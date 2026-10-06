// -----------------------------------------------------------------------------
// PAGAR A FATURA DO CARTAO: A DECISAO, OS PEDIDOS E AS FRASES (HMO-312)
// -----------------------------------------------------------------------------
// Fase F13 da HMO-309. ISTO E UMA EXTRACAO, e nao uma feature: cada linha aqui
// saiu de dentro de `app/(dashboard)/dashboard/bills/page.tsx` (Contas a Pagar),
// onde o caminho inteiro de "informei que paguei a fatura" morava -- ~90 linhas
// dentro do componente de pagina, nenhuma lib, nenhum componente.
//
// POR QUE EXTRAIR ANTES DE A SEGUNDA TELA EXISTIR
// -----------------------------------------------
// Porque o caminho tem DUAS escritas sem transacao de banco (`close` e depois
// `pay`) e um galho de corrida (o 409 de "esta fatura ja foi fechada"). Copiar
// essa sequencia para a tela de Despesas seria a SEGUNDA implementacao da
// de-duplicacao de fatura neste repositorio, e as duas divergem na primeira
// correcao: uma ganha o tratamento do 409, a outra nao, e o sintoma da que
// ficou para tras e uma fatura fechada duas vezes -- sem erro em lugar nenhum.
//
// =============================================================================
// AS TRES FATURAS DA MESMA TELA, E SO UMA PRECISA DE `close`
// =============================================================================
// As tres casam pelo MESMO critério (`natureza === "fatura"` em Despesas,
// `ehFatura(notes)` em Contas a Pagar). O que separa UMA escrita de DUAS e se a
// linha esta GRAVADA:
//
//   | linha                                   | gravada | precisa de `close`? |
//   |-----------------------------------------|---------|---------------------|
//   | fatura ABERTA sintetizada (HMO-227)     | nao     | SIM (close -> pay)  |
//   | fatura FECHADA na agenda                | sim     | nao (pay)           |
//   | previsao digitada LIGADA a fatura (305) | sim     | NAO                 |
//
// A TERCEIRA E A ARMADILHA. Ligar o elo da HMO-305 grava a chave canonica da
// fatura em `notes`, entao `natureza` ja vira `"fatura"` e o cartao e o mes ja
// vem preenchidos -- **mesmo ela sendo a linha da CONTA CORRENTE que a pessoa
// digitou, e nao a fatura do cartao**. Trocar `gravada` por `natureza` no galho
// do `close` fecharia a fatura do cartao quando a pessoa pagou a previsao da
// conta corrente, **sem dar erro nenhum**: o `close` responde 200, a fatura do
// mes vira uma conta a pagar de verdade, e o mes passa a cobrar a divida duas
// vezes. E por isso que o galho mora em `precisaFecharAFatura` -- uma funcao
// com nome, e nao um `&&` dentro da sequencia de escritas -- e e por isso que
// `npm run mutantes:pagamento-da-fatura` troca exatamente essa linha.
//
// =============================================================================
// O DESCRITOR E NEUTRO DE PROPOSITO: AS DUAS TELAS NAO TEM A MESMA LINHA
// =============================================================================
// Contas a Pagar passeia `ScheduledTransaction | FaturaPrevista` (`description`,
// `amount`, `due_date`, `notes`, `account_id`, `invoice_month`); a tela de
// Despesas passeia `LinhaDaTela` (`descricao`, `valor`, `data`, `gravada`,
// `natureza`, `fatura.accountId`, `fatura.mes`). Se a sequencia ou o dialogo
// fossem tipados pela forma de UMA das duas, a outra teria de CONVERTER -- e a
// conversao e exatamente o lugar onde `gravada` vira `natureza` por descuido.
//
// Entao `FaturaPagavel` e pequeno, de campo NOMEADO, e cada tela mapeia para
// ele: `faturaPagavelDaAgenda` (aqui, e e o que prova que Contas a Pagar nao
// mudou) e o mapeamento de Despesas (F14).
//
// A UNIAO NO TIPO NAO E ZELO: ela e o que torna impossivel montar
// `/api/scheduled-transactions/null/pay`. `id: null` acompanha
// `precisaFechar: true` e `id: string` acompanha `precisaFechar: false`, os dois
// amarrados pelo `tsc` -- um descritor com `id: null` e `precisaFechar: false`
// nao compila, e era ele que produziria a URL com `null` no meio.
// -----------------------------------------------------------------------------

