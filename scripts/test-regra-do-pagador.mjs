#!/usr/bin/env node
// =====================================================
// PULODOGATO - a regra do pagador no previsto (HMO-363, F1 da HMO-360)
// =====================================================
// A conta do grupo Casa de R$ 1.000, num grupo 70/30 em que a MINHA parte e
// R$ 300, tem DUAS respostas certas no Previsto da aba Despesas, e qual delas
// vale depende de quem LANCOU:
//
//   eu lancei      -> R$ 1.000  (sai do meu cartao inteiro; os R$ 700 voltam
//                                como receita prevista, que e a F3)
//   ela lancou     -> R$   300  ("pagar para Leticia")
//
// `previstasComAMinhaParte`, que esta em producao, responde R$ 300 nos DOIS
// casos -- ela nunca olha `user_id`. O erro e silencioso e e para baixo: a tela
// diz que vou gastar R$ 300 num mes em que o cartao cobra R$ 1.000.
//
// O QUE ESTE ARQUIVO COBRA SAO ERROS QUE A TELA NAO MOSTRA
// -------------------------------------------------------
//   - a MINHA linha de grupo sendo rateada (o defeito de hoje). Numero
//     plausivel, formatado, e menor que a fatura;
//   - a linha da OUTRA pessoa contando bruto (o mesmo erro invertido): divida
//     que nao e minha, para cima;
//   - o `pagar_para` ausente ou apontando para mim. Sem ele a conta da Leticia
//     se le como conta propria, e a F2 nao tem nome para escrever;
//   - a linha PESSOAL sendo tocada. `Number(amount)` converteria a string do
//     PostgREST em number em toda linha da tela, por um caminho que nada mede;
//   - o grupo que a RLS nao me deixa ler virando divisao por palpite. Tem de
//     manter o valor CHEIO, porque custo subestimado alimenta o safe-to-spend;
//   - o sinal. A lista pinta pelo SINAL e formata com `Math.abs`, entao um
//     valor negativo aqui sai com o numero certo e a COR DE RECEITA;
//   - as outras quatro leituras mudando de numero. Esta fase prometeu nao
//     tocar nelas, e a secao final cobra isso de `previstasComAMinhaParte`.
//
// E AS DUAS PARCELAS SAO AFIRMADAS SEPARADAS, NUNCA O LIQUIDO
// -----------------------------------------------------------
// O par bruto+reembolso se anula: R$ 1.300 de Despesas menos R$ 700 de
// reembolso previsto e R$ 600, que e o mesmo liquido da regra de hoje. Um teste
// escrito sobre o liquido passaria verde com as duas parcelas erradas -- a
// familia de `duas-pernas-mantem-o-total-certo`. A secao "a conciliacao com a
// F3" afirma os tres numeros um por um e so depois mostra que fecham.
//
// A prova de que isto nao e fixture inocente esta em
// `scripts/mutantes-regra-do-pagador.mjs`.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { previstasPelaRegraDoPagador, euFrontoAConta } = await import(
  "../.tmp-regra-do-pagador/lib/regra-do-pagador.js"
);

// A funcao que esta em producao nas CINCO leituras. Importada, e nao descrita de
// memoria: a ultima secao afirma que ela continua respondendo o que respondia, e
// uma copia do comportamento esperado escrita aqui passaria verde mesmo depois
// de alguem mudar o original.
const { previstasComAMinhaParte, montarParticipantesPorGrupo } = await import(
  "../.tmp-regra-do-pagador/lib/parte-do-grupo.js"
);

const EU = "11111111-0000-0000-0000-000000000001";
const LETICIA = "22222222-0000-0000-0000-000000000002";
const CASA = "44444444-0000-0000-0000-000000000004";
const OPACO = "99999999-0000-0000-0000-000000000009";

// Grupo 70/30 com a MINHA parte em 30 -- os numeros do cabecalho de
// lib/parte-do-grupo.ts, para os dois arquivos falarem da mesma conta.
const PESOS = montarParticipantesPorGrupo([
  { group_id: CASA, user_id: EU, id: "a", percentage: 30, status: "active" },
  { group_id: CASA, user_id: LETICIA, id: "b", percentage: 70, status: "active" },
]);

