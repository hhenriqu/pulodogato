#!/usr/bin/env node
// =====================================================
// PULODOGATO - as tres acoes de uma linha da lista (HMO-301)
// =====================================================
//   npm run test:acoes-da-linha
//
// `lib/acoes-da-linha.ts` e a peneira que decide QUAIS dos tres botoes
// (Editar / Excluir / Confirmar) cada linha ganha, e PARA ONDE cada um vai.
//
// POR QUE ISTO E UMA SUITE PROPRIA, E NAO UM `&&` NO JSX
// -----------------------------------------------------
// Porque os cinco modos de falha desta peneira produzem o MESMO resultado na
// tela -- um botao que aparece -- e se separam so depois do clique, onde quem
// clicou nao tem como ligar a causa ao efeito:
//
//   * fatura ABERTA: id sintetico (`fatura:2026-08-01:<uuid>`) numa URL de
//     baixa -> 404, que se le como "o app nao conseguiu";
//   * fatura FECHADA: a baixa exige a conta pagadora no corpo -> erro em TODO
//     clique;
//   * linha REALIZADA com "Confirmar": gravaria a SEGUNDA PERNA do mesmo
//     dinheiro -- que e exatamente como este app ja contou despesa duas vezes;
//   * linha de OUTRO membro do grupo: a RLS recusa, e **`UPDATE` recusado pela
//     RLS volta 200 sem alterar nada**. O app diz "pronto" e a linha fica;
//   * perna de transferencia aberta na tela de despesa: a outra perna fica
//     ORFA, e o patrimonio erra pelo valor inteiro sem nada parecer errado.
//
// Nenhum dos cinco levanta excecao, nenhum aparece no `tsc` e nenhum muda um
// pixel antes do clique.
//
// O QUE ESTA SUITE NAO COBRE
// --------------------------
// QUE O BOTAO ESTEJA DESENHADO. Ela afirma sobre as funcoes; o HTML e
// `npm run test:secao-da-tela`, e o CLIQUE chegando na rota e a linha mudando
// de secao e `npm run test:lista-na-tela` (Chromium). As tres medem coisas
// diferentes, e as tres passam verde com as outras duas quebradas.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  ROTULO_DE_EDITAR,
  ROTULO_DE_EXCLUIR,
  ROTULO_DE_PAGAR,
  avisoDaExclusao,
  caminhoDeEdicao,
  motivoSemEditar,
  pedidoDeConfirmacao,
  pedidoDeEdicaoDaPrevista,
  pedidoDeExclusao,
  podeAgirNaLinha,
  podeConfirmar,
  podeEditar,
  podeExcluir,
  podePagarAFatura,
  rotuloDeConfirmar,
} = await import("../.tmp-acoes-da-linha/lib/acoes-da-linha.js");

// A CADEIA DE PRODUCAO INTEIRA, e nao uma fixture escrita a mao -- HMO-311.
// Ver o ultimo bloco deste arquivo para por que ela precisa estar aqui.
const { sintetizarFaturasAbertas } = await import(
  "../.tmp-acoes-da-linha/lib/agenda-do-cartao.js"
);
const { linhaPrevista } = await import(
  "../.tmp-acoes-da-linha/lib/telas-de-movimentacao.js"
);

const CARTAO = "33333333-3333-4333-b333-333333333333";

/** Uma conta prevista comum, minha e gravada: o caso em que TUDO aparece. */
const prevista = (extra = {}) => ({
  id: "s1",
  gravada: true,
  origem: "previsto",
  tipo: "expense",
  natureza: "despesa",
  posso_editar: true,
  ...extra,
});

/** Uma linha realizada comum, minha. */
const realizada = (extra = {}) => ({
  id: "t1",
  gravada: true,
  origem: "realizado",
  tipo: "expense",
  natureza: "despesa",
  posso_editar: true,
  ...extra,
});

/** A fatura ABERTA sintetizada: chave com prefixo, e sem linha no banco. */
const faturaAberta = () =>
  prevista({
    id: `fatura:2026-08-01:${CARTAO}`,
    gravada: false,
    natureza: "fatura",
    posso_editar: false,
  });

/** A fatura FECHADA: `scheduled_transaction` de verdade, minha e gravada. */
const faturaFechada = () =>
  prevista({ id: "s-fatura", natureza: "fatura" });

// ---------------------------------------------------------------------------
// OS TRES SABORES DE FATURA, TODOS MEUS -- HMO-311
// ---------------------------------------------------------------------------
// `faturaAberta()` acima tem `posso_editar: false`, e por isso ela nao serve
// para medir o botao novo: ela recusaria pelo criterio errado, e o bloco
// passaria verde com `natureza` esquecido.
//
// E CUIDADO COM O QUE AQUELA FIXTURE DIZ. Ela NAO e mais a fatura aberta de
// producao -- desde a HMO-311 a sintetizada carrega `user_id` e chega a tela
// `posso_editar: true` (ver o bloco 11, no fim deste arquivo, onde a cadeia de
// producao e montada de verdade). Ela continua valendo como o caso NEGATIVO:
// uma linha de fatura que nao e minha. Nenhuma fixture escrita a mao prova de
// onde `posso_editar` vem -- foi exatamente isso que deixou o botao sumir em
// producao com 104 assercoes verdes.

