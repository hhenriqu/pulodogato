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

// =====================================================
// A SEGUNDA METADE DESTE ARQUIVO (HMO-289): OS MUTANTES DO TYPESCRIPT
// =====================================================
// A PR 1 pos a coluna e a view; a PR 2 ligou o app nelas. Os mutantes da
// migration acima nao alcancam nada disso: eles mutam SQL e medem o teste SQL.
//
// POR QUE OS DOIS CONJUNTOS MORAM NO MESMO ARQUIVO, COM MODOS SEPARADOS
// ----------------------------------------------------------------------
// A issue pediu que os mutantes da fiacao entrassem "no
// scripts/mutantes-fatura-escolhida.mjs da PR 1", e a feature e uma so -- quem
// mexer na 041 tem de ver os dois placares no mesmo lugar. Mas os dois precisam
// de coisas diferentes: a parte SQL exige um Postgres com um template montado a
// mao, e a parte TypeScript nao precisa de banco nenhum.
//
// Juntar sem separar seria o pior dos dois: a parte TypeScript ficaria inacessivel
// em CI (que nao tem o template) e o placar sairia pela metade com cara de
// inteiro. Por isso os MODOS sao explicitos, e nenhum deles PULA nada em
// silencio:
//
//   npm run mutantes:fatura-escolhida                 # os dois (exige Postgres)
//   npm run mutantes:fatura-escolhida -- --so-typescript   # so a fiacao, sem banco
//   npm run mutantes:fatura-escolhida -- --so-sql         # so a migration
//
// O `--so-typescript` e o que roda em CI.
// =====================================================

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ARGS = process.argv.slice(2);
const SO_TYPESCRIPT = ARGS.includes("--so-typescript");
const SO_SQL = ARGS.includes("--so-sql");

if (SO_TYPESCRIPT && SO_SQL) {
  console.error("--so-typescript e --so-sql sao exclusivos.");
  process.exit(2);
}

const RODAR_TYPESCRIPT = !SO_SQL;
const RODAR_SQL = !SO_TYPESCRIPT;

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

/**
 * Roda a suite num banco novo feito do template, com `sql` no lugar da 041.
 *
 * `dir` chega por PARAMETRO de proposito. Quando ele era lido do escopo de fora,
 * um `const dir` declarado dentro de `rodarMutantesDaMigration` nao alcancava
 * aqui: toda chamada com `sql !== null` estourava `dir is not defined`, o `catch`
 * abaixo engolia o ReferenceError como se fosse o teste reprovando, e os 10
 * mutantes "morriam" todos pelo erro de script -- placar 10/10 sem ter medido
 * nada. Quem denunciou foi o controle positivo (o unico caso com `sql !== null`
 * que DEVIA ficar verde); o controle negativo passa `null`, nao tocava no `dir` e
 * ficava verde-de-verdade, escondendo metade do sintoma.
 */
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

let falhou = false;

/**
 * A METADE SQL: muta a 041 e mede o teste da 041.
 *
 * Exige um Postgres com o template montado -- e por isso que ela e opcional.
 * Ver o cabecalho sobre os modos.
 */
