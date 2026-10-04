// O contrato entre o cartao de fechamento e a rota dele (HMO-245).
//
// POR QUE ESTE TESTE E DE TEXTO, E NAO DE COMPORTAMENTO
// -----------------------------------------------------
// Mesmo desenho do test-painel-do-grupo.mjs, e pela mesma razao: `await
// res.json()` e `any`, entao atribuir a resposta da rota a interface do
// componente NAO e checado pelo tsc. Um campo renomeado em um dos dois lados
// chega `undefined`, o `??`/`?.` do componente o transforma em ZERO ou em
// branco, e a tela mostra "Total do mes R$ 0,00" sobre um mes com conta.
//
// Aqui isso e dinheiro em cima de dinheiro: `total`, `devido` e `amount` sao os
// numeros que a pessoa vai usar para fazer o Pix. O calculo esta coberto por
// test-fechamento-do-grupo.mjs e por 15 mutantes; o que ESTE teste tranca e o
// nome dos campos no caminho entre os dois arquivos.
//
// COMENTARIO E CODIGO SAO SEPARADOS ANTES DE QUALQUER ASSERCAO
// ------------------------------------------------------------
// Os tres arquivos deste recorte sao muito comentados, e os comentarios citam
// os nomes dos campos. Uma assercao textual que nao tire os comentarios passa
// verde casando com a PROSA que descreve o campo em vez da linha que o produz
// -- um verde que sobrevive a remocao do campo.
//
//   npm run test:contrato-do-fechamento

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const COMPONENTE = "components/grupos/FechamentoDoMes.tsx";
const ROTA = "app/api/expense-groups/[groupId]/fechamento/route.ts";
const LIB = "lib/fechamento-do-grupo.ts";

