#!/usr/bin/env node
// =====================================================
// A REGRA DO CARTAO ESTA LIGADA DE PONTA A PONTA? (HMO-265 / HMO-266)
// =====================================================
//   node scripts/check-cartao-pela-fatura.mjs
//
// POR QUE ISTO EXISTE, SE A REGRA JA TEM 15 ASSERCOES E 12 MUTANTES
// -----------------------------------------------------------------
// Porque `npm run test:realizado-do-caixa` prova a REGRA, e a regra pode estar
// perfeita e nao estar LIGADA. O defeito que sobra e de fiacao, e ele e mudo:
//
//   * o painel para de mandar `&faturaAte=` na URL -> a rota le a fatura paga
//     so ate hoje, e a fatura que vence depois de hoje e ja foi paga some do
//     Realizado do painel. Nenhum erro, nenhum campo faltando, nenhum log.
//     (Ate a fase 6 o parametro era `&cartao=fatura`, que ligava a regra; desde
//     a 072 a regra e a do relatorio pessoal inteiro e nao se pede.)
//   * a rota para de ler a fatura paga, ou de chamar
//     `realizadoComCartaoPelaFatura` -> a compra no cartao volta a contar no
//     dia em que foi feita, ou sai e nada entra no lugar. O modulo continua
//     passando em todos os testes dele, sem ninguem chamando.
//   * a rota da Previsao para de tirar as compras no cartao da agenda, ou para
//     de sintetizar a fatura aberta -> o cartao conta em dobro na Previsao, ou
//     desaparece dela. As duas metades dessa rota sao uma so mudanca.
//
// Nenhum desses quatro aparece no `tsc`: sao string de URL, chamada de funcao
// que ninguem exige, e `await res.json()` que e `any` na fronteira.
//
// DUAS COISAS SAO REMOVIDAS ANTES DA VARREDURA, E AS DUAS SAO LOAD-BEARING
// ------------------------------------------------------------------------
//   1. OS COMENTARIOS. Os arquivos abaixo EXPLICAM esta regra em prosa, e a
//      prosa cita `cartao=fatura` e os nomes das funcoes. Varrendo o fonte cru,
//      este guard passaria verde lendo os proprios comentarios que descrevem o
//      defeito -- e continuaria verde depois de alguem apagar o codigo e deixar
//      o comentario. `semComentarios` e o mesmo helper que o
//      check-embed-ambiguo usa, pela mesma razao.
//
//   2. AS DECLARACOES DE `import`. Esta foi a correcao do proprio guard: na
//      primeira versao ele exigia apenas que o nome APARECESSE no arquivo, e
//      tres das sete mutacoes do controle negativo SOBREVIVERAM -- trocar
//      `realizadoComCartaoPelaFatura(linhas)` por `linhas.slice()` deixa a
//      chamada morta e o `import` intacto, e o nome continua "aparecendo". Um
//      guard que le a lista de imports mede se a dependencia foi declarada, nao
//      se ela e usada. Com os imports fora, a unica forma de satisfazer a
//      exigencia e CHAMAR.
//
// E por isso que cada nome de funcao na lista abaixo vem com o `(`: o alvo e a
// chamada, nao a mencao.
//
// A HMO-266 ACRESCENTOU TRES EXIGENCIAS, E ELAS SAO DO MESMO TIPO
// ---------------------------------------------------------------
// A decisao da HMO-266 foi NAO estender esta regra a tela de relatorios, e o
// preco e que as duas telas divergem de proposito. A legenda que explica isso e
// tao muda quanto a fiacao acima quando deixa de existir: string que ninguem
// renderiza compila, e campo que a rota para de emitir nao da erro em lugar
// nenhum -- a tela so volta a mostrar dois numeros sem explicacao, que e o
// estado que produziu a HMO-258. As tres ultimas exigencias da lista cobrem
// isso: o campo na rota, a chamada+render na tela de relatorios, e a legenda
// gemea no painel.
//
// DESDE A FASE 6 (072, RN017.4) as duas telas pessoais contam pela fatura, e o
// par que diverge de proposito e outro: o relatorio PESSOAL (fatura) e o do
// GRUPO (compra). As tres exigencias continuam as mesmas, porque o modo de
// falha e o mesmo -- um criterio emitido sem legenda, ou uma legenda que nao le
// o criterio.
// =====================================================

import { readFileSync } from "node:fs";
import { semComentarios } from "./varredura-de-fonte.mjs";

