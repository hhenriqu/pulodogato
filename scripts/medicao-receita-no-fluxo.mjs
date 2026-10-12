#!/usr/bin/env node
// =====================================================
// MEDICAO EM PRODUCAO -- a receita prevista no fluxo de caixa (HMO-400)
// =====================================================
//   node scripts/medicao-receita-no-fluxo.mjs
//
// NAO roda em CI e nao e teste: ela fala com PRODUCAO, pela conta de teste, e
// existe para responder uma pergunta que nenhuma suite responde -- "o deploy
// de hoje conta a receita prevista para que lado?".
//
// Foi ela que achou o defeito desta issue. A issue dizia "ao apagar uma
// receita, ela continua aparecendo no fluxo de caixa"; as duas primeiras
// rodadas procuraram a DESCRICAO da sonda nas respostas e nao acharam nada --
// o DELETE funciona nas tres formas de receita (prevista avulsa, de regra fixa
// e realizada). Esta rodada mede NUMERO, e foi assim que apareceu o que estava
// errado no mesmo lugar:
//
//   receita prevista avulsa de R$ 1.000,00, horizonte de 90 dias
//   cash-flow.saldoFinal   -189,98  ->  -1.189,98       (SUBTRAIU)
//   receitas.previsto            0  ->       1000       (a tela de Receitas)
//
// R$ 1.000 de diferenca, e nao R$ 2.000: o valor nao faltava do lado certo,
// estava sendo subtraido do errado -- as duas leituras do mesmo dinheiro
// discordavam no SINAL.
//
// POR QUE A MEDIDA E O DIFF DE TRES MOMENTOS, E NAO UM NUMERO SO
// --------------------------------------------------------------
// base (antes de criar) -> com (depois de criar) -> depois (depois de apagar).
// A conta de teste NAO esta em zero (ela tem sonda de runs antigos: ver
// `conta-de-teste-em-prod`), entao nenhum valor absoluto desta conta prova
// nada. O que prova e a DIFERENCA atribuivel a uma linha, e o `depois` voltando
// ao `base` -- que e a metade da issue que ja funcionava.
//
// Os valores da conta mudam; o CRITERIO nao:
//
//   com.saldoFinal - base.saldoFinal  ==  +valor   (receita entra)
//   depois                            ==  base     (o DELETE desfaz)
//
// CREDENCIAL: a conta de teste de producao, e a senha e dela mesma -- conta
// descartavel num app sem dado real. `NEXT_PUBLIC_SUPABASE_ANON_KEY` sai do
// .env.local do workspace, que NAO esta no git.
// =====================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PROD = "https://pulodogato.hmoraes.com.br";
const ENV = fileURLToPath(new URL("../.env.local", import.meta.url));
const EMAIL = "teste-hmo161-1790379476@hmoraes.com.br";
const SENHA = "PuloGato!1790379476";
const MARCA = `SONDA HMO400 ${process.argv[2] ?? "medicao"}`;
const VALOR_DA_RECEITA = 1000;

