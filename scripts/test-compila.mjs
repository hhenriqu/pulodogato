// As regras do reaproveitamento da compilacao compartilhada (HMO-263).
//
// POR QUE ESTA SUITE EXISTE
// -------------------------
// Antes da HMO-263, cada alvo `test:*` comecava com `rm -rf .tmp-<nome>` e
// compilava do zero. Era lento (97 invocacoes de tsc, 285s) mas tinha uma
// propriedade barata de enxergar: a suite SEMPRE rodava sobre o codigo de
// agora.
//
// Agora um lote compila os 97 de uma vez e cada alvo reaproveita a saida. Isso
// troca tempo por uma decisao: "esta saida ainda vale?". Se essa decisao errar
// para o lado do "vale", o estrago e o pior tipo deste repositorio -- um
// controle negativo ficaria verde sobre o artefato de antes, e o rotulo do
// step diria que o mutante morreu quando ele nunca foi compilado. Ja aconteceu
// aqui: um `.tmp-*` compilado guardou o mutante depois do restore da fonte.
//
// Entao a decisao e por sha256 do CONTEUDO das entradas, e e isto que esta
// suite fixa. O caso 3 e o que protege os controles negativos; o caso 4 e o
// que prova que a decisao nao e por data de modificacao -- uma implementacao
// por mtime passaria no 3 e falharia no 4, e seria fragil justamente onde o
// git mexe em mtime sem mexer em conteudo.
//
// A fixture vive dentro do repositorio de proposito: o `compila.mjs` so
// hasheia entradas abaixo da raiz (fora dela sao dependencias, cobertas pelo
// hash do package-lock), entao uma fixture em /tmp nao exercitaria nada.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, utimesSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const FIXTURE = path.join(RAIZ, process.env.FIXTURE ?? ".tmp-compila-fixture");
const FONTES = path.join(FIXTURE, "src");
const SAIDA = path.join(FIXTURE, "out");
const TSCONFIG = path.join(FIXTURE, "tsconfig.json");

/** Monta a fixture do zero: dois modulos, um importando o outro. */
function montarFixture({ somaErrada = false } = {}) {
  rmSync(FIXTURE, { recursive: true, force: true });
  mkdirSync(FONTES, { recursive: true });

  writeFileSync(
    path.join(FONTES, "soma.ts"),
    somaErrada
      ? `export function soma(a: number, b: number): number { return "isto nao e numero"; }\n`
      : `export function soma(a: number, b: number): number { return a + b; }\n`,
  );
  writeFileSync(
    path.join(FONTES, "principal.ts"),
    `import { soma } from "./soma";\nexport const dois = soma(1, 1);\n`,
  );
  writeFileSync(
    TSCONFIG,
    JSON.stringify(
      {
        compilerOptions: {
          outDir: "./out",
          module: "es2020",
          target: "es2020",
          moduleResolution: "node",
          skipLibCheck: true,
        },
        include: ["./src/**/*.ts"],
      },
      null,
      2,
    ),
  );
}

