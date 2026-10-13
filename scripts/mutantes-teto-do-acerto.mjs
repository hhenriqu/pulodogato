#!/usr/bin/env node
// Mutantes de lib/teto-do-acerto.ts -- HMO-404, item 1.
//
// POR QUE ISTO EXISTE
// -------------------
// `npm run test:teto-do-acerto` passa com 14 blocos verdes nos dois fusos, e o
// bloco principal afirma que o credito do C vai a zero e o do D fica em
// R$ 30,00. Esse par de numeros sai certo por caminhos errados: a fixture tem
// dois devedores com a MESMA parte, entao trocar o lado da comparacao ou
// agregar o acerto pelo grupo inteiro devolve 30,00 numa das duas linhas do
// mesmo jeito. Cada mutante abaixo desfaz UMA decisao; o teste tem que ficar
// vermelho em todos.
//
// O MUTANTE QUE MAIS IMPORTA E O `chave_sem_devedor`
// --------------------------------------------------
// Ele e a alternativa que a issue mandou NAO fazer e que a view do 007 convida
// a fazer: `group_member_balances.settlements_received` agrega todos os
// pagadores num numero so. Com UM devedor os dois criterios EMPATAM -- e por
// isso que a fixture tem dois, um que pagou e um que nao, e e so por isso que
// este mutante morre. Trocar a fixture por um devedor so o ressuscita sem
// nenhuma assercao mudar de cor.
//
// O SEGUNDO E O `min_virou_max`
// -----------------------------
// `min` e `max` sao a mesma palavra com o resultado invertido, e no caso em que
// o devedor NAO pagou nada os dois dao o mesmo numero (teto >= credito). O
// defeito so aparece em quem pagou: `max(30, 0) = 30` deixa a aba Receitas
// prometendo de novo os R$ 39,99 que a medicao da HMO-367 pegou em producao.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e compilada de uma arvore que nao e a do repositorio (ver
// mutantes-em-bloco.mjs). Mutar, rodar e restaurar no `finally` deixaria a
// fonte mutada no disco quando o processo morre no meio -- e `finally` nao roda
// em SIGTERM, o sinal que o `timeout` do shell e o cancelamento de job mandam.
//
// COMO RODAR
//   npm run mutantes:teto-do-acerto

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const FONTE = "lib/teto-do-acerto.ts";
const SUITE = "test:teto-do-acerto";

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  {
    nome: "min_virou_max",
    porque:
      "o teto passa a ser um PISO: quem pagou o acumulado inteiro continua " +
      "aparecendo pelo credito do mes, que e o defeito medido em producao na " +
      "HMO-367 (R$ 39,99 prometidos depois de um Pix de R$ 240,00)",
    de: "    const cents = Math.min(toCents(linha.valor), tetoCents);",
    para: "    const cents = Math.max(toCents(linha.valor), tetoCents);",
  },
  {
    nome: "teto_sem_piso",
    porque:
      "o acerto maior que o acumulado faz o teto ficar NEGATIVO, e o negativo " +
      "vira desconto: a linha entra com valor negativo e o acerto de um " +
      "devedor abate o que OUTRO me deve (total -10,00 onde o certo e 30,00)",
    // OS DOIS PISOS DE UMA VEZ, E NAO UM DE CADA VEZ.
    //
    // `Math.max(0, ...)` e o `if (cents <= 0) continue` sao redundantes ENTRE
    // SI: com o piso no teto, `cents` nunca fica negativo, e sem o piso o
    // `continue` ainda descarta a linha negativa. Remover um so SOBREVIVE, e
    // sobrevive com razao, porque o outro ainda faz o trabalho -- a mesma
    // conclusao que `residuo_sem_piso` registrou em mutantes-credito-de-grupo.
    //
    // A decisao que o modulo toma e uma so ("o teto tem piso zero"), e e ela
    // que este mutante desfaz.
    de:
      "    const tetoCents = Math.max(\n" +
      "      0,\n" +
      "      (acumuladoPorPar.get(chave) ?? 0) - (acertos.get(chave) ?? 0)\n" +
      "    );",
    para:
      "    const tetoCents =\n" +
      "      (acumuladoPorPar.get(chave) ?? 0) - (acertos.get(chave) ?? 0);",
    tambem: {
      de: "    if (cents <= 0) continue;",
      para: "    if (false) continue;",
    },
  },
  {
    nome: "acerto_somado",
    porque:
      "soma o acerto no lugar de subtrair: pagar AUMENTA o teto, entao o " +
      "credito nunca cai -- o defeito da issue com o sinal invertido, e " +
      "invisivel porque o teto maior so faz o `min` virar no-op",
    de: "      (acumuladoPorPar.get(chave) ?? 0) - (acertos.get(chave) ?? 0)",
    para: "      (acumuladoPorPar.get(chave) ?? 0) + (acertos.get(chave) ?? 0)",
  },
  {
    nome: "chave_sem_devedor",
    porque:
      "agrega acerto e acumulado por GRUPO, que e o que a view do 007 ja faz " +
      "(`settlements_received` soma todos os pagadores): o Pix do C abate o " +
      "que o D me deve, e o D sai da tela devendo zero",
    de: "  return `${groupId}\\0${devedorUserId}`;",
    para: "  return `${groupId}`;",
  },
  {
    nome: "teto_no_total",
    porque:
      "aplica o teto ao TOTAL em vez de linha por linha: as linhas voltam " +
      "cruas (o C que pagou tudo reaparece na lista) e o numero grande deixa " +
      "de ser a soma das linhas -- criterio da HMO-275",
    de: "    const cents = Math.min(toCents(linha.valor), tetoCents);",
    para: "    const cents = toCents(linha.valor);",
    tambem: {
      de: "  const totalCents = presas.reduce((soma, l) => soma + l.cents, 0);",
      para:
        "  const totalCents = Math.min(\n" +
        "    presas.reduce((soma, l) => soma + l.cents, 0),\n" +
        "    Math.max(\n" +
        "      0,\n" +
        "      toCents(acumulado.total) -\n" +
        "        Array.from(acertos.values()).reduce((s, v) => s + v, 0)\n" +
        "    )\n" +
        "  );",
    },
  },
  {
    nome: "acerto_sem_cambio",
    porque:
      "ignora a cotacao congelada do acerto: US$ 12,00 pagos a 5,00 abatem " +
      "R$ 12,00 em vez de R$ 60,00, e o credito fica inflado em quase cinco " +
      "vezes sem nenhum erro -- a pegadinha da 026",
    de: "    porPar.set(chave, (porPar.get(chave) ?? 0) + toCents(valor * cotacao));",
    para: "    porPar.set(chave, (porPar.get(chave) ?? 0) + toCents(valor));",
  },
  {
    nome: "cotacao_sem_fallback",
    porque:
      "`exchange_rate` nulo (a linha gravada antes da 026) multiplica por " +
      "`null`, o acerto em real vira R$ 0,00 e deixa de abater qualquer coisa",
    de: "    const cotacao = Number(acerto.exchange_rate ?? 1) || 1;",
    para: "    const cotacao = Number(acerto.exchange_rate);",
  },
  {
    nome: "acerto_nao_soma",
    porque:
      "sobrescreve em vez de somar: dois Pix do mesmo devedor passam a abater " +
      "so o ultimo, e quem pagou em duas vezes continua devendo a primeira",
    de: "    porPar.set(chave, (porPar.get(chave) ?? 0) + toCents(valor * cotacao));",
    para: "    porPar.set(chave, toCents(valor * cotacao));",
  },
  {
    nome: "ordem_herdada",
    porque:
      "mantem a ordem que `creditoAReceber` devolveu, que e a do valor ANTES " +
      "do teto: a tela lista R$ 10,00 acima de R$ 100,00 sem nada ter mudado " +
      "nos dados",
    de:
      "  const linhas = presas\n" +
      "    .sort(\n" +
      "      (a, b) =>\n" +
      "        b.cents - a.cents ||\n" +
      "        a.grupo.localeCompare(b.grupo) ||\n" +
      "        a.devedor_user_id.localeCompare(b.devedor_user_id)\n" +
      "    )\n" +
      "    .map(({ cents, ...linha }) => linha);",
    para: "  const linhas = presas.map(({ cents, ...linha }) => linha);",
  },
  {
    nome: "acumulado_pelo_total",
    porque:
      "usa o total do acumulado para TODOS os devedores em vez do acumulado " +
      "do par: o teto de cada um passa a ser a soma de todo mundo, e o acerto " +
      "do C deixa de morder o credito dele",
    de: "    const tetoCents = Math.max(\n      0,\n      (acumuladoPorPar.get(chave) ?? 0) - (acertos.get(chave) ?? 0)\n    );",
    para: "    const tetoCents = Math.max(\n      0,\n      toCents(acumulado.total) - (acertos.get(chave) ?? 0)\n    );",
  },
  {
    nome: "soma_em_reais",
    porque:
      "acumula REAIS em ponto flutuante no lugar de centavos inteiros: tres " +
      "acertos de R$ 0,10 viram 0,30000000000000004 e o teto deixa de bater " +
      "com a soma que a pessoa faz a mao",
    de: "    porPar.set(chave, (porPar.get(chave) ?? 0) + toCents(valor * cotacao));",
    para: "    porPar.set(chave, (porPar.get(chave) ?? 0) + valor * cotacao);",
  },
];
//
// DOIS MUTANTES QUE NAO ENTRARAM, E POR QUE
// -----------------------------------------
// 1. `if (!Number.isFinite(valor) || valor <= 0) continue;` -- a 007 tem
//    `CHECK (amount > 0)` e a 026 tem `CHECK (exchange_rate > 0)`, entao
//    nenhuma linha do banco cai nesse ramo. Um mutante ali mediria um estado
//    inalcancavel: ele sobreviveria, e sobreviveria com razao
//    ([[trava-pode-proteger-estado-inalcancavel]]). A guarda fica no modulo
//    porque `numeric` chega como STRING do PostgREST e `Number("")` e 0 -- nao
//    `NaN` --, mas o placar nao finge que ha medida onde nao ha.
// 2. `sem_devedor: doPeriodo.sem_devedor` -- trocar por `0` ou pelo do
//    acumulado e uma decisao de rotulo sobre um residuo de CENTAVOS, e a suite
//    que o mediria teria de cravar o centavo de tolerancia de
//    `simplifySettlements` como numero. O bloco "`sem_devedor` passa intacto"
//    cobre a decisao; mutar o campo mediria a assercao, nao o dinheiro.

