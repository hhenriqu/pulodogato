#!/usr/bin/env node
// =====================================================
// CONTROLE NEGATIVO DA CONTAGEM DE TRANSACOES DO GRUPO -- HMO-259
// =====================================================
//   npm run mutantes:contagem-do-grupo
//
// A suite `test:contagem-do-grupo` afirma IGUALDADES sobre numeros pequenos
// (12, 1, 0), e esse e o tipo de afirmacao que fica verde de graca: 12 e o
// resultado de mais de uma funcao errada, e `owed_count` sozinho -- que e uma
// das funcoes erradas -- acerta o caso da issue e todo grupo em que ninguem paga
// despesa sem se incluir no rateio. O placar daqui e o que separa "a suite
// mede a uniao" de "a suite viu 12 e gostou".
//
// O MUTANTE 1 E O DEFEITO DA ISSUE, LITERAL
// -----------------------------------------
// Ele nao desliga uma guarda: ele faz a chave de de-duplicacao da perna do PAGO
// ser diferente da chave da perna do RATEIO. E exatamente `paid_count +
// owed_count` escrito com conjuntos -- a mesma despesa entra duas vezes porque
// entra com dois nomes -- e devolve os 18/18/12 medidos em producao.
//
// A GUARDA QUE NAO ESTA NA LISTA, E POR QUE
// -----------------------------------------
// `if (!rateio.member_id) continue;` nao tem mutante aqui, e nao e esquecimento.
// Desligada, o `userIdPorMembro.get(undefined)` devolve `undefined` e o
// `if (!userId) return` de `participa` recusa a mesma linha -- duas guardas
// redundantes, mutante SEMANTICAMENTE IDENTICO a versao boa. Ele sobreviveria, e
// sobreviver estaria certo; um sobrevivente certo na lista ensina a nao ler o
// placar. O que a guarda compra e clareza no ponto onde o erro aconteceria, e e
// o `if (!userId)` que tem mutante (o 7).
//
// MUTA UMA SOMBRA, NUNCA A ARVORE
// -------------------------------
// `criarBlocoDeMutantes` (HMO-319) espelha o repositorio em /tmp e troca o
// arquivo mutado so la. Runner que muta `lib/` no lugar deixa o mutante gravado
// quando morre no meio -- aconteceu tres vezes neste repositorio, e e o que
// `scripts/check-mutacao-no-lugar.mjs` existe para impedir no proximo.
// =====================================================

