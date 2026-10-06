// =========================================================
// PULODOGATO - para onde o lancamento volta, e o que "Salvar e continuar"
// preserva (HMO-249)
// =========================================================
//   npm run test:retorno-lancamento
//
// Roda o JS compilado de lib/retorno-do-lancamento.ts. Aquele modulo nao importa
// nada em tempo de execucao (so o TIPO de lib/lancamento.ts, que o emit apaga),
// entao nao ha passo de resolve-aliases aqui.
//
// O CONTROLE DE CADA BLOCO
// ------------------------
// Antes desta issue as tres telas terminavam em
// `router.push("/dashboard/personal-finance")` -- uma constante. Entao o
// "antes" de toda assercao de destino e essa string, e ela esta escrita nos
// casos: sem isso, `assert.equal(destino, "/dashboard/despesas?de=...")` passa
// verde numa funcao que devolvesse o `origem` cru sem peneirar -- que e
// exatamente o redirecionamento aberto que `origemSegura` existe para fechar.
//
// E o controle do "Salvar e continuar" e o VALOR: um `proximoLancamento` que
// nao limpasse `valor` deixaria o segundo clique em Salvar gravar o mesmo gasto
// de novo. Por isso todo caso daquele bloco afirma sobre `valor` e `descricao`
// explicitamente, e nao por `deepEqual` contra um objeto esperado -- deepEqual
// contra um objeto que eu mesmo escrevi nao distingue "limpou" de "eu escrevi o
// valor errado no esperado".
// =========================================================

import test from "node:test";
import assert from "node:assert/strict";

const {
  PARAM_DE_ORIGEM,
  ROTAS_DE_LANCAMENTO,
  ROTA_PADRAO_DE_RETORNO,
  comOrigem,
  destinoDepoisDeSalvar,
  origemSegura,
  proximaTransferencia,
  proximoLancamento,
} = await import("../.tmp-retorno-lancamento/retorno-do-lancamento.js");

/** O destino fixo que as tres telas usavam antes desta issue. */
const ANTES = "/dashboard/personal-finance";

// ---------------------------------------------------------
// origemSegura: a peneira do que vem da URL
// ---------------------------------------------------------

test("a tela de origem volta inteira, COM a query do periodo", () => {
  const tela = "/dashboard/despesas?de=2026-01-01&ate=2026-01-31";

  assert.equal(origemSegura(tela), tela);

  // O que importa: a query nao e descartada. Voltar so para
  // `/dashboard/despesas` abriria o mes corrente, e a despesa de janeiro que
  // acabou de ser lancada ficaria fora da tela.
  assert.ok(origemSegura(tela).includes("de=2026-01-01"));
  assert.ok(origemSegura(tela).includes("ate=2026-01-31"));
});

test("fragmento e caminho sem query tambem passam", () => {
  assert.equal(origemSegura("/dashboard"), "/dashboard");
  assert.equal(origemSegura("/dashboard/cartoes/abc-123"), "/dashboard/cartoes/abc-123");
  assert.equal(origemSegura("/dashboard/bills#atrasadas"), "/dashboard/bills#atrasadas");
});

test("espaco em volta nao reprova uma origem boa", () => {
  assert.equal(origemSegura("  /dashboard/bills  "), "/dashboard/bills");
});

test("host de fora e RECUSADO -- as quatro grafias", () => {
  // Esta e a razao de a funcao existir: o momento depois de confirmar um
  // lancamento e o de maior confianca na tela, e e nele que o app levaria a
  // pessoa para fora.
  for (const fora of [
    "https://golpe.example/pagar",
    "http://golpe.example",
    // Protocolo-relativo: comeca com `/`, entao uma guarda ingenua aprova, e o
    // navegador vai para o host de fora do mesmo jeito.
    "//golpe.example/dashboard",
    // A mesma coisa com barra invertida, que os navegadores normalizam para `//`.
    "/\\golpe.example",
  ]) {
    assert.equal(origemSegura(fora), null, `deveria recusar: ${fora}`);
  }
});

