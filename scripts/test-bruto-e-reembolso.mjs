// =====================================================
// PULODOGATO - DESPESAS EM BRUTO + REEMBOLSO PREVISTO EM RECEITAS (HMO-364)
// =====================================================
//   npm run test:bruto-e-reembolso
//
// As fases F1b + F3 + F5 da HMO-360 vao no mesmo release, e o plano aprovado diz
// por que:
//
//   > Com a regra do pagador, a aba Despesas passa a contar bruto. Se o
//   > reembolso previsto nao entrar em Receitas no mesmo release, o Previsto de
//   > Despesas infla sem contrapartida e o usuario ve uma divida que nao e dele.
//   > F1 e F3 vao juntas ou nao vao.
//
// Esta suite e quem mede a TRAVA. As duas metades estao cobertas em separado --
// `test:regra-do-pagador` (21 blocos, 14 mutantes) tem a regra,
// `test:credito-de-grupo` (17 blocos, 12 mutantes) tem o credito,
// `test:telas-de-movimentacao` tem a soma no «Previsto» --, e nenhuma das tres
// ve a coisa que quebra se as fases se separarem: a RECONCILIACAO entre os dois
// cartoes de duas telas diferentes.
//
// AS DUAS PERNAS SAO AFIRMADAS EM SEPARADO, E NUNCA O LIQUIDO
// ----------------------------------------------------------
// Este e o requisito de medicao da issue, e ele e a familia de
// `duas-pernas-mantem-o-total-certo`: o bruto de Despesas e o reembolso de
// Receitas SE ANULAM por construcao. Uma assercao sobre
// "Despesas menos Receitas" fica verde com as duas parcelas infladas -- que foi
// exatamente como a transferencia de duas pernas somou R$ 1.000 em Receitas e
// R$ 1.000 em Despesas por meses em producao, com o saldo exato ao lado.
//
// Entao cada numero tem assercao propria, e o liquido entra DEPOIS, como terceira
// assercao, so para provar que a soma fecha.
//
// O CONTROLE NEGATIVO E A F3 DESLIGADA
// ------------------------------------
// "O Previsto de Despesas subiu" e "o Previsto de Receitas subiu" passariam
// verdes de graca se o fixture nao tivesse conta de grupo nenhuma, ou se a
// medicao nao enxergasse o que mudou. O controle e rodar o MESMO cenario pela
// funcao que esta em producao nas outras quatro leituras
// (`previstasComAMinhaParte`) e exigir que o numero seja DIFERENTE -- e menor,
// na direcao que a F1b promete. Sem esse par, "tudo verde" nao distingue
// "consertado" de "nao medi nada" (`mutantes-e-controle-negativo`).
//
// NENHUM NUMERO ESPERADO SAI DE UMA SEGUNDA IMPLEMENTACAO
// ------------------------------------------------------
// O reembolso nao e escrito a mao no lado de Receitas: ele sai de `fecharMes` +
// `creditoAReceber` + `notaDoCreditoAReceber`, as mesmas funcoes que a rota
// chama. Escrever "300" direto ali faria a suite concordar consigo mesma --
// `conferidor-que-usa-o-mesmo-extrator-nos-dois-lados-passa-vacuo` --, e o
// R$ 300 do grupo 70/30 deixaria de ser medido: ele seria uma constante.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const RAIZ = "../.tmp-bruto-e-reembolso/lib";

// A REGRA DO PAGADOR (F1b) e a funcao que ela SUBSTITUIU nesta leitura. As duas
// importadas, nunca descritas de memoria: a segunda e o controle negativo, e uma
// copia do comportamento dela escrita aqui ficaria verde depois de alguem mudar
// o original.
const { previstasPelaRegraDoPagador } = await import(
  `${RAIZ}/regra-do-pagador.js`
);
const {
  previstasComAMinhaParte,
  montarParticipantesPorGrupo,
  parteConfiguradaDoMembro,
} = await import(`${RAIZ}/parte-do-grupo.js`);

// Os tres numeros da tela, pelas funcoes da rota.
const { linhasDaTela, resumoDaTela, resumoComReembolsoPrevisto } = await import(
  `${RAIZ}/telas-de-movimentacao.js`
);

// O credito (F3), pelas funcoes da rota.
const { fecharMes, linhaDoPrevisto } = await import(
  `${RAIZ}/fechamento-do-grupo.js`
);
const { creditoAReceber, notaDoCreditoAReceber } = await import(
  `${RAIZ}/credito-de-grupo.js`
);

const EU = "11111111-0000-0000-0000-000000000001";
const LETICIA = "22222222-0000-0000-0000-000000000002";
const CASA = "44444444-0000-0000-0000-000000000004";

