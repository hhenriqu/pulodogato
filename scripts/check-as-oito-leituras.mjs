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
//
// O NOME DO ARQUIVO E HISTORICO: HOJE SAO NOVE E QUATRO (HMO-416)
// ---------------------------------------------------------------
// A HMO-411 fechou com oito leituras medidas e UMA excecao declarada, e deixou
// escrito que outras tres leitoras da mesma view tinham ficado em `status` sem
// entrar em lista nenhuma -- nem medidas, nem declaradas. Era o estado exato
// que este arquivo existe para impedir, so que uma camada acima: a convencao
// valia para as leituras que alguem lembrou de listar.
//
// A HMO-416 decidiu as tres uma a uma (e achou uma QUARTA, em
// `lib/services/credito-dos-grupos.ts`, que nem a issue tinha visto):
//
//   * `app/api/card-invoices/route.ts` -> TROCOU. Ela filtra `user_id` na mao,
//     entao a troca nao muda numero nenhum; ela e de convencao, igual as tres
//     que a propria HMO-411 trocou por esse motivo. Virou a NONA de `LEITURAS`;
//   * as outras tres -> EXCECAO, cada uma com o paragrafo. Todas perguntam
//     sobre a CONTA ("esta conta prevista ja recebeu baixa?") e nao sobre a
//     pessoa, e nas tres a resposta errada e a MESMA: a conta ja paga contada
//     outra vez, em cima da transacao real que a baixa criou.
//
// O arquivo continua se chamando `check-as-oito-leituras` de proposito: o nome
// e o marco da HMO-411, o CI e o `package.json` o invocam por ele, e renomear
// custaria mais do que informa. A contagem de verdade sai no fim da execucao, e
// vem de `LEITURAS.length` / `EXCECOES.length` -- nunca de um numero escrito a
// mao, que e como "oito" sobreviveria a decima leitura.
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
// A LEITURA DO PAINEL DO PAPEL DE PAO SAIU NA HMO-470 (F6 do plano da HMO-462).
// `app/api/papel-de-pao/painel/route.ts` foi apagada junto com a tela que a
// chamava -- a conversa (`ConversaDePapel`) nao le `scheduled_transactions`,
// ela le o REALIZADO de `financial_transactions`, e por isso nao entra nesta
// lista no lugar daquela. A contagem desta guarda sai de `LEITURAS.length`, e
// nao de um "oito" escrito a mao, entao ela se ajustou sozinha.
const LEITURAS = [
  ["app/api/scheduled-transactions/route.ts", "a lista de Contas a Pagar", "filtro"],
  [
    "app/api/scheduled-transactions/summary/route.ts",
    "o cabecalho «a vencer» / «a pagar»",
    "select",
  ],
  // A PREVISAO DO PAINEL FILTRA AS DUAS COLUNAS, e o quarto campo e o porque.
  // Ela le `my_status` como as outras E exige `status = 'pending'` do dono: o
  // Realizado do mesmo painel ja conta a minha parte da conta de grupo que o
  // dono pagou (`group_share_entries`, HMO-418), e deixa-la no previsto pelo
  // `my_status` somava a mesma parte duas vezes (R$ 406,73 onde o certo era
  // R$ 237,81, conta da Lais, 22/10/2026). O guard exige o `status` nela, e
  // continua recusando-o em todas as outras.
  [
    "app/api/dashboard/previsao/route.ts",
    "a previsao do painel",
    "filtro",
    "o realizado do painel ja conta a minha parte da conta de grupo que o dono pagou",
  ],
  ["app/api/movimentacoes/resumo/route.ts", "as telas de Receitas/Despesas", "select"],
  ["app/api/safe-to-spend/route.ts", "o posso gastar", "filtro"],
  ["app/api/projection/route.ts", "a projecao", "filtro"],
  ["app/api/cash-flow/route.ts", "o fluxo de caixa", "filtro"],
  // A NONA (HMO-416), e ela entrou pelo mesmo argumento das tres de convencao
  // acima: `.eq("user_id", user.id)` na mesma cadeia, entao a troca nao mexe em
  // numero nenhum. O que ela compra e a ausencia da pergunta "por que ESTA
  // ficou em `status`?" -- que e o que custou a HMO-416 inteira.
  ["app/api/card-invoices/route.ts", "as previsoes do cartao na tela da fatura", "filtro"],
];

