#!/usr/bin/env node
// =====================================================
// PULODOGATO - o controle negativo da suite da conta do ativo (HMO-436)
// =====================================================
//   node scripts/mutantes-conta-do-ativo.mjs
//
// `npm run test:conta-do-ativo` verde nao prova que ela SABE REPROVAR. Uma
// assercao que parou de alcancar o codigo que mede imprime o mesmo `✔` -- e
// cada um dos defeitos abaixo e um que alguem pode introduzir sem perceber,
// porque todos deixam a rota respondendo 200/201 com corpo plausivel.
//
// Cada mutante e plantado numa COPIA da arvore em /tmp, compilado e medido com
// a suite de verdade. O mutante tem de MATAR a suite; sobrevivente e relatorio
// de buraco na suite, nao de defeito no app.
//
// Nada daqui toca arquivo rastreado -- ver `check-mutacao-no-lugar`.
// =====================================================

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

// Os alvos como CONSTANTES, e nao caminho literal em cada entrada. Dois
// motivos, e o segundo e o que obriga: os caminhos repetem, e
// `scripts/mede-ancora-ambigua.mjs` recorta o miolo deste arquivo a partir da
// primeira constante que a lista REFERENCIA -- com os caminhos embutidos como
// literal, ele nao acha onde comecar o recorte e o `check-ancora-de-mutante`
// estoura em vez de medir. Ver
// `runner-fora-da-forma-canonica-derruba-a-guarda-de-ancora`.
const LIB = "lib/conta-do-ativo.ts";
const POST_DE_ATIVO = "app/api/investments/assets/route.ts";
const PATCH_DE_ATIVO = "app/api/investments/assets/[assetId]/route.ts";
const CARTEIRA = "app/api/investments/route.ts";
const RENDA_FIXA = "app/api/investments/renda-fixa/route.ts";

/**
 * Cada mutante: o arquivo, a ANCORA (`de`, que tem de existir uma vez so) e a
 * troca. A ancora exata e o que impede o mutante de morrer calado por nao ter
 * casado -- `ancora-de-mutante-casa-no-comentario-e-o-cmp-nao-ve`.
 */
