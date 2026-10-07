#!/usr/bin/env node
// Prova de mutacao do lib/divisao-configurada.ts (HMO-245, fase 1). NAO roda em
// CI: e ferramenta de quem esta escrevendo o teste. Cada entrada abaixo estraga
// uma decisao do arquivo; a suite tem que ficar VERMELHA em todas. Mutante que
// sobrevive e um trecho que nenhum teste distingue -- ou codigo morto.
//
//   node scripts/mutantes-divisao-configurada.mjs
//
// O mutante que a issue pede por nome e `MAIOR RESTO -> ARREDONDAMENTO`. Ele e
// o controle negativo da entrega: se ele sobreviver, a suite nao prova que a
// configuracao soma 100% cravado, e um residual de um centesimo entra no
// fechamento do mes sem aparecer em tela nenhuma.
//
// TRES COISAS QUE ESTE RUNNER FAZ E QUE O OBVIO NAO FAZ
// -----------------------------------------------------
// 1. CONFERE QUE A ARVORE ESTA VERDE ANTES DE COMECAR. Com a suite ja vermelha,
//    TODO mutante "morre" -- e o relatorio sai 100% com zero informacao. Este e
//    o controle POSITIVO, e ele e a primeira coisa a rodar.
//
// 2. EXIGE QUE A ANCORA APAREÇA EXATAMENTE UMA VEZ. `String.replace` com string
//    troca so a PRIMEIRA ocorrencia. Uma ancora que casa em dois lugares muta o
//    lugar errado, a suite fica vermelha de qualquer jeito, e o mutante e dado
//    por morto com o rotulo mentindo sobre o que foi provado.
//
// 3. CONFERE QUE O ARQUIVO MUDOU DE VERDADE. Ancora que nao casa mais (porque o
//    codigo foi reescrito) deixaria a suite intacta e VERDE -- "morto" sem nunca
//    ter existido. Aqui isso e sobrevivente, e com a razao dita no relatorio.
//
// O restore do fonte e a ultima linha, fora de qualquer try/catch com
// `process.exit` dentro: um `exit` dentro de `try` pula o `finally` e deixaria
// lib/divisao-configurada.ts MUTADO no worktree.
import { writeFileSync } from "node:fs";
import { protegerArvore } from "./auto-cura-de-mutante.mjs";
import { execSync } from "node:child_process";

const ALVO = "lib/divisao-configurada.ts";
const SUITE = "npm run test:divisao-configurada";
// O original vem do helper, e nao de um `readFileSync` aqui, para a leitura
// acontecer DEPOIS da auto-cura -- ver o contrato de ordem no cabecalho dele.
const { originais, encerrar } = protegerArvore({
  runner: "divisao-configurada",
  arquivos: [ALVO],
});
const original = originais[ALVO];

/** Roda a suite. `true` = vermelha. */
function vermelha() {
  try {
    execSync(SUITE, { stdio: "pipe" });
    return false;
  } catch {
    return true;
  }
}

