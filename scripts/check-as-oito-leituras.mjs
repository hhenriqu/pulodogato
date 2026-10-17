#!/usr/bin/env node
// =====================================================
// AS OITO LEITURAS DA AGENDA LEEM `my_status` (HMO-411)
// =====================================================
//   npm run check-as-oito-leituras
//
// `scheduled_transactions` tem UMA coluna `status` e ela e do DONO. Numa conta
// de grupo isso quer dizer que a conta sumia do «a pagar» de todos os membros
// no instante em que o dono pagava -- eles ainda deviam a parte deles. A
// migration 055 pos o estado POR PESSOA na view (`my_status`,
// `my_effective_status`), e as oito leituras de dinheiro trocaram.
//
// POR QUE UM GUARD, E NAO SO AS SUITES
// ------------------------------------
// QUATRO das oito tem prova de comportamento ponta a ponta, com duble de
// supabase, em `scripts/test-leituras-do-mybank.mjs`: a lista, o «A vencer»,
// o safe-to-spend e as telas de Receitas/Despesas. As outras QUATRO --
// previsao, papel de pao, projection e cash-flow -- nao tem rota montada em
// suite nenhuma deste repositorio, e o cliente do supabase aqui NAO e tipado
// (nao existe `database.types.ts`): `.eq("status", ...)` e `.eq("my_status",
// ...)` passam identicos pelo `tsc`. Sem este guard, a copia esquecida em uma
// delas seria invisivel -- e o sintoma nao e erro, e a conta de grupo do outro
// membro entrando ou saindo de uma soma de dinheiro.
//
// E E UM GUARD DE CONVENCAO, TAMBEM. Tres das oito (safe-to-spend, projection,
// cash-flow) filtram `user_id = auth.uid()` na mao e por isso NAO mudam de
// numero: para linha minha a 055 garante `my_status = status::text`. Elas
// trocaram assim mesmo para haver UMA convencao -- com metade das rotas numa
// coluna e metade na outra, a proxima pessoa teria de descobrir caso a caso.
// Este arquivo e o que torna essa convencao verificavel.
//
// O FONTE VEM SEM COMENTARIO, E AQUI ISSO E LOAD-BEARING: as oito rotas
// EXPLICAM a troca em comentario e escrevem `status` dentro da explicacao --
// `assercao-sobre-codigo-fonte-le-o-comentario`. Com os comentarios dentro,
// este guard reprovaria a arvore certa.
//
// E A COMPARACAO E DE COLUNA INTEIRA, NUNCA DE SUBSTRING: `my_status` CONTEM
// `status`, e um `includes("status")` casaria com a coluna nova --
// `guard-de-includes-casa-dentro-de-identificador-maior`.
// =====================================================

import { readFileSync } from "node:fs";
import { semComentarios } from "./varredura-de-fonte.mjs";

/** A view cujo estado esta sendo trocado. */
const VIEW = "scheduled_transactions_effective";

/**
 * As oito, na ordem da issue, COM O LUGAR EM QUE CADA UMA USA O ESTADO.
 *
 * `onde` NAO E BUROCRACIA, e foi um mutante sobrevivente que o pos aqui. Com
 * um criterio unico ("a cadeia cita `my_status` em algum lugar"), apagar o
 * FILTRO de uma rota que tambem tem a coluna no `select` passava verde -- e
 * uma leitura que deixa de filtrar por estado nao e inocua: e a conta ja paga
 * voltando para dentro da soma.
 *
 *   * `filtro` -- a rota recorta no banco (`.eq("my_status", "pending")`);
 *   * `select` -- a rota traz a coluna e classifica em JS, porque precisa
 *     somar as linhas em mais de um balde (o «A vencer» separa vencido de a
 *     vencer; o papel de pao tira `skipped`/`cancelled` do previsto).
 */