/** Sabor 1: a aberta sintetizada -- `gravada: false`, sem id de banco. */
const faturaAbertaMinha = () =>
  prevista({
    id: `fatura:2026-08-01:${CARTAO}`,
    gravada: false,
    natureza: "fatura",
    posso_editar: true,
  });

// E OS SABORES 2 E 3 SAO A MESMA ENTRADA AQUI, de propósito nao repetidos: a
// fatura FECHADA e a previsao DIGITADA ligada ao elo diferem em
// `elo_da_fatura`, que nao e campo de `LinhaAcionavel` -- esta peneira nao pode
// distingui-las, e um segundo caso "sabor 3" seria um bloco que nao mede nada.
// Onde a diferenca existe: em `decisaoDePagamentoDaFatura` (por `gravada`, com
// mutante obrigatorio em `npm run mutantes:pagamento-da-fatura`) e na MARCACAO
// (so a fatura leva o nome do cartao como link -- `npm run test:secao-da-tela`).

// ---------------------------------------------------------------------------
// 1. O caso base -- sem ele, tudo abaixo passaria por vacuidade
// ---------------------------------------------------------------------------

test("CONTROLE: a conta prevista minha e gravada ganha os TRES botoes", () => {
  // Este bloco e o controle positivo da suite inteira. Uma peneira que
  // devolvesse `false` em tudo passaria em cada assercao NEGATIVA daqui para
  // baixo -- e o sintoma no app seria a lista inteira sem botao nenhum, que e
  // precisamente o estado de antes desta issue.
  const linha = prevista();

  assert.equal(podeAgirNaLinha(linha), true);
  assert.equal(podeConfirmar(linha), true);
  assert.equal(podeEditar(linha), true);
  assert.equal(podeExcluir(linha), true);
  assert.equal(motivoSemEditar(linha), null);
});

test("CONTROLE: a linha realizada minha ganha DOIS -- nao tres", () => {
  const linha = realizada();

  assert.equal(podeEditar(linha), true);
  assert.equal(podeExcluir(linha), true);
  assert.equal(podeConfirmar(linha), false);
});

// ---------------------------------------------------------------------------
// 2. Regra 1: "Confirmar" so existe no PREVISTO
// ---------------------------------------------------------------------------

test("linha realizada NAO tem Confirmar, em nenhuma das tres telas", () => {
  // Confirmar o que ja aconteceu gravaria a segunda perna do MESMO dinheiro.
  // E por tela porque o botao e por tela: um `if` escrito so no caminho da
  // despesa deixaria Receitas e Transferencias com o botao.
  for (const tipo of ["income", "expense", "transfer"]) {
    assert.equal(
      podeConfirmar(realizada({ tipo })),
      false,
      `a realizada da tela ${tipo} ganhou Confirmar`
    );
    assert.equal(
      pedidoDeConfirmacao(realizada({ tipo })),
      null,
      `a realizada da tela ${tipo} montou um pedido de baixa`
    );
  }
});

test("a baixa vai para /pay da conta prevista, com o id DELA", () => {
  const pedido = pedidoDeConfirmacao(prevista({ id: "abc-123" }));

  assert.deepEqual(pedido, {
    metodo: "POST",
    url: "/api/scheduled-transactions/abc-123/pay",
    corpo: {},
  });
});

test("o id entra PERCENTO-CODIFICADO -- nada do id vira caminho novo", () => {
  // Um id com `/` montaria `/api/scheduled-transactions/a/b/pay`, que e OUTRA
  // rota (ou um 404). Nao acontece com uuid, e acontece com a chave sintetica
  // da fatura -- que e justamente a que tem de nao chegar aqui.
  const pedido = pedidoDeConfirmacao(prevista({ id: "a/b" }));
  assert.equal(pedido.url, "/api/scheduled-transactions/a%2Fb/pay");
});

// ---------------------------------------------------------------------------
// 3. Regra 2: uma acao, TRES rotulos
// ---------------------------------------------------------------------------