/** Tira comentario de bloco e de linha -- ver o cabecalho. */
function semComentarios(fonte) {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const componente = semComentarios(readFileSync(COMPONENTE, "utf8"));
const rota = semComentarios(readFileSync(ROTA, "utf8"));
const lib = semComentarios(readFileSync(LIB, "utf8"));

/** Os campos declarados numa `interface X { ... }`. */
function camposDaInterface(fonte, nome, arquivo) {
  const bloco = fonte.match(
    new RegExp(`interface ${nome} \\{([\\s\\S]*?)\\n\\}`)
  );
  assert.ok(
    bloco,
    `Nao achei a interface ${nome} em ${arquivo}. Se ela foi renomeada, ` +
      `atualize este teste -- nao o apague: ele e o unico lugar que liga a ` +
      `rota ao componente, porque o tsc nao liga.`
  );
  return bloco[1]
    .split("\n")
    .map((l) => l.trim())
    .map((l) => l.match(/^([a-z_][a-z0-9_]*)\??:/i))
    .filter(Boolean)
    .map((m) => m[1]);
}

/** As chaves do `NextResponse.json({ ... })` da rota, com o spread expandido. */
function camposQueARotaDevolve() {
  const bloco = rota.match(/return NextResponse\.json\(\{([\s\S]*?)\n\s*\}\);/);
  assert.ok(bloco, `Nao achei o NextResponse.json de sucesso em ${ROTA}.`);
  const corpo = bloco[1];

  const chaves = corpo
    .split("\n")
    .map((l) => l.trim())
    .map((l) => l.match(/^([a-z_][a-z0-9_]*)\s*[:,]/i))
    .filter(Boolean)
    .map((m) => m[1]);

  // `...fechamento` traz, campo por campo, o que `fecharMes` devolve. Sem
  // expandir isso o teste nao enxergaria `total` nem `por_membro` -- os campos
  // que mais importam -- e passaria verde sem medir nada deles.
  if (/\.\.\.fechamento/.test(corpo)) {
    chaves.push(...camposDaInterface(lib, "FechamentoDoMes", LIB));
  }

  return chaves;
}

test("a rota devolve todo campo que o cartao de fechamento le", () => {
  const lidos = camposDaInterface(
    componente,
    "RespostaDoFechamento",
    COMPONENTE
  );
  const devolvidos = camposQueARotaDevolve();

  // Controle da propria extracao: se um dos lados vier vazio, o `every` abaixo
  // passa por vacuidade e o teste nao mede nada.
  assert.ok(lidos.length >= 10, `extrai poucos campos do componente: ${lidos}`);
  assert.ok(
    devolvidos.length >= 10,
    `extrai poucos campos da rota: ${devolvidos}`
  );
  assert.ok(
    devolvidos.includes("total") && devolvidos.includes("por_membro"),
    "o spread de ...fechamento nao foi expandido: " + devolvidos.join(", ")
  );

  const faltando = lidos.filter((c) => !devolvidos.includes(c));
  assert.deepEqual(
    faltando,
    [],
    `O cartao le ${faltando.join(", ")}, e a rota nao devolve. ` +
      `Chega undefined e a tela mostra zero sobre um mes com conta.`
  );
});

test("os campos de dinheiro do membro batem entre a lib e o cartao", () => {
  // `pago`, `devido` e `saldo` sao os tres numeros do rateio. O componente os
  // le de `por_membro`, que vem de `PosicaoNoMes` na lib.
  const naLib = camposDaInterface(lib, "PosicaoNoMes", LIB);
  const noCartao = camposDaInterface(componente, "PosicaoNoMes", COMPONENTE);

  for (const campo of ["pago", "devido", "saldo", "user_id"]) {
    assert.ok(naLib.includes(campo), `${campo} saiu de PosicaoNoMes na lib`);
    assert.ok(
      noCartao.includes(campo),
      `${campo} saiu de PosicaoNoMes no cartao`
    );
  }
});

test("a transferencia que o cartao le tem os campos que simplifySettlements produz", () => {
  const noCartao = camposDaInterface(componente, "Transferencia", COMPONENTE);
  const naLib = camposDaInterface(
    semComentarios(readFileSync("lib/settlement.ts", "utf8")),
    "SuggestedTransfer",
    "lib/settlement.ts"
  );

  const faltando = noCartao.filter((c) => !naLib.includes(c));
  assert.deepEqual(
    faltando,
    [],
    `O cartao le ${faltando.join(", ")} de uma transferencia, e ` +
      `simplifySettlements nao produz esse campo.`
  );
  // `amount` e o valor do Pix: sem ele a linha do acerto sai sem numero.
  assert.ok(noCartao.includes("amount"));
});

// ---------------------------------------------------------------------------
// A FIACAO DA DIVISAO CONFIGURADA (HMO-245, fase 4)
// ---------------------------------------------------------------------------
// A aritmetica do peso tem teste e 21 mutantes em
// test-fechamento-do-grupo.mjs, e a decisao "esta config vale?" tem 8 mutantes
// em mutantes-divisao-configurada.mjs. O que NENHUM dos dois alcanca e a rota:
// ela pode ler a config certa, chamar a funcao certa e nao PASSAR o peso para
// `fecharMes` -- e o fechamento sairia na divisao igual, com a tela de
// configuracao mostrando 70/30 ao lado. Dois numeros certos e um defeito.
//
// O tsc nao pega isso: `peso` e opcional em `MembroDoFechamento` (tem de ser,
// para os chamadores anteriores a esta fase continuarem compilando), entao
// esquecer o campo compila. Estas assercoes sao sobre a fonte SEM COMENTARIO --
// ver o cabecalho: a prosa desta rota cita `default_split_type` e `percentage`
// varias vezes, e uma assercao textual que nao tirasse os comentarios passaria
// verde casando com a explicacao em vez de com a consulta.

test("a rota le as DUAS metades da configuracao: o modo e os percentuais", () => {
  // Uma so nao serve. So o modo deixa o peso de fora; so os percentuais fazem
  // um grupo em `equal` ser rateado por uma coluna que ninguem pediu para usar.
  assert.match(
    rota,
    /\.select\([^)]*\bpercentage\b/,
    "a rota nao le `percentage` dos membros -- o fechamento rateia sempre igual"
  );
  assert.match(
    rota,
    /\.select\([^)]*\bdefault_split_type\b/,
    "a rota nao le `default_split_type` do grupo -- o peso valeria sem o grupo " +
      "ter pedido modo porcentagem"
  );
  // E `percentage` sai da MESMA consulta dos membros, nao de uma segunda que
  // teria de ser casada por id com esta.
  assert.match(
    rota,
    /from\("group_members"\)\s*\n?\s*\.select\("[^"]*percentage[^"]*"\)/,
    "`percentage` nao vem da consulta de group_members"
  );
});

test("a decisao sobre a config nao e refeita na rota", () => {
  // A regra ("percentage com soma 100%") mora em lib/divisao-configurada.ts,
  // onde tem teste e mutante. Reescrita aqui, todo defeito dela sai como um
  // 200 com o numero errado.
  assert.match(
    rota,
    /divisaoDoPeriodo\(/,
    "a rota nao chama `divisaoDoPeriodo`"
  );
  assert.ok(
    !/default_split_type\s*===\s*["']percentage["']/.test(rota),
    "a rota compara `default_split_type` por conta propria -- essa regra tem de " +
      "ficar em lib/divisao-configurada.ts, que e onde ela tem mutante"
  );
});

test("o peso CHEGA em fecharMes, e nao morre numa variavel", () => {
  // O defeito que esta assercao existe para pegar: ler a config, montar
  // `divisao` e esquecer o `peso:` no objeto do membro. Compila, responde 200,
  // devolve a config na resposta -- e rateia igual.
  const montagemDoMembro = rota.match(
    /const membros = ativos\.map\(([\s\S]*?)\n    \}\);/
  );
  assert.ok(
    montagemDoMembro,
    "nao achei a montagem de `membros` na rota. Se ela mudou de forma, " +
      "atualize este teste -- nao o apague: ele e o unico lugar que prova que o " +
      "peso sai da config e entra no rateio."
  );
  assert.match(
    montagemDoMembro[1],
    /peso:\s*divisao\.pesos\[/,
    "`membros` nao recebe o peso de `divisao.pesos` -- o fechamento vai ratear " +
      "igual mesmo com 70/30 configurado"
  );
  assert.match(rota, /fecharMes\(linhas, membros, mes\)/);
});

test("a resposta diz com que divisao o mes foi rateado", () => {
  // `configurado` e `aplicado` DIVERGEM em dois casos reais -- modo custom/
  // proportional e config que nao fecha 100% -- e sem os dois na resposta a
  // tela mostra "igual" sobre um grupo configurado de outro jeito.
  const devolvidos = camposQueARotaDevolve();
  assert.ok(
    devolvidos.includes("divisao"),
    "a resposta nao traz `divisao`: " + devolvidos.join(", ")
  );
  const bloco = rota.match(/divisao: \{([\s\S]*?)\n      \},/);
  assert.ok(bloco, "nao achei o bloco `divisao` da resposta");
  assert.match(
    bloco[1],
    /\.\.\.divisao/,
    "`divisao` nao repassa o que `divisaoDoPeriodo` decidiu"
  );
  assert.match(
    bloco[1],
    /soma_percentual/,
    "a resposta nao traz a soma gravada -- a tela nao tem numero para cobrar o ajuste"
  );
});

// NAO HA ASSERCAO SOBRE O AVISO "a config nao reescreve despesa ja lancada"
// --------------------------------------------------------------------------
// Ele e um limite REAL (a 025 trancou repontamento de divisao, e mudar de 50/50
// para 70/30 nao toca uma parte ja gravada), e esta escrito no cabecalho desta
// rota. Mas uma assercao de que a FRASE existe na fonte nao mede nada: ela casa
// com a prosa que descreve o limite e sobreviveria a qualquer mudanca de
// comportamento. O lugar onde esse aviso precisa ser verificado e a TELA da
// fase 5, onde a pessoa o le -- e la ele e texto renderizado, nao comentario.

test("o cartao chama a rota com o parametro `mes`, que e o que a rota le", () => {
  // Se um lado escrever `month` e o outro `mes`, a rota cai no mes corrente
  // em silencio: o seletor parece nao funcionar, sem erro nenhum.
  assert.match(
    componente,
    /fechamento\?mes=/,
    "o cartao nao chama a rota de fechamento com ?mes="
  );
  assert.match(
    rota,
    /searchParams\.get\("mes"\)/,
    "a rota nao le o parametro `mes`"
  );
});
