// O MENU REDUZIDO do modo papel de pao -- HMO-284, ampliado pela HMO-294 e pela
// HMO-299 (plano da HMO-279), e ENCOLHIDO de 8 para 3 pela HMO-466 (fase 5 do
// plano da HMO-462).
//
// O QUE ESTA SUITE PROVA
// ----------------------
// Com o modo ligado o menu tem EXATAMENTE 3 rotas; desligado, EXATAMENTE 29
// TELAS -- que desde a HMO-423 sao pintadas como 8 entradas de primeiro nivel
// (duas telas soltas e seis grupos com submenu). Esta suite conta TELAS, pela
// lista plana `navigation`; quem conta as entradas e os grupos e
// `npm run test:menu-agrupado`.
//
// O "exatamente" (e nao "contem") e o ponto. Com `contem`, a suite fica verde
// enquanto o menu volta a crescer: o proximo item acrescentado ao array nao
// quebraria nada, e o modo reduzido voltaria a ter 4, 5, 6 itens sem ninguem
// notar. Aqui um item novo REPROVA, e quem o acrescentou tem de decidir de
// proposito se ele entra ou nao no modo.
//
// E ELE PRENDE NOS DOIS SENTIDOS, que e o que esta issue exercita: o 5 virou 7
// e o 7 virou 8 quando a HMO-294 pos `/dashboard/profile` e
// `/dashboard/settings` na lista e a HMO-299 pos `/dashboard/expense-groups`; o
// 8 virou 3 agora, quando a issue-mae pediu a conversa. Nas tres vezes as
// contagens abaixo tiveram de ser reescritas uma por uma -- de proposito, que e
// o preco de prender numero exato e tambem o que ele compra. Uma guarda que
// nao reprovasse ENCOLHER o menu seria metade de uma guarda: Grupos poderia
// ter saido da lista por descuido e nada reclamaria.
//
// POR QUE A SUITE FIXA O PLANO
// ----------------------------
// `podeVerItem` e o PRIMEIRO filtro do menu e ele ja existia. O menu completo
// so tem 29 telas para quem e `admin`: duas delas declaram `requiredPlans`
// (Admin e Trading), e a contagem cai para 28 no plano `trader` e para 27 nos
// outros -- a suite passaria a medir o PLANO em vez do MODO, variando com uma
// regra que nao e assunto desta issue. Entao o plano entra fixo em todo caso, e
// ha um caso proprio (`o plano e o OUTRO filtro`) que prende as tres contagens
// e a tabela de quem ve o que, em vez de deixa-las implicitas.
//
// POR QUE ELA NAO MEDE A SI MESMA
// -------------------------------
// Comparar a saida do filtro com o `ROTAS_DO_MENU_DE_PAPEL` que o alimenta
// provaria pouco: a lista estaria conferindo consigo mesma. O que torna a
// assercao real e que ela so fecha se cada uma das 3 rotas EXISTIR no array de
// 29 -- uma rota renomeada la derruba a contagem -- e que os NOMES conferidos
// (`Dashboard`, `Perfil`, `Configuracoes`) vem do array de navegacao, nao da
// lista de rotas. Esses nomes sao dado independente.
//
// O QUE ESTA SUITE NAO PROVA
// --------------------------
// Que o `Sidebar` pinta o menu. Isso e assunto de renderizacao, e o que amarra
// o filtro ao componente aqui e o `tsc`: `components/Sidebar.tsx` nao tem mais
// array nem filtro proprio -- ele IMPORTA os dois destes modulos, e a unica
// definicao de cada um e a que esta sendo testada.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const { navigation, podeVerItem } = await import(
  "../.tmp-menu-papel/components/navegacao-do-menu.js"
);

const { ROTAS_DO_MENU_DE_PAPEL, filtrarMenuDoPapel, noMenuDoPapel } =
  await import("../.tmp-menu-papel/lib/menu-do-papel.js");

