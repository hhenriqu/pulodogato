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
  rotuloDeConfirmar,
} = await import("../.tmp-acoes-da-linha/lib/acoes-da-linha.js");

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