import { ehFaturaPrevista, TIPO_CARTAO, type FaturaPrevista } from "@/lib/agenda-do-cartao";
import { chaveFatura, faturaDaChave } from "@/lib/card-invoice";

// =============================================================================
// O DESCRITOR NEUTRO
// =============================================================================

interface FaturaPagavelBase {
  descricao: string;
  /** Em reais, positivo -- o total que a fatura cobra. */
  valor: number;
  /** 'AAAA-MM-DD'. */
  vencimento: string;
  /**
   * O cartao da fatura. SEMPRE conhecido, inclusive na fatura fechada, porque
   * vem da chave canonica e nao do `account_id` da linha -- e na previsao ligada
   * (HMO-305) os dois DISCORDAM: `account_id` e a conta corrente que a pessoa
   * digitou, e a chave e a fatura do cartao.
   */
  cartaoId: string;
  /** 'AAAA-MM-01' -- o mes da fatura, nunca o do vencimento. */
  mes: string;
}

/**
 * Uma fatura que a pessoa pode informar como paga, em forma neutra de tela.
 *
 * Os sete campos sao os do plano da HMO-309 (armadilha 7), e a uniao amarra os
 * dois que nao podem se separar.
 */
export type FaturaPagavel =
  | (FaturaPagavelBase & {
      /** Nao existe em tabela nenhuma: a fatura ABERTA e calculada a cada leitura. */
      id: null;
      precisaFechar: true;
    })
  | (FaturaPagavelBase & {
      /** O id de `scheduled_transactions`. */
      id: string;
      precisaFechar: false;
    });

// =============================================================================
// O MAPEAMENTO DE CONTAS A PAGAR
// =============================================================================

/**
 * O que o mapeamento precisa de uma linha da agenda.
 *
 * ESTRUTURAL, e nao `ScheduledTransaction | FaturaPrevista`: este arquivo e
 * compilado por uma suite com `rootDir: lib`, e importar `@/types/financial`
 * faz o `tsc` parar com TS6059 (a mesma razao que `lib/agenda-do-cartao.ts` ja
 * documenta em `ehFaturaPrevista`). As duas pontas da uniao de verdade
 * satisfazem esta forma por construcao, entao um campo renomeado la reprova o
 * `tsc` no chamador em vez de passar em silencio.
 */
export interface LinhaDaAgendaComFatura {
  id?: string | null;
  description: string;
  amount: number | string;
  due_date: string;
  notes?: string | null;
  account_id?: string | null;
  invoice_month?: string | null;
}

/**
 * ESTA LINHA PRECISA DE `close` ANTES DA BAIXA? -- o galho que decide dinheiro.
 *
 * E uma funcao com nome, e nao `ehFaturaPrevista(...)` escrito no meio da
 * sequencia, por um motivo so: assim ela tem assercao por cima e um mutante
 * dedicado. Ver o cabecalho deste arquivo para o que a troca por `natureza`
 * faz com a previsao ligada da HMO-305.
 *
 * E um TYPE GUARD porque quem entra aqui `true` tem `account_id` e
 * `invoice_month` garantidos pelo tipo da fatura sintetizada -- sem isso o
 * mapeamento abaixo precisaria de dois `??` que nunca disparam e que esconderiam
 * um campo faltando.
 */
export function precisaFecharAFatura(
  linha: LinhaDaAgendaComFatura
): linha is LinhaDaAgendaComFatura & FaturaPrevista {
  return ehFaturaPrevista(linha);
}

/**
 * A linha da agenda de Contas a Pagar como fatura pagavel, ou `null` quando ela
 * nao e uma fatura.
 *
 * O `null` E O CONTRATO, e e ele que decide se a tela abre o dialogo da conta
 * pagadora ou da baixa direta: hoje Contas a Pagar pergunta exatamente
 * `ehFaturaPrevista(conta) || ehFatura(conta.notes)`, e isto responde o mesmo.
 */
