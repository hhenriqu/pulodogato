#!/usr/bin/env node
// =====================================================
// PULODOGATO - TESTES DE PREVISTO x REALIZADO (HMO-186)
// =====================================================
//   npm run test:previsto-x-realizado
//
// Exercita lib/previsto-x-realizado.ts -- quem soma a agenda de um periodo e
// quem compara o que ele prometia com o que aconteceu.
//
// -----------------------------------------------------------------------
// O que estes testes existem para pegar
// -----------------------------------------------------------------------
// Nenhum dos defeitos abaixo levanta excecao. Todos produzem um bloco que
// carrega, com numeros no formato certo, e uma conclusao falsa sobre o dinheiro
// de quem esta olhando:
//
//   - o previsto que zera no fim do mes. Se `paid` sair da conta, no dia 30 --
//     quando toda conta prevista ja foi paga -- o bloco fecha o mes em
//     "previsto R$ 0,00 x realizado R$ 6.000". E o UNICO momento em que a
//     comparacao tem todos os dados, e ela vira "R$ 6.000 acima do previsto".
//     Parece problema de dados, e e de definicao;
//
//   - a receita prevista contada como despesa. `scheduled_transactions.amount`
//     tem CHECK amount > 0: a direcao nao esta no sinal. Um `?? "expense"`
//     calado joga o salario para o lado das saidas e o resultado previsto erra
//     pelo DOBRO do salario -- e o numero continua plausivel, com cara de "o
//     mes fecha no vermelho";
//
//   - a diferenca com o sinal ao contrario. `previsto - realizado` em vez de
//     `realizado - previsto` inverte as tres linhas de uma vez. Nenhum total
//     muda: so a leitura, de "gastei mais" para "gastei menos";
//
//   - a barra fora de escala. Duas barras na mesma linha desenhadas com
//     divisores diferentes mostram o numero MENOR como a barra maior. E o tipo
//     de erro que ninguem confere, porque a barra e justamente o atalho de quem
//     nao quer ler os numeros;
//
//   - o zero que se passa por previsao. Agenda vazia contra R$ 4.000
//     realizados se le como "R$ 4.000 acima do previsto". O que houve foi
//     ausencia de previsao, e as duas coisas nao sao a mesma.
//
// Os numeros esperados abaixo foram escritos a mao a partir da regra, nao
// colados da saida das funcoes: um teste gravado do proprio codigo prova apenas
// que ele continua fazendo o que ja faz.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  STATUS_FORA_DO_PREVISTO,
  compararPrevistoRealizado,
  copiaDaPrevisao,
  somarAgenda,
  somarMesesPrevistos,
} = await import("../.tmp-previsto-x-realizado/previsto-x-realizado.js");

/** Uma linha de agenda com o minimo preenchido. */
const linha = (amount, direcao, status = "pending") => ({
  amount,
  direcao,
  status,
});

/** Acha uma das tres linhas da comparacao pela chave. */
const acha = (comparacao, chave) =>
  comparacao.linhas.find((l) => l.chave === chave);

// ---------------------------------------------------------------------------
// somarAgenda: entradas, despesas e resultado
// ---------------------------------------------------------------------------

test("separa receita prevista de despesa prevista", () => {
  const previsto = somarAgenda([
    linha(5000, "income"),
    linha(1200, "expense"),
    linha(800, "expense"),
  ]);

  assert.equal(previsto.entradas, 5000);
  assert.equal(previsto.despesas, 2000);
  assert.equal(previsto.resultado, 3000);
  assert.equal(previsto.quantidade, 3);
});

test("a agenda so de despesa da resultado previsto NEGATIVO", () => {
  // O caso comum de quem nao cadastra o salario como regra recorrente. O
  // resultado tem que sair negativo mesmo: e o que a agenda dela diz.
  const previsto = somarAgenda([linha(1200, "expense"), linha(300, "expense")]);

  assert.equal(previsto.entradas, 0);
  assert.equal(previsto.despesas, 1500);
  assert.equal(previsto.resultado, -1500);
});

test("conta prevista JA PAGA continua dentro do previsto", () => {
  // O defeito que uma allow-list de `pending` criaria: no fim do mes tudo esta
  // pago e o previsto do mes seria zero. Ver STATUS_FORA_DO_PREVISTO.
  const previsto = somarAgenda([
    linha(5000, "income", "paid"),
    linha(1200, "expense", "paid"),
  ]);

  assert.equal(previsto.entradas, 5000);
  assert.equal(previsto.despesas, 1200);
  assert.equal(previsto.resultado, 3800);
  assert.equal(previsto.quantidade, 2);
});

