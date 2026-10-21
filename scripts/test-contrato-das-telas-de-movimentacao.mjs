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
/**
 * A SECAO e a LINHA sairam para arquivo proprio na HMO-287, pelo mesmo motivo
 * que os cartoes sairam na HMO-246 -- e isso move os leitores de `LinhaDaTela`.
 *
 * Quem procura `linha.categoria` tem de olhar os DOIS arquivos: o container
 * continua sendo quem busca e separa as linhas, e este e quem as desenha.
 * Apontar a busca so para um dos dois daria um verde vazio no dia em que o
 * outro perdesse o leitor.
 */
const SECAO = "components/movimentacoes/SecaoDaTela.tsx";
/**
 * A LEITURA, a lista e as tres acoes sairam do container na HMO-301, pelo
 * MESMO motivo que os cartoes sairam na HMO-246 e a secao na HMO-287: o
 * container importa `next/navigation`, que nao roda no node, e com o `fetch`
 * la dentro nada neste repositorio conseguia montar a lista num navegador e
 * medir o gesto -- que confirmar uma linha a MOVE de "Previsto no período"
 * para "Realizado no período".
 *
 * Isso move de arquivo tres coisas que este teste afirma: a interface
 * `RespostaDaTela` (o contrato com a rota), a chamada com `?tipo=`, e o
 * `secoesDaTela`. Apontadas para o container elas falhariam sem nada estar
 * errado no app -- a pior especie de teste, porque treina quem a ve vermelha a
 * ignorar a suite inteira.
 */
const LISTA = "components/movimentacoes/ListaDeMovimentacao.tsx";
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
const secao = semComentarios(readFileSync(SECAO, "utf8"));
const lista = semComentarios(readFileSync(LISTA, "utf8"));
/**
 * Os TRES arquivos juntos: e onde os leitores de `LinhaDaTela` moram.
 *
 * Tres e nao dois desde a HMO-301. Buscar em so um daria um verde vazio no dia
 * em que outro perdesse o leitor -- e o container deixou de ser quem busca as
 * linhas, entao `componente` sozinho hoje nao tem leitor NENHUM.
 */
const telaInteira = `${componente}\n${lista}\n${secao}`;
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
  const lidos = camposDaInterface(lista, "RespostaDaTela", LISTA);
  const devolvidos = camposQueARotaDevolve();

  // Controle da propria extracao: se um dos lados vier vazio, o `filter` abaixo
  // passa por vacuidade e o teste nao mede nada.
  assert.ok(lidos.length >= 4, `extrai poucos campos da lista: ${lidos}`);
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
      telaInteira,
      new RegExp(`linha\\.${campo}`),
      `a tela nao le linha.${campo} -- a lib produz e a lista nao mostra`
    );
  }

  // 1b. OS DOIS QUE A HMO-285 CRIOU E A HMO-287 DESENHA. Eles estavam neste
  // teste como "produzidos nos dois lados" enquanto nada os lia; agora o
  // leitor existe, e e a SECAO que tem de ter. Sem esta exigencia, apagar o
  // icone e o rotulo nao reprovaria nada aqui -- os campos continuariam
  // chegando na resposta e sendo calculados certo.
  for (const campo of ["natureza", "fatura"]) {
    assert.ok(naLib.includes(campo), `${campo} saiu de LinhaDaTela`);
    assert.match(
      secao,
      new RegExp(`linha\\.${campo}`),
      `${SECAO} nao le linha.${campo} -- a lib produz e a linha nao mostra`
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
  assert.match(lista, /secoesDaTela\(linhas\)/);
  assert.match(lista, /const \{ previstas, realizadas \}/);
});

