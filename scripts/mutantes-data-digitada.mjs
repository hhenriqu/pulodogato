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
// Rodar na mao:  node scripts/mutantes-data-digitada.mjs
// =====================================================

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const ALVO = join(RAIZ, "lib/data-digitada.ts");

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
        `    esperava 1 ocorrencia em lib/data-digitada.ts, achei ${ocorrencias}:\n` +
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
    execSync("npm run test:data-digitada", { cwd: RAIZ, stdio: "pipe" });
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
      `lib/data-digitada.ts foi restaurado.\n`
  );
  process.exit(1);
}

console.log(
  `\nA suite fica vermelha nos ${MUTANTES.length} defeitos plantados.\n`
);
