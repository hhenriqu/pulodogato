// =====================================================
// OS DOIS NUMEROS DO MODO PAPEL DE PAO (HMO-286)
// =====================================================
//   npm run test:papel-de-pao
//
// "Salario Previsto" e "Total de contas" sao ROTULOS NOVOS, e e esse o risco
// que esta suite existe para cobrir: rotulo novo em cima de numero velho ja
// custou caro neste repositorio duas vezes ("Fatura atual" mostrando a divida
// inteira do cartao, "a vencer" somando salario com contas). Nos dois casos o
// numero exibido era plausivel.
//
// Ela mede `lib/papel-de-pao.ts` COMPILADO, com as dependencias de verdade --
// `STATUS_FORA_DO_PREVISTO`, `direcaoDaAgenda`, `parteDoMembro` e
// `periodoCorrente` entram pelo tsc, nao reescritos aqui. Uma copia local de
// qualquer uma delas faria a suite medir a si mesma.
//
// O RELOGIO E CONGELADO EM TODO CASO: nao ha `new Date()` nesta suite, e todo
// `hoje` e uma string literal. Teste de data aqui passa em UTC e nao ve o bug
// (a sandbox e America/Sao_Paulo, o CI e UTC), e por isso o script do
// package.json roda a suite DUAS VEZES, uma em cada fuso. Se qualquer coisa
// aqui passar a depender do relogio da maquina, uma das duas voltas reprova.
//
// OS QUATRO CASOS QUE A ISSUE EXIGE, e onde cada um esta:
//   1. o SINAL              -> "O sinal"
//   2. o RECORTE DO MES     -> "O recorte do mes"
//   3. o FILTRO DE CATEGORIA-> "O filtro de categoria"
//   4. o CASO VAZIO         -> "O caso vazio"
//
// A HMO-296 (6/6) ACRESCENTOU O TERCEIRO CARTAO -- "Quanto Sobra ou Quanto
// Falta" -- e com ele a secao "Sobra ou Falta" mais abaixo. Tres coisas daquela
// secao sao desenho de fixture e nao detalhe:
//
//   * o TITULO e lido em toda assercao de sinal, e nao so o valor. O valor sai
//     em MODULO, entao +300 e -300 imprimem o mesmo numero: uma suite que
//     medisse so o numero deixaria o mutante do sinal (`>= 0` virando `<= 0`)
//     passar por dezenas de assercoes verdes com o rotulo invertido;
//   * o mes de FALTA tem as duas magnitudes DIFERENTES (receitas 1.200,
//     despesas 1.500). Um fixture simetrico nao distingue `receitas - despesas`
//     de `despesas - receitas`, porque o modulo e o mesmo nas duas ordens;
//   * os casos de INDISPONIVEL tem UMA perna vazia e a outra cheia. Mes vazio
//     dos dois lados nao distingue a propagacao do `null` de um `?? 0`.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const {
  painelDePapel,
  sobraOuFalta,
  janelaDoMesCorrente,
  janelaDoMes,
  mesPedido,
  NOME_DA_CATEGORIA_DE_SALARIO,
  FRASE_SEM_SALARIO,
  FRASE_SEM_CONTAS,
  TITULO_SOBRA,
  TITULO_FALTA,
  TITULO_SEM_RESPOSTA,
  ROTULO_DAS_RECEITAS,
  ROTULO_DAS_DESPESAS,
} = await import("../.tmp-papel-de-pao/lib/papel-de-pao.js");

// A funcao que a ROTA usa para decidir se materializa, e de onde a rota a pega
// (nao uma copia): e dela que depende o criterio 3 da HMO-295 -- abrir novembro
// tem de CRIAR as linhas das regras recorrentes de novembro.
const { janelaParaMaterializar } = await import(
  "../.tmp-papel-de-pao/lib/periodo-do-painel.js"
);

// ---------------------------------------------------------------------------
// O FIXTURE
// ---------------------------------------------------------------------------
// Marco de 2026. Um mes so, com vizinhos dos dois lados para o recorte ter o
// que descartar.
const HOJE = "2026-03-15";
const JANELA = janelaDoMesCorrente(HOJE);

const SALARIO = "11111111-1111-1111-1111-111111111111";
const MORADIA = "22222222-2222-2222-2222-222222222222";
const SERVICOS = "33333333-3333-3333-3333-333333333333";

const GRUPO_CASA = "99999999-9999-9999-9999-999999999999";
/** O grupo Casa tem duas pessoas: metade de cada conta e minha. */
const MEMBROS = new Map([[GRUPO_CASA, 2]]);

// AS DUAS PESSOAS DO GRUPO CASA (HMO-300). A policy do 005 libera
// `group_id IS NOT NULL AND is_group_member(group_id)`, entao a leitura da rota
// traz tambem a linha de grupo do OUTRO membro -- e e por isso que o fixture
// tem dono por linha: sem isso, `posso_editar` seria sempre verdadeiro e o
// campo nao mediria nada.
const EU = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OUTRO = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

/** A conta previsivel: so o salario e so uma conta. Serve de controle. */
const LINHAS_DO_PAR = [
  {
    id: "cccccccc-0000-0000-0000-000000000001",
    description: "Salário de março",
    user_id: EU,
    due_date: "2026-03-05",
    amount: 7000,
    status: "pending",
    direction: "income",
    category_id: SALARIO,
    group_id: null,
  },
  {
    id: "cccccccc-0000-0000-0000-000000000002",
    description: "Internet",
    user_id: EU,
    due_date: "2026-03-20",
    amount: 2000,
    status: "pending",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  },
];

const LINHAS = [
  // 1) O salario do mes. O unico que entra no primeiro numero.
  ...LINHAS_DO_PAR.slice(0, 1),

  // 2) ALUGUEL RECEBIDO -- receita prevista FORA da categoria Salario. E a
  //    linha mais importante do fixture: sem ela, um codigo que lesse o
  //    `expected_income` AGREGADO de /api/scheduled-transactions/summary
  //    passaria verde aqui. Ela nao entra em nenhum dos dois numeros.
  {
    id: "cccccccc-0000-0000-0000-000000000003",
    description: "Aluguel recebido",
    user_id: EU,
    due_date: "2026-03-10",
    amount: 2500,
    status: "pending",
    direction: "income",
    category_id: MORADIA,
    group_id: null,
  },

  // 3) Conta de luz pendente: entra no total de contas.
  {
    id: "cccccccc-0000-0000-0000-000000000004",
    description: "Conta de luz",
    user_id: EU,
    due_date: "2026-03-20",
    amount: 180.5,
    status: "pending",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  },

  // 4) Conta JA PAGA: continua sendo uma conta do mes. Sem ela, no dia 30 o
  //    total de contas iria para zero debaixo do mesmo rotulo.
  {
    id: "cccccccc-0000-0000-0000-000000000005",
    description: "Condomínio",
    user_id: EU,
    due_date: "2026-03-08",
    amount: 2000,
    status: "paid",
    direction: "expense",
    category_id: MORADIA,
    group_id: null,
  },

  // 5) Assinatura CANCELADA e mensalidade PULADA: sairam da promessa do mes.
  {
    id: "cccccccc-0000-0000-0000-000000000006",
    description: "Assinatura cancelada",
    user_id: EU,
    due_date: "2026-03-12",
    amount: 99,
    status: "cancelled",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  },
  {
    id: "cccccccc-0000-0000-0000-000000000007",
    description: "Mensalidade pulada",
    user_id: EU,
    due_date: "2026-03-13",
    amount: 49,
    status: "skipped",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  },

  // 6) Despesa gravada NEGATIVA. A outra convencao de sinal do app chegando
  //    aqui: sem `Math.abs` ela DIMINUIRIA o total de contas.
  {
    id: "cccccccc-0000-0000-0000-000000000008",
    description: "Taxa lançada negativa",
    user_id: EU,
    due_date: "2026-03-22",
    amount: -300,
    status: "pending",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  },

  // 7) Aluguel do grupo Casa, R$ 3.000 para duas pessoas. Entra por 1.500.
  {
    id: "cccccccc-0000-0000-0000-000000000009",
    description: "Aluguel do grupo Casa",
    user_id: OUTRO,
    due_date: "2026-03-28",
    amount: 3000,
    status: "pending",
    direction: "expense",
    category_id: MORADIA,
    group_id: GRUPO_CASA,
  },

  // 8) e 9) Os vizinhos: o salario de ABRIL e o de FEVEREIRO. Nenhum dos dois
  //    e deste mes, e a rota pode trazer meses vizinhos de proposito (a
  //    consulta da fatura do cartao olha um mes antes).
  {
    id: "cccccccc-0000-0000-0000-000000000010",
    description: "Salário de abril",
    user_id: EU,
    due_date: "2026-04-05",
    amount: 7000,
    status: "pending",
    direction: "income",
    category_id: SALARIO,
    group_id: null,
  },
  {
    id: "cccccccc-0000-0000-0000-000000000011",
    description: "Salário de fevereiro",
    user_id: EU,
    due_date: "2026-02-05",
    amount: 7000,
    status: "pending",
    direction: "income",
    category_id: SALARIO,
    group_id: null,
  },
  // Uma conta de fevereiro, para o recorte ter o que descartar dos DOIS lados
  // no segundo numero tambem.
  {
    id: "cccccccc-0000-0000-0000-000000000012",
    description: "Conta de fevereiro",
    user_id: EU,
    due_date: "2026-02-20",
    amount: 1234.56,
    status: "pending",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  },
];

/**
 * A FATURA ABERTA SINTETIZADA, na forma que `sintetizarFaturasAbertas` monta
 * e que `agendaComFaturasAbertas` concatena no FIM da lista (HMO-300).
 *
 * Ela nao existe em tabela nenhuma: `id: null` e deliberado em
 * `FaturaPrevista`, e e dele que sai `gravada: false` no detalhe. Os campos que
 * so ela tem -- `account_id` e `invoice_month` -- sao o que vira o caminho de
 * volta para o cartao naquele mes.
 *
 * O `due_date` dela e 25/03, no MEIO do mes, para a ordenacao da lista ter o
 * que provar: concatenada no fim, ela so aparece no lugar certo se alguem
 * ordenar.
 */
const CARTAO_NUBANK = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const FATURA_ABERTA = {
  id: null,
  fatura_prevista: true,
  account_id: CARTAO_NUBANK,
  account_name: "Nubank",
  invoice_month: "2026-03-01",
  description: "Fatura Nubank 03/2026",
  amount: 820.4,
  due_date: "2026-03-25",
  status: "pending",
  direction: "expense",
  group_id: null,
  category_id: null,
};

