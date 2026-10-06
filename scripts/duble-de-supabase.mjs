// =====================================================
// PULODOGATO - duble do client do Supabase para sonda de ROUTE HANDLER
// =====================================================
// Criado na HMO-272 (HMO-245, fase 6) para
// scripts/test-semeadura-pela-renda.mjs.
//
// POR QUE UM DUBLE, E NAO UMA ASSERCAO SOBRE O TEXTO DA ROTA
// ----------------------------------------------------------
// O que esta fase promete e um RECORTE DE RESPOSTA: "o R$ da renda so para o
// proprio dono". Um teste que leia o fonte da rota e procure a palavra
// `viewerUserId` passa verde com o salario no JSON -- e passa verde tambem no dia
// em que alguem acrescentar um campo novo que leve o valor de volta. A unica
// medida que corresponde a promessa e CHAMAR o handler e olhar o corpo que ele
// devolve. Para isso ele precisa de um client, e o client de verdade exige
// `next/headers` e rede.
//
// O DUBLE FILTRA DE VERDADE -- E ISSO E O PONTO
// ---------------------------------------------
// Ele nao devolve uma resposta pronta por tabela: ele guarda as linhas e APLICA
// `eq` / `in` / `gte` / `lte` sobre elas. A diferenca importa:
//
//   * um duble que ignorasse os filtros devolveria os membros ativos mesmo se a
//     rota esquecesse `.eq("status", "active")`, e o membro que saiu do grupo
//     continuaria ganhando percentual sem nenhum teste vermelho;
//   * um duble que ignorasse o `.in("user_id", ...)` esconderia uma leitura
//     privilegiada ampla demais -- justamente o risco de usar a service role.
//
// Pelo mesmo motivo o `select` e PROJETADO: a rota recebe so as colunas que
// pediu. Pedir uma coluna que a tabela nao tem aparece como `undefined` no lugar
// do valor, e nao como um dado que apareceu de graca.
//
// O QUE ELE NAO FAZ
// -----------------
// Nao ha RLS aqui, e e deliberado: as policies sao provadas em
// database/tests/*.sql, contra um Postgres de verdade. O que esta sonda mede e o
// recorte que a ROTA faz em cima do que leu -- a camada que fica depois da RLS, e
// que a RLS nao cobre quando a leitura usa a service role.
// =====================================================

/**
 * As colunas de um `select("a, b, c")`. `*` (ou vazio) = a linha inteira.
 *
 * EMBED CONTA COMO UMA COLUNA SO (HMO-273)
 * ----------------------------------------
 * `split-suggestions` pede embed de perfil e de partes:
 *
 *     select("id, user_id, percentage, user:profiles!fk ( id, full_name )")
 *
 * Um `split(",")` cru picaria isso em `user:profiles!fk ( id` e `full_name )` --
 * nomes de coluna que linha nenhuma tem. A projecao devolveria `undefined` em
 * TUDO, a rota cairia no caminho de "membro sem dado" e a sonda mediria um
 * fixture vazio passando verde por vacuidade. Por isso a virgula e contada no
 * NIVEL ZERO de parenteses, e o embed vira a coluna com o nome do ALIAS (`user`
 * em `user:profiles!fk(...)`, `profiles` quando nao ha alias) -- que e a chave
 * em que o PostgREST entrega o objeto aninhado, e a chave em que a sonda monta a
 * linha do fixture.
 *
 * As colunas DE DENTRO do embed nao sao projetadas: o fixture ja entrega o
 * objeto aninhado pronto. Projetar dentro exigiria reimplementar o join, e a
 * sonda nao mede join -- mede o recorte que a rota faz em cima do que leu.
 */
function colunasDe(selecao) {
  if (!selecao || selecao.includes("*")) return null;

  const topo = [];
  let atual = "";
  let profundidade = 0;

  for (const ch of selecao) {
    if (ch === "(") profundidade += 1;
    else if (ch === ")") profundidade -= 1;

    if (ch === "," && profundidade === 0) {
      topo.push(atual);
      atual = "";
      continue;
    }
    atual += ch;
  }
  topo.push(atual);

  return topo
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const abre = c.indexOf("(");
      if (abre === -1) return c;
      // `alias:tabela!fk ( ... )` -> `alias`; `tabela ( ... )` -> `tabela`.
      const cabeca = c.slice(0, abre).trim();
      const alias = cabeca.includes(":")
        ? cabeca.slice(0, cabeca.indexOf(":"))
        : cabeca.split("!")[0];
      return alias.trim();
    })
    .filter(Boolean);
}

function projetar(linha, colunas) {
  if (!colunas) return { ...linha };
  const saida = {};
  for (const c of colunas) saida[c] = linha[c];
  return saida;
}

/**
 * Um builder de consulta encadeavel sobre um array de linhas.
 *
 * `await` nele resolve para `{ data, error }`, como no client de verdade --
 * `then` e o que faz isso funcionar sem Promise de mentira.
 */