import { readFileSync } from "node:fs";
import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const FONTE = "lib/contagem-do-grupo.ts";

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  // -------------------------------------------------------------------------
  // O DEFEITO DA ISSUE
  // -------------------------------------------------------------------------
  {
    nome: "volta_a_somar_as_duas_pernas",
    porque:
      "O DEFEITO DA HMO-259, LITERAL. A perna do pago passa a de-duplicar por uma chave propria, entao a despesa que o membro PAGOU e rateou entra duas vezes -- e `paid_count + owed_count` de volta, com os 18/18/12 medidos na conta de teste em producao. Se este sobrevive, a suite inteira nao mede o defeito que a issue abriu",
    de: "      participa(despesa.pagador, despesa.id);",
    para: '      participa(despesa.pagador, despesa.id + ":pago");',
  },

  // -------------------------------------------------------------------------
  // AS DUAS PERNAS, UMA A UMA
  // -------------------------------------------------------------------------
  {
    nome: "perna_do_pago_sai",
    porque:
      "so o rateio conta -- e esta e a funcao errada que o CASO DA ISSUE NAO PEGA: `owed_count` sozinho da 12/12/12 no grupo da HMO-255 e acerta todo grupo em que quem paga sempre se inclui no rateio. Despesa sem rateio (o taxi do caso C) e pagador que recusou a propria parte (caso D) desaparecem da contagem de quem pagou",
    de: "    if (despesa.tipo === TIPO_DE_DESPESA) {",
    para: "    if (false) {",
  },
  {
    nome: "perna_do_rateio_sai",
    porque:
      "so o que o membro pagou conta: quem nao pagou nada no grupo -- o C da conta de teste, que participa das 12 -- aparece com zero transacao ao lado de um saldo devedor de milhares de reais",
    // `.slice(0, 0)` e nao `[]`: a lista vazia literal e inferida `never[]` e o
    // mutante morreria em TS2339 no `rateio.member_id` -- morte no compilador,
    // que nao prova assercao nenhuma. O `slice` mantem o tipo e obriga a suite a
    // ser quem reprova.
    de: "    for (const rateio of despesa.rateios) {",
    para: "    for (const rateio of despesa.rateios.slice(0, 0)) {",
  },

  // -------------------------------------------------------------------------
  // A ASSIMETRIA DO FILTRO DE TIPO (o cabecalho da fonte a justifica)
  // -------------------------------------------------------------------------
  {
    nome: "tipo_ignorado_no_pago",
    porque:
      "a perna do pago perde o `transaction_type = 'expense'` e passa a contar RECEITA do grupo (reembolso, estorno) como despesa participada -- o numero da tela deixa de bater com a lista pelo outro lado, e discorda do `paid_count` da propria view na mesma consulta",
    de: "    if (despesa.tipo === TIPO_DE_DESPESA) {",
    para: "    if (despesa.tipo !== null) {",
  },
  {
    nome: "tipo_exigido_no_rateio",
    porque:
      "a perna do rateio GANHA um filtro de tipo que a view nao tem. Parece simetria e e perda de informacao: quem tem parte numa linha de grupo que nao e `expense` participa dela, e aqui ele desapareceria da contagem sem desaparecer de `owed_count`",
    de: "    for (const rateio of despesa.rateios) {",
    para:
      "    for (const rateio of despesa.tipo === TIPO_DE_DESPESA ? despesa.rateios : []) {",
  },

  // -------------------------------------------------------------------------
  // QUEM CONTA COMO PARTICIPACAO
  // -------------------------------------------------------------------------
  {
    nome: "rateio_recusado_conta",
    porque:
      "a parte RECUSADA e a EXPIRADA voltam a contar. A 007 tirou as duas do saldo porque deixaram de ser divida; aqui elas voltariam a ser participacao, e o contador diria que o membro esta em 12 despesas das quais ele recusou tres",
    de: "      if (STATUS_FORA_DO_RATEIO.includes(rateio.status ?? \"\")) continue;",
    para: "      if (false) continue;",
  },
  {
    nome: "so_aprovado_conta",
    porque:
      "o filtro aperta de 'nao recusado' para 'aprovado', e o rateio PENDENTE sai da contagem -- justamente a despesa que o membro ainda nao respondeu, que e a que ele precisa ver na tela. Verde em todo caso em que ninguem tem parte pendente",
    de: "      if (STATUS_FORA_DO_RATEIO.includes(rateio.status ?? \"\")) continue;",
    para: '      if (rateio.status !== "approved") continue;',
  },

  // -------------------------------------------------------------------------
  // A CHAVE: user_id, NUNCA member_id
  // -------------------------------------------------------------------------
  {
    nome: "conta_por_membro_e_nao_por_usuario",
    porque:
      "a contagem passa a ser por `group_members.id`. A view agrupa por `user_id` e quem saiu do grupo e voltou tem DUAS linhas de membro: a contagem se partiria em duas chaves, nenhuma delas casando com a linha de saldo que a tela mostra ao lado -- e a rota devolveria zero para o membro de hoje",
    de: "      participa(userIdPorMembro.get(rateio.member_id), despesa.id);",
    para: "      participa(rateio.member_id, despesa.id);",
  },
  {
    nome: "membro_desconhecido_vira_usuario",
    porque:
      "rateio cujo membro nao esta no mapa inventa uma chave com o `member_id` cru. A view faz JOIN com group_members, entao linha de membro que a RLS esconde nao entra em `owed_count` -- aqui ela entraria, e a resposta ganharia um participante que nao existe",
    de: "      participa(userIdPorMembro.get(rateio.member_id), despesa.id);",
    para:
      "      participa(userIdPorMembro.get(rateio.member_id) ?? rateio.member_id, despesa.id);",
  },
  {
    nome: "usuario_vazio_entra_no_mapa",
    porque:
      "a guarda de `userId` ausente sai e `undefined` vira chave do mapa. Nao e cosmetico: o mapa ganha uma entrada que nenhuma linha de saldo reclama, e o dia em que a rota iterar a contagem em vez de consultar por `user_id` essa entrada vira uma linha na tela",
    // Nao `if (false) return;`: sem o estreitamento a chamada seguinte reprova
    // em TS2345 e o mutante morre no compilador, sem dizer nada sobre a suite.
    // Trocar a recusa por um usuario FABRICADO guarda o tipo e deixa o defeito
    // de pe -- uma chave a mais no mapa.
    de: "    if (!userId) return;",
    para: '    if (!userId) userId = "(sem usuario)";',
  },

  // -------------------------------------------------------------------------
  // O CONJUNTO
  // -------------------------------------------------------------------------
  {
    nome: "tamanho_vira_um",
    porque:
      "`conjunto.size` viraria 1 para todo mundo: o grupo de 12 despesas mostraria '1 transacao' em cada membro. Mutante bobo de proposito -- se ele sobrevive, a suite nao esta lendo o numero, so a presenca da chave",
    de: "    contagem.set(userId, conjunto.size);",
    para: "    contagem.set(userId, 1);",
  },
];