const ctx = {
  janela: JANELA,
  membrosAtivosPorGrupo: MEMBROS,
  categoriasDeSalario: [SALARIO],
  // QUEM ESTA OLHANDO. Sem ele `posso_editar` cai para `false` em toda linha,
  // e e esse o caso negativo mais abaixo.
  meuUserId: EU,
};

/**
 * O PAR (total, quantidade) DE UM NUMERO, SEM O `detalhe` -- HMO-300.
 *
 * Os casos de aritmetica desta suite comparam o numero inteiro com
 * `deepEqual`, e `deepEqual` exige as MESMAS chaves: com o `detalhe` no tipo,
 * cada um deles teria de carregar a lista inteira escrita a mao, e um caso de
 * SOMA passaria a reprovar quando alguem mudasse uma DESCRICAO.
 *
 * Isto nao afrouxa nada: o `detalhe` de todo fixture e medido logo abaixo, e
 * contra a invariante que importa (a soma), que e mais forte do que uma lista
 * copiada.
 */
const soNumero = ({ total, quantidade }) => ({ total, quantidade });

/** 180,50 + 2.000 (paga) + 300 (negativa) + 1.500 (minha metade do grupo). */
const CONTAS_DE_MARCO = 3980.5;

/**
 * 7.000 (salario) + 2.500 (aluguel RECEBIDO) -- a parcela de cima do cartao.
 *
 * REPARE QUE ELA NAO E O SALARIO, e esse desencontro e o ponto: o cartao da
 * HMO-296 mostra 9.500 - 3.980,50 e nao 7.000 - 3.980,50. Um fixture em que
 * "Receitas" e "Salario" coincidissem passaria verde com o salario no lugar das
 * receitas -- que e a alternativa descartada pela issue, a que fecha a conta na
 * tela e mente no rotulo.
 */
const RECEITAS_DE_MARCO = 9500;

/** 9.500 - 3.980,50. Positivo: marco de 2026 SOBRA. */
const SOBRA_DE_MARCO = 5519.5;

test("a janela e o mes de hoje, e nao o horizonte", () => {
  assert.deepEqual(JANELA, { de: "2026-03-01", ate: "2026-03-31" });
});

test("os dois numeros do mes, sobre o fixture inteiro", () => {
  const painel = painelDePapel(LINHAS, ctx);

  assert.deepEqual(soNumero(painel.salario_previsto), { total: 7000, quantidade: 1 });
  assert.deepEqual(soNumero(painel.total_de_contas), {
    total: CONTAS_DE_MARCO,
    quantidade: 4,
  });
});

// ===========================================================================
// O DETALHE DO CHEVRON -- HMO-300 (9/10 do plano da HMO-279)
// ===========================================================================
// A REGRA QUE DECIDE A ENTREGA INTEIRA, E E UMA SO:
//
//     soma(detalhe) === total, em TODO fixture e nas TRES pernas.
//
// Um chevron que abre uma lista que nao fecha com o numero de cima e pior que
// cartao nenhum: ele transforma um numero conferivel num numero DESMENTIDO
// pela propria tela.
//
// E ela e aritmetica de proposito. "O detalhe tem N linhas" nao serve, e o
// motivo tem nome: o mutante desta issue e listar as linhas ANTES da divisao
// da parte do grupo -- tres linhas de R$ 3.000 debaixo de um total de
// R$ 1.500. Ele passa por QUALQUER assercao que so conte linhas, e so morre
// contra a soma. E um fixture sem linha de grupo o deixa vivo: por isso o caso
// com grupo e obrigatorio, nao opcional.
//
// A segunda metade da mesma ideia e a FATURA ABERTA sintetizada. Ela entra na
// mesma lista por um caminho completamente diferente (`agendaComFaturasAbertas`
// a concatena depois da leitura do banco), e um detalhe montado de um segundo
// `filter` sobre `linhasBrutas` a perderia -- a lista somaria MENOS que o
// total, com o total certo.

/** A soma das linhas abertas, em centavos fechados. */
const somaDoDetalhe = (numero) =>
  Number(numero.detalhe.reduce((soma, l) => soma + l.valor, 0).toFixed(2));

/**
 * TODO FIXTURE DA SUITE, nomeado -- e os quatro que esta issue acrescenta.
 *
 * A lista e explicita e nao derivada: um laco sobre fixtures gerados nao teria
 * como nomear o que falhou, e o que importa aqui e justamente saber QUAL
 * forma de lista quebrou a invariante.
 */
const FIXTURES_DO_DETALHE = [
  ["o fixture inteiro de marco", LINHAS, ctx],
  ["o par de controle (um salario, uma conta)", LINHAS_DO_PAR, ctx],
  ["o mes com a FATURA aberta sintetizada", [...LINHAS, FATURA_ABERTA], ctx],
  ["so a fatura aberta, sem linha gravada nenhuma", [FATURA_ABERTA], ctx],
  [
    "a linha de GRUPO sozinha -- o mutante da divisao mora aqui",
    LINHAS.filter((l) => l.group_id != null),
    ctx,
  ],
  [
    "a mesma linha de grupo, com TRES membros (a parte muda, a soma segue)",
    LINHAS.filter((l) => l.group_id != null),
    { ...ctx, membrosAtivosPorGrupo: new Map([[GRUPO_CASA, 3]]) },
  ],
  [
    "grupo sem contagem de membros -- o valor cheio, que erra para cima",
    LINHAS.filter((l) => l.group_id != null),
    { ...ctx, membrosAtivosPorGrupo: new Map() },
  ],
  ["o mes vazio", [], ctx],
  [
    "um mes inteiro fora da janela (so os vizinhos)",
    LINHAS.filter((l) => !l.due_date.startsWith("2026-03")),
    ctx,
  ],
  [
    "linha sem `direction` -- o painel cala os tres numeros",
    LINHAS.map(({ direction, ...resto }) => resto),
    ctx,
  ],
  [
    "sem `meuUserId` -- nenhuma linha ganha acao",
    [...LINHAS, FATURA_ABERTA],
    { ...ctx, meuUserId: undefined },
  ],
];

for (const [nome, linhas, contexto] of FIXTURES_DO_DETALHE) {
  test(`o detalhe FECHA com o total -- ${nome}`, () => {
    const painel = painelDePapel(linhas, contexto);

    for (const perna of ["salario_previsto", "receitas", "total_de_contas"]) {
      const numero = painel[perna];

      assert.ok(
        Array.isArray(numero.detalhe),
        `${perna}: o detalhe nao e uma lista`
      );

      // INDISPONIVEL NAO ABRE NADA. `total: null` nao e zero, e uma lista
      // debaixo de "indisponivel" explicaria um numero que a tela acabou de
      // dizer que nao sabe.
      if (numero.total === null) {
        assert.deepEqual(
          numero.detalhe,
          [],
          `${perna}: total indisponivel, mas o chevron teria o que abrir`
        );
        assert.equal(numero.quantidade, 0, `${perna}`);
        continue;
      }

      // A INVARIANTE. E uma igualdade exata, nao uma tolerancia: as duas saem
      // do mesmo `toFixed(2)`.
      assert.equal(
        somaDoDetalhe(numero),
        numero.total,
        `${perna}: a soma das linhas abertas nao e o total do cartao`
      );

      // E a contagem e a MESMA lista. Sem isto, um detalhe que somasse certo
      // com linhas fundidas (duas de R$ 100 viradas uma de R$ 200) passaria.
      assert.equal(
        numero.detalhe.length,
        numero.quantidade,
        `${perna}: o detalhe tem outra contagem que a do cartao`
      );

      // Nenhuma linha negativa: o cartao soma em modulo, e uma linha negativa
      // na lista fecharia a soma mentindo no sinal.
      for (const l of numero.detalhe) {
        assert.ok(l.valor >= 0, `${perna}: linha com valor negativo na lista`);
        assert.equal(typeof l.data, "string", `${perna}: linha sem data`);
      }

      // CRONOLOGICA. A fatura sintetizada e concatenada no FIM da lista crua;
      // sem ordenar, ela apareceria depois da conta do dia 28 por acidente de
      // montagem.
      const datas = numero.detalhe.map((l) => l.data);
      assert.deepEqual(
        datas,
        [...datas].sort(),
        `${perna}: a lista nao esta em ordem de vencimento`
      );
    }
  });
}

test("O MUTANTE DA ISSUE: a linha de grupo entra pela MINHA parte, e rotulada", () => {
  // O aluguel do grupo Casa e de R$ 3.000, e o grupo tem duas pessoas. Listar
  // a linha ANTES de `parteDoMembro` poria R$ 3.000 debaixo de um total que
  // tem R$ 1.500 dela -- e passaria por qualquer assercao que so contasse
  // linhas. A soma acima ja mata o mutante; este caso diz em quanto.
  const doGrupo = LINHAS.filter((l) => l.group_id != null);
  const painel = painelDePapel(doGrupo, ctx);

  assert.equal(painel.total_de_contas.total, 1500);
  assert.equal(painel.total_de_contas.detalhe.length, 1);

  const linha = painel.total_de_contas.detalhe[0];
  assert.equal(linha.valor, 1500, "a lista mostra o valor CHEIO do grupo");
  assert.equal(linha.de_grupo, true, "a linha de grupo nao vem rotulada");
  assert.equal(linha.descricao, "Aluguel do grupo Casa");

  // E O CONTROLE: a linha PESSOAL nao vem rotulada como de grupo. Sem ele,
  // `de_grupo: true` fixo passaria no caso de cima.
  const pessoal = painelDePapel(LINHAS_DO_PAR, ctx);
  assert.deepEqual(
    pessoal.total_de_contas.detalhe.map((l) => l.de_grupo),
    [false]
  );
});

test("a FATURA aberta aparece na lista: nao gravada, com o caminho de volta", () => {
  const painel = painelDePapel([...LINHAS, FATURA_ABERTA], ctx);
  const contas = painel.total_de_contas;

  // Ela ENTRA no total -- e a maior conta de muita gente.
  assert.equal(contas.total, Number((CONTAS_DE_MARCO + 820.4).toFixed(2)));
  assert.equal(contas.quantidade, 5);

  const fatura = contas.detalhe.find((l) => l.descricao === FATURA_ABERTA.description);
  assert.ok(fatura, "a fatura aberta nao aparece na lista que o chevron abre");
  assert.equal(fatura.gravada, false, "a fatura sintetizada veio como gravada");
  assert.equal(fatura.id, null);
  assert.equal(fatura.valor, 820.4);
  assert.deepEqual(fatura.fatura, {
    accountId: CARTAO_NUBANK,
    mes: "2026-03-01",
  });

  // SEM ACAO: ela nao tem `scheduled_transactions.id`, e uma baixa com id
  // inventado responde 404 -- que para quem clicou se le como "o app nao
  // conseguiu".
  assert.equal(fatura.posso_editar, false);

  // E O CONTROLE: toda linha GRAVADA sai sem `fatura`, senao o campo nao
  // distingue nada.
  for (const l of contas.detalhe.filter((l) => l.gravada)) {
    assert.equal(l.fatura, null, `${l.descricao} ganhou caminho de fatura`);
  }

  // E a ordem poe a fatura (25/03) ANTES do aluguel do grupo (28/03), mesmo
  // tendo sido concatenada DEPOIS dele na lista crua.
  assert.deepEqual(
    contas.detalhe.map((l) => l.data),
    ["2026-03-08", "2026-03-20", "2026-03-22", "2026-03-25", "2026-03-28"]
  );
});

