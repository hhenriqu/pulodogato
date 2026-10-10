// O contrato entre o bloco "A receber dos grupos" e a rota dele (HMO-245 F10).
//
// POR QUE ESTE TESTE E DE TEXTO, E NAO DE COMPORTAMENTO
// -----------------------------------------------------
// Mesmo desenho do test-contrato-do-fechamento.mjs, e pela mesma razao: `await
// res.json()` e `any`, entao atribuir a resposta da rota a `CreditoAReceber`
// NAO e checado pelo tsc. Um campo renomeado em um dos dois lados chega
// `undefined`, o `??`/`?.` da tela o transforma em ZERO ou em branco, e o bloco
// mostra "R$ 0,00 a receber" num mes em que alguem deve de verdade -- ou
// simplesmente nao aparece, que e pior, porque invisivel se le como inexistente.
//
// O calculo esta coberto por test-credito-de-grupo.mjs (17 blocos, dois fusos)
// e por 12 mutantes. O que ESTE teste tranca e o nome dos campos no caminho
// entre os tres arquivos.
//
// A ASSERCAO QUE VALE MAIS: O CREDITO NAO ENTRA EM `calculateBalance`
// -------------------------------------------------------------------
// A decisao desta fase e que o credito e PREVISTO e fica FORA do cartao
// "Receitas" -- `fecharMes` soma previsto junto com realizado, entao somar a
// saida dele em receita publicaria dinheiro que ninguem pagou. E a familia de
// defeito do "a vencer", que este app ja pagou uma vez.
//
// Esse defeito seria uma linha: `income: resumo.receitas + credito.total`. E um
// defeito que o SALDO NAO DENUNCIA quando vem acompanhado do outro lado, e que
// nenhum teste da funcao pura pode pegar, porque a funcao pura nao e o lugar
// onde ele acontece. Por isso a assercao e aqui, sobre o corpo de
// `calculateBalance`.
//
// COMENTARIO E CODIGO SAO SEPARADOS ANTES DE QUALQUER ASSERCAO
// ------------------------------------------------------------
// Os tres arquivos deste recorte sao muito comentados, e os comentarios citam
// os nomes dos campos -- o cabecalho de lib/credito-de-grupo.ts cita
// `receitas`, `resumoDoPeriodo` e `por_membro[].saldo` em prosa. Uma assercao
// textual que nao tire os comentarios passa verde casando com a PROSA que
// descreve o campo em vez da linha que o produz: um verde que sobrevive a
// remocao do campo.
//
//   npm run test:contrato-do-credito

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const TELA = "app/(dashboard)/dashboard/personal-finance/page.tsx";
const ROTA = "app/api/expense-groups/my-credit/route.ts";
const LIB = "lib/credito-de-grupo.ts";
/**
 * As seis consultas, que sairam da rota na HMO-364.
 *
 * A aba Receitas passou a somar o MESMO credito dentro do cartao «Previsto»
 * (fase F3 da HMO-360), e duas copias das mesmas consultas divergiriam na
 * primeira mudanca -- a familia de `fontes-consistentes-que-discordam`. Este
 * arquivo entra no recorte porque metade do contrato que este teste tranca
 * mudou de endereco: apontar tudo para a rota deixaria as assercoes verdes
 * medindo um arquivo que nao consulta mais nada.
 */
const SERVICO = "lib/services/credito-dos-grupos.ts";

/** Tira comentario de bloco, de linha e de JSX -- ver o cabecalho. */
function semComentarios(fonte) {
  return fonte
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "") // {/* ... */} do JSX
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const telaCrua = readFileSync(TELA, "utf8");
const tela = semComentarios(telaCrua);
const rota = semComentarios(readFileSync(ROTA, "utf8"));
const lib = semComentarios(readFileSync(LIB, "utf8"));
const servico = semComentarios(readFileSync(SERVICO, "utf8"));

/** Os campos declarados numa `interface X { ... }`. */
function camposDaInterface(fonte, nome, arquivo) {
  const bloco = fonte.match(
    new RegExp(`interface ${nome} \\{([\\s\\S]*?)\\n\\}`)
  );
  assert.ok(
    bloco,
    `Nao achei a interface ${nome} em ${arquivo}. Se ela foi renomeada, ` +
      `atualize este teste -- nao o apague: ele e o unico lugar que liga a ` +
      `rota a tela, porque o tsc nao liga.`
  );
  return bloco[1]
    .split("\n")
    .map((l) => l.trim())
    .map((l) => l.match(/^(\w+)\??:/))
    .filter(Boolean)
    .map((m) => m[1]);
}

