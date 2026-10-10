#!/usr/bin/env node
// =====================================================
// PULODOGATO - pra quem pagar, e quanto (HMO-365, F2 da HMO-360)
// =====================================================
// A HMO-363 carimbou `pagar_para` na linha de grupo que OUTRO membro frontou, e
// a HMO-364 a ligou no «Previsto» de Despesas pela minha parte. Faltava a
// pergunta que a issue faz em voz alta: *pra quem pagar*.
//
// O QUE ESTE ARQUIVO COBRA SAO ERROS QUE A TELA NAO MOSTRA
// -------------------------------------------------------
//   - a INVARIANTE `soma(detalhe) === total`, por destinatario. O cabecalho de
//     `LinhaDoDetalhe` (HMO-300) diz por que ela e a entrega: um chevron que
//     abre uma lista que nao fecha com o numero de cima transforma um numero
//     conferivel num numero desmentido pela propria tela;
//   - o ROTULO SEM A PESSOA quando `full_name` nao e legivel. Nenhuma policy de
//     `profiles` olha `group_members`, entao o nome ausente e caminho NORMAL --
//     e uma linha de pagamento sem destinatario se le como conta propria, que e
//     o contrario do que ela existe para dizer;
//   - a divida SEM DONO desaparecendo. `pagar_para: null` e "e desse tipo e eu
//     nao sei de quem"; um `if (!pagar_para)` a descartaria do painel enquanto
//     o cartao «Previsto» continuaria contando-a;
//   - a linha PESSOAL e a MINHA linha de grupo entrando. As duas tem
//     `pagar_para` ausente, e somar qualquer uma faria o painel cobrar de mim
//     uma divida com ninguem;
//   - a conta JA PAGA (ou pulada, ou cancelada) somando. E a mesma peneira do
//     cartao de cima, e sem ela o painel diz "pague R$ 500" sobre R$ 300 de
//     divida real -- com o cartao, lido da mesma fonte, mostrando outro numero;
//   - a AGREGACAO POR NOME em vez de por `user_id`: dois perfis invisiveis (os
//     dois sem nome) viram UMA linha, somando dividas de duas pessoas num
//     rotulo so, com o total certo e o destinatario errado;
//   - a ORDEM instavel. Sem desempate, dois destinatarios de mesmo valor saem
//     na ordem de chegada das previsoes -- e um painel que reordena sozinho
//     entre duas leituras iguais se le como dado instavel.
//
// O ROTULO E AFIRMADO PELO TEXTO **E** PELA MARCA, SEMPRE OS DOIS
// ---------------------------------------------------------------
// `rotuloDoDestino` devolve `{ texto, temNome }` da MESMA decisao, e o motivo
// esta no cabecalho de `pagadorNaLinha` (HMO-274): um `full_name` de espacos em
// branco e verdadeiro em JavaScript, entao uma assercao que leia so a marca
// passaria verde sobre um selo em branco. Toda secao de rotulo aqui afirma o
// par.
//
// A prova de que isto nao e fixture inocente esta em
// `scripts/mutantes-pra-quem-pagar.mjs`.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { destinosDoPagamento, rotuloDoDestino, totalPraQuemPagar, DESTINO_SEM_NOME } =
  await import("../.tmp-pra-quem-pagar/lib/pra-quem-pagar.js");

const EU = "11111111-0000-0000-0000-000000000001";
const LETICIA = "22222222-0000-0000-0000-000000000002";
const ANA = "33333333-0000-0000-0000-000000000003";
const CASA = "44444444-0000-0000-0000-000000000004";
const VIAGEM = "55555555-0000-0000-0000-000000000005";

const NOMES = new Map([
  [LETICIA, "Letícia"],
  [ANA, "Ana"],
]);
const GRUPOS = new Map([
  [CASA, "Casa"],
  [VIAGEM, "Viagem"],
]);

/**
 * Uma previsao como ela chega DEPOIS de `previstasPelaRegraDoPagador`: o
 * `amount` ja e a MINHA parte, e `pagar_para` ja esta carimbado.
 *
 * `amount` entra como STRING porque e assim que o PostgREST entrega
 * `numeric(15,2)` -- e passar number aqui esconderia a conversao que
 * `valorEmReais` faz.
 */
function parteDoGrupo({
  id = "prev-1",
  description = "Aluguel",
  amount = "300.00",
  due_date = "2026-10-15",
  status = "pending",
  group_id = CASA,
  pagar_para = LETICIA,
} = {}) {
  return { id, description, amount, due_date, status, group_id, pagar_para };
}

