/**
 * PAGAR A FATURA DO CARTAO: A DECISAO E A SEQUENCIA DAS ESCRITAS -- HMO-310
 * (fase 13 do plano da HMO-245, Bloco 3).
 *
 * ===========================================================================
 * POR QUE ESTE ARQUIVO EXISTE
 * ===========================================================================
 * Pagar fatura escolhendo a conta pagadora ja funcionava inteiro -- e so
 * funcionava DENTRO de `app/(dashboard)/dashboard/bills/page.tsx`, em ~90 linhas
 * de sequencia de escrita com o tratamento do 409 no meio. Nenhuma lib, nenhum
 * componente. A tela de Despesas, que vai ganhar o mesmo botao, teria de
 * reescrever aquilo -- e seria a SEGUNDA implementacao da de-duplicacao de
 * fatura, com as duas divergindo na primeira correcao.
 *
 * Isto aqui e a metade que decide. A UI mora em
 * `components/fatura/DialogoDePagamentoDaFatura.tsx`, e as duas telas consomem
 * as mesmas duas respostas:
 *
 *   (a) esta baixa precisa saber DE QUAL CONTA o dinheiro saiu?
 *   (b) a fatura precisa ser FECHADA (`close`) antes do `pay`?
 *
 * ===========================================================================
 * O GALHO DAS DUAS ESCRITAS E `gravada`, NUNCA `natureza`
 * ===========================================================================
 * Existem TRES sabores de fatura, e os tres casam em `natureza === "fatura"`:
 *
 *   1. a fatura ABERTA sintetizada (`sintetizarFaturasAbertas`, HMO-227):
 *      `gravada: false`, nao existe em tabela nenhuma. E a UNICA que precisa do
 *      `close` antes do `pay` -- e preciso materializar a linha para ter um id;
 *   2. a fatura FECHADA que esta na agenda: `gravada: true`, `account_id` e o
 *      PROPRIO cartao. Uma escrita so;
 *   3. a previsao DIGITADA que a pessoa ligou a fatura (o elo da HMO-305):
 *      `gravada: true`, `natureza: "fatura"`, `fatura` preenchido, e
 *      `account_id` e a CONTA CORRENTE de onde o dinheiro sai. Uma escrita so.
 *
 * Trocar `gravada` por `natureza` no galho do `close` faz o sabor 3 passar pelo
 * `POST /api/card-invoices/close`: a fatura do CARTAO seria fechada porque a
 * pessoa pagou a previsao da CONTA CORRENTE. Isso nao da erro nenhum -- o
 * `close` responde 201, cria uma conta a pagar nova no mes, e o unico sintoma e
 * um numero maior na agenda do mes seguinte. E por isso que o mutante
 * `gravada` -> `natureza` e obrigatorio em `scripts/mutantes-pagamento-da-fatura.mjs`,
 * e por isso que ele tem de morrer por uma assercao sobre o SABOR 3: um teste
 * que so olhe a fatura aberta passa verde com a troca feita.
 *
 * ===========================================================================
 * POR QUE A SEQUENCIA DAS ESCRITAS TAMBEM MORA AQUI, E NAO NO COMPONENTE
 * ===========================================================================
 * Por causa do 409. "Esta fatura ja foi fechada" NAO e erro: ele vem com
 * `scheduled_transaction_id` e e exatamente o que acontece quando outra aba (ou
 * o botao de Orcamentos) fechou a fatura no meio. Seguir para o `/pay` com
 * aquele id e o resultado certo; mostrar o erro mandaria a pessoa recarregar
 * para fazer o que ja esta feito.
 *
 * Esse ramo e invisivel num teste de componente -- ele exige um 409 vindo da
 * rede. Com a sequencia aqui, `rede` e injetada e o 409 tem caso de teste em
 * `node --test`, sem navegador. O componente fica sendo marcacao, estado de
 * dialogo e toast.
 *
 * ===========================================================================
 * AS FRASES MORAM AQUI PELO MESMO MOTIVO DE `lib/elo-da-fatura.ts`
 * ===========================================================================
 * Duas telas, a mesma pergunta. E uma delas -- `FRASE_DO_PATRIMONIO` -- e a que
 * evita o pagamento em dobro: quem acaba de pagar R$ 1.000 de fatura e ve o
 * patrimonio parado conclui que a tela nao registrou, e paga de novo. Se a
 * frase tivesse ficado em `bills/page.tsx`, a tela de Despesas nasceria sem
 * ela.
 *
 * `MOTIVO_SEM_CONTA_PAGADORA` NAO E ESCRITO AQUI: ele e
 * `mensagemContaPagadora("ausente")`, a MESMA string que
 * `/api/scheduled-transactions/{id}/pay` devolve em 400. Escrever o texto a mao
 * criaria a segunda fonte, e o dia em que a rota mudar a recusa o dialogo
 * passaria a prometer uma coisa e a rota a recusar outra.
 */
