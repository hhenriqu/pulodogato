#!/usr/bin/env node
// Prova de mutacao da 049 (HMO-347). Cada entrada estraga UMA decisao da
// migration; o database/tests/049_consumo_de_orcamento_do_grupo_test.sql tem de
// ficar VERMELHO em todas. Mutante que sobrevive e uma decisao que nenhuma
// assercao distingue -- ou codigo morto.
//
//   PGURL=postgresql://postgres:postgres@127.0.0.1:5432 node scripts/mutantes-consumo-de-orcamento-do-grupo.mjs
//
// POR QUE ESTE RUNNER EXISTE, TENDO O DA 046
// ------------------------------------------
// `mutantes-um-criterio-de-custo-pessoal.mjs` prova que a suite da 046
// distingue as decisoes da 046 -- nas views `personal_category_monthly_totals`
// e `group_share_category_monthly_totals`. A 049 aplica o MESMO criterio a uma
// view DIFERENTE (`budget_consumption`) e por um caminho diferente: ela nao le
// o rollup da 046, ela recorta `group_share_entries` por categoria e mes e
// converte a moeda. Nenhum mutante da 046 toca uma linha deste arquivo, e o
// cabecalho da 049 explica por que ela nao pode simplesmente ler a view da 046
// (o grao por moeda da 022).
//
// POR QUE UM BANCO-TEMPLATE, E POR QUE ELE PARA NA 048
// ---------------------------------------------------
// A cadeia 001 -> 048 sobe UMA vez num template e cada mutante sai de
// `CREATE DATABASE ... TEMPLATE` -- copia de arquivo, fracao de segundo, em vez
// de ~40s de cadeia por mutante.
//
// O template NAO TEM a 049, de proposito: se tivesse, cada mutante seria um
// `CREATE OR REPLACE VIEW` por cima da versao BOA, e o placar seria ficcao.
// E isso NAO se mede pela existencia da view -- `budget_consumption` existe
// desde o 006. `montarTemplate` mede o que a 049 muda: se a definicao no
// catalogo ja le `group_share_entries`, o template esta contaminado.
//
// "001 -> 048" e uma REGRA sobre o numero (`< ALVO_NUM`), e nao
// `!f.startsWith("049_")`. Essa diferenca nao e estetica: foi exatamente ela
// que quebrou o runner da 033 quando a 045 entrou na arvore -- "tudo menos a
// 033" incluia a 045, cujo preflight aborta sem as views da 033, e o runner
// morria antes do primeiro mutante com erro de psql em vez de placar. Com a
// regra do numero, a migration 050 de amanha entra no template sozinha.
import { readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const BASE = process.env.PGURL || "postgresql://postgres:postgres@127.0.0.1:5432";
const ALVO = "database/migrations/049_consumo_de_orcamento_do_grupo.sql";
const TESTE = "database/tests/049_consumo_de_orcamento_do_grupo_test.sql";
const TEMPLATE = `tpl_049_${process.pid}`;

const ALVO_NUM = 49;

const original = readFileSync(ALVO, "utf8");

// As ancoras. Cada uma leva indentacao e o `AND`/`SUM(` colado para NAO casar
// com a prosa do cabecalho, que repete estes mesmos trechos entre backticks --
// `replace` troca a PRIMEIRA ocorrencia, e uma ancora curta demais mutaria o
// comentario e deixaria a view intacta (o placar diria "sobreviveu" e a culpa
// cairia nas assercoes).
const RAMO_PESSOAL = "                ELSE t.user_id = b.user_id\n";
const SOMA_CHEIO = "        SELECT SUM(ABS(t.amount) * t.exchange_rate) AS v\n";
const SOMA_PARTE = "        SELECT SUM(e.amount * t.exchange_rate) AS v\n";
const DESLIGA_NO_GRUPO = "        WHERE b.group_id IS NULL\n";
const FILTRO_PAGUEI_EU = "          AND NOT e.paguei_eu\n";
const RECORTE_CATEGORIA = "          AND e.category_id = b.category_id\n";
const RECORTE_MES = "          AND e.month = b.month\n";
const RECORTE_USUARIO = "          AND e.user_id = b.user_id\n";
const SOMA_DAS_PERNAS =
  "    SELECT COALESCE(cheio.v, 0) + COALESCE(reembolso.v, 0) AS spent\n";

const mutantes = [
  // -----------------------------------------------------------------------
  // As duas metades da 049, uma sem a outra. Cada uma e um numero plausivel
  // que a barra do orcamento mostraria sem levantar erro.
  // -----------------------------------------------------------------------
  [
    "a metade 1 nao aplicada: o ramo pessoal volta a filtrar group_id IS NULL (520 -- a despesa que EU paguei desaparece)",
    RAMO_PESSOAL,
    "                ELSE t.user_id = b.user_id AND t.group_id IS NULL\n",
  ],
  [
    "a metade 2 nao aplicada: a perna do reembolso desligada (590 -- a leitura de CAIXA)",
    DESLIGA_NO_GRUPO,
    "        WHERE FALSE\n",
  ],
  [
    "a perna 2 sem o NOT paguei_eu (640 -- valor cheio + a minha parte dele, 120 de um jantar de 90)",
    FILTRO_PAGUEI_EU,
    "",
  ],
  [
    "a polaridade de paguei_eu invertida (620 -- entra a minha parte do que EU paguei, sai a do mercado da B)",
    FILTRO_PAGUEI_EU,
    "          AND e.paguei_eu\n",
  ],

  // -----------------------------------------------------------------------
  // A perna 2 vazando para o teto de GRUPO. E o defeito que cresce com gente:
  // cada membro novo acrescenta parte por cima do valor cheio da viagem.
  // -----------------------------------------------------------------------
  [
    "a perna 2 nao e desligada no teto de grupo (170 -- valor cheio + a minha parte dentro do teto da Casa)",
    DESLIGA_NO_GRUPO,
    "        WHERE TRUE\n",
  ],

  // -----------------------------------------------------------------------
  // A MOEDA, nos DOIS lados. A 026 trouxe a conversao para esta view porque
  // `amount_limit` e um numero em reais; a perna 2 e nova e precisa dela
  // tambem. Variar so um dos lados deixaria o outro sem medida.
  // -----------------------------------------------------------------------
  [
    "a perna 1 esquece a cotacao (200 -- 100 USD contados como 100 BRL num teto em reais)",
    SOMA_CHEIO,
    "        SELECT SUM(ABS(t.amount)) AS v\n",
  ],
  [
    "a perna 2 esquece a cotacao (520 -- 20 USD de parte contados como 20 BRL)",
    SOMA_PARTE,
    "        SELECT SUM(e.amount) AS v\n",
  ],

  // -----------------------------------------------------------------------
  // O SINAL. Despesa e gravada NEGATIVA neste banco: sem o ABS a view devolve
  // consumo negativo, o ratio fica negativo, o status e 'ok' para sempre e o
  // alerta de estouro nunca dispara. E o defeito que o 006 ja descrevia, e a
  // 049 reescreve a linha que o contem -- entao ele volta a ser mutavel.
  // -----------------------------------------------------------------------
  [
    "a perna 1 perde o ABS da despesa negativa (consumo negativo, status ok para sempre)",
    SOMA_CHEIO,
    "        SELECT SUM(t.amount * t.exchange_rate) AS v\n",
  ],
  [
    "a perna 2 inverte o sinal da parte (e.amount ja vem POSITIVO da 033)",
    SOMA_PARTE,
    "        SELECT SUM(-e.amount * t.exchange_rate) AS v\n",
  ],

  // -----------------------------------------------------------------------
  // Os RECORTES da perna 2. Ela e a consulta nova do arquivo, e cada `AND`
  // que falte a torna larga demais -- consumindo gasto de outra categoria, de
  // outro mes ou de outra pessoa. Nenhum deles levanta erro.
  // -----------------------------------------------------------------------
  [
    "a perna 2 perde o recorte de CATEGORIA (o teto de Alimentacao consome a parte do Uber)",
    RECORTE_CATEGORIA,
    "",
  ],
  [
    "a perna 2 perde o recorte de MES (o teto de maio consome a parte de abril)",
    RECORTE_MES,
    "",
  ],
  [
    "a perna 2 perde o recorte de USUARIO (a RLS de grupo devolve a parte dos OUTROS membros)",
    RECORTE_USUARIO,
    "",
  ],

  // -----------------------------------------------------------------------
  // O COALESCE da perna 2, e o que ele PROVA sobre o COALESCE de fora.
  //
  // `SUM` sobre zero linhas devolve NULL, e NULL somado a qualquer coisa e
  // NULL. O `COALESCE(g.spent, 0)` da view entao transforma o mes INTEIRO em
  // 0,00 -- nao em "vazio", que seria visivel. Quem nao deve parte nenhuma
  // (todo teto de grupo, e todo mes em que ninguem pagou nada por mim) passa a
  // mostrar barra zerada com dinheiro gasto.
  //
  // Este mutante e a medicao de que aquele COALESCE de fora NAO e decorativo:
  // e ele que converte o NULL em zero. Na view correta ele e inalcancavel (as
  // duas pernas ja vem com COALESCE), e esta e a unica linha do aparelho que
  // mostra o que ele faz quando alcancado.
  // -----------------------------------------------------------------------
  [
    "a perna 2 sem COALESCE (NULL contamina a soma, e o COALESCE de fora zera o mes inteiro)",
    SOMA_DAS_PERNAS,
    "    SELECT COALESCE(cheio.v, 0) + reembolso.v AS spent\n",
  ],

  // -----------------------------------------------------------------------
  // A RLS. `CREATE OR REPLACE VIEW` apaga as reloptions, e `security_invoker`
  // e uma reloption. Aqui, ao contrario das views da 046, o vazamento e REAL:
  // `budget_consumption` le `budgets`, que TEM RLS -- entao sem o ALTER
  // qualquer logado lista o orcamento de todo mundo.
  // -----------------------------------------------------------------------
  [
    "budget_consumption perde security_invoker",
    "ALTER VIEW public.budget_consumption SET (security_invoker = true);",
    "-- mutante: o ALTER foi apagado",
  ],
];

const psql = (url, args) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", url, ...args], {
    stdio: "pipe",
    encoding: "utf8",
  });

