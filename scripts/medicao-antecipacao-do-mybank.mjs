#!/usr/bin/env node
// =====================================================
// MEDICAO EM PRODUCAO -- antecipar parcelas do MyBank (HMO-395, F2 da HMO-393)
// =====================================================
//   node scripts/medicao-antecipacao-do-mybank.mjs
//
// NAO E SUITE: nao roda no CI, nao tem assercao de `node:test`. E o script dos
// SETE PASSOS que a issue exige, com os numeros ANTES e DEPOIS nas duas telas.
// A forma e a de `scripts/medicao-cancelamento-do-mybank.mjs` (HMO-391) de
// proposito: a corrente (login dos dois lados, cookie SSR forjado, conexao
// refeita, conta de investimento criada pela rota) leva mais tempo para
// reconstruir do que para ler.
//
// POR QUE AS DUAS CONTAS, E POR QUE A SEGUNDA E A QUE PROVA A FEATURE
// ------------------------------------------------------------------
// A antecipacao mexe no `aReceber` do CREDOR e no bloco da DEVEDORA, e o
// segundo e o unico que prova que a serie ENCURTOU: o lado dela sai pela view
// `mybank_due_entries`, com a RLS dela, e a unica forma de saber que duas
// parcelas sairam de lá e LER PELA CONTA DELA (`provar-grupo-em-prod-escreve-
// por-uma-conta-le-por-outra`).
//
// O PASSO 4 E O TESTE DA FEATURE INTEIRA
// -------------------------------------
// `2/6` com o vencimento da PARCELA 1 INTACTO e o fim da serie dois meses mais
// perto e o unico resultado que distingue este desenho de todos os outros:
//
//   * se a serie nao encurtasse, o fim continuaria no mes 6 -- o dinheiro teria
//     entrado e a decisao de produto nao teria sido cumprida;
//   * se a escolha pegasse a CABECA, o primeiro vencimento andaria para o mes 3
//     e o fim ficaria no mes 6 -- a serie NAO encurta e ninguem percebe pelo
//     total, que e o mesmo;
//   * se a cauda fosse CANCELADA (o desenho do item 2 da HMO-393), as telas
//     ficariam iguais a estas e o credor teria recebido R$ 200 por uma divida
//     de R$ 600 que se resolveu com R$ 400. E por isso o passo 5 soma as
//     parcelas: `soma(pagas) + soma(em aberto)` tem de continuar sendo o
//     principal, e esse numero nao esta em tela nenhuma.
//
// O QUE ESTE SCRIPT NAO MEDE, E ESTA DITO PARA NAO PARECER MEDIDO
// --------------------------------------------------------------
// O rotulo "de <mes 1> a <mes 4>" e montado na TELA, por
// `escopoDoBlocoDoDevedor` (`lib/mybank-na-tela.ts`), a partir dos vencimentos
// que `/api/mybank/due` devolve. Este script imprime o PRIMEIRO e o ULTIMO
// vencimento daquela resposta -- o mesmo dado de onde o rotulo sai --, e nao o
// rotulo renderizado. Afirmar o texto exigiria sonda de navegador, e a parte
// que pode estar errada aqui e o DADO.
//
// CREDENCIAIS: as duas contas de teste que ja existem em producao (memorias
// `conta-de-teste-em-prod` e `par-de-contas-a-e-b-conectadas-em-prod`). A anon
// key sai do `.env.local`, que nao esta no git.
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

// A anon key de placeholder faz o login responder "Invalid API key" com um hint
// sobre permissao -- que manda procurar o problema na conta.
if (!ANON || !ANON.startsWith("eyJ")) {
  throw new Error(`anon key invalida no .env.local: ${String(ANON).slice(0, 24)}`);
}

const REF = new URL(SUPABASE).hostname.split(".")[0];

const CONTA_A = {
  nome: "A (credora)",
  email: "teste-hmo161-1790379476@hmoraes.com.br",
  senha: "PuloGato!1790379476",
};

const CONTA_B = {
  nome: "B (devedora)",
  email: "teste-hmo374-1791680245339@hmoraes.com.br",
  senha: "PuloGato!1791680245339",
};