test("`posso_editar`: a minha linha sim, a do outro membro do grupo nao", () => {
  const painel = painelDePapel(LINHAS, ctx);

  // O salario e meu: ele ganha acao.
  assert.deepEqual(
    painel.salario_previsto.detalhe.map((l) => ({
      descricao: l.descricao,
      gravada: l.gravada,
      posso_editar: l.posso_editar,
    })),
    [{ descricao: "Salário de março", gravada: true, posso_editar: true }]
  );

  // O aluguel do grupo e do OUTRO membro: ele entra no total (e a minha
  // metade do que vou pagar) e sai SEM acao. A RLS recusaria o `DELETE`, e o
  // modo de falha pior ja esta medido aqui: `UPDATE` filtrado pela RLS volta
  // 200 sem alterar nada -- o app diz "pronto" e a linha fica.
  const doOutro = painel.total_de_contas.detalhe.find((l) => l.de_grupo);
  assert.equal(doOutro.gravada, true, "a linha do outro membro existe no banco");
  assert.equal(doOutro.posso_editar, false);

  // E AS MINHAS CONTAS, no mesmo cartao, continuam editaveis -- sem este par o
  // caso de cima passaria com `posso_editar: false` fixo.
  assert.deepEqual(
    painel.total_de_contas.detalhe
      .filter((l) => !l.de_grupo)
      .map((l) => l.posso_editar),
    [true, true, true]
  );
});

test("`posso_editar` FALHA FECHADO: sem `meuUserId`, nenhuma linha ganha acao", () => {
  // O caso do campo que a rota esqueceu de passar. Botao ausente e ruim;
  // botao que aparece e nao funciona e pior -- e esta e a direcao barata.
  const painel = painelDePapel(LINHAS, { ...ctx, meuUserId: undefined });

  assert.deepEqual(
    painel.total_de_contas.detalhe.map((l) => l.posso_editar),
    [false, false, false, false]
  );

  // E o controle positivo: com o campo, as mesmas linhas respondem outra
  // coisa. Sem ele, este caso ficaria verde com `posso_editar` apagado de vez.
  assert.ok(
    painelDePapel(LINHAS, ctx).total_de_contas.detalhe.some(
      (l) => l.posso_editar
    ),
    "nenhuma linha e editavel nem com o meuUserId -- o caso acima e vacuo"
  );
});

test("sem `user_id` na leitura, a linha entra na soma e sai sem acao", () => {
  // A rota que esquecesse a coluna no `select`. O total continua certo -- o
  // campo nao entra em soma nenhuma --, e a lista perde os botoes.
  const semDono = LINHAS.map(({ user_id, ...resto }) => resto);
  const painel = painelDePapel(semDono, ctx);

  assert.equal(painel.total_de_contas.total, CONTAS_DE_MARCO);
  assert.deepEqual(
    painel.total_de_contas.detalhe.map((l) => l.posso_editar),
    [false, false, false, false]
  );
});

test("sem `id` na leitura, a linha vira NAO GRAVADA -- e o total nao muda", () => {
  // A outra coluna nova. `gravada` sai do `id`, como em `LinhaDaTela`: sem
  // ele, nenhuma linha oferece acao, e isso e melhor do que oferecer uma acao
  // que monta a URL com `undefined`.
  const semId = LINHAS.map(({ id, ...resto }) => resto);
  const painel = painelDePapel(semId, ctx);

  assert.equal(painel.total_de_contas.total, CONTAS_DE_MARCO);
  assert.deepEqual(
    painel.total_de_contas.detalhe.map((l) => [l.gravada, l.posso_editar]),
    [
      [false, false],
      [false, false],
      [false, false],
      [false, false],
    ]
  );
});

test("sem `description`, a lista sai sem nome -- e nao com um nome inventado", () => {
  const semNome = LINHAS_DO_PAR.map(({ description, ...resto }) => resto);
  const painel = painelDePapel(semNome, ctx);

  assert.deepEqual(
    painel.total_de_contas.detalhe.map((l) => l.descricao),
    [null]
  );
  // E o total nao se mexe: nenhum destes campos entra na soma.
  assert.equal(painel.total_de_contas.total, 2000);
});

test("os TRES detalhes sao listas distintas -- um nao e o outro", () => {
  // `semLinha` era uma constante compartilhada ate a HMO-300. Com um array
  // dentro, a constante daria a MESMA lista para os tres numeros, e um `push`
  // num cartao apareceria nos outros dois.
  const vazio = painelDePapel([], ctx);
  assert.notEqual(vazio.salario_previsto.detalhe, vazio.total_de_contas.detalhe);
  assert.notEqual(vazio.receitas.detalhe, vazio.total_de_contas.detalhe);

  // E no mes cheio o salario e um SUBCONJUNTO das receitas, nao o mesmo array.
  const painel = painelDePapel(LINHAS, ctx);
  assert.notEqual(painel.salario_previsto.detalhe, painel.receitas.detalhe);
  assert.deepEqual(
    painel.receitas.detalhe.map((l) => l.descricao),
    ["Salário de março", "Aluguel recebido"]
  );
  assert.deepEqual(
    painel.salario_previsto.detalhe.map((l) => l.descricao),
    ["Salário de março"]
  );
});

// ---------------------------------------------------------------------------
// 1. O SINAL
// ---------------------------------------------------------------------------
test("O sinal: a despesa negativa SOMA no total de contas, nao subtrai", () => {
  const semNegativa = LINHAS.filter((l) => Number(l.amount) >= 0);

  const comTudo = painelDePapel(LINHAS, ctx).total_de_contas.total;
  const sem = painelDePapel(semNegativa, ctx).total_de_contas.total;

  // A linha vale -300. Somada crua, o total CAIRIA 300 em vez de subir 300 --
  // e os dois numeros seriam plausiveis.
  assert.equal(comTudo - sem, 300);
  assert.equal(comTudo, CONTAS_DE_MARCO);
});

test("O sinal: o salario nao cancela as contas -- sao dois numeros, nao um saldo", () => {
  const painel = painelDePapel(LINHAS_DO_PAR, ctx);

  assert.equal(painel.salario_previsto.total, 7000);
  assert.equal(painel.total_de_contas.total, 2000);

  // Os tres jeitos de errar isto, cada um com cara de certo:
  //   9000  -> somou tudo num acumulador positivo (o defeito da HMO-187)
  //   5000  -> deixou o salario cancelar as contas
  //  -5000  -> inverteu o par
  for (const errado of [9000, 5000, -5000]) {
    assert.notEqual(painel.total_de_contas.total, errado);
  }
});

test("O sinal: nenhum dos dois numeros sai negativo", () => {
  const painel = painelDePapel(LINHAS, ctx);
  assert.ok(painel.salario_previsto.total > 0);
  assert.ok(painel.total_de_contas.total > 0);
});

// ---------------------------------------------------------------------------
// 2. O RECORTE DO MES
// ---------------------------------------------------------------------------
test("O recorte do mes: o salario de abril e o de fevereiro ficam fora", () => {
  const painel = painelDePapel(LINHAS, ctx);

  // Tres salarios de R$ 7.000 no fixture, um por mes.
  assert.equal(painel.salario_previsto.total, 7000);
  assert.notEqual(painel.salario_previsto.total, 21000);
  assert.equal(painel.salario_previsto.quantidade, 1);
});

test("O recorte do mes: a conta de fevereiro nao entra no total de marco", () => {
  const painel = painelDePapel(LINHAS, ctx);

  assert.equal(painel.total_de_contas.total, CONTAS_DE_MARCO);
  // Sem recorte, a de fevereiro (1.234,56) entraria e o numero ainda pareceria
  // um total de contas perfeitamente comum.
  assert.notEqual(painel.total_de_contas.total, CONTAS_DE_MARCO + 1234.56);
});

test("O recorte do mes: so vizinho, nenhuma linha do mes -> indisponivel nos dois", () => {
  const soVizinhos = LINHAS.filter(
    (l) => !l.due_date.startsWith("2026-03")
  );

  const painel = painelDePapel(soVizinhos, ctx);
  assert.deepEqual(soNumero(painel.salario_previsto), { total: null, quantidade: 0 });
  assert.deepEqual(soNumero(painel.total_de_contas), { total: null, quantidade: 0 });
});

test("O recorte do mes: os dois extremos da janela ENTRAM", () => {
  const nasPontas = [
    {
      due_date: "2026-03-01",
      amount: 10,
      status: "pending",
      direction: "expense",
      category_id: SERVICOS,
      group_id: null,
    },
    {
      due_date: "2026-03-31",
      amount: 5,
      status: "pending",
      direction: "expense",
      category_id: SERVICOS,
      group_id: null,
    },
  ];

  // Janela FECHADA dos dois lados. Um `<` no lugar do `<=` tiraria a conta que
  // vence no ultimo dia do mes -- a mais comum que existe.
  const painel = painelDePapel(nasPontas, ctx);
  assert.deepEqual(soNumero(painel.total_de_contas), { total: 15, quantidade: 2 });
});

test("O recorte do mes nasce do fuso de Sao Paulo, nao de UTC", () => {
  // 30 de setembro as 21:00 em Sao Paulo ja e 1o de outubro em UTC. Com `hoje`
  // vindo do fuso certo (`today()`, que a rota chama), a janela e setembro.
  assert.deepEqual(janelaDoMesCorrente("2026-09-30"), {
    de: "2026-09-01",
    ate: "2026-09-30",
  });

  // E o ultimo dia e o do mes de verdade, inclusive em fevereiro bissexto.
  assert.equal(janelaDoMesCorrente("2026-02-10").ate, "2026-02-28");
  assert.equal(janelaDoMesCorrente("2024-02-10").ate, "2024-02-29");
});

