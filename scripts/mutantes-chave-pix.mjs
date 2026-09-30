#!/usr/bin/env node
// Mutantes da migration 032 (chave Pix do membro) -- HMO-201.
//
// POR QUE ISTO EXISTE
// -------------------
// `hmo201_chave_pix_test.sql` passa com 14 assercoes verdes. Isso, sozinho, nao
// diz nada: um teste que nunca reprova e um teste que nao esta medindo o que a
// justificativa dele afirma. Cada mutante abaixo afrouxa UMA decisao da 032; o
// teste tem que ficar vermelho em todos.
//
// O MUTANTE QUE IMPORTA E O PRIMEIRO. A 032 inteira existe para que a chave Pix
// nao vaze para fora do grupo. Se `policy_larga` sobreviver, a migration esta
// entregando o CPF de cada pessoa para a base autenticada inteira e o teste
// esta assinando embaixo.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria e escrita num arquivo TEMPORARIO; o
// `database/migrations/032_*.sql` nao e tocado em momento nenhum. E de
// proposito: o jeito usual (mutar o arquivo, rodar, restaurar no `finally`)
// deixa a fonte mutada no disco quando o processo morre no meio, e o placar
// seguinte vira ficcao.
//
// COMO RODAR
//   1. Monte o banco-template com a cadeia ATE A 031 (sem a 032):
//        createdb hmo201_base && ...aplique as migrations...
//   2. npm run mutantes:chave-pix
//
// O template NAO pode conter a 032: ela e cheia de `IF NOT EXISTS` /
// `CREATE OR REPLACE`, entao aplicar um mutante sobre um banco que ja tem a
// versao boa vira no-op e TODO mutante "sobrevive" por motivo nenhum.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PG = process.env.PG_URL_BASE ?? "postgresql://postgres:postgres@127.0.0.1:5432";
const TEMPLATE = process.env.PG_TEMPLATE ?? "hmo201_base";
const MIGRATION = "database/migrations/032_chave_pix_do_membro.sql";
const TESTE = "database/tests/hmo201_chave_pix_test.sql";

const psql = (db, args) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-q", `${PG}/${db}`, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" },
  });

const original = readFileSync(MIGRATION, "utf8");

const MUTANTES = [
  {
    nome: "policy_larga",
    porque:
      "a policy de SELECT para de perguntar quem e -- todo autenticado le a chave de todo mundo",
    de: "USING (user_id = auth.uid() OR public.compartilha_grupo_ativo(user_id));",
    para: "USING (TRUE);",
  },
  {
    nome: "pending_conta_como_membro",
    porque:
      "compartilha_grupo_ativo deixa de exigir que o OUTRO lado esteja ativo: quem so pediu entrada ja le",
    de: "       AND dele.user_id = p_user_id\n       AND dele.status = 'active'",
    para: "       AND dele.user_id = p_user_id",
  },
  // NAO EXISTE um mutante "tira o WITH CHECK do UPDATE". Ele foi escrito,
  // sobreviveu, e o motivo nao e buraco no teste: num policy de UPDATE sem
  // WITH CHECK o Postgres usa a expressao do USING para validar a linha nova
  // (medido -- `polwithcheck` fica NULO e a escrita continua barrada). Era um
  // mutante EQUIVALENTE, e manter um desses no placar e pior que nao ter
  // mutante nenhum: ele transformaria "4/6" numa meta impossivel e treinaria
  // quem olha o placar a ignorar sobrevivente. O que afrouxa de verdade e
  // mexer no USING, e e isso que `update_larga` faz.
  {
    nome: "update_larga",
    porque:
      "o UPDATE para de perguntar de quem e a linha: da para mover a propria chave para o user_id de outra pessoa",
    de: "  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());",
    para: "  USING (TRUE) WITH CHECK (TRUE);",
  },
  {
    nome: "aceita_chave_em_branco",
    porque:
      "o CHECK de chave nao-vazia some: a tela do colega mostra um botao que copia string vazia",
    de: "    CHECK (length(btrim(pix_key)) > 0),",
    para: "    CHECK (TRUE),",
  },
  {
    nome: "aceita_qualquer_tipo",
    porque: "o CHECK do tipo some: 'whatsapp' entra e a tela nao sabe o que esta mostrando",
    de: "    CHECK (pix_key_type IN ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')),",
    para: "    CHECK (TRUE),",
  },
  {
    nome: "insert_sem_dono",
    porque:
      "o WITH CHECK do INSERT some: qualquer um cadastra a PROPRIA chave no nome de outra pessoa",
    de: "CREATE POLICY user_pix_keys_insert ON public.user_pix_keys\n  FOR INSERT TO authenticated\n  WITH CHECK (user_id = auth.uid());",
    para: "CREATE POLICY user_pix_keys_insert ON public.user_pix_keys\n  FOR INSERT TO authenticated\n  WITH CHECK (TRUE);",
  },
];

const dir = mkdtempSync(join(tmpdir(), "mutantes-pix-"));

/** Roda a suite num banco novo feito do template, com `sql` no lugar da 032. */
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
    return { verde: false, saida: String(e.stderr ?? e.message).trim().split("\n").slice(-2).join(" | ") };
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
  const controle = rodar("hmo201_mut_controle", original);
  if (!controle.verde) {
    console.error(`CONTROLE FALHOU: a 032 intacta nao passa no teste -> ${controle.saida}`);
    console.error("O template esta errado, ou a migration quebrou. Placar abaixo nao vale.");
    falhou = true;
  } else {
    console.log("controle: a 032 intacta passa no teste  OK\n");
  }

  let mortos = 0;
  for (const m of MUTANTES) {
    if (!original.includes(m.de)) {
      // Mutante que nao se aplica e o pior resultado possivel: ele conta como
      // "morreu" sem nunca ter existido. Ver controle-negativo-que-nasce-falso.
      console.error(`NAO APLICOU: ${m.nome} -- o trecho procurado nao esta na 032`);
      falhou = true;
      continue;
    }
    const r = rodar(`hmo201_mut_${m.nome}`, original.replace(m.de, m.para));
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