/** A linha pessoal, e a de grupo que EU frontei: as duas sem `pagar_para`. */
const PESSOAL = {
  id: "prev-pessoal",
  description: "Internet",
  amount: "120.00",
  due_date: "2026-10-10",
  status: "pending",
  group_id: null,
};
const FRONTADA_POR_MIM = {
  id: "prev-minha",
  description: "Luz",
  amount: "1000.00",
  due_date: "2026-10-20",
  status: "pending",
  group_id: CASA,
};

// =====================================================
// 1. A INVARIANTE, QUE E A ENTREGA
// =====================================================

test("soma(detalhe) === total, por destinatario", () => {
  const destinos = destinosDoPagamento(
    [
      parteDoGrupo({ id: "a", amount: "300.00", description: "Aluguel" }),
      parteDoGrupo({ id: "b", amount: "53.30", description: "Internet" }),
      parteDoGrupo({ id: "c", amount: "12.45", description: "Gás" }),
    ],
    NOMES,
    GRUPOS
  );

  assert.equal(destinos.length, 1);

  const [leticia] = destinos;
  const soma = leticia.detalhe.reduce((s, l) => s + l.valor, 0);

  // Os dois lados, e o `total` afirmado tambem como LITERAL: comparar so
  // `soma === total` passaria verde com as duas pontas zeradas.
  assert.equal(Number(soma.toFixed(2)), leticia.total);
  assert.equal(leticia.total, 365.75);
  assert.equal(leticia.quantidade, 3);
  assert.equal(leticia.detalhe.length, 3);
});

test("a invariante sobrevive ao centavo do rateio -- 0.1 + 0.2", () => {
  // O caso que o ponto flutuante quebra: sem arredondar a duas casas, a soma
  // sai 0.30000000000000004 e a assercao reprova com os dois numeros
  // visivelmente iguais na mensagem.
  const [destino] = destinosDoPagamento(
    [
      parteDoGrupo({ id: "a", amount: "0.10" }),
      parteDoGrupo({ id: "b", amount: "0.20" }),
    ],
    NOMES,
    GRUPOS
  );

  assert.equal(destino.total, 0.3);
  assert.equal(
    Number(destino.detalhe.reduce((s, l) => s + l.valor, 0).toFixed(2)),
    destino.total
  );
});

// =====================================================
// 2. O NOME, E O `null` HONESTO
// =====================================================

test("com o perfil legivel, o rotulo nomeia a pessoa", () => {
  const [destino] = destinosDoPagamento([parteDoGrupo()], NOMES, GRUPOS);

  assert.equal(destino.nome, "Letícia");
  assert.equal(destino.rotulo.texto, "Pagar para Letícia");
  assert.equal(destino.rotulo.temNome, true);
});

test("SEM o perfil, o rotulo ainda menciona a outra pessoa -- e diz o grupo", () => {
  // O caso que a issue exige: `full_name` nulo (perfil invisivel pela RLS).
  const [destino] = destinosDoPagamento([parteDoGrupo()], new Map(), GRUPOS);

  assert.equal(destino.nome, null);
  assert.equal(destino.rotulo.temNome, false);

  // A EXIGENCIA, afirmada sobre o TEXTO e nao sobre a marca: a linha nao pode
  // ficar sem mencao a outra pessoa, senao se le como conta propria.
  assert.equal(destino.rotulo.texto, "Pagar para outro membro de Casa");
  assert.match(destino.rotulo.texto, /outro membro/);
  assert.ok(
    destino.rotulo.texto.includes("Casa"),
    "o nome do grupo ancora a divida quando o da pessoa nao e legivel"
  );

  // E o controle do controle: o rotulo NAO pode ser so o verbo. Um
  // `Pagar para ` com o nome vazio passaria pelas duas assercoes de cima se
  // elas fossem escritas sobre `temNome`.
  assert.notEqual(destino.rotulo.texto.trim(), "Pagar para");
});

test("sem nome E sem grupo legivel, o rotulo cai no texto generico", () => {
  const [destino] = destinosDoPagamento(
    [parteDoGrupo()],
    new Map(),
    new Map() // nem `expense_groups` veio
  );

  assert.equal(destino.rotulo.texto, `Pagar para ${DESTINO_SEM_NOME}`);
  assert.equal(destino.rotulo.texto, "Pagar para outro membro do grupo");
  assert.equal(destino.rotulo.temNome, false);
});