/**
 * O menu como o `Sidebar` o monta: os dois filtros, nesta ordem, sobre o mesmo
 * array. Esta funcao e a copia da composicao que esta no componente -- e o
 * unico pedaco duplicado da suite, e ele e de UMA LINHA de proposito: duplicar
 * a chamada e barato, duplicar a LISTA nao seria.
 */
function menu({ plano, papel }) {
  return filtrarMenuDoPapel(
    navigation.filter((item) => podeVerItem(item, plano)),
    papel
  );
}

const hrefs = (itens) => itens.map((item) => item.href);
const nomes = (itens) => itens.map((item) => item.name);

// ---------------------------------------------------------------------------
// Desligado: o menu inteiro
// ---------------------------------------------------------------------------

test("desligado, o menu tem EXATAMENTE 29 telas", () => {
  const itens = menu({ plano: "admin", papel: false });

  // Se este numero mudou, foi porque alguem acrescentou (ou tirou) um item do
  // array. Isso nao e um erro -- e a pergunta que esta suite existe para
  // forcar: o item novo aparece no modo papel de pao? Se sim, entre com ele em
  // `ROTAS_DO_MENU_DE_PAPEL` e no caso do menu reduzido abaixo; se nao, ajuste
  // so este 29.
  //
  // AS DUAS NOTAS ABAIXO SAO HISTORIA, e falam das 8 rotas que o modo tinha
  // quando elas foram escritas. A HMO-466 encolheu a lista para 3, entao
  // `/dashboard/contas` e `/dashboard/cartoes` JA NAO estao mais no modo -- o
  // que as notas registram e a DECISAO de cada issue, que continua valendo: a
  // tela nova nao entrou no modo.
  //
  // O 27 VIROU 28 NA HMO-371: entrou "MyBank" (`/dashboard/mybank`), e a
  // resposta a pergunta acima foi NAO -- ele fica FORA do modo papel de pao. O
  // modo e para quem quer o app simples; emprestar dinheiro para si mesmo em 24x
  // nao e uma das cinco telas de dinheiro que ele promete. As oito rotas do modo
  // continuaram as mesmas, e o caso das telas escondidas abaixo e quem prova
  // que a nova esta entre elas.
  //
  // O 28 VIROU 29 NA HMO-423: entrou "Contas de Investimento"
  // (`/dashboard/contas?tipo=investment`), e a resposta tambem foi NAO. Ela e a
  // tela de Contas recortada no tipo, e `/dashboard/contas` -- a tela inteira --
  // ERA entao uma das oito do modo: botar as duas no menu reduzido seria ensinar
  // justamente o modo simples a ter dois itens para a mesma tela. (Hoje as duas
  // estao fora, pela HMO-466, e a assercao sobre a rota com QUERY continua de
  // pe por outro motivo -- ver o caso das 26 escondidas.)
  //
  // O QUE ESTE NUMERO *NAO* MEDE DESDE A HMO-423: quantos itens o menu PINTA.
  // `navigation` virou a lista PLANA derivada de `menuAgrupado`, e o menu
  // desligado mostra 8 entradas de primeiro nivel com as 29 telas dentro. As
  // duas contagens vivem em suites diferentes de proposito -- esta conta TELAS,
  // que e o que o modo papel filtra; `test:menu-agrupado` conta as entradas.
  assert.equal(itens.length, 29);
  assert.equal(navigation.length, 29);
});

test("desligado, o filtro do modo devolve o MESMO array -- sem copia", () => {
  // O modo desligado e o caminho de todo mundo e nao deve custar nada. Isto
  // tambem e o que garante que nenhum item se perde pelo caminho: nao ha
  // caminho de perda, e o proprio array que volta.
  const comPlano = navigation.filter((item) => podeVerItem(item, "admin"));
  assert.equal(filtrarMenuDoPapel(comPlano, false), comPlano);
});

