#!/usr/bin/env node
// Mutantes da migration 041 (a fatura escolhida no lancamento) -- HMO-281 / HMO-288.
//
// POR QUE ISTO EXISTE
// -------------------
// `041_fatura_escolhida_no_lancamento_test.sql` passa com 27 assercoes verdes.
// Isso, sozinho, nao diz nada: um teste que nunca reprova nao esta medindo o
// que a justificativa dele afirma. Cada mutante abaixo afrouxa UMA decisao da
// 041; o teste tem que ficar vermelho em todos.
//
// OS DOIS QUE VALEM SER LIDOS ANTES DE MEXER NA 041
// --------------------------------------------------
// `sem_coalesce_no_vencimento` e o mutante-assinatura desta migration. Ele deixa
// o COALESCE no `invoice_month` e tira SO o do `invoice_due_date` -- que e
// exatamente o que acontece quando alguem le a issue, encontra "o COALESCE na
// view" e para na primeira ocorrencia. O resultado e silencioso: a compra
// APARECE na fatura escolhida, a tela fica certa, e o "fechar fatura" do 015
// gera a conta a pagar com o vencimento da OUTRA fatura. Se este mutante
// sobreviver, o teste esta medindo meia feature.
//
// `sem_reafirmar_invoker` nao e teorico. Foi MEDIDO que `CREATE OR REPLACE VIEW`
// APAGA as reloptions da view no Postgres 17.11 (ver a 035 e
// database/validation/01_migrations.sql). Sem o
// `ALTER VIEW ... SET (security_invoker = true)` no fim do arquivo, a 041 -- que
// tem toda a cara de aditiva e nao fala de permissao em lugar nenhum -- faz a
// fatura de qualquer usuario ir para qualquer usuario logado, sem erro, so com
// linhas a mais. Quem o mata e a SECAO 5.
//
// UM MUTANTE QUE FOI DELIBERADAMENTE DEIXADO DE FORA
// ---------------------------------------------------
// Tirar o ramo `invoice_month_override IS NULL OR` do CHECK NAO entra na lista,
// e nao e esquecimento: `CHECK (x = date_trunc('month', x)::date)` com `x` nulo
// resulta NULL, e **CHECK que resulta NULL ACEITA a linha**. O mutante e
// semanticamente IDENTICO a versao boa -- ele sobreviveria, e sobreviver estaria
// CERTO. Por o ramo explicito e sobre a forma que se copia depois, nao sobre o
// comportamento de hoje. Mutante sobrevivente que esta certo polui o placar e
// faz o proximo leitor apagar a guarda errada.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria e escrita num arquivo TEMPORARIO; o
// `database/migrations/041_*.sql` nao e tocado em momento nenhum. O jeito usual
// (mutar o arquivo, rodar, restaurar no `finally`) deixa a fonte mutada no disco
// quando o processo morre no meio, e o placar seguinte vira ficcao.
//
// A TRAVA CONTRA O MUTANTE QUE NAO SE APLICA
// -------------------------------------------
// Um `sed` que nao casa sai 0 e o mutante passa por "sobrevivente" -- ou, pior,
// por "morto". Aqui cada mutante e conferido contra a fonte ANTES de rodar
// (`original.includes(m.de)`) e, depois da substituicao, contra ela de novo: se
// o texto mutado for IGUAL ao original, a mutacao nao aconteceu e o resultado
// nao vale. Os dois casos sao erro duro, nao aviso.
//
// COMO RODAR
//   1. Monte o banco-template com a cadeia ATE A 040 (SEM a 041) -- a mesma
//      sequencia de `$PSQL -f` do .github/workflows/db-verify.yml. O template
//      NAO pode conter a 041: ela e `ADD COLUMN IF NOT EXISTS` e
//      `IF NOT EXISTS (pg_constraint)`, entao aplicar um mutante sobre um banco
//      que ja tem a versao boa vira no-op e TODO mutante "sobrevive" por motivo
//      nenhum.
//   2. PG_TEMPLATE=<nome do template> npm run mutantes:fatura-escolhida
//
// O proprio script checa isso: o CONTROLE NEGATIVO roda o teste contra o
// template CRU, sem migration nenhuma, e exige que ele REPROVE. Se o template
// ja tiver a 041, esse controle fica verde-onde-devia-ser-vermelho e o script
// para antes de imprimir placar.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PG = process.env.PG_URL_BASE ?? "postgresql://postgres:postgres@127.0.0.1:5432";
const TEMPLATE = process.env.PG_TEMPLATE ?? "hmo288_base";
const MIGRATION = "database/migrations/041_fatura_escolhida_no_lancamento.sql";
const TESTE = "database/tests/041_fatura_escolhida_no_lancamento_test.sql";

