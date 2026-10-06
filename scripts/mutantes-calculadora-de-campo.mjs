#!/usr/bin/env node
// =====================================================
// CONTROLE NEGATIVO DA SUITE DA CALCULADORA (HMO-171)
// =====================================================
// Planta, um por vez, defeitos reais em lib/calculadora-de-campo.ts e exige que
// `npm run test:calculadora-campo` fique VERMELHO em cada um. Mesmo desenho do
// scripts/mutantes-dinheiro.mjs, e pela mesma razao: aquela suite e quase toda
// igualdade de string, e igualdade de string continua verde quando o codigo vira
// outra coisa por baixo -- desde que a outra coisa produza o mesmo texto nos
// exemplos escolhidos.
//
// Cada mutante DECLARA o texto que espera encontrar. A ausencia desse texto e um
// erro proprio ("ALVO PERDIDO"), separado de "o teste nao pega o defeito": um
// `sed` que nao casa sai 0 sem mudar nada, e o relatorio acusaria o contrario do
// que aconteceu.
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-320)
// --------------------------------------------------------
// Antes, cada mutante era escrito em `lib/calculadora-de-campo.ts` -- o arquivo
// que o git rastreia -- e um `npm run test:calculadora-campo` inteiro era
// disparado por cima: uma partida de npm e de tsc por mutante, o programa
// reparseado do zero para trocar um arquivo. E restaurar no fim do laco nao e
// restaurar: um SIGTERM (o `timeout` do shell, o cancelamento de job) matava o
// processo com o mutante GRAVADO na fonte, e dali em diante quem rodasse a suite
// media o mutante.
//
// `criarBlocoDeMutantes` fecha as duas coisas. A mutacao vai para uma SOMBRA em
// diretorio temporario -- `lib/calculadora-de-campo.ts` nunca e tocado -- e a
// compilacao e em processo, dividindo o AST de tudo que nao e o arquivo mutado.
//
// O PIPELINE VEM DO `test:calculadora-campo` no package.json em vez de repetido
// aqui: a copia da receita divergia do alvo de verdade sem nada reclamar.
//
// A LINHA DE BASE abaixo era o unico controle positivo deste runner, e continua
// sendo -- agora medida pelo mesmo aparelho que mede os mutantes, que e o que a
// torna capaz de pegar erro no aparelho.
//
// Rodar na mao:  node scripts/mutantes-calculadora-de-campo.mjs
// =====================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const FONTE = "lib/calculadora-de-campo.ts";
const ALVO = join(RAIZ, FONTE);
const SUITE = "test:calculadora-campo";

