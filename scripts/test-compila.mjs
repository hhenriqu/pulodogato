// As regras do reaproveitamento da compilacao compartilhada (HMO-263).
//
// POR QUE ESTA SUITE EXISTE
// -------------------------
// Antes da HMO-263, cada alvo `test:*` comecava com `rm -rf .tmp-<nome>` e
// compilava do zero. Era lento (98 invocacoes de tsc, 209s medidos) mas tinha
// uma propriedade barata de enxergar: a suite SEMPRE rodava sobre o codigo de
// agora.
//
// Agora um lote compila os 98 de uma vez e cada alvo reaproveita a saida. Isso
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
// Os dois ultimos casos cuidam do caminho FRIO, que e o dos mutantes: alvo sem
// manifesto compila pelo `tsc` e nao deixa estado aproveitavel, e os dois
// caminhos de emissao tem que produzir o mesmo byte.
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

import ts from "typescript";
import {
  compilarComSobrescritas,
  baldeDasOpcoes,
  lerFonteCompartilhada,
  resolverInvocacao,
} from "./compila.mjs";

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

/**
 * Roda o compila.mjs na fixture. Devolve { saida, codigo, aproveitou }.
 *
 * `semear: true` e o que o lote (`--todas`) faz com cada alvo: compila em
 * processo e deixa manifesto. Sem ele, um alvo frio e delegado ao `tsc` e nao
 * deixa manifesto -- entao os casos que conferem reaproveitamento precisam
 * SEMEAR primeiro, senao estariam medindo um estado que nunca existe.
 */
