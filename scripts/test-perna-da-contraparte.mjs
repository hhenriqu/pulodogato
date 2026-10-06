#!/usr/bin/env node
// =====================================================
// PULODOGATO - o outro lado do acerto (HMO-245, fase 12)
// =====================================================
// A fase 11 gravou a perna de QUEM CLICOU e parou ali, nao por falta de codigo:
// `financial_transactions_write` e `FOR INSERT WITH CHECK (user_id =
// auth.uid())` (`002_rls_lockdown.sql:472`), entao a perna do outro lado precisa
// da sessao DELE e da conta DELE. `lib/perna-da-contraparte.ts` decide o que
// cada sessao ve e pode fazer, e esta suite fixa as quatro coisas que erram em
// silencio se mudarem:
//
//   1. AS DUAS SESSOES DO MESMO ACERTO VEEM DIRECOES OPOSTAS. E o unico
//      enunciado desta fase que uma sessao so nao consegue falsificar: com um
//      userId so, qualquer direcao "funciona". O teste roda o MESMO acerto pelos
//      DOIS ids e exige o par -- `paguei` para `from_user_id`, `recebi` para
//      `to_user_id` -- e so depois olha os numeros.
//
//   2. A PERNA DE QUEM DEVE E `transfer` NEGATIVA, NUNCA `expense`. E o mutante
//      que a issue manda matar, e ele e traicoeiro porque NAO MUDA O SALDO:
//      `update_account_balance` soma `NEW.amount` sem olhar `transaction_type`
//      (`001_baseline.sql:833`). Com `expense`, o Pix de R$ 200 entra no cartao
//      Despesas dela EM CIMA dos R$ 200 que o rateio ja tomou
//      (`group_share_entries`, 033) -- R$ 400 de despesa num mes em que ela
//      gastou 200, com o saldo certo na tela toda. Uma suite que meca so
//      `current_balance` fica verde.
//
//      Por isso a assercao e composta: ela sai de `minhaPernaPodeSerGravada` e
//      entra em `pernaDoAcerto`, que e exatamente o que a rota faz. Medir as
//      duas pecas em separado deixaria passar a fiacao errada entre elas.
//
//   3. O ROTULO DO ESTADO INTERMEDIARIO. "Nao lancado" e indistinguivel de "nao
//      aconteceu": sem rotulo, a tela de quem nao confirmou mostra o acerto com
//      valor, data e os dois nomes, e nenhum sinal de que o dinheiro nao passou
//      pela conta dela. O teste exige que o rotulo de `a_lancar` seja DIFERENTE
//      do de `lancado` -- um mutante que devolva a mesma frase nos dois estados
//      passa por qualquer assercao que olhe so um deles.
//
//   4. A ASSIMETRIA DO DESFAZER. Quem registrou desfaz o ACERTO (a perna vai
//      junto); a contraparte remove SO A PERNA DELA, porque a quitacao nao e
//      dela para apagar. Os dois booleanos nunca sao o mesmo, e oferecer
//      "desfazer so o meu lancamento" a quem registrou reproduziria o defeito
//      que a fase 11 consertou: quitacao gravada com dinheiro nenhum.
//
// O que esta suite NAO prova: que a escrita acontece, nem que o `current_balance`
// volta ao valor de antes no desfazer. Isso e duas sessoes em producao -- ver o
// comentario da issue -- porque e o branch de DELETE do `update_account_balance`
// (`001_baseline.sql:840`) que reverte o saldo, e ele nao roda em teste puro.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  AVISO_AO_DESFAZER_O_ACERTO,
  MENSAGEM_JA_LANCADO,
  MENSAGEM_NAO_SOU_PARTE,
  MENSAGEM_USE_DESFAZER,
  ROTULO_A_LANCAR,
  comoEuVejoOAcerto,
  mensagemDaRecusaDaPerna,
  minhaPernaPodeSerGravada,
  recusaDeRemoverSoAMinhaPerna,
  rotuloDeLancado,
} from "../.tmp-perna-da-contraparte/perna-da-contraparte.js";

import {
  TIPO_DA_PERNA,
  pernaDoAcerto,
} from "../.tmp-perna-da-contraparte/acerto-em-lancamento.js";

const ANA = "aaaaaaaa-0000-0000-0000-00000000a001";
const BIA = "bbbbbbbb-0000-0000-0000-00000000b001";
const CAIO = "cccccccc-0000-0000-0000-00000000c001";