/** A conta de R$ 1.000 do grupo, como o PostgREST a entrega: `amount` string. */
function contaDoGrupo(quemLancou) {
  return {
    id: `prev-${quemLancou}`,
    description: "Aluguel",
    amount: "1000.00",
    group_id: CASA,
    user_id: quemLancou,
  };
}

/** Uma previsao pessoal, fora de grupo. */
const PESSOAL = {
  id: "prev-pessoal",
  description: "Internet",
  amount: "120.00",
  group_id: null,
  user_id: EU,
};

// =====================================================
// 1. A LINHA QUE EU LANCEI: VALOR CHEIO
// =====================================================

test("a conta de grupo que EU lancei mantem o valor cheio", () => {
  const [linha] = previstasPelaRegraDoPagador([contaDoGrupo(EU)], PESOS, EU);

  assert.equal(linha.amount, "1000.00");
  assert.equal(linha.group_id, CASA, "o group_id sobrevive -- e dele que sai o rotulo");
});

test("a linha que eu lancei nao e nem recriada, e o amount continua string", () => {
  const entrada = contaDoGrupo(EU);
  const [linha] = previstasPelaRegraDoPagador([entrada], PESOS, EU);

  // A MESMA referencia. Recriar o objeto aqui nao mudaria numero nenhum hoje,
  // mas abriria o caminho de converter `amount` para number -- e o tipo da
  // coluna atravessa esta funcao inteira sem ser tocado por nenhum dos dois
  // ramos de passagem.
  assert.equal(linha, entrada);
  assert.equal(typeof linha.amount, "string");
});

test("a linha que eu lancei NAO ganha pagar_para", () => {
  const [linha] = previstasPelaRegraDoPagador([contaDoGrupo(EU)], PESOS, EU);

  // `in`, e nao `=== undefined`: o campo tem de estar AUSENTE. `pagar_para:
  // undefined` presente no objeto se serializa igual em JSON e faria a F2
  // tratar a minha propria conta como linha com destinatario desconhecido.
  assert.ok(
    !("pagar_para" in linha),
    "a minha propria conta nao tem para quem pagar"
  );
});

// =====================================================
// 2. A LINHA QUE A OUTRA PESSOA LANCOU: A MINHA PARTE, COM DESTINATARIO
// =====================================================

test("a conta de grupo que a Leticia lancou vale a MINHA parte", () => {
  const [linha] = previstasPelaRegraDoPagador([contaDoGrupo(LETICIA)], PESOS, EU);

  assert.equal(linha.amount, 300);
});

test("a linha da Leticia diz para QUEM eu pago", () => {
  const [linha] = previstasPelaRegraDoPagador([contaDoGrupo(LETICIA)], PESOS, EU);

  assert.equal(linha.pagar_para, LETICIA);
  assert.notEqual(linha.pagar_para, EU, "'pagar para voce' nao e uma frase");
});

test("a linha da Leticia e um objeto NOVO e a entrada nao e mutada", () => {
  const entrada = contaDoGrupo(LETICIA);
  const lista = [entrada];
  const [linha] = previstasPelaRegraDoPagador(lista, PESOS, EU);

  assert.notEqual(linha, entrada);
  assert.equal(entrada.amount, "1000.00", "a lista de entrada ficou intacta");
  assert.ok(!("pagar_para" in entrada));
});

test("o group_id e a descricao sobrevivem na linha rateada", () => {
  const [linha] = previstasPelaRegraDoPagador([contaDoGrupo(LETICIA)], PESOS, EU);

  // O `group_id` e o ROTULO: uma conta de R$ 300 que a pessoa nao lancou e
  // indistinguivel de bug sem ele. O resto do objeto atravessa pelo spread, e
  // perder um campo ali nao da erro -- da uma linha sem descricao na tela.
  assert.equal(linha.group_id, CASA);
  assert.equal(linha.description, "Aluguel");
  assert.equal(linha.id, `prev-${LETICIA}`);
});

