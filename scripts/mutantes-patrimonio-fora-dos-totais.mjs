#!/usr/bin/env node
// Prova de mutacao da migration 064 -- o patrimonio mes a mes ignora a conta
// fora dos totais (HMO-441).
//
//   PGURL="postgresql://" node scripts/mutantes-patrimonio-fora-dos-totais.mjs
//
// Cada mutante estraga UM pedaco da 064; a suite
// `064_patrimonio_ignora_conta_fora_dos_totais_test.sql` tem que ficar
// VERMELHA. Mutante que sobrevive e um trecho que nenhuma assercao distingue.
//
// POR QUE UM BANCO-TEMPLATE, E POR QUE ELE PARA NA 063
// ----------------------------------------------------
// Montar a cadeia 001 -> 063 custa ~200 passos de SQL; `CREATE DATABASE ...
// TEMPLATE` e copia de arquivo. O template para na 063 (SEM a 064) e ja leva a
// FIXTURE comitada, porque o filtro da 064 so e load-bearing se houver dinheiro
// na conta desligada -- num banco sem ele todo mutante sobreviveria e o placar
// sairia cheio sem ter medido nada.
//
// O BANCO DE CADA MUTANTE E NOVO. Um banco reaproveitado daria verde-falso: a
// view que o mutante deveria deixar errada ja estaria recolada certa da passada
// anterior.
//
// AS ANCORAS NAO PODEM CASAR NO COMENTARIO, E AQUI O RISCO E REAL
// ---------------------------------------------------------------
// O cabecalho da 064 EXPLICA o que nao fazer citando `FILTER (WHERE
// a.include_in_total)`, `NOT IN (desligadas)`, `WHERE a.include_in_total` e
// `financial_transactions.include_in_total` por extenso. Uma ancora curta
// casaria na prosa, o `replace` mutaria um COMENTARIO, a view ficaria intacta e
// o mutante "sobreviveria" sem nunca ter existido
// (`ancora-de-mutante-casa-no-comentario-e-o-cmp-nao-ve`). Dai as ancoras
// levarem a linha de codigo inteira, com a indentacao.
//
// A TRAVA DE OCORRENCIA UNICA fecha o resto: `String.replace` troca a PRIMEIRA
// ocorrencia, e o runner aborta quando a ancora aparece 0 ou 2+ vezes. Mutante
// de VARIAS edicoes valida CADA uma -- uma edicao que nao casa deixaria o
// mutante meio-aplicado e ele sobreviveria por nao ter sido escrito
// (`mutante-de-varias-edicoes-sobrevive-falso-quando-uma-delas-nao-casa`).

import { readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const BASE = process.env.PGURL || "postgresql://postgres:postgres@127.0.0.1:5432";
const ALVO = "database/migrations/064_patrimonio_ignora_conta_fora_dos_totais.sql";
const TESTE = "database/tests/064_patrimonio_ignora_conta_fora_dos_totais_test.sql";
const FIXTURE = "database/tests/064_contas_antes_da_064.sql";
const TEMPLATE = `tpl_064_${process.pid}`;
const ALVO_NUM = 64;

const original = readFileSync(ALVO, "utf8");

// ---------------------------------------------------------------------------
// As ancoras, todas linhas de CODIGO
// ---------------------------------------------------------------------------
const FILTRO_SALDO =
  "      COALESCE(SUM(a.current_balance) FILTER (WHERE a.include_in_total), 0)::numeric(15,2) AS total\n";
const FILTRO_MOVIMENTO =
  "      COALESCE(SUM(t.amount) FILTER (WHERE a.include_in_total), 0)::numeric(15,2) AS net\n";
const FROM_CONTAS = "    FROM public.financial_accounts a\n    GROUP BY a.user_id\n";
const JUNCAO = "    LEFT JOIN public.financial_accounts a ON a.id = t.account_id\n";
const WHERE_COM_CONTA = "    WHERE t.account_id IS NOT NULL\n";
const ALTER_INVOKER =
  "ALTER VIEW public.net_worth_history SET (security_invoker = true);";
const REVOKE_ANON = "REVOKE ALL ON public.net_worth_history FROM anon;";
const PREFLIGHT = "    RAISE EXCEPTION E'064 nao pode ser aplicado neste banco.";
const COMMENT_LANCAMENTO =
  "NAO ignora o LANCAMENTO fora dos totais (financial_transactions.include_in_total = false, HMO-443/060)";

const mutantes = [
  // -------------------------------------------------------------------------
  // 1-2. O FILTRO APAGADO, uma ponta por vez. E literalmente o estado de
  // ANTES desta migration, ponta por ponta -- e o que producao mostra hoje.
  // -------------------------------------------------------------------------
  {
    nome: "o FILTER do saldo_hoje apagado (o nivel volta a somar a conta desligada)",
    espera: "secao 3 -- o ultimo ponto da serie",
    edicoes: [[FILTRO_SALDO, "      COALESCE(SUM(a.current_balance), 0)::numeric(15,2) AS total\n"]],
  },
  {
    nome: "o FILTER do movimento apagado (a variacao do mes volta a somar)",
    espera: "secao 4 -- net_change de maio",
    edicoes: [[FILTRO_MOVIMENTO, "      COALESCE(SUM(t.amount), 0)::numeric(15,2) AS net\n"]],
  },

  // -------------------------------------------------------------------------
  // 3-4. `FILTER` TROCADO POR `WHERE`. Os dois dao os MESMOS numeros das
  // secoes 3, 4 e 5 -- e e por isso que as secoes 6 e 8 existem. Sem elas
  // estes dois mutantes sobreviveriam, e o defeito que eles plantam nao e um
  // numero errado: e um mes que desaparece do grafico e uma tela que fica
  // vazia em vez de zerada.
  // -------------------------------------------------------------------------
  {
    nome: "saldo_hoje com WHERE em vez de FILTER (a tela de quem so tem conta desligada esvazia)",
    espera: "secao 8 -- o usuario de contas todas desligadas perde a serie",
    edicoes: [
      [FILTRO_SALDO, "      COALESCE(SUM(a.current_balance), 0)::numeric(15,2) AS total\n"],
      [FROM_CONTAS, "    FROM public.financial_accounts a\n    WHERE a.include_in_total\n    GROUP BY a.user_id\n"],
    ],
  },
  {
    nome: "movimento com WHERE em vez de FILTER (o mes de julho desaparece do grafico)",
    espera: "secao 6 -- a chave do mes",
    edicoes: [
      [FILTRO_MOVIMENTO, "      SUM(t.amount)::numeric(15,2) AS net\n"],
      [WHERE_COM_CONTA, "    WHERE t.account_id IS NOT NULL\n      AND a.include_in_total\n"],
    ],
  },

  // -------------------------------------------------------------------------
  // 5-6. A POLARIDADE INVERTIDA. A coluna e positiva ("entra nos totais"), e a
  // negacao dupla e exatamente o erro que a 058 escolheu o nome para evitar.
  // -------------------------------------------------------------------------
  {
    nome: "polaridade invertida no saldo_hoje (NOT a.include_in_total)",
    espera: "secao 3 -- o ultimo ponto vira o saldo da conta desligada",
    edicoes: [[FILTRO_SALDO, "      COALESCE(SUM(a.current_balance) FILTER (WHERE NOT a.include_in_total), 0)::numeric(15,2) AS total\n"]],
  },
  {
    nome: "polaridade invertida no movimento (NOT a.include_in_total)",
    espera: "secao 4 -- net_change de maio vira o aporte da desligada",
    edicoes: [[FILTRO_MOVIMENTO, "      COALESCE(SUM(t.amount) FILTER (WHERE NOT a.include_in_total), 0)::numeric(15,2) AS net\n"]],
  },

  // -------------------------------------------------------------------------
  // 7. O FILTRO QUE NAO FILTRA. `IS NOT NULL` e sempre verdadeiro numa coluna
  // `NOT NULL`: o predicado fica com a cara de filtro e nao recorta nada. E o
  // mutante do "checkbox que nao faz nada", que passa em revisao de codigo.
  // -------------------------------------------------------------------------
  {
    nome: "filtro sempre verdadeiro no movimento (include_in_total IS NOT NULL)",
    espera: "secao 4 -- net_change de maio",
    edicoes: [[FILTRO_MOVIMENTO, "      COALESCE(SUM(t.amount) FILTER (WHERE a.include_in_total IS NOT NULL), 0)::numeric(15,2) AS net\n"]],
  },

  // -------------------------------------------------------------------------
  // 8. O `WHERE t.account_id IS NOT NULL` DA 008 APAGADO. A recolagem tinha de
  // preservar essa linha; sem ela o lancamento sem conta passa a CRIAR mes na
  // serie (agosto, na fixture).
  // -------------------------------------------------------------------------
  {
    nome: "o WHERE t.account_id IS NOT NULL da 008 apagado (lancamento sem conta cria mes)",
    espera: "secao 7 -- agosto nao pode ter linha",
    edicoes: [[WHERE_COM_CONTA, "    WHERE TRUE\n"]],
  },

  // -------------------------------------------------------------------------
  // 9. O CONSERTO ZELOSO, que e pior que o defeito: filtrar TAMBEM o flag do
  // LANCAMENTO (060). A ressalva 1 do cabecalho da 060 proibe isso por
  // extenso, e este mutante e a razao de a secao 5 existir.
  // -------------------------------------------------------------------------
  {
    nome: 'o "conserto" zeloso: filtrar tambem t.include_in_total (o flag da 060)',
    espera: "secao 5 -- o patrimonio NAO filtra o lancamento desmarcado",
    edicoes: [[FILTRO_MOVIMENTO, "      COALESCE(SUM(t.amount) FILTER (WHERE a.include_in_total AND t.include_in_total), 0)::numeric(15,2) AS net\n"]],
  },

  // -------------------------------------------------------------------------
  // 10. O `COALESCE` DO SALDO APAGADO. Sem ele o usuario cuja unica conta e
  // desligada recebe `net_worth = NULL` em vez de 0 -- a tela desenha "--" ou
  // quebra, em vez de desenhar zero.
  // -------------------------------------------------------------------------
  {
    nome: "o COALESCE do saldo_hoje apagado (patrimonio NULL em vez de zero)",
    espera: "secao 8 -- o patrimonio dele e ZERO",
    edicoes: [[FILTRO_SALDO, "      (SUM(a.current_balance) FILTER (WHERE a.include_in_total))::numeric(15,2) AS total\n"]],
  },

  // -------------------------------------------------------------------------
  // 11-12. OS DOIS PASSOS QUE `CREATE OR REPLACE VIEW` EXIGE DE VOLTA. Nenhum
  // dos dois muda um numero num banco de um usuario so -- por isso as secoes 9
  // e 10 medem o CATALOGO.
  // -------------------------------------------------------------------------
  {
    nome: "o ALTER VIEW ... SET (security_invoker) apagado (a view vira DEFINER)",
    espera: "secao 9 -- reloptions no catalogo",
    edicoes: [[ALTER_INVOKER, "-- mutante: o ALTER foi apagado"]],
  },
  {
    nome: "anon recebe SELECT no patrimonio",
    espera: "secao 10 -- anon nao tem privilegio nenhum",
    edicoes: [[REVOKE_ANON, "GRANT SELECT ON public.net_worth_history TO anon;"]],
  },

  // -------------------------------------------------------------------------
  // 13. O COMMENT QUE NAO DIZ QUAL DAS DUAS COLUNAS. E a sonda de colagem em
  // prod, e um COMMENT que omita a politica do flag do LANCAMENTO manda o
  // proximo leitor medir no corpo da view -- justamente a confusao que esta
  // migration existe para desfazer.
  // -------------------------------------------------------------------------
  {
    nome: "o COMMENT nao diz mais o que acontece com o LANCAMENTO desmarcado",
    espera: "secao 11 -- o COMMENT nomeia as duas politicas",
    edicoes: [[COMMENT_LANCAMENTO, "Ignora tudo o que estiver fora dos totais"]],
  },

  // -------------------------------------------------------------------------
  // 14. O PREFLIGHT AFROUXADO, e ele esta nesta lista DE PROPOSITO sabendo que
  // SOBREVIVE -- mesmo desenho do mutante homonimo da 063. Num banco que JA
  // tem a 058 o preflight nunca dispara, entao o mutante e indistinguivel do
  // original NESTA posicao da cadeia e nenhuma assercao desta suite pode
  // distingui-lo. O que o torna observavel foi medido FORA da suite, no CN3
  // (ver o bloco do db-verify): num banco parado antes da 058 a colagem passa
  // do preflight e morre adiante com `column a.include_in_total does not
  // exist`, que NAO nomeia a migration que falta.
  // -------------------------------------------------------------------------
  {
    nome: "preflight afrouxado (RAISE EXCEPTION -> RAISE NOTICE)",
    espera: "SOBREVIVE de proposito -- observavel so no CN3, fora da suite",
    sobrevivePorConstrucao: true,
    edicoes: [[PREFLIGHT, "    RAISE NOTICE E'064 nao pode ser aplicado neste banco."]],
  },

  // -------------------------------------------------------------------------
  // 15. O `LEFT JOIN` VIRA `JOIN`, e este tambem SOBREVIVE de proposito. Com o
  // `WHERE t.account_id IS NOT NULL` logo abaixo, toda linha que chega aqui tem
  // conta, e a FK garante que a conta existe: `JOIN` e `LEFT JOIN` sao
  // equivalentes NESTE corpo, e nenhuma assercao honesta pode separa-los. O
  // `LEFT JOIN` esta escrito por defesa -- quem apagar o `WHERE` amanha (o
  // mutante 8) encontra a forma que NAO descarta linha sem conta calado. Um
  // mutante equivalente declarado e melhor que um mutante equivalente
  // escondido: sem esta entrada, alguem o escreveria, o veria sobreviver e
  // acharia que a suite tem furo (`mutante-sobrevivente-pode-estar-certo`).
  // -------------------------------------------------------------------------
  {
    nome: "LEFT JOIN vira JOIN",
    espera: "SOBREVIVE de proposito -- equivalente sob o WHERE account_id IS NOT NULL",
    sobrevivePorConstrucao: true,
    edicoes: [[JUNCAO, "    JOIN public.financial_accounts a ON a.id = t.account_id\n"]],
  },
];

const psql = (url, args) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", url, ...args], {
    stdio: "pipe",
    encoding: "utf8",
  });

