#!/usr/bin/env node
// =============================================================================
// HMO-298 -- A MEDICAO DAS TRES LEITURAS DO "TOTAL DE CONTAS"
// =============================================================================
//   node scripts/medicao-hmo298.mjs
//
// 7/10 do plano da HMO-279. Este script NAO conserta nada e NAO afirma que o
// codigo esta certo ou errado: ele mede os tres numeros lado a lado e imprime
// a diferenca em reais. A pergunta que ele responde e a do usuario --
// "verificar se os valores esta trazendo somente o das despesas, pois
// aparentemente na conta da leticia esta trazendo valores errados" -- com
// numero, e nao com hipotese.
//
// AS TRES LEITURAS, E POR QUE SAO ESTAS TRES
// ------------------------------------------
//   1. `painelDePapel` (lib/papel-de-pao.ts) -- o "Total de contas" que o
//      Dashboard do modo Papel de Pao mostra. Le a agenda SEM filtro de
//      `user_id` (so a RLS filtra) e divide a linha de grupo por membros
//      ativos.
//   2. `/api/movimentacoes/resumo?tipo=expense` -- o "Previsto" da tela de
//      Despesas, pela mesma aritmetica pura que a rota usa
//      (`linhasDaTela` + `resumoDaTela`, lib/telas-de-movimentacao.ts). Filtra
//      por `user_id` e NAO traz `group_id` no select.
//   3. `ratearPorPeso` (lib/fechamento-do-grupo.ts) -- o numero que o
//      fechamento do grupo vai COBRAR de verdade, pelo `percentage` gravado
//      desde a HMO-269/270/271.
//
// AS FUNCOES SAO IMPORTADAS, NAO REESCRITAS
// -----------------------------------------
// Tudo abaixo chama o codigo compilado de lib/. Uma tabela construida sobre uma
// reimplementacao da conta mediria a reimplementacao: ela sairia bonita e nao
// diria nada sobre o que esta no ar. O que este arquivo faz de proprio e so
// montar os INSUMOS de cada leitura do jeito que a rota correspondente monta --
// e essa montagem esta anotada linha a linha, porque e ali que uma medicao
// desonesta se esconderia.
//
// O BANCO E REAL, A CONTA DE NINGUEM E
// ------------------------------------
// Postgres local, migrations reais (001 -> 041), RLS ligada e `auth.uid()` do
// shim. Producao e somente-leitura aqui e nenhum dado de usuario e tocado.
// Quem viu cada linha foi a RLS de verdade, e nao um `.filter()` deste script:
// e isso que torna o mecanismo (d) uma medicao e nao uma alegacao.
//
// O RELOGIO E CONGELADO
// ---------------------
// `HOJE` e uma constante. A janela do painel e mensal e este repositorio ja
// perdeu um dia para isso: a sandbox roda em America/Sao_Paulo e o CI em UTC, e
// um `today()` lido do relogio muda quais linhas caem dentro da janela
// dependendo de onde a suite rodou.
//
// O CONTROLE QUE DECIDE SE A TABELA VALE ALGUMA COISA
// ---------------------------------------------------
// Se as tres leituras concordarem em todas as linhas, a tabela nao provou o
// codigo -- provou que o fixture nao acende nada. Por isso o script SAI COM
// ERRO quando algum dos quatro mecanismos sai sem discordancia. Tabela toda
// verde aqui e defeito de fixture, nao noticia boa.
// =============================================================================

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPILADO = join(RAIZ, ".tmp-medicao-hmo298", "lib");

if (!existsSync(COMPILADO)) {
  console.error(
    "Falta compilar. Rode:\n" +
      "  npx tsc -p scripts/tsconfig.medicao-hmo298-test.json\n" +
      "  node scripts/resolve-aliases.mjs .tmp-medicao-hmo298 lib --espelha-raiz"
  );
  process.exit(1);
}

