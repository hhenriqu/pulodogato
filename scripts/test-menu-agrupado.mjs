// O MENU + SUBMENU -- HMO-423.
//
// O QUE ESTA SUITE PROVA
// ----------------------
// Que o menu lateral tem EXATAMENTE 8 entradas de primeiro nivel e que as 29
// telas continuam todas alcancaveis, cada uma em um lugar so. As duas metades
// importam: a queixa da issue era o tamanho do menu, e o risco de agrupar e
// perder tela pelo caminho -- um `href` que nao esta em grupo nenhum nao da
// sintoma, ele so deixa de existir para quem usa o app (o sintoma que a HMO-145
// foi consertar, e que a HMO-124 ja tinha visto com "Configurações" dando 404).
//
// POR QUE ELA E SEPARADA DE `test:menu-papel`
// -------------------------------------------
// Aquela suite conta TELAS, pela lista plana, porque e isso que o modo papel de
// pao filtra. Esta conta ENTRADAS e grupos. Juntar as duas faria um numero
// mudar por dois motivos diferentes, e quem fosse reescrever a contagem nao
// saberia qual dos dois tinha mudado.
//
// O QUE ELA NAO PROVA
// -------------------
// Que o CLIQUE chega ao `useState`. O que esta suite mede do abrir e fechar e
// a REGRA (`grupoAberto`, pura, com as duas fontes dela: o que o usuario mexeu
// e o grupo da tela atual) e a FIACAO dela no componente -- por assercao sobre
// o texto-fonte. Pintar o `Sidebar` num navegador para clicar nele exigiria
// stub de `next/link`, do cliente do Supabase, do `useSubscription` e do
// `useModoPapel`; o que isso acrescentaria sobre o que ja esta medido aqui e o
// `onClick` do botao estar ligado no `alternarGrupo` -- e e exatamente o que o
// mutante `o rotulo do grupo nao alterna nada` cobra, no runner desta suite.
//
// Aqui ficam, entao, os DADOS, o filtro de plano sobre a arvore, a regra do
// item ativo, a regra do aberto/fechado e a FIACAO -- esta ultima por assercao sobre o
// texto-fonte do `Sidebar`, com controle nos dois sentidos e mutante proprio
// (`node scripts/mutantes-menu-agrupado.mjs`), porque assercao sobre texto e o
// tipo que mais passa verde sem medir nada.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// `podeVerItem` NAO entra nesta lista, e a ausencia e deliberada: quem o
// exercita aqui e `filtrarMenuAgrupado`, que o chama item por item dentro de
// cada grupo. Importa-lo sem chamar deixava o `lint-tudo` vermelho na main por
// um aviso de variavel nao usada -- e um aviso que ninguem le e o que faz os
// outros 696 arquivos pararem de ser conferidos.
const {
  ehGrupo,
  filtrarMenuAgrupado,
  grupoAberto,
  itemAtivoDoMenu,
  menuAgrupado,
  navigation,
} = await import("../.tmp-menu-agrupado/components/navegacao-do-menu.js");

const { tipoDoRecorte } = await import("../.tmp-menu-agrupado/lib/contas.js");

/** O rotulo de uma entrada, seja ela grupo ou tela solta. */
const rotulo = (entrada) => (ehGrupo(entrada) ? entrada.nome : entrada.name);

/** As telas de uma entrada: as do grupo, ou ela mesma. */
const telasDa = (entrada) => (ehGrupo(entrada) ? entrada.itens : [entrada]);

const TODOS_OS_HREFS = navigation.map((item) => item.href);

// ---------------------------------------------------------------------------
// O primeiro nivel
// ---------------------------------------------------------------------------

test("o primeiro nivel tem EXATAMENTE 8 entradas, nesta ordem", () => {
  // O "exatamente" (e nao "no maximo") e o ponto desta issue inteira: o menu
  // tinha 28 itens porque nada cobrava o tamanho dele. Uma entrada nova REPROVA
  // aqui, e quem a acrescentar tem de decidir de proposito se ela merece
  // primeiro nivel ou se mora dentro de um grupo que ja existe.
  assert.deepEqual(menuAgrupado.map(rotulo), [
    "Dashboard",
    "Movimentações",
    "Contas e Cartões",
    "Planejamento",
    "Investimentos",
    "Grupos",
    "Ferramentas",
    "Conta e Ajustes",
  ]);
});