// O teste imprime um NOTICE por assercao que PASSOU antes de estourar na que
// falhou, e todos saem em stderr. A linha que importa e a do ERROR.
const linhaDoErro = (stderr) => {
  const txt = (stderr || "").trim();
  const erro = txt.split("\n").find((l) => l.includes("ERROR:"));
  return (erro || txt).replace(/^.*ERROR:\s*/, "").trim();
};

const migrations = readdirSync("database/migrations")
  .filter(
    (f) => /^0\d\d_/.test(f) && !f.startsWith("000_") && Number(f.slice(0, 3)) < ALVO_NUM
  )
  .sort();

function montarTemplate() {
  psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`]);
  psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${TEMPLATE}`]);
  const url = `${BASE}/${TEMPLATE}`;
  psql(url, ["-f", "database/tests/00_supabase_shim.sql"]);
  for (const m of migrations) psql(url, ["-f", `database/migrations/${m}`]);
  // A fixture ENTRA NO TEMPLATE: sem dinheiro na conta desligada todo mutante
  // sobrevive, e o placar sai cheio sem ter medido nada.
  psql(url, ["-f", FIXTURE]);

  // O template nao pode ter a 064 -- e isso se mede pelo que a 064 acrescenta a
  // DEFINICAO da view, nao pela existencia dela (a view vem do 008).
  // `pg_get_viewdef` devolve a definicao normalizada pelo Postgres, sem
  // comentario nenhum: nao ha como casar com a prosa da migration.
  const jaTem = psql(url, [
    "-tAc",
    "SELECT count(*) FROM pg_class c WHERE c.oid = 'public.net_worth_history'::regclass " +
      "AND pg_get_viewdef(c.oid) LIKE '%include_in_total%'",
  ]).trim();
  if (jaTem !== "0") {
    throw new Error(`o template ${TEMPLATE} ja tem a 064 -- os mutantes mediriam a versao boa`);
  }

  // E a fixture tem de estar la, com o dinheiro do lado desligado.
  const saldoDesligado = psql(url, [
    "-tAc",
    "SELECT COALESCE(SUM(current_balance), 0) FROM public.financial_accounts " +
      "WHERE id = 'f0640000-0000-0000-0000-000000000002'",
  ]).trim();
  if (Number(saldoDesligado) !== 7700) {
    throw new Error(
      `a fixture nao plantou os 7.700,00 da conta desligada (obtido ${saldoDesligado}) -- ` +
        "sem isso todo mutante sobrevive"
    );
  }
}