test("o verbo da baixa segue a DIRECAO da linha -- e os tres textos diferem", () => {
  assert.equal(rotuloDeConfirmar("income"), "Confirmar recebimento");
  assert.equal(rotuloDeConfirmar("expense"), "Confirmar pagamento");
  assert.equal(rotuloDeConfirmar("transfer"), "Confirmar transferência");

  // OS TRES DISTINTOS ENTRE SI, e nao so "cada um e o texto que eu escrevi":
  // um `rotuloDeConfirmar` que devolvesse sempre a mesma string passaria nas
  // tres assercoes acima se as tres esperassem o mesmo texto -- e o defeito
  // real e exatamente este, um rotulo so fazendo duas telas mentir.
  const todos = ["income", "expense", "transfer"].map(rotuloDeConfirmar);
  assert.equal(new Set(todos).size, 3, `rotulos repetidos: ${todos}`);

  // E "recebimento" nao aparece na tela de Despesas nem vice-versa.
  assert.ok(!rotuloDeConfirmar("expense").includes("receb"));
  assert.ok(!rotuloDeConfirmar("income").includes("pagam"));
});

test("a URL da baixa e a MESMA nas tres telas -- muda o texto, nao a rota", () => {
  const urls = ["income", "expense", "transfer"].map(
    (tipo) => pedidoDeConfirmacao(prevista({ tipo })).url
  );

  assert.equal(new Set(urls).size, 1, `a rota da baixa divergiu por tela: ${urls}`);
  assert.equal(urls[0], "/api/scheduled-transactions/s1/pay");
});

// ---------------------------------------------------------------------------
// 4. Regra 3: linha NAO GRAVADA nao ganha botao
// ---------------------------------------------------------------------------

test("a fatura ABERTA nao ganha botao nenhum, e nao monta URL nenhuma", () => {
  const linha = faturaAberta();

  assert.equal(podeAgirNaLinha(linha), false);
  assert.equal(podeConfirmar(linha), false);
  assert.equal(podeEditar(linha), false);
  assert.equal(podeExcluir(linha), false);
  assert.equal(pedidoDeConfirmacao(linha), null);
  assert.equal(pedidoDeExclusao(linha), null);
  assert.equal(avisoDaExclusao(linha, "Fatura Nubank"), null);
  assert.equal(caminhoDeEdicao(linha, "/dashboard/despesas", null), null);
});

test("`gravada: false` recusa SOZINHO -- mesmo com posso_editar e natureza comum", () => {
  // Os tres criterios de `podeAgirNaLinha` sao testados um a um porque eles sao
  // CONJUNCAO: com dois deles escritos e o terceiro esquecido, a peneira
  // continua recusando a maioria das linhas e passa por funcionando. Aqui cada
  // bloco deixa os outros dois VALIDOS.
  const linha = prevista({ gravada: false, natureza: "despesa", posso_editar: true });
  assert.equal(podeAgirNaLinha(linha), false, "`gravada: false` passou");
});

// ---------------------------------------------------------------------------
// 5. Regra 4: sem `posso_editar` nao sai botao
// ---------------------------------------------------------------------------

test("`posso_editar: false` recusa SOZINHO -- a linha de outro membro do grupo", () => {
  const linha = prevista({ posso_editar: false, gravada: true, natureza: "despesa" });

  assert.equal(podeAgirNaLinha(linha), false);
  assert.equal(podeConfirmar(linha), false);
  assert.equal(podeEditar(linha), false);
  assert.equal(podeExcluir(linha), false);
  assert.equal(pedidoDeExclusao(linha), null);
  // E o Editar nao fica nem APAGADO: um botao cinza sobre linha alheia
  // convidaria a tentar o que a RLS nunca vai deixar.
  assert.equal(motivoSemEditar(linha), null);
});

test("o mesmo vale para a linha REALIZADA de outro membro", () => {
  const linha = realizada({ posso_editar: false });
  assert.equal(podeExcluir(linha), false);
  assert.equal(pedidoDeExclusao(linha), null);
  assert.equal(caminhoDeEdicao(linha, "/dashboard/despesas", null), null);
});

// ---------------------------------------------------------------------------
// 6. Regra 5: a fatura FECHADA tambem nao, e por outra razao
// ---------------------------------------------------------------------------

test("`natureza: 'fatura'` recusa SOZINHO -- mesmo gravada e minha", () => {
  // A fatura fechada tem id de banco e e minha: ela passa pelas regras 3 e 4.
  // O que a recusa e a 5 -- a baixa dela exige a conta pagadora, e a linha dela
  // e um `<a>` para a tela do cartao (botao dentro de ancora navegaria junto).
  const linha = faturaFechada();

  assert.equal(linha.gravada, true, "o caso precisa estar gravado para valer");
  assert.equal(linha.posso_editar, true, "o caso precisa ser meu para valer");
  assert.equal(podeAgirNaLinha(linha), false);
  assert.equal(podeConfirmar(linha), false);
  assert.equal(podeExcluir(linha), false);
  assert.equal(pedidoDeConfirmacao(linha), null);
});