// ---------------------------------------------------------------------------
// 2b. O MES PEDIDO -- `?month=AAAA-MM` (HMO-295)
// ---------------------------------------------------------------------------
// O MUTANTE QUE DECIDE ESTA SECAO: ignorar o `?month=` e usar sempre o mes
// corrente. Ele SO MORRE porque o `hoje` destes casos (marco de 2026) e de um
// mes diferente do mes pedido em cada um deles. Um caso que pedisse o mes
// corrente seria sonda VACUA: passaria verde com o parametro inteiramente
// desligado, porque as duas respostas coincidem.
//
// `hoje` continua string literal, e as duas voltas do script (Sao Paulo e UTC)
// continuam valendo: a janela do mes pedido nao passa por `new Date` nenhum, e
// esta secao e onde isso seria facil de quebrar -- `new Date("2026-11-01")` e
// meia-noite UTC e em Sao Paulo ja e 31 de outubro.

test("o mes pedido manda: `2026-11` devolve NOVEMBRO, com hoje em marco", () => {
  assert.deepEqual(janelaDoMes("2026-11", HOJE), {
    de: "2026-11-01",
    ate: "2026-11-30",
  });

  // O mes corrente do fixture, que e a resposta do mutante. Se este `notEqual`
  // ficasse verde junto com o de cima, os dois meses seriam o mesmo e a secao
  // nao mediria nada.
  assert.notDeepEqual(janelaDoMes("2026-11", HOJE), JANELA);
  assert.notEqual(HOJE.slice(0, 7), "2026-11");
});

test("o mes pedido anda para TRAS tambem, e nao so para frente", () => {
  // Um `Math.max(mes, hoje)` escondido no caminho deixaria o passado preso no
  // mes corrente -- e "quanto eu tinha de contas no mes passado" e metade do
  // pedido da issue.
  assert.deepEqual(janelaDoMes("2026-01", HOJE), {
    de: "2026-01-01",
    ate: "2026-01-31",
  });
  assert.deepEqual(janelaDoMes("2025-12", HOJE), {
    de: "2025-12-01",
    ate: "2025-12-31",
  });
});

test("o ultimo dia e o do mes PEDIDO -- inclusive fevereiro bissexto", () => {
  // O erro classico: somar um mes ao dia 31 e ficar preso no dia 28 (ver
  // `passoDeMes` em lib/periodo-do-painel.ts). Aqui a janela e recalculada, e
  // um fevereiro de 30 dias viraria uma conta de 1o de marco contada em
  // fevereiro.
  assert.equal(janelaDoMes("2026-02", HOJE).ate, "2026-02-28");
  assert.equal(janelaDoMes("2024-02", HOJE).ate, "2024-02-29");
  assert.equal(janelaDoMes("2026-04", HOJE).ate, "2026-04-30");
  assert.equal(janelaDoMes("2026-12", HOJE).ate, "2026-12-31");
});

test("o `month` da resposta sai da janela, e ecoa o mes pedido", () => {
  // A rota responde `janela.de.slice(0, 7)`, e e com esse campo que a tela
  // descarta a resposta de outro mes. Se ele nao ecoasse o pedido, a tela
  // descartaria TODA resposta e o painel ficaria indisponivel para sempre.
  for (const mes of ["2026-01", "2026-11", "2027-02"]) {
    assert.equal(janelaDoMes(mes, HOJE).de.slice(0, 7), mes);
  }
});

test("mes ausente ou estragado cai no mes CORRENTE -- nao em erro, nao em vazio", () => {
  // Criterio 4 da issue: `?month=` ausente, `?month=abacaxi` e `?month=2026-13`
  // todos respondem o mes corrente com status 200. Querystring estragada (link
  // antigo, parametro cortado pelo aplicativo de mensagem) nao pode apagar o
  // modulo inteiro.
  const invalidos = [
    undefined,
    null,
    "",
    "abacaxi",
    "2026-13", // mes 13 NAO existe -- e `Date.UTC(2026, 13, 0)` e um janeiro
    "2026-00", //   de 2027 perfeitamente valido, entao so a regex nao basta
    "2026-1", // sem o zero a esquerda
    "202611",
    "2026/11",
    "26-11",
    "2026-11-05", // data inteira nao e mes
    "2026-11 ", // com espaco: a querystring entrega o que vier
    123,
    {},
    ["2026-11"],
  ];

  for (const entrada of invalidos) {
    assert.deepEqual(
      janelaDoMes(entrada, HOJE),
      JANELA,
      `${JSON.stringify(entrada)} deveria cair no mes corrente`
    );
    assert.equal(mesPedido(entrada), null, `${JSON.stringify(entrada)}`);
  }
});

test("mes valido NAO cai na rede do mes corrente (o par positivo do caso acima)", () => {
  // Sem este par, o caso de cima ficaria verde numa funcao que devolvesse o
  // mes corrente para TUDO -- que e o mutante desta issue.
  for (const mes of ["2025-12", "2026-01", "2026-11", "2027-06"]) {
    assert.equal(mesPedido(mes), mes);
    assert.notDeepEqual(janelaDoMes(mes, HOJE), JANELA);
  }
});

test("sem `hoje`, a rede e o mes do relogio em Sao Paulo", () => {
  // O unico caso da suite que toca o relogio, e de proposito: a rota chama
  // `janelaDoMes(month, today())`, e um default em UTC aqui devolveria o mes
  // seguinte nas tres ultimas horas do ultimo dia do mes. A comparacao e com
  // `janelaDoMesCorrente()` (que delega para `periodoCorrente`), e nao com um
  // mes escrito a mao -- escrever o mes a mao faria o caso vencer de validade.
  assert.deepEqual(janelaDoMes(undefined), janelaDoMesCorrente());
  assert.deepEqual(janelaDoMes("abacaxi"), janelaDoMesCorrente());
});

test("o mes SEGUINTE materializa; o mes passado nao -- conferido, nao suposto", () => {
  // Criterio 3 da issue, e o elo que faz o pedido dela responder algo. A rota
  // chama `janelaParaMaterializar(janela, hoje)`, e o que esta sendo conferido
  // aqui e que a janela do mes seguinte ATRAVESSA essa funcao -- sem isso,
  // novembro diria "nenhuma conta prevista" num mes cheio de contas e o resto da
  // rota estaria correto.
  const seguinte = janelaDoMes("2026-04", HOJE);
  assert.deepEqual(janelaParaMaterializar(seguinte, HOJE), {
    de: "2026-04-01",
    ate: "2026-04-30",
  });

  // E o mes INTEIRAMENTE PASSADO devolve `null`: materializar para tras
  // fabricaria conta vencida retroativa -- o app inventando divida que a pessoa
  // nunca teve, e ainda marcada em atraso. Mes velho mostra so o que ja esta
  // gravado, e esta certo.
  assert.equal(janelaParaMaterializar(janelaDoMes("2026-01", HOJE), HOJE), null);

  // O mes corrente materializa de HOJE para frente, e nao do dia 1: a parte
  // passada da janela nao pode ganhar linha nova.
  assert.deepEqual(janelaParaMaterializar(JANELA, HOJE), {
    de: HOJE,
    ate: "2026-03-31",
  });
});

test("os dois numeros seguem a janela do mes PEDIDO, e nao a do corrente", () => {
  // O elo que fecha a secao: a janela entra em `painelDePapel` por `ctx`, e e
  // ela que decide quais linhas contam. O fixture tem o salario de ABRIL
  // (R$ 7.000, dia 05) e nenhuma conta de abril.
  const abril = painelDePapel(LINHAS, { ...ctx, janela: janelaDoMes("2026-04", HOJE) });

  assert.deepEqual(soNumero(abril.salario_previsto), { total: 7000, quantidade: 1 });
  assert.deepEqual(soNumero(abril.total_de_contas), { total: null, quantidade: 0 });

  // E o mes de marco continua respondendo o que respondia -- a janela nova nao
  // mexeu na conta, so em QUAL mes ela responde.
  const marco = painelDePapel(LINHAS, { ...ctx, janela: janelaDoMes("2026-03", HOJE) });
  assert.equal(marco.total_de_contas.total, CONTAS_DE_MARCO);
  assert.notEqual(abril.total_de_contas.total, marco.total_de_contas.total);
});

// ---------------------------------------------------------------------------
// 3. O FILTRO DE CATEGORIA
// ---------------------------------------------------------------------------
test("O filtro de categoria: aluguel recebido NAO e salario", () => {
  const painel = painelDePapel(LINHAS, ctx);

  assert.equal(painel.salario_previsto.total, 7000);

  // 9.500 = 7.000 do salario + 2.500 do aluguel recebido. E exatamente o que um
  // codigo que lesse o `expected_income` agregado da rota de resumo devolveria,
  // e e um numero com cara de salario de quem tem renda extra.
  assert.notEqual(painel.salario_previsto.total, 9500);
  assert.equal(painel.salario_previsto.quantidade, 1);
});

test("O filtro de categoria: a receita fora da categoria tambem nao vira CONTA", () => {
  // O aluguel recebido e `income`: ele nao cai no "Total de contas" so por nao
  // ser salario. As duas peneiras nao cobrem a lista inteira, e esta e a prova.
  const painel = painelDePapel(LINHAS, ctx);
  assert.equal(painel.total_de_contas.total, CONTAS_DE_MARCO);
  assert.notEqual(painel.total_de_contas.total, CONTAS_DE_MARCO + 2500);
});

test("O filtro de categoria: mais de um id de salario conta (catalogo + a propria)", () => {
  // A 036 deixa a pessoa criar a PROPRIA categoria, e o nome pode repetir o do
  // catalogo. A rota resolve os dois ids pelo mesmo nome e os dois contam.
  const MEU_SALARIO = "44444444-4444-4444-4444-444444444444";
  const linhas = [
    ...LINHAS_DO_PAR.slice(0, 1),
    {
      due_date: "2026-03-25",
      amount: 1200,
      status: "pending",
      direction: "income",
      category_id: MEU_SALARIO,
      group_id: null,
    },
  ];

  const um = painelDePapel(linhas, ctx);
  assert.deepEqual(soNumero(um.salario_previsto), { total: 7000, quantidade: 1 });

  const dois = painelDePapel(linhas, {
    ...ctx,
    categoriasDeSalario: [SALARIO, MEU_SALARIO],
  });
  assert.deepEqual(soNumero(dois.salario_previsto), { total: 8200, quantidade: 2 });
});

test("O filtro de categoria: linha sem category_id nunca cai no salario", () => {
  // A fatura sintetizada do cartao chega assim -- calculada, nao gravada. Ela e
  // `expense`, entao o lugar dela e o outro numero.
  const comFatura = [
    {
      due_date: "2026-03-10",
      amount: 450,
      status: "pending",
      direction: "expense",
      notes: "fatura:2026-03",
    },
  ];

  const painel = painelDePapel(comFatura, ctx);
  assert.deepEqual(soNumero(painel.salario_previsto), { total: null, quantidade: 0 });
  assert.deepEqual(soNumero(painel.total_de_contas), { total: 450, quantidade: 1 });
});

