#!/usr/bin/env node
// Mutantes de lib/acerto-na-aba-receitas.ts -- HMO-366, fase F4 da HMO-360.
//
// POR QUE ISTO EXISTE
// -------------------
// `npm run test:acerto-na-aba-receitas` passa com 14 blocos verdes, e isso
// sozinho nao diz nada: quase todo enunciado desta fase e "esta linha aparece
// AQUI e nao ALI", e esse e o tipo de afirmacao que um teste confirma por
// acidente -- basta olhar o lado que calhou de estar certo. Cada mutante abaixo
// desfaz UMA decisao do modulo; o teste tem de ficar vermelho em todos.
//
// OS DOIS QUE MAIS IMPORTAM
// -------------------------
// `perna_invisivel` e o que reproduz o defeito caro desta fase pelo lado da
// tela: com ele, TODO acerto do periodo aparece como "a confirmar" -- inclusive
// o que eu ja lancei. A pessoa clica, o POST responde 409 ("Este acerto já está
// lançado na sua conta"), e o segundo clique se le como app travado. Ele morre
// no bloco que mede as DUAS metades do gesto, e nao no que mede a primeira.
//
// `confirmado_desaparece` e a pegadinha de UX que a issue manda resolver, de
// volta: a perna e `transfer` e `transfer` nao entra em Receitas realizadas,
// entao sem o lado confirmado a linha SOME da tela depois do clique -- e "o
// valor sumiu" termina em alguem lancando a receita a mao, que e a conta duas
// vezes que a 007 recusou. Note que ele NAO e morto por nenhuma assercao sobre o
// lado a confirmar: as duas metades tem de estar no mesmo bloco.
//
// O TERCEIRO, QUE ERRA DINHEIRO: `quem_paga_tambem_ve`
// ----------------------------------------------------
// Para quem PAGOU o acerto tambem esta `a_lancar`, e a tela dela ganharia uma
// linha na aba RECEITAS por um Pix que SAIU da conta dela. O dialogo abriria
// com `direcao="recebi"` literal (o componente nao tem outro caminho), e a perna
// sairia POSITIVA: a conta de quem pagou R$ 300 subiria R$ 300. O saldo anda
// para o lado errado com o valor certo, e nada na tela parece errado.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// `criarBlocoDeMutantes` espelha a arvore por symlink e troca EM MEMORIA so o
// arquivo mutado. Mutar o arquivo do repo e restaurar no `finally` deixa a fonte
// mutada no disco quando o processo morre no meio -- e aqui o worktree e
// compartilhado com outros runs, onde isso custaria o trabalho de outra pessoa.
//
// COMO RODAR
//   npm run mutantes:acerto-na-aba-receitas

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const FONTE = "lib/acerto-na-aba-receitas.ts";
const SUITE = "test:acerto-na-aba-receitas";

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  {
    nome: "aba_errada_tambem_recebe",
    porque:
      "o acerto passa a aparecer tambem em Despesas e em Transferencias: na primeira ele e uma divida que nao existe (quem recebe nao paga nada), na segunda um numero sem rotulo",
    de: '  if (params.tipo !== "income") return { a_confirmar: [], confirmados: [] };',
    para: "",
  },
  {
    nome: "quem_paga_tambem_ve",
    porque:
      "quem PAGOU passa a ver o acerto na aba Receitas dela: o dialogo abre com direcao 'recebi' literal e a perna sai POSITIVA -- a conta de quem pagou R$ 300 SUBIRIA R$ 300",
    de: '    if (visao.direcao !== "recebi") continue;',
    para: "    if (!visao.direcao) continue;",
  },
  {
    nome: "direcao_invertida",
    porque:
      "as duas sessoes trocam de lado: quem PAGOU ve a linha na aba Receitas dela e quem recebeu nao ve nada -- o Pix que saiu da conta de uma entra como receita a confirmar na tela dela, e o da outra desaparece",
    de: "        from_user_id: acerto.from_user_id,\n        to_user_id: acerto.to_user_id,",
    para: "        from_user_id: acerto.to_user_id,\n        to_user_id: acerto.from_user_id,",
  },
  {
    nome: "nome_do_pagador_e_o_meu",
    porque:
      "a frase passa a nomear quem RECEBEU (eu) em vez de quem pagou: a linha diz 'me pagou' com o meu proprio nome, ou cai no fallback sem nome -- e o extrato, gravado pela rota, repete o nome CERTO: duas telas discordando sobre o mesmo Pix",
    de: "    const nome = params.nomes.get(acerto.from_user_id) ?? null;",
    para: "    const nome = params.nomes.get(acerto.to_user_id) ?? null;",
  },
  {
    nome: "perna_invisivel",
    porque:
      "TODO acerto do periodo aparece como a confirmar, inclusive o que eu ja lancei: o botao oferece lancar dinheiro que ja esta na conta, o POST responde 409 e o segundo clique se le como app travado",
    de: "      temPerna: params.chavesComPerna.has(chave),",
    para: "      temPerna: false,",
  },
  {
    nome: "estados_trocados",
    porque:
      "a confirmar e confirmado trocam de lado: a linha ja lancada volta a pedir confirmacao e a que falta lancar aparece como recebida -- o Pix fica fora do extrato para sempre",
    de: '    if (visao.estado === "a_lancar") aConfirmar.push(linha);\n    else if (visao.estado === "lancado") confirmados.push(linha);',
    para: '    if (visao.estado === "lancado") aConfirmar.push(linha);\n    else if (visao.estado === "a_lancar") confirmados.push(linha);',
  },
  {
    nome: "confirmado_desaparece",
    porque:
      "o lado confirmado some: como a perna e `transfer` e nao entra em Receitas realizadas, confirmar faz a linha DESAPARECER da tela -- indistinguivel de bug, e o caminho dessa estranheza termina em alguem lancando a receita a mao",
    de: '    else if (visao.estado === "lancado") confirmados.push(linha);',
    para: "",
  },
  {
    nome: "valor_zero_vira_linha",
    porque:
      "um acerto de R$ 0,00 (ou negativo) ganha botao Confirmar: o dialogo abre e o servidor recusa a perna, e o sintoma e 'cliquei e nada aconteceu'",
    de: "    if (!Number.isFinite(valor) || valor <= 0) continue;",
    para: "",
  },
  {
    nome: "nan_vira_linha",
    porque:
      "`amount` nao-numerico passa: `Number('abc')` e NaN, e `NaN <= 0` e falso -- a linha sai com 'R$ NaN' na tela e um POST que o servidor recusa",
    de: "    if (!Number.isFinite(valor) || valor <= 0) continue;",
    para: "    if (valor <= 0) continue;",
  },
  {
    nome: "chave_sem_prefixo",
    porque:
      "o id da linha passa a ser o uuid cru da quitacao: qualquer href montado com ele pode passar por um /api/scheduled-transactions/<uuid>/pay plausivel, e a chave deixa de ser a mesma que a perna leva em `notes`",
    de: "      id: chave,",
    para: "      id: acerto.id,",
  },
  {
    nome: "ordem_dos_confirmados_invertida",
    porque:
      "os confirmados passam a sair em ordem crescente: o acerto que a pessoa acabou de lancar vai para o FIM da lista, embaixo dos de duas semanas atras -- ela conclui que o clique nao gravou",
    de: "    confirmados: confirmados.sort((a, b) => b.data.localeCompare(a.data)),",
    para: "    confirmados: confirmados.sort((a, b) => a.data.localeCompare(b.data)),",
  },
  {
    nome: "mesma_frase_nos_dois_blocos",
    porque:
      "o bloco confirmado passa a explicar o cartao «Previsto»: a frase fala do balde errado, e quem acabou de confirmar continua sem saber por que o «Realizado» nao subiu",
    de: "export const ACERTO_FORA_DO_REALIZADO =\n  \"Já está na sua conta e fora do Realizado acima: acerto é transferência — ele move dinheiro de lugar e não é receita nova.\";",
    // A frase do OUTRO bloco, escrita por extenso: uma referencia a
    // `ACERTO_FORA_DO_PREVISTO` nao compila (ele e declarado DEPOIS neste
    // arquivo), e mutante que nao compila nunca chega ao teste.
    para:
      "export const ACERTO_FORA_DO_REALIZADO =\n  \"Fora do Previsto acima: este valor já está lá dentro, como reembolso previsto do grupo.\";",
  },
];

