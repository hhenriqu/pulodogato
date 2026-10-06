#!/usr/bin/env node
// Mutantes da migration 040 (a trava de percentual e papel do membro) -- HMO-268.
//
// POR QUE ISTO EXISTE
// -------------------
// `040_trava_de_percentual_e_papel_do_membro_test.sql` passa com 32 assercoes
// verdes. Isso, sozinho, nao diz nada -- e nesta migration menos do que nas
// outras, porque o teste dela e um teste de RECUSA, e teste de recusa e o que
// mais facilmente passa vazio. A policy de UPDATE de `group_members` descarta
// linha em SILENCIO (`UPDATE 0`, sem erro), entao um arquivo que so conferisse
// "o percentual nao mudou" ficaria verde com trigger nenhum instalado. Cada
// mutante abaixo afrouxa UMA decisao da 040; o teste tem que ficar vermelho em
// todos.
//
// O MUTANTE QUE MOTIVOU ESTE ARQUIVO
// -----------------------------------
// `igualdade_simples_no_percentual` nao e teorico: ele SOBREVIVEU a primeira
// versao do teste, com os 31 "ok" no terminal. Ele troca
// `NEW.percentage IS DISTINCT FROM OLD.percentage` por `<>`, e `percentage` e a
// unica das quatro colunas que aceita nulo (001:1215 -- `numeric(5,2)
// DEFAULT 0.00`, sem NOT NULL). Com `<>`, comparar 50.00 com NULL da NULL, que
// nao e TRUE: o IF nao entra e a guarda passa ao largo. Medido no banco da
// cadeia 001..039 + 040 mutada, como `authenticated`: o membro comum manda
// `{"percentage": null}` no lugar do `0.01` que o teste tentava, o `UPDATE`
// volta `UPDATE 1`, e o peso dele vira nulo de verdade. A trava fechava a porta
// da frente e deixava a lateral aberta, e o placar nao tinha como dizer isso --
// as sete tentativas do teste mandavam todas um NUMERO.
//
// A assercao que o mata ('B anulando o proprio percentual') entrou na SECAO 2
// por causa deste mutante. E a razao de o runner existir: o buraco nao estava
// na migration, estava na medida.
//
// OS MUTANTES DELIBERADAMENTE DEIXADOS DE FORA
// ---------------------------------------------
// Trocar `IS DISTINCT FROM` por `<>` nas outras TRES colunas nao entra na lista,
// e nao e esquecimento: `group_id`, `user_id` e `role` sao NOT NULL (conferido
// no catalogo, nao no 001 -- `information_schema.columns`), entao nenhum dos
// dois lados da comparacao pode ser nulo e os dois operadores sao o MESMO
// predicado. Seriam mutantes equivalentes: sobreviveriam, e sobreviver estaria
// CERTO. Mutante sobrevivente que esta certo polui o placar e faz o proximo
// leitor "consertar" uma guarda que nunca esteve quebrada.
//
// `is_group_admin(OLD.group_id)` -> `NEW.group_id` na guarda de `role` tambem
// fica de fora, pelo mesmo motivo e com a mesma honestidade: o grupo da linha
// ja esta congelado pela guarda de cima, entao quando a execucao chega ali os
// dois sao iguais por construcao. `OLD` esta no arquivo por clareza e para
// continuar certo se o congelamento do grupo um dia sair -- nao por
// comportamento de hoje.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria e escrita num arquivo TEMPORARIO; o
// `database/migrations/040_*.sql` nao e tocado em momento nenhum. O jeito usual
// (mutar o arquivo, rodar, restaurar no `finally`) deixa a fonte mutada no disco
// quando o processo morre no meio -- e o placar seguinte vira ficcao.
//
// COMO RODAR
//   1. Monte o banco-template com a cadeia ATE A 039 (SEM a 040) -- a mesma
//      sequencia de `$PSQL -f` do .github/workflows/db-verify.yml, parando
//      antes da 040. O template NAO pode conter a 040: ela e
//      `CREATE OR REPLACE FUNCTION` mais `DROP TRIGGER IF EXISTS`, entao
//      aplicar um mutante sobre um banco que ja tem a versao boa REESCREVE a
//      funcao -- o mutante pegaria, mas o controle negativo e que denuncia um
//      template montado errado.
//   2. PG_TEMPLATE=<nome do template> npm run mutantes:trava-de-membro
//
// O proprio script checa isso: o CONTROLE NEGATIVO roda o teste contra o
// template CRU, sem a 040, e exige que ele REPROVE.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PG = process.env.PG_URL_BASE ?? "postgresql://postgres:postgres@127.0.0.1:5432";
const TEMPLATE = process.env.PG_TEMPLATE ?? "hmo268_base";
const MIGRATION = "database/migrations/040_trava_de_percentual_e_papel_do_membro.sql";
const TESTE = "database/tests/040_trava_de_percentual_e_papel_do_membro_test.sql";

const psql = (db, args) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-q", `${PG}/${db}`, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" },
  });

const original = readFileSync(MIGRATION, "utf8");

// ---------------------------------------------------------------------------
// Os trechos exatos da 040 que os mutantes trocam.
// ---------------------------------------------------------------------------