import { TIPO_CARTAO } from "@/lib/agenda-do-cartao";
import { faturaDaChave, mensagemContaPagadora } from "@/lib/card-invoice";

/**
 * As tres respostas possiveis para "o que esta linha e".
 *
 * Os valores sao os de `NaturezaDaLinha` (lib/telas-de-movimentacao.ts) de
 * proposito: e assim que `LinhaDaTela` satisfaz `LinhaParaPagar`
 * estruturalmente, sem adaptador e sem campo novo. O tipo nao e importado de la
 * porque aquele arquivo arrasta o grafo das duas telas atras dele.
 */
export type NaturezaParaPagar = "despesa" | "fatura" | "fixa";

/**
 * O que a decisao precisa saber da linha -- e nada mais.
 *
 * E deliberadamente o SUBCONJUNTO de `LinhaDaTela` que responde as duas
 * perguntas: a tela de Despesas passa a propria linha, e Contas a Pagar monta
 * esta forma com `linhaParaPagarDaAgenda`. Pedir a linha inteira aqui
 * obrigaria as duas telas a concordarem em trinta campos para concordarem em
 * tres.
 */
export interface LinhaParaPagar {
  /**
   * A linha existe em `scheduled_transactions`?
   *
   * `false` so na fatura ABERTA sintetizada. E ESTE o campo que separa uma
   * escrita de duas -- ver o cabecalho.
   */
  gravada: boolean;
  /** Fatura de cartao, conta de regra fixa, ou linha comum. */
  natureza: NaturezaParaPagar;
  /**
   * O cartao e o mes da fatura, lidos da chave canonica em `notes`.
   *
   * Preenchido nos TRES sabores (e o que faz `natureza` ser `"fatura"`), e
   * `null` em todo o resto. No sabor 3 o `accountId` daqui e o do CARTAO, e nao
   * o da conta onde a previsao esta -- e e por isso que o `/pay` le o cartao da
   * chave e nao de `account_id`.
   */
  fatura: { accountId: string; mes: string } | null;
}

/** As duas respostas da fase 13. */
export interface DecisaoDePagamento {
  /**
   * (a) A baixa precisa de `payment_account_id`?
   *
   * `true` nos tres sabores de fatura. Sem ele o `/pay` responde 400 com
   * `MOTIVO_SEM_CONTA_PAGADORA` -- e e por isso que o `Confirmar` do dialogo
   * fica desabilitado com o motivo escrito em vez de deixar a pessoa clicar
   * para descobrir.
   */
  precisaDeContaPagadora: boolean;
  /**
   * (b) O que mandar para o `POST /api/card-invoices/close`, ou `null` para ir
   * direto ao `/pay`.
   *
   * Carregar o payload em vez de um booleano fecha um estado impossivel: nao da
   * para "precisar fechar" sem saber QUAL fatura fechar.
   */
  faturaParaFechar: { accountId: string; mesDoClose: string } | null;
}

/** O corpo que o `close` espera: ele aceita 'AAAA-MM', e `mes` e 'AAAA-MM-01'. */
const mesDoClose = (mes: string): string => mes.slice(0, 7);

/**
 * A DECISAO -- funcao pura, zero rede, zero relogio.
 *
 * `precisaDeContaPagadora` sai de `natureza`, porque a pergunta "de onde o
 * dinheiro saiu?" vale para os tres sabores: nos tres o `/pay` cai em
 * `pagarFatura` (a rota detecta pela chave canonica em `notes`) e nos tres ele
 * recusa sem `payment_account_id`.
 *
 * `faturaParaFechar` sai de `gravada`. Ver o cabecalho para o que acontece
 * quando alguem troca os dois criterios de lugar.
 */