export function faturaPagavelDaAgenda(
  linha: LinhaDaAgendaComFatura
): FaturaPagavel | null {
  const comum = {
    descricao: linha.description,
    // `Number` porque numeric do Postgres chega como string em alguns caminhos
    // do PostgREST -- e e o mesmo `Number(conta.amount)` que a tela ja fazia.
    valor: Number(linha.amount),
    vencimento: linha.due_date,
  };

  if (precisaFecharAFatura(linha)) {
    return {
      ...comum,
      id: null,
      precisaFechar: true,
      cartaoId: linha.account_id,
      mes: linha.invoice_month,
    };
  }

  // A fatura FECHADA e a previsao LIGADA a fatura (HMO-305) chegam as duas
  // aqui, e as duas levam UMA escrita. O cartao e o mes saem da CHAVE, nunca do
  // `account_id`: ver o comentario de `cartaoId`.
  const chave = faturaDaChave(linha.notes);
  if (!chave || !linha.id) return null;

  return {
    ...comum,
    id: linha.id,
    precisaFechar: false,
    cartaoId: chave.accountId,
    mes: chave.mes,
  };
}

/**
 * A chave do spinner desta fatura.
 *
 * A fatura ABERTA nao tem `id` (HMO-227), e uma chave `null` deixaria TODA
 * linha sintetizada girando ao mesmo tempo. A canonica e unica por cartao+mes e
 * nunca colide com um uuid -- e e a MESMA que o `close` vai gravar em `notes`,
 * entao depois da materializacao a linha real e a sintetizada tem chaves
 * diferentes de proposito: a sequencia troca de chave no meio, e e por isso que
 * o botao do dialogo nao compara com uma das duas.
 */
export function chaveDaEscrita(fatura: FaturaPagavel): string {
  return fatura.id ?? chaveFatura(fatura.mes, fatura.cartaoId);
}

// =============================================================================
// OS DOIS PEDIDOS
// =============================================================================

/** Um pedido HTTP pronto: o caminho e o corpo. */
export interface PedidoDeEscrita {
  metodo: "POST";
  url: string;
  corpo: Record<string, unknown>;
}

export const ROTA_DE_FECHAMENTO = "/api/card-invoices/close";

/**
 * A PRIMEIRA das duas escritas: materializar a fatura aberta.
 *
 * `null` quando a fatura ja esta fechada -- aquele caminho tem UMA escrita so.
 *
 * ELA ACONTECE NO CONFIRMAR, E NAO AO ABRIR O DIALOGO. Materializar na abertura
 * deixaria uma fatura fechada para tras cada vez que alguem abrisse o dialogo e
 * desistisse, e fechar nao e reversivel pela tela.
 */
export function pedidoDeFechamento(
  fatura: FaturaPagavel
): PedidoDeEscrita | null {
  if (!fatura.precisaFechar) return null;
  return {
    metodo: "POST",
    url: ROTA_DE_FECHAMENTO,
    corpo: {
      account_id: fatura.cartaoId,
      // O `close` aceita 'AAAA-MM'; `mes` e 'AAAA-MM-01'. `slice` de string, e
      // nao `new Date()`: a data ISO lida como UTC voltaria um dia no fuso do
      // Brasil e a fatura de 01/03 seria fechada como a de fevereiro.
      month: fatura.mes.slice(0, 7),
    },
  };
}

/**
 * A SEGUNDA escrita (ou a unica): a baixa, com a conta de onde o dinheiro saiu.
 *
 * `null` quando a fatura ainda nao tem id ou quando nao ha conta pagadora
 * escolhida -- e o `null` e o contrato, nao zelo: ele e o que torna impossivel
 * montar `/api/scheduled-transactions/null/pay` ou um POST sem
 * `payment_account_id`, que a rota recusa com
 * `mensagemContaPagadora("ausente")`.
 */