// ---------------------------------------------------------------------------
// Ligado: as tres telas
// ---------------------------------------------------------------------------

test("ligado, o menu tem EXATAMENTE as 3 rotas, na ordem do menu", () => {
  const itens = menu({ plano: "admin", papel: true });

  assert.equal(itens.length, 3);
  // A ORDEM e a do array de navegacao, nao a de `ROTAS_DO_MENU_DE_PAPEL`. Aqui
  // as duas coincidem -- `/dashboard` e a entrada SOLTA que abre o menu, e
  // "Perfil" e "Configuracoes" moram nesta ordem dentro do grupo "Conta e
  // Ajustes" --, e isso NAO torna o caso vazio: ele continua sendo o unico
  // lugar onde a identidade das tres rotas esta escrita por extenso, e o
  // controle negativo de que o filtro nao ordena pela lista de rotas vive em
  // `scripts/mutantes-menu-papel.mjs` (o sobrevivente ESPERADO, que troca a
  // ordem da lista e tem de passar).
  assert.deepEqual(hrefs(itens), [
    "/dashboard",
    "/dashboard/profile",
    "/dashboard/settings",
  ]);
});

test("ligado, os 3 itens sao as telas certas -- conferido pelo NOME", () => {
  // Os nomes vem do array de navegacao, nao de `ROTAS_DO_MENU_DE_PAPEL`. E o
  // que impede este caso de ser a lista conferindo consigo mesma: uma rota
  // trocada por outra (digamos `/dashboard/transferencias` no lugar de
  // `/dashboard`) passaria por qualquer assercao de CONTAGEM e por qualquer
  // assercao que so comparasse rotas com rotas -- e aqui apareceria como
  // "Transferências" onde se espera "Dashboard".
  //
  // "Configurações" e o nome do array, com acento e cedilha. Ele e tambem o que
  // prova que a rota que ficou e a tela do espelho do interruptor, e nao
  // `/dashboard/connections` (que esta ENTRE "Perfil" e ela no array, e e por
  // isso que trocar uma pela outra mantem a contagem em 3).
  assert.deepEqual(nomes(menu({ plano: "admin", papel: true })), [
    "Dashboard",
    "Perfil",
    "Configurações",
  ]);
});