/** Roda o compila.mjs na fixture. Devolve { saida, codigo, aproveitou }. */
function compilar() {
  let saida;
  let codigo = 0;
  try {
    saida = execFileSync("node", ["scripts/compila.mjs", "-p", path.relative(RAIZ, TSCONFIG)], {
      cwd: RAIZ,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (erro) {
    codigo = erro.status ?? 1;
    saida = `${erro.stdout ?? ""}${erro.stderr ?? ""}`;
  }
  return { saida, codigo, aproveitou: /aproveitado do lote/.test(saida) };
}

const manifesto = () => path.join(SAIDA, ".compilado.json");

test("compila do zero, emite o JS e deixa um manifesto", () => {
  montarFixture();
  const r = compilar();
  assert.equal(r.codigo, 0, `compila.mjs devia ter passado:\n${r.saida}`);
  assert.equal(r.aproveitou, false, "a primeira compilacao nao tem o que aproveitar");
  assert.ok(existsSync(path.join(SAIDA, "principal.js")), "o JS emitido tem que existir");
  assert.ok(existsSync(manifesto()), "o manifesto tem que existir");

  const m = JSON.parse(readFileSync(manifesto(), "utf8"));
  assert.ok(m.entradas["src/soma.ts".replace("src", path.relative(RAIZ, FONTES))] || Object.keys(m.entradas).some((k) => k.endsWith("soma.ts")), "soma.ts tem que estar nas entradas hasheadas");
  assert.ok(Object.keys(m.entradas).some((k) => k.endsWith("principal.ts")), "principal.ts tem que estar nas entradas");
});

test("a segunda chamada aproveita, sem recompilar", () => {
  montarFixture();
  assert.equal(compilar().codigo, 0);
  const r = compilar();
  assert.equal(r.codigo, 0, `a segunda chamada devia passar:\n${r.saida}`);
  assert.equal(r.aproveitou, true, `a segunda chamada devia ter aproveitado:\n${r.saida}`);
});

test("mudar o CONTEUDO de uma entrada forca recompilacao -- e o que mata o mutante", () => {
  montarFixture();
  assert.equal(compilar().codigo, 0);
  assert.equal(compilar().aproveitou, true, "pre-condicao: estava aproveitando");

  // O mutante: troca `a + b` por `a - b`, como um controle negativo faria.
  const arquivo = path.join(FONTES, "soma.ts");
  writeFileSync(arquivo, readFileSync(arquivo, "utf8").replace("a + b", "a - b"));

  const r = compilar();
  assert.equal(r.codigo, 0);
  assert.equal(r.aproveitou, false, "a mutacao TEM que forcar recompilacao, senao o mutante morre verde");
  assert.match(
    readFileSync(path.join(SAIDA, "soma.js"), "utf8"),
    /a - b/,
    "o JS emitido tem que conter a mutacao, nao o codigo de antes",
  );
});

test("voltar a fonte ao original tambem forca recompilacao -- o restore do mutante", () => {
  montarFixture();
  assert.equal(compilar().codigo, 0);

  const arquivo = path.join(FONTES, "soma.ts");
  const original = readFileSync(arquivo, "utf8");
  writeFileSync(arquivo, original.replace("a + b", "a - b"));
  assert.equal(compilar().aproveitou, false, "a mutacao forca recompilacao");

  // Restaurado: o hash deixa de casar com o manifesto que o mutante escreveu.
  writeFileSync(arquivo, original);
  const r = compilar();
  assert.equal(r.aproveitou, false, "o restore TEM que recompilar, senao sobra o JS do mutante");
  assert.match(readFileSync(path.join(SAIDA, "soma.js"), "utf8"), /a \+ b/);
});

test("mexer so na DATA do arquivo nao recompila: a decisao e por conteudo", () => {
  montarFixture();
  assert.equal(compilar().codigo, 0);

  // Um `git checkout` mexe em mtime sem mexer em conteudo. Uma implementacao
  // por data recompilaria os 97 alvos aqui e devolveria os 285s.
  const arquivo = path.join(FONTES, "soma.ts");
  const daqui = new Date(Date.now() + 60_000);
  utimesSync(arquivo, daqui, daqui);

  assert.equal(compilar().aproveitou, true, "mtime novo com conteudo igual tem que continuar aproveitando");
});

test("apagar um arquivo emitido forca recompilacao", () => {
  montarFixture();
  assert.equal(compilar().codigo, 0);
  rmSync(path.join(SAIDA, "principal.js"));

  const r = compilar();
  assert.equal(r.aproveitou, false, "saida incompleta nao e estado aproveitavel");
  assert.ok(existsSync(path.join(SAIDA, "principal.js")), "o arquivo tem que voltar");
});

test("mudar o tsconfig forca recompilacao", () => {
  montarFixture();
  assert.equal(compilar().codigo, 0);

  const cfg = JSON.parse(readFileSync(TSCONFIG, "utf8"));
  cfg.compilerOptions.target = "es2017";
  writeFileSync(TSCONFIG, JSON.stringify(cfg, null, 2));

  assert.equal(compilar().aproveitou, false, "opcao de compilacao diferente nao pode aproveitar saida velha");
});

test("erro de tipo reprova e NAO deixa manifesto aproveitavel", () => {
  montarFixture({ somaErrada: true });
  const r = compilar();
  assert.equal(r.codigo, 1, `erro de tipo tem que sair 1:\n${r.saida}`);
  assert.equal(existsSync(manifesto()), false, "compilacao com erro nao pode virar estado aproveitavel");

  // E o erro tem que continuar aparecendo na chamada seguinte, nao sumir num
  // "aproveitado" -- um erro que aparece uma vez e some e pior que nenhum.
  const r2 = compilar();
  assert.equal(r2.codigo, 1, "o erro tem que reaparecer, nao ser aproveitado");
});

test("raiz que nao e .ts reprova em vez de compilar nada em silencio", () => {
  // O caso real: `-p` perdido no corte dos argumentos faz o tsconfig.json
  // entrar como arquivo-fonte. O alvo emitia zero arquivos e saia com sucesso.
  montarFixture();
  let codigo = 0;
  let saida = "";
  try {
    saida = execFileSync("node", ["scripts/compila.mjs", path.relative(RAIZ, TSCONFIG)], {
      cwd: RAIZ,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (erro) {
    codigo = erro.status ?? 1;
    saida = `${erro.stdout ?? ""}${erro.stderr ?? ""}`;
  }
  assert.equal(codigo, 1, `devia reprovar, e saiu:\n${saida}`);
  assert.match(saida, /nao e \.ts/, "a mensagem tem que dizer qual e o problema");
});

test("o lote entende a invocacao de TODOS os alvos test:* do package.json", () => {
  // A erosao que isto pega: alguem escreve um alvo novo numa forma que o
  // `--todas` nao sabe ler. Nada quebra -- o alvo so volta a compilar sozinho,
  // devagar -- e os minutos de CI voltam sem ninguem notar.
  const pkg = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8"));
  const alvos = Object.entries(pkg.scripts).filter(([n]) => n.startsWith("test:"));
  const compilam = alvos.filter(([, cmd]) => /compila\.mjs|(^|&&)\s*tsc\s/.test(cmd));

  assert.ok(compilam.length > 50, `esperava dezenas de alvos que compilam, achei ${compilam.length}`);

  for (const [nome, cmd] of compilam) {
    for (const parte of cmd.split("&&").map((s) => s.trim())) {
      if (!/^node\s+scripts\/compila\.mjs\s/.test(parte)) continue;
      const args = parte.split(/\s+/).slice(2);
      assert.ok(
        args.includes("-p") || args.some((a) => /\.tsx?$/.test(a)),
        `${nome}: o lote nao acharia o que compilar em "${parte}"`,
      );
    }
  }
});