const { painelDePapel } = await import(join(COMPILADO, "papel-de-pao.js"));
const { contarMembrosAtivos } = await import(join(COMPILADO, "parte-do-grupo.js"));
const { agendaSemCompraNoCartao, sintetizarFaturasAbertas } = await import(
  join(COMPILADO, "agenda-do-cartao.js")
);
const { linhasDaTela, resumoDaTela } = await import(
  join(COMPILADO, "telas-de-movimentacao.js")
);
const { ratearPorPeso } = await import(join(COMPILADO, "fechamento-do-grupo.js"));

// -----------------------------------------------------------------------------
// As constantes do fixture. Mudaram la, mudam aqui.
// -----------------------------------------------------------------------------
const DB = process.env.HMO298_DB ?? "hmo298";
const EU = "e0000000-0000-0000-0000-0000000000e1";
const OUTRO = "b0000000-0000-0000-0000-0000000000b1";
const GRUPO = "a0000000-0000-0000-0000-00000000ca5a";

/** Relogio congelado -- ver o cabecalho. */
const HOJE = "2026-03-10";
/** A janela do mes medido, fechada nas duas pontas. */
const JANELA = { de: "2026-03-01", ate: "2026-03-31" };

// -----------------------------------------------------------------------------
// A ponte com o banco
// -----------------------------------------------------------------------------
// `psql` em vez de um driver: o repositorio nao tem cliente Postgres entre as
// dependencias e acrescentar um so para esta medicao seria uma dependencia nova
// numa filha que nao entrega codigo de producao. O `SET ROLE authenticated` +
// o claim `sub` sao exatamente o que o shim do Supabase le em auth.uid(), e e o
// que faz a RLS valer aqui.
function consultar(sql, comoUsuario = EU) {
  // UM SENTINEL, E NAO UMA CONTAGEM DE LINHAS. A saida do psql antes da
  // consulta tem um numero de linhas que depende de coisas que nao sao desta
  // medicao (o `SET` do SET ROLE, o retorno do set_config), e `json_agg` ainda
  // QUEBRA LINHA entre os elementos do array -- entao nem "a primeira linha"
  // nem "a ultima" identificam o JSON. Depois do sentinel, tudo o que vem e a
  // resposta, e ela se junta de volta numa string so.
  const script = `
    \\pset format unaligned
    \\pset tuples_only on
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claims',
      '{"sub":"${comoUsuario}","role":"authenticated"}', false);
    \\echo __RESPOSTA__
    ${sql}
  `;
  const saida = execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-d", DB],
    {
      input: script,
      encoding: "utf8",
      env: {
        ...process.env,
        PGUSER: process.env.PGUSER ?? "postgres",
        PGPASSWORD: process.env.PGPASSWORD ?? "postgres",
        PGHOST: process.env.PGHOST ?? "localhost",
      },
    }
  );
  const corte = saida.indexOf("__RESPOSTA__");
  if (corte < 0) throw new Error(`psql nao devolveu o sentinel:\n${saida}`);
  const json = saida
    .slice(corte + "__RESPOSTA__".length)
    .split("\n")
    .join("")
    .trim();
  return json ? JSON.parse(json) : [];
}