/**
 * O fonte sem comentario e sem a lista de imports.
 *
 * O recorte dos imports e deliberadamente simples -- `import ... from "..."` e
 * `import ... from '...'`, inclusive em varias linhas -- porque e assim que os
 * quatro arquivos deste guard os escrevem. Um parser de verdade aqui seria
 * precisao sobre um problema que nao existe: se um import escapar do recorte, o
 * guard volta a ser o que era (afirma sobre a mencao), e o controle negativo em
 * .github/workflows/verificacao.yml acusa isso na hora.
 */
function semComentariosNemImports(fonte) {
  return semComentarios(fonte).replace(
    /^\s*import\s[\s\S]*?from\s*["'][^"']*["'];?\s*$/gm,
    ""
  );
}

const EXIGENCIAS = [
  {
    arquivo: "app/(dashboard)/dashboard/page.tsx",
    trechos: ["faturaAte="],
    porque:
      "o painel precisa pedir a fatura paga ATE O FIM DO PERIODO. O Realizado " +
      "dele para em hoje, e sem o parametro a fatura que vence depois de hoje e " +
      "ja foi paga sai do mes -- pagar adiantado tiraria a fatura do Resultado.",
  },
  {
    arquivo: "app/api/reports/cash-flow/route.ts",
    trechos: ['get("faturaAte")', "lerFaturasPagas(", "realizadoComCartaoPelaFatura("],
    porque:
      "a rota precisa LER a fatura paga e APLICAR a regra (RN017.4). Lendo sem " +
      "aplicar, a compra no cartao conta no dia em que foi feita; aplicando sem " +
      "ler, a compra sai e a fatura nao entra -- o cartao some do Realizado.",
  },
  {
    arquivo: "app/api/dashboard/previsao/route.ts",
    trechos: ["agendaSemCompraNoCartao(", "faturasPrevistasDaJanela("],
    porque:
      "a Previsao precisa das DUAS metades: sem o filtro, a parcela da compra " +
      "soma junto da fatura que a contem (cartao em dobro); sem a sintese, o " +
      "cartao de quem nunca fechou fatura nao entra em lado nenhum.",
  },
  {
    arquivo: "lib/realizado-do-caixa.ts",
    // `faturasPagasComoTransacoes(` desde a fase 6. Ate ali a exigencia era
    // `ehPagamentoDaFatura(`, a perna de saida do pagamento promovida a
    // despesa no dia em que o dinheiro saiu; a 072 trocou a perna pela FATURA,
    // somada das linhas de `card_invoice_paid_entries`, no mes do vencimento.
    // Ancora de guard que apodrece grita; ancora de `sed` apodrece calada
    // (HMO-339) -- e por isso as duas mudaram juntas.
    trechos: ["account:financial_accounts(account_type)", "faturasPagasComoTransacoes("],
    porque:
      "sem o embed da conta a regra nao sabe que a linha e compra no cartao, e " +
      "sem `faturasPagasComoTransacoes` a fatura PAGA nao entra no mes do " +
      "vencimento -- o cartao desaparece do Realizado (HMO-264, RN017.4).",
  },

  // -------------------------------------------------------------------------
  // A LEGENDA QUE SEPARA AS DUAS LEITURAS (HMO-266, fase 6)
  // -------------------------------------------------------------------------
  // A HMO-266 decidiu (opcao "consumo", escolhida pelo Helio) que a tela de
  // relatorios NAO adotava a regra acima, e as duas telas mostravam totais
  // diferentes para o mesmo periodo -- medidos R$ 7.545 contra R$ 3.345 na
  // fixture de 6 meses. A fase 6 (decisao D1) desfez isso: o relatorio pessoal
  // inteiro conta pela fatura, e quem continua contando pela compra e o GRUPO.
  // A legenda e a UNICA coisa que separa as duas leituras de um defeito aos
  // olhos de quem compara.
  //
  // As tres exigencias abaixo sao de fiacao, e nenhuma aparece no `tsc`:
  // `cartao` e campo de um objeto literal que ninguem tipa na saida, e as duas
  // legendas sao strings que compilam igual renderizadas ou nao. Apagar
  // qualquer uma das tres devolve o app ao estado em que a divergencia e muda --
  // que e o estado que esta issue existe para nao deixar acontecer.
  {
    arquivo: "app/api/reports/cash-flow/route.ts",
    // REGEX, e nao a string: `includes('cartao: groupId ...')` casa dentro de
    // `grao_do_cartao: groupId ...`, e a tela le `d.cartao`. Renomear o campo e
    // a forma mais plausivel de quebrar isto -- foi a mutacao que o controle
    // negativo da HMO-266 rodou primeiro, e ela passou VERDE na primeira versao
    // desta exigencia. O `[^\w.]` exige que o nome comece aqui.
    //
    // A CONDICIONAL INTEIRA desde a fase 6: o relatorio pessoal conta pela
    // fatura e o do grupo pela compra, nos dois ramos da rota, e e o `groupId`
    // que decide. Um literal cravado em qualquer dos dois lados faria uma das
    // telas afirmar o criterio da outra.
    trechos: [/[^\w.]cartao: groupId \? "compra" : "fatura"/],
    porque:
      "a rota precisa dizer qual criterio usou, com esse nome de campo, e pela " +
      "mesma condicao que o decide: `fatura` no relatorio pessoal, `compra` no do " +
      "grupo. Sem o campo a legenda da tela de relatorios nao tem de onde sair -- " +
      "ela passaria a SUPOR o criterio, que e o mesmo que nao ter legenda.",
  },
  {
    arquivo: "app/(dashboard)/dashboard/reports/page.tsx",
    trechos: ["legendaDoCartao(fluxo?.cartao)", "{legendaDoFluxo}"],
    porque:
      "a tela de relatorios precisa CHAMAR a legenda com o campo da resposta e " +
      "RENDERIZAR o resultado. Chamar sem renderizar, ou renderizar uma constante " +
      "sem olhar o campo, deixa a tela afirmando um criterio que ela nao leu. O " +
      "argumento esta na exigencia de proposito: `legendaDoCartao(\"compra\")` " +
      "compila, sempre devolve a mesma frase, e para de seguir a rota.",
  },
  {
    arquivo: "app/(dashboard)/dashboard/page.tsx",
    trechos: ["LEGENDA_DO_CARTAO.fatura"],
    porque:
      "o painel tambem explica o criterio. Uma legenda so nao resolve: quem " +
      "compara o painel pessoal com o do grupo precisa encontrar a explicacao na " +
      "tela em que estiver, nao na outra. Aqui e constante e nao o campo da resposta porque " +
      "esta tela guarda apenas `d.summary` -- e o painel e sempre pessoal, entao " +
      "o criterio dele e sempre a fatura.",
  },
];

