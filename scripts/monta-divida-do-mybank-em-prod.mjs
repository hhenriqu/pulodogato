#!/usr/bin/env node
// =====================================================
// O ESTADO DA PROVA: uma divida de MyBank em janela, em producao (HMO-386)
// =====================================================
//   node scripts/monta-divida-do-mybank-em-prod.mjs
//
// NAO E SUITE e NAO RODA NO CI: ele ESCREVE em producao, pelas duas contas de
// teste (memorias `conta-de-teste-em-prod` e
// `par-de-contas-a-e-b-conectadas-em-prod`).
//
// POR QUE ELE EXISTE
// ------------------
// `scripts/probe-linha-dobrada-do-mybank.mjs` exige, como controle positivo,
// que a conta logada tenha parcela de MyBank DENTRO da janela de
// `/dashboard/bills`. Sem ela a contagem da sonda seria 0 -> 0: verde sem
// medir nada, a familia `sonda-de-horizonte-vence-fora-da-janela-e-mede-zero`.
//
// E esse estado NAO PERSISTE: a HMO-391 cancelou os emprestimos que usou, e em
// 2026-10-11 a agenda da conta devedora voltou a ZERO linha. Toda medicao do
// lado do devedor comeca, portanto, montando a divida.
//
// A CORRENTE (a parte que leva tempo para reconstruir, nao para ler):
//
//   1. login dos DOIS lados -> cookie SSR forjado por conta;
//   2. a conexao A <-> B, refeita se a faxina a apagou (ela foi apagada uma vez);
//   3. a conta de INVESTIMENTO de A -- a trava 1 da 053 exige uma, e as quatro
//      do cadastro padrao nao incluem `investment`;
//   4. `POST /api/mybank/loans` com `primeiro_vencimento` no mes QUE VEM, dia
//      15: dentro da janela de `horizonteAte()`, que e o recorte da tela.
//
// O emprestimo FICA em producao de proposito: a sonda roda duas vezes (ANTES e
// DEPOIS do deploy) e as duas medidas tem de falar da MESMA divida -- um
// emprestimo novo por rodada mudaria «Total a pagar» entre as duas e apagaria o
// controle negativo do dinheiro. Para limpar depois:
// `PATCH /api/mybank/loans/<id>` com `{"status":"cancelled"}` pela conta A.
// =====================================================

import { readFileSync } from "node:fs";

const APP = (process.env.APP_URL || "https://pulodogato.hmoraes.com.br").replace(
  /\/$/,
  ""
);

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
  nome: "A (credora)",
  email: "teste-hmo161-1790379476@hmoraes.com.br",
  senha: "PuloGato!1790379476",
};

const CONTA_B = {
  nome: "B (devedora)",
  email: "teste-hmo374-1791680245339@hmoraes.com.br",
  senha: "PuloGato!1791680245339",
};

const MARCA = process.env.MARCA || "HMO386";

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
  const cookie =
    `sb-${REF}-auth-token=base64-` +
    Buffer.from(JSON.stringify(sessao)).toString("base64");
  return { ...conta, jwt: sessao.access_token, id: sessao.user.id, cookie };
}

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

const uuid = () =>
  "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () =>
    Math.floor(Math.random() * 16).toString(16)
  );

const linha = (...xs) => console.log(...xs);

// ---------------------------------------------------------------------------

const A = await entrar(CONTA_A);
const B = await entrar(CONTA_B);
linha(`A = ${A.id}`);
linha(`B = ${B.id}\n`);

// --- a divida que JA existe: nao criar a segunda ----------------------------
//
// Duas dividas em janela dobrariam «Total a pagar» entre a medicao ANTES e a
// DEPOIS, e o controle negativo do dinheiro (o numero escrito na assercao)
// perderia o sentido.
{
  const jaTem = await rota(B, "/api/mybank/due");
  const parcelas = jaTem.corpo?.parcelas ?? [];
  if (parcelas.length > 0) {
    linha(`B JA DEVE ${parcelas.length} parcela(s) -- nada a criar:`);
    for (const p of parcelas) {
      linha(`  ${p.id}  ${p.descricao}  vence ${p.vencimento}  ${p.valor}  ${p.status}`);
    }
    process.exit(0);
  }
}

// --- a conexao A <-> B ------------------------------------------------------
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
    linha(`conexao: criada (${pedido.status}) e aceita (${aceite.status}) -- ${idDoPedido}`);
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
  if (!investimento) {
    throw new Error(`nao consegui criar a conta credora: ${JSON.stringify(criada.corpo)}`);
  }
  linha(`conta de investimento CRIADA: ${investimento.id}`);
}
linha(`conta credora = ${investimento.name} (${investimento.id})\n`);

// --- o emprestimo -----------------------------------------------------------
//
// Dia 15 do mes QUE VEM: dentro da janela da tela (hoje -> `horizonteAte()`).
// Duas parcelas: a segunda cai fora da janela ou na borda dela, e isso e de
// proposito -- a sonda mede a contagem da parcela EM JANELA, e uma divida com
// uma parcela so nao distinguiria "o bloco saiu" de "o bloco esta vazio".
const hoje = new Date();
const PRIMEIRO_VENCIMENTO = `${hoje.getUTCFullYear()}-${String(
  hoje.getUTCMonth() + 2
).padStart(2, "0")}-15`;

const loan = uuid();
const criado = await rota(A, "/api/mybank/loans", {
  metodo: "POST",
  corpo: {
    id: loan,
    descricao: `${MARCA} divida em janela`,
    conta_credora_id: investimento.id,
    devedor_id: B.id,
    valor: "123.45",
    base: "parcela",
    parcelas: 2,
    primeiro_vencimento: PRIMEIRO_VENCIMENTO,
  },
});
linha(`POST /api/mybank/loans: ${criado.status} ${JSON.stringify(criado.corpo)}`);
if (criado.status >= 300) process.exit(1);

const devidas = await rota(B, "/api/mybank/due");
linha(`\nB agora deve ${(devidas.corpo?.parcelas ?? []).length} parcela(s):`);
for (const p of devidas.corpo?.parcelas ?? []) {
  linha(`  ${p.id}  ${p.descricao}  vence ${p.vencimento}  ${p.valor}  ${p.status}`);
}

const naAgenda = await rota(B, "/api/scheduled-transactions?status=open");
const emJanela = (naAgenda.corpo?.scheduled ?? []).filter(
  (l) => l.parcela_do_mybank === true
);
linha(`\nem janela na agenda de B: ${emJanela.length}`);
for (const l of emJanela) {
  linha(`  ${l.mybank_installment_id}  ${l.description}  ${l.due_date}  ${l.amount}`);
}
linha(`\nemprestimo = ${loan}  (cancelar: PATCH /api/mybank/loans/${loan})`);
