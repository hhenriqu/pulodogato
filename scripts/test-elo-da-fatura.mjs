#!/usr/bin/env node
// =====================================================
// O ELO EXPLICITO DA FATURA -- HMO-305
// =====================================================
//   npm run test:elo-da-fatura
//
// A mesma divida em dois lugares: a pessoa anota "Pagar fatura Nubank" na conta
// corrente, o app sintetiza a fatura aberta das compras reais do cartao, e o mes
// soma R$ 1.600,00 de uma divida de R$ 800,00. O conserto aprovado nao adivinha
// nada: ele ROTULA a suspeita e da a acao -- e a de-duplicacao acontece pelo
// mecanismo que ja existe (`chavesPersistidas` em `sintetizarFaturasAbertas`),
// pela chave canonica gravada em `notes`.
//
// O QUE ESTA SUITE MEDE, E O QUE ELA DELIBERADAMENTE NAO MEDE
// -----------------------------------------------------------
// Aqui esta a DETECCAO e as FRASES, que sao funcoes puras. O efeito em DINHEIRO
// -- as duas telas passando de R$ 1.600,00 para R$ 800,00 -- esta em
// `node scripts/medicao-hmo298.mjs`, com Postgres, migrations reais e RLS
// ligada, porque so la o numero e o numero. E a fiacao da TELA (o rotulo, o
// cartao de confirmacao, o POST, o desfazer) esta no caso J de
// `npm run test:papel-na-tela`, que roda os componentes de producao num
// Chromium.
//
// AS SEIS MANEIRAS DE ERRAR AQUI, E A DIRECAO DE CADA UMA
// -------------------------------------------------------
// A assimetria e o que organiza esta suite: o rotulo que NAO acende deixa o mes
// como esta hoje (R$ 1.600,00, com as duas linhas a vista, conferivel). O rotulo
// que acende na linha ERRADA poe na tela um botao que, clicado, esconde uma
// divida verdadeira. Por isso cinco dos casos abaixo cobram a AUSENCIA do
// rotulo:
//
//   1. rotular a linha que ja tem o elo -- o rotulo nunca sairia da tela;
//   2. rotular pelo nome do cartao por SUBSTRING ("Nu" dentro de "Numerario");
//   3. rotular com DUAS faturas candidatas -- escolher no lugar da pessoa
//      justamente no caso em que so ela sabe;
//   4. rotular conta de GRUPO, cujo valor ja e uma fracao rateada;
//   5. rotular RECEITA;
//   6. e a sexta, que e de escrita e nao de rotulo: gravar em `notes` qualquer
//      coisa que nao seja a chave canonica EXATA. `RE_CHAVE_FATURA` e ancorada
//      nas duas pontas, entao um sufixo inocente (" (confirmado)") faz a
//      de-duplicacao parar de acontecer em silencio -- a tela diz "pronto" e o
//      mes continua somando a divida duas vezes.
//
// E O QUE ESTA SUITE *COBRAVA* SEM MEDIR -- HMO-307
// --------------------------------------------------
// `npm run mutantes:elo-da-fatura` troca uma linha de `lib/elo-da-fatura.ts` por
// vez e exige que esta suite reprove. Dos doze mutantes, DOIS sobreviveram na
// primeira medicao, e os dois eram furo de verdade:
//
//   * `citacao_por_substring` -- o caso "Nu" dentro de "Numerario" e barrado pela
//     guarda do NOME CURTO, nao pela comparacao por palavra inteira. O caso novo
//     e "Inter" dentro de "Internet" (ver o caso 2);
//   * `fatura_fechada_vira_candidata` -- o `!gravada` do laco das faturas abertas
//     estava documentado como load-bearing e nao tinha medicao nenhuma.
//
// Os dois viraram CASO NOVO aqui, nao mutante removido da lista.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPILADO = join(RAIZ, ".tmp-elo-da-fatura");

