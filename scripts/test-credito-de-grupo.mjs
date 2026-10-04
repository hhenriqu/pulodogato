// =============================================================================
// PULODOGATO - o credito de grupo na tela de receitas, como A RECEBER
// (HMO-245, fase 10)
// =============================================================================
//   npm run test:credito-de-grupo
//
// Roda o JS compilado de lib/credito-de-grupo.ts, lib/fechamento-do-grupo.ts e
// lib/parte-de-grupo-na-lista.ts -- por isso o npm script tem o passo de
// resolve-aliases.
//
// POR QUE O TESTE ALIMENTA O CREDITO COM A SAIDA REAL DE `fecharMes`
// ------------------------------------------------------------------
// Escrever o fechamento a mao (`{ por_membro: [...], transferencias: [...] }`)
// seria mais curto e mediria menos: a coisa inteira que esta fase existe para
// nao errar e que `fecharMes` SOMA PREVISTO JUNTO COM REALIZADO, e um objeto
// escrito a mao nao tem previsto nem realizado dentro -- tem numeros. Entao os
// blocos abaixo montam a conta de internet de verdade, com `linhaDoPrevisto`, e
// conferem antes que o fechamento esta de fato em `total_previsto` -- so depois
// medem o credito. Sem esse passo o teste passaria igual num mundo em que a
// conta ja estivesse paga, que e o mundo em que o credito SERIA receita.
//
// AS ASSERCOES SAO SEPARADAS POR CARTAO, E NUNCA SOBRE O SALDO
// ------------------------------------------------------------
// O saldo fica certo com os dois lados errados -- inflar receita e despesa pelo
// mesmo valor deixa `receitas - despesas` exato. E a armadilha das duas pernas
// ([[duas-pernas-mantem-o-total-certo]]), e e exatamente o defeito que esta fase
// poderia introduzir: somar o credito em "Receitas" fecharia o saldo. Por isso
// cada bloco afirma sobre RECEITAS e sobre o CREDITO em separado, com o numero
// que a conta errada produziria escrito ao lado.
//
// Cada bloco tem o CONTROLE junto: sem ele, "total = 106,60" passa verde numa
// implementacao que soma o saldo em vez das linhas, e a assercao nao seria
// capaz de falhar.
// =============================================================================

import test from "node:test";
import assert from "node:assert/strict";

const { fecharMes, linhaDoPrevisto, linhaDoRealizado } = await import(
  "../.tmp-credito-de-grupo/fechamento-do-grupo.js"
);

const {
  creditoAReceber,
  creditoDoFechamento,
  devedorNaLinha,
  notaDoCreditoAReceber,
  DEVEDOR_SEM_NOME,
} = await import("../.tmp-credito-de-grupo/credito-de-grupo.js");

const { resumoComPartesDeGrupo } = await import(
  "../.tmp-credito-de-grupo/parte-de-grupo-na-lista.js"
);

const HELIO = "11111111-1111-1111-1111-111111111111";
const LAIS = "22222222-2222-2222-2222-222222222222";
const BIA = "33333333-3333-3333-3333-333333333333";

const NOME = { [HELIO]: "Hélio", [LAIS]: "Laís", [BIA]: "Bia" };

const CASA = { id: "g-casa", nome: "Casa" };
const VIAGEM = { id: "g-viagem", nome: "Viagem" };
const PRAIA = { id: "g-praia", nome: "Praia" };

/** Membros sem peso = divisao igual, que e o caso de todo grupo nao configurado. */
const membros = (...ids) =>
  ids.map((id) => ({ user_id: id, full_name: NOME[id] ?? null }));

/**
 * A conta de internet da issue: R$ 159,90 no cartao C6, vencendo 15/10, lancada
 * no grupo. PREVISTA -- nao existe transacao nenhuma dela ainda.
 */
const internetDeOutubro = (pagador = HELIO) =>
  linhaDoPrevisto({
    id: "s-internet",
    description: "Internet",
    // `scheduled_transactions.amount` e POSITIVO por CHECK.
    amount: "159.90",
    due_date: "2026-10-15",
    user_id: pagador,
    status: "pending",
    direction: "expense",
  });

