#!/usr/bin/env node
// =====================================================
// A CONTAGEM DE TRANSACOES DO GRUPO -- HMO-259
// =====================================================
//   npm run test:contagem-do-grupo
//
// `GET /api/expense-groups/{id}/balances` devolvia `paid_count + owed_count` e
// contava duas vezes a despesa que o membro PAGOU: num grupo de 12 despesas, 6
// pagas pela A e 6 pela B, todas rateadas entre os tres, a resposta medida em
// producao (conta de teste da HMO-255, 04/10/2026) foi
//
//     A: 18    B: 18    C: 12
//
// O caso A desta suite E esse grupo, com os mesmos numeros, e e o unico caso que
// distingue o defeito do conserto por si so -- os 18 aparecem exatamente onde a
// pessoa pagou e rateou.
//
// POR QUE O CASO A NAO BASTA
// --------------------------
// Ele e satisfeito por mais de uma funcao errada. `owed_count` sozinho ja da
// 12/12/12 no caso A, e tambem da a resposta certa em TODO grupo em que ninguem
// paga despesa sem se incluir no rateio -- que e a esmagadora maioria. Os casos
// C, D e E existem para separar a UNIAO de "so o rateio":
//
//   C -- despesa sem rateio nenhum: quem pagou participa, e so ele.
//   D -- o proprio pagador teve a parte RECUSADA: ele pagou, logo participa, e
//        participa UMA vez -- este e o caso em que as duas pernas se cruzam sem
//        que o rateio dele conte.
//   E -- membro cujo unico vinculo e um rateio recusado: zero, nao um.
//
// E o caso F separa a UNIAO da soma pelo outro lado: `transaction_type` que nao
// e `expense` nao conta pela perna do pago, mas o rateio dele conta -- a
// assimetria que o cabecalho de lib/contagem-do-grupo.ts explica. Sem o caso F,
// tirar o filtro de tipo passa verde.
//
// O QUE ESTA SUITE NAO MEDE
// -------------------------
// A fiacao com o PostgREST -- se o `select` com `!inner` e o embed reverso
// trazem mesmo `transaction.user_id` e `splits[].member_id`. Isso e a rota, e
// nenhuma funcao pura alcanca. Esta suite prova a REGRA; a leitura em producao
// esta registrada na issue.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPILADO = join(RAIZ, ".tmp-contagem-do-grupo");

const { contagemPorMembro, STATUS_FORA_DO_RATEIO, TIPO_DE_DESPESA } =
  await import(join(COMPILADO, "contagem-do-grupo.js"));

// Os tres membros da conta de teste da HMO-255. `m*` e `group_members.id`, `u*`
// e `user_id` -- a distincao e metade do defeito possivel aqui, porque o rateio
// aponta para o PRIMEIRO e a contagem e pelo SEGUNDO.
const mA = "membro-a";
const mB = "membro-b";
const mC = "membro-c";
const uA = "usuario-a";
const uB = "usuario-b";
const uC = "usuario-c";

const TRES_MEMBROS = new Map([
  [mA, uA],
  [mB, uB],
  [mC, uC],
]);

/** Despesa rateada entre os tres, paga por `pagador`. */
function despesaRateadaEntreOsTres(id, pagador) {
  return {
    id,
    pagador,
    tipo: TIPO_DE_DESPESA,
    rateios: [
      { member_id: mA, status: "approved" },
      { member_id: mB, status: "approved" },
      { member_id: mC, status: "pending" },
    ],
  };
}

/** O grupo da HMO-255: 6 jantares pagos pela A, 6 mercados pagos pela B. */
function grupoDaContaDeTeste() {
  const despesas = [];
  for (let i = 1; i <= 6; i++) {
    despesas.push(despesaRateadaEntreOsTres(`jantar-${i}`, uA));
  }
  for (let i = 1; i <= 6; i++) {
    despesas.push(despesaRateadaEntreOsTres(`mercado-${i}`, uB));
  }
  return despesas;
}