test("ligado, as 26 telas restantes saem do menu -- nenhuma sobra", () => {
  const dentro = new Set(hrefs(menu({ plano: "admin", papel: true })));
  const fora = hrefs(menu({ plano: "admin", papel: false })).filter(
    (href) => !dentro.has(href)
  );

  // 19 -> 20 na HMO-371: "MyBank" entrou no array e fica FORA do modo. O laco
  // abaixo e quem prova que ele esta entre as escondidas de verdade -- a
  // contagem sozinha nao distingue "o item novo ficou fora" de "um item antigo
  // saiu e o novo entrou".
  //
  // 20 -> 21 na HMO-423: "Contas de Investimento". Ela merece assercao PROPRIA
  // e nao so o +1 da contagem, porque ela e a unica rota do menu com QUERY, e e
  // o caso em que uma leitura por caminho erraria calada: `noMenuDoPapel`
  // compara o `href` inteiro, entao `/dashboard/contas?tipo=investment` fica
  // fora. Se alguem fizer o predicado comparar so o caminho, a tela recortada
  // entra no modo simples sem ninguem pedir -- e a linha abaixo e quem reprova.
  //
  // 21 -> 26 NA HMO-466, e os cinco que entraram sao os que a issue-mae pediu
  // que saissem: as quatro telas de relatorio de dinheiro e GRUPOS. Cada uma
  // tem assercao propria abaixo, e nao so o +5 da contagem, por dois motivos
  // diferentes:
  //
  // (a) a contagem sozinha nao distingue "as cinco certas sairam" de "sairam
  //     quatro e uma sexta tela sumiu por descuido" -- 26 fecha nos dois casos;
  // (b) `/dashboard/expense-groups` e uma REVERSAO DELIBERADA da HMO-299, e o
  //     unico lugar onde uma reversao assim para de parecer regressao e uma
  //     assercao que a afirma por extenso. A issue-mae pede "nada de grupos,
  //     nada de contas divididas"; esta linha e a guarda dessa frase NO MENU.
  //     ESCONDER NAO E FILTRAR O DINHEIRO: grupo escondido daqui continua
  //     somando no painel e aceitando lancamento (fases F2 e F3 da HMO-462).
  assert.equal(fora.length, 26);
  assert.ok(
    fora.includes("/dashboard/mybank"),
    "o MyBank deveria estar entre as telas escondidas pelo modo"
  );
  assert.ok(
    fora.includes("/dashboard/contas?tipo=investment"),
    "Contas de Investimento deveria estar escondida pelo modo"
  );
  assert.ok(
    fora.includes("/dashboard/expense-groups"),
    "Grupos deveria estar escondida pelo modo -- a HMO-466 reverte a HMO-299 " +
      "de proposito, e e esta linha que diz que foi de proposito"
  );
  for (const relatorio of [
    "/dashboard/receitas",
    "/dashboard/despesas",
    "/dashboard/contas",
    "/dashboard/cartoes",
  ]) {
    assert.ok(
      fora.includes(relatorio),
      `${relatorio} deveria sair do menu do modo -- a conversa substitui o relatorio`
    );
  }
  // E um controle do `noMenuDoPapel`, nao so aritmetica: cada rota escondida
  // tem de ser reprovada pelo predicado, uma por uma. Uma rota que saisse da
  // lista por outro motivo (um `href` duplicado comendo o Set, por exemplo)
  // apareceria aqui.
  for (const href of fora) {
    assert.equal(noMenuDoPapel(href), false, `${href} deveria estar escondida`);
  }
});

test("as 3 rotas do modo existem todas no array de navegacao", () => {
  // Redundante com a contagem de 3 acima, e proposital: quando alguem muda o
  // `href` de uma das tres telas, esta e a mensagem de erro que diz QUAL rota
  // sumiu, em vez de "esperava 3, recebeu 2".
  const todas = new Set(hrefs(navigation));
  for (const rota of ROTAS_DO_MENU_DE_PAPEL) {
    assert.ok(todas.has(rota), `${rota} nao existe no menu`);
  }
});

// ---------------------------------------------------------------------------
// O modo nao e o plano
// ---------------------------------------------------------------------------

