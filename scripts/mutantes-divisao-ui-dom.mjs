#!/usr/bin/env node
// Prova de mutacao do components/grupos/DivisaoDoGrupo.tsx -- a FIACAO do painel
// de divisao (HMO-271 / HMO-245 fase 5). Cada entrada estraga uma ligacao da
// tela; a suite `test:divisao-ui-dom` tem que ficar VERMELHA em todas.
//
// POR QUE ESTES MUTANTES, E NAO OS DA ARITMETICA
// ---------------------------------------------
// `rebalancear`, `igualitario` e `ratearPorPeso` ja tem mutante proprio
// (`mutantes:divisao-configurada`, `mutantes:fechamento-do-grupo`). Mutar a
// conta de novo aqui so mediria aquelas suites.
//
// O que esta tela acrescenta -- e o que esta sem rede fora do navegador -- e a
// LIGACAO: o handler chamando a conta certa, com a unidade certa, com o peso
// certo. Os dois primeiros grupos abaixo sao exatamente os defeitos que um
// teste de `react-dom/server` NAO consegue ver, porque `onChange` nao sai no
// HTML: a tela renderizaria identica com o handler vazio.
//
//   node scripts/mutantes-divisao-ui-dom.mjs
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-335)
// --------------------------------------------------------
// Este runner MUTAVA A ARVORE RASTREADA: escrevia o mutante em `ALVO`, chamava
// `npm run` ali mesmo e restaurava depois. Dois defeitos, e o segundo e o que
// doia:
//
//   1. cada volta recompilava o programa INTEIRO e subia um CHROMIUM novo para
//      trocar UM arquivo -- 18 voltas, 84s medidos;
//   2. o mutante ficava GRAVADO no arquivo de producao quando o processo morria
//      no meio. A restauracao estava no corpo do laco, sem `finally`, e
//      `execSync` BLOQUEIA a thread do JS -- com SIGTERM (o sinal que um timeout
//      manda) o processo termina a volta em curso e aplica A SEGUINTE. Nao e
//      hipotese: a HMO-263 herdou um worktree com este MESMO `DivisaoDoGrupo.tsx`
//      mutado, e o `git status` mostrava um arquivo modificado -- a cara de
//      trabalho em andamento.
//
// Agora as voltas dividem um processo e um cache de AST
// (`criarBlocoDeMutantes`, HMO-319): so o arquivo mutado e reparseado, e a
// mutacao vai para uma SOMBRA em diretorio temporario. A arvore rastreada e o
// `.tmp-*` do repositorio nao sao tocados em momento nenhum, entao o pior caso
// de um processo morto e um diretorio orfao em /tmp.
//
// Por isso tambem sairam daqui a conferencia de "o arquivo voltou byte a byte?"
// e a restauracao final: nao ha mais escrita na arvore para conferir nem para
// desfazer.
//
// As etapas da suite saem do proprio `scripts["test:divisao-ui-dom"]` do
// package.json -- o comando que o CI roda --, e nao de uma receita repetida a
// mao aqui.
//
// A lista de mutantes abaixo NAO foi reescrita nem movida: o diff desta
// conversao nao toca uma linha dela.
import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const ALVO = "components/grupos/DivisaoDoGrupo.tsx";
const SUITE = "test:divisao-ui-dom";

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela.
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  // --- o handler ligado na conta: o que so o navegador ve ---
  [
    "o campo numerico nao rebalanceia (so escreve o proprio valor)",
    "  const mexer = useCallback((memberId: string, centesimos: number) => {\n    setSalvo(false);\n    setPesos((atuais) => rebalancear(atuais, memberId, centesimos));\n  }, []);",
    "  const mexer = useCallback((memberId: string, centesimos: number) => {\n    setSalvo(false);\n    setPesos((atuais) =>\n      atuais.map((p) =>\n        p.member_id === memberId ? { ...p, centesimos } : p\n      )\n    );\n  }, []);",
  ],
  [
    "o onChange do campo numerico e um no-op",
    "                      mexer(p.member_id, centesimosDigitados(e.target.value))",
    "                      undefined",
  ],
  [
    "o onChange do range e um no-op (so o campo rebalancearia)",
    "                    mexer(p.member_id, Number(e.target.value) * 100)",
    "                    undefined",
  ],
  [
    "o range manda ponto percentual onde a fase 1 espera centesimo de ponto",
    "                    mexer(p.member_id, Number(e.target.value) * 100)",
    "                    mexer(p.member_id, Number(e.target.value))",
  ],
  [
    "o campo le o texto sem extrair digito (a virgula que ele exibe vira NaN)",
    '  const digitos = texto.replace(/\\D/g, "").replace(/^0+/, "").slice(0, 5);',
    "  const digitos = texto;",
  ],
  [
    "o campo le o texto como PONTO percentual, nao como centesimo de ponto",
    "  return dePercentual(Number(digitos || 0) / 100);",
    "  return dePercentual(Number(digitos || 0));",
  ],
  [
    "o campo volta a ser type=number (a virgula zera a parte do membro)",
    '                    type="text"\n                    id={`divisao-campo-${p.member_id}`}',
    '                    type="number"\n                    id={`divisao-campo-${p.member_id}`}',
  ],
  [
    "o rotulo e o campo passam a ter formatadores diferentes",
    "                    {textoDoPercentual(p.centesimos)}%",
    '                    {paraPercentual(p.centesimos).toFixed(1).replace(".", ",")}%',
  ],

  // --- a previa em reais: o peso errado da um numero plausivel e errado ---
  [
    "a previa em Igual passa a ratear pelos PERCENTUAIS (666,80 no lugar de 666,67)",
    '  return modo === "equal" ? 1 : peso.centesimos;',
    "  return peso.centesimos;",
  ],
  [
    "a previa em Proporcional passa a ratear igual (o slider nao move o R$)",
    '  return modo === "equal" ? 1 : peso.centesimos;',
    "  return 1;",
  ],
  [
    "a previa deixa de depender do peso (o R$ congela no primeiro render)",
    "      pesos.map((p) => ({ user_id: p.member_id, peso: pesoDaPrevia(modo, p) }))\n    );\n  }, [total, pesos, modo]);",
    "      pesos.map((p) => ({ user_id: p.member_id, peso: pesoDaPrevia(modo, p) }))\n    );\n    // eslint-disable-next-line react-hooks/exhaustive-deps\n  }, [total]);",
  ],

  // --- o que a tela ABRE mostrando: tem de concordar com o fechamento ---
  [
    "a tela confia no modo gravado em vez de perguntar o que o mes aplica",
    "  if (aplicada.aplicado === \"percentage\") {",
    '  if (gravado === "percentage") {',
  ],
  [
    "voltar para Igual deixa os percentuais de Proporcional na coluna",
    "        setPesos(igualitario(membros.map((m) => m.member_id)));",
    "        setPesos((atuais) => atuais);",
  ],
  [
    "abrir em Igual mostra o que esta na coluna, e nao a divisao igual",
    "    pesos: igualitario(membros.map((m) => m.member_id)),",
    "    pesos: aplicada.pesos.map((p) => ({\n      member_id: p.user_id,\n      centesimos: p.peso,\n    })),",
  ],

  // --- a trava do membro comum, que a rota cobra com 403 ---
  [
    "o campo numerico libera para quem nao e admin",
    '                    value={textoDoPercentual(p.centesimos)}\n                    disabled={!ehAdmin || modo === "equal"}',
    '                    value={textoDoPercentual(p.centesimos)}\n                    disabled={modo === "equal"}',
  ],
  [
    "o botao Salvar aparece para quem nao e admin",
    "      {ehAdmin ? (",
    "      {true ? (",
  ],

  // --- a linha da 025 ---
  [
    "o painel perde a linha sobre despesa ja lancada",
    '        <p className="text-sm text-muted-foreground" id="divisao-aviso-retroativo">',
    '        <p className="text-sm text-muted-foreground" id="divisao-aviso-sumiu">',
  ],

  // --- o rotulo do membro sem nome ---
  [
    "membro sem nome fica com um slider sem dono",
    '    (m.nome ?? "").trim() || "Membro do grupo";',
    '    (m.nome ?? "").trim();',
  ],
];

