// Mutantes da trava da HMO-206.
//
// Um teste novo que passa nao prova nada: prova que o codigo atual o satisfaz.
// Cada mutante abaixo quebra a trava de um jeito diferente e nomeia o teste
// que TEM que ficar vermelho. Mutante que sobrevive verde denuncia a
// assercao, nao o mutante.
//
// O fonte e restaurado no `finally`, e NAO ha `process.exit()` dentro do
// try: ele pularia o finally e deixaria lib/puxar-para-atualizar.ts mutado.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVO = "lib/puxar-para-atualizar.ts";
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  {
    nome: "sem a trava em lerGesto",
    de: "  if (!toqueNaPagina) return GESTO_INERTE;",
    para: "  if (false) return GESTO_INERTE;",
    esperaQuebrar: "rolar a lista do menu NAO recarrega a pagina",
  },
  {
    nome: "toqueEhNaPagina sempre true (nunca trava)",
    de: "  return !caminhoDoToque.some(",
    para: "  return true || !caminhoDoToque.some(",
    esperaQuebrar: "rolar a lista do menu NAO recarrega a pagina",
  },
  {
    nome: "toqueEhNaPagina sempre false (trava larga demais)",
    de: "  return !caminhoDoToque.some(",
    para: "  return false && !caminhoDoToque.some(",
    esperaQuebrar: "toque so na pagina: o caminho vazio e o caminho neutro puxam",
  },
  {
    nome: "ignora o marcador do menu",
    de: "    (ancestral) => ancestral.rolaOProprioConteudo || ancestral.dispensaOPuxao",
    para: "    (ancestral) => ancestral.rolaOProprioConteudo",
    esperaQuebrar: "area marcada segura o puxao mesmo sem nada rolando",
  },
  {
    nome: "ignora a caixa que rola sozinha",
    de: "    (ancestral) => ancestral.rolaOProprioConteudo || ancestral.dispensaOPuxao",
    para: "    (ancestral) => ancestral.dispensaOPuxao",
    esperaQuebrar: "caixa que rola sozinha segura o puxao, mesmo fora do menu",
  },
  {
    nome: "default do toqueNaPagina invertido",
    de: "  toqueNaPagina = true,",
    para: "  toqueNaPagina = false,",
    esperaQuebrar: "sem a pergunta respondida, o puxao continua valendo",
  },
  {
    nome: "nome do atributo com erro de digitacao",
    de: 'export const ATRIBUTO_SEM_PUXAO = "data-sem-puxar-para-atualizar";',
    para: 'export const ATRIBUTO_SEM_PUXAO = "data-sem-puxar-pra-atualizar";',
    esperaQuebrar: "o marcador do menu e o atributo que a leitura procura",
  },
];

const placar = [];

try {
  for (const m of mutantes) {
    if (!original.includes(m.de)) {
      // Mutante que nao aplica e assercao: ele passaria "verde" sem nunca ter
      // tocado o fonte, e o placar viraria ficcao.
      placar.push({ ...m, resultado: "NAO APLICOU", ok: false });
      continue;
    }

    writeFileSync(ALVO, original.replace(m.de, m.para));

    let saida = "";
    let passou = true;
    try {
      saida = execSync("npm run test:puxar-para-atualizar 2>&1", {
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

console.log("\n=== PLACAR ===");
for (const p of placar) {
  console.log(`${p.ok ? "OK  " : "RUIM"}  ${p.nome} -> ${p.resultado}`);
  if (!p.ok) console.log(`        esperava quebrar: ${p.esperaQuebrar}`);
}
const sobreviventes = placar.filter((p) => !p.ok).length;
console.log(`\n${placar.length - sobreviventes}/${placar.length} mutantes mortos no teste certo`);