function doEnv(chave) {
  const linha = readFileSync(ENV, "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${chave}=`));
  if (!linha) throw new Error(`${chave} ausente em ${ENV}`);
  return linha.slice(chave.length + 1).trim();
}

const SUPABASE_URL = doEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = doEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const REF = new URL(SUPABASE_URL).hostname.split(".")[0];

let COOKIE = "";

async function api(metodo, caminho, corpo) {
  const r = await fetch(`${PROD}${caminho}`, {
    method: metodo,
    headers: { Cookie: COOKIE, ...(corpo ? { "Content-Type": "application/json" } : {}) },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await r.text();
  try {
    return { status: r.status, json: JSON.parse(texto) };
  } catch {
    return { status: r.status, json: { _naoJson: texto.slice(0, 200) } };
  }
}

const hoje = new Date().toISOString().slice(0, 10);
const mes = hoje.slice(0, 7);

/**
 * Os numeros das tres leituras que mostram previsao de receita.
 *
 * `gastoDiario=0` no fluxo de caixa: sem isso o `saldoFinal` carrega 90 dias de
 * gasto variavel por cima, e a diferenca de UMA linha desaparece no meio.
 */
async function numeros() {
  const cf = await api("GET", "/api/cash-flow?dias=90&gastoDiario=0");
  const res = await api(
    "GET",
    `/api/movimentacoes/resumo?tipo=income&de=${mes}-01&ate=${mes}-28`
  );
  const prev = await api("GET", `/api/dashboard/previsao?de=${mes}-01&ate=${mes}-28`);

  return {
    "cash-flow.saldoFinal": cf.json?.cash_flow?.saldoFinal ?? null,
    "cash-flow.totalEntra": cf.json?.cash_flow?.totalEntra ?? null,
    "cash-flow.totalSai": cf.json?.cash_flow?.totalSai ?? null,
    "cash-flow.upcoming.n": (cf.json?.upcoming ?? []).length,
    "receitas.previsto": res.json?.previsto ?? res.json?.resumo?.previsto ?? null,
    // `receita`/`despesa` e nao `entra`/`sai`: a rota devolve o que
    // `somarLinhaNaJanela` monta (lib/realizado-e-previsao.ts), e os dois lados
    // vem POSITIVOS. Ler a chave errada aqui devolveria `null` nos tres
    // momentos -- uma linha que nunca muda e que se le como "esta leitura nao
    // viu a receita" (`sonda-de-horizonte-vence-fora-da-janela-e-mede-zero`).
    "previsao.receita": prev.json?.previsao?.receita ?? null,
    "previsao.despesa": prev.json?.previsao?.despesa ?? null,
  };
}

function imprime(rotulo, antes, agora) {
  console.log(`\n  ${rotulo}`);
  for (const k of Object.keys(antes)) {
    const mudou = JSON.stringify(antes[k]) !== JSON.stringify(agora[k]);
    console.log(
      `    ${mudou ? "*" : " "} ${k.padEnd(22)} ${String(antes[k]).padStart(12)} -> ${String(
        agora[k]
      ).padStart(12)}`
    );
  }
}

async function main() {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: SENHA }),
  });
  const sessao = await r.json();
  if (!sessao.access_token) throw new Error(`login falhou: ${JSON.stringify(sessao)}`);
  COOKIE = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(sessao)).toString(
    "base64"
  )}`;

  const cats = await api("GET", "/api/personal-finance/categories");
  const categoria = (cats.json?.categories ?? cats.json ?? [])[0];
  const contas = await api("GET", "/api/financial-accounts");
  const lista = contas.json?.accounts ?? contas.json ?? [];
  const conta = (Array.isArray(lista) ? lista : []).find(
    (c) => c.account_type !== "credit_card"
  );
  if (!categoria?.id || !conta?.id) {
    throw new Error("fixture da conta de teste incompleta: sem categoria ou sem conta");
  }
  console.log(`login ok  marca="${MARCA}"  conta=${conta.name}`);

  const base = await numeros();

  const criada = await api("POST", "/api/scheduled-transactions", {
    description: `${MARCA} PREVISTA`,
    amount: VALOR_DA_RECEITA,
    category_id: categoria.id,
    account_id: conta.id,
    due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    transaction_type: "income",
  });
  const id = criada.json?.scheduled?.id;
  console.log(`\nPOST receita prevista avulsa -> ${criada.status} id=${id}`);
  if (!id) throw new Error(`nao criou: ${JSON.stringify(criada.json).slice(0, 300)}`);

  const com = await numeros();
  imprime("base -> com a receita", base, com);

  const diferenca = com["cash-flow.saldoFinal"] - base["cash-flow.saldoFinal"];
  const certo = Math.abs(diferenca - VALOR_DA_RECEITA) < 0.01;
  console.log(
    `\n  VEREDITO: saldo projetado ${diferenca > 0 ? "+" : ""}${diferenca.toFixed(2)} ` +
      `para uma receita de ${VALOR_DA_RECEITA.toFixed(2)} -> ${
        certo ? "ENTRA (certo)" : "SAI (o defeito da HMO-400)"
      }`
  );

  const apagada = await api("DELETE", `/api/scheduled-transactions/${id}`, {
    alcance: "apenas_esta",
  });
  console.log(`\nDELETE -> ${apagada.status} ${JSON.stringify(apagada.json).slice(0, 120)}`);

  const depois = await numeros();
  imprime("base -> depois de apagar  (* = NAO voltou: o sintoma da issue)", base, depois);

  const voltou = Object.keys(base).every(
    (k) => JSON.stringify(base[k]) === JSON.stringify(depois[k])
  );
  console.log(
    `\n  VEREDITO: as ${Object.keys(base).length} leituras ${
      voltou ? "VOLTARAM ao estado de base (o DELETE limpa)" : "NAO voltaram"
    }`
  );

  process.exit(certo && voltou ? 0 : 1);
}

main().catch((e) => {
  console.error("MEDICAO FALHOU:", e);
  process.exit(1);
});