let falhas = 0;

for (const { arquivo, trechos, porque } of EXIGENCIAS) {
  const fonte = semComentariosNemImports(readFileSync(arquivo, "utf8"));

  for (const trecho of trechos) {
    // String ou RegExp. A string e o caso comum e e literal de proposito -- o
    // alvo e a chamada `nomeDaFuncao(`, que nao precisa de regex. A regex entra
    // onde o alvo e um NOME: `includes` casa dentro de um identificador maior
    // (`grao_do_cartao` contem `cartao`), e renomear o campo e justamente a
    // forma plausivel de desligar a fiacao sem apagar nada.
    const presente =
      trecho instanceof RegExp ? trecho.test(fonte) : fonte.includes(trecho);
    if (presente) continue;
    console.error(`FALTA  ${arquivo}`);
    console.error(`       não cita \`${trecho}\` fora de comentário`);
    console.error(`       ${porque}`);
    falhas++;
  }
}

// CONTRAPESO: a lista acima nao pode virar "o nome da funcao aparece em algum
// lugar". Se `direcaoNoPainel` voltar a receber o segundo argumento que a
// HMO-265 tirou, a fatura sai da Previsao de novo -- e as quatro exigencias
// acima continuariam satisfeitas. Por isso esta ultima, que e sobre a ASSINATURA.
const realizadoEPrevisao = semComentariosNemImports(
  readFileSync("lib/realizado-e-previsao.ts", "utf8")
);

if (/export function direcaoNoPainel\([^)]*,/.test(realizadoEPrevisao)) {
  console.error("FALTA  lib/realizado-e-previsao.ts");
  console.error(
    "       `direcaoNoPainel` voltou a receber um segundo argumento: a exclusão da fatura saiu na HMO-265"
  );
  console.error(
    "       Com ela de volta, a fatura sai da Previsão e o cartão desaparece dos DOIS lados do Total esperado."
  );
  falhas++;
}

if (falhas > 0) {
  console.error(
    `\n${falhas} ponto(s) da fiação do cartão pela fatura está desligado (HMO-265/HMO-266).`
  );
  process.exit(1);
}

// A contagem sai da propria lista, e nao de um numero escrito a mao. A versao
// anterior dizia "nos quatro pontos" e continuou dizendo isso depois de a
// HMO-266 acrescentar tres exigencias -- um rotulo que mente sobre o que acabou
// de ser provado e pior do que rotulo nenhum.
const pontos = EXIGENCIAS.reduce((n, e) => n + e.trechos.length, 0);

console.log(
  `OK: a regra do cartao pela fatura esta ligada nos ${pontos} pontos, a divergencia ` +
    "com a tela de relatorios tem legenda nas duas telas, e `direcaoNoPainel` segue com um argumento."
);