const MARCA = `HMO395-${Date.now()}`;

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
    // 404 do Next vem em HTML: e assim que "a rota nao foi publicada ainda" se
    // parece, e e diferente de "a rota respondeu erro".
    json = { __html: texto.slice(0, 120) };
  }
  return { status: r.status, corpo: json };
}

/**
 * O PostgREST com a sessao da propria conta (a RLS dela vale).
 *
 * `corpo` existe para o PATCH da limpeza. Sem ele, um PATCH sem corpo responde
 * erro do PostgREST -- e a limpeza falharia DEPOIS de a medicao ter passado,
 * deixando dado da marca na conta de teste sem nada no log explicando por que.
 */
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

/**
 * O PAINEL DO CREDOR: `n/m`, quanto falta receber, e qual e o PROXIMO
 * vencimento.
 *
 * O proximo vencimento esta aqui porque ele e a metade do passo 4 que o total
 * nao mede: antecipar encurta a serie pelo FIM, entao ele tem de ficar PARADO.
 * Se a escolha pegasse a cabeca, este numero andaria -- e o `a receber` seria
 * exatamente o mesmo.
 */
async function painelDoCredor(quem, loanId) {
  const r = await rota(quem, "/api/mybank/loans");
  if (r.status !== 200) {
    throw new Error(`GET loans de ${quem.nome}: ${r.status} ${JSON.stringify(r.corpo)}`);
  }

  const emprestimo = (r.corpo.loans ?? []).find((l) => l.id === loanId);
  if (!emprestimo) {
    // A lista filtra `status = 'active'`: um emprestimo ausente aqui pode ser
    // "quitado" (o passo 7) ou "nunca existiu", e os dois NAO sao a mesma
    // coisa. Quem chama distingue pela leitura da tabela.
    return { presente: false };
  }

  const pagas = emprestimo.parcelas.filter((p) => p.status === "paid");
  const emAberto = emprestimo.parcelas.filter((p) =>
    ["pending", "reported"].includes(p.status)
  );

  const centavos = (xs) =>
    xs.reduce((t, p) => t + Math.round(Number(p.valor) * 100), 0);

  return {
    presente: true,
    status: emprestimo.status,
    progresso: `${pagas.length}/${emprestimo.total_de_parcelas}`,
    aReceber: centavos(emAberto) / 100,
    jaRecebido: centavos(pagas) / 100,
    // A INVARIANTE, calculada aqui porque nenhuma tela a mostra.
    somaFechaComOPrincipal:
      centavos(pagas) + centavos(emAberto) ===
      Math.round(Number(emprestimo.principal) * 100),
    proximoVencimento: emAberto.map((p) => p.vencimento).sort()[0] ?? null,
    ultimoVencimento: emAberto.map((p) => p.vencimento).sort().slice(-1)[0] ?? null,
  };
}

/**
 * O BLOCO DA DEVEDORA, pelos vencimentos que a rota devolve -- o dado de onde a
 * tela monta "de <mes 1> a <mes 4>". Ver O QUE ESTE SCRIPT NAO MEDE.
 */
async function blocoDaDevedora(quem, loanId) {
  const r = await rota(quem, "/api/mybank/due");
  if (r.status !== 200) {
    throw new Error(`GET due de ${quem.nome}: ${r.status} ${JSON.stringify(r.corpo)}`);
  }

  const minhas = (r.corpo.parcelas ?? []).filter((p) => p.loan_id === loanId);
  const vencimentos = minhas.map((p) => p.vencimento).sort();

  const mes = (iso) => (iso ? iso.slice(0, 7).split("-").reverse().join("/") : null);

  return {
    linhas: minhas.length,
    de: mes(vencimentos[0]),
    ate: mes(vencimentos[vencimentos.length - 1]),
    rotulos: minhas.map((p) => p.rotulo).sort(),
  };
}

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );
}

const linha = (...xs) => console.log(...xs);

// ---------------------------------------------------------------------------

const A = await entrar(CONTA_A);
const B = await entrar(CONTA_B);

linha(`A = ${A.id}`);
linha(`B = ${B.id}`);
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
// 404 em JSON e a resposta CERTA para um id inventado: a rota existe e nao achou
// o emprestimo. E o controle positivo da sonda.
linha(`sonda da rota: ${sonda.status} ${JSON.stringify(sonda.corpo)}\n`);

