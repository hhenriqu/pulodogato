// =====================================================
// TESTES DA FILA DE LANCAMENTOS OFFLINE
// =====================================================
//   npm run test:offline-queue
//
// Os dois invariantes que estes testes existem para segurar:
//   1. um lancamento enfileirado nunca cobra duas vezes;
//   2. um lancamento enfileirado nunca some em silencio.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
  avaliarLancamento,
  interpretarRespostaDeEnvio,
  classificarErroDeEnvio,
  aplicarResultado,
  ordenarParaEnvio,
  resumirFila,
  novoId,
  MAX_TENTATIVAS,
} from "../.tmp-offline-queue/offline-queue.js";
import {
  guardarCatalogo,
  lerCatalogo,
  esquecerCatalogo,
  decidirAbertura,
} from "../.tmp-offline-queue/offline-cache.js";

const ID = "11111111-1111-4111-8111-111111111111";

/** Um almoco de R$ 32: despesa simples, sem divisao, sem parcela. */
const base = {
  userId: "u-1",
  serviceId: "s-1",
  categoryId: "c-1",
  accountId: null,
  descricao: "Almoco",
  valor: "32.00",
  tipo: "expense",
  data: "2026-09-25",
  notas: null,
  parcelado: false,
  compartilhado: false,
  grupoId: null,
  editando: false,
  tipoDeDespesa: "one_off",
};

const linhaDe = (entrada = base, id = ID) => {
  const r = avaliarLancamento(entrada, id);
  assert.equal(r.ok, true, "esperava que este lancamento fosse aceito");
  return r.linha;
};

const itemDe = (over = {}) => ({
  id: ID,
  linha: linhaDe(),
  criadoEm: 1000,
  tentativas: 0,
  ultimoErro: null,
  estado: "pendente",
  ...over,
});

// ---------------------------------------------------------------------------
// avaliarLancamento -- o que pode esperar a rede voltar
// ---------------------------------------------------------------------------

test("despesa simples e aceita e sai com o id que veio", () => {
  const linha = linhaDe();
  // O id vem de fora e vai na linha: e ele que faz o reenvio ser inofensivo.
  assert.equal(linha.id, ID);
  assert.equal(linha.description, "Almoco");
});

test("DESPESA E NEGATIVA -- o sinal nao pode se perder na fila", () => {
  // Uma despesa gravada positiva soma no lugar de subtrair. O saldo fecha
  // errado para MAIS, que e o lado de que ninguem reclama.
  assert.equal(linhaDe().amount, -32);
});

test("receita e positiva", () => {
  assert.equal(linhaDe({ ...base, tipo: "income" }).amount, 32);
});

test("valor digitado com sinal errado e corrigido, nao repassado", () => {
  // O input aceita "-32". Sem o Math.abs, despesa de -32 viraria -(-32) = +32.
  assert.equal(linhaDe({ ...base, valor: "-32" }).amount, -32);
  assert.equal(linhaDe({ ...base, valor: "-32", tipo: "income" }).amount, 32);
});

test("categoria de despesa manda, mesmo com o tipo em branco", () => {
  assert.equal(
    linhaDe({ ...base, tipo: "", categoriaEhDespesa: true }).amount,
    -32
  );
});

test("parcelado e recusado: a fila carregaria intencao, nao fato", () => {
  const r = avaliarLancamento({ ...base, parcelado: true }, ID);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "parcelado");
});

test("despesa fixa e recusada: ela e regra, nao lancamento", () => {
  // Enfileirar como transacao cobraria o valor duas vezes -- agora e de novo
  // quando a ocorrencia do mes fosse baixada.
  const r = avaliarLancamento({ ...base, tipoDeDespesa: "fixed" }, ID);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "despesa-fixa");
});

test("dividida e recusada: o rateio depende de quem esta no grupo AGORA", () => {
  const comGrupo = avaliarLancamento({ ...base, grupoId: "g-1" }, ID);
  assert.equal(comGrupo.ok, false);
  assert.equal(comGrupo.motivo, "compartilhado");

  const compartilhada = avaliarLancamento({ ...base, compartilhado: true }, ID);
  assert.equal(compartilhada.ok, false);
});