/** O mes do fixture. Cravado: nada aqui depende de "hoje". */
const MES = "2026-03";
const VENCE = "2026-03-10";

// ---------------------------------------------------------------------------
// O CENARIO: UMA conta de grupo de R$ 1.000, num grupo 70/30, QUE EU PAGO
// ---------------------------------------------------------------------------
// O menor cenario em que as duas fases tem efeito oposto e mensuravel. A minha
// parte e 70%, entao os numeros sao redondos e distintos: 1000 de bruto, 700 de
// parte, 300 de reembolso. Tres numeros diferentes -- um fixture 50/50 faria
// "metade" e "o resto" coincidirem e um erro de lado passaria verde
// (`caso-da-issue-nao-distingue-floor-de-round`).
const PESOS = montarParticipantesPorGrupo([
  { group_id: CASA, user_id: EU, id: "m1", percentage: 70, status: "active" },
  {
    group_id: CASA,
    user_id: LETICIA,
    id: "m2",
    percentage: 30,
    status: "active",
  },
]);

/** Os membros como `fecharMes` os pede -- o peso vem do mesmo 70/30. */
const MEMBROS_DO_FECHAMENTO = [
  { user_id: EU, full_name: "Helio", peso: 70 },
  { user_id: LETICIA, full_name: "Leticia", peso: 30 },
];

/**
 * A conta do grupo como a view `scheduled_transactions_effective` a entrega.
 *
 * `amount` e STRING porque o PostgREST entrega `numeric(15,2)` assim, e e o
 * formato em que a regra do pagador recebe a linha na rota. Um fixture com
 * `amount: 1000` nao mediria a conversao.
 */
const CONTA_DO_GRUPO = {
  id: "prev-aluguel",
  description: "Aluguel",
  amount: "1000.00",
  due_date: VENCE,
  status: "pending",
  effective_status: "pending",
  direction: "expense",
  group_id: CASA,
  // QUEM LANCOU -- e o campo inteiro da F1b. Sou EU: eu fronto a conta.
  user_id: EU,
};

/** Uma despesa pessoal, para o fixture nao ser so grupo. */
const DESPESA_PESSOAL = {
  id: "prev-luz",
  description: "Luz",
  amount: "200.00",
  due_date: VENCE,
  status: "pending",
  effective_status: "pending",
  direction: "expense",
  group_id: null,
  user_id: EU,
};

/** Uma receita prevista propria, para o «Previsto» de Receitas nao ser zero. */
const RECEITA_PROPRIA = {
  id: "prev-salario",
  description: "Salário",
  amount: "5000.00",
  due_date: VENCE,
  status: "pending",
  effective_status: "pending",
  direction: "income",
  group_id: null,
  user_id: EU,
};

const AGENDA = [CONTA_DO_GRUPO, DESPESA_PESSOAL, RECEITA_PROPRIA];

/** Nenhuma realizada no fixture: o que esta em jogo e o PREVISTO. */
const SEM_FIXAS = new Set();

/**
 * O "Previsto" de uma tela, pelo caminho da rota: regra -> linhas -> resumo.
 *
 * `regra` e a funcao de divisao que esta ligada, e e o parametro que o controle
 * negativo troca. Tudo o mais e identico nas duas voltas -- se a medicao
 * mudasse junto, a comparacao mediria a medicao.
 */
function previstoDaTela(tipo, regra, reembolso = null) {
  const previstas = regra(AGENDA, PESOS, EU);
  const linhas = linhasDaTela([], previstas, tipo, SEM_FIXAS, EU);
  return resumoComReembolsoPrevisto(resumoDaTela(linhas), tipo, reembolso);
}

/**
 * O reembolso previsto do mes, pelas funcoes da rota de credito.
 *
 * Nenhum valor esperado e escrito aqui: a conta de grupo entra em `fecharMes`
 * pela mesma `linhaDoPrevisto` que `lerCreditoDosGrupos` usa, e o 300 cai do
 * 70/30 sozinho.
 */
function reembolsoDoMes() {
  const linhas = [linhaDoPrevisto(CONTA_DO_GRUPO)].filter(Boolean);
  const fechamento = fecharMes(linhas, MEMBROS_DO_FECHAMENTO, MES);
  const credito = creditoAReceber(
    [{ grupo: { id: CASA, nome: "Casa" }, fechamento }],
    EU
  );
  return { credito, nota: notaDoCreditoAReceber(credito) };
}