// ---------------------------------------------------------------------------
// 6b. O DESTINO PROPRIO DA FATURA -- `podePagarAFatura` (HMO-311, fase 14)
// ---------------------------------------------------------------------------
// "Precisa colocar o botao de pagar tbm na fatura do cartao em despesas."
//
// Os blocos acima provam que a fatura nao entra na baixa GENERICA, e isso
// continua valendo. O que esta secao mede e o caminho NOVO, e a armadilha dele e
// que ele CONTRADIZ a regra 3 em `gravada` -- de proposito.

test("CONTROLE: a fatura ABERTA (gravada: false) GANHA o botao Pagar", () => {
  // O CONTROLE POSITIVO desta secao, e o caso que ela existe para alcancar: a
  // fatura aberta sintetizada e a terceira fonte do «Previsto» da tela de
  // Despesas, e em muitos meses a maior.
  //
  // Sem este bloco, um `podePagarAFatura` que copiasse `podeAgirNaLinha`
  // (recusando `gravada: false`) passaria em todos os blocos negativos abaixo --
  // e o sintoma no app seria a fatura aberta continuando sem botao, que e
  // exatamente o estado de antes desta fase.
  const linha = faturaAbertaMinha();

  assert.equal(linha.gravada, false, "o caso precisa ser NAO gravado para valer");
  assert.equal(podePagarAFatura(linha), true);

  // E A BAIXA GENERICA CONTINUA RECUSADA. As duas coisas de uma vez: o botao
  // novo existe E nenhum caminho monta a URL com a chave sintetica.
  assert.equal(podeAgirNaLinha(linha), false);
  assert.equal(podeConfirmar(linha), false);
  assert.equal(pedidoDeConfirmacao(linha), null);
  assert.equal(pedidoDeExclusao(linha), null);
});

test("a fatura FECHADA, gravada e minha, tambem ganha Pagar", () => {
  const linha = faturaFechada();

  assert.equal(linha.gravada, true);
  assert.equal(podePagarAFatura(linha), true);
  // Pagar e o UNICO botao dela: Editar e Excluir continuam fora (regra 5).
  assert.equal(podeEditar(linha), false);
  assert.equal(podeExcluir(linha), false);
});

test("`posso_editar: false` TIRA o Pagar -- a fatura de outro membro do grupo", () => {
  // A regra 4 vale para o botao novo inteira e sem desconto, e este bloco e o
  // que mata o mutante que a tira da condicao. O modo de falha e o caro: a RLS
  // recusa a escrita e **UPDATE filtrado pela RLS volta 200 sem alterar nada**
  // -- o dialogo diria "Fatura paga", o saldo nao mudaria, e a pessoa pagaria de
  // novo pelo banco.
  //
  // A lista de Despesas inclui linha de outro membro desde a HMO-303, entao isto
  // nao e hipotetico. E ele mede nos TRES sabores: com um so, um `posso_editar`
  // escrito em um ramo deixaria os outros dois passando.
  for (const sabor of [faturaAbertaMinha(), faturaFechada()]) {
    assert.equal(
      podePagarAFatura({ ...sabor, posso_editar: false }),
      false,
      `a fatura alheia (gravada: ${sabor.gravada}) ganhou Pagar`
    );
    // E o controle do par: a MESMA linha com `posso_editar: true` ganha. Sem
    // isto, a assercao acima ficaria verde numa funcao que devolve `false`
    // sempre.
    assert.equal(podePagarAFatura({ ...sabor, posso_editar: true }), true);
  }
});

test("a fatura do lado REALIZADO nao ganha Pagar -- ela ja foi paga", () => {
  // ESTE BLOCO DEIXOU DE MEDIR UM AMANHA NA HMO-264. Ate ela,
  // `natureza: "fatura"` nao existia no realizado (`linhaRealizada` escrevia
  // "fixa" ou "despesa") e o caso aqui era hipotetico. A fatura PAGA chega agora
  // ao lado realizado de verdade -- a perna de SAIDA do pagamento, reconhecida
  // pela chave canonica em `notes` --, e `origem === "previsto"` e o que impede
  // a tela de oferecer "Pagar" numa fatura JA paga: aquele `/pay` gravaria a
  // SEGUNDA perna do mesmo dinheiro.
  const paga = { ...faturaFechada(), origem: "realizado" };

  assert.equal(podePagarAFatura(paga), false);
  // O controle do par: a MESMA linha do lado previsto ganha.
  assert.equal(podePagarAFatura({ ...paga, origem: "previsto" }), true);
});

test("nenhuma natureza ALEM de fatura ganha Pagar -- nas tres telas", () => {
  // A SEGUNDA METADE DO CRITERIO, e ela e o que impede o botao de brotar em
  // Receitas: a mudanca desta fase passa pela MESMA `SecaoDaTela` que serve
  // Receitas e Transferencias. Nenhuma linha de receita carrega a chave canonica
  // da fatura, entao nenhuma tem `natureza: "fatura"` -- e e por `natureza` que
  // o botao e decidido, nao por "a linha tem rotulo".
  for (const tipo of ["income", "expense", "transfer"]) {
    for (const natureza of ["despesa", "fixa"]) {
      assert.equal(
        podePagarAFatura(prevista({ tipo, natureza })),
        false,
        `a linha ${natureza} da tela ${tipo} ganhou Pagar`
      );
    }
    // E o controle: na MESMA tela, a linha de fatura ganha. Sem ele o laco
    // acima passaria verde numa funcao que recusa tudo.
    assert.equal(podePagarAFatura(prevista({ tipo, natureza: "fatura" })), true);
  }
});