// --- a conexao entre as duas contas -----------------------------------------
{
  const atual = await tabela(
    A,
    `user_connections?select=id,status&or=(and(requester_id.eq.${A.id},requested_id.eq.${B.id}),and(requester_id.eq.${B.id},requested_id.eq.${A.id}))`
  );

  const aceita = (atual.corpo ?? []).find((c) => c.status === "accepted");

  if (aceita) {
    linha(`conexao: ja aceita (${aceita.id})`);
  } else {
    for (const c of atual.corpo ?? []) {
      await tabela(A, `user_connections?id=eq.${c.id}`, { metodo: "DELETE" });
    }
    const pedido = await rota(A, "/api/connections", {
      metodo: "POST",
      corpo: { requested_id: B.id },
    });
    const idDoPedido = pedido.corpo?.connection?.id ?? pedido.corpo?.id;
    const aceite = await rota(B, `/api/connections/requests/${idDoPedido}`, {
      metodo: "PUT",
      corpo: { action: "accept" },
    });
    linha(
      `conexao: criada (${pedido.status}) e aceita (${aceite.status}) -- ${idDoPedido}`
    );
  }
}

// --- a conta credora de A ---------------------------------------------------
const contasDeA = await rota(A, "/api/financial-accounts");
let investimento = (contasDeA.corpo.accounts ?? []).find(
  (c) => c.account_type === "investment"
);

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
linha(`conta credora = ${investimento.name} (${investimento.id})\n`);

// O primeiro vencimento e no MES QUE VEM: a parcela 1 fica em aberto e e o
// `proximoVencimento` que tem de ficar parado no passo 4.
const hoje = new Date();
const PRIMEIRO_VENCIMENTO = `${hoje.getUTCFullYear()}-${String(
  hoje.getUTCMonth() + 2
).padStart(2, "0")}-15`;

// ===========================================================================
// PASSO 1 -- o emprestimo de A para B, 6 x R$ 100
// ===========================================================================
linha("=== PASSO 1: A empresta para B, 6 x R$ 100 ===");

const loan = uuid();
const criado = await rota(A, "/api/mybank/loans", {
  metodo: "POST",
  corpo: {
    id: loan,
    descricao: `${MARCA} antecipacao`,
    conta_credora_id: investimento.id,
    devedor_id: B.id,
    valor: "100.00",
    base: "parcela",
    parcelas: 6,
    primeiro_vencimento: PRIMEIRO_VENCIMENTO,
  },
});
linha(`POST loans: ${criado.status} ${JSON.stringify(criado.corpo)}\n`);

if (criado.status >= 400) throw new Error("o emprestimo nao nasceu");

// ===========================================================================
// PASSO 2 -- ANTES, nas duas telas
// ===========================================================================
linha("=== PASSO 2: ANTES ===");

const antesDeA = await painelDoCredor(A, loan);
const antesDeB = await blocoDaDevedora(B, loan);
linha(`A (painel do MyBank): ${JSON.stringify(antesDeA)}`);
linha(`B (Contas a Pagar):   ${JSON.stringify(antesDeB)}\n`);

// ===========================================================================
// PASSO 3 -- antecipar 2 pela conta A
// ===========================================================================
linha("=== PASSO 3: antecipar 2 ===");

const antecipado = await rota(A, `/api/mybank/loans/${loan}/antecipacao`, {
  metodo: "POST",
  corpo: { parcelas: 2 },
});
linha(`POST antecipacao: ${antecipado.status} ${JSON.stringify(antecipado.corpo)}\n`);

// ===========================================================================
// PASSO 4 -- DEPOIS. O teste da feature inteira
// ===========================================================================
linha("=== PASSO 4: DEPOIS (o teste da feature inteira) ===");

const depoisDeA = await painelDoCredor(A, loan);
const depoisDeB = await blocoDaDevedora(B, loan);
linha(`A (painel do MyBank): ${JSON.stringify(depoisDeA)}`);
linha(`B (Contas a Pagar):   ${JSON.stringify(depoisDeB)}`);

