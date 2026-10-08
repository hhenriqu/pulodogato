#!/usr/bin/env node
// Prova de mutacao da 046 (HMO-258). Cada entrada estraga UMA decisao da
// migration; o database/tests/046_um_criterio_de_custo_pessoal_test.sql tem de
// ficar VERMELHO em todas. Mutante que sobrevive e uma decisao que nenhuma
// assercao distingue -- ou codigo morto.
//
//   PGURL=postgresql://postgres:postgres@127.0.0.1:5432 node scripts/mutantes-um-criterio-de-custo-pessoal.mjs
//
// POR QUE ESTE RUNNER EXISTE, TENDO O DA 033
// ------------------------------------------
// `mutantes-minha-parte-no-realizado.mjs` mede as MESMAS DUAS VIEWS, e continua
// valendo: ele prova que o teste da 033 distingue as decisoes da 033, no estado
// do banco em que o teste da 033 roda (001 -> 032, mais a 033 mutada).
//
// A 046 TROCA O CRITERIO daquelas views. Duas consequencias, e as duas pedem
// aparelho proprio:
//
//   1. O mutante 2 da 033 ("o lado pessoal deixa de filtrar group_id IS NULL")
//      descreve metade da 046 como defeito -- e esta certo no lugar dele, porque
//      na 033 sozinha aquilo produz dupla contagem. O que a 046 faz e aplicar
//      aquela metade JUNTO com a outra. Nenhum mutante da 033 mede o par.
//   2. O teste da 033 continua exigindo 950 (o criterio dela), e esta certo: ele
//      roda na posicao da 033, antes da 046. Nao ha como pendurar na suite da
//      033 uma assercao sobre o criterio que a substitui.
//
// POR QUE UM BANCO-TEMPLATE, E POR QUE ELE PARA NA 045
// ---------------------------------------------------
// A cadeia 001 -> 045 sobe UMA vez num template e cada mutante sai de
// `CREATE DATABASE ... TEMPLATE` -- copia de arquivo, fracao de segundo, em vez
// de ~40s de cadeia por mutante.
//
// O template NAO TEM a 046, de proposito: se tivesse, cada mutante seria um
// `CREATE OR REPLACE VIEW` por cima da versao BOA, e o placar seria ficcao --
// algumas mutacoes nem chegariam a mudar a view. A funcao `montarTemplate`
// confere isso medindo um numero, nao a ausencia de um objeto: as views existem
// desde a 033, o que a 046 muda e o VALOR que elas devolvem.
//
// "001 -> 045" e uma REGRA sobre o numero, e nao `!f.startsWith("046_")`. Essa
// diferenca nao e estetica: foi exatamente ela que quebrou o runner da 033
// quando a 045 entrou na arvore -- "tudo menos a 033" incluia a 045, cujo
// preflight aborta sem as views da 033, e o runner morria antes do primeiro
// mutante com erro de psql em vez de placar.
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";

const BASE = process.env.PGURL || "postgresql://postgres:postgres@127.0.0.1:5432";
const ALVO = "database/migrations/046_um_criterio_de_custo_pessoal.sql";
const TESTE = "database/tests/046_um_criterio_de_custo_pessoal_test.sql";
const TEMPLATE = `tpl_046_${process.pid}`;

const ALVO_NUM = 46;

const original = readFileSync(ALVO, "utf8");

// As duas pernas da view, como elas aparecem no arquivo. Ancoras curtas demais
// casariam no comentario do cabecalho, que repete os dois trechos em prosa --
// por isso cada uma leva o SELECT inteiro da perna.
const PERNA_PESSOAL =
  "    SELECT\n" +
  "      c.user_id, c.month, c.category_id,\n" +
  "      c.expense, c.income, c.transaction_count, c.currency\n" +
  "    FROM public.category_monthly_totals c";

const PERNA_GRUPO =
  "    FROM public.group_share_category_monthly_totals g\n" +
  "    WHERE NOT g.paguei_eu";

