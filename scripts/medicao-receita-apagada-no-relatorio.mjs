#!/usr/bin/env node
// =====================================================
// MEDICAO EM PRODUCAO -- a ocorrencia apagada no Previsto x Realizado (HMO-400)
// =====================================================
//   node scripts/medicao-receita-apagada-no-relatorio.mjs
//
// NAO roda em CI e nao e teste: fala com PRODUCAO pela conta de teste.
//
// A `validacao-receita-apagada.mjs` mede os 25 lugares de uma vez e achou UM
// que nao limpa. Esta isola esse lugar, porque na validacao larga ele estava
// CONFUNDIDO: lá a soma e de 3 meses, e apagar a ocorrencia de outubro deixa
// novembro e dezembro de pe -- o total nao voltar ao base e esperado, e o
// defeito se esconde exatamente atras do comportamento certo.
//
// A ISOLACAO: medir o MES, nao a soma
// -----------------------------------
// Uma receita fixa nasce com uma ocorrencia por mes. Apagando so a de outubro,
// o `planned_income` DE OUTUBRO tem de voltar ao valor de base. Novembro e
// dezembro continuam -- e esses nao sao medidos aqui.
//
// O CONTROLE NEGATIVO: a avulsa no mesmo mes
// ------------------------------------------
// A mesma medida e feita com uma receita PREVISTA AVULSA. As duas aparecem no
// relatorio do mesmo jeito; as duas sao apagadas pela mesma rota. A diferenca
// e so o que o DELETE faz por tras:
//
//   avulsa   -> a linha e APAGADA        (DELETE de verdade)
//   fixa     -> a linha fica `skipped`   (para nao ressuscitar na agenda)
//
// Se as duas falhassem, o defeito seria da janela ou do parametro da sonda. Se
// nenhuma falhasse, nao haveria defeito. A avulsa limpando e a fixa nao e o que
// aponta para `status` como a causa -- e nao para a minha leitura.
//
// A CAUSA, no SQL (conferida no arquivo e medida na resposta)
// ----------------------------------------------------------
// `planned_vs_actual` (008 secao 7, redefinida igual na 022) soma o previsto com
//
//   AND s.status <> 'cancelled'
//
// `skipped` nao esta excluido. Todas as OUTRAS leituras do previsto filtram
// `status = 'pending'`, que exclui `skipped` de graca -- e e por isso que o
// Fluxo de Caixa, a agenda e o resumo limpam e so o relatorio nao.
// =====================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PROD = "https://pulodogato.hmoraes.com.br";
const ENV = fileURLToPath(new URL("../.env.local", import.meta.url));
const EMAIL = "teste-hmo161-1790379476@hmoraes.com.br";
const SENHA = "PuloGato!1790379476";
const SELO = `SONDA HMO400R ${Date.now()}`;
const VALOR = 777.77;

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
    headers: {
      Cookie: COOKIE,
      ...(corpo ? { "Content-Type": "application/json" } : {}),
    },
    ...(corpo ? { body: JSON.stringify(corpo) } : {}),
  });
  const texto = await r.text();
  try {
    return { status: r.status, json: JSON.parse(texto), texto };
  } catch {
    return { status: r.status, json: null, texto };
  }
}

const hoje = new Date().toISOString().slice(0, 10);
const mesAtual = `${hoje.slice(0, 7)}-01`;

