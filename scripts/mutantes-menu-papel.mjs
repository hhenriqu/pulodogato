// CONTROLE NEGATIVO de `npm run test:menu-papel` -- HMO-284, ampliado pela
// HMO-294 (as duas rotas que entraram no modo).
//
// A suite do menu reduzido e quase toda feita de contagens e de assercoes sobre
// texto-fonte, e esses dois tipos sao justamente os que passam verde sem medir
// nada. Este runner estraga o codigo de proposito, uma mudanca por vez, e exige
// que a suite REPROVE em todas. Um mutante SOBREVIVENTE e um buraco na suite.
//
// NAO RESTAURA NADA, PORQUE NAO MUTA NADA (HMO-320)
// -------------------------------------------------
// Este runner nao usava `git checkout` para restaurar -- ele restauraria a
// partir do INDICE, e num worktree compartilhado isso ja apagou trabalho nao
// commitado aqui -- e guardava o original em memoria para reescrever o arquivo
// no fim de cada volta. Restaurar em memoria e melhor que `git checkout`, mas
// continua sendo restaurar: `process.on("exit")` NAO roda em SIGTERM, o sinal
// que o `timeout` do shell e o cancelamento de job mandam, e o processo morto no
// meio deixava o mutante gravado em `components/Sidebar.tsx`.
//
// Com `criarBlocoDeMutantes` nao ha o que restaurar: a mutacao e escrita numa
// SOMBRA em diretorio temporario e os tres arquivos do repositorio nunca sao
// tocados. Os tres mutam em arquivos diferentes, e a sombra aceita os tres pelo
// mesmo caminho relativo que eles tem aqui.
//
// E A COMPILACAO E UMA SO para todas as voltas, em vez de um `npm run
// test:menu-papel` inteiro por mutante: a sombra e montada uma vez e o AST de
// tudo que nao e o arquivo mutado e reaproveitado. O pipeline vem do proprio
// alvo `test:menu-papel` no package.json -- que tem DOIS passos de
// `resolve-aliases`, um para `components` e um para `lib`, e nenhum runner
// repetindo a receita a mao fica em pe com isso por muito tempo.
//
// Cada mutante continua sendo conferido antes de rodar: um `replace` que nao
// casa com nada nao muda o texto e a suite passaria -- o que se le como "mutante
// sobreviveu", quando na verdade o mutante nunca existiu.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const SIDEBAR = "components/Sidebar.tsx";
const FILTRO = "lib/menu-do-papel.ts";
const NAVEGACAO = "components/navegacao-do-menu.ts";
const SUITE = "test:menu-papel";

const mutantes = [
  {
    nome: "o modo nao esconde nada (filtro ignora `papel`)",
    arquivo: FILTRO,
    de: "  if (!papel) return itens;",
    para: "  if (!papel) return itens;\n  return itens;",
  },
  {
    nome: "o modo esconde ao contrario (`noMenuDoPapel` invertido)",
    arquivo: FILTRO,
    de: "  return ROTAS_DO_MENU_DE_PAPEL.includes(href);",
    para: "  return !ROTAS_DO_MENU_DE_PAPEL.includes(href);",
  },
  {
    nome: "uma 8a rota entra no modo sem ninguem pedir",
    arquivo: FILTRO,
    de: '  "/dashboard/cartoes",',
    para: '  "/dashboard/cartoes",\n  "/dashboard/investments",',
  },
  {
    nome: "uma das 7 rotas sai do modo",
    arquivo: FILTRO,
    de: '  "/dashboard/contas",\n',
    para: "",
  },
  {
    nome: "uma das 7 rotas vira outra tela (so o `href` muda)",
    arquivo: FILTRO,
    de: '  "/dashboard/contas",',
    para: '  "/dashboard/transferencias",',
  },
  {
    // AS DUAS ROTAS DA HMO-294, uma por uma. Tira-las juntas seria um mutante
    // so, e o mais provavel dos dois defeitos e esquecer UMA -- `settings` e a
    // que importa mais, porque e a tela do espelho do interruptor: sem ela, a
    // unica saida do modo volta a ser o papelzinho do cabecalho.
    nome: "Configuracoes sai do modo (o espelho do interruptor fica inalcancavel)",
    arquivo: FILTRO,
    de: '  "/dashboard/settings",\n',
    para: "",
  },
  {
    nome: "Perfil sai do modo",
    arquivo: FILTRO,
    de: '  "/dashboard/profile",\n',
    para: "",
  },
  {
    // A VIZINHA DE ARRAY. `/dashboard/connections` ("Conexões") esta a dois
    // itens de `/dashboard/settings` no array de navegacao, e trocar uma pela
    // outra mantem a CONTAGEM em 7 -- este mutante morre no caso que confere
    // pelo NOME, e so nele. E a razao de aquele caso existir.
    nome: "Conexoes entra no lugar de Configuracoes (a contagem continua 7)",
    arquivo: FILTRO,
    de: '"/dashboard/settings"',
    para: '"/dashboard/connections"',
  },
  {
    nome: "um 28o item entra no menu sem passar pelo modo",
    arquivo: NAVEGACAO,
    de: "export const navigation: NavigationItem[] = [\n",
    para:
      "export const navigation: NavigationItem[] = [\n" +
      '  { name: "Novidade", href: "/dashboard/novidade", icon: Settings },\n',
  },
  {
    nome: "o filtro de plano para de filtrar",
    arquivo: NAVEGACAO,
    de: '    return plano === "admin";',
    para: "    return true;",
  },
  {
    // O mutante central da fiacao: tirar a CHAMADA e deixar o import. Nao e
    // erro de tsc (`noUnusedLocals` esta desligado) nem de lint, e sem o caso
    // "o Sidebar CHAMA filtrarMenuDoPapel" ele sobreviveria com a suite
    // inteira verde -- o menu voltando a 27 itens no modo ligado.
    nome: "o Sidebar importa o filtro mas NAO o chama",
    arquivo: SIDEBAR,
    de: "  const filteredNavigation = filtrarMenuDoPapel(\n    navigation.filter((item) => podeVerItem(item, subscription?.plan)),\n    papel\n  );",
    para:
      "  const filteredNavigation = navigation.filter((item) =>\n" +
      "    podeVerItem(item, subscription?.plan)\n  );",
  },
  {
    nome: "o Sidebar chumba o modo em `false` (interruptor sem efeito)",
    arquivo: SIDEBAR,
    de: "    papel\n  );",
    para: "    false\n  );",
  },
];