test("`javascript:` e `data:` tambem sao recusados", () => {
  assert.equal(origemSegura("javascript:alert(1)"), null);
  assert.equal(origemSegura("data:text/html,<script>alert(1)</script>"), null);
});

test("caractere de controle no meio da URL nao escapa da peneira", () => {
  // O truque classico contra quem compara so o comeco da string.
  //
  // O NUL abaixo vai como ESCAPE de seis caracteres, e nao como byte
  // literal. Um byte zero cru no arquivo faz o git classificar a FONTE como
  // BINARIA: o diff fica opaco e o merge de tres vias para de funcionar
  // naquele arquivo. Foi o que aconteceu na primeira volta desta suite.
  assert.equal(origemSegura("/dashboard\n//golpe.example"), null);
  assert.equal(origemSegura("/dashboard/bills\tx"), null);
  assert.equal(origemSegura("/dashboard/bills\u0000"), null);
  assert.equal(origemSegura("/dashboard/bi lls"), null);
});

test("rota interna que nao e tela do dashboard e recusada", () => {
  // `/api/...` devolveria JSON na cara da pessoa depois de ela salvar.
  assert.equal(origemSegura("/api/financial-accounts"), null);
  // `/login` se le como "fui desconectado", e o lancamento parece perdido.
  assert.equal(origemSegura("/login"), null);
  assert.equal(origemSegura("/"), null);
  // Caminho relativo: o navegador resolveria contra a rota do modal.
  assert.equal(origemSegura("dashboard/bills"), null);
});

test("`/dashboardfalso` nao passa por `/dashboard`", () => {
  // `startsWith("/dashboard")` sozinho aprovaria -- e e o jeito obvio de
  // escrever esta guarda.
  assert.equal(origemSegura("/dashboardfalso"), null);
  assert.equal(origemSegura("/dashboard-publico/x"), null);
});

test("as proprias telas de lancamento sao recusadas como origem", () => {
  // Senao o Salvar fecharia o modal e abriria o MESMO modal de novo, em cima de
  // um formulario limpo -- indistinguivel de "o botao nao fez nada", com o
  // lancamento ja gravado.
  for (const rota of ROTAS_DE_LANCAMENTO) {
    assert.equal(origemSegura(rota), null, `deveria recusar: ${rota}`);
    assert.equal(origemSegura(`${rota}?cartao=abc`), null);
  }

  // E as tres estao na lista: uma lista com duas deixaria a terceira em laco.
  assert.equal(ROTAS_DE_LANCAMENTO.length, 3);
});

test("vazio, nulo e indefinido viram null, nao excecao", () => {
  assert.equal(origemSegura(null), null);
  assert.equal(origemSegura(undefined), null);
  assert.equal(origemSegura(""), null);
  assert.equal(origemSegura("   "), null);
});

test("URL absurdamente longa e recusada", () => {
  assert.equal(origemSegura(`/dashboard/bills?x=${"a".repeat(600)}`), null);
});

// ---------------------------------------------------------
// destinoDepoisDeSalvar: fechar, continuar, ou o fallback
// ---------------------------------------------------------

test("sem origem, o destino e o MESMO de antes desta issue", () => {
  // O caso que garante que nenhum link antigo muda de significado.
  assert.equal(
    destinoDepoisDeSalvar({ origem: null, continuar: false }),
    ANTES
  );
  assert.equal(ROTA_PADRAO_DE_RETORNO, ANTES);
});

test("com origem, volta para a tela de onde a pessoa veio", () => {
  const tela = "/dashboard/despesas?de=2026-01-01&ate=2026-01-31";
  const destino = destinoDepoisDeSalvar({ origem: tela, continuar: false });

  assert.equal(destino, tela);
  // CONTROLE: e preciso ser DIFERENTE do destino fixo de antes, senao a
  // assercao acima passaria numa funcao que ignora `origem`.
  assert.notEqual(destino, ANTES);
});

