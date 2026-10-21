// O MOTOR DA CONVERSA DO MODO PAPEL DE PAO -- HMO-464, F1 do plano da HMO-462.
//
//   npm run test:conversa-do-papel
//
// O QUE ESTA SUITE PROVA
// ----------------------
// Que as cinco telas da conversa caminham como a issue descreve, e que nenhuma
// delas pergunta nada que nao seja "quanto?": saudacao -> digitando ->
// confirmando -> pronto, mais o `saldo` ao lado.
//
// Ela roda DUAS VEZES, em America/Sao_Paulo e em UTC (ver o alvo no
// package.json), e isso nao e zelo: a issue exige que o relogio entre por
// PARAMETRO, e uma suite de um fuso so passa verde com `new Date()` escondido
// dentro do motor. Com os dois fusos, qualquer leitura de relogio aqui dentro
// faz as duas voltas discordarem. (A mesma armadilha ja custou caro neste
// repositorio em `test:papel-de-pao`, que roda nos dois fusos pela mesma
// razao.)
//
// O QUE ELA NAO PROVA
// -------------------
// Que o dinheiro e gravado (e a rota de F3), que o saldo e somado certo (e
// `lib/saldo-da-conversa.ts`, F2) e que a tela pinta (e F4). O que amarra o
// motor a eles e o tsc e as suites deles -- nao ha copia de nenhuma regra aqui.
//
// POR QUE AS ASSERCOES DE VALOR SAO LITERAIS
// ------------------------------------------
// "R$ 1.000,00" esta escrito a mao em vez de sair de `formatarValor` chamado
// pelo teste. Chamar o mesmo formatador nos dois lados seria o conferidor com o
// mesmo extrator em cada ponta: ele fica verde com qualquer mascara, inclusive
// com a errada. O literal e dado independente, e e ele que prende a convencao
// de CENTAVOS do teclado (1-0-0-0 e dez reais, nao mil).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const {
  ESTADOS,
  TECLAS,
  aoGesto,
  botoes,
  conversaInicial,
  fraseDaPergunta,
  fraseDoResultado,
  frasesDoSaldo,
  lancamentoDaConversa,
  mesDoSaldo,
  podeConfirmar,
  primeiroNome,
  rotuloDoSaldo,
  tecladoAberto,
  valorNaTela,
} = await import("../.tmp-conversa-do-papel/lib/conversa-do-papel.js");

/** 20 de outubro de 2026 -- o dia em que o plano foi aceito. */
const HOJE = "2026-10-20";

const nova = (nome = "Letícia Moraes de Souza", hoje = HOJE) =>
  conversaInicial({ nome, hoje });

/** Aplica uma fila de gestos, na ordem. */
const andar = (conversa, ...gestos) => gestos.reduce(aoGesto, conversa);

const digitar = (conversa, teclas) =>
  andar(
    conversa,
    ...[...teclas].map((digito) => ({ tipo: "digito", digito }))
  );

const rotulos = (lista) => lista.map((b) => b.rotulo);
const gestos = (lista) => lista.map((b) => b.gesto);

/**
 * OS OITO GESTOS, escritos a mao.
 *
 * Esta lista e a forma executavel de "sem seletor de categoria, de conta ou de
 * data: nada disso e pergunta para ela". `Gesto` e uma uniao fechada no
 * TypeScript, mas uniao de tipo nao existe em tempo de execucao -- e o `.mjs`
 * nao passa pelo tsc. Entao o vocabulario da conversa fica preso aqui, e um
 * gesto novo (`{ tipo: "categoria" }`) obriga quem o acrescentar a vir mexer
 * nesta linha de proposito.
 */
const GESTOS = [
  "gastei",
  "ganhei",
  "saldo",
  "digito",
  "apagar",
  "limpar",
  "confirmar",
  "voltar",
];

// ---------------------------------------------------------------------------
// 1. Saudacao
// ---------------------------------------------------------------------------

test("a saudacao chama a pessoa pelo PRIMEIRO nome e oferece os tres botoes", () => {
  const c = nova();

  assert.equal(c.estado, "saudacao");
  // "Olá Letícia Moraes de Souza, o que deseja?" e um cadastro falando, nao uma
  // conversa. E o nome vem do argumento, nao de um relogio nem de um padrao.
  assert.equal(fraseDaPergunta(c), "Olá Letícia, o que deseja?");
  assert.deepEqual(rotulos(botoes(c)), ["Gastei", "Ganhei", "Saldo"]);
  assert.deepEqual(gestos(botoes(c)), ["gastei", "ganhei", "saldo"]);
  // A ordem e a da issue: Gastei primeiro. Nao e enfeite -- anotar gasto e o
  // que ela faz todo dia, e o primeiro botao e o que o dedo encontra.
  assert.equal(botoes(c)[0].rotulo, "Gastei");
  // Nada de teclado antes de ela escolher a palavra.
  assert.equal(tecladoAberto(c), false);
  assert.equal(fraseDoResultado(c), null);
  assert.equal(lancamentoDaConversa(c), null);
});