test("o nome da categoria e o do seed do 001, com acento", () => {
  // Digitado sem acento, o filtro nao casa com nada e o cartao do salario fica
  // vazio PARA SEMPRE, sem erro em lugar nenhum.
  assert.equal(NOME_DA_CATEGORIA_DE_SALARIO, "Salário");
});

// ---------------------------------------------------------------------------
// 4. O CASO VAZIO
// ---------------------------------------------------------------------------
test("O caso vazio: lista vazia -> indisponivel nos dois, e nao R$ 0,00", () => {
  const painel = painelDePapel([], ctx);

  assert.deepEqual(soNumero(painel.salario_previsto), { total: null, quantidade: 0 });
  assert.deepEqual(soNumero(painel.total_de_contas), { total: null, quantidade: 0 });

  // Zero e uma afirmacao sobre o dinheiro da pessoa, e nesta conta ela e falsa.
  assert.notEqual(painel.salario_previsto.total, 0);
  assert.notEqual(painel.total_de_contas.total, 0);
});

test("O caso vazio: tem contas mas nao tem salario -> um numero e uma frase", () => {
  const soContas = LINHAS.filter((l) => l.direction === "expense");
  const painel = painelDePapel(soContas, ctx);

  assert.equal(painel.salario_previsto.total, null);
  assert.equal(painel.total_de_contas.total, CONTAS_DE_MARCO);
});

test("O caso vazio: catalogo sem a categoria Salario -> indisponivel, nao zero", () => {
  const painel = painelDePapel(LINHAS, { ...ctx, categoriasDeSalario: [] });

  assert.deepEqual(soNumero(painel.salario_previsto), { total: null, quantidade: 0 });
  // O outro numero nao e afetado.
  assert.equal(painel.total_de_contas.total, CONTAS_DE_MARCO);
});

test("O caso vazio: todas as linhas do mes canceladas -> indisponivel", () => {
  const canceladas = LINHAS.filter((l) => l.due_date.startsWith("2026-03")).map(
    (l) => ({ ...l, status: "cancelled" })
  );

  const painel = painelDePapel(canceladas, ctx);
  assert.deepEqual(soNumero(painel.salario_previsto), { total: null, quantidade: 0 });
  assert.deepEqual(soNumero(painel.total_de_contas), { total: null, quantidade: 0 });
});

test("as duas frases do caso vazio existem e nao dizem zero", () => {
  for (const frase of [FRASE_SEM_SALARIO, FRASE_SEM_CONTAS]) {
    assert.equal(typeof frase, "string");
    assert.ok(frase.length > 0);
    assert.ok(!/0,00|R\$/.test(frase), `a frase do caso vazio diz um valor: ${frase}`);
  }
  assert.notEqual(FRASE_SEM_SALARIO, FRASE_SEM_CONTAS);
});

// ---------------------------------------------------------------------------
// O STATUS
// ---------------------------------------------------------------------------
test("'paid' fica DENTRO do previsto; 'skipped' e 'cancelled' saem", () => {
  const base = {
    due_date: "2026-03-10",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  };

  const paga = painelDePapel([{ ...base, amount: 100, status: "paid" }], ctx);
  assert.deepEqual(soNumero(paga.total_de_contas), { total: 100, quantidade: 1 });

  for (const status of ["skipped", "cancelled"]) {
    const fora = painelDePapel([{ ...base, amount: 100, status }], ctx);
    assert.deepEqual(
      soNumero(fora.total_de_contas),
      { total: null, quantidade: 0 },
      `status ${status} deveria sair do previsto`
    );
  }

  // 'overdue' nunca e GRAVADO (a view o calcula na hora): uma conta vencida
  // continua sendo uma conta que o mes previa.
  const vencida = painelDePapel(
    [{ ...base, amount: 100, status: "pending" }],
    ctx
  );
  assert.equal(vencida.total_de_contas.total, 100);
});

// ---------------------------------------------------------------------------
// A PARTE DO GRUPO
// ---------------------------------------------------------------------------
test("a linha de grupo entra pela MINHA parte, nao pelo valor cheio", () => {
  const doGrupo = [
    {
      due_date: "2026-03-28",
      amount: 3000,
      status: "pending",
      direction: "expense",
      category_id: MORADIA,
      group_id: GRUPO_CASA,
    },
  ];

  // Duas pessoas no grupo: metade.
  const comMetade = painelDePapel(doGrupo, ctx);
  assert.deepEqual(soNumero(comMetade.total_de_contas), { total: 1500, quantidade: 1 });

  // Sem a contagem de membros o valor fica CHEIO -- erra para cima, que e a
  // direcao barata (ver lib/parte-do-grupo.ts). O que nao pode e a policy do
  // 005, que devolve a previsto de grupo dos OUTROS membros, virar R$ 3.000 no
  // total de contas de quem nao cadastrou nada.
  const semMapa = painelDePapel(doGrupo, {
    ...ctx,
    membrosAtivosPorGrupo: new Map(),
  });
  assert.equal(semMapa.total_de_contas.total, 3000);
});

// ---------------------------------------------------------------------------
// A DIRECAO AUSENTE CALA O PAINEL
// ---------------------------------------------------------------------------
test("direcao ausente deixa os DOIS numeros indisponiveis", () => {
  // Se a view do 027 deixar de entregar `direction`, o default historico
  // ('expense') poria o salario dentro do total de contas: o painel mostraria
  // "nenhum salario previsto" e uma conta inflada em R$ 7.000, com cara de mes
  // apertado. A tela escreve "indisponivel" em vez disso.
  const semDirecao = LINHAS.map(({ direction, ...resto }) => resto);

  const painel = painelDePapel(semDirecao, ctx);
  assert.deepEqual(soNumero(painel.salario_previsto), { total: null, quantidade: 0 });
  assert.deepEqual(soNumero(painel.total_de_contas), { total: null, quantidade: 0 });
});

test("direcao ausente FORA da janela nao cala nada", () => {
  // A linha que a tela nao mostra nao pode apagar a que ela mostra. Um
  // vizinho mal formado nao derruba o mes.
  const linhas = [
    ...LINHAS_DO_PAR,
    { due_date: "2026-04-09", amount: 500, status: "pending" },
  ];

  const painel = painelDePapel(linhas, ctx);
  assert.equal(painel.salario_previsto.total, 7000);
  assert.equal(painel.total_de_contas.total, 2000);
});

// ---------------------------------------------------------------------------
// CENTAVOS
// ---------------------------------------------------------------------------
test("a soma fecha em centavos, sem o residuo do ponto flutuante", () => {
  const tresDeDezCentavos = [0.1, 0.2, 0.3].map((amount, i) => ({
    due_date: `2026-03-0${i + 1}`,
    amount,
    status: "pending",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  }));

  // 0.1 + 0.2 + 0.3 da 0.6000000000000001 em ponto flutuante.
  assert.equal(painelDePapel(tresDeDezCentavos, ctx).total_de_contas.total, 0.6);
});

test("amount em string (como o PostgREST entrega numeric) soma igual", () => {
  const comoTexto = LINHAS.map((l) => ({ ...l, amount: String(l.amount) }));
  const painel = painelDePapel(comoTexto, ctx);

  assert.equal(painel.salario_previsto.total, 7000);
  assert.equal(painel.total_de_contas.total, CONTAS_DE_MARCO);
});

// ---------------------------------------------------------------------------
// A PERNA DAS RECEITAS -- HMO-296 (6/6)
// ---------------------------------------------------------------------------
// Ela e um `aceita` novo dentro do MESMO `somarPerna`, e nao uma segunda soma:
// a janela, o status, o sinal e a parte do grupo saem da mesma peneira que o
// "Total de contas" usa. Os casos abaixo medem exatamente isso -- se alguem
// reescrever a perna como um `reduce` local, cada um deles quebra num elo
// diferente.

test("as receitas sao TODA receita prevista do mes, e nao so o salario", () => {
  const painel = painelDePapel(LINHAS, ctx);

  // 7.000 de salario + 2.500 de aluguel recebido. As duas sao receita; so uma
  // e salario.
  assert.deepEqual(soNumero(painel.receitas), {
    total: RECEITAS_DE_MARCO,
    quantidade: 2,
  });

  // E o par que da sentido ao numero: o salario e um SUBCONJUNTO das receitas,
  // e as duas nao sao a mesma coisa. Um codigo que usasse o salario como
  // "Receitas" passaria por qualquer assercao que so olhasse um dos dois.
  assert.equal(painel.salario_previsto.total, 7000);
  assert.ok(painel.receitas.total > painel.salario_previsto.total);
});

test("a perna das receitas obedece a JANELA, como a de despesa", () => {
  // O salario de fevereiro e o de abril estao no fixture. Somados, dariam
  // 23.500 -- e uma leitura sem recorte de data soma o horizonte inteiro, que e
  // defeito que este app ja mostrou na tela.
  const painel = painelDePapel(LINHAS, ctx);
  assert.equal(painel.receitas.total, RECEITAS_DE_MARCO);
  assert.notEqual(painel.receitas.total, 23500);
});

test("a perna das receitas obedece ao STATUS: 'paid' entra, 'skipped' sai", () => {
  const base = {
    due_date: "2026-03-09",
    amount: 500,
    direction: "income",
    category_id: MORADIA,
    group_id: null,
  };

  assert.equal(
    painelDePapel([{ ...base, status: "paid" }], ctx).receitas.total,
    500,
    "a receita JA RECEBIDA saiu do previsto do mes"
  );

  for (const status of ["skipped", "cancelled"]) {
    const fora = painelDePapel([{ ...base, status }], ctx);
    assert.deepEqual(
      soNumero(fora.receitas),
      { total: null, quantidade: 0 },
      `a receita '${status}' continua contando como prevista`
    );
  }
});

test("a perna das receitas divide a linha de GRUPO pela minha parte", () => {
  // Uma receita de grupo (um reembolso previsto, um aluguel que o grupo
  // recebe): a policy do 005 devolve a linha para os dois membros, e sem
  // dividir o cartao de cada um mostraria uma sobra inflada.
  const receitaDoGrupo = [
    {
      due_date: "2026-03-11",
      amount: 1000,
      status: "pending",
      direction: "income",
      category_id: MORADIA,
      group_id: GRUPO_CASA,
    },
  ];

  assert.equal(painelDePapel(receitaDoGrupo, ctx).receitas.total, 500);
});