test("o plano e o OUTRO filtro: cada plano tem a sua contagem", () => {
  // Este caso existe para que o 29 lá em cima nao seja um numero misterioso. E
  // e a razao de todos os outros casos fixarem o plano.
  //
  // Sao DOIS os itens restritos, nao um: `Admin` (`["admin"]`) e `Trading`
  // (`["trader", "admin"]`). Entao ha TRES contagens e nao duas, e e por isso
  // que elas estao escritas uma por uma em vez de "sem admin da 25": o `trader`
  // nao e o `free` com outro nome.
  //
  // ATE A HMO-292 as tres eram 25, 25 e 25. O predicado olhava se a lista
  // CONTINHA "admin" e ai exigia plano `admin`, ignorando o resto -- e quem
  // pagava o plano `trader` nao via no menu a tela de Trading que comprou. Esta
  // suite REGISTRAVA aquele defeito, com um caso que afirmava a invisibilidade
  // e um comentario apontando para a issue, em vez de corrigi-lo: ele foi
  // encontrado (nao causado) na HMO-284, cujo assunto era o menu reduzido, e
  // consertar la mudaria o menu de quem usa o app num PR sobre outra coisa.
  //
  // As cinco subiram de 1 na HMO-371 e de 1 outra vez na HMO-423 (entraram
  // "MyBank" e "Contas de Investimento", nenhum dos dois com `requiredPlans`),
  // e TODAS as cinco nas duas vezes: "MyBank" nao declara
  // `requiredPlans` nenhum (Decisao 5 da HMO-368 -- quem tem conta de
  // investimento tem MyBank), entao ele entra no menu de todo plano, inclusive
  // de quem ainda nao carregou a assinatura. Se um dia alguem gatear a tela, sao
  // estes cinco numeros que deixam de fechar -- e nao um comentario.
  assert.equal(menu({ plano: "admin", papel: false }).length, 29);
  assert.equal(menu({ plano: "trader", papel: false }).length, 28);
  assert.equal(menu({ plano: "invest", papel: false }).length, 27);
  assert.equal(menu({ plano: "free", papel: false }).length, 27);
  // Sem assinatura carregada ninguem ve item restrito. E o estado dos primeiros
  // quadros, e o menu dele e o do `free`.
  assert.equal(menu({ plano: undefined, papel: false }).length, 27);

  // A CONTAGEM NAO DIZ QUAIS. Trocar uma tela restrita pela outra -- Trading
  // exigindo so `admin` e Admin passando a aceitar `trader` -- manteria os
  // cinco numeros acima de pe. Entao a visibilidade das duas telas restritas
  // vai item por item, plano por plano.
  //
  // E a tabela e COMPLETA de proposito: os quatro planos de `UserPlan` mais o
  // `undefined`, vezes as duas rotas. Um `requiredPlans` alargado por acidente
  // (um `"free"` que entrasse na lista do Trading) nao tem por onde escapar.
  const visibilidade = {
    admin: { "/dashboard/admin": true, "/dashboard/trading": true },
    // A LINHA DESTA ISSUE: quem paga o plano `trader` VE a tela de Trading, e
    // continua sem ver a de Admin -- honrar `requiredPlans` inteiro nao e
    // afrouxar o filtro, e le-lo.
    trader: { "/dashboard/admin": false, "/dashboard/trading": true },
    invest: { "/dashboard/admin": false, "/dashboard/trading": false },
    free: { "/dashboard/admin": false, "/dashboard/trading": false },
    undefined: { "/dashboard/admin": false, "/dashboard/trading": false },
  };

  for (const [nome, esperado] of Object.entries(visibilidade)) {
    const plano = nome === "undefined" ? undefined : nome;
    const rotas = hrefs(menu({ plano, papel: false }));
    for (const [restrita, deveriaVer] of Object.entries(esperado)) {
      assert.equal(
        rotas.includes(restrita),
        deveriaVer,
        `plano ${nome}: ${restrita} deveria ${deveriaVer ? "" : "NAO "}aparecer`
      );
    }
  }

  // E A PREMISSA DA TABELA, explicita: estas sao as UNICAS duas telas restritas
  // do menu, e os `requiredPlans` delas sao estes. Sem este par, o dia em que
  // uma terceira tela ganhasse `requiredPlans` a tabela acima continuaria
  // verde sem nunca ter olhado para ela -- e as contagens mudariam junto,
  // pedindo so que alguem reescrevesse os numeros.
  const restritos = navigation.filter((item) => item.requiredPlans);
  assert.deepEqual(
    restritos.map((item) => [item.href, [...item.requiredPlans]]),
    [
      ["/dashboard/trading", ["trader", "admin"]],
      ["/dashboard/admin", ["admin"]],
    ]
  );
});