test("A: o grupo da conta de teste conta 12 para os tres, e nao 18/18/12", () => {
  const contagem = contagemPorMembro(grupoDaContaDeTeste(), TRES_MEMBROS);

  // Os 18 medidos em producao vinham de 12 rateios + 6 despesas proprias. Pedir
  // 12 aqui reprova a soma; pedir os tres juntos reprova consertar so quem paga.
  assert.equal(contagem.get(uA), 12, "quem pagou 6 das 12 nao participa de 18");
  assert.equal(contagem.get(uB), 12, "quem pagou as outras 6 tambem nao");
  assert.equal(contagem.get(uC), 12, "quem nao pagou nada ja estava certo");

  // O grupo tem 12 despesas e 3 membros: ninguem pode passar de 12, e o total
  // nao pode passar de 36. O defeito somava 48.
  const total = [...contagem.values()].reduce((a, b) => a + b, 0);
  assert.equal(total, 36, "a soma das tres contagens denuncia a duplicata");
});

test("B: cada membro conta a despesa UMA vez, mesmo pagando e rateando", () => {
  const contagem = contagemPorMembro(
    [despesaRateadaEntreOsTres("jantar-unico", uA)],
    TRES_MEMBROS
  );

  // O caso minimo do defeito: uma despesa so. O errado dava 2 para quem pagou.
  assert.equal(contagem.get(uA), 1);
  assert.equal(contagem.get(uB), 1);
  assert.equal(contagem.get(uC), 1);
});

test("C: despesa sem rateio conta para quem pagou, e so para ele", () => {
  const contagem = contagemPorMembro(
    [{ id: "taxi", pagador: uA, tipo: TIPO_DE_DESPESA, rateios: [] }],
    TRES_MEMBROS
  );

  // `owed_count` sozinho daria zero para todos. E a perna do PAGO que faz esta
  // despesa existir na contagem -- e o `residual` da propria rota avisa que
  // despesa sem rateio acontece.
  assert.equal(contagem.get(uA), 1, "quem pagou participa mesmo sem rateio");
  assert.equal(contagem.get(uB), undefined, "quem nao tem parte nao participa");
  assert.equal(contagem.get(uC), undefined);
});

test("D: pagador com a propria parte RECUSADA participa, e participa uma vez", () => {
  const contagem = contagemPorMembro(
    [
      {
        id: "jantar-recusado",
        pagador: uA,
        tipo: TIPO_DE_DESPESA,
        rateios: [
          { member_id: mA, status: "rejected" },
          { member_id: mB, status: "approved" },
        ],
      },
    ],
    TRES_MEMBROS
  );

  // Aqui as duas pernas se cruzam SEM que o rateio dele conte: ele pagou o
  // jantar inteiro e recusou a propria parte. Uma funcao que respondesse so pelo
  // rateio daria zero; uma que somasse daria 1 por acidente -- e e por isso que
  // o caso D vem junto com o B, que cobra o 1 onde a soma daria 2.
  assert.equal(contagem.get(uA), 1);
  assert.equal(contagem.get(uB), 1);
});

test("E: rateio recusado ou expirado nao e participacao", () => {
  for (const status of STATUS_FORA_DO_RATEIO) {
    const contagem = contagemPorMembro(
      [
        {
          id: `jantar-${status}`,
          pagador: uA,
          tipo: TIPO_DE_DESPESA,
          rateios: [
            { member_id: mA, status: "approved" },
            { member_id: mB, status },
          ],
        },
      ],
      TRES_MEMBROS
    );

    assert.equal(contagem.get(uA), 1, `pagador com rateio ${status} do outro`);
    assert.equal(
      contagem.get(uB),
      undefined,
      `parte ${status} deixou de ser divida na 007 e nao e participacao`
    );
  }

  // O laco acima e vacuo se a constante esvaziar. Esta linha e o que impede.
  assert.deepEqual([...STATUS_FORA_DO_RATEIO], ["rejected", "expired"]);
});

