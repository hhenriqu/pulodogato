#!/usr/bin/env node
// Prova de mutacao do "quem te paga" (HMO-422).
//
//   node scripts/mutantes-quem-me-paga.mjs
//
// Cada entrada estraga uma decisao de
// `components/movimentacoes/PainelQuemMePaga.tsx`, e a suite de navegador tem
// de ficar VERMELHA. Mutante que sobrevive e um trecho que nenhum teste
// distingue, ou codigo morto.
//
// UMA SUITE SO, E ISSO E DIFERENTE DO IRMAO
// -----------------------------------------
// `mutantes-pra-quem-pagar.mjs` roda duas suites (a aritmetica no node e a
// marcacao no Chromium) porque aquele painel tem uma lib propria
// (`lib/pra-quem-pagar.ts`). Aqui a aritmetica NAO E DESTE COMPONENTE: o
// credito sai de `lib/credito-de-grupo.ts`, que ja tem runner proprio
// (`npm run mutantes:credito-de-grupo`). Este componente so DESENHA, entao a
// unica suite que pode mata-lo e a de navegador -- e por isso ela e a unica
// aqui. Marcar a suite errada produziria "sobreviveu" sobre um defeito que a
// outra pega, que e o pior relato possivel porque manda consertar o que nao
// esta quebrado.
//
// O QUE A ISSUE NOMEIA ESTA NO TOPO
// ---------------------------------
// A HMO-422 e "os 508,42 nao deveria estar aparecendo?": o cartao «Previsto» de
// Receitas dizia R$ 508,42 "de 2 pessoas em 1 grupo" e a aba nao dizia QUEM nem
// de QUAL grupo. Entao os dois primeiros mutantes sao os que DESLIGAM a entrega:
//
//   * `painel_sempre_nulo` -- o painel nunca desenha. E a tela de antes desta
//     issue, byte a byte, e tem de morrer em TODA assercao de conteudo;
//   * `nota_apagada` -- o painel desenha sem a frase que diz que o valor JA
//     ESTA no «Previsto» de cima. Sem ela a pessoa soma os dois numeros e
//     conclui que vai receber R$ 1.016,84 -- a familia de
//     `duas-metades-certas-dobram-a-linha`, e o motivo pelo qual
//     `NOTA_PRA_QUEM_PAGAR` existe do outro lado.
//
// E OS DOIS QUE SO O DOM DENUNCIA
// -------------------------------
//   * `rotulo_pelo_nome_cru` -- a tela imprime `linha.devedor` em vez do rotulo
//     pronto de `devedorNaLinha`. Com o perfil legivel a diferenca e NENHUMA
//     ("Laís" nos dois casos); com o perfil ILEGIVEL o elemento renderiza nada,
//     e "R$ 300,00 · Casa" sem mencao a outra pessoa se le como receita propria
//     -- e pior, como receita JA RECEBIDA. Nenhum teste de funcao pura alcanca
//     "nao aparece";
//   * `chave_so_do_devedor` -- a `key` do React perde o `group_id`. A mesma
//     pessoa me devendo em DOIS grupos colapsa numa linha so, e o cartao
//     «Previsto» continua somando as duas. E o mutante que exige fixture de
//     dois GRUPOS: com um grupo so os dois criterios empatam.
//
// AS TRAVAS QUE ESTE RUNNER NAO DISPENSA
// --------------------------------------
// 1. O TRECHO APARECE EXATAMENTE UMA VEZ. `String.replace` com string troca a
//    PRIMEIRA ocorrencia: um alvo que aparece duas vezes muta um lugar que o
//    rotulo nao descreve, e a linha de saida passa a mentir sobre o que mediu.
// 2. A SUITE ESTA VERDE ANTES. Suite ja vermelha faz todo mutante "morrer" sem
//    nada ter sido medido -- 100% de mortalidade com zero poder de deteccao.
// 3. A ARVORE RASTREADA NAO E TOCADA: `criarBlocoDeMutantes` espelha o repo em
//    diretorio temporario e muta so la.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const TELA = "components/movimentacoes/PainelQuemMePaga.tsx";

