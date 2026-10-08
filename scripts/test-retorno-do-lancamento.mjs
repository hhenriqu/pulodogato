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
  proximaDespesaDeGrupo,
  proximaMovimentacaoDeCarteira,
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

// ---------------------------------------------------------
// proximaMovimentacaoDeCarteira (HMO-252)
// ---------------------------------------------------------
// O CONTROLE DESTE BLOCO e o par quantidade+preco, e o custo de deixa-lo na
// tela nao e uma linha repetida na lista: e o PRECO MEDIO do ativo.
//
// Quem tinha 100 PETR4 a R$ 20,00 e compra 100 a R$ 31,50 passa a ter 200 a
// R$ 25,75. Com o formulario ainda preenchido, um segundo clique grava a mesma
// compra: 300 acoes a R$ 27,67. O numero errado continua parecendo um numero --
// nao ha linha estranha para notar, e o lucro, o prejuizo e a rentabilidade
// daquele ativo passam todos a sair daquele R$ 27,67.
//
// Por isso as assercoes abaixo sao sobre CAMPO, uma por campo, e nao um
// `deepEqual` contra um objeto esperado: deepEqual contra um objeto que eu
// mesmo escrevi nao distingue "limpou" de "eu escrevi o valor errado no
// esperado".

/** O estado inicial do formulario, como ele abre. */
const inicialM = () => ({
  assetId: "",
  kind: "buy",
  quantidade: "",
  preco: "",
  taxas: "",
  data: "2026-10-08",
});

/** O que a pessoa acabou de lancar: a compra de 100 PETR4 a R$ 31,50. */
const movimentada = () => ({
  ...inicialM(),
  assetId: "ativo-petr4",
  kind: "buy",
  quantidade: "100",
  preco: "31.50",
  taxas: "4.90",
  data: "2026-03-15",
});

test("quantidade e preco SAO LIMPOS -- e isso que impede errar o preco medio", () => {
  const antes = movimentada();
  // CONTROLE: antes do reset, o segundo clique em "Lançar" gravaria esta mesma
  // compra de novo, e ela entraria na conta do preco medio.
  assert.equal(antes.quantidade, "100");
  assert.equal(antes.preco, "31.50");

  const proxima = proximaMovimentacaoDeCarteira(antes, inicialM());

  assert.equal(
    proxima.quantidade,
    "",
    "sem quantidade o campo `required` recusa o reenvio em vez de aceita-lo"
  );
  assert.equal(proxima.preco, "");
});

test("as taxas tambem saem: corretagem herdada e preco medio errado pelo outro lado", () => {
  const antes = movimentada();
  assert.equal(antes.taxas, "4.90");

  const proxima = proximaMovimentacaoDeCarteira(antes, inicialM());

  assert.equal(proxima.taxas, "");
});

test("o ativo, o tipo e a data SOBREVIVEM: e para isso que a opcao existe", () => {
  const proxima = proximaMovimentacaoDeCarteira(movimentada(), inicialM());

  assert.equal(
    proxima.assetId,
    "ativo-petr4",
    "lancar os tres proventos do mesmo ativo sem reescolher o ativo"
  );
  assert.equal(proxima.kind, "buy");
  assert.equal(proxima.data, "2026-03-15");
  // Que o ativo e a data sobreviveram so quer dizer algo porque eles DIFEREM do
  // inicial: sem esta linha, um reset total passaria no caso de cima.
  assert.notEqual(proxima.assetId, inicialM().assetId);
  assert.notEqual(proxima.data, inicialM().data);
});

test("o provento guarda o tipo escolhido -- `buy` de volta seria outra operacao", () => {
  // O caso real de quem poe a carteira em dia: a temporada de proventos. Se o
  // tipo voltasse para "Compra", a segunda linha do mes viraria uma COMPRA do
  // valor do provento -- dinheiro que entrou lancado como dinheiro que saiu.
  const provento = { ...movimentada(), kind: "dividend", quantidade: "100", preco: "0.87" };

  const proxima = proximaMovimentacaoDeCarteira(provento, inicialM());

  assert.equal(proxima.kind, "dividend");
  assert.notEqual(proxima.kind, inicialM().kind);
});

test("o reset da carteira nao MUTA o estado que recebeu", () => {
  // Mesmo motivo do caso irmao de `proximoLancamento`: em React o reset roda
  // dentro de `setValores(atual => ...)`, e mutar `atual` ali e um estado que o
  // React nao sabe que mudou.
  const antes = movimentada();
  const copia = JSON.parse(JSON.stringify(antes));

  proximaMovimentacaoDeCarteira(antes, inicialM());

  assert.deepEqual(antes, copia, "o objeto de entrada ficou intacto");
});

test("todo campo da movimentacao existe no resultado -- nenhum vira undefined", () => {
  const antes = movimentada();
  const proxima = proximaMovimentacaoDeCarteira(antes, inicialM());

  for (const chave of Object.keys(antes)) {
    assert.ok(
      chave in proxima,
      `${chave} desapareceu: um campo faltando vira undefined no formulario`
    );
  }
});

