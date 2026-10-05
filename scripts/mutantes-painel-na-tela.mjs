// CONTROLE NEGATIVO da metade do PAINEL em `npm run test:papel-na-tela` -- a
// leitura do rotulo que a HMO-294 encurtou.
//
// POR QUE ESTE RUNNER EXISTE
// --------------------------
// A HMO-294 trocou uma `string` literal por outra mais curta --
// `rotulo="Salário Previsto"` virou `rotulo="Salário"` -- e NADA no repositorio
// ve essa troca sozinho: o tsc e o lint nao olham conteudo de literal, o
// `next build` compila as duas igual, e `npm run test:papel-de-pao` mede a
// ARITMETICA do painel, que nao mudou. E a mesma familia de defeito que ja deu
// "40 blocos verdes com a classificacao invertida" neste repositorio: campo de
// ROTULO atravessa suite de numero sem tocar em nada.
//
// Entao o que precisa de prova nao e "a suite passa" -- ela passava com o texto
// velho --, e sim que ela SABE REPROVAR as tres formas do defeito:
//
//   1. o rotulo volta a ser o texto longo (o defeito literal da issue);
//   2. o rotulo vai para o cartao ERRADO (os dois cartoes compilam igual);
//   3. a ANCORA da sonda (`data-rotulo`) muda de nome -- e esta e a que
//      importa para o runner, porque sem ela a sonda leria uma lista VAZIA de
//      rotulos, e "Salário Previsto nao aparece" e verdade numa lista vazia.
//      O caso que mata este mutante e o controle positivo da montagem, nao a
//      assercao do rotulo.
//
// A SUITE E DE NAVEGADOR, e cada volta custa ~7s. Sao quatro voltas (uma de
// controle positivo e tres de mutante), e por isso o runner e separado do
// `mutantes-menu-papel.mjs`: o do menu e puro e roda em menos de 1s por volta.
//
// Nao usa `git checkout` para restaurar: ele restauraria a partir do INDICE, e
// num worktree compartilhado isso ja apagou trabalho nao commitado aqui. A
// copia original vai para a memoria e volta de la, sempre.

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const PAINEL = "components/papel-de-pao/PainelDePapel.tsx";

const mutantes = [
  {
    // O DEFEITO LITERAL DA ISSUE. Ele morre so porque a assercao tem as DUAS
    // metades: "Salário" PRESENTE sobrevive a este mutante, porque "Salário" e
    // substring de "Salário Previsto".
    nome: "o rotulo volta a ser `Salário Previsto`",
    arquivo: PAINEL,
    de: 'rotulo="Salário"',
    para: 'rotulo="Salário Previsto"',
  },
  {
    // O ROTULO NO CARTAO ERRADO. Os dois `NumeroGrande` tem a mesma assinatura,
    // entao trocar os rotulos de lugar compila, renderiza e passa por qualquer
    // assercao que so procurasse as duas palavras na tela. Morre na comparacao
    // ORDENADA de `data-rotulo`.
    nome: "os dois rotulos trocam de cartao",
    arquivo: PAINEL,
    de: 'rotulo="Salário"',
    para: 'rotulo="Total de contas"',
  },
  {
    // A ANCORA DA SONDA. Sem `data-rotulo` no DOM, a lista de rotulos vem
    // vazia -- e uma lista vazia satisfaz "Salário Previsto nao aparece". Quem
    // mata este mutante e o caso "o painel montou de verdade", que exige DOIS
    // cartoes de producao antes de qualquer assercao sobre texto.
    nome: "o `data-rotulo` muda de nome (a sonda passa a ler o vazio)",
    arquivo: PAINEL,
    de: "data-rotulo={rotulo}",
    para: "data-rotulo-do-cartao={rotulo}",
  },
];

const original = new Map();
for (const arquivo of new Set(mutantes.map((m) => m.arquivo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}
const restaurar = () => {
  for (const [arquivo, texto] of original) writeFileSync(arquivo, texto);
};
process.on("exit", restaurar);
process.on("SIGINT", () => process.exit(130));

const roda = () => {
  try {
    execSync("npm run test:papel-na-tela", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

// CONTROLE POSITIVO, primeiro e obrigatorio: sem mutante a suite tem de PASSAR.
// Se ela estiver vermelha por outro motivo -- navegador ausente, esboco
// faltando, erro no proprio caminho da mutacao -- todo mutante "morre" e o
// placar fecha 100% sem medir nada. O controle NEGATIVO nao pega isso: ele
// passa por outro caminho.
console.log("controle positivo (codigo intacto): a suite deve PASSAR");
if (!roda()) {
  console.error("  REPROVOU -- conserte a suite antes de medir mutante");
  process.exit(1);
}
console.log("  ok, passou\n");

let sobreviventes = 0;
for (const m of mutantes) {
  const antes = original.get(m.arquivo);
  if (!antes.includes(m.de)) {
    console.error(`SOBREVIVEU (ancora nao casou) :: ${m.nome}`);
    console.error(`  o texto buscado nao existe em ${m.arquivo}: ${m.de}`);
    sobreviventes++;
    continue;
  }
  const depois = antes.replace(m.de, m.para);
  if (depois === antes) {
    console.error(`SOBREVIVEU (replace nao mudou nada) :: ${m.nome}`);
    sobreviventes++;
    continue;
  }
  writeFileSync(m.arquivo, depois);
  const passou = roda();
  restaurar();
  if (passou) {
    console.error(`SOBREVIVEU :: ${m.nome}`);
    sobreviventes++;
  } else {
    console.log(`morreu     :: ${m.nome}`);
  }
}

console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mortos`);
process.exit(sobreviventes === 0 ? 0 : 1);
