#!/usr/bin/env node
// Prova de mutacao da 033 (HMO-202). NAO roda em CI: e ferramenta de quem esta
// escrevendo o teste. Cada entrada estraga UMA decisao da migration; o
// database/tests/033_minha_parte_no_realizado_test.sql tem que ficar VERMELHO
// em todas. Mutante que sobrevive e uma decisao que nenhuma assercao distingue
// -- ou codigo morto.
//
// Precisa de um Postgres alcancavel. Por padrao usa o local:
//   PGURL=postgresql://postgres:postgres@127.0.0.1:5432 node scripts/mutantes-minha-parte-no-realizado.mjs
//
// POR QUE UM BANCO-TEMPLATE
// -------------------------
// O harness da 024 sobe a cadeia 001 -> 024 inteira para cada mutante: ~15s
// cada, e a 033 esta nove migrations mais a frente. Aqui a cadeia 001 -> 032
// sobe UMA vez num template, e cada mutante sai de `CREATE DATABASE ...
// TEMPLATE` -- copia de arquivo, fracao de segundo.
//
// O template NAO TEM a 033, de proposito. Se ele a tivesse, cada mutante
// aplicaria a versao mutada por cima de views que ja existem na versao boa, e
// `CREATE OR REPLACE VIEW` sobre uma definicao que mudou de colunas falharia
// (ou pior: nao falharia, e o mutante mediria a view antiga). O placar sairia
// todo verde por um motivo que nao tem nada a ver com as assercoes.
//
// O template e recriado a cada execucao. Reaproveitar um template de uma
// execucao anterior parece economia e nao e: uma migration editada no meio do
// trabalho deixaria o template desatualizado, e o placar passaria a medir um
// schema que nao e mais o do repositorio.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.PGURL || "postgresql://postgres:postgres@127.0.0.1:5432";
const ALVO = "database/migrations/033_minha_parte_no_realizado.sql";
const TESTE = "database/tests/033_minha_parte_no_realizado_test.sql";
const TEMPLATE = `tpl_033_${process.pid}`;

const original = readFileSync(ALVO, "utf8");

