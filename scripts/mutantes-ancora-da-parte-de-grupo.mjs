#!/usr/bin/env node
// =====================================================
// MUTANTES DA ANCORA DA PARTE DE GRUPO (HMO-282)
// =====================================================
//   node scripts/mutantes-ancora-da-parte-de-grupo.mjs
//
// A HMO-282 repontou dois casos de `test:mobile-overflow` de
// `personal-finance/page.tsx` para `LinhaDaParteDeGrupo.tsx`, que e para onde a
// HMO-274 moveu o JSX. Repontar a ancora faz os dois ficarem VERDES -- e verde
// depois de um conserto de ancora nao distingue "voltou a medir" de "achou o
// arquivo e nao afirma nada". Este runner e quem distingue: ele estraga uma
// classe de quebra por vez no componente e exige que o caso correspondente fique
// VERMELHO.
//
// Os alvos sao as `className` INTEIRAS, e nao o pedaco (`min-w-0`, `truncate`):
// `min-w-0` aparece tres vezes no arquivo, uma delas dentro de um comentario que
// explica a regra. Um replace pelo pedaco pega a primeira ocorrencia, que e o
// comentario -- `ler()` apaga comentarios antes de medir, entao o teste
// continuaria verde e o mutante sobreviveria por motivo nenhum.
//
// O CONTROLE POSITIVO (arvore intacta, 22 verdes) roda primeiro: ele e o unico
// passo que pega erro no proprio runner -- se o caminho do arquivo estiver
// errado, ou o comando nao rodar, todos os mutantes "morrem" e o relatorio sai
// perfeito sem ter medido nada.
// =====================================================

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { protegerArvore } from "./auto-cura-de-mutante.mjs";

const RAIZ = path.join(import.meta.dirname, "..");
const ALVO = "components/movimentacoes/LinhaDaParteDeGrupo.tsx";
const CAMINHO = path.join(RAIZ, ALVO);

const BLOCO_ESQUERDO = "flex items-center gap-3 min-w-0 flex-1";
const EMBRULHO = `<div className="min-w-0">`;
const DESCRICAO = `<p className="font-medium truncate">`;
const FILA =
  "flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground";

const MUTANTES = [
  {
    nome: "bloco da esquerda sem min-w-0",
    de: BLOCO_ESQUERDO,
    para: "flex items-center gap-3 flex-1",
    caso: "a linha nova da lista tambem nao empurra a pagina",
  },
  {
    nome: "embrulho do texto sem min-w-0",
    de: EMBRULHO,
    para: `<div className="w-full">`,
    caso: "a linha nova da lista tambem nao empurra a pagina",
  },
  {
    nome: "descricao sem truncate",
    de: DESCRICAO,
    para: `<p className="font-medium">`,
    caso: "a linha nova da lista tambem nao empurra a pagina",
  },
  {
    nome: "fila de metadados sem flex-wrap",
    de: FILA,
    para: "flex items-center gap-x-2 gap-y-1 text-sm text-muted-foreground",
    caso: "a fila de categoria/grupo/data quebra, e com gap vertical",
  },
  {
    nome: "fila de metadados sem gap-y",
    de: FILA,
    para: "flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground",
    caso: "a fila de categoria/grupo/data quebra, e com gap vertical",
  },
];

/** Devolve {ok, saida} de `node --test scripts/test-mobile-overflow.mjs`. */
function rodar() {
  try {
    const saida = execFileSync(
      process.execPath,
      ["--test", "scripts/test-mobile-overflow.mjs"],
      { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { ok: true, saida };
  } catch (e) {
    return { ok: false, saida: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

// O ORIGINAL vem do helper, e nao de um `readFileSync` aqui, para a leitura
// acontecer DEPOIS da auto-cura -- ver o contrato de ordem no cabecalho dele.
const { originais, encerrar } = protegerArvore({
  runner: "ancora-da-parte-de-grupo",
  arquivos: [ALVO],
});
const ORIGINAL = originais[ALVO];
// A arvore volta ao original mesmo se o runner morrer no meio (timeout, Ctrl-C):
// mutante que fica aplicado vira "defeito que o teste nao pega" na proxima
// pessoa que rodar a suite.
const restaurar = () => fs.writeFileSync(CAMINHO, ORIGINAL);
process.on("exit", restaurar);
for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => {
    restaurar();
    process.exit(1);
  });
}

let falhas = 0;

console.log("CONTROLE POSITIVO (arvore intacta)");
const base = rodar();
if (!base.ok) {
  console.log("  REPROVADO: a arvore intacta ja esta vermelha");
  console.log(base.saida.split("\n").slice(-25).join("\n"));
  process.exit(1);
}
console.log("  ok: 22 verdes\n");

console.log("MUTANTES");
for (const m of MUTANTES) {
  const ocorrencias = ORIGINAL.split(m.de).length - 1;
  if (ocorrencias !== 1) {
    console.log(
      `  [ERRO] ${m.nome}: a ancora casa ${ocorrencias}x em ${ALVO} ` +
        `(precisa casar exatamente 1x para o mutante ser o que diz ser)`,
    );
    falhas++;
    continue;
  }

  fs.writeFileSync(CAMINHO, ORIGINAL.replace(m.de, m.para));
  const r = rodar();
  restaurar();

  // Nao basta ficar vermelho: tem que ficar vermelho NO CASO que esse mutante
  // deveria quebrar. Um mutante que derruba outro caso qualquer mediria a suite,
  // nao a afirmacao.
  const matouOCaso = !r.ok && r.saida.includes(m.caso);

  if (matouOCaso) {
    console.log(`  MORTO     ${m.nome}  ->  "${m.caso}"`);
  } else {
    falhas++;
    console.log(
      `  SOBREVIVE ${m.nome}  (esperava derrubar "${m.caso}")` +
        (r.ok ? " -- a suite ficou toda verde" : " -- vermelho em outro caso"),
    );
  }
}

encerrar();

console.log(
  `\n${MUTANTES.length - falhas}/${MUTANTES.length} mutantes mortos.`,
);
process.exit(falhas === 0 ? 0 : 1);
