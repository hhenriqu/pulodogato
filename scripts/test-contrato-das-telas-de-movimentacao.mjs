// O contrato entre as tres telas de movimentacao e a rota delas (HMO-246).
//
// POR QUE ESTE TESTE E DE TEXTO, E NAO DE COMPORTAMENTO
// -----------------------------------------------------
// Mesmo desenho do test-contrato-do-fechamento.mjs, e pela mesma razao: `await
// res.json()` e `any`, entao atribuir a resposta da rota a interface do
// componente NAO e checado pelo tsc. Um campo renomeado em um dos dois lados
// chega `undefined`, o `??` do componente o transforma em zero, e a tela mostra
// "Total R$ 0,00" num mes com despesa -- exatamente o zero confiante que o
// resto deste recorte foi escrito para impedir.
//
// Aqui o campo e o numero: `resumo`, `linhas` e `vencido` sao Total, Previsto e
// Realizado e a lista que os sustenta. A ARITMETICA esta coberta por
// test-telas-de-movimentacao.mjs e por 32 mutantes; o que ESTE teste tranca e o
// nome dos campos no caminho entre os tres arquivos -- e o `?tipo=`, que e o
// unico parametro que distingue as tres telas.
//
// COMENTARIO E CODIGO SAO SEPARADOS ANTES DE QUALQUER ASSERCAO
// ------------------------------------------------------------
// Os arquivos deste recorte sao muito comentados, e os comentarios citam os
// nomes dos campos. Uma assercao textual que nao tire os comentarios passa
// verde casando com a PROSA que descreve o campo em vez da linha que o produz
// -- um verde que sobrevive a remocao do campo.
//
//   npm run test:contrato-das-telas-de-movimentacao

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const COMPONENTE = "components/movimentacoes/TelaDeMovimentacao.tsx";
/**
 * Os tres cartoes moram em arquivo PROPRIO desde a HMO-246.
 *
 * `TelaDeMovimentacao.tsx` importa `next/navigation`, que nao roda no node;
 * com os cartoes la dentro, o teste que renderiza a marcacao deles morreria no
 * import. As assercoes sobre `resumo?.total` e `podeMostrarNumero` tem de ler
 * ESTE arquivo -- apontadas para o outro elas falhavam sem que nada estivesse
 * errado no app, que e a pior especie de teste: ele treina quem o ve vermelho a
 * ignorar a suite inteira.
 */
const CARTOES = "components/movimentacoes/CartoesDaTela.tsx";
const ROTA = "app/api/movimentacoes/resumo/route.ts";
const LIB = "lib/telas-de-movimentacao.ts";
/** Onde a constante do tipo de conta de cartao mora de verdade. */
const AGENDA_DO_CARTAO = "lib/agenda-do-cartao.ts";