const mutantes = [
  // -----------------------------------------------------------------------
  // O defeito original, de volta: a parte de grupo nao entra no realizado.
  // -----------------------------------------------------------------------
  [
    "a parte de grupo volta a nao entrar no realizado (o buraco da HMO-202)",
    "    UNION ALL\n\n    SELECT\n      g.user_id, g.month, g.category_id,\n      g.expense, g.income, g.transaction_count, g.currency\n    FROM public.group_share_category_monthly_totals g",
    "    UNION ALL\n\n    SELECT\n      g.user_id, g.month, g.category_id,\n      g.expense, g.income, g.transaction_count, g.currency\n    FROM public.group_share_category_monthly_totals g\n    WHERE FALSE",
  ],
  // O conserto ERRADO: tirar o filtro do lado pessoal. Quem pagou passa a ver
  // o valor cheio E a propria parte -- 600 numa despesa de 400.
  [
    "o lado pessoal deixa de filtrar group_id IS NULL (valor cheio + parte, dupla contagem)",
    "    FROM public.category_monthly_totals c\n    WHERE c.group_id IS NULL",
    "    FROM public.category_monthly_totals c",
  ],
  // A perna PESSOAL desaparece: toda despesa que nao e de grupo sai do painel.
  [
    "a perna pessoal do UNION ALL desaparece (so sobra o grupo)",
    "    FROM public.category_monthly_totals c\n    WHERE c.group_id IS NULL",
    "    FROM public.category_monthly_totals c\n    WHERE FALSE",
  ],

  // -----------------------------------------------------------------------
  // Decisao 1: o status do rateio
  // -----------------------------------------------------------------------
  // `= 'approved'` zera o realizado de grupo de todo mundo, porque o app cria
  // tudo como 'pending' e nada nunca aprova. O defeito que a 033 conserta,
  // vestido de rigor.
  [
    "so rateio APROVADO conta (zera o realizado de grupo de todo mundo)",
    "  WHERE es.status NOT IN ('rejected', 'expired')",
    "  WHERE es.status = 'approved'",
  ],
  // O bug oposto: quem RECUSOU a divisao continua pagando por ela.
  [
    "o status do rateio deixa de ser olhado (o recusado volta a contar)",
    "  WHERE es.status NOT IN ('rejected', 'expired')",
    "  WHERE es.status IS NOT NULL",
  ],
  [
    "o expirado volta a contar (so o rejeitado fica de fora)",
    "  WHERE es.status NOT IN ('rejected', 'expired')",
    "  WHERE es.status NOT IN ('rejected')",
  ],
  [
    "o pendente deixa de contar (e o estado em que o app grava TUDO)",
    "  WHERE es.status NOT IN ('rejected', 'expired')",
    "  WHERE es.status NOT IN ('rejected', 'expired', 'pending')",
  ],

  // -----------------------------------------------------------------------
  // Decisao 2: so DESPESA
  // -----------------------------------------------------------------------
  [
    "o filtro de transaction_type cai (parte de RECEITA vira despesa)",
    "    AND t.transaction_type = 'expense'",
    "    AND t.transaction_type IS NOT NULL",
  ],
  [
    "a parte passa a ser contada como RECEITA em vez de despesa",
    "    SUM(e.amount)::numeric(15,2)        AS expense,\n    0::numeric(15,2)                    AS income,",
    "    0::numeric(15,2)                    AS expense,\n    SUM(e.amount)::numeric(15,2)        AS income,",
  ],

  // -----------------------------------------------------------------------
  // Decisao 3: a moeda no grao
  // -----------------------------------------------------------------------
  [
    "a moeda da parte vira BRL fixo (dolar somado com real)",
    "    t.currency                                        AS currency,",
    "    'BRL'::text                                       AS currency,",
  ],
  [
    "a moeda sai do grao do rollup mensal da parte",
    "  GROUP BY e.user_id, e.group_id, e.month, e.category_id, e.currency;",
    "  GROUP BY e.user_id, e.group_id, e.month, e.category_id;",
  ],
  [
    "a moeda sai do grao da view pessoal por categoria",
    "  GROUP BY tudo.user_id, tudo.month, tudo.category_id, tudo.currency;",
    "  GROUP BY tudo.user_id, tudo.month, tudo.category_id;",
  ],
  [
    "a moeda sai do grao do fluxo pessoal",
    "  GROUP BY p.user_id, p.month, p.currency;",
    "  GROUP BY p.user_id, p.month;",
  ],

  // -----------------------------------------------------------------------
  // Decisao 4: o mes e o da DESPESA
  // -----------------------------------------------------------------------
  [
    "o mes passa a vir da criacao da parte (mes fechado muda de valor)",
    "    date_trunc('month', t.transaction_date)::date     AS month,",
    "    date_trunc('month', es.created_at)::date          AS month,",
  ],

  // -----------------------------------------------------------------------
  // A parte e LIDA, nunca recalculada
  // -----------------------------------------------------------------------
  // Os dois caminhos tentadores. Os dois empatam com o valor gravado quando a
  // divisao e exata, e perdem centavo quando nao e -- o bug que o 007 foi a
  // producao consertar.
  [
    "a parte passa a ser recalculada pela PORCENTAGEM (perde centavo)",
    "    es.amount                                         AS amount,",
    "    round(ABS(t.amount) * es.percentage / 100, 2)      AS amount,",
  ],
  [
    "a parte passa a ser o valor CHEIO da despesa",
    "    es.amount                                         AS amount,",
    "    ABS(t.amount)                                     AS amount,",
  ],

  // -----------------------------------------------------------------------
  // De quem e a parte
  // -----------------------------------------------------------------------
  // A parte vai para quem PAGOU em vez de para quem deve: o pagador volta a
  // ver o valor cheio (somando as partes) e quem nao pagou volta a ver zero.
  [
    "a parte e atribuida a quem PAGOU, nao a quem deve",
    "    em.user_id                                        AS user_id,",
    "    t.user_id                                         AS user_id,",
  ],
  // Filtrar por membro ativo reescreve o passado de quem saiu do grupo.
  [
    "so membro ATIVO tem parte (quem saiu perde o historico)",
    "  WHERE es.status NOT IN ('rejected', 'expired')\n    AND t.transaction_type = 'expense';",
    "  WHERE es.status NOT IN ('rejected', 'expired')\n    AND em.status = 'active'\n    AND t.transaction_type = 'expense';",
  ],

  // -----------------------------------------------------------------------
  // A contagem, que e o que faz a MEDIA existir
  // -----------------------------------------------------------------------
  [
    "a contagem da parte vira zero (media zerada com total cheio ao lado)",
    "    COUNT(*)                            AS transaction_count,",
    "    0::bigint                           AS transaction_count,",
  ],

  // -----------------------------------------------------------------------
  // O sinal do net
  // -----------------------------------------------------------------------
  [
    "o net pessoal inverte (receita - despesa viram despesa - receita)",
    "    (SUM(tudo.income) - SUM(tudo.expense))::numeric(15,2) AS net,",
    "    (SUM(tudo.expense) - SUM(tudo.income))::numeric(15,2) AS net,",
  ],

  // -----------------------------------------------------------------------
  // A RLS
  // -----------------------------------------------------------------------
  // Cada view, uma por uma: `security_invoker` nao e herdado, e perder a opcao
  // em QUALQUER camada faz a de cima ler com o privilegio do dono.
  [
    "group_share_entries perde security_invoker",
    "ALTER VIEW public.group_share_entries                 SET (security_invoker = true);",
    "-- mutante: sem security_invoker",
  ],
  [
    "personal_monthly_cash_flow perde security_invoker",
    "ALTER VIEW public.personal_monthly_cash_flow          SET (security_invoker = true);",
    "-- mutante: sem security_invoker",
  ],
  [
    "personal_category_monthly_totals perde security_invoker",
    "ALTER VIEW public.personal_category_monthly_totals    SET (security_invoker = true);",
    "-- mutante: sem security_invoker",
  ],
  [
    "group_share_category_monthly_totals perde security_invoker",
    "ALTER VIEW public.group_share_category_monthly_totals SET (security_invoker = true);",
    "-- mutante: sem security_invoker",
  ],
  // NAO HA MUTANTE DE `anon` NESTA LISTA, e isso foi medido, nao esquecido.
  //
  // Escrevi dois e os dois sobreviveram. Investigando: eles sao EQUIVALENTES --
  // nao existe assercao capaz de mata-los, porque eles nao tem efeito nenhum.
  // As views sao `security_invoker`, entao quem le com o papel `anon` e barrado
  // na camada de baixo, onde o 002 ja revogou tudo de anon:
  //
  //   SET ROLE anon; SELECT ... FROM group_share_entries
  //     -> ERROR: permission denied for table group_expense_splits
  //   SET ROLE anon; SELECT ... FROM personal_monthly_cash_flow
  //     -> ERROR: permission denied for view category_monthly_totals
  //
  // Medido nas quatro views e nas quatro tabelas-base. Ou seja: o
  // `REVOKE ALL ... FROM anon` da 033 e higiene (ele impede que a view apareca
  // como legivel), nao e o que protege o dado -- quem protege e o 002, uma
  // camada abaixo. Um mutante que "abre" so a 033 nao abre nada.
  //
  // Deixar um mutante impossivel de matar na lista produziria um sobrevivente
  // permanente no placar, e sobrevivente que a gente aprendeu a ignorar e pior
  // do que nenhum: ele treina quem roda isto a nao ler a saida.
];

