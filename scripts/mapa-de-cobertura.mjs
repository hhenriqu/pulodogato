#!/usr/bin/env node
// O MAPA: para cada alvo de verificacao do package.json, QUEM o roda e esse
// alguem DA PARTIDA.
//
// Por que isto existe (HMO-491): a pergunta "temos teste para isto?" tem tres
// respostas possiveis no repositorio e so duas delas se distinguem olhando. A
// terceira -- "a suite existe, esta citada num workflow, e aquele workflow nao
// roda" -- parece cobertura por qualquer medida textual, inclusive pela do
// `check-tests-in-ci.mjs`, que confere DECLARACAO.
//
// Foi o que aconteceu na HMO-473: o `.github/workflows/verificacao.yml` passou
// de 512.000 bytes, o GitHub parou de criar job para ele, e 290 steps de
// verificacao sairam do ar sem nada ficar vermelho. O `check-tests-in-ci`
// continuou verde durante tudo, porque a suite estava declarada -- e declaracao
// era exatamente o que sobrevivia a falha.
//
// Este arquivo responde a pergunta que falta. Nao e um guarda: ele imprime o
// mapa e sai 0. O guarda que trava a regressao e a QUARTA PENEIRA do
// `check-tests-in-ci.mjs`, que importa o criterio daqui em vez de reescreve-lo.
//
// Uso:
//   node scripts/mapa-de-cobertura.mjs           o mapa legivel
//   node scripts/mapa-de-cobertura.mjs --json    o mesmo, para outro programa
//   node scripts/mapa-de-cobertura.mjs --inertes so os alvos que nao rodam

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Nao ha constante com o diretorio de workflows: ele sai de `join(raiz, ...)`
// dentro de `workflows()`, porque a raiz e parametro (o teste monta uma arvore
// sintetica num mkdtemp). Uma constante aqui seria lida sempre do repositorio
// de verdade e tornaria os casos do teste vacuos.
const RAIZ = fileURLToPath(new URL("..", import.meta.url));

/**
 * O teto MEDIDO de tamanho de um arquivo de workflow: 512.000 bytes = 500 KiB.
 *
 * Medido na HMO-459 com tres branches de sonda, cada uma com o conteudo da main
 * e so linhas de comentario removidas: 504.975 bytes e 511.821 bytes nao criam
 * run nenhum (o comportamento certo numa branch de feature, porque o arquivo
 * filtra `branches: [main]` -- ou seja, o GitHub LEU o arquivo); 512.136 bytes
 * cria um run de 0s, `failure`, com o nome igual ao CAMINHO do arquivo. 511.821
 * le e 512.136 nao => o teto esta entre os dois, em 512.000.
 *
 * Acima dele o `js-yaml` ainda carrega o arquivo e devolve o `jobs` inteiro: o
 * YAML esta valido. Nao e erro de sintaxe, e tamanho -- entao a unica forma de
 * ver e medir o byte count.
 */
export const TETO_DE_BYTES_DO_WORKFLOW = 512_000;

/**
 * O alarme, bem abaixo do teto.
 *
 * Em 512.000 o alarme chega tarde: quem estoura o teto e o step da feature
 * seguinte, e o PR que o acrescenta nao tem nada de errado. Em 450.000 ainda ha
 * ~60 KB de folga para consertar com calma.
 */
export const ALARME_DE_BYTES_DO_WORKFLOW = 450_000;

/** As linhas de comentario saem: step comentado nao roda. */
export function semComentarios(texto) {
  return texto
    .split("\n")
    .filter((linha) => !/^\s*#/.test(linha))
    .join("\n");
}

/**
 * O step que roda EXATAMENTE este alvo.
 *
 * A borda `(?![\w:-])` e a mesma do `check-tests-in-ci.mjs`, e pela mesma razao:
 * o nome de um alvo pode ser PREFIXO do nome de outro (`test:moeda` dentro de
 * `test:moeda-do-grupo`), e a busca por substring acha o alvo errado.
 */
export function invocaPorNpm(texto, nome) {
  const escapado = nome.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`npm run ${escapado}(?![\\w:-])`).test(texto);
}