test("o rotulo e 'Pagar', e NAO um dos tres verbos de Confirmar", () => {
  // Os dois prometem coisas diferentes: "Confirmar" diz que o clique ja
  // resolveu, e e verdade nas outras linhas -- a baixa sai no proprio clique.
  // O da fatura ABRE UM DIALOGO e pergunta de onde o dinheiro saiu; quem clicou
  // ainda tem uma escolha a fazer, e pode desistir.
  assert.equal(ROTULO_DE_PAGAR, "Pagar");

  for (const tipo of ["income", "expense", "transfer"]) {
    assert.notEqual(
      ROTULO_DE_PAGAR,
      rotuloDeConfirmar(tipo),
      `o rotulo da fatura colidiu com o da baixa da tela ${tipo}`
    );
  }
});

test("a conta FIXA (que tambem e rotulada) continua ganhando os tres", () => {
  // Controle da regra 5: ela e sobre `"fatura"`, nao sobre "a linha tem
  // rotulo". Um `natureza !== "despesa"` escrito no lugar tiraria os botoes de
  // toda conta fixa -- que e a maioria das linhas previstas de quem usa o app.
  const fixa = prevista({ natureza: "fixa" });

  assert.equal(podeConfirmar(fixa), true);
  assert.equal(podeEditar(fixa), true);
  assert.equal(podeExcluir(fixa), true);
});

// ---------------------------------------------------------------------------
// 7. Editar: a perna de transferencia JA GRAVADA
// ---------------------------------------------------------------------------

test("a transferencia REALIZADA nao se edita -- e o botao diz por que", () => {
  const linha = realizada({ tipo: "transfer" });

  assert.equal(podeEditar(linha), false);
  assert.equal(caminhoDeEdicao(linha, "/dashboard/transferencias", null), null);

  const motivo = motivoSemEditar(linha);
  assert.ok(motivo, "o Editar apagado ficou sem motivo escrito");
  assert.match(motivo, /duas pernas/);
  assert.match(motivo, /órfã/);

  // E ela CONTINUA podendo ser excluida: a exclusao apaga as duas pernas.
  assert.equal(podeExcluir(linha), true);
});

test("a transferencia PREVISTA se edita -- ela e UMA linha com as duas contas", () => {
  // A diferenca e real e nao um detalhe: as duas pernas nascem na BAIXA
  // (`pagarTransferencia`), nao na agenda. Recusar as duas juntas tiraria a
  // edicao da unica tela em que a transferencia recorrente aparece.
  const linha = prevista({ tipo: "transfer" });

  assert.equal(podeEditar(linha), true);
  assert.equal(motivoSemEditar(linha), null);
});

// ---------------------------------------------------------------------------
// 8. Para onde cada exclusao vai
// ---------------------------------------------------------------------------

test("a conta prevista sai pela rota da agenda, com `alcance` EXPLICITO", () => {
  const pedido = pedidoDeExclusao(prevista({ id: "s9" }));

  assert.deepEqual(pedido, {
    metodo: "DELETE",
    url: "/api/scheduled-transactions/s9",
    corpo: { alcance: "apenas_esta" },
  });
});

test("o alcance e `apenas_esta`, e NUNCA `todas` -- a serie nao sai por aqui", () => {
  // `todas` chama `encerrarRegra`, o mesmo caminho de
  // DELETE /api/recurring-rules/{id}: ele encerra o gasto fixo inteiro. Um
  // clique distraido nao pode encerrar uma serie, e esta tela nao pergunta o
  // alcance (quem pergunta e Contas a Pagar, HMO-228).
  for (const natureza of ["despesa", "fixa"]) {
    const pedido = pedidoDeExclusao(prevista({ natureza }));
    assert.equal(pedido.corpo.alcance, "apenas_esta", `natureza ${natureza}`);
  }
});

test("a transferencia realizada sai pela rota que apaga AS DUAS pernas", () => {
  // Pela rota de lancamento comum a FK `ON DELETE SET NULL` do 015 nao reclama:
  // a outra perna FICA, com o elo zerado, mexendo o saldo de UMA conta. Meia
  // transferencia nao tem sintoma -- o extrato parece completo e o patrimonio
  // esta errado pelo valor inteiro.
  const pedido = pedidoDeExclusao(realizada({ id: "t9", tipo: "transfer" }));

  assert.deepEqual(pedido, {
    metodo: "DELETE",
    url: "/api/movimentacoes/transferencia?id=t9",
  });
  assert.ok(
    !pedido.url.includes("personal-finance"),
    "a transferencia foi para a rota de lancamento comum -- a outra perna ficaria"
  );
});