const MUTANTES = [
  {
    nome: "post_confere_depois_de_inserir",
    descricao:
      "a conferencia da conta sai do POST: a trigger da 059 passa a ser a " +
      "mensagem de usuario, em 500",
    arquivo: POST_DE_ATIVO,
    de: "      if (elo.account_id !== null) {\n        const conferida = await conferirContaDeInvestimento(",
    para: "      if (false && elo.account_id !== null) {\n        const conferida = await conferirContaDeInvestimento(",
  },
  {
    nome: "conferencia_sem_dono",
    descricao:
      "a conferencia da conta para de filtrar `user_id`: atrelar o ativo a " +
      "corretora de outra pessoa passa a ser aceito",
    arquivo: LIB,
    de: '    .eq("id", accountId)\n    .eq("user_id", userId)',
    para: '    .eq("id", accountId)',
  },
  {
    nome: "conferencia_aceita_qualquer_tipo",
    descricao:
      "a metade do `account_type` cai: conta corrente passa a aceitar ativo",
    arquivo: LIB,
    de: '  if (conta.account_type !== "investment") {',
    para: '  if (false) {',
  },
  {
    nome: "patch_confunde_soltar_com_nao_pedir",
    descricao:
      "`if (elo.presente)` vira `if (elo.account_id)` no PATCH: o botao de " +
      "desatrelar responde 200 e nao desatrela nada",
    arquivo: PATCH_DE_ATIVO,
    de: "    if (elo.presente) {\n      if (elo.account_id !== null) {",
    para: "    if (elo.account_id) {\n      if (elo.account_id !== null) {",
  },
  {
    nome: "recorte_nao_alcanca_os_lancamentos",
    descricao:
      "o recorte fica so nos ativos: `evolution` e `summary` passam a falar " +
      "da carteira toda ao lado da lista de uma conta",
    arquivo: CARTEIRA,
    de: '      if (recorte.tipo !== "sem-recorte") {',
    para: "      if (false) {",
  },
  {
    nome: "query_vazia_devolve_tudo",
    descricao:
      "`?account_id=` vazio cai em sem-recorte: quem pediu um pedaco recebe " +
      "a carteira inteira, com 200 e lista cheia",
    arquivo: LIB,
    de: '  if (texto === "") {\n    return {\n      ok: false,',
    para: '  if (texto === "") {\n    return {\n      ok: true, tipo: "sem-recorte",\n      naoUsado: true,',
  },
  {
    nome: "recorte_por_conta_e_noop",
    descricao:
      "o `.eq(account_id)` da carteira desaparece: o recorte devolve tudo",
    arquivo: CARTEIRA,
    de: '    if (recorte.tipo === "conta") {\n      consultaAtivos = consultaAtivos.eq("account_id", recorte.account_id);',
    para: '    if (recorte.tipo === "conta") {\n      consultaAtivos = consultaAtivos;',
  },
  {
    nome: "soltos_viram_tudo",
    descricao:
      '`?account_id=none` para de filtrar `IS NULL`: a tela de "atrelar" passa ' +
      "a oferecer ativos que ja tem conta",
    arquivo: CARTEIRA,
    de: '    } else if (recorte.tipo === "soltos") {\n      consultaAtivos = consultaAtivos.is("account_id", null);',
    para: '    } else if (recorte.tipo === "soltos") {\n      consultaAtivos = consultaAtivos;',
  },
  {
    nome: "carteira_fala_com_o_banco_central",
    descricao:
      "/api/investments passa a chamar lib/cdi: um timeout do SGS derruba a " +
      "carteira de quem nao tem renda fixa nenhuma",
    arquivo: CARTEIRA,
    // O `const AGORA = hojeEmBrasilia()` NAO E ENFEITE, e a primeira rodada
    // deste runner provou: com SO o `import`, o mutante SOBREVIVEU -- e
    // sobreviveu estando CERTO. O tsc ELIDE import que ninguem usa, o emit sai
    // sem nenhuma mencao a lib/cdi, e um import morto de fato nao fala com o
    // Banco Central. Para o mutante ser o defeito que a regra proibe, a funcao
    // tem de ser CHAMADA (tsc nao apaga declaracao de variavel, so import sem
    // uso).
    //
    // E e por isso que a assercao da suite le o EMIT e nao o fonte: no fonte, o
    // proprio comentario que documenta a proibicao cita `lib/cdi` e faria o
    // criterio reprovar a arvore certa -- a armadilha que o
    // `check-color-tokens` ja pagou.
    de: 'import { lerRecorteDeConta } from "@/lib/conta-do-ativo";',
    para:
      'import { lerRecorteDeConta } from "@/lib/conta-do-ativo";\n' +
      'import { hojeEmBrasilia } from "@/lib/cdi";\n' +
      "const AGORA = hojeEmBrasilia();",
  },
  {
    nome: "projecao_perde_a_conta",
    descricao:
      "a renda fixa para de devolver `account_id` na projecao: a tela nao sabe " +
      "de que conta e cada rendimento",
    arquivo: RENDA_FIXA,
    de: "        account_id: contaPorAtivo[p.asset_id] ?? null,",
    para: "        account_id: null,",
  },
  {
    nome: "duas_grafias_discordantes_passam",
    descricao:
      "a travessa das duas grafias cai: o pedido ambiguo e resolvido calado, " +
      "e erra em metade dos casos",
    arquivo: LIB,
    de: "    if (camel.bruto !== snake.bruto) {",
    para: "    if (false) {",
  },
  {
    nome: "uuid_malformado_vai_ao_banco",
    descricao:
      "a conferencia de forma do uuid cai: `?account_id=abc` chega ao " +
      "PostgREST, volta 22P02 e a rota responde 500 em vez de 400",
    arquivo: LIB,
    de: "  if (!UUID.test(texto)) {",
    para: "  if (false) {",
  },
];

