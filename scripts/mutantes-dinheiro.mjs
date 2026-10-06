#!/usr/bin/env node
// =====================================================
// CONTROLE NEGATIVO DA SUITE DE DINHEIRO (HMO-171)
// =====================================================
// Planta, um por vez, defeitos reais em lib/dinheiro.ts e exige que
// `npm run test:dinheiro` fique VERMELHO em cada um. Uma verificacao que nunca
// viu vermelho nao e verificacao: as asercoes daquela suite sao quase todas
// igualdades de string, e igualdade de string continua verde quando o codigo
// vira outra coisa por baixo -- desde que a outra coisa produza o mesmo texto
// nos exemplos escolhidos.
//
// POR QUE ISTO E UM SCRIPT, E NAO UM BLOCO `run:` NO WORKFLOW
// -----------------------------------------------------------
// Comecou como `sed -i` dentro do YAML e o desenho estava errado por um motivo
// que apareceu na primeira refatoracao: quando o codigo muda de forma, o padrao
// do `sed` deixa de casar e o `sed` NAO RECLAMA -- ele sai 0 sem ter mudado
// nada. O arquivo fica intacto, a suite passa (claro: nao ha defeito), e o
// passo acusa "verde com o defeito plantado". O CI fica vermelho pelo motivo
// errado, e quem for consertar vai procurar um bug na mascara que nao existe.
//
// Aqui cada mutante DECLARA o texto que espera encontrar, e a ausencia desse
// texto e um erro proprio, com mensagem propria. "O alvo mudou de forma" e
// "o teste nao pega o defeito" passam a ser dois vermelhos distinguiveis.
//
// O BLOCO: UMA COMPILACAO PARA OS NOVE MUTANTES (HMO-320)
// -------------------------------------------------------
// Antes, cada mutante era escrito em `lib/dinheiro.ts` -- o arquivo que o git
// rastreia -- e um `npm run test:dinheiro` inteiro era disparado por cima: nove
// partidas de npm, nove de tsc, o programa reparseado nove vezes para trocar um
// arquivo. E restaurar no fim do laco nao e restaurar: um SIGTERM (o `timeout`
// do shell, o cancelamento de job) matava o processo com o mutante GRAVADO na
// fonte, e dali em diante quem rodasse a suite media o mutante.
//
// `criarBlocoDeMutantes` fecha as duas coisas de uma vez. A mutacao vai para uma
// SOMBRA em diretorio temporario; `lib/dinheiro.ts` nunca e tocado. E a
// compilacao e em processo, dividindo o AST de tudo que nao e o arquivo mutado.
//
// O PIPELINE VEM DO `test:dinheiro` no package.json, e nao mais repetido aqui.
// Esta suite roda num fuso so hoje; se amanha ela passar a rodar em dois (como
// `test:papel-de-pao` e `test:credito-de-grupo` ja fazem), o controle negativo
// acompanha sozinho -- antes ele seguiria medindo o pipeline antigo sem nada
// reclamar.
//
// O CONTROLE POSITIVO passou a existir, e era o que faltava: sem ele uma sombra
// mal montada reprova TODO mutante e o relatorio sai dizendo "a suite fica
// vermelha nos 9 defeitos plantados" sobre zero assercoes executadas.
//
// Rodar na mao:  node scripts/mutantes-dinheiro.mjs
// =====================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const FONTE = "lib/dinheiro.ts";
const ALVO = join(RAIZ, FONTE);
const SUITE = "test:dinheiro";

/**
 * Cada mutante: o que ele representa, o texto exato que substitui, e por que
 * aquele defeito importa. O `porque` nao e enfeite -- ele e o que diz, para quem
 * ler um vermelho daqui a um ano, se o mutante ainda descreve um risco real.
 */
