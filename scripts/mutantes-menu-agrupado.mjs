// CONTROLE NEGATIVO de `npm run test:menu-agrupado` -- HMO-423.
//
// A suite do menu agrupado e feita de tres tipos de assercao, e os tres passam
// verde sem medir nada quando escritos com descuido: CONTAGEM sobre array
// (8 entradas, 29 telas), TABELA de casos puros (o item ativo, o aberto e
// fechado) e TEXTO-FONTE do `Sidebar` (a fiacao). Este runner estraga o codigo
// de proposito, uma mudanca por vez, e exige que a suite REPROVE em todas. Um
// mutante SOBREVIVENTE e um buraco na suite.
//
// NAO MUTA NADA NO LUGAR: a mutacao vai para uma SOMBRA em diretorio
// temporario (`criarBlocoDeMutantes`) e os dois arquivos do repositorio nunca
// sao tocados -- nem no SIGTERM, que handler nenhum pega. Ver o cabecalho de
// `scripts/check-mutacao-no-lugar.mjs`.
//
// Cada mutante e conferido antes de rodar: um `replace` que nao casa com nada
// nao muda o texto e a suite passaria -- o que se le como "mutante sobreviveu",
// quando na verdade o mutante nunca existiu.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const SIDEBAR = "components/Sidebar.tsx";
const NAVEGACAO = "components/navegacao-do-menu.ts";
const SUITE = "test:menu-agrupado";