/** Uma despesa JA realizada. `amount` negativo, que e a convencao do banco. */
const realizada = (id, valor, data, pagador) =>
  linhaDoRealizado({
    id,
    description: id,
    amount: -Math.abs(valor),
    exchange_rate: 1,
    transaction_date: data,
    user_id: pagador,
    transaction_type: "expense",
  });

/** Um mes de um grupo, pronto para `creditoAReceber`. */
const mesDe = (grupo, linhas, membrosDoGrupo, mes) => ({
  grupo,
  fechamento: fecharMes(linhas, membrosDoGrupo, mes),
});

/** O cartao "Receitas" da tela, pela mesma funcao que a tela usa. */
const UM_SALARIO = [{ amount: 5000, transaction_type: "income" }];

// -----------------------------------------------------------------------------
// O CASO DA ISSUE, NUMERO POR NUMERO
// -----------------------------------------------------------------------------
test("o Helio tem R$ 106,60 a receber da Lais e da Bia, e o credito diz de quem", () => {
  const outubro = mesDe(
    CASA,
    [internetDeOutubro()],
    membros(HELIO, LAIS, BIA),
    "2026-10"
  );

  // CONTROLE DA FONTE, e nao enfeite: o credito abaixo e inteiramente sobre
  // dinheiro que NINGUEM PAGOU. Se um dia esta linha virar `total_realizado`,
  // o resto do bloco continua passando e o significado do credito mudou.
  assert.equal(outubro.fechamento.total_previsto, 159.9);
  assert.equal(outubro.fechamento.total_realizado, 0);

  const credito = creditoAReceber([outubro], HELIO);

  // 159,90 / 3 = 53,30 exatos. O Helio pagou 159,90 e deve 53,30: 106,60.
  assert.equal(credito.total, 106.6);
  // CONTROLE: 159,90 e o numero de quem esquece de descontar a PROPRIA parte --
  // o valor cheio da conta, que o Helio nao tem a receber de ninguem.
  assert.notEqual(credito.total, 159.9);

  assert.equal(credito.linhas.length, 2);
  assert.equal(credito.sem_devedor, 0);

  // Nome, grupo e valor em cada linha -- o pedido da issue, literal.
  for (const linha of credito.linhas) {
    assert.equal(linha.valor, 53.3);
    assert.equal(linha.grupo, "Casa");
    assert.equal(linha.group_id, "g-casa");
  }

  assert.deepEqual(
    credito.linhas.map((l) => l.devedor).sort(),
    ["Bia", "Laís"]
  );
  assert.deepEqual(
    credito.linhas.map((l) => l.devedor_user_id).sort(),
    [LAIS, BIA].sort()
  );
});

test("o total do cartao e a SOMA DAS LINHAS, e nao o meu saldo", () => {
  const outubro = mesDe(
    CASA,
    [internetDeOutubro()],
    membros(HELIO, LAIS, BIA),
    "2026-10"
  );

  const credito = creditoAReceber([outubro], HELIO);
  const soma = credito.linhas.reduce((acc, l) => acc + l.valor, 0);

  // O criterio da HMO-275: o numero grande tem de bater com a soma das linhas
  // que a pessoa consegue apontar na tela.
  assert.equal(credito.total, Number(soma.toFixed(2)));

  // E, neste mes, bater tambem com o meu saldo no fechamento -- as duas fontes
  // concordam em todo mes que fecha, e e por isso que escolher a errada seria
  // invisivel aqui. O bloco do centavo, mais abaixo, e onde elas divergem.
  const meuSaldo = outubro.fechamento.por_membro.find(
    (p) => p.user_id === HELIO
  ).saldo;
  assert.equal(meuSaldo, 106.6);
  assert.equal(outubro.fechamento.fecha, true);
});