const LEITURAS = [
  ["app/api/scheduled-transactions/route.ts", "a lista de Contas a Pagar", "filtro"],
  [
    "app/api/scheduled-transactions/summary/route.ts",
    "o cabecalho «a vencer» / «a pagar»",
    "select",
  ],
  ["app/api/dashboard/previsao/route.ts", "a previsao do painel", "filtro"],
  ["app/api/movimentacoes/resumo/route.ts", "as telas de Receitas/Despesas", "select"],
  ["app/api/papel-de-pao/painel/route.ts", "o painel do modo Papel de Pao", "select"],
  ["app/api/safe-to-spend/route.ts", "o posso gastar", "filtro"],
  ["app/api/projection/route.ts", "a projecao", "filtro"],
  ["app/api/cash-flow/route.ts", "o fluxo de caixa", "filtro"],
];

/** `my_status` ou `my_effective_status` -- o estado DA PESSOA. */
const daPessoa = (colunas) =>
  colunas.some((c) => c === "my_status" || c === "my_effective_status");

/**
 * A EXCECAO DECLARADA, e ela nao e esquecimento.
 *
 * `app/api/expense-groups/[groupId]/scheduled/route.ts` le a MESMA view e
 * continua filtrando `.neq("status", "paid")` de proposito: o GRUPO nao tem
 * status de pago. Quando o dono da baixa, a despesa vira real, o rateio nasce
 * e a linha passa para a aba de despesas -- ela sai das previstas. A pergunta
 * ali e sobre a CONTA, nao sobre a pessoa.
 *
 * Esta lista existe para que a excecao seja uma DECISAO escrita, e nao uma
 * ausencia. Acrescentar um arquivo aqui tem de custar o paragrafo que explica
 * por que aquela leitura e sobre a conta.
 */
const EXCECOES = new Set([
  "app/api/expense-groups/[groupId]/scheduled/route.ts",
]);

/** As colunas de estado que sao do DONO -- nenhuma das oito pode usa-las. */
const DO_DONO = ["status", "effective_status"];

/**
 * As colunas de estado que uma chamada do PostgREST filtra, nesta cadeia.
 *
 * O recorte e a CADEIA da view, e nao o arquivo inteiro: as oito rotas tambem
 * consultam `group_members` com `.eq("status", "active")`, e um guard de
 * arquivo inteiro casaria com AQUELA consulta e mandaria consertar a errada --
 * `guard-de-arquivo-inteiro-casa-com-outra-consulta-da-rota`.
 */
function cadeiaDaView(fonte) {
  const inicio = fonte.indexOf(`.from("${VIEW}")`);
  if (inicio === -1) return null;

  // A cadeia literal vai ate o `;` que a termina: `.select(...)`, `.eq(...)`,
  // `.in(...)` e `.order(...)` estao dentro dela.
  const fim = fonte.indexOf(";", inicio);
  const literal = fonte.slice(inicio, fim === -1 ? fonte.length : fim);

  // E A CONTINUACAO POR VARIAVEL, que NAO e detalhe de forma: a lista de
  // Contas a Pagar monta os filtros DEPOIS, em `query = query.eq(...)`, porque
  // o recorte de status vem de um `?status=` da URL e tem tres ramos. Um guard
  // que parasse no `;` leria aquela rota como "nao filtra por estado nenhum" e
  // reprovaria a arvore certa -- enquanto deixava passar verde o dia em que os
  // tres ramos voltassem para `status`.
  //
  // O alvo e a VARIAVEL que recebeu a cadeia, e e isso que mantem o recorte
  // honesto: `.eq("status", "active")` de `group_members` mora em outra
  // variavel (ou em cadeia propria), e nao entra.
  const atribuicao = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]*$/.exec(
    fonte.slice(0, inicio)
  );
  if (!atribuicao) return literal;

  const alvo = atribuicao[1];
  const continuacoes = [
    ...fonte
      .slice(fim === -1 ? fonte.length : fim)
      .matchAll(
        new RegExp(`\\b${alvo}\\s*=\\s*${alvo}\\s*((?:\\.\\w+\\([^;]*?\\))+)`, "g")
      ),
  ].map((m) => m[1]);

  return [literal, ...continuacoes].join("\n");
}

let falhas = 0;