test("a perna das receitas soma o `amount` em MODULO", () => {
  // A outra convencao de sinal do app chegando aqui. Uma receita gravada
  // negativa DIMINUIRIA as receitas do mes -- e a sobra com ela.
  const negativa = [
    {
      due_date: "2026-03-07",
      amount: -1000,
      status: "pending",
      direction: "income",
      category_id: MORADIA,
      group_id: null,
    },
  ];

  assert.equal(painelDePapel(negativa, ctx).receitas.total, 1000);
});

// ---------------------------------------------------------------------------
// SOBRA OU FALTA -- o terceiro cartao (HMO-296)
// ---------------------------------------------------------------------------

test("o cartao sai da MESMA leitura: as parcelas sao os numeros da propria tela", () => {
  // O criterio 3 da issue, medido: nao ha terceira consulta nem segunda soma de
  // despesa. As duas parcelas do cartao sao, identicas, as duas pernas do
  // painel -- e e isso que impede o cartao de discordar do cartao colado nele.
  const painel = painelDePapel(LINHAS, ctx);

  assert.equal(painel.sobra_ou_falta.receitas, painel.receitas.total);
  assert.equal(painel.sobra_ou_falta.despesas, painel.total_de_contas.total);
  assert.equal(painel.sobra_ou_falta.receitas, RECEITAS_DE_MARCO);
  assert.equal(painel.sobra_ou_falta.despesas, CONTAS_DE_MARCO);
});

test("mes que SOBRA: o titulo e `Quanto Sobra` e o valor e Receitas - Despesas", () => {
  const painel = painelDePapel(LINHAS, ctx);

  assert.equal(painel.sobra_ou_falta.titulo, TITULO_SOBRA);
  assert.equal(painel.sobra_ou_falta.valor, SOBRA_DE_MARCO);

  // E NAO `Salario - Total de contas`, que daria 3.019,50 -- a alternativa
  // descartada pela issue. Ela fecharia a aritmetica na tela (os dois numeros
  // de cima) e mentiria no rotulo: quem recebe aluguel veria uma sobra MENOR do
  // que a real, que e o erro na direcao cara.
  assert.notEqual(painel.sobra_ou_falta.valor, 3019.5);
});

/**
 * Um mes APERTADO, com as duas magnitudes DIFERENTES.
 *
 * 1.200 de receita contra 1.500 de despesa. A diferenca de magnitude e o que
 * mata o mutante da ORDEM: com `despesas - receitas` o valor seria o MESMO 300
 * (o cartao exibe modulo) e so o titulo mudaria -- de "Quanto Falta" para
 * "Quanto Sobra". Um fixture simetrico (1.000 contra 1.000) deixaria esse
 * mutante vivo com o placar fechando.
 */
const MES_APERTADO = [
  {
    due_date: "2026-03-05",
    amount: 1200,
    status: "pending",
    direction: "income",
    category_id: SALARIO,
    group_id: null,
  },
  {
    due_date: "2026-03-18",
    amount: 1500,
    status: "pending",
    direction: "expense",
    category_id: SERVICOS,
    group_id: null,
  },
];

test("mes que FALTA: o titulo vira `Quanto Falta`, e o valor sai em MODULO", () => {
  const painel = painelDePapel(MES_APERTADO, ctx);

  // O TITULO primeiro: e a unica coisa que distingue sobrar de faltar, porque o
  // numero e o mesmo nas duas direcoes.
  assert.equal(painel.sobra_ou_falta.titulo, TITULO_FALTA);

  // "Quanto Falta: R$ 300,00", nunca "Quanto Falta: -R$ 300,00" -- que diria a
  // mesma coisa duas vezes e com dois sinais.
  assert.equal(painel.sobra_ou_falta.valor, 300);
  assert.notEqual(painel.sobra_ou_falta.valor, -300);

  // E as parcelas continuam sendo as duas pernas, na ordem certa.
  assert.equal(painel.sobra_ou_falta.receitas, 1200);
  assert.equal(painel.sobra_ou_falta.despesas, 1500);
});

test("o titulo distingue os DOIS meses -- o mesmo numero, respostas opostas", () => {
  // O par que mata o mutante do sinal sem depender do valor. Dois meses
  // espelhados: 1.500 de receita contra 1.200 de despesa SOBRA 300, e o
  // contrario FALTA 300. Os dois imprimem "R$ 300,00".
  const folgado = MES_APERTADO.map((l) => ({
    ...l,
    amount: l.direction === "income" ? 1500 : 1200,
  }));

  const comFolga = painelDePapel(folgado, ctx).sobra_ou_falta;
  const apertado = painelDePapel(MES_APERTADO, ctx).sobra_ou_falta;

  assert.equal(comFolga.valor, apertado.valor, "o fixture nao e espelhado");
  assert.equal(comFolga.titulo, TITULO_SOBRA);
  assert.equal(apertado.titulo, TITULO_FALTA);
  assert.notEqual(comFolga.titulo, apertado.titulo);
});

test("ZERO CRAVADO e Sobra: o mes fechou, nao faltou nada", () => {
  // A fronteira do `>= 0`. Aqui o mutante do sinal produz o MESMO valor
  // (R$ 0,00) com o titulo trocado, e e so o titulo que o pega.
  const empatado = MES_APERTADO.map((l) => ({ ...l, amount: 1300 }));
  const cartao = painelDePapel(empatado, ctx).sobra_ou_falta;

  assert.equal(cartao.valor, 0);
  assert.equal(cartao.titulo, TITULO_SOBRA);
  assert.notEqual(cartao.titulo, TITULO_FALTA);
});

test("os tres titulos existem, sao distintos, e nenhum deles traz sinal", () => {
  assert.equal(TITULO_SOBRA, "Quanto Sobra");
  assert.equal(TITULO_FALTA, "Quanto Falta");
  // O nome INTEIRO do cartao e a pergunta em aberto: e o titulo de quando nao
  // ha resposta, e nao um terceiro estado inventado aqui.
  assert.equal(TITULO_SEM_RESPOSTA, "Quanto Sobra ou Quanto Falta");
  assert.equal(new Set([TITULO_SOBRA, TITULO_FALTA, TITULO_SEM_RESPOSTA]).size, 3);

  // E os rotulos das duas parcelas, que sao os nomes dos dois itens do menu do
  // modo. Eles vao para a tela debaixo do resultado.
  assert.equal(ROTULO_DAS_RECEITAS, "Receitas");
  assert.equal(ROTULO_DAS_DESPESAS, "Despesas");
});

// ---------------------------------------------------------------------------
// INDISPONIVEL NAO E ZERO -- e no cartao ele CONTAMINA
// ---------------------------------------------------------------------------
// Os casos abaixo tem UMA perna vazia e a outra CHEIA, de proposito. Com as
// duas vazias, `null` e `0` dariam o mesmo titulo ("Quanto Sobra", valor zero) e
// o mutante do `?? 0` sobreviveria -- a assercao tem de poder ver o numero que o
// `?? 0` imprimiria.

test("mes com receita e SEM conta nenhuma -> indisponivel, nao `sobra tudo`", () => {
  const soReceita = LINHAS.filter(
    (l) => l.direction === "income" && l.due_date.startsWith("2026-03")
  );
  const painel = painelDePapel(soReceita, ctx);

  // O controle: a perna de cima esta CHEIA. Sem ele este caso passaria verde
  // num painel vazio dos dois lados, onde nada distingue `null` de zero.
  assert.equal(painel.receitas.total, RECEITAS_DE_MARCO);
  assert.equal(painel.total_de_contas.total, null);

  assert.deepEqual(painel.sobra_ou_falta, {
    titulo: TITULO_SEM_RESPOSTA,
    valor: null,
    receitas: RECEITAS_DE_MARCO,
    despesas: null,
  });

  // O NUMERO QUE O `?? 0` IMPRIMIRIA: "Quanto Sobra: R$ 9.500,00" num mes em
  // que as contas simplesmente nao foram lidas. E a afirmacao mais cara que
  // esta tela consegue fazer, e por isso ela esta escrita aqui.
  assert.notEqual(painel.sobra_ou_falta.valor, RECEITAS_DE_MARCO);
  assert.notEqual(painel.sobra_ou_falta.titulo, TITULO_SOBRA);
});

test("mes com conta e SEM receita nenhuma -> indisponivel, nao `falta tudo`", () => {
  const soConta = LINHAS.filter(
    (l) => l.direction === "expense" && l.due_date.startsWith("2026-03")
  );
  const painel = painelDePapel(soConta, ctx);

  assert.equal(painel.receitas.total, null);
  assert.equal(painel.total_de_contas.total, CONTAS_DE_MARCO);

  assert.equal(painel.sobra_ou_falta.titulo, TITULO_SEM_RESPOSTA);
  assert.equal(painel.sobra_ou_falta.valor, null);
  // O que o `?? 0` imprimiria do outro lado: "Quanto Falta: R$ 3.980,50" para
  // quem simplesmente nao cadastrou receita nenhuma.
  assert.notEqual(painel.sobra_ou_falta.valor, CONTAS_DE_MARCO);
  assert.notEqual(painel.sobra_ou_falta.titulo, TITULO_FALTA);
});

test("mes inteiramente vazio -> indisponivel, e nao `sobra R$ 0,00`", () => {
  const cartao = painelDePapel([], ctx).sobra_ou_falta;

  assert.equal(cartao.titulo, TITULO_SEM_RESPOSTA);
  assert.equal(cartao.valor, null);
  assert.equal(cartao.receitas, null);
  assert.equal(cartao.despesas, null);
});

test("direcao ausente cala o cartao TAMBEM, e nao so os dois numeros", () => {
  // Sem `direction`, `direcaoDaAgenda` classificaria toda linha como despesa: o
  // cartao diria "Quanto Falta: R$ 16.500,00" com cara de mes catastrofico.
  const semDirecao = LINHAS.map(({ direction, ...resto }) => resto);
  const painel = painelDePapel(semDirecao, ctx);

  assert.deepEqual(soNumero(painel.receitas), { total: null, quantidade: 0 });
  assert.equal(painel.sobra_ou_falta.titulo, TITULO_SEM_RESPOSTA);
  assert.equal(painel.sobra_ou_falta.valor, null);
});

test("`sobraOuFalta` e exportada e pura -- as duas pernas entram, nada mais", () => {
  // A funcao e medida direto, sem passar pelo painel: e dela que a tela recebe
  // o titulo, e e o nivel em que os tres mutantes da issue vivem.
  const cheio = { quantidade: 1 };

  assert.equal(sobraOuFalta({ ...cheio, total: 10 }, { ...cheio, total: 4 }).titulo, TITULO_SOBRA);
  assert.equal(sobraOuFalta({ ...cheio, total: 10 }, { ...cheio, total: 4 }).valor, 6);
  assert.equal(sobraOuFalta({ ...cheio, total: 4 }, { ...cheio, total: 10 }).titulo, TITULO_FALTA);
  assert.equal(sobraOuFalta({ ...cheio, total: 4 }, { ...cheio, total: 10 }).valor, 6);

  // Os centavos fecham: 0,1 + 0,2 contra 0,3 nao deixa residuo de ponto
  // flutuante virar "falta R$ 0,00" com o titulo de falta.
  const quaseZero = sobraOuFalta(
    { total: 0.3, quantidade: 1 },
    { total: 0.30000000000000004, quantidade: 2 }
  );
  assert.equal(quaseZero.valor, 0);
  assert.equal(quaseZero.titulo, TITULO_SOBRA);
});

