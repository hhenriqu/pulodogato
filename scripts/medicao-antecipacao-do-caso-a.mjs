#!/usr/bin/env node
// =====================================================
// MEDICAO EM PRODUCAO -- antecipar no CASO A (HMO-396, F3 da HMO-393)
// =====================================================
//   node scripts/medicao-antecipacao-do-caso-a.mjs
//
// NAO E SUITE: nao roda no CI, nao tem assercao de `node:test`. E a medicao que
// a issue exige, com as QUATRO coisas que ela pede por nome:
//
//   1. as duas parcelas da cauda `paid`;
//   2. as duas previsoes da cauda BAIXADAS, NAO SUMIDAS -- e a diferenca entre
//      as duas e a entrega desta fase;
//   3. DUAS pernas por parcela (saida e entrada), que e o que torna o Caso A
//      diferente do Caso B;
//   4. o saldo das duas contas fechando: o que saiu da corrente entrou no
//      investimento, real a real.
//
// UMA CONTA SO, E ISSO E O QUE DEFINE O CASO A
// -------------------------------------------
// O irmao deste script (`medicao-antecipacao-do-mybank.mjs`, HMO-395) precisa de
// DUAS contas porque o Caso B tem dois lados e o lado da devedora sai por outra
// RLS. Aqui o credor e o devedor sao a MESMA pessoa -- e e exatamente isso que
// faz a parcela existir TAMBEM em `scheduled_transactions`, como transferencia
// prevista com o elo `mybank:<id da parcela>`. As duas contas desta medicao sao
// as duas CONTAS DE DINHEIRO da mesma pessoa: a corrente e a de investimento.
//
// POR QUE O PASSO 4 CONTA AS LINHAS EM VEZ DE LER `previsoes_baixadas`
// -------------------------------------------------------------------
// A resposta da rota tem o campo `previsoes_baixadas`, e ele NAO SERVE como
// prova aqui: um DELETE no lugar do UPDATE devolveria o mesmo numero com as
// linhas sumidas. Entao a medicao conta as linhas com o elo ANTES e DEPOIS, e o
// que ela afirma e que o numero nao caiu -- `baixadas` e `apagadas` se
// distinguem no estado da tabela, nao no que a rota diz ter feito.
//
// E POR QUE O PASSO 5 NAO ACREDITA NO SALDO DA TELA
// ------------------------------------------------
// O saldo de uma conta e DERIVADO das linhas de `financial_transactions`. Somar
// as pernas pelo elo e ler a mesma fonte de onde o saldo sai, sem depender de
// qual tela o arredonda -- e e a soma que denuncia a perna faltando: com UMA
// perna por parcela (o defeito do Caso B aplicado aqui) a corrente cairia
// R$ 100 e o investimento nao receberia nada.
//
// O CONTROLE NEGATIVO JA FOI RODADO, E CONTRA A `main` DE ANTES DESTA ENTREGA
// --------------------------------------------------------------------------
// Rodado em 2026-10-11 contra producao com a F2 publicada (a F3 ainda nao), e
// ele reprovou em TODAS as quatro coisas -- que e o que prova que este script
// mede a F3 e nao algo que ja funcionava (`piso-com-folga-desarma-o-controle-
// negativo`):
//
//   PASSO 1  o auto-emprestimo nasceu com as 4 previsoes (201, previsoes_criadas: 4)
//   PASSO 3  POST antecipacao: 400 "Este emprestimo e para voce mesmo..."
//   (1)      parcelas 1:pending 2:pending 3:pending 4:pending   <<< NAO E O ESPERADO
//   (2)      previsoes 4 -> 4, baixadas (status=paid): 0         <<< NAO SAO DUAS
//   (3)      pernas das duas parcelas: 0                         <<< NAO SAO QUATRO
//   (4)      corrente R$ 0,00 / investimento R$ 0,00             <<< O SALDO NAO FECHA
//   PASSO 6  400 em vez de 409                                   <<< NAO E 409
//
// O PASSO 1 passando no controle negativo e o que importa ali: o fixture do Caso
// A (emprestimo + 4 parcelas + 4 previsoes com o elo) e real em producao HOJE, e
// o que falta e so a antecipacao sabe-lo baixar.
//
// CREDENCIAIS: a conta de teste que ja existe em producao (memoria
// `conta-de-teste-em-prod`). A anon key sai do `.env.local`, que nao esta no git.
// =====================================================

import { readFileSync } from "node:fs";

const APP = "https://pulodogato.hmoraes.com.br";