test('grupoId "none" e ausencia de grupo, nao um grupo chamado none', () => {
  // A tela usa a string "none" como valor do seletor vazio. Ler isso como
  // grupo de verdade recusaria TODO lancamento offline, e o modo offline
  // pareceria simplesmente nao funcionar.
  assert.equal(avaliarLancamento({ ...base, grupoId: "none" }, ID).ok, true);
});

test("transferencia e recusada: sao duas linhas que se anulam (HMO-164)", () => {
  // A fila envia uma linha de cada vez, e cada envio falha por conta propria.
  // Metade de uma transferencia enviada deixa o dinheiro so saindo (ou so
  // entrando) e erra o saldo das duas contas pelo valor inteiro.
  const r = avaliarLancamento({ ...base, tipo: "transfer" }, ID);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "transferencia");
});

test("transferencia sem categoria e recusada PELO motivo certo", () => {
  // Este e o teste que vale. Transferencia nao tem categoria, entao ela ja era
  // recusada antes da HMO-164 -- mas pelo ramo `invalido`, com a mensagem
  // "Escolha uma categoria", mandando a pessoa procurar um campo que a tela de
  // transferencia nao tem. Um `motivo: "invalido"` aqui e a regressao.
  const r = avaliarLancamento(
    { ...base, tipo: "transfer", categoryId: "" },
    ID
  );
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "transferencia");
  assert.doesNotMatch(r.mensagem, /categoria/i);
});

test("edicao e recusada: a versao do servidor pode ter mudado", () => {
  const r = avaliarLancamento({ ...base, editando: true }, ID);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "edicao");
});

test("valor vazio, zero ou nao numerico e recusado", () => {
  for (const valor of ["", "0", "abc", "  "]) {
    assert.equal(
      avaliarLancamento({ ...base, valor }, ID).ok,
      false,
      `valor ${JSON.stringify(valor)} deveria ser recusado`
    );
  }
});

test("descricao so com espaco e recusada", () => {
  assert.equal(avaliarLancamento({ ...base, descricao: "   " }, ID).ok, false);
});

test("data fora de YYYY-MM-DD e recusada", () => {
  // `transaction_date` e `date` no banco. Uma string em outro formato so
  // falharia no envio, horas depois, longe do formulario que podia avisar.
  for (const data of ["25/09/2026", "2026-9-5", ""]) {
    assert.equal(avaliarLancamento({ ...base, data }, ID).ok, false);
  }
});

test("sem userId ou serviceId e recusado antes de virar linha", () => {
  assert.equal(avaliarLancamento({ ...base, userId: "" }, ID).ok, false);
  assert.equal(avaliarLancamento({ ...base, serviceId: "" }, ID).ok, false);
});

test("a linha aceita NUNCA sai marcada como dividida", () => {
  // `is_shared: true` sem nenhuma linha em `expense_splits` e uma despesa que
  // a tela mostra como rateada e que nao cobra de ninguem.
  const linha = linhaDe();
  assert.equal(linha.is_shared, false);
  assert.equal(linha.group_id, null);
});

// ---------------------------------------------------------------------------
// interpretarRespostaDeEnvio -- a armadilha do reenvio
// ---------------------------------------------------------------------------

test("gravou agora: uma linha de volta", () => {
  assert.equal(
    interpretarRespostaDeEnvio({ erro: null, linhasRetornadas: 1 }),
    "gravado"
  );
});

test("ZERO LINHAS SEM ERRO E SUCESSO, nao falha", () => {
  // Com `ON CONFLICT (id) DO NOTHING`, o reenvio de algo que JA gravou volta
  // sem erro e sem linha. Ler isso como falha devolve o item para a fila para
  // sempre: a fila nunca esvazia, o contador nunca zera, e a causa e um envio
  // que deu certo.
  assert.equal(
    interpretarRespostaDeEnvio({ erro: null, linhasRetornadas: 0 }),
    "ja-estava-la"
  );
});

test("chave duplicada tambem e sucesso", () => {
  assert.equal(classificarErroDeEnvio({ code: "23505" }), "ja-estava-la");
});

// ---------------------------------------------------------------------------
// classificarErroDeEnvio
// ---------------------------------------------------------------------------