const psql = (db, args) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-q", `${PG}/${db}`, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" },
  });

const original = readFileSync(MIGRATION, "utf8");

// ---------------------------------------------------------------------------
// Os trechos exatos da 041 que os mutantes trocam.
// ---------------------------------------------------------------------------

const ADD_COLUNA = `ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS invoice_month_override date;`;

const ADD_CHECK = `    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_invoice_month_override_dia_1
      CHECK (invoice_month_override IS NULL
             OR invoice_month_override = date_trunc('month', invoice_month_override)::date);`;

const CORPO_CHECK = `      CHECK (invoice_month_override IS NULL
             OR invoice_month_override = date_trunc('month', invoice_month_override)::date);`;

const COALESCE_MES = `    COALESCE(t.invoice_month_override,
             public.card_invoice_month(t.transaction_date, a.closing_day)) AS invoice_month,`;

const COALESCE_VENCIMENTO = `    public.card_invoice_due_date(
      COALESCE(t.invoice_month_override,
               public.card_invoice_month(t.transaction_date, a.closing_day)),
      a.closing_day, a.due_day)                                  AS invoice_due_date,`;

// O `CREATE OR REPLACE VIEW` inteiro, do CREATE ao ponto e virgula final. E o
// que o mutante `view_nao_recriada` tira: a coluna entra e a view fica a da 035.
const VIEW_INTEIRA = original.slice(
  original.indexOf("CREATE OR REPLACE VIEW public.card_invoice_lines AS"),
  original.indexOf("AND t.transaction_type IN ('expense', 'income');") +
    "AND t.transaction_type IN ('expense', 'income');".length,
);

const MUTANTES = [
  {
    nome: "sem_coalesce_no_mes",
    porque:
      "a coluna existe, a pessoa escolhe a fatura, e a view continua decidindo pela data: o campo novo nao faz nada e o usuario nao tem como saber disso",
    de: COALESCE_MES,
    para: "    public.card_invoice_month(t.transaction_date, a.closing_day) AS invoice_month,",
  },
  {
    nome: "sem_coalesce_no_vencimento",
    porque:
      "O DEFEITO SILENCIOSO DO PAR: a compra vai para a fatura escolhida com o vencimento da fatura da DATA. A tela fica certa e o 'fechar fatura' gera a conta a pagar com data de outro mes",
    de: COALESCE_VENCIMENTO,
    para: `    public.card_invoice_due_date(
      public.card_invoice_month(t.transaction_date, a.closing_day),
      a.closing_day, a.due_day)                                  AS invoice_due_date,`,
  },
  {
    nome: "coalesce_invertido_no_mes",
    porque:
      "COALESCE(card_invoice_month(...), override): o primeiro argumento NUNCA e nulo, entao o override nunca e consultado. Compila, parece certo, e e o `sem_coalesce_no_mes` com outra roupa",
    de: COALESCE_MES,
    para: `    COALESCE(public.card_invoice_month(t.transaction_date, a.closing_day),
             t.invoice_month_override) AS invoice_month,`,
  },
  {
    nome: "view_nao_recriada",
    porque:
      "o esquecimento mais provavel desta migration: a coluna entra na tabela e a view fica a da 035. Tudo grava, nada le -- o campo novo vira dado morto",
    de: VIEW_INTEIRA,
    para: "-- (mutado) a view nao foi recriada: a 035 continua valendo",
  },
  {
    nome: "sem_reafirmar_invoker",
    porque:
      "MEDIDO: CREATE OR REPLACE VIEW APAGA as reloptions. Sem reafirmar, card_invoice_lines roda com o privilegio do DONO e a fatura de qualquer usuario vai para qualquer usuario logado -- sem erro, so com linhas a mais",
    de: "ALTER VIEW public.card_invoice_lines SET (security_invoker = true);",
    para: "-- (mutado) sem reafirmar o security_invoker",
  },
  {
    nome: "coluna_com_default",
    porque:
      "ADD COLUMN ... DEFAULT nao e aditivo: ele PREENCHE as linhas que ja existem. Todo o historico de cartao do banco iria para a mesma fatura de uma vez, sem erro nenhum",
    de: ADD_COLUNA,
    para: `ALTER TABLE public.financial_transactions
  ADD COLUMN IF NOT EXISTS invoice_month_override date
  DEFAULT date_trunc('month', CURRENT_DATE)::date;`,
  },
  {
    nome: "check_ausente",
    porque:
      "a coluna entra sem trava: '2026-12-15' vira um invoice_month que nao e mes nenhum, e a tela passa a listar duas faturas de dezembro, cada uma com parte das compras",
    de: ADD_CHECK,
    para: "    PERFORM 1;",
  },
  {
    nome: "check_nao_trava",
    porque:
      "CHECK (true) tem a cara de uma trava e nao trava nada -- o modo de falha mais plausivel de um 'simplifiquei o CHECK'",
    de: CORPO_CHECK,
    para: "      CHECK (true);",
  },
  {
    nome: "check_recusa_tudo",
    porque:
      "CHECK (false) recusa o dia 15, recusa o dia 31 e recusa TODO lancamento do app junto: so morre junto com o controle positivo (o dia 1 e o NULO continuam entrando)",
    de: CORPO_CHECK,
    para: "      CHECK (false);",
  },
  {
    nome: "check_nao_validado",
    porque:
      "NOT VALID deixa as linhas que JA estao na tabela fora da checagem: o CHECK aparece em pg_constraint e parece estar la sem estar",
    de: CORPO_CHECK,
    para: CORPO_CHECK.replace("::date);", "::date) NOT VALID;"),
  },
];