test("a receita e a despesa realizadas saem pela rota de lancamento", () => {
  for (const tipo of ["income", "expense"]) {
    const pedido = pedidoDeExclusao(realizada({ id: "t9", tipo }));
    assert.deepEqual(pedido, {
      metodo: "DELETE",
      url: "/api/personal-finance/transactions/t9",
    });
  }
});

test("as tres exclusoes vao para rotas DIFERENTES -- nenhuma colapsou nas outras", () => {
  const urls = [
    pedidoDeExclusao(prevista()).url,
    pedidoDeExclusao(realizada({ tipo: "transfer" })).url,
    pedidoDeExclusao(realizada({ tipo: "expense" })).url,
  ];
  assert.equal(new Set(urls).size, 3, `rotas repetidas: ${urls}`);
});

// ---------------------------------------------------------------------------
// 9. A frase da confirmacao: ocorrencia x regra fixa
// ---------------------------------------------------------------------------

test("a frase da conta FIXA diz que a REGRA continua -- a da avulsa, que nao volta", () => {
  // As duas respondem 200 e as duas tiram a linha da tela: NADA no app
  // distingue uma da outra depois do clique. Quem clicou em Excluir num aluguel
  // fixo e viu a linha sumir concluiu que o aluguel acabou -- e ele volta no mes
  // seguinte.
  const daFixa = avisoDaExclusao(prevista({ natureza: "fixa" }), "Aluguel");
  const daAvulsa = avisoDaExclusao(prevista({ natureza: "despesa" }), "Boleto");

  assert.match(daFixa, /ocorrência/);
  assert.match(daFixa, /continua ativo/);
  assert.match(daFixa, /gerar as próximas/);
  assert.ok(daFixa.includes('"Aluguel"'), daFixa);

  assert.match(daAvulsa, /excluída de vez|não volta/);
  assert.ok(daAvulsa.includes('"Boleto"'), daAvulsa);

  // AS DUAS FRASES SAO DIFERENTES, e esta e a assercao que importa: um texto
  // unico para os dois casos passaria em metade dos `match` acima e seria o
  // defeito inteiro.
  assert.notEqual(daFixa, daAvulsa);
  // E a da avulsa NAO promete que alguma coisa continua.
  assert.ok(!daAvulsa.includes("continua ativo"), daAvulsa);
});

test("a frase da transferencia avisa das DUAS pernas", () => {
  const frase = avisoDaExclusao(realizada({ tipo: "transfer" }), "Itaú → Nubank");

  assert.match(frase, /DUAS contas/);
  assert.match(frase, /duas pernas/);
});

test("a frase do lancamento comum nao fala de serie nem de pernas", () => {
  const frase = avisoDaExclusao(realizada({ tipo: "expense" }), "Mercado");

  assert.ok(frase.includes('"Mercado"'), frase);
  assert.ok(!frase.includes("perna"), frase);
  assert.ok(!frase.includes("gasto fixo"), frase);
});

test("linha sem descricao nao vira a palavra 'null' na pergunta", () => {
  // `descricao` e `string | null` em `LinhaDaTela`, e a lista mostra "Sem
  // descrição" nesse caso. Uma interpolacao crua perguntaria 'Excluir "null"?'.
  for (const nome of [null, undefined, "", "   "]) {
    const frase = avisoDaExclusao(realizada(), nome);
    assert.ok(!frase.includes("null"), frase);
    assert.ok(!frase.includes("undefined"), frase);
    assert.ok(frase.includes("este lançamento"), frase);
  }
});

// ---------------------------------------------------------------------------
// 10. O caminho de edicao da linha realizada
// ---------------------------------------------------------------------------

test("o Editar da realizada leva `?id=` e o `?origem=` de volta para esta tela", () => {
  const caminho = caminhoDeEdicao(
    realizada({ id: "t7" }),
    "/dashboard/movimentacoes/despesa",
    "/dashboard/despesas?de=2026-08-01&ate=2026-08-31"
  );

  assert.match(caminho, /^\/dashboard\/movimentacoes\/despesa\?id=t7&origem=/);
  // A ORIGEM LEVA O PERIODO DENTRO (HMO-249): sem ele, fechar a edicao de uma
  // despesa de agosto devolveria a pessoa ao mes corrente, onde ela nao esta.
  assert.ok(
    decodeURIComponent(caminho).includes("de=2026-08-01&ate=2026-08-31"),
    caminho
  );
});

