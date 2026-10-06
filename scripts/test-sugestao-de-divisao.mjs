// =====================================================
// A SUGESTAO DE DIVISAO VIVA (HMO-245 fase 7 / HMO-273)
// =====================================================
//   npm run test:sugestao-de-divisao
//
// O DEFEITO QUE ESTA SUITE TRANCA
// -------------------------------
// A sugestao "Divisao Proporcional" de `GET /split-suggestions` era CODIGO MORTO
// que parecia feature. Ela so montava com `default_split_type === 'proportional'`
// E algum membro com `percentage > 0`, e as duas condicoes nunca se encontravam:
// ninguem escrevia a coluna (o primeiro escritor do app e o `PUT /split-config`
// da fase 3, que grava o modo `percentage`, NUNCA `proportional`), e
// `proportional` e o SEGUNDO armazem de porcentagem do schema -- o
// `group_member_proportions` que esta fase aposenta.
//
// Por isso a suite tem TRES camadas, e nenhuma das tres cobre as outras:
//
//   1. a ARITMETICA (lib/sugestao-de-divisao.ts): os pesos de cada sugestao, e o
//      % e o R$ que saem deles;
//   2. a ROTA (app/api/.../split-suggestions/route.ts), CHAMADA de verdade com
//      os dubles da HMO-272. Esta e a medida que corresponde a promessa da fase:
//      "com 70/30 gravado, a sugestao de uma despesa nova tem que vir 70/30". Um
//      teste so da funcao prova que a FUNCAO divide 70/30; nao prova que a rota
//      le `group_members.percentage` em vez do armazem aposentado, nem que ela
//      passa o `default_split_type` do grupo, nem que a sugestao chega no corpo
//      da resposta. Cada um desses defeitos sai da rota como um 200 com o numero
//      errado -- e um handler so e verificavel por um 200;
//   3. a APOSENTADORIA do `group_member_proportions`: nenhum leitor, nenhum
//      escritor, nenhum `fetch`. A entrega 2 da issue e uma AUSENCIA, e ausencia
//      nao tem caso de teste de comportamento -- so guard.
//
// O CONTROLE POSITIVO DA CAMADA 2 ESTA NA FUNCAO `sonda`
// ------------------------------------------------------
// Ela exige `chamadasDeSessao > 0`. Uma rota que trocasse o jeito de obter o
// client devolveria uma resposta plausivel com o duble INTOCADO, e todas as
// assercoes de corpo abaixo passariam por vacuidade, medindo um fixture que o
// teste praticamente escreveu.
//
// O CONTROLE POSITIVO DA CAMADA 3 ESTA EM `semComentarios`
// --------------------------------------------------------
// Os arquivos deste recorte CITAM `group_member_proportions` na prosa, de
// proposito: o cabecalho do `split-config` explica qual dos dois armazens e a
// verdade. Um guard que nao tire os comentarios ficaria vermelho para sempre; um
// `semComentarios` que tire demais (uma barra dentro de string, por exemplo)
// ficaria verde para sempre. Os dois sentidos tem caso proprio abaixo.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { criarDuble } from "./duble-de-supabase.mjs";

const {
  PONTOS_DO_PAGADOR_PRINCIPAL,
  partesDaSugestao,
  partesParaGravar,
  pesosConfigurados,
  pesosDoHistorico,
  pesosDoPagadorPrincipal,
  pesosIguais,
} = await import("../.tmp-sugestao-de-divisao/lib/sugestao-de-divisao.js");

const ROTA = await import(
  "../.tmp-sugestao-de-divisao/app/api/expense-groups/[groupId]/split-suggestions/route.js"
);

// ---------------------------------------------------------------------------
// O FIXTURE
// ---------------------------------------------------------------------------
// Os `member_id` sao escolhidos para que a ORDEM ALFABETICA deles seja A < B < C
// e a ordem de ENTRADA seja outra em um dos casos: `ratearPorPeso` desempata
// resto igual pelo indice do array, e quem grava a despesa desempata pelo
// `member_id`. Se a sugestao rateasse na ordem recebida, o centavo extra iria
// para uma pessoa na previa e para outra na cobranca.
const GRUPO = "99999999-9999-9999-9999-999999999999";

const MEMBRO_A = "11111111-1111-1111-1111-111111111111";
const MEMBRO_B = "22222222-2222-2222-2222-222222222222";
const MEMBRO_C = "33333333-3333-3333-3333-333333333333";

const USER_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const USER_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_C = "cccccccc-cccc-cccc-cccc-cccccccccccc";

/**
 * Uma linha de `group_members` como o PostgREST a entrega para esta rota: as
 * colunas planas mais o embed `user` ja aninhado.
 */
function membro(id, userId, percentage, nome) {
  return {
    id,
    group_id: GRUPO,
    user_id: userId,
    percentage,
    status: "active",
    user: nome ? { id: userId, full_name: nome, avatar_url: undefined } : null,
  };
}

const NOME_A = "Hélio";
const NOME_B = "Convidada";
const NOME_C = "Terceiro";

// ===========================================================================
// 1. A ARITMETICA
// ===========================================================================