function rodarMutantesDaMigration() {
  const dir = mkdtempSync(join(tmpdir(), "mutantes-hmo288-"));

  try {
    // CONTROLE NEGATIVO. Sem a 041, o teste tem de REPROVAR. Ele e o que detecta
    // o erro de montagem que estraga todo o resto: um template que JA tem a 041
    // faz cada mutante virar no-op (`IF NOT EXISTS`) e o placar sai 10/10 sem que
    // nada tenha sido medido.
    const negativo = rodar(dir, "hmo288_mut_negativo", null);
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
    const positivo = rodar(dir, "hmo288_mut_controle", original);
    if (!positivo.verde) {
      console.error(`CONTROLE POSITIVO FALHOU: a 041 intacta nao passa no teste -> ${positivo.saida}`);
      console.error("O template esta errado, ou a migration quebrou. Placar nenhum vale, e por isso nao sai nenhum.");
      falhou = true;
      // SAIR AQUI, e nao seguir medindo. Imprimir "SQL: 10/10 mutantes mortos"
      // logo embaixo de "placar nao vale" e pior do que nao imprimir: o placar
      // e o que se le, o aviso e o que se pula. Foi assim que o `dir is not
      // defined` acima sobreviveu um run inteiro -- com os 10 mutantes mortos
      // pelo erro de script, debaixo do aviso de que nada aquilo valia.
      // A metade TypeScript ja faz isto (o `return` do controle positivo dela).
      return;
    }
    console.log("controle positivo: a 041 intacta passa no teste  OK\n");

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

      const r = rodar(dir, `hmo288_mut_${m.nome}`, mutado);
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
}

// ===========================================================================
// A METADE TYPESCRIPT (HMO-289): A FIACAO DOS QUATRO ESCRITORES
// ===========================================================================
// Aqui a fonte E mutada no disco -- ao contrario da metade SQL, onde a mutacao
// vai para um arquivo temporario. Nao ha escolha: os oraculos sao `npm run
// test:*` e `check-fatura-no-lancamento.mjs`, e os dois leem os caminhos reais do
// repositorio. Por isso o restauro e conferido byte a byte depois de CADA
// mutante, e um restauro que falhe PARA o script na hora: seguir em frente
// mediria os mutantes seguintes contra uma arvore ja estragada, e -- pior --
// deixaria o mutante commitavel no worktree.
//
// POR QUE OS ORACULOS SAO DIFERENTES ENTRE SI
// --------------------------------------------
// Nenhum `tsc` mata nenhum destes mutantes: todos os cinco COMPILAM. Trocar
// `faturaDaEntrada(entrada)` por `null` e um `string | null` onde se espera
// `string | null`. Essa e a razao de a HMO-289 ter um guard de fiacao, e e a
// razao de estes mutantes existirem -- eles sao o que mede se o guard mede.
//
// Tres mutantes sao medidos pelo GUARD e dois por SUITES DE TESTE, e a divisao
// nao e arbitraria: onde ha funcao pura para chamar (a fila offline, a
// aritmetica da ancora), o teste e o oraculo mais forte, porque ele reprova
// pelo VALOR errado e nao pela ausencia do texto. Onde o codigo so existe
// dentro de um componente React ou de uma rota (o insert, a ancora da rota), o
// guard e o unico oraculo que alcanca.

const ARQUIVO_CAMPOS = "components/movimentacoes/CamposDeLancamento.tsx";
const ARQUIVO_FORM = "components/movimentacoes/FormularioDeLancamento.tsx";
const ARQUIVO_FILA = "lib/offline-queue.ts";
const ARQUIVO_ROTA = "app/api/financial-installments/route.ts";
const ARQUIVO_LANC = "lib/lancamento.ts";

const GUARD = [process.execPath, ["scripts/check-fatura-no-lancamento.mjs"]];
const TESTE_FILA = ["npm", ["run", "test:offline-queue"]];
const TESTE_LANC = ["npm", ["run", "test:lancamento"]];

const MUTANTES_TS = [
  // ---------------------------------------------------------------------
  // O SELETOR (CamposDeLancamento.tsx). Ele era o unico arquivo ligado por
  // esta PR com ZERO mutante: o guard afirma sobre ele -- `janelaDeFaturas(`
  // e `mesDaFatura: e.target.value` -- e nada media se essas duas exigencias
  // mordem. Guard cuja assercao nunca foi vista reprovar e guard que pode
  // estar casando com outra linha do arquivo.
  //
  // Os dois mutantes abaixo sao as duas metades de um seletor inutil: um que
  // nao devolve a escolha, e um que nao tem o que escolher.
  // ---------------------------------------------------------------------
  {
    nome: "seletor_nao_devolve_a_escolha",
    arquivo: ARQUIVO_CAMPOS,
    oraculo: GUARD,
    porque:
      "O SELETOR DECORATIVO. Sem o `onChange`, o `<select>` nativo ainda ABRE, " +
      "ainda lista os meses certos e o cursor ainda troca de linha -- mas o " +
      "`value` volta de `valores.mesDaFatura`, que nunca muda. A pessoa escolhe " +
      "a fatura, o campo visualmente nao obedece, e o que grava e o padrao. " +
      "Nenhuma suite pura alcanca: `camposDoTipo` continua dizendo que o campo " +
      "devia aparecer, e ele aparece",
    de: "                onChange={(e) => aoMudar({ mesDaFatura: e.target.value })}\n",
    para: "",
  },
  {
    nome: "janela_vira_lista_vazia",
    arquivo: ARQUIVO_CAMPOS,
    oraculo: GUARD,
    porque:
      "A CHAMADA MORTA COM O `import` INTACTO -- o caso que o cabecalho do guard " +
      "usa para justificar o `(` em cada nome de funcao. Trocar a janela por `[]` " +
      "deixa so a opcao vazia ('Pela data da compra'): a feature desaparece da " +
      "tela e `janelaDeFaturas` continua importado e continua 'aparecendo' no " +
      "arquivo. O `tsc` concorda -- `[]` e um `string[]` onde se espera `string[]`",
    de: "                {janelaDeFaturas(mesPadraoDaFatura, valores.mesDaFatura).map(",
    para: "                {([] as string[]).map(",
  },
  {
    nome: "insert_sem_o_campo",
    arquivo: ARQUIVO_FORM,
    oraculo: GUARD,
    porque:
      "O MUTANTE QUE A ISSUE PEDIU PRIMEIRO. Sem o campo no objeto `linha`, a " +
      "pessoa escolhe a fatura, a tela diz 'salvo' e a coluna fica NULA: a " +
      "compra cai na fatura da data. O `tsc` nao ve -- a chave e opcional no " +
      "insert -- e nenhum teste de funcao pura chega ate aqui",
    de: `      invoice_month_override:
        campos.faturaDoLancamento && valores.mesDaFatura
          ? \`\${valores.mesDaFatura}-01\`
          : null,`,
    para: "",
  },
  {
    nome: "campo_sai_undefined",
    arquivo: ARQUIVO_FORM,
    oraculo: GUARD,
    porque:
      "DEFEITO DE UMA PALAVRA: `undefined` no lugar de `null`. O supabase-js " +
      "OMITE a chave `undefined` do corpo, e coluna omitida num UPDATE fica " +
      "como esta -- entao DESFAZER uma escolha errada passa a ser impossivel, " +
      "com o toast de sucesso aparecendo do mesmo jeito. Grava igual, apaga nunca",
    de: `          : null,
    };`,
    para: `          : undefined,
    };`,
  },
  {
    nome: "data_da_compra_vira_o_mes",
    arquivo: ARQUIVO_FORM,
    oraculo: GUARD,
    porque:
      "O CAMINHO QUE O PLANO RECUSOU (secao 2.1, caminho B): gravar dia 1 do " +
      "mes escolhido em `transaction_date`. Ele POE a compra na fatura certa -- " +
      "e por isso que sobrevive a qualquer teste de fatura -- e apaga um fato: " +
      "quebra `expected_date`/'pagou atrasado?' (027), move a despesa de mes em " +
      "todo relatorio que agrupa por data, e mostra a compra num dia em que ela " +
      "nao aconteceu",
    de: "      transaction_date: valores.data,",
    para:
      "      transaction_date: valores.mesDaFatura\n" +
      "        ? `${valores.mesDaFatura}-01`\n" +
      "        : valores.data,",
  },
  {
    nome: "fila_offline_perde_a_fatura",
    arquivo: ARQUIVO_FILA,
    oraculo: TESTE_FILA,
    porque:
      "O ESCRITOR MUDO. O lancamento sem rede sincroniza, e ACEITO, vira linha " +
      "valida e cai na fatura da data -- sem erro, sem item `falhou`, sem nada " +
      "na tela. O campo continua existindo na linha, entao nem o `tsc` nem uma " +
      "sonda de 'o campo esta la?' notam: o que muda e so o VALOR",
    de: "    invoice_month_override: faturaDaEntrada(entrada),",
    para: "    invoice_month_override: null,",
  },
  {
    nome: "ancora_da_rota_ignora_o_override",
    arquivo: ARQUIVO_ROTA,
    oraculo: GUARD,
    porque:
      "A rota carimba o override na parcela 1 e conta as outras a partir da " +
      "fatura da DATA. Serie de 10 com a primeira numa fatura e as nove " +
      "seguintes a partir de outra -- e, no caso do fechamento dia 30 com " +
      "compra em 31/01, a 2a cai JUNTO da 1a e a serie termina um mes antes.\n" +
      "            O esquecimento REAL e este: carimbar o override na parcela 1 " +
      "(que e a parte visivel) e nunca ligar a ancora",
    // O ramo some e a RPC passa a valer sempre; as chaves continuam fechando,
    // entao o mutante COMPILA -- que e o ponto.
    //
    // UM MUTANTE QUE EU TENTEI E NAO MANTIVE: trocar a condicao por
    // `if (false)`, deixando `mesAncora = faturaEscolhida` escrito mas morto.
    // Ele SOBREVIVE, e sobreviver esta correto: um guard textual nao distingue
    // codigo vivo de codigo morto em volta do texto certo, e nenhuma mudanca
    // razoavel no guard mudaria isso. Mante-lo seria um vermelho permanente que
    // nao aponta para conserto nenhum. O que cobre esse flanco e o mutante
    // seguinte, que mede a ARITMETICA da ancora por valor, num teste de verdade.
    de: `    if (faturaEscolhida) {
      mesAncora = faturaEscolhida;
    } else {`,
    para: "    {",
  },
  {
    nome: "parcelas_contadas_da_data_da_compra",
    arquivo: ARQUIVO_LANC,
    oraculo: TESTE_LANC,
    porque:
      "A VERSAO QUASE-CERTA, e a mais cara: contar as parcelas somando meses a " +
      "DATA DA COMPRA em vez de a ancora. Somar um mes a uma data NAO soma um " +
      "mes a fatura quando o dia e grampeado pelo fim do mes -- 31/01 e 28/02 " +
      "caem na MESMA fatura num cartao que fecha dia 30. Dobra uma fatura, " +
      "esvazia a ultima, e nao aparece como erro: aparece como um mes caro",
    de: "    const mes = somaMeses(mesDaFaturaAncora, k);",
    para: "    const mes = somaMeses(dataDaCompra, k);",
  },
];

/** Roda um oraculo. Verde = passou (exit 0). */
function rodarOraculo([cmd, args]) {
  const r = spawnSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return {
    verde: r.status === 0,
    saida: String(r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" | "),
  };
}

function rodarMutantesDaFiacao() {
  // O conteudo intacto de cada arquivo, lido UMA vez. E ele que restaura, e e
  // contra ele que o restauro e conferido.
  const intactos = new Map();
  for (const m of MUTANTES_TS) {
    if (!intactos.has(m.arquivo)) intactos.set(m.arquivo, readFileSync(m.arquivo, "utf8"));
  }

  // CONTROLE POSITIVO, UM POR ORACULO DISTINTO. Sem ele, um oraculo que ja
  // estivesse vermelho por outro motivo faria TODO mutante "morrer", e o placar
  // sairia cheio sem ter medido nada. E o mesmo papel do controle positivo da
  // metade SQL.
  const oraculos = new Map();
  for (const m of MUTANTES_TS) oraculos.set(m.oraculo[1].join(" "), m.oraculo);

  for (const [nome, oraculo] of oraculos) {
    const r = rodarOraculo(oraculo);
    if (!r.verde) {
      console.error(`CONTROLE POSITIVO FALHOU: '${nome}' ja reprova na arvore INTACTA -> ${r.saida}`);
      console.error("Placar abaixo nao vale: um oraculo ja vermelho mata todo mutante de graca.");
      falhou = true;
      return;
    }
    console.log(`controle positivo: '${nome}' passa na arvore intacta  OK`);
  }
  console.log("");

  let mortos = 0;

  for (const m of MUTANTES_TS) {
    const intacto = intactos.get(m.arquivo);

    // AS DUAS TRAVAS DO MUTANTE QUE NAO SE APLICA, iguais as da metade SQL.
    // A primeira e mais importante aqui do que la: estes alvos sao codigo que a
    // propria PR escreveu, e qualquer reescrita posterior de uma linha dessas
    // faz o `de` deixar de casar. Sem a trava, o mutante viraria no-op, o
    // oraculo ficaria verde e o placar leria "SOBREVIVEU" -- um alarme falso --
    // ou, com a logica invertida, "morreu" sem nunca ter existido.
    const ocorrencias = intacto.split(m.de).length - 1;
    if (ocorrencias !== 1) {
      console.error(
        `NAO APLICOU: ${m.nome} -- o trecho procurado aparece ${ocorrencias}x em ${m.arquivo} (esperado: 1)`
      );
      falhou = true;
      continue;
    }

    const mutado = intacto.replace(m.de, m.para);
    if (mutado === intacto) {
      console.error(`NAO MUTOU: ${m.nome} -- a substituicao nao mudou o arquivo`);
      falhou = true;
      continue;
    }

    let r;
    try {
      writeFileSync(m.arquivo, mutado);
      r = rodarOraculo(m.oraculo);
    } finally {
      writeFileSync(m.arquivo, intacto);

      // O RESTAURO E CONFERIDO, e a falha dele e FATAL. Um `finally` que
      // escreve nao prova que escreveu: se o restauro nao bater byte a byte, o
      // worktree esta com o mutante dentro e tudo depois disto e ficcao.
      if (readFileSync(m.arquivo, "utf8") !== intacto) {
        console.error(`\nRESTAURO FALHOU em ${m.arquivo} apos o mutante '${m.nome}'.`);
        console.error("O worktree esta MUTADO. Rode `git checkout --` nesse arquivo antes de qualquer coisa.");
        process.exit(3);
      }
    }

    if (r.verde) {
      console.error(`SOBREVIVEU: ${m.nome}  (${m.oraculo[1].join(" ")})`);
      console.error(`            ${m.porque}`);
      falhou = true;
    } else {
      mortos++;
      console.log(`morreu:     ${m.nome}  (${m.oraculo[1].join(" ")})`);
    }
  }

  console.log(`\nTypeScript: ${mortos}/${MUTANTES_TS.length} mutantes mortos`);
}

if (RODAR_SQL) rodarMutantesDaMigration();
if (RODAR_TYPESCRIPT) rodarMutantesDaFiacao();

process.exitCode = falhou ? 1 : 0;