linha("");
linha(`progresso:            ${antesDeA.progresso} -> ${depoisDeA.progresso}`);
linha(`a receber:            ${antesDeA.aReceber} -> ${depoisDeA.aReceber}`);
linha(
  `PROXIMO vencimento:   ${antesDeA.proximoVencimento} -> ${depoisDeA.proximoVencimento}` +
    (antesDeA.proximoVencimento === depoisDeA.proximoVencimento
      ? "   (PARADO, como tem de ser)"
      : "   <<< ANDOU: a escolha nao pegou a cauda")
);
linha(
  `FIM da serie:         ${antesDeA.ultimoVencimento} -> ${depoisDeA.ultimoVencimento}` +
    (antesDeA.ultimoVencimento !== depoisDeA.ultimoVencimento
      ? "   (ENCURTOU)"
      : "   <<< NAO ENCURTOU")
);
linha(
  `bloco de B:           de ${antesDeB.de} a ${antesDeB.ate} (${antesDeB.linhas} linhas) ` +
    `-> de ${depoisDeB.de} a ${depoisDeB.ate} (${depoisDeB.linhas} linhas)`
);
linha(
  `soma fecha com o principal: antes=${antesDeA.somaFechaComOPrincipal} depois=${depoisDeA.somaFechaComOPrincipal}` +
    (depoisDeA.somaFechaComOPrincipal
      ? ""
      : "   <<< PERDEU DINHEIRO: e o desenho que cancela a cauda")
);
linha("");

// ===========================================================================
// PASSO 5 -- as DUAS pernas, e o elo de cada parcela
// ===========================================================================
linha("=== PASSO 5: as duas pernas em financial_transactions ===");

const parcelasDeA = await tabela(
  A,
  `mybank_installments?select=id,installment_number,status,amount,due_date,paid_date,paid_transaction_id&loan_id=eq.${loan}&order=installment_number`
);
linha(`parcelas: ${JSON.stringify(parcelasDeA.corpo)}`);

const elos = (parcelasDeA.corpo ?? []).map((p) => `mybank:${p.id}`);
const pernas = await tabela(
  A,
  `financial_transactions?select=id,transaction_type,amount,account_id,notes,transaction_date&notes=in.(${elos.join(",")})&order=transaction_date`
);
linha(`pernas: ${JSON.stringify(pernas.corpo)}`);

{
  const linhasDePerna = pernas.corpo ?? [];
  const soma =
    linhasDePerna.reduce((t, p) => t + Math.round(Number(p.amount) * 100), 0) / 100;
  const tipos = [...new Set(linhasDePerna.map((p) => p.transaction_type))];
  const naConta = linhasDePerna.every((p) => p.account_id === investimento.id);

  // CADA PARCELA APONTA PARA A PERNA DELA: dois `paid_transaction_id`
  // DIFERENTES. Iguais, uma das pernas ficaria sem divida que a explicasse.
  const pagas = (parcelasDeA.corpo ?? []).filter((p) => p.status === "paid");
  const apontados = pagas.map((p) => p.paid_transaction_id);

  linha("");
  linha(`pernas: ${linhasDePerna.length} | soma R$ ${soma} | tipos ${JSON.stringify(tipos)}`);
  linha(`todas na conta de investimento: ${naConta}`);
  linha(
    `elos distintos: ${new Set(apontados).size} de ${apontados.length} parcelas pagas`
  );
  linha(
    `cada elo aponta para uma perna existente: ` +
      apontados.every((id) => linhasDePerna.some((p) => p.id === id))
  );
  linha("");
}

// ===========================================================================
// PASSO 6 -- a conta B chama a rota e leva 403
// ===========================================================================
linha("=== PASSO 6: a devedora chama a rota ===");

const pelaDevedora = await rota(B, `/api/mybank/loans/${loan}/antecipacao`, {
  metodo: "POST",
  corpo: { parcelas: 1 },
});
linha(
  `POST por B: ${pelaDevedora.status} ${JSON.stringify(pelaDevedora.corpo)}` +
    (pelaDevedora.status === 403 ? "   (403, como tem de ser)" : "   <<< NAO E 403")
);

// E NADA MUDOU. A policy FILTRA em vez de recusar, entao "403 na resposta" e
// "nenhuma escrita" sao duas afirmacoes diferentes -- e a segunda e a que
// importa.
const depoisDaDevedora = await painelDoCredor(A, loan);
linha(
  `A depois da tentativa de B: ${depoisDaDevedora.progresso} / a receber ${depoisDaDevedora.aReceber}` +
    (depoisDaDevedora.progresso === depoisDeA.progresso
      ? "   (intacto)"
      : "   <<< A TENTATIVA DE B ESCREVEU")
);
linha("");