/** Tira comentario de bloco e de linha -- ver o cabecalho. */
function semComentarios(fonte) {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const componente = semComentarios(readFileSync(COMPONENTE, "utf8"));
const cartoes = semComentarios(readFileSync(CARTOES, "utf8"));
const rota = semComentarios(readFileSync(ROTA, "utf8"));
const lib = semComentarios(readFileSync(LIB, "utf8"));

/** Os campos declarados numa `interface X { ... }`. */
function camposDaInterface(fonte, nome, arquivo) {
  const bloco = fonte.match(
    new RegExp(`interface ${nome} \\{([\\s\\S]*?)\\n\\}`)
  );
  assert.ok(
    bloco,
    `Nao achei a interface ${nome} em ${arquivo}. Se ela foi renomeada, ` +
      `atualize este teste -- nao o apague: ele e o unico lugar que liga a ` +
      `rota ao componente, porque o tsc nao liga.`
  );
  return bloco[1]
    .split("\n")
    .map((l) => l.trim())
    .map((l) => l.match(/^([a-z_][a-z0-9_]*)\??:/i))
    .filter(Boolean)
    .map((m) => m[1]);
}

/** As chaves do `NextResponse.json({ ... })` de sucesso da rota. */
function camposQueARotaDevolve() {
  const bloco = rota.match(
    /return NextResponse\.json\(\{\n\s*success: true,([\s\S]*?)\n\s*\}\);/
  );
  assert.ok(
    bloco,
    `Nao achei o NextResponse.json de sucesso em ${ROTA}. As respostas de erro ` +
      `nao servem: elas nao tem nenhum dos campos que a tela le.`
  );

  return bloco[1]
    .split("\n")
    .map((l) => l.trim())
    .map((l) => l.match(/^([a-z_][a-z0-9_]*)\s*[:,]/i))
    .filter(Boolean)
    .map((m) => m[1]);
}

test("a rota devolve todo campo que a tela le", () => {
  const lidos = camposDaInterface(componente, "RespostaDaTela", COMPONENTE);
  const devolvidos = camposQueARotaDevolve();

  // Controle da propria extracao: se um dos lados vier vazio, o `filter` abaixo
  // passa por vacuidade e o teste nao mede nada.
  assert.ok(lidos.length >= 4, `extrai poucos campos do componente: ${lidos}`);
  assert.ok(devolvidos.length >= 4, `extrai poucos campos da rota: ${devolvidos}`);

  const faltando = lidos.filter((c) => !devolvidos.includes(c));
  assert.deepEqual(
    faltando,
    [],
    `A tela le ${faltando.join(", ")}, e a rota nao devolve. Chega undefined, ` +
      `o \`??\` vira zero, e a tela mostra R$ 0,00 num periodo com lançamento.`
  );

  // Os tres que SAO a issue. Um `assert` generico passaria verde se os dois
  // lados perdessem o campo junto.
  for (const campo of ["resumo", "linhas", "vencido"]) {
    assert.ok(devolvidos.includes(campo), `a rota nao devolve \`${campo}\``);
    assert.ok(lidos.includes(campo), `a tela nao le \`${campo}\``);
  }
});

test("os tres numeros da tela sao os tres campos de ResumoDaTela", () => {
  const naLib = camposDaInterface(lib, "ResumoDaTela", LIB);

  // Total, Previsto e Realizado: os tres que a issue pede, com o nome que o
  // cartao usa em `resumo?.total` e companhia.
  for (const campo of ["total", "previsto", "realizado"]) {
    assert.ok(naLib.includes(campo), `${campo} saiu de ResumoDaTela`);
    assert.match(
      cartoes,
      new RegExp(`resumo\\?\\.${campo}`),
      `${CARTOES} nao le resumo?.${campo} -- o cartao sairia com travessao sempre`
    );
  }

  // A contagem embaixo do Total.
  assert.ok(naLib.includes("quantidade"));
  assert.match(cartoes, /resumo\.quantidade/);
});

test("todo campo de LinhaDaTela tem leitor -- na tela ou na propria lib", () => {
  // Um campo que a lib produz e ninguem consome e feature que existe e nao
  // existe ao mesmo tempo: ela chega na resposta, ocupa bytes, e nada na tela a
  // mostra. Este repositorio ja teve `account_id` selecionado pelo `*` da
  // consulta e sem leitor nenhum por meses (HMO-215).
  //
  // Os campos se dividem em dois grupos, e o teste nao pode exigir o mesmo
  // leitor dos dois:
  const naLib = camposDaInterface(lib, "LinhaDaTela", LIB);

  // 1. OS QUE A TELA DESENHA. Cada um aparece numa linha da lista.
  for (const campo of [
    "id",
    "gravada",
    "descricao",
    "valor",
    "data",
    "situacao",
    "categoria",
    "conta",
    "moeda",
  ]) {
    assert.ok(naLib.includes(campo), `${campo} saiu de LinhaDaTela`);
    assert.match(
      componente,
      new RegExp(`linha\\.${campo}`),
      `a tela nao le linha.${campo} -- a lib produz e a lista nao mostra`
    );
  }

  // 2. OS QUE A LIB USA PARA DECIDIR, e que por isso NAO aparecem na tela:
  // `origem` e o que `secoesDaTela`, `resumoDaTela` e `previstoVencido` leem
  // para separar previsto de realizado, e `tipo` e o que `linhasDaTela` compara
  // com a tela pedida. Exigir `linha.origem` no JSX obrigaria a tela a refazer
  // uma separacao que a lib ja fez -- e duas implementacoes da mesma regra
  // divergem.
  for (const campo of ["origem", "tipo"]) {
    assert.ok(naLib.includes(campo), `${campo} saiu de LinhaDaTela`);
    assert.match(
      lib,
      new RegExp(`\\.${campo} ===`),
      `nada na lib decide por \`${campo}\` -- o campo virou enfeite`
    );
  }

  // E a tela consome a separacao por `origem` pelo caminho certo: as duas
  // secoes saem de `secoesDaTela`, nao de um filtro escrito no JSX.
  assert.match(componente, /secoesDaTela\(linhas\)/);
  assert.match(componente, /const \{ previstas, realizadas \}/);
});

test("a tela chama a rota com `tipo` e `de`/`ate`, que e o que a rota le", () => {
  // Se um lado escrever `type` e o outro `tipo`, a rota responde 400 e as tres
  // telas abrem no painel de erro -- ou, pior, se houvesse padrao, as tres
  // mostrariam despesa.
  assert.match(
    componente,
    /\/api\/movimentacoes\/resumo\?tipo=\$\{tipo\}&\$\{queryDoPeriodo\}/,
    "a tela nao chama a rota com ?tipo= e o periodo na querystring"
  );
  // E `queryDoPeriodo` SAI de `periodoParaQuery`, nao de uma string montada a
  // mao: e ela quem escolhe os nomes `de`/`ate` que `periodoDaQuery` le na
  // rota. Um `?from=` contra um `get("de")` cai no mes corrente em silencio.
  assert.match(componente, /const queryDoPeriodo = periodoParaQuery\(periodo\)/);
  assert.match(rota, /params\.get\("tipo"\)/, "a rota nao le o parametro `tipo`");
  assert.match(
    rota,
    /periodoDaQuery\(params\.get\("de"\), params\.get\("ate"\)\)/,
    "a rota nao le `de`/`ate` por periodoDaQuery"
  );
  // `periodoParaQuery` e quem emite `de=&ate=`: a tela nao monta a querystring
  // a mao, senao os nomes se separariam dos que `periodoDaQuery` espera.
  assert.match(componente, /periodoParaQuery/);
});

test("as tres rotas do catalogo tem pagina, e as tres paginas usam o container", () => {
  // A rota vem de `TELAS_DE_MOVIMENTACAO` e e usada em `irPara` (o seletor de
  // periodo troca a URL). Uma rota sem arquivo de pagina vira 404 do Next
  // quando a pessoa troca o mes -- e o link do menu funcionava.
  for (const [tipo, caminho] of [
    ["income", "app/(dashboard)/dashboard/receitas/page.tsx"],
    ["expense", "app/(dashboard)/dashboard/despesas/page.tsx"],
    ["transfer", "app/(dashboard)/dashboard/transferencias/page.tsx"],
  ]) {
    const pagina = readFileSync(caminho, "utf8");
    assert.match(
      pagina,
      new RegExp(`TelaDeMovimentacao tipo="${tipo}"`),
      `${caminho} nao monta TelaDeMovimentacao com tipo="${tipo}"`
    );
    // Sem o `Suspense`, `useSearchParams` reprova a rota no build do Next.
    assert.match(pagina, /Suspense/, `${caminho} sem o limite de suspensao`);

    const rotaDoCatalogo = caminho
      .replace("app/(dashboard)", "")
      .replace("/page.tsx", "");
    assert.ok(
      lib.includes(`rota: "${rotaDoCatalogo}"`),
      `o catalogo nao aponta para ${rotaDoCatalogo}`
    );
  }
});

test("o menu lateral leva para as tres telas", () => {
  // A HMO-145 deste repositorio achou tres features em producao sem nenhum item
  // de menu apontando para elas: as rotas respondiam 200 e nao havia como
  // chegar la clicando, entao a feature existia e nao existia ao mesmo tempo.
  const sidebar = semComentarios(readFileSync("components/Sidebar.tsx", "utf8"));

  for (const rotaDaTela of [
    "/dashboard/receitas",
    "/dashboard/despesas",
    "/dashboard/transferencias",
  ]) {
    assert.ok(
      sidebar.includes(`href: "${rotaDaTela}"`),
      `o menu nao tem item para ${rotaDaTela}`
    );
  }
});

test("as tres telas abrem sem rede -- elas sao alcancaveis de rota precacheada", () => {
  // O menu lateral e a frase de cabecalho de /dashboard/personal-finance (que
  // ESTA no precache) levam para as tres. Uma delas fora da lista abriria o
  // menu sem rede com os tres itens e cairia na pagina /offline generica no
  // toque -- o mesmo defeito que a HMO-165 pagou quando o formulario saiu para
  // rota propria sem entrar no precache.
  //
  // As tres podem estar la porque pagam o pedagio: todo numero passa por
  // `podeMostrarNumero` (sem dado, travessao -- nunca R$ 0,00) e as duas frases
  // de secao vazia passam por `podeAfirmarVazio`.
  const precache = semComentarios(readFileSync("lib/pwa-precache.js", "utf8"));

  for (const rotaDaTela of [
    "/dashboard/receitas",
    "/dashboard/despesas",
    "/dashboard/transferencias",
  ]) {
    assert.ok(
      precache.includes(`"${rotaDaTela}"`),
      `${rotaDaTela} esta no menu e nao no precache: sem rede o item aparece e ` +
        `o toque cai na /offline`
    );
  }

  // O pedagio, afirmado onde ele mora. `podeMostrarNumero` tem de ser a porta
  // de TODO numero -- `numero()` e a unica funcao que formata os cartoes, e e
  // ela que decide entre o valor e o travessao. Os tres numeros estao em
  // CartoesDaTela.tsx; as frases de secao vazia, no container.
  assert.match(cartoes, /podeMostrarNumero\(estado\) && resumo/);
  assert.match(cartoes, /<NumeroIndisponivel \/>/);
  assert.match(componente, /podeAfirmarVazio\(estado\)/);
});

test("o `credit_card` da lib e o MESMO de agenda-do-cartao", () => {
  // HMO-260. `lib/telas-de-movimentacao.ts` declara `TIPO_CARTAO` em vez de
  // importar o de `lib/agenda-do-cartao.ts`, e a razao esta documentada la: o
  // import arrastaria `card-invoice` -> `transferencia` -> `lancamento` para
  // dentro do tsconfig de `rootDir: lib` que as suites e o mutador usam.
  //
  // O preco e uma fonte de verdade duplicada, e o modo de falha dela e MUDO:
  // um typo (`credit-card`) nao da erro -- nenhuma linha casa, o filtro passa a
  // nao filtrar nada, e o Total da tela de Despesas volta a somar a compra no
  // cartao junto da fatura que ja a contem. Esta assercao e o que impede as
  // duas declaracoes de se separarem.
  const agenda = semComentarios(readFileSync(AGENDA_DO_CARTAO, "utf8"));

  const daAgenda = agenda.match(/export const TIPO_CARTAO = "([^"]+)"/);
  const daLib = lib.match(/export const TIPO_CARTAO = "([^"]+)"/);

  // Controle da extracao: sem ele, um `match` nulo dos dois lados passaria por
  // vacuidade e o teste nao mediria nada.
  assert.ok(daAgenda, `nao achei TIPO_CARTAO em ${AGENDA_DO_CARTAO}`);
  assert.ok(daLib, `nao achei TIPO_CARTAO em ${LIB}`);

  assert.equal(
    daLib[1],
    daAgenda[1],
    `TIPO_CARTAO e "${daLib[1]}" em ${LIB} e "${daAgenda[1]}" em ` +
      `${AGENDA_DO_CARTAO}. As duas telas do cartao param de concordar sobre ` +
      `o que e um cartao, e o lado errado nao da erro -- ele so para de filtrar.`
  );
  assert.equal(daLib[1], "credit_card", "o valor do ENUM account_type mudou?");
});

