#!/usr/bin/env node
// Mutantes da migration 048 (a trava de tipo do lancamento) -- HMO-232.
//
// POR QUE ISTO EXISTE
// -------------------
// A 048 tem UMA linha de efeito. Um teste de recusa sobre uma linha de efeito e
// o caso em que a prova de mutacao parece mais dispensavel e e mais util: as
// quatro maneiras plausiveis de escrever essa linha ERRADA produzem, as quatro,
// um banco que "recusa lancamento sem tipo" -- e tres delas quebram outra coisa
// no caminho, em silencio.
//
// Os dois mutantes que motivaram o arquivo:
//
//   `check_que_aceita_nulo` -- a armadilha que a propria issue nomeia.
//   `CHECK (transaction_type IN ('income','expense','transfer'))` e o que se
//   escreve quando se quer "travar o dominio da coluna". Para a linha SEM tipo
//   o predicado vale NULL, que nao e FALSE, e o Postgres ACEITA: e uma trava
//   que passa em revisao de codigo, aparece no `\d+` da tabela, e deixa entrar
//   exatamente a unica linha que ela existia para barrar. Quem o mata e a
//   SECAO 2 (o INSERT sem a coluna passa).
//
//   `check_explicito_em_vez_de_not_null` -- o irmao honesto dele.
//   `CHECK (transaction_type IS NOT NULL)` barra o nulo DE VERDADE. Ele e o
//   mutante que importa, porque esta CERTO no comportamento e errado no resto:
//   o SQLSTATE vira 23514 e `is_nullable` continua 'YES' no catalogo. Tudo que
//   le a coluna pelo catalogo -- `\d`, o Supabase Studio, o gerador de tipos,
//   `scripts/gen-schema-columns.mjs` -- segue dizendo "aceita nulo". Um teste
//   que so afirmasse "o INSERT sem tipo e recusado" ficaria VERDE com ele, e
//   e por isso que a SECAO 1 (catalogo) existe junto da SECAO 2 (recusa):
//   cada mutante deste arquivo e morto por UMA das duas, nunca pelas duas.
//
// OS MUTANTES DELIBERADAMENTE DEIXADOS DE FORA
// ---------------------------------------------
// Dois, e os dois pelo MESMO motivo -- eles sobreviveriam, e sobreviver estaria
// CERTO. O db-verify monta o banco DO ZERO e aplica a cadeia em ordem, entao
// quando a 048 roda nao existe nenhuma linha antiga sem tipo para o backfill
// alcancar. Nessa cadeia:
//
//   `sem_o_backfill` (apagar o bloco DO que chama
//   `public.backfill_tipo_do_lancamento()`) e um no-op. O que esse bloco
//   protege e a COLAGEM A MAO num banco que tem historico -- o do Helio, o
//   unico lugar onde pode haver linha nula, e o unico que nenhum CI alcanca.
//
//   `backfill_depois_da_trava` (mover o bloco para DEPOIS do ALTER) e no-op
//   pela mesma razao: com zero linha nula, as duas ordens dao o mesmo banco.
//   Num banco com historico a ordem invertida faz o `SET NOT NULL` abortar em
//   23502 e a migration inteira voltar atras.
//
// Mutante sobrevivente que esta certo polui o placar e faz o proximo leitor
// "consertar" uma guarda que nunca esteve quebrada. Os dois ficam escritos aqui
// em vez de na lista.
//
// E SOBRE O `sem_a_trava`, QUE ESTA NA LISTA
// -------------------------------------------
// Ele apaga o ALTER e DEIXA o backfill -- entao se parece muito com o CONTROLE
// NEGATIVO (o teste rodado contra o template cru, sem a 048 nenhuma). A
// sobreposicao e proposital e nao e a mesma pergunta: o controle negativo
// detecta um TEMPLATE montado errado (com a 048 dentro), e este mutante detecta
// uma MIGRATION esvaziada -- alguem que leia a 048, veja o bloco de backfill
// com 40 linhas de comentario e a trava com duas, e "simplifique" para o que
// parece ser o corpo dela. Os dois ficam porque custam 2s cada.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria e escrita num arquivo TEMPORARIO; o
// `database/migrations/048_*.sql` nao e tocado em momento nenhum. O jeito usual
// (mutar o arquivo, rodar, restaurar no `finally`) deixa a fonte mutada no disco
// quando o processo morre no meio -- e o placar seguinte vira ficcao.
//
// COMO RODAR
//   1. Monte o banco-template com a cadeia ATE A 047 (SEM a 048) -- a mesma
//      sequencia de `$PSQL -f` do .github/workflows/db-verify.yml, parando
//      antes da 048. O template NAO pode conter a 048: `SET NOT NULL` numa
//      coluna que ja e NOT NULL e um no-op, entao TODO mutante "morreria"
//      sobre um banco que ja estivesse travado -- e o placar sairia cheio sem
//      ter medido nada. E o que o CONTROLE NEGATIVO existe para detectar.
//   2. PG_TEMPLATE=<nome do template> npm run mutantes:trava-de-tipo

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PG = process.env.PG_URL_BASE ?? "postgresql://postgres:postgres@127.0.0.1:5432";
const TEMPLATE = process.env.PG_TEMPLATE ?? "hmo232_pre048";
const MIGRATION = "database/migrations/048_trava_de_tipo_do_lancamento.sql";
const TESTE = "database/tests/048_trava_de_tipo_do_lancamento_test.sql";