test("os pesos configurados saem da MESMA regra do fechamento do mes", () => {
  const pesos = pesosConfigurados("percentage", [
    { member_id: MEMBRO_A, percentage: 70 },
    { member_id: MEMBRO_B, percentage: 30 },
  ]);

  assert.deepEqual(pesos, [
    { member_id: MEMBRO_A, centesimos: 7000 },
    { member_id: MEMBRO_B, centesimos: 3000 },
  ]);
});

test("`numeric(5,2)` que chega como STRING continua valendo 70/30", () => {
  // O PostgREST entrega `numeric` como number, mas a falha do contrario e MUDA:
  // `Number("70.00")` perdido daria 0 nas duas linhas, a soma cairia em `equal`,
  // e a sugestao configurada simplesmente nunca apareceria -- sem erro, sem log,
  // com uma resposta que parece certa. Ver [[nome-de-campo-errado-esconde-bug-de-dinheiro]].
  const pesos = pesosConfigurados("percentage", [
    { member_id: MEMBRO_A, percentage: "70.00" },
    { member_id: MEMBRO_B, percentage: "30.00" },
  ]);

  assert.deepEqual(pesos, [
    { member_id: MEMBRO_A, centesimos: 7000 },
    { member_id: MEMBRO_B, centesimos: 3000 },
  ]);
});

test("o modo APOSENTADO (`proportional`) nao tem peso, mesmo com 70/30 gravado", () => {
  // Este e o coracao da fase 7 do lado da leitura: `proportional` lia o SEGUNDO
  // armazem (`group_member_proportions`), e `divisaoDoPeriodo` nao sabe aplicar
  // aquele armazem -- um grupo parado nesse modo fecha o mes IGUAL. Devolver
  // 70/30 aqui seria a sugestao discordando do fechamento, que e exatamente o
  // "duas telas discordando sobre dinheiro" que a issue manda fechar.
  assert.equal(
    pesosConfigurados("proportional", [
      { member_id: MEMBRO_A, percentage: 70 },
      { member_id: MEMBRO_B, percentage: 30 },
    ]),
    null
  );
});

test("`custom` e `equal` tambem nao tem peso configurado", () => {
  for (const modo of ["custom", "equal", "", null, undefined, 7]) {
    assert.equal(
      pesosConfigurados(modo, [
        { member_id: MEMBRO_A, percentage: 70 },
        { member_id: MEMBRO_B, percentage: 30 },
      ]),
      null,
      `o modo ${JSON.stringify(modo)} nao deveria produzir sugestao configurada`
    );
  }
});

test("soma que nao fecha 100% nao sugere a proporcao errada -- sugere nada", () => {
  // 70 e 27 somam 97. `ratearPorPeso` divide pela SOMA dos pesos, entao rateá-los
  // nao daria 97% da conta: daria 100% numa proporcao que ninguem configurou
  // (72,16% e 27,84%). Isso e PIOR que um residual visivel, porque o total fecha
  // e nada na tela denuncia o numero errado.
  assert.equal(
    pesosConfigurados("percentage", [
      { member_id: MEMBRO_A, percentage: 70 },
      { member_id: MEMBRO_B, percentage: 27 },
    ]),
    null
  );
});

test("os quatro zeros do `DEFAULT 0.00` -- todo grupo de hoje -- nao sugerem nada", () => {
  assert.equal(
    pesosConfigurados("percentage", [
      { member_id: MEMBRO_A, percentage: 0 },
      { member_id: MEMBRO_B, percentage: 0 },
    ]),
    null
  );
});

test("a divisao igual de TRES membros soma 10000 cravado, e nao 9999", () => {
  const pesos = pesosIguais([MEMBRO_A, MEMBRO_B, MEMBRO_C]);
  assert.equal(
    pesos.reduce((acc, p) => acc + p.centesimos, 0),
    10000
  );
  // 33,33 tres vezes seria 99,99: o centesimo que sobra vai para UM deles.
  assert.deepEqual(
    pesos.map((p) => p.centesimos).sort((a, b) => a - b),
    [3333, 3333, 3334]
  );
});

test("o R$ da previa fecha o total AO CENTAVO -- 70/30 de R$ 1.000", () => {
  const partes = partesDaSugestao(
    [
      { member_id: MEMBRO_A, centesimos: 7000 },
      { member_id: MEMBRO_B, centesimos: 3000 },
    ],
    1000
  );

  assert.deepEqual(
    partes.map((p) => p.amount),
    [700, 300]
  );
  assert.equal(
    partes.reduce((acc, p) => acc + p.amount, 0),
    1000
  );
});

