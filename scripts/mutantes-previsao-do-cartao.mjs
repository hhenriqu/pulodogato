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
// NAO MUTA A ARVORE: MUTA UMA SOMBRA EM /tmp (HMO-483)
// ----------------------------------------------------
// Este runner mutava o arquivo rastreado no lugar e restaurava de uma copia --
// o que deixa o mutante GRAVADO na arvore quando o processo morre por timeout
// ou cancelamento (e `test:tela-do-cartao` e suite de navegador, uma volta por
// mutante). Agora a mutacao vai para a sombra de `criarBlocoDeMutantes`, que
// sobrevive a SIGTERM e a SIGKILL porque nao ha o que restaurar. O porque longo
// esta no bloco do driver, abaixo da lista.
// =====================================================

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const SUITE = "test:tela-do-cartao";

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

// A SOMBRA EM /tmp, E NAO A ARVORE (HMO-483, divida da HMO-337)
// -------------------------------------------------------------
// Este driver gravava o mutante no arquivo RASTREADO -- uma escrita do `fs`
// direto no caminho do alvo -- e restaurava de uma copia.
// `check-mutacao-no-lugar` reprovava por isso, e o runner nao estava declarado
// na divida conhecida.
//
// A FRASE ACIMA NAO SOLETRA A CHAMADA DE PROPOSITO: `check-mutacao-no-lugar`
// procura o padrao no TEXTO do arquivo, sem descontar comentario. Descrever o
// defeito antigo com a sintaxe exata da chamada faz a guarda acusar o runner ja
// consertado -- falso vermelho que custou uma volta de medicao aqui.
//
// O MODO DE FALHA NAO E TEORICO, e o cabecalho de `check-mutacao-no-lugar.mjs`
// o descreve: morto por timeout ou cancelamento, o runner deixa o mutante
// GRAVADO na arvore -- e dali em diante toda medicao le o arquivo errado, com
// nada no placar dizendo isso. Este runner roda a `test:tela-do-cartao` (suite
// de navegador) uma vez por mutante, que e justamente o perfil que estoura
// timeout.
//
// E NAO SE CONSERTA COM HANDLER DE SINAL: num laco sincrono o handler de
// `SIGTERM` nunca roda (o event loop nao recebe o controle) e ainda ENGOLE o
// sinal, deixando o runner vivo e mutando -- medido na HMO-327, e o remedio
// fabrica o defeito mais caro. O unico conserto e nao mutar a arvore.
//
// A LISTA ACIMA NAO FOI TOCADA, de proposito: o risco desta migracao e errar a
// LISTA, nao errar o driver, e com ela parada o `git diff` e a prova. Conferido
// por `git show`: as 7 entradas saem byte a byte iguais.
//
// O QUE A CONVERSAO GANHA DE GRACA, e nao e cosmetico: `bloco.rodar` distingue
// o mutante que morre no TSC do que morre na ASSERCAO. Um mutante que nao
// compila nao chega em producao, mas tambem nao prova que a suite mediu a regra
// -- e o driver antigo, que so sabia "a suite reprovou", contava os dois como a
// mesma morte.
const bloco = criarBlocoDeMutantes({
  rotulo: "previsao-do-cartao",
  suites: [SUITE],
});
process.on("exit", () => bloco.fechar());

/** As fontes intactas dos tres arquivos, lidas UMA vez. */
const originais = {
  [LIB]: readFileSync(LIB, "utf8"),
  [TELA]: readFileSync(TELA, "utf8"),
  [FORM]: readFileSync(FORM, "utf8"),
};

// O CONTROLE POSITIVO, PELO MESMO `bloco.rodar` DOS MUTANTES. Pelo mesmo
// aparelho e deliberado: so assim ele pega erro NO APARELHO (sombra incompleta,
// alias nao resolvido), que senao faria todo mutante "morrer" e o placar sairia
// cheio sem que uma assercao tivesse medido nada.
//
// Suite vermelha faz TODO controle negativo passar vacuo, e e por isso que isto
// vem antes e aborta.
process.stdout.write("controle: a suite intacta passa ... ");
const controle = bloco.rodar("controle", originais, SUITE);
if (!controle.verde) {
  console.log("NAO");
  console.error(
    `\nA suite reprova ANTES de qualquer mutacao (${controle.como}):\n` +
      `${controle.saida}\n\n` +
      "Todo mutante abaixo 'morreria' sem provar nada. Conserte a suite primeiro."
  );
  process.exit(1);
}
console.log("sim");

let sobreviventes = 0;
let porTsc = 0;

for (const m of MUTANTES) {
  const original = originais[m.arquivo];

  // A ANCORA TEM DE CASAR UMA VEZ SO, E ISSO SEGUE CONFERIDO. Mutante cuja
  // ancora nao casa deixa o arquivo intacto e a suite verde -- que se le como
  // "sobreviveu", o relatorio confiante e errado. Ancora AMBIGUA (duas
  // ocorrencias) e igualmente ruim: o `replace` troca a primeira e o rotulo
  // passa a mentir sobre onde mediu.
  const pedacos = original.split(m.de);
  if (pedacos.length !== 2) {
    console.error(
      `\nANCORA NAO CASOU (${pedacos.length - 1} ocorrencias) em ${m.arquivo}:\n` +
        `  ${m.de}\n\nSem casar exatamente uma vez, o placar nao vale. Conserte a ancora.`
    );
    process.exit(1);
  }

  process.stdout.write(`mutante: ${m.nome} ... `);
  const r = bloco.rodar(m.nome, { [m.arquivo]: pedacos.join(m.para) }, SUITE);

  if (!r.verde) {
    if (r.como === "tsc") porTsc += 1;
    console.log(`morreu (${r.como === "tsc" ? "tsc" : "assercao"})`);
  } else {
    sobreviventes += 1;
    console.log("SOBREVIVEU");
    console.error(`  o que ele estraga: ${m.porque}`);
    if (r.mudouASaida === false) {
      console.error("  (saida compilada identica a da arvore limpa: EQUIVALENTE)");
    }
  }
}

console.log(
  `\n${MUTANTES.length - sobreviventes}/${MUTANTES.length} mutantes mortos` +
    (porTsc > 0 ? ` (${porTsc} no tsc, ${MUTANTES.length - sobreviventes - porTsc} na assercao)` : "") +
    "."
);

if (sobreviventes > 0) {
  console.error(
    "Mutante sobrevivente = assercao que nao existe, ou que afirma menos do que\n" +
      "parece. Ver o cabecalho deste arquivo."
  );
  process.exit(1);
}
