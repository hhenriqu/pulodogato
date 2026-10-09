#!/usr/bin/env node
// =====================================================
// CONTROLE NEGATIVO DA GUARDA DE `sed` DOS WORKFLOWS (HMO-231)
// =====================================================
// Roda com:  npm run test:sed-dos-workflows
//
// Uma guarda que varre por PREDICADO DE FORMA tem um jeito silencioso de morrer:
// o predicado para de casar, a varredura mede o conjunto vazio e o boletim sai
// limpo. "0 ancoras mortas" e "nao achei ancora nenhuma" imprimem quase a mesma
// coisa. Por isso cada estado que a guarda recusa tem aqui um caso, e o controle
// POSITIVO -- arvore sintetica intacta sai sem reprovado -- e o que pega o
// "vermelho pelo motivo errado".
//
// AS DUAS METADES, QUE E O QUE O PR #136 ENSINOU
// ----------------------------------------------
// Nao basta exigir que a guarda reprove. O caso 13 prova a outra metade: o MESMO
// padrao quebrado, **sem** a guarda, volta a mentir -- `sed -i` sai 0, nao muda
// um byte, e quem olha o codigo de saida conclui que plantou o defeito. Sem essa
// metade o controle provaria apenas que a mensagem nova existe, nao que a guarda
// e quem trabalha.
//
// TUDO EM /tmp, E DE PROPOSITO
// ----------------------------
// Nenhum caso aqui escreve na arvore. A fonte sintetica e o workflow sintetico
// nascem num `mkdtempSync`, e por isso este arquivo nao tem `trap` nem nada para
// restaurar: morrer no meio (SIGTERM, SIGKILL, timeout do runner) nao deixa
// mutante gravado em `.github/` nem em `lib/`. E a regra que o
// `check-mutacao-no-lugar.mjs` cobra dos runners novos, e o motivo dela esta
// medido no cabecalho dele: um runner que muta no lugar e morre no meio faz TODA
// medicao seguinte ler o arquivo errado.
//
// O CRITERIO E IMPORTADO, NUNCA REESCRITO
// ---------------------------------------
// Os vereditos saem de `varrer` e `reprovados` do proprio
// `check-sed-dos-workflows.mjs`. Um controle que reimplementa o criterio passa a
// medir a copia, e fica verde justamente quando a guarda de verdade muda de
// opiniao.
// =====================================================

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { varrer, reprovados, padraoDaExpressao, recortarSed } from "./check-sed-dos-workflows.mjs";

let falhas = 0;
let casos = 0;

function ok(nome, condicao, detalhe = "") {
  casos++;
  if (condicao) {
    console.log(`  ok   ${nome}`);
  } else {
    falhas++;
    console.log(`  FALHA ${nome}${detalhe ? `\n        ${detalhe}` : ""}`);
  }
}

/**
 * Monta uma arvore sintetica: `<raiz>/.github/workflows/<nome>.yml` e os
 * arquivos alvo que o caso precisar. Devolve a raiz.
 */
function arvore(arquivos) {
  const raiz = mkdtempSync(join(tmpdir(), "hmo231-"));
  for (const [rel, conteudo] of Object.entries(arquivos)) {
    const caminho = join(raiz, rel);
    mkdirSync(join(caminho, "..").replace(/\/\.\.$/, ""), { recursive: true });
    mkdirSync(caminho.split("/").slice(0, -1).join("/"), { recursive: true });
    writeFileSync(caminho, conteudo);
  }
  return raiz;
}

function medir(raiz) {
  const achados = varrer({ raiz, dirWorkflows: join(raiz, ".github", "workflows") });
  return { achados, fora: reprovados(achados) };
}

function passo(nome, corpo) {
  return `jobs:\n  j:\n    steps:\n      - name: ${nome}\n        run: |\n${corpo
    .split("\n")
    .map((l) => `          ${l}`)
    .join("\n")}\n`;
}

