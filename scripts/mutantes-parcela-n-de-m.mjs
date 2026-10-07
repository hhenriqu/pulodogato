#!/usr/bin/env node
// Mutantes da migration 035 (parcela N de M) -- HMO-211 / HMO-219.
//
// POR QUE ISTO EXISTE
// -------------------
// `035_parcela_n_de_m_test.sql` passa com 35 assercoes verdes. Isso, sozinho,
// nao diz nada: um teste que nunca reprova nao esta medindo o que a
// justificativa dele afirma. Cada mutante abaixo afrouxa UMA decisao da 035; o
// teste tem que ficar vermelho em todos.
//
// OS QUE VALEM SER LIDOS ANTES DE MEXER NA 035
// --------------------------------------------
// `check_intuitivo` e o mutante-assinatura desta migration. Ele troca o CHECK
// pela forma que QUALQUER pessoa escreveria primeiro:
//
//   CHECK ((number IS NULL AND total IS NULL) OR (number >= 1 AND total >= 2 ...))
//
// Com `(3, NULL)` o primeiro ramo e FALSE e o segundo contem `NULL >= 2`, que e
// NULL. `FALSE OR NULL` e NULL -- e **um CHECK que resulta NULL ACEITA a
// linha**. A versao obvia deixa passar exatamente a linha meio-preenchida que
// ela existe para barrar, e a tela mostra "parcela 3 de " sem numero depois do
// "de". Se este mutante sobreviver, a 035 nao esta protegendo nada.
//
// `check_ausente` e `check_largo_demais` sao os extremos opostos da mesma linha,
// e um teste so pega os dois se tiver assercao de recusa E assercao de
// aceitacao. Era facil escrever este teste so com as quatro recusas da SECAO 4 --
// e `check_largo_demais` (`CHECK (false)`, que recusa o par incoerente e recusa
// TODO lancamento do app junto) passaria por morto. Quem o mata e o controle
// positivo da compra avulsa.
//
// `sem_reafirmar_invoker` nao e teorico, e e a razao pela qual aquela linha da
// 035 nao pode ser apagada por "redundante": foi MEDIDO que
// `CREATE OR REPLACE VIEW` APAGA as reloptions da view no Postgres 17.11. Sem o
// `ALTER VIEW ... SET (security_invoker = true)` a 035 -- que nao fala de
// permissao em lugar nenhum -- faz a fatura de qualquer usuario vazar para
// qualquer usuario logado. Quem o mata e a SECAO 6.
//
// `indice_nao_parcial` so morre por causa da SECAO 4b, e e um caso instrutivo:
// nenhuma assercao de COMPORTAMENTO muda de cor quando o `WHERE` do indice cai
// (um indice cheio responde as mesmas perguntas). O que muda e o tamanho, e
// tamanho nao aparece em `count(*)`. Por isso a assercao tem de ser sobre
// `pg_index.indpred`, e nao sobre uma consulta.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria e escrita num arquivo TEMPORARIO; o
// `database/migrations/035_*.sql` nao e tocado em momento nenhum. E de
// proposito: o jeito usual (mutar o arquivo, rodar, restaurar no `finally`)
// deixa a fonte mutada no disco quando o processo morre no meio, e o placar
// seguinte vira ficcao.
//
// COMO RODAR
//   1. Monte o banco-template com a cadeia ATE A 034 (sem a 035) -- a mesma
//      sequencia de `$PSQL -f` do .github/workflows/db-verify.yml:
//        createdb hmo211_base && ...aplique a sequencia...
//   2. npm run mutantes:parcela-n-de-m
//
// O template NAO pode conter a 035: ela e `IF NOT EXISTS` / `IF NOT EXISTS` na
// constraint, entao aplicar um mutante sobre um banco que ja tem a versao boa
// vira no-op e TODO mutante "sobrevive" por motivo nenhum.
//
// E O CONTROLE NEGATIVO E QUEM CONFERE ISSO (HMO-331)
// ---------------------------------------------------
// Nao da para confiar na receita: um template montado por engano COM a 035
// deixa todo mutante sobreviver como no-op, e o placar sai cheio sem ter medido
// nada. Por isso a primeira coisa que este runner faz e rodar o teste num clone
// do template SEM aplicar a 035 -- e exigir que ele REPROVE. Se passar, o
// runner para e diz que o placar nao vale.
//
// NO CI, O TEMPLATE E UM RETRATO DA PROPRIA CADEIA
// -----------------------------------------------
// O db-verify.yml tira `CREATE DATABASE hmo331_pre035 TEMPLATE $PGDATABASE` no
// ponto em que a 034 acabou de entrar e a 035 ainda nao -- copia de arquivo
// no lado do servidor, nao replica a cadeia. O retrato nao pode divergir do que
// o job acabou de provar, porque E ele. O default `hmo211_base` ficou para quem
// monta o template a mao, na receita acima.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PG = process.env.PG_URL_BASE ?? "postgresql://postgres:postgres@127.0.0.1:5432";
const TEMPLATE = process.env.PG_TEMPLATE ?? "hmo211_base";
const MIGRATION = "database/migrations/035_parcela_n_de_m.sql";
const TESTE = "database/tests/035_parcela_n_de_m_test.sql";