// ---------------------------------------------------------------------------
// 0. O CONTROLE DE VACUIDADE: o fixture TEM conta de grupo e ela TEM peso
// ---------------------------------------------------------------------------
// Sem isto, todo bloco abaixo pode passar verde medindo um fixture vazio: um
// `group_id` com typo, um peso que `divisaoDoPeriodo` descartasse, um `status`
// que saisse do previsto -- em qualquer desses casos bruto e liquido coincidem
// e as assercoes de diferenca nao existem para falhar.
test("o fixture divide de verdade: a minha parte de R$ 1.000 e R$ 700", () => {
  assert.equal(
    parteConfiguradaDoMembro(CONTA_DO_GRUPO.amount, CASA, PESOS, EU),
    700,
    "o rateio nao aconteceu -- o resto da suite mediria bruto contra bruto"
  );
});

// ---------------------------------------------------------------------------
// 1. DESPESAS: o BRUTO, e o controle negativo da F1b
// ---------------------------------------------------------------------------
test("Despesas conta a conta de grupo que EU fronto INTEIRA -- R$ 1.200", () => {
  const despesas = previstoDaTela("expense", previstasPelaRegraDoPagador);

  // 1000 do grupo + 200 da luz. A pergunta e "quanto sai da minha conta", e no
  // dia 10 sai a conta inteira do aluguel.
  assert.equal(despesas.previsto, 1200);

  // E o reembolso NAO abate daqui: "quanto sai da minha conta" nao desconta
  // promessa. Quem desconta e o safe-to-spend, que e outra pergunta.
  assert.equal(despesas.reembolso_previsto, null);
});

test("CONTROLE NEGATIVO da F1b: pela regra antiga o mesmo mes da R$ 900", () => {
  const antes = previstoDaTela("expense", previstasComAMinhaParte);

  // 700 (a minha parte do aluguel) + 200. E o numero que as outras QUATRO
  // leituras continuam dando -- ver o bloco 4.
  assert.equal(antes.previsto, 900);

  // A PROVA DE QUE A MEDICAO VE A MUDANCA: o Previsto de Despesas SUBIU, e
  // subiu exatamente a parte da Leticia. Sem esta assercao, "Despesas = 1200"
  // passaria verde numa arvore em que nada foi ligado.
  const depois = previstoDaTela("expense", previstasPelaRegraDoPagador);
  assert.ok(
    depois.previsto > antes.previsto,
    "a F1b nao mudou nada: a leitura nao esta ligada na regra do pagador"
  );
  assert.equal(depois.previsto - antes.previsto, 300);
});

// ---------------------------------------------------------------------------
// 2. RECEITAS: o reembolso previsto, em assercao PROPRIA
// ---------------------------------------------------------------------------
test("o reembolso do mes sai do fechamento, e e a parte da Leticia", () => {
  const { credito, nota } = reembolsoDoMes();

  assert.equal(credito.total, 300, "o credito do 70/30 e a parte do outro");
  assert.equal(credito.linhas.length, 1, "uma linha, uma devedora");
  assert.equal(credito.linhas[0].devedor_user_id, LETICIA);
  // Zero sobra sem devedor: o mes fecha. Um residuo aqui significaria que parte
  // do meu credito nao tem a quem cobrar, e o total do cartao deixaria de ser a
  // soma das linhas que a pessoa consegue apontar.
  assert.equal(credito.sem_devedor, 0);
  assert.deepEqual(nota, { total: 300, quantos: 1, grupos: 1 });
});

test("Receitas soma o reembolso no PREVISTO e nao toca o realizado", () => {
  const { nota } = reembolsoDoMes();
  const receitas = previstoDaTela("income", previstasPelaRegraDoPagador, nota);

  // 5000 do salario + 300 de reembolso.
  assert.equal(receitas.previsto, 5300);

  // O REALIZADO FICA ZERO. E a recusa que o cabecalho de lib/credito-de-grupo.ts
  // escreve: credito sobre conta que ninguem pagou nao e receita recebida.
  assert.equal(receitas.realizado, 0);
  assert.equal(receitas.total, 5300);

  // E ele vai DITO, ou o cartao sobe R$ 300 sem rotulo (fase F5).
  assert.deepEqual(receitas.reembolso_previsto, nota);

  // A CONTAGEM NAO SOBE: o reembolso nao e linha da lista. Com 1 previsto de
  // receita no fixture, 2 aqui prometeria uma linha que a lista nao tem.
  assert.equal(receitas.quantidadePrevista, 1);
});

test("CONTROLE NEGATIVO da F3: sem o reembolso, Receitas fica em R$ 5.000", () => {
  // A F3 DESLIGADA, que e o estado que o plano proibe de ir sozinho para
  // producao. O Previsto de Despesas ja subiu 300 (bloco 1) e aqui NADA sobe --
  // a divida que nao e minha, medida.
  const semF3 = previstoDaTela("income", previstasPelaRegraDoPagador, null);
  assert.equal(semF3.previsto, 5000);
  assert.equal(semF3.reembolso_previsto, null);

  const { nota } = reembolsoDoMes();
  const comF3 = previstoDaTela("income", previstasPelaRegraDoPagador, nota);
  assert.ok(
    comF3.previsto > semF3.previsto,
    "a F3 nao mudou nada: o reembolso nao chega ao cartao Previsto"
  );
  assert.equal(comF3.previsto - semF3.previsto, 300);
});

