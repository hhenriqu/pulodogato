#!/usr/bin/env node
// =====================================================
// VALIDACAO EM PRODUCAO -- "a receita apagada sai de TODOS os lugares?" (HMO-400)
// =====================================================
//   node scripts/validacao-receita-apagada.mjs
//
// NAO roda em CI e nao e teste: ela fala com PRODUCAO, pela conta de teste.
// A `medicao-receita-no-fluxo.mjs` responde uma pergunta estreita ("o fluxo de
// caixa conta a receita prevista para que lado?") em 3 leituras. Esta responde
// a pergunta que o Helio pediu, que e larga: **apagar uma receita a tira de
// todo lugar do app em que ela aparecia?**
//
// COMO O "TODO LUGAR" FOI ENUMERADO, EM VEZ DE CHUTADO
// ---------------------------------------------------
// Uma receita vive em duas tabelas e so duas: `scheduled_transactions` (a
// previsao, direcao pela view `scheduled_transactions_effective`) e
// `financial_transactions` (o realizado). Entao "todo lugar" = toda rota que
// le uma das duas. A lista abaixo saiu de
//
//   grep -rl "from('scheduled_transactions')"  app/api --include=route.ts
//   grep -rl "from('financial_transactions')"  app/api --include=route.ts
//   + as rotas que leem as VIEWS derivadas (`scheduled_transactions_effective`,
//     `planned_vs_actual`, `budget_consumption`, `card_invoice_lines`)
//
// e nao da memoria. Rotas de escrita, de grupo (exigem outra conta) e de
// cartao (exigem fatura) ficaram de fora e estao nomeadas em FORA_DO_ALCANCE.
//
// POR QUE CADA LEITURA E MEDIDA EM TRES MOMENTOS
// ----------------------------------------------
//   base (antes de criar) -> com (depois de criar) -> depois (depois de apagar)
//
// A conta de teste NAO esta em zero (ela carrega sonda de runs antigos: ver a
// memoria `conta-de-teste-em-prod`), entao valor absoluto nenhum prova nada
// aqui. O que prova e a diferenca atribuivel a UMA linha.
//
// E o `com` nao e enfeite: ele e o CONTROLE POSITIVO de cada leitura.
//
//   base != com   a leitura VE a receita     -> `depois == base` significa algo
//   base == com   a leitura NAO ve a receita -> `depois == base` e VACUO
//
// Sem essa separacao, uma leitura com o parametro errado (janela fora da data,
// nome de campo trocado) devolve o mesmo numero nos tres momentos e se le como
// "a receita saiu daqui" -- quando o que aconteceu e que ela nunca entrou e a
// sonda nao mede nada. Esse e o modo de falha das memorias
// `sonda-de-horizonte-vence-fora-da-janela-e-mede-zero` e
// `sonda-de-fatura-vira-vacua-com-param-errado`, e e por isso que o relatorio
// imprime `vacuo` como terceira categoria em vez de contar como aprovado.
//
// AS QUATRO FORMAS DE APAGAR UMA RECEITA
// --------------------------------------
// A tela oferece quatro caminhos, e os quatro sao exercitados:
//
//   1. prevista avulsa          DELETE /api/scheduled-transactions/{id}
//   2. receita fixa, 1 mes      idem, alcance `apenas_esta`
//   3. receita fixa, a serie    idem, alcance `todas`  + DELETE da regra
//   4. realizada                DELETE /api/personal-finance/transactions/{id}
//
// O caso 2 e o unico em que `depois != base` e o comportamento CERTO: apagar a
// ocorrencia de outubro deixa novembro e dezembro no horizonte de 90 dias do
// fluxo de caixa. Ele esta aqui medido de proposito, porque e a explicacao
// candidata do relato original ("continua aparecendo") e o numero diz de
// quanto e o resto que fica.
//
// CREDENCIAL: a conta de teste de producao, com a senha dela mesma -- conta
// descartavel num app sem dado real. A anon key sai do .env.local do
// workspace, que NAO esta no git.
// =====================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PROD = "https://pulodogato.hmoraes.com.br";
const ENV = fileURLToPath(new URL("../.env.local", import.meta.url));
const EMAIL = "teste-hmo161-1790379476@hmoraes.com.br";
const SENHA = "PuloGato!1790379476";
const SELO = `SONDA HMO400V ${Date.now()}`;
const VALOR = 1234.56;

