// Testes de lib/categorias-do-periodo.ts -- HMO-201, parte 3.
//
// Este modulo existe porque o painel do grupo precisa perguntar por um periodo
// de datas qualquer, e nenhuma view mensal responde isso. A soma passa a ser
// feita no JavaScript -- e e ai que as regras que o banco aplicava calado
// precisam ser repetidas na mao. Cada assercao aqui e uma dessas regras.

import test from "node:test";
import assert from "node:assert/strict";

const { linhasDeCategoria, CATEGORIA_AUSENTE } = await import(
  "../.tmp-categorias-do-periodo/categorias-do-periodo.js"
);

const acharCategoria = (linhas, id, moeda = "BRL") =>
  linhas.find((l) => l.category_id === id && l.currency === moeda);

test("soma despesas da mesma categoria", () => {
  const linhas = linhasDeCategoria([
    { category_id: "mercado", amount: -100, transaction_type: "expense" },
    { category_id: "mercado", amount: -50.5, transaction_type: "expense" },
  ]);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].expense, 150.5);
  assert.equal(linhas[0].income, 0);
  assert.equal(linhas[0].transaction_count, 2);
});

test("despesa negativa vira gasto POSITIVO", () => {
  // Neste banco a despesa e gravada negativa. Somar cru devolveria -150 e a
  // pizza desenharia fatia negativa -- ou nenhuma.
  const linhas = linhasDeCategoria([
    { category_id: "mercado", amount: -150, transaction_type: "expense" },
  ]);
  assert.equal(linhas[0].expense, 150);
});

test("receita e despesa da mesma categoria nao se misturam", () => {
  const linhas = linhasDeCategoria([
    { category_id: "casa", amount: -300, transaction_type: "expense" },
    { category_id: "casa", amount: 100, transaction_type: "income" },
  ]);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].expense, 300);
  assert.equal(linhas[0].income, 100);
  assert.equal(linhas[0].transaction_count, 2);
});

// ---------------------------------------------------------------------------
// A REGRA QUE O BANCO APLICAVA E QUE PRECISA SER REPETIDA AQUI
// ---------------------------------------------------------------------------

test("transferencia fica FORA da conta e fora da contagem", () => {
  // As duas pernas de uma transferencia -- e as duas de um pagamento de fatura
  // -- se anulam no total, entao um relatorio que as inclui continua com o
  // saldo certo. O que ele estraga e "quanto entrou" e "quanto saiu": os dois
  // inflam juntos, e a categoria de transferencia vira a maior fatia da pizza.
  const linhas = linhasDeCategoria([
    { category_id: "mercado", amount: -100, transaction_type: "expense" },
    { category_id: "transf", amount: -500, transaction_type: "transfer" },
    { category_id: "transf", amount: 500, transaction_type: "transfer" },
  ]);
  assert.equal(linhas.length, 1);
  assert.equal(linhas[0].category_id, "mercado");
  assert.equal(
    acharCategoria(linhas, "transf"),
    undefined,
    "a categoria de transferencia nao pode aparecer no relatorio"
  );
});

test("tipo desconhecido tambem fica de fora", () => {
  // Nao e defensividade vazia: o app ja ganhou tipos novos antes, e o padrao
  // certo e ignorar em vez de contar como despesa.
  const linhas = linhasDeCategoria([
    { category_id: "x", amount: -10, transaction_type: "coisa_nova" },
    { category_id: "x", amount: -10, transaction_type: null },
  ]);
  assert.equal(linhas.length, 0);
});

// ---------------------------------------------------------------------------
// MOEDA
// ---------------------------------------------------------------------------

test("a mesma categoria em duas moedas vira DUAS linhas", () => {
  // Sem a moeda na chave, 1000 reais + 180 dolares viram 1180 -- um numero que
  // nao esta em moeda nenhuma, com cara de total e para MAIS. E o defeito que
  // a migration 022 foi a producao corrigir nas views; ele volta por esta
  // porta se a chave for so a categoria.
  const linhas = linhasDeCategoria([
    {
      category_id: "hotel",
      amount: -1000,
      transaction_type: "expense",
      currency: "BRL",
    },
    {
      category_id: "hotel",
      amount: -180,
      transaction_type: "expense",
      currency: "USD",
    },
  ]);
  assert.equal(linhas.length, 2);
  assert.equal(acharCategoria(linhas, "hotel", "BRL").expense, 1000);
  assert.equal(acharCategoria(linhas, "hotel", "USD").expense, 180);
  assert.equal(
    linhas.find((l) => l.expense === 1180),
    undefined,
    "reais e dolares nunca podem cair na mesma linha"
  );
});

test("sem moeda na linha, cai no padrao", () => {
  const linhas = linhasDeCategoria([
    { category_id: "x", amount: -10, transaction_type: "expense" },
  ]);
  assert.equal(linhas[0].currency, "BRL");

  const emDolar = linhasDeCategoria(
    [{ category_id: "x", amount: -10, transaction_type: "expense" }],
    "USD"
  );
  assert.equal(emDolar[0].currency, "USD");
});

// ---------------------------------------------------------------------------
// LANCAMENTO SEM CATEGORIA
// ---------------------------------------------------------------------------

test("lancamento sem categoria aparece, em vez de sumir", () => {
  // ATENCAO ao ler este teste: `financial_transactions.category_id` e NOT NULL
  // hoje, entao esta entrada NAO e alcancavel pelo app. Isto nao fixa um
  // defeito existente -- fixa a ESCOLHA de, se a coluna um dia afrouxar, o
  // dinheiro continuar na tela em vez de sumir. Descartar faria o total por
  // categoria ficar menor que o do fluxo de caixa do mesmo periodo, sem que o
  // usuario tivesse como saber em qual dos dois acreditar.
  const linhas = linhasDeCategoria([
    { category_id: null, amount: -40, transaction_type: "expense" },
    { category_id: "mercado", amount: -60, transaction_type: "expense" },
  ]);
  const total = linhas.reduce((s, l) => s + l.expense, 0);
  assert.equal(total, 100, "nenhum centavo pode desaparecer do relatorio");
  assert.equal(acharCategoria(linhas, CATEGORIA_AUSENTE).expense, 40);
});