// -----------------------------------------------------------------------------
// O CARTAO "Receitas" NAO SE MEXE -- A ASSERCAO QUE ESTA FASE EXISTE PARA TER
// -----------------------------------------------------------------------------
// `fecharMes` soma previsto junto com realizado por desenho. Usar a saida dele
// como receita realizada publicaria conta que ninguem pagou, e o saldo da tela
// continuaria fechando: e a familia de
// [[a-vencer-soma-receita-prevista-como-conta-a-pagar]], que este app ja pagou.
//
// As duas assercoes abaixo sao sobre CARTOES DIFERENTES, no mesmo cenario, de
// proposito. Uma assercao sobre o saldo passaria com os dois lados inflados.
test("Receitas fica em R$ 5.000 com R$ 106,60 de credito na tela", () => {
  const outubro = mesDe(
    CASA,
    [internetDeOutubro()],
    membros(HELIO, LAIS, BIA),
    "2026-10"
  );
  const credito = creditoAReceber([outubro], HELIO);

  // A minha parte da despesa de grupo que OUTRA pessoa pagou, que a HMO-275 pos
  // dentro de "Despesas". Esta aqui para o cenario ter os dois lados do
  // "bruto + reembolso" ao mesmo tempo -- e porque o mutante que importa
  // (somar a parte tambem em `receitas`) so e visivel com ela presente.
  const partes = [
    {
      id: "parte:1",
      transactionId: "t1",
      groupId: "g-casa",
      description: "Mercado",
      amount: -40,
      totalDaDespesa: -120,
      transactionDate: "2026-10-05",
      categoria: null,
      splitStatus: "approved",
      currency: "BRL",
      pagadorId: LAIS,
      pagador: "Laís",
    },
  ];

  const cartoes = resumoComPartesDeGrupo(UM_SALARIO, partes);

  // CARTAO 1 -- Receitas. O credito NAO entra aqui.
  assert.equal(cartoes.receitas, 5000);
  // CONTROLE: os dois numeros que a conta errada produziria. 5.106,60 e o
  // credito somado em receita; 5.040 e a parte de grupo somada em receita (o
  // mutante do "bruto + reembolso" com o sinal trocado).
  assert.notEqual(cartoes.receitas, 5106.6);
  assert.notEqual(cartoes.receitas, 5040);

  // CARTAO 2 -- Despesas. A parte de terceiro entra (HMO-275) e o credito nao
  // tem nada a ver com ele.
  assert.equal(cartoes.despesas, 40);

  // CARTAO 3 -- o credito, em bloco proprio.
  assert.equal(credito.total, 106.6);

  // E a prova de que os dois numeros sao INDEPENDENTES: o credito existe e
  // Receitas nao mudou.
  assert.ok(credito.total > 0);
  assert.equal(cartoes.receitas, resumoComPartesDeGrupo(UM_SALARIO, []).receitas);
});

// -----------------------------------------------------------------------------
// O CONTROLE: O MESMO MES, SEM DESPESA DE GRUPO
// -----------------------------------------------------------------------------
test("mesmo mes sem despesa de grupo: credito vazio, nota nula, Receitas igual", () => {
  const outubro = mesDe(CASA, [], membros(HELIO, LAIS, BIA), "2026-10");

  assert.equal(outubro.fechamento.total, 0);

  const credito = creditoAReceber([outubro], HELIO);

  assert.deepEqual(credito.linhas, []);
  assert.equal(credito.total, 0);
  assert.equal(credito.sem_devedor, 0);

  // `null` e nao uma frase com zero: "R$ 0,00 a receber de grupos" na tela de
  // quem nao tem credito nenhum e ruido que parece recurso quebrado -- e, pior,
  // aqui pareceria um valor que a pessoa perdeu.
  assert.equal(notaDoCreditoAReceber(credito), null);

  // E o cartao de Receitas e o MESMO do cenario com credito: a presenca ou a
  // ausencia de grupo nao move aquele numero em nenhuma direcao.
  assert.equal(resumoComPartesDeGrupo(UM_SALARIO, []).receitas, 5000);
});

test("sem grupo nenhum: a lista vazia nao inventa nota nem total", () => {
  const credito = creditoAReceber([], HELIO);
  assert.deepEqual(credito.linhas, []);
  assert.equal(credito.total, 0);
  assert.equal(notaDoCreditoAReceber(credito), null);
});