test("Dashboard e Grupos sao telas SOLTAS; as outras seis sao grupos", () => {
  // A forma de cada entrada, item por item. Sem este caso, transformar
  // "Dashboard" num grupo de um item so (ou dissolver "Planejamento" em seis
  // entradas de primeiro nivel, que e desfazer a issue) passaria pela contagem
  // acima desde que o numero fechasse.
  const soltas = menuAgrupado.filter((e) => !ehGrupo(e)).map(rotulo);
  assert.deepEqual(soltas, ["Dashboard", "Grupos"]);

  assert.equal(menuAgrupado.filter(ehGrupo).length, 6);
});

test("nenhum grupo tem menos de DOIS itens", () => {
  // Um grupo de um item so e um submenu que existe para nao agrupar nada: ele
  // cobra um clique e nao encurta o menu em nada. "Grupos" e "Dashboard" sao
  // soltos exatamente por isso, e esta e a regra que impede o proximo grupo de
  // nascer com um item e ficar assim.
  for (const grupo of menuAgrupado.filter(ehGrupo)) {
    assert.ok(
      grupo.itens.length >= 2,
      `o grupo "${grupo.nome}" tem ${grupo.itens.length} item(ns)`
    );
  }
});

test("nenhum grupo declara acesso -- quem esconde tela e o ITEM", () => {
  // A premissa de `filtrarMenuAgrupado` e esta, e ela precisa ser verificada e
  // nao so comentada: se um grupo puder declarar `requiredPlans`, passa a haver
  // um segundo lugar que esconde tela, e e o lugar que ninguem confere -- a
  // tela sumiria do menu com o item dela intacto e `podeVerItem` dizendo que
  // ela aparece.
  for (const grupo of menuAgrupado.filter(ehGrupo)) {
    for (const campo of ["requiredPlans", "requiredFeature", "isPremium", "href"]) {
      assert.ok(
        !(campo in grupo),
        `o grupo "${grupo.nome}" declara ${campo}, e grupo nao decide acesso nem navega`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// As 29 telas: nenhuma perdida, nenhuma repetida
// ---------------------------------------------------------------------------

test("as 29 telas moram em um lugar so, e a lista plana e a soma delas", () => {
  const dasEntradas = menuAgrupado.flatMap(telasDa).map((item) => item.href);

  // (a) A lista plana E a arvore achatada -- mesmo conteudo, mesma ordem. E o
  //     que prova que `navigation` e DERIVADA e nao uma segunda lista mantida a
  //     mao: uma copia escrita a mao bateria hoje e divergiria na primeira tela
  //     nova, que e exatamente o modo de falha que esta assercao existe para
  //     impedir.
  assert.deepEqual(TODOS_OS_HREFS, dasEntradas);
  assert.equal(navigation.length, 29);

  // (b) Nenhum `href` repetido. Um item em dois grupos pinta a mesma tela duas
  //     vezes no menu (e o React reclamaria de chave repetida no console, que e
  //     tudo que ele faz: a primeira pintura fica identica).
  assert.equal(new Set(TODOS_OS_HREFS).size, TODOS_OS_HREFS.length);

  // (c) Nenhum rotulo repetido no primeiro nivel: o nome do grupo e a chave de
  //     abrir e fechar no `Sidebar`, e dois grupos de mesmo nome abririam
  //     juntos.
  const rotulos = menuAgrupado.map(rotulo);
  assert.equal(new Set(rotulos).size, rotulos.length);
});

test("nenhuma tela de antes da HMO-423 ficou fora do menu", () => {
  // O RISCO CENTRAL DE AGRUPAR, escrito como lista: as 28 rotas que o menu
  // plano tinha, uma por uma. Agrupar 28 itens a mao perde um pelo caminho sem
  // nenhum sintoma -- a tela continua respondendo 200 e simplesmente nao tem
  // mais como ser alcancada clicando.
  //
  // A lista e literal de proposito. Deriva-la de `navigation` seria a lista
  // conferindo consigo mesma, e e justamente a perda de um item que ela tem de
  // pegar.
  const ANTES_DA_423 = [
    "/dashboard",
    "/dashboard/personal-finance",
    "/dashboard/receitas",
    "/dashboard/despesas",
    "/dashboard/transferencias",
    "/dashboard/contas",
    "/dashboard/cartoes",
    "/dashboard/payroll",
    "/dashboard/bills",
    "/dashboard/cash-flow",
    "/dashboard/notifications",
    "/dashboard/budgets",
    "/dashboard/statements",
    "/dashboard/investments",
    "/dashboard/mybank",
    "/dashboard/net-worth",
    "/dashboard/recurrences",
    "/dashboard/categorias",
    "/dashboard/categorization",
    "/dashboard/goals",
    "/dashboard/calculators",
    "/dashboard/reports",
    "/dashboard/expense-groups",
    "/dashboard/trading",
    "/dashboard/profile",
    "/dashboard/connections",
    "/dashboard/settings",
    "/dashboard/admin",
  ];

  assert.equal(ANTES_DA_423.length, 28);
  for (const href of ANTES_DA_423) {
    assert.ok(TODOS_OS_HREFS.includes(href), `${href} saiu do menu`);
  }

  // E a unica tela NOVA e a da issue -- agrupar nao e hora de acrescentar menu.
  const novas = TODOS_OS_HREFS.filter((href) => !ANTES_DA_423.includes(href));
  assert.deepEqual(novas, ["/dashboard/contas?tipo=investment"]);
});

// ---------------------------------------------------------------------------
// O PEDIDO DA ISSUE: o caminho paralelo das contas de investimento
// ---------------------------------------------------------------------------

test("MyBank e a conta de investimento moram DENTRO de Investimentos", () => {
  // A frase da issue: "MyBank deve estar dentro de Investimentos, a conta
  // investimento tambem, pra que ela tenha um caminhar em paralelo as minhas
  // contas do dia a dia."
  const investimentos = menuAgrupado
    .filter(ehGrupo)
    .find((g) => g.nome === "Investimentos");
  assert.ok(investimentos, "o grupo Investimentos deveria existir");

  const dentro = investimentos.itens.map((item) => item.href);
  assert.ok(dentro.includes("/dashboard/mybank"), "MyBank saiu do grupo");
  assert.ok(
    dentro.includes("/dashboard/contas?tipo=investment"),
    "a conta de investimento saiu do grupo"
  );

  // E O PARALELO, que e a outra metade do pedido: a conta do dia a dia continua
  // em OUTRA entrada. Se alguem mover "Contas" para dentro de Investimentos (ou
  // a de investimento para "Contas e Cartoes"), o caminho deixa de ser paralelo
  // e passa a ser o mesmo -- e as duas leituras ficariam no mesmo submenu,
  // dizendo que sao a mesma coisa.
  const contasECartoes = menuAgrupado
    .filter(ehGrupo)
    .find((g) => g.nome === "Contas e Cartões");
  assert.ok(contasECartoes, "o grupo Contas e Cartões deveria existir");
  assert.deepEqual(
    contasECartoes.itens.map((item) => item.href),
    ["/dashboard/contas", "/dashboard/cartoes"]
  );
});

test("a query do menu e EXATAMENTE a que a tela de contas sabe ler", () => {
  // A FIACAO, e a razao de `lib/contas.ts` entrar no tsconfig desta suite.
  //
  // O item leva `?tipo=investment`; quem le aquilo na tela e o `tipoDoRecorte`.
  // Os dois lados sao arquivos diferentes, e um `?tipo=investments` (ou um
  // `?conta=`) em qualquer um deles nao da erro nenhum: a tela cai calada na
  // lista inteira, com o titulo "Contas", e o item do menu passa a apontar para
  // a tela que ele deveria recortar. Entao a query sai DO MENU e e entregue ao
  // LEITOR DE VERDADE.
  const item = navigation.find((i) => i.name === "Contas de Investimento");
  assert.ok(item, "o item Contas de Investimento deveria existir");

  const [rota, query] = item.href.split("?");
  assert.equal(rota, "/dashboard/contas");

  const tipo = new URLSearchParams(query).get("tipo");
  assert.equal(
    tipoDoRecorte(tipo),
    "investment",
    `a tela nao sabe ler ?${query} -- ela cairia na lista inteira`
  );

  // CONTROLE NEGATIVO do leitor, aqui e nao so na suite dele: se
  // `tipoDoRecorte` passar a aceitar qualquer coisa, a assercao de cima vira
  // enfeite -- ela ficaria verde com qualquer query no `href`.
  assert.equal(tipoDoRecorte("investments"), null);
  assert.equal(tipoDoRecorte(null), null);
});

// ---------------------------------------------------------------------------
// O filtro de plano, sobre a arvore
// ---------------------------------------------------------------------------

test("o plano filtra ITEM dentro do grupo, e nao a entrada", () => {
  // As duas telas restritas moram em grupos diferentes ("Trading" em
  // Investimentos, "Admin" em Conta e Ajustes), e as duas tem vizinhos. Entao
  // nenhum plano perde ENTRADA -- os oito rotulos continuam de pe para todo
  // mundo -- e o que muda e o tamanho de dois submenus.
  for (const plano of ["admin", "trader", "invest", "free", undefined]) {
    assert.deepEqual(
      filtrarMenuAgrupado(menuAgrupado, plano).map(rotulo),
      menuAgrupado.map(rotulo),
      `o plano ${plano} perdeu uma entrada de primeiro nivel`
    );
  }

  const telasDe = (plano) =>
    filtrarMenuAgrupado(menuAgrupado, plano)
      .flatMap(telasDa)
      .map((item) => item.href);

  // As contagens sao as mesmas de `test:menu-papel` -- de proposito: e o MESMO
  // `podeVerItem` nos dois caminhos, e se as duas suites discordassem uma delas
  // estaria medindo um filtro proprio.
  assert.equal(telasDe("admin").length, 29);
  assert.equal(telasDe("trader").length, 28);
  assert.equal(telasDe("free").length, 27);

  assert.ok(telasDe("trader").includes("/dashboard/trading"));
  assert.ok(!telasDe("trader").includes("/dashboard/admin"));
  assert.ok(!telasDe("free").includes("/dashboard/trading"));
});

test("grupo que perdeu TODOS os itens desaparece", () => {
  // Nenhum grupo real chega a esvaziar hoje, e por isso este caso monta um: um
  // grupo cujo unico item e restrito. Sem ele, a regra "grupo vazio desaparece"
  // seria prosa -- e um submenu que abre vazio e a feature existindo e nao
  // existindo ao mesmo tempo, so que em forma de gaveta.
  const arvore = [
    { nome: "Só Admin", icon: null, itens: [navigation.find((i) => i.href === "/dashboard/admin")] },
    { nome: "Dois", icon: null, itens: navigation.slice(0, 2) },
  ];

  assert.deepEqual(
    filtrarMenuAgrupado(arvore, "admin").map(rotulo),
    ["Só Admin", "Dois"]
  );
  assert.deepEqual(filtrarMenuAgrupado(arvore, "free").map(rotulo), ["Dois"]);

  // E a entrada SOLTA restrita tambem desaparece -- ela nao tem grupo para
  // esvaziar, e o filtro tem de alcanca-la do mesmo jeito.
  const soltaRestrita = [navigation.find((i) => i.href === "/dashboard/admin")];
  assert.equal(filtrarMenuAgrupado(soltaRestrita, "admin").length, 1);
  assert.equal(filtrarMenuAgrupado(soltaRestrita, "free").length, 0);
});

test("o filtro NAO muta a arvore original", () => {
  // `filtrarMenuAgrupado` devolve grupos novos (`{...grupo, itens}`). Se ele
  // escrevesse em `grupo.itens`, o menu de quem e `free` apagaria "Trading" do
  // modulo para o resto da sessao -- e um `admin` que trocasse de aba veria o
  // menu do `free`. O defeito aparece uma vez e nunca mais, que e o pior tipo.
  const antes = JSON.stringify(menuAgrupado.flatMap(telasDa).map((i) => i.href));
  filtrarMenuAgrupado(menuAgrupado, "free");
  assert.equal(
    JSON.stringify(menuAgrupado.flatMap(telasDa).map((i) => i.href)),
    antes
  );
});

// ---------------------------------------------------------------------------
// O item ativo: o mais especifico ganha
// ---------------------------------------------------------------------------

test("o item ativo e UM so, e e o mais especifico", () => {
  const ativo = (caminho, busca = "") =>
    itemAtivoDoMenu(TODOS_OS_HREFS, caminho, busca);

  // O DEFEITO QUE ISTO CONSERTA, primeiro: `/dashboard` e prefixo de todas as
  // rotas do app, e o teste antigo (`pathname.startsWith(href + "/")`) acendia
  // "Dashboard" em TODA tela -- quem estava em Contas via dois itens marcados.
  assert.equal(ativo("/dashboard"), "/dashboard");
  assert.equal(ativo("/dashboard/contas"), "/dashboard/contas");
  assert.equal(ativo("/dashboard/net-worth"), "/dashboard/net-worth");

  // O SEGUNDO DEFEITO: "Contas" e "Contas de Investimento" sao a MESMA rota, e
  // quem as separa e a query. Sem ler a query os dois acendem juntos sempre.
  assert.equal(
    ativo("/dashboard/contas", "tipo=investment"),
    "/dashboard/contas?tipo=investment"
  );
  // Query de outro tipo (ou query que a tela nao entende) nao acende o item do
  // recorte: a tela cai na lista inteira, e o item marcado tem de ser o dela.
  assert.equal(ativo("/dashboard/contas", "tipo=checking"), "/dashboard/contas");
  assert.equal(ativo("/dashboard/contas", "pagina=2"), "/dashboard/contas");
  // E o `href` com query CONTEM, nao e igual: um parametro a mais na barra nao
  // apaga a marcacao.
  assert.equal(
    ativo("/dashboard/contas", "tipo=investment&ordem=nome"),
    "/dashboard/contas?tipo=investment"
  );

  // TELA FILHA acende o item do pai -- `/dashboard/cartoes/<id>` e
  // `/dashboard/expense-groups/<id>` sao as duas que existem hoje.
  assert.equal(ativo("/dashboard/cartoes/abc-123"), "/dashboard/cartoes");
  assert.equal(
    ativo("/dashboard/expense-groups/abc-123"),
    "/dashboard/expense-groups"
  );

  // E fora do painel nao acende nada. `null` e nao "/dashboard": a regra e
  // prefixo com barra, entao `/dashboardzinho` nao e filha de `/dashboard`.
  assert.equal(ativo("/login"), null);
  assert.equal(ativo("/dashboardzinho"), null);
});

test("o item ativo nunca e um grupo -- grupo nao navega", () => {
  // O vencedor de `itemAtivoDoMenu` sai da lista de `href`s, e grupo nao tem
  // `href`. Este caso trava a consequencia: em qualquer tela do app, o rotulo
  // que acende e de uma TELA, e quem diz "a sua tela esta aqui dentro" e o
  // submenu aberto com o item marcado.
  for (const href of TODOS_OS_HREFS) {
    const [caminho, query = ""] = href.split("?");
    const vencedor = itemAtivoDoMenu(TODOS_OS_HREFS, caminho, query);
    assert.ok(
      TODOS_OS_HREFS.includes(vencedor),
      `${href} acendeu ${vencedor}, que nao e tela do menu`
    );
  }
});

test("toda tela do menu acende o PROPRIO item", () => {
  // A ida e a volta: navegar para o `href` de cada uma das 29 telas tem de
  // acender aquela tela, e nao uma vizinha. E o caso que pega o empate de peso
  // -- duas rotas com o mesmo caminho e queries diferentes, ou um prefixo que
  // ganha de quem nao devia.
  for (const href of TODOS_OS_HREFS) {
    const [caminho, query = ""] = href.split("?");
    assert.equal(
      itemAtivoDoMenu(TODOS_OS_HREFS, caminho, query),
      href,
      `${href} nao acende o proprio item`
    );
  }
});

// ---------------------------------------------------------------------------
// Aberto ou fechado: duas fontes, e a do usuario manda
// ---------------------------------------------------------------------------

const GRUPO_INVESTIMENTOS = menuAgrupado
  .filter(ehGrupo)
  .find((g) => g.nome === "Investimentos");

test("grupo fechado por padrao, ABERTO se a tela atual mora nele", () => {
  // O menu nasce todo fechado -- e o que encurta a lista, e o pedido da issue.
  assert.equal(grupoAberto(GRUPO_INVESTIMENTOS, {}, "/dashboard/contas"), false);
  assert.equal(grupoAberto(GRUPO_INVESTIMENTOS, {}, null), false);

  // Mas quem esta numa tela de dentro ve o grupo ABERTO, com ela marcada. Sem
  // isto, entrar em `/dashboard/mybank` por um link de dentro de uma pagina (ou
  // recarregar ali) daria um menu de 8 rotulos fechados e nada dizendo onde a
  // pessoa esta.
  assert.equal(
    grupoAberto(GRUPO_INVESTIMENTOS, {}, "/dashboard/mybank"),
    true
  );
  // E vale para o item com query, que e o que exige o `href` INTEIRO na
  // comparacao: so o caminho (`/dashboard/contas`) abriria tambem o grupo
  // "Contas e Cartoes".
  assert.equal(
    grupoAberto(GRUPO_INVESTIMENTOS, {}, "/dashboard/contas?tipo=investment"),
    true
  );

  // TODO grupo abre na tela de cada um dos seus itens, e nenhum grupo abre na
  // tela de outro. A tabela completa, e nao so o caso de Investimentos: um
  // `some` escrito sobre a lista errada (as 29 telas em vez das do grupo)
  // abriria TODOS os grupos em TODA tela, e o caso unico acima passaria.
  for (const grupo of menuAgrupado.filter(ehGrupo)) {
    for (const outro of menuAgrupado.filter(ehGrupo)) {
      for (const item of outro.itens) {
        assert.equal(
          grupoAberto(grupo, {}, item.href),
          grupo.nome === outro.nome,
          `${grupo.nome} com a tela ${item.href} de ${outro.nome}`
        );
      }
    }
  }
});

test("o que o usuario mexeu VENCE a tela atual -- nos dois sentidos", () => {
  // Abrir a mao um grupo que nao e o da tela.
  assert.equal(
    grupoAberto(GRUPO_INVESTIMENTOS, { Investimentos: true }, "/dashboard"),
    true
  );

  // E FECHAR a mao o grupo da tela em que se esta. Este e o lado que erra: com
  // `??` sobre o booleano ou com `||`, o `false` do usuario seria lido como
  // "nao respondeu" e o grupo reabriria no quadro seguinte -- o submenu que nao
  // fecha.
  assert.equal(
    grupoAberto(
      GRUPO_INVESTIMENTOS,
      { Investimentos: false },
      "/dashboard/mybank"
    ),
    false
  );

  // Mexer em UM grupo nao mexe nos outros: o mapa e por nome.
  const planejamento = menuAgrupado
    .filter(ehGrupo)
    .find((g) => g.nome === "Planejamento");
  assert.equal(
    grupoAberto(planejamento, { Investimentos: true }, "/dashboard"),
    false
  );
});

// ---------------------------------------------------------------------------
// A fiacao: o Sidebar PINTA grupo, e nao decide ativo por conta propria
// ---------------------------------------------------------------------------

/**
 * Tira comentarios de linha e de bloco. Nao e um parser -- e o suficiente para
 * o uso aqui, e o caso abaixo tem controle nos DOIS sentidos justamente porque
 * um strip de comentario erra para os dois lados: apagando codigo de verdade
 * (uma `//` dentro de string) ou deixando passar comentario.
 */
function semComentarios(fonte) {
  return fonte
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

test("o Sidebar pinta GRUPO, e o item ativo vem de itemAtivoDoMenu", () => {
  const cru = readFileSync(join("components", "Sidebar.tsx"), "utf8");
  const codigo = semComentarios(cru);

  // CONTROLE NOS DOIS SENTIDOS, antes das assercoes de verdade.
  //
  // (a) o strip nao comeu codigo: um token que so existe em codigo sobreviveu.
  assert.match(codigo, /entradasDoMenu\.map\(/);
  // (b) o strip funcionou: uma frase que so existe em comentario SUMIU, e
  //     estava no texto cru. Sem este par, um `semComentarios` que devolvesse a
  //     fonte intacta (ou vazia) passaria as assercoes de baixo sem sentido.
  const soEmComentario = "O markup do item era copiado aqui e la";
  assert.ok(cru.includes(soEmComentario), "a frase-controle saiu do Sidebar");
  assert.ok(!codigo.includes(soEmComentario), "o strip de comentario nao agiu");

  // O GRUPO E PINTADO: o componente distingue grupo de tela e abre submenu.
  assert.match(codigo, /ehGrupo\(entrada\)/);
  assert.match(codigo, /filtrarMenuAgrupado\(menuAgrupado,/);
  assert.match(codigo, /aria-expanded=/);
  assert.match(codigo, /alternarGrupo\(entrada\)/);

  // O ABERTO/FECHADO VEM DA REGRA PURA, com o mapa do `useState` e o item ativo
  // -- nao de um `useState` por grupo e nao de um `useEffect` que sincroniza
  // depois de navegar. E o `alternarGrupo` le o mapa pelo ATUALIZADOR do React
  // (`(mexidos) => ...`), nao pela variavel fechada na renderizacao: dois
  // cliques no mesmo quadro perderiam um.
  assert.match(codigo, /grupoAberto\(grupo, gruposMexidos, hrefAtivo\)/);
  assert.match(
    codigo,
    /setGruposMexidos\(\(mexidos\) => \(\{[\s\S]{0,200}?grupoAberto\(grupo, mexidos, hrefAtivo\)/
  );

  // O ROTULO DO GRUPO E UM BOTAO, nao um link: ele nao navega. Um `<Link>` ali
  // mandaria o clique para uma rota que nao existe (o grupo nao tem `href`).
  assert.match(codigo, /<button\s+type="button"\s+onClick=\{\(\) => alternarGrupo/);

  // O ITEM ATIVO SAI DA FUNCAO PURA, e o `startsWith` do pathname NAO VOLTA.
  // Era ele quem acendia o "Dashboard" em toda tela, e quem acenderia "Contas"
  // junto com "Contas de Investimento".
  assert.match(codigo, /itemAtivoDoMenu\(/);
  assert.match(codigo, /item\.href === hrefAtivo/);
  assert.doesNotMatch(codigo, /pathname\.startsWith\(/);
  assert.doesNotMatch(codigo, /pathname === item\.href/);

  // A QUERY E LIDA. Sem `useSearchParams` o item do recorte nunca acende --
  // `itemAtivoDoMenu` receberia busca vazia e o vencedor seria sempre "Contas".
  assert.match(codigo, /useSearchParams\(\)/);

  // E O SUBMENU FECHADO NAO EXISTE NO DOM. Com `hidden` os 29 links ficariam no
  // HTML e o leitor de tela anunciaria um menu de 29 itens para quem ve 8.
  assert.match(codigo, /\{aberto && \(/);
  assert.doesNotMatch(codigo, /hidden=\{!aberto\}/);
});

test("o Sidebar e o UNICO lugar que le o menu agrupado", () => {
  // `menuAgrupado` e dado de menu. O dia em que uma pagina o importar -- para
  // montar um menu proprio, uma trilha de navegacao ou uma lista de atalhos --
  // passa a haver duas leituras da mesma arvore, e elas divergem na primeira
  // tela nova. O lugar de um segundo leitor e um componente que o `Sidebar`
  // tambem use, nao uma copia.
  const arquivos = [];
  const varrer = (dir) => {
    for (const nome of readdirSync(dir)) {
      if (nome === "node_modules" || nome.startsWith(".")) continue;
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) varrer(caminho);
      else if (/\.tsx?$/.test(nome)) arquivos.push(caminho);
    }
  };
  varrer("app");
  varrer("components");

  // CONTROLE POSITIVO primeiro: a varredura e o padrao precisam ENCONTRAR o
  // leitor no Sidebar. Sem isto, um erro de caminho, de regex ou de extensao
  // deixaria o caso verde por nao achar nada em lugar nenhum -- que e
  // exatamente a aparencia de "ninguem mais le".
  const leem = arquivos.filter((caminho) => {
    const fonte = readFileSync(caminho, "utf8");
    return (
      /\bmenuAgrupado\b/.test(fonte) &&
      caminho !== join("components", "navegacao-do-menu.ts")
    );
  });

  assert.deepEqual(
    leem,
    [join("components", "Sidebar.tsx")],
    "so o Sidebar pode ler o menu agrupado"
  );
});
