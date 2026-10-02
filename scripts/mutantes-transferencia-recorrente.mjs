#!/usr/bin/env node
// Mutantes da migration 038 (transferencia recorrente) -- HMO-172.
//
// POR QUE ISTO EXISTE
// -------------------
// `038_transferencia_recorrente_test.sql` passa com 14 assercoes verdes. Isso,
// sozinho, nao diz nada: um teste que nunca reprova nao esta medindo o que a
// justificativa dele afirma. Cada mutante abaixo afrouxa UMA decisao da 038; o
// teste tem que ficar vermelho em todos.
//
// O PAR QUE DA SENTIDO AO PLACAR
// ------------------------------
// `check_larga_demais` (CHECK (false)) e `check_nao_trava` (CHECK (true)) sao os
// extremos opostos da mesma linha, e um teste so pega os dois se tiver assercao
// de recusa E de aceitacao. Era facil escrever este teste so com "transfer sem
// destino e recusado" -- e `check_larga_demais`, que recusa TAMBEM a despesa
// fixa e portanto quebra a criacao de qualquer conta prevista no app, passaria
// por morto.
//
// O MUTANTE QUE MOTIVOU O TESTE INTEIRO
// -------------------------------------
// `check_permissivo` e o defeito que eu teria escrito sem pensar: a forma
// `destination_account_id IS NULL OR transaction_type = 'transfer'` tem a cara
// certa e deixa passar exatamente o estado que a issue descreve -- `transfer`
// SEM destino, a regra que materializa UMA perna. Ele e a razao pela qual o
// CHECK e um CASE.
//
// `drop_sem_add` e o segundo que vale ler: ele apaga o CHECK do 027 e nao poe
// nada no lugar. Toda assercao de ACEITACAO passa (transfer entra!), e so as de
// recusa pegam -- e o estado resultante e pior que o original, porque
// `transaction_type` passaria a aceitar qualquer valor do enum sem nenhuma
// regra de destino.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria e escrita num arquivo TEMPORARIO; o
// `database/migrations/038_*.sql` nao e tocado em momento nenhum. E de
// proposito: o jeito usual (mutar o arquivo, rodar, restaurar no `finally`)
// deixa a fonte mutada no disco quando o processo morre no meio, e o placar
// seguinte vira ficcao.
//
// COMO RODAR
//   1. Monte o banco-template com a cadeia ATE A 037 (sem a 038):
//        export PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres
//        createdb hmo172_base
//        psql -q -d hmo172_base -f database/tests/00_supabase_shim.sql
//        for f in $(ls database/migrations/*.sql | grep -v '/038_' | sort); do \
//          psql -v ON_ERROR_STOP=1 -q -d hmo172_base -f "$f"; done
//   2. npm run mutantes:transferencia-recorrente
//
// O template NAO pode conter a 038: as guardas `ADD COLUMN IF NOT EXISTS` e
// `IF NOT EXISTS (pg_constraint)` tornam todo mutante no-op sobre um banco que
// ja tem a versao boa, e TODOS "sobrevivem" por motivo nenhum.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PG = process.env.PG_URL_BASE ?? "postgresql://postgres:postgres@127.0.0.1:5432";
const TEMPLATE = process.env.PG_TEMPLATE ?? "hmo172_base";
const MIGRATION = "database/migrations/038_transferencia_recorrente.sql";
const TESTE = "database/tests/038_transferencia_recorrente_test.sql";

const psql = (db, args) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-q", `${PG}/${db}`, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" },
  });

const original = readFileSync(MIGRATION, "utf8");

// O corpo do CHECK cruzado, identico nas duas tabelas. Mutar a string crua
// troca as DUAS ocorrencias de uma vez (`replaceAll`), que e o que se quer: um
// afrouxamento que valesse so para `recurring_rules` deixaria a ocorrencia
// protegida e seria um mutante mais fraco do que o defeito real.
const CORPO_DO_CHECK = `        CASE WHEN transaction_type = 'transfer'
          THEN destination_account_id IS NOT NULL
               AND account_id IS NOT NULL
               AND destination_account_id <> account_id
          ELSE destination_account_id IS NULL
        END`;