test("origem envenenada cai no padrao -- nao no host de fora", () => {
  assert.equal(
    destinoDepoisDeSalvar({ origem: "https://golpe.example", continuar: false }),
    ANTES
  );
  assert.equal(
    destinoDepoisDeSalvar({ origem: "//golpe.example", continuar: false }),
    ANTES
  );
});

test("`continuar` ligado devolve null: fica na tela", () => {
  assert.equal(
    destinoDepoisDeSalvar({ origem: null, continuar: true }),
    null
  );
  // E vence a origem: quem ligou o interruptor pediu para NAO sair.
  assert.equal(
    destinoDepoisDeSalvar({ origem: "/dashboard/bills", continuar: true }),
    null
  );
});

test("o fallback da transferencia mensal continua sendo Contas Previstas", () => {
  // Herdado da HMO-164: a regra mensal aparece em /dashboard/bills, e nao na
  // lista de lancamentos. Cair na lista se leria como "nao salvou".
  assert.equal(
    destinoDepoisDeSalvar({
      origem: null,
      fallback: "/dashboard/bills",
      continuar: false,
    }),
    "/dashboard/bills"
  );
  assert.notEqual(
    destinoDepoisDeSalvar({
      origem: null,
      fallback: "/dashboard/bills",
      continuar: false,
    }),
    ANTES
  );
});

test("a origem explicita VENCE o fallback", () => {
  // Quem clicou em "Nova Transferência" dentro de uma tela pediu para voltar
  // para ela, inclusive criando uma regra mensal.
  assert.equal(
    destinoDepoisDeSalvar({
      origem: "/dashboard/transferencias?de=2026-03-01&ate=2026-03-31",
      fallback: "/dashboard/bills",
      continuar: false,
    }),
    "/dashboard/transferencias?de=2026-03-01&ate=2026-03-31"
  );
});

// ---------------------------------------------------------
// comOrigem: o link que abre o modal
// ---------------------------------------------------------

test("o link ganha `?origem=` com o endereco escapado", () => {
  const link = comOrigem(
    "/dashboard/movimentacoes/despesa",
    "/dashboard/despesas?de=2026-01-01&ate=2026-01-31"
  );

  assert.equal(
    link,
    "/dashboard/movimentacoes/despesa?origem=%2Fdashboard%2Fdespesas%3Fde%3D2026-01-01%26ate%3D2026-01-31"
  );
  assert.equal(PARAM_DE_ORIGEM, "origem");

  // O `&` e o `?` da origem TEM de estar escapados: cru, o `&ate=` seria lido
  // como um parametro do modal, e `origemSegura` receberia metade do endereco.
  assert.ok(!link.slice(link.indexOf("origem=")).includes("&"));
});

test("rota que JA tem query recebe a origem com `&`", () => {
  // "Lancar gasto neste cartao" chega como `...despesa?cartao=<id>`. Um `?` a
  // mais faria `origem` virar parte do valor de `cartao`, e o cartao travado
  // sumiria do formulario sem nenhum erro.
  const link = comOrigem(
    "/dashboard/movimentacoes/despesa?cartao=abc-123",
    "/dashboard/cartoes/abc-123"
  );

  assert.equal(
    link,
    "/dashboard/movimentacoes/despesa?cartao=abc-123&origem=%2Fdashboard%2Fcartoes%2Fabc-123"
  );
  // O cartao continua la, intacto.
  assert.ok(link.includes("cartao=abc-123"));
  assert.equal(link.split("?").length, 2, "um `?` so");
});