test("a rota TRAZ `account_type` no embed -- sem ele o filtro do cartao é vácuo", () => {
  // HMO-260. A regra e pura e tem mutante, mas ela decide sobre um campo que
  // esta consulta precisa pedir. Tirar `account_type` do `select` -- numa
  // limpeza de campos "nao usados na tela" -- nao quebra tsc nem teste de
  // unidade: a regra recebe `undefined` em toda linha, para de casar com
  // `credit_card`, e o Total volta a somar o cartao duas vezes.
  assert.match(
    rota,
    /account:financial_accounts\([^)]*account_type[^)]*\)/,
    "o `select` do realizado nao pede `account_type` no embed da conta"
  );

  // E a lib de fato decide por ele, no lado realizado e so na tela de Despesas.
  // O `===`/`!==` nao esta na regex de proposito: a comparacao ja mudou de
  // sentido uma vez (quando o segundo criterio entrou) e um teste que cobra a
  // forma da expressao fica vermelho numa refatoracao que nao muda nada.
  assert.match(
    lib,
    /account_type\s*[!=]==\s*TIPO_CARTAO/,
    "nada na lib compara `account_type` com TIPO_CARTAO"
  );
  assert.match(
    lib,
    /tipo === "expense" && ehGastoNoCartao\(crua\)/,
    "o gasto no cartao nao esta sendo tirado do realizado da tela de Despesas"
  );

  // O SEGUNDO CRITERIO, que e o que impede o conserto de APAGAR dinheiro.
  // `card_invoice_lines` (006/035) filtra `t.transaction_type IN
  // ('expense','income')` pela COLUNA, e ha linha com a coluna NULA em
  // producao: ela NAO esta na fatura. Escondida daqui pelo tipo da conta, ela
  // sairia da tela sem que nada a somasse no lugar.
  //
  // A leitura e da coluna CRUA e nao de `classificarMovimentacao`, que deriva o
  // tipo da categoria ou do sinal -- ele chamaria de despesa exatamente a linha
  // que a view descartou.
  assert.match(
    lib,
    /TIPOS_QUE_ENTRAM_NA_FATURA\.has\(String\(crua\.transaction_type\)\)/,
    "`ehGastoNoCartao` deixou de conferir o `transaction_type` GRAVADO: a " +
      "compra no cartao com a coluna nula sai de Despesas sem estar na fatura"
  );
  // E a lista e a copia do `WHERE` da view, nao uma escolha deste modulo.
  assert.match(lib, /"expense",\s*\n\s*"income",/);
});

