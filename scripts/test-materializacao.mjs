// =====================================================
// A MATERIALIZACAO DA AGENDA -- HMO-172
// =====================================================
//   npm run test:materializacao
//
// `materializarAgenda` e o passo que transforma uma `recurring_rules` nas
// ocorrencias de `scheduled_transactions`. Ela fala com o banco, mas o que esta
// sendo medido aqui nao e o banco: e a LINHA que ela monta. Um cliente de
// mentira devolve as regras e guarda o que teria sido gravado, e as assercoes
// olham esse objeto.
//
// POR QUE ISTO PRECISA DE TESTE PROPRIO
// -------------------------------------
// A transferencia recorrente so funciona se DOIS campos atravessarem este passo
// juntos: `transaction_type = 'transfer'` e `destination_account_id`. Perder
// qualquer um dos dois nao da erro aqui -- da uma ocorrencia que a baixa nao
// consegue honrar:
//
//   * sem o destino, a baixa grava a perna de SAIDA e descobre no passo
//     seguinte que nao tem para onde mandar o dinheiro. Metade de uma
//     transferencia, que e o defeito que a issue nomeia.
//   * sem o tipo, a ocorrencia herda a direcao da regra pelo COALESCE da 027 --
//     o que daria certo por acidente na leitura -- mas o CHECK da 037 recusa a
//     linha, porque um CHECK nao consulta outra tabela para saber se aquele
//     destino e legitimo. O INSERT leva 23514 e a agenda fica vazia.
//
// E o par e assimetrico de proposito: para income/expense `transaction_type`
// continua NULL ("pergunte a regra", 027), porque editar a regra de despesa para
// receita tem de reapontar as ocorrencias futuras. As assercoes cobram as duas
// metades da assimetria.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { materializarAgenda, valorComSinal } = await import(
  "../.tmp-materializacao/lib/services/scheduled.js"
);

const USUARIO = "00000000-0000-0000-0000-0000000000aa";
const CORRENTE = "11111111-1111-1111-1111-111111111111";
const POUPANCA = "22222222-2222-2222-2222-222222222222";
const CATEGORIA = "99999999-9999-9999-9999-999999999999";

/**
 * Um cliente de mentira, com a forma que `materializarAgenda` usa: um
 * `from("recurring_rules").select().eq().eq()` que resolve nas regras dadas, e
 * um `from("scheduled_transactions").upsert(linhas)` que as guarda.
 *
 * O `upsert` devolve `select("id")` porque a funcao conta as criadas por ali.
 */
function clienteFalso(regras) {
  const gravadas = [];
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    // `materializarAgenda` faz `await` no encadeamento das regras.
    then: (resolver) => resolver({ data: regras, error: null }),
  };
  return {
    gravadas,
    from(tabela) {
      if (tabela === "recurring_rules") return consulta;
      return {
        upsert(linhas) {
          gravadas.push(...linhas);
          return {
            select: () => ({
              then: (resolver) =>
                resolver({ data: linhas.map((_, i) => ({ id: `x${i}` })), error: null }),
            }),
          };
        },
      };
    },
  };
}

const regraBase = {
  id: "regra-1",
  user_id: USUARIO,
  category_id: CATEGORIA,
  frequency: "monthly",
  interval_count: 1,
  due_day: 5,
  start_date: "2026-03-01",
  end_date: null,
  max_occurrences: null,
  description: "Reserva mensal",
  amount: 1000,
  is_active: true,
};

const transferencia = {
  ...regraBase,
  transaction_type: "transfer",
  account_id: CORRENTE,
  destination_account_id: POUPANCA,
};

const despesa = {
  ...regraBase,
  transaction_type: "expense",
  account_id: CORRENTE,
  description: "Aluguel",
};

/** Materializa uma janela fixa, para a contagem de ocorrencias ser estavel. */
const materializar = async (regras) => {
  const cliente = clienteFalso(regras);
  await materializarAgenda(cliente, USUARIO, {
    de: "2026-03-01",
    ate: "2026-05-31",
  });
  return cliente.gravadas;
};

