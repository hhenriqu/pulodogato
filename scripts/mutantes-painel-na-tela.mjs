// CONTROLE NEGATIVO da metade do PAINEL em `npm run test:papel-na-tela` -- a
// leitura do rotulo que a HMO-294 encurtou, mais o PASSO DE MES da HMO-295.
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
// A SUITE E DE NAVEGADOR, e cada volta custa ~5s. Sao doze voltas (uma de
// controle positivo e onze de mutante), e por isso o runner e separado do
// `mutantes-menu-papel.mjs`: o do menu e puro e roda em menos de 1s por volta.
// Pela mesma razao os mutantes da ROTA e da funcao pura do mes nao estao aqui --
// eles vivem em `scripts/mutantes-mes-do-painel.mjs`, que mede a suite pura.
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

  // ===========================================================================
  // O PASSO DE MES -- HMO-295 (5/6)
  // ===========================================================================
  // Os mutantes da ROTA e da funcao pura estao em
  // `scripts/mutantes-mes-do-painel.mjs`, que mede a suite pura e roda em
  // segundos. Aqui ficam os que so a tela ve: um clique que nao chega na rota,
  // um botao que aparece onde nao devia, uma resposta de outro mes pintada. Os
  // seis compilam, passam no lint e deixam a tela com a MESMA aparencia estatica
  // -- a diferenca esta no gesto, e gesto nao tem rede sem navegador
  // (`react-dom/server` nao ve handler).
  {
    // O CLIQUE QUE NAO CHEGA NA ROTA. A tela anda de mes, o rotulo muda, e o
    // `fetch` continua pedindo o mes corrente: os numeros de outubro ficam
    // debaixo do rotulo "novembro de 2026". E a HMO-173 de novo, e e exatamente
    // o defeito que um teste que lesse so o rotulo nao veria.
    nome: "o fetch nao manda o mes (a tela anda, a rota nao)",
    arquivo: PAINEL,
    de: "`/api/papel-de-pao/painel?month=${mesPedido}`",
    para: '"/api/papel-de-pao/painel"',
  },
  {
    // A SETA TROCADA. As duas chamadas tem a mesma forma e o mesmo tipo, e o
    // unico sintoma e a direcao -- que nenhuma assercao estatica distingue.
    nome: "a seta da direita anda para TRAS",
    arquivo: PAINEL,
    de: "onClick={() => setPeriodo(passoDeMes(periodo, 1))}",
    para: "onClick={() => setPeriodo(passoDeMes(periodo, -1))}",
  },
  {
    // O EFEITO QUE NAO DEPENDE DO MES. Com a lista de dependencias vazia, o
    // pedido acontece UMA vez e as setas passam a trocar so o rotulo. O
    // `exhaustive-deps` reclamaria num `npm run lint`; este runner nao roda
    // lint, e o ponto e que a SUITE tem de reprovar sozinha.
    nome: "o efeito nao refaz o pedido quando o mes muda",
    arquivo: PAINEL,
    de: "  }, [mesPedido]);",
    para: "  }, []);",
  },
  {
    // A RESPOSTA DE OUTRO MES, PINTADA. Sem a guarda, o cache do PWA (24h nas
    // rotas /api/) poe os numeros de um mes debaixo do rotulo de outro -- e os
    // numeros sao plausiveis, porque sao numeros de verdade.
    nome: "a tela pinta resposta de qualquer mes (a guarda do `month` sai)",
    arquivo: PAINEL,
    de: "        if (dados.month !== mesPedido) {",
    para: "        if (false) {",
  },
  {
    // A GUARDA INVERTIDA: descarta exatamente o que deveria aceitar. O painel
    // fica "indisponivel agora" para sempre, com a conta certa chegando pela
    // rede -- e quem morre aqui e o CONTROLE POSITIVO do caso F, nao a assercao
    // do descarte.
    nome: "a guarda do `month` esta invertida (descarta o mes certo)",
    arquivo: PAINEL,
    de: "        if (dados.month !== mesPedido) {",
    para: "        if (dados.month === mesPedido) {",
  },
  {
    // O "HOJE" SEMPRE NA TELA. Um botao que nao tem para onde levar, no mes em
    // que a pessoa ja esta. O criterio 2 da issue e literalmente este par, e so
    // uma assercao nos DOIS sentidos o mede.
    nome: "o `Hoje` aparece tambem no mes corrente",
    arquivo: PAINEL,
    de: "        {!noMesCorrente && (",
    para: "        {true && (",
  },
  {
    // O "HOJE" COMO UM PASSO PARA TRAS. A dois meses de distancia ele deixa a
    // pessoa no mes seguinte, nao no corrente -- e a um mes de distancia os dois
    // sao indistinguiveis, que e por que a sonda o clica de longe.
    nome: "o `Hoje` anda um mes para tras em vez de voltar para hoje",
    arquivo: PAINEL,
    de: 'onClick={() => setPeriodo(periodoCorrente())}',
    para: "onClick={() => setPeriodo(passoDeMes(periodo, -1))}",
  },
  {
    // A ANCORA DA SONDA, como no `data-rotulo` acima: sem `data-mes`, a leitura
    // do mes na tela vem `null` e "o mes mudou" deixa de ser mensuravel. Quem o
    // mata sao as assercoes que comparam `mesNaTela` com o oraculo.
    nome: "o `data-mes` muda de nome (a sonda perde o mes da tela)",
    arquivo: PAINEL,
    de: "data-mes={mesPedido}",
    para: "data-mes-do-painel={mesPedido}",
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