// As rotas que leem uma das duas tabelas e NAO entram nesta validacao, com o
// motivo. Lista explicita para que "todo lugar" seja uma afirmacao conferivel
// em vez de uma impressao -- a memoria `fiz-tudo-costuma-ser-parcial`.
const FORA_DO_ALCANCE = [
  "expense-groups/* -- exigem a 2a conta do par e um grupo; receita de grupo e outra feature",
  "card-invoices*, mybank/* -- exigem fatura de cartao / emprestimo, nao receita",
  "payroll/[id], statements/* -- receita de folha e de extrato importado, formas que a tela de Receitas nao cria",
  "financial-installments -- parcelamento e despesa (a rota de criacao recusa income)",
  "budgets -- orcamento e de DESPESA (budget_consumption nao tem lado de receita)",
];

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
const mes = hoje.slice(0, 7);
const daquiA = (dias) =>
  new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

/**
 * TODAS as leituras do app que podem mostrar uma receita, medidas de uma vez.
 *
 * `id` e `selo` sao o que foi criado na rodada: as leituras de LISTA sao
 * medidas por PRESENCA do id, nao por numero -- "a linha esta na lista?" e o
 * que a issue reclama, e um total pode coincidir por acaso enquanto a linha
 * continua ali (a memoria `duas-metades-certas-dobram-a-linha-sem-total-para-discordar`).
 *
 * `gastoDiario=0` no fluxo de caixa: sem isso o `saldoFinal` carrega 90 dias de
 * gasto variavel estimado por cima, e a diferenca de UMA linha se perde no meio.
 */