test("nome em BRANCO e tratado como ausente, nao como nome", () => {
  // `full_name` nao tem NOT NULL nem CHECK de tamanho em `profiles` (001).
  for (const emBranco of ["", "   ", "\t"]) {
    const [destino] = destinosDoPagamento(
      [parteDoGrupo()],
      new Map([[LETICIA, emBranco]]),
      GRUPOS
    );

    assert.equal(destino.nome, null, `nome ${JSON.stringify(emBranco)}`);
    assert.equal(destino.rotulo.temNome, false);
    assert.equal(destino.rotulo.texto, "Pagar para outro membro de Casa");
    // O selo em branco, dito por extenso: o texto nunca termina no verbo.
    assert.doesNotMatch(destino.rotulo.texto, /Pagar para\s*$/);
  }
});

test("rotuloDoDestino, nas tres saidas, direto", () => {
  assert.deepEqual(rotuloDoDestino("Letícia", "Casa"), {
    texto: "Pagar para Letícia",
    temNome: true,
  });
  assert.deepEqual(rotuloDoDestino(null, "Casa"), {
    texto: "Pagar para outro membro de Casa",
    temNome: false,
  });
  assert.deepEqual(rotuloDoDestino(null, null), {
    texto: "Pagar para outro membro do grupo",
    temNome: false,
  });
  // O nome vence o grupo: ter os dois nao escreve os dois.
  assert.equal(rotuloDoDestino("Ana", "Viagem").texto, "Pagar para Ana");
});

test("rotuloDoDestino limpa o nome EM BRANCO por conta propria", () => {
  // ESTA SECAO EXISTE POR UM MUTANTE SOBREVIVENTE, e vale dizer por que ela nao
  // e redundante com a de cima.
  //
  // `destinosDoPagamento` normaliza o nome em branco para `null` ANTES de
  // chamar esta funcao, entao pela porta da lib o `.trim()` daqui nunca decide
  // nada -- e foi exatamente isso que deixou o mutante que o apaga
  // (`nome_em_branco_vira_nome`) sobreviver a suite inteira na primeira volta.
  //
  // So que a funcao e EXPORTADA, e a sonda de navegador a chama DIRETO, com o
  // `nome` do fixture sem normalizacao nenhuma pelo caminho. O guarda e
  // load-bearing para todo chamador que nao seja `destinosDoPagamento`, e a
  // saida certa aqui e medir o guarda -- nao apaga-lo, que e a saida do caso em
  // que nenhum chamador possivel o alcanca (ver `euFrontoAConta`, HMO-363, onde
  // 0 de 25 pares diferiam).
  //
  // Sem isto, o dia em que alguem tirar o `.trim()` daqui entrega uma tela com
  // "Pagar para    " -- o selo em branco, que se le como conta propria.
  for (const emBranco of ["", "   ", "\t", "\n"]) {
    assert.deepEqual(
      rotuloDoDestino(emBranco, "Casa"),
      { texto: "Pagar para outro membro de Casa", temNome: false },
      `nome ${JSON.stringify(emBranco)}`
    );
  }

  // E o grupo em branco cai no generico pelo mesmo caminho.
  assert.equal(
    rotuloDoDestino(null, "   ").texto,
    "Pagar para outro membro do grupo"
  );
});

// =====================================================
// 3. A DIVIDA SEM DONO NAO DESAPARECE
// =====================================================

test("`pagar_para: null` continua sendo um destinatario", () => {
  // `null` = linha de grupo de outro membro cujo `user_id` eu nao sei ler.
  // Descartar a faria sair do painel e FICAR no cartao «Previsto».
  const destinos = destinosDoPagamento(
    [parteDoGrupo({ pagar_para: null, amount: "80.00" })],
    NOMES,
    GRUPOS
  );

  assert.equal(destinos.length, 1);
  assert.equal(destinos[0].user_id, null);
  assert.equal(destinos[0].total, 80);
  assert.equal(destinos[0].rotulo.temNome, false);
  assert.match(destinos[0].rotulo.texto, /outro membro/);
});

test("`pagar_para` AUSENTE sai: a linha pessoal e a que EU frontei", () => {
  const destinos = destinosDoPagamento(
    [PESSOAL, FRONTADA_POR_MIM],
    NOMES,
    GRUPOS
  );

  // Nenhuma das duas e divida com ninguem. Somar qualquer uma cobraria de mim
  // uma divida com ninguem -- e `FRONTADA_POR_MIM` traz o valor CHEIO.
  assert.deepEqual(destinos, []);
  assert.equal(totalPraQuemPagar(destinos), null);
});