const PASSOS = [
  ["node", ["scripts/compila.mjs", "-p", "scripts/tsconfig.conta-do-ativo-test.json"]],
  ["node", ["scripts/resolve-aliases.mjs", ".tmp-conta-do-ativo", "lib", "--espelha-raiz"]],
  ["node", ["scripts/resolve-aliases.mjs", ".tmp-conta-do-ativo", "utils", "--espelha-raiz"]],
  ["node", ["scripts/resolve-next-subpaths.mjs", ".tmp-conta-do-ativo"]],
  ["node", ["scripts/monta-duble-de-rota.mjs", ".tmp-conta-do-ativo"]],
  ["node", ["--test", "scripts/test-conta-do-ativo.mjs"]],
];

/** Roda a cadeia inteira na copia e diz se a SUITE passou. */
function suitePassa(dir) {
  for (const [cmd, args] of PASSOS) {
    try {
      execFileSync(cmd, args, { cwd: dir, stdio: "pipe" });
    } catch {
      // Compilacao quebrada tambem e mutante morto: o tsc reprovando e um
      // sinal vermelho tao bom quanto a assercao reprovando. O que nao serve e
      // tudo verde.
      return false;
    }
  }
  return true;
}

const base = mkdtempSync(join(tmpdir(), "mut-conta-do-ativo-"));
console.log(`arvore base em ${base}`);

// A copia exclui `.tmp-*` e `.next`: o lote compilado do worktree tem centenas
// de megabytes e nada dele e entrada do mutante.
cpSync(RAIZ, base, {
  recursive: true,
  dereference: false,
  filter: (src) => {
    const rel = src.slice(RAIZ.length);
    if (rel.startsWith(".tmp-") || rel.startsWith(".next")) return false;
    if (rel.startsWith(".git/")) return false;
    return true;
  },
});

// O controle POSITIVO: a arvore sem mutante tem de ficar VERDE. Sem ele, uma
// arvore quebrada (um passo da cadeia que nao roda em /tmp, por exemplo) faria
// TODO mutante parecer morto -- `suite-vermelha-faz-todo-controle-negativo-passar-vacuo`.
if (!suitePassa(base)) {
  console.error(
    "CONTROLE POSITIVO VERMELHO: a arvore SEM mutante nao passa a suite em " +
      `${base}. Todo mutante abaixo pareceria morto por este motivo, nao pelo ` +
      "defeito. Nada foi medido."
  );
  process.exit(1);
}
console.log("controle positivo: arvore limpa VERDE\n");

let mortos = 0;
const sobreviventes = [];

for (const m of MUTANTES) {
  const alvo = join(base, m.arquivo);
  const original = readFileSync(alvo, "utf8");

  const ocorrencias = original.split(m.de).length - 1;
  if (ocorrencias !== 1) {
    console.error(
      `ANCORA MORTA em ${m.nome}: o texto casa ${ocorrencias} vez(es) em ` +
        `${m.arquivo}, e tem de casar exatamente 1. O mutante nao foi plantado ` +
        "-- isto e falha do runner, nao mutante morto.\n" +
        `  ancora: ${JSON.stringify(m.de.slice(0, 80))}`
    );
    process.exit(1);
  }

  writeFileSync(alvo, original.replace(m.de, m.para));
  const passou = suitePassa(base);
  writeFileSync(alvo, original);

  if (passou) {
    sobreviventes.push(m);
    console.log(`SOBREVIVEU  ${m.nome} -- ${m.descricao}`);
  } else {
    mortos++;
    console.log(`morto       ${m.nome}`);
  }
}

rmSync(base, { recursive: true, force: true });

console.log(`\nplacar: ${mortos}/${MUTANTES.length} mortos`);

if (sobreviventes.length > 0) {
  console.error(
    "\nSobrevivente e buraco na suite: cada um destes defeitos pode entrar na " +
      "main com `npm run test:conta-do-ativo` verde."
  );
  process.exit(1);
}