// ---------------------------------------------------------
// proximaDespesaDeGrupo (HMO-251)
// ---------------------------------------------------------
// O CONTROLE DESTE BLOCO e `amount` -- e aqui ele nao custa o dinheiro de quem
// digitou. A despesa de grupo e rateada entre os participantes por um trigger do
// banco (`group_expense_splits`, migration 042), entao a despesa gravada duas
// vezes manda cobranca para a conta de OUTRAS PESSOAS. No extrato do grupo a
// linha duplicada e indistinguivel de duas contas iguais no mesmo dia -- num
// jantar de viagem, plausivel --, e ninguem tem como desconfiar.
//
// Os campos sao em ingles porque o estado do formulario e em ingles
// (`expenseForm` em app/(dashboard)/dashboard/expense-groups/[groupId]/page.tsx).
// As fixtures abaixo copiam aquele estado campo a campo de proposito: uma
// fixture com nomes traduzidos passaria em todos os casos deste bloco sobre uma
// funcao que nao limpa nada do formulario de verdade.

/** O estado inicial, como `valoresIniciaisDaDespesa()` devolve na tela. */
const inicialG = () => ({
  description: "",
  amount: "",
  category_id: "",
  transaction_date: "2026-10-08",
  notes: "",
  split_type: "equal",
  currency: "BRL",
  cotacao: "",
});

/** O que a pessoa acabou de lancar: o jantar da viagem, em dolar, por percentual. */
const despesaDoGrupo = () => ({
  ...inicialG(),
  description: "Jantar do primeiro dia",
  amount: "240.00",
  category_id: "cat-alimentacao",
  transaction_date: "2026-03-15",
  notes: "mesa de 4",
  split_type: "percentage",
  currency: "USD",
  cotacao: "5.12",
});

test("o valor e a descricao SAO LIMPOS -- aqui o duplo envio cobra de OUTRAS pessoas", () => {
  const antes = despesaDoGrupo();
  // CONTROLE: antes do reset, um segundo clique em "Adicionar Despesa" gravaria
  // esta mesma despesa de novo -- e o trigger do banco a ratearia entre os
  // participantes outra vez.
  assert.equal(antes.amount, "240.00");
  assert.equal(antes.description, "Jantar do primeiro dia");

  const proxima = proximaDespesaDeGrupo(antes, inicialG());

  assert.equal(
    proxima.amount,
    "",
    "sem valor, handleAddExpense recusa o reenvio em vez de aceita-lo calado"
  );
  assert.equal(proxima.description, "");
});

test("a observacao da despesa anterior nao vai para a seguinte", () => {
  const antes = despesaDoGrupo();
  assert.equal(antes.notes, "mesa de 4");

  const proxima = proximaDespesaDeGrupo(antes, inicialG());

  assert.equal(proxima.notes, "");
});

test("categoria, data, moeda e cotacao SOBREVIVEM: e para isso que a opcao existe", () => {
  const proxima = proximaDespesaDeGrupo(despesaDoGrupo(), inicialG());

  assert.equal(
    proxima.category_id,
    "cat-alimentacao",
    "lancar as cinco contas da viagem sem reescolher a categoria"
  );
  assert.equal(proxima.transaction_date, "2026-03-15");
  assert.equal(proxima.currency, "USD", "a proxima conta da viagem tambem e em dolar");
  assert.equal(
    proxima.cotacao,
    "5.12",
    "a cotacao e daquele dia naquela moeda -- continua certa, e limpa-la faria CampoDeCotacao buscar o mesmo numero"
  );
  // Que eles sobreviveram so quer dizer algo porque DIFEREM do inicial: sem
  // estas linhas, um reset total passaria nas assercoes de cima.
  assert.notEqual(proxima.category_id, inicialG().category_id);
  assert.notEqual(proxima.transaction_date, inicialG().transaction_date);
  assert.notEqual(proxima.currency, inicialG().currency);
});

test("o tipo de divisao sobrevive -- cair em partes IGUAIS caladas e o defeito oposto", () => {
  // A sugestao escolhida NAO mora neste objeto (e estado separado da tela, que
  // a pagina limpa junto), e e por isso que `split_type` pode ficar: com a
  // sugestao limpa e o tipo preservado, a tela PEDE a divisao de novo em vez de
  // ratear em partes iguais sem avisar. Uma divisao silenciosamente errada
  // parece ter funcionado -- e o pior dos dois defeitos.
  const proxima = proximaDespesaDeGrupo(despesaDoGrupo(), inicialG());

  assert.equal(proxima.split_type, "percentage");
  assert.notEqual(proxima.split_type, inicialG().split_type);
});

test("o reset da despesa de grupo nao MUTA o estado que recebeu", () => {
  // Mesmo motivo dos casos irmaos: na tela o reset roda dentro de
  // `setExpenseForm(atual => ...)`, e mutar `atual` ali e um estado que o React
  // nao sabe que mudou -- o valor da despesa anterior ficaria na tela.
  const antes = despesaDoGrupo();
  const copia = JSON.parse(JSON.stringify(antes));

  proximaDespesaDeGrupo(antes, inicialG());

  assert.deepEqual(antes, copia, "o objeto de entrada ficou intacto");
});

test("todo campo da despesa existe no resultado -- nenhum vira undefined", () => {
  const antes = despesaDoGrupo();
  const proxima = proximaDespesaDeGrupo(antes, inicialG());

  for (const chave of Object.keys(antes)) {
    assert.ok(
      chave in proxima,
      `${chave} desapareceu: um campo faltando vira undefined no formulario`
    );
  }
});
