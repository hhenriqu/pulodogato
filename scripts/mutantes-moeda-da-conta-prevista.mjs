#!/usr/bin/env node
// Mutantes da migration 034 (a conta prevista e em real) -- HMO-184.
//
// POR QUE ISTO EXISTE
// -------------------
// `hmo184_moeda_da_conta_prevista_test.sql` passa com 12 assercoes verdes.
// Isso, sozinho, nao diz nada: um teste que nunca reprova nao esta medindo o
// que a justificativa dele afirma. Cada mutante abaixo afrouxa UMA decisao da
// 034; o teste tem que ficar vermelho em todos.
//
// OS DOIS QUE IMPORTAM, E POR QUE ELES SAO UM PAR
// -----------------------------------------------
// `sem_trava` e `trava_larga_demais` sao os extremos opostos da mesma linha, e
// um teste so pega os dois se tiver assercao de recusa E assercao de aceitacao.
// Era facil escrever este teste so com "USD e recusado" -- e `trava_larga_demais`
// (`CHECK (false)`, que recusa ate BRL e portanto quebra a criacao de QUALQUER
// conta prevista no app) passaria por morto. Ver
// mutante-da-trava-larga-demais.
//
// `catalogo_no_lugar_da_trava` e o terceiro que vale ler: ele e INDISTINGUIVEL
// hoje -- a 034 vira no-op e o comportamento de gravacao fica identico --, e so
// cobra o preco no dia em que alguem destrancar. Quem o mata e a assercao de
// que o catalogo da 022 continua embaixo da trava, que existe exatamente para
// isso.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria e escrita num arquivo TEMPORARIO; o
// `database/migrations/034_*.sql` nao e tocado em momento nenhum. E de
// proposito: o jeito usual (mutar o arquivo, rodar, restaurar no `finally`)
// deixa a fonte mutada no disco quando o processo morre no meio, e o placar
// seguinte vira ficcao.
//
// COMO RODAR
//   1. Monte o banco-template com a cadeia ATE A 033 (sem a 034) -- a mesma
//      sequencia de `$PSQL -f` do .github/workflows/db-verify.yml:
//        createdb hmo184_base && ...aplique a sequencia...
//   2. npm run mutantes:moeda-da-conta-prevista
//
// O template NAO pode conter a 034: ela e `IF NOT EXISTS`, entao aplicar um
// mutante sobre um banco que ja tem a versao boa vira no-op e TODO mutante
// "sobrevive" por motivo nenhum.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PG = process.env.PG_URL_BASE ?? "postgresql://postgres:postgres@127.0.0.1:5432";
const TEMPLATE = process.env.PG_TEMPLATE ?? "hmo184_base";
const MIGRATION = "database/migrations/034_moeda_da_conta_prevista.sql";
const TESTE = "database/tests/hmo184_moeda_da_conta_prevista_test.sql";

const psql = (db, args) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-q", `${PG}/${db}`, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" },
  });

const original = readFileSync(MIGRATION, "utf8");

const TRAVA = `    ALTER TABLE public.scheduled_transactions
      ADD CONSTRAINT scheduled_transactions_currency_brl
      CHECK (currency = 'BRL');`;

const MUTANTES = [
  {
    nome: "sem_trava",
    porque:
      "a 034 vira so o comentario: nada impede uma rota nova de gravar USD, e todo somador de conta prevista volta a somar dolar com real",
    de: TRAVA,
    para: "    PERFORM 1;",
  },
  {
    nome: "trava_larga_demais",
    porque:
      "CHECK (false) recusa USD -- e recusa BRL junto: o app para de conseguir criar conta prevista nenhuma",
    de: "      CHECK (currency = 'BRL');",
    para: "      CHECK (false);",
  },
  {
    nome: "trava_nao_trava",
    porque:
      "CHECK (true) tem a cara de uma trava e nao trava nada -- o modo de falha mais plausivel de um 'simplifiquei o CHECK'",
    de: "      CHECK (currency = 'BRL');",
    para: "      CHECK (true);",
  },
  {
    nome: "catalogo_no_lugar_da_trava",
    porque:
      "a trava vira uma copia do catalogo da 022: hoje e INDISTINGUIVEL na gravacao, e so quebra no dia em que alguem destrancar e sobrar validacao nenhuma",
    de: "      CHECK (currency = 'BRL');",
    para:
      "      CHECK (currency IN ('BRL','USD','EUR','GBP','CHF','CAD','AUD','ARS','CLP','UYU','PYG','JPY','CNY'));",
  },
  {
    nome: "tabela_errada",
    porque:
      "o cadeado cai em financial_transactions: a conta prevista segue solta e a multimoeda que a 026 entregou morre junto",
    de: TRAVA,
    para: `    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT scheduled_transactions_currency_brl
      CHECK (currency = 'BRL');`,
  },
  {
    nome: "trava_so_no_insert",
    porque:
      "um trigger de INSERT no lugar do CHECK deixa o UPDATE passar -- e e por UPDATE que um PATCH novo gravaria a moeda",
    de: TRAVA,
    para: `    CREATE OR REPLACE FUNCTION public.hmo184_mut_so_insert()
    RETURNS TRIGGER LANGUAGE plpgsql AS $f$
    BEGIN
      IF NEW.currency <> 'BRL' THEN
        RAISE EXCEPTION 'moeda invalida' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END $f$;
    DROP TRIGGER IF EXISTS hmo184_mut_so_insert ON public.scheduled_transactions;
    CREATE TRIGGER hmo184_mut_so_insert
      BEFORE INSERT ON public.scheduled_transactions
      FOR EACH ROW EXECUTE FUNCTION public.hmo184_mut_so_insert();`,
  },
];

const dir = mkdtempSync(join(tmpdir(), "mutantes-hmo184-"));

/** Roda a suite num banco novo feito do template, com `sql` no lugar da 034. */
function rodar(db, sql) {
  const arquivo = join(dir, `${db}.sql`);
  writeFileSync(arquivo, sql);
  psql("postgres", ["-c", `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`]);
  psql("postgres", ["-c", `CREATE DATABASE ${db} TEMPLATE ${TEMPLATE}`]);
  try {
    psql(db, ["-f", arquivo]);
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
  // CONTROLE POSITIVO. Sem ele, um template quebrado faria todo mutante
  // "morrer" e o placar sairia 6/6 sem que o teste tivesse medido nada.
  const controle = rodar("hmo184_mut_controle", original);
  if (!controle.verde) {
    console.error(`CONTROLE FALHOU: a 034 intacta nao passa no teste -> ${controle.saida}`);
    console.error("O template esta errado, ou a migration quebrou. Placar abaixo nao vale.");
    falhou = true;
  } else {
    console.log("controle: a 034 intacta passa no teste  OK\n");
  }

  let mortos = 0;
  for (const m of MUTANTES) {
    if (!original.includes(m.de)) {
      // Mutante que nao se aplica e o pior resultado possivel: ele conta como
      // "morreu" sem nunca ter existido. Ver controle-negativo-que-nasce-falso.
      console.error(`NAO APLICOU: ${m.nome} -- o trecho procurado nao esta na 034`);
      falhou = true;
      continue;
    }
    const r = rodar(`hmo184_mut_${m.nome}`, original.replace(m.de, m.para));
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
