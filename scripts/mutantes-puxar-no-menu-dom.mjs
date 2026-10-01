// Mutantes da LEITURA de DOM da HMO-206.
//
// O teste em navegador passou de primeira, e teste que passa de primeira e
// suspeito: ele pode estar medindo outra coisa. Cada mutante abaixo quebra a
// leitura de um jeito diferente e nomeia o teste que TEM que ficar vermelho.
//
// O fonte e restaurado no `finally`, e NAO ha `process.exit()` dentro do try:
// ele pularia o finally e deixaria lib/puxar-para-atualizar-dom.ts mutado.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVO = "lib/puxar-para-atualizar-dom.ts";
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  {
    // Precisa COMPILAR para dizer algo: um `return` logo apos a declaracao
    // deixa o resto inalcancavel e o tsc reprova, e o mutante "morre" sem
    // nunca ter rodado -- morte que nao prova assercao nenhuma.
    nome: "caminho sempre vazio (leitura nao le nada)",
    de: "  let no: Element | null = alvo instanceof Element ? alvo : null;",
    para: "  let no: Element | null = null;",
    esperaQuebrar: "tocar um item do menu NAO e toque de pagina",
  },
  {
    nome: "nao sobe pelos ancestrais (olha so o alvo)",
    de: "    no = no.parentElement;",
    para: "    no = null;",
    esperaQuebrar: "tocar um item do menu NAO e toque de pagina",
  },
  {
    nome: "ignora se a caixa transborda",
    de: "        OVERFLOW_QUE_ROLA.has(estilo.overflowY) &&\n        no.scrollHeight > no.clientHeight,",
    para: "        OVERFLOW_QUE_ROLA.has(estilo.overflowY),",
    esperaQuebrar: "overflow-y-auto que nao transborda deixa puxar",
  },
  {
    nome: "nao le o marcador do menu",
    de: "      dispensaOPuxao: no.hasAttribute(ATRIBUTO_SEM_PUXAO),",
    para: "      dispensaOPuxao: false,",
    esperaQuebrar: "o resto da gaveta tambem nao puxa",
  },
  {
    // A pagina PADRAO nao poe overflow em html/body (como o app hoje), entao
    // este mutante nao aparece nela: quem o pega e a variante de raiz rolavel.
    nome: "sobe tambem pelo body/html (a pagina vira area que rola)",
    de: "  while (no && no !== document.body && no !== document.documentElement) {",
    para: "  while (no) {",
    esperaQuebrar: "com overflow-y na RAIZ, a pagina ainda puxa",
  },
  {
    nome: "overflow visible tambem conta como rolagem",
    de: 'const OVERFLOW_QUE_ROLA = new Set(["auto", "scroll", "overlay"]);',
    para:
      'const OVERFLOW_QUE_ROLA = new Set(["auto", "scroll", "overlay", "visible"]);',
    esperaQuebrar: "caixa que transborda SEM rolar deixa puxar",
  },
];

const placar = [];

try {
  for (const m of mutantes) {
    if (!original.includes(m.de)) {
      // Mutante que nao aplica e assercao: passaria "verde" sem nunca ter
      // tocado o fonte, e o placar viraria ficcao.
      placar.push({ ...m, resultado: "NAO APLICOU", ok: false });
      continue;
    }

    writeFileSync(ALVO, original.replace(m.de, m.para));

    let saida = "";
    let passou = true;
    try {
      // Pelo script do npm, que e quem recompila o fonte mutado. Chamar o
      // `node --test` direto rodaria o JS da compilacao ANTERIOR, e todo
      // mutante "sobreviveria" sem nunca ter chegado ao navegador.
      saida = execSync("npm run test:puxar-no-menu-dom 2>&1", {
        encoding: "utf8",
      });
    } catch (e) {
      saida = (e.stdout || "") + (e.stderr || "");
      passou = false;
    }

    const quebrouOEsperado = saida.includes(`✖ ${m.esperaQuebrar}`);
    placar.push({
      ...m,
      resultado: passou
        ? "SOBREVIVEU (suite verde)"
        : quebrouOEsperado
        ? "morreu no teste certo"
        : "morreu em OUTRO teste",
      ok: !passou && quebrouOEsperado,
    });
  }
} finally {
  writeFileSync(ALVO, original);
  const restaurado = readFileSync(ALVO, "utf8") === original;
  console.log(`\nfonte restaurado: ${restaurado ? "sim" : "NAO -- CONFIRA"}`);
}

console.log("\n=== PLACAR (leitura de DOM) ===");
for (const p of placar) {
  console.log(`${p.ok ? "OK  " : "RUIM"}  ${p.nome} -> ${p.resultado}`);
  if (!p.ok) console.log(`        esperava quebrar: ${p.esperaQuebrar}`);
}
const vivos = placar.filter((p) => !p.ok).length;
console.log(
  `\n${placar.length - vivos}/${placar.length} mutantes mortos no teste certo`
);