export function decisaoDePagamentoDaFatura(
  linha: LinhaParaPagar
): DecisaoDePagamento {
  const ehFaturaDeCartao = linha.natureza === "fatura";

  // O GALHO. `gravada`, nao `natureza`: a previsao digitada ligada ao elo e
  // `natureza: "fatura"` E `gravada: true`, e fecha-la fecharia a fatura do
  // cartao quando a pessoa pagou a previsao da conta corrente.
  const precisaDeClose = ehFaturaDeCartao && !linha.gravada;

  return {
    precisaDeContaPagadora: ehFaturaDeCartao,
    faturaParaFechar:
      precisaDeClose && linha.fatura
        ? {
            accountId: linha.fatura.accountId,
            mesDoClose: mesDoClose(linha.fatura.mes),
          }
        : null,
  };
}

/** O que `linhaParaPagarDaAgenda` le de uma linha de Contas a Pagar. */
export interface LinhaCruaDaAgenda {
  /** `null` na fatura ABERTA sintetizada -- ela nao existe no banco. */
  id?: string | null;
  /** Onde a chave canonica da fatura mora, nos tres sabores. */
  notes?: string | null;
  /** A regra que gerou a ocorrencia. `null`/ausente na previsao avulsa. */
  recurring_rule_id?: string | null;
}

/**
 * A linha de Contas a Pagar na forma que a decisao le.
 *
 * A ORDEM DE AVALIACAO E FATURA PRIMEIRO, FIXA DEPOIS -- a MESMA de
 * `linhasDaTela` (lib/telas-de-movimentacao.ts), de proposito. Duas derivacoes
 * de `natureza` responderiam diferente sobre a mesma linha no dia em que a
 * fatura fechada passasse a nascer de uma regra recorrente, e a tela que
 * dissesse "fixa" perderia o `close`.
 *
 * `gravada` sai do `id` como em `linhasDaTela`: string nao-vazia. Um `id: ""` --
 * que um mock produz sem esforco -- nao e linha gravada em lugar nenhum.
 */
export function linhaParaPagarDaAgenda(
  linha: LinhaCruaDaAgenda
): LinhaParaPagar {
  const daChave = faturaDaChave(linha.notes);
  const gravada = typeof linha.id === "string" && linha.id !== "";

  return {
    gravada,
    natureza: daChave
      ? "fatura"
      : typeof linha.recurring_rule_id === "string" && linha.recurring_rule_id
        ? "fixa"
        : "despesa",
    fatura: daChave ? { accountId: daChave.accountId, mes: daChave.mes } : null,
  };
}

/**
 * O que `linhaParaPagarDaTela` le de uma linha das telas de movimentacao.
 *
 * ESTRUTURAL, e nao `LinhaDaTela`: importar o tipo de
 * `lib/telas-de-movimentacao` arrastaria o grafo das duas telas para dentro
 * deste arquivo (e das suites e sondas que o compilam), por quatro campos.
 * `LinhaDaTela` satisfaz esta forma por construcao, e o `tsc` do call site
 * reprova se algum dos quatro mudar de nome.
 */
export interface LinhaCruaDaTela {
  /**
   * SEMPRE string na tela -- e e por isso que esta funcao existe.
   *
   * Na fatura ABERTA sintetizada ele e a chave canonica
   * (`fatura:2026-10-01:<uuid>`), e NAO um id de banco: `linhasDaTela` precisa
   * de uma chave estavel para o React, e a fatura aberta nao tem id nenhum.
   */
  id: string;
  gravada: boolean;
  natureza: NaturezaParaPagar;
  fatura: { accountId: string; mes: string } | null;
  descricao?: string | null;
}