test("a origem de FORA e descartada, e o caminho continua valendo", () => {
  // `comOrigem` passa por `origemSegura`, que recusa host externo. O que esta
  // assercao garante e que a recusa nao leva o `?id=` junto: sem o id, o
  // formulario abriria VAZIO e o Salvar criaria um lancamento NOVO em vez de
  // editar o que a pessoa clicou -- dois lancamentos onde havia um.
  const caminho = caminhoDeEdicao(
    realizada({ id: "t7" }),
    "/dashboard/movimentacoes/despesa",
    "//golpe.example"
  );

  assert.equal(caminho, "/dashboard/movimentacoes/despesa?id=t7");
  assert.ok(!caminho.includes("golpe"), caminho);
});

test("a PREVISTA nao tem caminho de edicao -- ela se edita no formulario em linha", () => {
  // `?id=` do formulario completo le `financial_transactions`; uma conta
  // prevista nao esta la. O caminho montado abriria um formulario vazio.
  assert.equal(
    caminhoDeEdicao(prevista(), "/dashboard/movimentacoes/despesa", null),
    null
  );
  // E ela CONTINUA editavel -- so por outro caminho.
  assert.equal(podeEditar(prevista()), true);
});

// ---------------------------------------------------------------------------
// 11. O PATCH da conta prevista, e as tres recusas dele
// ---------------------------------------------------------------------------

const EDICAO_OK = {
  descricao: "Aluguel",
  valor: "2500,00",
  vencimento: "2026-11-05",
};

test("o PATCH leva os tres campos, o valor em NUMERO e o alcance escrito", () => {
  const r = pedidoDeEdicaoDaPrevista(prevista({ id: "s5" }), EDICAO_OK);

  assert.ok(!("erro" in r), JSON.stringify(r));
  assert.deepEqual(r.pedido, {
    metodo: "PATCH",
    url: "/api/scheduled-transactions/s5",
    corpo: {
      description: "Aluguel",
      amount: 2500,
      due_date: "2026-11-05",
      alcance: "apenas_esta",
    },
  });
});

test("a VIRGULA decimal chega como numero, e o ponto de milhar nao multiplica", () => {
  // `Number("1.234,56")` e NaN, e `type="number"` DESCARTA a virgula enquanto se
  // digita (medido na HMO-271) -- por isso o campo e `text` e a conversao mora
  // aqui. O erro na direcao oposta e pior: "1.234,56" lido como 1.234 grava um
  // aluguel de R$ 1,23.
  const casos = [
    ["2500,00", 2500],
    ["1.234,56", 1234.56],
    ["1234.56", 123456],
    ["0,99", 0.99],
    ["10", 10],
  ];

  for (const [digitado, esperado] of casos) {
    const r = pedidoDeEdicaoDaPrevista(prevista(), { ...EDICAO_OK, valor: digitado });
    assert.ok(!("erro" in r), `"${digitado}" foi recusado: ${JSON.stringify(r)}`);
    assert.equal(r.pedido.corpo.amount, esperado, `"${digitado}"`);
  }
});

test("valor vazio, zero, negativo ou lixo e RECUSADO antes de sair", () => {
  // `Number("")` e 0, que NAO e NaN e passa por qualquer `isNaN`: sem a guarda
  // de `> 0`, o PATCH sairia com `amount: 0` e a rota responderia 400 com texto
  // em portugues que a tela mostraria como erro de servidor.
  for (const valor of ["", "   ", "0", "0,00", "-10", "abc", "R$ 10"]) {
    const r = pedidoDeEdicaoDaPrevista(prevista(), { ...EDICAO_OK, valor });
    assert.ok("erro" in r, `"${valor}" passou`);
    assert.match(r.erro, /maior que zero/);
  }
});

test("descricao vazia e vencimento mal formado sao RECUSADOS, cada um com o seu texto", () => {
  const semDescricao = pedidoDeEdicaoDaPrevista(prevista(), {
    ...EDICAO_OK,
    descricao: "   ",
  });
  assert.ok("erro" in semDescricao);
  assert.match(semDescricao.erro, /Descrição/);

  for (const vencimento of ["", "05/11/2026", "2026-11", "2026-13-99x"]) {
    const r = pedidoDeEdicaoDaPrevista(prevista(), { ...EDICAO_OK, vencimento });
    assert.ok("erro" in r, `"${vencimento}" passou`);
    assert.match(r.erro, /AAAA-MM-DD/);
  }
});

test("a descricao vai APARADA -- espaco em volta nao vira o nome da conta", () => {
  const r = pedidoDeEdicaoDaPrevista(prevista(), {
    ...EDICAO_OK,
    descricao: "  Aluguel  ",
  });
  assert.equal(r.pedido.corpo.description, "Aluguel");
});

test("a linha REALIZADA e a de outro membro nao chegam ao PATCH da agenda", () => {
  // A rota da agenda sobre um id de `financial_transactions` responde 404; a
  // linha alheia e recusada pela RLS.
  for (const linha of [realizada(), prevista({ posso_editar: false })]) {
    const r = pedidoDeEdicaoDaPrevista(linha, EDICAO_OK);
    assert.ok("erro" in r, JSON.stringify(r));
    assert.match(r.erro, /não pode ser editada/);
  }
});