export function pedidoDeBaixaDaFatura(
  fatura: FaturaPagavel,
  contaPagadoraId: string,
  hoje: string
): PedidoDeEscrita | null {
  if (fatura.id === null) return null;
  if (!contaPagadoraId) return null;
  return {
    metodo: "POST",
    url: `/api/scheduled-transactions/${encodeURIComponent(fatura.id)}/pay`,
    corpo: { paid_date: hoje, payment_account_id: contaPagadoraId },
  };
}

/**
 * Hoje, no fuso de Sao Paulo -- o `paid_date` da baixa.
 *
 * NAO e `new Date().toISOString().slice(0,10)`: as 21h de Sao Paulo o UTC ja
 * esta no dia seguinte, e a baixa cairia no dia -- as vezes no MES -- errado.
 *
 * E a MESMA conta que `bills/page.tsx` fazia na constante `HOJE` do modulo. A
 * unica diferenca e QUANDO ela e feita: aqui, no clique. Constante de modulo
 * congela a data de quando a aba foi aberta, e esta tela fica aberta de um dia
 * para o outro -- quem deixa Contas a Pagar aberta de madrugada dava baixa com
 * a data de ontem, sem nada na tela dizendo isso.
 */
export function hojeEmSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}

// =============================================================================
// O 409 NAO E ERRO
// =============================================================================

/** O que `POST /api/card-invoices/close` responde, nas tres formas possiveis. */
export interface RespostaDoFechamento {
  scheduled_transaction?: { id?: string | null } | null;
  /** So no 409: o id da linha que OUTRO fechamento ja criou. */
  scheduled_transaction_id?: string | null;
  error?: string | null;
}

export const ERRO_DO_FECHAMENTO = "Não foi possível registrar a fatura";

/**
 * A fatura depois do `close`, com o id da linha real -- ou a recusa.
 *
 * O 409 "esta fatura ja foi fechada" NAO E ERRO. Ele vem com
 * `scheduled_transaction_id` e e exatamente o que acontece quando outra aba (ou
 * o botao "Fechar fatura" de Orcamentos) fechou a fatura no meio. Seguir com
 * aquele id e o RESULTADO CERTO: a fatura que a pessoa quer pagar existe, com
 * aquele id, e mostrar o erro mandaria ela recarregar para fazer o que ja esta
 * feito. Tratar o 409 como falha nao perde dinheiro -- perde o clique, e a
 * pessoa tenta de novo e ve o mesmo erro, porque o estado nao vai mudar.
 *
 * A fatura devolvida e a variante `precisaFechar: false`: depois do `close` ela
 * tem id, e o `tsc` nao deixa ninguem fechar de novo.
 */
export function faturaDepoisDoFechamento(
  fatura: FaturaPagavel,
  resposta: { ok: boolean; status: number; dados: RespostaDoFechamento }
): { fatura: FaturaPagavel } | { erro: string } {
  const { ok, status, dados } = resposta;

  if (ok && dados.scheduled_transaction?.id) {
    return { fatura: comId(fatura, dados.scheduled_transaction.id) };
  }

  if (status === 409 && dados.scheduled_transaction_id) {
    return { fatura: comId(fatura, dados.scheduled_transaction_id) };
  }

  return { erro: dados.error ?? ERRO_DO_FECHAMENTO };
}

/** A mesma fatura, agora gravada. Um lugar so faz a troca dos dois campos. */
function comId(fatura: FaturaPagavel, id: string): FaturaPagavel {
  return {
    descricao: fatura.descricao,
    valor: fatura.valor,
    vencimento: fatura.vencimento,
    cartaoId: fatura.cartaoId,
    mes: fatura.mes,
    id,
    precisaFechar: false,
  };
}

// =============================================================================
// QUEM PODE PAGAR UMA FATURA
// =============================================================================

/**
 * Contas que podem pagar uma fatura: tudo que nao e cartao de credito.
 *
 * Cartao pagando cartao nao existe neste app, e o proprio cartao pagando a
 * propria fatura faria as duas pernas da transferencia se anularem -- a fatura
 * ficaria paga sem dinheiro nenhum ter saido. A API recusa os dois casos; o
 * seletor nem os oferece.
 *
 * Funcao e nao um `.filter` na tela porque a tela de Despesas vai precisar da
 * MESMA peneira (F14), e `!== "credit_card"` escrito duas vezes e um typo
 * silencioso: `"credit-card"` nao casaria com nada, o filtro pararia de
 * filtrar, e o cartao apareceria no seletor de quem paga a propria fatura.
 */