/**
 * A linha da tela de Despesas na forma que a decisao e a sequencia leem -- a
 * irma de `linhaParaPagarDaAgenda`, para a OUTRA tela (HMO-311, fase 14).
 *
 * ELA EXISTE POR UMA UNICA RAZAO, E ELA DECIDE DINHEIRO: o `id` da fatura
 * ABERTA na tela e a CHAVE SINTETICA, e `pagarAFatura` usa `linha.id` como id de
 * banco. Passar a linha da tela crua faria a chave `fatura:2026-10-01:<uuid>`
 * virar `POST /api/scheduled-transactions/fatura:2026-10-01:<uuid>/pay` em todo
 * caminho onde o `close` nao sobrescrevesse o id -- um 404 que, para quem
 * clicou, se le como "o app nao conseguiu". A conversao e `gravada ? id : null`,
 * que e exatamente o contrato que `LinhaParaPagar.id` ja declara ("`null` na
 * fatura ABERTA sintetizada").
 *
 * `gravada` E O CRITERIO, e nao o prefixo `fatura:` do id. Procurar o prefixo
 * seria uma SEGUNDA definicao de "esta linha existe no banco", e ela divergiria
 * de `linhasDaTela` -- que deriva `gravada` do id ser nao-vazio -- no dia em que
 * a chave mudasse de forma.
 */
export function linhaParaPagarDaTela(
  linha: LinhaCruaDaTela
): LinhaParaPagar & { id: string | null; description: string | null } {
  return {
    gravada: linha.gravada,
    natureza: linha.natureza,
    fatura: linha.fatura,
    id: linha.gravada ? linha.id : null,
    description: linha.descricao ?? null,
  };
}

// ---------------------------------------------------------------------------
// AS FRASES
// ---------------------------------------------------------------------------

/**
 * A FRASE QUE EVITA O PAGAMENTO EM DOBRO -- o `description` do toast de
 * sucesso.
 *
 * Pagar a fatura nao muda o patrimonio: a despesa foi a compra, e esta baixa so
 * move dinheiro da conta para o cartao (as duas pernas 'transfer' do HMO-149 se
 * anulam em `net_worth_history`). Quem acabou de pagar R$ 1.000 e ve o
 * patrimonio parado precisa ler isso de alguem -- senao conclui que a tela nao
 * registrou e paga de novo.
 *
 * Ela sai no toast de TODO sucesso do caminho da fatura, e nao so quando a
 * resposta vem com `is_transfer`. A rota sempre o manda (`pagarFatura` termina
 * em `is_transfer: true`), entao a frase e a mesma na pratica -- e condiciona-la
 * a um campo da resposta criaria um jeito silencioso de a frase desaparecer.
 */
export const FRASE_DO_PATRIMONIO =
  "Transferência: saiu da conta e quitou o cartão. O patrimônio não muda — a despesa já foi contada nas compras.";

/** A mesma verdade, dita ANTES do clique -- dentro do dialogo. */
export const FRASE_DO_PATRIMONIO_NO_DIALOGO =
  "Pagar a fatura não é um gasto novo: as compras já foram contadas no mês em que você fez cada uma. Esta baixa tira o dinheiro da conta escolhida e quita a dívida do cartão, então seu patrimônio fica igual — e é isso que estava errado antes.";

/**
 * O MOTIVO ESCRITO do `Confirmar` desabilitado.
 *
 * E a recusa que a rota ja da (`pay/route.ts`, `mensagemContaPagadora`), e nao
 * um texto proprio -- ver o cabecalho.
 */
export const MOTIVO_SEM_CONTA_PAGADORA = mensagemContaPagadora("ausente");

/**
 * O aviso da fatura ABERTA: confirmar congela o total de HOJE.
 *
 * E a unica diferenca real entre pagar a aberta e pagar a fechada, e ela decide
 * dinheiro -- uma compra lancada depois, com data dentro deste mes de fatura,
 * passa a aparecer na fatura e NAO entra no valor que foi pago.
 */
export const AVISO_DA_FATURA_ABERTA =
  "Esta fatura ainda está em aberto: confirmar registra o total de hoje como o valor pago. Se você lançar depois uma compra com data deste mês, ela não entra neste pagamento.";