test("ligado, o menu reduzido e o MESMO para qualquer plano", () => {
  // O modo nao e um plano: ligar o modo tem de dar a mesma lista para `admin`,
  // `free` e para quem ainda nao carregou a assinatura -- que e o estado dos
  // primeiros quadros.
  //
  // E NAO E POR ACIDENTE, e por `podeVerItem`. Ele esconde unicamente item que
  // DECLARA `requiredPlans` sem o plano de quem olha, e nenhuma das tres telas
  // do modo declara `requiredPlans` -- e o laco abaixo, mais a premissa
  // explicita depois dele, e quem amarra isso.
  const esperado = hrefs(menu({ plano: "admin", papel: true }));
  for (const plano of ["free", "invest", "trader", undefined]) {
    assert.deepEqual(hrefs(menu({ plano, papel: true })), esperado);
  }

  // A PREMISSA, explicita em vez de so na prosa: nenhuma das tres declara
  // `requiredPlans`. Sem ela o laco acima ficaria verde tambem no dia em que
  // uma das tres saisse do menu por outro motivo -- cinco listas iguais de
  // duas rotas passam igual.
  const noModo = menu({ plano: "admin", papel: true });
  assert.equal(noModo.length, 3);
  for (const item of noModo) {
    assert.equal(
      item.requiredPlans,
      undefined,
      `${item.name} declara requiredPlans e o menu do modo passaria a variar com o plano`
    );
  }

  // E `requiredFeature` NAO E FILTRO DE VISIBILIDADE -- a premissa que a
  // HMO-299 trouxe para esta suite e que a HMO-466 nao pode perder de vista so
  // porque "Grupos" saiu do modo. Ele alimenta o `isPremiumButNoAccess` do
  // `Sidebar`, que pinta o selo premium no item; quem decide se o item APARECE
  // e so o `podeVerItem`.
  //
  // Com "Grupos" fora do menu reduzido, o lugar onde isso ainda se MEDE e o
  // menu DESLIGADO: ele declara `requiredFeature: "expense_groups"`, nao
  // declara `requiredPlans`, e aparece para TODO plano. Se alguem fizer
  // `podeVerItem` olhar `requiredFeature`, as contagens do caso anterior
  // desabam -- e este par diz, na mensagem de erro, por que.
  const completo = menu({ plano: "admin", papel: false });
  const grupos = completo.find(
    (item) => item.href === "/dashboard/expense-groups"
  );
  assert.ok(grupos, "Grupos deveria continuar no menu DESLIGADO");
  assert.equal(grupos.requiredFeature, "expense_groups");
  assert.equal(grupos.requiredPlans, undefined);
  for (const plano of ["free", "invest", "trader", undefined]) {
    assert.ok(
      hrefs(menu({ plano, papel: false })).includes("/dashboard/expense-groups"),
      `plano ${plano}: Grupos deveria aparecer no menu desligado -- requiredFeature nao esconde item`
    );
  }
});

// ---------------------------------------------------------------------------
// A fiacao: o Sidebar CHAMA o filtro
// ---------------------------------------------------------------------------

/**
 * Tira comentarios de linha e de bloco. Nao e um parser -- e o suficiente para
 * o uso aqui, e o caso abaixo tem controle nos DOIS sentidos justamente porque
 * um strip de comentario erra para os dois lados: apagando codigo de verdade
 * (uma `//` dentro de string) ou deixando passar comentario.
 */
