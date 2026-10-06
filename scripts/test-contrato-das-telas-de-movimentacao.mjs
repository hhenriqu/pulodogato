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
  assert.match(
    lista,
    /\/api\/movimentacoes\/resumo\?tipo=\$\{tipo\}&\$\{queryDoPeriodo\}/,
    "a lista nao chama a rota com ?tipo= e o periodo na querystring"
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
  assert.match(cartoes, /podeMostrarNumero\(estado\) && resumo/);
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
    /return !ehPernaDeEntrada\(crua\);/,
    "`ehPagamentoDaFatura` nao distingue mais as duas pernas: as duas tem a " +
      "mesma chave e `valorEmReais` passa `Math.abs`, entao o mes fecha no DOBRO"
  );

  // E O RAMO EXISTE, e so na tela de Despesas. Sem a guarda de `tipo`, a chave
  // canonica poe o pagamento da fatura no total de Receitas.
  assert.match(
    lib,
    /tipo === "expense" && ehPagamentoDaFatura\(crua\)/,
    "a fatura paga nao esta mais entrando no realizado da tela de Despesas"
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

test("TODA dependencia `@/` da lib esta em DEPENDENCIAS do mutador", () => {
  // O modo de falha e o pior possivel: a dependencia que falta faz o arquivo
  // mutado nao COMPILAR, e um mutante que nao compila conta como morto. Sem o
  // controle positivo do runner, o placar sairia "todos os N mutantes morreram"
  // tendo medido zero.
  const MUTADOR = "scripts/mutantes-telas-de-movimentacao.mjs";
  const mutador = semComentarios(readFileSync(MUTADOR, "utf8"));

  const bloco = mutador.match(/const DEPENDENCIAS = \[([\s\S]*?)\];/);
  assert.ok(bloco, `nao achei DEPENDENCIAS em ${MUTADOR}`);

  const importados = [...lib.matchAll(/from "@\/(lib\/[a-z0-9-]+)"/g)].map(
    (m) => m[1]
  );
  // Controle da extracao: a lib tem pelo menos tres imports `@/lib/`, e um
  // `matchAll` que nao casasse nada faria o laco abaixo passar por vacuidade.
  assert.ok(
    importados.length >= 3,
    `extrai poucos imports de ${LIB}: ${importados}`
  );

  for (const dep of importados) {
    assert.match(
      bloco[1],
      new RegExp(`"${dep}\\.ts"`),
      `${dep}.ts e importado por ${LIB} e nao esta em DEPENDENCIAS de ` +
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