const {
  ROTULO_DE_SUSPEITA,
  ROTULO_DE_LIGAR,
  ROTULO_DE_DESLIGAR,
  NOTES_SEM_ELO,
  avisoDaAnotacao,
  descricaoCitaOCartao,
  efeitoDoDesfazer,
  efeitoDoElo,
  eloDesfazivel,
  notesDoElo,
  perguntaDoElo,
  suspeitasDeFaturaRepetida,
} = await import(join(COMPILADO, "elo-da-fatura.js"));

const { RE_CHAVE_FATURA, chaveFatura, faturaDaChave } = await import(
  join(COMPILADO, "chave-da-fatura.js")
);

// ---------------------------------------------------------------------------
// O CENARIO, que e o do fixture da HMO-298
// ---------------------------------------------------------------------------
// Marco de 2026: compras reais de R$ 800,00 no Nubank viram a fatura aberta que
// vence dia 10, e a pessoa anotou "Pagar fatura Nubank" na conta corrente, para
// o mesmo dia 10. O `invoice_month` da fatura e 2026-03-01.
const CARTAO = "11111111-2222-3333-4444-555555555555";
const OUTRO_CARTAO = "99999999-8888-7777-6666-555555555555";

/** A fatura ABERTA sintetizada: sem `id`, com a chave canonica em `notes`. */
const faturaAberta = (extra = {}) => ({
  id: null,
  description: "Fatura Nubank 03/2026",
  notes: chaveFatura("2026-03-01", CARTAO),
  account_name: "Nubank",
  due_date: "2026-03-10",
  direction: "expense",
  ...extra,
});

/** A previsao digitada a mao, na CONTA CORRENTE. */
const previsaoDigitada = (extra = {}) => ({
  id: "da-previsao",
  description: "Pagar fatura Nubank",
  notes: "anotei pra nao esquecer",
  due_date: "2026-03-10",
  direction: "expense",
  group_id: null,
  ...extra,
});

// ===========================================================================
// A DETECCAO -- o caso de uso
// ===========================================================================

test("o caso da issue: a previsao que cita o cartao vira suspeita, e aponta a fatura", () => {
  const suspeitas = suspeitasDeFaturaRepetida([
    previsaoDigitada(),
    faturaAberta(),
  ]);

  assert.equal(suspeitas.size, 1);

  const suspeita = suspeitas.get("da-previsao");
  assert.ok(suspeita, "a previsao digitada tem de ser a suspeita");

  // O MES E O DA FATURA (`invoice_month`), E NAO O DO VENCIMENTO DA PREVISAO.
  // Os dois coincidem neste cenario; o caso abaixo os separa de proposito.
  assert.equal(suspeita.mes, "2026-03-01");
  assert.equal(suspeita.accountId, CARTAO);
  assert.equal(suspeita.nomeDoCartao, "Nubank");

  // E o aviso da anotacao viaja com ela, com o texto da pessoa dentro.
  assert.match(suspeita.aviso, /anotei pra nao esquecer/);
});

test("o mes gravado e o da FATURA, mesmo quando ela vence no mes seguinte", () => {
  // Cartao que fecha dia 28 e vence dia 5: a fatura de marco vence em ABRIL. A
  // pessoa anota o pagamento para abril, que e quando o dinheiro sai.
  //
  // Este caso e o que separa duas implementacoes que passam identicas no cenario
  // comum: gravar `mesDaData(due_date)` daria a chave `fatura:2026-04-01:...`,
  // que NENHUMA fatura casa -- o elo seria gravado, a de-duplicacao nao
  // aconteceria, e a tela teria dito "pronto".
  const suspeitas = suspeitasDeFaturaRepetida([
    previsaoDigitada({ due_date: "2026-04-05" }),
    faturaAberta({ due_date: "2026-04-05" }),
  ]);

  assert.equal(suspeitas.get("da-previsao").mes, "2026-03-01");
});

test("sem fatura aberta no mes nao ha suspeita nenhuma", () => {
  // O caso comum de quase todo mes de quase toda pessoa: a lista nao tem fatura
  // sintetizada. Nenhum rotulo, e nenhum laco gasto.
  const suspeitas = suspeitasDeFaturaRepetida([previsaoDigitada()]);
  assert.equal(suspeitas.size, 0);
});