// ===========================================================================
// PASSO 7 -- antecipar as 4 restantes: `settled` e sai das telas
// ===========================================================================
linha("=== PASSO 7: antecipar as 4 que sobram ===");

const quitou = await rota(A, `/api/mybank/loans/${loan}/antecipacao`, {
  metodo: "POST",
  corpo: { parcelas: 4 },
});
linha(`POST antecipacao (4): ${quitou.status} ${JSON.stringify(quitou.corpo)}`);

const noFimDeA = await painelDoCredor(A, loan);
const noFimDeB = await blocoDaDevedora(B, loan);

const loanNaTabela = await tabela(
  A,
  `mybank_loans?select=id,status,principal&id=eq.${loan}`
);

linha(`emprestimo na tabela: ${JSON.stringify(loanNaTabela.corpo)}`);
linha(
  `A (painel): ${
    noFimDeA.presente ? JSON.stringify(noFimDeA) : "FORA da lista A receber"
  }`
);
linha(`B (Contas a Pagar): ${JSON.stringify(noFimDeB)}`);

{
  // A SOMA NO FIM: tudo pago, nada em aberto, e o total continua o principal.
  const todas = await tabela(
    A,
    `mybank_installments?select=installment_number,status,amount&loan_id=eq.${loan}&order=installment_number`
  );
  const centavos = (status) =>
    (todas.corpo ?? [])
      .filter((p) => status.includes(p.status))
      .reduce((t, p) => t + Math.round(Number(p.amount) * 100), 0);

  const pagas = centavos(["paid"]);
  const emAberto = centavos(["pending", "reported"]);
  const canceladas = centavos(["cancelled"]);
  const principal = Math.round(
    Number((loanNaTabela.corpo ?? [{}])[0].principal ?? 0) * 100
  );

  linha("");
  linha(
    `pagas R$ ${pagas / 100} + em aberto R$ ${emAberto / 100} = R$ ${
      (pagas + emAberto) / 100
    }  (principal R$ ${principal / 100})` +
      (pagas + emAberto === principal ? "   OK" : "   <<< NAO FECHA")
  );
  linha(
    `canceladas: R$ ${canceladas / 100}` +
      (canceladas === 0 ? "   (nenhuma, como tem de ser)" : "   <<< A CAUDA FOI CANCELADA")
  );
  linha("");
}

// ===========================================================================
// LIMPEZA -- dado meu na conta de teste aparece na tela dele
// ===========================================================================
linha("=== limpeza ===");

// `mybank_loans_delete` recusa emprestimo com parcela `paid` de proposito, e
// aqui TODAS estao pagas: as pernas saem primeiro, as parcelas voltam a
// `pending`, e so entao o emprestimo.
const pernasAApagar = await tabela(
  A,
  `financial_transactions?select=id&notes=in.(${elos.join(",")})`
);
for (const p of pernasAApagar.corpo ?? []) {
  await tabela(A, `financial_transactions?id=eq.${p.id}`, { metodo: "DELETE" });
}
linha(`pernas apagadas: ${(pernasAApagar.corpo ?? []).length}`);

// `mybank_installments_paid_check` e `(status='paid') = (paid_date IS NOT
// NULL)`: os tres campos voltam JUNTOS, senao o UPDATE cai em 23514.
const voltaram = await tabela(A, `mybank_installments?loan_id=eq.${loan}`, {
  metodo: "PATCH",
  corpo: { status: "pending", paid_date: null, paid_transaction_id: null },
});
linha(`parcelas devolvidas a pending: ${voltaram.status}`);

const apagado = await tabela(A, `mybank_loans?id=eq.${loan}`, { metodo: "DELETE" });
linha(`DELETE emprestimo: ${apagado.status} ${JSON.stringify(apagado.corpo).slice(0, 120)}`);

const restou = await tabela(
  A,
  `mybank_loans?select=id,description,status&description=like.${MARCA}*`
);
linha(`sobrou da marca: ${JSON.stringify(restou.corpo)}`);
