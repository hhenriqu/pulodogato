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
function consulta(
  linhas,
  tabela,
  registro,
  escrever = () => {},
  rlsBarra = false
) {
  let filtradas = [...linhas];
  let colunas = null;
  const filtros = [];

  /**
   * As linhas que um UPDATE/DELETE com estes filtros alcanca (HMO-356).
   *
   * Repetir o casamento aqui, em vez de reaproveitar o `filtradas` do caminho de
   * leitura, e deliberado: `update` e `delete` montam a cadeia num objeto
   * PROPRIO (`depois`), e os `eq`/`in` deles empilham em `filtros` sem nunca
   * passar pelo `api.eq`. Sem isto a contagem de linhas afetadas seria a tabela
   * inteira -- um `.delete().eq("id", x)` "apagaria" tudo aos olhos da sonda.
   *
   * `rlsBarra` responde ZERO sem erro: e a resposta medida em producao em
   * 2026-09-30 (HTTP 200, corpo `[]`) quando a policy nao casa com a linha. A
   * RLS FILTRA em vez de recusar, entao nao ha erro para imitar -- e e por isso
   * que ela precisa de um botao em vez de sair de um filtro.
   */
  const alcancadas = () => {
    if (rlsBarra) return [];

    return linhas.filter((l) =>
      filtros.every(([op, coluna, valor]) => {
        if (op === "eq") return l[coluna] === valor;
        if (op === "in") return valor.includes(l[coluna]);
        if (op === "neq") return l[coluna] !== valor;
        if (op === "is") return valor === null ? l[coluna] == null : l[coluna] === valor;
        return true;
      })
    );
  };

  /**
   * A cadeia de um UPDATE/DELETE: `.eq()`/`.in()` filtram, `.select()` pede as
   * linhas afetadas de volta, `await` executa.
   *
   * SEM `.select()` O RETORNO E `{ data: null, error: null }`, E ISSO E LOAD-BEARING
   * ------------------------------------------------------------------------------
   * E o que o client de verdade faz, e e a razao de `lib/escrita-conferida.ts`
   * separar `sem-select` de `nenhuma-linha`: um duble que devolvesse a contagem
   * sem o `.select()` daria a uma rota que esqueceu o `.select()` a aparencia de
   * uma rota conferida, e o defeito da HMO-203 passaria verde aqui.
   */
  function escritaFiltrada(verbo, alvo, aplicar) {
    let pediuSelect = false;
    let selecao = null;

    const depois = {
      eq(coluna, valor) {
        filtros.push(["eq", coluna, valor]);
        return depois;
      },
      neq(coluna, valor) {
        filtros.push(["neq", coluna, valor]);
        return depois;
      },
      is(coluna, valor) {
        filtros.push(["is", coluna, valor]);
        return depois;
      },
      in(coluna, valores) {
        filtros.push(["in", coluna, [...valores]]);
        return depois;
      },
      select(cols) {
        pediuSelect = true;
        selecao = colunasDe(cols);
        return depois;
      },
      then(resolve, reject) {
        const atingidas = alcancadas();
        aplicar(atingidas);
        // A projecao sai DEPOIS de aplicar, e serve aos dois verbos: o
        // `.select()` do PostgREST num UPDATE devolve a linha JA com o patch, e
        // num DELETE devolve a linha que saiu -- `atingidas` guarda as
        // referencias, entao o splice nao as apaga daqui.
        escrever({ ...alvo, linhasAfetadas: atingidas.length });
        registro(tabela, filtros, verbo);

        return Promise.resolve({
          data: pediuSelect
            ? atingidas.map((l) => projetar(l, selecao))
            : null,
          error: null,
        }).then(resolve, reject);
      },
    };

    return depois;
  }

  const api = {
    select(selecao) {
      colunas = colunasDe(selecao);
      return api;
    },
    // -----------------------------------------------------------------------
    // AS ESCRITAS (HMO-218)
    // -----------------------------------------------------------------------
    // O duble nasceu lendo, porque a HMO-272 media um recorte de RESPOSTA. Uma
    // feature que promete "o campo X chega ao banco" nao se mede na resposta: a
    // rota devolve o mesmo `{ success: true }` com o campo e sem ele. O que
    // corresponde a promessa e olhar o PAYLOAD que a rota mandou gravar.
    //
    // `insert` EMULA O LOTE DO POSTGREST, E ISSO NAO E ZELO EXCESSIVO
    // --------------------------------------------------------------
    // No client de verdade as colunas do comando saem da PRIMEIRA linha do
    // array: uma chave presente na linha 1 e ausente na 2 grava `null` na 2, e
    // uma chave AUSENTE na linha 1 e descartada de todas as outras -- em
    // silencio, sem erro. A rota de parcelas depende disso (ver
    // `invoice_month_override`, que e `null` de proposito nas parcelas 2..M).
    // Um duble que guardasse o array cru deixaria passar verde exatamente o
    // defeito que aquele comentario descreve.
    insert(payload) {
      const propostas = Array.isArray(payload) ? payload : [payload];
      const colunasDoLote = Object.keys(propostas[0] ?? {});
      const gravadas = propostas.map((proposta, i) => {
        const linha = { id: `${tabela}-${i + 1}` };
        for (const coluna of colunasDoLote) linha[coluna] = proposta[coluna];
        return linha;
      });

      // As chaves que o lote DESCARTOU por nao estarem na primeira linha. A
      // sonda pode exigir que esta lista esteja vazia, que e a unica forma de
      // ver o descarte silencioso descrito acima.
      const descartadas = [
        ...new Set(
          propostas.flatMap((p) =>
            Object.keys(p).filter((c) => !colunasDoLote.includes(c))
          )
        ),
      ];

      // O REGISTRO E UMA COPIA, E NAO AS LINHAS VIVAS (HMO-356)
      // -------------------------------------------------------
      // `gravadas` vai para `linhas`, e desde que `update` passou a aplicar o
      // patch EM CIMA das linhas semeadas (para a rota reler o que escreveu),
      // guardar a referencia aqui deixava o UPDATE reescrever a historia: uma
      // sonda que afirmasse "a despesa combinada nasce SEM group_id" lia
      // `group_id: "grupo-1"` -- o valor que o UPDATE posterior gravou -- e
      // reprovava a rota certa. `escritas` e o que a rota MANDOU, no instante em
      // que mandou, e tem de ficar imune ao que vem depois.
      escrever({
        tabela,
        verbo: "insert",
        linhas: gravadas.map((l) => ({ ...l })),
        descartadas,
      });
      registro(tabela, filtros, "insert");

      // A LINHA GRAVADA PASSA A SER LEGIVEL (HMO-224)
      // ---------------------------------------------
      // `linhas` e o array que veio de `tabelas[tabela]`, por referencia, e
      // cada `from()` monta um `consulta` novo sobre ele. Empurrar aqui faz a
      // linha recem-inserida aparecer numa leitura POSTERIOR -- que e o que o
      // banco faz, e o que uma rota que RELE o que acabou de gravar depende.
      //
      // Sem isto, a releitura da rota de lancamento (`.select(...).eq("id",
      // ...).single()`) nao acha nada e a resposta sai com `transaction: null`
      // -- 201 e corpo vazio. Uma sonda escrita sobre a resposta mediria o
      // caminho de erro achando que media a feature.
      //
      // So vale para tabela SEMEADA (`tabelas.x = []` conta): sem a chave,
      // `tabelas[tabela] ?? []` fabrica um array novo a cada `from()` e nao ha
      // onde acumular. Isso e proposital -- quem nao semeou nao quer estado.
      linhas.push(...gravadas);

      /**
       * O cliente de verdade deixa `insert().select()` continuar a cadeia:
       * `.single()` e `.maybeSingle()` vem DEPOIS do select, e e assim que a
       * rota de lancamento pega o id da linha que criou. Devolver uma Promise
       * crua aqui quebrava essa rota com "select(...).single is not a
       * function" -- erro de duble que se le como erro de rota.
       *
       * O objeto e thenable, entao `await ...select("id")` (o que a rota de
       * parcelas faz, em lote) continua valendo sem mudanca.
       */
      const depoisDoSelect = (cols) => {
        const projetadas = gravadas.map((l) => projetar(l, cols));
        return {
          single() {
            return Promise.resolve({
              data: projetadas[0] ?? null,
              error: projetadas[0]
                ? null
                : { code: "PGRST116", message: "no rows" },
            });
          },
          maybeSingle() {
            return Promise.resolve({
              data: projetadas[0] ?? null,
              error: null,
            });
          },
          then(resolve, reject) {
            return Promise.resolve({ data: projetadas, error: null }).then(
              resolve,
              reject
            );
          },
        };
      };

      const depois = {
        select(selecao) {
          return depoisDoSelect(colunasDe(selecao));
        },
        then(resolve, reject) {
          return Promise.resolve({ data: gravadas, error: null }).then(
            resolve,
            reject
          );
        },
      };
      return depois;
    },
    /**
     * `update` guarda o PATCH e os filtros. Quem chama `.update({...}).in("id",
     * ids)` esta dizendo "estas linhas, este campo" -- e as duas metades
     * importam: um patch certo com filtro errado reescreve a tabela.
     */
    update(patch) {
      const alvo = { tabela, verbo: "update", patch, filtros };
      return escritaFiltrada("update", alvo, (atingidas) => {
        // O patch e aplicado DE VERDADE nas linhas semeadas: uma rota que
        // escreve e depois RELE (ou um segundo update no mesmo pedido) tem de
        // ver o valor novo, como veria no banco.
        for (const l of atingidas) Object.assign(l, patch);
      });
    },
    /**
     * `delete` faltava inteiro (HMO-356), e a falta nao aparecia como duble
     * incompleto: `api.delete is not a function` no meio de uma sonda de rota se
     * le como rota quebrada. Ele e necessario para medir CAMINHO DE COMPENSACAO
     * -- o `desfazer` da rota de despesa de grupo, que apaga o lancamento quando
     * a divisao nao pode ser gravada.
     */
    delete() {
      const alvo = { tabela, verbo: "delete", filtros };
      return escritaFiltrada("delete", alvo, (atingidas) => {
        for (const l of atingidas) {
          const i = linhas.indexOf(l);
          if (i !== -1) linhas.splice(i, 1);
        }
      });
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
    /**
     * `.is(coluna, null)` do PostgREST -- que e `IS NULL`, e nao `= null`
     * (HMO-207).
     *
     * Faltava, e a falta NAO aparecia como duble incompleto: `api.is is not a
     * function` no meio de uma sonda de rota se le como rota quebrada. Ele e
     * necessario para medir os dois caminhos que o criterio da 033 deixou em
     * pe -- a queda para a view antiga enquanto a migration nao foi colada, e
     * os ramos que continuam filtrando grupo de proposito.
     *
     * `l[coluna] ?? null` e deliberado em vez de `=== null`: fixture que OMITE
     * `group_id` esta dizendo "lancamento que nao e de grupo", e e assim que as
     * linhas pessoais sao escritas. Exigir a chave presente com valor `null`
     * faria a sonda medir um recorte vazio e passar verde por vacuidade.
     */
    is(coluna, valor) {
      filtros.push(["is", coluna, valor]);
      filtradas = filtradas.filter((l) =>
        valor === null ? (l[coluna] ?? null) === null : l[coluna] === valor
      );
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
    /**
     * `lt` -- o extremo ABERTO (HMO-207).
     *
     * Faltava, e o sintoma era o pior tipo: /api/reports/export?report=transactions
     * faz `.lt("transaction_date", somarMeses(janela.fim, 1))`, entao
     * `api.lt is not a function` estourava DENTRO do try/catch da rota e saia
     * como `{"error":"Erro interno"}` com status 500. Uma sonda que olhasse o
     * corpo leria "a rota esta quebrada" e iria depurar a rota -- que esta
     * certa. Nao e `lte`: o mes seguinte nao entra.
     */
    lt(coluna, valor) {
      filtros.push(["lt", coluna, valor]);
      filtradas = filtradas.filter((l) => String(l[coluna]) < String(valor));
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
    /**
     * `.limit(n)` (HMO-356). Faltava, e a rota de despesa de grupo o usa para
     * pegar a categoria padrao (`.limit(1).single()`). A ausencia estourava com
     * `api.limit is not a function`, que nao aponta para o metodo que falta.
     *
     * Ele CORTA de verdade em vez de ser no-op: um `.limit(1)` seguido de
     * `.then` tem de devolver uma linha, e um duble que ignorasse o corte
     * esconderia uma rota que le a colecao inteira achando que leu a primeira.
     */
    limit(n) {
      filtros.push(["limit", "", n]);
      filtradas = filtradas.slice(0, n);
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
 *
 * `rlsFiltra` (HMO-356) e a lista de tabelas cuja ESCRITA alcanca zero linhas
 * sem erro -- `{ financial_transactions: true }`. Nao e "o duble ganhou RLS": e
 * um botao para a sonda reproduzir a UNICA resposta que a policy da quando ela
 * nao casa com a linha, que e sucesso com zero linha. As policies continuam
 * sendo provadas em database/tests/*.sql; o que se mede aqui e o que a ROTA faz
 * com essa resposta.
 */
export function criarDuble({
  user = null,
  tabelas = {},
  erros = {},
  rlsFiltra = {},
} = {}) {
  /** Toda consulta que passou por aqui, para a sonda conferir o que foi lido. */
  const lidas = [];

  /**
   * Toda ESCRITA que passou por aqui (HMO-218), na ordem. Cada item e
   * `{ tabela, verbo, linhas|patch, ... }` -- ver `insert`/`update` em
   * `consulta`. E aqui que uma sonda confere que o campo chegou ao banco.
   */
  const escritas = [];

  const registro = (tabela, filtros, terminador) => {
    lidas.push({ tabela, filtros, terminador });
  };

  const escrever = (operacao) => {
    escritas.push(operacao);
  };

  return {
    lidas,
    escritas,
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
            // `update`/`delete` entraram na HMO-356: sem eles uma sonda que
            // pedisse `erros: { financial_transactions: ... }` estouraria com
            // "falha.update is not a function", que se le como rota quebrada.
            update: () => falha,
            delete: () => falha,
            insert: () => falha,
            eq: () => falha,
            neq: () => falha,
            is: () => falha,
            in: () => falha,
            gte: () => falha,
            lt: () => falha,
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
        return consulta(
          tabelas[tabela] ?? [],
          tabela,
          registro,
          escrever,
          Boolean(rlsFiltra[tabela])
        );
      },
      rpc(nome, args) {
        registro(`rpc:${nome}`, [["args", "", args]], "rpc");
        return Promise.resolve({ data: tabelas[`rpc:${nome}`] ?? [], error: null });
      },
    },
  };
}