/** `my_status` ou `my_effective_status` -- o estado DA PESSOA. */
const daPessoa = (colunas) =>
  colunas.some((c) => c === "my_status" || c === "my_effective_status");

/**
 * AS EXCECOES DECLARADAS, e nenhuma delas e esquecimento.
 *
 * Todas leem a MESMA view e todas continuam em `status` de proposito, pela
 * mesma razao de fundo: a pergunta delas e sobre a CONTA ("esta conta prevista
 * ja recebeu baixa?") e nao sobre a pessoa que esta lendo. Em todas, o recorte
 * e por `group_id`/`user_id` de OUTROS -- vem conta de gente que nao sou eu --,
 * e `my_status` naquela linha e a MINHA parte nela, que e outra pergunta.
 *
 * Esta lista existe para que a excecao seja uma DECISAO escrita, e nao uma
 * ausencia. Acrescentar um arquivo aqui tem de custar o paragrafo que explica
 * por que aquela leitura e sobre a conta -- e o paragrafo mora no proprio
 * arquivo, junto da consulta, que e onde a proxima pessoa vai estar.
 *
 * `onde` E `forma` NAO SAO BUROCRACIA, e e a mesma licao do `onde` de
 * `LEITURAS`: as quatro guardam `status` em LUGARES DIFERENTES da cadeia. A
 * tela do grupo recorta no banco (`.neq("status", "paid")`); as outras tres
 * trazem a coluna no `select` e descartam a conta paga em `linhaDoPrevisto`.
 * Um criterio unico ("a cadeia cita `status` em algum lugar") absolveria a
 * metade errada de cada uma: a tela do grupo perdendo o `.neq` mas mantendo
 * `status` no `select` passaria verde, e o fechamento perdendo `status` do
 * `select` mas ganhando um `.eq("status", ...)` qualquer tambem.
 *
 * `forma` e o que resta de especifico quando `onde` ja casou: para a tela do
 * grupo, o filtro tem de ser EXATAMENTE `.neq("status", "paid")`. Sem isso um
 * `.eq("status", "paid")` -- que inverte a tela inteira -- continuaria dentro
 * de "filtra por status".
 */
const EXCECOES = [
  {
    arquivo: "app/api/expense-groups/[groupId]/scheduled/route.ts",
    apelido: "a aba de previstas da tela do grupo",
    onde: "filtro",
    forma: /\.neq\(\s*"status"\s*,\s*"paid"\s*\)/,
    porque:
      "o GRUPO nao tem status de pago. Quando o dono da baixa, a despesa vira " +
      "real, o rateio nasce e a linha passa para a aba de despesas -- ela sai " +
      "das previstas. Lendo `my_status` aqui, ela voltaria, e o aluguel " +
      "apareceria nas DUAS abas.",
  },
  {
    arquivo: "app/api/expense-groups/[groupId]/fechamento/route.ts",
    apelido: "o fechamento do mes do grupo",
    onde: "select",
    forma: null,
    porque:
      "`linhaDoPrevisto` descarta a conta com `status === 'paid'` porque a " +
      "transacao real que a baixa criou JA esta no lado realizado deste mesmo " +
      "fechamento. Com `my_status`, a conta que o dono pagou chega `pending` " +
      "(ela nao e minha) e a internet de R$ 159,90 vira R$ 319,80.",
  },
  {
    arquivo: "app/api/expense-groups/[groupId]/semear-divisao/route.ts",
    apelido: "a semeadura da divisao por renda",
    onde: "select",
    forma: null,
    porque:
      "esta le pelo cliente de SERVICE ROLE (`admin`), e sem sessao " +
      "`auth.uid()` e NULL: as duas colunas da 055 sao definidas em cima dele, " +
      "entao `my_status` desabaria para a CONSTANTE 'pending' em toda linha. " +
      "`linhaDoPrevisto` pararia de descartar qualquer conta paga e a divisao " +
      "sairia semeada com o dobro da renda de quem mais recebeu.",
  },
  {
    arquivo: "lib/services/credito-dos-grupos.ts",
    apelido: "o credito dos grupos",
    onde: "select",
    forma: null,
    porque:
      "mesma pergunta do fechamento, no servico que as abas de movimentacao e " +
      "o «meu credito» compartilham: o recorte e por `group_id`, vem conta de " +
      "todo membro, e contar a ja paga outra vez dobra o credito do grupo.",
  },
];

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

