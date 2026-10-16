#!/usr/bin/env node
// =====================================================
// O CONTROLE NEGATIVO DE `check-as-oito-leituras` (HMO-416)
// =====================================================
//   npm run test:as-tres-leituras
//
// A HMO-411 criou `scripts/check-as-oito-leituras.mjs` e o pos no CI VERDE. Mas
// guarda verde nao prova que a guarda SABE reprovar -- prova que a arvore de
// hoje passa, o que uma guarda vazia tambem faria. Este arquivo e a outra
// metade: para cada decisao da guarda ele PLANTA o defeito e exige vermelho.
//
// POR QUE AGORA, NA HMO-416, E NAO NA HMO-411
// -------------------------------------------
// A HMO-411 tinha UMA direcao (as oito leituras tem de usar `my_status`) e UMA
// excecao com forma unica (`.neq("status", "paid")`). A HMO-416 decidiu as tres
// leituras que tinham ficado de fora e a lista de excecoes passou de uma para
// tres -- com DUAS formas diferentes (filtro no banco, coluna no `select`) e uma
// assercao nova (a coluna da pessoa nao pode aparecer na cadeia). Sao quatro
// decisoes novas na guarda, e nenhuma delas tinha controle.
//
// A SOMBRA E DE 14 ARQUIVOS, E NAO DO REPOSITORIO
// -----------------------------------------------
// A guarda le exatamente dois tipos de arquivo: ela mesma (mais
// `varredura-de-fonte.mjs`) e as rotas que as suas listas nomeiam, por caminho
// relativo ao cwd. Entao a sombra precisa so disso -- um `cpSync` do repo
// inteiro levaria `node_modules` e os `.tmp-*` para medir um `readFileSync`.
//
// E A LISTA DE ROTAS SAI DO FONTE DA GUARDA, NAO DAQUI. Escrever os caminhos a
// mao neste arquivo criaria a divida que a propria guarda existe para evitar:
// uma leitura nova entraria em `LEITURAS` e esta sonda continuaria copiando as
// doze antigas -- a rota nova nasceria sem sombra, o `readFileSync` dela
// levantaria ENOENT, TODO caso negativo ficaria vermelho e o placar sairia
// perfeito medindo o erro de aparelho. Ver `lista-de-campos-conhecidos-no-leitor-
// e-divida`.
//
// AS DUAS ARMADILHAS DE VACUIDADE QUE ESTA SONDA TEM DE DESARMAR
// --------------------------------------------------------------
//   1. SOMBRA QUEBRADA. Se a sombra intacta ja sai VERMELHA -- arquivo que nao
//      foi copiado, import que nao resolve --, entao todo defeito plantado
//      "morre" sem nada ter sido medido. O primeiro caso deste arquivo e o
//      controle POSITIVO: sombra intacta, guarda verde. Sem ele o resto nao
//      vale.
//   2. VERMELHO PELA RAZAO ERRADA. Um defeito plantado que derruba a guarda com
//      `ENOENT` tambem sai nao-zero, e passaria por "a guarda pegou". Por isso
//      cada caso confere a MENSAGEM: o arquivo nomeado e a frase da decisao.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const GUARDA = "scripts/check-as-oito-leituras.mjs";

const fonteDaGuarda = readFileSync(join(RAIZ, GUARDA), "utf8");

/**
 * As rotas que a guarda le, extraidas DO FONTE DELA.
 *
 * O criterio e o literal de caminho: toda string `"app/api/.../route.ts"` que
 * aparece na guarda e um arquivo que ela vai abrir -- esteja em `LEITURAS` ou em
 * `EXCECOES`. As duas listas entram por aqui sem este arquivo saber a diferenca,
 * que e o ponto: a sonda acompanha a guarda sozinha.
 */
const ROTAS = [...new Set(
  [...fonteDaGuarda.matchAll(/"(app\/api\/[^"]+\/route\.ts)"/g)].map((m) => m[1])
)];

// A EXTRACAO TEM DE ACHAR ALGO, e o piso nao e 1: a guarda tem nove leituras e
// tres excecoes. Um regex que parasse de casar devolveria `[]`, a sombra sairia
// sem rota nenhuma e a guarda reprovaria tudo por ENOENT -- vermelho universal,
// que neste arquivo se leria como "a guarda e otima".
assert.ok(
  ROTAS.length >= 12,
  `a extracao de caminhos do fonte da guarda achou ${ROTAS.length} rotas (esperado >= 12) -- ` +
    "o formato da lista mudou e esta sonda parou de medir"
);