const mutantes = [
  // -----------------------------------------------------------------------
  // As duas metades da 046, uma sem a outra. Cada uma e um numero plausivel
  // que a tela mostraria sem levantar erro.
  // -----------------------------------------------------------------------
  [
    "a metade 1 nao aplicada: o lado pessoal volta a filtrar group_id IS NULL (920 -- a despesa que EU paguei desaparece)",
    PERNA_PESSOAL,
    PERNA_PESSOAL + "\n    WHERE c.group_id IS NULL",
  ],
  [
    "a metade 2 nao aplicada: a perna do grupo nao filtra paguei_eu (1040 -- valor cheio + a minha parte dele)",
    PERNA_GRUPO,
    "    FROM public.group_share_category_monthly_totals g",
  ],
  [
    "a polaridade de paguei_eu invertida (1020 -- entra a minha parte do que eu paguei, sai a do que a B pagou)",
    PERNA_GRUPO,
    "    FROM public.group_share_category_monthly_totals g\n    WHERE g.paguei_eu",
  ],
  [
    "a perna do grupo descartada (990 -- fluxo de caixa, que e o criterio CERTO de outra leitura)",
    PERNA_GRUPO,
    PERNA_GRUPO + " AND FALSE",
  ],

  // -----------------------------------------------------------------------
  // O GRAO do rollup. A coluna `paguei_eu` existir nao basta: ela precisa
  // estar no GROUP BY, senao a perna 2 filtra um valor agregado.
  // -----------------------------------------------------------------------
  // Com `bool_or` e sem o `paguei_eu` no GROUP BY, uma categoria que tenha as
  // duas origens no mesmo mes colapsa numa linha so -- e ela vem como "eu
  // paguei", entao a parte do que OUTRO pagou e descartada junto. O sintoma e
  // silencioso: a coluna esta la, o tipo esta certo, a view compila.
  [
    "paguei_eu sai do GRAO do rollup (bool_or colapsa as duas origens numa linha)",
    "    e.currency,\n" +
      "    -- A 046 acrescenta esta coluna. TRUE = a despesa e minha e o valor cheio\n" +
      "    -- dela ja esta no lado pessoal; quem soma custo pessoal tem de descartar\n" +
      "    -- estas linhas, ou conta a mesma despesa duas vezes.\n" +
      "    e.paguei_eu\n" +
      "  FROM public.group_share_entries e\n" +
      "  GROUP BY e.user_id, e.group_id, e.month, e.category_id, e.currency, e.paguei_eu;",
    "    e.currency,\n" +
      "    bool_or(e.paguei_eu) AS paguei_eu\n" +
      "  FROM public.group_share_entries e\n" +
      "  GROUP BY e.user_id, e.group_id, e.month, e.category_id, e.currency;",
  ],

  // -----------------------------------------------------------------------
  // A RLS. `CREATE OR REPLACE VIEW` apaga as reloptions; sem o ALTER de volta
  // as views voltam a ser DEFINER.
  // -----------------------------------------------------------------------
  // Dois mutantes e nao um: as duas views precisam do ALTER, `security_invoker`
  // nao e herdado, e apagar so um dos dois e o erro mais facil de cometer.
  //
  // OS DOIS MORREM NA ASSERCAO DE `reloptions`, NAO NO CONTROLE DA DORA -- e
  // isso esta certo e e medido. Nenhuma das duas views da 046 toca tabela com
  // RLS: as duas leem outras views (008 e 033), que sao INVOKER e e onde a
  // politica e avaliada. Com so estas duas como DEFINER a Dora continua vendo
  // zero; o vazamento aparece quando a view de BAIXO tambem perde a reloption.
  // Ver a secao 6 do teste, que diz isso no lugar em que alguem iria supor o
  // contrario.
  [
    "personal_category_monthly_totals perde security_invoker",
    "ALTER VIEW public.personal_category_monthly_totals    SET (security_invoker = true);",
    "-- mutante: o ALTER desta view foi apagado",
  ],
  [
    "group_share_category_monthly_totals perde security_invoker",
    "ALTER VIEW public.group_share_category_monthly_totals SET (security_invoker = true);",
    "-- mutante: o ALTER desta view foi apagado",
  ],
];