function consulta(linhas, tabela, registro) {
  let filtradas = [...linhas];
  let colunas = null;
  const filtros = [];

  const api = {
    select(selecao) {
      colunas = colunasDe(selecao);
      return api;
    },
    eq(coluna, valor) {
      filtros.push(["eq", coluna, valor]);
      filtradas = filtradas.filter((l) => l[coluna] === valor);
      return api;
    },
    neq(coluna, valor) {
      filtros.push(["neq", coluna, valor]);
      filtradas = filtradas.filter((l) => l[coluna] !== valor);
      return api;
    },
    in(coluna, valores) {
      filtros.push(["in", coluna, [...valores]]);
      filtradas = filtradas.filter((l) => valores.includes(l[coluna]));
      return api;
    },
    gte(coluna, valor) {
      filtros.push(["gte", coluna, valor]);
      filtradas = filtradas.filter((l) => String(l[coluna]) >= String(valor));
      return api;
    },
    lte(coluna, valor) {
      filtros.push(["lte", coluna, valor]);
      filtradas = filtradas.filter((l) => String(l[coluna]) <= String(valor));
      return api;
    },
    order(coluna, opcoes = {}) {
      const crescente = opcoes.ascending !== false;
      // `sort` estavel no V8: ordenar por `joined_at` e depois por `user_id`
      // reproduz o desempate em cascata do PostgREST, que e o que a rota pede
      // com dois `.order()` seguidos.
      filtradas = [...filtradas].sort((a, b) => {
        const x = a[coluna];
        const y = b[coluna];
        if (x === y) return 0;
        return (x > y ? 1 : -1) * (crescente ? 1 : -1);
      });
      return api;
    },
    maybeSingle() {
      registro(tabela, filtros, "maybeSingle");
      const linha = filtradas[0];
      return Promise.resolve({
        data: linha ? projetar(linha, colunas) : null,
        error: null,
      });
    },
    single() {
      registro(tabela, filtros, "single");
      const linha = filtradas[0];
      return Promise.resolve({
        data: linha ? projetar(linha, colunas) : null,
        // O client de verdade devolve erro quando `single()` nao acha linha. A
        // rota so olha `data`, entao o duble devolve `null` nos dois -- e o 403
        // sai pelo mesmo caminho.
        error: linha ? null : { code: "PGRST116", message: "no rows" },
      });
    },
    // `.returns<T>()` do client de verdade e SO tipo: ele devolve o proprio
    // builder e nao toca em nada em runtime. Aqui ele e um no-op que devolve
    // `api`, e precisa existir -- sem ele a cadeia da rota termina em
    // `undefined` e a suite falha com "Cannot read properties of undefined",
    // uma mensagem que nao aponta para o metodo que falta.
    returns() {
      return api;
    },
    then(resolve, reject) {
      registro(tabela, filtros, "list");
      return Promise.resolve({
        data: filtradas.map((l) => projetar(l, colunas)),
        error: null,
      }).then(resolve, reject);
    },
  };

  return api;
}

/**
 * Um client de leitura.
 *
 * `tabelas` e `{ nome_da_tabela: [linhas] }`. Tabela ausente responde lista
 * vazia -- e nao estoura --, porque uma tabela que a rota le e o teste nao
 * preencheu e um caso real: a resposta tem de ficar pobre, nao quebrada.
 *
 * `user` vira o retorno de `auth.getUser()`. `null` responde sessao ausente, que
 * e o caminho do 401.
 */
export function criarDuble({ user = null, tabelas = {}, erros = {} } = {}) {
  /** Toda consulta que passou por aqui, para a sonda conferir o que foi lido. */
  const lidas = [];

  const registro = (tabela, filtros, terminador) => {
    lidas.push({ tabela, filtros, terminador });
  };

  return {
    lidas,
    client: {
      auth: {
        getUser: () =>
          Promise.resolve({
            data: { user },
            error: user ? null : { message: "no session" },
          }),
      },
      from(tabela) {
        if (erros[tabela]) {
          const falha = {
            select: () => falha,
            eq: () => falha,
            neq: () => falha,
            in: () => falha,
            gte: () => falha,
            lte: () => falha,
            order: () => falha,
            maybeSingle: () =>
              Promise.resolve({ data: null, error: erros[tabela] }),
            single: () =>
              Promise.resolve({ data: null, error: erros[tabela] }),
            then: (res, rej) =>
              Promise.resolve({ data: null, error: erros[tabela] }).then(
                res,
                rej
              ),
          };
          registro(tabela, [], "erro");
          return falha;
        }
        return consulta(tabelas[tabela] ?? [], tabela, registro);
      },
      rpc(nome, args) {
        registro(`rpc:${nome}`, [["args", "", args]], "rpc");
        return Promise.resolve({ data: tabelas[`rpc:${nome}`] ?? [], error: null });
      },
    },
  };
}
