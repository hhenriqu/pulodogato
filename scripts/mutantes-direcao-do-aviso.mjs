#!/usr/bin/env node
// Prova de mutacao da 050 (HMO-350). Cada entrada estraga UMA decisao da
// migration; o database/tests/050_direcao_do_aviso_de_vencimento_test.sql tem
// de ficar VERMELHO em todas. Mutante que sobrevive e uma decisao que nenhuma
// assercao distingue -- ou codigo morto.
//
//   PGURL=postgresql://postgres:postgres@127.0.0.1:5432 node scripts/mutantes-direcao-do-aviso.mjs
//
// POR QUE ESTE RUNNER EXISTE, TENDO O DA 043
// ------------------------------------------
// A 043 fez o mesmo movimento (`COALESCE` da regra -> `s.direction`) na
// `planned_vs_actual`. A 050 o faz na `bill_alerts`, e nada no runner da 043
// toca uma linha deste arquivo: sao views diferentes, com WHERE diferente
// (`days_before`, `notify_overdue`), colunas diferentes (`kind`,
// `notify_email`) e um consumidor diferente -- a frase que vai para a caixa de
// entrada do usuario.
//
// O DEFEITO RESTAURADO NAO E MUTANTE AQUI, E O CONTROLE NEGATIVO
// --------------------------------------------------------------
// "Voltar ao `COALESCE(r.transaction_type, 'expense')`" exige trocar o `FROM` e
// repor o `LEFT JOIN recurring_rules` no mesmo golpe: cada metade sozinha nao
// APLICA (`column s.direction does not exist`, ou `missing FROM-clause entry
// for table "r"`), e mutante morto no `psql` nao prova assercao nenhuma. Quem
// mede isso aqui e o CONTROLE NEGATIVO -- a suite inteira contra um banco que
// para na 049, que e literalmente o mundo de antes. O mutante `so-income-vira-
// expense` abaixo e a versao cirurgica do mesmo defeito, e essa aplica.
//
// POR QUE UM BANCO-TEMPLATE, E POR QUE ELE PARA NA 049
// ---------------------------------------------------
// A cadeia 001 -> 049 sobe UMA vez num template e cada mutante sai de
// `CREATE DATABASE ... TEMPLATE` -- copia de arquivo no lado do servidor, em
// vez de uma cadeia inteira por mutante.
//
// O template NAO PODE ter a 050, e isso NAO se mede pela existencia da view:
// `bill_alerts` existe desde o 009. Mede-se pelo que a 050 muda na definicao --
// a leitura de `scheduled_transactions_effective` -- lida do CATALOGO com
// `pg_get_viewdef`, que devolve a definicao normalizada e sem comentario
// nenhum. Com a 050 no template, cada mutante seria um `CREATE OR REPLACE VIEW`
// por cima da versao BOA e o placar seria ficcao.
//
// "001 -> 049" e uma REGRA sobre o numero (`< ALVO_NUM`), e nao
// `!f.startsWith("050_")`: "tudo menos a 050" incluiria uma 051 futura, cujo
// preflight pode abortar, e o runner morreria antes do primeiro mutante com
// erro de psql em vez de placar (foi o que quebrou o runner da 033 quando a 045
// entrou na arvore).
import { readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const BASE = process.env.PGURL || "postgresql://postgres:postgres@127.0.0.1:5432";
const ALVO = "database/migrations/050_direcao_do_aviso_de_vencimento.sql";
const TESTE = "database/tests/050_direcao_do_aviso_de_vencimento_test.sql";
const TEMPLATE = `tpl_050_${process.pid}`;

const ALVO_NUM = 50;

const original = readFileSync(ALVO, "utf8");

// As ancoras levam a INDENTACAO e a virgula/`WHERE` colados de proposito: o
// cabecalho desta migration repete os mesmos trechos entre backticks, e
// `String.replace` troca a PRIMEIRA ocorrencia. Uma ancora curta demais mutaria
// a PROSA e deixaria a view intacta -- o placar diria "sobreviveu" e a culpa
// cairia nas assercoes.
const DIRECAO = "    s.direction AS transaction_type,\n";
const FROM_NOVO = "  FROM public.scheduled_transactions_effective s\n";
const JOIN_PREFS =
  "  LEFT JOIN public.notification_preferences p ON p.user_id = s.user_id\n";
const WHERE_STATUS = "  WHERE s.status = 'pending'\n";
const KIND =
  "    CASE WHEN s.due_date < CURRENT_DATE THEN 'overdue' ELSE 'due_soon' END AS kind,\n";
const DAYS_BEFORE = "    COALESCE(p.days_before, 3) AS days_before,\n";
const NOTIFY_EMAIL = "    COALESCE(p.notify_email, true) AS notify_email\n";
const INVOKER = "ALTER VIEW public.bill_alerts SET (security_invoker = true);";

const mutantes = [
  // -----------------------------------------------------------------------
  // A PRECEDENCIA, perna por perna. `direction` resolve ocorrencia -> regra ->
  // 'expense' (027). Cada mutante abaixo apaga UMA das tres, e nenhum levanta
  // erro: todos devolvem um valor do enum que a tela imprime sem reclamar.
  // -----------------------------------------------------------------------
  [
    "O DEFEITO, cirurgico: so a receita volta a sair como conta a pagar",
    DIRECAO,
    "    CASE WHEN s.direction = 'income' THEN 'expense'::public.transaction_financial_type ELSE s.direction END AS transaction_type,\n",
  ],
  [
    "a perna da REGRA e apagada (receita fixa vira NULL -- a frase perde a direcao)",
    DIRECAO,
    "    s.transaction_type AS transaction_type,\n",
  ],
  [
    "a QUARTA COPIA do criterio, com a regra esquecida (o erro que a 027 existe para impedir)",
    DIRECAO,
    "    COALESCE(s.transaction_type, 'expense'::public.transaction_financial_type) AS transaction_type,\n",
  ],
  [
    "a precedencia INVERTIDA: a regra vence a ocorrencia (repontar a linha deixa de valer)",
    DIRECAO,
    "    COALESCE((SELECT r.transaction_type FROM public.recurring_rules r WHERE r.id = s.recurring_rule_id), s.transaction_type, 'expense'::public.transaction_financial_type) AS transaction_type,\n",
  ],
  // `transfer` achatado em `expense` e o conserto plausivel que alguem escreve
  // quando le "a frase so tem dois lados". O valor sai do enum e a frase do
  // app perde a unica informacao que distingue transferencia de conta.
  [
    "transfer achatado em expense (a frase perde o terceiro valor do enum)",
    DIRECAO,
    "    CASE WHEN s.direction = 'income' THEN 'income' ELSE 'expense' END::public.transaction_financial_type AS transaction_type,\n",
  ],

  // -----------------------------------------------------------------------
  // O RECORTE DE STATUS, que o `FROM` novo torna mutavel. A view da agenda nao
  // tem recorte nenhum por dentro, e ela expoe DUAS colunas de status.
  // -----------------------------------------------------------------------
  [
    "o recorte passa a usar effective_status (a conta VENCIDA desaparece do aviso)",
    WHERE_STATUS,
    "  WHERE s.effective_status = 'pending'\n",
  ],
  [
    "o recorte de status cai (conta PAGA e CANCELADA voltam a gerar aviso)",
    WHERE_STATUS,
    "  WHERE TRUE\n",
  ],

  // -----------------------------------------------------------------------
  // A DIRECAO ENTRANDO NO WHERE. E o "conserto" que apaga o sintoma pelo lado
  // errado: sem receita na view, toda assercao de direcao fica vacuamente
  // verde. A contagem da SECAO 2 e o que fecha esta porta.
  // -----------------------------------------------------------------------
  [
    "a direcao vira FILTRO: receita prevista para de gerar aviso",
    WHERE_STATUS,
    "  WHERE s.status = 'pending'\n    AND s.direction <> 'income'\n",
  ],

  // -----------------------------------------------------------------------
  // O QUE A 050 TINHA DE REPOR INTACTO. `CREATE OR REPLACE VIEW` carrega a
  // definicao INTEIRA: cada linha abaixo e uma que a 047 e o 009 colocaram e
  // que esta migration podia ter perdido no caminho, sem erro nenhum.
  // -----------------------------------------------------------------------
  [
    "notify_email vira constante (o canal de e-mail deixa de ser desligavel)",
    NOTIFY_EMAIL,
    "    true AS notify_email\n",
  ],
  [
    "days_before vira constante (quem escolheu 25 passa a ver 3)",
    DAYS_BEFORE,
    "    3 AS days_before,\n",
  ],
  [
    "kind invertido (a conta vencida e anunciada como a vencer)",
    KIND,
    "    CASE WHEN s.due_date < CURRENT_DATE THEN 'due_soon' ELSE 'overdue' END AS kind,\n",
  ],
  [
    "o LEFT JOIN da preferencia vira INNER (quem nunca abriu a tela perde TODO aviso)",
    JOIN_PREFS,
    "  JOIN public.notification_preferences p ON p.user_id = s.user_id\n",
  ],

  // -----------------------------------------------------------------------
  // A RLS. `CREATE OR REPLACE VIEW` apaga as reloptions, e `security_invoker` e
  // uma reloption.
  //
  // E AQUI O MUTANTE MORRE NA ASSERCAO DE CATALOGO, NAO NO CONTROLE DA RLS --
  // o achado desta issue, e vale escrito porque a suposicao natural e a oposta.
  // Depois da 050 esta view nao toca mais nenhuma TABELA com RLS no FROM: ela
  // le `scheduled_transactions_effective`, que tem invoker proprio. Medido: com
  // esta flag apagada o vizinho continua vendo ZERO. Quem protege a lista e a
  // flag da view DE BAIXO -- e e por isso que a suite le os DOIS reloptions e
  // vaza pelo lado de baixo no controle negativo.
  // -----------------------------------------------------------------------
  [
    "bill_alerts perde o security_invoker (morre na assercao de catalogo, nao na RLS -- ver o comentario)",
    INVOKER,
    "-- mutante: o ALTER foi apagado",
  ],

  // -----------------------------------------------------------------------
  // O FROM apontado para a tabela, SEM repor o join da regra. Este morre no
  // `psql` (`column s.direction does not exist`) e esta na lista de proposito:
  // ele e a prova de que o `FROM` e `s.direction` sao UMA decisao so, e nao
  // duas que alguem pode desfazer pela metade sem o banco reclamar.
  // -----------------------------------------------------------------------
  [
    "o FROM volta para a tabela sem repor o join da regra (tem de NAO aplicar)",
    FROM_NOVO,
    "  FROM public.scheduled_transactions s\n",
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
      /^0\d\d_/.test(f) && !f.startsWith("000_") && Number(f.slice(0, 3)) < ALVO_NUM
  )
  .sort();

function montarTemplate() {
  psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`]);
  psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${TEMPLATE}`]);
  const url = `${BASE}/${TEMPLATE}`;
  psql(url, ["-f", "database/tests/00_supabase_shim.sql"]);
  for (const m of migrations) psql(url, ["-f", `database/migrations/${m}`]);

  const jaTem = psql(url, [
    "-tAc",
    "SELECT count(*) FROM pg_class c " +
      "WHERE c.oid = 'public.bill_alerts'::regclass " +
      "AND pg_get_viewdef(c.oid) LIKE '%scheduled_transactions_effective%'",
  ]).trim();
  if (jaTem !== "0") {
    throw new Error(
      `o template ${TEMPLATE} ja tem a 050 -- os mutantes mediriam a versao boa`
    );
  }
}