/** O `planned_income` DO MES ATUAL, mais as duas leituras que servem de contraste. */
async function doMes() {
  const [rel, cf, resumo] = await Promise.all([
    api("GET", "/api/reports/planned-vs-actual?months=3"),
    api("GET", "/api/cash-flow?dias=90&gastoDiario=0"),
    api("GET", "/api/scheduled-transactions/summary?months=3"),
  ]);
  const linha = (rel.json?.months ?? []).find((m) => String(m.month).slice(0, 10) === mesAtual);
  const lResumo = (resumo.json?.summary ?? []).find(
    (m) => String(m.month).slice(0, 10) === mesAtual
  );
  return {
    "Previsto x Realizado · previsto do mes": Number(linha?.planned_income ?? 0),
    "Resumo da agenda · receita prevista do mes": Number(lResumo?.total_pending_income ?? 0),
    // 90 DIAS, NAO O MES: esta linha e so contraste, e no caso da fixa ela
    // SOBRA de proposito -- as ocorrencias de novembro e dezembro estao dentro
    // do horizonte dela e continuam existindo. Ler "NAO LIMPOU" aqui como
    // defeito seria o erro que esta medicao existe para evitar; o veredito no
    // fim olha so a linha do MES, que e a unica comparavel.
    "Fluxo de Caixa · entra em 90d (sobra e o certo)": cf.json?.cash_flow?.totalEntra ?? null,
  };
}

const cor = (c, s) => `\x1b[${c}m${s}\x1b[0m`;

function tabela(titulo, base, com, depois) {
  console.log(`\n${"-".repeat(92)}\n${titulo}\n${"-".repeat(92)}`);
  const resultado = {};
  for (const k of Object.keys(base)) {
    const viu = base[k] !== com[k];
    const voltou = base[k] === depois[k];
    const v = !viu
      ? cor("90", "vacuo (nao viu a receita)")
      : voltou
        ? cor("32", "LIMPOU")
        : cor("31", "NAO LIMPOU -- continua contando a receita apagada");
    resultado[k] = !viu ? "vacuo" : voltou ? "limpou" : "sujo";
    console.log(
      `  ${k.padEnd(46)} ${String(base[k]).padStart(10)} ${String(com[k]).padStart(10)} ${String(
        depois[k]
      ).padStart(10)}  ${v}`
    );
  }
  return resultado;
}