// O teste imprime um NOTICE por assercao que PASSOU antes de estourar na que
// falhou, e todos saem em stderr. Mostrar `stderr` cru deixa o placar com a
// PRIMEIRA assercao verde em cada linha, que e exatamente a informacao inutil.
// A linha que importa e a do ERROR.
const linhaDoErro = (stderr) => {
  const txt = (stderr || "").trim();
  const erro = txt.split("\n").find((l) => l.includes("ERROR:"));
  return (erro || txt).replace(/^.*ERROR:\s*/, "").trim();
};

const migrations = readdirSync("database/migrations")
  .filter(
    (f) =>
      /^0\d\d_/.test(f) &&
      !f.startsWith("000_") &&
      Number(f.slice(0, 3)) < ALVO_NUM
  )
  .sort();

function montarTemplate() {
  psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`]);
  psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${TEMPLATE}`]);
  const url = `${BASE}/${TEMPLATE}`;
  psql(url, ["-f", "database/tests/00_supabase_shim.sql"]);
  for (const m of migrations) psql(url, ["-f", `database/migrations/${m}`]);

  // O template nao pode ter a 049 -- e isso NAO se mede pela existencia da
  // view, que vem do 006. Mede-se pelo que a 049 acrescenta a definicao: a
  // leitura de `group_share_entries`. `pg_get_viewdef` devolve a definicao
  // normalizada pelo Postgres, sem comentario nenhum.
  const jaTem = psql(url, [
    "-tAc",
    "SELECT count(*) FROM pg_class c " +
      "WHERE c.oid = 'public.budget_consumption'::regclass " +
      "AND pg_get_viewdef(c.oid) LIKE '%group_share_entries%'",
  ]).trim();
  if (jaTem !== "0") {
    throw new Error(
      `o template ${TEMPLATE} ja tem a 049 -- os mutantes mediriam a versao boa`
    );
  }
}