test("o R$ da previa fecha o total AO CENTAVO onde `total * % / 100` NAO fecha", () => {
  // Tres membros e R$ 10,00. O criterio antigo da rota era `amount * percentage
  // / 100` por linha: 3,333 / 3,333 / 3,334 arredondados na tela dao 3,33 tres
  // vezes -- R$ 9,99 sob o rotulo de uma despesa de R$ 10,00. O centavo nao
  // sobra em lugar nenhum: ele vira saldo que pagamento nenhum zera.
  const pesos = pesosIguais([MEMBRO_A, MEMBRO_B, MEMBRO_C]);

  const antigo = pesos
    .map((p) => Math.round((10 * (p.centesimos / 100)) / 100 * 100) / 100)
    .reduce((acc, v) => acc + v, 0);
  assert.notEqual(
    antigo,
    10,
    "o criterio antigo deixou de errar: este caso parou de medir a diferenca"
  );

  const partes = partesDaSugestao(pesos, 10);
  assert.equal(
    partes.reduce((acc, p) => acc + p.amount, 0),
    10
  );
});

test("o centavo extra vai para o MENOR `member_id`, como quem grava a despesa", () => {
  // Dois membros e R$ 10,01 em divisao igual: os dois restos sao IDENTICOS.
  // `divisaoPorPorcentagem` (lib/divisao-do-grupo.ts) desempata por
  // `a.membro < b.membro`, e o trigger do caso igual usa `ORDER BY gm.id`. A
  // previa que desempatasse pela ordem RECEBIDA mostraria R$ 5,01 no nome de uma
  // pessoa enquanto a despesa cobra de OUTRA.
  //
  // A ordem de ENTRADA aqui e B, A -- o inverso da alfabetica -- de proposito:
  // em ordem alfabetica os dois desempates coincidiriam por acidente, e o caso
  // nao mediria nada.
  const partes = partesDaSugestao(
    [
      { member_id: MEMBRO_B, centesimos: 5000 },
      { member_id: MEMBRO_A, centesimos: 5000 },
    ],
    10.01
  );

  // A SAIDA continua na ordem recebida -- e a ordem em que a tela lista.
  assert.deepEqual(
    partes.map((p) => p.member_id),
    [MEMBRO_B, MEMBRO_A]
  );
  const porMembro = new Map(partes.map((p) => [p.member_id, p.amount]));
  assert.equal(porMembro.get(MEMBRO_A), 5.01);
  assert.equal(porMembro.get(MEMBRO_B), 5);
});

test("sem valor digitado o `amount` fica AUSENTE, e nao R$ 0,00", () => {
  for (const total of [null, undefined, 0, NaN, -5]) {
    const partes = partesDaSugestao([{ member_id: MEMBRO_A, centesimos: 10000 }], total);
    assert.equal(
      "amount" in partes[0],
      false,
      `total ${String(total)} deveria deixar o amount ausente`
    );
  }
});

test("membro em 0% FICA na lista com 0,00 -- sumido e indistinguivel de zerado", () => {
  const partes = partesDaSugestao(
    [
      { member_id: MEMBRO_A, centesimos: 10000 },
      { member_id: MEMBRO_B, centesimos: 0 },
    ],
    100
  );

  assert.equal(partes.length, 2);
  assert.deepEqual(
    partes.map((p) => p.percentage),
    [100, 0]
  );
  assert.deepEqual(
    partes.map((p) => p.amount),
    [100, 0]
  );
});

test("o corpo do POST NAO leva a parte de 0% -- ela e recusada pelo gravador", () => {
  // `divisaoPorPorcentagem` (lib/divisao-do-grupo.ts) RECUSA `percentage <= 0`
  // com "Percentual inválido na divisão: 0,00%" -- ela nao descarta, recusa a
  // divisao inteira. Antes desta fase o caso era inalcancavel (a sugestao
  // configurada nunca aparecia, entao nenhum `custom_splits` de sugestao tinha
  // zero); ligar a sugestao TORNA um grupo 100/0 capaz de oferecer uma sugestao
  // que a tela mostra certa e o POST recusa SEMPRE.
  const naTela = partesDaSugestao(
    [
      { member_id: MEMBRO_A, centesimos: 10000 },
      { member_id: MEMBRO_B, centesimos: 0 },
    ],
    100
  );

  // Na tela, os dois: sumido e indistinguivel de zerado.
  assert.equal(naTela.length, 2);

  const noCorpo = partesParaGravar(naTela);
  assert.deepEqual(
    noCorpo.map((p) => p.member_id),
    [MEMBRO_A],
    "a parte de 0% chegou ao corpo do POST: o lancamento falharia sempre"
  );
  // Tirar o zero nao muda a soma -- 0 nao contribui --, entao a conferencia de
  // 100% do outro lado continua passando pelo mesmo caminho.
  assert.equal(
    noCorpo.reduce((acc, p) => acc + p.percentage, 0),
    100
  );
});

test("`partesParaGravar` nao mexe numa divisao sem zero", () => {
  const partes = partesDaSugestao(
    [
      { member_id: MEMBRO_A, centesimos: 7000 },
      { member_id: MEMBRO_B, centesimos: 3000 },
    ],
    1000
  );
  assert.deepEqual(partesParaGravar(partes), partes);
});