const GUARDA_PERCENTUAL = `  IF NEW.percentage IS DISTINCT FROM OLD.percentage
     AND NOT public.is_group_admin(OLD.group_id) THEN
    RAISE EXCEPTION
      'so um admin do grupo muda o percentual de divisao do membro (era %, veio %)',
      OLD.percentage, NEW.percentage
      USING ERRCODE = '42501';
  END IF;`;

const GUARDA_PAPEL = `  IF NEW.role IS DISTINCT FROM OLD.role
     AND NOT public.is_group_admin(OLD.group_id) THEN
    RAISE EXCEPTION
      'so um admin do grupo muda o papel do membro (era %, veio %)',
      OLD.role, NEW.role
      USING ERRCODE = '42501';
  END IF;`;

const GUARDA_GRUPO = `  IF NEW.group_id IS DISTINCT FROM OLD.group_id THEN
    RAISE EXCEPTION
      'linha de group_members nao troca de grupo: entre no outro grupo em vez de mudar esta (era %, veio %)',
      OLD.group_id, NEW.group_id
      USING ERRCODE = '42501';
  END IF;`;

const GUARDA_PESSOA = `  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION
      'linha de group_members nao troca de pessoa: adicione o outro membro em vez de mudar esta (era %, veio %)',
      OLD.user_id, NEW.user_id
      USING ERRCODE = '42501';
  END IF;`;

const SAIDA_SEM_CLAIM = `  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;`;

const CRIA_TRIGGER = `CREATE TRIGGER trg_group_members_guard
  BEFORE UPDATE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.group_members_guard();`;