async function main() {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: SENHA }),
  });
  const sessao = await r.json();
  if (!sessao.access_token) throw new Error(`login falhou: ${JSON.stringify(sessao)}`);
  COOKIE = `sb-${REF}-auth-token=base64-${Buffer.from(JSON.stringify(sessao)).toString("base64")}`;

  const cats = await api("GET", "/api/personal-finance/categories");
  const categoria = (cats.json?.categories ?? cats.json ?? [])[0];
  const contas = await api("GET", "/api/financial-accounts");
  const conta = (contas.json?.accounts ?? []).find((c) => c.account_type !== "credit_card");
  if (!categoria?.id || !conta?.id) throw new Error("fixture da conta de teste incompleta");

  console.log(`login ok  selo="${SELO}"  mes medido=${mesAtual}  valor=${VALOR}`);
  console.log(
    `\n  ${"".padEnd(46)} ${"base".padStart(10)} ${"com".padStart(10)} ${"depois".padStart(10)}`
  );

  // ---------- CONTROLE NEGATIVO: a receita PREVISTA AVULSA ----------
  const baseA = await doMes();
  const avulsa = await api("POST", "/api/scheduled-transactions", {
    description: `${SELO} avulsa`,
    amount: VALOR,
    category_id: categoria.id,
    account_id: conta.id,
    due_date: hoje,
    transaction_type: "income",
  });
  const idA = avulsa.json?.scheduled?.id;
  if (!idA) throw new Error(`nao criou a avulsa: ${avulsa.status} ${avulsa.texto.slice(0, 200)}`);
  const comA = await doMes();
  const delA = await api("DELETE", `/api/scheduled-transactions/${idA}`, {
    alcance: "apenas_esta",
  });
  const depoisA = await doMes();

  const resA = tabela(
    `CONTROLE NEGATIVO -- receita PREVISTA AVULSA, vencendo HOJE (${hoje})\n` +
      `  a linha e APAGADA de verdade pelo DELETE -> ${delA.status}`,
    baseA,
    comA,
    depoisA
  );

  // ---------- O CASO: a OCORRENCIA de uma receita FIXA ----------
  const baseF = await doMes();
  const regra = await api("POST", "/api/recurring-rules", {
    description: `${SELO} fixa`,
    amount: VALOR,
    category_id: categoria.id,
    account_id: conta.id,
    transaction_type: "income",
    frequency: "monthly",
    due_day: Number(hoje.slice(8, 10)),
    start_date: hoje,
  });
  const idRegra = regra.json?.rule?.id ?? regra.json?.id;
  if (!idRegra) throw new Error(`nao criou a regra: ${regra.status} ${regra.texto.slice(0, 300)}`);

  const agenda = await api("GET", "/api/scheduled-transactions?months=3");
  const desteMes = (agenda.json?.scheduled ?? []).filter(
    (x) => x.recurring_rule_id === idRegra && String(x.due_date).slice(0, 7) === hoje.slice(0, 7)
  );
  if (!desteMes[0]) throw new Error("a regra nao materializou ocorrencia neste mes");

  const comF = await doMes();
  const delF = await api("DELETE", `/api/scheduled-transactions/${desteMes[0].id}`, {
    alcance: "apenas_esta",
  });
  const depoisF = await doMes();

  // O status de verdade da linha apagada, lido do banco pela rota de detalhe --
  // e isto que separa "foi apagada" de "ficou skipped".
  const detalhe = await api("GET", `/api/scheduled-transactions/${desteMes[0].id}`);
  const statusDepois =
    detalhe.json?.scheduled?.status ?? detalhe.json?.status ?? `(rota devolveu ${detalhe.status})`;

  const resF = tabela(
    `O CASO -- OCORRENCIA de receita FIXA deste mes\n` +
      `  regra=${idRegra}  ocorrencia=${desteMes[0].id}\n` +
      `  DELETE {alcance:"apenas_esta"} -> ${delF.status}\n` +
      `  status da linha DEPOIS do DELETE: ${statusDepois}`,
    baseF,
    comF,
    depoisF
  );

  // faxina: a regra e todas as ocorrencias dela
  const restantes = (
    (await api("GET", "/api/scheduled-transactions?months=3")).json?.scheduled ?? []
  ).filter((x) => x.recurring_rule_id === idRegra);
  if (restantes[0]) {
    await api("DELETE", `/api/scheduled-transactions/${restantes[0].id}`, { alcance: "todas" });
  }
  const limpeza = await api("DELETE", `/api/recurring-rules/${idRegra}?purge=true`);
  console.log(`\nfaxina: regra apagada -> ${limpeza.status}`);

  // ---------- o veredito ----------
  const CHAVE = "Previsto x Realizado · previsto do mes";
  const avulsaLimpa = resA[CHAVE] === "limpou";
  const fixaSuja = resF[CHAVE] === "sujo";

  console.log(`\n${"=".repeat(92)}\nVEREDITO\n${"=".repeat(92)}`);
  console.log(`  avulsa apagada  -> o relatorio ${avulsaLimpa ? "LIMPA" : resA[CHAVE]}`);
  console.log(`  ocorrencia fixa -> o relatorio ${fixaSuja ? "NAO LIMPA" : resF[CHAVE]}`);

  if (avulsaLimpa && fixaSuja) {
    console.log(
      cor(
        "31",
        `\n  DEFEITO CONFIRMADO E ISOLADO: o Previsto x Realizado conta a ocorrencia\n` +
          `  \`skipped\` como receita prevista. A avulsa (linha apagada de verdade) limpa no\n` +
          `  mesmo mes e pela mesma rota -- entao nao e janela nem parametro da sonda.\n` +
          `  Causa: planned_vs_actual filtra \`status <> 'cancelled'\` e deixa \`skipped\` passar.`
      )
    );
    process.exit(1);
  }
  if (!avulsaLimpa) {
    console.log(
      cor("33", "\n  INCONCLUSIVO: o controle negativo nao limpou -- a sonda esta medindo errado")
    );
    process.exit(2);
  }
  console.log(cor("32", "\n  as duas formas limpam o relatorio -- o defeito nao se reproduz"));
  process.exit(0);
}

main().catch((e) => {
  console.error("MEDICAO FALHOU:", e);
  process.exit(1);
});