const ENV = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const le = (chave) => {
  const achado = ENV.match(new RegExp(`^${chave}=(.*)$`, "m"));
  return achado ? achado[1].trim() : null;
};

const SUPABASE = le("NEXT_PUBLIC_SUPABASE_URL");
const ANON = le("NEXT_PUBLIC_SUPABASE_ANON_KEY");

if (!ANON || !ANON.startsWith("eyJ")) {
  throw new Error(`anon key invalida no .env.local: ${String(ANON).slice(0, 24)}`);
}

const REF = new URL(SUPABASE).hostname.split(".")[0];

const CONTA_A = {
  nome: "A (a pessoa)",
  email: "teste-hmo161-1790379476@hmoraes.com.br",
  senha: "PuloGato!1790379476",
};

const MARCA = `HMO396-${Date.now()}`;

async function entrar(conta) {
  const r = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: conta.email, password: conta.senha }),
  });
  const sessao = await r.json();
  if (!sessao.access_token) {
    throw new Error(`login de ${conta.nome} falhou: ${JSON.stringify(sessao)}`);
  }

  // O cookie do @supabase/ssr: `base64-` + a sessao INTEIRA em base64.
  const cookie =
    `sb-${REF}-auth-token=base64-` +
    Buffer.from(JSON.stringify(sessao)).toString("base64");

  if (cookie.length > 3180) {
    throw new Error(`cookie de ${conta.nome} grande demais (${cookie.length})`);
  }

  return { ...conta, jwt: sessao.access_token, id: sessao.user.id, cookie };
}

/** Uma chamada a rota do app, como se fosse o navegador da pessoa. */
async function rota(quem, caminho, { metodo = "GET", corpo } = {}) {
  const r = await fetch(`${APP}${caminho}`, {
    method: metodo,
    headers: {
      Cookie: quem.cookie,
      ...(corpo ? { "Content-Type": "application/json" } : {}),
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });

  const texto = await r.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    json = { __html: texto.slice(0, 120) };
  }
  return { status: r.status, corpo: json };
}

