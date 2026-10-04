/**
 * A PERNA DO ACERTO DE GRUPO EM `financial_transactions` (HMO-245, fase 11)
 * =========================================================================
 *
 * `group_settlements` existe desde a migration 007 e nunca gerou lancamento
 * nenhum: o unico trigger da tabela e o de `updated_at`. O Pix que uma pessoa
 * manda para a outra era invisivel nos dois lados e o saldo da conta corrente
 * nao se mexia. Este modulo e o lado puro do conserto: ele decide O QUE gravar,
 * e a rota (`app/api/expense-groups/[groupId]/settlements/route.ts`) faz as
 * partes que precisam do banco.
 *
 * UMA PERNA SO, E O MOTIVO E A RLS
 * --------------------------------
 * `financial_transactions_write` e `FOR INSERT WITH CHECK (user_id = auth.uid())`
 * (`002_rls_lockdown.sql:472`). A rota roda na sessao de quem clicou, entao da
 * para gravar a linha de quem REGISTRA e de mais ninguem. A perna da contraparte
 * e outra fase (F12) e vai precisar de outro mecanismo -- e isso nao e uma
 * limitacao a contornar: e a objecao 1 da 007 ("nunca mexer na conta de outra
 * pessoa") continuando respeitada.
 *
 * Qualquer um dos dois lados pode registrar: a rota aceita `from_user_id` OU
 * `to_user_id` igual a quem chama, entao este modulo trata as duas direcoes.
 *
 * O SINAL CARREGA O SALDO, O TIPO NAO
 * -----------------------------------
 * `update_account_balance` soma `NEW.amount` em `current_balance`
 * (`001_baseline.sql:833`) sem olhar `transaction_type`. Medido num Postgres 17
 * local com a cadeia 001->039: a conta da Ana sai de 1000, vai a 600 com o hotel
 * de 400 e volta a 800 ao receber os 200 do acerto -- com a perna gravada como
 * `income` OU como `transfer`, o saldo da o mesmo numero. Entao o tipo nao
 * existe para mover dinheiro; ele existe para decidir se o acerto entra em
 * Receitas/Despesas.
 *
 * ===========================================================================
 * POR QUE AS DUAS PERNAS SAO `transfer`, INCLUSIVE A DE QUEM RECEBE
 * ===========================================================================
 * A issue decidiu `transfer` para quem paga e `income` para quem recebe. A
 * primeira metade esta certa pelo motivo escrito nela: quem paga ja tomou a
 * despesa quando a parte foi rateada, e cobrar de novo mostraria o dobro.
 *
 * A SEGUNDA METADE TEM O MESMO DEFEITO, ESPELHADO -- e isto foi medido, nao
 * deduzido. `personal_category_monthly_totals` (033) e o pessoal
 * (`group_id IS NULL`) MAIS a minha parte das despesas de grupo, e ela ignora
 * `transfer`. Na fixture acima (hotel de R$ 400 pago pela Ana, rateio 200/200):
 *
 *     painel pessoal da Ana      income   expense    net
 *     antes do acerto              0,00    200,00  -200,00   <- a parte dela
 *     recebendo como `income`    200,00    200,00     0,00   <- MENTE
 *     recebendo como `transfer`    0,00    200,00  -200,00   <- certo
 *
 * A Ana consumiu R$ 200 de hotel. Com `income`, o painel dela diz que o mes
 * fechou empatado -- o reembolso apaga a propria parte dela. Nao e receita: e
 * dinheiro que ela adiantou voltando. Com `transfer` o realizado continua sendo
 * "a minha parte" nos DOIS lados, e a soma entre os membros continua dando a
 * despesa inteira, que e a invariante que a 033 existe para manter.
 *
 * A invariante que sai disso, e que vale decorar: **um acerto nunca muda a
 * Receita nem a Despesa de ninguem -- ele so move dinheiro de lugar.** E a
 * objecao 2 da 007 (nao contar o hotel duas vezes por categoria) valendo para
 * os dois lados do Pix em vez de um.
 *
 * Trocar de volta e UMA linha (`TIPO_DA_PERNA`), e `scripts/test-acerto-em-
 * lancamento.mjs` tem o caso que fixa a decisao.
 *
 * `group_id` E SEMPRE `null`, E ISSO NAO E DETALHE
 * ------------------------------------------------
 * `auto_create_group_transaction` dispara em
 * `group_id IS NOT NULL AND amount < 0` (024, sobre a regra da 001) e rateia a
 * linha entre os membros ativos. A perna de quem PAGA e negativa. Medido na
 * mesma fixture: gravando a perna com `group_id` preenchido, as 2 linhas de
 * rateio (R$ 400) viram **4 linhas somando R$ 600** -- pagar a divida cria
 * divida nova, em silencio, para todo mundo. Por isso `group_id: null` e
 * `is_shared: false` sao literais aqui e nao parametros.
 *
 * A MOEDA VEM DA QUITACAO, NUNCA DE HOJE
 * --------------------------------------
 * `group_settlements` congela `currency` e `exchange_rate` em `settled_on`
 * (026). O lancamento sai dessa taxa gravada: pela taxa de hoje, o valor
 * recebido mudaria sozinho todo dia. `lib/moeda-do-grupo.ts` faz a aritmetica
 * da divida; aqui so se escolhe em que unidade a perna cabe, e a regra e a
 * conta escolhida -- ver `pernaDoAcerto`.
 */