function rodarMutante(nome, de, para) {
  if (!original.includes(de)) {
    // Ancora morta e pior que mutante sobrevivente: ela nao muta nada e o
    // `psql` do teste passa, entao sem este aviso o placar diria "sobreviveu"
    // e a culpa cairia nas assercoes.
    return { nome, estado: "ANCORA MORTA", detalhe: de.slice(0, 80) };
  }
  const mutado = original.replace(de, para);
  if (mutado === original) {
    return { nome, estado: "ANCORA MORTA", detalhe: "replace nao mudou nada" };
  }

  const banco = `mut049_${Math.random().toString(36).slice(2, 10)}`;
  // A MUTACAO VAI PARA UMA SOMBRA EM /tmp, E A ARVORE NUNCA E TOCADA -- morto
  // por timeout ou cancelamento, um runner que escreve no arquivo rastreado
  // deixa o mutante GRAVADO e dali em diante toda medicao le a migration
  // errada, sem nada no placar dizendo isso. Aqui a sombra sai de graca porque
  // o alvo e SQL: o que importa e o caminho que o `psql -f` recebe.
  const sombra = join(tmpdir(), `mut049_${banco}.sql`);
  try {
    psql(`${BASE}/postgres`, [
      "-c",
      `CREATE DATABASE ${banco} TEMPLATE ${TEMPLATE}`,
    ]);
    writeFileSync(sombra, mutado);
    const url = `${BASE}/${banco}`;
    try {
      psql(url, ["-f", sombra]);
    } catch (e) {
      // Mutante que nem aplica tambem esta morto -- e honesto dizer COMO.
      return {
        nome,
        estado: "morto",
        detalhe: `a migration mutada nao aplica: ${linhaDoErro(e.stderr).slice(0, 140)}`,
      };
    }
    try {
      psql(url, ["-f", TESTE]);
      return { nome, estado: "SOBREVIVEU", detalhe: "o teste passou com o mutante" };
    } catch (e) {
      return { nome, estado: "morto", detalhe: linhaDoErro(e.stderr) };
    }
  } finally {
    try {
      rmSync(sombra, { force: true });
    } catch {
      /* sombra em /tmp: sobrar nao muda placar nem toca a arvore */
    }
    try {
      psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`]);
    } catch {
      /* banco de mutante: sobrar nao muda placar */
    }
  }
}

console.log(`montando o template ${TEMPLATE} (001 -> 048, sem a 049)...`);
montarTemplate();

// CONTROLE NEGATIVO DA SUITE: no template (sem a 049) o teste tem de REPROVAR.
// Sem isto, uma suite que nao olhasse para o criterio novo deixaria todo
// mutante "morto" por outro motivo qualquer e o placar sairia perfeito medindo
// a fixture.
{
  const banco = `mut049_sem_a_049_${process.pid}`;
  psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${banco} TEMPLATE ${TEMPLATE}`]);
  try {
    psql(`${BASE}/${banco}`, ["-f", TESTE]);
    console.error(
      "CONTROLE NEGATIVO REPROVOU: a suite da 049 passa num banco que NAO tem a 049."
    );
    process.exit(1);
  } catch {
    console.log("controle negativo: sem a 049 a suite fica vermelha.");
  } finally {
    psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`]);
  }
}

// CONTROLE POSITIVO: a arvore NAO mutada tem de ficar VERDE. Sem ele, um erro
// de script (caminho errado, template sem shim) deixaria todo mutante "morto" e
// o placar sairia perfeito medindo nada.
{
  const banco = `mut049_positivo_${process.pid}`;
  psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${banco} TEMPLATE ${TEMPLATE}`]);
  try {
    psql(`${BASE}/${banco}`, ["-f", ALVO]);
    psql(`${BASE}/${banco}`, ["-f", TESTE]);
    console.log("controle positivo: a arvore limpa passa.\n");
  } catch (e) {
    console.error("CONTROLE POSITIVO REPROVOU -- o placar abaixo nao vale nada.");
    console.error((e.stderr || e.message || "").trim().slice(0, 600));
    process.exit(1);
  } finally {
    psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`]);
  }
}

const resultados = mutantes.map(([nome, de, para]) => rodarMutante(nome, de, para));

for (const r of resultados) {
  if (r.estado === "morto") {
    console.log(`ok   ${r.nome}\n       -> ${r.detalhe.slice(0, 160)}`);
  } else {
    console.log(`FALHA ${r.nome}\n       -> ${r.estado}: ${r.detalhe}`);
  }
}

try {
  psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`]);
} catch {
  /* idem */
}

const vivos = resultados.filter((r) => r.estado !== "morto");
if (vivos.length) {
  console.error(`\n${vivos.length} de ${resultados.length} mutantes NAO morreram.`);
  process.exit(1);
}
console.log(`\nTodos os ${resultados.length} mutantes morreram.`);