const MUTANTES = [
  {
    nome: "o ponto de milhar apenas removido, sem conferencia",
    porque:
      "O defeito de 10x, e a razao de `lerNumero` existir. Removendo o ponto sem " +
      "validar o agrupamento, '1.5' vira 15: o campo mostra R$ 15,00, a validacao " +
      "aprova, e ninguem tem como desconfiar.",
    de: '    if (!/^[0-9]{1,3}(\\.[0-9]{3})+$/.test(inteiro)) return "milhar-ambiguo";',
    para: "",
  },
  {
    nome: "arredondamento por Math.round sobre float",
    porque:
      "E a conta que quase todo mundo escreve, e ela perde um centavo no caso que " +
      "uma calculadora de dinheiro encontra toda hora: 1,005 em binario e " +
      "1.00499999999999989, entao Math.round(1.005 * 100) da 100 e o resultado " +
      "sai R$ 1,00 onde a pessoa esperava R$ 1,01.",
    de: "  const texto = abs.toFixed(casas + CASAS_DE_FOLGA);",
    para:
      "  const fator = 10 ** casas;\n" +
      "  const texto = (Math.round(abs * fator) / fator).toFixed(casas + CASAS_DE_FOLGA);",
  },
  {
    nome: "uma casa de folga em vez de oito (arredondamento duplo)",
    porque:
      "Este defeito esteve de pe neste arquivo e foi a suite que o pegou. Com uma " +
      "casa so, o proprio toFixed arredonda no ponto de corte e FABRICA o digito " +
      "que decide: (1.0049).toFixed(3) e '1.005', que sobe para 1,01 -- quando " +
      "1,0049 em duas casas e 1,00.",
    de: "const CASAS_DE_FOLGA = 8;",
    para: "const CASAS_DE_FOLGA = 1;",
  },
  {
    nome: "arredondamento para baixo (truncagem)",
    porque:
      "Some com o meio-para-cima: todo valor que nao fecha nas casas da moeda " +
      "perde a ultima fracao. 2,675 vira 2,67, e a diferenca aparece so quando " +
      "alguem soma o extrato a mao.",
    de: "  return decisor >= 5 ? semZerosAEsquerda(somarUm(truncado)) : truncado;",
    para: "  return truncado;",
  },
  {
    nome: "transporte do +1 sem o digito novo na frente",
    porque:
      "'999' + 1 tem de virar '1000'. Sem o digito que nasce na frente, 9,999 " +
      "arredonda para 0,00 em vez de 10,00 -- o valor nao fica um centavo errado, " +
      "fica mil vezes menor.",
    de: '  return i < 0 ? `1${saida.join("")}` : saida.join("");',
    para: '  return saida.join("");',
  },
  {
    nome: "resultado negativo entregue ao campo",
    porque:
      "As rotas deste app aplicam -Math.abs no valor. Um -70 num campo de despesa " +
      "volta do banco como +70: dinheiro ENTRANDO numa tela de saida, e o saldo " +
      "fechando errado para MAIS, que e o lado de que ninguem reclama.",
    de: "  if (bruto < 0) {",
    para: "  if (false) {",
  },
  {
    nome: "zero aceito pelo campo",
    porque:
      "Todo formulario daqui valida 'maior que zero', e campo vazio e o estado que " +
      "essas validacoes sabem recusar. Um zero aplicado passa pelo `required` do " +
      "HTML e chega na submissao.",
    de: "  if (zero) {",
    para: "  if (false) {",
  },
  {
    nome: "divisao por zero deixada passar",
    porque:
      "Infinity sobrevive a `+ 5` e a `* 2`, e 'Infinity' no campo vira " +
      "parseFloat -> Infinity -> erro do Postgres numa hora em que a pessoa ja " +
      "saiu da tela.",
    de: '          if (direita === 0) throw new Interrompe("divisao-por-zero");',
    para: "",
  },
  {
    nome: "teto de digitos ignorado",
    porque:
      "`aoDigitarValor` IGNORA a tecla que passa de MAX_DIGITOS. Entregando 16 " +
      "digitos, o campo exibe um numero DIFERENTE do que a calculadora acabou de " +
      "prometer, e a pessoa nao tem como saber qual dos dois sera gravado.",
    de: "  if (escalado.length > maxDigitos) {",
    para: "  if (false) {",
  },
  {
    nome: "token sobrando aceito (meia conta avaliada)",
    porque:
      "Sem conferir que o parser consumiu tudo, '2 3' devolve 2. E o pior tipo de " +
      "resultado: plausivel, com metade da conta descartada em silencio.",
    de: "    if (pos !== tokens.length) return \"sintaxe\";",
    para: "",
  },
  {
    nome: "peneira de caracteres removida (a mensagem, nao o motivo)",
    porque:
      "Este mutante SOBREVIVEU na primeira rodada, e o que ele denunciou foi um " +
      "comentario errado meu, nao um furo de teste: o tokenizador ja recusa " +
      "qualquer caractere que nao reconhece, entao a peneira nao protege a conta " +
      "de nada -- o motivo sai 'sintaxe' pelos dois caminhos. O que ela faz e " +
      "dizer QUAL e o alfabeto aceito. Sem ela, 'R$ 10' responde 'Conta " +
      "incompleta.' e manda a pessoa procurar um parentese que ela nao esqueceu. " +
      "Por isso a suite passou a comparar o TEXTO da mensagem.",
    de: "  if (!PERMITIDOS.test(expressao)) {",
    para: "  if (false) {",
  },
  {
    nome: "precedencia achatada (soma antes de multiplicacao)",
    porque:
      "'2+3*4' passa a ser 20 em vez de 14. Um orcamento de '100+3*50' viraria " +
      "5.150 em vez de 250.",
    de: "      if (t && t.tipo === \"op\" && (t.op === \"*\" || t.op === \"/\")) {",
    para: "      if (t && t.tipo === \"op\" && (t.op === \"+\" || t.op === \"-\")) {",
  },
  {
    nome: "casas da moeda trocadas por duas fixas",
    porque:
      "Iene nao tem centavos. Com duas casas fixas o valor de um lancamento em " +
      "iene sai cem vezes maior do que a conta deu.",
    de: "  const casas = opcoes.casas === undefined ? 2 : opcoes.casas;",
    para: "  const casas = 2;",
  },
  {
    nome: "zero da frente perdido em valor menor que uma unidade",
    porque:
      "Cinco centavos montariam '.05' em vez de '0.05'. O parseFloat ate le, mas o " +
      "texto deixa de ser identico ao que o campo emite para o mesmo numero, e a " +
      "comparacao que protege o formato para de valer.",
    de: '      ? `${"0".repeat(casas - escalado.length + 1)}${escalado}`',
    para: '      ? `${"0".repeat(casas - escalado.length)}${escalado}`',
  },
];