test("a fatura de OUTRO mes nao casa -- a comparacao e por mes do vencimento", () => {
  const suspeitas = suspeitasDeFaturaRepetida([
    previsaoDigitada({ due_date: "2026-04-10" }),
    faturaAberta(),
  ]);
  assert.equal(suspeitas.size, 0);
});

// ===========================================================================
// AS CINCO AUSENCIAS -- cada uma fecha uma porta por onde o rotulo esconderia
// dinheiro
// ===========================================================================

test("1. a linha que JA tem o elo nao e mais suspeita -- e e assim que o rotulo some", () => {
  // A propriedade que a issue pede ("o rotulo da irma some quando o elo
  // existe"), e ela sai de graca: a linha com a chave JA e uma fatura para o
  // resto do app.
  const ligada = previsaoDigitada({ notes: chaveFatura("2026-03-01", CARTAO) });

  const suspeitas = suspeitasDeFaturaRepetida([ligada, faturaAberta()]);
  assert.equal(suspeitas.size, 0);
});

test("2. o nome do cartao casa por PALAVRA INTEIRA, nunca por substring", () => {
  // "Nu" dentro de "Numerario" e o caso caro: o rotulo apontaria a fatura errada,
  // e um clique de confirmacao esconderia uma divida real.
  assert.equal(descricaoCitaOCartao("Numerario da viagem", "Nu"), false);
  assert.equal(descricaoCitaOCartao("Pagar fatura Nubank", "Nubank"), true);

  // E O CASO QUE MEDE A PALAVRA INTEIRA DE VERDADE -- HMO-307.
  //
  // As duas assercoes acima NAO medem o criterio que elas nomeiam: "Nu" tem duas
  // letras, e quem o barra e a guarda do NOME CURTO (`p.length >= 3`) logo
  // acima, nao a comparacao por palavra inteira. Trocar `palavras` + `every` por
  // `includes` deixava as duas VERDES -- foi o mutante `citacao_por_substring`,
  // sobrevivente medido em `npm run mutantes:elo-da-fatura`.
  //
  // Medir exige um nome de cartao com tres letras ou mais que seja PREFIXO de
  // outra palavra, e as duas contas existem na vida real e vencem no mesmo mes:
  // o cartao do Banco Inter e a conta de Internet. Com substring, a conta de
  // internet ganharia o botao que esconde a fatura do cartao -- e a pessoa
  // fecharia o mes achando ter um dinheiro que nao tem.
  assert.equal(descricaoCitaOCartao("Internet de março", "Inter"), false);
  assert.equal(descricaoCitaOCartao("Pagar fatura Inter", "Inter"), true);

  // Caixa e acento nao importam; pontuacao tampouco.
  assert.equal(descricaoCitaOCartao("pagar NUBANK.", "Nubank"), true);
  assert.equal(descricaoCitaOCartao("Fatura do Itaú", "itau"), true);

  // Nome com DUAS palavras exige as duas: metade do nome nao identifica o
  // cartao.
  assert.equal(
    descricaoCitaOCartao("Pagar o Nubank", "Nubank Ultravioleta"),
    false
  );
  assert.equal(
    descricaoCitaOCartao("Pagar o Nubank Ultravioleta", "Nubank Ultravioleta"),
    true
  );

  // Nome que nao identifica nada nao vale como citacao -- senao um cartao
  // chamado "C" casaria com qualquer descricao que tivesse a letra solta.
  assert.equal(descricaoCitaOCartao("C de casa", "C"), false);

  // E leitura incompleta nao vira afirmacao: sem nome, nada casa.
  assert.equal(descricaoCitaOCartao("Pagar fatura Nubank", null), false);
  assert.equal(descricaoCitaOCartao("Pagar fatura Nubank", "   "), false);
});