test("pulada e cancelada saem do previsto, e saem da contagem tambem", () => {
  const previsto = somarAgenda([
    linha(1000, "expense", "pending"),
    linha(400, "expense", "skipped"),
    linha(700, "expense", "cancelled"),
    linha(2000, "income", "skipped"),
  ]);

  // So a primeira linha entrou.
  assert.equal(previsto.despesas, 1000);
  assert.equal(previsto.entradas, 0);
  assert.equal(previsto.resultado, -1000);
  // A contagem importa por si: e ela que decide se o bloco mostra a comparacao
  // ou diz "nao havia previsao". Somar zero e contar 4 faria o bloco afirmar
  // que existiam quatro compromissos previstos de R$ 0,00.
  assert.equal(previsto.quantidade, 1);
});

test("os dois status excluidos sao exatamente pulada e cancelada", () => {
  // Fixado em assercao porque a lista e uma decisao de PRODUTO, nao um detalhe:
  // acrescentar um status aqui apaga dinheiro do previsto de todo mundo, e
  // remover um faz o mes fechar em zero. Ver o cabecalho da constante.
  assert.deepEqual(
    [...STATUS_FORA_DO_PREVISTO].sort(),
    ["cancelled", "skipped"]
  );
});

test("status desconhecido CONTA, em vez de desaparecer calado", () => {
  // Deny-list e nao allow-list: um status novo no enum entra no previsto e
  // aparece errado (visivel, corrigivel) em vez de ser omitido do total
  // (invisivel). Com allow-list, o dinheiro sumiria sem nenhum sintoma.
  const previsto = somarAgenda([linha(900, "expense", "qualquer_coisa_nova")]);

  assert.equal(previsto.despesas, 900);
  assert.equal(previsto.quantidade, 1);
});

test("valor negativo que escapa vira despesa positiva, nao credito", () => {
  // O CHECK do banco garante amount > 0, mas esta funcao tambem soma valores
  // que passaram por outra rota. Um negativo sem ABS seria uma despesa que
  // AUMENTA o resultado previsto.
  const previsto = somarAgenda([linha(-1200, "expense")]);

  assert.equal(previsto.despesas, 1200);
  assert.equal(previsto.resultado, -1200);
});

test("valor em texto e valor ausente nao contaminam a soma", () => {
  // O PostgREST devolve numeric como string. E `null` chegando de um campo que
  // o tipo diz obrigatorio viraria NaN, que se propaga por toda a soma e
  // imprime "R$ NaN" nas tres linhas.
  const previsto = somarAgenda([
    linha("1500.50", "income"),
    linha(null, "expense"),
    linha("nao-e-numero", "expense"),
  ]);

  assert.equal(previsto.entradas, 1500.5);
  assert.equal(previsto.despesas, 0);
  assert.equal(previsto.resultado, 1500.5);
});

test("a soma fecha no centavo, sem residuo de ponto flutuante", () => {
  // 0.1 + 0.2 em binario da 0.30000000000000004, e o Intl imprimiria R$ 0,30 --
  // escondendo o residuo ate ele se acumular o suficiente para a soma das
  // parcelas nao fechar com o total na tela.
  const previsto = somarAgenda([
    linha(0.1, "expense"),
    linha(0.2, "expense"),
  ]);

  assert.equal(previsto.despesas, 0.3);
});

test("agenda vazia da zero em tudo, e quantidade zero", () => {
  const previsto = somarAgenda([]);

  assert.deepEqual(previsto, {
    entradas: 0,
    despesas: 0,
    resultado: 0,
    quantidade: 0,
  });
});

// ---------------------------------------------------------------------------
// somarMesesPrevistos: o periodo de varios meses
// ---------------------------------------------------------------------------

const mes = (income, expense, count) => ({
  expected_income: income,
  expected_expense: expense,
  expected_count: count,
});

test("soma os meses do periodo em vez de escolher um deles", () => {
  // O defeito da HMO-173 era `find` pelo mes corrente. Um periodo de tres meses
  // tem que somar os tres.
  const previsto = somarMesesPrevistos([
    mes(5000, 3000, 4),
    mes(5000, 3500, 5),
    mes(5000, 2800, 3),
  ]);

  assert.equal(previsto.entradas, 15000);
  assert.equal(previsto.despesas, 9300);
  assert.equal(previsto.resultado, 5700);
  assert.equal(previsto.quantidade, 12);
});