// ---------------------------------------------------------------------------
// O CARTAO EM QUALQUER MES -- criterio 5, com a janela da 5/6
// ---------------------------------------------------------------------------
test("o cartao responde o mes PEDIDO, e nao o corrente", () => {
  // O `hoje` do fixture e marco; abril tem, no fixture, so o salario de
  // R$ 7.000 e nenhuma conta -- entao abril e indisponivel e marco sobra. Se o
  // cartao fosse calculado sobre a janela do mes corrente, os dois meses
  // responderiam igual.
  const abril = painelDePapel(LINHAS, {
    ...ctx,
    janela: janelaDoMes("2026-04", HOJE),
  });
  const marco = painelDePapel(LINHAS, {
    ...ctx,
    janela: janelaDoMes("2026-03", HOJE),
  });

  assert.equal(abril.receitas.total, 7000);
  assert.equal(abril.total_de_contas.total, null);
  assert.equal(abril.sobra_ou_falta.titulo, TITULO_SEM_RESPOSTA);

  assert.equal(marco.sobra_ou_falta.titulo, TITULO_SOBRA);
  assert.equal(marco.sobra_ou_falta.valor, SOBRA_DE_MARCO);
  assert.notEqual(abril.sobra_ou_falta.valor, marco.sobra_ou_falta.valor);
});

// ---------------------------------------------------------------------------
// O PORTAO DA ROTA /dashboard
// ---------------------------------------------------------------------------
// As quatro linhas que escolhem qual painel aparece. INVERTIDAS, o app fica
// exatamente ao contrario -- quem liga o modo recebe o painel de 8 requisicoes
// e quem nao liga recebe dois numeros -- e nada nesta suite, no tsc, no lint ou
// no `next build` nota: as duas pontas existem, compilam e sao do mesmo tipo.
// E a familia de defeito de "campo de rotulo passa pela suite de aritmetica".
//
// POR QUE ESTA ASSERCAO E TEXTUAL, e qual e o limite dela
// -------------------------------------------------------
// O portao vive em `page.tsx`, que importa o `PainelCompleto` inteiro -- as 8
// chamadas de rede, o seletor de periodo, 40 modulos. Monta-lo num `file://`
// com o React UMD (o desenho de `test:papel-na-tela`) significaria esbocar
// aquilo todo, e cada esboco e um lugar onde a sonda deixa de falar do codigo
// de producao. O preco aceito e este: a assercao prova a DECISAO escrita, nao a
// tela pintada. O que ela NAO cobre e um `useModoPapel` que devolvesse `papel`
// errado -- e isso `npm run test:modo-papel` e `npm run test:papel-na-tela` ja
// cobrem, cada um de um lado.
//
// O COMENTARIO E ARRANCADO ANTES, e essa e a parte que erra calado: o cabecalho
// do portao MENCIONA os dois nomes em prosa. Sobre o texto cru, um `exigido`
// passaria verde com o `return` apagado (o comentario basta) e um `proibido`
// reprovaria sempre. O controle do proprio strip esta no caso seguinte.
const PAGINA = fileURLToPath(new URL("../app/(dashboard)/dashboard/page.tsx", import.meta.url));
const FONTE_DA_PAGINA = readFileSync(PAGINA, "utf8");

/** O codigo sem comentario -- bloco `/* *\/` e linha `//`, nessa ordem. */
const semComentario = (texto) =>
  texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const CODIGO_DA_PAGINA = semComentario(FONTE_DA_PAGINA);

test("o strip de comentario funciona -- senao todo caso abaixo e vacuo", () => {
  // Uma frase que SO existe em comentario no arquivo. Se ela sobrevive ao
  // strip, o strip nao rodou e os casos seguintes estao lendo prosa.
  assert.ok(
    /NAO E HIGIENE/.test(FONTE_DA_PAGINA),
    "a ancora do controle saiu do arquivo: reescreva este caso"
  );
  assert.ok(
    !/NAO E HIGIENE/.test(CODIGO_DA_PAGINA),
    "o strip de comentario nao removeu um comentario conhecido"
  );
});

test("o portao manda o modo papel para o PainelDePapel, e nao o contrario", () => {
  assert.match(
    CODIGO_DA_PAGINA,
    /if\s*\(\s*papel\s*\)\s*return\s*<PainelDePapel\s*\/>\s*;/,
    "o ramo do modo papel nao devolve <PainelDePapel />"
  );
  assert.match(
    CODIGO_DA_PAGINA,
    /<PainelCompleto\s*\/>/,
    "o outro ramo nao devolve <PainelCompleto />"
  );

  // E o inverso NAO esta escrito em lugar nenhum: `if (papel)` devolvendo o
  // painel completo e a unica forma do defeito que compila igual.
  assert.ok(
    !/if\s*\(\s*papel\s*\)\s*return\s*<PainelCompleto/.test(CODIGO_DA_PAGINA),
    "o portao esta invertido: com o modo ligado ele devolve o painel completo"
  );
});

test("o portao espera o `mounted` ANTES de escolher um dos dois", () => {
  // Sem isto o servidor renderiza um dos dois no chute e a hidratacao quebra --
  // a tela INTEIRA troca, nao um icone.
  assert.match(
    CODIGO_DA_PAGINA,
    /if\s*\(\s*!mounted\s*\)\s*return\s*<Girando\s*\/>\s*;/,
    "o portao nao espera o mounted"
  );

  // E a espera vem PRIMEIRO. Depois do `if (papel)` ela nao protege nada.
  const ondeMounted = CODIGO_DA_PAGINA.indexOf("!mounted");
  const ondePapel = CODIGO_DA_PAGINA.indexOf("if (papel)");
  assert.ok(ondeMounted >= 0 && ondePapel >= 0);
  assert.ok(
    ondeMounted < ondePapel,
    "o `!mounted` aparece DEPOIS da escolha do painel: ali ele nao protege nada"
  );
});

// ---------------------------------------------------------------------------
// A FIACAO DA ROTA: ela tem de LER o `?month=` e passa-lo adiante (HMO-295)
// ---------------------------------------------------------------------------
// Os casos funcionais acima provam `janelaDoMes`. O que eles NAO alcancam e a
// rota, e e la que vive o mutante da issue: uma `GET()` que nunca le a
// querystring responde o mes corrente para todo pedido, e isso compila, nao da
// erro de lint e passa por todos os casos de cima -- a funcao esta certa, so
// nao e chamada com o parametro.
//
// Nenhuma suite deste repositorio importa um `route.ts` (ele arrasta
// `next/server` e o cliente do Supabase), entao a prova aqui e TEXTUAL, e os
// limites dela sao os conhecidos:
//
//   * a ancora e o CALL SITE com os argumentos, e nao o nome da funcao. Um
//     `exigido("janelaDoMes")` passaria verde com `import { janelaDoMes }`
//     intacto e a chamada apagada -- e tambem com `janelaDoMes(null, hoje)`,
//     que e o mutante escrito de outro jeito;
//   * o comentario e arrancado ANTES. O cabecalho da rota MENCIONA `month` e
//     `janelaDoMes` em prosa: sobre o texto cru, um `proibido` reprovaria
//     sempre e um `exigido` passaria com o codigo apagado. O controle do
//     proprio strip e o primeiro caso abaixo.
const ROTA = fileURLToPath(
  new URL("../app/api/papel-de-pao/painel/route.ts", import.meta.url)
);
const FONTE_DA_ROTA = readFileSync(ROTA, "utf8");
const CODIGO_DA_ROTA = semComentario(FONTE_DA_ROTA);

test("o strip de comentario funciona na rota -- senao os casos dela sao vacuos", () => {
  // Uma frase que SO existe em comentario no route.ts. Se ela sobrevive ao
  // strip, o strip nao rodou e os casos seguintes estao lendo prosa.
  assert.ok(
    /ECOA o mes que saiu da querystring/.test(FONTE_DA_ROTA),
    "a ancora do controle saiu do route.ts: reescreva este caso"
  );
  assert.ok(
    !/ECOA o mes que saiu da querystring/.test(CODIGO_DA_ROTA),
    "o strip de comentario nao removeu um comentario conhecido do route.ts"
  );
});