// ---------------------------------------------------------------------------
// O preflight nao e um mutante -- e uma assercao sobre a MENSAGEM
// ---------------------------------------------------------------------------
// Tentei primeiro como mutante e nao funciona, por uma razao que vale escrever:
// num banco ANTES da 022 a migration falha de qualquer jeito, com ou sem
// preflight, porque `t.currency` nao existe e o CREATE VIEW nao compila. Nao ha
// como o preflight "deixar o erro passar" -- entao nao ha mutante para matar.
//
// O que o preflight entrega nao e a PREVENCAO, e a LEGIBILIDADE: sem ele, quem
// aplicar a 033 num banco atrasado recebe `column t.currency does not exist` e
// vai procurar o erro na view; com ele, recebe a lista do que falta e a
// instrucao de rodar 001 -> 032 antes. Essa e a diferenca que o controle mede.
//
// Entao o controle e: num banco 001 -> 021 (sem a 022), a 033 falha E a
// mensagem e a NOSSA. As duas metades importam -- "falhou" sozinho passaria com
// o preflight apagado.
const PRE022 = `tpl_033_pre022_${process.pid}`;

// "001 -> 021" e uma REGRA sobre o numero, e tem de ser escrita como regra.
//
// Isto era a lista a mao `["022_", ..., "033_"]`, correta no dia em que a 033
// era a ultima migration da arvore. Quando a 034 entrou, ela deixou de ser
// filtrada e passou a ser aplicada sobre um banco parado na 021 -- e a 034
// adiciona o CHECK `currency = 'BRL'` numa coluna que a 022 cria. Resultado:
// `column "currency" does not exist`, o runner morria antes do primeiro
// mutante, e nada denunciou porque nenhum workflow o invocava (HMO-322).
// Enumerar o "depois da 022" obriga toda migration futura a se lembrar deste
// arquivo; comparar o numero nao obriga ninguem a nada.
const PRIMEIRA_EXCLUIDA = 22;
const ehDepoisDa022 = (m) => Number(m.slice(0, 3)) >= PRIMEIRA_EXCLUIDA;