const psql = (db, args) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-q", `${PG}/${db}`, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" },
  });

const original = readFileSync(MIGRATION, "utf8");

// ---------------------------------------------------------------------------
// O trecho exato da 048 que os mutantes trocam.
// ---------------------------------------------------------------------------
// O `ALTER TABLE` aparece UMA vez no arquivo -- o script confere isso antes de
// cada substituicao, porque `replace` pega a PRIMEIRA ocorrencia e um trecho
// que casasse duas vezes mutaria a errada em silencio.
const A_TRAVA = `ALTER TABLE public.financial_transactions
  ALTER COLUMN transaction_type SET NOT NULL;`;

const MUTANTES = [
  {
    nome: "sem_a_trava",
    porque:
      "a entrega da issue em pessoa: o backfill da 037 roda de novo, a migration sai verde, e a coluna continua aceitando nulo. E a 048 reduzida ao que PARECE ser o corpo dela",
    de: A_TRAVA,
    para: "-- a trava foi removida pelo mutante",
  },
  {
    nome: "check_que_aceita_nulo",
    porque:
      "A ARMADILHA QUE A ISSUE NOMEIA: CHECK aceita NULL. Para a linha sem tipo o predicado vale NULL, que nao e FALSE, e a linha ENTRA -- a trava fecha o dominio da coluna e deixa passar o unico valor que ela existia para barrar. Quem o mata e a SECAO 2 (o INSERT sem a coluna deixa de ser recusado)",
    de: A_TRAVA,
    para: `ALTER TABLE public.financial_transactions
  ADD CONSTRAINT financial_transactions_transaction_type_valido
  CHECK (transaction_type IN ('income', 'expense', 'transfer'));`,
  },
  {
    nome: "check_explicito_em_vez_de_not_null",
    porque:
      "O MUTANTE QUE ESTA CERTO NO COMPORTAMENTO: este CHECK barra o nulo de verdade, com 23514. O que ele perde e o CATALOGO -- `is_nullable` continua 'YES', e toda ferramenta que le a coluna por ali (o \\d, o Studio, o gerador de tipos, gen-schema-columns.mjs) segue dizendo 'aceita nulo'. Um teste que so afirmasse 'o INSERT sem tipo e recusado' ficaria VERDE com ele; quem o mata e a SECAO 1, e o SQLSTATE exato da SECAO 2",
    de: A_TRAVA,
    para: `ALTER TABLE public.financial_transactions
  ADD CONSTRAINT financial_transactions_transaction_type_nao_nulo
  CHECK (transaction_type IS NOT NULL);`,
  },
  {
    nome: "default_junto_da_trava",
    porque:
      "o 'conserto' que alguem faz para a migration nao poder falhar na colagem: com DEFAULT 'expense', o INSERT sem a coluna volta a PASSAR e a linha nasce despesa em silencio -- inclusive a perna de transferencia, que viraria uma despesa a mais no mes com o saldo continuando certo (o estrago da HMO-162, de novo). A trava passa a existir no catalogo e a nao barrar escrita nenhuma",
    de: A_TRAVA,
    para: `ALTER TABLE public.financial_transactions
  ALTER COLUMN transaction_type SET DEFAULT 'expense';

ALTER TABLE public.financial_transactions
  ALTER COLUMN transaction_type SET NOT NULL;`,
  },
];