const reais = (centavos) => (centavos / 100).toFixed(2);
const brl = (valor) =>
  valor === null || valor === undefined
    ? "--"
    : `R$ ${Number(valor).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

// =============================================================================
// LEITURA 1 -- `painelDePapel`, o Dashboard do modo Papel de Pao
// =============================================================================
// Monta os insumos como app/api/papel-de-pao/painel/route.ts monta, na MESMA
// ordem (a ordem importa: a compra de cartao sai ANTES de a fatura entrar).
//
// A consulta e a da rota, campo por campo, e o que ela NAO tem e o ponto:
// nenhum `user_id = ...`. So a RLS filtra, e a RLS do 005 libera
// `group_id IS NOT NULL AND is_group_member(group_id)`.
function leituraDoPainel() {
  const linhasBrutas = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (
        SELECT s.due_date::text, s.amount, s.status, s.direction,
               s.category_id, s.group_id, s.notes,
               json_build_object('account_type', a.account_type) AS account
          FROM scheduled_transactions_effective s
          LEFT JOIN financial_accounts a ON a.id = s.account_id
         WHERE s.due_date >= '${JANELA.de}' AND s.due_date <= '${JANELA.ate}'
      ) t;
  `);

  // A compra de cartao sai (ela esta DENTRO da fatura); a fatura fechada FICA.
  const semCompraDeCartao = agendaSemCompraNoCartao(linhasBrutas);

  // A fatura ABERTA, sintetizada -- a segunda metade do mecanismo (b).
  // `faturasPrevistasDaJanela` faz estas duas consultas e chama esta mesma
  // funcao pura; aqui elas estao abertas para a de-duplicacao ficar visivel.
  const linhasDeFatura = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (
        SELECT account_id, account_name, invoice_month::text,
               invoice_due_date::text, invoice_amount
          FROM card_invoice_lines WHERE user_id = '${EU}'
      ) t;
  `);
  // As `notes` das previsoes JA gravadas. So a chave canonica
  // `fatura:AAAA-MM-01:<uuid>` de-duplica -- texto digitado a mao nao.
  const chavesPersistidas = consultar(`
    SELECT COALESCE(json_agg(notes), '[]')
      FROM scheduled_transactions
     WHERE user_id = '${EU}' AND notes IS NOT NULL;
  `);

  const { previstas } = sintetizarFaturasAbertas({
    linhas: linhasDeFatura,
    chavesPersistidas,
    de: JANELA.de,
    ate: JANELA.ate,
    hoje: HOJE,
  });

  const linhas = [...semCompraDeCartao, ...previstas];

  // Quantos membros ATIVOS cada grupo tem -- o divisor de `parteDoMembro`.
  const membros = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (SELECT group_id, status FROM group_members
             WHERE status = 'active') t;
  `);

  const categoriasDeSalario = consultar(`
    SELECT COALESCE(json_agg(id), '[]') FROM transaction_categories
     WHERE name = 'Salário';
  `);

  const painel = painelDePapel(linhas, {
    janela: JANELA,
    membrosAtivosPorGrupo: contarMembrosAtivos(membros),
    categoriasDeSalario,
  });

  return { painel, linhas, previstas };
}

// =============================================================================
// LEITURA 2 -- `/api/movimentacoes/resumo?tipo=expense`, a tela de Despesas
// =============================================================================
// A consulta e a da rota, e as DUAS diferencas que importam estao nela:
//   * `user_id = EU` -- a linha de grupo do outro membro nem chega;
//   * o select NAO traz `group_id` -- entao a MINHA linha de grupo chega
//     CHEIA, e nada depois dela sabe que havia o que dividir.
// Nenhuma das duas e corrigida aqui: corrigi-las seria medir outro codigo.
function leituraDaTelaDeDespesas() {
  const previstasCruas = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (
        SELECT s.id::text, s.description, s.amount, s.due_date::text, s.status::text,
               s.effective_status::text, s.currency, s.direction, s.notes,
               s.recurring_rule_id::text,
               json_build_object('name', c.name) AS category,
               json_build_object('id', a.id::text, 'name', a.name,
                                 'account_type', a.account_type) AS account
          FROM scheduled_transactions_effective s
          LEFT JOIN transaction_categories c ON c.id = s.category_id
          LEFT JOIN financial_accounts a ON a.id = s.account_id
         WHERE s.user_id = '${EU}'
           AND s.due_date >= '${JANELA.de}' AND s.due_date <= '${JANELA.ate}'
      ) t;
  `);

  const semCompraDeCartao = agendaSemCompraNoCartao(previstasCruas);

  // A MESMA fatura sintetizada da leitura 1: as duas telas a somam.
  const linhasDeFatura = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (
        SELECT account_id, account_name, invoice_month::text,
               invoice_due_date::text, invoice_amount
          FROM card_invoice_lines WHERE user_id = '${EU}'
      ) t;
  `);
  const chavesPersistidas = consultar(`
    SELECT COALESCE(json_agg(notes), '[]')
      FROM scheduled_transactions
     WHERE user_id = '${EU}' AND notes IS NOT NULL;
  `);
  const { previstas } = sintetizarFaturasAbertas({
    linhas: linhasDeFatura,
    chavesPersistidas,
    de: JANELA.de,
    ate: JANELA.ate,
    hoje: HOJE,
  });

  // O realizado nao entra nesta medicao: a pergunta e sobre o PREVISTO, que e
  // o "Total de contas". `linhasDaTela` recebe a lista vazia de realizadas.
  const linhas = linhasDaTela(
    [],
    [...semCompraDeCartao, ...previstas],
    "expense",
    new Set(),
    // Quem esta olhando (HMO-301). Esta medicao le o banco pelo psql e nao
    // tem sessao nenhuma: o `null` faz `posso_editar` cair para `false` em
    // toda linha, que e a direcao barata -- e nenhum dos tres numeros desta
    // medicao depende do campo.
    null
  );

  return { resumo: resumoDaTela(linhas), linhas };
}