test("rede e 5xx sao para repetir", () => {
  assert.equal(classificarErroDeEnvio({ status: 0 }), "repetir");
  assert.equal(classificarErroDeEnvio({ status: 500 }), "repetir");
  assert.equal(classificarErroDeEnvio({ status: 503 }), "repetir");
  assert.equal(classificarErroDeEnvio({ message: "Failed to fetch" }), "repetir");
});

test("RLS e 401 pedem login -- e NAO descartam o lancamento", () => {
  // Descartar aqui apagaria o lancamento de quem ficou tempo demais offline:
  // exatamente a pessoa que esta fila veio atender.
  assert.equal(classificarErroDeEnvio({ code: "42501" }), "reautenticar");
  assert.equal(classificarErroDeEnvio({ status: 401 }), "reautenticar");
  assert.equal(classificarErroDeEnvio({ status: 403 }), "reautenticar");
});

test("erro de conteudo nao adianta repetir", () => {
  // 23503 = a categoria foi apagada no outro aparelho. Repetir para sempre
  // trava a fila atras de uma linha que nunca vai passar.
  assert.equal(classificarErroDeEnvio({ code: "23503" }), "falhou");
  assert.equal(classificarErroDeEnvio({ code: "23514" }), "falhou");
  assert.equal(classificarErroDeEnvio({ code: "22P02" }), "falhou");
  assert.equal(classificarErroDeEnvio({ status: 400 }), "falhou");
});

test("erro desconhecido cai para o lado que nao perde o lancamento", () => {
  assert.equal(classificarErroDeEnvio({ message: "???" }), "repetir");
  assert.equal(classificarErroDeEnvio(undefined), "repetir");
});

// ---------------------------------------------------------------------------
// aplicarResultado
// ---------------------------------------------------------------------------

test("sucesso tira o item da fila", () => {
  assert.equal(aplicarResultado(itemDe(), "gravado"), null);
  assert.equal(aplicarResultado(itemDe(), "ja-estava-la"), null);
});

test("repetir conta tentativa e mantem pendente", () => {
  const depois = aplicarResultado(itemDe(), "repetir", "sem rede");
  assert.equal(depois.estado, "pendente");
  assert.equal(depois.tentativas, 1);
  assert.equal(depois.ultimoErro, "sem rede");
});

test("no teto de tentativas o item vira falhou -- e APARECE", () => {
  // Vira visivel, nao apagado: e assim que a pessoa fica sabendo que precisa
  // relancar.
  const depois = aplicarResultado(
    itemDe({ tentativas: MAX_TENTATIVAS - 1 }),
    "repetir",
    "deu ruim"
  );
  assert.equal(depois.estado, "falhou");
});

test("reautenticar NAO gasta o teto de tentativas", () => {
  // A causa e a sessao, nao o lancamento. Queimar as dez tentativas numa
  // viagem longa transformaria "faca login" em "o seu lancamento virou erro
  // permanente".
  const item = itemDe({ tentativas: MAX_TENTATIVAS - 1 });
  const depois = aplicarResultado(item, "reautenticar", "faca login");
  assert.equal(depois.estado, "pendente");
  assert.equal(depois.tentativas, MAX_TENTATIVAS - 1);
});

test("aplicarResultado nao muda o item original", () => {
  const item = itemDe();
  aplicarResultado(item, "repetir", "x");
  assert.equal(item.tentativas, 0);
  assert.equal(item.ultimoErro, null);
});

// ---------------------------------------------------------------------------
// ordenarParaEnvio / resumirFila
// ---------------------------------------------------------------------------

test("sai o mais antigo primeiro, e o que falhou nao sai", () => {
  const fila = [
    itemDe({ id: "c", criadoEm: 3000 }),
    itemDe({ id: "a", criadoEm: 1000 }),
    itemDe({ id: "z", criadoEm: 2000, estado: "falhou" }),
    itemDe({ id: "b", criadoEm: 2000 }),
  ];
  assert.deepEqual(
    ordenarParaEnvio(fila).map((i) => i.id),
    ["a", "b", "c"]
  );
});