const psql = (url, args) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", url, ...args], {
    stdio: "pipe",
    encoding: "utf8",
  });

// O teste imprime um NOTICE por assercao que PASSOU antes de estourar na que
// falhou, e todos saem em stderr. Mostrar `stderr` cru deixa o placar com a
// PRIMEIRA assercao verde em cada linha -- sete mutantes "ok" exibindo "ok: o
// jantar nasceu com 3 partes", que e exatamente a informacao inutil. A linha
// que importa e a do ERROR.
const linhaDoErro = (stderr) => {
  const txt = (stderr || "").trim();
  const erro = txt.split("\n").find((l) => l.includes("ERROR:"));
  return (erro || txt).replace(/^.*ERROR:\s*/, "").trim();
};

// "001 -> 045" como regra sobre o numero. Ver o cabecalho: a forma
// `!f.startsWith("046_")` e a que quebrou o runner da 033.
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

  // O template nao pode ter a 046 -- e isso NAO se mede pela existencia das
  // views, que vem da 033. Mede-se pelo GRAO: `paguei_eu` so entra na coluna
  // na 046. Com ela no template, cada mutante seria aplicado por cima da
  // versao boa e o placar seria ficcao.
  const jaTem = psql(url, [
    "-tAc",
    "SELECT count(*) FROM information_schema.columns " +
      "WHERE table_schema = 'public' " +
      "AND table_name = 'group_share_category_monthly_totals' " +
      "AND column_name = 'paguei_eu'",
  ]).trim();
  if (jaTem !== "0") {
    throw new Error(
      `o template ${TEMPLATE} ja tem o grao da 046 -- os mutantes mediriam a versao boa`
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
  // `replace` troca a PRIMEIRA ocorrencia. As ancoras aqui sao os trechos
  // completos das pernas justamente para nao casarem no cabecalho em prosa.
  const mutado = original.replace(de, para);
  if (mutado === original) {
    return { nome, estado: "ANCORA MORTA", detalhe: "replace nao mudou nada" };
  }

  const banco = `mut046_${Math.random().toString(36).slice(2, 10)}`;
  // A MUTACAO VAI PARA UMA SOMBRA EM /tmp, E A ARVORE NUNCA E TOCADA.
  //
  // A primeira versao escrevia o mutante NO PROPRIO arquivo rastreado e
  // restaurava no `finally`. O `check-mutacao-no-lugar.mjs` reprovou, e com
  // razao: morto por timeout ou cancelamento, o runner deixa o mutante GRAVADO
  // na arvore, e dali em diante toda medicao le a migration errada sem nada no
  // placar dizendo isso. `process.on("SIGTERM")` nao resolve -- num laco
  // sincrono o handler nunca roda e ainda engole o sinal.
  //
  // (Este comentario evita escrever a chamada antiga em forma de codigo: aquele
  // guard e TEXTUAL e nao descarta comentario, entao a propria descricao do
  // defeito o dispara. Medido.)
  //
  // Aqui a sombra sai de graca porque o alvo e SQL: o que importa e o caminho
  // que o `psql -f` recebe, nao o nome do arquivo. Runners de suite JS precisam
  // do `criarBlocoDeMutantes` (que copia a arvore) pelo mesmo motivo.
  const sombra = join(tmpdir(), `mut046_${banco}.sql`);
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

console.log(`montando o template ${TEMPLATE} (001 -> 045, sem a 046)...`);
montarTemplate();

// CONTROLE POSITIVO: a arvore NAO mutada tem de ficar VERDE. Sem ele, um erro
// de script (caminho errado, template sem shim) deixaria todo mutante "morto" e
// o placar sairia perfeito medindo nada.
{
  const banco = `mut046_positivo_${process.pid}`;
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