// =============================================================================
// LEITURA 3 -- `ratearPorPeso`, o que o fechamento COBRA
// =============================================================================
// O peso e o `percentage` gravado em `group_members` -- a divisao configurada
// da HMO-269/270/271. E o unico dos tres numeros que corresponde a uma cobranca
// real: os outros dois sao o que a tela DIZ.
function leituraDoFechamento() {
  const pesos = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (SELECT user_id::text, percentage FROM group_members
             WHERE group_id = '${GRUPO}' AND status = 'active'
             ORDER BY user_id) t;
  `);
  const participantes = pesos.map((p) => ({
    user_id: p.user_id,
    peso: Number(p.percentage),
  }));

  // As despesas do grupo no mes, pelo valor CHEIO -- e isso que o fechamento
  // rateia.
  const despesas = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (
        SELECT description, amount FROM scheduled_transactions_effective
         WHERE group_id = '${GRUPO}' AND direction = 'expense'
           AND due_date >= '${JANELA.de}' AND due_date <= '${JANELA.ate}'
         ORDER BY description
      ) t;
  `);

  let meusCentavos = 0;
  const porDespesa = [];
  for (const d of despesas) {
    const totalCents = Math.round(Number(d.amount) * 100);
    const partes = ratearPorPeso(totalCents, participantes);
    const minha = partes.get(EU) ?? 0;
    meusCentavos += minha;
    porDespesa.push({ descricao: d.description, cheio: Number(d.amount), minha });
  }

  return { meusCentavos, porDespesa, participantes };
}

// =============================================================================
// A TABELA
// =============================================================================
const { painel, previstas } = leituraDoPainel();
const { resumo, linhas: linhasDaDespesa } = leituraDaTelaDeDespesas();
const fechamento = leituraDoFechamento();

/** O que uma descricao especifica contribuiu para cada leitura. */
const noPainel = (descricao) => {
  // Reconstroi a contribuicao de UMA linha ao total, pela mesma peneira do
  // painel: direction != income, dentro da janela, status valido.
  const todas = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (SELECT amount, group_id FROM scheduled_transactions_effective
             WHERE description = '${descricao}'
               AND due_date >= '${JANELA.de}' AND due_date <= '${JANELA.ate}') t;
  `);
  if (todas.length === 0) return 0;
  const membros = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (SELECT group_id, status FROM group_members WHERE status='active') t;
  `);
  const contagem = contarMembrosAtivos(membros);
  return todas.reduce((soma, l) => {
    const n = l.group_id ? (contagem.get(l.group_id) ?? 1) : 1;
    return soma + Math.abs(Number(l.amount)) / n;
  }, 0);
};