/** O PostgREST com a sessao da propria conta (a RLS dela vale). */
async function tabela(quem, consulta, { metodo = "GET", corpo } = {}) {
  const r = await fetch(`${SUPABASE}/rest/v1/${consulta}`, {
    method: metodo,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${quem.jwt}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await r.text();
  try {
    return { status: r.status, corpo: JSON.parse(texto) };
  } catch {
    return { status: r.status, corpo: texto.slice(0, 200) };
  }
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}

const linha = (...xs) => console.log(...xs);
const reais = (centavos) => `R$ ${(centavos / 100).toFixed(2)}`;
const emCentavos = (n) => Math.round(Number(n) * 100);

/** As parcelas da serie, na ordem, direto da tabela. */
async function parcelas(quem, loanId) {
  const r = await tabela(
    quem,
    `mybank_installments?select=id,installment_number,status,amount,due_date,paid_date,paid_transaction_id&loan_id=eq.${loanId}&order=installment_number`
  );
  return r.corpo ?? [];
}

/**
 * As previsoes da serie, PELO ELO -- e e esta consulta que distingue baixada de
 * apagada: ela conta as linhas que EXISTEM com aquele `notes`.
 */
async function previsoes(quem, elos) {
  if (elos.length === 0) return [];
  const r = await tabela(
    quem,
    `scheduled_transactions?select=id,notes,status,paid_date,transaction_id,amount,due_date,account_id,destination_account_id&notes=in.(${elos.join(
      ","
    )})&order=due_date`
  );
  return r.corpo ?? [];
}

// ---------------------------------------------------------------------------

const A = await entrar(CONTA_A);
linha(`A = ${A.id}`);
linha(`marca = ${MARCA}\n`);

// A ROTA EXISTE? O 404 em HTML e "o deploy ainda nao subiu", e ele tem de ser
// distinguido ANTES de qualquer escrita -- senao a prova mede a ausencia do
// deploy achando que mede a feature (`verify-404-is-a-false-positive-trap`).
const sonda = await rota(A, `/api/mybank/loans/${uuid()}/antecipacao`, {
  metodo: "POST",
  corpo: { parcelas: 1 },
});
if (sonda.corpo.__html) {
  throw new Error(
    "POST /api/mybank/loans/[id]/antecipacao NAO esta publicado (404 em HTML). " +
      "Espere o deploy da Vercel."
  );
}
linha(`sonda da rota: ${sonda.status} ${JSON.stringify(sonda.corpo)}\n`);

// --- as DUAS contas de dinheiro ---------------------------------------------
const contas = await rota(A, "/api/financial-accounts");
const todas = contas.corpo.accounts ?? [];

let investimento = todas.find((c) => c.account_type === "investment");
if (!investimento) {
  const criada = await rota(A, "/api/financial-accounts", {
    metodo: "POST",
    corpo: {
      name: "Carteira de investimento (teste)",
      account_type: "investment",
      icon: "piggy-bank",
    },
  });
  investimento = criada.corpo.account;
  if (!investimento) throw new Error("nao consegui criar a conta credora");
}

// A CONTA DE PAGAMENTO, e ela NAO pode ser a de investimento: e dela que a
// previsao debita, e `mybank_loans_conta_de_pagamento_check` (053) recusa a
// mesma conta nos dois lados.
let corrente = todas.find(
  (c) => c.account_type !== "investment" && c.id !== investimento.id
);
if (!corrente) {
  const criada = await rota(A, "/api/financial-accounts", {
    metodo: "POST",
    corpo: {
      name: "Conta corrente (teste)",
      account_type: "checking",
      icon: "wallet",
    },
  });
  corrente = criada.corpo.account;
  if (!corrente) throw new Error("nao consegui criar a conta de pagamento");
}

linha(`corrente     = ${corrente.name} (${corrente.id})`);
linha(`investimento = ${investimento.name} (${investimento.id})\n`);

const hoje = new Date();
const PRIMEIRO_VENCIMENTO = `${hoje.getUTCFullYear()}-${String(
  hoje.getUTCMonth() + 2
).padStart(2, "0")}-15`;

// ===========================================================================
// PASSO 1 -- o auto-emprestimo: 4 x R$ 50, de mim para mim
// ===========================================================================
linha("=== PASSO 1: auto-emprestimo de 4 x R$ 50 ===");

// `devedor_id` AUSENTE e o que define o Caso A (ver `casoDoEmprestimo`), e
// `conta_de_pagamento_id` e o que faz as quatro previsoes nascerem.
const loan = uuid();
const criado = await rota(A, "/api/mybank/loans", {
  metodo: "POST",
  corpo: {
    id: loan,
    descricao: `${MARCA} caso A`,
    conta_credora_id: investimento.id,
    conta_de_pagamento_id: corrente.id,
    valor: "50.00",
    base: "parcela",
    parcelas: 4,
    primeiro_vencimento: PRIMEIRO_VENCIMENTO,
  },
});
linha(`POST loans: ${criado.status} ${JSON.stringify(criado.corpo)}\n`);
if (criado.status >= 400) throw new Error("o emprestimo nao nasceu");

// ===========================================================================
// PASSO 2 -- ANTES: as 4 parcelas e as 4 previsoes
// ===========================================================================
linha("=== PASSO 2: ANTES ===");

const parcelasAntes = await parcelas(A, loan);
const elos = parcelasAntes.map((p) => `mybank:${p.id}`);
const previsoesAntes = await previsoes(A, elos);

linha(
  `parcelas: ${parcelasAntes
    .map((p) => `${p.installment_number}:${p.status}`)
    .join(" ")}`
);
linha(
  `previsoes com o elo: ${previsoesAntes.length} ` +
    `(${previsoesAntes.map((p) => p.status).join(" ")})`
);

// O CONTROLE DESTA MEDICAO. Sem as quatro previsoes o Caso A nao esta montado, e
// a antecipacao seria recusada em 409 -- a medicao mediria a recusa achando que
// mede a feature.
if (previsoesAntes.length !== 4) {
  throw new Error(
    `o Caso A nao nasceu com as 4 previsoes (${previsoesAntes.length}): ` +
      "sem elas a antecipacao e recusada, e esta medicao nao mede nada."
  );
}
linha("");

// ===========================================================================
// PASSO 3 -- antecipar 2
// ===========================================================================
linha("=== PASSO 3: antecipar 2 ===");

const antecipado = await rota(A, `/api/mybank/loans/${loan}/antecipacao`, {
  metodo: "POST",
  corpo: { parcelas: 2 },
});
linha(
  `POST antecipacao: ${antecipado.status} ${JSON.stringify(antecipado.corpo)}\n`
);

// ===========================================================================
// PASSO 4 -- AS QUATRO COISAS QUE A ISSUE PEDE
// ===========================================================================
linha("=== PASSO 4: as quatro coisas ===");

const parcelasDepois = await parcelas(A, loan);
const previsoesDepois = await previsoes(A, elos);

// (1) AS DUAS PARCELAS DA CAUDA `paid`, e as da cabeca intactas.
const estado = (n) =>
  parcelasDepois.find((p) => p.installment_number === n) ?? {};
const esperado = { 1: "pending", 2: "pending", 3: "paid", 4: "paid" };
const parcelasOk = [1, 2, 3, 4].every((n) => estado(n).status === esperado[n]);

linha(
  `(1) parcelas: ${parcelasDepois
    .map((p) => `${p.installment_number}:${p.status}`)
    .join(" ")}` + (parcelasOk ? "   OK (3 e 4 pagas)" : "   <<< NAO E O ESPERADO")
);

// E o valor de quem sobra NAO mudou -- a decisao de produto.
const valorIntacto = [1, 2].every((n) => emCentavos(estado(n).amount) === 5000);
linha(
  `    as que sobram mantem o valor: ${[1, 2]
    .map((n) => reais(emCentavos(estado(n).amount)))
    .join(" ")}` + (valorIntacto ? "   OK" : "   <<< O AMOUNT FOI TOCADO")
);

// (2) AS PREVISOES BAIXADAS, NAO SUMIDAS -- a entrega desta fase.
const sumiram = previsoesAntes.length - previsoesDepois.length;
const baixadas = previsoesDepois.filter((p) => p.status === "paid");

linha(
  `(2) previsoes com o elo: ${previsoesAntes.length} antes -> ${previsoesDepois.length} depois` +
    (sumiram === 0
      ? "   OK (nenhuma sumiu)"
      : `   <<< ${sumiram} PREVISAO(OES) FORAM APAGADAS`)
);
linha(
  `    baixadas (status=paid): ${baixadas.length}` +
    (baixadas.length === 2 ? "   OK" : "   <<< NAO SAO DUAS")
);
for (const p of previsoesDepois) {
  linha(
    `      ${p.notes} ${p.status} vence ${p.due_date}` +
      (p.status === "paid"
        ? ` pago em ${p.paid_date}, perna ${String(p.transaction_id).slice(0, 8)}`
        : "")
  );
}

// E O CAMPO DA RESPOSTA, CONFERIDO CONTRA AS LINHAS -- e nao no lugar delas.
linha(
  `    a resposta disse previsoes_baixadas=${antecipado.corpo.previsoes_baixadas}` +
    (antecipado.corpo.previsoes_baixadas === baixadas.length
      ? "   (confere com as linhas)"
      : "   <<< O CAMPO DISCORDA DAS LINHAS")
);

// (3) DUAS PERNAS POR PARCELA.
const elosDaCauda = [3, 4].map((n) => `mybank:${estado(n).id}`);
const pernas = await tabela(
  A,
  `financial_transactions?select=id,account_id,amount,transaction_type,notes,counterpart_transaction_id&notes=in.(${elosDaCauda.join(
    ","
  )})&order=notes`
);
const linhasDePernas = pernas.corpo ?? [];

linha(
  `(3) pernas das duas parcelas: ${linhasDePernas.length}` +
    (linhasDePernas.length === 4
      ? "   OK (duas por parcela)"
      : "   <<< NAO SAO QUATRO")
);
for (const p of linhasDePernas) {
  const onde = p.account_id === corrente.id ? "corrente" : "investimento";
  linha(
    `      ${p.notes} ${onde} ${reais(emCentavos(p.amount))} ${p.transaction_type}`
  );
}

const soTransfer = linhasDePernas.every((p) => p.transaction_type === "transfer");
linha(
  `    todas sao 'transfer': ${soTransfer}` +
    (soTransfer ? "   OK (principal voltando nao e receita)" : "   <<< TEM income/expense")
);

// (4) O SALDO DAS DUAS CONTAS FECHANDO.
const somaDaConta = (contaId) =>
  linhasDePernas
    .filter((p) => p.account_id === contaId)
    .reduce((t, p) => t + emCentavos(p.amount), 0);

const naCorrente = somaDaConta(corrente.id);
const noInvestimento = somaDaConta(investimento.id);

linha(
  `(4) corrente ${reais(naCorrente)} / investimento ${reais(noInvestimento)}` +
    (naCorrente === -10000 && noInvestimento === 10000
      ? "   OK (R$ 100 sairam e R$ 100 entraram)"
      : "   <<< O SALDO NAO FECHA")
);
linha(
  `    soma das duas pontas: ${reais(naCorrente + noInvestimento)}` +
    (naCorrente + noInvestimento === 0
      ? "   OK (transferir nao muda o patrimonio)"
      : "   <<< O PATRIMONIO MUDOU")
);

// E A INVARIANTE DA DIVIDA, que nao esta em tela nenhuma.
{
  const centavos = (status) =>
    parcelasDepois
      .filter((p) => status.includes(p.status))
      .reduce((t, p) => t + emCentavos(p.amount), 0);

  const pagas = centavos(["paid"]);
  const emAberto = centavos(["pending", "reported"]);
  const canceladas = centavos(["cancelled"]);

  linha("");
  linha(
    `    pagas ${reais(pagas)} + em aberto ${reais(emAberto)} = ${reais(
      pagas + emAberto
    )}  (principal R$ 200,00)` +
      (pagas + emAberto === 20000 ? "   OK" : "   <<< NAO FECHA")
  );
  linha(
    `    canceladas: ${reais(canceladas)}` +
      (canceladas === 0
        ? "   (nenhuma, como tem de ser)"
        : "   <<< A CAUDA FOI CANCELADA")
  );
}
linha("");

// ===========================================================================
// PASSO 5 -- A FRASE, e ela fala da OUTRA tela
// ===========================================================================
linha("=== PASSO 5: a frase da resposta ===");
linha(`  "${antecipado.corpo.message}"`);
linha(
  `  diz que as contas a pagar foram baixadas: ${/baixadas/i.test(
    String(antecipado.corpo.message)
  )}`
);
linha("");

// ===========================================================================
// PASSO 6 -- a previsao da cauda APAGADA A MAO: 409, e nada e escrito
// ===========================================================================
// O caminho de recusa que a F3 criou, e ele e real: quem apagar a conta a pagar
// da parcela 4 em Contas a Pagar deixa a parcela sem de onde debitar. A rota
// recusa nomeando a parcela, em vez de escolher uma conta por conta propria.
linha("=== PASSO 6: previsao apagada a mao ===");

const daParcela2 = previsoesDepois.find(
  (p) => p.notes === `mybank:${estado(2).id}`
);

if (daParcela2) {
  await tabela(A, `scheduled_transactions?id=eq.${daParcela2.id}`, {
    metodo: "DELETE",
  });

  const recusado = await rota(A, `/api/mybank/loans/${loan}/antecipacao`, {
    metodo: "POST",
    corpo: { parcelas: 1 },
  });

  linha(
    `POST antecipacao (1, sem a previsao da 2): ${recusado.status} ` +
      JSON.stringify(recusado.corpo)
  );
  linha(
    recusado.status === 409
      ? "   OK (409, e a frase nomeia a parcela)"
      : "   <<< NAO E 409"
  );

  const depoisDaRecusa = await parcelas(A, loan);
  const intacta =
    (depoisDaRecusa.find((p) => p.installment_number === 2) ?? {}).status ===
    "pending";
  linha(
    `   a parcela 2 continua pending: ${intacta}` +
      (intacta ? "   OK (nada foi escrito)" : "   <<< A RECUSA ESCREVEU")
  );
}
linha("");

// ===========================================================================
// LIMPEZA -- dado meu na conta de teste aparece na tela dele
// ===========================================================================
linha("=== limpeza ===");

const pernasAApagar = await tabela(
  A,
  `financial_transactions?select=id&notes=in.(${elos.join(",")})`
);
for (const p of pernasAApagar.corpo ?? []) {
  await tabela(A, `financial_transactions?id=eq.${p.id}`, { metodo: "DELETE" });
}
linha(`pernas apagadas: ${(pernasAApagar.corpo ?? []).length}`);

const previsoesAApagar = await previsoes(A, elos);
for (const p of previsoesAApagar) {
  await tabela(A, `scheduled_transactions?id=eq.${p.id}`, { metodo: "DELETE" });
}
linha(`previsoes apagadas: ${previsoesAApagar.length}`);

// `mybank_installments_paid_check` e `(status='paid') = (paid_date IS NOT
// NULL)`: os tres campos voltam JUNTOS, senao o UPDATE cai em 23514.
const voltaram = await tabela(A, `mybank_installments?loan_id=eq.${loan}`, {
  metodo: "PATCH",
  corpo: { status: "pending", paid_date: null, paid_transaction_id: null },
});
linha(`parcelas devolvidas a pending: ${voltaram.status}`);

const apagado = await tabela(A, `mybank_loans?id=eq.${loan}`, {
  metodo: "DELETE",
});
linha(
  `DELETE emprestimo: ${apagado.status} ${JSON.stringify(apagado.corpo).slice(
    0,
    120
  )}`
);

const restou = await tabela(
  A,
  `mybank_loans?select=id,description,status&description=like.${MARCA}*`
);
linha(`sobrou da marca: ${JSON.stringify(restou.corpo)}`);