const original = readFileSync(ALVO, "utf8");

// ---------------------------------------------------------------------------
// LINHA DE BASE: a suite esta VERDE antes de eu plantar defeito nenhum?
// ---------------------------------------------------------------------------
// Sem esta porta o relatorio deste script e capaz de mentir por completo, e ele
// mentiu para mim durante esta issue: uma assercao minha estava errada no
// arquivo de teste, a suite ja estava vermelha, e os 14 mutantes foram
// declarados "vermelho em:" um por um. Todos eram vermelhos pelo motivo errado.
//
// "A suite falha com o defeito" so quer dizer algo quando ela PASSA sem ele. E
// o controle positivo que faltava ao controle negativo.
//
// `rodar` com `{}` compila e roda a sombra sem sobrescrita nenhuma: a mesma
// compilacao, o mesmo diretorio e o mesmo `node --test` que cada mutante vai
// usar. Era por isso que ele tinha de mudar de aparelho junto com os mutantes --
// um controle que roda por outro caminho nao prova nada sobre este.
const bloco = criarBlocoDeMutantes({ rotulo: "calculadora-de-campo", suites: [SUITE] });
// A sombra vive em diretorio temporario e sai junto com o processo -- inclusive
// nas saidas antecipadas abaixo. No pior caso (SIGTERM) sobra um diretorio orfao
// em /tmp; o que NAO sobra, e era o problema, e mutante em `lib/`.
process.on("exit", () => bloco.fechar());

const controle = bloco.rodar("controle", {}, SUITE);
if (!controle.verde) {
  console.error(
    "\n  LINHA DE BASE VERMELHA\n" +
      `    A suite JA falha com lib/calculadora-de-campo.ts intacto (${controle.como}),\n` +
      "    entao nenhum mutante abaixo provaria nada: todos ficariam 'vermelhos'\n" +
      "    por um defeito que nao e o plantado.\n" +
      "    Conserte a suite (ou o codigo) antes de rodar este script.\n\n" +
      `    ${controle.saida}`
  );
  process.exit(1);
}

let falhas = 0;

for (const m of MUTANTES) {
  const ocorrencias = original.split(m.de).length - 1;

  if (ocorrencias !== 1) {
    console.error(
      `\n  ALVO PERDIDO  ${m.nome}\n` +
        `    esperava 1 ocorrencia em lib/calculadora-de-campo.ts, achei ${ocorrencias}:\n` +
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
        // o mutante da lista).
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
      `lib/calculadora-de-campo.ts nunca foi tocado: a mutacao mora na sombra.\n`
  );
  process.exit(1);
}

console.log(
  `\nA suite fica vermelha nos ${MUTANTES.length} defeitos plantados.\n`
);