export function contasQuePodemPagar<T extends { account_type?: string | null }>(
  contas: T[]
): T[] {
  return contas.filter((conta) => conta.account_type !== TIPO_CARTAO);
}

// =============================================================================
// AS FRASES
// =============================================================================
// Elas moravam dentro de `bills/page.tsx`. Estao aqui pela mesma razao que as
// frases da HMO-305 moram em `lib/elo-da-fatura.ts`: as duas telas respondem a
// MESMA pergunta sobre a MESMA linha, e duas copias divergem -- uma ganha o
// aviso da fatura aberta, a outra nao, e ninguem nota.

export const TITULO_DO_PAGAMENTO = "Pagar a fatura";
export const ROTULO_DE_CONFIRMAR = "Confirmar pagamento";
export const PERGUNTA_DA_CONTA_PAGADORA = "De qual conta o dinheiro saiu? *";

/**
 * Nenhuma conta pode pagar a fatura.
 *
 * Botao cinza sem motivo escrito e indistinguivel de tela quebrada, e a pessoa
 * tenta de novo. A frase diz o que falta E por que o cartao nao serve.
 */
export const FRASE_SEM_CONTA_PAGADORA =
  "Você não tem nenhuma conta que possa pagar a fatura. Cadastre uma conta " +
  "corrente, poupança ou carteira em Contas — cartão de crédito não paga " +
  "cartão de crédito.";

/**
 * O PATRIMONIO NAO MUDA -- a frase ANTES de confirmar.
 *
 * A baixa grava duas pernas `transfer`: sai da conta, quita o cartao. Quem
 * acabou de informar R$ 1.000 e ve o patrimonio parado conclui que a tela nao
 * registrou -- e registra de novo. As duas frases (esta e a do toast) sao a
 * unica defesa contra o pagamento em dobro, e e por isso que nao sao "texto":
 * sao metade da feature.
 */
export const FRASE_DO_PATRIMONIO_ANTES =
  "Pagar a fatura não é um gasto novo: as compras já foram contadas no mês em " +
  "que você fez cada uma. Esta baixa tira o dinheiro da conta escolhida e " +
  "quita a dívida do cartão, então seu patrimônio fica igual — e é isso que " +
  "estava errado antes.";

/** A mesma verdade DEPOIS da escrita, no toast do galho `is_transfer`. */
export const FRASE_DO_PATRIMONIO_DEPOIS =
  "Transferência: saiu da conta e quitou o cartão. O patrimônio não muda — a " +
  "despesa já foi contada nas compras.";

/**
 * A fatura ABERTA ainda pode mudar de valor.
 *
 * E a diferenca real entre as duas faturas, e ela decide dinheiro: uma compra
 * lancada depois, com data dentro deste mes de fatura, passa a aparecer na
 * fatura e NAO entra no valor que foi pago.
 */
export const AVISO_DA_FATURA_ABERTA =
  "Esta fatura ainda está em aberto: confirmar registra o total de hoje como o " +
  "valor pago. Se você lançar depois uma compra com data deste mês, ela não " +
  "entra neste pagamento.";

/** O aviso da fatura aberta, ou `null` na fechada -- que nao muda mais. */
export function avisoDaFaturaAberta(fatura: FaturaPagavel): string | null {
  return fatura.precisaFechar ? AVISO_DA_FATURA_ABERTA : null;
}

export const ERRO_DA_BAIXA = "Não foi possível dar baixa";
export const ERRO_DE_REDE_NO_FECHAMENTO = "Erro ao registrar a fatura";
export const ERRO_DE_REDE_NA_BAIXA = "Erro ao dar baixa";

/** "Fatura Nubank 10/2026 paga" -- o fallback de quando a rota nao manda texto. */
export function toastDaFaturaPaga(fatura: FaturaPagavel): string {
  return `${fatura.descricao} paga`;
}