const psql = (db, args) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-q", `${PG}/${db}`, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" },
  });

const original = readFileSync(MIGRATION, "utf8");

// O ADD CONSTRAINT inteiro, de dentro do `DO $$`.
const ADD_CHECK = `    ALTER TABLE public.financial_transactions
      ADD CONSTRAINT financial_transactions_installment_coerente
      CHECK (
        (installment_number IS NULL) = (installment_total IS NULL)
        AND (
          installment_number IS NULL
          OR (
            installment_number >= 1
            AND installment_total >= 2
            AND installment_number <= installment_total
          )
        )
      );`;

// So o corpo do CHECK, para os mutantes que trocam a expressao e nada mais.
const CORPO_CHECK = `      CHECK (
        (installment_number IS NULL) = (installment_total IS NULL)
        AND (
          installment_number IS NULL
          OR (
            installment_number >= 1
            AND installment_total >= 2
            AND installment_number <= installment_total
          )
        )
      );`;

const INDICE = `CREATE INDEX IF NOT EXISTS idx_financial_transactions_installment_parent
  ON public.financial_transactions (installment_parent_id)
  WHERE installment_parent_id IS NOT NULL;`;

const COLUNAS_DA_VIEW = `    -- 035: o rotulo "parcela N de M". NULL nas duas em toda compra avulsa.
    t.installment_number,
    t.installment_total`;

const MUTANTES = [
  {
    nome: "check_ausente",
    porque:
      "as duas colunas entram sem trava nenhuma: o par meio preenchido fica gravavel e a tela mostra 'parcela 3 de ' sem numero depois do 'de'",
    de: ADD_CHECK,
    para: "    PERFORM 1;",
  },
  {
    nome: "check_intuitivo",
    porque:
      "a forma que se escreve primeiro: com (3, NULL) o CHECK resulta NULL, e CHECK que resulta NULL ACEITA a linha -- deixa passar exatamente o que existe para barrar",
    de: CORPO_CHECK,
    para: `      CHECK (
        (installment_number IS NULL AND installment_total IS NULL)
        OR (
          installment_number >= 1
          AND installment_total >= 2
          AND installment_number <= installment_total
        )
      );`,
  },
  {
    nome: "check_largo_demais",
    porque:
      "CHECK (false) recusa o par incoerente -- e recusa TODO lancamento do app junto: so morre junto com a assercao de ACEITACAO da compra avulsa",
    de: CORPO_CHECK,
    para: "      CHECK (false);",
  },
  {
    nome: "check_nao_trava",
    porque:
      "CHECK (true) tem a cara de uma trava e nao trava nada -- o modo de falha mais plausivel de um 'simplifiquei o CHECK'",
    de: CORPO_CHECK,
    para: "      CHECK (true);",
  },
  {
    nome: "check_nao_validado",
    porque:
      "NOT VALID deixa as linhas que JA estao na tabela fora da checagem: o CHECK aparece em pg_constraint e parece estar la sem estar",
    de: CORPO_CHECK,
    para: CORPO_CHECK.replace("      );", "      ) NOT VALID;"),
  },
  {
    nome: "parcela_1_de_1_permitida",
    porque:
      "`total >= 1` no lugar de `>= 2` cria duas maneiras de dizer 'compra avulsa', e a tela passa a rotular metade das compras como 'parcela 1 de 1'",
    de: "            AND installment_total >= 2",
    para: "            AND installment_total >= 1",
  },
  {
    nome: "n_maior_que_m_permitido",
    porque:
      "sem `number <= total` a 'parcela 12 de 10' entra: aritmetica impossivel gravada, e a tela a imprime como se fosse normal",
    de: "            AND installment_number <= installment_total\n",
    para: "",
  },
  {
    nome: "indice_nao_parcial",
    porque:
      "o indice vira CHEIO: indexa o installment_parent_id NULL de todo lancamento avulso do historico. Nenhuma consulta muda de resposta -- so o tamanho --, entao so a assercao sobre pg_index.indpred pega",
    de: INDICE,
    para: `CREATE INDEX IF NOT EXISTS idx_financial_transactions_installment_parent
  ON public.financial_transactions (installment_parent_id);`,
  },
  {
    nome: "view_sem_o_rotulo",
    porque:
      "a view volta a ser a da 006: as colunas existem na tabela e a fatura nao as expoe, entao a tela nao tem de onde ler 'parcela 3 de 10' e cai no parsing da descricao, que o usuario pode reescrever",
    de: COLUNAS_DA_VIEW,
    para: "    -- 035: (mutado) o rotulo nao entra na view",
  },
  {
    nome: "sem_reafirmar_invoker",
    porque:
      "MEDIDO: CREATE OR REPLACE VIEW APAGA as reloptions. Sem reafirmar, card_invoice_lines roda com o privilegio do DONO e a fatura de qualquer usuario vai para qualquer usuario logado -- sem erro, so com linhas a mais",
    de: "ALTER VIEW public.card_invoice_lines SET (security_invoker = true);",
    para: "-- (mutado) sem reafirmar o security_invoker",
  },
  {
    nome: "fatura_com_sinal_cru",
    porque:
      "SUM(amount) no lugar de SUM(-amount): a despesa e gravada negativa, entao a parcela ABATE da fatura em vez de somar e o mes fecha negativo",
    de: "    (-t.amount) AS invoice_amount,",
    para: "    (t.amount) AS invoice_amount,",
  },
];