test("o resultado do periodo e recalculado, nao herdado do mes", () => {
  // De proposito NAO existe `expected_result` na entrada: se um mes chegasse com
  // um resultado inconsistente com as proprias parcelas, somar aquele campo
  // carregaria a inconsistencia para o total do periodo. Aqui o resultado sai
  // sempre de entradas - despesas.
  const previsto = somarMesesPrevistos([
    { ...mes(1000, 400, 2), expected_result: 999999 },
  ]);

  assert.equal(previsto.resultado, 600);
});

test("mes com campos em texto, e lista vazia", () => {
  const emTexto = somarMesesPrevistos([mes("1000.25", "400.25", "2")]);
  assert.equal(emTexto.entradas, 1000.25);
  assert.equal(emTexto.despesas, 400.25);
  assert.equal(emTexto.resultado, 600);
  assert.equal(emTexto.quantidade, 2);

  assert.deepEqual(somarMesesPrevistos([]), {
    entradas: 0,
    despesas: 0,
    resultado: 0,
    quantidade: 0,
  });
});

// ---------------------------------------------------------------------------
// compararPrevistoRealizado: as tres linhas
// ---------------------------------------------------------------------------

const PREVISTO = {
  entradas: 5000,
  despesas: 3000,
  resultado: 2000,
  quantidade: 6,
};

const REALIZADO = { entradas: 4800, despesas: 4200, resultado: 600 };

test("as tres linhas vem na ordem da tela, com os rotulos da tela", () => {
  const c = compararPrevistoRealizado(PREVISTO, REALIZADO);

  assert.deepEqual(
    c.linhas.map((l) => l.chave),
    ["entradas", "despesas", "resultado"]
  );
  assert.deepEqual(
    c.linhas.map((l) => l.rotulo),
    ["Entradas", "Despesas", "Resultado"]
  );
});

test("a diferenca e realizado MENOS previsto nas tres linhas", () => {
  const c = compararPrevistoRealizado(PREVISTO, REALIZADO);

  // Escritas a mao a partir da regra. A ordem invertida daria +200/-1200/+1400
  // e o bloco leria "entrou mais, gastei menos" num mes em que entrou menos e
  // gastou mais -- sem nenhum total mudar de valor.
  assert.equal(acha(c, "entradas").diferenca, -200);
  assert.equal(acha(c, "despesas").diferenca, 1200);
  assert.equal(acha(c, "resultado").diferenca, -1400);
});

test("a diferenca fecha no centavo", () => {
  // 0.3 - 0.1 em binario da 0.19999999999999998. Sem o arredondamento a tela
  // imprimiria R$ 0,20 igual -- e o residuo so apareceria no dia em que alguem
  // somasse as diferencas das tres linhas e o total nao fechasse.
  const c = compararPrevistoRealizado(
    { entradas: 0.1, despesas: 0, resultado: 0.1, quantidade: 1 },
    { entradas: 0.3, despesas: 0, resultado: 0.3 }
  );

  assert.equal(acha(c, "entradas").diferenca, 0.2);
});

test("'mais e melhor' vale para entradas e resultado, e nao para despesas", () => {
  const c = compararPrevistoRealizado(PREVISTO, REALIZADO);

  // A cor do bloco sai deste campo. Invertido na linha de despesas, gastar
  // R$ 1.200 acima do previsto apareceria em verde.
  assert.equal(acha(c, "entradas").maiorEMelhor, true);
  assert.equal(acha(c, "despesas").maiorEMelhor, false);
  assert.equal(acha(c, "resultado").maiorEMelhor, true);
});

test("os valores passam inteiros, sem recalculo de um lado pelo outro", () => {
  // `resultado` do realizado vem do `net` de monthly_cash_flow. Se esta funcao
  // o refizesse como entradas - despesas, o bloco passaria a discordar dos
  // tiles "Entrou" e "Saiu" no dia em que a view mudasse o que considera
  // receita. O 999 abaixo nao fecha com as parcelas de proposito.
  const c = compararPrevistoRealizado(PREVISTO, {
    entradas: 4800,
    despesas: 4200,
    resultado: 999,
  });

  assert.equal(acha(c, "resultado").realizado, 999);
  assert.equal(acha(c, "resultado").previsto, 2000);
});

// ---------------------------------------------------------------------------
// As barras
// ---------------------------------------------------------------------------