test("sem nome a saudacao perde a virgula -- e nao fica 'Olá , o que deseja?'", () => {
  // Os quatro jeitos de nao haver nome: ausente, nulo, vazio e so espaco. O
  // ultimo e o que um `full_name` de " " produz, e e o que um `?? ""` sem
  // `trim` deixaria passar.
  for (const nome of [undefined, null, "", "   "]) {
    const c = conversaInicial({ nome, hoje: HOJE });
    assert.equal(c.nome, "");
    assert.equal(fraseDaPergunta(c), "Olá, o que deseja?");
  }

  // E o recorte do primeiro nome, direto, com o espaco de sobra nas duas
  // pontas -- um `split(" ")[0]` sem `trim` devolveria "" aqui.
  assert.equal(primeiroNome("  Letícia  Moraes  "), "Letícia");
  assert.equal(primeiroNome("Letícia"), "Letícia");
});

test("gesto que nao cabe na saudacao devolve a MESMA conversa", () => {
  const c = nova();
  // Identidade, e nao igualdade: `proxima === atual` e o que diz a F4 que nada
  // aconteceu. Uma copia nova a cada toque perdido faria a tela repintar e, no
  // `digitando`, poderia reiniciar a digitacao sem nada na tela mudando.
  for (const gesto of [
    { tipo: "digito", digito: "5" },
    { tipo: "apagar" },
    { tipo: "limpar" },
    { tipo: "confirmar" },
    { tipo: "voltar" },
  ]) {
    assert.equal(aoGesto(c, gesto), c, `${gesto.tipo} nao deveria mexer na saudacao`);
  }
});

test("hoje tem de ser data de verdade -- e o motor RECUSA quando nao e", () => {
  // `hoje` nao vem do banco nem da mao de ninguem: vem do nosso `today()`. Um
  // `hoje` sujo nao deixa a tela estranha, deixa o SALDO respondendo por outro
  // mes com a mesma cara de certo -- e nao ha padrao para onde cair sem ler o
  // relogio, que e justamente o que este motor nao faz.
  for (const hoje of [
    "",
    "20/10/2026",
    "2026-10",
    "2026-13-01",
    "2026-02-30",
    "ontem",
  ]) {
    assert.throws(
      () => conversaInicial({ nome: "Letícia", hoje }),
      /hoje tem de ser/,
      `${JSON.stringify(hoje)} deveria ser recusado`
    );
  }
  // CONTROLE: a data boa passa. Sem este par, uma validacao que recusasse tudo
  // deixaria o laco acima verde sem medir nada.
  assert.equal(conversaInicial({ nome: "Letícia", hoje: HOJE }).hoje, HOJE);
  assert.equal(
    conversaInicial({ nome: "Letícia", hoje: "2024-02-29" }).hoje,
    "2024-02-29"
  );
});

// ---------------------------------------------------------------------------
// 2. Digitando o valor
// ---------------------------------------------------------------------------

test("Gastei e Ganhei abrem o teclado, e a pergunta muda com a palavra", () => {
  const gastei = aoGesto(nova(), { tipo: "gastei" });
  assert.equal(gastei.estado, "digitando");
  assert.equal(gastei.direcao, "gastei");
  assert.equal(fraseDaPergunta(gastei), "Quanto você gastou?");
  assert.equal(tecladoAberto(gastei), true);

  const ganhei = aoGesto(nova(), { tipo: "ganhei" });
  assert.equal(ganhei.direcao, "ganhei");
  // A pergunta no PASSADO e com a outra palavra. Um motor que ignorasse a
  // direcao aqui passaria por qualquer assercao de contagem de estado.
  assert.equal(fraseDaPergunta(ganhei), "Quanto você ganhou?");
});