function compilar({ semear = false } = {}) {
  let saida;
  let codigo = 0;
  const args = ["scripts/compila.mjs"];
  if (semear) args.push("--semeia");
  args.push("-p", path.relative(RAIZ, TSCONFIG));
  try {
    saida = execFileSync("node", args, {
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
  const r = compilar({ semear: true });
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
  assert.equal(compilar({ semear: true }).codigo, 0);
  const r = compilar();
  assert.equal(r.codigo, 0, `a segunda chamada devia passar:\n${r.saida}`);
  assert.equal(r.aproveitou, true, `a segunda chamada devia ter aproveitado:\n${r.saida}`);
});

test("mudar o CONTEUDO de uma entrada forca recompilacao -- e o que mata o mutante", () => {
  montarFixture();
  assert.equal(compilar({ semear: true }).codigo, 0);
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
  assert.equal(compilar({ semear: true }).codigo, 0);

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
  assert.equal(compilar({ semear: true }).codigo, 0);

  // Um `git checkout` mexe em mtime sem mexer em conteudo. Uma implementacao
  // por data recompilaria os 98 alvos aqui e devolveria os 209s.
  const arquivo = path.join(FONTES, "soma.ts");
  const daqui = new Date(Date.now() + 60_000);
  utimesSync(arquivo, daqui, daqui);

  assert.equal(compilar().aproveitou, true, "mtime novo com conteudo igual tem que continuar aproveitando");
});

test("apagar um arquivo emitido forca recompilacao", () => {
  montarFixture();
  assert.equal(compilar({ semear: true }).codigo, 0);
  rmSync(path.join(SAIDA, "principal.js"));

  const r = compilar();
  assert.equal(r.aproveitou, false, "saida incompleta nao e estado aproveitavel");
  assert.ok(existsSync(path.join(SAIDA, "principal.js")), "o arquivo tem que voltar");
});

test("mudar o tsconfig forca recompilacao", () => {
  montarFixture();
  assert.equal(compilar({ semear: true }).codigo, 0);

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

test("alvo frio, fora do lote, compila pelo tsc e nao deixa manifesto", () => {
  // Por que isto importa: os 24 blocos de controle negativo rodam a suite numa
  // COPIA da arvore, em diretorio temporario, uma vez por mutante. La nunca ha
  // manifesto, entao o caminho em processo seria travessia pura sem nenhum
  // reaproveitamento para pagar a conta -- medido, 20% mais lento que o `tsc`.
  //
  // Nao deixar manifesto tambem e a parte segura: o estado aproveitavel so e
  // criado por quem sabe preenche-lo, e na duvida recompila-se.
  montarFixture();
  const r = compilar();
  assert.equal(r.codigo, 0, `o alvo frio devia compilar:\n${r.saida}`);
  assert.equal(r.aproveitou, false, "frio nao tem o que aproveitar");
  assert.ok(existsSync(path.join(SAIDA, "principal.js")), "o JS tem que ser emitido pelo tsc");
  assert.equal(existsSync(manifesto()), false, "o caminho frio nao deixa manifesto");

  // E por nao deixar manifesto, a chamada seguinte tambem e fria -- nunca
  // aproveita um estado que nao foi semeado.
  assert.equal(compilar().aproveitou, false, "sem semear, nunca aproveita");
});

test("o tsc e o caminho em processo emitem o MESMO byte", () => {
  // A troca entre os dois caminhos so e segura porque a saida e a mesma. Esta
  // assercao e o que impede os dois de divergirem sem ninguem ver.
  montarFixture();
  assert.equal(compilar().codigo, 0, "primeiro pelo tsc");
  const peloTsc = readFileSync(path.join(SAIDA, "soma.js"), "utf8");

  montarFixture();
  assert.equal(compilar({ semear: true }).codigo, 0, "agora em processo");
  const emProcesso = readFileSync(path.join(SAIDA, "soma.js"), "utf8");

  assert.equal(emProcesso, peloTsc, "os dois caminhos tem que emitir identico");
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

// ---------------------------------------------------------------------------
// O caminho dos MUTANTES: compilarComSobrescritas (HMO-319)
// ---------------------------------------------------------------------------
// Os tres casos acima protegem o lote, que decide "esta saida ainda vale?" por
// sha256. O caminho dos mutantes nao tem essa decisao -- ele reaproveita o AST
// das fontes NAO mutadas, guardado no `cacheDeFontes` do processo -- e por isso
// erra de outra forma: se o texto MUTADO entrasse no cache, a volta seguinte
// leria o AST da volta anterior. O placar entao diria "morreu" sobre codigo que
// ninguem compilou, e o controle positivo passaria lendo o ultimo mutante.
//
// Era o unico mecanismo da HMO-319 sem caso proprio aqui: a suite cobria o lote
// e nao o cache compartilhado entre voltas.

const ARGUMENTOS = () => ["-p", path.relative(RAIZ, TSCONFIG)];
const SAIDA_DO_MUTANTE = () => path.join(FIXTURE, "out-mutante");
const ALVO = () => path.relative(RAIZ, path.join(FONTES, "soma.ts"));

const somaQue = (corpo) =>
  `export function soma(a: number, b: number): number { return ${corpo}; }\n`;

test("sobrescritas: a fonte mutada NAO entra no cache, e a volta seguinte nao a le", () => {
  montarFixture();
  const fora = SAIDA_DO_MUTANTE();

  const controle = compilarComSobrescritas({ argumentos: ARGUMENTOS(), outDir: fora });
  assert.equal(controle.erros, 0, `o controle devia compilar:\n${controle.mensagens.join("\n")}`);
  const doControle = controle.emitidos.get("soma.js");
  assert.ok(doControle, `esperava soma.js emitido, vieram: ${[...controle.emitidos.keys()]}`);

  const mutado = compilarComSobrescritas({
    argumentos: ARGUMENTOS(),
    outDir: fora,
    sobrescritas: { [ALVO()]: somaQue("a - b") },
  });
  assert.equal(mutado.erros, 0, `o mutante devia compilar:\n${mutado.mensagens.join("\n")}`);
  assert.notEqual(
    mutado.emitidos.get("soma.js"),
    doControle,
    "a mutacao tinha que mudar o byte emitido -- sem isso o resto do caso nao mede nada",
  );

  // A TRAVA. Sem sobrescritas, o byte tem que voltar a ser o do controle.
  const depois = compilarComSobrescritas({ argumentos: ARGUMENTOS(), outDir: fora });
  assert.equal(
    depois.emitidos.get("soma.js"),
    doControle,
    "a volta sem sobrescritas emitiu o byte do MUTANTE anterior: o texto mutado " +
      "entrou no cacheDeFontes, e nesse estado todo mutante seguinte morre verde",
  );
});

test("sobrescritas: dois mutantes seguidos no mesmo arquivo nao dividem a saida", () => {
  montarFixture();
  const fora = SAIDA_DO_MUTANTE();
  const emitir = (corpo) =>
    compilarComSobrescritas({
      argumentos: ARGUMENTOS(),
      outDir: fora,
      sobrescritas: { [ALVO()]: somaQue(corpo) },
    }).emitidos.get("soma.js");

  assert.notEqual(
    emitir("a - b"),
    emitir("a * b"),
    "cada volta tem que reparsear o arquivo mutado; byte igual aqui significa " +
      "que a segunda leu a primeira",
  );
});

test("sobrescritas: a volta do mutante nao deixa manifesto aproveitavel", () => {
  // A segunda trava da HMO-263, aqui no caminho novo: manifesto so nasce de
  // quem semeia. Um manifesto no outDir do mutante reintroduziria exatamente a
  // decisao "esta saida ainda vale?" no lugar onde errar sai mais caro.
  montarFixture();
  const fora = SAIDA_DO_MUTANTE();
  compilarComSobrescritas({
    argumentos: ARGUMENTOS(),
    outDir: fora,
    sobrescritas: { [ALVO()]: somaQue("a - b") },
  });
  assert.equal(
    existsSync(path.join(fora, ".compilado.json")),
    false,
    "o outDir de um mutante nao pode ter manifesto",
  );
});

// ---------------------------------------------------------------------------
// O BALDE do cache de fontes: alvos de `jsx` diferente nao dividem AST (HMO-419)
// ---------------------------------------------------------------------------
// Os casos acima protegem o reaproveitamento de SAIDA (o manifesto) e o cache
// entre voltas de mutante. Este bloco protege uma terceira coisa, que nao tinha
// caso nenhum e por isso quebrou: o cache de AST compartilhado entre os 127
// alvos do lote.
//
// O `ts.createProgram` nao le o SourceFile -- ele ESCREVE DE VOLTA nele. Em
// `collectExternalModuleReferences` a primeira linha e `if (file.imports) return;`,
// e o `file.imports` que ele calcula leva imports SINTETIZADOS a partir de
// `jsx`, `jsxImportSource` e `importHelpers`. Com o objeto compartilhado entre
// programas de opcoes diferentes, o segundo programa herda o campo do primeiro.
//
// Na pratica: um alvo `jsx: "react"` compila um .tsx e o campo nasce sem o
// import sintetico; um alvo `jsx: "react-jsx"` que depois reaproveite o mesmo
// objeto estoura no `Debug.assert` do `getJSXRuntimeImportSpecifier`. Era isto
// que derrubava 5 alvos de tela e, com eles, o 5o step do `verificacao` e do
// `db-verify` -- os ~560 steps seguintes dos dois jobs nunca rodavam.
//
// O caso 2 e a regressao; o caso 3 e o controle negativo que prova que o caso 2
// mede o mecanismo e nao o acaso -- com o balde constante (o desenho de antes),
// a MESMA sequencia tem que estourar. Sem ele, o caso 2 passaria verde tambem
// num mundo onde o balde nao fizesse nada.

const FONTES_JSX = path.join(FIXTURE, "src-jsx");
const TSCONFIG_JSX = (sabor) => path.join(FIXTURE, `tsconfig.jsx-${sabor}.json`);

/**
 * Fixture de JSX: um .tsx com um import de topo DE VERDADE, e dois tsconfigs
 * que diferem so no `jsx`.
 *
 * O import de topo nao e enfeite -- e a condicao do estouro. Sem nenhum import,
 * `file.imports` fica vazio, `imports[0]` e `undefined`, o `if (specifier)` do
 * tsc protege o assert e a emissao sai identica. Verificado: um .tsx sem import
 * nao reproduz o defeito, e uma fixture assim daria um caso verde vazio.
 */
function montarFixtureJsx() {
  rmSync(FIXTURE, { recursive: true, force: true });
  mkdirSync(FONTES_JSX, { recursive: true });

  writeFileSync(path.join(FONTES_JSX, "dep.ts"), `export const dep = 1;\n`);
  writeFileSync(
    path.join(FONTES_JSX, "Comp.tsx"),
    `import { dep } from "./dep";\nexport const C = () => <div>{dep}</div>;\n`,
  );

  for (const [sabor, jsx] of [["react", "react"], ["react-jsx", "react-jsx"]]) {
    writeFileSync(
      TSCONFIG_JSX(sabor),
      JSON.stringify(
        {
          compilerOptions: {
            outDir: `./out-jsx-${sabor}`,
            module: "es2020",
            target: "es2020",
            moduleResolution: "node",
            skipLibCheck: true,
            jsx,
            // Com `jsx: "react"` o .tsx referencia o React como global UMD, e
            // um arquivo que e modulo levaria TS2686. Importar o React aqui
            // resolveria o erro mas poria "react" em `imports[0]`; deste jeito
            // quem fica em `imports[0]` e o `./dep`, que e a condicao do
            // estouro que estes casos medem.
            allowUmdGlobalAccess: true,
          },
          include: ["./src-jsx/**/*.ts", "./src-jsx/**/*.tsx"],
        },
        null,
        2,
      ),
    );
  }
}

const ARGS_JSX = (sabor) => ["-p", path.relative(RAIZ, TSCONFIG_JSX(sabor))];

test("balde: jsx, jsxImportSource e importHelpers separam o cache de fontes", () => {
  // Os tres campos que alimentam os imports sintetizados de
  // `collectExternalModuleReferences`. Se um deles deixar de separar balde --
  // porque uma versao nova de tsc mudou o `getKeyForCompilationSettings`, de
  // onde a chave sai -- o defeito volta, e volta como `Debug Failure` num alvo
  // que nao mudou. Esta assercao e o que faz esse dia reprovar aqui primeiro.
  const base = { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 };
  const balde = (extra) => baldeDasOpcoes({ ...base, ...extra });

  assert.notEqual(
    balde({ jsx: ts.JsxEmit.React }),
    balde({ jsx: ts.JsxEmit.ReactJSX }),
    "`jsx: react` e `jsx: react-jsx` NAO podem dividir AST -- e o defeito da HMO-419",
  );
  assert.notEqual(
    balde({ jsx: ts.JsxEmit.ReactJSX }),
    balde({ jsx: ts.JsxEmit.ReactJSX, jsxImportSource: "preact" }),
    "`jsxImportSource` muda o import sintetizado, entao tem que mudar o balde",
  );
  assert.notEqual(
    balde({ importHelpers: true }),
    balde({ importHelpers: false }),
    "`importHelpers` poe o tslib em imports[0] e desloca o indice do jsx",
  );

  // E o contrario: o que NAO muda os imports sintetizados nao pode dividir
  // balde, senao os 127 alvos viram 127 baldes e o lote perde a razao de ser --
  // cada alvo tem o seu proprio outDir, e sao eles que precisam compartilhar.
  assert.equal(
    balde({ jsx: ts.JsxEmit.ReactJSX, outDir: "/a" }),
    balde({ jsx: ts.JsxEmit.ReactJSX, outDir: "/b" }),
    "`outDir` nao pode separar balde -- se separasse, nao haveria compartilhamento nenhum",
  );
});

test("balde: react e depois react-jsx no mesmo processo compilam os dois", () => {
  montarFixtureJsx();

  const comReact = compilarComSobrescritas({
    argumentos: ARGS_JSX("react"),
    outDir: path.join(FIXTURE, "fora-react"),
  });
  assert.equal(comReact.erros, 0, `o alvo react devia compilar:\n${comReact.mensagens.join("\n")}`);

  // A ordem importa: so o `react-jsx` consulta `imports[0]`, entao e o SEGUNDO
  // que estoura. Invertida, a sequencia passa mesmo com o defeito presente.
  const comReactJsx = compilarComSobrescritas({
    argumentos: ARGS_JSX("react-jsx"),
    outDir: path.join(FIXTURE, "fora-react-jsx"),
  });
  assert.equal(
    comReactJsx.erros,
    0,
    `o alvo react-jsx devia compilar depois do react:\n${comReactJsx.mensagens.join("\n")}`,
  );

  // E nao basta "nao estourou": a saida tem que ser a do react-jsx de verdade.
  // Um conserto que silenciasse o assert deixaria o `_jsx` sem de onde vir.
  const emitido = readFileSync(path.join(FIXTURE, "fora-react-jsx", "Comp.js"), "utf8");
  assert.match(
    emitido,
    /from "react\/jsx-runtime"/,
    `o react-jsx tem que emitir o import do jsx-runtime, e emitiu:\n${emitido}`,
  );
  const doReact = readFileSync(path.join(FIXTURE, "fora-react", "Comp.js"), "utf8");
  assert.match(doReact, /React\.createElement/, `o react classico tem que emitir createElement:\n${doReact}`);
});

test("controle negativo: com balde CONSTANTE, a mesma sequencia estoura", () => {
  // O desenho de antes da HMO-419: chave de cache sem as opcoes, ou seja um
  // balde so para todo mundo. `lerFonteCompartilhada` com o 4o argumento no
  // default ("") e exatamente isso.
  //
  // Se este caso parar de estourar, o caso de cima deixou de medir o mecanismo
  // -- ou porque o tsc consertou a invariante upstream (e ai o balde e so
  // zelo), ou porque a fixture parou de reproduzir. Nos dois casos quem le esta
  // suite precisa saber, e nao descobrir num job vermelho.
  montarFixtureJsx();

  const compilarComBaldeUnico = (sabor, fora) => {
    const { opcoes: doAlvo, raizes } = resolverInvocacao(ARGS_JSX(sabor));
    const opcoes = { ...doAlvo, outDir: path.resolve(fora) };
    const host = ts.createCompilerHost(opcoes);
    host.getSourceFile = (nome, versao, aoErrar) => lerFonteCompartilhada(nome, versao, aoErrar);
    host.writeFile = () => {};
    ts.createProgram(raizes, opcoes, host).emit();
  };

  compilarComBaldeUnico("react", path.join(FIXTURE, "unico-react"));
  assert.throws(
    () => compilarComBaldeUnico("react-jsx", path.join(FIXTURE, "unico-react-jsx")),
    /synthesized JSX runtime import/,
    "sem o balde, o react-jsx TEM que estourar depois do react -- se nao estoura, " +
      "o caso de cima nao esta provando nada",
  );
});