// ---------------------------------------------------------------------------
// 3. A SOMA FECHA -- e esta e a TERCEIRA assercao, nunca a unica
// ---------------------------------------------------------------------------
test("bruto menos reembolso = o liquido de antes: o par nao move o resultado", () => {
  const { nota } = reembolsoDoMes();

  const despesasDepois = previstoDaTela(
    "expense",
    previstasPelaRegraDoPagador
  ).previsto;
  const receitasDepois = previstoDaTela(
    "income",
    previstasPelaRegraDoPagador,
    nota
  ).previsto;

  const despesasAntes = previstoDaTela("expense", previstasComAMinhaParte)
    .previsto;
  const receitasAntes = previstoDaTela("income", previstasComAMinhaParte, null)
    .previsto;

  // 1200 - 5300 = -4100 = 900 - 5000. As duas parcelas mudaram e o resultado
  // nao -- que e EXATAMENTE por que esta assercao nao pode ser a unica: ela
  // ficaria verde com o par inteiro errado, desde que errado dos dois lados.
  assert.equal(
    despesasDepois - receitasDepois,
    despesasAntes - receitasAntes,
    "o par bruto+reembolso mexeu no resultado do mes -- as duas fases nao se " +
      "anulam, e uma delas esta somando no lugar errado"
  );

  // O CONTROLE DA ASSERCAO DE CIMA: as duas parcelas DE FATO mudaram. Sem isto
  // a igualdade passa verde numa arvore em que nada foi ligado (os quatro
  // numeros seriam os mesmos dois).
  assert.notEqual(despesasDepois, despesasAntes);
  assert.notEqual(receitasDepois, receitasAntes);
});

// ---------------------------------------------------------------------------
// 4. AS OUTRAS QUATRO LEITURAS NAO MUDARAM
// ---------------------------------------------------------------------------
// A secao 4 do plano da HMO-360 decidiu NAO reverter a HMO-306/308: o painel do
// Papel de Pao, o safe-to-spend, o resumo das contas previstas e a previsao do
// painel continuam contando a MINHA PARTE. As quatro chamam
// `parteConfiguradaDoMembro` direto -- nenhuma delas passa por
// `previstasComAMinhaParte` nem pela regra do pagador --, entao o que prova a
// invariancia e o valor que essa funcao devolve para a MESMA linha do fixture.
//
// A fiacao (que nenhuma das quatro importou o modulo novo) e afirmada em
// test-contrato-das-telas-de-movimentacao.mjs, sobre o fonte das rotas: aqui
// nao ha como ver um import.
test("as quatro leituras conservadoras continuam em R$ 700 para a mesma linha", () => {
  assert.equal(
    parteConfiguradaDoMembro(CONTA_DO_GRUPO.amount, CASA, PESOS, EU),
    700,
    "a divisao mudou -- a HMO-306/308 foi revertida sem decisao"
  );

  // E a linha PESSOAL atravessa as duas regras sem ser tocada, nas duas
  // direcoes: foi assim que a HMO-303 quase dividiu a conta de luz.
  for (const regra of [previstasComAMinhaParte, previstasPelaRegraDoPagador]) {
    const [, luz] = regra(AGENDA, PESOS, EU);
    assert.equal(luz.amount, "200.00", "a despesa pessoal foi mexida");
  }
});

// ---------------------------------------------------------------------------
// 5. A CONTA QUE A LETICIA FRONTA: o outro ramo da regra, na mesma tela
// ---------------------------------------------------------------------------
// Sem este bloco a suite mede UM ramo da F1b e o mutante que devolve "sempre o
// valor cheio" sobrevive -- ele acertaria o fixture inteiro.
test("a conta que a Leticia lanca entra pela MINHA parte, e nao inteira", () => {
  const dela = { ...CONTA_DO_GRUPO, id: "prev-dela", user_id: LETICIA };
  const previstas = previstasPelaRegraDoPagador([dela], PESOS, EU);
  const linhas = linhasDaTela([], previstas, "expense", SEM_FIXAS, EU);

  assert.equal(resumoDaTela(linhas).previsto, 700);
  assert.equal(
    previstas[0].pagar_para,
    LETICIA,
    "sem `pagar_para` a conta da outra pessoa se le como conta propria"
  );
});