const naTelaDeDespesas = (descricao) =>
  linhasDaDespesa
    .filter((l) => l.descricao === descricao)
    .reduce((s, l) => s + Math.abs(l.valor), 0);

const LINHAS = [
  {
    mecanismo: "(a)",
    par: ["painel","tela"],
    caso: "Transferência prevista — «Reserva na poupança» R$ 500,00",
    painel: noPainel("Reserva na poupanca"),
    tela: naTelaDeDespesas("Reserva na poupanca"),
    cobrado: null,
    nota: "guardar na poupança entra no «Total de contas» como se fosse boleto; a tela de Despesas não a lista",
  },
  {
    mecanismo: "(b)",
    par: ["painel","cobrado"],
    caso: "Fatura do Nubank — R$ 800,00 de compras reais",
    painel:
      noPainel("Pagar fatura Nubank") +
      previstas.reduce((s, f) => s + f.amount, 0),
    tela:
      naTelaDeDespesas("Pagar fatura Nubank") +
      previstas.reduce((s, f) => s + f.amount, 0),
    cobrado: previstas.reduce((s, f) => s + f.amount, 0),
    nota: "a previsão digitada à mão não carrega a chave de fatura, então não de-duplica contra a fatura sintetizada: a mesma dívida em dois lugares, nas DUAS telas",
  },
  {
    mecanismo: "(c)",
    par: ["painel","cobrado"],
    caso: "Parte do grupo Casa (70/30) — R$ 4.000,00 de contas no mês",
    painel: noPainel("Aluguel da casa") + noPainel("Internet da casa"),
    tela: naTelaDeDespesas("Internet da casa"),
    cobrado: fechamento.meusCentavos / 100,
    nota: "o painel divide IGUAL (÷2); o fechamento cobra por PESO (30%). Quem tem 30% vê 50%",
  },
  {
    mecanismo: "(d)",
    par: ["painel","tela"],
    caso: "Conta de grupo do OUTRO membro — «Aluguel da casa» R$ 3.000,00",
    painel: noPainel("Aluguel da casa"),
    tela: naTelaDeDespesas("Aluguel da casa"),
    cobrado:
      (fechamento.porDespesa.find((d) => d.descricao === "Aluguel da casa")
        ?.minha ?? 0) / 100,
    nota: "o painel soma metade dela (a RLS a entrega); a tela de Despesas filtra por user_id e não lista nada dela",
  },
  {
    mecanismo: "(d)",
    par: ["painel","tela"],
    caso: "MINHA conta de grupo — «Internet da casa» R$ 1.000,00",
    painel: noPainel("Internet da casa"),
    tela: naTelaDeDespesas("Internet da casa"),
    cobrado:
      (fechamento.porDespesa.find((d) => d.descricao === "Internet da casa")
        ?.minha ?? 0) / 100,
    nota: "o painel divide; a tela de Despesas soma CHEIO, porque o select dela nem traz group_id",
  },
];

console.log("");
console.log("=".repeat(114));
console.log("HMO-298 -- AS TRES LEITURAS DO \"TOTAL DE CONTAS\", MEDIDAS");
console.log(`Postgres local, migrations 001->041, RLS ligada. Mês ${JANELA.de} a ${JANELA.ate}, hoje congelado em ${HOJE}.`);
console.log("=".repeat(114));
console.log("");

const col = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(
  col("mec", 5) + col("caso", 62) + col("painel", 14) + col("tela Despesas", 15) + col("cobrado", 14) + "dif. do par"
);
console.log("-".repeat(114));