// =====================================================
// 3. A LINHA PESSOAL NAO E TOCADA
// =====================================================

test("a previsao fora de grupo passa INTACTA, pela referencia", () => {
  const [linha] = previstasPelaRegraDoPagador([PESSOAL], PESOS, EU);

  assert.equal(linha, PESSOAL);
  assert.equal(typeof linha.amount, "string", "nao converter a string do PostgREST");
  assert.ok(!("pagar_para" in linha));
});

test("group_id vazio conta como fora de grupo", () => {
  // `""` e `undefined` caem no mesmo `!p.group_id` que o `null`. Um grupo de id
  // vazio nao existe, e tratar isso como grupo faria a linha ser consultada no
  // mapa pela chave "" -- que erra para o valor cheio, mas COM `pagar_para`.
  const vazio = { ...PESSOAL, group_id: "" };
  const semCampo = { id: "x", amount: "10.00", user_id: EU };

  const saida = previstasPelaRegraDoPagador([vazio, semCampo], PESOS, EU);

  assert.equal(saida[0], vazio);
  assert.equal(saida[1], semCampo);
});

test("a linha pessoal de quem NAO trouxe user_id tambem passa intacta", () => {
  // `user_id` e OPCIONAL no contrato deste modulo, e por isso esta linha nao e
  // academica: uma leitura que nao o selecione (a rota de Despesas o traz desde
  // a HMO-303, as outras nao precisam) entrega exatamente este objeto.
  //
  // E e aqui que o `!p.group_id` prova que e load-bearing. Sem ele, a linha
  // PESSOAL cai no caminho de calculo: `parteConfiguradaDoMembro` devolve o
  // valor cheio (grupo nulo), mas ja como `number`, e a linha ganha um
  // `pagar_para: null` -- uma despesa propria rotulada como divida com alguem
  // que o app nao soube nomear. Com `user_id: EU` o defeito fica INVISIVEL,
  // porque o ramo "eu fronto" devolve a linha intacta por outro motivo.
  const anonima = { id: "y", description: "Luz", amount: "55.00" };
  const anonimaSemGrupo = { ...anonima, group_id: null };

  const saida = previstasPelaRegraDoPagador([anonima, anonimaSemGrupo], PESOS, EU);

  assert.equal(saida[0], anonima);
  assert.equal(saida[1], anonimaSemGrupo);
  assert.equal(typeof saida[1].amount, "string");
  assert.ok(!("pagar_para" in saida[1]));
});

// =====================================================
// 4. O QUE EU NAO SEI
// =====================================================

test("sem saber quem sou eu, a lista passa inteira e intacta", () => {
  const daLeticia = contaDoGrupo(LETICIA);
  const lista = [PESSOAL, daLeticia];

  for (const ninguem of [null, undefined, ""]) {
    const saida = previstasPelaRegraDoPagador(lista, PESOS, ninguem);

    assert.equal(saida[0], PESSOAL);
    // Nem rateada nem rotulada: `pagar_para` apontaria para o dono da linha num
    // contexto em que esse dono pode ser eu mesmo.
    assert.equal(saida[1], daLeticia);
    assert.ok(!("pagar_para" in saida[1]));
  }
});

test("grupo que eu nao consigo ler mantem o valor CHEIO, e ainda assim diz o destinatario", () => {
  const opaca = { ...contaDoGrupo(LETICIA), group_id: OPACO };
  const [linha] = previstasPelaRegraDoPagador([opaca], PESOS, EU);

  // A RLS de `group_members` pode nao me deixar ler os membros de um grupo cuja
  // LINHA de despesa eu enxergo. Errar para cima e a escolha deste modulo:
  // custo subestimado alimenta o safe-to-spend e promete dinheiro que nao sobra.
  assert.equal(linha.amount, 1000);
  // E o destinatario continua dito -- o que falta e a FRACAO, nao a pessoa.
  assert.equal(linha.pagar_para, LETICIA);
});