// ---------------------------------------------------------------------------
// 12. Os dois rotulos fixos
// ---------------------------------------------------------------------------

test("os rotulos de Editar e Excluir existem e sao diferentes", () => {
  assert.equal(ROTULO_DE_EDITAR, "Editar");
  assert.equal(ROTULO_DE_EXCLUIR, "Excluir");
  assert.notEqual(ROTULO_DE_EDITAR, ROTULO_DE_EXCLUIR);
});

// ---------------------------------------------------------------------------
// 11. A CADEIA DE PRODUCAO, E NAO TRES SUITES CONCORDANDO SOBRE UMA FIXTURE
// ---------------------------------------------------------------------------
// ESTE BLOCO EXISTE PORQUE UM DEFEITO PASSOU POR TODAS AS OUTRAS SUITES.
//
// A fase 14 foi entregue, mergeada e publicada com 104 assercoes verdes -- e na
// tela de Despesas de producao a linha da fatura saiu SEM o botao. A causa: a
// fatura ABERTA sintetizada nao carregava `user_id` (`FaturaPrevista` nao tinha
// o campo), entao `linhaPrevista` a marcava `posso_editar: false`, e
// `podePagarAFatura` -- que exige `posso_editar`, com razao -- a recusava.
//
// E A RAZAO DE NINGUEM TER VISTO E O QUE IMPORTA AQUI: as fixtures de fatura
// aberta deste repositorio (`faturaAberta()` acima, `FATURA` em
// test-secao-da-tela.mjs) CARREGAVAM `posso_editar: false` -- copiado da
// producao de entao, quando aquele valor nao tinha consequencia nenhuma, porque
// `podeAgirNaLinha` ja recusava a fatura por `gravada: false` ANTES de olhar o
// campo. As fixtures estavam certas sobre o DADO e erradas sobre o FATO, e
// nenhuma assercao tinha como notar: as tres suites concordavam entre si.
//
// O que nenhuma delas fazia era PERGUNTAR A PRODUCAO de onde aquele dado vem.
// E o que este bloco faz: ele monta a linha pela cadeia real
// (`sintetizarFaturasAbertas` -> `linhaPrevista` -> `podePagarAFatura`), sem
// escrever `posso_editar` em lugar nenhum.

const MEU_ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";

/** A fatura ABERTA como PRODUCAO a produz -- nada escrito a mao aqui. */
function faturaAbertaDaProducao(userId = MEU_ID) {
  const { previstas } = sintetizarFaturasAbertas({
    linhas: [
      {
        account_id: CARTAO,
        account_name: "Nubank",
        invoice_month: "2026-10-01",
        invoice_due_date: "2026-10-28",
        invoice_amount: 317.45,
      },
    ],
    userId,
    chavesPersistidas: [],
    de: "2026-10-01",
    ate: "2026-10-31",
    hoje: "2026-10-06",
  });
  return previstas[0];
}

test("CADEIA: a fatura ABERTA de producao chega a tela com o botao Pagar", () => {
  const crua = faturaAbertaDaProducao();
  assert.ok(crua, "a sintese nao produziu fatura -- o caso nao vale");

  const linha = linhaPrevista(crua, MEU_ID);
  assert.ok(linha, "`linhaPrevista` descartou a fatura -- o caso nao vale");

  // O QUE A CADEIA PRODUZ, e nao o que esta suite gostaria que ela produzisse.
  assert.equal(linha.natureza, "fatura");
  assert.equal(linha.gravada, false, "a fatura aberta nao existe no banco");
  assert.equal(
    linha.posso_editar,
    true,
    "a fatura sintetizada chegou a tela como linha de OUTRA pessoa -- foi este o defeito que a HMO-311 publicou"
  );

  // E A CONCLUSAO: o botao existe.
  assert.equal(podePagarAFatura(linha), true);

  // E a baixa generica continua recusada, pelos dois motivos de sempre.
  assert.equal(podeAgirNaLinha(linha), false);
  assert.equal(pedidoDeConfirmacao(linha), null);
});

test("CADEIA: a fatura aberta de OUTRA pessoa nao ganha o botao", () => {
  // O PAR, e ele e o que impede o conserto de virar "aprove tudo": a cadeia
  // tambem tem de DIZER NAO. O `userId` da sintese e o de quem leu
  // `card_invoice_lines`; quem OLHA a tela e o segundo argumento de
  // `linhaPrevista`. Com os dois diferentes, a linha nao e minha.
  const crua = faturaAbertaDaProducao("bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb");
  const linha = linhaPrevista(crua, MEU_ID);

  assert.equal(linha.posso_editar, false);
  assert.equal(podePagarAFatura(linha), false);
});