/**
 * POR QUE A FATURA SEM DIA DE VENCIMENTO NAO GANHA O BOTAO -- HMO-311.
 *
 * Ela nao e uma linha da lista: sem `due_day` no cartao o banco nao calcula
 * vencimento, e a fatura sai num bloco a parte com so `{ account_name, total }`
 * -- SEM id e SEM `accountId`. Nao ha o que pagar por aqui nem com que chave, e
 * nenhuma das duas escritas de `pagarAFatura` tem argumento.
 *
 * A FRASE E OBRIGATORIA, e nao enfeite. "A fatura do Nubank tem botao e a do C6
 * nao" se le como tela quebrada, e a reacao natural e recarregar a pagina e
 * tentar de novo -- nao e cadastrar o dia de vencimento, que e o caminho de
 * verdade. Dizer QUAL e esse caminho e a unica coisa que transforma a ausencia
 * do botao de defeito em instrucao.
 */
export const FATURA_SEM_VENCIMENTO_NAO_TEM_PAGAR =
  "E por isso que esta fatura não tem o botão Pagar: sem o dia de vencimento ela não é uma linha do Previsto, e não há data para dar baixa. Configure o dia de vencimento do cartão e ela passa a aparecer na lista, com o botão.";

/** Nenhuma conta pode pagar: cartao de credito nao paga cartao de credito. */
export const SEM_CONTA_PAGADORA_CADASTRADA =
  "Você não tem nenhuma conta que possa pagar a fatura. Cadastre uma conta corrente, poupança ou carteira em Contas — cartão de crédito não paga cartão de crédito.";

/** O erro do `close` quando a rota nao manda texto proprio. */
export const ERRO_AO_FECHAR = "Não foi possível registrar a fatura";

/** O erro do `/pay` quando a rota nao manda texto proprio. */
export const ERRO_AO_PAGAR = "Não foi possível dar baixa";

// ---------------------------------------------------------------------------
// A SEQUENCIA DAS ESCRITAS
// ---------------------------------------------------------------------------

/** O minimo de uma resposta HTTP que esta sequencia le. */
export interface RespostaDaRede {
  ok: boolean;
  status: number;
  json: () => Promise<Record<string, unknown>>;
}

/**
 * `fetch`, estruturalmente.
 *
 * Declarado em vez de `typeof fetch` porque os tsconfig das suites compilam com
 * `target: es2020` e sem a lib do DOM: `Response` nao existe para o `tsc` ali, e
 * a suite nao compilaria. Injetar tambem e o que da caso de teste ao 409.
 */
export type ChamadaDeRede = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<RespostaDaRede>;

/** O resultado da sequencia -- uniao discriminada, sem `erro` no sucesso. */
export type ResultadoDoPagamento =
  | {
      ok: true;
      /** O titulo do toast; vem da rota, que sabe a direcao de verdade. */
      mensagem: string;
      /** Sempre `FRASE_DO_PATRIMONIO`. */
      descricao: string;
    }
  | {
      ok: false;
      /** Qual das duas escritas recusou -- `"decisao"` e antes de qualquer uma. */
      etapa: "decisao" | "close" | "pay";
      erro: string;
    };

/** A string de um campo da resposta, ou `null` -- nunca `undefined` nem numero. */
function texto(valor: unknown): string | null {
  return typeof valor === "string" && valor !== "" ? valor : null;
}

/**
 * AS ESCRITAS DO "INFORMEI QUE PAGUEI", NA ORDEM, PARA OS TRES SABORES.
 *
 * Fechada ou previsao ligada: uma escrita (o `/pay`), como sempre foi.
 * Aberta: duas, nesta ordem -- `close` e depois `/pay`. Um clique, nao dois: a
 * pessoa nao precisa saber que "fechar a fatura" existe para informar que pagou
 * o cartao, e era justamente esse passo escondido em outra tela que fazia a
 * fatura nunca chegar a Contas a Pagar.
 *
 * O `close` acontece so AQUI, no confirmar, e nao ao abrir o dialogo:
 * materializar na abertura deixaria uma fatura fechada para tras cada vez que
 * alguem abrisse o dialogo e desistisse -- e fechar nao e reversivel pela tela.
 *
 * SE O `close` FALHAR, O `/pay` NAO ACONTECE. O estado fica inalterado --
 * nenhuma fatura meio-paga.
 */
