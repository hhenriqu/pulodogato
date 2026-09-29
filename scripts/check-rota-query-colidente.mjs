#!/usr/bin/env node
// Reprova rota que le um parametro de query com o MESMO nome de um segmento
// dinamico do proprio caminho.
//
// O modo de falha e mudo e total. Numa rota sob `[id]`, o Next usa a query
// string para carregar o valor do segmento e consome a chave de mesmo nome ao
// montar `params`. Resultado: `searchParams.get("id")` volta null mesmo com
// `?id=<uuid>` chegando inteiro no servidor -- da o `x-matched-path` certo, o
// handler certo, e o parametro sumido.
//
// Nada disso aparece antes de producao: o `tsc` passa, o `next build` passa, o
// teste de unidade da funcao pura passa, e a rota responde 200/400 com uma
// mensagem plausivel ("Informe qual aporte desfazer"). Foi o que aconteceu com
// DELETE /api/goals/[id]/contributions?id=<uuid> (HMO-142): desfazer aporte
// ficou 100% quebrado em producao, com a tela dizendo ao usuario que ele nao
// informou o que informou.
//
// Medido em producao com controle positivo e negativo, na mesma familia de
// rota `[id]`: `?purge=true` chega normalmente e muda o ramo da resposta; so a
// chave que colide com o segmento desaparece. Ou seja: nao e "query nao
// funciona em rota dinamica", e exatamente a colisao de nome.
//
// O conserto e renomear o parametro (`?contributionId=`), nao contornar lendo
// do corpo: DELETE com corpo e mal suportado por cache e proxy.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("../app/api", import.meta.url).pathname;

function rotasRecursivas(dir) {
  const achados = [];
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) {
      achados.push(...rotasRecursivas(caminho));
    } else if (entrada === "route.ts" || entrada === "route.tsx") {
      achados.push(caminho);
    }
  }
  return achados;
}

// Os segmentos dinamicos do caminho, incluindo catch-all (`[...slug]`,
// `[[...slug]]`): o Next normaliza os tres para a mesma chave.
function segmentosDinamicos(caminhoDoArquivo) {
  const nomes = new Set();
  for (const trecho of caminhoDoArquivo.split("/")) {
    const m = trecho.match(/^\[+(?:\.\.\.)?([A-Za-z0-9_$]+)\]+$/);
    if (m) nomes.add(m[1]);
  }
  return nomes;
}

// Comentario NAO conta. Este guard varre texto cru, e a explicacao do proprio
// conserto cita a forma proibida -- sem isto, documentar a armadilha reprova o
// commit, que e a armadilha que o check-color-tokens ja tinha. Trocamos por
// espaco em vez de apagar para nao deslocar o numero da linha do relatorio.
function semComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, (t) => t.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (t) => t.replace(/[^\n]/g, " "));
}

// `searchParams` costuma chegar por apelido -- `const sp = new
// URL(request.url).searchParams` -- e procurar so pelo nome literal deixaria
// passar exatamente o caso que motivou o guard. Coletamos os apelidos e
// tratamos todos como a mesma coisa.
function apelidosDeSearchParams(fonte) {
  const nomes = new Set(["searchParams"]);
  const decl = /(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*[^;\n]*\bsearchParams\b/g;
  for (const m of fonte.matchAll(decl)) nomes.add(m[1]);
  return nomes;
}

const violacoes = [];

for (const arquivo of rotasRecursivas(RAIZ)) {
  const dinamicos = segmentosDinamicos(arquivo);
  if (dinamicos.size === 0) continue;

  const bruto = readFileSync(arquivo, "utf8");
  const fonte = semComentarios(bruto);
  if (!fonte.includes("searchParams")) continue;

  const alvos = apelidosDeSearchParams(fonte);
  const pegaGet =
    /([A-Za-z0-9_$]+)\s*\.\s*get\(\s*["'`]([A-Za-z0-9_$]+)["'`]\s*\)/g;

  for (const m of fonte.matchAll(pegaGet)) {
    if (!alvos.has(m[1])) continue;
    if (!dinamicos.has(m[2])) continue;
    const linha = fonte.slice(0, m.index).split("\n").length;
    violacoes.push({
      arquivo: arquivo.replace(`${process.cwd()}/`, ""),
      linha,
      nome: m[2],
    });
  }
}

if (violacoes.length > 0) {
  console.error(
    "Parametro de query com o mesmo nome de um segmento dinamico do caminho.\n" +
      "O Next consome essa chave ao montar `params`: o `.get()` volta null em\n" +
      "producao mesmo com o parametro chegando na URL. Renomeie o parametro.\n"
  );
  for (const v of violacoes) {
    console.error(`  ${v.arquivo}:${v.linha}  -> segmento [${v.nome}] e searchParams.get("${v.nome}")`);
  }
  console.error(`\n${violacoes.length} colisao(oes).`);
  process.exit(1);
}

console.log("OK: nenhuma rota le query com nome de segmento dinamico.");