test("3. DUAS faturas candidatas nao viram rotulo -- a escolha e da pessoa", () => {
  // A descricao cita os dois nomes, e as duas faturas vencem no mesmo mes.
  // Escolher uma aqui seria escolher no lugar de quem e a unica que sabe, e o
  // clique seguinte esconde dinheiro.
  const suspeitas = suspeitasDeFaturaRepetida([
    previsaoDigitada({ description: "Pagar Nubank e Itau" }),
    faturaAberta(),
    faturaAberta({
      notes: chaveFatura("2026-03-01", OUTRO_CARTAO),
      account_name: "Itau",
      description: "Fatura Itau 03/2026",
    }),
  ]);

  assert.equal(suspeitas.size, 0);

  // E O CONTROLE DESTE CASO: com a descricao citando SO UM dos dois, a suspeita
  // volta -- e aponta o cartao citado. Sem ele, "duas faturas nao rotulam"
  // ficaria verde com a deteccao inteiramente desligada.
  const umSo = suspeitasDeFaturaRepetida([
    previsaoDigitada({ description: "Pagar o Itau" }),
    faturaAberta(),
    faturaAberta({
      notes: chaveFatura("2026-03-01", OUTRO_CARTAO),
      account_name: "Itau",
    }),
  ]);
  assert.equal(umSo.get("da-previsao").accountId, OUTRO_CARTAO);
});

test("4. conta de GRUPO nao e a fatura do meu cartao", () => {
  // O valor dela na tela ja e a MINHA fracao do rateio. Chamar aquilo de fatura
  // seria o rotulo errado sobre o numero errado.
  const suspeitas = suspeitasDeFaturaRepetida([
    previsaoDigitada({ group_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }),
    faturaAberta(),
  ]);
  assert.equal(suspeitas.size, 0);
});

test("5. RECEITA nao e fatura -- nem quando cita o nome do cartao", () => {
  const suspeitas = suspeitasDeFaturaRepetida([
    previsaoDigitada({
      description: "Estorno do Nubank",
      direction: "income",
    }),
    faturaAberta(),
  ]);
  assert.equal(suspeitas.size, 0);

  // `direction` AUSENTE nao bloqueia: a view do 027 termina em 'expense', e uma
  // leitura que nao traga a coluna nao pode apagar a feature.
  const semDirecao = suspeitasDeFaturaRepetida([
    previsaoDigitada({ direction: undefined }),
    faturaAberta(),
  ]);
  assert.equal(semDirecao.size, 1);
});

test("a fatura FECHADA nao e alvo do elo -- o `!gravada` do laco e load-bearing", () => {
  // HMO-307: a propriedade esta explicada em `suspeitasDeFaturaRepetida` como
  // LOAD-BEARING, e nada a media -- foi o mutante `fatura_fechada_vira_candidata`
  // (tirar o `if (gravada) continue;` do laco das faturas abertas), sobrevivente
  // em `npm run mutantes:elo-da-fatura`.
  //
  // O cenario: a fatura de marco JA FOI FECHADA pelo
  // `POST /api/card-invoices/close`, que criou uma conta a pagar GRAVADA com a
  // chave canonica e `account_id` = o proprio cartao. Nao ha fatura sintetizada
  // nenhuma na lista -- ela deixou de ser aberta. E a pessoa tambem anotou
  // "Pagar fatura Nubank" na conta corrente, para o mesmo dia.
  //
  // Ligar a previsao digitada aquela chave criaria DUAS linhas com a MESMA chave
  // e nao ha fatura sintetizada para suprimir: o mes continuaria dobrado, com a
  // tela dizendo "pronto". Quem recusa gravar e a rota; aqui o rotulo nem acende.
  const faturaFechada = {
    id: "da-fatura-fechada",
    description: "Fatura Nubank 03/2026",
    notes: chaveFatura("2026-03-01", CARTAO),
    account_name: "Nubank",
    due_date: "2026-03-10",
    direction: "expense",
    group_id: null,
  };

  const suspeitas = suspeitasDeFaturaRepetida([
    previsaoDigitada(),
    faturaFechada,
  ]);
  assert.equal(suspeitas.size, 0);

  // E O CONTROLE DO CASO: a MESMA previsao, com a fatura ABERTA no lugar da
  // fechada, VIRA suspeita. Sem ele, "a fechada nao e alvo" ficaria verde com a
  // deteccao inteiramente desligada -- e e exatamente a diferenca entre as duas
  // linhas (o `id`) que esta sendo medida.
  const comAAberta = suspeitasDeFaturaRepetida([
    previsaoDigitada(),
    faturaAberta(),
  ]);
  assert.equal(comAAberta.size, 1);
});