export async function pagarAFatura(params: {
  linha: LinhaParaPagar & { id?: string | null; description?: string | null };
  /** O id da conta de onde o dinheiro saiu. Vazio e recusado antes da rede. */
  contaPagadoraId: string;
  /** 'AAAA-MM-DD'. Quem tem o fuso da tela e a tela. */
  pagoEm: string;
  rede: ChamadaDeRede;
}): Promise<ResultadoDoPagamento> {
  const { linha, contaPagadoraId, pagoEm, rede } = params;
  const decisao = decisaoDePagamentoDaFatura(linha);

  // A MESMA RECUSA DA ROTA, ANTES DA REDE. O dialogo ja desabilita o botao com
  // este motivo escrito; isto e a rede de seguranca para quem chamar daqui.
  if (decisao.precisaDeContaPagadora && !contaPagadoraId) {
    return { ok: false, etapa: "decisao", erro: MOTIVO_SEM_CONTA_PAGADORA };
  }

  const cabecalhos = { "Content-Type": "application/json" };
  let idDaLinha = texto(linha.id);

  if (decisao.faturaParaFechar) {
    const resposta = await rede("/api/card-invoices/close", {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify({
        account_id: decisao.faturaParaFechar.accountId,
        month: decisao.faturaParaFechar.mesDoClose,
      }),
    });
    const dados = await resposta.json();

    const criada = dados.scheduled_transaction as
      | { id?: unknown }
      | null
      | undefined;

    if (resposta.ok && texto(criada?.id)) {
      idDaLinha = texto(criada?.id);
    } else if (
      // O 409 QUE NAO E ERRO: outra aba fechou a fatura no meio. Ele vem com o
      // id da linha que ja existe, e seguir para o `/pay` com ele e o resultado
      // certo. Os outros 409 do `close` ("esta fatura nao tem lancamentos",
      // "nao tem valor a pagar") NAO trazem o id e caem no erro abaixo.
      resposta.status === 409 &&
      texto(dados.scheduled_transaction_id)
    ) {
      idDaLinha = texto(dados.scheduled_transaction_id);
    } else {
      return {
        ok: false,
        etapa: "close",
        erro: texto(dados.error) ?? ERRO_AO_FECHAR,
      };
    }
  }

  // SEM ID NAO SE MONTA URL. `POST /api/scheduled-transactions/null/pay`
  // responde 404 -- ou, pior, 400 falando de outra coisa -- e quem clicou le
  // "o app nao conseguiu". O `tsc` obriga a decidir aqui porque a fatura
  // sintetizada tem `id: null` no tipo (HMO-227).
  if (!idDaLinha) {
    return { ok: false, etapa: "decisao", erro: ERRO_AO_FECHAR };
  }

  const resposta = await rede(
    `/api/scheduled-transactions/${idDaLinha}/pay`,
    {
      method: "POST",
      headers: cabecalhos,
      body: JSON.stringify({
        paid_date: pagoEm,
        ...(contaPagadoraId ? { payment_account_id: contaPagadoraId } : {}),
      }),
    }
  );
  const dados = await resposta.json();

  if (!resposta.ok) {
    return {
      ok: false,
      etapa: "pay",
      erro: texto(dados.error) ?? ERRO_AO_PAGAR,
    };
  }

  return {
    ok: true,
    mensagem: texto(dados.message) ?? "Fatura paga",
    descricao: FRASE_DO_PATRIMONIO,
  };
}

/**
 * As contas que podem pagar uma fatura.
 *
 * Cartao de credito NUNCA paga fatura -- nem o proprio (as duas pernas se
 * anulariam e a fatura ficaria paga sem dinheiro nenhum ter saido) nem outro
 * (criaria divida num cartao sem compra por tras). A API recusa os dois casos
 * em `validarContaPagadora`; o seletor nem os oferece.
 *
 * `TIPO_CARTAO` e nao o literal `"credit_card"`: um typo (`credit-card`) nao
 * daria erro nenhum -- nenhuma conta casaria, o filtro passaria a nao filtrar
 * nada e o seletor ofereceria o proprio cartao.
 */
export function contasQuePodemPagar<T extends { account_type?: string | null }>(
  contas: readonly T[]
): T[] {
  return contas.filter((conta) => conta.account_type !== TIPO_CARTAO);
}