const mutantes = [
  // -------------------------------------------------------------------------
  // OS DOIS DA ISSUE: a entrega desligada
  // -------------------------------------------------------------------------
  [
    TELA,
    "painel_sempre_nulo: o painel nunca desenha -- a tela de antes desta issue",
    "  if (!credito || credito.linhas.length === 0) return null;",
    "  if (true) return null;",
  ],
  [
    TELA,
    "nota_apagada: o painel desenha sem dizer que o valor JA ESTA no «Previsto»",
    "          {NOTA_QUEM_ME_PAGA}",
    "          {\"\"}",
  ],
  [
    TELA,
    "titulo_apagado: o painel desenha sem titulo -- uma lista de nomes sem rotulo",
    "        <p className=\"text-sm text-muted-foreground\">{TITULO_QUEM_ME_PAGA}</p>",
    "        <p className=\"text-sm text-muted-foreground\">{\"\"}</p>",
  ],

  // -------------------------------------------------------------------------
  // O ROTULO: as duas classes que so o DOM denuncia
  // -------------------------------------------------------------------------
  [
    TELA,
    "rotulo_pelo_nome_cru: imprime o nome cru e o perfil ilegivel fica SEM rotulo",
    "                  <p className=\"text-sm break-words\">{devedor.texto}</p>",
    "                  <p className=\"text-sm break-words\">{linha.devedor}</p>",
  ],
  [
    TELA,
    "marca_calculada_a_parte: o data-tem-nome sai do campo cru e MENTE no nome em branco",
    "                    data-tem-nome={devedor.temNome ? \"sim\" : \"nao\"}",
    "                    data-tem-nome={linha.devedor ? \"sim\" : \"nao\"}",
  ],

  // -------------------------------------------------------------------------
  // A LINHA: a chave, o grupo e o valor
  // -------------------------------------------------------------------------
  [
    TELA,
    "chave_so_do_devedor: a mesma pessoa em dois grupos colapsa numa linha so",
    "                key={`${linha.group_id}:${linha.devedor_user_id}`}",
    "                key={linha.devedor_user_id}",
  ],
  [
    TELA,
    "grupo_pelo_id: a linha diz o uuid do grupo em vez do nome dele",
    "                    {linha.grupo}",
    "                    {linha.group_id}",
  ],
  [
    TELA,
    "valor_no_atributo_errado: o span marca o valor de outro campo da linha",
    "                  data-valor-do-devedor={linha.valor}",
    "                  data-valor-do-devedor={credito.total}",
  ],
  [
    TELA,
    "valor_formatado_do_total: a linha IMPRIME o total do painel no lugar do dela",
    "                  {formatCurrency(linha.valor)}",
    "                  {formatCurrency(credito.total)}",
  ],

  // -------------------------------------------------------------------------
  // O SALDO SEM DEVEDOR: a linha que impede a soma de nao fechar
  // -------------------------------------------------------------------------
  [
    TELA,
    "sem_devedor_sempre: escreve 'mais R$ 0,00 sem devedor' para todo mundo",
    "          {credito.sem_devedor > 0 && (",
    "          {credito.sem_devedor >= 0 && (",
  ],
  [
    TELA,
    "sem_devedor_nunca: o saldo orfao DESAPARECE e a soma da tela nao fecha",
    "          {credito.sem_devedor > 0 && (",
    "          {false && (",
  ],

  // -------------------------------------------------------------------------
  // A PORTA: `null` e lista vazia tem de dar o MESMO nada
  // -------------------------------------------------------------------------
  [
    TELA,
    "lista_vazia_desenha: quem nao tem grupo ve um painel vazio",
    "  if (!credito || credito.linhas.length === 0) return null;",
    "  if (!credito) return null;",
  ],
];

const SUITES = ["test:quem-me-paga-na-tela"];

const bloco = criarBlocoDeMutantes({
  rotulo: "quem-me-paga",
  suites: SUITES,
});

// A sombra vive em diretorio temporario e a arvore rastreada nunca e mutada. O
// handler de sinal existe so para que nem o diretorio orfao sobre.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// O texto de cada arquivo que algum mutante toca. Lido da arvore de verdade, que
// e o original por construcao: nada mais aqui escreve nela. Montado DEPOIS da
// lista, pelos alvos distintos dela -- `const` multilinha declarada ANTES da
// lista faz o recorte de `mede-ancora-ambigua.mjs` levar a lista inteira e a
// guarda de ancora morrer com a main vermelha para todos.
const original = new Map();
for (const arquivo of new Set(mutantes.map(([alvo]) => alvo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO: a arvore INTACTA tem de passar na suite antes de qualquer
// mutante, e pelo MESMO `rodar` que os mutantes usam -- por isso ele pega erro
// no aparelho (Chromium ausente, .tmp mal montado). Sem ele, uma sombra mal
// montada reprova TODO mutante e o placar sai "N/N mortos" sobre zero assercoes
// executadas.
for (const suite of SUITES) {
  const controle = bloco.rodar("controle", {}, suite);
  if (!controle.verde) {
    console.error(
      `ABORTADO: a arvore INTACTA reprova em ${suite} (${controle.como}).`
    );
    console.error(`  ${controle.saida}`);
    console.error(
      "O placar nao valeria: todo mutante 'morreria' sem ter sido medido."
    );
    process.exit(1);
  }
}
console.log(`controle positivo: a arvore intacta passa em ${SUITES.join(" e ")}\n`);

let sobreviventes = 0;

for (const [alvo, nome, de, para] of mutantes) {
  const antes = original.get(alvo);

  // AS TRES TRAVAS DE ANCORA. `String.replace` troca a PRIMEIRA ocorrencia, e um
  // `de` que aparece duas vezes muta um lugar que o rotulo nao descreve.
  const ocorrencias = antes.split(de).length - 1;
  if (ocorrencias === 0) {
    console.error(`SOBREVIVEU (ancora nao casou) :: ${nome}`);
    console.error(`  o texto buscado nao existe em ${alvo}: ${de}`);
    sobreviventes++;
    continue;
  }
  if (ocorrencias > 1) {
    console.error(`SOBREVIVEU (ancora ambigua) :: ${nome}`);
    console.error(
      `  o texto buscado aparece ${ocorrencias}x em ${alvo}; o rotulo descreve UM lugar`
    );
    sobreviventes++;
    continue;
  }

  const depois = antes.replace(de, para);

  let morreu = false;
  let como = "";
  for (const suite of SUITES) {
    const r = bloco.rodar(nome, { [alvo]: depois }, suite);
    if (!r.verde) {
      morreu = true;
      como = `${suite} (${r.como})`;
      break;
    }
  }

  if (morreu) {
    console.log(`morto por ${como} :: ${nome}`);
  } else {
    console.error(`SOBREVIVEU :: ${nome}`);
    sobreviventes++;
  }
}

console.log(
  `\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`
);

if (sobreviventes > 0) {
  console.error(
    `\n${sobreviventes} mutante(s) sobreviveram: ha trecho que nenhuma assercao distingue.`
  );
  process.exit(1);
}