const mutantes = [
  // =======================================================================
  // O CONTROLE NEGATIVO QUE A ISSUE PEDE: maior resto -> arredondamento
  // =======================================================================
  [
    "MAIOR RESTO -> ARREDONDAMENTO (a config passa a somar 100,01%)",
    "  const base = efetivos.map((p) => Math.floor((total * p) / soma));",
    "  const base = efetivos.map((p) => Math.round((total * p) / soma));",
  ],
  [
    "maior resto -> teto (a config passa a somar mais de 100%)",
    "  const base = efetivos.map((p) => Math.floor((total * p) / soma));",
    "  const base = efetivos.map((p) => Math.ceil((total * p) / soma));",
  ],
  [
    "o centesimo que sobra deixa de ser distribuido (a config soma 99,99%)",
    "    centesimos[i] += 1;\n    sobra -= 1;",
    "    centesimos[i] += 0;\n    sobra -= 1;",
  ],
  [
    "a sobra toda vai para um unico membro",
    "    centesimos[i] += 1;\n    sobra -= 1;",
    "    centesimos[i] += sobra;\n    sobra = 0;",
  ],
  [
    "o centesimo vai para o MENOR resto",
    "        ? b.resto - a.resto",
    "        ? a.resto - b.resto",
  ],
  [
    "o desempate por member_id some (a mesma config grava numeros diferentes)",
    "  const ordem = ids\n    .map((member_id, i) => ({ i, resto: restos[i], member_id }))\n    .sort((a, b) =>\n      b.resto !== a.resto\n        ? b.resto - a.resto\n        : a.member_id < b.member_id\n          ? -1\n          : a.member_id > b.member_id\n            ? 1\n            : 0\n    );",
    "  const ordem = ids\n    .map((member_id, i) => ({ i, resto: restos[i], member_id }))\n    .sort((a, b) => b.resto - a.resto);",
  ],
  [
    "o desempate inverte (maior member_id leva o centesimo)",
    "        : a.member_id < b.member_id\n          ? -1\n          : a.member_id > b.member_id\n            ? 1\n            : 0",
    "        : a.member_id > b.member_id\n          ? -1\n          : a.member_id < b.member_id\n            ? 1\n            : 0",
  ],
  // Nao ha mutante trocando o resto inteiro pela parte fracionaria em float:
  // ele SOBREVIVE, e com razao -- as duas formas diferem por um fator positivo
  // e constante dentro de uma chamada, entao ORDENAM IGUAL. Mutante equivalente
  // nao e lacuna de teste, e o relatorio ficaria mentindo sobre uma.

  // =======================================================================
  // O DEGRAU DO 0/0 -- o NaN% na tela
  // =======================================================================
  [
    "o degrau da divisao igual some (todos em zero viram NaN%)",
    "  const efetivos = somaPesos > 0 ? pesos : pesos.map(() => 1);\n  const soma = somaPesos > 0 ? somaPesos : pesos.length;",
    "  const efetivos = pesos;\n  const soma = somaPesos;",
  ],
  [
    "o degrau passa a valer sempre (a proporcao entre os outros e ignorada)",
    "  const efetivos = somaPesos > 0 ? pesos : pesos.map(() => 1);\n  const soma = somaPesos > 0 ? somaPesos : pesos.length;",
    "  const efetivos = pesos.map(() => 1);\n  const soma = pesos.length;",
  ],

  // =======================================================================
  // A SOBRA: quanto vai para os outros
  // =======================================================================
  [
    "os outros recebem 100% em vez da sobra (a config soma mais de 100%)",
    "  const outros = distribuir(outrosIds, outrosPesos, CENTESIMOS_TOTAIS - pedido);",
    "  const outros = distribuir(outrosIds, outrosPesos, CENTESIMOS_TOTAIS);",
  ],
  [
    "a sobra e calculada sobre o que o membro TINHA, e nao sobre o que pediu",
    "  const outros = distribuir(outrosIds, outrosPesos, CENTESIMOS_TOTAIS - pedido);",
    "  const outros = distribuir(outrosIds, outrosPesos, CENTESIMOS_TOTAIS - pesos[alvo]);",
  ],
  [
    "100% na unidade errada (10000 trocado por 100)",
    "export const CENTESIMOS_TOTAIS = 10000;",
    "export const CENTESIMOS_TOTAIS = 100;",
  ],

  // =======================================================================
  // O GRUPO DE UM MEMBRO
  // =======================================================================
  [
    "grupo de um membro devolve o pedido (lista que soma menos de 100%)",
    "  if (ids.length === 1) {\n    return [{ member_id: ids[0], centesimos: CENTESIMOS_TOTAIS }];\n  }",
    "  if (ids.length === 1) {\n    return [{ member_id: ids[0], centesimos: pedido }];\n  }",
  ],
  [
    "a guarda do grupo de um membro some",
    "  if (ids.length === 1) {\n    return [{ member_id: ids[0], centesimos: CENTESIMOS_TOTAIS }];\n  }",
    "  if (false) {\n    return [{ member_id: ids[0], centesimos: CENTESIMOS_TOTAIS }];\n  }",
  ],

  // =======================================================================
  // O TETO E O PISO DO QUE O SLIDER PEDE
  // =======================================================================
  [
    "o teto de 100% some (percentage > 100 e 23514 nas duas tabelas)",
    "  if (arredondado >= CENTESIMOS_TOTAIS) return CENTESIMOS_TOTAIS;",
    "  if (false) return CENTESIMOS_TOTAIS;",
  ],
  [
    "o piso de zero some (porcentagem negativa na config)",
    "  if (arredondado <= 0) return 0;",
    "  if (false) return 0;",
  ],
  [
    "o pedido deixa de ser arredondado para inteiro",
    "  const arredondado = Math.round(valor);",
    "  const arredondado = valor;",
  ],
  [
    "pedido nao numerico deixa de ser detectado (NaN atravessa como pedido)",
    'function centesimosPedidos(valor: unknown): number | null {\n  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;',
    "function centesimosPedidos(valor: unknown): number | null {\n  if (false) return null;",
  ],
  [
    "pedido invalido deixa de cair na normalizacao (NaN vira o peso do membro)",
    "  if (alvo < 0 || pedido === null) {",
    "  if (alvo < 0) {",
  ],
  [
    "membro fora da lista deixa de cair na normalizacao",
    "  if (alvo < 0 || pedido === null) {",
    "  if (pedido === null) {",
  ],

  // =======================================================================
  // O PESO QUE CHEGA DE FORA
  // =======================================================================
  [
    "peso negativo passa (inverte a proporcao de quem sobrou)",
    '  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) {\n    return 0;\n  }',
    '  if (typeof valor !== "number") {\n    return 0;\n  }',
  ],
  [
    "peso NaN passa (contamina a soma inteira)",
    "|| !Number.isFinite(valor) || valor <= 0) {",
    "|| valor <= 0) {",
  ],
  // Nao ha mutante sobre arredondar o PESO: `pesoLimpo` nao arredonda, porque o
  // peso so e usado como razao e o `Math.floor` de `distribuir` e que garante
  // centesimo inteiro na saida. O arredondamento estava la na primeira versao,
  // sobreviveu ao mutante, e foi TIRADO -- e nao coberto por um teste novo. O
  // arredondamento do PEDIDO, logo acima, e outra coisa: ele vai direto para a
  // saida, entao ele muda o resultado e tem teste.

  // =======================================================================
  // A ORDEM DA LISTA (os sliders saltando debaixo do dedo)
  // =======================================================================
  [
    "a ordem da lista deixa de ser preservada (o membro mexido vai para o fim)",
    "  const resultado: PesoDoMembro[] = [];\n  let k = 0;\n  for (let i = 0; i < ids.length; i++) {\n    resultado.push(\n      i === alvo ? { member_id: ids[i], centesimos: pedido } : outros[k++]\n    );\n  }\n  return resultado;",
    "  return [...outros, { member_id: ids[alvo], centesimos: pedido }];",
  ],

  // =======================================================================
  // O DEGRAU QUE VIRA DINHEIRO: 0% SAI DA DIVISAO DA DESPESA
  // =======================================================================
  [
    "membro em 0% volta a entrar na despesa com parte zerada (23514 no INSERT)",
    "      .filter((m) => m.peso > 0)",
    "      .filter((m) => m.peso >= 0)",
  ],
  [
    "a conferencia da soma na leitura some (a despesa fecha 96% do valor)",
    "  if (soma !== CENTESIMOS_TOTAIS) {\n    return {\n      ok: false,\n      erro:",
    "  if (false) {\n    return {\n      ok: false,\n      erro:",
  ],
  [
    "a conferencia da soma aceita um centesimo de diferenca",
    "  if (soma !== CENTESIMOS_TOTAIS) {\n    return {\n      ok: false,\n      erro:",
    "  if (Math.abs(soma - CENTESIMOS_TOTAIS) > 1) {\n    return {\n      ok: false,\n      erro:",
  ],
  [
    "a despesa grava centesimos crus no lugar da porcentagem (7000 em vez de 70)",
    "        percentage: paraPercentual(peso),",
    "        percentage: peso,",
  ],

  // =======================================================================
  // A IDA E VOLTA PELO numeric(5,2)
  // =======================================================================
  [
    "dePercentual deixa de arredondar (33,33% volta como 3332 centesimos)",
    "  const centesimos = Math.round(percentual * 100);",
    "  const centesimos = percentual * 100;",
  ],
  [
    "dePercentual perde o teto",
    "  if (centesimos >= CENTESIMOS_TOTAIS) return CENTESIMOS_TOTAIS;",
    "  if (false) return CENTESIMOS_TOTAIS;",
  ],
  [
    "dePercentual aceita valor nao numerico como zero sem dizer",
    '  if (typeof percentual !== "number" || !Number.isFinite(percentual)) return 0;',
    '  if (typeof percentual !== "number") return 0;',
  ],
  [
    "paraPercentual erra a escala",
    "  return centesimos / 100;",
    "  return centesimos / 10000;",
  ],

  // =======================================================================
  // O ESTADO INICIAL DA TELA
  // =======================================================================
  [
    "igualitario deixa de somar 100% (divide 100 em vez de 10000)",
    "  return distribuir(\n    ids,\n    ids.map(() => 1),\n    CENTESIMOS_TOTAIS\n  );",
    "  return distribuir(\n    ids,\n    ids.map(() => 1),\n    100\n  );",
  ],

  // =======================================================================
  // A PORTA DE ENTRADA DA ROTA: conferirConfiguracao (HMO-269, fase 3)
  // =======================================================================
  // Cada uma destas estraga uma recusa do PUT /split-config. Todas produzem o
  // MESMO sintoma em producao -- um 200, com um numero errado gravado na
  // coluna que a fase 4 passa a usar como peso do rateio do mes.
  [
    "a soma deixa de ser conferida por baixo (99,99% passa)",
    "  if (soma !== CENTESIMOS_TOTAIS) {\n    return { ok: false, recusa: { motivo: \"soma\", centesimos: soma } };",
    "  if (soma > CENTESIMOS_TOTAIS) {\n    return { ok: false, recusa: { motivo: \"soma\", centesimos: soma } };",
  ],
  [
    "a soma deixa de ser conferida por cima (100,01% passa)",
    "  if (soma !== CENTESIMOS_TOTAIS) {\n    return { ok: false, recusa: { motivo: \"soma\", centesimos: soma } };",
    "  if (soma < CENTESIMOS_TOTAIS) {\n    return { ok: false, recusa: { motivo: \"soma\", centesimos: soma } };",
  ],
  [
    "a soma e conferida em FLOAT (33,333 x3 passa e grava 99,99)",
    "  const centesimos = idsAtivos.map((id) => dePercentual(pedidoPorId.get(id)));\n  const soma = centesimos.reduce((acc, c) => acc + c, 0);",
    "  const centesimos = idsAtivos.map((id) => (pedidoPorId.get(id) ?? 0) * 100);\n  const soma = Math.round(centesimos.reduce((acc, c) => acc + c, 0));",
  ],
  [
    "grava o numero do CORPO em vez do normalizado",
    "      percentage: paraPercentual(centesimos[i]),",
    "      percentage: pedidoPorId.get(member_id),",
  ],
  [
    "membro repetido deixa de ser recusado (o ultimo vence, o outro some)",
    '    if (pedidoPorId.has(p.member_id)) {\n      return { ok: false, recusa: { motivo: "repetido" } };\n    }',
    '    if (false) {\n      return { ok: false, recusa: { motivo: "repetido" } };\n    }',
  ],
  [
    "membro ativo esquecido pelo corpo deixa de ser recusado",
    "  if (faltando.length > 0 || sobrando.length > 0) {",
    "  if (sobrando.length > 0) {",
  ],
  [
    "membro inventado no corpo deixa de ser recusado",
    "  if (faltando.length > 0 || sobrando.length > 0) {",
    "  if (faltando.length > 0) {",
  ],
  [
    "membro em 0% some da configuracao (a linha dele fica com o valor VELHO)",
    "    porMembro: idsAtivos.map((member_id, i) => ({\n      member_id,\n      percentage: paraPercentual(centesimos[i]),\n    })),",
    "    porMembro: idsAtivos\n      .map((member_id, i) => ({\n        member_id,\n        percentage: paraPercentual(centesimos[i]),\n      }))\n      .filter((m) => m.percentage > 0),",
  ],
  [
    "a saida sai na ordem do CORPO, nao na do banco",
    "    porMembro: idsAtivos.map((member_id, i) => ({\n      member_id,\n      percentage: paraPercentual(centesimos[i]),\n    })),",
    "    porMembro: pedidos.map((p) => ({\n      member_id: p.member_id,\n      percentage: paraPercentual(dePercentual(p.percentage)),\n    })),",
  ],

  // -------------------------------------------------------------------------
  // `divisaoDoPeriodo` -- a config virando peso do fechamento (fase 4)
  // -------------------------------------------------------------------------
  [
    "config que NAO soma 100% passa a valer, e o mes e rateado numa proporcao que ninguem configurou",
    '    configurado === "percentage" && soma === CENTESIMOS_TOTAIS',
    '    configurado === "percentage"',
  ],
  [
    "o modo e ignorado: grupo em `equal` passa a ser rateado pela coluna `percentage` que ninguem pediu para usar",
    '    configurado === "percentage" && soma === CENTESIMOS_TOTAIS',
    "    soma === CENTESIMOS_TOTAIS",
  ],
  [
    "divisao igual passa a mandar peso ZERO em vez de 1 -- o fechamento so acerta se o degrau do 0/0 dele estiver intacto",
    '      peso: aplicado === "percentage" ? centesimos[i] : 1,',
    '      peso: aplicado === "percentage" ? centesimos[i] : 0,',
  ],
  [
    "o peso sai sempre do percentual gravado, inclusive em `equal`: grupo nao configurado manda os quatro zeros do DEFAULT para o fechamento",
    '      peso: aplicado === "percentage" ? centesimos[i] : 1,',
    "      peso: centesimos[i],",
  ],
  [
    "`percentage` que chega como string vale ZERO, e a divisao configurada nunca vale -- sem erro e sem log",
    '      typeof m.percentage === "string" ? Number(m.percentage) : m.percentage',
    "      m.percentage",
  ],
  [
    "`configurado` passa a repetir `aplicado`, e a tela mostra 'igual' sobre um grupo configurado de outro jeito",
    "    configurado,\n    aplicado,",
    "    configurado: aplicado,\n    aplicado,",
  ],
  [
    "`soma_centesimos` vira a soma ESPERADA em vez da gravada, e a tela perde o numero pelo qual cobra o ajuste",
    "    soma_centesimos: soma,",
    "    soma_centesimos: CENTESIMOS_TOTAIS,",
  ],
  [
    "a ordem dos pesos deixa de ser a dos membros recebidos: a parte de um sai no nome do outro",
    '    pesos: membros.map((m, i) => ({\n      user_id: m.user_id,\n      peso: aplicado === "percentage" ? centesimos[i] : 1,\n    })),',
    '    pesos: [...membros].reverse().map((m, i) => ({\n      user_id: m.user_id,\n      peso: aplicado === "percentage" ? centesimos[i] : 1,\n    })),',
  ],
];