test("ausente e `null` sao DISTINGUIVEIS -- as duas na mesma lista", () => {
  const destinos = destinosDoPagamento(
    [PESSOAL, FRONTADA_POR_MIM, parteDoGrupo({ pagar_para: null, amount: "80.00" })],
    NOMES,
    GRUPOS
  );

  // Um `if (!pagar_para) continue` juntaria os tres e devolveria lista vazia.
  assert.equal(destinos.length, 1);
  assert.equal(destinos[0].total, 80);
});

// =====================================================
// 4. A PENEIRA DE STATUS, A MESMA DO CARTAO DE CIMA
// =====================================================

for (const status of ["paid", "skipped", "cancelled"]) {
  test(`status '${status}' NAO soma no painel`, () => {
    const destinos = destinosDoPagamento(
      [
        parteDoGrupo({ id: "viva", amount: "300.00", status: "pending" }),
        parteDoGrupo({ id: "morta", amount: "200.00", status }),
      ],
      NOMES,
      GRUPOS
    );

    assert.equal(destinos[0].total, 300);
    assert.equal(destinos[0].quantidade, 1);
    assert.equal(destinos[0].detalhe[0].id, "viva");
  });
}

test("'overdue' SOMA -- conta vencida continua sendo conta a pagar", () => {
  // `overdue` nao e gravado: a view do 005 o calcula de `pending` + vencimento
  // passado. Tira-lo faria o painel DIMINUIR no dia seguinte ao vencimento --
  // exatamente o dia em que a pessoa abre a tela para ver o que esta atrasado.
  const [destino] = destinosDoPagamento(
    [parteDoGrupo({ status: "overdue", amount: "300.00" })],
    NOMES,
    GRUPOS
  );

  assert.equal(destino.total, 300);
});

// =====================================================
// 5. A AGREGACAO E POR `user_id`, NUNCA POR NOME
// =====================================================

test("duas pessoas sem nome ficam em DUAS linhas", () => {
  // Agrupar por nome (as duas `null`) somaria R$ 300 num rotulo so: o total
  // certo com o destinatario errado.
  const destinos = destinosDoPagamento(
    [
      parteDoGrupo({ id: "a", pagar_para: LETICIA, amount: "200.00" }),
      parteDoGrupo({ id: "b", pagar_para: ANA, amount: "100.00" }),
    ],
    new Map(), // nenhum perfil legivel: os dois rotulos sao iguais
    GRUPOS
  );

  assert.equal(destinos.length, 2);
  assert.deepEqual(
    destinos.map((d) => d.total),
    [200, 100]
  );
  // Os rotulos SAO iguais, e e justamente por isso que o nome nao serve de
  // chave -- esta assercao documenta a coincidencia que o teste explora.
  assert.equal(destinos[0].rotulo.texto, destinos[1].rotulo.texto);
  assert.notEqual(destinos[0].user_id, destinos[1].user_id);
});

test("a MESMA pessoa em dois grupos vira UM destinatario, com os dois grupos", () => {
  const [destino] = destinosDoPagamento(
    [
      parteDoGrupo({ id: "a", group_id: CASA, amount: "300.00" }),
      parteDoGrupo({ id: "b", group_id: VIAGEM, amount: "150.00" }),
      // O grupo repetido NAO entra duas vezes na lista de nomes.
      parteDoGrupo({ id: "c", group_id: CASA, amount: "50.00" }),
    ],
    NOMES,
    GRUPOS
  );

  assert.equal(destino.total, 500);
  assert.equal(destino.quantidade, 3);
  assert.deepEqual(destino.grupos, ["Casa", "Viagem"]);
});

// =====================================================
// 6. A ORDEM, E O DESEMPATE QUE A TORNA ESTAVEL
// =====================================================

test("do maior total para o menor", () => {
  const destinos = destinosDoPagamento(
    [
      parteDoGrupo({ id: "a", pagar_para: LETICIA, amount: "100.00" }),
      parteDoGrupo({ id: "b", pagar_para: ANA, amount: "900.00" }),
    ],
    NOMES,
    GRUPOS
  );

  assert.deepEqual(
    destinos.map((d) => d.rotulo.texto),
    ["Pagar para Ana", "Pagar para Letícia"]
  );
});