const psql = (url, args) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", url, ...args], {
    stdio: "pipe",
    encoding: "utf8",
  });

const migrations = readdirSync("database/migrations")
  .filter((f) => /^0\d\d_/.test(f) && !f.startsWith("000_") && !f.startsWith("033_"))
  .sort();

function montarTemplate() {
  psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`]);
  psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${TEMPLATE}`]);
  const url = `${BASE}/${TEMPLATE}`;
  psql(url, ["-f", "database/tests/00_supabase_shim.sql"]);
  for (const m of migrations) psql(url, ["-f", `database/migrations/${m}`]);

  // O template nao pode ter a 033. Se tiver, cada mutante estaria sendo
  // aplicado por cima da versao boa e o placar seria ficcao.
  const sobrando = psql(url, [
    "-tAc",
    "SELECT count(*) FROM pg_class WHERE relname = 'personal_monthly_cash_flow'",
  ]).trim();
  if (sobrando !== "0") {
    throw new Error(
      `o template ${TEMPLATE} ja tem as views da 033 (${sobrando}) -- os mutantes mediriam a versao boa`
    );
  }
}

// O controle do preflight: 001 -> 021, sem a 022 e sem nada depois dela.
function controleDoPreflight() {
  psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${PRE022} WITH (FORCE)`]);
  psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${PRE022}`]);
  const url = `${BASE}/${PRE022}`;
  psql(url, ["-f", "database/tests/00_supabase_shim.sql"]);
  for (const m of migrations) {
    if (ehDepoisDa022(m)) continue;
    psql(url, ["-f", `database/migrations/${m}`]);
  }

  // A primeira metade: o banco e de verdade atrasado. Sem isto, "a 033 falhou"
  // poderia ser qualquer outra coisa.
  const temCurrency = psql(url, [
    "-tAc",
    "SELECT count(*) FROM information_schema.columns WHERE table_name = 'financial_transactions' AND column_name = 'currency'",
  ]).trim();
  if (temCurrency !== "0") {
    return `CONTROLE FALSO: o banco sem a 022 ja tem financial_transactions.currency`;
  }

  let erro = "";
  try {
    psql(url, ["-f", ALVO]);
    return "CONTROLE FALHOU: a 033 APLICOU num banco sem a 022";
  } catch (e) {
    erro = String(e.stderr || "");
  }

  if (!erro.includes("033 nao pode ser aplicado neste banco")) {
    return `CONTROLE FALHOU: a 033 recusou, mas com erro bruto em vez da mensagem do preflight -> ${erro
      .split("\n")
      .find((l) => l.includes("ERROR"))}`;
  }
  if (!erro.includes("financial_transactions.currency")) {
    return "CONTROLE FALHOU: o preflight nao nomeou a coluna que falta";
  }
  return null;
}