const bloco = criarBlocoDeMutantes({ rotulo: "divisao-ui-dom", suites: [SUITE] });

// A sombra vive em diretorio temporario, e a arvore rastreada nunca e mutada --
// era esse o modo de falha deste runner. O handler de sinal existe so para que
// nem o diretorio orfao sobre: `finally` nao roda em SIGTERM, mas
// `process.exit` dispara o `exit` abaixo.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// CONTROLE POSITIVO: a suite tem de estar VERDE no codigo intacto antes de
// qualquer mutante. Sem esta conferencia, uma suite quebrada por outro motivo
// mataria todos os mutantes de uma vez e o relatorio sairia perfeito. Ele passa
// pelo MESMO `rodar` dos mutantes, entao pega erro no proprio aparelho.
console.log("controle: a suite no codigo intacto...");
const controle = bloco.rodar("controle", {}, SUITE);
if (!controle.verde) {
  console.error(
    `A suite JA esta vermelha sem mutante nenhum (${controle.como}) -- conserte isso antes.\n` +
      controle.saida
  );
  process.exit(1);
}
console.log("OK   verde no codigo intacto\n");

let sobreviventes = 0;

for (const [nome, de, para] of mutantes) {
  // Um mutante que nao aplica passa por "morto" sem nunca ter existido: o
  // trecho mudou de forma, o replace nao acha nada, e a suite fica verde por
  // nao ter sido mexida. Conta como sobrevivente, de proposito.
  if (!original.includes(de)) {
    console.log(`??   ${nome}: o trecho nao existe mais -- mutante desatualizado`);
    sobreviventes++;
    continue;
  }

  const mutado = original.replace(de, para);

  // `replace` com string troca a PRIMEIRA ocorrencia. Se o trecho aparece mais
  // de uma vez, o mutante nao e o que o nome diz -- e o relatorio mentiria sobre
  // qual decisao foi testada.
  if (original.split(de).length > 2) {
    console.log(`??   ${nome}: o trecho aparece mais de uma vez -- ancora ambigua`);
    sobreviventes++;
    continue;
  }

  const r = bloco.rodar(nome, { [ALVO]: mutado }, SUITE);
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
