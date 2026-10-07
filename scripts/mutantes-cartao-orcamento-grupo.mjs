#!/usr/bin/env node
// Prova de mutacao do components/financial/CartaoOrcamentoGrupo.tsx. Cada
// entrada abaixo estraga uma decisao do JSX; a suite tem que ficar VERMELHA em
// todas. Mutante que sobrevive e um trecho que nenhum teste distingue -- ou
// codigo morto.
//
// O primeiro grupo e o que interessa, e e o "nao fazer" literal da HMO-180:
// refazer a soma dentro do JSX. O numero continua plausivel, a barra continua
// enchendo, e o sintoma e a tela do grupo e a aba de Orcamento mostrando
// percentuais diferentes para a mesma viagem -- sem erro, sem teste vermelho,
// sem nada no console.
//
//   node scripts/mutantes-cartao-orcamento-grupo.mjs
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-335)
// --------------------------------------------------------
// Este runner MUTAVA A ARVORE RASTREADA: escrevia o mutante em `ALVO`, chamava
// `npm run` ali mesmo e restaurava depois. Dois defeitos, e o segundo e o que
// doia:
//
//   1. cada volta recompilava o programa INTEIRO para trocar UM arquivo -- 16
//      voltas de `tsc` completo, 72s medidos;
//   2. o mutante ficava GRAVADO no arquivo de producao quando o processo morria
//      no meio. Nao havia nem `finally` aqui: a restauracao era uma linha no fim
//      do corpo do laco, e `execSync` BLOQUEIA a thread do JS -- com SIGTERM (o
//      sinal que um timeout manda) o processo termina a volta em curso e aplica
//      A SEGUINTE. Ja aconteceu nesta arvore: a HMO-329 comecou com
//      `lib/divisao-configurada.ts` mutado por um runner deste desenho.
//
// Agora as voltas dividem um processo e um cache de AST
// (`criarBlocoDeMutantes`, HMO-319): so o arquivo mutado e reparseado, e a
// mutacao vai para uma SOMBRA em diretorio temporario. A arvore rastreada e o
// `.tmp-*` do repositorio nao sao tocados em momento nenhum, entao o pior caso
// de um processo morto e um diretorio orfao em /tmp.
//
// As etapas da suite saem do proprio `scripts["test:cartao-orcamento-grupo"]`
// do package.json -- o comando que o CI roda --, e nao de uma receita repetida
// a mao aqui.
//
// A lista de mutantes abaixo NAO foi reescrita nem movida: o diff desta
// conversao nao toca uma linha dela.
import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const ALVO = "components/financial/CartaoOrcamentoGrupo.tsx";
const SUITE = "test:cartao-orcamento-grupo";

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela.
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  // --- a soma refeita no JSX: o "nao fazer" da issue ---
  [
    "o cabecalho repete o teto de maior valor em vez de somar a viagem",
    "              {formatCurrency(grupo.gasto)} de {formatCurrency(grupo.limite)}",
    "              {formatCurrency(Number(grupo.orcamentos[0]?.spent ?? 0))} de{\" \"}\n              {formatCurrency(Number(grupo.orcamentos[0]?.amount_limit ?? 0))}",
  ],
  [
    "o percentual do grupo passa a ser o da primeira categoria",
    "  const pct = percentual(grupo.ratio);",
    "  const pct = percentual(Number(grupo.orcamentos[0]?.consumed_ratio ?? 0));",
  ],

  // --- a barra, que precisa parar em 100 ---
  [
    "a barra deixa de parar em 100 (o indicador sai do trilho e a barra some)",
    "const larguraDaBarra = (pct: number) => Math.min(pct, 100);",
    "const larguraDaBarra = (pct: number) => pct;",
  ],
  [
    "o percentual sem teto vira NaN na barra",
    "const percentual = (ratio: number) => Math.round(ratio * 100);",
    "const percentual = (ratio: number) => Math.round((ratio * 100) / 0) * 0 + NaN;",
  ],

  // --- a frase, que e a unica coisa que a pessoa le ---
  [
    "o estouro do grupo e anunciado como sobra",
    "            {fraseDoRestante(grupo)}",
    "            {fraseDoRestante({ ...grupo, restante: Math.abs(grupo.restante) })}",
  ],
  [
    "a linha perde o Math.abs (sai 'Estourou -R$ 300', que se le como dois estouros)",
    "            Estourou {formatCurrency(Math.abs(restante))}",
    "            Estourou {formatCurrency(restante)}",
  ],
  [
    "sobra e estouro trocam de lado na linha",
    "        {restante >= 0 ? (",
    "        {restante < 0 ? (",
  ],

  // --- o slot da acao: quem gerencia teto e so a tela de Orcamento ---
  [
    "a acao por linha e ignorada (a tela de Orcamento perde o botao de remover)",
    "            <LinhaDeTeto key={b.id} budget={b} acao={acaoDaLinha?.(b)} />",
    "            <LinhaDeTeto key={b.id} budget={b} />",
  ],
  [
    "a acao e montada sempre para a PRIMEIRA linha (a segunda categoria nao se remove)",
    "            <LinhaDeTeto key={b.id} budget={b} acao={acaoDaLinha?.(b)} />",
    "            <LinhaDeTeto\n              key={b.id}\n              budget={b}\n              acao={acaoDaLinha?.(grupo.orcamentos[0])}\n            />",
  ],
  [
    "a linha passa a desenhar um botao proprio (ele vaza para a tela do grupo)",
    "          {acao}",
    '          {acao ?? <button type="button" aria-label="Remover orçamento" />}',
  ],

  // --- o mes: sem eixo de tempo o rotulo mente sem dar erro ---
  [
    "o mes passa por new Date() (o dia 01 volta um mes no fuso de Sao Paulo)",
    '  const [ano, mes] = iso.split("-");\n  return `${MESES[Number(mes) - 1] ?? iso} de ${ano}`;',
    "  const d = new Date(iso);\n  return `${MESES[d.getMonth()]} de ${d.getFullYear()}`;",
  ],
  [
    "o cartao inventa um mes quando nao recebe nenhum",
    '              {mes ? ` em ${nomeDoMes(mes)}` : ""} — soma o gasto de todos os',
    '              {` em ${nomeDoMes(mes ?? "2026-01-01")}`} — soma o gasto de todos os',
  ],

  // --- o titulo ---
  [
    "o titulo recebido e ignorado (a tela do grupo repete o nome do cabecalho)",
    "              <span className=\"truncate\">{titulo ?? grupo.group_name}</span>",
    "              <span className=\"truncate\">{grupo.group_name}</span>",
  ],
  [
    "o titulo passa a mostrar o group_id",
    "              <span className=\"truncate\">{titulo ?? grupo.group_name}</span>",
    "              <span className=\"truncate\">{titulo ?? grupo.group_id}</span>",
  ],

  // --- a linha por categoria ---
  [
    "a categoria sem nome resolvido sai como linha vazia",
    '            {budget.category?.name ?? "Categoria"}',
    "            {budget.category?.name}",
  ],
  [
    "a linha mostra o gasto no lugar do teto (toda categoria parece 100% consumida)",
    "            {formatCurrency(Number(budget.spent))} de{\" \"}\n            {formatCurrency(Number(budget.amount_limit))}",
    "            {formatCurrency(Number(budget.spent))} de{\" \"}\n            {formatCurrency(Number(budget.spent))}",
  ],
];