let sobreviventes = 0;
const dir = mkdtempSync(join(tmpdir(), "mut-033-"));

try {
  console.log("controle do preflight (banco 001 -> 021, sem a 022)...");
  const falhaDoControle = controleDoPreflight();
  if (falhaDoControle) {
    console.log(`CONTROLE  ${falhaDoControle}`);
    sobreviventes++;
  } else {
    console.log(
      "ok   a 033 recusa um banco sem a 022, com a mensagem do preflight e nomeando a coluna\n"
    );
  }

  console.log(`montando o template ${TEMPLATE} (001 -> 032, sem a 033)...`);
  montarTemplate();
  console.log(`template pronto. ${mutantes.length} mutantes.\n`);

  for (const [nome, de, para] of mutantes) {
    if (!original.includes(de)) {
      console.log(`??   ${nome}: o trecho procurado nao existe mais no arquivo`);
      sobreviventes++;
      continue;
    }

    const banco = `mut033_${Math.random().toString(36).slice(2, 10)}`;
    const mutado = join(dir, "033.sql");
    writeFileSync(mutado, original.replace(de, para));

    let vermelho = false;
    let detalhe = "";

    try {
      psql(`${BASE}/postgres`, [
        "-c",
        `CREATE DATABASE ${banco} TEMPLATE ${TEMPLATE}`,
      ]);
      const url = `${BASE}/${banco}`;

      // A migration mutada pode nem aplicar -- isso tambem e "vermelho", mas
      // por outro motivo, e vale distinguir no relatorio: um mutante que so
      // quebra a sintaxe nao prova nada sobre as assercoes.
      try {
        psql(url, ["-f", mutado]);
      } catch {
        vermelho = true;
        detalhe = "a migration mutada nem aplica";
      }

      if (!vermelho) {
        try {
          psql(url, ["-f", TESTE]);
        } catch (e) {
          vermelho = true;
          detalhe =
            String(e.stderr || "")
              .split("\n")
              .find((l) => l.includes("FALHA") || l.includes("ERROR")) ||
            "teste falhou";
        }
      }
    } finally {
      try {
        psql(`${BASE}/postgres`, [
          "-c",
          `DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`,
        ]);
      } catch {}
    }

    if (vermelho) {
      console.log(`ok   ${nome}\n       -> ${detalhe.trim().slice(0, 150)}`);
    } else {
      console.log(`VIVO ${nome} -- nenhuma assercao distingue isto`);
      sobreviventes++;
    }
  }
} finally {
  // O fonte NAO e tocado por este harness (a mutacao vai para um arquivo
  // temporario), entao nao ha o que restaurar -- mas o template e os bancos
  // ficariam ocupando disco. `process.exit()` dentro do try pularia este bloco:
  // o exit fica DEPOIS dele, de proposito.
  for (const banco of [TEMPLATE, PRE022]) {
    try {
      psql(`${BASE}/postgres`, [
        "-c",
        `DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`,
      ]);
    } catch {}
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log(
  sobreviventes === 0
    ? `\nTodos os ${mutantes.length} mutantes morreram.`
    : `\n${sobreviventes} de ${mutantes.length} mutantes SOBREVIVERAM.`
);
process.exit(sobreviventes === 0 ? 0 : 1);