import { MOEDA_PADRAO, moedaConhecida } from "@/lib/dinheiro";
import { valorEmReais } from "@/lib/cambio";
import { toCents, toReais } from "@/lib/settlement";

/**
 * O tipo das duas pernas. Ver "POR QUE AS DUAS PERNAS SAO `transfer`" acima.
 *
 * Constante com nome, e nao literal espalhado, porque e a UNICA linha a mudar
 * se o Helio preferir `income` para quem recebe depois de ver a medicao.
 */
export const TIPO_DA_PERNA = "transfer" as const;

/**
 * A categoria reservada das pernas, por usuario.
 *
 * `financial_transactions.category_id` e NOT NULL e um acerto nao tem
 * categoria: ele nao e gasto nem ganho. A 036 deu `user_id` e a policy
 * `transaction_categories_insert_own` a `transaction_categories`, entao a rota
 * cria esta linha sob demanda com `is_active = false` -- sem migration e sem
 * passo humano no SQL Editor, que e o gargalo do projeto. O caminho da 023
 * (seed global) nao se repete aqui porque nao precisa mais.
 */
export const NOME_DA_CATEGORIA_DE_ACERTO = "Acerto de grupo";

export const DESCRICAO_DA_CATEGORIA_DE_ACERTO =
  "Reservada: a perna do acerto de contas de grupo em financial_transactions. " +
  "Nao aparece nos seletores (is_active = false) porque acerto nao tem categoria.";

/** Quem registra esta recebendo ou pagando? */
export type DirecaoDoAcerto = "recebi" | "paguei";

/**
 * A direcao do acerto para quem esta registrando, ou `null` quando quem registra
 * nao e parte no pagamento.
 *
 * `null` e o caso que a policy de INSERT da 007 recusa de qualquer forma; aqui
 * ele existe para a rota responder 403 com frase em vez de 42501.
 */
export function direcaoDoAcerto(params: {
  fromUserId: string;
  toUserId: string;
  userId: string;
}): DirecaoDoAcerto | null {
  if (params.toUserId === params.userId) return "recebi";
  if (params.fromUserId === params.userId) return "paguei";
  return null;
}

/** Por que esta conta nao serve para a perna do acerto. */
export type ProblemaDaContaDoAcerto =
  /** Nenhuma conta escolhida -- o campo novo do dialogo veio vazio. */
  | "sem_conta"
  /** A conta nao e do usuario (ou nao existe). */
  | "conta_nao_encontrada"
  /** Cartao de credito: ver `pernaDoAcerto`. */
  | "conta_de_cartao"
  /** Conta numa terceira moeda, que nao e a do acerto nem real. */
  | "moeda_incompativel";

/**
 * A frase da recusa. Separada do JSX e da rota porque e a unica coisa que a
 * pessoa vai ler, e porque o teste pode exigir que ela diga o que fazer.
 */
export function mensagemDaContaDoAcerto(
  problema: ProblemaDaContaDoAcerto,
  moedaDoAcerto?: string
): string {
  switch (problema) {
    case "sem_conta":
      return "Escolha de qual conta o dinheiro saiu (ou em qual entrou) para registrar o acerto.";
    case "conta_nao_encontrada":
      return "Conta não encontrada.";
    case "conta_de_cartao":
      return "Acerto de grupo não entra em cartão de crédito: escolha a conta por onde o dinheiro passou.";
    case "moeda_incompativel":
      return (
        `Esta conta não é em reais nem em ${moedaDoAcerto ?? "na moeda do acerto"}. ` +
        "Escolha uma conta em uma das duas — converter aqui inventaria uma cotação."
      );
  }
}

/** O que a perna precisa saber da conta escolhida. */
export interface ContaDoAcerto {
  id: string;
  account_type?: string | null;
  currency?: string | null;
}