async function lugares({ id, selo } = {}) {
  const [cf, proj, sts, stsResumo, previsao, resIn, relCf, relPvA, relCat, pfTx, nw, contas, relExp, pfExp] =
    await Promise.all([
      api("GET", "/api/cash-flow?dias=90&gastoDiario=0"),
      api("GET", `/api/projection?through=${daquiA(90)}`),
      api("GET", "/api/scheduled-transactions?months=3"),
      api("GET", "/api/scheduled-transactions/summary?months=3"),
      api("GET", `/api/dashboard/previsao?de=${mes}-01&ate=${mes}-31`),
      api("GET", `/api/movimentacoes/resumo?tipo=income&de=${mes}-01&ate=${mes}-31`),
      api("GET", "/api/reports/cash-flow?months=3"),
      api("GET", "/api/reports/planned-vs-actual?months=3"),
      api("GET", "/api/reports/categories?months=3"),
      api("GET", "/api/personal-finance/transactions?limit=300"),
      api("GET", "/api/net-worth?months=3"),
      api("GET", "/api/financial-accounts"),
      api("GET", "/api/reports/export?months=3"),
      api("GET", "/api/personal-finance/transactions/export"),
    ]);

  const safe = await api("GET", "/api/safe-to-spend");

  const naLista = (arr, chave = "id") =>
    (arr ?? []).some((x) => x?.[chave] === id) ? "PRESENTE" : "ausente";
  const noTexto = (t) => (selo && (t ?? "").includes(selo) ? "PRESENTE" : "ausente");
  const soma = (arr, campo) =>
    Number(((arr ?? []).reduce((a, x) => a + Number(x?.[campo] ?? 0), 0)).toFixed(2));

  return {
    // ---- a previsao (scheduled_transactions / _effective) ----
    "Fluxo de Caixa · saldo projetado": cf.json?.cash_flow?.saldoFinal ?? null,
    "Fluxo de Caixa · total que entra": cf.json?.cash_flow?.totalEntra ?? null,
    "Fluxo de Caixa · total que sai": cf.json?.cash_flow?.totalSai ?? null,
    "Fluxo de Caixa · proximas (linha)": naLista(cf.json?.upcoming),
    "Projecao · saldo projetado": proj.json?.projected_total ?? null,
    "Projecao · entra na agenda": proj.json?.scheduled_in ?? null,
    "Quanto posso gastar · receitas previstas": safe.json?.safe_to_spend?.receitasPrevistas ?? null,
    "Quanto posso gastar · livre": safe.json?.safe_to_spend?.livre ?? null,
    "Receitas (agenda) · linha na lista": naLista(sts.json?.scheduled),
    "Receitas (agenda) · n de linhas": (sts.json?.scheduled ?? []).length,
    "Receitas (resumo) · receita prevista": soma(stsResumo.json?.summary, "total_pending_income"),
    "Receitas (resumo) · receita esperada": soma(stsResumo.json?.summary, "expected_income"),
    "Painel · previsao de receita": previsao.json?.previsao?.receita ?? null,
    "Movimentacoes · previsto": resIn.json?.resumo?.previsto ?? null,
    "Movimentacoes · realizado": resIn.json?.resumo?.realizado ?? null,
    "Movimentacoes · linha na lista": naLista(resIn.json?.linhas),
    "Relatorio previsto x realizado · previsto": soma(relPvA.json?.months, "planned_income"),
    "Relatorio previsto x realizado · realizado": soma(relPvA.json?.months, "actual_income"),

    // ---- o realizado (financial_transactions) ----
    "Lancamentos · linha na lista": naLista(pfTx.json?.transactions),
    "Relatorio fluxo de caixa · entradas": relCf.json?.summary?.total_income ?? null,
    "Relatorio por categoria · receita": soma(relCat.json?.categories, "income"),
    "Patrimonio · total de ativos": nw.json?.summary?.total_assets ?? null,
    "Contas · saldo somado": soma(contas.json?.accounts, "current_balance"),
    "CSV de lancamentos · o selo": noTexto(pfExp.texto),
    "CSV de relatorio · entradas": (relExp.texto ?? "")
      .split("\n")
      .slice(1)
      .reduce((a, l) => a + Number((l.split(";")[2] ?? "0").replace(/\./g, "").replace(",", ".") || 0), 0)
      .toFixed(2),
  };
}

const RESET = "\x1b[0m";
const cor = (c, s) => `\x1b[${c}m${s}${RESET}`;

/**
 * O relatorio de UMA rodada. Classifica cada lugar pelo par (viu?, limpou?) --
 * e e aqui que `vacuo` deixa de ser confundido com aprovado.
 */