test("as duas barras da linha usam a MESMA escala", () => {
  // Despesa realizada de 4200 contra 3000 previstos: a maior enche a barra, a
  // menor fica em 3000/4200. Escalas separadas (cada barra sobre o proprio
  // valor) deixariam as duas cheias e a comparacao viraria decoracao.
  const c = compararPrevistoRealizado(PREVISTO, REALIZADO);
  const despesas = acha(c, "despesas");

  assert.equal(despesas.proporcaoRealizado, 1);
  assert.equal(despesas.proporcaoPrevisto, 3000 / 4200);
});

test("estouro nao satura: o previsto encolhe, o realizado enche", () => {
  // O motivo de nao usar o <Progress> do painel. Com progresso, gastar o dobro
  // do previsto desenha a mesma barra cheia de quem gastou exatamente o
  // previsto.
  const c = compararPrevistoRealizado(
    { entradas: 0, despesas: 1000, resultado: -1000, quantidade: 1 },
    { entradas: 0, despesas: 2000, resultado: -2000 }
  );
  const despesas = acha(c, "despesas");

  assert.equal(despesas.proporcaoRealizado, 1);
  assert.equal(despesas.proporcaoPrevisto, 0.5);
});

test("par de negativos escala pelo ABSOLUTO, sem proporcao invertida", () => {
  // A linha de resultado e onde os dois numeros podem ser negativos. Dividir
  // pelo maior valor COM sinal (-500 > -2000) daria proporcao 4 para o -2000 e
  // uma barra de 400% de largura.
  const c = compararPrevistoRealizado(
    { entradas: 0, despesas: 500, resultado: -500, quantidade: 1 },
    { entradas: 0, despesas: 2000, resultado: -2000 }
  );
  const resultado = acha(c, "resultado");

  assert.equal(resultado.proporcaoRealizado, 1);
  assert.equal(resultado.proporcaoPrevisto, 0.25);
});

test("previsto positivo contra realizado negativo compara os tamanhos", () => {
  // Prometia sobrar R$ 1.000 e fechou R$ 500 no vermelho. As barras mostram os
  // tamanhos; quem diz que um e prejuizo e o numero, ja impresso ao lado.
  const c = compararPrevistoRealizado(
    { entradas: 2000, despesas: 1000, resultado: 1000, quantidade: 2 },
    { entradas: 500, despesas: 1000, resultado: -500 }
  );
  const resultado = acha(c, "resultado");

  assert.equal(resultado.proporcaoPrevisto, 1);
  assert.equal(resultado.proporcaoRealizado, 0.5);
  assert.equal(resultado.diferenca, -1500);
});

test("par de zeros da duas barras vazias, nunca NaN", () => {
  // `NaN` em `width: NaN%` nao da erro: o navegador descarta a declaracao e a
  // barra fica com a largura que o CSS anterior deixou.
  const c = compararPrevistoRealizado(
    { entradas: 0, despesas: 0, resultado: 0, quantidade: 1 },
    { entradas: 0, despesas: 0, resultado: 0 }
  );

  for (const l of c.linhas) {
    assert.equal(l.proporcaoPrevisto, 0, `${l.chave} previsto`);
    assert.equal(l.proporcaoRealizado, 0, `${l.chave} realizado`);
    assert.ok(
      Number.isFinite(l.proporcaoPrevisto) &&
        Number.isFinite(l.proporcaoRealizado),
      `${l.chave} tem proporcao nao finita`
    );
  }
});