const mutantes = [
  // ------------------------------------------------------------------------
  // A ARVORE: desagrupar, esvaziar, duplicar
  // ------------------------------------------------------------------------
  {
    // O DESFAZIMENTO DA ISSUE, inteiro: o menu volta a ser plano. Se este
    // mutante sobreviver, a suite nao esta medindo o agrupamento -- so a
    // existencia das telas, que o `test:menu-papel` ja media antes.
    nome: "o menu volta a ser plano (um grupo deixa de ser grupo)",
    arquivo: NAVEGACAO,
    de: '    nome: "Contas e Cartões",\n    icon: Wallet,\n    itens: [\n',
    para: "",
  },
  {
    nome: "um grupo nasce com UM item so (submenu que nao agrupa nada)",
    arquivo: NAVEGACAO,
    de: '        name: "Cartões",\n        href: "/dashboard/cartoes",\n        icon: CreditCard,\n      },\n',
    para: "",
  },
  {
    // A TELA PERDIDA: o risco central de agrupar 28 itens a mao. A tela
    // continua respondendo 200 e simplesmente nao tem mais como ser alcancada
    // clicando -- sem sintoma nenhum.
    nome: "uma tela cai do menu no meio do agrupamento",
    arquivo: NAVEGACAO,
    de: '        name: "Importar Extrato",\n        href: "/dashboard/statements",\n        icon: FileUp,\n        requiredFeature: "personal_finance",\n      },\n',
    para: "",
  },
  {
    nome: "a mesma tela aparece em DOIS grupos",
    arquivo: NAVEGACAO,
    de: '      {\n        name: "MyBank",\n        href: "/dashboard/mybank",\n        icon: HandCoins,\n      },',
    para:
      '      {\n        name: "MyBank",\n        href: "/dashboard/mybank",\n        icon: HandCoins,\n      },\n' +
      '      {\n        name: "MyBank (de novo)",\n        href: "/dashboard/mybank",\n        icon: HandCoins,\n      },',
  },
  {
    // O PEDIDO DA ISSUE, desfeito: a conta de investimento volta para o grupo
    // das contas do dia a dia, e o caminho deixa de ser paralelo.
    nome: "a conta de investimento sai de Investimentos",
    arquivo: NAVEGACAO,
    de: '        name: "Contas de Investimento",\n        href: "/dashboard/contas?tipo=investment",\n        icon: Coins,\n      },\n',
    para: "",
  },
  {
    // A QUERY QUE A TELA NAO LE. Nao da erro nenhum: o item do menu passa a
    // apontar para a tela INTEIRA de Contas, com o titulo "Contas" e as oito
    // contas, e nada reclama. E o mutante que o caso de fiacao com
    // `tipoDoRecorte` existe para matar.
    nome: "o href do recorte vira uma query que a tela nao sabe ler",
    arquivo: NAVEGACAO,
    de: 'href: "/dashboard/contas?tipo=investment",',
    para: 'href: "/dashboard/contas?tipo=investments",',
  },
  {
    nome: "o grupo passa a declarar requiredPlans (segundo lugar que esconde tela)",
    arquivo: NAVEGACAO,
    de: '    nome: "Ferramentas",\n    icon: Calculator,',
    para: '    nome: "Ferramentas",\n    icon: Calculator,\n    requiredPlans: ["admin"],',
  },

  // ------------------------------------------------------------------------
  // O FILTRO DE PLANO SOBRE A ARVORE
  // ------------------------------------------------------------------------
  {
    nome: "o filtro de plano nao entra nos grupos (item restrito aparece para todos)",
    arquivo: NAVEGACAO,
    de: "    const itens = entrada.itens.filter((item) => podeVerItem(item, plano));",
    para: "    const itens = entrada.itens;",
  },
  {
    nome: "grupo vazio NAO desaparece (submenu que abre vazio)",
    arquivo: NAVEGACAO,
    de: "    if (itens.length > 0) visiveis.push({ ...entrada, itens });",
    para: "    visiveis.push({ ...entrada, itens });",
  },
  {
    nome: "a entrada SOLTA escapa do filtro de plano",
    arquivo: NAVEGACAO,
    de: "      if (podeVerItem(entrada, plano)) visiveis.push(entrada);",
    para: "      visiveis.push(entrada);",
  },
  {
    // O FILTRO QUE MUTA A ARVORE. `grupo.itens = itens` em vez de
    // `{...entrada, itens}`: o menu de quem e `free` apagaria "Trading" do
    // modulo para o resto da sessao, e um `admin` que trocasse de aba veria o
    // menu do `free`. Acontece uma vez e nunca mais, que e o pior tipo.
    nome: "o filtro escreve na arvore original",
    arquivo: NAVEGACAO,
    de: "    if (itens.length > 0) visiveis.push({ ...entrada, itens });",
    para: "    entrada.itens = itens;\n    if (itens.length > 0) visiveis.push(entrada);",
  },

  // ------------------------------------------------------------------------
  // O ITEM ATIVO
  // ------------------------------------------------------------------------
  {
    // O DEFEITO QUE A HMO-423 CONSERTOU, de volta: prefixo sem peso, e
    // "Dashboard" acende em toda tela do app.
    nome: "o item ativo volta a ser o PRIMEIRO que casa, nao o mais especifico",
    arquivo: NAVEGACAO,
    de: "    const peso = rota.length + (query ? 1000 : 0);",
    para: "    const peso = 0;",
  },
  {
    nome: "a query deixa de valer mais que o caminho (Contas ganha do recorte)",
    arquivo: NAVEGACAO,
    de: "    const peso = rota.length + (query ? 1000 : 0);",
    para: "    const peso = rota.length;",
  },
  {
    nome: "a query do href para de ser exigida (o recorte acende em Contas)",
    arquivo: NAVEGACAO,
    de: "      if (atual.get(chave) !== valor) casa = false;",
    para: "      if (false) casa = false;",
  },
  {
    nome: "o casamento de caminho vira prefixo CRU (/dashboardzinho acende)",
    arquivo: NAVEGACAO,
    de: '    if (caminho !== rota && !caminho.startsWith(rota + "/")) continue;',
    para: "    if (!caminho.startsWith(rota)) continue;",
  },
  {
    nome: "tela filha para de acender o item do pai",
    arquivo: NAVEGACAO,
    de: '    if (caminho !== rota && !caminho.startsWith(rota + "/")) continue;',
    para: "    if (caminho !== rota) continue;",
  },

  // ------------------------------------------------------------------------
  // ABERTO OU FECHADO
  // ------------------------------------------------------------------------
  {
    nome: "o grupo da tela atual NAO abre sozinho",
    arquivo: NAVEGACAO,
    de: "  return grupo.itens.some((item) => item.href === hrefAtivo);",
    para: "  return false;",
  },
  {
    nome: "TODO grupo abre quando qualquer tela esta ativa",
    arquivo: NAVEGACAO,
    de: "  return grupo.itens.some((item) => item.href === hrefAtivo);",
    para: "  return hrefAtivo !== null;",
  },
  {
    // O LADO QUE ERRA: `??` sobre booleano le o `false` do usuario como
    // "nao respondeu", e o grupo da tela atual reabre no quadro seguinte -- o
    // submenu que nao fecha.
    nome: "fechar a mao o grupo da tela nao funciona (`??` em vez de undefined)",
    arquivo: NAVEGACAO,
    de: "  const mexido = mexidos[grupo.nome];\n  if (mexido !== undefined) return mexido;",
    para: "  const mexido = mexidos[grupo.nome];\n  if (mexido) return mexido;",
  },
  {
    nome: "o mapa de mexidos e ignorado (o grupo nunca abre no clique)",
    arquivo: NAVEGACAO,
    de: "  const mexido = mexidos[grupo.nome];",
    para: "  const mexido = undefined;",
  },

  // ------------------------------------------------------------------------
  // A FIACAO NO SIDEBAR
  // ------------------------------------------------------------------------
  {
    // O MUTANTE CENTRAL DA FIACAO DO CLIQUE: o rotulo do grupo deixa de
    // alternar. Nao e erro de tsc nem de lint, e o menu fica com seis grupos
    // que so abrem quando a tela atual mora dentro deles. E o que o cabecalho
    // da suite aponta como a razao de nao haver sonda de navegador aqui.
    nome: "o rotulo do grupo nao alterna nada",
    arquivo: SIDEBAR,
    de: "            onClick={() => alternarGrupo(entrada)}",
    para: "            onClick={() => undefined}",
  },
  {
    nome: "o Sidebar chumba o grupo em ABERTO (o submenu nao fecha)",
    arquivo: SIDEBAR,
    de: "  const estaAberto = (grupo: GrupoDeMenu) =>\n    grupoAberto(grupo, gruposMexidos, hrefAtivo);",
    para: "  const estaAberto = (grupo: GrupoDeMenu) => true;",
  },
  {
    nome: "o alternar le o mapa da renderizacao, nao o do atualizador",
    arquivo: SIDEBAR,
    de: "      [grupo.nome]: !grupoAberto(grupo, mexidos, hrefAtivo),",
    para: "      [grupo.nome]: !grupoAberto(grupo, gruposMexidos, hrefAtivo),",
  },
  {
    // O RETROCESSO DO ITEM ATIVO, no componente: volta o teste de prefixo que
    // acendia "Dashboard" em toda tela e acenderia "Contas" junto com o
    // recorte. O `href` com query nunca casa por igualdade de `pathname`, entao
    // o item novo simplesmente nunca acende.
    nome: "o Sidebar volta a decidir o ativo com startsWith no pathname",
    arquivo: SIDEBAR,
    de: "    const ativo = item.href === hrefAtivo;",
    para:
      "    const ativo =\n" +
      '      pathname === item.href || pathname.startsWith(item.href + "/");',
  },
  {
    nome: "o Sidebar para de ler a query (o recorte nunca acende)",
    arquivo: SIDEBAR,
    de: "  const busca = useSearchParams().toString();",
    para: '  const busca = "";',
  },
  {
    nome: "o submenu fechado continua no DOM, so escondido",
    arquivo: SIDEBAR,
    de: "          {aberto && (\n            <div id={idDoSubmenu} className=\"mt-1 space-y-1\">",
    para: "          {true && (\n            <div id={idDoSubmenu} hidden={!aberto} className=\"mt-1 space-y-1\">",
  },
  {
    nome: "o Sidebar deixa de pintar grupo (percorre so as telas soltas)",
    arquivo: SIDEBAR,
    de: "      if (!ehGrupo(entrada)) {\n        return linhaDoItem(entrada, { aoClicar: aoNavegar });\n      }",
    para: "      if (true) {\n        return null;\n      }",
  },
];