function relatorio(titulo, base, com, depois, { esperaResto = false } = {}) {
  console.log(`\n${"=".repeat(96)}\n${titulo}\n${"=".repeat(96)}`);
  console.log(
    `  ${"lugar".padEnd(44)} ${"base".padStart(13)} ${"com".padStart(13)} ${"depois".padStart(13)}  veredito`
  );

  const contagem = { limpou: 0, sujo: 0, vacuo: 0 };
  const sujos = [];

  for (const k of Object.keys(base)) {
    const b = JSON.stringify(base[k]);
    const c = JSON.stringify(com[k]);
    const d = JSON.stringify(depois[k]);
    const viu = b !== c;
    const voltou = b === d;

    let veredito;
    if (!viu) {
      veredito = cor("90", "vacuo (nao ve esta forma)");
      contagem.vacuo++;
    } else if (voltou) {
      veredito = cor("32", "LIMPOU");
      contagem.limpou++;
    } else {
      veredito = cor("31", "NAO LIMPOU");
      contagem.sujo++;
      sujos.push(k);
    }

    console.log(
      `  ${k.padEnd(44)} ${String(base[k]).padStart(13)} ${String(com[k]).padStart(13)} ${String(
        depois[k]
      ).padStart(13)}  ${veredito}`
    );
  }

  console.log(
    `\n  ${contagem.limpou} lugares viram a receita e LIMPARAM | ${contagem.sujo} NAO limparam | ${contagem.vacuo} nao veem esta forma`
  );
  if (contagem.sujo && !esperaResto) {
    console.log(cor("31", `  NAO LIMPARAM: ${sujos.join(" / ")}`));
  }
  if (esperaResto) {
    console.log(
      cor("33", "  (nesta rodada sobrar e o CERTO: a serie continua nos meses seguintes)")
    );
  }
  return contagem;
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

  const commit = await (await fetch(`${PROD}/sw.js?cb=${SELO}`, {
    headers: { "Cache-Control": "no-cache" },
  }).then((x) => x.text()));
  const sha = (commit.match(/[0-9a-f]{40}/) ?? ["?"])[0];

  console.log(`login ok  selo="${SELO}"  conta="${conta.name}"  valor=${VALOR}`);
  console.log(`producao esta no commit ${sha}`);
  console.log(`\nfora do alcance desta validacao:`);
  for (const f of FORA_DO_ALCANCE) console.log(`  - ${f}`);

  const placar = [];

  // =============== 1. receita PREVISTA AVULSA ===============
  {
    const base = await lugares({});
    const criada = await api("POST", "/api/scheduled-transactions", {
      description: `${SELO} avulsa`,
      amount: VALOR,
      category_id: categoria.id,
      account_id: conta.id,
      due_date: daquiA(7),
      transaction_type: "income",
    });
    const id = criada.json?.scheduled?.id;
    if (!id) throw new Error(`nao criou a avulsa: ${criada.status} ${criada.texto.slice(0, 200)}`);

    const com = await lugares({ id, selo: SELO });
    const apagada = await api("DELETE", `/api/scheduled-transactions/${id}`, {
      alcance: "apenas_esta",
    });
    const depois = await lugares({ id, selo: SELO });

    const direto = await api("GET", `/api/scheduled-transactions?months=3`);
    const aindaLa = (direto.json?.scheduled ?? []).some((x) => x.id === id);

    placar.push([
      "1. prevista avulsa",
      relatorio(
        `RODADA 1 -- receita PREVISTA AVULSA (a digitada em «Nova receita»)\n` +
          `  POST /api/scheduled-transactions -> ${criada.status} id=${id}\n` +
          `  DELETE /api/scheduled-transactions/${id} {alcance:"apenas_esta"} -> ${apagada.status}\n` +
          `  a linha ainda aparece na agenda depois do DELETE? ${aindaLa ? "SIM" : "nao"}`,
        base,
        com,
        depois
      ),
    ]);
  }

  // =============== 2. e 3. receita FIXA ===============
  {
    const base = await lugares({});
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

    // A agenda se materializa na LEITURA: sem este GET as ocorrencias da regra
    // nao existem ainda como linha (`generated` conta quantas nasceram).
    const materializa = await api("GET", "/api/scheduled-transactions?months=3");
    const ocorrencias = (materializa.json?.scheduled ?? []).filter(
      (x) => x.recurring_rule_id === idRegra
    );
    const umaDelas = ocorrencias[0];

    const com = await lugares({ id: umaDelas?.id, selo: SELO });

    // ---- 2. apagar SO a ocorrencia deste mes ----
    const umMes = await api("DELETE", `/api/scheduled-transactions/${umaDelas.id}`, {
      alcance: "apenas_esta",
    });
    const aposUma = await lugares({ id: umaDelas?.id, selo: SELO });

    placar.push([
      "2. fixa, so a ocorrencia do mes",
      relatorio(
        `RODADA 2 -- receita FIXA, apagando SO A OCORRENCIA DESTE MES\n` +
          `  POST /api/recurring-rules -> ${regra.status} regra=${idRegra}\n` +
          `  a regra materializou ${ocorrencias.length} ocorrencias (generated=${materializa.json?.generated})\n` +
          `  DELETE da ocorrencia ${umaDelas.id} {alcance:"apenas_esta"} -> ${umMes.status}\n` +
          `  ATENCAO: sobrar aqui e o comportamento CERTO -- as outras ${Math.max(
            ocorrencias.length - 1,
            0
          )} ocorrencias continuam no horizonte`,
        base,
        com,
        aposUma,
        { esperaResto: true }
      ),
    ]);

    // ---- 3. apagar a SERIE INTEIRA ----
    const restantes = (
      (await api("GET", "/api/scheduled-transactions?months=3")).json?.scheduled ?? []
    ).filter((x) => x.recurring_rule_id === idRegra);
    let serie = { status: "n/a" };
    if (restantes[0]) {
      serie = await api("DELETE", `/api/scheduled-transactions/${restantes[0].id}`, {
        alcance: "todas",
      });
    }
    const regraApagada = await api("DELETE", `/api/recurring-rules/${idRegra}?purge=true`);
    const depois = await lugares({ id: umaDelas?.id, selo: SELO });

    const sobrou = (
      (await api("GET", "/api/scheduled-transactions?months=3")).json?.scheduled ?? []
    ).filter((x) => x.recurring_rule_id === idRegra);

    placar.push([
      "3. fixa, a serie inteira",
      relatorio(
        `RODADA 3 -- receita FIXA, apagando a SERIE INTEIRA\n` +
          `  DELETE de ocorrencia {alcance:"todas"} -> ${serie.status}\n` +
          `  DELETE /api/recurring-rules/${idRegra}?purge=true -> ${regraApagada.status}\n` +
          `  sobraram ${sobrou.length} ocorrencias desta regra na agenda`,
        base,
        com,
        depois
      ),
    ]);
  }

  // =============== 4. receita REALIZADA ===============
  {
    const base = await lugares({});
    const criada = await api("POST", "/api/personal-finance/transactions", {
      description: `${SELO} realizada`,
      amount: VALOR,
      category_id: categoria.id,
      account_id: conta.id,
      transaction_date: hoje,
      transaction_type: "income",
    });
    const id = criada.json?.transaction?.id ?? criada.json?.id;
    if (!id) throw new Error(`nao criou a realizada: ${criada.status} ${criada.texto.slice(0, 300)}`);

    const com = await lugares({ id, selo: SELO });
    const apagada = await api("DELETE", `/api/personal-finance/transactions/${id}`);
    const depois = await lugares({ id, selo: SELO });

    const direto = await api("GET", "/api/personal-finance/transactions?limit=300");
    const aindaLa = (direto.json?.transactions ?? []).some((x) => x.id === id);

    placar.push([
      "4. realizada",
      relatorio(
        `RODADA 4 -- receita REALIZADA (dinheiro que entrou)\n` +
          `  POST /api/personal-finance/transactions -> ${criada.status} id=${id}\n` +
          `  DELETE /api/personal-finance/transactions/${id} -> ${apagada.status}\n` +
          `  a linha ainda aparece nos lancamentos depois do DELETE? ${aindaLa ? "SIM" : "nao"}`,
        base,
        com,
        depois
      ),
    ]);
  }

  // =============== o placar ===============
  console.log(`\n${"=".repeat(96)}\nPLACAR\n${"=".repeat(96)}`);
  let defeitos = 0;
  for (const [nome, c] of placar) {
    const esperado = nome.startsWith("2.");
    if (!esperado) defeitos += c.sujo;
    console.log(
      `  ${nome.padEnd(34)} viram e limparam: ${String(c.limpou).padStart(2)} | nao limparam: ${String(
        c.sujo
      ).padStart(2)}${esperado ? "  (sobrar e o certo)" : ""} | vacuo: ${String(c.vacuo).padStart(2)}`
    );
  }
  console.log(
    `\n  VEREDITO: ${
      defeitos === 0
        ? cor("32", "apagar uma receita a tira de TODOS os lugares que a mostravam")
        : cor("31", `${defeitos} lugares continuam mostrando a receita apagada`)
    }`
  );
  process.exit(defeitos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("VALIDACAO FALHOU:", e);
  process.exit(1);
});