test("nenhuma proporcao passa de 1 nem fica negativa", () => {
  const casos = [
    [PREVISTO, REALIZADO],
    [
      { entradas: 1, despesas: 9999, resultado: -9998, quantidade: 1 },
      { entradas: 9999, despesas: 1, resultado: 9998 },
    ],
    [
      { entradas: 0, despesas: 0, resultado: 0, quantidade: 1 },
      { entradas: 100, despesas: 0, resultado: 100 },
    ],
  ];

  for (const [p, r] of casos) {
    for (const l of compararPrevistoRealizado(p, r).linhas) {
      for (const prop of [l.proporcaoPrevisto, l.proporcaoRealizado]) {
        assert.ok(prop >= 0 && prop <= 1, `${l.chave}: proporcao ${prop}`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// semPrevisao: o zero que nao e previsao
// ---------------------------------------------------------------------------

test("agenda vazia marca semPrevisao, mesmo com realizado cheio", () => {
  const c = compararPrevistoRealizado(
    { entradas: 0, despesas: 0, resultado: 0, quantidade: 0 },
    { entradas: 6000, despesas: 2000, resultado: 4000 }
  );

  assert.equal(c.semPrevisao, true);
});

test("uma unica linha na agenda JA e previsao", () => {
  const c = compararPrevistoRealizado(
    { entradas: 0, despesas: 1200, resultado: -1200, quantidade: 1 },
    { entradas: 6000, despesas: 2000, resultado: 4000 }
  );

  assert.equal(c.semPrevisao, false);
});

test("previsto todo zerado mas com linhas NAO e ausencia de previsao", () => {
  // O caso que separa "nao havia previsao" de "a previsao era zero": uma conta
  // prevista de R$ 0,00 existe na agenda (a view do 008 ja produziu linha
  // zerada antes -- ver a 008 sem CHECK sobre amount). Tratar os dois como o
  // mesmo caso esconderia a linha zerada.
  const c = compararPrevistoRealizado(
    { entradas: 0, despesas: 0, resultado: 0, quantidade: 3 },
    { entradas: 100, despesas: 50, resultado: 50 }
  );

  assert.equal(c.semPrevisao, false);
});

test("periodo no futuro: previsto cheio contra realizado zerado", () => {
  // Navegar para novembro. Nada foi realizado, e isso e o estado do mundo, nao
  // um dado faltando -- o bloco mostra previsto integral e diferenca igual ao
  // previsto com o sinal trocado.
  const c = compararPrevistoRealizado(PREVISTO, {
    entradas: 0,
    despesas: 0,
    resultado: 0,
  });

  assert.equal(c.semPrevisao, false);
  assert.equal(acha(c, "entradas").diferenca, -5000);
  assert.equal(acha(c, "despesas").diferenca, -3000);
  assert.equal(acha(c, "resultado").diferenca, -2000);
  // Nas tres linhas a barra do realizado fica vazia e a do previsto cheia.
  for (const l of c.linhas) {
    assert.equal(l.proporcaoRealizado, 0, `${l.chave} realizado`);
    assert.equal(l.proporcaoPrevisto, 1, `${l.chave} previsto`);
  }
});

test("previsto igual ao realizado da diferenca zero nas tres linhas", () => {
  const igual = { entradas: 5000, despesas: 3000, resultado: 2000 };
  const c = compararPrevistoRealizado({ ...igual, quantidade: 4 }, igual);

  for (const l of c.linhas) {
    assert.equal(l.diferenca, 0, `${l.chave}`);
    assert.equal(l.proporcaoPrevisto, 1, `${l.chave} previsto`);
    assert.equal(l.proporcaoRealizado, 1, `${l.chave} realizado`);
  }
});

// ---------------------------------------------------------------------------
// COMO A TELA FALA DE UMA LINHA DA AGENDA (HMO-188)
// ---------------------------------------------------------------------------

test("receita prevista se confirma RECEBENDO, nao pagando", () => {
  // Era o defeito que a HMO-188 nomeia: "Marcar como paga" sobre um salario
  // previsto. E o erro nao e so de palavra -- ele esconde que a lista tem duas
  // coisas diferentes, e quem ve o salario com um botao de "pagar" conclui que
  // cadastrou errado.
  const receita = copiaDaPrevisao("income");
  assert.equal(receita.confirmar, "Confirmar recebimento");
  assert.equal(receita.rotulo, "a receber");
  assert.equal(receita.verbo, "receber");
  assert.match(receita.efeito, /entra no saldo/);

  const despesa = copiaDaPrevisao("expense");
  assert.equal(despesa.confirmar, "Marcar como paga");
  assert.equal(despesa.rotulo, "a pagar");
  assert.equal(despesa.verbo, "pagar");
  assert.match(despesa.efeito, /sai do saldo/);
});

test("direcao ausente ou desconhecida cai em DESPESA", () => {
  // O lado seguro. Ler uma despesa como receita mostraria "vou receber" sobre
  // uma conta a pagar; e 'expense' e o default historico da rota de baixa, entao
  // a tela concorda com o que o banco faria.
  for (const entrada of [undefined, null, "", "transfer", "qualquer-coisa"]) {
    assert.equal(
      copiaDaPrevisao(entrada).confirmar,
      "Marcar como paga",
      `direcao ${JSON.stringify(entrada)} deveria cair em despesa`
    );
  }
});