/**
 * O arquivo que o comando do alvo executa, quando o workflow o chama direto.
 *
 * Nem todo step passa pelo `npm run`: varios chamam `node scripts/x.mjs` ou
 * `bash scripts/x.sh` com o caminho na mao. Sem este caso o mapa reporta 33
 * alvos como "nenhum workflow" e 24 deles rodam -- a primeira medicao da
 * HMO-491 errou exatamente assim.
 */
export function arquivoDoComando(comando) {
  const m = /scripts\/[\w.-]+\.(?:mjs|js|sh)/.exec(comando ?? "");
  return m ? m[0] : null;
}

/**
 * Os workflows, com o tamanho medido e o veredito de partida.
 *
 * `raiz` e parametro para que o `test-suite-inerte.mjs` possa montar uma arvore
 * sintetica num `mkdtempSync` em vez de escrever em `.github/` -- escrever na
 * arvore de verdade e o que o `check-mutacao-no-lugar.mjs` proibe, e com razao:
 * um teste que morre no meio deixaria workflow mutante gravado.
 */
export function workflows(raiz = RAIZ) {
  const dir = join(raiz, ".github/workflows");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort()
    .map((nome) => {
      const bruto = readFileSync(join(dir, nome), "utf8");
      const bytes = Buffer.byteLength(bruto, "utf8");
      return {
        nome,
        bytes,
        daPartida: bytes <= TETO_DE_BYTES_DO_WORKFLOW,
        emAlarme: bytes > ALARME_DE_BYTES_DO_WORKFLOW,
        texto: semComentarios(bruto),
      };
    });
}

/**
 * O mapa: alvo -> workflows que o invocam -> ele roda de verdade?
 *
 * `invocadoPor` inclui a cadeia TRANSITIVA: um alvo chamado por outro alvo que
 * o workflow invoca tambem roda. O `pre-commit` encadeia nove `check-*` com
 * `&&`, e sem a cadeia cada um deles apareceria como orfao.
 */