// A DIFERENCA E A DO PAR DECLARADO, E NAO O MAIOR BURACO ENTRE AS TRES
// COLUNAS. Isto nao e detalhe de apresentacao -- e o que faz o controle medir o
// mecanismo que a linha diz medir. Medido: com o max-min das tres colunas, por
// o grupo em 50/50 (que APAGA o mecanismo (c), igualando painel e cobrado em
// R$ 2.000,00) deixava a linha (c) ainda "discordante" em R$ 1.000,00 -- porque
// a coluna da tela de Despesas carrega o defeito (d), que e OUTRO mecanismo.
// O controle passava verde sobre um fixture que tinha parado de acender (c).
let discordantes = new Set();
const mudas = [];
for (const l of LINHAS) {
  const [a, b] = l.par;
  const dif = Math.abs(l[a] - l[b]);
  if (dif > 0.004) discordantes.add(l.mecanismo);
  else mudas.push(l);
  console.log(
    col(l.mecanismo, 5) +
      col(l.caso, 62) +
      col(brl(l.painel), 14) +
      col(brl(l.tela), 15) +
      col(brl(l.cobrado), 14) +
      `${brl(dif)}  (${l.par[0]} x ${l.par[1]})`
  );
}

console.log("-".repeat(114));
console.log("");
for (const l of LINHAS) console.log(`  ${l.mecanismo} ${l.caso}\n      ${l.nota}\n`);

console.log("=".repeat(114));
console.log("OS TOTAIS DO MÊS");
console.log("=".repeat(114));
console.log(`  Salário Previsto (painel)        ${brl(painel.salario_previsto.total)}  (${painel.salario_previsto.quantidade} linha(s))`);
console.log(`  Receitas (painel)                ${brl(painel.receitas.total)}  (${painel.receitas.quantidade} linha(s))`);
console.log(`  TOTAL DE CONTAS (painel)         ${brl(painel.total_de_contas.total)}  (${painel.total_de_contas.quantidade} linha(s))`);
console.log(`  Previsto da tela de Despesas     ${brl(resumo.previsto)}`);
console.log(`  O que o grupo vai COBRAR de mim  ${brl(fechamento.meusCentavos / 100)}`);
console.log(`  «${painel.sobra_ou_falta.titulo}»  ${brl(painel.sobra_ou_falta.valor)}`);
console.log("");
console.log(
  `  Diferença entre o painel e a tela de Despesas: ${brl(
    Math.abs(painel.total_de_contas.total - resumo.previsto)
  )}`
);
console.log("");

// -----------------------------------------------------------------------------
// O CONTROLE. Ver o cabecalho: tabela toda verde e defeito de fixture.
// -----------------------------------------------------------------------------
// O CONTROLE E POR LINHA, E NAO POR MECANISMO.
// "Pelo menos uma linha por mecanismo discorda" e fraco demais: o mecanismo
// (d) tem DUAS faces (a linha do outro membro, que some da tela de Despesas, e
// a minha, que a tela soma cheia) e uma cobre a outra -- apagar a primeira
// deixaria o placar verde pela segunda, com metade do mecanismo sem medicao
// nenhuma. Exigir que TODA linha discorde e o que faz cada peca do fixture
// responder por si.
const ESPERADOS = ["(a)", "(b)", "(c)", "(d)"];
const semMecanismo = ESPERADOS.filter((m) => !discordantes.has(m));

if (mudas.length > 0) {
  console.error(
    "FALHA DE CONTROLE: estas linhas sairam sem discordancia nenhuma entre o " +
      "par que elas dizem medir:\n" +
      mudas
        .map((l) => `  ${l.mecanismo} ${l.caso}  [${l.par[0]} x ${l.par[1]}]`)
        .join("\n") +
      (semMecanismo.length > 0
        ? `\n  -> e com isso os mecanismos ${semMecanismo.join(", ")} ficaram SEM medicao.`
        : "") +
      "\n\nIsso NAO significa que o codigo esta certo -- significa que o " +
      "fixture parou de acender o que a tabela diz medir, e a tabela deixou " +
      "de ser evidencia."
  );
  process.exit(1);
}

console.log(
  `Controle: as ${LINHAS.length} linhas discordaram no par que cada uma mede, ` +
    `cobrindo os ${ESPERADOS.length} mecanismos (${ESPERADOS.join(", ")}).`
);
console.log("");