test("a FATURA sintetizada nao e suspeita de ser ela mesma", () => {
  // Ela nao tem `id`, entao nao haveria o que atualizar -- e a acao na tela
  // apontaria para um `PATCH` sem alvo.
  const suspeitas = suspeitasDeFaturaRepetida([faturaAberta(), faturaAberta()]);
  assert.equal(suspeitas.size, 0);
});

test("linha sem data nao ganha rotulo, e nao casa com a fatura por engano", () => {
  // `mesDaData(null)` e "", e "" nao e o mes de fatura nenhuma. O caso existe
  // porque `due_date` e opcional em `PrevistaCrua`, e dois vazios que se
  // igualassem rotulariam a linha errada.
  const suspeitas = suspeitasDeFaturaRepetida([
    previsaoDigitada({ due_date: null }),
    faturaAberta(),
  ]);
  assert.equal(suspeitas.size, 0);
});

// ===========================================================================
// 6. A ESCRITA -- a chave tem de ser EXATA
// ===========================================================================

test("6. `notesDoElo` produz a chave canonica, e nada alem dela", () => {
  const chave = notesDoElo("2026-03-01", CARTAO);

  // A MESMA string que o `POST /api/card-invoices/close` grava. Esta igualdade
  // e a entrega inteira: e por ela que `chavesPersistidas` de-duplica, sem uma
  // segunda implementacao da de-duplicacao em lugar nenhum.
  assert.equal(chave, chaveFatura("2026-03-01", CARTAO));

  // E ela passa pela regex ANCORADA. Um sufixo inocente aqui faria a
  // de-duplicacao parar de acontecer em silencio.
  assert.match(chave, RE_CHAVE_FATURA);
  assert.deepEqual(faturaDaChave(chave), {
    mes: "2026-03-01",
    accountId: CARTAO,
  });

  // O controle negativo do proprio caso: com qualquer coisa a mais, a chave
  // deixa de ser chave -- e e por isso que `notesDoElo` existe em vez de uma
  // concatenacao escrita na rota.
  assert.equal(faturaDaChave(`${chave} (confirmado)`), null);
});

test("desfazer grava NULL, e nao string vazia", () => {
  // `faturaDaChave` responde `null` para os dois, mas `notes: ""` e um texto que
  // a pessoa nunca escreveu, e aparece na tela de edicao como campo preenchido
  // com nada.
  assert.equal(NOTES_SEM_ELO, null);
});

// ===========================================================================
// O DESFAZER -- e a linha que NAO se desfaz por aqui
// ===========================================================================

test("a previsao que a pessoa ligou e desfazivel", () => {
  const elo = eloDesfazivel(
    chaveFatura("2026-03-01", CARTAO),
    "conta-corrente",
    true
  );
  assert.deepEqual(elo, { mes: "2026-03-01", accountId: CARTAO });
});

test("a FATURA FECHADA nao se desfaz aqui -- a chave dela e a idempotencia do fechamento", () => {
  // O `close` grava `account_id` = o PROPRIO cartao, de proposito. Apagar a
  // chave dessa linha faria um segundo clique em "fechar fatura" criar uma
  // SEGUNDA conta a pagar do mesmo mes.
  const elo = eloDesfazivel(chaveFatura("2026-03-01", CARTAO), CARTAO, true);
  assert.equal(elo, null);
});

test("sem a conta da linha nao se oferece o desfazer", () => {
  // Sem `account_id` nao da para distinguir a previsao ligada da fatura fechada,
  // e a resposta segura e nao oferecer o botao: oferecer e deixar a rota recusar
  // poria na tela um botao que falha.
  assert.equal(eloDesfazivel(chaveFatura("2026-03-01", CARTAO), null, true), null);
  assert.equal(
    eloDesfazivel(chaveFatura("2026-03-01", CARTAO), undefined, true),
    null
  );
});

