#!/usr/bin/env node
// Mutantes de lib/credito-de-grupo.ts -- HMO-245, fase 10.
//
// POR QUE ISTO EXISTE
// -------------------
// `npm run test:credito-de-grupo` passa com 17 blocos verdes nos dois fusos, e
// o bloco principal afirma que o Helio tem R$ 106,60 a receber da Lais e da
// Bia. Esse numero sai certo por caminhos errados: o mes do exemplo tem UMA
// conta e DOIS devedores com a mesma parte, entao somar o saldo em vez das
// linhas, ou trocar o lado da transferencia, devolve 106,60 do mesmo jeito.
// Cada mutante abaixo desfaz UMA decisao; o teste tem que ficar vermelho em
// todos.
//
// O MUTANTE QUE MAIS IMPORTA E O `total_do_saldo`
// ----------------------------------------------
// Havia duas maneiras de produzir o numero grande do cartao -- somar
// `por_membro[].saldo` positivo, ou somar as linhas por devedor -- e elas
// CONCORDAM em todo mes que fecha. E por isso que escolher a errada e barato e
// invisivel: o defeito so aparece no mes em que `simplifySettlements` descarta
// o centavo de tolerancia, e a unica forma de notar na tela seria somar a lista
// a mao. O mutante poe o residuo de volta no total; se o teste nao reclamar, a
// assercao do total nao esta medindo de onde ele vem.
//
// O SEGUNDO E O `credito_por_valor`
// ---------------------------------
// `SuggestedTransfer.amount` e sempre POSITIVO nos dois sentidos -- a
// transferencia em que eu pago a Ana tem o mesmo sinal da em que ela me paga.
// Filtrar por valor em vez de por `to_user_id` devolve as duas, e o mes em que
// eu DEVO R$ 300 aparece como R$ 300 a receber: o numero certo, com o sinal
// invertido, na tela de receita.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e compilada de uma arvore que nao e a do repositorio. Mutar, rodar e
// restaurar no `finally` deixa a fonte mutada no disco quando o processo morre no
// meio -- e `finally` nao roda em SIGTERM, o sinal que o `timeout` do shell e o
// cancelamento de job mandam.
//
// A COPIA DO lib/ INTEIRO DEIXOU DE EXISTIR (HMO-320)
// ---------------------------------------------------
// Este runner montava, A CADA MUTANTE, uma arvore nova em diretorio temporario
// com `lib/` INTEIRO copiado dentro, um `tsconfig.json` sintetizado com a lista
// dos tres modulos que o teste importa, e tres processos por cima (`npx tsc`,
// `resolve-aliases`, `node --test`). O `lib/` inteiro estava ali pelo motivo
// certo: o teste importa TRES modulos compilados (o credito, o fechamento que o
// alimenta e `parte-de-grupo-na-lista`, de onde sai o numero de verdade do cartao
// "Receitas"), e esses tres arrastam `settlement` e `movimentacoes` -- copiar so
// as dependencias de hoje quebra no dia em que alguem adiciona um import, e um
// mutante que nao COMPILA "morre" por motivo errado, o que faz o placar mentir A
// FAVOR.
//
// Mas copiar `lib/` nao fechava o buraco inteiro: a lista de `include` do
// tsconfig sintetizado continuava a mao, e um import novo para FORA de `lib/`
// (foi `@/types/financial` que pegou tres blocos deste repositorio) nao entrava
// na copia. `criarBlocoDeMutantes` nao recebe recorte nenhum -- espelha a arvore
// inteira por symlink e troca EM MEMORIA so o arquivo mutado. Quem delimita o
// que este bloco prova volta a ser o `scripts/tsconfig.credito-de-grupo-test.json`,
// o mesmo que o CI usa.
//
// E O PIPELINE PASSOU A SER O DO ALVO `test:credito-de-grupo`, que roda a suite
// em DOIS fusos. Este runner rodava em UM (`America/Sao_Paulo`, o negativo, com a
// nota de que um fuso basta para matar mutante). A nota estava certa sobre matar
// mutante e errada sobre o que o bloco mede: quem repete a receita a mao mede um
// pipeline que nao e mais o da suite, e nada reclama.
//
// COMO RODAR
//   npm run mutantes:credito-de-grupo

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const FONTE = "lib/credito-de-grupo.ts";
const SUITE = "test:credito-de-grupo";

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  {
    nome: "total_do_saldo",
    porque:
      "o total do cartao passa a ser o meu SALDO (linhas + residuo) em vez da " +
      "soma das linhas: o numero grande fica acima da soma dos nomes listados, " +
      "e a unica forma de achar a diferenca seria somar a lista a mao",
    de: "    (soma, l) => soma + l.cents,\n    0\n  );",
    para: "    (soma, l) => soma + l.cents,\n    semDevedorCents\n  );",
  },
  {
    nome: "credito_por_valor",
    porque:
      "filtra por valor positivo em vez de por `to_user_id` -- e `amount` e " +
      "positivo nos DOIS sentidos, entao o mes em que eu devo R$ 300 aparece " +
      "como R$ 300 a receber na tela de receita",
    de:
      "    .filter((t) => t.to_user_id === viewerUserId)\n" +
      "    .map((t) => ({",
    para:
      "    .filter((t) => (Number(t.amount) || 0) > 0)\n" +
      "    .map((t) => ({",
  },
  {
    nome: "lado_invertido",
    porque:
      "lista como devedor justamente quem eu tenho de PAGAR: a tela de receita " +
      "exibe a minha divida como credito meu",
    de:
      "    .filter((t) => t.to_user_id === viewerUserId)\n" +
      "    .map((t) => ({",
    para:
      "    .filter((t) => t.from_user_id === viewerUserId)\n" +
      "    .map((t) => ({",
  },
  {
    nome: "residuo_sem_piso",
    porque:
      "o mes em que eu DEVO produz residuo negativo, e num periodo misto ele " +
      "subtrai do residuo do mes em que eu recebo -- uma conta que nao " +
      "significa nada, escrita na tela como 'sem devedor identificado'",
    // OS DOIS `Math.max` DE UMA VEZ, E NAO UM DE CADA VEZ.
    //
    // Eles sao redundantes ENTRE SI: no mes em que eu devo, `nomeadoCents` e
    // zero (nao ha transferencia para mim), entao prender o saldo em zero antes
    // da subtracao e prender a diferenca depois chegam ao mesmo zero. Remover
    // so um sobrevive -- e sobrevive COM RAZAO, porque o outro ainda faz o
    // trabalho. Foi o que dois mutantes separados mostraram.
    //
    // A decisao que o modulo toma e uma so ("o residuo tem piso zero"), e e ela
    // que este mutante desfaz.
    de:
      "  const saldoCents = Math.max(0, toCents(saldo?.saldo ?? 0));",
    para: "  const saldoCents = toCents(saldo?.saldo ?? 0);",
    tambem: {
      de: "  return Math.max(0, saldoCents - nomeadoCents);",
      para: "  return saldoCents - nomeadoCents;",
    },
  },
  {
    nome: "nome_apagado",
    porque:
      "o nome que veio num mes e sumiu no outro (perfil que deixou de ser " +
      "legivel) APAGA o que a tela ja tinha, e a linha cai no rotulo de " +
      "fallback com o nome disponivel",
    de: "        atual.devedor = atual.devedor ?? linha.devedor;",
    para: "        atual.devedor = linha.devedor;",
  },
  {
    nome: "chave_sem_grupo",
    porque:
      "agrega so por devedor: a Lais me devendo na Casa e na Viagem vira UMA " +
      "linha, com o nome de um grupo so e o valor dos dois",
    de: "      const chave = `${linha.group_id}\\0${linha.devedor_user_id}`;",
    para: "      const chave = `${linha.devedor_user_id}`;",
  },
  {
    nome: "chave_sem_devedor",
    porque:
      "agrega so por grupo: a Lais e a Bia viram UMA linha de R$ 106,60 com o " +
      "nome de uma das duas -- a issue pede por grupo E por devedor",
    de: "      const chave = `${linha.group_id}\\0${linha.devedor_user_id}`;",
    para: "      const chave = `${linha.group_id}`;",
  },
  {
    nome: "soma_em_reais",
    porque:
      "acumula REAIS em ponto flutuante no lugar de centavos inteiros: doze " +
      "meses e tres grupos deixam residuo de fracao de centavo e o total chega " +
      "na tela diferente da soma visivel das linhas",
    de: "        porDevedor.set(chave, { ...linha, cents: toCents(linha.valor) });",
    para: "        porDevedor.set(chave, { ...linha, cents: linha.valor });",
  },
  {
    nome: "ordem_sem_desempate",
    porque:
      "dois devedores com o MESMO valor trocam de lugar entre dois " +
      "carregamentos da mesma tela, sem nada ter mudado",
    de:
      "    .sort(\n" +
      "      (a, b) =>\n" +
      "        b.cents - a.cents ||\n" +
      "        a.grupo.localeCompare(b.grupo) ||\n" +
      "        a.devedor_user_id.localeCompare(b.devedor_user_id)\n" +
      "    )",
    para: "    .sort((a, b) => b.cents - a.cents)",
  },
  {
    nome: "rotulo_em_branco",
    porque:
      "`full_name` com so espaco em branco -- que existe no banco -- passa o " +
      "teste de vazio e a linha sai com o rotulo EM BRANCO, que e exatamente o " +
      "defeito que o fallback existe para nao ter",
    de: '  const limpo = (linha.devedor ?? "").trim();',
    para: '  const limpo = linha.devedor ?? "";',
  },
  {
    nome: "nota_sem_grupos_distintos",
    porque:
      "a frase do cartao de Receitas conta LINHAS no lugar de grupos: a Lais e " +
      "a Bia na mesma Casa se leem como 'em 2 grupos'",
    de: "    grupos: new Set(credito.linhas.map((l) => l.group_id)).size,",
    para: "    grupos: credito.linhas.length,",
  },
  {
    nome: "nota_sempre_existe",
    porque:
      "quem nao participa de grupo nenhum passa a ler '+ R$ 0,00 a receber de " +
      "0 pessoas em 0 grupos' embaixo de Receitas -- ruido que parece recurso " +
      "quebrado",
    de: "  if (credito.linhas.length === 0) return null;",
    para: "  if (false) return null;",
  },
];
//
// NOTA SOBRE DOIS MUTANTES QUE NAO ENTRARAM SEPARADOS
// ---------------------------------------------------
// Os dois `Math.max(0, ...)` de `creditoSemDevedorCents` comecaram como dois
// mutantes, um por guarda. Os dois SOBREVIVERAM, e sobreviveram com razao: no
// mes em que eu devo, `nomeadoCents` e zero, entao prender o saldo em zero
// antes da subtracao e prender a diferenca depois chegam ao mesmo resultado --
// cada guarda cobre a outra, e nenhum teste consegue distinguir a remocao de
// uma so ([[mutante-sobrevivente-pode-estar-certo]]).
//
// Trocar os dois por um mutante unico (`residuo_sem_piso`) e o que mede a
// decisao de verdade, que e uma: o residuo tem piso zero. As duas guardas ficam
// no modulo -- redundancia barata em codigo de dinheiro --, mas o placar nao
// finge que ha duas decisoes onde ha uma.

const bloco = criarBlocoDeMutantes({ rotulo: "credito-de-grupo", suites: [SUITE] });
// A sombra vive em diretorio temporario e sai junto com o processo -- inclusive
// na saida antecipada do controle. No pior caso (SIGTERM) sobra um diretorio
// orfao em /tmp, e nao mutante em `lib/`.
process.on("exit", () => bloco.fechar());

let falhas = 0;

/** Uma volta do bloco com estas sobrescritas (`{}` = arvore intacta). */
const compilaERoda = (sobrescritas = {}) =>
  bloco.rodar("credito-de-grupo", sobrescritas, SUITE);

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
  // `credito_por_valor` e `lado_invertido` mutam o MESMO filtro, e o `.map(`
  // da linha de baixo e o que torna o trecho unico: o outro
  // `to_user_id === viewerUserId` do modulo e seguido de `.reduce(`.
  // `tambem` existe para o mutante que desfaz UMA decisao escrita em DOIS
  // lugares (ver `residuo_sem_piso`). Os dois trechos passam pela mesma
  // conferencia de unicidade -- um deles ficar sem casar transformaria o
  // mutante num mutante diferente do que o rotulo diz.
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