// ---------------------------------------------------------------------------
// CONTROLE POSITIVO: a arvore tem que estar VERDE antes do primeiro mutante.
// ---------------------------------------------------------------------------
// Sem isto, uma suite ja vermelha faz TODO mutante "morrer" e o relatorio sai
// 100% sem ter medido nada.
console.log("controle positivo: a suite esta verde sem mutante?");
if (vermelha()) {
  console.error(
    `\nA suite ja esta VERMELHA sem mutante nenhum. Nada aqui mediria nada --\n` +
      `todo mutante apareceria como morto. Conserte \`${SUITE}\` primeiro.`
  );
  process.exit(1);
}
console.log("   verde. medindo os mutantes.\n");

const sobreviventes = [];

for (const [nome, de, para] of mutantes) {
  // Ancora que nao casa mais: a suite ficaria intacta e VERDE, e o mutante
  // seria dado por morto sem nunca ter existido.
  const ocorrencias = original.split(de).length - 1;
  if (ocorrencias === 0) {
    console.log(`??  ${nome}\n    a ancora nao existe mais -- mutante desatualizado`);
    sobreviventes.push(nome);
    continue;
  }
  // Ancora ambigua: `replace` troca a PRIMEIRA ocorrencia, que pode nao ser a
  // que o rotulo descreve. Vermelho aqui provaria outra coisa.
  if (ocorrencias > 1) {
    console.log(
      `??  ${nome}\n    a ancora casa ${ocorrencias}x -- replace mutaria o lugar errado`
    );
    sobreviventes.push(nome);
    continue;
  }

  const mutado = original.replace(de, para);
  if (mutado === original) {
    console.log(`??  ${nome}\n    a troca nao mudou nada -- mutante vacuo`);
    sobreviventes.push(nome);
    continue;
  }

  writeFileSync(ALVO, mutado);
  const morreu = vermelha();
  console.log(`${morreu ? "OK  " : "VIVO"} ${nome}`);
  if (!morreu) sobreviventes.push(nome);
}

// A ultima coisa que este script faz.
encerrar();

console.log(
  `\n${mutantes.length - sobreviventes.length}/${mutantes.length} mutantes mortos`
);
if (sobreviventes.length > 0) {
  console.log("\nsobreviventes:");
  for (const n of sobreviventes) console.log(`  - ${n}`);
}
process.exit(sobreviventes.length === 0 ? 0 : 1);
