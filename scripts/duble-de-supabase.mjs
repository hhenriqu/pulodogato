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
 * Parte uma lista do PostgREST na VIRGULA DE NIVEL ZERO (HMO-373).
 *
 * Irmao do `colunasDe`, e pelo mesmo motivo: a virgula e separador, mas a
 * virgula DENTRO de `and(...)` e dentro de um operando `"citado"` e texto. Um
 * `split(",")` cru picaria `and(a.eq.1,b.eq.2)` no meio.
 */
function partirNoNivelZero(expressao) {
  const partes = [];
  let atual = "";
  let profundidade = 0;
  let citando = false;

  for (let i = 0; i < expressao.length; i++) {
    const c = expressao[i];

    if (citando) {
      // Dentro de aspas, `\` escapa o proximo caractere -- e o que
      // `citar()` de lib/busca-de-perfil.ts emite.
      if (c === "\\") {
        atual += c + (expressao[i + 1] ?? "");
        i++;
        continue;
      }
      if (c === '"') citando = false;
      atual += c;
      continue;
    }

    if (c === '"') {
      citando = true;
      atual += c;
      continue;
    }
    if (c === "(") profundidade++;
    if (c === ")") profundidade--;
    if (c === "," && profundidade === 0) {
      partes.push(atual);
      atual = "";
      continue;
    }
    atual += c;
  }

  if (atual) partes.push(atual);
  return partes;
}