test("dois lancamentos no MESMO milissegundo saem em ordem definida", () => {
  // Dar dois "Salvar" seguidos e comum. Sem o desempate por id a ordem fica
  // indefinida -- o tipo de coisa que passa verde na maquina e muda de
  // comportamento no celular.
  const fila = [
    itemDe({ id: "b", criadoEm: 1000 }),
    itemDe({ id: "a", criadoEm: 1000 }),
  ];
  assert.deepEqual(ordenarParaEnvio(fila).map((i) => i.id), ["a", "b"]);
  assert.deepEqual(
    ordenarParaEnvio([...fila].reverse()).map((i) => i.id),
    ["a", "b"]
  );
});

test("o total pendente soma em modulo -- despesa nao cancela receita", () => {
  // Sem o Math.abs, uma despesa de 32 e uma receita de 32 se anulariam e o
  // aviso diria "R$ 0 aguardando" com dois lancamentos na fila.
  const fila = [
    itemDe({ id: "a", linha: linhaDe(base, "a") }),
    itemDe({ id: "b", linha: linhaDe({ ...base, tipo: "income" }, "b") }),
    itemDe({ id: "c", estado: "falhou" }),
  ];
  const resumo = resumirFila(fila);
  assert.equal(resumo.pendentes, 2);
  assert.equal(resumo.falhados, 1);
  assert.equal(resumo.totalPendente, 64);
});

test("fila vazia resume em zeros", () => {
  assert.deepEqual(resumirFila([]), {
    pendentes: 0,
    falhados: 0,
    totalPendente: 0,
  });
});

// ---------------------------------------------------------------------------
// novoId
// ---------------------------------------------------------------------------

test("novoId devolve uuid v4 e nao repete", () => {
  const a = novoId();
  assert.match(
    a,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  );
  assert.notEqual(a, novoId());
});

test("novoId funciona sem crypto.randomUUID (contexto nao seguro)", () => {
  // http://<ip>:3000 na rede local -- que e exatamente como se testa o app no
  // celular. Sem o fallback, lancar offline estouraria justamente ali.
  const original = globalThis.crypto;
  try {
    Object.defineProperty(globalThis, "crypto", {
      value: {},
      configurable: true,
    });
    assert.match(
      novoId(),
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      value: original,
      configurable: true,
    });
  }
});

// ---------------------------------------------------------------------------
// O CATALOGO (lib/offline-cache.ts)
// ---------------------------------------------------------------------------
// Sem ele a fila funciona e nao serve para nada: offline o seletor de
// categoria abre vazio, e um formulario sem categoria nao passa na propria
// validacao.

const storageFalso = (inicial = {}) => {
  const dados = { ...inicial };
  return {
    getItem: (k) => (k in dados ? dados[k] : null),
    setItem: (k, v) => {
      dados[k] = String(v);
    },
    removeItem: (k) => {
      delete dados[k];
    },
    dados,
  };
};

const catalogo = {
  serviceId: "s-1",
  categorias: [{ id: "c-1", name: "Alimentacao", is_expense: true }],
  contas: [{ id: "a-1", name: "Conta", account_type: "checking" }],
  guardadoEm: 1_700_000_000_000,
};

test("catalogo guardado volta igual", () => {
  const s = storageFalso();
  guardarCatalogo(s, catalogo);
  assert.deepEqual(lerCatalogo(s), catalogo);
});

test("sem nada guardado, devolve null", () => {
  assert.equal(lerCatalogo(storageFalso()), null);
});

test("JSON corrompido devolve null em vez de estourar", () => {
  // Este valor sobrevive a troca de versao do app. Um `JSON.parse` solto
  // estoura na montagem da tela, e a pagina em branco que sobra so sai com
  // "limpar dados do site" -- instrucao que ninguem descobre sozinho.
  const s = storageFalso({ "pulodogato:catalogo-lancamento": "{nao e json" });
  assert.equal(lerCatalogo(s), null);
});

test("catalogo sem serviceId e recusado inteiro", () => {
  // `service_id` e NOT NULL na tabela. Um catalogo sem ele deixaria a pessoa
  // preencher o formulario todo para o lancamento ser recusado no fim.
  const s = storageFalso();
  guardarCatalogo(s, { ...catalogo, serviceId: "" });
  assert.equal(lerCatalogo(s), null);
});