// -----------------------------------------------------------------------------
// SO O MEU SALDO POSITIVO: O MES EM QUE EU DEVO NAO E RECEITA
// -----------------------------------------------------------------------------
test("o grupo em que eu DEVO nao entra no credito, e nao reduz o do outro", () => {
  // Viagem: a Lais pagou o hotel de R$ 400; o Helio deve R$ 200 e pagou zero.
  const viagem = mesDe(
    VIAGEM,
    [realizada("hotel", 400, "2026-10-10", LAIS)],
    membros(HELIO, LAIS),
    "2026-10"
  );

  const meuSaldoNaViagem = viagem.fechamento.por_membro.find(
    (p) => p.user_id === HELIO
  ).saldo;
  assert.equal(meuSaldoNaViagem, -200);

  // Sozinho: nada a receber. O `amount` de uma transferencia sugerida e sempre
  // POSITIVO nos dois sentidos, entao um filtro por sinal devolveria R$ 200
  // aqui -- o numero certo com o sentido invertido, na tela de receita.
  const soViagem = creditoAReceber([viagem], HELIO);
  assert.deepEqual(soViagem.linhas, []);
  assert.equal(soViagem.total, 0);

  // Com a Casa junto: o credito continua sendo 106,60.
  const casa = mesDe(
    CASA,
    [internetDeOutubro()],
    membros(HELIO, LAIS, BIA),
    "2026-10"
  );
  const credito = creditoAReceber([casa, viagem], HELIO);

  assert.equal(credito.total, 106.6);
  // CONTROLE: 306,60 e o filtro ausente (as duas pontas somadas); 200 e o
  // filtro invertido, que entregaria a divida como credito.
  assert.notEqual(credito.total, 306.6);
  assert.notEqual(credito.total, 200);
  assert.equal(credito.linhas.length, 2);
  assert.ok(credito.linhas.every((l) => l.group_id === "g-casa"));

  // E ele NAO neta contra o que eu devo: este bloco responde "a receber", e nao
  // "o liquido". Quem responde o liquido e o cartao da HMO-175.
  assert.notEqual(credito.total, -93.4);
});

test("creditoDoFechamento olha `to_user_id`, e cada membro ve o seu lado", () => {
  const casa = mesDe(
    CASA,
    [internetDeOutubro()],
    membros(HELIO, LAIS, BIA),
    "2026-10"
  );

  // O Helio recebe das duas; a Lais e a Bia nao recebem de ninguem.
  assert.equal(creditoDoFechamento(casa, HELIO).length, 2);
  assert.deepEqual(creditoDoFechamento(casa, LAIS), []);
  assert.deepEqual(creditoDoFechamento(casa, BIA), []);
});

// -----------------------------------------------------------------------------
// A AGREGACAO: POR GRUPO *E* POR DEVEDOR
// -----------------------------------------------------------------------------
test("o mesmo devedor em dois grupos sao DUAS linhas, cada uma com o seu grupo", () => {
  const casa = mesDe(
    CASA,
    [internetDeOutubro()],
    membros(HELIO, LAIS, BIA),
    "2026-10"
  );
  // Praia: so o Helio e a Lais; o Helio pagou R$ 100, a Lais deve R$ 50.
  const praia = mesDe(
    PRAIA,
    [realizada("quiosque", 100, "2026-10-20", HELIO)],
    membros(HELIO, LAIS),
    "2026-10"
  );

  const credito = creditoAReceber([casa, praia], HELIO);

  assert.equal(credito.total, 156.6);
  assert.equal(credito.linhas.length, 3);

  const daLais = credito.linhas.filter((l) => l.devedor_user_id === LAIS);
  // CONTROLE: uma chave de agregacao que ignore o grupo junta as duas numa
  // linha de R$ 103,30, e o nome de um dos dois grupos desaparece da tela.
  assert.equal(daLais.length, 2);
  assert.deepEqual(daLais.map((l) => l.grupo).sort(), ["Casa", "Praia"]);
  assert.deepEqual(daLais.map((l) => l.valor).sort((a, b) => a - b), [50, 53.3]);
});

test("o mesmo devedor no mesmo grupo, em dois meses, e UMA linha somada", () => {
  const membrosDaCasa = membros(HELIO, LAIS, BIA);
  const linhas = [
    internetDeOutubro(),
    // Setembro: R$ 90 que o Helio pagou. 90 / 3 = 30 para cada.
    realizada("mercado", 90, "2026-09-12", HELIO),
  ];

  const credito = creditoAReceber(
    [
      mesDe(CASA, linhas, membrosDaCasa, "2026-09"),
      mesDe(CASA, linhas, membrosDaCasa, "2026-10"),
    ],
    HELIO
  );

  // 53,30 + 30,00 por devedor, duas devedoras.
  assert.equal(credito.linhas.length, 2);
  assert.equal(credito.total, 166.6);
  assert.ok(credito.linhas.every((l) => l.valor === 83.3));

  // CONTROLE: sem agregacao sao QUATRO linhas, duas com o mesmo nome e o mesmo
  // grupo uma embaixo da outra -- que se leem como duplicata na tela.
  assert.notEqual(credito.linhas.length, 4);
});