test("a fatura ABERTA sintetizada nao e desfazivel -- ela nao esta no banco", () => {
  assert.equal(
    eloDesfazivel(chaveFatura("2026-03-01", CARTAO), "conta-corrente", false),
    null
  );
});

test("linha sem chave nenhuma nao tem elo a desfazer", () => {
  assert.equal(eloDesfazivel("anotei pra nao esquecer", "conta-corrente", true), null);
  assert.equal(eloDesfazivel(null, "conta-corrente", true), null);
});

// ===========================================================================
// AS FRASES -- elas sao a unica coisa que a pessoa le antes de mexer no numero
// ===========================================================================

test("a pergunta diz QUAL fatura, com o cartao e o mes", () => {
  assert.equal(
    perguntaDoElo("Nubank", "março de 2026"),
    "Esta previsão é a fatura Nubank de março de 2026?"
  );

  // Mes ilegivel cai na frase SEM mes, e nao em "a fatura de undefined".
  assert.equal(perguntaDoElo("Nubank", null), "Esta previsão é a fatura Nubank?");

  // Sem nome do cartao a frase usa o substantivo -- a mesma escolha de
  // `descricaoDaFatura` em lib/agenda-do-cartao.ts.
  assert.match(perguntaDoElo(null, "março de 2026"), /a fatura do cartão de março/);
});

test("o efeito diz o numero E diz que a divida continua na lista", () => {
  const frase = efeitoDoElo("R$ 800,00");

  assert.match(frase, /R\$ 800,00/);
  // A segunda metade nao e enfeite: sem ela o cartao esta dizendo a uma pessoa
  // que o app vai apagar R$ 800 que ela deve.
  assert.match(frase, /continua na lista/);

  // Sem o valor, a frase sai sem numero -- nunca com um numero inventado.
  const semValor = efeitoDoElo(null);
  assert.ok(!/R\$/.test(semValor), `a frase sem valor citou dinheiro: ${semValor}`);
  assert.match(semValor, /continua na lista/);
});

test("o desfazer avisa que o numero SOBE, que e a direcao oposta", () => {
  const frase = efeitoDoDesfazer("R$ 800,00");
  assert.match(frase, /R\$ 800,00/);
  assert.match(frase, /sobe/);
  assert.match(frase, /dois lugares/);

  assert.ok(!/R\$/.test(efeitoDoDesfazer(null)));
});

test("o aviso da anotacao SO aparece quando ha anotacao para perder", () => {
  // Esta e a unica parte irreversivel do clique, e por isso ela e dita antes.
  assert.match(avisoDaAnotacao("conferi no app"), /«conferi no app»/);
  assert.match(avisoDaAnotacao("conferi no app"), /não a traz de volta/);

  // Nada a perder, nada a dizer: um aviso que aparece sempre e um aviso que
  // ninguem le.
  assert.equal(avisoDaAnotacao(null), null);
  assert.equal(avisoDaAnotacao(""), null);
  assert.equal(avisoDaAnotacao("   "), null);

  // E a linha que ja tem a chave tambem nao avisa: nao ha texto de pessoa ali.
  assert.equal(avisoDaAnotacao(chaveFatura("2026-03-01", CARTAO)), null);
});

test("os rotulos existem e sao diferentes entre si", () => {
  // Tres textos curtos, tres papeis: o rotulo da suspeita, o verbo de ligar e o
  // verbo de desfazer. Dois iguais fariam a tela oferecer a mesma palavra para
  // acoes opostas -- e uma delas esconde dinheiro.
  const todos = [ROTULO_DE_SUSPEITA, ROTULO_DE_LIGAR, ROTULO_DE_DESLIGAR];
  for (const r of todos) assert.ok(r.trim().length > 0);
  assert.equal(new Set(todos).size, 3);

  // O de desfazer tem de dizer que desfaz: e a unica coisa na tela que informa
  // que existe caminho de volta.
  assert.match(ROTULO_DE_DESLIGAR, /desfazer/i);
});