test("catalogo sem nenhuma categoria e recusado, nao devolvido vazio", () => {
  // Devolver `{categorias: []}` faria a tela mostrar um seletor vazio em vez
  // do aviso de "abra uma vez com conexao": a feature pareceria quebrada em
  // vez de explicada.
  const s = storageFalso();
  guardarCatalogo(s, { ...catalogo, categorias: [] });
  assert.equal(lerCatalogo(s), null);
});

test("categoria malformada e descartada, o resto do catalogo fica", () => {
  const s = storageFalso();
  guardarCatalogo(s, {
    ...catalogo,
    categorias: [{ id: "c-1", name: "Alimentacao", is_expense: true }, { name: "sem id" }],
  });
  const lido = lerCatalogo(s);
  assert.equal(lido.categorias.length, 1);
  assert.equal(lido.categorias[0].id, "c-1");
});

test("storage que estoura na leitura nao derruba a tela", () => {
  // Navegacao anonima em alguns navegadores lanca em vez de devolver null.
  const s = {
    getItem: () => {
      throw new Error("bloqueado");
    },
    setItem: () => {},
    removeItem: () => {},
  };
  assert.equal(lerCatalogo(s), null);
});

test("storage que estoura na gravacao nao derruba o carregamento", () => {
  // Cota cheia. O preco e o modo offline vir sem catalogo depois -- o que NAO
  // pode acontecer e a tela online quebrar por causa disso.
  const s = {
    getItem: () => null,
    setItem: () => {
      throw new Error("cota");
    },
    removeItem: () => {},
  };
  assert.doesNotThrow(() => guardarCatalogo(s, catalogo));
});

test("esquecerCatalogo apaga", () => {
  const s = storageFalso();
  guardarCatalogo(s, catalogo);
  esquecerCatalogo(s);
  assert.equal(lerCatalogo(s), null);
});

// ---------------------------------------------------------------------------
// ABRIR A TELA QUANDO `getUser()` NAO DEU USUARIO (decidirAbertura)
// ---------------------------------------------------------------------------
// Esta secao existe por causa de um defeito que chegou em producao com o modo
// offline INTEIRO funcionando: "funciona offline mas as categorias nao
// carregaram" (25/09). A fila estava certa, o catalogo estava gravado no
// aparelho, e mesmo assim o seletor abria vazio.
//
// A causa era uma guarda que ninguem leria duas vezes:
//
//     const { data: { user } } = await supabase.auth.getUser();
//     if (!user) return;
//
// `getUser()` vai na rede e, quando a rede falha, o supabase-js NAO lanca --
// devolve `user: null` com o erro ao lado. O `return` seco saia da funcao
// antes do catch que sabia repor o catalogo. Nada aparecia como erro.
//
// A licao que estes testes travam: **"sem usuario" tem quatro causas, e elas
// pedem quatro comportamentos diferentes.** Enquanto isso fosse um `if` de uma
// linha dentro da pagina, nao havia onde perguntar "e os outros tres casos?".

const usuario = { id: "u-1", email: "helio@exemplo.com" };

test("servidor confirmou: segue o carregamento normal", () => {
  const d = decidirAbertura({
    usuarioConfirmado: usuario,
    origemDaFalha: "rede",
    sessaoLembrada: { id: "u-velho", email: null },
    catalogo,
  });
  // Confirmado manda sozinho: nem o bilhete velho nem `origemDaFalha` mudam
  // isso. E a mesma precedencia de `decidirSessao`.
  assert.equal(d.decisao, "seguir");
  assert.equal(d.usuario.id, "u-1");
});

test("SEM REDE com catalogo guardado: repoe, e este e o caso do defeito", () => {
  const d = decidirAbertura({
    usuarioConfirmado: null,
    origemDaFalha: "rede",
    sessaoLembrada: usuario,
    catalogo,
  });
  assert.equal(d.decisao, "repor-do-aparelho");
  // As duas metades precisam voltar juntas: o catalogo enche os seletores, e o
  // usuario e o `user_id` que a fila exige -- sem ele o submit recusa com
  // "preencha todos os campos obrigatorios", que e uma mensagem falsa.
  assert.deepEqual(d.catalogo.categorias, catalogo.categorias);
  assert.equal(d.usuario.id, "u-1");
});