function aplicarEdicoes(texto, edicoes) {
  let atual = texto;
  for (const [de, para] of edicoes) {
    const ocorrencias = atual.split(de).length - 1;
    if (ocorrencias !== 1) {
      return { erro: `a ancora aparece ${ocorrencias}x (tem de ser 1): ${de.trim().slice(0, 70)}` };
    }
    const depois = atual.replace(de, para);
    if (depois === atual) {
      return { erro: `o replace nao mudou nada: ${de.trim().slice(0, 70)}` };
    }
    atual = depois;
  }
  return { texto: atual };
}

function rodarMutante(mut) {
  const r = aplicarEdicoes(original, mut.edicoes);
  if (r.erro) {
    // Ancora morta e PIOR que mutante sobrevivente: ela nao muta nada, a suite
    // passa, e o placar diria "sobreviveu" com a culpa caindo nas assercoes.
    return { ...mut, estado: "ANCORA MORTA", detalhe: r.erro };
  }

  const banco = `mut064_${Math.random().toString(36).slice(2, 10)}`;
  // A MUTACAO VAI PARA UMA SOMBRA EM /tmp, E A ARVORE NUNCA E TOCADA -- morto
  // por timeout, um runner que escreve no arquivo rastreado deixa o mutante
  // GRAVADO e dali em diante toda medicao le a migration errada.
  const sombra = join(tmpdir(), `mut064_${banco}.sql`);
  try {
    psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${banco} TEMPLATE ${TEMPLATE}`]);
    writeFileSync(sombra, r.texto);
    const url = `${BASE}/${banco}`;
    try {
      psql(url, ["-f", sombra]);
    } catch (e) {
      // Mutante que nem aplica tambem esta morto -- e honesto dizer COMO.
      return {
        ...mut,
        estado: "morto",
        detalhe: `a migration mutada nao aplica: ${linhaDoErro(e.stderr).slice(0, 140)}`,
      };
    }
    try {
      psql(url, ["-f", TESTE]);
      return { ...mut, estado: "SOBREVIVEU", detalhe: "a suite passou com o mutante" };
    } catch (e) {
      return { ...mut, estado: "morto", detalhe: linhaDoErro(e.stderr) };
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

console.log(`montando o template ${TEMPLATE} (001 -> 063 + fixture, sem a 064)...`);
montarTemplate();

// CONTROLE NEGATIVO DA SUITE: no template (sem a 064) a suite tem de REPROVAR.
// Sem isto, uma suite que nao olhasse para o filtro novo deixaria todo mutante
// aparecer como morto -- e o placar sairia cheio medindo nada
// (`suite-vermelha-faz-todo-controle-negativo-passar-vacuo` pelo avesso).
{
  const banco = `cn064_${Math.random().toString(36).slice(2, 10)}`;
  psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${banco} TEMPLATE ${TEMPLATE}`]);
  try {
    psql(`${BASE}/${banco}`, ["-f", TESTE]);
    console.error(
      "CONTROLE NEGATIVO FALHOU: a suite passou num banco SEM a 064. " +
        "Ela nao mede o filtro novo, e o placar abaixo nao valeria nada."
    );
    process.exit(1);
  } catch (e) {
    console.log(`controle negativo ok (suite vermelha sem a 064): ${linhaDoErro(e.stderr)}`);
  } finally {
    psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`]);
  }
}

// CONTROLE POSITIVO: a 064 INTACTA tem de ficar verde. Se o arranjo estiver
// quebrado (psql, template, ordem dos passos), todo mutante aparece como morto.
{
  const banco = `cp064_${Math.random().toString(36).slice(2, 10)}`;
  psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${banco} TEMPLATE ${TEMPLATE}`]);
  try {
    psql(`${BASE}/${banco}`, ["-f", ALVO]);
    psql(`${BASE}/${banco}`, ["-f", TESTE]);
    console.log("controle positivo ok (a 064 intacta deixa a suite verde)");
  } catch (e) {
    console.error(`CONTROLE POSITIVO FALHOU: ${linhaDoErro(e.stderr)}`);
    process.exit(1);
  } finally {
    psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`]);
  }
}

console.log(`\nrodando ${mutantes.length} mutantes...\n`);

const resultados = mutantes.map((m) => {
  const r = rodarMutante(m);
  const marca =
    r.estado === "morto"
      ? "MORTO    "
      : r.estado === "SOBREVIVEU" && r.sobrevivePorConstrucao
        ? "sobrevive"
        : r.estado === "SOBREVIVEU"
          ? "SOBREVIVEU"
          : "ANCORA   ";
  console.log(`${marca} ${r.nome}`);
  console.log(`          ${r.detalhe}`);
  return r;
});

const ancoras = resultados.filter((r) => r.estado === "ANCORA MORTA");
const inesperados = resultados.filter(
  (r) => r.estado === "SOBREVIVEU" && !r.sobrevivePorConstrucao
);
const esperados = resultados.filter(
  (r) => r.estado === "SOBREVIVEU" && r.sobrevivePorConstrucao
);
const mortos = resultados.filter((r) => r.estado === "morto");

console.log(
  `\nplacar: ${mortos.length} mortos, ${esperados.length} sobreviventes DECLARADOS, ` +
    `${inesperados.length} sobreviventes inesperados, ${ancoras.length} ancoras mortas`
);

psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`]);

if (ancoras.length || inesperados.length) process.exit(1);