const dir = mkdtempSync(join(tmpdir(), "mutantes-hmo211-"));

/**
 * Roda a suite num banco novo feito do template, com `sql` no lugar da 035.
 *
 * `sql === null` quer dizer "nao aplique a 035 nenhuma" -- e o que o CONTROLE
 * NEGATIVO usa para provar que o template esta mesmo PRE-035.
 */
function rodar(db, sql) {
  const arquivo = join(dir, `${db}.sql`);
  if (sql !== null) writeFileSync(arquivo, sql);
  psql("postgres", ["-c", `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`]);
  psql("postgres", ["-c", `CREATE DATABASE ${db} TEMPLATE ${TEMPLATE}`]);
  try {
    if (sql !== null) psql(db, ["-f", arquivo]);
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
  // CONTROLE NEGATIVO. Sem a 035, o teste tem de REPROVAR. E ele que detecta o
  // template montado COM a migration dentro -- o erro que faz todo mutante
  // "morrer" por no-op e o placar sair 11/11 sem nada ter sido medido.
  const negativo = rodar("hmo211_mut_negativo", null);
  if (negativo.verde) {
    console.error("CONTROLE NEGATIVO FALHOU: o teste da 035 passa num banco SEM a 035 aplicada.");
    console.error(
      `O template '${TEMPLATE}' provavelmente ja contem a 035 (ou o teste nao mede nada). Placar abaixo nao vale.`,
    );
    falhou = true;
  } else {
    console.log("controle negativo: sem a 035 o teste reprova  OK");
  }

  // CONTROLE POSITIVO. Sem ele, um template quebrado faria todo mutante
  // "morrer" e o placar sairia 11/11 sem que o teste tivesse medido nada.
  const controle = rodar("hmo211_mut_controle", original);
  if (!controle.verde) {
    console.error(`CONTROLE FALHOU: a 035 intacta nao passa no teste -> ${controle.saida}`);
    console.error("O template esta errado, ou a migration quebrou. Placar abaixo nao vale.");
    falhou = true;
  } else {
    console.log("controle: a 035 intacta passa no teste  OK\n");
  }

  let mortos = 0;
  for (const m of MUTANTES) {
    if (!original.includes(m.de)) {
      // Mutante que nao se aplica e o pior resultado possivel: ele conta como
      // "morreu" sem nunca ter existido.
      console.error(`NAO APLICOU: ${m.nome} -- o trecho procurado nao esta na 035`);
      falhou = true;
      continue;
    }
    const r = rodar(`hmo211_mut_${m.nome}`, original.replace(m.de, m.para));
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