/** Bia pagou R$ 200 para a Ana, e a BIA registrou. */
const ACERTO = {
  from_user_id: BIA,
  to_user_id: ANA,
  created_by: BIA,
};

const CONTA = { id: "conta-corrente", account_type: "checking", currency: "BRL" };

const ID_DO_ACERTO = "5e111111-0000-0000-0000-000000000001";

/** O que a rota faz: decide se pode, e com a direcao devolvida monta a perna. */
function pernaComoARotaMonta(userId, temPerna = false) {
  const permissao = minhaPernaPodeSerGravada({
    acerto: ACERTO,
    userId,
    temPerna,
  });

  if (permissao.recusa) return { recusa: permissao.recusa };

  const { perna, problema } = pernaDoAcerto({
    direcao: permissao.direcao,
    conta: CONTA,
    amount: 200,
    currency: "BRL",
    exchange_rate: 1,
    settledOn: "2026-03-12",
    settlementId: ID_DO_ACERTO,
    nomeDaContraparte: "Ana",
    nomeDoGrupo: "Viagem",
  });

  return { direcao: permissao.direcao, perna, problema };
}

// =====================================================
// 1 + 2. AS DUAS SESSOES, E O TIPO DA PERNA DE QUEM DEVE
// =====================================================

test("o MESMO acerto da direcoes opostas nas duas sessoes -- com uma sessao so isto nao se mede", () => {
  const quemPaga = pernaComoARotaMonta(BIA);
  const quemRecebe = pernaComoARotaMonta(ANA);

  // O par, e nao cada lado por si: uma funcao que devolvesse SEMPRE "paguei"
  // passa por qualquer assercao que olhe apenas a sessao de quem paga.
  assert.equal(quemPaga.direcao, "paguei");
  assert.equal(quemRecebe.direcao, "recebi");
  assert.notEqual(quemPaga.direcao, quemRecebe.direcao);
});

test("quem deve leva `transfer` NEGATIVA -- `expense` cobraria a parte dela duas vezes", () => {
  const { perna } = pernaComoARotaMonta(BIA);

  // O mutante da issue. `expense` aqui NAO mexeria no saldo -- so inflaria a
  // despesa dela em cima da parte que o rateio ja tomou.
  assert.equal(perna.transaction_type, "transfer");
  assert.equal(perna.transaction_type, TIPO_DA_PERNA);
  assert.notEqual(perna.transaction_type, "expense");

  // E o sinal, que e o que move o saldo.
  assert.equal(perna.amount, -200);
  assert.ok(perna.amount < 0, "a conta de quem paga tem que DIMINUIR");
});

test("quem recebe leva `transfer` POSITIVA -- `income` apagaria a parte dela no painel", () => {
  const { perna } = pernaComoARotaMonta(ANA);

  assert.equal(perna.transaction_type, "transfer");
  assert.notEqual(perna.transaction_type, "income");
  assert.equal(perna.amount, 200);
});

test("as duas pernas somam ZERO e nenhuma delas e Receita ou Despesa", () => {
  const paga = pernaComoARotaMonta(BIA).perna;
  const recebe = pernaComoARotaMonta(ANA).perna;

  // A invariante da fase, numa linha: um acerto nunca muda a Receita nem a
  // Despesa de ninguem -- ele so move dinheiro de uma conta para a outra.
  assert.equal(paga.amount + recebe.amount, 0);
  for (const perna of [paga, recebe]) {
    assert.notEqual(perna.transaction_type, "expense");
    assert.notEqual(perna.transaction_type, "income");
  }
});

// =====================================================
// 3. O ROTULO DO ESTADO INTERMEDIARIO
// =====================================================

test("sem perna, o estado e `a_lancar` e o rotulo DIZ que nao foi lancado", () => {
  const visao = comoEuVejoOAcerto({ acerto: ACERTO, userId: ANA, temPerna: false });

  assert.equal(visao.estado, "a_lancar");
  assert.equal(visao.rotulo, ROTULO_A_LANCAR);
  // A frase tem de afirmar as duas coisas: que o acerto EXISTE e que a conta
  // dela nao foi tocada. So "pendente" deixaria "nao aconteceu" no ar.
  assert.match(visao.rotulo, /registrado/i);
  assert.match(visao.rotulo, /ainda não lançado/i);
  assert.match(visao.rotulo, /sua conta/i);
});