export function mapaDeCobertura(raiz = RAIZ) {
  const pkg = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));
  const scripts = pkg.scripts ?? {};
  const wfs = workflows(raiz);

  const alvos = Object.keys(scripts)
    .filter((n) => /^(test:|mutantes:|check)/.test(n))
    .sort();

  // Quem chama quem, pelo corpo dos scripts do package.json.
  const chamadores = new Map();
  for (const [nome, corpo] of Object.entries(scripts)) {
    for (const m of corpo.matchAll(/npm run ([\w:.-]+)/g)) {
      if (!chamadores.has(m[1])) chamadores.set(m[1], []);
      chamadores.get(m[1]).push(nome);
    }
  }

  const direto = new Map();
  for (const nome of Object.keys(scripts)) {
    const arquivo = arquivoDoComando(scripts[nome]);
    direto.set(
      nome,
      wfs
        .filter(
          (w) => invocaPorNpm(w.texto, nome) || (arquivo !== null && w.texto.includes(arquivo)),
        )
        .map((w) => w.nome),
    );
  }

  const memo = new Map();
  function alcance(nome, vistos = new Set()) {
    if (memo.has(nome)) return memo.get(nome);
    if (vistos.has(nome)) return [];
    vistos.add(nome);
    const achados = new Set(direto.get(nome) ?? []);
    for (const pai of chamadores.get(nome) ?? []) {
      for (const w of alcance(pai, vistos)) achados.add(w);
    }
    const lista = [...achados];
    if (vistos.size === 1) memo.set(nome, lista);
    return lista;
  }

  const porNome = new Map(wfs.map((w) => [w.nome, w]));

  return {
    workflows: wfs.map(({ texto, ...resto }) => resto),
    alvos: alvos.map((nome) => {
      const invocadoPor = alcance(nome);
      const queRodam = invocadoPor.filter((w) => porNome.get(w).daPartida);
      return {
        nome,
        familia: nome.startsWith("test:")
          ? "test"
          : nome.startsWith("mutantes:")
            ? "mutantes"
            : "check",
        invocadoPor,
        queRodam,
        // RODA   -- algum workflow que da partida o invoca.
        // INERTE -- esta declarado, e so em workflow que nao da partida.
        // ORFAO  -- nenhum workflow o cita, nem morto.
        estado: queRodam.length > 0 ? "RODA" : invocadoPor.length > 0 ? "INERTE" : "ORFAO",
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Linha de comando. So quando ESTE arquivo e o que o node executou -- importa-lo
// do `check-tests-in-ci.mjs` nao pode imprimir o mapa inteiro no log do guarda.
// ---------------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const mapa = mapaDeCobertura();
  const args = new Set(process.argv.slice(2));

  if (args.has("--json")) {
    console.log(JSON.stringify(mapa, null, 2));
    process.exit(0);
  }

  const inertes = mapa.alvos.filter((a) => a.estado === "INERTE");
  const orfaos = mapa.alvos.filter((a) => a.estado === "ORFAO");

  if (args.has("--inertes")) {
    for (const a of [...inertes, ...orfaos]) console.log(`${a.estado}\t${a.nome}`);
    process.exit(0);
  }

  console.log("MAPA DE COBERTURA -- quem roda cada alvo, e esse alguem da partida\n");

  console.log("Os workflows:\n");
  for (const w of mapa.workflows) {
    const folga = TETO_DE_BYTES_DO_WORKFLOW - w.bytes;
    const veredito = !w.daPartida
      ? `NAO DA PARTIDA (${(-folga).toLocaleString("pt-BR")} bytes ACIMA do teto)`
      : w.emAlarme
        ? `da partida, mas em ALARME (${folga.toLocaleString("pt-BR")} bytes de folga)`
        : `da partida (${folga.toLocaleString("pt-BR")} bytes de folga)`;
    console.log(`  ${w.nome.padEnd(20)} ${w.bytes.toLocaleString("pt-BR").padStart(9)} bytes  ${veredito}`);
  }

  console.log("\nOs alvos, por familia:\n");
  const familias = ["test", "mutantes", "check"];
  for (const familia of familias) {
    const daFamilia = mapa.alvos.filter((a) => a.familia === familia);
    const conta = (e) => daFamilia.filter((a) => a.estado === e).length;
    console.log(
      `  ${familia.padEnd(9)} ${String(daFamilia.length).padStart(3)} alvos  ` +
        `RODA ${String(conta("RODA")).padStart(3)}  ` +
        `INERTE ${String(conta("INERTE")).padStart(3)}  ` +
        `ORFAO ${String(conta("ORFAO")).padStart(3)}`,
    );
  }

  if (inertes.length > 0) {
    console.log(
      `\nINERTE -- ${inertes.length} alvos declarados SO em workflow que nao da partida.\n` +
        "Cada um destes parece cobertura e nao roda em PR nenhum:\n",
    );
    for (const a of inertes) console.log(`  ${a.nome.padEnd(46)} so em ${a.invocadoPor.join(", ")}`);
  }

  if (orfaos.length > 0) {
    console.log(`\nORFAO -- ${orfaos.length} alvos que workflow nenhum cita:\n`);
    for (const a of orfaos) console.log(`  ${a.nome}`);
  }

  const rodando = mapa.alvos.filter((a) => a.estado === "RODA").length;
  console.log(
    `\nResumo: ${rodando} de ${mapa.alvos.length} alvos de verificacao rodam em CI. ` +
      `${inertes.length} inertes, ${orfaos.length} orfaos.`,
  );
  process.exit(0);
}