/** Monta a sombra e devolve o diretorio. */
function montarSombra() {
  const dir = mkdtempSync(join(tmpdir(), "hmo416-"));

  for (const relativo of [GUARDA, "scripts/varredura-de-fonte.mjs", ...ROTAS]) {
    const destino = join(dir, relativo);
    mkdirSync(dirname(destino), { recursive: true });
    cpSync(join(RAIZ, relativo), destino);
  }

  return dir;
}

/**
 * Roda a guarda na sombra, com os arquivos de `mutacoes` sobrescritos.
 *
 * `mutacoes` e um mapa caminho-relativo -> conteudo novo. A sombra e montada
 * limpa em cada chamada, entao um caso nunca ve a mutacao do anterior.
 */
function rodarGuarda(mutacoes = {}) {
  const dir = montarSombra();
  try {
    for (const [relativo, conteudo] of Object.entries(mutacoes)) {
      writeFileSync(join(dir, relativo), conteudo);
    }

    const r = spawnSync(process.execPath, [GUARDA], {
      cwd: dir,
      encoding: "utf8",
    });

    return { codigo: r.status, saida: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** O fonte de uma rota da arvore de verdade. */
const fonteDe = (relativo) => readFileSync(join(RAIZ, relativo), "utf8");

const FATURA = "app/api/card-invoices/route.ts";
const FECHAMENTO = "app/api/expense-groups/[groupId]/fechamento/route.ts";
const SEMEADURA = "app/api/expense-groups/[groupId]/semear-divisao/route.ts";
const TELA_DO_GRUPO = "app/api/expense-groups/[groupId]/scheduled/route.ts";

/** Troca `de` por `para` em `relativo`, exigindo ocorrencia UNICA. */
function mutar(relativo, de, para) {
  const antes = fonteDe(relativo);
  const vezes = antes.split(de).length - 1;

  // ANCORA MORTA E ANCORA AMBIGUA DAO O MESMO VERMELHO QUE UM DEFEITO PEGO, e e
  // por isso que elas sao conferidas aqui e nao descobertas la: com zero
  // ocorrencias o `replace` nao muda nada, a guarda roda sobre a sombra INTACTA,
  // sai VERDE -- e o caso negativo falharia dizendo "a guarda nao pegou", que e
  // a mensagem errada para "o meu alvo nao existe mais".
  assert.equal(
    vezes,
    1,
    `o alvo da mutacao aparece ${vezes}x em ${relativo} (esperado 1x): ${de}`
  );

  return { [relativo]: antes.replace(de, para) };
}

// -----------------------------------------------------
// 1. O CONTROLE POSITIVO -- sem ele nada abaixo vale
// -----------------------------------------------------
test("a sombra INTACTA passa na guarda (senao todo caso negativo e vacuo)", () => {
  const r = rodarGuarda();
  assert.equal(
    r.codigo,
    0,
    `a sombra intacta reprovou -- o aparelho esta quebrado, nao a arvore:\n${r.saida}`
  );
  // E a guarda tem de dizer que mediu as duas listas. Uma guarda cujas listas
  // ficassem vazias tambem sairia 0 aqui.
  assert.match(r.saida, /as 9 leituras/);
  assert.match(r.saida, /as 3 excecoes declaradas/);
});

// -----------------------------------------------------
// 2. A NONA LEITURA -- a troca da HMO-416, medida
// -----------------------------------------------------
test("a fatura do cartao voltando para `status` reprova", () => {
  // Exatamente a reversao da HMO-416: a rota volta a coluna do DONO.
  const r = rodarGuarda(
    mutar(FATURA, '.eq("my_status", "pending")', '.eq("status", "pending")')
  );

  assert.notEqual(r.codigo, 0, `a guarda passou verde sobre a reversao:\n${r.saida}`);
  assert.match(r.saida, /card-invoices/);
  assert.match(r.saida, /coluna do DONO/);
});

test("a fatura do cartao sem filtro de estado nenhum reprova", () => {
  // O outro lado, e o que `onde: "filtro"` existe para pegar: apagar o recorte
  // nao e consertar nada -- e a previsao ja paga voltando para a tela do cartao.
  const r = rodarGuarda(mutar(FATURA, '.eq("my_status", "pending")\n', ""));

  assert.notEqual(r.codigo, 0, `a guarda passou verde sem filtro de estado:\n${r.saida}`);
  assert.match(r.saida, /card-invoices/);
  assert.match(r.saida, /nao aparece no filtro/);
});

// -----------------------------------------------------
// 3. AS DUAS EXCECOES NOVAS -- a metade (a), no `select`
// -----------------------------------------------------
for (const [rotulo, arquivo] of [
  ["o fechamento do grupo", FECHAMENTO],
  ["a semeadura pela renda", SEMEADURA],
]) {
  test(`${rotulo} trocando \`status\` por \`my_status\` no select reprova`, () => {
    // O defeito de dinheiro que a decisao escrita impede: para a conta de OUTRO
    // membro que ele ja pagou, `my_status` e `pending` -- a prevista nao seria
    // descartada e somaria em cima da realizada.
    const r = rodarGuarda(
      mutar(arquivo, "user_id, status, direction", "user_id, my_status, direction")
    );

    assert.notEqual(r.codigo, 0, `a guarda passou verde sobre a troca:\n${r.saida}`);
    assert.match(r.saida, /perdeu `status` do select/);
  });

  test(`${rotulo} perdendo \`status\` do select reprova`, () => {
    // O MESMO defeito por omissao: sem a coluna, `linha.status` chega
    // `undefined`, nunca e "paid", e `linhaDoPrevisto` para de descartar.
    const r = rodarGuarda(
      mutar(arquivo, "user_id, status, direction", "user_id, direction")
    );

    assert.notEqual(r.codigo, 0, `a guarda passou verde sobre a omissao:\n${r.saida}`);
    assert.match(r.saida, /perdeu `status` do select/);
    assert.match(r.saida, /DOBRADO/);
  });

  test(`${rotulo} ACRESCENTANDO \`my_status\` ao lado de \`status\` reprova`, () => {
    // A metade (b), e o caso que ela existe para pegar: a metade (a) continua
    // satisfeita (`status` segue no select), e so esta assercao distingue. E o
    // caminho de defeito mais provavel -- acrescentar a coluna e depois mudar o
    // consumidor em JS.
    const r = rodarGuarda(
      mutar(
        arquivo,
        "user_id, status, direction",
        "user_id, status, my_status, direction"
      )
    );

    assert.notEqual(
      r.codigo,
      0,
      `a guarda passou verde sobre a coluna da pessoa acrescentada:\n${r.saida}`
    );
    assert.match(r.saida, /estado da PESSOA/);
  });
}

// -----------------------------------------------------
// 4. A EXCECAO DA HMO-411 -- a metade (a), no `filtro`
// -----------------------------------------------------
test("a tela do grupo trocando o `.neq` para `my_status` reprova", () => {
  // O molde que a HMO-411 escreveu, agora com controle. Dois vermelhos de uma
  // vez: (a) perdeu `status` do filtro, e (b) passou a usar a coluna da pessoa.
  const r = rodarGuarda(
    mutar(TELA_DO_GRUPO, '.neq("status", "paid")', '.neq("my_status", "paid")')
  );

  assert.notEqual(r.codigo, 0, `a guarda passou verde sobre a troca:\n${r.saida}`);
  assert.match(r.saida, /perdeu `status` do filtro/);
  assert.match(r.saida, /estado da PESSOA/);
});

test("a tela do grupo perdendo o `.neq` reprova", () => {
  const r = rodarGuarda(mutar(TELA_DO_GRUPO, '\n      .neq("status", "paid")', ""));

  assert.notEqual(r.codigo, 0, `a guarda passou verde sem o recorte:\n${r.saida}`);
  assert.match(r.saida, /perdeu `status` do filtro/);
});

// -----------------------------------------------------
// 5. A CADEIA ILEGIVEL -- a guarda tem de pedir olho humano
// -----------------------------------------------------
// Este caso mede a trava que as outras nao alcancam: uma leitura que SAI da
// view. Sem ele, `cadeiaDaView` podendo devolver `null` em silencio passaria
// verde, e a guarda inteira viraria opcional -- bastaria mover a consulta.
test("a excecao que sai da view reprova (e nao passa calada)", () => {
  const r = rodarGuarda(
    mutar(
      FECHAMENTO,
      '.from("scheduled_transactions_effective")',
      '.from("scheduled_transactions")'
    )
  );

  assert.notEqual(r.codigo, 0, `a guarda passou verde sobre a saida da view:\n${r.saida}`);
  assert.match(r.saida, /nao achei um/);
  assert.match(r.saida, /olho humano/);
});