const bloco = criarBlocoDeMutantes({ rotulo: "cartao-orcamento-grupo", suites: [SUITE] });

// A sombra vive em diretorio temporario, e a arvore rastreada nunca e mutada --
// era esse o modo de falha deste runner. O handler de sinal existe so para que
// nem o diretorio orfao sobre: `finally` nao roda em SIGTERM, mas
// `process.exit` dispara o `exit` abaixo.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// CONTROLE POSITIVO, primeiro e obrigatorio: a suite tem de passar com a arvore
// INTACTA, e pelo MESMO `rodar` que os mutantes usam -- por isso ele pega erro
// no proprio aparelho. Sem ele, uma sombra mal montada reprova TODO mutante e o
// placar fecha "16/16 mortos" sobre zero assercoes executadas.
const controle = bloco.rodar("controle", {}, SUITE);
if (!controle.verde) {
  console.error(`ABORTADO: ${ALVO} INTACTO reprova em ${SUITE} (${controle.como}).`);
  console.error(`  ${controle.saida}`);
  console.error("O placar nao valeria: todo mutante 'morreria' sem ter sido medido.");
  process.exit(1);
}
console.log(`controle positivo: ${ALVO} intacto passa em ${SUITE}\n`);

let sobreviventes = 0;

for (const [nome, de, para] of mutantes) {
  // Um mutante que nao aplica passa por "morto" sem nunca ter existido: o
  // trecho mudou de forma, o replace nao encontra nada, e a suite fica verde
  // por nao ter sido mexida. Ele conta como sobrevivente de proposito.
  //
  // A segunda trava -- a ocorrencia UNICA -- e a que esta conversao acrescenta:
  // `String.replace` troca a PRIMEIRA ocorrencia, entao um trecho que aparece
  // duas vezes muta um lugar que o rotulo nao descreve e sobrevive com o rotulo
  // mentindo. Ela entrou sem mudar veredito nenhum: nenhuma das 16 ancoras daqui
  // e ambigua hoje (medido na HMO-335, junto com as outras quatro listas).
  const ocorrencias = original.split(de).length - 1;
  if (ocorrencias === 0) {
    console.log(`??  ${nome}: o trecho nao existe mais -- mutante desatualizado`);
    sobreviventes++;
    continue;
  }
  if (ocorrencias > 1) {
    console.log(`??  ${nome}: o trecho aparece ${ocorrencias}x -- mutante ambiguo, invalido`);
    sobreviventes++;
    continue;
  }

  const r = bloco.rodar(nome, { [ALVO]: original.replace(de, para) }, SUITE);
  const vermelho = !r.verde;
  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) {
    if (r.mudouASaida === false) {
      console.log("     (saida compilada identica a da arvore limpa: EQUIVALENTE)");
    }
    sobreviventes++;
  }
}

console.log(
  `\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`
);
process.exit(sobreviventes === 0 ? 0 : 1);