test("a tela DIZ que a compra no cartão está na fatura, e não no Realizado", () => {
  // HMO-260. "Gastos do cartao devem aparecer apenas no financas pessoais que
  // lista o que voce lancou, e dentro do cartao de credito."
  //
  // Um valor que falta sem rotulo e indistinguivel de um bug: sem esta frase o
  // Realizado de quem gasta no cartao fica muito menor que a lista de Finanças
  // Pessoais do mesmo mes, e o caminho dessa estranheza termina em alguem
  // lançando a compra outra vez no débito para "consertar" o total.
  //
  // A assercao e sobre o TEXTO que o JSX produz, com os comentarios ja
  // removidos -- e por isso que ela nao passa verde casando com a prosa que
  // descreve a frase.
  assert.match(
    componente,
    /Compra no cartão não entra no Realizado/,
    "a tela de Despesas nao diz onde a compra no cartao foi"
  );
  // E ela aponta para os lugares onde o valor ESTA.
  assert.match(componente, /href="\/dashboard\/cartoes"/);
  assert.match(componente, /href="\/dashboard\/personal-finance"/);

  // Inclusive para o caso que a frase curta erraria: depois da baixa a fatura
  // sai do Previsto (status `paid`) e o valor vive numa TRANSFERENCIA de duas
  // pernas. Nesse mes esta tela mostra R$ 0,00 de cartao -- medido --, e uma
  // frase que dissesse apenas "esta no Previsto acima" apontaria para um
  // Previsto vazio, o que e pior que nao ter frase nenhuma.
  assert.match(
    componente,
    /depois de paga, ela aparece em/,
    "a frase nao diz onde a fatura PAGA foi -- no mes da baixa ela aponta para " +
      "um Previsto que nao tem mais a fatura"
  );
  assert.match(componente, /href="\/dashboard\/transferencias"/);

  // A frase e condicionada a tela de Despesas: em Receitas e Transferencias ela
  // falaria de um filtro que nao existe naquelas telas.
  assert.match(componente, /\{tipo === "expense" && \(/);

  // E o rotulo do cartao "Realizado" de Despesas tambem diz, porque e o numero
  // que encolheu. A frase mora no catalogo, nao no JSX.
  const daLib = lib.match(
    /tipo: "expense",[\s\S]*?oQueORealizadoE:\s*\n?\s*"([^"]+)"/
  );
  assert.ok(daLib, "nao achei oQueORealizadoE da tela de Despesas no catalogo");
  assert.match(
    daLib[1],
    /cartão/,
    `o rotulo do Realizado de Despesas ("${daLib[1]}") nao menciona o cartao`
  );
});

test("a barra de abas por tipo saiu de Finanças Pessoais", () => {
  // "Finanças pessoais deve ser uma grande lista de transações e lançamentos
  // indiferente do que for." As abas filtravam SO a lista: os tres cartoes do
  // topo somavam o periodo inteiro, entao a aba "Transferências" abria com uma
  // lista de transferencias e "Despesas R$ 4.200" parado logo acima dela.
  const tela = semComentarios(
    readFileSync("app/(dashboard)/dashboard/personal-finance/page.tsx", "utf8")
  );

  assert.ok(
    !/FILTROS_DE_LANCAMENTO/.test(tela),
    "a barra de abas por tipo voltou a Finanças Pessoais -- ela filtra a lista " +
      "sem mexer nos cartoes, e os dois juntos se leem como um total errado"
  );
  assert.ok(
    !/<TabsTrigger/.test(tela),
    "ha TabsTrigger em Finanças Pessoais de novo"
  );
  // E a lista continua sendo a de TODOS os tipos, dito explicitamente.
  assert.match(
    tela,
    /linhasDaLista\(transactions, partesDeGrupo, "todos"\)/,
    'a lista de Finanças Pessoais nao esta mais chamada com "todos"'
  );
});