test("servidor RECUSOU o token: nao repoe nada, mesmo com catalogo no aparelho", () => {
  const d = decidirAbertura({
    usuarioConfirmado: null,
    origemDaFalha: "recusa",
    sessaoLembrada: usuario,
    catalogo,
  });
  // Repor aqui seria mostrar as categorias de uma sessao que o proprio
  // servidor acabou de recusar -- e deixar lancar na fila em nome dela.
  assert.equal(d.decisao, "desistir");
  assert.equal(d.catalogo, null);
  assert.equal(d.usuario, null);
});

test("sem rede e sem catalogo: avisa, nao abre um formulario vazio", () => {
  const d = decidirAbertura({
    usuarioConfirmado: null,
    origemDaFalha: "rede",
    sessaoLembrada: usuario,
    catalogo: null,
  });
  assert.equal(d.decisao, "aparelho-vazio");
});

test("sem rede, com catalogo e SEM bilhete: nao deixa preencher para recusar no fim", () => {
  // Este e o caso assimetrico, e o unico que nao e obvio. O catalogo sozinho
  // encheria os seletores, a pessoa preencheria o lancamento inteiro, e so no
  // envio a fila recusaria por falta de `user_id` -- o pior momento possivel
  // para descobrir. Melhor dizer antes que falta abrir uma vez com conexao.
  const d = decidirAbertura({
    usuarioConfirmado: null,
    origemDaFalha: "rede",
    sessaoLembrada: null,
    catalogo,
  });
  assert.equal(d.decisao, "aparelho-vazio");
  assert.equal(d.catalogo, null);
});

test("as quatro decisoes sao alcancaveis, e nenhuma outra existe", () => {
  // Guarda contra o proximo caso esquecido: se alguem acrescentar um valor ao
  // tipo sem dar um caminho para ele, ou trocar o default silenciosamente,
  // este teste e o que cobra.
  const casos = [
    { usuarioConfirmado: usuario, origemDaFalha: "rede", sessaoLembrada: null, catalogo: null },
    { usuarioConfirmado: null, origemDaFalha: "recusa", sessaoLembrada: usuario, catalogo },
    { usuarioConfirmado: null, origemDaFalha: "rede", sessaoLembrada: usuario, catalogo },
    { usuarioConfirmado: null, origemDaFalha: "rede", sessaoLembrada: null, catalogo: null },
  ];
  const vistas = new Set(casos.map((c) => decidirAbertura(c).decisao));
  assert.deepEqual(
    [...vistas].sort(),
    ["aparelho-vazio", "desistir", "repor-do-aparelho", "seguir"]
  );
});

// ---------------------------------------------------------------------------
// A moeda atravessa a fila (HMO-171)
// ---------------------------------------------------------------------------
// A coluna `currency` tem DEFAULT 'BRL' (022). Isso faz o defeito aqui ser
// invisivel: uma linha que chega a fila SEM moeda e gravada como real, sem erro
// nenhum, e um lancamento feito offline numa conta em dolar entra no balde errado
// do relatorio na hora da sincronizacao. So conferindo lancamento por lancamento
// se descobre.

test("a moeda escolhida na tela chega na linha da fila", () => {
  assert.equal(linhaDe({ ...base, moeda: "USD" }).currency, "USD");
});

test("linha sem moeda cai em BRL, e nao em undefined", () => {
  // `undefined` aqui seria omitido do JSON e a coluna cairia no DEFAULT -- o
  // mesmo resultado, por acidente. A asercao existe para que o campo seja
  // SEMPRE presente e explicito: uma linha na fila e um registro que o aparelho
  // guarda por horas, e ela tem que dizer em que moeda esta.
  assert.equal(linhaDe().currency, "BRL");
  assert.equal(linhaDe({ ...base, moeda: "" }).currency, "BRL");
  assert.equal(linhaDe({ ...base, moeda: "   " }).currency, "BRL");
});

test("a moeda e normalizada para maiuscula na fila", () => {
  // A fila e gravada no aparelho e reenviada depois. Um "usd" minusculo passaria
  // pelo JSON e bateria no CHECK da 022 so na sincronizacao -- horas depois, num
  // reenvio de fundo que a pessoa nao esta olhando.
  assert.equal(linhaDe({ ...base, moeda: " usd " }).currency, "USD");
});