test("a ocorrencia de transferencia carrega o DESTINO", async () => {
  const linhas = await materializar([transferencia]);

  assert.ok(linhas.length > 0, "nenhuma ocorrencia materializada");
  for (const linha of linhas) {
    // A origem, como qualquer ocorrencia.
    assert.equal(linha.account_id, CORRENTE);
    // E o destino -- o campo sem o qual a baixa grava UMA perna.
    assert.equal(linha.destination_account_id, POUPANCA);
  }
});

test("a ocorrencia de transferencia grava transaction_type EXPLICITO", async () => {
  const linhas = await materializar([transferencia]);

  for (const linha of linhas) {
    // Explicito, e nao NULL: o CHECK da 037 precisa do tipo na PROPRIA linha
    // para poder exigir o destino. Com NULL a linha cai no ramo que PROIBE
    // destino e o INSERT leva 23514.
    assert.equal(linha.transaction_type, "transfer");
  }
});

test("a ocorrencia de DESPESA continua sem transaction_type e sem destino", async () => {
  const linhas = await materializar([despesa]);

  assert.ok(linhas.length > 0);
  for (const linha of linhas) {
    // A outra metade da assimetria, e o controle que mata o mutante "grava o
    // tipo em TODA ocorrencia": NULL quer dizer "pergunte a regra" (027), e e o
    // que faz editar a regra reapontar as ocorrencias futuras. Uma copia gravada
    // em cada uma congelaria a direcao antiga.
    assert.equal(linha.transaction_type, undefined);
    // E destino preenchido num tipo que nao e transferencia e justamente o que o
    // CHECK da 037 chama de transferencia disfarcada.
    assert.equal(linha.destination_account_id, undefined);
  }
});

test("transferencia sem destino na regra materializa destino NULL, nao undefined", async () => {
  // Uma regra assim nao deveria existir (o CHECK da 037 a recusa), mas se ela
  // existir -- banco sem a 037, importacao, SQL Editor -- o que importa e que a
  // ocorrencia NAO nasca com o destino faltando em silencio. `null` explicito e
  // o que faz o CHECK recusar o INSERT na hora, em vez de a baixa descobrir
  // depois de ja ter gravado a perna de saida.
  const linhas = await materializar([
    { ...transferencia, destination_account_id: undefined },
  ]);

  for (const linha of linhas) {
    assert.equal(linha.transaction_type, "transfer");
    assert.equal(linha.destination_account_id, null);
  }
});

test("as duas regras juntas nao contaminam uma a outra", async () => {
  // O risco do spread condicional: um objeto reusado entre iteracoes faria a
  // despesa herdar o destino da transferencia. O `flatMap` cria um objeto por
  // ocorrencia, e esta assercao e o que prova.
  const linhas = await materializar([transferencia, despesa]);

  const deTransferencia = linhas.filter((l) => l.description === "Reserva mensal");
  const deDespesa = linhas.filter((l) => l.description === "Aluguel");

  assert.ok(deTransferencia.length > 0 && deDespesa.length > 0);
  for (const l of deTransferencia) assert.equal(l.destination_account_id, POUPANCA);
  for (const l of deDespesa) assert.equal(l.destination_account_id, undefined);
});

test("a ocorrencia leva valor POSITIVO, nos dois tipos", async () => {
  for (const regra of [transferencia, despesa]) {
    for (const linha of await materializar([regra])) {
      // `scheduled_transactions.amount` tem CHECK (> 0). O sinal e aplicado na
      // baixa -- em transferencia, pelas duas pernas.
      assert.ok(linha.amount > 0, `${regra.transaction_type} com amount <= 0`);
      assert.equal(linha.status, "pending");
    }
  }
});

test("valorComSinal manda transferencia para o lado NEGATIVO", () => {
  // Isto nao e o comportamento desejado -- e a razao pela qual a rota de baixa
  // DESVIA a transferencia antes de chegar aqui. A assercao documenta a armadilha
  // de forma executavel: quem tirar o desvio da rota faz toda transferencia
  // prevista virar uma perna negativa solta, e este teste continua verde. O que
  // pega o desvio removido e test:transferencia (saldo por conta).
  assert.equal(valorComSinal(1000, "transfer"), -1000);
  assert.equal(valorComSinal(1000, "income"), 1000);
  assert.equal(valorComSinal(1000, "expense"), -1000);
});