const LISTA_DO_027 = `    transaction_type IS NULL
    OR transaction_type IN ('income', 'expense', 'transfer')`;

const MUTANTES = [
  {
    nome: "check_permissivo",
    porque:
      "a forma `destino IS NULL OR tipo = transfer` deixa passar transfer SEM destino -- a regra que materializa UMA perna, o defeito inteiro da issue",
    de: CORPO_DO_CHECK,
    para: "        destination_account_id IS NULL OR transaction_type = 'transfer'",
    todas: true,
  },
  {
    nome: "destino_igual_a_origem_liberado",
    porque:
      "sem `destination_account_id <> account_id` as duas pernas caem na mesma conta, se anulam, e a tela diz 'transferido' sem nada ter se movido",
    de: `               AND destination_account_id <> account_id\n`,
    para: "",
    todas: true,
  },
  {
    nome: "else_sem_regra",
    porque:
      "ELSE true libera despesa/receita COM destino: a transferencia disfarcada, que a baixa grava como UMA perna negativa",
    de: "          ELSE destination_account_id IS NULL",
    para: "          ELSE true",
    todas: true,
  },
  {
    nome: "check_larga_demais",
    porque:
      "CHECK (false) recusa transfer sem destino -- e recusa a despesa fixa junto: o app para de criar conta prevista nenhuma",
    de: CORPO_DO_CHECK,
    para: "        false",
    todas: true,
  },
  {
    nome: "check_nao_trava",
    porque:
      "CHECK (true) tem a cara de uma trava e nao trava nada -- o modo de falha mais plausivel de um 'simplifiquei o CHECK'",
    de: CORPO_DO_CHECK,
    para: "        true",
    todas: true,
  },
  {
    nome: "drop_sem_add",
    porque:
      "apaga o CHECK do 027 e nao poe nada no lugar: transfer passa a entrar, mas `transaction_type` aceita qualquer valor do enum sem regra de destino nenhuma",
    de: `ALTER TABLE public.scheduled_transactions
  ADD CONSTRAINT scheduled_transactions_transaction_type_check
  CHECK (
${LISTA_DO_027}
  );`,
    para: "-- mutante: o ADD foi removido",
  },
  {
    nome: "so_transfer_na_lista",
    porque:
      "a lista alargada vira `IN ('transfer')`: a transferencia entra e a receita prevista da HMO-188 passa a levar 23514 -- o salario volta a nao poder ser previsto",
    de: LISTA_DO_027,
    para: `    transaction_type IS NULL
    OR transaction_type IN ('transfer')`,
  },
  {
    nome: "add_sem_drop",
    porque:
      "o `IF NOT EXISTS` da 027 no lugar do DROP+ADD: a constraint ESTREITA continua de pe, a migration fica verde e a primeira transferencia prevista leva 23514",
    de: `ALTER TABLE public.scheduled_transactions
  DROP CONSTRAINT IF EXISTS scheduled_transactions_transaction_type_check;`,
    para: "-- mutante: o DROP foi removido",
  },
  {
    nome: "fk_com_set_null",
    porque:
      "ON DELETE SET NULL no destino: apagar a conta transforma a regra numa transferencia SEM destino -- numa linha que ninguem tocou, e o 23514 so aparece na escrita seguinte",
    de: `      FOREIGN KEY (destination_account_id)
      REFERENCES public.financial_accounts(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scheduled_transactions_destination_account_id_fkey'
  ) THEN`,
    para: `      FOREIGN KEY (destination_account_id)
      REFERENCES public.financial_accounts(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scheduled_transactions_destination_account_id_fkey'
  ) THEN`,
  },
  {
    nome: "recria_a_view",
    porque:
      "o 'conserto' tentador: recriar scheduled_transactions_effective para 'incluir transfer'. CREATE OR REPLACE VIEW apaga reloptions, e com ele o security_invoker da 004 -- a view volta a rodar como o DONO e fura a RLS de todo mundo",
    de: "COMMENT ON CONSTRAINT scheduled_transactions_destino_check",
    para: `CREATE OR REPLACE VIEW public.scheduled_transactions_effective AS
  SELECT s.*,
         CASE WHEN s.status = 'pending' AND s.due_date < CURRENT_DATE
                THEN 'overdue' ELSE s.status::text END AS effective_status,
         COALESCE(s.transaction_type, r.transaction_type, 'expense') AS direction
    FROM public.scheduled_transactions s
    LEFT JOIN public.recurring_rules r ON r.id = s.recurring_rule_id;

COMMENT ON CONSTRAINT scheduled_transactions_destino_check`,
  },
  // `sem_a_guarda` NAO esta nesta lista, e a ausencia e deliberada. A guarda do
  // passo 1 so e alcancavel num banco que JA tenha uma regra 'transfer', e o
  // teste SQL roda num banco limpo -- nenhuma assercao dele pode mata-lo. Posto
  // aqui, ele seria um "SOBREVIVEU" permanente que se le como furo do teste e
  // nao e. Ele e provado por `provarAGuarda`, que fabrica a linha ruim.
];

