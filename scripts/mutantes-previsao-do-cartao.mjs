#!/usr/bin/env node
// =====================================================
// CONTROLE NEGATIVO: as acoes da conta prevista do cartao (HMO-460)
// =====================================================
//   npm run mutantes:previsao-do-cartao
//
// A suite `test:tela-do-cartao` ficou verde com os casos novos desta fase. Verde
// nao prova nada sozinho: uma assercao que grepa a pagina inteira por um
// fragmento casa com qualquer coisa, e um `&&` que nunca e falso passa igual.
// Este runner QUEBRA a feature de propositos diferentes e exige que a suite
// REPROVE em cada um.
//
// A ANCORA TEM DE CASAR, E ISSO E CONFERIDO
// -----------------------------------------
// Mutante cuja ancora nao casa deixa o arquivo intacto e a suite verde -- que se
// le como "o mutante sobreviveu", o relatorio confiante e errado. Por isso cada
// edicao conta as substituicoes e aborta em zero.
//
// RESTAURA DE UMA COPIA, e nao com `git checkout`: os arquivos desta fase ainda
// nao estao commitados, e `git checkout --` os APAGARIA em vez de reverte-los.
// =====================================================

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const LIB = "lib/acoes-da-previsao-do-cartao.ts";
const TELA = "components/cartoes/FaturaDoCartao.tsx";
const FORM = "components/cartoes/EdicaoDaPrevisaoDoCartao.tsx";

const MUTANTES = [
  {
    nome: "o campo de valor volta a usar PONTO decimal (o defeito de 10x)",
    porque:
      "`String(39.9)` no campo e lido com replace(/\\./g,'') e grava R$ 399,00 " +
      "numa assinatura de R$ 39,90 -- e o PATCH responde 200.",
    arquivo: LIB,
    de: 'return Number(amount).toFixed(2).replace(".", ",");',
    para: "return String(amount);",
  },
  {
    nome: "a exclusao ignora o alcance escolhido e manda sempre apenas_esta",
    porque:
      "quem escolhe 'todas as ocorrencias' perde UM mes e recebe os outros de " +
      "volta. A linha sai da tela nos tres alcances: nada distingue no clique.",
    arquivo: LIB,
    de: "return { ...base, corpo: { alcance } };",
    para: "return base;",
  },
  {
    nome: "a SERIE tambem recebe frase de confirm (e perde o dialogo do alcance)",
    porque:
      "a frase da `fixa` manda usar Contas a Pagar -- a tela de onde a HMO-209 " +
      "tirou esta linha --, e o dialogo dos tres alcances nunca abre.",
    arquivo: LIB,
    de: "  if (ehSerieDaPrevisao(previsao)) return null;",
    para: "  if (false) return null;",
  },
  {
    nome: "string vazia em recurring_rule_id passa por serie",
    porque:
      "`!= null` abriria o dialogo sobre uma linha que a rota apaga de vez: a " +
      "pessoa escolhe 'todas' e apaga uma linha so, sem nada dizendo isso.",
    arquivo: LIB,
    de: "  return Boolean(previsao.recurring_rule_id);",
    para: "  return previsao.recurring_rule_id !== undefined && previsao.recurring_rule_id !== null;",
  },
  {
    nome: "o aviso da edicao nao distingue serie de avulsa",
    porque:
      "sem a segunda frase, a assinatura reajustada neste mes volta ao valor " +
      "antigo no proximo e nada na tela ligou uma coisa a outra.",
    arquivo: LIB,
    de: "  if (!ehSerieDaPrevisao(previsao)) return base;",
    para: "  return base;\n  if (!ehSerieDaPrevisao(previsao)) return base;",
  },
  {
    nome: "a ancora do dialogo usa a ISO crua",
    porque:
      "'Apenas esta (2026-10-20)' e o rotulo que identifica a linha falando " +
      "num formato que ninguem le -- e `ancoraDaPrevisao` existe por isso.",
    arquivo: LIB,
    de: '  return `${due_date.slice(8, 10)}/${due_date.slice(5, 7)}/${due_date.slice(0, 4)}`;',
    para: "  return due_date;",
  },
  {
    nome: "os botoes da previsao aparecem sem a pagina passar handler",
    porque:
      "botao ligado em nada: o clique nao faz NADA, e isso nao tem sintoma " +
      "nenhum na tela. E e o que faria este componente deixar de ser sem-rede.",
    arquivo: TELA,
    de: "                  {aoEditarPrevisao ? (",
    para: "                  {true ? (",
  },
  {
    nome: "o formulario da previsao vai para DENTRO do bloco das previsoes",
    porque:
      "uma releitura que falhe no meio da digitacao faz `previsoes` virar null " +
      "e o formulario desaparece COM o texto digitado dentro.",
    arquivo: TELA,
    de: "      {blocoDeEdicaoDaPrevisao}\n",
    para: "",
  },
  {
    nome: "o Salvar do formulario nao apaga durante a gravacao",
    porque: "duplo clique manda dois PATCH -- no caminho da exclusao, dois DELETE.",
    arquivo: FORM,
    de: "            disabled={salvando}\n          >\n            {salvando && <Loader2",
    para: "          >\n            {salvando && <Loader2",
  },
];

const guardados = mkdtempSync(join(tmpdir(), "mutantes-previsao-"));
for (const arquivo of [LIB, TELA, FORM]) {
  copyFileSync(arquivo, join(guardados, arquivo.replace(/\//g, "_")));
}
const restaurar = () => {
  for (const arquivo of [LIB, TELA, FORM]) {
    copyFileSync(join(guardados, arquivo.replace(/\//g, "_")), arquivo);
  }
};

const suiteReprova = () => {
  try {
    execFileSync("npm", ["run", "test:tela-do-cartao"], { stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
};

// A SUITE INTACTA PRIMEIRO. Suite vermelha faz TODO mutante "morrer" por um
// motivo que nao e o dele, e o runner inteiro passa vacuo.
process.stdout.write("controle: a suite intacta passa ... ");
if (suiteReprova()) {
  console.log("NAO");
  console.error(
    "\nA suite reprova ANTES de qualquer mutacao. Todo mutante abaixo 'morreria'\n" +
      "sem provar nada. Conserte a suite primeiro."
  );
  process.exit(1);
}
console.log("sim");

let sobreviventes = 0;

for (const m of MUTANTES) {
  const original = readFileSync(m.arquivo, "utf8");

  const pedacos = original.split(m.de);
  if (pedacos.length !== 2) {
    restaurar();
    console.error(
      `\nANCORA NAO CASOU (${pedacos.length - 1} ocorrencias) em ${m.arquivo}:\n` +
        `  ${m.de}\n\nSem casar, o arquivo fica intacto e a suite verde se leria\n` +
        "como mutante sobrevivente. Conserte a ancora."
    );
    process.exit(1);
  }

  writeFileSync(m.arquivo, pedacos.join(m.para));
  process.stdout.write(`mutante: ${m.nome} ... `);
  const morreu = suiteReprova();
  restaurar();

  if (morreu) {
    console.log("morreu");
  } else {
    sobreviventes += 1;
    console.log("SOBREVIVEU");
    console.error(`  o que ele estraga: ${m.porque}`);
  }
}

console.log(
  `\n${MUTANTES.length - sobreviventes}/${MUTANTES.length} mutantes mortos.`
);

if (sobreviventes > 0) {
  console.error(
    "Mutante sobrevivente = assercao que nao existe, ou que afirma menos do que\n" +
      "parece. Ver o cabecalho deste arquivo."
  );
  process.exit(1);
}