const MUTANTES = [
  {
    nome: "a mascara emitida no lugar do valor",
    porque:
      "O defeito catastrofico, e a razao da suite existir: parseFloat('1.000,00') e 1. " +
      "Mil reais entram no banco como um real, sem NaN e sem excecao.",
    de: 'valor: `${inteiro}${moeda.casas > 0 ? `.${fracao}` : ""}`,',
    para: "valor: `${numero}`,",
  },
  {
    nome: "milhar agrupado a partir do comeco",
    porque:
      "Acerta os numeros de tamanho multiplo de 3 e erra todos os outros, entao " +
      "passa verde em metade dos exemplos que alguem escolheria a esmo.",
    de: "const daDireita = inteiro.length - i;",
    para: "const daDireita = i + 1;",
  },
  {
    nome: "duas casas para toda moeda",
    porque:
      "Iene nao tem centavos. Com duas casas fixas os digitos entram deslocados " +
      "por cem, e o valor fica cem vezes menor que o digitado.",
    de: "const { inteiro, fracao } = partir(digitos, moeda.casas);",
    para: "const { inteiro, fracao } = partir(digitos, 2);",
  },
  {
    nome: "campo vazio virando zero",
    porque:
      "Faz um `required` do HTML passar com nada digitado, deixando a validacao " +
      "da submissao como unica rede.",
    de: 'return { exibicao: "", valor: "" };',
    para: 'return { exibicao: formatarValor(0, moeda.codigo), valor: "0.00" };',
  },
  {
    nome: "campo que nao esvazia (poda de zeros a esquerda removida)",
    porque:
      "Este e o defeito que a simulacao de teclado encontrou DEPOIS de a suite " +
      "estar verde. Sem a poda, o backspace tem um ponto fixo em 'R$ 0,00': " +
      "apagar o ultimo caractere deixa 'R$ 0,0', que o padStart devolve para " +
      "tres digitos, que reexibem 'R$ 0,00'. O campo fica impossivel de limpar, " +
      "para sempre, sem erro nenhum.",
    de: '    .replace(/^0+/, "")\n',
    para: "",
  },
  {
    nome: "poda de zeros a esquerda trocada por no-op",
    porque:
      "O mesmo defeito acima por outro caminho. O mutante anterior depende da " +
      "quebra de linha; este nao, entao os dois juntos sobrevivem a um " +
      "formatador que junte as chamadas numa linha so.",
    de: '.replace(/^0+/, "")',
    para: '.replace(/^$/, "")',
  },
  {
    nome: "o menos sobrevivendo a digitacao",
    porque:
      "O campo era type=number e aceitava '-30' numa tela de despesa. " +
      "`valorGravado` aplica -Math.abs, entao '-30' virava -(-30) = +30: " +
      "dinheiro ENTRANDO numa tela de saida, e o saldo fechando errado para " +
      "MAIS, que e o lado do qual ninguem reclama.",
    de: "exibicao: `${moeda.simbolo} ${numero}`,",
    para:
      'exibicao: `${textoCru.includes("-") ? "-" : ""}${moeda.simbolo} ${numero}`,',
  },
  {
    nome: "sem teto de digitos",
    porque:
      "O valor sai da faixa exata de Number, e a reexibicao de um valor gravado " +
      "passa a mover centavos.",
    de: "    .slice(0, MAX_DIGITOS);",
    para: "    .slice(0);",
  },
  {
    nome: "moeda desconhecida sem queda para o padrao",
    porque:
      "`preferences` e um jsonb: qualquer string pode chegar ali, por mao humana " +
      "ou por versao antiga do app. A tela de lancamento ficaria branca.",
    de:
      "  return (\n" +
      "    MOEDAS.find((m) => m.codigo === alvo) ??\n" +
      "    MOEDAS.find((m) => m.codigo === MOEDA_PADRAO)!\n" +
      "  );",
    para: "  return MOEDAS.find((m) => m.codigo === alvo)!;",
  },
];

const original = readFileSync(ALVO, "utf8");
const bloco = criarBlocoDeMutantes({ rotulo: "dinheiro", suites: [SUITE] });
// A sombra vive em diretorio temporario e sai junto com o processo -- inclusive
// nas saidas antecipadas abaixo. No pior caso (SIGTERM) sobra um diretorio orfao
// em /tmp; o que NAO sobra, e era o problema, e mutante em `lib/`.
process.on("exit", () => bloco.fechar());

let falhas = 0;

// CONTROLE POSITIVO, antes de qualquer mutante: a arvore INTACTA tem de passar.
// `rodar` com `{}` compila e roda a sombra sem sobrescrita nenhuma -- e e o unico
// passo que pega erro no proprio aparelho.
const controle = bloco.rodar("controle", {}, SUITE);
if (!controle.verde) {
  console.error(
    `\n  LINHA DE BASE VERMELHA\n` +
      `    A suite JA falha com ${FONTE} intacto (${controle.como}), entao nenhum\n` +
      `    mutante abaixo provaria nada: todos ficariam 'vermelhos' por um defeito\n` +
      `    que nao e o plantado.\n\n    ${controle.saida}`
  );
  process.exit(1);
}
console.log(`  controle:     ${FONTE} intacto passa na suite`);

for (const m of MUTANTES) {
  const ocorrencias = original.split(m.de).length - 1;

  // O ALVO MUDOU DE FORMA. Isto nao e "o teste nao pega o defeito" -- e este
  // arquivo estar desatualizado, e precisa de mensagem propria. Sem esta porta o
  // mutante viraria um no-op silencioso: o codigo fica intacto, a suite passa, e
  // o relatorio acusa o contrario do que aconteceu.
  if (ocorrencias !== 1) {
    console.error(
      `\n  ALVO PERDIDO  ${m.nome}\n` +
        `    esperava 1 ocorrencia em lib/dinheiro.ts, achei ${ocorrencias}:\n` +
        `      ${JSON.stringify(m.de)}\n` +
        `    O codigo mudou de forma. Atualize o mutante (ou tire-o, se o risco\n` +
        `    que ele descreve deixou de existir): ${m.porque}`
    );
    falhas++;
    continue;
  }

  const r = bloco.rodar(m.nome, { [FONTE]: original.replace(m.de, m.para) }, SUITE);

  if (r.verde) {
    console.error(
      `\n  SOBREVIVEU    ${m.nome}\n` +
        `    A suite ficou VERDE com este defeito de pe.\n` +
        `    Por que ele importa: ${m.porque}` +
        // Sobreviver emitindo byte IDENTICO ao da arvore limpa nao e furo de
        // assercao: e mutante equivalente, e nenhuma assercao o mataria. A
        // resposta certa para os dois casos e oposta (escrever assercao x tirar
        // o mutante da lista), e sem a distincao um equivalente fica no placar
        // para sempre ensinando a nao ler o placar.
        (r.mudouASaida === false
          ? "\n    (a saida compilada e identica a da arvore limpa: mutante" +
            " EQUIVALENTE, nao furo de teste)"
          : "")
    );
    falhas++;
  } else {
    console.log(`  vermelho em:  ${m.nome}  (${r.como})`);
  }
}

if (falhas > 0) {
  console.error(
    `\n${falhas} de ${MUTANTES.length} mutantes nao produziram vermelho. ` +
      `lib/dinheiro.ts nunca foi tocado: a mutacao mora na sombra.\n`
  );
  process.exit(1);
}

console.log(
  `\nA suite fica vermelha nos ${MUTANTES.length} defeitos plantados.\n`
);