// O BLOCO: um diretorio, um processo, a fonte e os mutantes dentro (HMO-319).
// As etapas vem do proprio alvo `test:contagem-do-grupo` no package.json -- uma
// copia da receita escrita a mao aqui divergiria do alvo de verdade sem nada
// reclamar, e o placar afirmaria cobertura sobre etapas que este runner nao roda.
const SUITE_DO_BLOCO = "test:contagem-do-grupo";
const bloco = criarBlocoDeMutantes({
  rotulo: "contagem-do-grupo",
  suites: [SUITE_DO_BLOCO],
});

/** Uma volta do bloco. */
const voltaDoBloco = (nome, fonte) =>
  bloco.rodar(nome, { [FONTE]: fonte }, SUITE_DO_BLOCO);

let falhou = false;

try {
  // CONTROLE POSITIVO. Sem ele, "todos morreram" pode significar so que o build
  // quebrou: uma suite ja vermelha mata todo mutante de graca e o placar sai
  // cheio sem que uma assercao tenha medido nada.
  const controle = voltaDoBloco("controle", original);
  if (!controle.verde) {
    console.error(
      `CONTROLE POSITIVO FALHOU: a fonte intacta nao passa na suite (${controle.como}) -> ${controle.saida}`
    );
    console.error("O placar abaixo nao vale, e por isso nao sai nenhum.");
    bloco.fechar();
    process.exit(1);
  }
  console.log("controle positivo: a fonte intacta passa na suite  OK\n");

  let mortos = 0;
  let porTeste = 0;

  for (const m of MUTANTES) {
    // MUTANTE QUE NAO SE APLICA E O PIOR RESULTADO POSSIVEL: contaria como
    // "morreu" sem nunca ter existido. A ambiguidade importa tanto quanto a
    // ausencia -- varios destes trechos tambem aparecem no COMENTARIO que os
    // explica, e um `replace` cego mutaria a prosa e deixaria o codigo intacto.
    const ocorrencias = original.split(m.de).length - 1;
    if (ocorrencias === 0) {
      console.error(
        `NAO APLICOU: ${m.nome} -- o trecho procurado nao esta em ${FONTE}`
      );
      falhou = true;
      continue;
    }
    if (ocorrencias > 1) {
      console.error(
        `AMBIGUO: ${m.nome} -- o trecho aparece ${ocorrencias}x; a mutacao atingiria so a primeira`
      );
      falhou = true;
      continue;
    }

    const r = voltaDoBloco(m.nome, original.replace(m.de, m.para));
    if (r.verde) {
      console.error(`SOBREVIVEU: ${m.nome}`);
      console.error(`            ${m.porque}`);
      // Sobreviver emitindo o MESMO byte nao e furo de assercao: e mutante
      // equivalente, e nenhuma assercao do mundo o mataria.
      if (r.mudouASaida === false) {
        console.error(
          "            (a saida compilada e identica a da arvore limpa: mutante EQUIVALENTE, nao furo de teste)"
        );
      }
      falhou = true;
    } else {
      mortos++;
      if (r.como === "teste") porTeste++;
      console.log(`morreu:     ${m.nome}  (${r.como}: ${r.saida})`);
    }
  }

  console.log(
    `\n${mortos}/${MUTANTES.length} mutantes mortos (${porTeste} por assercao)`
  );

  // UM MUTANTE MORTO SO PELO `tsc` NAO PROVA ASSERCAO NENHUMA. Se todos
  // morressem assim, a suite poderia estar vazia e o placar sairia perfeito.
  if (mortos > 0 && porTeste === 0) {
    console.error(
      "\nNENHUM mutante foi morto por assercao -- todos cairam no compilador. A suite nao esta medindo nada."
    );
    falhou = true;
  }
} finally {
  bloco.fechar();
}

process.exitCode = falhou ? 1 : 0;
