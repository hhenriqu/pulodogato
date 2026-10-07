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
//   * o painel para de mandar `&cartao=fatura` na URL -> a rota responde 200
//     com o numero da regra ANTIGA. Nenhum erro, nenhum campo faltando, nenhum
//     log: o painel volta ao defeito desta issue com os 12 mutantes verdes.
//   * a rota para de chamar `realizadoComCartaoPelaFatura` -> idem. O modulo
//     continua passando em todos os testes dele, sem ninguem chamando.
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
    trechos: ["cartao=fatura"],
    porque:
      "o painel precisa PEDIR a regra nova. Sem o parametro, /api/reports/cash-flow " +
      "responde 200 com o total da regra antiga -- o cartao contado no dia da compra.",
  },
  {
    arquivo: "app/api/reports/cash-flow/route.ts",
    trechos: ['get("cartao")', "realizadoComCartaoPelaFatura("],
    porque:
      "a rota precisa LER o parametro e APLICAR a regra. Lendo sem aplicar, ou " +
      "aplicando sem ler, o total e o de antes desta issue.",
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
    // `ehPagamentoDaFatura(`, e nao `ehFatura(`: a HMO-317 deu um DONO SO ao
    // criterio da perna de saida, em lib/telas-de-movimentacao.ts, e apagou
    // deste arquivo a leitura local de `notes` por `ehFatura`. A exigencia
    // ficou apontando para o nome antigo, e desde o merge da #211 este guard
    // estava VERMELHO na main -- ninguem viu porque o Actions nao iniciava job
    // (HMO-242). Ancora de guard que apodrece grita; ancora de `sed` apodrece
    // calada (HMO-339).
    trechos: ["account:financial_accounts(account_type)", "ehPagamentoDaFatura("],
    porque:
      "sem o embed da conta a regra nao sabe que a linha esta na fatura, e sem " +
      "`ehPagamentoDaFatura` a fatura PAGA nao vira despesa do mes em que o " +
      "dinheiro saiu -- o cartao desaparece dos dois lados (HMO-264).",
  },

  // -------------------------------------------------------------------------
  // A LEGENDA QUE SEPARA AS DUAS LEITURAS (HMO-266)
  // -------------------------------------------------------------------------
  // A HMO-266 decidiu (opcao "consumo", escolhida pelo Helio) que a tela de
  // relatorios NAO adota a regra acima: ela responde "no que o dinheiro foi
  // gasto" e o painel responde "quando o dinheiro saiu". O preco disso e que as
  // duas telas mostram totais diferentes para o mesmo periodo -- medidos
  // R$ 7.545 contra R$ 3.345 na fixture de 6 meses -- e a legenda e a UNICA
  // coisa que separa isso de um defeito aos olhos de quem compara.
  //
  // As tres exigencias abaixo sao de fiacao, e nenhuma aparece no `tsc`:
  // `cartao` e campo de um objeto literal que ninguem tipa na saida, e as duas
  // legendas sao strings que compilam igual renderizadas ou nao. Apagar
  // qualquer uma das tres devolve o app ao estado em que a divergencia e muda --
  // que e o estado que esta issue existe para nao deixar acontecer.
  {
    arquivo: "app/api/reports/cash-flow/route.ts",
    // REGEX, e nao a string: `includes('cartao: "compra"')` casa dentro de
    // `grao_do_cartao: "compra"`, e a tela le `d.cartao`. Renomear o campo e a
    // forma mais plausivel de quebrar isto -- foi a mutacao que o controle
    // negativo desta issue rodou primeiro, e ela passou VERDE na primeira
    // versao desta exigencia. O `[^\w.]` exige que o nome comece aqui.
    trechos: [/[^\w.]cartao: "compra"/],
    porque:
      "o ramo MENSAL da rota precisa dizer qual criterio usou, com esse nome de " +
      "campo. Ele e o ramo que " +
      "a tela de relatorios consome (`?months=N`), e sem o campo a legenda de la " +
      "nao tem de onde sair -- ela passaria a SUPOR o criterio, que e o mesmo que " +
      "nao ter legenda. O ramo de intervalo ja emitia o campo desde a HMO-265; " +
      "este literal e o do ramo mensal, onde `cartao=fatura` e inalcancavel.",
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
      "o painel e a OUTRA metade do par. Uma legenda so nao resolve: quem ve " +
      "R$ 3.345 aqui e R$ 7.545 la precisa encontrar a explicacao na tela em que " +
      "estiver, nao na outra. Aqui e constante e nao o campo da resposta porque " +
      "esta tela guarda apenas `d.summary` -- o que garante o criterio e o " +
      "`cartao=fatura` da primeira exigencia deste guard.",
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
