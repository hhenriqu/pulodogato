// O contrato entre a aba de Despesas do grupo e o recorte de mes (HMO-248).
//
// POR QUE ESTE TESTE E DE TEXTO, E NAO DE COMPORTAMENTO
// -----------------------------------------------------
// Mesmo desenho do test-contrato-do-fechamento.mjs. A aritmetica do recorte
// esta em lib/periodo-do-grupo.ts, coberta por 14 blocos e 14 mutantes
// (`npm run mutantes:periodo-do-grupo`). O que falta provar e que a TELA usa
// esse recorte -- e isso o tsc nao prova: a soma antiga
// (`scheduled.reduce(...)` sobre a lista inteira) compila perfeitamente, e o
// defeito que ela produz e um total plausivel de R$ 5.400 num cartao que nao
// diz de qual mes fala.
//
// A tela e um componente de 2.100 linhas com `useEffect`, `fetch` e Supabase:
// montar isso num harness custaria mais do que mede. O que se mede aqui e o
// unico par de fatos que separa a tela consertada da tela com o defeito:
// 1. a soma sobre a lista INTEIRA nao existe mais em lugar nenhum;
// 2. o seletor do fechamento e o MESMO estado que recorta as listas.
//
// COMENTARIO E CODIGO SAO SEPARADOS ANTES DE QUALQUER ASSERCAO
// ------------------------------------------------------------
// Os arquivos deste recorte sao muito comentados, e os comentarios CITAM o
// codigo antigo de proposito (o `scheduled.reduce` aparece escrito na prosa que
// explica o bug). Uma assercao que nao tire os comentarios passaria verde
// casando com a explicacao em vez da linha que executa -- e, pior, a assercao
// NEGATIVA passaria a falhar por causa da propria documentacao.
// Ver [[assercao-sobre-codigo-fonte-le-o-comentario]].
//
//   npm run test:contrato-do-periodo-do-grupo

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const TELA = "app/(dashboard)/dashboard/expense-groups/[groupId]/page.tsx";
const CARTAO = "components/grupos/FechamentoDoMes.tsx";
const LIB = "lib/periodo-do-grupo.ts";