test("a TELA do grupo passa a sugestao pelo `partesParaGravar` antes do POST", () => {
  // Assercao textual, e ancorada no CALL SITE -- nao no import. Um guard que
  // procurasse `partesParaGravar` no arquivo inteiro casaria com a linha do
  // `import` e ficaria verde no dia em que alguem tirasse a chamada e deixasse
  // o import (que o lint remove depois, calado). O `.tsx` da tela nao entra no
  // tsconfig desta suite, entao nao ha como o tsc provar a fiacao aqui.
  // Ver [[guard-de-fiacao-casa-com-o-import-nos-dois-sentidos]].
  const TELA = join(
    "app",
    "(dashboard)",
    "dashboard",
    "expense-groups",
    "[groupId]",
    "page.tsx"
  );
  const codigo = semComentarios(readFileSync(TELA, "utf8"));

  assert.match(
    codigo,
    /expenseData\.custom_splits\s*=\s*partesParaGravar\(/,
    `${TELA} monta \`custom_splits\` sem passar por \`partesParaGravar\`. Um ` +
      "grupo com membro em 0% oferece uma sugestao que a tela mostra certa e o " +
      "POST recusa sempre."
  );
});

test("o historico normaliza medias que NAO somam 100 para 100 cravado", () => {
  const pesos = pesosDoHistorico([
    { member_id: MEMBRO_A, somaPercentual: 123.6, participacoes: 3 },
    { member_id: MEMBRO_B, somaPercentual: 101.1, participacoes: 3 },
    { member_id: MEMBRO_C, somaPercentual: 60.3, participacoes: 3 },
  ]);

  // Medias de 41,2 / 33,7 / 20,1 -- somam 95, uma proporcao legitima que nao
  // fecha. Dividir cada uma pela soma e arredondar e o que NAO fecha.
  assert.equal(
    pesos.reduce((acc, p) => acc + p.centesimos, 0),
    10000
  );
  assert.equal(pesos[0].member_id, MEMBRO_A);
  assert.ok(pesos[0].centesimos > pesos[1].centesimos);
  assert.ok(pesos[1].centesimos > pesos[2].centesimos);
});

test("quem nao participou de NADA nao vira 0% -- a sugestao historica nao existe", () => {
  // Media de zero despesas nao e "ela paga 0%": e "nao sei". Um membro que
  // entrou ontem iria para 0% numa sugestao que parece ter sido calculada, e a
  // conta do mes inteiro cairia nos outros.
  assert.equal(
    pesosDoHistorico([
      { member_id: MEMBRO_A, somaPercentual: 150, participacoes: 3 },
      { member_id: MEMBRO_B, somaPercentual: 0, participacoes: 0 },
    ]),
    null
  );
});

test("o pagador principal assume cinco pontos, e a soma continua 100", () => {
  const pesos = pesosDoPagadorPrincipal([MEMBRO_A, MEMBRO_B], MEMBRO_A);

  assert.equal(
    pesos.reduce((acc, p) => acc + p.centesimos, 0),
    10000
  );
  assert.deepEqual(pesos, [
    { member_id: MEMBRO_A, centesimos: 5500 },
    { member_id: MEMBRO_B, centesimos: 4500 },
  ]);
  assert.equal(PONTOS_DO_PAGADOR_PRINCIPAL, 500);
});

test("o criterio ANTIGO do pagador principal somava 150% -- nao era gravavel", () => {
  // A rota montava `100/n + 5` para o pagador e `95 / (n - 1)` para cada um dos
  // outros. Com dois membros isso e 55 e 95. `divisaoParaGravar` recusa soma
  // fora de 100 por meio ponto, entao escolher esta sugestao e salvar devolvia
  // erro SEMPRE, para qualquer grupo. O caso existe para nao reintroduzirem a
  // conta: ver [[controle-do-criterio-antigo-nao-se-escreve-a-mao]] -- o criterio
  // antigo esta aqui escrito a mao porque o codigo que o continha foi apagado,
  // e e isso que esta assercao documenta.
  const antigo = [100 / 2 + 5, 95 / (2 - 1)];
  assert.equal(antigo.reduce((a, b) => a + b, 0), 150);

  const novo = pesosDoPagadorPrincipal([MEMBRO_A, MEMBRO_B], MEMBRO_A);
  assert.equal(
    novo.reduce((acc, p) => acc + p.centesimos, 0) / 100,
    100
  );
});

test("num grupo de UM a sugestao do pagador principal nao existe", () => {
  // Era ela que dividia por zero em `95 / (n - 1)`.
  assert.equal(pesosDoPagadorPrincipal([MEMBRO_A], MEMBRO_A), null);
  assert.equal(
    pesosDoPagadorPrincipal([MEMBRO_A, MEMBRO_B], "nao-e-membro"),
    null
  );
});

// ===========================================================================
// 2. A ROTA
// ===========================================================================

/**
 * Chama `GET /api/expense-groups/{GRUPO}/split-suggestions?amount=` com o duble
 * no lugar do client da sessao.
 *
 * O CONTROLE POSITIVO VIVE AQUI: `chamadasDeSessao > 0`. Ver o cabecalho.
 */
async function sonda({
  user = USER_A,
  modo = "percentage",
  membros,
  amount,
  transacoes = [],
} = {}) {
  const sessao = criarDuble({
    user: { id: user, email: `${user}@exemplo.test` },
    tabelas: {
      expense_groups: [
        { id: GRUPO, name: "Casa", default_split_type: modo },
      ],
      group_members: membros,
      group_transactions: transacoes,
    },
  });

  const registro = { sessao: () => sessao.client };
  globalThis.__dubleDeSupabase = registro;

  let resposta;
  try {
    const url = new URL(
      `https://exemplo.test/api/expense-groups/${GRUPO}/split-suggestions`
    );
    if (amount !== undefined) url.searchParams.set("amount", String(amount));

    resposta = await ROTA.GET(
      { url: url.toString() },
      { params: { groupId: GRUPO } }
    );
  } finally {
    delete globalThis.__dubleDeSupabase;
  }

  assert.ok(
    (registro.chamadasDeSessao ?? 0) > 0,
    "CONTROLE POSITIVO: a rota nao consultou o duble do client de sessao. Ela " +
      "trocou o jeito de obter o client, e todas as assercoes de corpo desta " +
      "suite passariam por vacuidade."
  );

  return { status: resposta.status, corpo: await resposta.json() };
}

/** A sugestao de um `name`, ou `undefined`. */
function sugestaoChamada(corpo, nome) {
  return corpo.suggestions.find((s) => s.name === nome);
}

const DOIS_MEMBROS_70_30 = [
  membro(MEMBRO_A, USER_A, 70, NOME_A),
  membro(MEMBRO_B, USER_B, 30, NOME_B),
];

test("A PROMESSA DA FASE: com 70/30 gravado, a sugestao de R$ 1.000 vem 70/30", async () => {
  const { status, corpo } = await sonda({
    membros: DOIS_MEMBROS_70_30,
    amount: 1000,
  });

  assert.equal(status, 200);

  const configurada = sugestaoChamada(corpo, "Divisão Configurada");
  assert.ok(
    configurada,
    "a sugestao configurada NAO apareceu. Era este o defeito da fase 7: ela " +
      "era codigo morto que parecia feature.\n" +
      `Vieram: ${corpo.suggestions.map((s) => s.name).join(", ")}`
  );

  // A sugestao configurada vem PRIMEIRO: ela e a regra que o grupo combinou, e
  // e o numero que o fechamento vai cobrar no fim do mes de qualquer jeito.
  assert.equal(corpo.suggestions[0].name, "Divisão Configurada");

  const porMembro = new Map(configurada.splits.map((s) => [s.member_id, s]));
  assert.equal(porMembro.get(MEMBRO_A).percentage, 70);
  assert.equal(porMembro.get(MEMBRO_B).percentage, 30);
  assert.equal(porMembro.get(MEMBRO_A).amount, 700);
  assert.equal(porMembro.get(MEMBRO_B).amount, 300);

  // ... E O TOTAL FECHA COM A DESPESA, AO CENTAVO.
  assert.equal(
    configurada.splits.reduce((acc, s) => acc + s.amount, 0),
    1000
  );
  assert.equal(
    configurada.splits.reduce((acc, s) => acc + s.percentage, 0),
    100
  );

  // O nome de cada pessoa viaja junto: uma parte de dinheiro sem dono nao se le.
  assert.equal(porMembro.get(MEMBRO_A).user.full_name, NOME_A);
  assert.equal(porMembro.get(MEMBRO_B).user.full_name, NOME_B);

  assert.equal(corpo.group.divisao_configurada_aplicada, true);
});

test("a rota fecha ao centavo onde `total * % / 100` nao fecha", async () => {
  // 33,33 / 33,33 / 33,34 em R$ 10,00. O criterio antigo da rota daria R$ 9,99.
  const { corpo } = await sonda({
    membros: [
      membro(MEMBRO_A, USER_A, 33.33, NOME_A),
      membro(MEMBRO_B, USER_B, 33.33, NOME_B),
      membro(MEMBRO_C, USER_C, 33.34, NOME_C),
    ],
    amount: 10,
  });

  const configurada = sugestaoChamada(corpo, "Divisão Configurada");
  assert.ok(configurada, "a sugestao configurada nao apareceu");

  const antigo = configurada.splits
    .map((s) => Math.round(10 * (s.percentage / 100) * 100) / 100)
    .reduce((acc, v) => acc + v, 0);
  assert.notEqual(
    antigo,
    10,
    "o criterio antigo deixou de errar neste fixture: ele parou de medir"
  );

  assert.equal(
    configurada.splits.reduce((acc, s) => acc + s.amount, 0),
    10
  );
});

test("CONTROLE NEGATIVO: com a config em `equal`, a sugestao volta a ser IGUAL", async () => {
  const { corpo } = await sonda({
    modo: "equal",
    membros: DOIS_MEMBROS_70_30,
    amount: 1000,
  });

  assert.equal(
    sugestaoChamada(corpo, "Divisão Configurada"),
    undefined,
    "o grupo esta em `equal` e apareceu sugestao configurada: a sugestao " +
      "passou a discordar do que o fechamento do mes vai cobrar"
  );
  assert.equal(corpo.group.divisao_configurada_aplicada, false);

  const igual = sugestaoChamada(corpo, "Divisão Igual");
  assert.ok(igual, "a divisao igual tem de estar sempre disponivel");
  assert.deepEqual(
    igual.splits.map((s) => s.percentage),
    [50, 50]
  );
  assert.deepEqual(
    igual.splits.map((s) => s.amount),
    [500, 500]
  );
});

test("CONTROLE NEGATIVO: o modo APOSENTADO nao ressuscita a sugestao", async () => {
  // `proportional` com 70/30 gravado na coluna. O armazem que esse modo lia esta
  // aposentado, e `divisaoDoPeriodo` fecha o mes IGUAL para esse grupo -- entao a
  // sugestao tambem tem de ser igual, ou a previa promete uma divisao que ninguem
  // vai cobrar.
  const { corpo } = await sonda({
    modo: "proportional",
    membros: DOIS_MEMBROS_70_30,
    amount: 1000,
  });

  assert.equal(sugestaoChamada(corpo, "Divisão Configurada"), undefined);
  assert.equal(corpo.group.divisao_configurada_aplicada, false);
  assert.equal(corpo.group.default_split_type, "proportional");

  const igual = sugestaoChamada(corpo, "Divisão Igual");
  assert.deepEqual(
    igual.splits.map((s) => s.amount),
    [500, 500]
  );
});

test("CONTROLE NEGATIVO: soma 97% gravada nao sugere 72,16/27,84", async () => {
  const { corpo } = await sonda({
    membros: [
      membro(MEMBRO_A, USER_A, 70, NOME_A),
      membro(MEMBRO_B, USER_B, 27, NOME_B),
    ],
    amount: 1000,
  });

  assert.equal(sugestaoChamada(corpo, "Divisão Configurada"), undefined);
  assert.equal(
    JSON.stringify(corpo).includes("72,16"),
    false,
    "a rota rateou a proporcao que ninguem configurou"
  );
});

test("o membro INATIVO nao entra na divisao sugerida", async () => {
  // O duble aplica `.eq("status", "active")` de verdade. Sem esse filtro a
  // pessoa que saiu do grupo continuaria ganhando percentual, e a soma dos dois
  // que ficaram deixaria de fechar 100.
  const { corpo } = await sonda({
    membros: [
      membro(MEMBRO_A, USER_A, 70, NOME_A),
      membro(MEMBRO_B, USER_B, 30, NOME_B),
      {
        ...membro(MEMBRO_C, USER_C, 0, NOME_C),
        status: "removed",
      },
    ],
    amount: 1000,
  });

  assert.equal(corpo.group.members_count, 2);
  for (const s of corpo.suggestions) {
    assert.equal(
      s.splits.some((p) => p.member_id === MEMBRO_C),
      false,
      `a sugestao "${s.name}" incluiu um membro inativo`
    );
  }
});

test("quem NAO e membro ativo do grupo recebe 403, e nao a divisao", async () => {
  const { status, corpo } = await sonda({
    user: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    membros: DOIS_MEMBROS_70_30,
    amount: 1000,
  });

  assert.equal(status, 403);
  assert.equal(corpo.suggestions, undefined);
});

test("sem `amount` a rota devolve o % e nenhum R$", async () => {
  const { corpo } = await sonda({ membros: DOIS_MEMBROS_70_30 });

  const configurada = sugestaoChamada(corpo, "Divisão Configurada");
  assert.equal(configurada.splits[0].percentage, 70);
  for (const s of configurada.splits) {
    assert.equal(
      "amount" in s,
      false,
      "sem valor digitado nao existe previa em reais -- e R$ 0,00 se leria " +
        "como 'esta pessoa nao paga nada'"
    );
  }
});

test("o perfil que a RLS nao libera vira `user: null`, e nao uma linha perdida", async () => {
  // Ser do mesmo grupo NAO da acesso a `profiles`: nenhuma policy de `profiles`
  // olha `group_members`. O embed do perfil do outro membro volta nulo, e a
  // parte dele tem de continuar na divisao -- ela e dinheiro.
  const { corpo } = await sonda({
    membros: [
      membro(MEMBRO_A, USER_A, 70, NOME_A),
      membro(MEMBRO_B, USER_B, 30, null),
    ],
    amount: 1000,
  });

  const configurada = sugestaoChamada(corpo, "Divisão Configurada");
  assert.equal(configurada.splits.length, 2);
  const doB = configurada.splits.find((s) => s.member_id === MEMBRO_B);
  assert.equal(doB.user, null);
  assert.equal(doB.amount, 300);
});

test("a sugestao historica le a parte por `member_id`, e fecha 100", async () => {
  const parte = (memberId, percentage) => ({
    id: `split-${memberId}-${percentage}`,
    amount: 0,
    percentage,
    member: { id: memberId, user_id: null },
  });

  const despesa = (id, pagador, valor, partes) => ({
    id,
    group_id: GRUPO,
    transaction: {
      id: `tx-${id}`,
      amount: valor,
      transaction_date: "2026-10-01",
      user_id: pagador,
    },
    splits: partes,
  });

  const { corpo } = await sonda({
    modo: "equal",
    membros: [
      membro(MEMBRO_A, USER_A, 0, NOME_A),
      membro(MEMBRO_B, USER_B, 0, NOME_B),
    ],
    amount: 1000,
    transacoes: [
      // Os tres pagamentos sao de pessoas DIFERENTES e com o mesmo valor: sem
      // isso o "pagador principal" apareceria e a lista teria uma sugestao a
      // mais, que nao e o que este caso mede.
      despesa("d1", USER_A, -300, [parte(MEMBRO_A, 60), parte(MEMBRO_B, 40)]),
      despesa("d2", USER_B, -300, [parte(MEMBRO_A, 60), parte(MEMBRO_B, 40)]),
      despesa("d3", USER_A, -300, [parte(MEMBRO_A, 60), parte(MEMBRO_B, 40)]),
    ],
  });

  const historica = sugestaoChamada(corpo, "Baseado no Histórico");
  assert.ok(
    historica,
    `a sugestao historica nao apareceu. Vieram: ${corpo.suggestions
      .map((s) => s.name)
      .join(", ")}`
  );
  assert.deepEqual(
    historica.splits.map((s) => s.percentage),
    [60, 40]
  );
  assert.equal(
    historica.splits.reduce((acc, s) => acc + s.amount, 0),
    1000
  );
});

test("o ajuste do pagador principal fecha 100, e nao 150", async () => {
  const despesa = (id, pagador, valor) => ({
    id,
    group_id: GRUPO,
    transaction: {
      id: `tx-${id}`,
      amount: valor,
      transaction_date: "2026-10-01",
      user_id: pagador,
    },
    splits: [],
  });

  const { corpo } = await sonda({
    modo: "equal",
    membros: [
      membro(MEMBRO_A, USER_A, 0, NOME_A),
      membro(MEMBRO_B, USER_B, 0, NOME_B),
    ],
    amount: 1000,
    transacoes: [
      despesa("d1", USER_A, -900),
      despesa("d2", USER_A, -900),
      despesa("d3", USER_B, -100),
    ],
  });

  const ajuste = sugestaoChamada(corpo, "Ajuste por Pagador Principal");
  assert.ok(
    ajuste,
    `o ajuste nao apareceu. Vieram: ${corpo.suggestions
      .map((s) => s.name)
      .join(", ")}`
  );
  assert.equal(
    ajuste.splits.reduce((acc, s) => acc + s.percentage, 0),
    100
  );
  assert.equal(
    ajuste.splits.reduce((acc, s) => acc + s.amount, 0),
    1000
  );

  const doPagador = ajuste.splits.find((s) => s.member_id === MEMBRO_A);
  assert.equal(doPagador.percentage, 55);
  assert.equal(doPagador.amount, 550);
});

test("TODA sugestao devolvida fecha 100% e fecha o valor da despesa", async () => {
  // A invariante do conjunto, varrendo a resposta inteira: nenhuma sugestao sai
  // desta rota sem passar por `partesDaSugestao`. Uma conta nova escrita no meio
  // do handler ficaria vermelha aqui mesmo que o caso dela nao existisse acima.
  const { corpo } = await sonda({
    membros: [
      membro(MEMBRO_A, USER_A, 33.33, NOME_A),
      membro(MEMBRO_B, USER_B, 33.33, NOME_B),
      membro(MEMBRO_C, USER_C, 33.34, NOME_C),
    ],
    amount: 777.77,
    transacoes: [
      {
        id: "d1",
        group_id: GRUPO,
        transaction: {
          id: "tx1",
          amount: -900,
          transaction_date: "2026-10-01",
          user_id: USER_A,
        },
        splits: [
          { id: "s1", amount: 0, percentage: 50, member: { id: MEMBRO_A } },
          { id: "s2", amount: 0, percentage: 30, member: { id: MEMBRO_B } },
          { id: "s3", amount: 0, percentage: 20, member: { id: MEMBRO_C } },
        ],
      },
      {
        id: "d2",
        group_id: GRUPO,
        transaction: {
          id: "tx2",
          amount: -50,
          transaction_date: "2026-10-02",
          user_id: USER_B,
        },
        splits: [
          { id: "s4", amount: 0, percentage: 50, member: { id: MEMBRO_A } },
          { id: "s5", amount: 0, percentage: 30, member: { id: MEMBRO_B } },
          { id: "s6", amount: 0, percentage: 20, member: { id: MEMBRO_C } },
        ],
      },
      {
        id: "d3",
        group_id: GRUPO,
        transaction: {
          id: "tx3",
          amount: -50,
          transaction_date: "2026-10-03",
          user_id: USER_C,
        },
        splits: [
          { id: "s7", amount: 0, percentage: 50, member: { id: MEMBRO_A } },
          { id: "s8", amount: 0, percentage: 30, member: { id: MEMBRO_B } },
          { id: "s9", amount: 0, percentage: 20, member: { id: MEMBRO_C } },
        ],
      },
    ],
  });

  assert.ok(
    corpo.suggestions.length >= 4,
    `o fixture devia produzir as quatro sugestoes; vieram ${corpo.suggestions
      .map((s) => s.name)
      .join(", ")}`
  );

  for (const s of corpo.suggestions) {
    assert.equal(
      s.splits.reduce((acc, p) => acc + p.percentage, 0),
      100,
      `a sugestao "${s.name}" nao soma 100%`
    );
    assert.equal(
      s.splits.reduce((acc, p) => acc + p.amount, 0),
      777.77,
      `a sugestao "${s.name}" nao fecha o valor da despesa`
    );
  }
});

// ===========================================================================
// 3. A APOSENTADORIA DO `group_member_proportions`
// ===========================================================================

/** Tira comentario de bloco e de linha -- ver o cabecalho. */
function semComentarios(fonte) {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("CONTROLE DE `semComentarios`: tira o comentario, e NAO tira o codigo", () => {
  // Os dois sentidos. Sem o primeiro caso o guard abaixo ficaria vermelho para
  // sempre (os arquivos citam a tabela na prosa, de proposito); sem o segundo
  // ficaria verde para sempre, porque um strip guloso apagaria tambem a linha
  // que faz a consulta.
  assert.equal(
    semComentarios(`
/* .from("group_member_proportions") */
// .from("group_member_proportions")
`).includes("group_member_proportions"),
    false,
    "o strip deixou passar a mencao em COMENTARIO: o guard ficaria vermelho " +
      "por causa da prosa que explica a aposentadoria"
  );

  assert.equal(
    semComentarios(`const x = supabase.from("group_member_proportions");`),
    `const x = supabase.from("group_member_proportions");`,
    "o strip comeu a linha de CODIGO: o guard passaria verde sobre uma " +
      "consulta viva"
  );

  // Uma `//` dentro de string e o caso em que um strip por regex erra: a linha
  // nao e comentario, e o resto dela tem de sobreviver.
  assert.equal(
    semComentarios(
      `const u = "https://x"; supabase.from("group_member_proportions");`
    ).includes("group_member_proportions"),
    true
  );
});

/** Todo `.ts`/`.tsx` sob `app/`, `lib/`, `components/` e `utils/`. */
function arquivosDoApp() {
  const saida = [];
  const andar = (dir) => {
    for (const nome of readdirSync(dir)) {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) {
        andar(caminho);
      } else if (/\.tsx?$/.test(nome)) {
        saida.push(caminho);
      }
    }
  };
  for (const raiz of ["app", "lib", "components", "utils"]) {
    if (existsSync(raiz)) andar(raiz);
  }
  return saida;
}

const FONTES = arquivosDoApp().map((caminho) => ({
  caminho,
  codigo: semComentarios(readFileSync(caminho, "utf8")),
}));

test("o fixture do guard nao esta vazio", () => {
  // Sem isto, um `arquivosDoApp` que devolvesse `[]` -- raiz renomeada, pasta
  // movida -- faria os tres guards abaixo passarem verde sem ler nada.
  assert.ok(
    FONTES.length > 200,
    `o guard leu ${FONTES.length} arquivos; esperava a arvore do app inteira`
  );
  assert.ok(
    FONTES.some((f) =>
      f.caminho.endsWith(
        join("app", "api", "expense-groups", "[groupId]", "split-config", "route.ts")
      )
    ),
    "o guard nao achou a rota do split-config: a varredura esta no lugar errado"
  );
});

test("ninguem LE nem ESCREVE `group_member_proportions`", () => {
  const culpados = FONTES.filter((f) =>
    /group_member_proportions/.test(f.codigo)
  ).map((f) => f.caminho);

  assert.deepEqual(
    culpados,
    [],
    "a fase 7 aposentou o segundo armazem de porcentagem. A TABELA fica no " +
      "banco (dado historico nao se joga fora), mas sem papel no calculo: " +
      "`group_members.percentage` e a verdade, e dois armazens vivos e como se " +
      "chega a duas telas discordando sobre dinheiro."
  );
});

test("ninguem chama `calculate_member_proportions`", () => {
  // A funcao SQL fica no banco, sem chamadores. Ela soma so
  // `financial_transactions` com `transaction_type = 'income'` (nao le previsto,
  // e linha com tipo NULO desaparece) e inventa R$ 1.000 para quem nao tem
  // receita, com `COALESCE(..., 1000)`. Quem semeia pela renda e
  // `lib/semear-pela-renda.ts`, da fase 6.
  const culpados = FONTES.filter((f) =>
    /calculate_member_proportions/.test(f.codigo)
  ).map((f) => f.caminho);

  assert.deepEqual(culpados, []);
});

test("nenhuma tela chama `/api/expense-groups/proportions`", () => {
  const culpados = FONTES.filter((f) =>
    /expense-groups\/proportions/.test(f.codigo)
  ).map((f) => f.caminho);

  assert.deepEqual(
    culpados,
    [],
    "a rota foi removida nesta fase. Um `fetch` sobrevivente nao quebra o " +
      "build: ele devolve o HTML do 404 e a tela mostra lista vazia -- ver " +
      "[[verify-404-is-a-false-positive-trap]]."
  );
});

test("a rota `/api/expense-groups/proportions` nao existe mais", () => {
  assert.equal(
    existsSync(join("app", "api", "expense-groups", "proportions", "route.ts")),
    false
  );
});
