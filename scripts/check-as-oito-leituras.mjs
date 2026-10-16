#!/usr/bin/env node
// =====================================================
// AS LEITURAS DA AGENDA LEEM `my_status` (HMO-411, HMO-416)
// =====================================================
//   npm run check-as-oito-leituras
//
// «OITO» E O NOME HISTORICO, E HOJE SAO NOVE MAIS TRES EXCECOES. A HMO-411
// moveu oito leituras e deixou tres da mesma view em `status` sem estarem em
// lista nenhuma -- nem medidas, nem declaradas. A HMO-416 decidiu as tres, uma
// a uma: a da fatura do cartao e sobre a PESSOA e trocou (virou a nona de
// `LEITURAS`); as duas do grupo sao sobre a CONTA e entraram em `EXCECOES`,
// cada uma com o paragrafo que diz por que. O arquivo conserva o nome para nao
// mexer no step do CI nem no `package.json` por causa de um numero; quem conta
// e `LEITURAS.length`, e a mensagem final imprime os dois totais.
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
// E E UM GUARD DE CONVENCAO, TAMBEM. Quatro das nove (safe-to-spend,
// projection, cash-flow e a fatura do cartao) filtram `user_id = auth.uid()` na
// mao e por isso NAO mudam de numero: para linha minha a 055 garante
// `my_status = status::text`, e a secao 2 de
// database/tests/hmo407_pagamento_de_conta_de_grupo_test.sql prende essa
// igualdade sobre seis linhas do proprio dono. Elas trocaram assim mesmo para
// haver UMA convencao -- com metade das rotas numa coluna e metade na outra, a
// proxima pessoa teria de descobrir caso a caso. Este arquivo e o que torna
// essa convencao verificavel.
//
// PARA AS QUATRO INERTES, ESTE GUARD E A UNICA MEDIDA POSSIVEL, e vale dizer
// por que: «inerte» quer dizer que nenhuma assercao de COMPORTAMENTO consegue
// distinguir as duas colunas ali. Uma suite de rota montada sobre conta
// individual passa verde com qualquer das duas, hoje e no dia da reversao --
// seria controle negativo vacuo. Quem mede a convencao e a lista abaixo; quem
// mede o NUMERO e a secao 2 do teste da 055, no banco.
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
  // A NONA, da HMO-416. Mesmo argumento das tres inertes acima: ela filtra
  // `user_id = auth.uid()` na linha de cima, entao a troca nao mudou numero --
  // entrou para a convencao ser uma so. Ver o comentario na rota.
  [
    "app/api/card-invoices/route.ts",
    "as previsoes pendentes do cartao",
    "filtro",
  ],
];

/** `my_status` ou `my_effective_status` -- o estado DA PESSOA. */
const daPessoa = (colunas) =>
  colunas.some((c) => c === "my_status" || c === "my_effective_status");

/**
 * AS EXCECOES DECLARADAS, e nenhuma delas e esquecimento.
 *
 * Cada entrada e `[arquivo, porque, onde]`. O `onde` e o mesmo campo de
 * `LEITURAS` e pela mesma razao -- so que invertido: diz em que lugar da cadeia
 * a coluna DA CONTA tem de continuar aparecendo. As tres nao usam o mesmo
 * verbo, e um guard que exigisse `.neq("status", "paid")` das tres (a forma da
 * primeira) reprovaria as duas que trazem a coluna no `select` e decidem em JS.
 *
 * Esta lista existe para que a excecao seja uma DECISAO escrita, e nao uma
 * ausencia. Acrescentar um arquivo aqui tem de custar o paragrafo que explica
 * por que aquela leitura e sobre a conta.
 */
const EXCECOES = [
  [
    "app/api/expense-groups/[groupId]/scheduled/route.ts",
    "a tela do grupo (HMO-411)",
    "filtro",
  ],
  [
    "app/api/expense-groups/[groupId]/fechamento/route.ts",
    "o fechamento do mes do grupo (HMO-416)",
    "select",
  ],
  [
    "app/api/expense-groups/[groupId]/semear-divisao/route.ts",
    "a semeadura pela renda (HMO-416)",
    "select",
  ],
];