for (const [arquivo, apelido, onde, tambemDoDono] of LEITURAS) {
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

  // A leitura que filtra TAMBEM pelo dono tem de filtrar `status` -- e so no
  // filtro: no `select` ele continua proibido, porque ali ninguem o le.
  if (tambemDoDono && !filtradas.includes("status")) {
    falhas += 1;
    console.error(
      `\n✖ ${arquivo} (${apelido})\n` +
        "  esta leitura tem de filtrar TAMBEM `status` (o do dono): " +
        `${tambemDoDono}. Sem o filtro a mesma parte entra no realizado e no previsto.`
    );
  }
  for (const proibida of DO_DONO) {
    const liberada =
      Boolean(tambemDoDono) &&
      proibida === "status" &&
      !pedidas.includes(proibida);
    if (usadas.includes(proibida) && !liberada) {
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

// AS EXCECOES SAO CONFERIDAS AO CONTRARIO: elas TEM de continuar lendo
// `status`, e NAO podem citar o estado da pessoa.
//
// As duas metades sao necessarias, e e por isso que sao duas. Quem "arruma"
// uma excecao para `my_status` nao faz as duas coisas ao mesmo tempo de forma
// confiavel: trocar o `select` de `status` para `my_status` tira a coluna do
// dono (metade 1 pega) e poe a da pessoa (metade 2 pega); mas ACRESCENTAR
// `my_status` ao `select` sem tirar `status` -- o passo intermediario de uma
// migracao mal interrompida -- so a metade 2 pega, e e exatamente o estado em
// que `linhaDoPrevisto` ainda funciona hoje e para de funcionar no dia em que
// alguem trocar o campo que ele le.
for (const { arquivo, apelido, onde, forma, porque } of EXCECOES) {
  const cadeia = cadeiaDaView(semComentarios(readFileSync(arquivo, "utf8")));

  if (!cadeia) {
    falhas += 1;
    console.error(
      `\n✖ ${arquivo} (${apelido})\n` +
        `  nao achei um \`.from("${VIEW}")\` legivel.\n` +
        "  ou a leitura saiu da view, ou a forma da cadeia mudou e esta " +
        "excecao parou de ser medida -- as duas pedem olho humano."
    );
    continue;
  }

  const filtradas = [...cadeia.matchAll(/\.(?:eq|neq|in|gte|lte)\(\s*"([^"]+)"/g)].map(
    (m) => m[1]
  );
  const select = /\.select\(\s*(?:`([^`]*)`|"([^"]*)")/.exec(cadeia);
  const pedidas = (select?.[1] ?? select?.[2] ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  // METADE 1 -- a coluna do DONO continua no lugar declarado.
  const ondeEsta = onde === "filtro" ? filtradas : pedidas;
  if (!ondeEsta.includes("status")) {
    falhas += 1;
    console.error(
      `\n✖ ${arquivo} (${apelido})\n` +
        `  a excecao declarada perdeu \`status\` do ${onde} da cadeia da view.\n` +
        `  ${porque}`
    );
  } else if (forma && !forma.test(cadeia)) {
    falhas += 1;
    console.error(
      `\n✖ ${arquivo} (${apelido})\n` +
        `  a cadeia ainda filtra \`status\`, mas nao na forma declarada ` +
        `(${forma.source}).\n` +
        `  ${porque}`
    );
  }

  // METADE 2 -- e a coluna da PESSOA nao entrou nesta cadeia.
  if (daPessoa([...filtradas, ...pedidas])) {
    falhas += 1;
    console.error(
      `\n✖ ${arquivo} (${apelido})\n` +
        "  esta leitura e uma EXCECAO declarada e passou a citar o estado da " +
        "PESSOA (`my_status`/`my_effective_status`).\n" +
        `  ${porque}\n` +
        "  se a decisao mudou, tire o arquivo de `EXCECOES` e ponha em " +
        "`LEITURAS` -- com o motivo, como foi feito com as outras."
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