/** Tira comentario de bloco, de linha e de JSX -- ver o cabecalho. */
function semComentarios(fonte) {
  return fonte
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const telaCrua = readFileSync(TELA, "utf8");
const tela = semComentarios(telaCrua);
const cartao = semComentarios(readFileSync(CARTAO, "utf8"));
const lib = semComentarios(readFileSync(LIB, "utf8"));

test("controle: a separacao de comentario e codigo funcionou", () => {
  // Sem este bloco as assercoes NEGATIVAS abaixo poderiam passar por um
  // `semComentarios` que apagou o arquivo inteiro.
  assert.ok(tela.length > 20000, `sobrou pouco codigo da tela: ${tela.length}`);
  assert.ok(
    telaCrua.length > tela.length,
    "nenhum comentario foi removido -- a limpeza nao esta funcionando"
  );
  // E o controle do outro lado: a prosa que CITA o codigo antigo existe no
  // arquivo cru, e e exatamente o que a limpeza tem de ter tirado.
  assert.match(
    telaCrua,
    /R\$ 5\.400/,
    "o comentario que explica o bug saiu da tela -- se ele saiu de proposito, " +
      "ajuste este controle; ele existe para provar que a limpeza age sobre " +
      "texto que de fato cita o codigo"
  );
});

test("a tela nao soma mais a lista INTEIRA de previstas", () => {
  // O defeito da issue, em uma linha: `scheduled.reduce((sum, s) => sum + ...)`
  // soma toda parcela materializada da despesa fixa -- o aluguel de outubro,
  // de novembro e de dezembro no mesmo total.
  assert.doesNotMatch(
    tela,
    /scheduled\.reduce\s*\(/,
    "a tela voltou a somar a lista inteira de previstas, sem recorte de mes"
  );
  assert.doesNotMatch(
    tela,
    /scheduled\.map\s*\(/,
    "a tela voltou a LISTAR a lista inteira de previstas, sem recorte de mes"
  );
  // `scheduled` continua sendo o estado que a rota alimenta: o que mudou e que
  // nada o consome cru. Sem esta assercao as duas de cima passariam verde numa
  // tela que simplesmente deixou de buscar as previstas.
  assert.match(
    tela,
    /setScheduled\(/,
    "a tela parou de carregar as previstas do grupo"
  );
});

test("a tela nao recorta mais o mes por getMonth()", () => {
  // `new Date("2026-10-01").getMonth()` em America/Sao_Paulo e SETEMBRO: a
  // despesa do dia 1 caia no mes anterior em todo fuso negativo, e o CI em UTC
  // nao via. `transactionGroups` era o nome do recorte que fazia isso.
  assert.doesNotMatch(
    tela,
    /transactionGroups/,
    "o recorte por Date voltou para a tela"
  );
  assert.doesNotMatch(
    tela,
    /getMonth\(\)/,
    "a tela voltou a comparar mes por getMonth(), que depende do fuso"
  );
});

test("a tela recorta as duas listas pelo mes do seletor", () => {
  for (const chamada of [
    /recortarPrevistas\(\s*scheduled\s*,\s*mesDoGrupo\s*\)/,
    /recortarRealizado\(\s*transactions\s*,\s*mesDoGrupo\s*\)/,
  ]) {
    assert.match(
      tela,
      chamada,
      `a tela nao chama ${chamada} -- a lista correspondente ficou sem recorte`
    );
  }
  // As duas funcoes existem com esse nome na lib. Sem isto, as assercoes de
  // cima casariam com uma chamada para uma funcao que ninguem escreveu.
  assert.match(lib, /export function recortarPrevistas/);
  assert.match(lib, /export function recortarRealizado/);
});

test("o seletor do fechamento e o MESMO estado que recorta as listas", () => {
  // Esta e a assercao que impede o pior resultado possivel desta issue: um
  // fechamento de novembro em cima de uma lista de outubro, as duas corretas
  // em separado e a tela inteira mentindo.
  assert.match(
    tela,
    /<FechamentoDoMes[\s\S]{0,200}?mes=\{mesDoGrupo\}/,
    "a tela nao passa `mesDoGrupo` para o cartao de fechamento"
  );
  assert.match(
    tela,
    /<FechamentoDoMes[\s\S]{0,200}?onMesChange=\{setMesDoGrupo\}/,
    "a tela nao recebe de volta a troca de mes do cartao de fechamento"
  );

  // E o cartao tem de aceitar as duas props E usar a de escrita no Select --
  // uma prop declarada e ignorada deixa o seletor mexendo so no estado interno,
  // e as listas abaixo congeladas no mes de hoje, sem erro nenhum.
  assert.match(cartao, /mes:\s*mesControlado/, "o cartao nao aceita `mes`");
  assert.match(cartao, /onMesChange\?:/, "o cartao nao aceita `onMesChange`");
  assert.match(
    cartao,
    /const trocarMes = onMesChange \?\? setMesLocal;/,
    "o cartao nao da preferencia ao `onMesChange` de quem o controla"
  );
  assert.match(
    cartao,
    /onValueChange=\{trocarMes\}/,
    "o Select do cartao nao chama `trocarMes` -- a troca de mes nao sobe"
  );
});

test("o que o recorte deixou de fora e dito em texto na tela", () => {
  // Recortar no mes escondia a parcela VENCIDA de um mes passado. Sumir sem
  // rotulo e indistinguivel de "nao existe", e quem acabou de cadastrar a
  // despesa fixa concluiria que ela nao foi gravada.
  for (const leitura of [
    /previstasDoMes\.antes\.quantidade/,
    /previstasDoMes\.depois\.quantidade/,
    /previstasDoMes\.antes\.total/,
    /previstasDoMes\.depois\.total/,
  ]) {
    assert.match(
      tela,
      leitura,
      `a tela nao mostra ${leitura}: o que saiu do mes sai sem contagem nenhuma`
    );
  }
  // E a lib tem de produzir os dois lados. `ForaDoMes` com um campo renomeado
  // chegaria `undefined` e a tela esconderia a linha em silencio.
  assert.match(lib, /interface ForaDoMes \{[\s\S]*?quantidade: number;/);
  assert.match(lib, /antes: ForaDoMes;/);
  assert.match(lib, /depois: ForaDoMes;/);
});

test("o titulo dos dois cartoes diz DE QUAL MES a lista fala", () => {
  // "Previstas" e "Mes Atual" eram titulos fixos. Com o seletor mandando, um
  // titulo fixo mente sobre a lista em todo mes que nao e o de hoje -- e e o
  // titulo que a pessoa le para saber o que esta vendo.
  assert.match(
    tela,
    /Previstas de \{rotuloDoMesDoGrupo\}/,
    "o cartao de previstas nao diz de qual mes fala"
  );
  assert.match(
    tela,
    /Despesas de \{rotuloDoMesDoGrupo\}/,
    "o cartao de realizadas nao diz de qual mes fala"
  );
  assert.doesNotMatch(
    tela,
    /Mês Atual/,
    "o titulo fixo 'Mes Atual' voltou, sobre uma lista que segue o seletor"
  );
});