/**
 * SOBREVIVENTES ESPERADOS: mutantes que a suite tem de deixar PASSAR.
 *
 * Um runner que so cobra vermelho mede metade. A lista de rotas afirma, no
 * comentario dela, que a ordem escrita ali NAO e a ordem do menu -- quem ordena
 * e o array de navegacao, que continua sendo percorrido na ordem dele. Se um
 * dia alguem "consertar" o filtro para ordenar pela lista de rotas, a suite
 * passaria a prender a coisa errada e NADA reclamaria; e este bloco que
 * reclama.
 */
const sobreviventesEsperados = [
  {
    nome: "a ordem DENTRO de ROTAS_DO_MENU_DE_PAPEL nao e a ordem do menu",
    arquivo: FILTRO,
    de: '  "/dashboard",\n  "/dashboard/receitas",',
    para: '  "/dashboard/receitas",\n  "/dashboard",',
  },
];

const original = new Map();
for (const arquivo of new Set(
  [...mutantes, ...sobreviventesEsperados].map((m) => m.arquivo)
)) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

const bloco = criarBlocoDeMutantes({ rotulo: "menu-papel", suites: [SUITE] });
// A sombra vive em diretorio temporario e sai junto com o processo -- inclusive
// nas saidas antecipadas abaixo. No pior caso (SIGTERM) sobra um diretorio orfao
// em /tmp; o que NAO sobra, e era o problema, e mutante nos tres arquivos.
process.on("exit", () => bloco.fechar());

/** `true` se a suite PASSA com estas sobrescritas (`{}` = arvore intacta). */
const roda = (nome, sobrescritas = {}) => bloco.rodar(nome, sobrescritas, SUITE).verde;

// CONTROLE POSITIVO: sem mutante, a suite tem de PASSAR. Se ela estiver
// vermelha por outro motivo, todo mutante "morre" e o placar fecha 100% sem
// medir nada. Ele roda pelo MESMO aparelho que os mutantes (a mesma sombra, a
// mesma compilacao, o mesmo `node --test`) -- e por isso ele pega erro no
// aparelho, e nao so na suite.
console.log("controle positivo (codigo intacto): a suite deve PASSAR");
if (!roda("controle")) {
  console.error("  REPROVOU -- conserte a suite antes de medir mutante");
  process.exit(1);
}
console.log("  ok, passou\n");

let sobreviventes = 0;
for (const m of mutantes) {
  const antes = original.get(m.arquivo);
  if (!antes.includes(m.de)) {
    console.error(`SOBREVIVEU (ancora nao casou) :: ${m.nome}`);
    console.error(`  o texto buscado nao existe em ${m.arquivo}`);
    sobreviventes++;
    continue;
  }
  const depois = antes.replace(m.de, m.para);
  if (depois === antes) {
    console.error(`SOBREVIVEU (replace nao mudou nada) :: ${m.nome}`);
    sobreviventes++;
    continue;
  }
  const passou = roda(m.nome, { [m.arquivo]: depois });
  if (passou) {
    console.error(`SOBREVIVEU :: ${m.nome}`);
    sobreviventes++;
  } else {
    console.log(`morreu     :: ${m.nome}`);
  }
}

let esperadosQueMorreram = 0;
if (sobreviventesEsperados.length > 0) {
  console.log("\nsobreviventes ESPERADOS (a suite deve deixar passar)");
  for (const m of sobreviventesEsperados) {
    const antes = original.get(m.arquivo);
    if (!antes.includes(m.de)) {
      console.error(`  ANCORA NAO CASOU :: ${m.nome}`);
      console.error(`    o texto buscado nao existe em ${m.arquivo}`);
      esperadosQueMorreram++;
      continue;
    }
    const passou = roda(m.nome, { [m.arquivo]: antes.replace(m.de, m.para) });
    if (passou) {
      console.log(`  ok, sobreviveu :: ${m.nome}`);
    } else {
      console.error(`  REPROVOU :: ${m.nome}`);
      console.error("    a suite esta prendendo a ordem da LISTA DE ROTAS, e");
      console.error("    quem ordena o menu e o array de navegacao.");
      esperadosQueMorreram++;
    }
  }
}

console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mortos`);
process.exit(sobreviventes === 0 && esperadosQueMorreram === 0 ? 0 : 1);