let falhou = false;

function rodar(dir, db, sql) {
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

const dir = mkdtempSync(join(tmpdir(), "mutantes-hmo232-"));

try {
  // CONTROLE NEGATIVO. Sem a 048, o teste tem de REPROVAR. Ele e o que detecta
  // o template montado com a migration dentro -- e aqui esse erro e mais facil
  // de cometer do que em qualquer outra migration: `SET NOT NULL` sobre coluna
  // ja travada nao da erro nenhum, entao um template contaminado nao se
  // denuncia por si.
  const negativo = rodar(dir, "hmo232_mut_negativo", null);
  if (negativo.verde) {
    console.error("CONTROLE NEGATIVO FALHOU: o teste da 048 passa num banco SEM a 048 aplicada.");
    console.error(
      `O template '${TEMPLATE}' provavelmente ja contem a 048 (ou o teste nao mede nada). Placar abaixo nao vale.`,
    );
    falhou = true;
  } else {
    console.log("controle negativo: sem a 048 o teste reprova  OK");
  }

  // CONTROLE POSITIVO. E o unico controle que pega erro de script no proprio
  // caminho da mutacao: com ele vermelho, todo mutante "morre" de graca e o
  // placar sai cheio sem ter medido nada.
  const positivo = rodar(dir, "hmo232_mut_controle", original);
  if (!positivo.verde) {
    console.error(`CONTROLE POSITIVO FALHOU: a 048 intacta nao passa no teste -> ${positivo.saida}`);
    console.error("O template esta errado, ou a migration quebrou. Placar nenhum vale, e por isso nao sai nenhum.");
    process.exitCode = 1;
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  }
  console.log("controle positivo: a 048 intacta passa no teste  OK\n");

  let mortos = 0;
  for (const m of MUTANTES) {
    // Mutante que nao se aplica e o pior resultado possivel: ele conta como
    // "morreu" sem nunca ter existido. As duas travas, antes e depois.
    const ocorrencias = original.split(m.de).length - 1;
    if (ocorrencias !== 1) {
      console.error(`NAO APLICOU: ${m.nome} -- o trecho procurado aparece ${ocorrencias}x na 048 (esperado: 1)`);
      falhou = true;
      continue;
    }
    const mutado = original.replace(m.de, m.para);
    if (mutado === original) {
      console.error(`NAO MUTOU: ${m.nome} -- a substituicao nao mudou o arquivo`);
      falhou = true;
      continue;
    }

    const r = rodar(dir, `hmo232_mut_${m.nome}`, mutado);
    if (r.verde) {
      console.error(`SOBREVIVEU: ${m.nome}`);
      console.error(`            ${m.porque}`);
      falhou = true;
    } else {
      mortos++;
      console.log(`morreu:     ${m.nome}`);
    }
  }

  console.log(`\nSQL: ${mortos}/${MUTANTES.length} mutantes mortos`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exitCode = falhou ? 1 : 0;