const bloco = criarBlocoDeMutantes({ rotulo: "teto-do-acerto", suites: [SUITE] });
// A sombra vive em diretorio temporario e sai junto com o processo -- inclusive
// na saida antecipada do controle. No pior caso (SIGTERM) sobra um diretorio
// orfao em /tmp, e nao mutante em `lib/`.
process.on("exit", () => bloco.fechar());

let falhas = 0;

/** Uma volta do bloco com estas sobrescritas (`{}` = arvore intacta). */
const compilaERoda = (sobrescritas = {}) =>
  bloco.rodar("teto-do-acerto", sobrescritas, SUITE);

// CONTROLE POSITIVO: com a fonte intacta o teste tem de PASSAR. Sem isto, um
// "todos morreram" poderia significar apenas que o build esta quebrado e o
// teste reprova sempre.
const controle = compilaERoda();
if (controle.verde) {
  console.log("controle positivo: o teste passa com a fonte intacta\n");
} else {
  console.error("ABORTADO: o teste reprova com a fonte INTACTA.");
  console.error(`  (${controle.como}) ${controle.saida}`);
  process.exit(1);
}

for (const m of MUTANTES) {
  // `String.replace` troca a PRIMEIRA ocorrencia. Um trecho que aparece duas
  // vezes produz um mutante que muta o lugar errado e morre verde com o
  // rotulo mentindo sobre o que foi medido -- por isso o trecho tem de ser
  // unico, e nao apenas existir.
  //
  // `acerto_sem_cambio`, `acerto_nao_soma` e `soma_em_reais` mutam a MESMA
  // linha do `porPar.set`, cada um desfazendo uma decisao diferente dela
  // (converter, acumular, usar centavos). `tambem` existe para o mutante que
  // desfaz UMA decisao escrita em DOIS lugares (ver `teto_sem_piso`).
  const trechos = [
    { de: m.de, para: m.para },
    ...(m.tambem ? [m.tambem] : []),
  ];

  let mutado = original;
  let invalido = null;

  for (const t of trechos) {
    const ocorrencias = mutado.split(t.de).length - 1;
    if (ocorrencias === 0) {
      invalido = `o trecho a mutar NAO EXISTE MAIS (${t.de.trim().slice(0, 50)})`;
      break;
    }
    if (ocorrencias > 1) {
      invalido = `o trecho aparece ${ocorrencias}x -- ambiguo (${t.de
        .trim()
        .slice(0, 50)})`;
      break;
    }
    mutado = mutado.replace(t.de, t.para);
  }

  if (invalido) {
    console.log(`  !! ${m.nome}: ${invalido} -- mutante invalido`);
    falhas++;
    continue;
  }
  // A mutacao tem de MUDAR o arquivo. `de === para` por descuido numa
  // refatoracao produz um "mutante" identico a fonte, que sobrevive sempre e
  // se le como furo de cobertura.
  if (mutado === original) {
    console.log(`  !! ${m.nome}: a mutacao nao alterou nada -- invalido`);
    falhas++;
    continue;
  }

  const r = compilaERoda({ [FONTE]: mutado });

  if (r.verde) {
    console.log(`  SOBREVIVEU  ${m.nome}  <-- nenhuma assercao protege isto`);
    console.log(`              (${m.porque})`);
    // Sobreviver emitindo byte IDENTICO ao da arvore limpa nao e furo de
    // assercao: e mutante equivalente, e nenhuma assercao o mataria.
    if (r.mudouASaida === false) {
      console.log(
        "              (saida compilada identica a da arvore limpa: EQUIVALENTE, nao furo)"
      );
    }
    falhas++;
  } else {
    // Nem compilar continua contando como morto aqui, como antes -- mas agora
    // isso aparece na linha, e nao se esconde atras de um `catch` vazio.
    console.log(`  morreu      ${m.nome}  (${r.como})`);
  }
}

console.log();
if (falhas === 0) {
  console.log(`todos os ${MUTANTES.length} mutantes morreram`);
} else {
  console.log(`${falhas} mutante(s) sobreviveu/sobreviveram ou sao invalidos`);
  process.exit(1);
}