test("o recorte do mes e por prefixo de string, e vale nos dois fusos", () => {
  const membrosDaCasa = membros(HELIO, LAIS, BIA);
  // A primeira conta do mes: `new Date("2026-10-01")` e 21:00 de 30/09 em
  // America/Sao_Paulo, e um recorte por Date a jogaria no mes anterior.
  const linhas = [realizada("dia 1", 300, "2026-10-01", HELIO)];

  const outubro = creditoAReceber(
    [mesDe(CASA, linhas, membrosDaCasa, "2026-10")],
    HELIO
  );
  assert.equal(outubro.total, 200);

  const setembro = creditoAReceber(
    [mesDe(CASA, linhas, membrosDaCasa, "2026-09")],
    HELIO
  );
  assert.equal(setembro.total, 0);
  assert.deepEqual(setembro.linhas, []);
});

test("a ordem das linhas e estavel: maior primeiro, e o desempate nao sorteia", () => {
  const casa = mesDe(
    CASA,
    [internetDeOutubro()],
    membros(HELIO, LAIS, BIA),
    "2026-10"
  );
  const praia = mesDe(
    PRAIA,
    [realizada("quiosque", 100, "2026-10-20", HELIO)],
    membros(HELIO, LAIS),
    "2026-10"
  );

  const uma = creditoAReceber([casa, praia], HELIO);
  const outra = creditoAReceber([praia, casa], HELIO);

  // Maior primeiro.
  assert.deepEqual(uma.linhas.map((l) => l.valor), [53.3, 53.3, 50]);
  // E a MESMA ordem com os grupos entregues ao contrario -- sem isso, as linhas
  // trocariam de lugar a cada carregamento da tela sem nada ter mudado.
  assert.deepEqual(
    uma.linhas.map((l) => `${l.grupo} ${l.devedor_user_id} ${l.valor}`),
    outra.linhas.map((l) => `${l.grupo} ${l.devedor_user_id} ${l.valor}`)
  );

  // O EMPATE TEM DE SER ENTRE GRUPOS DIFERENTES, OU O DESEMPATE NAO RODA
  // --------------------------------------------------------------------
  // As duas linhas de 53,30 acima empatam, mas sao as duas da MESMA Casa: elas
  // entram no mapa na ordem dos membros do fechamento, que e a mesma nas duas
  // chamadas. `Array.prototype.sort` e estavel, entao a ordem delas sai igual
  // mesmo SEM criterio de desempate nenhum -- o bloco de cima passa verde num
  // `sort` que so compara valor, e foi um mutante que mostrou isso.
  //
  // Dois grupos com UM devedor cada, no mesmo valor, e o caso que distingue:
  // aqui a ordem de insercao MUDA entre as duas chamadas, e a unica coisa capaz
  // de devolver a mesma lista nas duas e o desempate por nome de grupo.
  const soLais = mesDe(
    CASA,
    [realizada("mercado", 100, "2026-10-11", HELIO)],
    membros(HELIO, LAIS),
    "2026-10"
  );
  const soBia = mesDe(
    PRAIA,
    [realizada("quiosque", 100, "2026-10-20", HELIO)],
    membros(HELIO, BIA),
    "2026-10"
  );

  const ordemA = creditoAReceber([soLais, soBia], HELIO);
  const ordemB = creditoAReceber([soBia, soLais], HELIO);

  // Empate de verdade: as duas valem 50,00.
  assert.deepEqual(ordemA.linhas.map((l) => l.valor), [50, 50]);
  // "Casa" antes de "Praia" nas DUAS, e nao a ordem em que os grupos chegaram.
  assert.deepEqual(ordemA.linhas.map((l) => l.grupo), ["Casa", "Praia"]);
  assert.deepEqual(ordemB.linhas.map((l) => l.grupo), ["Casa", "Praia"]);
});