const dir = mkdtempSync(join(tmpdir(), "mutantes-hmo172-"));

/** Roda a suite num banco novo feito do template, com `sql` no lugar da 038. */
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

/**
 * A guarda do passo 1 da 038, provada sobre a linha que ela existe para pegar.
 *
 * POR QUE ISTO NAO E UM MUTANTE COMO OS OUTROS
 * --------------------------------------------
 * `sem_a_guarda` (RAISE EXCEPTION -> RAISE NOTICE) SOBREVIVE ao teste SQL, e
 * nao por descuido do teste: com a guarda rebaixada a aviso, a migration segue e
 * o `ADD CONSTRAINT recurring_rules_destino_check` falha de todo jeito, porque a
 * linha pre-existente viola o CHECK. O RESULTADO e o mesmo -- a migration
 * aborta. O que muda e so a MENSAGEM, e a mensagem e o unico motivo de a guarda
 * existir: `23514 ... violates check constraint` nao diz qual linha, nem que o
 * conserto e preencher `destination_account_id`, nem que aquela regra e uma
 * transferencia de meia perna.
 *
 * Nenhuma assercao dentro do teste SQL alcanca isso: o teste roda DEPOIS da
 * migration, num banco onde a guarda ja passou. A unica sonda possivel fabrica
 * a linha ruim no template e aplica a migration por cima -- e e o que esta
 * funcao faz. Ver tambem: uma guarda cuja condicao nunca acontece no teste
 * passa verde por nao ter o que conferir.
 */