test("empate de valor desempata pelo id -- e as duas ordens de entrada dao a MESMA tela", () => {
  const umaOrdem = [
    parteDoGrupo({ id: "a", pagar_para: LETICIA, amount: "100.00" }),
    parteDoGrupo({ id: "b", pagar_para: ANA, amount: "100.00" }),
  ];

  const direto = destinosDoPagamento(umaOrdem, NOMES, GRUPOS);
  const invertido = destinosDoPagamento([...umaOrdem].reverse(), NOMES, GRUPOS);

  // `sort` e estavel (ES2019+), entao SEM o desempate estas duas listas sairiam
  // invertidas uma da outra -- e o painel reordenaria sozinho entre duas
  // leituras do mesmo periodo.
  assert.deepEqual(
    direto.map((d) => d.user_id),
    invertido.map((d) => d.user_id)
  );
  assert.deepEqual(
    direto.map((d) => d.user_id),
    [LETICIA, ANA]
  );
});

// =====================================================
// 7. A LINHA DO DETALHE, NO CONTRATO DA HMO-300
// =====================================================

test("a linha do detalhe sai `de_grupo`, sem acao e sem fatura", () => {
  const [destino] = destinosDoPagamento([parteDoGrupo()], NOMES, GRUPOS);
  const [linha] = destino.detalhe;

  assert.equal(linha.id, "prev-1");
  assert.equal(linha.gravada, true);
  assert.equal(linha.descricao, "Aluguel");
  assert.equal(linha.valor, 300);
  assert.equal(linha.data, "2026-10-15");

  // `de_grupo` carrega o rotulo "minha parte do grupo": sem ele, metade do
  // aluguel debaixo do nome do aluguel inteiro se le como erro de digitacao.
  assert.equal(linha.de_grupo, true);

  // FALHA FECHADO, e aqui o fechado e o certo: a linha e de outro membro, e
  // `UPDATE` filtrado pela RLS volta 200 sem alterar nada.
  assert.equal(linha.posso_editar, false);

  assert.equal(linha.fatura, null);
  assert.equal(linha.fatura_suspeita, null);
  assert.equal(linha.elo_da_fatura, null);
});

test("previsao sem id sai `gravada: false`", () => {
  const [destino] = destinosDoPagamento(
    [parteDoGrupo({ id: null })],
    NOMES,
    GRUPOS
  );

  assert.equal(destino.detalhe[0].id, null);
  // Fixar `true` poria acao em cima de linha que o `PATCH` nao acha.
  assert.equal(destino.detalhe[0].gravada, false);
});

test("o `amount` do PostgREST (string) e o sinal invertido viram reais positivos", () => {
  const [destino] = destinosDoPagamento(
    [
      parteDoGrupo({ id: "a", amount: "300.00" }),
      // `scheduled_transactions.amount` tem CHECK (amount > 0), entao negativo
      // e out-of-contract -- e a lista pinta pelo SINAL, logo um negativo aqui
      // sairia com o numero certo e a COR DE RECEITA.
      parteDoGrupo({ id: "b", amount: -50 }),
      parteDoGrupo({ id: "c", amount: null }),
    ],
    NOMES,
    GRUPOS
  );

  assert.deepEqual(
    destino.detalhe.map((l) => l.valor),
    [300, 50, 0]
  );
  assert.equal(destino.total, 350);
});

// =====================================================
// 8. O TOTAL DO PAINEL
// =====================================================

test("totalPraQuemPagar soma as pessoas, e e `null` quando nao ha nenhuma", () => {
  const destinos = destinosDoPagamento(
    [
      parteDoGrupo({ id: "a", pagar_para: LETICIA, amount: "300.00" }),
      parteDoGrupo({ id: "b", pagar_para: ANA, amount: "53.30" }),
    ],
    NOMES,
    GRUPOS
  );

  assert.deepEqual(totalPraQuemPagar(destinos), { total: 353.3, pessoas: 2 });

  // `null` e nao `{total: 0}`: "R$ 0,00 a pagar" na tela de quem nao tem grupo
  // e ruido que parece recurso quebrado.
  assert.equal(totalPraQuemPagar([]), null);
});

// =====================================================
// 9. OS CONTROLES: lista vazia, e nada inventado
// =====================================================

test("lista vazia devolve lista vazia", () => {
  assert.deepEqual(destinosDoPagamento([], NOMES, GRUPOS), []);
});

test("mapas vazios NAO descartam linha nenhuma", () => {
  // Faltar `profiles` ou `expense_groups` (as duas consultas podem falhar) cai
  // no rotulo, nunca no sumico: a divida seguiria no cartao «Previsto».
  const destinos = destinosDoPagamento(
    [parteDoGrupo({ amount: "300.00" })],
    new Map(),
    new Map()
  );

  assert.equal(destinos.length, 1);
  assert.equal(destinos[0].total, 300);
  assert.deepEqual(destinos[0].grupos, []);
});
