// O MENU REDUZIDO do modo papel de pao -- HMO-284 (plano da HMO-279).
//
// O QUE ESTA SUITE PROVA
// ----------------------
// Com o modo ligado o menu tem EXATAMENTE 5 rotas; desligado, EXATAMENTE 27.
//
// O "exatamente" (e nao "contem") e o ponto. Com `contem`, a suite fica verde
// enquanto o menu volta a crescer: o proximo item acrescentado ao array nao
// quebraria nada, e o modo reduzido voltaria a ter 6, 7, 8 itens sem ninguem
// notar. Aqui um item novo REPROVA, e quem o acrescentou tem de decidir de
// proposito se ele entra ou nao no modo.
//
// POR QUE A SUITE FIXA O PLANO
// ----------------------------
// `podeVerItem` e o PRIMEIRO filtro do menu e ele ja existia. Sem plano
// `admin`, a tela de Admin sai da lista e a contagem cai de 27 para 26 -- e a
// suite passaria a medir o PLANO em vez do MODO, variando com uma regra que
// nao e assunto desta issue. Entao o plano entra fixo em todo caso, e ha um
// caso proprio (`o plano e o OUTRO filtro`) que documenta a diferenca em vez de
// deixa-la implicita.
//
// POR QUE ELA NAO MEDE A SI MESMA
// -------------------------------
// Comparar a saida do filtro com o `ROTAS_DO_MENU_DE_PAPEL` que o alimenta
// provaria pouco: a lista estaria conferindo consigo mesma. O que torna a
// assercao real e que ela so fecha se cada uma das 5 rotas EXISTIR no array de
// 27 -- uma rota renomeada la derruba a contagem -- e que os NOMES conferidos
// (`Dashboard`, `Receitas`, ...) vem do array de navegacao, nao da lista de
// rotas. Esses nomes sao dado independente.
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

test("desligado, o menu tem EXATAMENTE 27 itens", () => {
  const itens = menu({ plano: "admin", papel: false });

  // Se este numero mudou, foi porque alguem acrescentou (ou tirou) um item do
  // array. Isso nao e um erro -- e a pergunta que esta suite existe para
  // forcar: o item novo aparece no modo papel de pao? Se sim, entre com ele em
  // `ROTAS_DO_MENU_DE_PAPEL` e no caso do menu reduzido abaixo; se nao, ajuste
  // so este 27.
  assert.equal(itens.length, 27);
  assert.equal(navigation.length, 27);
});

test("desligado, o filtro do modo devolve o MESMO array -- sem copia", () => {
  // O modo desligado e o caminho de todo mundo e nao deve custar nada. Isto
  // tambem e o que garante que nenhum item se perde pelo caminho: nao ha
  // caminho de perda, e o proprio array que volta.
  const comPlano = navigation.filter((item) => podeVerItem(item, "admin"));
  assert.equal(filtrarMenuDoPapel(comPlano, false), comPlano);
});

// ---------------------------------------------------------------------------
// Ligado: as cinco telas
// ---------------------------------------------------------------------------

test("ligado, o menu tem EXATAMENTE as 5 rotas, na ordem do menu", () => {
  const itens = menu({ plano: "admin", papel: true });

  assert.equal(itens.length, 5);
  assert.deepEqual(hrefs(itens), [
    "/dashboard",
    "/dashboard/receitas",
    "/dashboard/despesas",
    "/dashboard/contas",
    "/dashboard/cartoes",
  ]);
});

test("ligado, os 5 itens sao as telas certas -- conferido pelo NOME", () => {
  // Os nomes vem do array de navegacao, nao de `ROTAS_DO_MENU_DE_PAPEL`. E o
  // que impede este caso de ser a lista conferindo consigo mesma: uma rota
  // trocada por outra (digamos `/dashboard/transferencias` no lugar de
  // `/dashboard/contas`) passaria por qualquer assercao de CONTAGEM e por
  // qualquer assercao que so comparasse rotas com rotas -- e aqui apareceria
  // como "Transferências" onde se espera "Contas".
  assert.deepEqual(nomes(menu({ plano: "admin", papel: true })), [
    "Dashboard",
    "Receitas",
    "Despesas",
    "Contas",
    "Cartões",
  ]);
});