function rodarMutante(nome, de, para) {
  if (!original.includes(de)) {
    // Ancora morta e pior que mutante sobrevivente: ela nao muta nada, o
    // `psql` do teste passa, e sem este aviso o placar diria "sobreviveu" com a
    // culpa caindo nas assercoes.
    return { nome, estado: "ANCORA MORTA", detalhe: de.slice(0, 80) };
  }
  // A ancora tem de ser UNICA: o cabecalho desta migration repete os mesmos
  // trechos em prosa, e `replace` pegaria o comentario em vez da view.
  const ocorrencias = original.split(de).length - 1;
  if (ocorrencias > 1) {
    return {
      nome,
      estado: "ANCORA AMBIGUA",
      detalhe: `o trecho aparece ${ocorrencias}x -- a mutacao atingiria so a primeira`,
    };
  }
  const mutado = original.replace(de, para);
  if (mutado === original) {
    return { nome, estado: "ANCORA MORTA", detalhe: "replace nao mudou nada" };
  }

  const banco = `mut050_${Math.random().toString(36).slice(2, 10)}`;
  // A MUTACAO VAI PARA UMA SOMBRA EM /tmp, E A ARVORE NUNCA E TOCADA -- morto
  // por timeout ou cancelamento, um runner que escreve no arquivo rastreado
  // deixa o mutante GRAVADO e dali em diante toda medicao le a migration
  // errada, sem nada no placar dizendo isso.
  const sombra = join(tmpdir(), `mut050_${banco}.sql`);
  try {
    psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${banco} TEMPLATE ${TEMPLATE}`]);
    writeFileSync(sombra, mutado);
    const url = `${BASE}/${banco}`;
    try {
      psql(url, ["-f", sombra]);
    } catch (e) {
      // Mutante que nem aplica tambem esta morto -- e honesto dizer COMO, para
      // quem le o placar nao achar que uma assercao o pegou.
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

console.log(`montando o template ${TEMPLATE} (001 -> 049, sem a 050)...`);
montarTemplate();

// CONTROLE NEGATIVO DA SUITE: no template (sem a 050) o teste tem de REPROVAR.
// Ele e tambem a medicao do defeito desta issue -- o template E o mundo de
// antes. Sem isto, uma suite que nao olhasse para a direcao deixaria todo
// mutante "morto" por outro motivo e o placar sairia perfeito medindo a
// fixture.
{
  const banco = `mut050_sem_a_050_${process.pid}`;
  psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${banco} TEMPLATE ${TEMPLATE}`]);
  try {
    psql(`${BASE}/${banco}`, ["-f", TESTE]);
    console.error(
      "CONTROLE NEGATIVO REPROVOU: a suite da 050 passa num banco que NAO tem a 050."
    );
    process.exit(1);
  } catch (e) {
    console.log(`controle negativo: sem a 050 a suite fica vermelha (${linhaDoErro(e.stderr).slice(0, 110)})`);
  } finally {
    psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`]);
  }
}

// CONTROLE POSITIVO: a arvore NAO mutada tem de ficar VERDE. Sem ele, um erro
// de script (caminho errado, template sem shim) deixaria todo mutante "morto" e
// o placar sairia perfeito medindo nada.
{
  const banco = `mut050_positivo_${process.pid}`;
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

// MUTANTE MORTO SO PELO `psql` NAO PROVA ASSERCAO NENHUMA. Se TODOS morressem
// assim, a suite poderia estar vazia e o placar sairia perfeito.
const porAssercao = resultados.filter((r) => r.detalhe.startsWith("FALHA")).length;
if (porAssercao === 0) {
  console.error(
    "\nNENHUM mutante foi morto por assercao -- todos cairam no psql. A suite nao esta medindo nada."
  );
  process.exit(1);
}
console.log(
  `\nTodos os ${resultados.length} mutantes morreram (${porAssercao} por assercao da suite).`
);