const dir = mkdtempSync(join(tmpdir(), "mutantes-hmo288-"));

/** Roda a suite num banco novo feito do template, com `sql` no lugar da 041. */
function rodar(db, sql) {
  psql("postgres", ["-c", `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`]);
  psql("postgres", ["-c", `CREATE DATABASE ${db} TEMPLATE ${TEMPLATE}`]);
  try {
    if (sql !== null) {
      const arquivo = join(dir, `${db}.sql`);
      writeFileSync(arquivo, sql);
      psql(db, ["-f", arquivo]);
    }
    psql(db, ["-f", TESTE]);
    return { verde: true };
  } catch (e) {
    return {
      verde: false,
      saida: String(e.stderr ?? e.message).trim().split("\n").slice(-2).join(" | "),
    };
  } finally {
    try {
      psql("postgres", ["-c", `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`]);
    } catch {
      /* o banco ja pode ter falhado ao nascer; nao e o que esta sendo medido */
    }
  }
}

let falhou = false;

try {
  // CONTROLE NEGATIVO. Sem a 041, o teste tem de REPROVAR. Ele e o que detecta
  // o erro de montagem que estraga todo o resto: um template que JA tem a 041
  // faz cada mutante virar no-op (`IF NOT EXISTS`) e o placar sai 10/10 sem que
  // nada tenha sido medido.
  const negativo = rodar("hmo288_mut_negativo", null);
  if (negativo.verde) {
    console.error(
      "CONTROLE NEGATIVO FALHOU: o teste da 041 passa num banco SEM a 041 aplicada.",
    );
    console.error(
      `O template '${TEMPLATE}' provavelmente ja contem a 041 (ou o teste nao mede nada). Placar abaixo nao vale.`,
    );
    falhou = true;
  } else {
    console.log("controle negativo: sem a 041 o teste reprova  OK");
  }

  // CONTROLE POSITIVO. Sem ele, um template quebrado faria todo mutante
  // "morrer" e o placar sairia 10/10 sem que o teste tivesse medido nada.
  const positivo = rodar("hmo288_mut_controle", original);
  if (!positivo.verde) {
    console.error(`CONTROLE POSITIVO FALHOU: a 041 intacta nao passa no teste -> ${positivo.saida}`);
    console.error("O template esta errado, ou a migration quebrou. Placar abaixo nao vale.");
    falhou = true;
  } else {
    console.log("controle positivo: a 041 intacta passa no teste  OK\n");
  }

  let mortos = 0;
  for (const m of MUTANTES) {
    // Mutante que nao se aplica e o pior resultado possivel: ele conta como
    // "morreu" sem nunca ter existido. As duas travas, antes e depois.
    if (!original.includes(m.de)) {
      console.error(`NAO APLICOU: ${m.nome} -- o trecho procurado nao esta na 041`);
      falhou = true;
      continue;
    }
    const mutado = original.replace(m.de, m.para);
    if (mutado === original) {
      console.error(`NAO MUTOU: ${m.nome} -- a substituicao nao mudou o arquivo`);
      falhou = true;
      continue;
    }

    const r = rodar(`hmo288_mut_${m.nome}`, mutado);
    if (r.verde) {
      console.error(`SOBREVIVEU: ${m.nome}`);
      console.error(`            ${m.porque}`);
      falhou = true;
    } else {
      mortos++;
      console.log(`morreu:     ${m.nome}`);
    }
  }

  console.log(`\n${mortos}/${MUTANTES.length} mutantes mortos`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exitCode = falhou ? 1 : 0;