function semComentarios(fonte) {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("o Sidebar CHAMA filtrarMenuDoPapel -- nao so importa", () => {
  // Por que este caso existe: `tsconfig.json` nao liga `noUnusedLocals`, entao
  // apagar a CHAMADA e deixar o import nao e erro de tsc nem de lint. O menu
  // voltaria a ter 29 telas no modo ligado e TODOS os casos acima continuariam
  // verdes -- eles medem a composicao, nao o componente.
  //
  // Por isso a ancora e o CALL SITE, com os comentarios fora: uma assercao
  // sobre o import casaria com a linha de import, e uma assercao sobre o texto
  // cru casaria com um comentario que mencionasse o nome da funcao.
  const cru = readFileSync(join("components", "Sidebar.tsx"), "utf8");
  const codigo = semComentarios(cru);

  // CONTROLE NOS DOIS SENTIDOS, antes da assercao de verdade.
  //
  // (a) o strip nao comeu codigo: um token que so existe em codigo sobreviveu.
  //     Era `filteredNavigation.map(` ate a HMO-423, quando o `Sidebar` passou
  //     a percorrer `entradasDoMenu` -- telas soltas e grupos -- em vez de uma
  //     lista plana de itens.
  assert.match(codigo, /entradasDoMenu\.map\(/);
  // (b) o strip funcionou: uma frase que so existe em comentario SUMIU, e
  //     estava no texto cru. Sem este par, um `semComentarios` que devolvesse a
  //     fonte intacta (ou vazia) passaria a assercao de baixo sem sentido.
  const soEmComentario = "do que o plano permite, o que o modo mantem";
  assert.ok(cru.includes(soEmComentario), "a frase-controle saiu do Sidebar");
  assert.ok(!codigo.includes(soEmComentario), "o strip de comentario nao agiu");

  // A assercao: a chamada existe, e o argumento do modo e o `papel` do hook --
  // nao um `true`/`false` chumbado, que deixaria o interruptor sem efeito.
  assert.match(codigo, /filtrarMenuDoPapel\(/);
  assert.match(codigo, /\bpapel\b/);
  assert.match(codigo, /useModoPapel\(\)/);
  assert.doesNotMatch(codigo, /filtrarMenuDoPapel\([\s\S]{0,200}?(true|false)\s*\)/);

  // E o array e o filtro de plano vem dos modulos, nao de copias locais: se
  // alguem redeclarar qualquer um dos dois aqui, as duas definicoes divergem na
  // primeira renomeacao e nenhum caso acima perceberia.
  assert.doesNotMatch(codigo, /const navigation(:|\s*=)/);
  assert.doesNotMatch(codigo, /const canAccessItem/);
});

// ---------------------------------------------------------------------------
// O modo NAO bloqueia rota nenhuma
// ---------------------------------------------------------------------------

test("nenhuma tela consulta o menu reduzido -- esconder nao e bloquear", () => {
  // Esconder do menu e simplificar; devolver 404 na tela que mostra o dinheiro
  // do proprio usuario e outra coisa. Quem tiver `/dashboard/investments` nos
  // favoritos continua chegando la, com a pele de papel.
  //
  // A forma de guardar isso e pelo GRAFO DE IMPORTS: o menu reduzido e assunto
  // de menu, e so o menu pode consulta-lo. No dia em que uma pagina importar
  // `lib/menu-do-papel` -- o primeiro passo de qualquer guarda de rota,
  // redirect ou `notFound()` baseado no modo -- este caso reprova.
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

  // CONTROLE POSITIVO, primeiro: a varredura e o padrao precisam ENCONTRAR o
  // import no Sidebar. Sem isto, um erro de caminho, de regex ou de extensao
  // deixaria o caso verde por nao ter achado nada em lugar nenhum -- que e
  // exatamente a aparencia de "nenhuma pagina importa".
  const padrao = /from\s+"@\/lib\/menu-do-papel"/;
  const importam = arquivos.filter((caminho) =>
    padrao.test(readFileSync(caminho, "utf8"))
  );
  assert.deepEqual(
    importam,
    [join("components", "Sidebar.tsx")],
    "so o Sidebar pode importar o menu reduzido"
  );

  // E nenhuma pagina (`page.tsx` / `layout.tsx` sob `app/`) consulta o modo
  // papel para decidir se renderiza. O `layout.tsx` da raiz usa o modo -- ele
  // monta o provider e a pele -- entao a busca e pelo MODULO DO MENU, nao pelo
  // modo em si.
  const paginas = arquivos.filter(
    (caminho) =>
      caminho.startsWith("app") && /(page|layout|route)\.tsx?$/.test(caminho)
  );
  assert.ok(paginas.length > 20, `varredura achou poucas paginas: ${paginas.length}`);
  for (const caminho of paginas) {
    assert.ok(
      !padrao.test(readFileSync(caminho, "utf8")),
      `${caminho} nao deveria consultar o menu reduzido`
    );
  }
});
