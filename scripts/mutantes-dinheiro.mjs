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
// Rodar na mao:  node scripts/mutantes-dinheiro.mjs
// =====================================================

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const ALVO = join(RAIZ, "lib/dinheiro.ts");

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
let falhas = 0;

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

  writeFileSync(ALVO, original.replace(m.de, m.para));

  let passou;
  try {
    execSync("npm run test:dinheiro", { cwd: RAIZ, stdio: "pipe" });
    passou = true;
  } catch {
    passou = false;
  }

  if (passou) {
    console.error(
      `\n  SOBREVIVEU    ${m.nome}\n` +
        `    A suite ficou VERDE com este defeito de pe.\n` +
        `    Por que ele importa: ${m.porque}`
    );
    falhas++;
  } else {
    console.log(`  vermelho em:  ${m.nome}`);
  }
}

writeFileSync(ALVO, original);

if (falhas > 0) {
  console.error(
    `\n${falhas} de ${MUTANTES.length} mutantes nao produziram vermelho. ` +
      `lib/dinheiro.ts foi restaurado.\n`
  );
  process.exit(1);
}

console.log(
  `\nA suite fica vermelha nos ${MUTANTES.length} defeitos plantados.\n`
);