test("ligado, as 22 telas restantes saem do menu -- nenhuma sobra", () => {
  const dentro = new Set(hrefs(menu({ plano: "admin", papel: true })));
  const fora = hrefs(menu({ plano: "admin", papel: false })).filter(
    (href) => !dentro.has(href)
  );

  assert.equal(fora.length, 22);
  // E um controle do `noMenuDoPapel`, nao so aritmetica: cada rota escondida
  // tem de ser reprovada pelo predicado, uma por uma. Uma rota que saisse da
  // lista por outro motivo (um `href` duplicado comendo o Set, por exemplo)
  // apareceria aqui.
  for (const href of fora) {
    assert.equal(noMenuDoPapel(href), false, `${href} deveria estar escondida`);
  }
});

test("as 5 rotas do modo existem todas no array de navegacao", () => {
  // Redundante com a contagem de 5 acima, e proposital: quando alguem muda o
  // `href` de uma das cinco telas, esta e a mensagem de erro que diz QUAL rota
  // sumiu, em vez de "esperava 5, recebeu 4".
  const todas = new Set(hrefs(navigation));
  for (const rota of ROTAS_DO_MENU_DE_PAPEL) {
    assert.ok(todas.has(rota), `${rota} nao existe no menu`);
  }
});

// ---------------------------------------------------------------------------
// O modo nao e o plano
// ---------------------------------------------------------------------------

test("o plano e o OUTRO filtro: sem admin, o menu inteiro tem 25", () => {
  // Este caso existe para que o 27 lá em cima nao seja um numero misterioso. E
  // e a razao de todos os outros casos fixarem o plano.
  //
  // Sao DOIS os itens que caem, nao um: `Admin` e `Trading`. E sobre o
  // `Trading` ha um defeito ANTERIOR a esta issue, que esta suite registra em
  // vez de corrigir -- ele declara `requiredPlans: ["trader", "admin"]`, mas o
  // predicado so olha se a lista CONTEM "admin" e ai exige plano `admin`.
  // Resultado: quem paga o plano `trader` nao ve a tela de Trading no menu.
  //
  // Corrigir isso aqui mudaria o menu de quem usa o app numa issue cujo
  // assunto e outro, e mudaria a contagem que o caso de cima trava. Fica para
  // issue propria; o caso abaixo e a prova de que o comportamento de hoje e
  // este, e nao um acidente da mudanca da HMO-284 (que moveu o predicado de
  // arquivo sem tocar na regra).
  assert.equal(menu({ plano: "free", papel: false }).length, 25);
  assert.equal(menu({ plano: undefined, papel: false }).length, 25);
  assert.equal(menu({ plano: "trader", papel: false }).length, 25);

  const comAdmin = hrefs(menu({ plano: "admin", papel: false }));
  const semAdmin = hrefs(menu({ plano: "free", papel: false }));
  for (const restrita of ["/dashboard/admin", "/dashboard/trading"]) {
    assert.ok(comAdmin.includes(restrita));
    assert.ok(!semAdmin.includes(restrita));
  }

  // O defeito do `trader`, explicito: se alguem o consertar, este caso reprova
  // e aponta para o comentario acima em vez de deixar a contagem de 25 virar
  // 26 em silencio.
  assert.ok(!hrefs(menu({ plano: "trader", papel: false })).includes("/dashboard/trading"));
});

test("ligado, o menu reduzido e o MESMO para qualquer plano", () => {
  // O modo nao e um plano. Nenhuma das 5 telas e restrita, entao ligar o modo
  // tem de dar a mesma lista para `admin`, `free` e para quem ainda nao
  // carregou a assinatura -- que e o estado dos primeiros quadros.
  const esperado = hrefs(menu({ plano: "admin", papel: true }));
  for (const plano of ["free", "invest", "trader", undefined]) {
    assert.deepEqual(hrefs(menu({ plano, papel: true })), esperado);
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
  // voltaria a ter 27 itens no modo ligado e TODOS os casos acima continuariam
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
  assert.match(codigo, /filteredNavigation\.map\(/);
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
