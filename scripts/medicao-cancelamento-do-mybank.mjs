#!/usr/bin/env node
// =====================================================
// MEDICAO EM PRODUCAO -- o cancelamento do emprestimo do MyBank (HMO-391)
// =====================================================
//   node scripts/medicao-cancelamento-do-mybank.mjs
//
// NAO E SUITE: nao roda no CI, nao tem assercao de `node:test`. E o script da
// prova em producao que a issue exige, guardado porque a proxima fase do MyBank
// vai querer repeti-lo -- e porque a corrente (login dos DOIS lados, cookie SSR
// forjado, conexao refeita, escrita por uma conta e leitura pela outra) leva
// mais tempo para reconstruir do que para ler.
//
// O QUE ELE MEDE, E POR QUE PRECISA DAS DUAS CONTAS
// ------------------------------------------------
// A promessa da feature e "a divida sai das DUAS telas". Uma conta so nao
// consegue medir isso: o lado do devedor sai pela view `mybank_due_entries`, com
// a RLS DELE, e a unica forma de saber que ela parou de devolver a parcela e
// LER PELA CONTA DELE. Dai o par A/B.
//
//   CASO B (o controle positivo da issue): A empresta para B, as duas telas de B
//     mostram a parcela, A cancela, as duas telas de B param de mostrar.
//
//   CASO A (o controle negativo): auto-emprestimo de A com DUAS parcelas, a
//     primeira PAGA de verdade pela baixa da previsao (duas pernas em
//     `financial_transactions`), e depois cancelado. A parcela paga continua
//     `paid`, a previsao baixada continua lá, e so a pendente sai.
//
// O numero ANTES e DEPOIS esta impresso nos dois casos. "A linha sumiu" sem o
// numero de antes nao distingue feature de tela vazia.
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

const MARCA = `HMO391-${Date.now()}`;

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

/** O PostgREST com a sessao da propria conta (a RLS dela vale). */
async function tabela(quem, consulta, { metodo = "GET" } = {}) {
  const r = await fetch(`${SUPABASE}/rest/v1/${consulta}`, {
    method: metodo,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${quem.jwt}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });
  const texto = await r.text();
  try {
    return { status: r.status, corpo: JSON.parse(texto) };
  } catch {
    return { status: r.status, corpo: texto.slice(0, 200) };
  }
}

/**
 * AS DUAS TELAS DO LADO DE QUEM DEVE, pelas rotas que as alimentam.
 *
 * `lerDividaDoMyBank` e lida por QUATRO rotas, e as duas que a issue nomeia sao
 * estas: a aba Despesas (`/api/movimentacoes/resumo`) e Contas a Pagar
 * (`/api/scheduled-transactions`). Ler as duas e o que separa "a divida saiu de
 * uma tela" de "a divida saiu".
 */