for (const [arquivo, apelido, onde] of LEITURAS) {
  const fonte = semComentarios(readFileSync(arquivo, "utf8"));
  const cadeia = cadeiaDaView(fonte);

  if (!cadeia) {
    falhas += 1;
    console.error(
      `\n✖ ${arquivo} (${apelido})\n` +
        `  nao achei um \`.from("${VIEW}")\` legivel.\n` +
        "  ou a leitura saiu da view, ou a forma da cadeia mudou e este guard " +
        "parou de medir -- as duas pedem olho humano."
    );
    continue;
  }

  // AS COLUNAS FILTRADAS, extraidas como palavra inteira. O regex pega
  // `.eq("coluna"`, `.in("coluna"`, `.neq("coluna"` e `.gte/.lte`, que sao os
  // verbos que estas oito usam.
  const filtradas = [...cadeia.matchAll(/\.(?:eq|neq|in|gte|lte)\(\s*"([^"]+)"/g)].map(
    (m) => m[1]
  );

  // E AS COLUNAS PEDIDAS NO `select`, tambem como palavra inteira: o
  // `my_status` que a rota soma em JS entra por aqui, nao por filtro.
  const select = /\.select\(\s*(?:`([^`]*)`|"([^"]*)")/.exec(cadeia);
  const pedidas = (select?.[1] ?? select?.[2] ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  const usadas = [...filtradas, ...pedidas];

  for (const proibida of DO_DONO) {
    if (usadas.includes(proibida)) {
      falhas += 1;
      console.error(
        `\n✖ ${arquivo} (${apelido})\n` +
          `  a cadeia da view ainda usa \`${proibida}\`, que e a coluna do DONO.\n` +
          `  troque por \`my_${proibida}\`: numa conta de grupo, \`${proibida}\` e o ` +
          "estado de quem criou a conta, e a linha some do «a pagar» dos outros " +
          "membros no instante em que ele paga."
      );
    }
  }

  // E O CONTROLE POSITIVO, arquivo por arquivo E NO LUGAR CERTO -- ver o
  // comentario de `onde` em LEITURAS. Exigir a coluna "em algum lugar da
  // cadeia" deixava sobreviver o mutante que apaga o FILTRO de uma rota que
  // tambem a traz no `select`, e uma leitura que para de filtrar por estado
  // nao e o conserto: e a conta ja paga voltando para dentro da soma.
  const ondeEsta = onde === "filtro" ? filtradas : pedidas;
  if (!daPessoa(ondeEsta)) {
    falhas += 1;
    console.error(
      `\n✖ ${arquivo} (${apelido})\n` +
        `  o estado da pessoa nao aparece no ${onde} da cadeia da view.\n` +
        (onde === "filtro"
          ? "  esta rota recorta no banco (`.eq(\"my_status\", ...)`). Sem o filtro " +
            "ela passa a somar a conta ja paga, e a coluna no `select` nao " +
            "substitui isso -- ninguem a le."
          : "  esta rota traz a coluna e classifica em JS (ela soma em mais de um " +
            "balde). Sem a coluna no `select`, o campo chega `undefined` e toda " +
            "linha cai no balde errado, sem erro nenhum.")
    );
  }
}

// A EXCECAO E CONFERIDA AO CONTRARIO: ela TEM de continuar lendo `status`.
// Sem esta metade, alguem "arrumando" a tela do grupo para `my_status` faria a
// conta prevista reaparecer na aba de previstas depois da baixa -- dobrando o
// aluguel na tela, porque a despesa ja esta na aba de despesas.
for (const arquivo of EXCECOES) {
  const cadeia = cadeiaDaView(semComentarios(readFileSync(arquivo, "utf8")));
  if (!cadeia || !/\.neq\(\s*"status"/.test(cadeia)) {
    falhas += 1;
    console.error(
      `\n✖ ${arquivo}\n` +
        '  a excecao declarada perdeu o `.neq("status", "paid")`.\n' +
        "  o GRUPO nao tem status de pago, e isso foi pedido: a conta paga sai " +
        "das previstas porque a baixa cria a transacao real e o rateio, e a " +
        "despesa passa para a aba de despesas. Lendo `my_status` aqui, ela " +
        "voltaria -- e o aluguel apareceria nas DUAS abas."
    );
  }
}

if (falhas) {
  console.error(`\n${falhas} verificacao(oes) falharam.`);
  process.exit(1);
}

console.log(
  `✔ as ${LEITURAS.length} leituras de ${VIEW} usam o estado da PESSOA, ` +
    `e a ${EXCECOES.size} excecao declarada segue no estado da CONTA.`
);
