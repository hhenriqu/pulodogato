#!/usr/bin/env node
// =====================================================
// A REGRA DO CARTAO ESTA LIGADA DE PONTA A PONTA? (HMO-265)
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
    trechos: ["account:financial_accounts(account_type)", "ehFatura("],
    porque:
      "sem o embed da conta a regra nao sabe que a linha esta na fatura, e sem " +
      "`ehFatura` toda transferencia entre contas proprias vira despesa do mes.",
  },
];

let falhas = 0;

for (const { arquivo, trechos, porque } of EXIGENCIAS) {
  const fonte = semComentariosNemImports(readFileSync(arquivo, "utf8"));

  for (const trecho of trechos) {
    if (fonte.includes(trecho)) continue;
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
    `\n${falhas} ponto(s) da fiação do cartão pela fatura está desligado (HMO-265).`
  );
  process.exit(1);
}

console.log(
  "OK: a regra do cartao pela fatura esta ligada nos quatro pontos, e `direcaoNoPainel` segue com um argumento."
);