// -----------------------------------------------------------------------------
// O CREDITO SEM DEVEDOR: ONDE AS DUAS FONTES DIVERGEM
// -----------------------------------------------------------------------------
test("o centavo de tolerancia deixa credito meu sem devedor, e ele nao desaparece", () => {
  // R$ 0,03 entre tres: 1 centavo cada. O Helio pagou os tres centavos, logo
  // tem 2 a receber; cada uma das outras deve 1. `simplifySettlements` descarta
  // saldo de ate um centavo (`Math.abs(cents) > 1`), entao as duas dividas
  // somem do acerto e o credito do Helio fica sem a quem cobrar.
  const centavos = mesDe(
    CASA,
    [realizada("cafe", 0.03, "2026-10-08", HELIO)],
    membros(HELIO, LAIS, BIA),
    "2026-10"
  );

  const meuSaldo = centavos.fechamento.por_membro.find(
    (p) => p.user_id === HELIO
  ).saldo;
  assert.equal(meuSaldo, 0.02);

  const credito = creditoAReceber([centavos], HELIO);

  // As linhas sao vazias -- nao ha devedor nomeado --, e o total e a soma delas.
  assert.deepEqual(credito.linhas, []);
  assert.equal(credito.total, 0);
  // CONTROLE: 0,02 e o que um total vindo do SALDO produziria. Ele nao e o
  // total; ele e `sem_devedor`, e esta escrito em separado em vez de somado a
  // uma lista vazia.
  assert.notEqual(credito.total, 0.02);
  assert.equal(credito.sem_devedor, 0.02);
});

test("o mes em que eu devo nao produz `sem_devedor` negativo", () => {
  const viagem = mesDe(
    VIAGEM,
    [realizada("hotel", 400, "2026-10-10", LAIS)],
    membros(HELIO, LAIS),
    "2026-10"
  );

  const credito = creditoAReceber([viagem], HELIO);
  // CONTROLE: -200 e o que um `saldoCents` sem o piso em zero produziria -- e
  // ele viraria DESCONTO no credito de outro grupo do mesmo periodo.
  assert.equal(credito.sem_devedor, 0);
  assert.notEqual(credito.sem_devedor, -200);
});

// -----------------------------------------------------------------------------
// O NOME DO DEVEDOR, E O CAMINHO EM QUE ELE NAO VEM
// -----------------------------------------------------------------------------
// Nenhuma policy de SELECT de `profiles` olha `group_members`: dividir a conta
// com alguem nao da acesso ao perfil dele, e o PostgREST nao levanta erro --
// devolve menos linhas. O caminho sem nome roda em producao.
test("o devedor sem perfil legivel ganha rotulo, e o rotulo nao sai em branco", () => {
  const semPerfil = mesDe(
    CASA,
    [internetDeOutubro()],
    // `full_name` nulo na Lais e espaco em branco na Bia -- os dois existem no
    // banco, e `"   " || fallback` devolveria os espacos.
    [
      { user_id: HELIO, full_name: "Hélio" },
      { user_id: LAIS, full_name: null },
      { user_id: BIA, full_name: "   " },
    ],
    "2026-10"
  );

  const credito = creditoAReceber([semPerfil], HELIO);
  assert.equal(credito.linhas.length, 2);

  for (const linha of credito.linhas) {
    const devedor = devedorNaLinha(linha);
    assert.equal(devedor.temNome, false);
    assert.equal(devedor.texto, DEVEDOR_SEM_NOME);
    // CONTROLE: o defeito a evitar e o rotulo VAZIO. Uma linha
    // "R$ 53,30 · Casa" sem mencao a outra pessoa se le como receita propria.
    assert.notEqual(devedor.texto.trim(), "");
  }

  // E o valor nao se perde com o nome: a linha continua cobravel.
  assert.equal(credito.total, 106.6);
});