test("o link e a leitura fecham: o que comOrigem escreve, origemSegura aceita", () => {
  // O par que impede os dois lados de divergirem. Sem ele, um escape a mais de
  // um lado deixa o modal sempre caindo no destino padrao -- que e o
  // comportamento de ANTES da issue, ou seja, uma regressao invisivel.
  const tela = "/dashboard/despesas?de=2026-01-01&ate=2026-01-31";
  const link = comOrigem("/dashboard/movimentacoes/despesa", tela);

  // E o que o navegador entrega a `searchParams.get("origem")`.
  const lido = new URL(link, "https://exemplo.test").searchParams.get(
    PARAM_DE_ORIGEM
  );

  assert.equal(lido, tela);
  assert.equal(origemSegura(lido), tela);
});

test("origem ruim nao suja o link: ele sai sem parametro nenhum", () => {
  assert.equal(
    comOrigem("/dashboard/movimentacoes/receita", "https://golpe.example"),
    "/dashboard/movimentacoes/receita"
  );
  assert.equal(
    comOrigem("/dashboard/movimentacoes/receita", null),
    "/dashboard/movimentacoes/receita"
  );
});

// ---------------------------------------------------------
// proximoLancamento: o que sobrevive a "Salvar e continuar"
// ---------------------------------------------------------

/** O estado inicial, como `valoresIniciais()` devolve. */
const inicial = () => ({
  descricao: "",
  valor: "",
  categoriaId: "",
  contaId: "",
  data: "2026-10-04",
  dataPrevista: "2026-10-04",
  confirmado: true,
  notas: "",
  natureza: "one_off",
  diaDeVencimento: "",
  duracao: "indefinida",
  mesesDeRepeticao: "",
  moeda: "BRL",
  moedaSobreposta: false,
  cotacao: "",
  parcelado: false,
  baseDoValorParcelado: "parcela",
  parcelaAtual: "1",
  totalDeParcelas: "1",
  compartilhado: false,
  grupoId: "",
  rateios: [],
});

/** O que a pessoa acabou de lancar: uma conta da viagem, rateada. */
const lancado = () => ({
  ...inicial(),
  descricao: "Jantar do primeiro dia",
  valor: "240.00",
  categoriaId: "cat-alimentacao",
  subcategoriaId: "sub-restaurante",
  contaId: "conta-nubank",
  data: "2026-03-15",
  dataPrevista: "2026-03-15",
  notas: "mesa de 4",
  moeda: "USD",
  moedaSobreposta: true,
  cotacao: "5.12",
  compartilhado: true,
  grupoId: "grupo-viagem",
  rateios: [{ participanteId: "p1", percentual: 50 }],
});

test("o valor e a descricao SAO LIMPOS -- e isso que impede gravar duas vezes", () => {
  const antes = lancado();
  // CONTROLE: antes do reset, o segundo clique em Salvar gravaria isto de novo.
  assert.equal(antes.valor, "240.00");
  assert.equal(antes.descricao, "Jantar do primeiro dia");

  const proximo = proximoLancamento(antes, inicial());

  assert.equal(proximo.valor, "", "sem valor, `validarLancamento` recusa o reenvio");
  assert.equal(proximo.descricao, "");
  assert.equal(proximo.notas, "");
});

test("o contexto SOBREVIVE: e para isso que a opcao existe", () => {
  const proximo = proximoLancamento(lancado(), inicial());

  assert.equal(proximo.categoriaId, "cat-alimentacao");
  assert.equal(proximo.subcategoriaId, "sub-restaurante");
  assert.equal(proximo.contaId, "conta-nubank");
  assert.equal(proximo.data, "2026-03-15", "a data do lancamento, nao hoje");
  assert.equal(proximo.dataPrevista, "2026-03-15");
  assert.equal(proximo.grupoId, "grupo-viagem");
  assert.equal(proximo.compartilhado, true);
  assert.deepEqual(proximo.rateios, [{ participanteId: "p1", percentual: 50 }]);
  assert.equal(proximo.moeda, "USD");
  assert.equal(proximo.cotacao, "5.12");

  // CONTROLE: o inicial tem OUTROS valores nestes campos. Sem esta linha, as
  // assercoes acima passariam numa funcao que devolvesse `valores` intocado E
  // numa que devolvesse `inicial` -- se por acaso coincidissem.
  assert.notEqual(inicial().categoriaId, "cat-alimentacao");
  assert.notEqual(inicial().data, "2026-03-15");
  assert.notEqual(inicial().moeda, "USD");
});