/** A linha que vai para `financial_transactions`. */
export interface PernaDoAcerto {
  account_id: string;
  amount: number;
  transaction_type: typeof TIPO_DA_PERNA;
  transaction_date: string;
  description: string;
  currency: string;
  exchange_rate: number;
  /** Literal: ver "group_id E SEMPRE null" no cabecalho. */
  group_id: null;
  is_shared: false;
  /** A chave canonica, para o desfazer achar esta linha. */
  notes: string;
}

/**
 * A chave que liga a perna a quitacao, em `notes`.
 *
 * `financial_transactions` nao tem coluna de acerto, e criar uma exigiria
 * migration -- isto e, um passo humano no SQL Editor antes de o codigo poder
 * subir. A chave em `notes` e o mesmo recurso que o ajuste de fatura usa
 * (`chaveAjuste`, HMO-253) e resolve o que precisa ser resolvido nesta fase:
 * desfazer o acerto tem que apagar a perna dele.
 *
 * SEM ISTO, O DESFAZER VIRA UM BUG DE DINHEIRO: a quitacao sai da lista, a
 * divida volta a aparecer na sugestao, e o Pix continua no saldo da conta --
 * duas telas afirmando coisas contrarias sobre o mesmo dinheiro.
 */
export function chaveDoAcerto(settlementId: string): string {
  return `acerto:${settlementId}`;
}

/** A descricao que a pessoa vai reconhecer no extrato. */
export function descricaoDoAcerto(params: {
  direcao: DirecaoDoAcerto;
  nomeDaContraparte?: string | null;
  nomeDoGrupo?: string | null;
}): string {
  const quem = (params.nomeDaContraparte || "").trim();
  const grupo = (params.nomeDoGrupo || "").trim();
  const sufixo = grupo ? ` (${grupo})` : "";

  if (params.direcao === "recebi") {
    return quem
      ? `Acerto de grupo — ${quem} me pagou${sufixo}`
      : `Acerto de grupo — recebido${sufixo}`;
  }
  return quem
    ? `Acerto de grupo — paguei ${quem}${sufixo}`
    : `Acerto de grupo — pago${sufixo}`;
}

/**
 * A perna a gravar, ou o problema da conta escolhida.
 *
 * EM QUE UNIDADE A PERNA ENTRA
 * ----------------------------
 * `amount` e `exchange_rate` chegam como a quitacao os gravou: `amount` esta na
 * moeda do PAGAMENTO e a taxa e a de `settled_on` (026). A perna segue a moeda
 * da CONTA, porque e o saldo dela que o trigger vai mover:
 *
 *   - conta na mesma moeda do acerto -> a perna e o proprio `amount`, com a
 *     taxa gravada na quitacao. US$ 50 saindo de uma conta em dolar sao 50.
 *   - conta em real -> `amount * exchange_rate`, que e a mesma conta que
 *     `group_member_balances` faz para saber quanto a divida abateu. Taxa 1,
 *     porque a linha passa a ser em real (o CHECK da 026 exige
 *     `(currency = 'BRL') = (exchange_rate = 1)`).
 *   - conta numa TERCEIRA moeda -> `moeda_incompativel`. Converter euro para
 *     dolar aqui exigiria uma cotacao que ninguem informou; gravar o numero cru
 *     poria 50 euros valendo 50 dolares no saldo, sem erro nenhum aparecer.
 *
 * Cartao de credito e recusado antes de tudo isso: um acerto de grupo e Pix,
 * dinheiro que entra ou sai de conta. Pendurar a perna num cartao a jogaria
 * dentro da FATURA (`card_invoice_lines` le `financial_transactions` da conta de
 * cartao), inventando uma compra que ninguem fez -- e, do lado de quem recebe,
 * uma "entrada" que abateria a fatura.
 */