const bloco = criarBlocoDeMutantes({
  rotulo: "acerto-na-aba-receitas",
  suites: [SUITE],
});
// A sombra vive em diretorio temporario e sai junto com o processo -- inclusive
// na saida antecipada do controle. No pior caso (SIGTERM) sobra um diretorio
// orfao em /tmp, e nao mutante em `lib/`.
process.on("exit", () => bloco.fechar());

/** Uma volta do bloco com estas sobrescritas (`{}` = arvore intacta). */
const compilaERoda = (sobrescritas = {}) =>
  bloco.rodar("acerto-na-aba-receitas", sobrescritas, SUITE);

let falhas = 0;
let mortos = 0;

// CONTROLE POSITIVO: com a fonte intacta o teste tem de PASSAR. Sem isto, um
// "todos morreram" poderia significar apenas que o build esta quebrado, ou que
// este runner esta compilando a arvore errada, e o teste reprova sempre.
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
  // vezes produz um mutante que muta o lugar errado e morre verde com o rotulo
  // mentindo sobre o que foi medido -- por isso o trecho tem de ser UNICO, e
  // nao apenas existir.
  const ocorrencias = original.split(m.de).length - 1;
  if (ocorrencias !== 1) {
    console.error(
      `NAO APLICOU: ${m.nome} -- o trecho aparece ${ocorrencias}x em ${FONTE} (tem de ser 1)`
    );
    falhas++;
    continue;
  }

  const r = compilaERoda({ [FONTE]: original.replace(m.de, m.para) });

  if (r.verde) {
    console.error(`SOBREVIVEU: ${m.nome}`);
    console.error(`            ${m.porque}`);
    // Sobreviver emitindo byte IDENTICO ao da arvore limpa nao e furo de
    // assercao: e mutante equivalente, e nenhuma assercao o mataria.
    if (r.mudouASaida === false) {
      console.error(
        "            (a saida compilada e identica a da arvore limpa: mutante EQUIVALENTE, nao furo de teste)"
      );
    }
    falhas++;
  } else {
    // Mutante que nao compila nao e mutante morto: ele nunca chegou ao teste.
    // Sem esta peneira, um `de`/`para` que quebre o TypeScript conta como
    // acerto e o placar sai cheio sem nada ter sido medido.
    if (r.como === "tsc") {
      console.error(`NAO COMPILOU: ${m.nome} -- o mutante nao chegou ao teste`);
      console.error(`  ${r.saida}`);
      falhas++;
      continue;
    }
    mortos++;
    console.log(`morreu:     ${m.nome}`);
  }
}

console.log(`\n${mortos}/${MUTANTES.length} mutantes mortos`);

process.exitCode = falhas ? 1 : 0;