test("o parcelamento NAO sobrevive: uma segunda serie de 10x seria dinheiro em dobro", () => {
  const parcelado = {
    ...lancado(),
    parcelado: true,
    baseDoValorParcelado: "total",
    parcelaAtual: "1",
    totalDeParcelas: "10",
  };
  // CONTROLE: e isto que ficaria ligado se o reset esquecesse o bloco.
  assert.equal(parcelado.parcelado, true);
  assert.equal(parcelado.totalDeParcelas, "10");

  const proximo = proximoLancamento(parcelado, inicial());

  assert.equal(proximo.parcelado, false);
  assert.equal(proximo.totalDeParcelas, "1");
  assert.equal(proximo.parcelaAtual, "1");
  assert.equal(proximo.baseDoValorParcelado, "parcela");
});

test("a despesa fixa guarda os campos da recorrencia -- eles vao com a natureza", () => {
  const fixa = {
    ...lancado(),
    natureza: "fixed",
    diaDeVencimento: "10",
    duracao: "contada",
    mesesDeRepeticao: "12",
  };

  const proximo = proximoLancamento(fixa, inicial());

  assert.equal(proximo.natureza, "fixed");
  assert.equal(proximo.diaDeVencimento, "10");
  assert.equal(proximo.duracao, "contada");
  assert.equal(proximo.mesesDeRepeticao, "12");
  // E o valor continua limpo: a segunda regra fixa tem de ser digitada.
  assert.equal(proximo.valor, "");
});

test("o reset nao MUTA o estado que recebeu", () => {
  // `setValores(atual => proximoLancamento(atual, ...))` em React: mutar o
  // objeto anterior faria o render nao perceber a mudanca em alguns caminhos.
  const antes = lancado();
  const copia = JSON.parse(JSON.stringify(antes));

  proximoLancamento(antes, inicial());

  assert.deepEqual(antes, copia, "o objeto de entrada ficou intacto");
});

test("todo campo do estado existe no resultado -- nenhum vira undefined", () => {
  const antes = lancado();
  const proximo = proximoLancamento(antes, inicial());

  for (const chave of Object.keys(antes)) {
    assert.ok(
      chave in proximo,
      `${chave} desapareceu: um campo faltando vira undefined no formulario`
    );
  }
});

// ---------------------------------------------------------
// proximaTransferencia
// ---------------------------------------------------------

test("a transferencia limpa valor e descricao e guarda origem/destino/data", () => {
  const inicialT = {
    descricao: "",
    valor: "",
    origemId: "",
    destinoId: "",
    data: "2026-10-04",
    notas: "",
    natureza: "one_off",
    diaDeVencimento: "",
    duracao: "indefinida",
    mesesDeRepeticao: "",
  };
  const feita = {
    ...inicialT,
    descricao: "Pix para a poupança",
    valor: "1000.00",
    origemId: "conta-corrente",
    destinoId: "conta-poupanca",
    data: "2026-03-15",
    notas: "primeira parcela",
  };

  // CONTROLE: o valor que o segundo clique gravaria de novo -- e aqui ele vale
  // o DOBRO, porque transferencia grava duas pernas.
  assert.equal(feita.valor, "1000.00");

  const proxima = proximaTransferencia(feita, inicialT);

  assert.equal(proxima.valor, "");
  assert.equal(proxima.descricao, "");
  assert.equal(proxima.notas, "");
  assert.equal(proxima.origemId, "conta-corrente", "o par de contas fica");
  assert.equal(proxima.destinoId, "conta-poupanca");
  assert.equal(proxima.data, "2026-03-15");
  assert.notEqual(proxima.origemId, inicialT.origemId);
});