// -----------------------------------------------------------------------------
// O CONTRATO DE CAMPOS
// -----------------------------------------------------------------------------
test("a tela le os tres campos de CreditoAReceber, com o nome que a lib da", () => {
  const campos = camposDaInterface(lib, "CreditoAReceber", LIB);
  assert.deepEqual(campos.sort(), ["linhas", "sem_devedor", "total"]);

  for (const campo of campos) {
    assert.ok(
      tela.includes(`creditoDeGrupo.${campo}`) ||
        tela.includes(`credito.${campo}`),
      `A tela nunca le \`${campo}\`. Se a rota parar de mandar esse campo, ou ` +
        `se ele for renomeado, a tela mostra zero/branco sem erro nenhum.`
    );
  }
});

test("a tela le os campos de cada linha, e nao esquece o nome do devedor", () => {
  const campos = camposDaInterface(lib, "CreditoDeGrupo", LIB);
  // O pedido da issue, literal: nome, grupo e valor. `group_id` e o link e
  // `devedor_user_id` e metade da chave do React.
  assert.deepEqual(campos.sort(), [
    "devedor",
    "devedor_user_id",
    "group_id",
    "grupo",
    "valor",
  ]);

  for (const campo of ["group_id", "grupo", "valor", "devedor_user_id"]) {
    assert.ok(
      tela.includes(`linha.${campo}`),
      `A tela nunca le \`linha.${campo}\`.`
    );
  }

  // `devedor` NAO e lido direto de proposito: quem escreve o rotulo (e o
  // fallback de perfil ilegivel) e `devedorNaLinha`, que tem teste. Ler
  // `linha.devedor` cru na tela e o caminho que produz rotulo em branco.
  assert.ok(
    tela.includes("devedorNaLinha(linha)"),
    "A tela tem de passar a linha por `devedorNaLinha` -- e ela que poe o " +
      "rotulo quando o perfil do devedor nao e legivel, que e caminho NORMAL."
  );
});