export function pernaDoAcerto(params: {
  direcao: DirecaoDoAcerto;
  conta: ContaDoAcerto | null | undefined;
  /** Na moeda do acerto, como `group_settlements.amount`. Positivo. */
  amount: number;
  currency: string;
  exchange_rate: number;
  /** `group_settlements.settled_on`, no formato YYYY-MM-DD. */
  settledOn: string;
  settlementId: string;
  nomeDaContraparte?: string | null;
  nomeDoGrupo?: string | null;
}):
  | { perna: PernaDoAcerto; problema?: undefined }
  | { perna?: undefined; problema: ProblemaDaContaDoAcerto } {
  if (!params.conta || !params.conta.id) return { problema: "sem_conta" };
  if (params.conta.account_type === "credit_card") {
    return { problema: "conta_de_cartao" };
  }

  const moedaDoAcerto = moedaConhecida(params.currency)
    ? String(params.currency).trim().toUpperCase()
    : MOEDA_PADRAO;
  const moedaDaConta = moedaConhecida(params.conta.currency)
    ? String(params.conta.currency).trim().toUpperCase()
    : MOEDA_PADRAO;

  const taxa = Number(params.exchange_rate);
  const bruto = Number(params.amount);
  if (!Number.isFinite(bruto) || bruto <= 0) return { problema: "sem_conta" };
  if (!Number.isFinite(taxa) || taxa <= 0) return { problema: "moeda_incompativel" };

  let valor: number;
  let currency: string;
  let exchangeRate: number;

  if (moedaDaConta === moedaDoAcerto) {
    valor = bruto;
    currency = moedaDoAcerto;
    exchangeRate = taxa;
  } else if (moedaDaConta === MOEDA_PADRAO) {
    valor = valorEmReais(bruto, taxa);
    currency = MOEDA_PADRAO;
    exchangeRate = 1;
  } else {
    return { problema: "moeda_incompativel" };
  }

  // Centavos inteiros pela mesma funcao do resto do projeto: a divisao da
  // conversao pode sair com cauda binaria, e `numeric(15,2)` truncaria sozinha
  // -- o saldo ficaria a um centavo do extrato sem nada apontar por que.
  const total = toReais(toCents(valor));
  if (!(total > 0)) return { problema: "moeda_incompativel" };

  return {
    perna: {
      account_id: params.conta.id,
      // A unica diferenca entre receber e pagar. O tipo e o mesmo nos dois.
      amount: params.direcao === "recebi" ? total : -total,
      transaction_type: TIPO_DA_PERNA,
      // A data do PAGAMENTO, nao de hoje: o acerto pode ser registrado dias
      // depois, e e em `settled_on` que a quitacao ja esta datada.
      transaction_date: params.settledOn,
      description: descricaoDoAcerto({
        direcao: params.direcao,
        nomeDaContraparte: params.nomeDaContraparte,
        nomeDoGrupo: params.nomeDoGrupo,
      }),
      currency,
      exchange_rate: exchangeRate,
      group_id: null,
      is_shared: false,
      notes: chaveDoAcerto(params.settlementId),
    },
  };
}

/**
 * A frase que o dialogo mostra ANTES de registrar: o que vai acontecer com o
 * dinheiro, e em qual conta.
 *
 * Existe como funcao pura porque e a unica coisa que distingue o
 * comportamento novo do antigo aos olhos de quem clica. O botao de antes dizia
 * "Ja paguei" e nao lancava nada; se a tela nova nao disser em que conta o
 * dinheiro vai mexer, a pessoa nao tem como saber que mexeu -- e `Math.abs` no
 * lugar errado, ou a direcao invertida, passariam sem sintoma.
 *
 * O SINAL ESTA NA FRASE de proposito: "sai" e "entra" sao a leitura humana do
 * sinal que `pernaDoAcerto` aplica, e e assim que um teste pode exigir que
 * receber e pagar NAO digam a mesma coisa.
 */
export function fraseDoLancamentoDoAcerto(params: {
  direcao: DirecaoDoAcerto;
  /** Como vai para a perna, ja na moeda da conta. Positivo. */
  valor: number;
  moeda: string;
  nomeDaConta?: string | null;
  formatar: (valor: number, moeda: string) => string;
}): string {
  const conta = (params.nomeDaConta || "").trim();
  const onde = conta ? ` em ${conta}` : "";
  const quanto = params.formatar(Math.abs(params.valor), params.moeda);

  return params.direcao === "recebi"
    ? `Entra ${quanto}${onde}.`
    : `Sai ${quanto}${onde}.`;
}

/**
 * As contas que o campo novo do dialogo pode oferecer.
 *
 * Cartao fica fora (ver `pernaDoAcerto`), e conta em terceira moeda tambem --
 * oferecer e recusar depois do envio e pior do que nao oferecer. A regra e a
 * MESMA do servidor de proposito: se as duas listas divergirem, a tela mostra
 * uma opcao que a rota recusa.
 */
export function contasParaOAcerto<T extends ContaDoAcerto>(
  contas: T[],
  moedaDoAcerto: string
): T[] {
  const moeda = moedaConhecida(moedaDoAcerto)
    ? String(moedaDoAcerto).trim().toUpperCase()
    : MOEDA_PADRAO;

  return (contas || []).filter((c) => {
    if (c.account_type === "credit_card") return false;
    const daConta = moedaConhecida(c.currency)
      ? String(c.currency).trim().toUpperCase()
      : MOEDA_PADRAO;
    return daConta === moeda || daConta === MOEDA_PADRAO;
  });
}
