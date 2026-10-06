#!/usr/bin/env node
// Prova de mutacao do components/grupos/DivisaoDoGrupo.tsx -- a FIACAO do painel
// de divisao (HMO-271 / HMO-245 fase 5). NAO roda em CI: e ferramenta de quem
// esta escrevendo o teste. Cada entrada estraga uma ligacao da tela; a suite
// `test:divisao-ui-dom` tem que ficar VERMELHA em todas.
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
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVO = "components/grupos/DivisaoDoGrupo.tsx";
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

// CONTROLE NEGATIVO: a suite tem de estar VERDE no codigo intacto antes de
// qualquer mutante. Sem esta conferencia, uma suite quebrada por outro motivo
// mataria os 15 mutantes de uma vez e o relatorio sairia perfeito.
console.log("controle: a suite no codigo intacto...");
try {
  execSync("npm run test:divisao-ui-dom", { stdio: "pipe" });
  console.log("OK   verde no codigo intacto\n");
} catch (e) {
  console.error(
    "A suite JA esta vermelha sem mutante nenhum -- conserte isso antes.\n" +
      String(e.stdout ?? e)
  );
  process.exit(1);
}

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

  writeFileSync(ALVO, mutado);

  let vermelho = false;
  try {
    execSync("npm run test:divisao-ui-dom", { stdio: "pipe" });
  } catch {
    vermelho = true;
  }

  writeFileSync(ALVO, original);

  // O arquivo tem de voltar BYTE A BYTE. Sem esta conferencia um erro de
  // escrita deixaria o mutante no disco, e o proximo run mediria outra coisa.
  if (readFileSync(ALVO, "utf8") !== original) {
    console.error("o arquivo NAO voltou ao original -- pare e confira o git diff");
    process.exit(2);
  }

  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) sobreviventes++;
}

writeFileSync(ALVO, original);

console.log(
  `\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`
);
process.exit(sobreviventes === 0 ? 0 : 1);