// -----------------------------------------------------------------------------
console.log("\n1) CONTROLE POSITIVO: ancora intacta nao reprova nada");
// Se este caso falhar, todos os outros viram vacuos: um criterio que reprova
// tudo "pega" qualquer defeito plantado sem medir nada.
{
  // O passo em ordem nos DOIS quesitos: ancora viva E prova local. Um dos dois
  // faltando ja reprova (casos 2 e 11b), entao o controle positivo precisa dos
  // dois -- senao ele mediria "a guarda reprova tudo".
  const raiz = arvore({
    ".github/workflows/x.yml": passo(
      "planta",
      `cp lib/alvo.ts lib/alvo.ts.orig\nsed -i 's#const a = 1;#const a = 2;#' lib/alvo.ts\nif cmp -s lib/alvo.ts lib/alvo.ts.orig; then exit 1; fi\nnpm run test:x`,
    ),
    "lib/alvo.ts": "const a = 1;\n",
  });
  const { achados, fora } = medir(raiz);
  ok("um `sed` lido", achados.length === 1, `leu ${achados.length}`);
  ok("estado CASOU", achados[0]?.estado === "CASOU", `estado=${achados[0]?.estado}`);
  ok("tem prova local", achados[0]?.temProvaLocal === true, `provadoPor=${achados[0]?.provadoPor}`);
  ok("nenhum reprovado", fora.length === 0, JSON.stringify(fora.map((f) => f.estado)));
  rmSync(raiz, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
console.log("\n2) ANCORA MORTA: o padrao nao casa, e a guarda reprova dizendo isso");
{
  const raiz = arvore({
    ".github/workflows/x.yml": passo("planta", `sed -i 's#const a = 1;#const a = 2;#' lib/alvo.ts`),
    "lib/alvo.ts": "const a = 99;\n",
  });
  const { achados, fora } = medir(raiz);
  ok("estado ANCORA_MORTA", achados[0]?.estado === "ANCORA_MORTA", `estado=${achados[0]?.estado}`);
  ok("reprova", fora.length === 1, `reprovados=${fora.length}`);
  ok(
    "a frase manda consertar o WORKFLOW, nao o codigo",
    /ANCORA MORTA/.test(fora[0]?.frase || "") && /CONSERTE O PADRAO NESTE WORKFLOW/.test(fora[0]?.frase || ""),
    fora[0]?.frase,
  );
  rmSync(raiz, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
console.log("\n3) A REGRESSAO DA HMO-185: a refatoracao dedentou a linha");
// O caso real que custou 57 runs vermelhos. O padrao ancora a indentacao com
// `^` e `$`; a refatoracao tirou dois espacos. O arquivo segue CORRETO -- e o
// workflow e que ficou errado.
{
  const raiz = arvore({
    ".github/workflows/x.yml": passo("planta", `sed -i '/^      <\\/Link>$/d' components/Menu.tsx`),
    "components/Menu.tsx": "    </Link>\n",
  });
  const { achados, fora } = medir(raiz);
  ok("ancora morta pela indentacao", achados[0]?.estado === "ANCORA_MORTA", `estado=${achados[0]?.estado}`);
  ok("reprova", fora.length === 1);

  // E com a indentacao de antes, a MESMA ancora casa -- senao o caso acima
  // estaria medindo um padrao quebrado por outro motivo.
  const raiz2 = arvore({
    ".github/workflows/x.yml": passo("planta", `sed -i '/^      <\\/Link>$/d' components/Menu.tsx`),
    "components/Menu.tsx": "      </Link>\n",
  });
  ok("a mesma ancora casa com a indentacao de antes", medir(raiz2).achados[0]?.estado === "CASOU");
  rmSync(raiz, { recursive: true, force: true });
  rmSync(raiz2, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
console.log("\n4) O PADRAO E REGEX, NAO TEXTO: `includes()` daria falso negativo");
// Os tres padroes que o primeiro passe da HMO-199 julgou mortos por compara-los
// como literal. Todos os tres CASAM, e a guarda tem de dizer isso.
{
  const tres = [
    ["classe e quantificador", `sed -i 's/--success: [0-9.]* [0-9.]*%/--success: 1 2%/' app/globals.css`, "app/globals.css", "  --success: 142.1 70.6%;\n"],
    ["ancora de linha", `sed -i 's#^    </Card>$#x#' lib/Lista.tsx`, "lib/Lista.tsx", "    </Card>\n"],
    ["ponto escapado", `sed -i '/^\\/\\.tmp-recorrencia-edicao\\/$/d' .gitignore`, ".gitignore", "/.tmp-recorrencia-edicao/\n"],
  ];
  for (const [nome, linha, alvo, conteudo] of tres) {
    const raiz = arvore({ ".github/workflows/x.yml": passo("planta", linha), [alvo]: conteudo });
    const { achados } = medir(raiz);
    ok(`casa: ${nome}`, achados[0]?.estado === "CASOU", `estado=${achados[0]?.estado} padrao=${JSON.stringify(achados[0]?.padrao)}`);
    // E o controle do controle: um `includes()` literal reprovaria este mesmo
    // padrao. Se algum dia o padrao virar literal no arquivo, este caso para de
    // medir dialeto -- entao exigimos que ele NAO seja literal.
    ok(`e regex de verdade: ${nome}`, !conteudo.includes(achados[0]?.padrao ?? "\u0000"), `padrao=${JSON.stringify(achados[0]?.padrao)}`);
    rmSync(raiz, { recursive: true, force: true });
  }
}

// -----------------------------------------------------------------------------
console.log("\n5) O DIALETO E BRE, NAO ERE: parentese e literal");
// `sed` sem `-E` usa BRE, onde `(` e literal. Compilado como ERE isto seria um
// grupo de captura e o padrao casaria `Boolean categoria` -- a guarda estaria
// medindo um padrao que o `sed` nao usa.
{
  const raiz = arvore({
    ".github/workflows/x.yml": passo("planta", `sed -i 's#return Boolean(categoria) \\&\\& ok;#return ok;#' lib/r.ts`),
    "lib/r.ts": "return Boolean(categoria) && ok;\n",
  });
  ok("BRE: `(` literal casa o parentese de verdade", medir(raiz).achados[0]?.estado === "CASOU");
  rmSync(raiz, { recursive: true, force: true });

  // O mesmo padrao contra um arquivo SEM os parenteses tem de dar ancora morta.
  // Em ERE casaria, porque `(categoria)` seria grupo e sumiria do texto.
  const raiz2 = arvore({
    ".github/workflows/x.yml": passo("planta", `sed -i 's#return Boolean(categoria) \\&\\& ok;#return ok;#' lib/r.ts`),
    "lib/r.ts": "return Booleancategoria && ok;\n",
  });
  ok("BRE: sem o parentese, ancora morta (em ERE casaria)", medir(raiz2).achados[0]?.estado === "ANCORA_MORTA");
  rmSync(raiz2, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
console.log("\n6) VARIAVEL DE SHELL: `REGRAS=lib/x.ts` e depois `$REGRAS`");
{
  const raiz = arvore({
    ".github/workflows/x.yml": passo("planta", `REGRAS=lib/regras.ts\nsed -i 's#const a = 1;#const a = 2;#' $REGRAS`),
    "lib/regras.ts": "const a = 1;\n",
  });
  const { achados } = medir(raiz);
  ok("resolve `$REGRAS` e casa", achados[0]?.estado === "CASOU", `estado=${achados[0]?.estado} alvo=${achados[0]?.alvo}`);
  ok("o alvo resolvido aparece no achado", achados[0]?.alvo === "lib/regras.ts", `alvo=${achados[0]?.alvo}`);
  rmSync(raiz, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
console.log("\n7) VARIAVEL NO PADRAO: `PADRAO=...` e depois \"s|$PADRAO|...|\"");
{
  const raiz = arvore({
    ".github/workflows/x.yml": passo("planta", `PADRAO='if (ehFatura(p)) {'\nALCANCE=lib/alcance.ts\nsed -i "s|$PADRAO|if (false) {|" $ALCANCE`),
    "lib/alcance.ts": "if (ehFatura(p)) {\n",
  });
  ok("resolve o padrao vindo de variavel", medir(raiz).achados[0]?.estado === "CASOU", JSON.stringify(medir(raiz).achados[0]));
  rmSync(raiz, { recursive: true, force: true });

  const raiz2 = arvore({
    ".github/workflows/x.yml": passo("planta", `PADRAO='if (ehFatura(p)) {'\nALCANCE=lib/alcance.ts\nsed -i "s|$PADRAO|if (false) {|" $ALCANCE`),
    "lib/alcance.ts": "if (ehFaturaDoMes(p)) {\n",
  });
  ok("e reprova quando esse padrao morre", medir(raiz2).achados[0]?.estado === "ANCORA_MORTA");
  rmSync(raiz2, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
console.log("\n8) ALVO COM COLCHETE ESCAPADO: `\\[id\\]` e um arquivo que existe");
{
  const raiz = arvore({
    ".github/workflows/x.yml": passo("planta", `ROTA=app/api/x/\\[id\\]/route.ts\nsed -i 's#const a = 1;#const a = 2;#' "$ROTA"`),
    "app/api/x/[id]/route.ts": "const a = 1;\n",
  });
  ok("desescapa o alvo e casa", medir(raiz).achados[0]?.estado === "CASOU", JSON.stringify(medir(raiz).achados[0]));
  rmSync(raiz, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
console.log("\n9) CONTINUACAO DE LINHA: o alvo na linha de baixo");
{
  const raiz = arvore({
    ".github/workflows/x.yml": passo("planta", `sed -i 's|const a = 1;|const a = 2;|' \\\n  utils/env.ts`),
    "utils/env.ts": "const a = 1;\n",
  });
  const { achados } = medir(raiz);
  ok("emenda a continuacao e acha o alvo", achados[0]?.estado === "CASOU", `estado=${achados[0]?.estado} alvo=${achados[0]?.alvo}`);
  rmSync(raiz, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
console.log("\n10) ALVO AUSENTE: arquivo que nao existe reprova com frase propria");
{
  const raiz = arvore({
    ".github/workflows/x.yml": passo("planta", `sed -i 's#a#b#' lib/que-nao-existe.ts`),
  });
  const { achados, fora } = medir(raiz);
  ok("estado ALVO_AUSENTE", achados[0]?.estado === "ALVO_AUSENTE", `estado=${achados[0]?.estado}`);
  ok("frase propria, distinta de ancora morta", /ALVO AUSENTE/.test(fora[0]?.frase || ""), fora[0]?.frase);
  rmSync(raiz, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
console.log("\n11) DINAMICO: sem prova local reprova; com `cmp -s` passa");
// O `sed` dos runners em bloco: `for ... do sed -i "s@$de@$para@"`. Nao ha
// padrao estatico para conferir, e a guarda cobra a prova LOCAL em vez de
// inventar um valor -- ou de absolver calada, que e o estado que mente.
{
  const semProva = arvore({
    ".github/workflows/x.yml": passo(
      "bloco",
      `for m in a b; do\n  de=$(echo x)\n  sed -i "s@$de@y@" lib/alvo.ts\ndone`,
    ),
    "lib/alvo.ts": "x\n",
  });
  const r1 = medir(semProva);
  ok("estado DINAMICO", r1.achados[0]?.estado === "DINAMICO", `estado=${r1.achados[0]?.estado}`);
  ok("reprova sem prova local", r1.fora.length === 1, `reprovados=${r1.fora.length}`);
  ok(
    "frase cita a prova que falta, e diz que o padrao e dinamico",
    /SEM PROVA LOCAL/.test(r1.fora[0]?.frase || "") && /\$de/.test(r1.fora[0]?.frase || ""),
    r1.fora[0]?.frase,
  );
  rmSync(semProva, { recursive: true, force: true });

  const comProva = arvore({
    ".github/workflows/x.yml": passo(
      "bloco",
      `cp lib/alvo.ts lib/alvo.ts.orig\nfor m in a b; do\n  de=$(echo x)\n  sed -i "s@$de@y@" lib/alvo.ts\n  if cmp -s lib/alvo.ts lib/alvo.ts.orig; then exit 1; fi\ndone`,
    ),
    "lib/alvo.ts": "x\n",
  });
  const r2 = medir(comProva);
  ok("segue DINAMICO", r2.achados[0]?.estado === "DINAMICO");
  ok("nao reprova com `cmp -s` no passo", r2.fora.length === 0, JSON.stringify(r2.fora.map((f) => f.frase)));
  rmSync(comProva, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
console.log("\n11b) PROVA LOCAL: cobrada de TODO `sed`, e nas formas que a arvore usa");
// A segunda afirmacao da guarda. O caso 1 (ancora viva, sem prova) tem de
// reprovar: conferir o padrao de fora le a arvore de HOJE, e nao mede o momento
// em que o mutante e plantado.
{
  const sedCru = `cp lib/alvo.ts lib/alvo.ts.orig\nsed -i 's#const a = 1;#const a = 2;#' lib/alvo.ts\nnpm run test:x`;
  const semProva = arvore({ ".github/workflows/x.yml": passo("planta", sedCru), "lib/alvo.ts": "const a = 1;\n" });
  const r = medir(semProva);
  ok("ancora VIVA mas sem prova local reprova", r.fora.length === 1 && /SEM PROVA LOCAL/.test(r.fora[0].frase), JSON.stringify(r.fora.map((f) => f.estado + ":" + f.frase.slice(0, 40))));
  ok("e o estado segue CASOU (a ancora esta viva mesmo)", r.achados[0]?.estado === "CASOU");
  ok("a frase ensina o idioma da arvore", /mutou\(\)/.test(r.fora[0]?.frase || ""), r.fora[0]?.frase);
  rmSync(semProva, { recursive: true, force: true });

  // As cinco formas de prova que a arvore usa, cada uma na janela do `sed`.
  // Sem este caso, acrescentar uma marca nova a lista passaria sem medicao --
  // e marca que FALTA na lista nao e lacuna de cobertura, e falso vermelho
  // sobre um passo que ja prova (foi o que `diff -q` custou: 12 deles).
  const formas = [
    ["cmp -s", `if cmp -s lib/alvo.ts lib/alvo.ts.orig; then exit 1; fi`],
    ["diff -q", `if diff -q lib/alvo.ts.orig lib/alvo.ts > /dev/null; then exit 1; fi`],
    ["git diff --quiet", `if git diff --quiet -- lib/alvo.ts; then exit 1; fi`],
    ["grep -q", `if ! grep -q 'const a = 2;' lib/alvo.ts; then exit 1; fi`],
    ["grep -cF", `CASOU=$(grep -cF 'const a = 2;' lib/alvo.ts)`],
  ];
  for (const [nome, prova] of formas) {
    const raiz = arvore({
      ".github/workflows/x.yml": passo("planta", `cp lib/alvo.ts lib/alvo.ts.orig\nsed -i 's#const a = 1;#const a = 2;#' lib/alvo.ts\n${prova}\nnpm run test:x`),
      "lib/alvo.ts": "const a = 1;\n",
    });
    ok(`prova aceita: \`${nome}\``, medir(raiz).fora.length === 0, JSON.stringify(medir(raiz).fora.map((f) => f.frase.slice(0, 60))));
    rmSync(raiz, { recursive: true, force: true });
  }

  // A PRE-conferencia, o idioma do mutante 10 de `cartoes` e de
  // `lancamento.yml`: `test "$(grep -c ...)" = "1"` ANTES do `sed`. E a forma
  // mais forte (exige UMA ocorrencia, nao apenas uma), e recusa-la seria a
  // guarda mandando consertar justamente o `sed` melhor provado da arvore.
  const prechecado = arvore({
    ".github/workflows/x.yml": passo(
      "planta",
      `test "$(grep -c '^const a = 1;$' lib/alvo.ts)" = "1" || { echo "::error::ancora mudou"; exit 1; }\nsed -i 's#const a = 1;#const a = 2;#' lib/alvo.ts\nnpm run test:x`,
    ),
    "lib/alvo.ts": "const a = 1;\n",
  });
  const rp = medir(prechecado);
  ok("pre-conferencia antes do `sed` conta como prova", rp.fora.length === 0, JSON.stringify(rp.fora.map((f) => f.frase.slice(0, 60))));
  ok("e registra a forma", rp.achados[0]?.provadoPor === "pre-conferencia da ancora antes do sed", `por=${rp.achados[0]?.provadoPor}`);
  rmSync(prechecado, { recursive: true, force: true });

  // Mas a pre-conferencia do `sed` ANTERIOR nao vale para este: a janela para
  // tras fecha no `sed` de cima, senao uma conferencia so absolveria a cadeia
  // inteira -- que e a ressalva do `cartoes.yml` ao contrario.
  const precheckDoAnterior = arvore({
    ".github/workflows/x.yml": passo(
      "planta",
      `test "$(grep -c '^const a = 1;$' lib/alvo.ts)" = "1" || exit 1\nsed -i 's#const a = 1;#const a = 2;#' lib/alvo.ts\nsed -i 's#const b = 1;#const b = 2;#' lib/alvo.ts\nnpm run test:x`,
    ),
    "lib/alvo.ts": "const a = 1;\nconst b = 1;\n",
  });
  const rpa = medir(precheckDoAnterior);
  ok("a pre-conferencia nao vaza para o `sed` seguinte", rpa.fora.length === 1, `reprovados=${rpa.fora.length}`);
  ok("e o reprovado e o segundo", /const b = 1;/.test(rpa.fora[0]?.texto || ""), rpa.fora[0]?.texto);
  rmSync(precheckDoAnterior, { recursive: true, force: true });

  // O idioma `mutou()` -- a maioria dos `sed` da arvore e provada assim.
  const comFuncao = arvore({
    ".github/workflows/x.yml": passo(
      "planta",
      `cp lib/alvo.ts lib/alvo.ts.orig\nmutou() {\n  if cmp -s "$1" "$1.orig"; then\n    echo "::error::nao aplicou"\n    exit 1\n  fi\n}\nsed -i 's#const a = 1;#const a = 2;#' lib/alvo.ts\nmutou lib/alvo.ts 1\nnpm run test:x`,
    ),
    "lib/alvo.ts": "const a = 1;\n",
  });
  const rf = medir(comFuncao);
  ok("chamada de `mutou` conta como prova", rf.fora.length === 0, JSON.stringify(rf.fora.map((f) => f.frase.slice(0, 60))));
  ok("e o achado registra por que foi provado", rf.achados[0]?.provadoPor === "chamada de funcao que prova", `por=${rf.achados[0]?.provadoPor}`);
  rmSync(comFuncao, { recursive: true, force: true });

  // E a funcao que NAO prova nao vale: `planta()` que so muta, sem conferir.
  const funcaoVazia = arvore({
    ".github/workflows/x.yml": passo(
      "planta",
      `planta() {\n  echo "$1"\n}\nsed -i 's#const a = 1;#const a = 2;#' lib/alvo.ts\nplanta lib/alvo.ts\nnpm run test:x`,
    ),
    "lib/alvo.ts": "const a = 1;\n",
  });
  ok("funcao que nao confere nada nao conta como prova", medir(funcaoVazia).fora.length === 1);
  rmSync(funcaoVazia, { recursive: true, force: true });

  // A JANELA FECHA NO CONSUMO: prova que chega depois de a suite rodar nao
  // distingue mais nada -- a suite ja leu a fonte intacta e ja passou.
  const provaTardia = arvore({
    ".github/workflows/x.yml": passo(
      "planta",
      `cp lib/alvo.ts lib/alvo.ts.orig\nsed -i 's#const a = 1;#const a = 2;#' lib/alvo.ts\nnpm run test:x\nif cmp -s lib/alvo.ts lib/alvo.ts.orig; then exit 1; fi`,
    ),
    "lib/alvo.ts": "const a = 1;\n",
  });
  ok("prova DEPOIS da suite nao conta", medir(provaTardia).fora.length === 1, JSON.stringify(medir(provaTardia).fora.map((f) => f.frase.slice(0, 40))));
  rmSync(provaTardia, { recursive: true, force: true });

  // E a prova de UM `sed` nao cobre o `sed` seguinte -- a ressalva que a
  // propria HMO-231 fez sobre `cartoes.yml`: 15 mutacoes, UMA prova.
  const doisSeds = arvore({
    ".github/workflows/x.yml": passo(
      "planta",
      `cp lib/alvo.ts lib/alvo.ts.orig\nsed -i 's#const a = 1;#const a = 2;#' lib/alvo.ts\nif cmp -s lib/alvo.ts lib/alvo.ts.orig; then exit 1; fi\nnpm run test:x\nsed -i 's#const b = 1;#const b = 2;#' lib/alvo.ts\nnpm run test:x`,
    ),
    "lib/alvo.ts": "const a = 1;\nconst b = 1;\n",
  });
  const rd = medir(doisSeds);
  ok("dois `sed`, uma prova: reprova so o descoberto", rd.fora.length === 1, `reprovados=${rd.fora.length}`);
  ok("e e o SEGUNDO", /const b = 1;/.test(rd.fora[0]?.texto || ""), rd.fora[0]?.texto);
  rmSync(doisSeds, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
console.log("\n12) FORMA DESCONHECIDA reprova, em vez de ser ignorada calada");
// Uma forma de `sed` que a guarda nao sabe ler e indistinguivel, no boletim, de
// um `sed` em ordem -- se ela for ignorada. Tem de reprovar e pedir a medicao.
{
  const raiz = arvore({
    ".github/workflows/x.yml": passo("planta", `sed -i 'y/abc/xyz/' lib/alvo.ts`),
    "lib/alvo.ts": "a\n",
  });
  const { achados, fora } = medir(raiz);
  ok("estado FORMA_DESCONHECIDA", achados[0]?.estado === "FORMA_DESCONHECIDA", `estado=${achados[0]?.estado}`);
  ok("reprova", fora.length === 1 && /FORMA NAO MEDIDA/.test(fora[0].frase), fora[0]?.frase);
  rmSync(raiz, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
console.log("\n13) A OUTRA METADE: sem a guarda, o padrao quebrado VOLTA A MENTIR");
// Esta e a metade que o PR #136 ensinou a exigir. Nao basta a guarda reprovar;
// e preciso que o estado que ela reprova seja, de fato, o estado que engana --
// senao a guarda estaria cobrando zelo, nao defeito.
{
  const dir = mkdtempSync(join(tmpdir(), "hmo231-mecanismo-"));
  const alvo = join(dir, "alvo.ts");
  writeFileSync(alvo, "const a = 99;\n");
  const antes = readFileSync(alvo, "utf8");

  // O MESMO padrao morto do caso 2.
  const r = spawnSync("sed", ["-i", "s#const a = 1;#const a = 2;#", alvo], { encoding: "utf8" });
  const depois = readFileSync(alvo, "utf8");

  ok("o `sed` que nao casa SAI 0 (e por isso o `if` seguinte confia nele)", r.status === 0, `status=${r.status}`);
  ok("e nao muda um byte", antes === depois, `antes=${JSON.stringify(antes)} depois=${JSON.stringify(depois)}`);
  ok(
    "ou seja: o estado que a guarda reprova e mesmo o estado que mente",
    r.status === 0 && antes === depois,
  );

  // E o contraste: o padrao VIVO sai 0 e MUDA. E o que distingue os dois
  // estados, que o codigo de saida do `sed` nao distingue.
  writeFileSync(alvo, "const a = 1;\n");
  const r2 = spawnSync("sed", ["-i", "s#const a = 1;#const a = 2;#", alvo], { encoding: "utf8" });
  ok(
    "o padrao vivo tambem sai 0, mas muda o arquivo",
    r2.status === 0 && readFileSync(alvo, "utf8") === "const a = 2;\n",
  );
  rmSync(dir, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
console.log("\n14) O RECORTE, nos delimitadores que a arvore usa");
{
  for (const [d, linha] of [
    ["/", `sed -i 's/aa/bb/' f.ts`],
    ["#", `sed -i 's#aa#bb#' f.ts`],
    ["|", `sed -i 's|aa|bb|' f.ts`],
    ["@", `sed -i 's@aa@bb@' f.ts`],
  ]) {
    const corte = recortarSed(linha);
    const pad = padraoDaExpressao(corte.expressao);
    ok(`delimitador \`${d}\``, pad.padrao === "aa", `padrao=${JSON.stringify(pad.padrao)}`);
  }
  // Delimitador ESCAPADO dentro do padrao: `split` quebraria aqui.
  const corte = recortarSed(`sed -i 's#]{12})\\$;#]{12})/;#' f.ts`);
  ok("delimitador escapado nao quebra o recorte", padraoDaExpressao(corte.expressao).padrao === "]{12})\\$;", JSON.stringify(padraoDaExpressao(corte.expressao)));
  // `-E` muda o dialeto, e o recorte tem de dizer isso.
  ok("`-E` e reconhecido como ERE", recortarSed(`sed -i -E 's/a+/b/' f.ts`)?.ere === true);
  ok("sem `-E` e BRE", recortarSed(`sed -i 's/a+/b/' f.ts`)?.ere === false);
}

// -----------------------------------------------------------------------------
console.log("\n15) PROSA que cita `sed -i` nao e comando, e comentario nao conta");
{
  const raiz = arvore({
    ".github/workflows/x.yml": passo(
      "planta",
      `# O \`cmp\` depois de cada \`sed\` nao e zelo: um \`sed -i\` que nao casa sai 0.\nsed -i 's#const a = 1;#const a = 2;#' lib/alvo.ts`,
    ),
    "lib/alvo.ts": "const a = 1;\n",
  });
  const { achados } = medir(raiz);
  ok("le so o comando, nao o comentario", achados.length === 1, `leu ${achados.length}`);
  rmSync(raiz, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
console.log("\n16) CONTROLE POSITIVO NA ARVORE DE VERDADE: a guarda le os workflows reais");
// Sem este caso, todos os anteriores provariam a guarda sobre fixture sintetico
// e ela poderia estar lendo ZERO `sed` do repositorio -- o boletim limpo que o
// cabecalho descreve. O numero nao e fixado de proposito (ele cresce a cada
// controle negativo novo); o que se exige e que NAO seja vazio.
{
  const achados = varrer();
  ok("acha `sed -i` nos workflows do repositorio", achados.length > 0, `leu ${achados.length}`);
  ok(
    "e todos caem num estado conhecido",
    achados.every((a) => ["CASOU", "ANCORA_MORTA", "ALVO_AUSENTE", "DINAMICO", "FORMA_DESCONHECIDA"].includes(a.estado)),
  );
  console.log(`       (${achados.length} \`sed -i\` lidos na arvore de verdade)`);
}

console.log(`\n${casos - falhas}/${casos} casos ok`);
if (falhas) {
  console.error(`::error::${falhas} caso(s) do controle negativo da guarda de \`sed\` falharam.`);
  process.exit(1);
}
console.log("A guarda de `sed` dos workflows sabe reprovar, e sabe nao reprovar.");
