#!/usr/bin/env node
// =====================================================
// PULODOGATO - extensao nos subcaminhos do `next` no build dos testes
// =====================================================
//   node scripts/resolve-next-subpaths.mjs .tmp-previsto-bloco
//
// Irmao do resolve-aliases.mjs, e pelo mesmo motivo: o JS emitido para o teste
// roda direto no node como ESM, e o node nao resolve o especificador que o
// bundler do Next resolve.
//
// O CASO CONCRETO
// ---------------
// `import Link from "next/link"` compila e funciona no app -- o webpack do Next
// resolve. No node, nao: o pacote `next` NAO tem campo `exports` no
// package.json (conferido; se um dia tiver, o sintoma muda para
// ERR_PACKAGE_PATH_NOT_EXPORTED e este script fica inutil sem avisar -- dai a
// verificacao no fim). Sem `exports`, a resolucao ESM cai no caminho literal
// `node_modules/next/link`, que nao existe: o arquivo e `link.js`. No ESM a
// extensao nao e opcional, e o node morre com ERR_MODULE_NOT_FOUND.
//
// O arquivo existe e e o mesmo que o app carrega -- o que falta e so a
// extensao. Por isso a reescrita, e nao um dublê: um <Link> falso renderizaria
// uma <a> que o teste nao distingue da verdadeira, e no dia em que o Link real
// mudasse de marcacao o teste continuaria verde sobre o dublê.
//
// NAO entra no build do Next: la o bundler resolve.
// =====================================================

import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const [destino] = process.argv.slice(2);

if (!destino) {
  console.error("uso: node scripts/resolve-next-subpaths.mjs <dir-compilado>");
  process.exit(1);
}

// Só os subcaminhos que os componentes de fato importam. Lista explicita em vez
// de um `next/*` generico: `next/navigation` e `next/headers` sao resolvidos
// pelo runtime do Next e nao rodam no node de jeito nenhum -- reescrever a
// extensao deles trocaria um ERR_MODULE_NOT_FOUND claro por um erro de runtime
// dentro do pacote, muito mais dificil de ler.
const SUBCAMINHOS = ["next/link", "next/image"];

/** Todo .js debaixo de um diretorio, recursivamente. */
function arquivos(dir) {
  const achados = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      achados.push(...arquivos(caminho));
    } else if (nome.endsWith(".js")) {
      achados.push(caminho);
    }
  }
  return achados;
}

let reescritos = 0;

for (const caminho of arquivos(destino)) {
  const antes = readFileSync(caminho, "utf8");
  let depois = antes;

  for (const sub of SUBCAMINHOS) {
    // `from "next/link"` e `from 'next/link'`, sempre com a aspa fechando
    // imediatamente: sem isso `next/link` casaria dentro de `next/linkzinho`.
    depois = depois.replace(
      new RegExp(`(["'])${sub}\\1`, "g"),
      `$1${sub}.js$1`
    );
  }

  if (depois !== antes) {
    writeFileSync(caminho, depois);
    reescritos++;
  }
}

// Controle negativo do proprio script. Zero arquivos reescritos significa uma de
// duas coisas -- nenhum componente do build importa `next/link`, ou o tsc passou
// a emitir o import de outra forma -- e as duas fazem este passo virar no-op
// silencioso. Um no-op aqui nao da erro: da ERR_MODULE_NOT_FOUND no node, tres
// comandos depois, sem nada apontando para ca.
if (reescritos === 0) {
  console.error(
    `resolve-next-subpaths: nenhum import de ${SUBCAMINHOS.join("/")} encontrado em ${destino}. ` +
      "O passo virou no-op -- confira se ele ainda e necessario ou se o tsc mudou a emissao."
  );
  process.exit(1);
}

console.log(
  `resolve-next-subpaths: extensao acrescentada em ${reescritos} arquivo(s).`
);