async function telasDoDevedor(quem, de, ate) {
  // `tipo` E OBRIGATORIO E `de`/`ate` TEM ESSES NOMES: a rota responde 400 a
  // qualquer outra forma, de proposito (um `?tipo=` invalido caindo em
  // "expense" responderia numeros de despesa a quem pediu outra coisa). Medido
  // na primeira volta desta sonda: com `?inicio=&fim=` ela deu 400 nas DUAS
  // leituras, e `0 -> 0` passaria por "a parcela saiu" sem ter medido nada.
  const resumo = await rota(
    quem,
    `/api/movimentacoes/resumo?tipo=expense&de=${de}&ate=${ate}`
  );
  const agenda = await rota(
    quem,
    `/api/scheduled-transactions?start_date=${de}&end_date=${ate}`
  );

  const contar = (corpo) => {
    const texto = JSON.stringify(corpo ?? {});
    return (texto.match(new RegExp(MARCA, "g")) ?? []).length;
  };

  // O STATUS VAI JUNTO DO NUMERO, e nao e decoracao: 400 com 0 marcas e
  // indistinguivel de 200 com 0 marcas se so o numero for impresso.
  if (resumo.status !== 200 || agenda.status !== 200) {
    throw new Error(
      `leitura de ${quem.nome} nao respondeu 200: despesas=${resumo.status} ` +
        `agenda=${agenda.status} ${JSON.stringify(resumo.corpo).slice(0, 200)}`
    );
  }

  return {
    despesas: { status: resumo.status, marcas: contar(resumo.corpo) },
    contasAPagar: { status: agenda.status, marcas: contar(agenda.corpo) },
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
// distinguido antes de qualquer escrita -- senao a prova mede a ausencia do
// deploy achando que mede a feature.
const sonda = await rota(A, `/api/mybank/loans/${uuid()}`, {
  metodo: "PATCH",
  corpo: { status: "cancelled" },
});
if (sonda.corpo.__html) {
  throw new Error(
    `PATCH /api/mybank/loans/[id] NAO esta publicado (404 em HTML). ` +
      "Espere o deploy da Vercel."
  );
}
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
const corrente = (contasDeA.corpo.accounts ?? []).find(
  (c) => c.account_type === "checking"
);

if (!corrente) {
  throw new Error(
    `A nao tem conta corrente: ${JSON.stringify(
      (contasDeA.corpo.accounts ?? []).map((c) => c.account_type)
    )}`
  );
}

// A CONTA DE INVESTIMENTO NAO VEM NO PADRAO DA CONTA NOVA.
//
// As quatro que o cadastro cria sao `checking`, `cash`, `digital` e
// `credit_card` -- e o MyBank exige conta de investimento (a trava 1 da 053).
// Entao ela e criada aqui, pela ROTA, e FICA: a proxima fase do MyBank vai
// precisar dela, e criar/apagar a cada medicao gastaria uma ida e volta por
// prova sem provar nada a mais.
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
  linha(
    `conta de investimento CRIADA agora: ${criada.status} ${
      investimento ? investimento.id : JSON.stringify(criada.corpo)
    }`
  );
  if (!investimento) throw new Error("nao consegui criar a conta credora");
}
linha(`conta credora = ${investimento.name} (${investimento.id})`);
linha(`conta que paga = ${corrente.name} (${corrente.id})\n`);

// A janela das leituras: as parcelas nascem no mes que vem.
const hoje = new Date();
const DE = `${hoje.getUTCFullYear()}-01-01`;
const ATE = `${hoje.getUTCFullYear() + 2}-12-31`;
const PRIMEIRO_VENCIMENTO = `${hoje.getUTCFullYear()}-${String(
  hoje.getUTCMonth() + 2
).padStart(2, "0")}-15`;

// ===========================================================================
// CASO B -- o controle positivo: escrever por A, ler por B
// ===========================================================================
linha("=== CASO B: A empresta para B ===");

const loanB = uuid();
const criadoB = await rota(A, "/api/mybank/loans", {
  metodo: "POST",
  corpo: {
    id: loanB,
    descricao: `${MARCA} emprestimo para B`,
    conta_credora_id: investimento.id,
    devedor_id: B.id,
    valor: "100.00",
    base: "parcela",
    parcelas: 2,
    primeiro_vencimento: PRIMEIRO_VENCIMENTO,
  },
});
linha(`POST loans (Caso B): ${criadoB.status} ${JSON.stringify(criadoB.corpo)}`);

const antesDeB = await telasDoDevedor(B, DE, ATE);
linha(`ANTES  -- telas de B: ${JSON.stringify(antesDeB)}`);

const canceladoB = await rota(A, `/api/mybank/loans/${loanB}`, {
  metodo: "PATCH",
  corpo: { status: "cancelled" },
});
linha(`PATCH cancelar: ${canceladoB.status} ${JSON.stringify(canceladoB.corpo)}`);

const depoisDeB = await telasDoDevedor(B, DE, ATE);
linha(`DEPOIS -- telas de B: ${JSON.stringify(depoisDeB)}`);

// A RECUSA AO DEVEDOR, medida na mesma divida (antes da limpeza seria inutil:
// ela ja esta cancelada, entao a recusa que sai e a de estado). Em outra divida:
linha("");

// ===========================================================================
// CASO A -- o controle negativo: a parcela PAGA fica paga
// ===========================================================================
linha("=== CASO A: auto-emprestimo de A, com a parcela 1 PAGA ===");

const loanA = uuid();
const criadoA = await rota(A, "/api/mybank/loans", {
  metodo: "POST",
  corpo: {
    id: loanA,
    descricao: `${MARCA} auto-emprestimo`,
    conta_credora_id: investimento.id,
    conta_de_pagamento_id: corrente.id,
    valor: "100.00",
    base: "parcela",
    parcelas: 2,
    primeiro_vencimento: PRIMEIRO_VENCIMENTO,
  },
});
linha(`POST loans (Caso A): ${criadoA.status} ${JSON.stringify(criadoA.corpo)}`);

const parcelasDeA = await tabela(
  A,
  `mybank_installments?select=id,installment_number,status&loan_id=eq.${loanA}&order=installment_number`
);
linha(`parcelas: ${JSON.stringify(parcelasDeA.corpo)}`);

const elos = (parcelasDeA.corpo ?? []).map((p) => `mybank:${p.id}`);
const previsoes = await tabela(
  A,
  `scheduled_transactions?select=id,notes,status,amount&notes=in.(${elos.join(",")})`
);
linha(`previsoes: ${JSON.stringify(previsoes.corpo)}`);

const daParcela1 = (previsoes.corpo ?? []).find(
  (p) => p.notes === `mybank:${parcelasDeA.corpo[0].id}`
);

// A BAIXA DE VERDADE: duas pernas em `financial_transactions`, e a parcela 1
// virando `paid` pelo elo. Sem ela o controle negativo nao tem o que preservar.
// Sem corpo: a rota usa `today()` e, na transferencia, a conta de origem da
// propria previsao. `payment_account_id` e so para a fatura de cartao.
const paga = await rota(A, `/api/scheduled-transactions/${daParcela1.id}/pay`, {
  metodo: "POST",
  corpo: {},
});
linha(`baixa da previsao 1: ${paga.status} ${JSON.stringify(paga.corpo)}`);

const antesDeA = await tabela(
  A,
  `mybank_installments?select=id,installment_number,status,paid_date&loan_id=eq.${loanA}&order=installment_number`
);
linha(`ANTES  -- parcelas: ${JSON.stringify(antesDeA.corpo)}`);

const antesDasPrevisoes = await tabela(
  A,
  `scheduled_transactions?select=id,notes,status&notes=in.(${elos.join(",")})&order=due_date`
);
linha(`ANTES  -- previsoes: ${JSON.stringify(antesDasPrevisoes.corpo)}`);

const agendaAntes = await tabela(
  A,
  `scheduled_transactions?select=id&status=eq.pending`
);
linha(`ANTES  -- agenda pendente de A: ${(agendaAntes.corpo ?? []).length} linhas`);

const canceladoA = await rota(A, `/api/mybank/loans/${loanA}`, {
  metodo: "PATCH",
  corpo: { status: "cancelled" },
});
linha(`PATCH cancelar: ${canceladoA.status} ${JSON.stringify(canceladoA.corpo)}`);

const depoisDeA = await tabela(
  A,
  `mybank_installments?select=id,installment_number,status,paid_date&loan_id=eq.${loanA}&order=installment_number`
);
linha(`DEPOIS -- parcelas: ${JSON.stringify(depoisDeA.corpo)}`);

const depoisDasPrevisoes = await tabela(
  A,
  `scheduled_transactions?select=id,notes,status&notes=in.(${elos.join(",")})&order=due_date`
);
linha(`DEPOIS -- previsoes: ${JSON.stringify(depoisDasPrevisoes.corpo)}`);

// A agenda de A, para provar que o DELETE nao levou o que nao era dele.
const agendaDeA = await tabela(
  A,
  `scheduled_transactions?select=id&status=eq.pending`
);
linha(
  `agenda pendente de A depois do cancelamento: ${
    (agendaDeA.corpo ?? []).length
  } linhas`
);

// A segunda recusa, na divida que JA esta cancelada.
const deNovo = await rota(A, `/api/mybank/loans/${loanA}`, {
  metodo: "PATCH",
  corpo: { status: "cancelled" },
});
linha(`PATCH de novo: ${deNovo.status} ${JSON.stringify(deNovo.corpo)}`);

// E a recusa a quem NAO e o credor, na divida do Caso B (que B enxerga).
const pelaDevedora = await rota(B, `/api/mybank/loans/${loanB}`, {
  metodo: "PATCH",
  corpo: { status: "cancelled" },
});
linha(`PATCH por B (nao e credora): ${pelaDevedora.status} ${JSON.stringify(pelaDevedora.corpo)}`);

// ===========================================================================
// LIMPEZA -- dado meu na conta de teste aparece na tela dele
// ===========================================================================
linha("\n=== limpeza ===");

// O estorno devolve a parcela 1 a `pending` e apaga as duas pernas. E ele que
// faz `mybank_loans_delete` (que recusa emprestimo com parcela paga) aceitar.
const estorno = await rota(A, `/api/scheduled-transactions/${daParcela1.id}/pay`, {
  metodo: "DELETE",
});
linha(`estorno da baixa: ${estorno.status}`);

const sobrando = await tabela(
  A,
  `scheduled_transactions?select=id&notes=in.(${elos.join(",")})`
);
for (const p of sobrando.corpo ?? []) {
  await tabela(A, `scheduled_transactions?id=eq.${p.id}`, { metodo: "DELETE" });
}
linha(`previsoes apagadas: ${(sobrando.corpo ?? []).length}`);

for (const id of [loanA, loanB]) {
  const r = await tabela(A, `mybank_loans?id=eq.${id}`, { metodo: "DELETE" });
  linha(`DELETE emprestimo ${id}: ${r.status} ${JSON.stringify(r.corpo).slice(0, 120)}`);
}

const restou = await tabela(
  A,
  `mybank_loans?select=id,description,status&description=like.${MARCA}*`
);
linha(`sobrou da marca: ${JSON.stringify(restou.corpo)}`);