// ---------------------------------------------------------------------------
// BORDAS
// ---------------------------------------------------------------------------

test("lista vazia devolve lista vazia, nao quebra", () => {
  assert.deepEqual(linhasDeCategoria([]), []);
});

test("valor em string e somado como numero", () => {
  // O supabase-js devolve `numeric` do Postgres como string. Concatenar em vez
  // de somar daria "-100-50" e um NaN logo depois.
  const linhas = linhasDeCategoria([
    { category_id: "x", amount: "-100.00", transaction_type: "expense" },
    { category_id: "x", amount: "-50.00", transaction_type: "expense" },
  ]);
  assert.equal(linhas[0].expense, 150);
});

test("centavos nao acumulam residuo de ponto flutuante", () => {
  const linhas = linhasDeCategoria([
    { category_id: "x", amount: -0.1, transaction_type: "expense" },
    { category_id: "x", amount: -0.2, transaction_type: "expense" },
  ]);
  assert.equal(linhas[0].expense, 0.3);
});

// ---------------------------------------------------------------------------
// O LANCAMENTO FORA DOS TOTAIS (HMO-453, F3 da HMO-443)
// ---------------------------------------------------------------------------
// Esta funcao e o gemeo em JavaScript de `category_monthly_totals`, e aquela
// view ganhou `AND t.include_in_total` na 060. As duas respondem a MESMA
// pergunta -- a view no ramo de MES inteiro, esta funcao no ramo de INTERVALO
// livre --, e consertar so uma faz "setembro inteiro" e "01/09 a 30/09" darem
// numeros diferentes, sem total nenhum para arbitrar.
//
// TODA FIXTURE DAQUI PARA BAIXO TEM UMA LINHA MARCADA E UMA NAO MARCADA. Com
// so um dos dois lados, o filtro pode ser APAGADO e a assercao continua verde
// -- o sobrevivente que ninguem ve.

test("a linha desmarcada nao entra no gasto da categoria", () => {
  const linhas = linhasDeCategoria([
    { category_id: "x", amount: -100, transaction_type: "expense", include_in_total: true },
    { category_id: "x", amount: -400, transaction_type: "expense", include_in_total: false },
  ]);
  assert.equal(linhas[0].expense, 100);
  // 500 e o numero de antes da feature: se ele aparecer, o filtro nao esta la.
  assert.notEqual(linhas[0].expense, 500);
});

test("a linha desmarcada sai TAMBEM da contagem, como na view", () => {
  // O filtro entra onde a 060 o pos: no `WHERE`, e nao em cada `FILTER (WHERE
  // ...)`. Uma categoria que diz "2 lancamentos" ao lado de um total de um e a
  // contradicao visivel que nada na pizza explica.
  const linhas = linhasDeCategoria([
    { category_id: "x", amount: -100, transaction_type: "expense", include_in_total: true },
    { category_id: "x", amount: -400, transaction_type: "expense", include_in_total: false },
  ]);
  assert.equal(linhas[0].transaction_count, 1);
});

test("a receita desmarcada tambem sai -- e o caso que abriu a HMO-443", () => {
  // "adicionei um ajuste na minha conta investimento, ela entrou como uma
  // receita de ajuste mas nao quero que ela fique somada nos totais."
  const linhas = linhasDeCategoria([
    { category_id: "inv", amount: 250, transaction_type: "income", include_in_total: true },
    { category_id: "inv", amount: 1000, transaction_type: "income", include_in_total: false },
  ]);
  assert.equal(linhas[0].income, 250);
  assert.equal(linhas[0].transaction_count, 1);
});

test("o campo AUSENTE conta, que e o comportamento de antes da 060", () => {
  // A janela entre o deploy e a colagem, e o cache offline de antes da feature:
  // nos dois o campo chega `undefined`, e `undefined` tem de significar "soma"
  // -- o DEFAULT da coluna. Com `=== true` no lugar do `!== false` este numero
  // viraria ZERO e o relatorio inteiro esvaziaria, sem erro nenhum.
  const linhas = linhasDeCategoria([
    { category_id: "x", amount: -80, transaction_type: "expense" },
    { category_id: "x", amount: -20, transaction_type: "expense", include_in_total: null },
  ]);
  assert.equal(linhas[0].expense, 100);
  assert.equal(linhas[0].transaction_count, 2);
});

test("a linha desmarcada nao apaga a categoria inteira da pizza", () => {
  // Uma categoria que fica SO com linha desmarcada sai da lista (nao ha mais o
  // que somar nela), mas uma categoria com as duas continua -- com o numero
  // menor. O defeito oposto seria a categoria desaparecer por ter uma linha
  // marcada, que e o que um `filter` posto na chave do Map produziria.
  const linhas = linhasDeCategoria([
    { category_id: "fica", amount: -10, transaction_type: "expense", include_in_total: true },
    { category_id: "fica", amount: -90, transaction_type: "expense", include_in_total: false },
    { category_id: "sai", amount: -70, transaction_type: "expense", include_in_total: false },
  ]);
  assert.equal(linhas.length, 1);
  assert.equal(acharCategoria(linhas, "fica").expense, 10);
  assert.equal(acharCategoria(linhas, "sai"), undefined);
});
