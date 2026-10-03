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
