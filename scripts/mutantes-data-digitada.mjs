#!/usr/bin/env node
// =====================================================
// CONTROLE NEGATIVO DA SUITE DA DATA DIGITADA (HMO-238)
// =====================================================
// Planta, um por vez, defeitos reais em lib/data-digitada.ts e exige que
// `npm run test:data-digitada` fique VERMELHO em cada um. Uma verificacao que
// nunca viu vermelho nao e verificacao: as asercoes daquela suite sao quase todas
// igualdades de string, e igualdade de string continua verde quando o codigo vira
// outra coisa por baixo -- desde que a outra coisa produza o mesmo texto nos
// exemplos escolhidos.
//
// Aqui cada mutante DECLARA o texto que espera encontrar, e a ausencia desse
// texto e um erro proprio, com mensagem propria. "O alvo mudou de forma" e "o
// teste nao pega o defeito" passam a ser dois vermelhos distinguiveis -- um `sed`
// que nao casa sai 0 sem mudar nada, e o passo acusaria a mascara em vez do
// proprio mutante.
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-320)
// --------------------------------------------------------
// Antes, cada mutante era escrito em `lib/data-digitada.ts` -- o arquivo que o
// git rastreia -- e um `npm run test:data-digitada` inteiro era disparado por
// cima: uma partida de npm e de tsc por mutante, o programa reparseado do zero
// para trocar um arquivo. E restaurar no fim do laco nao e restaurar: um SIGTERM
// (o `timeout` do shell, o cancelamento de job) matava o processo com o mutante
// GRAVADO na fonte, e dali em diante quem rodasse a suite media o mutante.
//
// `criarBlocoDeMutantes` fecha as duas coisas. A mutacao vai para uma SOMBRA em
// diretorio temporario -- `lib/data-digitada.ts` nunca e tocado -- e a compilacao
// e em processo, dividindo o AST de tudo que nao e o arquivo mutado.
//
// O PIPELINE VEM DO `test:data-digitada` no package.json em vez de repetido
// aqui: a copia da receita divergia do alvo de verdade sem nada reclamar. Note
// que o alvo compila `lib/lancamento.ts` junto, e este runner nao sabia disso.
//
// O CONTROLE POSITIVO passou a existir, e era o que faltava: sem ele uma sombra
// mal montada reprova TODO mutante e o relatorio sai dizendo "a suite fica
// vermelha nos N defeitos plantados" sobre zero assercoes executadas.
//
// Rodar na mao:  node scripts/mutantes-data-digitada.mjs
// =====================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const FONTE = "lib/data-digitada.ts";
const ALVO = join(RAIZ, FONTE);
const SUITE = "test:data-digitada";

/**
 * Cada mutante: o que ele representa, o texto exato que substitui, e por que
 * aquele defeito importa. O `porque` nao e enfeite -- ele e o que diz, para quem
 * ler um vermelho daqui a um ano, se o mutante ainda descreve um risco real.
 */