function provarAGuarda(sql, rotulo) {
  const db = "hmo172_guarda";
  psql("postgres", ["-c", `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`]);
  psql("postgres", ["-c", `CREATE DATABASE ${db} TEMPLATE ${TEMPLATE}`]);
  const arquivo = join(dir, `${db}.sql`);
  writeFileSync(arquivo, sql);
  try {
    // A regra de meia transferencia que a guarda existe para encontrar. Ela
    // CABE no banco antes da 038: `recurring_rules.transaction_type` e o enum
    // do 001_baseline, que tem 'transfer', e nunca houve CHECK ali.
    psql(db, [
      "-c",
      `INSERT INTO auth.users (id, email)
         VALUES ('a1729999-0000-0000-0000-000000000001','guarda@172.local');
       INSERT INTO public.profiles (id, full_name, is_public)
         VALUES ('a1729999-0000-0000-0000-000000000001','Guarda 172', FALSE);
       INSERT INTO public.financial_accounts (id, user_id, name, account_type)
         VALUES ('a1729999-0000-0000-0000-0000000000c1','a1729999-0000-0000-0000-000000000001','Corrente','checking');
       INSERT INTO public.recurring_rules
         (id, user_id, category_id, account_id, description, amount, transaction_type, due_day)
       VALUES ('a1729999-0000-0000-0000-0000000000e1','a1729999-0000-0000-0000-000000000001',
               'b9db286c-ce4f-4fbe-b0bf-f3133185f90f','a1729999-0000-0000-0000-0000000000c1',
               'Reserva de meia perna', 1000.00, 'transfer', 5)`,
    ]);

    let erro = null;
    try {
      psql(db, ["-f", arquivo]);
    } catch (e) {
      erro = String(e.stderr ?? e.message);
    }

    if (!erro) {
      return { ok: false, motivo: "a migration APLICOU sobre uma regra transfer sem destino" };
    }
    // A MENSAGEM TEM DE ESTAR NA LINHA DE *ERROR*, e nao em qualquer lugar da
    // saida. Esta distincao nao e preciosismo: `RAISE NOTICE` imprime o MESMO
    // texto, tambem em stderr, e a primeira versao desta sonda (`erro.includes
    // ("HMO-172")`) dava o mutante por morto lendo o aviso dele -- a sonda
    // passava verde justamente sobre o caso que ela existe para pegar.
    const temErroDaGuarda = erro
      .split("\n")
      .some((l) => l.includes("ERROR") && l.includes("HMO-172"));
    if (!temErroDaGuarda) {
      // Aborta, mas com o 23514 cru: quem aplicar em producao nao sabe o que
      // fazer com ele.
      return {
        ok: false,
        motivo: `abortou sem a mensagem da guarda -> ${erro.trim().split("\n").slice(-2).join(" | ")}`,
      };
    }
    return { ok: true };
  } finally {
    try {
      psql("postgres", ["-c", `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`]);
    } catch {
      /* idem */
    }
  }
}

let falhou = false;

try {
  // CONTROLE POSITIVO. Sem ele, um template quebrado faria todo mutante
  // "morrer" e o placar sairia cheio sem que o teste tivesse medido nada.
  const controle = rodar("hmo172_mut_controle", original);
  if (!controle.verde) {
    console.error(`CONTROLE FALHOU: a 038 intacta nao passa no teste -> ${controle.saida}`);
    console.error("O template esta errado, ou a migration quebrou. Placar abaixo nao vale.");
    falhou = true;
  } else {
    console.log("controle: a 038 intacta passa no teste  OK\n");
  }

  let mortos = 0;
  for (const m of MUTANTES) {
    if (!original.includes(m.de)) {
      // Mutante que nao se aplica e o pior resultado possivel: ele conta como
      // "morreu" sem nunca ter existido.
      console.error(`NAO APLICOU: ${m.nome} -- o trecho procurado nao esta na 038`);
      falhou = true;
      continue;
    }
    const mutada = m.todas
      ? original.replaceAll(m.de, m.para)
      : original.replace(m.de, m.para);
    const r = rodar(`hmo172_mut_${m.nome}`, mutada);
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

  // A guarda, provada a parte (ver provarAGuarda). Duas corridas: a 038 intacta
  // tem de abortar COM a mensagem, e a versao com a guarda rebaixada a NOTICE
  // tem de ser pega -- ela aborta tambem, mas sem dizer o que fazer.
  console.log("\nguarda do passo 1 (sobre uma regra transfer pre-existente):");
  const guardaBoa = provarAGuarda(original, "intacta");
  if (guardaBoa.ok) {
    console.log("  ok:         a 038 intacta aborta com a mensagem da HMO-172");
  } else {
    console.error(`  FALHOU:     a 038 intacta -> ${guardaBoa.motivo}`);
    falhou = true;
  }

  const semGuarda = original.replace(
    "    RAISE EXCEPTION\n      'HMO-172: ha % regra(s)",
    "    RAISE NOTICE\n      'HMO-172: ha % regra(s)"
  );
  const guardaMutada = provarAGuarda(semGuarda, "rebaixada a NOTICE");
  if (guardaMutada.ok) {
    console.error(
      "  SOBREVIVEU: com a guarda rebaixada a NOTICE a mensagem da HMO-172 ainda aparece -- a sonda nao esta medindo a guarda"
    );
    falhou = true;
  } else {
    console.log(`  morreu:     guarda rebaixada a NOTICE (${guardaMutada.motivo})`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exitCode = falhou ? 1 : 0;