test("o rotulo de `a_lancar` e DIFERENTE do de `lancado` -- a mesma frase nos dois nao distingue nada", () => {
  const aLancar = comoEuVejoOAcerto({
    acerto: ACERTO,
    userId: ANA,
    temPerna: false,
  });
  const lancado = comoEuVejoOAcerto({
    acerto: ACERTO,
    userId: ANA,
    temPerna: true,
    nomeDaConta: "Nubank",
  });

  assert.equal(lancado.estado, "lancado");
  assert.notEqual(aLancar.rotulo, lancado.rotulo);
  // E o estado tem de acompanhar o rotulo: rotulo certo com estado errado faz a
  // tela mostrar a frase de "a lancar" com o botao de "lancado".
  assert.notEqual(aLancar.estado, lancado.estado);
});

test("lancado diz EM QUAL conta, quando a conta e conhecida", () => {
  const visao = comoEuVejoOAcerto({
    acerto: ACERTO,
    userId: ANA,
    temPerna: true,
    nomeDaConta: "Nubank",
  });

  assert.equal(visao.rotulo, rotuloDeLancado("Nubank"));
  assert.match(visao.rotulo, /Nubank/);

  // Sem o nome da conta a frase ainda tem de afirmar o lancamento -- e nao
  // sobrar um "Lancado em ." com o buraco a mostra.
  assert.equal(rotuloDeLancado(null), "Lançado na sua conta.");
  assert.equal(rotuloDeLancado("   "), "Lançado na sua conta.");
  assert.doesNotMatch(rotuloDeLancado(""), /em \./);
});

test("acerto entre outras duas pessoas NAO ganha rotulo -- ali a frase seria mentira", () => {
  const visao = comoEuVejoOAcerto({ acerto: ACERTO, userId: CAIO, temPerna: false });

  assert.equal(visao.estado, "nao_sou_parte");
  // `null`, e nao ROTULO_A_LANCAR: "ainda nao lancado na SUA conta" num acerto
  // entre a Bia e a Ana afirmaria uma divida que o Caio nao tem.
  assert.equal(visao.rotulo, null);
  assert.equal(visao.direcao, null);
  assert.equal(visao.podeLancar, false);
  assert.equal(visao.podeDesfazerSoAMinhaPerna, false);
});

// =====================================================
// 4. QUEM PODE O QUE -- E A RECUSA COM FRASE
// =====================================================

test("a contraparte pode lancar; depois de lancar, nao pode de novo", () => {
  const antes = comoEuVejoOAcerto({ acerto: ACERTO, userId: ANA, temPerna: false });
  const depois = comoEuVejoOAcerto({ acerto: ACERTO, userId: ANA, temPerna: true });

  assert.equal(antes.podeLancar, true);
  assert.equal(depois.podeLancar, false);
});

test("a duplicata e recusada como `ja_lancado` -- o duplo clique nao lanca duas vezes", () => {
  const r = minhaPernaPodeSerGravada({ acerto: ACERTO, userId: ANA, temPerna: true });

  assert.equal(r.recusa, "ja_lancado");
  assert.equal(r.direcao, undefined);
  assert.equal(mensagemDaRecusaDaPerna("ja_lancado"), MENSAGEM_JA_LANCADO);
});

test("quem nao e parte nao tem perna para lancar", () => {
  const r = minhaPernaPodeSerGravada({ acerto: ACERTO, userId: CAIO, temPerna: false });

  assert.equal(r.recusa, "nao_sou_parte");
  assert.equal(r.direcao, undefined);
  assert.equal(mensagemDaRecusaDaPerna("nao_sou_parte"), MENSAGEM_NAO_SOU_PARTE);
  // As duas recusas sao frases DIFERENTES: a mesma mensagem nos dois casos
  // mandaria a pessoa procurar o problema no lugar errado.
  assert.notEqual(MENSAGEM_JA_LANCADO, MENSAGEM_NAO_SOU_PARTE);
});

test("os dois desfazeres nunca sao o mesmo booleano", () => {
  // Quem registrou, com a perna da fase 11 no extrato.
  const quemRegistrou = comoEuVejoOAcerto({
    acerto: ACERTO,
    userId: BIA,
    temPerna: true,
  });
  // A contraparte, depois de confirmar.
  const contraparte = comoEuVejoOAcerto({
    acerto: ACERTO,
    userId: ANA,
    temPerna: true,
  });

  assert.equal(quemRegistrou.podeDesfazerOAcerto, true);
  // A acao melhor existe e leva a perna junto: oferecer "so o meu lancamento"
  // aqui deixaria a quitacao de pe sem o dinheiro ter saido -- o defeito EXATO
  // que a fase 11 consertou, a um clique de distancia.
  assert.equal(quemRegistrou.podeDesfazerSoAMinhaPerna, false);

  assert.equal(contraparte.podeDesfazerOAcerto, false);
  assert.equal(contraparte.podeDesfazerSoAMinhaPerna, true);

  // O par, dito de uma vez: nunca os dois verdadeiros na mesma linha da tela.
  for (const visao of [quemRegistrou, contraparte]) {
    assert.ok(
      !(visao.podeDesfazerOAcerto && visao.podeDesfazerSoAMinhaPerna),
      "as duas acoes de desfazer nao convivem na mesma sessao"
    );
  }
});