const MUTANTES = [
  {
    nome: "dia e mes trocados no valor emitido",
    porque:
      "O defeito que esta issue existe para fechar, reintroduzido no NOSSO lado: " +
      "e exatamente o que o controle nativo fazia ao ler 10/03 como mm/dd e gravar " +
      "3 de outubro. Data valida, plausivel, sem erro nenhum -- o lancamento anda " +
      "sete meses e ninguem fica sabendo.",
    de: "return { exibicao, valor: `${ano}-${mes}-${dia}` };",
    para: "return { exibicao, valor: `${ano}-${dia}-${mes}` };",
  },
  {
    nome: "a exibicao emitida no lugar do valor",
    porque:
      "O espelho do defeito de dinheiro, onde a mascara vazava para o parseFloat. " +
      "Aqui '10/03/2026' chega no PostgREST, que devolve 22007, que a tela mostra " +
      "como 'erro ao salvar' sem dizer qual campo.",
    de: "return { exibicao, valor: `${ano}-${mes}-${dia}` };",
    para: "return { exibicao, valor: exibicao };",
  },
  {
    nome: "data incompleta emitindo data parcial",
    porque:
      "O contrato 2 do cabecalho. '10/1' passaria a emitir uma data que ninguem " +
      "digitou, e uma gravacao errada e pior que uma recusa porque ninguem olha.",
    de: "if (digitos.length < DIGITOS_DA_DATA) {",
    para: "if (digitos.length < 1) {",
  },
  {
    nome: "redigitacao desligada (as duas datas se misturam)",
    porque:
      "O CRITERIO PRINCIPAL da issue. Sem esta regra, digitar sobre o campo que " +
      "chega preenchido com hoje mistura as duas datas -- '02/10/2026' + 10032026 " +
      "virava '02/10/1202'. E a versao mascarada do mesmo defeito do campo nativo.",
    de: "const redigitando = antes.length === DIGITOS_DA_DATA && crus.length > antes.length;",
    para: "const redigitando = false;",
  },
  {
    nome: "o digito inserido levando o resto da linha junto",
    porque:
      "Sem o recorte pelo SUFIXO, uma tecla no meio de uma data completa arrasta " +
      "os digitos que vinham depois dela. O caso do dedo no meio do texto volta a " +
      "produzir uma mistura das duas datas.",
    de: "return digitosNovos.slice(i, digitosNovos.length - j);",
    para: "return digitosNovos.slice(i);",
  },
  {
    nome: "fevereiro com 31 dias",
    porque:
      "A mascara emitiria '2026-02-31': oito digitos, formato certo, regex de " +
      "lib/lancamento.ts aprovando, e o Postgres recusando com 22007 na gravacao.",
    de: "if (mes === 2) return bissexto(ano) ? 29 : 28;",
    para: "if (mes === 2) return 31;",
  },
  {
    nome: "bissexto por `ano % 4` sozinho",
    porque:
      "Acerta 2024 e erra 1900, entao passa verde em qualquer exemplo que alguem " +
      "escolha a esmo perto de hoje. 29/02/1900 nao existe e seria aceito.",
    de: "return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;",
    para: "return ano % 4 === 0;",
  },
  {
    nome: "ano zero aceito",
    porque:
      "`'0000-01-01'::date` e fora de faixa no Postgres. E um ano a meio caminho " +
      "('0002' indo para 2026) nao pode virar uma gravacao.",
    de: "  if (ano < 1) return false;\n",
    para: "",
  },
  {
    nome: "barra sobrando no fim da exibicao",
    porque:
      "Da a esta mascara o ponto fixo que a de dinheiro teve: o backspace apaga a " +
      "barra, a mascara a devolve, e o campo fica impossivel de limpar -- a pessoa " +
      "aperta backspace e nada acontece, para sempre, sem erro nenhum.",
    de: "    if (i === 2 || i === 4) saida += SEPARADOR;\n    saida += digitos[i];",
    para: "    saida += digitos[i];\n    if (i === 1 || i === 3) saida += SEPARADOR;",
  },
  {
    nome: "separador na posicao errada",
    porque:
      "A exibicao deixa de ser dd/mm/aaaa, que e a unica coisa que diz a pessoa em " +
      "que ordem ela deve digitar. O valor continua certo, entao so uma asercao " +
      "sobre a EXIBICAO pega este.",
    de: "if (i === 2 || i === 4) saida += SEPARADOR;",
    para: "if (i === 2 || i === 5) saida += SEPARADOR;",
  },
  {
    nome: "rascunho honrado mesmo quando o pai discorda",
    porque:
      "E o bug de duas fontes de verdade que `CampoDeValor` evita nao guardando " +
      "estado: a edicao carrega o lancamento do banco, ou a tela copia a data " +
      "prevista da data real, e o campo continua mostrando o texto antigo com o " +
      "valor novo por baixo.",
    de: "  if (rascunho && rascunho.valor === valor) return rascunho.texto;",
    para: "  if (rascunho) return rascunho.texto;",
  },
  {
    nome: "caret deixado onde estava",
    porque:
      "A barra inserida pela mascara desloca a tecla seguinte, e a digitacao " +
      "embaralha: '1003' vira '10/30'. Medido na sonda em Chromium.",
    de: "  campo.setSelectionRange(fim, fim);\n",
    para: "",
  },
  {
    nome: "data invalida do banco sendo exibida",
    porque:
      "O campo passaria a mostrar um texto que ele seria incapaz de emitir -- " +
      "incluindo o '32026-10-02' que o controle nativo produzia. A pessoa veria uma " +
      "data na tela e o formulario estaria sem data nenhuma.",
    de: '  return entrada.valor === "" ? "" : entrada.exibicao;',
    para: "  return entrada.exibicao;",
  },
];

const original = readFileSync(ALVO, "utf8");
const bloco = criarBlocoDeMutantes({ rotulo: "data-digitada", suites: [SUITE] });
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
        `    esperava 1 ocorrencia em lib/data-digitada.ts, achei ${ocorrencias}:\n` +
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
      `lib/data-digitada.ts nunca foi tocado: a mutacao mora na sombra.\n`
  );
  process.exit(1);
}

console.log(
  `\nA suite fica vermelha nos ${MUTANTES.length} defeitos plantados.\n`
);