test("o nome que aparece num mes e falta no outro nao e apagado na agregacao", () => {
  const membrosComNome = membros(HELIO, LAIS, BIA);
  const membrosSemNome = [
    { user_id: HELIO, full_name: "Hélio" },
    { user_id: LAIS, full_name: null },
    { user_id: BIA, full_name: null },
  ];
  const linhas = [
    internetDeOutubro(),
    realizada("mercado", 90, "2026-09-12", HELIO),
  ];

  const credito = creditoAReceber(
    [
      mesDe(CASA, linhas, membrosSemNome, "2026-09"),
      mesDe(CASA, linhas, membrosComNome, "2026-10"),
    ],
    HELIO
  );

  assert.equal(credito.linhas.length, 2);
  // O primeiro nome que chega fica. Sobrescrever com o nulo do outro mes
  // apagaria informacao que a tela ja tinha, e o valor somado continuaria
  // certo -- um defeito que nenhum numero denuncia.
  assert.deepEqual(credito.linhas.map((l) => l.devedor).sort(), ["Bia", "Laís"]);

  // A ORDEM DOS DOIS MESES E O QUE DISTINGUE O DEFEITO
  // --------------------------------------------------
  // Acima o mes SEM nome vem primeiro, e nessa ordem as duas implementacoes
  // concordam: `atual.devedor ?? linha.devedor` e um `atual.devedor =
  // linha.devedor` cru chegam os dois ao nome, porque o que estava la era nulo.
  // Um mutante que apagava a guarda SOBREVIVEU a esse arranjo.
  //
  // E a ordem inversa -- nome primeiro, nulo depois -- que mede a guarda, e e
  // justamente o caso que o comentario do modulo descreve. O periodo e lido do
  // mes mais velho para o mais novo, entao um perfil que DEIXA de ser legivel
  // no meio do periodo cai exatamente aqui.
  const inversa = creditoAReceber(
    [
      mesDe(CASA, linhas, membrosComNome, "2026-09"),
      mesDe(CASA, linhas, membrosSemNome, "2026-10"),
    ],
    HELIO
  );

  assert.equal(inversa.linhas.length, 2);
  assert.deepEqual(inversa.linhas.map((l) => l.devedor).sort(), [
    "Bia",
    "Laís",
  ]);
  // CONTROLE: `[null, null]` e o que a implementacao sem guarda produz aqui --
  // duas linhas de credito sem mencao a ninguem, que se leem como receita
  // propria na tela.
  assert.ok(inversa.linhas.every((l) => l.devedor !== null));
});

// -----------------------------------------------------------------------------
// A FRASE DO CARTAO DE RECEITAS
// -----------------------------------------------------------------------------
test("a nota conta pessoas e grupos, e concorda em numero", () => {
  const casa = mesDe(
    CASA,
    [internetDeOutubro()],
    membros(HELIO, LAIS, BIA),
    "2026-10"
  );
  const praia = mesDe(
    PRAIA,
    [realizada("quiosque", 100, "2026-10-20", HELIO)],
    membros(HELIO, LAIS),
    "2026-10"
  );

  const duasPessoasUmGrupo = notaDoCreditoAReceber(
    creditoAReceber([casa], HELIO)
  );
  assert.deepEqual(duasPessoasUmGrupo, { total: 106.6, quantos: 2, grupos: 1 });

  const doisGrupos = notaDoCreditoAReceber(
    creditoAReceber([casa, praia], HELIO)
  );
  assert.deepEqual(doisGrupos, { total: 156.6, quantos: 3, grupos: 2 });

  // CONTROLE: `grupos` conta GRUPOS DISTINTOS, e nao linhas. Um `.length` no
  // lugar do `Set` diria "3 grupos" para dois grupos.
  assert.notEqual(doisGrupos.grupos, 3);

  // O total da nota e o total do credito -- dois numeros na mesma frase que
  // divergem e o defeito que a HMO-275 fechou no cartao de Despesas.
  assert.equal(doisGrupos.total, creditoAReceber([casa, praia], HELIO).total);
});

test("um grupo onde eu nao sou membro ativo nao credita nada a mim", () => {
  // O Helio nao esta na lista de membros: a despesa que ele pagou conta no
  // total e no `devido` de todos, e nao ha a quem creditar
  // (`pago_por_nao_membro`). O credito dele tem de ser zero -- e nao a sobra.
  const semMim = mesDe(
    CASA,
    [realizada("mercado", 90, "2026-10-12", HELIO)],
    membros(LAIS, BIA),
    "2026-10"
  );

  assert.equal(semMim.fechamento.pago_por_nao_membro, 90);
  assert.equal(semMim.fechamento.fecha, false);

  const credito = creditoAReceber([semMim], HELIO);
  assert.deepEqual(credito.linhas, []);
  assert.equal(credito.total, 0);
  // CONTROLE: 90 e o que um credito lido do pagador em vez do saldo daria.
  assert.notEqual(credito.total, 90);
  assert.equal(credito.sem_devedor, 0);
});