test("linha de grupo sem dono legivel devolve pagar_para NULO, e nao ausente", () => {
  // AS TRES AUSENCIAS, e nao so a do `null`: `user_id` pode chegar `null` (coluna
  // nula), `undefined` (chave presente e sem valor) ou AUSENTE (a leitura nao o
  // selecionou). Afirmar so o `null` nao distingue `?? null` de `as string` --
  // `p.user_id` JA e `null` naquele caso, e o mutante sai identico.
  const comNulo = { ...contaDoGrupo(LETICIA), user_id: null };
  const comUndefined = { ...contaDoGrupo(LETICIA), user_id: undefined };
  const comVazio = { ...contaDoGrupo(LETICIA), user_id: "" };
  const semChave = { id: "z", amount: "1000.00", group_id: CASA };

  for (const entrada of [comNulo, comUndefined, comVazio, semChave]) {
    const [linha] = previstasPelaRegraDoPagador([entrada], PESOS, EU);

    assert.equal(linha.amount, 300, "sem dono ela nao e minha: entra rateada");
    assert.ok("pagar_para" in linha, "o campo existe");
    assert.equal(linha.pagar_para, null, "e 'nao sei quem', nao 'nao se aplica'");
    // `null` e `undefined` se serializam diferente mas se LEEM igual em `if`, e
    // a F2 distingue os dois: `undefined` quer dizer "nao e linha de outro
    // membro" e faria a conta da outra pessoa se ler como conta propria.
    assert.notEqual(linha.pagar_para, undefined);
  }
});

// =====================================================
// 5. O SINAL
// =====================================================

test("a parte sai POSITIVA mesmo se a linha chegar com o sinal do realizado", () => {
  // `scheduled_transactions.amount` tem CHECK (amount > 0) (005:206), entao
  // nenhum chamador de producao chega aqui com negativo HOJE: esta linha e
  // sintetica de proposito. Ela existe porque o defeito e MUDO -- a lista pinta
  // pelo SINAL e formata com Math.abs, entao R$ -300 sai como "R$ 300,00" EM
  // VERDE, como receita, e o total do mes cancela em vez de somar.
  const comSinalDoRealizado = { ...contaDoGrupo(LETICIA), amount: "-1000.00" };
  const [linha] = previstasPelaRegraDoPagador([comSinalDoRealizado], PESOS, EU);

  assert.equal(linha.amount, 300);
  assert.ok(linha.amount > 0, "a saida fica na convencao do previsto");
});

test("amount nulo vira zero e nao NaN", () => {
  const nula = { ...contaDoGrupo(LETICIA), amount: null };
  const [linha] = previstasPelaRegraDoPagador([nula], PESOS, EU);

  assert.equal(linha.amount, 0);
  assert.ok(!Number.isNaN(linha.amount));
});

// =====================================================
// 6. euFrontoAConta -- os tres guardas, afirmados onde sao observaveis
// =====================================================

test("euFrontoAConta so e verdade com os dois ids presentes e iguais", () => {
  assert.equal(euFrontoAConta(EU, EU), true);
  assert.equal(euFrontoAConta(LETICIA, EU), false);
});

test("euFrontoAConta recusa o par de ausencias", () => {
  // `undefined === undefined` e VERDADE, e esse e o estado de uma rota que
  // esqueceu `user_id` no select: sem o guarda do visitante TODA linha de grupo
  // passaria a contar bruto, e o Previsto de Despesas dobraria em silencio.
  //
  // So ha UM guarda, e e de proposito: o do campo da linha nao muda resposta
  // nenhuma (medido, 0 de 25 pares) e foi apagado. As seis linhas abaixo
  // continuam cobrindo os dois lados -- o que mudou foi quem as atende.
  assert.equal(euFrontoAConta(undefined, undefined), false);
  assert.equal(euFrontoAConta(null, null), false);
  assert.equal(euFrontoAConta(null, undefined), false);
  assert.equal(euFrontoAConta("", ""), false, "sessao sem id nao e dona de nada");
  assert.equal(euFrontoAConta(EU, null), false);
  assert.equal(euFrontoAConta(null, EU), false);
});