test("a rota devolve `credito`, e e por esse nome que a tela le", () => {
  // DUAS PERNAS DESDE A HMO-364, e as duas sao necessarias.
  //
  // As seis consultas sairam da rota para lib/services/credito-dos-grupos.ts,
  // porque a aba Receitas passou a somar o MESMO credito dentro do cartao
  // «Previsto» (fase F3 da HMO-360) e duas copias das mesmas consultas
  // divergiriam na primeira mudanca. Entao a chamada de `creditoAReceber` nao
  // esta mais nesta rota -- ela esta no modulo.
  //
  // Afirmar so a perna da ROTA deixaria passar um modulo que devolve um objeto
  // montado a mao; afirmar so a perna do MODULO deixaria passar uma rota que
  // responde com outro nome de campo, e a tela mostraria "ninguem te deve
  // nada". As duas pernas, porque o defeito de cada lado e invisivel do outro.
  assert.ok(
    /credito:\s*leitura\.credito/.test(rota),
    "A rota tem de devolver o credito em `credito:` -- e o nome que a tela le."
  );
  assert.ok(
    /lerCreditoDosGrupos\(/.test(rota),
    "A rota tem de ler pelo modulo compartilhado (lib/services/credito-dos-grupos.ts)."
  );
  assert.ok(
    /credito:\s*creditoAReceber\(/.test(servico),
    "lib/services/credito-dos-grupos.ts tem de devolver `creditoAReceber(...)` " +
      "-- quem agrega por (grupo, devedor) e a funcao pura, que tem 12 mutantes."
  );
  // E A FALHA TEM DE CONTINUAR DANDO 500 AQUI. Esta rota existe para responder o
  // credito: sem ele a resposta nao tem conteudo. A aba Receitas faz o OPOSTO com
  // a mesma falha (segue com os tres numeros e o reembolso zerado), e foi por
  // isso que o erro passou a voltar como valor em vez de excecao -- um `ok`
  // ignorado aqui devolveria 200 com `credito` undefined, e a tela leria
  // "ninguem te deve nada".
  assert.ok(
    /if\s*\(!leitura\.ok\)[\s\S]{0,200}status:\s*500/.test(rota),
    "A rota tem de devolver 500 quando a leitura do credito falha."
  );
  assert.ok(
    tela.includes("dados.credito"),
    "A tela tem de ler `dados.credito`. Renomear um dos dois lados deixa o " +
      "bloco invisivel, e invisivel se le como 'ninguem te deve nada'."
  );
  assert.ok(
    tela.includes("/api/expense-groups/my-credit"),
    "A tela tem de chamar a rota my-credit."
  );
});

test("a rota e a tela concordam no recorte de periodo", () => {
  // Sem o mesmo `de`/`ate` dos tres cartoes, o credito seria de um recorte de
  // tempo diferente do resto da tela -- o defeito de rotulo que o painel desta
  // casa ja teve.
  assert.ok(
    /my-credit\?\$\{periodoParaQuery\(periodo\)\}/.test(tela),
    "A tela tem de mandar o periodo da tela na querystring."
  );
  for (const param of ['get("de")', 'get("ate")']) {
    assert.ok(
      rota.includes(param),
      `A rota tem de ler ${param} -- senao o periodo da tela e ignorado e o ` +
        `bloco soma um recorte de tempo que a legenda nao descreve.`
    );
  }
});

// -----------------------------------------------------------------------------
// A DECISAO DA FASE: PREVISTO FICA FORA DE "Receitas"
// -----------------------------------------------------------------------------
test("o credito NAO entra em `calculateBalance` -- os tres cartoes nao o somam", () => {
  const bloco = tela.match(/const calculateBalance = \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(bloco, "Nao achei `calculateBalance` na tela.");

  const corpo = bloco[1];

  // O defeito seria uma linha dentro deste bloco: `income: resumo.receitas +
  // credito.total`. `fecharMes` soma previsto com realizado, entao isso
  // publicaria como receita dinheiro que ninguem pagou -- e o saldo continuaria
  // fechando, porque o erro entra em UM lado so e o saldo e derivado dele.
  for (const proibido of ["credito", "Credito", "creditoDeGrupo"]) {
    assert.ok(
      !corpo.includes(proibido),
      `\`calculateBalance\` menciona "${proibido}". O credito de grupo e ` +
        `PREVISTO (a pessoa pode nao pagar) e tem de ficar FORA dos tres ` +
        `cartoes. A receita realizada do grupo e a quitacao, e so ela.`
    );
  }

  // CONTROLE POSITIVO da assercao de cima: se `calculateBalance` deixasse de
  // existir, ou deixasse de ser o lugar onde os cartoes sao calculados, o
  // `!corpo.includes` passaria verde medindo um bloco vazio.
  assert.match(corpo, /income:\s*resumo\.receitas/);
  assert.match(corpo, /expenses:\s*resumo\.despesas/);
});

test("a lib nao tem caminho para somar em receita", () => {
  // O modulo nao importa `resumoDoPeriodo` nem menciona `receitas`: o caminho
  // que misturaria os dois nao existe no arquivo. E a versao estrutural da
  // decisao de cima -- aqui ela e barata, e no dia em que alguem importar
  // aquilo para "unificar os cartoes" este teste e quem explica por que nao.
  assert.ok(
    !/resumoDoPeriodo|resumoComPartesDeGrupo/.test(lib),
    "lib/credito-de-grupo.ts nao deve importar o resumo dos cartoes."
  );
});

// -----------------------------------------------------------------------------
// OS ROTULOS QUE IMPEDEM A LEITURA ERRADA
// -----------------------------------------------------------------------------
test("o bloco e a frase dizem A RECEBER e previsto, nos comentarios E na tela", () => {
  // Aqui a fonte CRUA e a certa: o que esta sendo medido e o texto que a pessoa
  // le, e ele vive dentro do JSX. Sem estes rotulos um valor em verde ao lado
  // de "Receitas" se le como dinheiro que entrou.
  assert.ok(
    telaCrua.includes("A receber dos grupos"),
    "O bloco precisa do titulo 'A receber dos grupos'."
  );
  assert.ok(
    /previsto, fora deste total/.test(telaCrua),
    "A frase do cartao de Receitas tem de dizer que o valor esta FORA dele."
  );
  assert.ok(
    /Entra em Receitas quando a quitação for registrada/.test(telaCrua),
    "O bloco tem de dizer QUANDO o credito vira receita -- senao 'previsto' " +
      "nao tem desfecho e a pessoa nao sabe o que fazer com o numero."
  );
});

test("o caminho de FALHA tem texto proprio, separado do vazio", () => {
  // Erro e vazio sao o mesmo estado para quem olha: nenhum valor a receber na
  // tela. As leituras sao opostas -- "ninguem te deve nada" e "nao foi possivel
  // conferir" -- e sem a bandeira a tela escolheria sempre a primeira.
  assert.ok(
    tela.includes("setCreditoFalhou(true)"),
    "A bandeira de falha tem de subir."
  );
  assert.ok(
    tela.includes("setCreditoFalhou(false)"),
    "E descer no sucesso -- senao um erro transitorio deixa o aviso para sempre."
  );
  assert.ok(
    /creditoFalhou && \(/.test(tela),
    "A tela tem de escrever algo quando a consulta falha."
  );
});