// POR QUE AS TRES SAO SOBRE A CONTA, uma a uma -- o paragrafo que esta lista
// cobra:
//
//   1. A TELA DO GRUPO (HMO-411) filtra `.neq("status", "paid")` de proposito:
//      o GRUPO nao tem status de pago. Quando o dono da baixa, a despesa vira
//      real, o rateio nasce e a linha passa para a aba de despesas -- ela sai
//      das previstas. Lendo `my_status` aqui o aluguel apareceria nas DUAS
//      abas.
//
//   2. O FECHAMENTO DO MES (HMO-416) traz a coluna no `select` e decide em
//      `linhaDoPrevisto`, que devolve `null` para a conta com baixa. A exclusao
//      e a unica defesa contra contar a mesma conta duas vezes: a baixa criou a
//      transacao real, que ja entrou pelo lado realizado. E a rota filtra
//      `group_id` e MAIS NADA -- ela traz a linha de todos os membros. Para a
//      conta de OUTRO membro que ele ja pagou, `status` = `paid` mas o meu
//      `my_status` e `COALESCE(<a minha linha de pagamento>, 'pending')` =
//      `pending`: a prevista nao seria descartada, somaria em cima da
//      realizada, e o total do grupo sairia DOBRADO naquela conta.
//
//   3. A SEMEADURA PELA RENDA (HMO-416) e a mesma aritmetica no lado da
//      receita, pela mesma `linhaDoPrevisto` -- e tem uma segunda razao, mais
//      forte, que e propria dela: ela le pelo CLIENTE DE SERVICE ROLE
//      (`createServiceClient`, a leitura privilegiada da rota). Ali
//      `auth.uid()` e NULL, e as duas pernas do CASE da 055 dependem dele --
//      `s.user_id = auth.uid()` nunca e verdade e o join
//      `p.user_id = auth.uid()` nunca casa. `my_status` desaba para a
//      CONSTANTE `'pending'` em toda linha, inclusive nas pagas. Trocar aqui
//      nao trocaria de criterio: apagaria o criterio, e toda receita prevista
//      ja recebida contaria duas vezes na semeadura.
//
// As tres fazem a MESMA pergunta -- "esta conta do grupo ja aconteceu?" --, que
// e a pergunta de que a aritmetica do grupo precisa. Nenhuma pergunta "eu ja
// paguei a MINHA parte?": essa e a pergunta da HMO-411, e as rotas que a fazem
// nao passam por esta cadeia (a tela do grupo monta o estado por membro de
// `group_bill_payments`, lida a parte, e nao da coluna da view).

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

/**
 * As colunas de estado que a cadeia FILTRA e as que ela PEDE no `select`.
 *
 * Um extrator so, usado pelas duas direcoes do guard -- as nove leituras e as
 * tres excecoes. Dois extratores (um por direcao) e o que faz uma mudanca de
 * forma consertar metade do guard e deixar a outra metade medindo nada; e aqui
 * nao ha o risco de `conferidor-com-o-mesmo-extrator-nos-dois-lados-passa-
 * vacuo`, porque os dois lados nao sao as duas pontas de uma igualdade: sao
 * duas assercoes opostas sobre a MESMA extracao.
 */