test("E2: rateio PENDENTE e participacao -- so o recusado sai", () => {
  const contagem = contagemPorMembro(
    [
      {
        id: "jantar-pendente",
        pagador: uA,
        tipo: TIPO_DE_DESPESA,
        rateios: [{ member_id: mB, status: "pending" }],
      },
    ],
    TRES_MEMBROS
  );

  // Sem este caso, uma funcao que exigisse `status === 'approved'` passaria em
  // todos os outros -- e esconderia da tela a despesa que o membro ainda nao
  // respondeu, que e justamente a que ele precisa ver.
  assert.equal(contagem.get(uB), 1);
});

test("F: o que nao e despesa nao conta pelo PAGO, mas o rateio dele conta", () => {
  const contagem = contagemPorMembro(
    [
      {
        id: "reembolso",
        pagador: uA,
        tipo: "income",
        rateios: [{ member_id: mB, status: "approved" }],
      },
    ],
    TRES_MEMBROS
  );

  // A assimetria que o cabecalho de lib/contagem-do-grupo.ts justifica, e que
  // vem da view: a perna do pago filtra `transaction_type = 'expense'`, a do
  // rateio nao filtra tipo. Sem este caso, tirar o filtro de tipo (uA viraria 1)
  // ou acrescenta-lo no rateio (uB viraria 0) passa verde.
  assert.equal(contagem.get(uA), undefined, "receita nao conta pelo pago");
  assert.equal(contagem.get(uB), 1, "quem tem parte nela participa dela");
});

test("G: rateio de membro fora do mapa nao conta para ninguem", () => {
  const contagem = contagemPorMembro(
    [
      {
        id: "jantar-de-ex-membro",
        pagador: uA,
        tipo: TIPO_DE_DESPESA,
        rateios: [
          { member_id: mA, status: "approved" },
          { member_id: "membro-que-a-rls-esconde", status: "approved" },
        ],
      },
    ],
    TRES_MEMBROS
  );

  // Nao inventar um usuario e o ponto: a view faz JOIN com group_members, logo
  // rateio cuja linha de membro nao aparece nao entra em `owed_count` tambem.
  assert.equal(contagem.get(uA), 1);
  assert.equal(contagem.size, 1, "nenhuma chave nova apareceu no mapa");
});

test("H: o mesmo usuario em DUAS linhas de membro conta a despesa uma vez", () => {
  // Quem sai do grupo e volta tem duas linhas em `group_members` e UM saldo: a
  // view agrupa por `user_id`. Se a despesa antiga (no nome do membro velho) e a
  // nova caissem em chaves diferentes, a contagem discordaria do saldo ao lado.
  const mAVelho = "membro-a-que-saiu";
  const mapa = new Map([...TRES_MEMBROS, [mAVelho, uA]]);

  const contagem = contagemPorMembro(
    [
      {
        id: "jantar-com-as-duas-linhas",
        pagador: uB,
        tipo: TIPO_DE_DESPESA,
        rateios: [
          { member_id: mA, status: "approved" },
          { member_id: mAVelho, status: "approved" },
        ],
      },
    ],
    mapa
  );

  assert.equal(contagem.get(uA), 1, "duas partes na MESMA despesa, uma vez");
  assert.equal(contagem.get(uB), 1);
});

test("I: grupo sem despesa devolve mapa vazio, e nao zeros", () => {
  const contagem = contagemPorMembro([], TRES_MEMBROS);

  // A rota traduz a ausencia em zero com `?? 0`. Devolver zeros aqui faria a
  // funcao afirmar coisa sobre membro que ela nao viu em despesa nenhuma.
  assert.equal(contagem.size, 0);
  assert.equal(contagem.get(uA), undefined);
});

test("J: rateio sem member_id nao derruba nem conta", () => {
  const contagem = contagemPorMembro(
    [
      {
        id: "jantar-com-rateio-torto",
        pagador: uA,
        tipo: TIPO_DE_DESPESA,
        rateios: [{ member_id: null, status: "approved" }],
      },
    ],
    TRES_MEMBROS
  );

  // `member_id` e NOT NULL no banco (001). O caso existe porque o tipo do
  // PostgREST nao garante nada: coluna ausente do select chega `undefined`, e
  // uma excecao aqui derrubaria a tela de saldo inteira por um contador.
  assert.equal(contagem.get(uA), 1);
  assert.equal(contagem.size, 1);
});