// =====================================================
// 7. A CONCILIACAO COM A F3 -- tres numeros, um por um
// =====================================================

test("Despesas sobe para o bruto, e o reembolso previsto e a diferenca", () => {
  const mes = [contaDoGrupo(EU), contaDoGrupo(LETICIA)];

  const nova = previstasPelaRegraDoPagador(mes, PESOS, EU);
  const hoje = previstasComAMinhaParte(mes, PESOS, EU);

  const soma = (lista) => lista.reduce((t, l) => t + Number(l.amount), 0);

  // Parcela 1: o BRUTO da aba Despesas com a regra nova.
  assert.equal(soma(nova), 1300, "1000 que eu fronto + 300 da parte dela");

  // Parcela 2: o liquido que a leitura de hoje devolve, inalterado.
  assert.equal(soma(hoje), 600, "300 + 300 -- a minha parte nas duas linhas");

  // Parcela 3: o REEMBOLSO que a F3 tem de por na aba Receitas. E a parte dos
  // outros na conta que EU frontei, e nada nesta fase o calcula -- a F3 o tira
  // de `creditoAReceber`.
  const reembolsoQueAF3Deve = 1000 - 300;
  assert.equal(reembolsoQueAF3Deve, 700);

  // E SO AGORA as tres fecham. Afirmar `soma(nova) - reembolso === soma(hoje)`
  // sozinho passaria verde com as duas primeiras parcelas erradas em 400 cada.
  assert.equal(soma(nova) - reembolsoQueAF3Deve, soma(hoje));
});

test("sem a F3, o Previsto de Despesas SOBE -- e e isso que a medicao tem de ver", () => {
  const mes = [contaDoGrupo(EU), contaDoGrupo(LETICIA)];
  const soma = (lista) => lista.reduce((t, l) => t + Number(l.amount), 0);

  // O controle negativo da F3, no tamanho que cabe nesta fase: a regra nova
  // sozinha e ESTRITAMENTE maior. Se um dia estas duas somas empatarem, ou a
  // regra do pagador parou de funcionar ou a fixture perdeu a linha frontada por
  // mim -- nos dois casos a medicao da F3 mediria zero.
  assert.ok(
    soma(previstasPelaRegraDoPagador(mes, PESOS, EU)) >
      soma(previstasComAMinhaParte(mes, PESOS, EU))
  );
});

// =====================================================
// 8. AS OUTRAS QUATRO LEITURAS NAO MUDARAM
// =====================================================

test("previstasComAMinhaParte continua ignorando user_id -- de proposito", () => {
  // `papel-de-pao/painel`, `safe-to-spend`, `scheduled-transactions/summary` e
  // `dashboard/previsao` chamam esta funcao, e a secao 4 do plano da HMO-360
  // decidiu NAO reverter a HMO-306/308: o safe-to-spend responde "posso gastar
  // isso?" e o reembolso da contraparte e promessa, nao dinheiro.
  //
  // Entao o que para esta fase seria um defeito e, para aquela leitura, a
  // resposta certa -- e e por isso que a regra nova e uma funcao NOVA, e nao uma
  // edicao da antiga.
  const minha = previstasComAMinhaParte([contaDoGrupo(EU)], PESOS, EU);
  const dela = previstasComAMinhaParte([contaDoGrupo(LETICIA)], PESOS, EU);

  assert.equal(minha[0].amount, 300, "a MINHA linha de grupo continua rateada la");
  assert.equal(dela[0].amount, 300);
  assert.ok(!("pagar_para" in minha[0]), "ela nao ganhou campo novo");
  assert.ok(!("pagar_para" in dela[0]));
});

test("a linha pessoal continua intacta na funcao antiga tambem", () => {
  const [linha] = previstasComAMinhaParte([PESSOAL], PESOS, EU);

  assert.equal(linha, PESSOAL);
  assert.equal(typeof linha.amount, "string");
});