function colunasDaCadeia(cadeia) {
  // AS COLUNAS FILTRADAS, extraidas como palavra inteira. O regex pega
  // `.eq("coluna"`, `.in("coluna"`, `.neq("coluna"` e `.gte/.lte`, que sao os
  // verbos que estas rotas usam.
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

  return { filtradas, pedidas };
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

  const { filtradas, pedidas } = colunasDaCadeia(cadeia);
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

// AS EXCECOES SAO CONFERIDAS AO CONTRARIO: elas TEM de continuar lendo a coluna
// da CONTA. Sem esta metade, alguem "arrumando" as tres para `my_status` faria
// a conta de grupo ja paga voltar para dentro das somas -- na tela, nas DUAS
// abas; no fechamento e na semeadura, como total dobrado.
//
// E SAO DUAS ASSERCOES, NAO UMA, e a segunda nao e redundante:
//
//   (a) a coluna da conta TEM de aparecer no `onde` declarado. Pega quem trocou
//       `status` por `my_status` no lugar -- e pega tambem quem simplesmente a
//       APAGOU do `select`: ali `linha.status` chega `undefined`, nunca e
//       `"paid"`, e `linhaDoPrevisto` para de descartar a conta com baixa. O
//       sintoma e total dobrado, sem erro nenhum.
//
//   (b) a coluna da PESSOA nao pode aparecer em lugar nenhum da cadeia. Sem
//       esta, o caminho de defeito mais provavel passa verde: acrescentar
//       `my_status` ao `select` ao LADO de `status` (a (a) continua satisfeita)
//       e depois mudar o consumidor em JS para ler o campo novo. A decisao
//       escrita aqui e "esta leitura nao usa o estado da pessoa", e e isso que
//       (b) mede.
for (const [arquivo, apelido, onde] of EXCECOES) {
  const cadeia = cadeiaDaView(semComentarios(readFileSync(arquivo, "utf8")));

  if (!cadeia) {
    falhas += 1;
    console.error(
      `\n✖ ${arquivo} (${apelido})\n` +
        `  nao achei um \`.from("${VIEW}")\` legivel.\n` +
        "  ou a excecao saiu da view, ou a forma da cadeia mudou e esta metade " +
        "do guard parou de medir -- as duas pedem olho humano."
    );
    continue;
  }

  const { filtradas, pedidas } = colunasDaCadeia(cadeia);
  const ondeEsta = onde === "filtro" ? filtradas : pedidas;

  // (a) a coluna da CONTA, no lugar declarado.
  if (!ondeEsta.some((c) => DO_DONO.includes(c))) {
    falhas += 1;
    console.error(
      `\n✖ ${arquivo} (${apelido})\n` +
        `  a excecao declarada perdeu \`status\` do ${onde} da cadeia da view.\n` +
        "  o GRUPO nao tem status de pago, e isso foi pedido: a conta paga sai " +
        "das previstas porque a baixa cria a transacao real e o rateio. Esta " +
        "leitura e sobre a CONTA -- ver o paragrafo dela em `EXCECOES`.\n" +
        (onde === "filtro"
          ? "  ela recorta no banco: o `.neq(\"status\", \"paid\")` tem de voltar."
          : "  ela traz a coluna e decide em JS (`linhaDoPrevisto` descarta a " +
            "conta com baixa). Sem `status` no `select` o campo chega " +
            "`undefined`, nada e descartado, e o total sai DOBRADO.")
    );
  }

  // (b) e NENHUMA coluna da pessoa, em lugar nenhum da cadeia.
  const daPessoaNaCadeia = [...filtradas, ...pedidas].filter((c) =>
    daPessoa([c])
  );
  if (daPessoaNaCadeia.length > 0) {
    falhas += 1;
    console.error(
      `\n✖ ${arquivo} (${apelido})\n` +
        `  a cadeia da view passou a usar \`${daPessoaNaCadeia.join("`, `")}\`, ` +
        "que e o estado da PESSOA.\n" +
        "  esta leitura esta em `EXCECOES` por uma decisao escrita: a pergunta " +
        "dela e «esta conta do grupo ja aconteceu?», e nao «eu ja paguei a " +
        "minha parte?». Se a decisao mudou, mude o paragrafo e mova o arquivo " +
        "para `LEITURAS` -- nao acrescente a coluna aqui."
    );
  }
}

if (falhas) {
  console.error(`\n${falhas} verificacao(oes) falharam.`);
  process.exit(1);
}

console.log(
  `✔ as ${LEITURAS.length} leituras de ${VIEW} usam o estado da PESSOA, ` +
    `e as ${EXCECOES.length} excecoes declaradas seguem no estado da CONTA.`
);