test("o teclado tem dez teclas, de 1 a 9 e o zero por ultimo", () => {
  assert.deepEqual([...TECLAS], ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"]);
});

test("o acumulador e o de dinheiro.ts -- CENTAVOS, com os numeros da issue", () => {
  const vazio = aoGesto(nova(), { tipo: "gastei" });
  // Campo vazio mostra zero em vez de nada: o teclado grande nao pode nascer em
  // branco. E zero nao e valor -- nao da para seguir.
  assert.equal(valorNaTela(vazio), "R$ 0,00");
  assert.equal(podeConfirmar(vazio), false);

  // A CONVENCAO, com literal: quatro teclas sao dez reais. E ela que permite
  // digitar 47,80 (a compra de verdade) sem tecla de virgula.
  assert.equal(valorNaTela(digitar(vazio, "1000")), "R$ 10,00");
  assert.equal(valorNaTela(digitar(vazio, "4780")), "R$ 47,80");
  assert.equal(valorNaTela(digitar(vazio, "5")), "R$ 0,05");

  // OS DOIS NUMEROS DA ISSUE -- "gastei 1000, ganhei 2000, entao saldo 1000".
  // Mil reais sao seis teclas, e o separador de milhar entra.
  assert.equal(valorNaTela(digitar(vazio, "100000")), "R$ 1.000,00");
  assert.equal(valorNaTela(digitar(vazio, "200000")), "R$ 2.000,00");
  assert.equal(podeConfirmar(digitar(vazio, "100000")), true);
});

test("zero a esquerda nao acumula -- 0 depois 5 e cinco centavos", () => {
  const vazio = aoGesto(nova(), { tipo: "gastei" });

  // O toque no zero com o campo vazio nao faz NADA (identidade). Sem a poda, o
  // campo ficaria "0" e o 5 seguinte daria "05" -> "R$ 0,50", cinquenta
  // centavos onde ela quis cinco.
  const soZero = aoGesto(vazio, { tipo: "digito", digito: "0" });
  assert.equal(soZero, vazio);
  assert.equal(valorNaTela(digitar(vazio, "05")), "R$ 0,05");
  assert.equal(podeConfirmar(soZero), false);

  // E o zero DEPOIS de um digito acumula normalmente -- a poda e so a esquerda.
  assert.equal(valorNaTela(digitar(vazio, "50")), "R$ 0,50");
});

test("apagar tira UMA tecla; limpar tira tudo; nos dois o vazio e ponto fixo", () => {
  const vazio = aoGesto(nova(), { tipo: "gastei" });
  const mil = digitar(vazio, "100000");

  const umaMenos = aoGesto(mil, { tipo: "apagar" });
  // Uma tecla, nao duas e nao a primeira: R$ 1.000,00 vira R$ 100,00.
  assert.equal(valorNaTela(umaMenos), "R$ 100,00");
  assert.equal(valorNaTela(aoGesto(umaMenos, { tipo: "apagar" })), "R$ 10,00");

  assert.equal(valorNaTela(aoGesto(mil, { tipo: "limpar" })), "R$ 0,00");
  assert.equal(podeConfirmar(aoGesto(mil, { tipo: "limpar" })), false);

  // Vazio: os dois gestos devolvem a MESMA conversa. Era o ponto fixo de
  // "R$ 0,00" que `lib/dinheiro.ts` documenta -- um campo impossivel de
  // esvaziar, sem erro nenhum, para sempre.
  assert.equal(aoGesto(vazio, { tipo: "apagar" }), vazio);
  assert.equal(aoGesto(vazio, { tipo: "limpar" }), vazio);
});

test("o teto de 15 digitos IGNORA a tecla, nao corta o numero", () => {
  const vazio = aoGesto(nova(), { tipo: "gastei" });
  const cheio = digitar(vazio, "123456789012345");
  assert.equal(valorNaTela(cheio), "R$ 1.234.567.890.123,45");

  // A 16a tecla nao faz nada. Cortar pelo fim mudaria o numero que ela esta
  // vendo enquanto digita; ignorar so nao faz nada, e nao ha como ficar com um
  // valor que ninguem pediu.
  assert.equal(aoGesto(cheio, { tipo: "digito", digito: "6" }), cheio);
  assert.equal(valorNaTela(digitar(vazio, "1234567890123456")), "R$ 1.234.567.890.123,45");
});

test("tecla que nao e digito nao entra no acumulador", () => {
  const mil = digitar(aoGesto(nova(), { tipo: "gastei" }), "100000");
  // Nada disto chega pelo teclado da tela -- chega de um teste, de um teclado
  // fisico ou de um `onKeyDown` generoso. A funcao e TOTAL de proposito: ela
  // nao deixa o acumulador num estado que a mascara nao sabe ler.
  for (const digito of ["a", "", " ", "10", "-1", "1.5", ",", null, undefined]) {
    assert.equal(
      aoGesto(mil, { tipo: "digito", digito }),
      mil,
      `${JSON.stringify(digito)} nao deveria entrar`
    );
  }
});

test("Pronto so aparece com valor -- e nao leva zero para a confirmacao", () => {
  const vazio = aoGesto(nova(), { tipo: "gastei" });

  // Botao que nao faz nada ensina que a tela as vezes nao responde. Com o campo
  // vazio so ha a saida.
  assert.deepEqual(rotulos(botoes(vazio)), ["Voltar"]);
  // E o `confirmar` nao caminha: seguir daqui daria "Gastei R$ 0,00, certo?" e
  // um lancamento de zero que a rota recusaria depois, no lugar errado.
  assert.equal(aoGesto(vazio, { tipo: "confirmar" }), vazio);

  const mil = digitar(vazio, "100000");
  assert.deepEqual(rotulos(botoes(mil)), ["Pronto", "Voltar"]);
  assert.deepEqual(gestos(botoes(mil)), ["confirmar", "voltar"]);
});

test("Voltar do teclado volta para a saudacao e esquece o que foi digitado", () => {
  const mil = digitar(aoGesto(nova(), { tipo: "gastei" }), "100000");
  const volta = aoGesto(mil, { tipo: "voltar" });

  assert.equal(volta.estado, "saudacao");
  assert.equal(volta.direcao, null);
  assert.equal(volta.digitos, "");
  assert.equal(volta.lancamento, null);
  // E o nome e o relogio sobrevivem -- eles nao sao estado da conversa, sao o
  // contexto dela.
  assert.equal(volta.nome, "Letícia");
  assert.equal(volta.hoje, HOJE);
});

// ---------------------------------------------------------------------------
// 3. Confirmacao
// ---------------------------------------------------------------------------

test("a confirmacao repete a frase da issue -- 'Gastei 1000, certo?'", () => {
  const confirma = andar(
    digitar(aoGesto(nova(), { tipo: "gastei" }), "100000"),
    { tipo: "confirmar" }
  );

  assert.equal(confirma.estado, "confirmando");
  assert.equal(fraseDaPergunta(confirma), "Gastei R$ 1.000,00, certo?");
  assert.deepEqual(rotulos(botoes(confirma)), ["Sim, anotar", "Não, corrigir"]);
  assert.deepEqual(gestos(botoes(confirma)), ["confirmar", "voltar"]);
  // O teclado fecha: a pergunta e sim ou nao.
  assert.equal(tecladoAberto(confirma), false);

  const ganhou = andar(
    digitar(aoGesto(nova(), { tipo: "ganhei" }), "200000"),
    { tipo: "confirmar" }
  );
  // A outra palavra, e o outro numero da issue.
  assert.equal(fraseDaPergunta(ganhou), "Ganhei R$ 2.000,00, certo?");
});

test("o lancamento que vai para a rota: direcao, GRANDEZA e a data de hoje", () => {
  const confirma = andar(
    digitar(aoGesto(nova(), { tipo: "gastei" }), "100000"),
    { tipo: "confirmar" }
  );

  // `1000.00` com PONTO, que e o que a rota manda para o Postgres, e SEM
  // sinal: despesa negativa e convencao de `financial_transactions` e quem a
  // aplica e F3. Um motor que ja mandasse `-1000.00` criaria o segundo lugar
  // onde o sinal mora -- e a familia de defeito que este repositorio mais paga.
  assert.deepEqual(lancamentoDaConversa(confirma), {
    direcao: "gastei",
    valor: "1000.00",
    data: HOJE,
  });

  const ganhou = andar(
    digitar(aoGesto(nova(), { tipo: "ganhei" }), "4780"),
    { tipo: "confirmar" }
  );
  assert.deepEqual(lancamentoDaConversa(ganhou), {
    direcao: "ganhei",
    valor: "47.80",
    data: HOJE,
  });

  // A DATA E O PARAMETRO, nao o relogio: um `hoje` diferente sai no
  // lancamento. Esta e a assercao que um `new Date()` escondido no motor nao
  // atravessa.
  const outroDia = andar(
    digitar(aoGesto(nova("Letícia", "2026-01-31"), { tipo: "gastei" }), "100000"),
    { tipo: "confirmar" }
  );
  assert.equal(lancamentoDaConversa(outroDia).data, "2026-01-31");
});

test("'Não, corrigir' volta ao teclado COM os digitos -- corrigir nao e digitar de novo", () => {
  const confirma = andar(
    digitar(aoGesto(nova(), { tipo: "gastei" }), "100000"),
    { tipo: "confirmar" }
  );
  const corrige = aoGesto(confirma, { tipo: "voltar" });

  assert.equal(corrige.estado, "digitando");
  assert.equal(corrige.direcao, "gastei");
  // Os digitos continuam la: ela errou UMA tecla, e apagar uma e o gesto
  // seguinte. Um `voltar` que limpasse o campo faria a correcao custar o valor
  // inteiro -- e e o caminho mais natural de todos, porque ela so vem para a
  // confirmacao se achar que digitou certo.
  assert.equal(valorNaTela(corrige), "R$ 1.000,00");
  assert.equal(valorNaTela(aoGesto(corrige, { tipo: "apagar" })), "R$ 100,00");
  // E o lancamento sai de jogo -- ele deixa de existir junto com a pergunta.
  assert.equal(lancamentoDaConversa(corrige), null);
});

test("toque perdido na confirmacao nao muda o valor que ela esta conferindo", () => {
  const confirma = andar(
    digitar(aoGesto(nova(), { tipo: "gastei" }), "100000"),
    { tipo: "confirmar" }
  );
  // O teclado esta fechado, mas o gesto ainda pode chegar (tecla fisica, toque
  // atrasado no botao que acabou de sair da tela). Mudar o valor DEBAIXO da
  // pergunta "Gastei R$ 1.000,00, certo?" seria gravar um numero que a frase
  // nao disse.
  for (const gesto of [
    { tipo: "digito", digito: "9" },
    { tipo: "apagar" },
    { tipo: "limpar" },
    { tipo: "gastei" },
    { tipo: "ganhei" },
    { tipo: "saldo" },
  ]) {
    assert.equal(aoGesto(confirma, gesto), confirma, `${gesto.tipo} nao deveria mexer`);
  }
});

// ---------------------------------------------------------------------------
// 4. Pronto
// ---------------------------------------------------------------------------

test("Pronto diz o resultado em UMA frase e volta a oferecer os tres botoes", () => {
  const pronto = andar(
    digitar(aoGesto(nova(), { tipo: "gastei" }), "100000"),
    { tipo: "confirmar" },
    { tipo: "confirmar" }
  );

  assert.equal(pronto.estado, "pronto");
  // A frase nomeia a DIRECAO e o VALOR. Um "Anotado!" sozinho nao distingue o
  // toque que gravou mil do que gravou dez mil -- e e o erro de uma tecla que
  // esta frase existe para deixar visivel.
  assert.equal(fraseDoResultado(pronto), "Gastei R$ 1.000,00. Anotado.");
  // "volta para a saudacao": a pergunta e a saudacao outra vez, com os tres
  // botoes. Ela nao precisa dispensar a frase para anotar a proxima coisa.
  assert.equal(fraseDaPergunta(pronto), "Olá Letícia, o que deseja?");
  assert.deepEqual(rotulos(botoes(pronto)), ["Gastei", "Ganhei", "Saldo"]);
  assert.equal(tecladoAberto(pronto), false);

  // O lancamento sobrevive: e dele que F4 tira o corpo do POST para F3.
  assert.deepEqual(lancamentoDaConversa(pronto), {
    direcao: "gastei",
    valor: "1000.00",
    data: HOJE,
  });

  const ganhou = andar(
    digitar(aoGesto(nova(), { tipo: "ganhei" }), "200000"),
    { tipo: "confirmar" },
    { tipo: "confirmar" }
  );
  assert.equal(fraseDoResultado(ganhou), "Ganhei R$ 2.000,00. Anotado.");
});

test("o resultado so existe no Pronto", () => {
  const c = nova();
  const digitando = digitar(aoGesto(c, { tipo: "gastei" }), "100000");
  const confirmando = aoGesto(digitando, { tipo: "confirmar" });
  const saldo = aoGesto(c, { tipo: "saldo" });

  // Nos outros quatro estados nao ha nada "anotado" a dizer, e dizer seria
  // afirmar uma gravacao que nao aconteceu.
  for (const [nome, estado] of Object.entries({
    saudacao: c,
    digitando,
    confirmando,
    saldo,
  })) {
    assert.equal(fraseDoResultado(estado), null, `${nome} nao deveria ter resultado`);
  }
});

test("do Pronto, o lancamento seguinte comeca do zero", () => {
  const pronto = andar(
    digitar(aoGesto(nova(), { tipo: "gastei" }), "100000"),
    { tipo: "confirmar" },
    { tipo: "confirmar" }
  );

  const proximo = aoGesto(pronto, { tipo: "ganhei" });
  assert.equal(proximo.estado, "digitando");
  assert.equal(proximo.direcao, "ganhei");
  // O valor anterior NAO e herdado. Herdar faria o segundo lancamento nascer
  // com o numero do primeiro ja na tela -- e confirmar por reflexo gravaria
  // mil reais que ninguem digitou.
  assert.equal(valorNaTela(proximo), "R$ 0,00");
  assert.equal(lancamentoDaConversa(proximo), null);
  assert.equal(fraseDoResultado(proximo), null);

  // E o Saldo tambem sai do Pronto, direto.
  assert.equal(aoGesto(pronto, { tipo: "saldo" }).estado, "saldo");

  // `voltar` no Pronto dispensa a frase e nada mais.
  const limpo = aoGesto(pronto, { tipo: "voltar" });
  assert.equal(limpo.estado, "saudacao");
  assert.equal(fraseDoResultado(limpo), null);
  assert.equal(lancamentoDaConversa(limpo), null);
});

// ---------------------------------------------------------------------------
// 5. Saldo
// ---------------------------------------------------------------------------

test("o Saldo diz de QUE MES ele fala, e o rotulo nasce da janela consultada", () => {
  const saldo = aoGesto(nova(), { tipo: "saldo" });

  assert.equal(saldo.estado, "saldo");
  // Um "Saldo" sem periodo e um numero que ela nao consegue conferir de cabeca,
  // e saldo desde sempre cresce para sempre e nunca reinicia.
  assert.equal(fraseDaPergunta(saldo), "Seu saldo de outubro de 2026");
  assert.equal(rotuloDoSaldo(saldo), "outubro de 2026");
  // E o rotulo e a consulta saem do MESMO periodo. Um rotulo escrito a parte da
  // janela seria o defeito que este repositorio ja pagou duas vezes: numero
  // certo, pergunta desconhecida.
  assert.deepEqual(mesDoSaldo(saldo), { de: "2026-10-01", ate: "2026-10-31" });
  assert.equal(tecladoAberto(saldo), false);
  assert.deepEqual(rotulos(botoes(saldo)), ["Gastei", "Ganhei", "Voltar"]);
});

test("o mes do Saldo e o do PARAMETRO, inclusive na virada e em fevereiro", () => {
  // O ultimo dia do mes e o primeiro: num motor que lesse o relogio por dentro,
  // a volta em UTC desta suite ja discordaria da volta em Sao_Paulo -- as 21h
  // do dia 31 em Sao_Paulo sao o dia 1o em UTC.
  const casos = [
    ["2026-10-01", "outubro de 2026", "2026-10-31"],
    ["2026-10-31", "outubro de 2026", "2026-10-31"],
    ["2026-12-31", "dezembro de 2026", "2026-12-31"],
    ["2027-01-01", "janeiro de 2027", "2027-01-31"],
    // Fevereiro, nos dois tamanhos: 2026 tem 28 dias, 2024 tem 29. Um
    // `ate` cravado em 30 ou 31 inventaria dias que o mes nao tem.
    ["2026-02-10", "fevereiro de 2026", "2026-02-28"],
    ["2024-02-10", "fevereiro de 2024", "2024-02-29"],
  ];

  for (const [hoje, rotulo, ate] of casos) {
    const saldo = aoGesto(nova("Letícia", hoje), { tipo: "saldo" });
    assert.equal(rotuloDoSaldo(saldo), rotulo, hoje);
    assert.equal(mesDoSaldo(saldo).de, `${hoje.slice(0, 7)}-01`, hoje);
    assert.equal(mesDoSaldo(saldo).ate, ate, hoje);
  }
});

test("a tela mostra os TRES numeros juntos, na ordem da issue", () => {
  // "gastei 1000, ganhei 2000, entao saldo 1000" -- a frase da issue, inteira,
  // e ela e o teste de aceitacao: conferivel de cabeca.
  assert.deepEqual(frasesDoSaldo({ ganhei: 2000, gastei: 1000, saldo: 1000 }), [
    { rotulo: "Ganhei", valor: "R$ 2.000,00" },
    { rotulo: "Gastei", valor: "R$ 1.000,00" },
    { rotulo: "Saldo", valor: "R$ 1.000,00" },
  ]);

  // Sao TRES, sempre. Mostrar so o saldo seria o numero plausivel que ela nao
  // tem como conferir -- e o que o plano chama de unica defesa real e
  // justamente a aritmetica visivel na tela.
  assert.equal(frasesDoSaldo({ ganhei: 0, gastei: 0, saldo: 0 }).length, 3);
  assert.deepEqual(frasesDoSaldo({ ganhei: 0, gastei: 0, saldo: 0 }), [
    { rotulo: "Ganhei", valor: "R$ 0,00" },
    { rotulo: "Gastei", valor: "R$ 0,00" },
    { rotulo: "Saldo", valor: "R$ 0,00" },
  ]);

  // Centavos sobrevivem -- o saldo de uma compra de 47,80 nao arredonda.
  assert.deepEqual(frasesDoSaldo({ ganhei: 100, gastei: 47.8, saldo: 52.2 }), [
    { rotulo: "Ganhei", valor: "R$ 100,00" },
    { rotulo: "Gastei", valor: "R$ 47,80" },
    { rotulo: "Saldo", valor: "R$ 52,20" },
  ]);
});

test("o saldo NAO e recalculado aqui -- a tela denuncia quem somou errado", () => {
  // A tentacao e devolver `ganhei - gastei` no lugar do `saldo` que chegou: a
  // tela fecharia sempre, e exatamente por isso ela pararia de denunciar F2.
  // Aqui o terceiro numero e o que chegou, errado e visivel.
  const mentiroso = frasesDoSaldo({ ganhei: 2000, gastei: 1000, saldo: 99 });
  assert.equal(mentiroso[2].valor, "R$ 99,00");

  // O sinal cru da tabela esquecido no caminho (`financial_transactions` guarda
  // despesa NEGATIVA) aparece como menos na linha de Gastei, e nao e absorvido
  // por um `Math.abs` caridoso -- e assim que alguem ve que a conta nao fecha.
  const sinalTrocado = frasesDoSaldo({ ganhei: 2000, gastei: -1000, saldo: 1000 });
  assert.equal(sinalTrocado[1].valor, "-R$ 1.000,00");

  // E o saldo no vermelho e resposta legitima: o menos vem ANTES do simbolo.
  const vermelho = frasesDoSaldo({ ganhei: 500, gastei: 1500, saldo: -1000 });
  assert.equal(vermelho[2].valor, "-R$ 1.000,00");
});

test("do Saldo ela anota direto, sem passar pela saudacao", () => {
  const saldo = aoGesto(nova(), { tipo: "saldo" });

  const gastou = aoGesto(saldo, { tipo: "gastei" });
  assert.equal(gastou.estado, "digitando");
  assert.equal(gastou.direcao, "gastei");
  assert.equal(valorNaTela(gastou), "R$ 0,00");

  assert.equal(aoGesto(saldo, { tipo: "ganhei" }).direcao, "ganhei");
  assert.equal(aoGesto(saldo, { tipo: "voltar" }).estado, "saudacao");

  // O teclado esta fechado, entao tecla nao faz nada.
  for (const gesto of [
    { tipo: "digito", digito: "7" },
    { tipo: "apagar" },
    { tipo: "limpar" },
    { tipo: "confirmar" },
    { tipo: "saldo" },
  ]) {
    assert.equal(aoGesto(saldo, gesto), saldo, `${gesto.tipo} nao deveria mexer`);
  }
});

// ---------------------------------------------------------------------------
// A conversa inteira, e o vocabulario dela
// ---------------------------------------------------------------------------

test("os cinco estados existem, sao alcancaveis, e todos tem pergunta e botao", () => {
  assert.deepEqual([...ESTADOS], [
    "saudacao",
    "digitando",
    "confirmando",
    "pronto",
    "saldo",
  ]);

  // Cada estado alcancado por uma fila de gestos a partir do inicio. Uma
  // transicao que sumisse deixaria o estado orfao -- e a contagem de ESTADOS
  // continuaria 5, porque a lista e uma constante.
  const caminhos = {
    saudacao: [],
    digitando: [{ tipo: "gastei" }],
    confirmando: [
      { tipo: "gastei" },
      { tipo: "digito", digito: "1" },
      { tipo: "confirmar" },
    ],
    pronto: [
      { tipo: "gastei" },
      { tipo: "digito", digito: "1" },
      { tipo: "confirmar" },
      { tipo: "confirmar" },
    ],
    saldo: [{ tipo: "saldo" }],
  };

  assert.deepEqual(Object.keys(caminhos).sort(), [...ESTADOS].sort());

  for (const [estado, fila] of Object.entries(caminhos)) {
    const c = andar(nova(), ...fila);
    assert.equal(c.estado, estado, `a fila de ${estado} chegou em ${c.estado}`);
    // Nenhum estado fica sem pergunta nem sem saida: um `switch` com um ramo
    // esquecido devolveria `undefined` aqui, e a tela ficaria muda ou sem botao
    // -- um beco sem saida de onde o unico escape e recarregar a pagina.
    assert.ok(fraseDaPergunta(c), `${estado} ficou sem pergunta`);
    assert.ok(botoes(c).length > 0, `${estado} ficou sem botao`);
  }
});

test("o vocabulario tem OITO gestos -- nenhum deles pergunta categoria, conta ou data", () => {
  // Esta e a forma executavel de "sem seletor de categoria, de conta ou de
  // data: nada disso e pergunta para ela". Os defaults (data de hoje, conta
  // padrao, categoria reservada) o servidor resolve sozinho -- e e por isso que
  // nao ha gesto para eles.
  const oferecidos = new Set();
  for (const fila of [
    [],
    [{ tipo: "gastei" }],
    [{ tipo: "gastei" }, { tipo: "digito", digito: "1" }],
    [{ tipo: "gastei" }, { tipo: "digito", digito: "1" }, { tipo: "confirmar" }],
    [
      { tipo: "gastei" },
      { tipo: "digito", digito: "1" },
      { tipo: "confirmar" },
      { tipo: "confirmar" },
    ],
    [{ tipo: "saldo" }],
  ]) {
    for (const botao of botoes(andar(nova(), ...fila))) oferecidos.add(botao.gesto);
  }

  // Os cinco que viram BOTAO. Os outros tres (digito, apagar, limpar) sao o
  // teclado, e nao botao de conversa -- se um deles aparecesse aqui, a tela
  // teria ganhado um controle que `TECLAS`/`tecladoAberto` ja respondem.
  assert.deepEqual([...oferecidos].sort(), [
    "confirmar",
    "ganhei",
    "gastei",
    "saldo",
    "voltar",
  ]);

  // E nenhum gesto fora dos oito e aceito: um tipo desconhecido devolve a mesma
  // conversa, em todos os cinco estados, em vez de cair num ramo de ninguem.
  for (const estado of [
    nova(),
    aoGesto(nova(), { tipo: "gastei" }),
    aoGesto(nova(), { tipo: "saldo" }),
  ]) {
    for (const tipo of ["categoria", "conta", "data", "parcelar", "grupo", ""]) {
      assert.equal(aoGesto(estado, { tipo }), estado, `${tipo} nao deveria existir`);
      assert.ok(!GESTOS.includes(tipo));
    }
  }
  assert.equal(GESTOS.length, 8);
});

// ---------------------------------------------------------------------------
// Puro: sem React, sem rede, sem relogio
// ---------------------------------------------------------------------------

/**
 * Tira comentarios de linha e de bloco. Nao e um parser -- e o suficiente para
 * o uso aqui, e o caso abaixo tem controle nos DOIS sentidos justamente porque
 * um strip de comentario erra para os dois lados: apagando codigo de verdade
 * (uma `//` dentro de string) ou deixando passar comentario.
 */
function semComentarios(fonte) {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

test("o motor e PURO -- nada de React, de rede e de relogio lido por dentro", () => {
  // Esta e a premissa inteira do arquivo, e sem este caso ela seria so prosa:
  // um `fetch` ou um `new Date()` acrescentado ao motor nao quebra assercao
  // nenhuma acima -- quebra a suite de QUEM TENTAR rodar isto no servidor, ou
  // pior, nao quebra nada e so faz o saldo responder pelo mes errado quando o
  // aparelho esta em outro fuso.
  const cru = readFileSync(join("lib", "conversa-do-papel.ts"), "utf8");
  const codigo = semComentarios(cru);

  // CONTROLE NOS DOIS SENTIDOS, antes da assercao de verdade. Ele e obrigatorio
  // aqui: o COMENTARIO do arquivo fala de React, de `fetch` e de relogio -- e
  // de proposito, porque e onde esta escrito por que eles nao existem. Um
  // strip que nao agisse faria as proibicoes abaixo reprovarem o arquivo certo.
  assert.match(codigo, /export function aoGesto\(/);
  const soEmComentario = "a suite roda em node, sem navegador";
  assert.ok(cru.includes(soEmComentario), "a frase-controle saiu do arquivo");
  assert.ok(!codigo.includes(soEmComentario), "o strip de comentario nao agiu");

  // E o controle do outro lado: a palavra proibida ESTA no texto cru, dentro de
  // comentario. Sem isto, um dos `doesNotMatch` abaixo poderia estar verde por
  // o padrao nunca casar com nada em lugar nenhum.
  assert.match(cru, /fetch/);
  assert.match(cru, /React/);

  for (const [proibido, padrao] of [
    ["react", /from\s+"react/],
    ["fetch", /\bfetch\s*\(/],
    ["new Date", /new\s+Date\s*\(/],
    ["Date.now", /Date\.now\s*\(/],
    ["today()", /\btoday\s*\(/],
    ["supabase", /supabase/i],
    ["process.env", /process\.env/],
  ]) {
    assert.doesNotMatch(codigo, padrao, `o motor nao pode usar ${proibido}`);
  }

  // O QUE ELE PODE IMPORTAR: so lib pura. A lista e fechada de proposito -- o
  // primeiro import de componente, de rota ou de cliente de banco aqui reprova,
  // e e nesse import que a pureza morre primeiro.
  const importados = [...codigo.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(importados.sort(), [
    "@/lib/dinheiro",
    "@/lib/periodo-do-painel",
    "@/lib/saldo-da-conversa",
  ]);
});