/**
 * SOBREVIVENTES ESPERADOS: mutantes que a suite tem de deixar PASSAR.
 *
 * Um runner que so cobra vermelho mede metade. Os dois abaixo sao escolhas de
 * APRESENTACAO que a suite afirma NAO prender -- se um dia ela comecar a
 * reprovar aqui, ela passou a travar a decoracao do menu em vez do conteudo
 * dele, e e este bloco que reclama.
 */
const sobreviventesEsperados = [
  {
    nome: "o icone do grupo e outro (a suite nao prende icone)",
    arquivo: NAVEGACAO,
    de: '    nome: "Planejamento",\n    icon: CalendarClock,',
    para: '    nome: "Planejamento",\n    icon: Wallet,',
  },
  {
    nome: "o recuo do item dentro do grupo muda (a suite nao prende classe)",
    arquivo: SIDEBAR,
    de: '          recuado ? "pl-9 pr-3" : "px-3"',
    para: '          recuado ? "pl-6 pr-3" : "px-3"',
  },
];

const original = new Map();
for (const arquivo of new Set(
  [...mutantes, ...sobreviventesEsperados].map((m) => m.arquivo)
)) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

const bloco = criarBlocoDeMutantes({ rotulo: "menu-agrupado", suites: [SUITE] });
// A sombra vive em diretorio temporario e sai junto com o processo -- inclusive
// nas saidas antecipadas abaixo.
process.on("exit", () => bloco.fechar());

/** `true` se a suite PASSA com estas sobrescritas (`{}` = arvore intacta). */
const roda = (nome, sobrescritas = {}) =>
  bloco.rodar(nome, sobrescritas, SUITE).verde;

// CONTROLE POSITIVO: sem mutante, a suite tem de PASSAR. Se ela estiver
// vermelha por outro motivo, todo mutante "morre" e o placar fecha 100% sem
// medir nada. Ele roda pelo MESMO aparelho que os mutantes (a mesma sombra, a
// mesma compilacao, o mesmo `node --test`).
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
      console.error("    a suite esta prendendo APRESENTACAO (icone, classe) e");
      console.error("    nao o conteudo do menu.");
      esperadosQueMorreram++;
    }
  }
}

console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mortos`);
process.exit(sobreviventes === 0 && esperadosQueMorreram === 0 ? 0 : 1);