test("a GET recebe o request -- sem ele nao ha querystring para ler", () => {
  // A `GET()` de antes desta issue nao recebia parametro nenhum. Esta e a forma
  // mais crua do mutante, e a unica que o tsc tambem pegaria (o `request.url`
  // abaixo nao compilaria) -- as outras duas, nao.
  assert.match(
    CODIGO_DA_ROTA,
    /export\s+async\s+function\s+GET\s*\(\s*request\s*:/,
    "a GET do painel voltou a nao receber o request"
  );
});

test("a rota LE o `month` da querystring", () => {
  assert.match(
    CODIGO_DA_ROTA,
    /request\.nextUrl\.searchParams\.get\s*\(\s*"month"\s*\)/,
    "a rota nao le `month` dos searchParams do request"
  );
});

test("a rota passa o `month` para `janelaDoMes`, e nao fixa o mes corrente", () => {
  // O call site COM os argumentos. `janelaDoMes(null, hoje)` e
  // `janelaDoMesCorrente(hoje)` sao as duas formas do mutante que compilam
  // igual, e as duas falham aqui.
  assert.match(
    CODIGO_DA_ROTA,
    /janelaDoMes\s*\(\s*month\s*,\s*hoje\s*\)/,
    "a rota nao chama janelaDoMes(month, hoje)"
  );

  // E a porta do mes corrente NAO esta aberta em paralelo. `janelaDoMesCorrente`
  // continua existindo em lib/ (e `janelaDoMes` o chama como rede), mas na rota
  // ele e o mutante: chamado ali, o `?month=` nao chega a lugar nenhum.
  assert.ok(
    !/janelaDoMesCorrente/.test(CODIGO_DA_ROTA),
    "a rota voltou a calcular o mes corrente por conta propria"
  );
});

test("a rota materializa a janela do mes PEDIDO, e nao outra", () => {
  // O elo do "mes seguinte ja materializa": abrir novembro cria as linhas das
  // regras recorrentes de novembro, que e literalmente o que o comentario da
  // issue pede. Materializar a janela do mes corrente aqui deixaria novembro
  // dizendo "nenhuma conta prevista" com o resto da rota correto.
  assert.match(
    CODIGO_DA_ROTA,
    /janelaParaMaterializar\s*\(\s*janela\s*,\s*hoje\s*\)/,
    "a rota nao materializa a janela pedida"
  );

  // E a leitura das linhas usa os extremos DESSA janela, nos dois lados.
  assert.match(CODIGO_DA_ROTA, /\.gte\s*\(\s*"due_date"\s*,\s*janela\.de\s*\)/);
  assert.match(CODIGO_DA_ROTA, /\.lte\s*\(\s*"due_date"\s*,\s*janela\.ate\s*\)/);
});

test("o `month` da resposta sai da janela, e nao do relogio", () => {
  // Se ele saisse de `hoje`, a tela descartaria toda resposta de outro mes --
  // o painel ficaria "indisponivel" em novembro com a conta certa por baixo.
  assert.match(
    CODIGO_DA_ROTA,
    /month:\s*janela\.de\.slice\(0,\s*7\)/,
    "o campo `month` da resposta nao sai de janela.de"
  );
});

test("o portao le a preferencia pelo hook, e nao pelo localStorage na mao", () => {
  // `useModoPapel` e o unico lugar com o estado em memoria e o `mounted`. Ler o
  // storage direto aqui criaria a segunda fonte da verdade, e as duas
  // divergiriam no primeiro clique no papelzinho.
  assert.match(CODIGO_DA_PAGINA, /useModoPapel\s*\(\s*\)/);
  assert.ok(
    !/localStorage/.test(CODIGO_DA_PAGINA),
    "a pagina le o localStorage direto em vez de usar o useModoPapel"
  );
});

// ---------------------------------------------------------------------------
// A FIACAO DO DETALHE: as tres colunas novas, e NENHUMA consulta nova (HMO-300)
// ---------------------------------------------------------------------------
// Os casos funcionais acima provam `somarPerna`. O que eles nao alcancam e a
// rota -- e o criterio desta issue vive la: "nenhuma consulta nova foi
// acrescentada". Uma segunda leitura para montar a lista erraria nos quatro
// elos (`agendaSemCompraNoCartao`, `faturasPrevistasDaJanela`, `parteDoMembro`,
// `skipped`/`cancelled`) e pareceria certa -- so que agora EXPLICANDO o numero
// errado linha a linha, que e mais convincente que o numero errado sozinho.
//
// A prova e TEXTUAL pelo motivo de sempre (nenhuma suite daqui importa um
// `route.ts`: ele arrasta `next/server` e o cliente do Supabase), com os
// limites conhecidos -- a ancora e o CALL SITE, e o comentario e arrancado
// antes pelo `semComentario` cujo controle ja roda acima.

test("o `select` da rota traz as tres colunas que a lista precisa", () => {
  // Sem `description` a lista sai sem nome; sem `id` nenhuma linha e
  // `gravada`; sem `user_id` nenhuma e editavel. As tres estao na consulta que
  // JA existia -- o caso seguinte e que prova que ela continua sendo uma so.
  // ANCORADO NA TABELA, e nao no primeiro `.select(` do arquivo: a consulta
  // da categoria de salario tambem e um `.select("id")`, e sobre ela esta
  // assercao reprovaria por `description` faltando -- apontando para a linha
  // errada e mandando consertar a consulta errada.
  const select = CODIGO_DA_ROTA.match(
    /\.from\(\s*"scheduled_transactions_effective"\s*\)\s*\n?\s*\.select\(\s*\n?\s*"([^"]*)"/
  );
  assert.ok(
    select,
    'a leitura da agenda nao tem mais um `.from("scheduled_transactions_effective").select("...")` legivel'
  );

  const colunas = select[1].split(",").map((c) => c.trim());
  for (const coluna of ["id", "description", "user_id"]) {
    assert.ok(
      colunas.includes(coluna),
      `a coluna \`${coluna}\` saiu do select -- a lista do chevron perde ${coluna}`
    );
  }

  // E as que ja la estavam continuam: tirar uma delas mudaria a SOMA, nao a
  // lista. `notes` e o embed da conta sao de `agendaSemCompraNoCartao`.
  for (const coluna of ["due_date", "amount", "status", "direction", "category_id", "group_id", "notes"]) {
    assert.ok(colunas.includes(coluna), `a coluna \`${coluna}\` saiu do select`);
  }
  assert.match(select[1], /account:financial_accounts\(account_type\)/);
});

test("NENHUMA CONSULTA NOVA: a rota continua com as tres leituras de sempre", () => {
  // O criterio da issue, medido. As tres sao: a categoria de salario, a agenda
  // do mes e os membros ativos dos grupos envolvidos. Uma quarta aqui e, por
  // construcao, a segunda leitura da mesma coisa.
  const tabelas = [...CODIGO_DA_ROTA.matchAll(/\.from\(\s*"([^"]+)"\s*\)/g)].map(
    (m) => m[1]
  );
  assert.deepEqual(tabelas, [
    "transaction_categories",
    "scheduled_transactions_effective",
    "group_members",
  ]);
});

test("a rota passa o `user.id` adiante -- senao nenhuma linha ganha acao", () => {
  // O call site COM o argumento: `meuUserId: user.id`. Sem ele `posso_editar`
  // cai para `false` em toda linha e a 10/10 nasce sem botao nenhum, com a
  // lib intacta e a suite de aritmetica verde.
  assert.match(
    CODIGO_DA_ROTA,
    /meuUserId:\s*user\.id/,
    "a rota nao passa o `meuUserId` para `painelDePapel`"
  );
});

// ---------------------------------------------------------------------------
// A FIACAO DA TELA: o chevron sai do `detalhe`, e a tela nao refaz a conta
// ---------------------------------------------------------------------------
// O COMPORTAMENTO do chevron (clicar abre, `aria-expanded` vira `true`, cartao
// sem linha nao tem seta) e medido em navegador, por `npm run test:papel-na-tela`
// -- `react-dom/server` nao ve handler. O que cabe aqui e o que aquela sonda
// NAO alcanca: que a tela nao refaca a conta por conta propria.
//
// A distincao importa porque os dois defeitos sao diferentes. Um chevron que
// nao abre e visivel no primeiro clique; uma lista que a TELA filtrou ou
// dividiu abre certinho e mostra outros numeros -- e e esse que transforma o
// numero conferivel no numero desmentido.
const PAINEL = fileURLToPath(
  new URL("../components/papel-de-pao/PainelDePapel.tsx", import.meta.url)
);
const FONTE_DO_PAINEL = readFileSync(PAINEL, "utf8");
const CODIGO_DO_PAINEL = semComentario(FONTE_DO_PAINEL);

test("o strip de comentario funciona no painel -- senao os casos dele sao vacuos", () => {
  assert.ok(
    /A SOMA DAS LINHAS ABERTAS E/.test(FONTE_DO_PAINEL),
    "a ancora do controle saiu do PainelDePapel.tsx: reescreva este caso"
  );
  assert.ok(
    !/A SOMA DAS LINHAS ABERTAS E/.test(CODIGO_DO_PAINEL),
    "o strip de comentario nao removeu um comentario conhecido do painel"
  );
});

test("a tela LE o `detalhe` que chegou, e nao monta lista nenhuma", () => {
  // A lista vem do campo da resposta...
  assert.match(
    CODIGO_DO_PAINEL,
    /numero\?\.detalhe\s*\?\?\s*\[\]/,
    "a tela nao le o `detalhe` da resposta"
  );

  // ...e NAO de uma segunda peneira escrita aqui. `parteDoMembro`,
  // `direcaoDaAgenda` ou um `.filter(` sobre as linhas nesta tela seriam a
  // segunda definicao do numero -- e seria ela a aparecer debaixo dele.
  for (const proibido of ["parteDoMembro", "direcaoDaAgenda", "STATUS_FORA_DO_PREVISTO"]) {
    assert.ok(
      !CODIGO_DO_PAINEL.includes(proibido),
      `a tela chama \`${proibido}\`: ela voltou a calcular o que a rota ja calculou`
    );
  }
  assert.ok(
    !/\.reduce\(/.test(CODIGO_DO_PAINEL),
    "a tela soma alguma coisa -- o total e o do cartao, nao o da lista"
  );
});

test("o chevron e um CONTROLE: `aria-expanded` e o estado do proprio botao", () => {
  // Nao um `<div onClick>` com uma seta desenhada. A seta e o unico jeito de
  // chegar na lista, e sem `aria-expanded` quem usa leitor de tela nao sabe
  // que ela existe.
  assert.match(
    CODIGO_DO_PAINEL,
    /aria-expanded=\{aberto\}/,
    "o botao do chevron nao declara `aria-expanded`"
  );
  assert.match(
    CODIGO_DO_PAINEL,
    /useState\(false\)/,
    "o chevron nao nasce FECHADO"
  );
});

test("so os DOIS cartoes de cima tem chevron -- o terceiro nao", () => {
  // Padrao aprovado na revisao 3 do plano (item 4 de 9.5): a "lista" do
  // terceiro cartao seria a uniao das outras duas -- um terceiro lugar para a
  // mesma soma divergir. Ele ja mostra as duas parcelas dele.
  const cartaoDeSobra = CODIGO_DO_PAINEL.slice(
    CODIGO_DO_PAINEL.indexOf("function CartaoDeSobra"),
    CODIGO_DO_PAINEL.indexOf("function NumeroGrande")
  );
  assert.ok(cartaoDeSobra.length > 0, "o recorte do CartaoDeSobra nao casou");
  assert.ok(
    !/aria-expanded/.test(cartaoDeSobra),
    "o terceiro cartao ganhou chevron"
  );
  // O par positivo: o recorte acima nao e vazio por acidente -- ele contem o
  // que o terceiro cartao de fato tem.
  assert.match(cartaoDeSobra, /data-parcelas/);
});

test("a fatura da lista aponta para o cartao NAQUELE MES", () => {
  // `caminhoDoCartaoNoMes(accountId, mes)`, e nao `caminhoDoCartao(accountId)`:
  // sem o mes o link abre o mes corrente do cartao certo -- o destino
  // plausivel e errado que ninguem reporta. A ancora e o CALL SITE com os dois
  // argumentos, porque `caminhoDoCartaoNoMes(id, null)` compila igual.
  assert.match(
    CODIGO_DO_PAINEL,
    /caminhoDoCartaoNoMes\(linha\.fatura\.accountId,\s*linha\.fatura\.mes\)/,
    "o painel nao monta o link da fatura por caminhoDoCartaoNoMes(accountId, mes)"
  );
});