const MUTANTES = [
  {
    nome: "igualdade_simples_no_percentual",
    porque:
      "O MUTANTE QUE JA SOBREVIVEU UMA VEZ: `percentage` e nullable, entao com `<>` a comparacao com NULL da NULL, o IF nao entra, e o membro comum zera o proprio peso mandando `{\"percentage\": null}` em vez de 0.01. Quem o mata e a assercao 'B anulando o proprio percentual' da SECAO 2 -- sem ela o placar fica verde com a porta lateral aberta",
    de: "  IF NEW.percentage IS DISTINCT FROM OLD.percentage",
    para: "  IF NEW.percentage <> OLD.percentage",
  },
  {
    nome: "sem_guarda_de_percentual",
    porque:
      "a entrega principal da issue: sem ela o membro comum escreve o proprio peso do rateio e 'eu pago 0,01% do aluguel' volta a funcionar na fase 4",
    de: GUARDA_PERCENTUAL,
    para: "  -- guarda de percentual removida pelo mutante",
  },
  {
    nome: "sem_guarda_de_papel",
    porque:
      "`role` nao espera a fase 4: a guarda de 'so admin promove' mora na rota, nao no banco. Sem esta, o membro vira admin do grupo HOJE e ganha as policies de admin em expense_groups e group_transactions",
    de: GUARDA_PAPEL,
    para: "  -- guarda de papel removida pelo mutante",
  },
  {
    nome: "sem_congelar_o_grupo",
    porque:
      "a porta que encadeia com a de cima: travar `role` nao basta se a linha pode se mudar para outro `group_id` levando o papel que ja tem. O membro comum entra num grupo que nunca o convidou e le as despesas de la",
    de: GUARDA_GRUPO,
    para: "  -- congelamento de grupo removido pelo mutante",
  },
  {
    nome: "sem_congelar_a_pessoa",
    porque:
      "a linha de group_members troca de dono mantendo o `id` que group_expense_splits e group_member_proportions referenciam por FK: a participacao de alguem vira a participacao de outro, com o historico de partes preso no meio",
    de: GUARDA_PESSOA,
    para: "  -- congelamento de pessoa removido pelo mutante",
  },
  {
    nome: "percentual_so_para_baixo",
    porque:
      "a trava pela metade com cara de trava inteira: num grupo de dois, SUBIR o proprio peso e o jeito de baixar o do outro sem tocar na linha dele. A soma e que vira dinheiro, e ela nao mora em nenhuma das duas linhas",
    de: "  IF NEW.percentage IS DISTINCT FROM OLD.percentage\n     AND NOT public.is_group_admin(OLD.group_id) THEN",
    para: "  IF NEW.percentage < OLD.percentage\n     AND NOT public.is_group_admin(OLD.group_id) THEN",
  },
  {
    nome: "trava_vale_para_todos_inclusive_admin",
    porque:
      "sem o ramo do admin ninguem configura a divisao do grupo -- a feature da fase 4 nasce inacessivel. E o controle positivo da trava: prova que o teste mede o caminho que tem de CONTINUAR funcionando, nao so o que tem de falhar",
    de: GUARDA_PERCENTUAL,
    para: `  IF NEW.percentage IS DISTINCT FROM OLD.percentage THEN
    RAISE EXCEPTION
      'so um admin do grupo muda o percentual de divisao do membro (era %, veio %)',
      OLD.percentage, NEW.percentage
      USING ERRCODE = '42501';
  END IF;`,
  },
  {
    nome: "admin_invertido",
    porque:
      "`NOT is_group_admin` -> `is_group_admin`: a trava fica de cabeca para baixo, recusando exatamente quem pode e liberando exatamente quem nao pode. Passa em qualquer teste que so conte 'houve erro'",
    de: "  IF NEW.percentage IS DISTINCT FROM OLD.percentage\n     AND NOT public.is_group_admin(OLD.group_id) THEN",
    para: "  IF NEW.percentage IS DISTINCT FROM OLD.percentage\n     AND public.is_group_admin(OLD.group_id) THEN",
  },
  {
    nome: "saida_sem_claim_invertida",
    porque:
      "`IS NULL` -> `IS NOT NULL`: a sessao do app passa direto e a do backend e a unica barrada. O trigger fica com a aparencia de guarda e o comportamento de enfeite",
    de: SAIDA_SEM_CLAIM,
    para: `  IF auth.uid() IS NOT NULL THEN
    RETURN NEW;
  END IF;`,
  },
  {
    nome: "sem_saida_sem_claim",
    porque:
      "o oposto do de cima: sem o atalho, `auth.uid()` nulo cai nas guardas, `is_group_admin(...)` da FALSE, e o backend (service_role, cron, psql) perde a correcao de cadastro de membro e o backfill. E o mutante que quebra deploy em vez de seguranca",
    de: SAIDA_SEM_CLAIM,
    para: "  -- atalho de sessao sem claim removido pelo mutante",
  },
  {
    nome: "trigger_depois_em_vez_de_antes",
    porque:
      "AFTER UPDATE no lugar de BEFORE. A escrita ja aconteceu quando o RAISE sobe; aqui ainda desfaz pela transacao, mas a guarda deixa de ser guarda e passa a depender de quem a chama estar numa transacao que aborta junto",
    de: CRIA_TRIGGER,
    para: `CREATE TRIGGER trg_group_members_guard
  AFTER UPDATE ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.group_members_guard();`,
  },
  {
    nome: "trigger_so_no_insert",
    porque:
      "BEFORE INSERT no lugar de BEFORE UPDATE: o trigger existe, aparece em `pg_trigger`, e nao olha nenhum UPDATE. E o mutante que uma assercao de PRESENCA ('o trigger esta instalado') deixa passar -- a 040 confere tgtype no proprio arquivo por causa dele",
    de: CRIA_TRIGGER,
    para: `CREATE TRIGGER trg_group_members_guard
  BEFORE INSERT ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.group_members_guard();`,
  },
  {
    nome: "sem_trigger",
    porque:
      "a funcao entra e o trigger nao: `CREATE OR REPLACE FUNCTION` sai verde, a migration 'aplicou', e nada dispara. O bloco de prova no fim da 040 existe para este caso",
    de: CRIA_TRIGGER,
    para: "-- CREATE TRIGGER removido pelo mutante",
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

const dir = mkdtempSync(join(tmpdir(), "mutantes-hmo268-"));

try {
  // CONTROLE NEGATIVO. Sem a 040, o teste tem de REPROVAR. Ele e o que detecta
  // o template montado com a migration dentro -- o erro que faz todo mutante
  // "morrer" sem que nada tenha sido medido.
  const negativo = rodar(dir, "hmo268_mut_negativo", null);
  if (negativo.verde) {
    console.error("CONTROLE NEGATIVO FALHOU: o teste da 040 passa num banco SEM a 040 aplicada.");
    console.error(
      `O template '${TEMPLATE}' provavelmente ja contem a 040 (ou o teste nao mede nada). Placar abaixo nao vale.`,
    );
    falhou = true;
  } else {
    console.log("controle negativo: sem a 040 o teste reprova  OK");
  }

  // CONTROLE POSITIVO. E o unico controle que pega erro de script no proprio
  // caminho da mutacao: com ele vermelho, todo mutante "morre" de graca e o
  // placar sai cheio sem ter medido nada.
  const positivo = rodar(dir, "hmo268_mut_controle", original);
  if (!positivo.verde) {
    console.error(`CONTROLE POSITIVO FALHOU: a 040 intacta nao passa no teste -> ${positivo.saida}`);
    console.error("O template esta errado, ou a migration quebrou. Placar nenhum vale, e por isso nao sai nenhum.");
    process.exitCode = 1;
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  }
  console.log("controle positivo: a 040 intacta passa no teste  OK\n");

  let mortos = 0;
  for (const m of MUTANTES) {
    // Mutante que nao se aplica e o pior resultado possivel: ele conta como
    // "morreu" sem nunca ter existido. As duas travas, antes e depois.
    const ocorrencias = original.split(m.de).length - 1;
    if (ocorrencias !== 1) {
      console.error(`NAO APLICOU: ${m.nome} -- o trecho procurado aparece ${ocorrencias}x na 040 (esperado: 1)`);
      falhou = true;
      continue;
    }
    const mutado = original.replace(m.de, m.para);
    if (mutado === original) {
      console.error(`NAO MUTOU: ${m.nome} -- a substituicao nao mudou o arquivo`);
      falhou = true;
      continue;
    }

    const r = rodar(dir, `hmo268_mut_${m.nome}`, mutado);
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