test("a tela chama a rota com `tipo` e `de`/`ate`, que e o que a rota le", () => {
  // Se um lado escrever `type` e o outro `tipo`, a rota responde 400 e as tres
  // telas abrem no painel de erro -- ou, pior, se houvesse padrao, as tres
  // mostrariam despesa.
  //
  // EM DUAS METADES, e nao numa URL literal (HMO-457). A querystring passou a
  // ser montada numa variavel, porque o botao "Atualizar" da faixa acrescenta
  // `semCopia` a ela -- e a assercao antiga, que casava
  // `/api/movimentacoes/resumo?tipo=${tipo}&${queryDoPeriodo}` de uma vez,
  // REPROVOU o codigo novo e certo. O que esta guarda precisa prender nao e a
  // forma de montar a URL: e que os nomes dos parametros sejam os que a rota le,
  // e que a rota chamada seja essa. As duas metades juntas continuam reprovando
  // um `type=` contra um `get("tipo")`, que e o defeito que ela existe para
  // pegar -- e a sonda de navegador (`npm run test:lista-na-tela`, caso P) mede
  // a URL MONTADA, que e a prova que nenhum grep consegue dar.
  assert.match(
    lista,
    /tipo=\$\{tipo\}&\$\{queryDoPeriodo\}/,
    "a lista nao monta a querystring com ?tipo= e o periodo"
  );
  assert.match(
    lista,
    /\/api\/movimentacoes\/resumo\?\$\{query\}/,
    "a lista nao chama /api/movimentacoes/resumo com a querystring montada"
  );
  // E o container e quem PASSA `queryDoPeriodo` para a lista: sem a prop, a
  // lista leria `undefined` na querystring e a rota responderia o mes
  // corrente para qualquer periodo escolhido -- o seletor pareceria nao
  // funcionar, com 200 e sem erro nenhum.
  assert.match(
    componente,
    /queryDoPeriodo=\{queryDoPeriodo\}/,
    "o container nao passa `queryDoPeriodo` para ListaDeMovimentacao"
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

test("a tela do cartao recebe o `?mes=` que a linha de fatura manda (HMO-287)", () => {
  // AS DUAS PONTAS DO LINK, NO MESMO TESTE. Cada lado tem suite propria -- o
  // `href` em test-secao-da-tela, o mes inicial em test-fatura-do-cartao -- e
  // as duas ficariam verdes com as pontas DESLIGADAS: a linha mandando `?mes=`
  // para uma pagina que o ignora abre no mes corrente, que e um destino
  // plausivel, com o valor certo e o mes errado.
  const paginaDoCartao = readFileSync(
    "app/(dashboard)/dashboard/cartoes/[id]/page.tsx",
    "utf8"
  );

  // A ponta que manda.
  assert.match(
    secao,
    /caminhoDoCartaoNoMes\(linha\.fatura\.accountId, linha\.fatura\.mes\)/,
    `${SECAO} nao monta o href da fatura por caminhoDoCartaoNoMes`
  );

  // A ponta que recebe -- pela CONSTANTE, nao pela string "mes" escrita a mao
  // nos dois lugares: duas literais iguais divergem na primeira renomeacao, e o
  // sintoma e a tela abrindo no mes corrente sem erro nenhum.
  assert.match(
    semComentarios(paginaDoCartao),
    /mesInicialDaFatura\(searchParams\.get\(PARAM_DO_MES\)\)/,
    "a tela do cartao nao le o mes da URL por PARAM_DO_MES"
  );

  // E `useSearchParams` exige o limite de suspensao: sem ele o `next build`
  // reprova a rota inteira, e `next lint` NAO pega.
  assert.match(paginaDoCartao, /<Suspense/, "a tela do cartao sem Suspense");
});

test("o menu lateral leva para as tres telas", () => {
  // A HMO-145 deste repositorio achou tres features em producao sem nenhum item
  // de menu apontando para elas: as rotas respondiam 200 e nao havia como
  // chegar la clicando, entao a feature existia e nao existia ao mesmo tempo.
  //
  // O array de navegacao morava em `components/Sidebar.tsx` e saiu de la na
  // HMO-284 (o modo papel de pao precisava filtra-lo numa suite de Node, sem
  // arrastar o componente). O arquivo mudou; o contrato, nao.
  const menu = semComentarios(
    readFileSync("components/navegacao-do-menu.ts", "utf8")
  );

  for (const rotaDaTela of [
    "/dashboard/receitas",
    "/dashboard/despesas",
    "/dashboard/transferencias",
  ]) {
    assert.ok(
      menu.includes(`href: "${rotaDaTela}"`),
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
  // CartoesDaTela.tsx; as frases de secao vazia, na lista (HMO-301).
  //
  // HMO-250: sao DOIS pedagios, e eles guardam coisas DIFERENTES -- um dentro
  // de `numero()` (os tres valores em dinheiro) e um na contagem embaixo do
  // Total, que nao passa por `numero()`. Um `assert.match` solto pelo trecho
  // `podeMostrarNumero(estado) && resumo` se contenta com QUALQUER um dos dois:
  // matar o de dentro de `numero()` pintava os tres cartoes de R$ 0,00 sem dado
  // e a suite seguia verde, satisfeita pelo da contagem. Cada um e ancorado no
  // seu proprio ponto de uso.
  assert.match(
    cartoes,
    /const numero = \([^)]*\) =>\s*podeMostrarNumero\(estado\) && resumo \?/,
    `${CARTOES}: o pedagio saiu de dentro de \`numero()\` -- sem dado os TRES ` +
      `cartoes pintariam R$ 0,00 em vez do travessao`
  );
  assert.match(
    cartoes,
    /podeMostrarNumero\(estado\) && resumo\s*\?\s*`\$\{resumo\.quantidade\}/,
    `${CARTOES}: a contagem embaixo do Total nao passa pelo pedagio -- sem dado ` +
      `ela afirmaria "0 lançamento(s)"`
  );
  assert.match(cartoes, /<NumeroIndisponivel \/>/);
  assert.match(lista, /podeAfirmarVazio\(estado\)/);
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

test("a rota TRAZ `notes` do realizado -- sem ele a fatura PAGA desaparece", () => {
  // HMO-264, e a MESMA familia de `account_type` e `recurring_rule_id`: o campo
  // e OPCIONAL em `RealizadaCrua` (a ausencia e o estado da maioria das linhas),
  // entao o `tsc` nao pode cobrar. Tirar `notes` deste `select` numa limpeza de
  // "campos nao usados na tela" nao quebra compilacao nem teste de unidade:
  // `ehPagamentoDaFatura` recebe `undefined` em toda linha, para de casar, e o
  // mes em que a fatura foi paga volta a fechar mais barato pelo valor dela
  // inteiro -- no Previsto, no Realizado e no Total.
  //
  // A SONDA E ANCORADA NO `select` DE `financial_transactions`, e nao no
  // arquivo: `notes` aparece tambem no `select` da view do lado previsto, e uma
  // sonda solta sobre a rota passaria verde lendo a outra consulta.
  const doRealizado = rota.match(
    /\.from\("financial_transactions"\)\s*\.select\(\s*`([^`]*)`/
  );
  assert.ok(
    doRealizado,
    `nao achei o \`select\` de financial_transactions em ${ROTA}`
  );
  assert.match(
    doRealizado[1],
    /\bnotes\b/,
    "o `select` do realizado nao pede `notes`: a tela de Despesas perde a " +
      "fatura PAGA inteira, sem erro e sem log"
  );
  // Controle da extracao: o campo que a sonda irma protege tem de estar no
  // MESMO bloco. Sem isto um `match` que capturasse o pedaco errado do arquivo
  // ainda poderia casar com `notes` por acaso.
  assert.match(
    doRealizado[1],
    /counterpart_transaction_id/,
    "a sonda capturou o bloco errado"
  );

  // `include_in_total` -- HMO-452, e ele e da MESMA familia pelo mesmo motivo.
  //
  // `RealizadaCrua.include_in_total` e OPCIONAL de proposito (o banco sem a 060
  // colada e o cache offline do aparelho chegam sem o campo, e `linhaRealizada`
  // resolve a ausencia com `!== false`), entao o `tsc` nao pode cobrar. Tira-lo
  // deste `select` numa limpeza de "campos nao usados" nao quebra compilacao
  // nem assercao de valor nenhuma: `soma_nos_totais` passa a ser `true` em toda
  // linha, o SELO "fora dos totais" desaparece da lista e a acao da linha para
  // de oferecer o inverso -- o estado de antes desta issue, de volta em
  // silencio. E o sintoma e o pior desta feature: a linha marcada fica na lista
  // somando ZERO no total acima, sem nada que explique a diferenca
  // (`sumido-da-tela-pode-ser-so-indistinguivel`).
  //
  // ESTA LINHA SO PODE EXISTIR DEPOIS DA COLAGEM DA 060, e a colagem foi
  // MEDIDA em producao em 2026-10-21 pelo PostgREST com a chave anon e com
  // controle negativo -- ver o bloco de comentario no proprio `select` da rota.
  // Nomear coluna ausente faz o PostgREST responder `42703` e o handler cair em
  // 500: as telas de Despesas e Receitas param de carregar inteiras (#335).
  assert.match(
    doRealizado[1],
    /\binclude_in_total\b/,
    "o `select` do realizado nao pede `include_in_total`: a lista perde o selo " +
      "e a acao «Não somar nos totais» em TODA linha, e a linha marcada volta a " +
      "somar zero no total sem nada explicando por que"
  );

  // E A LIB DE FATO DECIDE POR ELE. Os tres criterios, cada um ancorado no que
  // ele separa -- `ehPagamentoDaFatura` com um deles a menos continua compilando
  // e continua devolvendo `true` na perna de saida.
  assert.match(
    lib,
    /if \(!faturaDaChave\(crua\.notes\)\) return false;/,
    "`ehPagamentoDaFatura` nao confere mais a chave canonica: toda perna de " +
      "saida de transferencia passa a entrar na tela de Despesas"
  );
  assert.match(
    lib,
    /crua\.transaction_type\) !== TIPO_DA_PERNA_DE_PAGAMENTO/,
    "`ehPagamentoDaFatura` nao confere mais o `transaction_type` GRAVADO: a " +
      "despesa nascida do elo da fatura (HMO-305) entra pelo ramo da fatura, " +
      "perde o Editar/Excluir e passa POR CIMA de `ehGastoNoCartao`"
  );
  assert.match(
    lib,
    /if \(ehPernaDeEntrada\(crua\)\) return false;/,
    "`ehPagamentoDaFatura` nao distingue mais as duas pernas pelo dono unico " +
      "de 'qual das duas e esta': as duas tem a mesma chave e `valorEmReais` " +
      "passa `Math.abs`, entao o mes fecha no DOBRO"
  );
  // E O SINAL ESTRITO, QUE E ONDE MORA A DECISAO DO `amount === 0` -- HMO-317.
  // Ela tem de ser UMA, porque a MESMA funcao responde pela tela de Despesas e
  // pelo Realizado do painel (`realizadoComCartaoPelaFatura`,
  // lib/realizado-do-caixa.ts). As duas copias que existiam ate aquela issue
  // divergiam exatamente aqui, e nenhum total mudava -- que e por que a
  // divergencia podia durar.
  assert.match(
    lib,
    /return Number\(crua\.amount\) < 0;/,
    "`ehPagamentoDaFatura` perdeu o sinal ESTRITO: o par de pagamento de valor " +
      "zero volta a ser fatura paga na tela de Despesas e a ser promovido no " +
      "painel, onde soma R$ 0,00 e sobe DOIS no `transaction_count`"
  );

  // E O RAMO EXISTE, e so na tela de Despesas. Sem a guarda de `tipo`, a chave
  // canonica poe o pagamento da fatura no total de Receitas.
  assert.match(
    lib,
    /tipo === "expense" && ehPagamentoDaFatura\(crua\)/,
    "a fatura paga nao esta mais entrando no realizado da tela de Despesas"
  );
});

test("a rota LE a divida do MyBank e a CONCATENA nas previstas (HMO-377)", () => {
  // POR QUE UMA SONDA TEXTUAL AQUI, e nao so o mutante da lib: a mudanca desta
  // issue tem DUAS metades, e o mutador de lib/telas-de-movimentacao.ts nao
  // alcanca a segunda. `ehParcelaDevidaDoMyBank` pode estar perfeita e com
  // mutante morto enquanto a rota simplesmente nao chama `lerDividaDoMyBank` --
  // e o sintoma seria a aba Despesas voltando aos R$ 200,00 da main 40c7b01,
  // com a lib verde e o `tsc` verde. E a mesma armadilha que fez a HMO-379
  // achar `a_receber_do_mybank` sem um unico consumidor na UI.
  //
  // E A SONDA LE A FONTE SEM COMENTARIO (`semComentarios`), porque esta rota
  // CITA `lerDividaDoMyBank` dentro do comentario que explica a decisao: um
  // `includes` sobre o arquivo cru casaria com a explicacao e nao com o codigo
  // (`assercao-de-fiacao-casa-com-o-import`,
  // `guard-com-janela-de-chars-conta-comentario`).

  // 1. A CHAMADA EXISTE. O `import` sozinho nao prova nada -- ele e exatamente
  //    o que sobra quando alguem apaga o uso (`fiacao-provada-tirando-o-import`).
  assert.match(
    rota,
    /await lerDividaDoMyBank\(\s*supabase,\s*user\.id,/,
    `${ROTA} nao chama mais \`lerDividaDoMyBank\`: a parcela que a pessoa DEVE ` +
      "a uma conexao desaparece da aba Despesas e a tela volta a discordar de " +
      "Contas a Pagar pela mesma divida -- R$ 200,00 contra R$ 1.200,00"
  );

  // 2. E ELA E GUARDADA PELA ABA DE DESPESAS. Sem a guarda, Receitas e
  //    Transferencias gastam uma consulta por leitura para descartar tudo
  //    depois -- e a assercao de que elas NAO consultam a view esta medida na
  //    rota de verdade em scripts/test-leituras-do-mybank.mjs (leitura 4).
  assert.match(
    rota,
    /tela\.tipo === "expense"\)\s*\{\s*const leitura = await lerDividaDoMyBank/,
    "a leitura da divida do MyBank perdeu a guarda `tela.tipo === \"expense\"`"
  );

  // 3. O DONO DA LEITURA E PREENCHIDO. `ParcelaDevidaNaAgenda` nasce com
  //    `user_id: ""` de proposito (a view devolve `borrower_user_id`, mas quem
  //    carimba a sessao e a rota), e `posso_editar` sai de
  //    `ehMinha(crua.user_id, meuUserId)`. Sem esta chamada a parcela chega a
  //    tela marcada como linha de OUTRA PESSOA -- hoje isso nao muda botao
  //    nenhum (`gravada: false` ja recusa os tres), e e justamente por isso que
  //    a perda passaria calada. E a licao da HMO-311 na fatura sintetizada.
  assert.match(
    rota,
    /comODonoDaLeitura\(leitura\.linhas, user\.id\)/,
    `${ROTA} nao carimba mais o dono da parcela devida: \`posso_editar\` cai ` +
      "para `false` e a linha se apresenta como de outra pessoa"
  );

  // 4. E A LISTA DE FATO ENTRA EM `previstas`. E o elo que faz a linha existir:
  //    a leitura pode acontecer, o resultado ser guardado numa variavel e nunca
  //    chegar a `linhasDaTela` -- um estado que compila, nao quebra teste de
  //    unidade nenhum e devolve exatamente os numeros de antes desta issue
  //    (`coluna-declarada-e-nunca-lida-faz-conserto-de-view-virar-no-op`).
  const montagem = rota.match(/const previstas: PrevistaCrua\[\] = \[([^;]*)\];/);
  assert.ok(montagem, `nao achei a montagem de \`previstas\` em ${ROTA}`);
  assert.match(
    montagem[1],
    /\.\.\.\(parcelasDevidas as unknown as PrevistaCrua\[\]\)/,
    "a divida do MyBank e lida e NAO entra em `previstas`: a aba Despesas " +
      "continua sem a parcela, com a leitura acontecendo e o resultado descartado"
  );
  // Controle da extracao: as duas outras fontes do previsto tem de estar no
  // MESMO bloco capturado. Sem isto um `match` que pegasse o pedaco errado do
  // arquivo poderia casar por acaso.
  assert.match(montagem[1], /agendaPelaRegraDoPagador/, "a sonda capturou o bloco errado");
  assert.match(montagem[1], /fatura\.previstas/, "a sonda capturou o bloco errado");
});

test("o selo «MyBank» CHEGA a tela, e com a palavra de Contas a Pagar (HMO-377)", () => {
  // `natureza: "mybank"` existe desde a HMO-372 e ganhou o lado realizado na
  // HMO-380 -- e ate esta issue NENHUM componente o lia. O campo viajava na
  // resposta da rota e morria em `marcaDaLinha`, caindo no caso comum: a
  // parcela se apresentava como despesa qualquer. E o mesmo defeito que a
  // HMO-379 achou em `a_receber_do_mybank`, e a razao pela qual o teste
  // "todo campo de LinhaDaTela tem leitor" nao o pegou e que ele media o CAMPO
  // (`natureza` tem leitor) e nao o VALOR.
  assert.match(
    secao,
    /linha\.natureza === "mybank"/,
    "SecaoDaTela.tsx nao le `natureza === \"mybank\"`: a parcela que a pessoa " +
      "DEVE a uma conexao aparece como despesa comum de R$ 1.000 numa linha sem " +
      "botao nenhum, e isso e indistinguivel de bug"
  );

  // A PALAVRA E A MESMA DAS OUTRAS DUAS TELAS. `SELO_DO_MYBANK` e "MyBank" em
  // lib/emprestimo-do-mybank.ts, e e o que `ParcelaDevidaNaAgenda.selo` leva
  // para Contas a Pagar. A string esta escrita no componente (e nao importada)
  // para nao arrastar `@/lib/lancamento` para a arvore que a sonda de navegador
  // compila -- entao quem tranca a igualdade e esta assercao.
  const EMPRESTIMO = "lib/emprestimo-do-mybank.ts";
  const emprestimo = semComentarios(readFileSync(EMPRESTIMO, "utf8"));
  const declarado = emprestimo.match(
    /export const SELO_DO_MYBANK = "([^"]+)";/
  );
  assert.ok(declarado, `nao achei SELO_DO_MYBANK em ${EMPRESTIMO}`);

  const noRamo = secao.match(
    /linha\.natureza === "mybank"\)\s*\{\s*return \{[^}]*rotulo: "([^"]+)"/
  );
  assert.ok(noRamo, "nao achei o rotulo do ramo `mybank` em SecaoDaTela.tsx");
  assert.equal(
    noRamo[1],
    declarado[1],
    "o rotulo da lista divergiu de `SELO_DO_MYBANK`: as duas telas que mostram " +
      "a MESMA divida passam a chamá-la por nomes diferentes, e quem olha vai " +
      "procurar a diferenca que nao existe"
  );

  // E O ICONE NAO E O DO GASTO FIXO. A parcela E uma serie (3/24), entao
  // `Repeat` seria plausivel -- e e por isso que ele esta recusado: aquele
  // desenho ja significa "fixo" nesta lista, e dizer duas coisas com o mesmo
  // icone apaga a distincao que o rotulo tenta fazer.
  assert.doesNotMatch(
    noRamo[0],
    /Icone: Repeat/,
    "o selo do MyBank nao pode usar o icone do gasto fixo"
  );
});

test("a rota TRAZ `recurring_rule_id` da view -- sem ele toda conta fixa vira comum", () => {
  // HMO-285, e a MESMA familia de `account_type` acima. A diferenca e que aqui o
  // campo e OPCIONAL em `PrevistaCrua`, porque a ausencia dele e um estado
  // legitimo (a previsao avulsa nao tem regra). Isso fecha a ultima porta que o
  // tsc poderia ter fechado: tirar `recurring_rule_id` do `select` nao quebra
  // compilacao, nao quebra teste de unidade, nao muda um centavo em Total,
  // Previsto ou Realizado -- e faz TODA conta fixa do periodo se chamar comum.
  //
  // A SONDA E ANCORADA NO `select` DA VIEW, e nao no arquivo. Desde esta issue
  // `recurring_rule_id` aparece em DOIS lugares da rota (a view e a terceira
  // consulta), e uma sonda solta sobre o arquivo passaria verde lendo a outra --
  // exatamente o tipo de sonda que escorrega para a funcao vizinha.
  const daView = rota.match(
    /\.from\("scheduled_transactions_effective"\)\s*\.select\(\s*`([^`]*)`/
  );
  assert.ok(
    daView,
    `nao achei o \`select\` de scheduled_transactions_effective em ${ROTA}`
  );
  assert.match(
    daView[1],
    /recurring_rule_id/,
    "o `select` da view nao pede `recurring_rule_id`: a tela para de distinguir " +
      "conta fixa de despesa comum, sem erro e sem mudar nenhum total"
  );
  // Controle da extracao: o campo que a sonda irma protege tem de estar no
  // MESMO bloco. Sem isto, um `match` que capturasse o pedaco errado do arquivo
  // ainda poderia casar com `recurring_rule_id` por acaso.
  assert.match(daView[1], /direction/, "a sonda capturou o bloco errado");

  // E a terceira consulta, que e a unica fonte do lado REALIZADO: o elo e de uma
  // via (`financial_transactions` nao tem a coluna, 001), entao a pergunta tem
  // de ser feita do lado da agenda.
  assert.match(
    rota,
    /\.from\("scheduled_transactions"\)\s*\.select\("transaction_id, recurring_rule_id"\)/,
    "a terceira consulta saiu: nenhuma linha REALIZADA consegue mais saber que " +
      "veio de regra fixa, porque financial_transactions nao tem o elo"
  );
  assert.match(
    rota,
    /\.not\("recurring_rule_id", "is", null\)/,
    "a terceira consulta deixou de filtrar no servidor: ela passa a trazer toda " +
      "previsao avulsa com baixa para descartar no cliente"
  );

  // E o conjunto CHEGA na regra pura. O parametro e obrigatorio, entao o tsc
  // cobra a fiacao -- esta assercao existe para o caso de alguem reinventar o
  // parametro como opcional, que e quando o tsc para de cobrar.
  const chamada = rota.match(/const linhas = linhasDaTela\(([\s\S]*?)\);/);
  assert.ok(chamada, `nao achei a chamada de linhasDaTela em ${ROTA}`);
  assert.match(
    chamada[1],
    /idsDeFixa/,
    "a rota nao passa o conjunto de fixas para `linhasDaTela`"
  );

  // A falha da terceira consulta NAO derruba a leitura: o conjunto fica vazio,
  // as linhas caem em "despesa" e os tres numeros nao se mexem. Um `return` com
  // 500 ali trocaria os totais do mes por uma tela de erro por causa de um
  // rotulo.
  const terceira = rota.slice(rota.indexOf('.from("scheduled_transactions")'));
  const ateOFim = terceira.slice(0, terceira.indexOf("const previstas"));
  assert.match(ateOFim, /console\.error\(/, "a falha da terceira consulta fica muda");
  assert.ok(
    !/NextResponse\.json\(/.test(ateOFim),
    "a falha da terceira consulta derruba a leitura: um ROTULO ausente passa a " +
      "custar os tres numeros do periodo"
  );
});

test("`natureza` e `fatura` existem e sao produzidos nos DOIS lados", () => {
  // HMO-285 e a primeira das duas PRs: esta PR faz o dado existir e chegar ao
  // componente, e a PR irma desenha o icone, o rotulo e o link. Por isso estes
  // dois campos sao, HOJE, os unicos de `LinhaDaTela` sem leitor na tela -- e
  // e exatamente por isso que eles precisam desta assercao. Um campo sem leitor
  // e o que este repositorio ja perdeu por meses (`account_id` selecionado pelo
  // `*`, HMO-215): sem nada cobrando, uma limpeza o apaga antes da PR irma
  // chegar, e o que se perde e a feature inteira, nao um campo.
  const naLib = camposDaInterface(lib, "LinhaDaTela", LIB);

  for (const campo of ["natureza", "fatura"]) {
    assert.ok(naLib.includes(campo), `${campo} saiu de LinhaDaTela`);
  }

  // E os DOIS construtores os preenchem, E OS DOIS DECIDEM OS DOIS CAMPOS.
  //
  // Ate a HMO-264 `linhaRealizada` gravava `fatura: null` literal, e esta
  // assercao afirmava isso. A fatura PAGA derrubou aquilo: a perna de SAIDA do
  // pagamento e a unica linha realizada que e uma fatura, e ela carrega o cartao
  // e o mes como a prevista carrega.
  assert.match(
    lib,
    /natureza: faturaPaga\s*\n\s*\? "fatura"/,
    "`linhaRealizada` nao avalia mais FATURA ANTES de fixa -- invertida a ordem, " +
      "a fatura paga se chama 'fixa' e perde o caminho de volta ao cartao"
  );
  assert.match(
    lib,
    /idsDeFixa\.has\(crua\.id\)/,
    "`linhaRealizada` nao classifica mais a linha pelo conjunto da rota"
  );
  assert.match(
    lib,
    /natureza: daFatura\s*\n\s*\? "fatura"/,
    "`linhaPrevista` nao avalia mais FATURA ANTES de fixa -- invertida a ordem, " +
      "a fatura perde o campo `fatura`, que e o caminho de volta ao cartao"
  );

  // E OS DOIS CONSTRUTORES SAO TEXTUALMENTE DISTINTOS -- `faturaPaga` no
  // realizado, `daFatura` no previsto --, e isso NAO e estilo.
  //
  // Enquanto os dois blocos `fatura: ...` eram identicos letra por letra, o
  // mutante `fatura_sem_mes` (que existe para medir `linhaPrevista`) casava com
  // a PRIMEIRA ocorrencia do arquivo, que e a do realizado. O runner reprova
  // trecho ambiguo, entao isso aparece -- mas quem "consertasse" o mutante
  // ancorando no texto duplicado passaria a medir o construtor errado com o
  // rotulo mentindo sobre o que foi medido.
  assert.equal(
    lib.split("mes: faturaPaga.mes").length - 1,
    1,
    "o construtor de `fatura` do REALIZADO nao e mais unico no arquivo"
  );
  assert.equal(
    lib.split("mes: daFatura.mes").length - 1,
    1,
    "o construtor de `fatura` do PREVISTO nao e mais unico no arquivo"
  );

  // `natureza` NAO e um quarto valor de `TipoDaTela`: esticar aquela uniao faria
  // `telaDoTipo("fatura")` ter de responder uma tela, e um valor novo chegando
  // em `linhaPrevista` sairia pela peneira do `direction` -- a linha
  // desapareceria da tela em silencio.
  const uniao = lib.match(/export type TipoDaTela = ([^;]+);/);
  assert.ok(uniao, "nao achei TipoDaTela");
  for (const palavra of ["fatura", "fixa", "despesa"]) {
    assert.ok(
      !uniao[1].includes(`"${palavra}"`),
      `"${palavra}" entrou em TipoDaTela: a rota valida \`?tipo=\` contra ela`
    );
  }
});

test("a chave da fatura mora num arquivo-FOLHA, e `card-invoice` a re-exporta", () => {
  // HMO-285, fase 0. `lib/telas-de-movimentacao.ts` precisa de `faturaDaChave` e
  // nao pode importar `lib/card-invoice.ts`: ele arrasta `transferencia` ->
  // `lancamento` atras dele, e o mutador daquele modulo copia para a arvore
  // temporaria so as dependencias listadas -- um mutante que nao COMPILA
  // "morre" por motivo errado e o placar mente a favor.
  //
  // A FOLHA E A TRAVA: no dia em que `chave-da-fatura.ts` ganhar um import, o
  // problema volta inteiro, e volta como "todos os mutantes morreram".
  const FOLHA = "lib/chave-da-fatura.ts";
  const folha = semComentarios(readFileSync(FOLHA, "utf8"));
  const imports = folha.match(/^\s*import\s/gm) ?? [];
  assert.deepEqual(
    imports,
    [],
    `${FOLHA} ganhou import. Ele e copiado para a arvore do mutador de ` +
      `telas-de-movimentacao, onde a dependencia nova NAO existe: o controle ` +
      `positivo aborta, e sem ele TODO mutante "morreria" por erro de compilacao.`
  );

  // Os cinco nomes continuam chegando por `@/lib/card-invoice`, que e de onde os
  // nove chamadores de hoje os pedem.
  const cardInvoice = semComentarios(readFileSync("lib/card-invoice.ts", "utf8"));
  const reexport = cardInvoice.match(
    /export \{([^}]*)\} from "@\/lib\/chave-da-fatura";/
  );
  assert.ok(
    reexport,
    "lib/card-invoice.ts nao re-exporta mais a chave da fatura: os nove " +
      "chamadores que a pedem de la param de compilar"
  );
  for (const nome of [
    "PREFIXO_CHAVE_FATURA",
    "chaveFatura",
    "RE_CHAVE_FATURA",
    "faturaDaChave",
    "ehFatura",
  ]) {
    assert.match(reexport[1], new RegExp(`\\b${nome}\\b`), `${nome} nao e re-exportado`);
  }

  // E a regex da chave tem UMA definicao. Duas ancoradas que divergissem nao
  // dariam erro nenhum: uma das duas so pararia de casar, e a tela deixaria de
  // reconhecer a fatura em silencio.
  assert.ok(
    !/RE_CHAVE_FATURA\s*=/.test(cardInvoice),
    "a regex da chave voltou a ser declarada em card-invoice: duas copias " +
      "ancoradas divergem sem erro, e o lado errado so para de casar"
  );
});

test("o mutador nao tem lista de dependencia a mao para envelhecer", () => {
  // ESTA ASSERCAO SUBSTITUI UMA (HMO-318), e vale dizer qual, porque trocar
  // guard por guard e o jeito mais facil de perder cobertura sem perceber.
  //
  // Antes, o mutador montava uma arvore temporaria com uma lista
  // `DEPENDENCIAS` escrita a mao, e este teste conferia que todo import `@/`
  // da lib estava nela. O modo de falha coberto era o pior possivel: a
  // dependencia que falta faz o arquivo mutado nao COMPILAR, e mutante que nao
  // compila conta como morto -- o placar sairia "todos os N mutantes morreram"
  // tendo medido ZERO.
  //
  // Nao era teorico. `mutantes-realizado-do-caixa.mjs`, da mesma familia e SEM
  // um guard destes, passou meses abortando: a HMO-285 e a HMO-305 criaram
  // `lib/chave-da-fatura.ts` e `lib/elo-da-fatura.ts`, e a lista dele nao
  // acompanhou.
  //
  // O mutador agora passa por `criarBlocoDeMutantes`, cuja sombra espelha a
  // arvore INTEIRA e cujas etapas saem do `scripts[suite]` do package.json. A
  // lista a mao deixou de existir, e com ela o modo de falha -- conferir o
  // conteudo dela nao e mais possivel. O que este teste trava agora e a
  // propriedade que tomou o lugar: que a lista NAO VOLTE, porque voltar e
  // voltar o envelhecimento em silencio.
  const MUTADOR = "scripts/mutantes-telas-de-movimentacao.mjs";
  const mutador = semComentarios(readFileSync(MUTADOR, "utf8"));

  assert.match(
    mutador,
    /criarBlocoDeMutantes\(\{/,
    `${MUTADOR} nao passa mais pelo bloco: sem ele volta a existir um recorte ` +
      "de arvore a mao, que envelhece sem nada reclamar"
  );
  assert.ok(
    !/const DEPENDENCIAS = \[/.test(mutador),
    `${MUTADOR} voltou a ter DEPENDENCIAS a mao -- e a lista que o bloco existe ` +
      "para eliminar; um import novo na lib a deixa errada em silencio"
  );

  // CONTROLE DA EXTRACAO. Sem ele as duas assercoes acima passariam sobre um
  // arquivo vazio -- um `MUTADOR` renomeado, por exemplo, faria o
  // `readFileSync` lancar, mas um arquivo TRUNCADO passaria calado nas duas.
  assert.match(
    mutador,
    /const MUTANTES = \[/,
    `${MUTADOR} ficou sem lista de mutantes`
  );
  const importados = [...lib.matchAll(/from "@\/(lib\/[a-z0-9-]+)"/g)].map(
    (m) => m[1]
  );
  assert.ok(
    importados.length >= 3,
    `extrai poucos imports de ${LIB}: ${importados}`
  );
});

test("o criterio da fatura paga tem UM dono, e o painel o IMPORTA", () => {
  // HMO-317. `ehPagamentoDaFatura` responde pelos DOIS leitores do pagamento da
  // fatura -- a tela de Despesas (`linhasDaTela`) e o Realizado do painel
  // (`realizadoComCartaoPelaFatura`, lib/realizado-do-caixa.ts). Ate aquela
  // issue cada um tinha a sua copia dos tres criterios, e as duas JA DIVERGIAM
  // em `amount === 0` sem que nenhum total mudasse -- que e exatamente por que a
  // divergencia podia durar: duas copias de um criterio de DINHEIRO que ninguem
  // compara.
  //
  // QUEM PROVA QUE OS DOIS CONCORDAM e o bloco "os dois leitores da fatura paga
  // concordam, linha por linha" de scripts/test-realizado-do-caixa.mjs, que
  // passa a MESMA matriz pelos dois. O QUE ESTE TESTE TRANCA e a outra metade: o
  // dia em que alguem puser uma segunda copia do criterio de volta no painel, o
  // controle de comportamento la continuaria VERDE -- ele compara a funcao dona
  // com o que o leitor faz, e um leitor que decide por conta propria passa a
  // discordar so nos casos que a matriz ainda nao tem.
  const CAIXA = "lib/realizado-do-caixa.ts";
  const caixa = semComentarios(readFileSync(CAIXA, "utf8"));

  // A ANCORA E O CALL SITE, e nao o import: um import pode ficar para tras de um
  // `const` local que reimplementa a regra, e a assercao passaria verde casando
  // com a linha do `import`.
  assert.match(
    caixa,
    /if \(ehPagamentoDaFatura\(linha\)\) \{/,
    `${CAIXA} nao promove mais a fatura paga pela funcao dona: ou o Realizado ` +
      `do painel perdeu a fatura inteira, ou ele voltou a decidir por conta ` +
      `propria -- e as duas copias divergem na primeira mudanca de um dos lados`
  );

  // E NENHUM CRITERIO DA CHAVE E LIDO AQUI. Mesma trava que a regex da chave
  // canonica ja tem em `card-invoice`: duas leituras do mesmo criterio nao dao
  // erro nenhum, uma das duas so para de casar.
  assert.ok(
    !/\b(ehFatura|faturaDaChave)\(/.test(caixa),
    `${CAIXA} voltou a ler a chave canonica da fatura por conta propria: o ` +
      `criterio tem um dono (ehPagamentoDaFatura, em ${LIB}), e uma segunda ` +
      `copia dele e o defeito que a HMO-317 fechou`
  );
  // A CHAVE E O CRITERIO QUE NAO DA PARA CONTORNAR: nao existe segunda copia de
  // "esta linha e uma fatura" que nao leia a chave canonica. Trancar a leitura
  // dela aqui tranca a duplicacao inteira, sem depender do NOME que a copia
  // nova receberia.

  // E O MUTADOR DO PAINEL COPIA TODA DEPENDENCIA DELE, incluindo o dono: ele e
  // dependencia E alvo de mutante la (os criterios do dono tem de continuar
  // medidos CONTRA O TOTAL DO PAINEL, que a suite da tela nao soma).
  const MUTADOR = "scripts/mutantes-realizado-do-caixa.mjs";
  const mutador = semComentarios(readFileSync(MUTADOR, "utf8"));
  const dono = mutador.match(/const DONO_DO_CRITERIO = "([^"]+)";/);
  assert.ok(dono, `nao achei DONO_DO_CRITERIO em ${MUTADOR}`);
  assert.equal(
    dono[1],
    `${LIB}`,
    `o alvo de mutante do mutador do painel nao e mais ${LIB}`
  );
  const cru = mutador.match(/const DEPENDENCIAS = \[([\s\S]*?)\];/);
  assert.ok(cru, `nao achei DEPENDENCIAS em ${MUTADOR}`);
  // `DONO_DO_CRITERIO` entra na lista pelo nome da constante, e nao pela string:
  // resolve-la aqui e o que impede este laco de reprovar a arvore certa.
  const dependencias = cru[1].replace(
    /\bDONO_DO_CRITERIO\b/g,
    JSON.stringify(dono[1])
  );

  const importados = [...caixa.matchAll(/from "@\/(lib\/[a-z0-9-]+)"/g)].map(
    (m) => m[1]
  );
  // Controle da extracao: sem pelo menos um import, o laco abaixo passaria por
  // vacuidade -- e `realizado-do-caixa` TEM de importar o dono.
  assert.ok(
    importados.includes("lib/telas-de-movimentacao"),
    `${CAIXA} nao importa mais ${LIB}: o criterio da fatura paga perdeu o dono`
  );

  for (const dep of importados) {
    assert.match(
      dependencias,
      new RegExp(`"${dep}\\.ts"`),
      `${dep}.ts e importado por ${CAIXA} e nao esta em DEPENDENCIAS de ` +
        `${MUTADOR}: o arquivo mutado para de compilar e TODO mutante "morre"`
    );
  }
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

test("`posso_editar` atravessa os QUATRO elos -- rota, lib, container e botao (HMO-301)", () => {
  // A MESMA familia de `account_type` e `recurring_rule_id` acima, e com o modo
  // de falha mais caro dos tres: a direcao do erro aqui NAO e so "o rotulo
  // sumiu". `posso_editar` e o que impede um Excluir de aparecer sobre a linha
  // de outro membro do grupo -- e `UPDATE` recusado pela RLS volta **200 sem
  // alterar nada**: o app diz "pronto" e a linha fica.
  //
  // Os quatro elos, e o que cada um faz em silencio quando se rompe:
  //
  //   1. `user_id` no `select` do realizado  -> `posso_editar: false` em toda
  //   2. `user_id` no `select` da view          linha realizada / prevista: a
  //                                             lista volta a ser so leitura;
  //   3. `user.id` em `linhasDaTela`         -> IDEM, nas duas de uma vez;
  //   4. `acoes` em `<SecaoDaTela>`          -> o tsc PEGA este (a prop e
  //                                             obrigatoria), e esta assercao
  //                                             existe para as DUAS secoes --
  //                                             passar so para uma compila.
  //
  // Nenhum dos tres primeiros quebra `tsc` (os campos sao opcionais nas
  // interfaces cruas, porque a fatura sintetizada nao os tem) nem teste de
  // unidade nenhum.

  // 1. O `select` do realizado. ANCORADO NO BLOCO da consulta e nao no arquivo:
  // `user_id` aparece em varios `.eq()` desta rota, e um `match` solto passaria
  // verde com a coluna fora do `select`.
  const doRealizado = rota.match(
    /\.from\("financial_transactions"\)\s*\.select\(\s*`([^`]*)`/
  );
  assert.ok(doRealizado, `nao achei o \`select\` de financial_transactions em ${ROTA}`);
  assert.match(
    doRealizado[1],
    /\buser_id\b/,
    "o `select` do realizado nao pede `user_id` -- `posso_editar` cai para false em toda linha"
  );

  // 2. O `select` da view. Mesmo ancoramento, mesmo motivo.
  const daView = rota.match(
    /\.from\("scheduled_transactions_effective"\)\s*\.select\(\s*`([^`]*)`/
  );
  assert.ok(daView, `nao achei o \`select\` da view em ${ROTA}`);
  assert.match(
    daView[1],
    /\buser_id\b/,
    "o `select` do previsto nao pede `user_id` -- `posso_editar` cai para false em toda linha"
  );

  // 3. A ROTA PASSA QUEM ESTA OLHANDO. Ancorado na CHAMADA e nao no arquivo: a
  // rota le `user.id` em meia duzia de `.eq()`, e `assert.match(rota, /user\.id/)`
  // passaria verde com o argumento ausente.
  const chamada = rota.match(/const linhas = linhasDaTela\(([\s\S]*?)\n    \);/);
  assert.ok(chamada, `nao achei a chamada de linhasDaTela em ${ROTA}`);
  assert.match(
    chamada[1],
    /\buser\.id\b/,
    "a rota nao passa `user.id` para `linhasDaTela` -- nenhum botao aparece em lugar nenhum"
  );

  // 4. A lib produz o campo, e o produz nos DOIS construtores. `ehMinha` e a
  // funcao unica que decide; os dois a chamam com o `user_id` da sua linha.
  assert.match(
    lib,
    /posso_editar: ehMinha\(crua\.user_id, meuUserId\)/,
    "a lib nao calcula `posso_editar` a partir de `user_id` e de quem esta olhando"
  );
  assert.equal(
    lib.split("posso_editar: ehMinha(crua.user_id, meuUserId)").length - 1,
    2,
    "`posso_editar` nao e calculado nos DOIS construtores (realizada e prevista)"
  );

  // 5. Quem DECIDE o botao le o campo, e decide na lib pura -- nao num `&&` do
  // JSX, que nao teria assercao nenhuma por cima.
  const acoes = semComentarios(readFileSync("lib/acoes-da-linha.ts", "utf8"));
  assert.match(
    acoes,
    /if \(!linha\.posso_editar\) return false;/,
    "lib/acoes-da-linha.ts nao recusa a linha por `posso_editar`"
  );
  assert.match(
    acoes,
    /if \(!linha\.gravada\) return false;/,
    "lib/acoes-da-linha.ts nao recusa a linha NAO GRAVADA (a fatura aberta sintetizada)"
  );

  // 6. AS DUAS SECOES recebem as acoes. A prop e obrigatoria, entao o tsc cobra
  // que ELA exista -- e nao que as duas a recebam: uma secao com `acoes` e a
  // outra comentada compila, e o sintoma seria metade da tela sem botao.
  assert.equal(
    lista.split("acoes={acoes}").length - 1,
    2,
    "as duas secoes (Previsto e Realizado) tem de receber `acoes`"
  );

  // 7. E a SECAO tira os botoes das tres funcoes da lib, uma por botao. Sem
  // isto, um `linha.posso_editar &&` escrito no JSX passaria por todo o resto
  // desta assercao.
  for (const fn of ["podeConfirmar", "podeEditar", "podeExcluir"]) {
    assert.match(
      secao,
      new RegExp(`${fn}\\(linha\\)`),
      `${SECAO} nao chama \`${fn}(linha)\` -- a regra do botao voltou para o JSX`
    );
  }
});

test("a baixa, a exclusao e a edicao vao para as rotas que EXISTEM (HMO-301)", () => {
  // Nenhuma rota foi escrita nesta issue, e e isso que esta assercao tranca:
  // cada caminho montado por `lib/acoes-da-linha.ts` tem de ter arquivo. Um
  // caminho plausivel e inexistente responde 404 do Next -- que, para quem
  // clicou em "Confirmar pagamento", se le como "o app nao conseguiu".
  const acoes = semComentarios(readFileSync("lib/acoes-da-linha.ts", "utf8"));

  const pares = [
    ["/api/scheduled-transactions/${encodeURIComponent(linha.id)}/pay", "app/api/scheduled-transactions/[id]/pay/route.ts"],
    ["/api/scheduled-transactions/${id}", "app/api/scheduled-transactions/[id]/route.ts"],
    ["/api/movimentacoes/transferencia?id=${id}", "app/api/movimentacoes/transferencia/route.ts"],
    ["/api/personal-finance/transactions/${id}", "app/api/personal-finance/transactions/[id]/route.ts"],
  ];

  for (const [caminho, arquivo] of pares) {
    assert.ok(
      acoes.includes(caminho),
      `lib/acoes-da-linha.ts nao monta mais \`${caminho}\``
    );
    // `readFileSync` e o teste: arquivo ausente lanca com o nome dele.
    const fonte = readFileSync(arquivo, "utf8");
    assert.ok(fonte.length > 0, `${arquivo} esta vazio`);
  }

  // E os METODOS que cada rota de fato exporta. `DELETE` pedido a uma rota que
  // so tem `PATCH` responde 405, e o 405 chega na tela pelo mesmo toast do 404.
  const metodos = [
    ["app/api/scheduled-transactions/[id]/pay/route.ts", "POST"],
    ["app/api/scheduled-transactions/[id]/route.ts", "PATCH"],
    ["app/api/scheduled-transactions/[id]/route.ts", "DELETE"],
    ["app/api/movimentacoes/transferencia/route.ts", "DELETE"],
    ["app/api/personal-finance/transactions/[id]/route.ts", "DELETE"],
  ];

  for (const [arquivo, metodo] of metodos) {
    assert.match(
      readFileSync(arquivo, "utf8"),
      new RegExp(`export async function ${metodo}\\b`),
      `${arquivo} nao exporta ${metodo} -- a acao da linha receberia 405`
    );
  }
});

// -----------------------------------------------------------------------------
// A FIACAO DO BRUTO E DO REEMBOLSO (HMO-364, fases F1b/F3/F5 da HMO-360)
// -----------------------------------------------------------------------------
// As duas fases vao no MESMO release, e a razao esta no plano: com a regra do
// pagador a aba Despesas conta bruto, e se o reembolso previsto nao entrar em
// Receitas junto, o Previsto de Despesas infla sem contrapartida e a tela mostra
// uma divida que nao e do usuario.
//
// A ARITMETICA DAS DUAS ESTA MEDIDA EM OUTRO LUGAR -- `test:bruto-e-reembolso`
// afirma os dois numeros em separado, com controle negativo de cada fase, e
// `test:telas-de-movimentacao` tem a soma no «Previsto» com mutantes. O que
// ESTAS assercoes trancam e a FIACAO: qual funcao a rota chama, e se a tela le o
// campo. Nenhuma das duas coisas o tsc cobra -- `previstasComAMinhaParte` e
// `previstasPelaRegraDoPagador` tem assinatura compativel, e trocar uma pela
// outra compila e devolve numeros plausiveis.

test("a rota de Despesas chama a REGRA DO PAGADOR, e nao a divisao cega", () => {
  assert.match(
    rota,
    /previstasPelaRegraDoPagador\(/,
    "A rota tem de chamar `previstasPelaRegraDoPagador` (lib/regra-do-pagador.ts). " +
      "Sem ela a conta de grupo que o usuario FRONTA volta a entrar pela parte " +
      "dele -- a aba Despesas diz R$ 300 num mes em que R$ 1.000 saem da conta."
  );

  // E a antiga tem de SAIR. As duas ao mesmo tempo dividiriam a linha duas
  // vezes, ou (pior) a segunda desfaria a primeira sem erro nenhum.
  assert.ok(
    !/previstasComAMinhaParte/.test(rota),
    "A rota ainda menciona `previstasComAMinhaParte`. A fase F1b a substituiu " +
      "NESTA leitura; as outras quatro continuam com ela, por decisao da secao " +
      "4 do plano da HMO-360."
  );

  // O `user_id` da AGENDA e o campo inteiro da regra: sem ele no `select`,
  // `euFrontoAConta` recebe `undefined` em toda linha e NADA conta bruto. Ele
  // ja estava la desde a HMO-301, e esta assercao e o que impede que uma
  // limpeza de "campos nao usados" o leve.
  const agenda = rota.match(
    /from\("scheduled_transactions_effective"\)\s*\.select\(\s*`([\s\S]*?)`/
  );
  assert.ok(agenda, "Nao achei o select da agenda na rota.");
  for (const coluna of ["user_id", "group_id"]) {
    assert.match(
      agenda[1],
      new RegExp(`\\b${coluna}\\b`),
      `O select da agenda perdeu \`${coluna}\` -- a regra do pagador fica sem ` +
        `o campo por que ela decide, e nao quebra tsc nem teste de unidade.`
    );
  }
});

test("as outras QUATRO leituras do previsto NAO foram ligadas na regra nova", () => {
  // A secao 4 do plano da HMO-360 decidiu NAO reverter a HMO-306/308: o
  // safe-to-spend responde "posso gastar isso?" e e conservador de proposito.
  // Ligar a regra do pagador la faria o cartao prometer dinheiro que e de outra
  // pessoa -- o pior erro possivel naquele numero.
  //
  // A assercao e sobre o IMPORT e sobre a CHAMADA, porque uma sem a outra fica
  // verde pelo lado errado: um import nao usado passa o `includes` da chamada,
  // e uma chamada por outro nome passa a do import.
  // A ANCORA DO CONTROLE POSITIVO E POR ARQUIVO, e nao uma so para as tres:
  // as tres chamam `parteConfiguradaDoMembro` direto. ERAM QUATRO ate a HMO-470
  // (F6 do plano da HMO-462) -- a quarta era `app/api/papel-de-pao/painel`, que
  // DELEGAVA a divisao para `painelDePapel` e por isso tinha ancora propria. A
  // rota e a lib foram apagadas com o painel; a conversa que entrou no lugar nao
  // le conta de grupo nenhuma, de proposito (ver o plano da HMO-462).
  const conservadoras = [
    ["app/api/safe-to-spend/route.ts", /parteConfiguradaDoMembro\(/],
    [
      "app/api/scheduled-transactions/summary/route.ts",
      /parteConfiguradaDoMembro\(/,
    ],
    ["app/api/dashboard/previsao/route.ts", /parteConfiguradaDoMembro\(/],
  ];

  for (const [arquivo, ancoraDaParte] of conservadoras) {
    const fonte = semComentarios(readFileSync(arquivo, "utf8"));

    assert.ok(
      !/regra-do-pagador/.test(fonte),
      `${arquivo} importa lib/regra-do-pagador.ts. As quatro leituras ` +
        `conservadoras contam A MINHA PARTE, e isso foi decidido na secao 4 do ` +
        `plano -- nao revertido por refatoracao.`
    );
    assert.ok(
      !/previstasPelaRegraDoPagador/.test(fonte),
      `${arquivo} chama \`previstasPelaRegraDoPagador\`.`
    );

    // CONTROLE POSITIVO das duas negacoes acima: se o arquivo deixasse de
    // dividir a parte do grupo (ou mudasse de nome, ou saisse do lugar), os
    // dois `!test` passariam verdes medindo um arquivo que nao divide nada.
    assert.match(
      fonte,
      ancoraDaParte,
      `${arquivo} nao divide mais a parte do grupo por ${ancoraDaParte} -- esta ` +
        `assercao parou de medir a leitura que ela existe para proteger.`
    );
  }
});

test("o reembolso do grupo entra pelo modulo compartilhado, e so em Receitas", () => {
  // UMA leitura para as duas rotas. Copiar as seis consultas para ca criaria a
  // segunda implementacao do mesmo credito -- dois numeros plausiveis que
  // divergiriam na primeira mudanca, que e a familia de
  // `fontes-consistentes-que-discordam`.
  assert.match(
    rota,
    /lerCreditoDosGrupos\(/,
    "A rota tem de ler o credito por `lerCreditoDosGrupos` " +
      "(lib/services/credito-dos-grupos.ts), o mesmo modulo da rota my-credit."
  );
  assert.match(
    semComentarios(readFileSync("app/api/expense-groups/my-credit/route.ts", "utf8")),
    /lerCreditoDosGrupos\(/,
    "A rota my-credit tem de ler pelo MESMO modulo -- senao as duas voltam a " +
      "ter uma copia das consultas cada."
  );

  // SO EM RECEITAS. Em Despesas o mesmo valor seria um abatimento da conta a
  // pagar, que e o criterio do safe-to-spend -- outra pergunta, outra tela.
  assert.match(
    rota,
    /tela\.tipo === "income"[\s\S]{0,400}lerCreditoDosGrupos\(/,
    'A leitura do credito tem de estar dentro do ramo `tela.tipo === "income"`.'
  );
});

test("o reembolso vai para o «Previsto» por `resumoComReembolsoPrevisto`", () => {
  // A funcao e quem decide o balde, e ela tem assercao e mutante. A rota nao
  // pode somar por fora: `previsto: resumo.previsto + reembolso.total` escrito
  // aqui seria uma segunda aritmetica, sem teste, no arquivo onde o mutador nao
  // chega.
  assert.match(
    rota,
    /resumoComReembolsoPrevisto\(\s*resumoDaTela\(linhas\),/,
    "O resumo da resposta tem de passar por `resumoComReembolsoPrevisto`."
  );

  // E a rota nao pode fazer aritmetica propria com o reembolso. `.total` lido
  // fora da chamada e o cheiro: ele significa que alguem somou a mao.
  assert.ok(
    !/reembolso[\s\S]{0,40}\.total\s*[+\-]/.test(rota),
    "A rota esta somando o reembolso a mao. Quem soma e a funcao pura."
  );

  // A CONTAGEM: `notaDoCreditoAReceber` e quem conta devedores e grupos, e nao
  // um `.length` da rota -- a frase do cartao concorda em numero com eles.
  assert.match(
    rota,
    /notaDoCreditoAReceber\(/,
    "A rota tem de usar `notaDoCreditoAReceber` para contar devedores e grupos."
  );
});

test("o cartao «Previsto» DIZ que o reembolso esta dentro dele (fase F5)", () => {
  // O defeito que esta assercao impede: o numero sobe R$ 300 e nada na tela diz
  // de onde vieram. E o quinto numero sem rotulo da familia
  // `despesa-de-grupo-tem-tres-convencoes`, que este app ja pagou quatro vezes
  // -- e um valor a mais sem rotulo e indistinguivel de bug.
  // A ASSERCAO E SOBRE A LEITURA DO CAMPO NO JSX, e nao sobre o nome aparecer
  // no arquivo: `cartoes.includes("reembolso_previsto")` casaria com a
  // DECLARACAO do tipo e com qualquer comentario, e ficaria verde num
  // componente que le o campo e nao desenha nada. Quem mede "aparece na tela" e
  // a suite que renderiza (test-cartoes-da-tela.mjs, 4 blocos); o que esta aqui
  // e o elo do NOME entre a rota e o componente, que o tsc nao liga.
  assert.match(
    cartoes,
    /resumo\?\.reembolso_previsto/,
    "CartoesDaTela.tsx nunca le `resumo?.reembolso_previsto`. O valor entraria " +
      "no «Previsto» de Receitas invisivel."
  );
  assert.match(
    cartoes,
    /resumo\.reembolso_previsto\.total/,
    "O cartao nao imprime o TOTAL do reembolso -- uma frase sem o valor nao " +
      "diz quanto do «Previsto» e promessa."
  );

  // A FONTE CRUA e a certa para o TEXTO: o que esta sendo medido e a frase que
  // a pessoa le, e ela vive dentro do JSX.
  const cartoesCrus = readFileSync(CARTOES, "utf8");
  assert.match(
    cartoesCrus,
    /reembolso\s+previsto/,
    "A frase do cartao tem de dizer PREVISTO -- um valor a receber num cartao " +
      "verde se le como dinheiro que ja entrou."
  );
  assert.match(
    cartoesCrus,
    /ainda não recebido/,
    "A frase tem de dizer que o dinheiro ainda nao chegou."
  );
});

test("o cartao «Previsto» DIZ que o «a receber» do MyBank esta dentro dele (HMO-379)", () => {
  // O ELO QUE FALTOU, e este bloco existe porque ele faltou de verdade: a F4
  // (HMO-372) acrescentou `a_receber_do_mybank` a resposta da rota e o campo
  // ficou SEM UM UNICO CONSUMIDOR na UI -- `git grep a_receber_do_mybank --
  // app components` nao devolvia nada. Medido em producao: «Previsto» R$ 30,00
  // em cima de "Nada previsto neste período", com o contador ao lado dizendo
  // (0). A suite inteira passava verde assim, porque numero nenhum mudou -- a
  // familia `campo-de-rotulo-passa-pela-suite-de-aritmetica-inteira`.
  //
  // TUDO AQUI LE `cartoes`, QUE E A FONTE SEM COMENTARIO, inclusive as
  // assercoes de TEXTO -- e isso e diferente do bloco do reembolso acima, que
  // usa `cartoesCrus`. A razao e que o comentario deste bloco no componente
  // CITA a frase ("R$ 30,00 a receber", "do MyBank"): medida na fonte crua, a
  // assercao casaria com o comentario e ficaria verde num componente que
  // apagou o JSX. E a familia `assercao-textual-casa-com-o-comentario`.
  assert.match(
    cartoes,
    /resumo\?\.a_receber_do_mybank/,
    "CartoesDaTela.tsx nunca le `resumo?.a_receber_do_mybank`. O valor entraria " +
      "no «Previsto» de Receitas invisivel -- o defeito da HMO-379."
  );
  assert.match(
    cartoes,
    /resumo\.a_receber_do_mybank\.total/,
    "O cartao nao imprime o TOTAL do «a receber» -- uma frase sem o valor nao " +
      "diz quanto do «Previsto» e promessa."
  );

  // AS DUAS CONTAGENS, cada uma no campo dela. `parcelas` NAO e nenhuma das
  // duas: quatro parcelas de uma pessoa num emprestimo sao "1 pessoa em 1
  // empréstimo", e trocar os campos daria uma frase plausivel e errada.
  for (const campo of ["devedores", "emprestimos"]) {
    assert.match(
      cartoes,
      new RegExp(`resumo\\.a_receber_do_mybank\\.${campo}`),
      `A frase nao le \`${campo}\` -- ela tem de contar pessoas E emprestimos.`
    );
  }

  assert.match(
    cartoes,
    /a receber de/,
    "A frase tem de dizer A RECEBER -- um valor que ainda nao entrou, num cartao " +
      "verde, se le como dinheiro que ja esta na conta."
  );
  assert.match(
    cartoes,
    /do MyBank/,
    "A frase tem de NOMEAR o MyBank: quem tem grupo E conexao le as duas notas, " +
      "e sem o nome elas sao indistinguiveis."
  );

  // A ORACAO DO SAFE-TO-SPEND VEM DA CONSTANTE, e por INTERPOLACAO -- nao
  // copiada. Duas copias da mesma frase se separam na primeira edicao, e o
  // sintoma e uma tela que contradiz a outra.
  assert.match(
    cartoes,
    /\{LEGENDA_DO_A_RECEBER_DO_MYBANK\}/,
    "A oracao do safe-to-spend tem de ser INTERPOLADA de " +
      "`LEGENDA_DO_A_RECEBER_DO_MYBANK`, e nao reescrita no JSX."
  );

  // E A CONSTANTE TEM DE DIZER A COISA. Ela nasceu na F2 e ficou ORFA ate esta
  // issue: sem esta assercao, uma limpeza de "constante nao usada" a esvazia e
  // a interpolacao acima continua verde imprimindo string vazia.
  //
  // `semComentarios` TAMBEM AQUI, e aqui ele e obrigatorio: o docstring da
  // constante contem a frase "Quanto ainda posso gastar" em prosa. Na fonte
  // crua esta assercao passaria com a constante esvaziada.
  const mybank = semComentarios(
    readFileSync("lib/leituras-do-mybank.ts", "utf8")
  );
  assert.match(
    mybank,
    /Quanto ainda posso gastar/,
    "`LEGENDA_DO_A_RECEBER_DO_MYBANK` perdeu a oracao que importa: ela diz que " +
      "este numero NAO esta no safe-to-spend, que e o outro cartao que a pessoa " +
      "olha no mesmo minuto."
  );
});

test("a frase de vazio do «Previsto» CONCORDA com o cartao (HMO-379)", () => {
  // A SEGUNDA METADE DO DEFEITO. "Nada previsto neste período." dito embaixo de
  // um cartao «Previsto» de R$ 30,00 e a leitura "o total esta errado" -- e as
  // duas promessas que o cartao soma (reembolso da HMO-364, MyBank da HMO-372)
  // nascem FORA de `scheduled_transactions` e NENHUMA das duas vira linha na
  // secao.
  //
  // A DECISAO, REGISTRADA: a parcela NAO vira linha, e a frase deixa de
  // afirmar vazio. A razao esta no call-site e e a mesma que manteve o
  // reembolso e o acerto fora das duas secoes -- `LinhaDaTela` exige
  // `posso_editar`/`gravada`, e fabricar isso daria Editar/Excluir sobre um id
  // que nao existe em `scheduled_transactions`. O "0 lançamento(s)" do «Total»
  // fica como esta: ele conta lancamentos, e lancamentos sao zero de verdade.
  assert.match(
    lista,
    /previstoSemLinha\(resumo\)/,
    "A lista nao chama `previstoSemLinha`: a frase de vazio volta a afirmar " +
      "'Nada previsto neste período' com o cartao «Previsto» em R$ 30,00."
  );
  assert.match(
    lista,
    /promessas sem linha própria/,
    "A frase nova nao esta na lista -- ela e o que explica o numero do cartao " +
      "para quem conta as linhas e acha zero."
  );
  // E A FRASE ANTIGA CONTINUA EXISTINDO: quem nao tem grupo nem MyBank tem de
  // ler "Nada previsto neste período." -- o controle negativo da issue.
  assert.match(
    lista,
    /Nada previsto neste período\./,
    "A frase de vazio de verdade desapareceu: a conta sem promessa nenhuma " +
      "precisa continuar lendo que nao ha nada previsto."
  );
});

test("a aba Receitas NOMEIA quem deve o reembolso que esta no «Previsto» (HMO-422)", () => {
  // A TERCEIRA METADE DO MESMO DEFEITO, e ela sobreviveu as duas de cima.
  //
  // A HMO-379 fez o cartao DIZER "R$ 508,42 de 2 pessoas em 1 grupo" e a frase
  // de vazio deixar de afirmar vazio. Nenhuma das duas diz QUEM sao as duas
  // pessoas nem QUAL e o grupo -- e `lerCreditoDosGrupos` JA DEVOLVIA essas
  // linhas: `notaDoCreditoAReceber` as colapsava em tres numeros e a rota
  // jogava o resto fora. Para conferir os R$ 508,42 era preciso trocar de tela
  // (/dashboard/personal-finance), enquanto a aba DESPESAS lista os
  // destinatarios da parte simetrica desde a HMO-365.
  //
  // O ELO INTEIRO E ASSERCAO AQUI, e nao so uma ponta: o defeito da HMO-379 foi
  // precisamente a rota mandar um campo que o tipo da tela escondia, entao
  // "a rota emite" sozinho nao prova entrega nenhuma.
  assert.match(
    rota,
    /quem_me_paga:\s*creditoDosGrupos/,
    "A rota nao emite `quem_me_paga`. As linhas do credito morrem em " +
      "`notaDoCreditoAReceber`, e a aba Receitas volta a citar um numero sem " +
      "dizer de quem ele e."
  );
  assert.match(
    rota,
    /creditoDosGrupos = leitura\.credito/,
    "A rota nao guarda `leitura.credito`. Uma SEGUNDA leitura para as linhas " +
      "seria a segunda implementacao do mesmo credito -- o painel mostraria " +
      "linhas que nao somam o numero do cartao ao lado."
  );
  assert.match(
    lista,
    /quem_me_paga\s*\?\?\s*null/,
    "A lista nao le `quem_me_paga` da resposta: o campo chegaria no corpo e " +
      "nenhum componente o mencionaria -- o defeito da HMO-379, repetido."
  );
  assert.match(
    lista,
    /<PainelQuemMePaga\s+credito=\{quemMePaga\}/,
    "O painel nao e montado com o estado lido da rota."
  );

  // SO NA ABA RECEITAS, e o `tipo === "income"` ao lado do painel e o que
  // garante isso. Em Despesas o mesmo valor seria um abatimento da conta a
  // pagar (o criterio do safe-to-spend, que e outra pergunta e outra tela).
  assert.match(
    lista,
    /tipo === "income" && podeMostrarNumero\(estado\) && \(\s*<PainelQuemMePaga/,
    "O painel nao esta preso a aba Receitas e ao `podeMostrarNumero`: " +
      '"a Laís te deve R$ 508,42" dito sobre um cache de ontem pode ja ter ' +
      "sido pago."
  );

  // O PAINEL DIZ QUE O VALOR NAO E ACRESCIMO. Sem esta frase a pessoa soma o
  // total do painel ao «Previsto» de cima e conclui que vai receber o dobro --
  // a mesma razao de `NOTA_PRA_QUEM_PAGAR` existir do outro lado.
  //
  // `semComentarios` e OBRIGATORIO aqui: o cabecalho do componente cita a
  // frase em prosa, e na fonte crua esta assercao casaria com o comentario e
  // ficaria verde sobre um JSX que apagou a nota.
  const painel = semComentarios(
    readFileSync("components/movimentacoes/PainelQuemMePaga.tsx", "utf8")
  );
  assert.match(
    painel,
    /já incluído no Previsto acima/,
    "`NOTA_QUEM_ME_PAGA` perdeu a oracao que importa: a de que este total JA " +
      "esta dentro do cartao «Previsto»."
  );
  assert.match(
    painel,
    /\{NOTA_QUEM_ME_PAGA\}/,
    "O painel nao INTERPOLA a nota -- uma segunda copia da frase no JSX se " +
      "separa da constante na primeira edicao."
  );
  // E O ROTULO DO DEVEDOR VEM DA LIB, nao de um `{linha.devedor}` solto: com o
  // perfil ilegivel (nenhuma policy de `profiles` olha `group_members`) o
  // elemento renderizaria NADA, e "R$ 300 · Casa" sem mencao a ninguem se le
  // como receita propria -- e pior, como receita JA RECEBIDA.
  assert.match(
    painel,
    /devedorNaLinha\(linha\)/,
    "O painel nao usa `devedorNaLinha`: o devedor de perfil ilegivel ficaria " +
      "sem rotulo nenhum na linha."
  );
});

test("o painel diz DE QUANDO e DE QUEM JA PAGOU -- a 2a volta da HMO-422", () => {
  // O print que reabriu a issue, na MESMA aba, dois blocos de distancia:
  //
  //   «Letícia me pagou (Casa 🏠)» 01/10/2026  -- ja esta na sua conta
  //   «Letícia · Casa 🏠 · R$ 270,62»          -- ainda nao entrou na sua conta
  //
  // As duas frases estavam CERTAS (o acerto dela quitou um mes anterior, e o
  // teto desconta sobre a posicao acumulada do par, nao sobre o mes). O defeito
  // era nenhuma das duas dizer de que mes falava.
  //
  // A FIACAO DO ROTULO E ASSERCAO AQUI PORQUE O TIPO NAO A COBRA: a prop e
  // opcional na assinatura do painel (a sonda de componente precisa poder
  // omiti-la), entao esquecer de liga-la compila, passa no lint, e a tela volta
  // a mostrar valores sem data -- exatamente o estado que a issue reportou.
  assert.match(
    lista,
    /<PainelQuemMePaga[\s\S]{0,120}rotuloDoPeriodo=\{rotuloDoPeriodo\}/,
    "A lista nao passa `rotuloDoPeriodo` ao painel: os valores voltam a " +
      "aparecer sem dizer de que periodo sao, e o acerto pago ontem parece " +
      "nao ter entrado."
  );

  const painel = semComentarios(
    readFileSync("components/movimentacoes/PainelQuemMePaga.tsx", "utf8")
  );

  // AS TRES FRASES NOVAS, INTERPOLADAS -- `{NOME}` e nao `includes("NOME")`,
  // que casaria com a linha de declaracao e ficaria verde sobre um JSX que
  // nunca as escreve.
  for (const frase of [
    "{FRASE_DO_PERIODO(periodo)}",
    "{NOTA_DO_ACERTO_NO_PERIODO}",
    "{FRASE_JA_PAGOU(formatCurrency(jaPagou))}",
  ]) {
    assert.ok(
      painel.includes(frase),
      `O painel nao escreve \`${frase}\`. As frases da 2a volta sao a entrega ` +
        `inteira desta rodada -- o numero nao mudou, a explicacao dele mudou.`
    );
  }

  // E AS DUAS DECISOES SAEM DA LIB, nao de um `&&` sobre o campo cru: `0`
  // ("perguntei e ela nao pagou") e `null` ("nao perguntei") tem de produzir a
  // MESMA tela, e um `linha.ja_pago &&` distingue os dois -- escrevendo "ja te
  // pagou R$ 0,00" para quem nunca pagou nada.
  assert.match(
    painel,
    /jaPagouNaLinha\(linha\)/,
    "O painel nao passa a linha por `jaPagouNaLinha`."
  );
  assert.match(
    painel,
    /algumJaPagou\(credito\)/,
    "A nota do acerto nao e decidida por `algumJaPagou`: ela apareceria para " +
      "quem nunca recebeu acerto nenhum, explicando um mecanismo que nao agiu."
  );
});

test("os DOIS numeros que vao discordar levam a legenda de cada um (fase F5)", () => {
  // A aba Despesas responde "quanto sai da sua conta" (bruto) e o cartao
  // «Quanto ainda posso gastar» responde "quanto voce pode gastar" (liquido).
  // Os dois estao certos e aparecem na mesma navegacao. Sem legenda, o menor
  // dos dois se le como conta perdida, e o caminho dessa estranheza termina em
  // alguem "consertando" a conta por fora.
  const LEGENDAS = "lib/legenda-do-bruto-e-do-liquido.ts";
  const legendas = readFileSync(LEGENDAS, "utf8");

  // As duas frases moram no MESMO arquivo porque sao uma explicacao so dita de
  // dois lados: editar uma e esquecer a outra produz duas legendas que se
  // contradizem, que e pior do que nenhuma.
  for (const nome of ["LEGENDA_DO_BRUTO", "LEGENDA_DO_LIQUIDO"]) {
    assert.match(
      legendas,
      new RegExp(`export const ${nome}\\b`),
      `${LEGENDAS} nao exporta mais ${nome}.`
    );
  }

  // `{NOME}` E NAO `includes("NOME")`, NOS DOIS ARQUIVOS.
  //
  // `includes` casa com a linha de IMPORT -- `import { LEGENDA_DO_LIQUIDO }
  // from ...` --, entao ele fica verde num arquivo que importa a constante e
  // nao a escreve em lugar nenhum. E a familia de
  // `guard-de-fiacao-casa-com-o-import`, e aqui ela e barata de evitar: o
  // import tem ESPACOS dentro das chaves e a interpolacao do JSX nao.
  assert.match(
    cartoes,
    /\{LEGENDA_DO_BRUTO\}/,
    "O cartao «Previsto» da aba Despesas nao escreve a legenda do bruto."
  );

  const painel = semComentarios(
    readFileSync("app/(dashboard)/dashboard/page.tsx", "utf8")
  );
  assert.match(
    painel,
    /\{LEGENDA_DO_LIQUIDO\}/,
    "O cartao «Quanto ainda posso gastar» nao escreve a legenda do liquido. " +
      "Ele e o numero MENOR dos dois, que e o que se le como conta perdida."
  );

  // E cada legenda nomeia a pergunta do OUTRO lado, com link: uma frase que
  // explica so o proprio numero deixa o outro sem explicacao.
  for (const frase of ["PERGUNTA_DO_BRUTO", "PERGUNTA_DO_LIQUIDO"]) {
    const ocorrencias = legendas.split(frase).length - 1;
    assert.ok(
      ocorrencias >= 3,
      `${frase} aparece ${ocorrencias}x em ${LEGENDAS}: as duas legendas tem ` +
        `de citar as DUAS perguntas (a declaracao + um uso em cada frase).`
    );
  }
  // A FIACAO DO LINK, E NAO O ENDERECO LITERAL (HMO-415).
  //
  // Ate a HMO-415 esta assercao exigia `href="/dashboard/despesas"` -- e aquele
  // literal era o defeito, nao o contrato: `lerPeriodo`, do outro lado, cai no
  // MES CORRENTE quando nao acha `?de=&ate=`. O cartao aparece em todo periodo
  // que contem hoje, e conter hoje nao e ser o mes corrente -- num intervalo de
  // 15/09 a 20/10 o link nu abria outubro inteiro a partir de uma legenda que
  // falava do intervalo. Quem mede o `href` RENDERIZADO, em navegador e nos
  // quatro periodos, e `scripts/test-painel-clicavel.mjs`; o que fica aqui e a
  // fiacao: a legenda tem link, e ele sai de `rotaDaTelaDoLado`.
  //
  // E O RECORTE E A LEGENDA, nao o arquivo inteiro: a MESMA chamada aparece no
  // tile de Despesas 240 linhas acima (HMO-408), e um `includes` no painel todo
  // ficaria verde com o link da legenda nu de novo.
  const inicioDaLegenda = painel.indexOf("{LEGENDA_DO_LIQUIDO}");
  const fimDaLegenda = painel.indexOf("Abrir Despesas", inicioDaLegenda);
  assert.ok(
    inicioDaLegenda >= 0 && fimDaLegenda > inicioDaLegenda,
    "A legenda do painel nao tem mais o link «Abrir Despesas» para a aba Despesas."
  );
  assert.ok(
    painel
      .slice(inicioDaLegenda, fimDaLegenda)
      .includes('rotaDaTelaDoLado("despesa", periodo)'),
    "O «Abrir Despesas» da legenda do painel tem de levar a aba Despesas COM a " +
      "janela da tela: um link nu abre o mes corrente, e o cartao existe em " +
      "periodo que contem hoje sem ser o mes corrente."
  );
});

test("o par do REALIZADO tambem leva legenda dos dois lados (HMO-413)", () => {
  // O SEGUNDO EIXO, e ele nao e repeticao do de cima.
  //
  // O teste anterior cobre o PREVISTO: aba Despesas 1.000 vs painel «posso
  // gastar» 700. Este cobre o REALIZADO: painel 1.010 vs aba Despesas 990 --
  // medido nos dois route handlers em `npm run test:criterio-do-painel`, secao
  // 8. E A DIRECAO SE INVERTE: no previsto o painel mostra MENOS, no realizado
  // mostra MAIS. Por isso as frases nao se reaproveitam, e por isso as quatro
  // moram no mesmo arquivo -- duas delas vivem na MESMA tela e uma sem recorte
  // de eixo contradiz a vizinha.
  //
  // Por que ele existe: ate a HMO-413 o tile «Realizado» do painel era um LINK
  // (HMO-408) para um numero 20,00 menor, e o rotulo desse lado nao existia. O
  // comentario do proprio painel afirmava que existia.
  const LEGENDAS = "lib/legenda-do-bruto-e-do-liquido.ts";
  const legendas = readFileSync(LEGENDAS, "utf8");

  for (const nome of [
    "PERGUNTA_DO_CUSTO",
    "LEGENDA_DO_CUSTO_REALIZADO",
    "LEGENDA_DO_CAIXA_REALIZADO",
  ]) {
    assert.match(
      legendas,
      new RegExp(`export const ${nome}\\b`),
      `${LEGENDAS} nao exporta mais ${nome}.`
    );
  }

  // CADA FRASE CITA AS DUAS PERGUNTAS. Uma legenda que explica so o proprio
  // numero deixa o outro sem explicacao, e e o outro que a pessoa acabou de ver.
  for (const [nome, frase] of [
    ["LEGENDA_DO_CUSTO_REALIZADO", "PERGUNTA_DO_CUSTO"],
    ["LEGENDA_DO_CUSTO_REALIZADO", "PERGUNTA_DO_BRUTO"],
    ["LEGENDA_DO_CAIXA_REALIZADO", "PERGUNTA_DO_CUSTO"],
    ["LEGENDA_DO_CAIXA_REALIZADO", "PERGUNTA_DO_BRUTO"],
  ]) {
    // O CORPO VAI ATE O PROXIMO `export const`, e nao ate o proximo `;`.
    // Medido ao escrever isto: um ponto-e-virgula DENTRO do texto da legenda
    // cortava o recorte no meio da frase e a assercao reprovava uma legenda
    // correta. Um recorte que depende da pontuacao da prosa mede a prosa.
    //
    // E ELE PARA NO `/**` DO VIZINHO, nao so no `export` dele: o comentario da
    // legenda seguinte fala das MESMAS perguntas, e um recorte que o engolisse
    // ficaria verde com a frase vazia -- a assercao mediria a documentacao.
    const inicio = legendas.indexOf(`export const ${nome}`);
    const limites = ["\nexport const ", "\n/**"]
      .map((marca) => legendas.indexOf(marca, inicio + 1))
      .filter((i) => i !== -1);
    const corpo = legendas.slice(
      inicio,
      limites.length ? Math.min(...limites) : legendas.length
    );
    assert.ok(
      corpo.includes(frase),
      `${nome} nao cita ${frase}: a frase explica o proprio numero e deixa o do ` +
        "outro lado sem explicacao -- e os dois aparecem a um clique de distancia."
    );
  }

  // A DIRECAO, NO TEXTO. As duas frases afirmam qual lado mostra mais, e a
  // secao 8 de `test:criterio-do-painel` mede que a afirmacao e verdade. Sem
  // esta assercao uma reescrita poderia trocar os papeis e mandar a pessoa
  // procurar o dinheiro no lado errado, com as duas suites verdes.
  assert.match(
    legendas,
    /A aba Despesas mostra menos/,
    "LEGENDA_DO_CUSTO_REALIZADO perdeu a oracao da DIRECAO: ela existe para " +
      "dizer que o numero do destino e MENOR -- e e nessa direcao que a " +
      "surpresa doi, porque a pessoa clicou no maior."
  );
  assert.match(
    legendas,
    /No painel, o «Realizado» mostra mais/,
    "LEGENDA_DO_CAIXA_REALIZADO perdeu a oracao da DIRECAO: ela e o espelho da " +
      "de cima, dita do lado de quem CHEGOU."
  );
  // E A DO PREVISTO CONTINUA RECORTADA PELO EIXO DELA. Sem "no «Previsto»" a
  // frase do `safe-to-spend` diz "a aba Despesas mostra mais" a dois
  // centimetros de uma legenda dizendo que ela mostra menos, na mesma tela.
  assert.match(
    legendas,
    /A aba Despesas mostra mais no «Previsto»/,
    "LEGENDA_DO_LIQUIDO perdeu o recorte de eixo: com o par do REALIZADO na " +
      "mesma tela, 'a aba Despesas mostra mais' sem dizer DE QUE NUMERO " +
      "contradiz a legenda vizinha."
  );

  // `{NOME}` E NAO `includes("NOME")`, pela razao escrita no teste de cima: o
  // `includes` casa com a linha de import e fica verde num arquivo que importa
  // a constante e nao a escreve em lugar nenhum.
  const painel = semComentarios(
    readFileSync("app/(dashboard)/dashboard/page.tsx", "utf8")
  );
  assert.match(
    painel,
    /\{LEGENDA_DO_CUSTO_REALIZADO\}/,
    "o painel nao escreve a legenda do «Realizado». O tile dele e um LINK para " +
      "um numero MENOR desde a HMO-408."
  );
  assert.match(
    componente,
    /\{LEGENDA_DO_CAIXA_REALIZADO\}/,
    "a aba Despesas nao escreve a volta da legenda. A frase que ela ja tinha " +
      "aponta para Financas Pessoais, e nao para o numero de onde a pessoa veio."
  );

  // A JANELA VAI NOS DOIS LINKS, e isso e a feature e nao detalhe: as duas
  // telas leem `?de=&ate=` e as DUAS caem no mes corrente sem eles. Uma legenda
  // que fala de maio abrindo outubro apresenta como par dois numeros que nao se
  // comparam -- pior que legenda nenhuma.
  //
  // E O RECORTE E A LEGENDA, nao o arquivo: a MESMA chamada aparece no tile e no
  // cartao «posso gastar», e um `includes` no painel todo ficaria verde com o
  // link daqui nu.
  const inicio = painel.indexOf("{LEGENDA_DO_CUSTO_REALIZADO}");
  const fim = painel.indexOf("</p>", inicio);
  assert.ok(
    inicio >= 0 && fim > inicio,
    "a legenda do «Realizado» do painel nao fecha o paragrafo: o recorte abaixo " +
      "mediria o arquivo inteiro."
  );
  assert.ok(
    painel.slice(inicio, fim).includes('rotaDaTelaDoLado("despesa", periodo)'),
    "o link da legenda do «Realizado» nao leva a janela da tela. `lerPeriodo`, " +
      "do outro lado, cai no mes corrente sem `?de=&ate=`."
  );

  const inicioDaVolta = componente.indexOf("{LEGENDA_DO_CAIXA_REALIZADO}");
  const fimDaVolta = componente.indexOf("</p>", inicioDaVolta);
  assert.ok(
    inicioDaVolta >= 0 && fimDaVolta > inicioDaVolta,
    "a legenda da volta nao fecha o paragrafo na aba Despesas."
  );
  assert.ok(
    componente.slice(inicioDaVolta, fimDaVolta).includes("rotaDoPainel(periodo)"),
    "o «Abrir o painel» nao leva a janela da tela: o painel tambem le " +
      "`?de=&ate=` e tambem cai no mes corrente sem eles, entao um link nu " +
      "compararia maio com outubro."
  );
});