test("a recusa de remover so a minha perna MANDA usar o Desfazer, para quem registrou", () => {
  const recusa = recusaDeRemoverSoAMinhaPerna({
    acerto: ACERTO,
    userId: BIA,
    temPerna: true,
  });

  assert.equal(recusa, MENSAGEM_USE_DESFAZER);
  // A frase tem de dizer O QUE FAZER: a acao certa esta na mesma linha da tela.
  assert.match(recusa, /Desfazer/);
});

test("a contraparte com perna remove a propria perna -- sem recusa", () => {
  const recusa = recusaDeRemoverSoAMinhaPerna({
    acerto: ACERTO,
    userId: ANA,
    temPerna: true,
  });

  assert.equal(recusa, null);
});

test("sem perna nao ha o que remover, e a recusa diz isso", () => {
  const recusa = recusaDeRemoverSoAMinhaPerna({
    acerto: ACERTO,
    userId: ANA,
    temPerna: false,
  });

  assert.ok(recusa, "remover perna inexistente tem de ser recusado");
  assert.match(recusa, /não está lançado/i);
  // E nao a frase de quem registrou: mandar a contraparte usar "Desfazer" a
  // mandaria num botao que a tela dela nao tem.
  assert.notEqual(recusa, MENSAGEM_USE_DESFAZER);
});

test("quem nao e parte tampouco remove perna", () => {
  const recusa = recusaDeRemoverSoAMinhaPerna({
    acerto: ACERTO,
    userId: CAIO,
    temPerna: false,
  });

  assert.equal(recusa, MENSAGEM_NAO_SOU_PARTE);
});

// =====================================================
// OS DOIS CASOS DE BORDA QUE SAO REAIS, NAO TEORICOS
// =====================================================

test("acerto de ANTES da fase 11 nao tem perna, e quem registrou pode lancar a dele", () => {
  // A fase 11 subiu com `group_settlements` ja povoada: aquelas quitacoes nao
  // tem perna nenhuma, e o dinheiro nunca entrou na conta de ninguem.
  const visao = comoEuVejoOAcerto({ acerto: ACERTO, userId: BIA, temPerna: false });

  assert.equal(visao.estado, "a_lancar");
  assert.equal(visao.podeLancar, true);
  assert.equal(visao.rotulo, ROTULO_A_LANCAR);
  // E ele continua podendo desfazer a quitacao, que e o que a policy da 007 ve:
  // ela olha `created_by` e mais nada.
  assert.equal(visao.podeDesfazerOAcerto, true);
});

test("o admin que registrou acerto entre OUTROS dois desfaz o proprio registro", () => {
  const acertoAlheio = { from_user_id: BIA, to_user_id: ANA, created_by: CAIO };
  const visao = comoEuVejoOAcerto({
    acerto: acertoAlheio,
    userId: CAIO,
    temPerna: false,
  });

  assert.equal(visao.estado, "nao_sou_parte");
  assert.equal(visao.rotulo, null);
  assert.equal(visao.podeLancar, false);
  // Sem isto, um acerto registrado por engano entre outros dois fica na lista
  // para sempre: ninguem tem a acao de tirar.
  assert.equal(visao.podeDesfazerOAcerto, true);
});

test("o aviso do desfazer fala da perna que sobrevive do outro lado", () => {
  // A RLS impede o DELETE de quem desfaz de alcancar a perna da contraparte --
  // e isso e o certo. Mas a quitacao deixa de existir, e com ela a linha da tela
  // que oferecia "Desfazer o meu lancamento" a ela: quem desfaz e a unica
  // pessoa que sabe, naquele instante, que o acerto deixou de valer.
  assert.match(AVISO_AO_DESFAZER_O_ACERTO, /outra pessoa/i);
  assert.match(AVISO_AO_DESFAZER_O_ACERTO, /só ela/i);
});