/** Tira as aspas (e os escapes) de um operando citado do PostgREST. */
function descitar(valor) {
  if (valor.length >= 2 && valor.startsWith('"') && valor.endsWith('"')) {
    return valor.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return valor;
}

/**
 * Avalia UM ramo da arvore logica do PostgREST contra uma linha.
 *
 * Aceita `and(...)` / `or(...)` aninhados e as folhas `coluna.op.valor`.
 *
 * OPERADOR DESCONHECIDO ESTOURA, e isto e load-bearing
 * ----------------------------------------------------
 * A tentacao e devolver `true` no `default` -- "nao sei avaliar, nao filtro".
 * Isso transformaria todo `.or()` com um operador novo num NO-OP, e uma sonda
 * que medisse recorte de busca passaria verde com a rota devolvendo a base
 * inteira. O duble inteiro existe porque ele FILTRA DE VERDADE (ver o cabecalho
 * do arquivo), entao a resposta honesta para "nao sei" e parar.
 */
function avaliarRamo(ramo, linha) {
  const limpo = ramo.trim();

  const grupo = /^(and|or)\((.*)\)$/s.exec(limpo);
  if (grupo) {
    const ramos = partirNoNivelZero(grupo[2]);
    return grupo[1] === "and"
      ? ramos.every((r) => avaliarRamo(r, linha))
      : ramos.some((r) => avaliarRamo(r, linha));
  }

  // `coluna.op.resto` -- o resto pode conter pontos (um e-mail, por exemplo),
  // entao o split e nos DOIS primeiros pontos, nao em todos.
  const primeiro = limpo.indexOf(".");
  const segundo = limpo.indexOf(".", primeiro + 1);
  if (primeiro === -1 || segundo === -1) {
    throw new Error(
      `duble-de-supabase: nao sei ler o ramo \`${limpo}\` de um .or(). ` +
        "A forma esperada e `coluna.operador.valor` ou `and(...)`/`or(...)`."
    );
  }

  const coluna = limpo.slice(0, primeiro);
  const op = limpo.slice(primeiro + 1, segundo);
  const bruto = limpo.slice(segundo + 1);
  const valor = descitar(bruto);
  const celula = linha[coluna] ?? null;

  switch (op) {
    case "eq":
      // O PostgREST manda tudo como texto; `true`/`false` chegam como palavra.
      if (valor === "true") return celula === true;
      if (valor === "false") return celula === false;
      return String(celula) === valor;
    case "neq":
      return String(celula) !== valor;
    case "is":
      if (valor === "null") return celula === null;
      if (valor === "true") return celula === true;
      if (valor === "false") return celula === false;
      throw new Error(`duble-de-supabase: \`is.${valor}\` nao e um valor de IS.`);
    case "like":
    case "ilike": {
      // `%` e o curinga do LIKE; o resto do termo e literal. O `i` de `ilike`
      // e o que faz "AGENTE" achar "Agente Paperclip", que e o caso real.
      const padrao = valor
        .split("%")
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*");
      return new RegExp(`^${padrao}$`, op === "ilike" ? "is" : "s").test(
        String(celula ?? "")
      );
    }
    default:
      throw new Error(
        `duble-de-supabase: operador \`${op}\` (em \`${limpo}\`) nao esta ` +
          "implementado. Implemente-o em vez de deixar o .or() virar no-op."
      );
  }
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
  rlsBarra = false,
  sequencias = new Map(),
  /**
   * O erro que SO o `insert` desta tabela devolve, e nada mais (HMO-390).
   *
   * `erros: { tabela: ... }` existe desde antes e serve para "a tabela inteira
   * esta inacessivel": ele faz select, update e delete falharem junto. Uma
   * violacao de UNIQUE nao e isso -- no Postgres o INSERT falha com `23505` e a
   * tabela continua perfeitamente LEGIVEL, que e justamente o que a rota faz em
   * seguida (ela rele a linha que ja existe, por id).
   *
   * Sem esta opcao a unica forma de montar o caso seria `erros`, e ali a
   * releitura da rota falharia tambem: a rota cairia no 409 por nao ter achado
   * a linha, e a sonda do caminho 200 mediria o ramo errado -- verde pelo
   * motivo oposto ao que ela afirma.
   */
  erroDeInsert = null
) {
  let filtradas = [...linhas];
  let colunas = null;
  const filtros = [];

  /** `select(..., { count })` foi pedido? Ver `select` (HMO-390). */
  let contagem = false;
  /** `{ head: true }` junto: devolve o numero e NENHUMA linha. */
  let soCabecalho = false;

  /**
   * A faixa pedida por `.range(de, ate)`, ou `null` (HMO-417). Ver `range`.
   *
   * GUARDADA EM VEZ DE APLICADA NA HORA, E ESSA E A PARTE QUE IMPORTA
   * -----------------------------------------------------------------
   * Todo filtro desta cadeia recorta `filtradas` no ato, e para `eq`/`gte` isso
   * da no mesmo: conjuncao nao depende de ordem. Paginacao depende. No PostgREST
   * o `Range` e um cabecalho da MESMA requisicao que leva o `WHERE`, e o
   * LIMIT/OFFSET e aplicado depois dele -- a ordem das chamadas no builder nao
   * significa nada.
   *
   * E /api/reports/cash-flow chama nessa ordem exata:
   *
   *   .gte(...).lte(...).order("id").range(inicio, inicio + 999)
   *   ...e SO DEPOIS .eq("user_id", ...).is("group_id", null)
   *
   * (o `.eq` sai do ternario `groupId ? ... : ...` no fim de `pagina`). Um
   * `range` que cortasse na hora pegaria as 1000 primeiras linhas da tabela
   * INTEIRA e so entao tiraria as de outros usuarios -- a pagina viria com 3 em
   * vez de 1000, o laco da rota pararia na primeira volta, e o total do periodo
   * sairia MENOR sem erro nenhum. Exatamente o defeito que a paginacao da rota
   * existe para evitar, fabricado pelo duble.
   */
  let faixa = null;

  /** `filtradas` recortada pela faixa, se houver. `ate` INCLUSIVO. */
  const comFaixa = (lista) =>
    faixa ? lista.slice(faixa[0], faixa[1] + 1) : lista;

  /**
   * O proximo id desta tabela NA SESSAO -- e a sequencia e por sessao, nao por
   * chamada de `insert` (HMO-382).
   *
   * Antes o id saia do indice DENTRO do lote (`${tabela}-${i + 1}`), e duas
   * chamadas de `insert` de uma linha so na mesma tabela devolviam o MESMO id.
   * Isso fabrica equivalencia falsa em toda rota que grava duas linhas e
   * precisa escolher UMA: a baixa de uma transferencia grava a perna de saida e
   * a de entrada e amarra a parcela do MyBank a de ENTRADA (ver
   * `patchDaBaixaDaParcela`). Com os dois ids iguais, trocar uma perna pela
   * outra passava verde -- a assercao comparava `"financial_transactions-1"`
   * com `"financial_transactions-1"` e o mutante do elo errado sobrevivia sem
   * que nada no teste parecesse fraco.
   *
   * A sequencia continua de 1 em cada tabela, entao a PRIMEIRA linha inserida
   * continua sendo `<tabela>-1`, como antes.
   */
  const proximoNaSequencia = () => {
    const n = (sequencias.get(tabela) ?? 0) + 1;
    sequencias.set(tabela, n);
    return n;
  };

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
        if (op === "or")
          return partirNoNivelZero(valor).some((r) => avaliarRamo(r, l));
        if (op === "not") return !avaliarRamo(`${coluna}.${valor[0]}.${valor[1]}`, l);
        // COMPARACAO POR STRING, igual aos `gte`/`lt`/`lte` da cadeia de
        // LEITURA: as colunas comparadas assim sao `date` em ISO
        // (`YYYY-MM-DD`), e nessa forma a ordem lexicografica e a cronologica.
        //
        // Faltavam aqui (HMO-403), e a falta nao se lia como duble incompleto:
        // `encerrarRegra` termina em `.update(...).eq(...).gte("due_date",
        // today())`, e sem o `gte` no `depois` a cadeia estourava
        // `...gte is not a function`, o `catch` da rota devolvia
        // `500 {"error":"Erro interno"}`, e uma sonda escrita sobre a resposta
        // mediria o caminho de erro achando que mede a feature.
        if (op === "gte") return String(l[coluna]) >= String(valor);
        if (op === "lt") return String(l[coluna]) < String(valor);
        if (op === "lte") return String(l[coluna]) <= String(valor);
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
      or(expressao) {
        filtros.push(["or", "", expressao]);
        return depois;
      },
      not(coluna, operador, valor) {
        filtros.push(["not", coluna, [operador, valor]]);
        return depois;
      },
      in(coluna, valores) {
        filtros.push(["in", coluna, [...valores]]);
        return depois;
      },
      /**
       * As comparacoes de ORDEM na cadeia de escrita (HMO-403).
       *
       * `encerrarRegra` em lib/services/scheduled.ts termina em
       * `.update({status:"cancelled"}).eq(...).gte("due_date", today())` -- a
       * barreira que protege a conta VENCIDA e nao paga, que continua sendo uma
       * divida real. Sem `gte` aqui, a cadeia estourava
       * `...gte is not a function`, o `catch` da rota devolvia `500 {"error":
       * "Erro interno"}`, e uma sonda escrita sobre a resposta mediria o caminho
       * de erro achando que mede a feature. `lt`/`lte` entram junto porque a
       * cadeia de leitura tem os tres e a assimetria seria o proximo buraco.
       */
      gte(coluna, valor) {
        filtros.push(["gte", coluna, valor]);
        return depois;
      },
      lt(coluna, valor) {
        filtros.push(["lt", coluna, valor]);
        return depois;
      },
      lte(coluna, valor) {
        filtros.push(["lte", coluna, valor]);
        return depois;
      },
      select(cols) {
        pediuSelect = true;
        selecao = colunasDe(cols);
        return depois;
      },
      /**
       * O ESCRITO, e nao o lido: `.update({...}).eq(...).select().single()` e a
       * forma que a baixa de conta prevista usa nos tres caminhos dela.
       *
       * Faltava (HMO-382), e a falta NAO se lia como duble incompleto:
       * `...select(...).single is not a function` cai no `catch` da rota e sai
       * como `500 {"error":"Erro interno"}` -- uma sonda escrita sobre a
       * resposta mede o caminho de erro achando que mede a feature.
       *
       * Zero linha alcancada devolve `PGRST116` em `single`, como o cliente de
       * verdade: e assim que a rota distingue "a RLS filtrou" de "deu certo", e
       * e esse caminho que o botao `rlsFiltra` exercita. `maybeSingle` devolve
       * `null` sem erro, que e a outra metade do contrato.
       */
      single() {
        return concluir().then(({ data, error }) => ({
          data: data?.[0] ?? null,
          error:
            error ??
            (data && data.length > 0
              ? null
              : { code: "PGRST116", message: "no rows" }),
        }));
      },
      maybeSingle() {
        return concluir().then(({ data, error }) => ({
          data: data?.[0] ?? null,
          error: error ?? null,
        }));
      },
      then(resolve, reject) {
        return concluir().then(resolve, reject);
      },
    };

    /**
     * Executa a escrita e projeta o resultado. Um lugar so, porque os tres
     * terminadores (`then`, `single`, `maybeSingle`) tem de aplicar o patch
     * exatamente uma vez e registrar exatamente uma escrita.
     */
    function concluir() {
      const atingidas = alcancadas();
      aplicar(atingidas);
      // A projecao sai DEPOIS de aplicar, e serve aos dois verbos: o
      // `.select()` do PostgREST num UPDATE devolve a linha JA com o patch, e
      // num DELETE devolve a linha que saiu -- `atingidas` guarda as
      // referencias, entao o splice nao as apaga daqui.
      escrever({ ...alvo, linhasAfetadas: atingidas.length });
      registro(tabela, filtros, verbo);

      return Promise.resolve({
        data: pediuSelect ? atingidas.map((l) => projetar(l, selecao)) : null,
        error: null,
      });
    }

    return depois;
  }

  const api = {
    select(selecao, opcoes) {
      colunas = colunasDe(selecao);

      // `{ count: "exact", head: true }` (HMO-390)
      // ----------------------------------------
      // O duble ignorava o segundo argumento, e isso fazia TODA contagem
      // responder `undefined`. Numa rota que escreve `count ?? 0` -- o padrao
      // deste repositorio -- `undefined` vira **zero**: a sonda le 0, a rota
      // esta certa, e a assercao reprova o codigo bom. Pior no outro sentido,
      // que e o que importa aqui: uma assercao `count === 0` passaria VACUA
      // sobre qualquer numero de linhas.
      //
      // `head: true` nao devolve linha nenhuma (`data: null`), igual ao
      // PostgREST: quem pede `head` quer o numero, e uma lista devolvida aqui
      // deixaria passar verde uma rota que lesse `data.length`.
      if (opcoes && opcoes.count) {
        contagem = true;
        soCabecalho = Boolean(opcoes.head);
      }
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
      // O INSERT QUE FALHA SOZINHO (HMO-390) -- ver `erroDeInsert` na
      // assinatura. Nada e escrito, nada entra em `linhas`, e a cadeia continua
      // respondendo: a rota faz `.select("id").single()` depois do insert, e um
      // objeto sem `select` aqui estouraria com "select is not a function", que
      // se le como rota quebrada.
      //
      // O registro sai como verbo `insert-recusado`, e nao `insert`: uma sonda
      // que conte os inserts da tabela nao pode contar este, senao "o insert
      // saiu" deixa de distinguir gravado de recusado.
      if (erroDeInsert) {
        registro(tabela, filtros, "insert-recusado");
        const recusa = {
          select: () => recusa,
          single: () => Promise.resolve({ data: null, error: erroDeInsert }),
          maybeSingle: () =>
            Promise.resolve({ data: null, error: erroDeInsert }),
          then: (res, rej) =>
            Promise.resolve({ data: null, error: erroDeInsert }).then(res, rej),
        };
        return recusa;
      }

      const propostas = Array.isArray(payload) ? payload : [payload];
      const colunasDoLote = Object.keys(propostas[0] ?? {});
      const gravadas = propostas.map((proposta) => {
        const linha = { id: `${tabela}-${proximoNaSequencia()}` };
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
    /**
     * `.or("a.eq.1,b.ilike.%x%")` -- a arvore de disjuncao do PostgREST
     * (HMO-373).
     *
     * Faltava inteiro, e a falta era a pior possivel para uma sonda de BUSCA:
     * `/api/users/search` monta o casamento de nome/apelido num `.or()`, entao
     * `api.or is not a function` estourava dentro do try/catch da rota e saia
     * como `{"error":"Erro interno do servidor"}` com status 500. Uma sonda que
     * olhasse so o status leria "rota quebrada". E a tentacao de resolver com
     * `or: () => api` e pior: o filtro viraria no-op, a rota pareceria devolver
     * todo mundo que o fixture tem, e o teste do recorte da busca passaria
     * verde medindo nada.
     */
    or(expressao) {
      filtros.push(["or", "", expressao]);
      const ramos = partirNoNivelZero(expressao);
      filtradas = filtradas.filter((l) => ramos.some((r) => avaliarRamo(r, l)));
      return api;
    },
    /**
     * `.not(coluna, op, valor)` -- a negacao de UM operador (HMO-373).
     *
     * O caso que o trouxe e `.not("allow_connections", "is", false)`, que e
     * `IS NOT FALSE`: o portao de conexao que aceita `true` E `NULL` e recusa
     * so o `false` explicito. Ver `aplicarPortaoDeConexao` em
     * `lib/busca-de-perfil.ts`.
     */
    not(coluna, operador, valor) {
      filtros.push(["not", coluna, [operador, valor]]);
      const ramo = `${coluna}.${operador}.${valor}`;
      filtradas = filtradas.filter((l) => !avaliarRamo(ramo, l));
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
    /**
     * `.range(de, ate)` -- a PAGINACAO do PostgREST (HMO-417).
     *
     * Faltava, e a falta tirava do alcance de qualquer sonda o ramo de INTERVALO
     * de /api/reports/cash-flow e /api/reports/categories -- o ramo que o painel
     * principal usa, porque `cartao=fatura` sempre cai nele. As duas rotas
     * paginam as DUAS consultas que elas somam no JavaScript
     * (`financial_transactions` e `group_share_entries`), entao
     * `api.range is not a function` estourava dentro do `try` da rota, o `catch`
     * devolvia `500 {"error":"Erro interno"}`, e uma sonda escrita sobre a
     * resposta mediria O CAMINHO DE ERRO achando que mede a feature -- o modo de
     * falha que o controle positivo de scripts/test-semeadura-pela-renda.mjs
     * existe para denunciar.
     *
     * `ate` E INCLUSIVO, NOS DOIS EXTREMOS, COMO NO POSTGREST
     * ------------------------------------------------------
     * `range(0, 999)` traz 1000 linhas, e nao 999. Um `slice(de, ate)` aqui
     * pareceria so um off-by-one de duble, mas o efeito e dinheiro: a rota para
     * de paginar quando a pagina volta INCOMPLETA
     * (`if (lote.length < TAMANHO_DA_PAGINA) break`). Com uma linha a menos por
     * pagina, a primeira volta ja parece a ultima, a segunda pagina nunca e
     * pedida, e o total do periodo sai MENOR -- sem erro, com cara de numero
     * certo. E a mesma classe de defeito que a paginacao da rota foi escrita
     * para evitar.
     *
     * O corte e DEFERIDO para o terminador (ver `faixa`/`comFaixa`): a rota
     * encadeia `.range()` ANTES do `.eq("user_id")`, e cortar na hora recortaria
     * a tabela inteira em vez do recorte do usuario.
     */
    range(de, ate) {
      filtros.push(["range", "", [de, ate]]);
      faixa = [de, ate];
      return api;
    },
    maybeSingle() {
      registro(tabela, filtros, "maybeSingle");
      const linha = comFaixa(filtradas)[0];
      return Promise.resolve({
        data: linha ? projetar(linha, colunas) : null,
        error: null,
      });
    },
    single() {
      registro(tabela, filtros, "single");
      const linha = comFaixa(filtradas)[0];
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
      registro(tabela, filtros, contagem ? "count" : "list");
      return Promise.resolve({
        // `head: true` -> `data: null`, como o PostgREST. Ver `select`.
        data: soCabecalho
          ? null
          : comFaixa(filtradas).map((l) => projetar(l, colunas)),
        error: null,
        // `count` SO quando pedido: um `count` sempre presente faria uma rota
        // que o le sem pedir passar verde aqui e falhar em producao.
        //
        // E ele e o total que casa com os filtros, SEM a faixa (HMO-417) -- o
        // `count=exact` do PostgREST conta a selecao inteira, nao a pagina. E o
        // que torna `count` util para paginar: uma contagem que voltasse o
        // tamanho da pagina diria a quem le que acabou na primeira volta.
        ...(contagem ? { count: filtradas.length } : {}),
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
  /**
   * `{ mybank_loans: { code: "23505", message: "..." } }` -- o erro que SO o
   * `insert` daquela tabela devolve (HMO-390). Ver `erroDeInsert` em `consulta`
   * para o porque de nao dar para usar `erros` aqui.
   */
  errosDeInsert = {},
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

  /**
   * A sequencia de ids de cada tabela, viva pela sessao inteira. Ver
   * `proximoNaSequencia` em `consulta`: sem ela duas linhas inseridas na mesma
   * tabela nascem com o mesmo id, e toda rota que grava duas e escolhe uma fica
   * sem ter como ser medida.
   */
  const sequencias = new Map();

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
            or: () => falha,
            not: () => falha,
            in: () => falha,
            gte: () => falha,
            lt: () => falha,
            lte: () => falha,
            order: () => falha,
            // `limit` entrou junto com o `or`/`not` (HMO-373): a busca de
            // pessoas termina em `.limit(20)`, e sem ele um fixture com
            // `erros: { profiles: ... }` estouraria com "falha.limit is not a
            // function" em vez de exercitar o caminho de erro da rota.
            limit: () => falha,
            // `range` entrou na HMO-417, e aqui ele e o que torna sondavel a
            // QUEDA da parte de grupo: o ramo de intervalo de
            // /api/reports/cash-flow pagina `group_share_entries` e trata
            // `42P01`/`PGRST205` como "a 033 nao foi colada ainda" (ver
            // viewDaParteAusente). Um fixture com
            // `erros: { group_share_entries: ... }` estouraria com
            // "falha.range is not a function" antes de chegar nesse `if`, e a
            // sonda mediria o `catch` da rota em vez da queda.
            range: () => falha,
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
          Boolean(rlsFiltra[tabela]),
          // A sequencia de ids e da SESSAO: cada `from()` monta um `consulta`
          // novo, e um contador local a ele voltaria a 1 em cada chamada --
          // exatamente o empate que a sequencia existe para desfazer.
          sequencias,
          errosDeInsert[tabela] ?? null
        );
      },
      rpc(nome, args) {
        registro(`rpc:${nome}`, [["args", "", args]], "rpc");
        return Promise.resolve({ data: tabelas[`rpc:${nome}`] ?? [], error: null });
      },
    },
  };
}
