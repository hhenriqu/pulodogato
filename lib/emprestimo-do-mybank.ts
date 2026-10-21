// ---------------------------------------------------------------------------
// MyBank -- a aritmetica do emprestimo e a DECISAO de quais pernas cada caso
// gera (HMO-370, F2 da HMO-368)
// ---------------------------------------------------------------------------
// Uma conta de investimento minha virando banco: ela empresta, e a divida volta
// parcelada. Dois casos, e eles nao sao variacoes do mesmo -- eles escrevem em
// lugares DIFERENTES:
//
//   CASO A -- auto-emprestimo. Eu pago para mim mesmo. Cada parcela nasce como
//     TRANSFERENCIA PREVISTA em `scheduled_transactions` (`transaction_type =
//     'transfer'`, destino = a conta de investimento). Ela aparece em Despesas e
//     em Contas a Pagar porque e dinheiro que sai da minha conta corrente no dia
//     do vencimento -- a pergunta que a aba Despesas passou a responder na
//     HMO-364 ("sai da sua conta", e nao "deixou de ser seu"). Gravar como
//     transferencia e o que mantem o Total de contas certo.
//
//   CASO B -- emprestei para uma conexao. NENHUMA linha minha, em tabela
//     nenhuma de dinheiro. A parcela existe so em `mybank_installments`, e o
//     lado do devedor sai pela view `mybank_due_entries` (F1) -- nao gravando
//     linha no nome dele, porque a RLS de `scheduled_transactions` e
//     `user_id = auth.uid()` e recusaria, e deveria.
//
// POR QUE A DECISAO DE PERNAS E UMA FUNCAO PURA, E NAO UM `if` DENTRO DA ROTA
// --------------------------------------------------------------------------
// O defeito que esta feature pode ter e "o Caso B inventa uma despesa no meu
// lado": eu emprestei R$ 24.000 para a Lais e o meu safe-to-spend passa a
// descontar R$ 1.000 por mes de uma conta que ELA paga. Dentro da rota isso se
// mede so subindo a rota; aqui `previsoesDoEmprestimo` devolve `[]` e a
// assercao e uma linha. A rota continua sendo medida (o duble de client), mas a
// REGRA tem onde ser lida.
//
// A ARITMETICA E IMPORTADA, NAO REESCRITA
// ---------------------------------------
// `serieDeParcelas`, `valorGravado` e `descricaoDaParcela` vem de
// `lib/lancamento.ts`. A soma das parcelas fecha com o principal e a ultima
// absorve o centavo da divisao porque AQUELA funcao faz isso em centavos
// inteiros -- uma segunda copia aqui divergiria dela na primeira mudanca, e o
// sintoma seria o MyBank e a compra parcelada discordando sobre quanto e 24x de
// R$ 1.000,01.
//
// A CONSEQUENCIA QUE PRECISA ESTAR ESCRITA: O ALCANCE FICA 2..60
// --------------------------------------------------------------
// `serieDeParcelas` recusa `m < 2` e `m > 60` (`MAX_PARCELAS`), e
// `mybank_loans_installment_count_check` aceita 1..360. As duas faixas sao
// diferentes DE PROPOSITO: o banco e a rede de seguranca e pode ser mais largo
// que a UX. O que nao pode e a diferenca ser silenciosa -- por isso
// `problemaDoEmprestimo` devolve `parcelas_fora_do_alcance` e a mensagem DIZ os
// numeros. No dia em que 1x ou 120x virar requisito, o conserto e em
// `serieDeParcelas`, num lugar so, e nao numa segunda aritmetica aqui.
//
// NAO HA IMPORT DE `lib/dinheiro.ts` NEM DE NADA COM `@/` ALEM DE `lancamento`
// E `transferencia`: os dois sao puros (nenhum import proprio), e e isso que
// deixa este modulo compilar na suite sem o runtime do Next.
// ---------------------------------------------------------------------------

import {
  descricaoDaParcela,
  serieDeParcelas,
  valorGravado,
  type BaseDoValorParcelado,
  type SerieDeParcelas,
} from "@/lib/lancamento";
import { pernasDaTransferencia, type PernaDeTransferencia } from "@/lib/transferencia";

/** Os dois casos da issue. Nao sao graus do mesmo: eles escrevem em lugares diferentes. */
export type CasoDoEmprestimo = "auto" | "conexao";

/**
 * Quem paga sou eu mesmo?
 *
 * `borrower_user_id` e NOT NULL na 053 justamente para esta pergunta ser uma
 * comparacao e nao um `?? "eu"`: "emprestimo para mim mesmo" fica explicito na
 * linha, e nenhuma leitura precisa tratar NULL como "eu".
 */
export function casoDoEmprestimo(params: {
  lenderUserId: string;
  borrowerUserId: string;
}): CasoDoEmprestimo {
  return params.borrowerUserId === params.lenderUserId ? "auto" : "conexao";
}

/** O menor e o maior numero de parcelas que a aritmetica importada sabe montar. */
export const MIN_PARCELAS_DO_MYBANK = 2;
export const MAX_PARCELAS_DO_MYBANK = 60;

/** Juro que a fase 1 aceita -- a mesma trava do `mybank_loans_interest_rate_fase_1`. */
export const JUROS_DA_FASE_1 = 0;

/**
 * A chave do elo da parcela na perna, em `notes`.
 *
 * NAO HA COLUNA DE ELO, E ISSO E UMA ESCOLHA COM PRECEDENTE
 * ---------------------------------------------------------
 * `scheduled_transactions` nao tem `mybank_installment_id`, e a F1 nao a criou.
 * A convencao deste repositorio para exatamente este problema -- amarrar uma
 * perna a um fato de outra tabela sem FK nova -- e a chave canonica em `notes`:
 * `chaveDoAcerto` (`acerto:<id>`, HMO-366) e lida por `.eq("notes", chave)` em
 * cinco lugares e funciona em producao.
 *
 * O prefixo existe para que nenhum id lido daqui possa passar por um uuid nu
 * numa URL (a mesma razao do `acerto:` na HMO-366), e para que a chave seja
 * `grep`avel: "quem sao as pernas do MyBank" e uma busca por `mybank:`.
 */
export const PREFIXO_DA_CHAVE_DO_MYBANK = "mybank:";

export function chaveDaParcelaDoMyBank(installmentId: string): string {
  return `${PREFIXO_DA_CHAVE_DO_MYBANK}${installmentId}`;
}

/**
 * O INVERSO da chave: qual parcela esta previsao paga, ou `null`.
 *
 * E a metade que faltava do elo (HMO-382). A F2 gravou a chave e a F4 nunca a
 * LEU na baixa: cada parcela do Caso A nascia com `notes = mybank:<id>`, a baixa
 * da transferencia prevista movia o dinheiro certo, e `mybank_installments`
 * ficava em `pending` para sempre -- eu pagava a moto para mim mesmo nas 24
 * vezes e o painel do MyBank seguia dizendo que eu devia tudo. O oposto da
 * familia HMO-149: lá o numero fecha e o fato nao aconteceu; aqui o fato
 * aconteceu e o numero nao mexe.
 *
 * A COMPARACAO E DE CHAVE INTEIRA, NAO `includes`
 * -----------------------------------------------
 * `notes` e um campo que a pessoa digita. Procurar o prefixo em qualquer
 * posicao faria uma anotacao como "paguei o mybank: 300 reais" virar elo para
 * um id inventado -- e o efeito nao seria erro, seria um UPDATE em parcela
 * nenhuma (ou, com sorte do azar, em uma parcela de outro emprestimo). Entao a
 * chave e o `notes` INTEIRO, como em `RE_CHAVE_FATURA`, e o id nao pode conter
 * espaco: o unico jeito de uma previsao ter elo e ela ter nascido com ele.
 */
export function parcelaDaChaveDoMyBank(
  notes: string | null | undefined
): string | null {
  if (typeof notes !== "string") return null;
  if (!notes.startsWith(PREFIXO_DA_CHAVE_DO_MYBANK)) return null;

  const id = notes.slice(PREFIXO_DA_CHAVE_DO_MYBANK.length);
  if (!id || /\s/.test(id)) return null;

  return id;
}

/**
 * A baixa desta previsao leva ESTA parcela a `paid`?
 *
 * `null` (a parcela nao existe) devolve `false`, E ISSO NAO E DEFENSIVIDADE
 * ------------------------------------------------------------------------
 * O elo pendurado e um estado alcancavel: `mybank_loans_delete` (053) deixa
 * apagar emprestimo sem parcela paga, o CASCADE de `loan_id` leva as parcelas,
 * e as 24 transferencias previstas ficam -- com `notes` apontando para ids que
 * nao existem mais. Essa previsao continua sendo dinheiro que a pessoa quer
 * mover entre contas DELA, e recusar a baixa por causa do elo morto seria
 * transformar "o MyBank nao sabe mais desta parcela" em "voce nao consegue
 * mais transferir". A baixa anda; so nao ha parcela para marcar.
 *
 * `cancelled` tambem devolve `false`: parcela cancelada nao volta a `paid` por
 * efeito colateral de uma baixa, e `paid` ja esta no destino.
 */
export function parcelaSegueABaixaDaPrevisao(
  parcela: { status: string } | null | undefined
): boolean {
  if (!parcela) return false;
  return parcela.status === "pending" || parcela.status === "reported";
}

/** O estorno da baixa devolve ESTA parcela a `pending`? */
export function parcelaSegueAoEstornoDaPrevisao(
  parcela: { status: string } | null | undefined
): boolean {
  if (!parcela) return false;
  return parcela.status === "paid";
}

/** O patch da parcela quando a previsao e baixada. */
export interface BaixaDaParcela {
  status: "paid";
  paid_date: string;
  paid_transaction_id: string;
}

/**
 * O que a baixa da previsao grava na parcela.
 *
 * `pernaDeEntradaId` E A PERNA POSITIVA, A DA CONTA DE INVESTIMENTO
 * ----------------------------------------------------------------
 * A baixa de uma transferencia grava DUAS pernas, e `scheduled_transactions.
 * transaction_id` aponta para a de SAIDA (e onde o dinheiro saiu, e e por ela
 * que o estorno acha a contraparte). A parcela aponta para a de ENTRADA, e por
 * uma razao diferente: `paid_transaction_id` responde "onde foi que este
 * dinheiro entrou", e a resposta e a conta de investimento -- a mesma coluna
 * que no Caso B guarda a perna de entrada que o credor lanca
 * (`pernaDeEntradaDoPagamento`). Apontar para a saida faria a mesma coluna
 * querer dizer coisas opostas nos dois casos, e o sintoma seria uma tela
 * futura mostrando "a parcela 3 entrou na conta corrente" com sinal negativo.
 *
 * O nome do parametro e o que carrega essa decisao: um `transactionId` cru
 * aceitaria a perna errada sem que a chamada parecesse errada.
 */
export function patchDaBaixaDaParcela(params: {
  paidDate: string;
  pernaDeEntradaId: string;
}): BaixaDaParcela {
  return {
    status: "paid",
    paid_date: params.paidDate,
    paid_transaction_id: params.pernaDeEntradaId,
  };
}

/** O patch que devolve a parcela ao estado de antes da baixa. */
export interface EstornoDaParcela {
  status: "pending";
  paid_date: null;
  paid_transaction_id: null;
}

/**
 * O que o estorno da baixa devolve a parcela.
 *
 * OS TRES CAMPOS JUNTOS, E O `paid_date: null` E OBRIGATORIO
 * ----------------------------------------------------------
 * `mybank_installments_paid_check` e `CHECK ((status = 'paid') = (paid_date IS
 * NOT NULL))`: um estorno que mexesse so no `status` seria recusado em 23514
 * pelo proprio banco. O `paid_transaction_id: null` nao e exigido por CHECK
 * nenhum -- e ele que impede a parcela pendente de continuar apontando para um
 * lancamento que acabou de ser apagado.
 *
 * NAO volta para `reported`, mesmo que a parcela tenha passado por lá: no Caso
 * A nao ha a quem avisar (eu sou os dois lados, e o PATCH recusa o aviso por
 * isso), entao `pending` e o unico estado anterior possivel desta parcela.
 */
export function patchDoEstornoDaParcela(): EstornoDaParcela {
  return { status: "pending", paid_date: null, paid_transaction_id: null };
}

/** Por que este pedido de emprestimo nao serve. */
export type ProblemaDoEmprestimo =
  | "descricao_ausente"
  | "base_do_valor_ausente"
  | "conta_credora_ausente"
  | "conta_credora_nao_encontrada"
  | "conta_credora_nao_e_investimento"
  | "conta_de_pagamento_ausente"
  | "conta_de_pagamento_nao_encontrada"
  | "conta_de_pagamento_e_a_credora"
  | "devedor_sem_conexao"
  | "juros_fora_da_fase_1"
  | "parcelas_fora_do_alcance"
  | "serie_impossivel";

/** O que a validacao precisa saber de uma conta. */
export interface ContaDoEmprestimo {
  id: string;
  account_type?: string | null;
}

/**
 * O pedido serve? `null` quando serve, ou o motivo.
 *
 * A ROTA CONFERE ANTES; O BANCO E A REDE DE SEGURANCA, NAO A UX
 * -------------------------------------------------------------
 * As duas travas da 053 sao trigger, e uma trigger responde 23514
 * ("check_violation") com um texto que nenhuma tela quer mostrar. Entao a rota
 * pergunta primeiro e devolve 400 com frase legivel. As duas camadas NAO sao
 * redundancia: quem chega pelo PostgREST direto (a fila offline, um script, um
 * app futuro) nao passa por esta funcao, e e a trigger que o segura.
 *
 * `contaCredora` e `contaDePagamento` entram como OBJETO JA LIDO, nao como id:
 * quem le e a rota, com `.eq("user_id", user.id)` no filtro -- e e isso que faz
 * "conta de outra pessoa" chegar aqui como `null` (ou seja "nao encontrada") em
 * vez de precisar de uma pergunta propria. Dizer "essa conta nao e sua" para um
 * id que existe confirmaria a existencia daquela conta para quem chutou o uuid,
 * que e a mesma razao pela qual a trigger da 053 nao distingue os dois motivos.
 *
 * `conexaoAceita` tambem entra pronto, pelo mesmo motivo: a consulta de
 * `user_connections` cruza os dois lados (`requester`/`requested`) e e da rota.
 */
export function problemaDoEmprestimo(params: {
  descricao: string;
  base: BaseDoValorParcelado | null | undefined;
  caso: CasoDoEmprestimo;
  contaCredoraPedida: string | null;
  contaCredora: ContaDoEmprestimo | null | undefined;
  /** So o Caso A precisa dela: e a conta de onde a parcela sai. */
  contaDePagamentoPedida: string | null;
  contaDePagamento: ContaDoEmprestimo | null | undefined;
  conexaoAceita: boolean;
  juros: number;
  parcelas: number;
  serie: SerieDeParcelas | null;
}): ProblemaDoEmprestimo | null {
  if (!params.descricao.trim()) return "descricao_ausente";

  if (params.base !== "parcela" && params.base !== "total") {
    return "base_do_valor_ausente";
  }

  if (!params.contaCredoraPedida) return "conta_credora_ausente";
  if (!params.contaCredora) return "conta_credora_nao_encontrada";

  // A TRAVA 1 DA 053, EM FORMA DE FRASE. Conta corrente credora e o MyBank
  // emprestando dinheiro que nao esta investido; a trigger recusa, e sem esta
  // pergunta a tela mostraria o 23514 dela.
  if (params.contaCredora.account_type !== "investment") {
    return "conta_credora_nao_e_investimento";
  }

  // A TRAVA 2 DA 053. O auto-emprestimo sai primeiro e sem consultar nada --
  // `user_connections` tem `CHECK (requester_id <> requested_id)`, ninguem e
  // conexao de si mesmo, e sem este desvio o caso principal da issue seria
  // recusado pela propria trava.
  if (params.caso === "conexao" && !params.conexaoAceita) {
    return "devedor_sem_conexao";
  }

  // SO O CASO A PRECISA DA CONTA DE ONDE SAI O DINHEIRO
  //
  // No Caso B nao ha perna minha nenhuma -- pedir uma conta de pagamento ali
  // seria pedir de onde sai um dinheiro que nao sai de mim. E e por isso que a
  // exigencia esta dentro do ramo: um `if (!contaDePagamento)` solto recusaria
  // o Caso B inteiro, e o sintoma seria "emprestar para a Lais pede uma conta
  // minha" -- um pedido que nao tem resposta certa.
  if (params.caso === "auto") {
    if (!params.contaDePagamentoPedida) return "conta_de_pagamento_ausente";
    if (!params.contaDePagamento) return "conta_de_pagamento_nao_encontrada";
    // `scheduled_transactions_destino_check` (038) exige
    // `destination_account_id <> account_id`. Sem esta pergunta a serie INTEIRA
    // morreria em 23514 depois de o emprestimo e as parcelas ja estarem
    // gravados.
    if (params.contaDePagamento.id === params.contaCredora.id) {
      return "conta_de_pagamento_e_a_credora";
    }
  }

  if (params.juros !== JUROS_DA_FASE_1) return "juros_fora_da_fase_1";

  // ANTES DA SERIE, E COM OS NUMEROS NA FRASE
  //
  // `serieDeParcelas` devolve `null` tanto para "35 parcelas e demais" quanto
  // para "o valor nao da para ler". Separar os dois aqui e o que impede a tela
  // de dizer "confira o valor" a quem digitou 120 parcelas de um valor certo.
  if (
    !Number.isInteger(params.parcelas) ||
    params.parcelas < MIN_PARCELAS_DO_MYBANK ||
    params.parcelas > MAX_PARCELAS_DO_MYBANK
  ) {
    return "parcelas_fora_do_alcance";
  }

  if (!params.serie) return "serie_impossivel";

  return null;
}

/** A frase que a tela mostra para cada problema. */
export function mensagemDoProblema(problema: ProblemaDoEmprestimo): string {
  switch (problema) {
    case "descricao_ausente":
      return "Diga para que é o empréstimo.";
    case "base_do_valor_ausente":
      return "Diga se o valor é o da parcela ou o total.";
    case "conta_credora_ausente":
      return "Escolha a conta de investimento que vai emprestar.";
    case "conta_credora_nao_encontrada":
      return "Conta de investimento não encontrada.";
    case "conta_credora_nao_e_investimento":
      return "O MyBank empresta de uma conta de investimento. Escolha uma conta de investimento sua.";
    case "conta_de_pagamento_ausente":
      return "Escolha a conta de onde as parcelas vão sair.";
    case "conta_de_pagamento_nao_encontrada":
      return "Conta de pagamento não encontrada.";
    case "conta_de_pagamento_e_a_credora":
      return "A conta que paga tem que ser diferente da conta que empresta — senão o dinheiro não sai de lugar nenhum.";
    case "devedor_sem_conexao":
      return "Só é possível emprestar para si mesmo ou para uma conexão aceita. Convide a pessoa primeiro.";
    case "juros_fora_da_fase_1":
      return "Nesta fase o MyBank só empresta a juro zero.";
    case "parcelas_fora_do_alcance":
      return `O número de parcelas tem que estar entre ${MIN_PARCELAS_DO_MYBANK} e ${MAX_PARCELAS_DO_MYBANK}.`;
    case "serie_impossivel":
      return "Não consegui montar as parcelas: confira o valor e o primeiro vencimento.";
  }
}

/**
 * A serie do emprestimo, pela aritmetica de `lib/lancamento.ts`.
 *
 * `parcelaAtual: 1` SEMPRE, e isso e a diferenca entre emprestimo e compra
 * parcelada. Na compra do cartao a pessoa pode lancar "parcela 3 de 10" (a
 * decisao (A) da HMO-208, que NAO cria as duas anteriores); um emprestimo
 * nasce agora, na parcela 1, e `parcelasAnteriores` e 0 por construcao. Deixar o
 * numero entrar como parametro abriria um emprestimo cuja soma de parcelas NAO
 * fecha com o principal -- e a soma fechando e a invariante desta tabela
 * (`mybank_loans.principal`, comentario da 053).
 */
export function serieDoEmprestimo(entrada: {
  /** Como veio do campo: string. */
  valor: string;
  base: BaseDoValorParcelado;
  parcelas: number;
  /** O vencimento da parcela 1, 'AAAA-MM-DD'. */
  primeiroVencimento: string;
}): SerieDeParcelas | null {
  return serieDeParcelas({
    valor: entrada.valor,
    base: entrada.base,
    parcelaAtual: 1,
    totalDeParcelas: entrada.parcelas,
    vencimentoDaParcelaAtual: entrada.primeiroVencimento,
  });
}

/** Uma linha de `mybank_installments`, sem o `loan_id` (que so existe depois do insert). */
export interface LinhaDaParcela {
  installment_number: number;
  installment_total: number;
  amount: number;
  due_date: string;
  status: "pending";
}

/**
 * As N linhas de `mybank_installments`, a partir da serie.
 *
 * `amount` VAI POSITIVO, por `valorGravado("income", ...)`
 * -------------------------------------------------------
 * `mybank_installments_amount_check` e `CHECK (amount > 0)`: esta tabela nao
 * guarda sinal nenhum, ela guarda quanto a parcela VALE. O sinal de dinheiro
 * deste banco (despesa negativa) vive em `financial_transactions`, e e
 * `pernasDaTransferencia` que o aplica, uma perna de cada vez.
 *
 * `"income"` e nao `"expense"` nao e detalhe de nomenclatura: `valorGravado`
 * devolve `-Math.abs` para `"expense"`, e uma parcela negativa derrubaria o
 * INSERT da serie INTEIRA em 23514. Passar pela funcao em vez de escrever
 * `Math.abs` a mao e o que mantem a convencao de sinal num lugar so -- se um
 * dia ela mudar, este arquivo acompanha.
 */
export function linhasDasParcelas(params: {
  serie: SerieDeParcelas;
  parcelas: number;
}): LinhaDaParcela[] {
  return params.serie.parcelas.map((p) => ({
    installment_number: p.numero,
    installment_total: params.parcelas,
    amount: valorGravado("income", p.valor),
    due_date: p.vencimento,
    status: "pending" as const,
  }));
}

/** Uma transferencia prevista do Caso A -- uma linha de `scheduled_transactions`. */
export interface PrevisaoDaParcela {
  account_id: string;
  destination_account_id: string;
  description: string;
  amount: number;
  due_date: string;
  transaction_type: "transfer";
  /** O elo: `mybank:<id da parcela>`. Ver `chaveDaParcelaDoMyBank`. */
  notes: string;
}

/** Uma parcela ja gravada, com o id que o insert devolveu. */
export interface ParcelaGravada {
  id: string;
  installment_number: number;
  installment_total: number;
  amount: number;
  due_date: string;
}

/**
 * QUAIS PERNAS CADA CASO GERA. Esta e a funcao que a issue manda separar da
 * escrita, e ela e a entrega inteira desta fase em cinco linhas.
 *
 * CASO A -> uma transferencia prevista por parcela.
 * CASO B -> `[]`. NENHUMA linha minha.
 *
 * POR QUE O `[]` E A PARTE QUE PRECISA DE PROVA
 * ---------------------------------------------
 * Um `previsoesDoEmprestimo` que ignorasse o caso e gerasse a serie nos dois
 * nao daria erro em lugar nenhum: as linhas sao minhas, a RLS as aceita, o
 * CHECK do destino passa. O que acontece e que emprestar R$ 24.000 para a Lais
 * cria 24 contas a pagar NO MEU NOME -- o safe-to-spend desconta R$ 1.000 por
 * mes de um dinheiro que ELA paga, Despesas infla, e nenhuma tela diz por que.
 * Dinheiro errado e plausivel, que e a unica classe de defeito que este
 * repositorio nao consegue achar depois.
 *
 * E o outro lado tambem esta fechado, e nao aqui: gravar linha NO NOME DELA
 * seria recusado pela RLS de `scheduled_transactions` (`user_id = auth.uid()`),
 * e deveria ser. O lado do devedor sai pela view `mybank_due_entries`.
 */
export function previsoesDoEmprestimo(params: {
  caso: CasoDoEmprestimo;
  parcelas: ParcelaGravada[];
  descricao: string;
  /** A conta de onde a parcela sai. So existe no Caso A. */
  contaDePagamentoId: string | null;
  /** A conta de investimento credora -- o destino da transferencia. */
  contaCredoraId: string;
}): PrevisaoDaParcela[] {
  if (params.caso !== "auto") return [];
  if (!params.contaDePagamentoId) return [];

  return params.parcelas.map((parcela) => ({
    account_id: params.contaDePagamentoId as string,
    destination_account_id: params.contaCredoraId,
    description: descricaoDaParcela(
      params.descricao,
      parcela.installment_number,
      parcela.installment_total
    ),
    // POSITIVO: `scheduled_transactions_amount_check` e `CHECK (amount > 0)`.
    // A previsao nao guarda sinal -- quem decide o sinal e a BAIXA, por
    // `transaction_type`, e em `transfer` ela grava DUAS pernas.
    amount: valorGravado("income", parcela.amount),
    due_date: parcela.due_date,
    // 'transfer' EXPLICITO, e nao herdado da regra.
    //
    // `scheduled_transactions_destino_check` (038) exige o tipo na propria
    // linha para poder exigir `destination_account_id`: com `transaction_type`
    // NULL o ramo ELSE do CASE alcanca a linha e exige destino NULL -- a linha
    // seria recusada. E trocar isto por 'expense' e o mutante nominal da issue:
    // a baixa criaria UMA perna negativa na conta corrente e a conta de
    // investimento nunca receberia nada. O dinheiro simplesmente desapareceria
    // do patrimonio, R$ 1.000 por mes, sem erro nenhum no caminho.
    transaction_type: "transfer" as const,
    notes: chaveDaParcelaDoMyBank(parcela.id),
  }));
}

/**
 * A perna de ENTRADA do pagamento de uma parcela -- a do Caso B, e so dela.
 *
 * `null` no Caso A, E ISSO EVITA CONTAR O DINHEIRO DUAS VEZES
 * ----------------------------------------------------------
 * No auto-emprestimo a parcela JA e uma transferencia prevista, e quem a paga e
 * `/api/scheduled-transactions/[id]/pay` -- que grava as DUAS pernas de
 * `pernasDaTransferencia` pelo caminho que ja existe. Se confirmar a parcela
 * tambem gravasse uma perna aqui, a conta de investimento receberia o valor
 * duas vezes: a baixa da previsao e a confirmacao do MyBank. E a mesma familia
 * do `pulodogato-fatura-conta-duas-vezes`.
 *
 * POR QUE `transfer` E NAO `income`, NO CASO B
 * -------------------------------------------
 * Principal voltando NAO e receita. Eu emprestei R$ 24.000 que eram meus; a
 * Lais devolvendo R$ 1.000 move dinheiro de volta para dentro do meu
 * patrimonio, nao o aumenta. Gravado como `income`, o mesmo dinheiro contaria
 * como renda 24 vezes -- e o Realizado de Receitas, o relatorio e o
 * `monthly_cash_flow` todos mostrariam um salario que nao existe. Quando
 * houver juro (fase 2), SO o juro e receita.
 *
 * UMA PERNA SO, E ISSO E CORRETO
 * -----------------------------
 * `pernasDaTransferencia` devolve o par, e aqui se usa `entrada`. Nao ha perna
 * de saida porque o dinheiro vem de FORA das minhas contas -- a conta da Lais
 * nao existe neste banco. Uma transferencia de uma perna nao desequilibra nada:
 * `category_monthly_totals` filtra `type IN ('expense','income')`, entao a
 * entrada nao entra como receita de ninguem, e o saldo da conta de investimento
 * sobe pelo valor que entrou nela de verdade.
 */
export function pernaDeEntradaDoPagamento(params: {
  caso: CasoDoEmprestimo;
  contaCredoraId: string;
  valor: number;
  descricao: string;
  numero: number;
  total: number;
}): PernaDeTransferencia | null {
  if (params.caso !== "conexao") return null;

  const { entrada } = pernasDaTransferencia({
    valor: params.valor,
    // A origem nao e usada (so a `entrada` sai daqui), e por isso ela e a
    // propria conta credora em vez de uma string vazia: um id vazio num campo
    // que um dia passe a ser lido viraria 22P02 em vez de erro de logica.
    origemId: params.contaCredoraId,
    destinoId: params.contaCredoraId,
    descricao: descricaoDaParcela(params.descricao, params.numero, params.total),
  });

  return entrada;
}

// ---------------------------------------------------------------------------
// O estado derivado: "alguem registrou que me pagou e eu ainda nao lancei"
// ---------------------------------------------------------------------------
// A forma e a da HMO-366 (`lib/acerto-na-aba-receitas.ts`), e o achado daquela
// fase foi que isto NAO precisa de coluna nova: e derivavel do estado que ja
// existe. Aqui o estado e `mybank_installments.status = 'reported'` -- o devedor
// avisou, o credor ainda nao confirmou.
//
// Quem ve o dinheiro chegar e quem confirma. O devedor so consegue levar
// `pending -> reported`; quem leva a `paid` e o credor, porque e a conta DELE
// que recebe, e so ele sabe se recebeu.

/** O devedor avisou que pagou e eu ainda nao confirmei. Ganha a acao Confirmar. */
export function parcelaAConfirmar(parcela: { status: string }): boolean {
  return parcela.status === "reported";
}

/** O titulo do bloco de quem avisou e espera confirmacao. */
export const TITULO_A_CONFIRMAR_NO_MYBANK = "Parcela do MyBank a confirmar";

/**
 * O que o bloco explica, e por que ele diz as duas coisas.
 *
 * A primeira oracao e o estado, a segunda e a CONSEQUENCIA de nao agir. Sem a
 * segunda a linha se le como aviso informativo e fica ali para sempre -- o
 * mesmo defeito que `SUBTITULO_A_CONFIRMAR` existe para nao ter na aba
 * Receitas.
 */
export const SUBTITULO_A_CONFIRMAR_NO_MYBANK =
  "Quem deve registrou que pagou. Enquanto você não confirmar, o dinheiro não entrou na sua conta de investimento.";

/**
 * POR QUE A PARCELA CONFIRMADA NAO ESTA NO «Realizado» DE RECEITAS.
 *
 * A perna e `transfer`, nao `income` -- ver `pernaDeEntradaDoPagamento`. Quem
 * acabou de confirmar precisa ler, na mesma tela, por que o numero grande nao
 * subiu; senao conclui que o app nao registrou e lanca a receita a mao, que e a
 * conta duas vezes de novo.
 */
export const PARCELA_FORA_DO_REALIZADO =
  "Já está na sua conta de investimento e fora do Realizado: o principal voltando move dinheiro de lugar e não é receita nova.";

/** O selo que a parcela do auto-emprestimo leva em Despesas e em Contas a Pagar. */
export const SELO_DO_MYBANK = "MyBank";

/**
 * Quem deve pagar esta parcela, para a lista "A receber" -- um dos tres campos
 * que a issue nomeia (valor, `n de m`, quem deve pagar).
 *
 * `null` no nome e um caso REAL, nao defensividade: o perfil do devedor e
 * alcancado pela `profiles_select_connected` (010), e desfazer a conexao depois
 * do emprestimo deixa a divida de pe com o perfil ilegivel. A tela mostra "quem
 * deve" sem o nome em vez de esconder a parcela -- a divida nao deixou de
 * existir porque o contato saiu.
 */
export function quemDevePagar(params: {
  caso: CasoDoEmprestimo;
  nomeDoDevedor: string | null;
}): string {
  if (params.caso === "auto") return "Você mesmo";
  return params.nomeDoDevedor ?? "Quem deve (contato indisponível)";
}

// ---------------------------------------------------------------------------
// O CANCELAMENTO DO EMPRESTIMO EM ATIVIDADE (F3 da HMO-383, issue HMO-391)
// ---------------------------------------------------------------------------
// Antes desta fase nao havia caminho nenhum de encerramento: `app/api/mybank/`
// tinha POST e GET de emprestimo, GET da agenda e o PATCH da parcela, e mais
// nada. Uma divida digitada errada -- a que abriu a HMO-383, duplicada em
// producao -- so saia por SQL colado a mao.
//
// CANCELAR E VIRAR UM STATUS, E ISSO NAO E PREGUICA DE MODELAGEM
// --------------------------------------------------------------
// As duas leituras do MyBank filtram `mybank_loans.status = 'active'` (a lista
// do credor em `lerAReceberDoMyBank`, e a view `mybank_due_entries` do lado do
// devedor). Virar o status apaga a divida DAS DUAS TELAS de uma vez, sem leitor
// novo e sem migration -- `mybank_loans_status_check` ja aceita `cancelled`
// desde a 053. E DELETE nao serviria: `mybank_loans_delete` recusa emprestimo
// com parcela `paid` de proposito, porque o CASCADE de `loan_id` levaria a
// parcela que tem perna em `financial_transactions`.
//
// A PARCELA `paid` FICA `paid`, E ESSE E O LIMITE DA OPERACAO
// -----------------------------------------------------------
// Parcela paga e dinheiro que se moveu: no Caso A a baixa da previsao gravou as
// duas pernas da transferencia; no Caso B o credor lancou a perna de entrada.
// Reescrever essas parcelas para `cancelled` apagaria o historico do dinheiro --
// o saldo da conta de investimento continuaria subido e nenhuma parcela
// explicaria por que. Cancelar encerra o que esta EM ABERTO; o que ja aconteceu
// nao se desfaz por aqui (e `mybank_installments_paid_check`, que e
// `CHECK ((status = 'paid') = (paid_date IS NOT NULL))`, passa nas canceladas
// justamente porque elas mantem `paid_date` nulo).
//
// A ORDEM DOS PASSOS E SOBRE DINHEIRO, E A DIRECAO DA FALHA PARCIAL E ESCOLHIDA
// -----------------------------------------------------------------------------
// A rota faz, nesta ordem: (2) o emprestimo vira `cancelled`; (3) as parcelas em
// aberto viram `cancelled`; (4) as previsoes ainda `pending` do Caso A sao
// apagadas de `scheduled_transactions`.
//
// Quebrar no meio DESTA ordem deixa previsao orfa em Contas a Pagar: a pessoa e
// cobrada por uma parcela de uma divida que nao existe mais -- e ela PERCEBE, e
// tem como consertar (a linha e dela, e Contas a Pagar sabe excluir previsao).
// A ordem inversa -- apagar as previsoes primeiro -- deixaria a divida viva com
// as contas a pagar sumidas: o safe-to-spend passaria a mostrar dinheiro que ja
// esta comprometido, ninguem reportaria nada, e o erro apareceria como surpresa
// no fim do mes. Entre um erro visivel e um erro que infla o disponivel, esta
// feature escolhe o visivel.
// ---------------------------------------------------------------------------

/** O status que encerra a divida nas duas telas. `mybank_loans_status_check`, 053. */
export const STATUS_CANCELADO = "cancelled";

/** Por que este cancelamento nao serve. */
export type ProblemaDoCancelamento =
  | "nao_sou_o_credor"
  | "emprestimo_ja_cancelado"
  | "emprestimo_ja_quitado";

/**
 * O cancelamento pode acontecer? `null` quando pode, ou o motivo.
 *
 * `nao_sou_o_credor` VEM PRIMEIRO, E A ORDEM E A RESPOSTA
 * ------------------------------------------------------
 * `mybank_loans_select` e `lender OR borrower`, entao o DEVEDOR enxerga a linha
 * e chega aqui com um emprestimo legivel. Perguntar pelo status antes diria "esse
 * emprestimo ja foi quitado" para quem nao tem nada a cancelar -- vazando o
 * estado da divida de outra pessoa numa mensagem de erro. Primeiro "isto nao e
 * seu para cancelar"; o estado so se discute com quem manda nele.
 *
 * E A PERGUNTA E FEITA ANTES, NAO SO DEPOIS: `mybank_loans_update` e
 * `USING/WITH CHECK (lender_user_id = auth.uid())`, e UPDATE que a policy filtra
 * volta como SUCESSO COM ZERO LINHAS neste app -- sem erro, sem SQLSTATE
 * (`update-filtrado-pela-rls-vira-sucesso`). Sem esta pergunta o devedor
 * receberia "divida cancelada" e nada teria mudado em tela nenhuma.
 */
export function problemaDoCancelamento(params: {
  emprestimo: { lender_user_id: string; status: string };
  meuId: string;
}): ProblemaDoCancelamento | null {
  if (params.emprestimo.lender_user_id !== params.meuId) {
    return "nao_sou_o_credor";
  }

  // OS DOIS ESTADOS ENCERRADOS TEM FRASE SEPARADA, e nao e detalhe: dizer
  // "ja foi cancelado" de um emprestimo `settled` e desmentir o proprio banco
  // para quem acabou de receber a ultima parcela.
  if (params.emprestimo.status === STATUS_CANCELADO) {
    return "emprestimo_ja_cancelado";
  }
  if (params.emprestimo.status === "settled") {
    return "emprestimo_ja_quitado";
  }

  return null;
}

/** A frase que a tela mostra para cada recusa de cancelamento. */
export function mensagemDoProblemaDoCancelamento(
  problema: ProblemaDoCancelamento
): string {
  switch (problema) {
    case "nao_sou_o_credor":
      return "Só quem emprestou pode cancelar este empréstimo. Fale com quem emprestou.";
    case "emprestimo_ja_cancelado":
      return "Este empréstimo já está cancelado.";
    case "emprestimo_ja_quitado":
      return "Este empréstimo já foi quitado — não há mais nada em aberto para cancelar.";
  }
}

/**
 * Os estados em que a parcela ainda nao virou fato de dinheiro.
 *
 * `paid` esta FORA, e e a invariante desta feature (ver o cabecalho da secao).
 * `cancelled` tambem: cancelar duas vezes nao tem segundo efeito.
 */
export const STATUS_EM_ABERTO_DA_PARCELA: readonly string[] = [
  "pending",
  "reported",
];

/**
 * Esta parcela e cancelada junto com o emprestimo?
 *
 * Escrita sobre `STATUS_EM_ABERTO_DA_PARCELA` em vez de repetir a comparacao de
 * `parcelaSegueABaixaDaPrevisao` -- que hoje tem o mesmo conjunto por
 * coincidencia de significado, nao por ser a mesma pergunta. A baixa pergunta
 * "esta parcela pode virar paga"; esta pergunta "esta parcela pode ser
 * encerrada sem apagar dinheiro". No dia em que um estado novo entrar na tabela
 * as duas podem querer respostas diferentes, e duas comparacoes identicas no
 * mesmo arquivo seriam lidas como uma copia a ser unificada.
 *
 * (`lib/mybank-na-tela.ts` tem um terceiro conjunto com os mesmos dois estados,
 * `STATUS_EM_ABERTO`, e ele responde a uma quarta pergunta -- "esta parcela
 * aparece na lista A receber". Unificar os tres num lugar so apagaria a medicao
 * de dois modulos para economizar duas linhas, e amarraria este arquivo a um
 * modulo de tela -- ele nao importa nada alem de `lancamento` e `transferencia`
 * de proposito, e e isso que o deixa compilar na suite sem o runtime do Next.)
 */
export function parcelaSegueOCancelamento(parcela: { status: string }): boolean {
  return STATUS_EM_ABERTO_DA_PARCELA.includes(parcela.status);
}

/** O patch da parcela encerrada junto com o emprestimo. */
export interface CancelamentoDaParcela {
  status: "cancelled";
}

/**
 * O que o cancelamento grava na parcela em aberto -- `status`, E MAIS NADA.
 *
 * Nao ha `paid_date` nem `paid_transaction_id` aqui porque a parcela em aberto
 * ja os tem nulos, e `mybank_installments_paid_check` so exige a equivalencia
 * entre `status = 'paid'` e `paid_date IS NOT NULL`. Um `paid_date: null`
 * explicito nao mudaria nada hoje e seria uma mentira amanha: ele diria que
 * esta funcao sabe apagar carimbo de pagamento, e e justamente o que ela nao faz.
 */
export function patchDoCancelamentoDaParcela(): CancelamentoDaParcela {
  return { status: "cancelled" };
}

/**
 * As chaves das previsoes a apagar de `scheduled_transactions` -- so o Caso A.
 *
 * `[]` NO CASO B, PELA MESMA RAZAO DE `previsoesDoEmprestimo`
 * ----------------------------------------------------------
 * No Caso B o emprestimo nunca gravou linha minha em tabela nenhuma de dinheiro
 * -- nao ha previsao para apagar, e o id da parcela da devedora existe do mesmo
 * jeito. Montar a chave dele aqui e mandar o DELETE assim mesmo nao daria erro
 * (nenhuma linha casaria), e e exatamente o tipo de passo que fica no codigo
 * parecendo necessario; o que importa e a decisao estar escrita no mesmo lugar
 * onde a criacao a tomou.
 *
 * E A LISTA VAZIA E UMA ARMADILHA DO POSTGREST, NAO UMA ECONOMIA
 * --------------------------------------------------------------
 * `.in("notes", [])` nao filtra nada: a clausula vazia simplesmente desaparece,
 * e o DELETE passa a alcancar TODA linha que a RLS entrega -- todas as
 * previsoes pendentes da pessoa. A mesma armadilha esta documentada em
 * `lib/services/divida-do-mybank.ts`, do lado da leitura (lá o sintoma e ler
 * parcela alheia; aqui seria apagar a agenda inteira). Quem chama GUARDA NO
 * `.length` desta lista.
 */
export function chavesDasPrevisoesDoCancelamento(params: {
  caso: CasoDoEmprestimo;
  parcelasCanceladas: { id: string }[];
}): string[] {
  if (params.caso !== "auto") return [];
  return params.parcelasCanceladas.map((p) => chaveDaParcelaDoMyBank(p.id));
}

/**
 * O aviso do `confirm()`, e ele diz o que o cancelamento NAO faz.
 *
 * Tres coisas, e as tres sao necessarias:
 *
 *   1. que a divida sai das duas telas -- no Caso B a tela que muda e DE OUTRA
 *      PESSOA, e quem clica tem de saber disso antes;
 *   2. que isto NAO e pagamento. Quem cancela achando que esta quitando ve a
 *      divida desaparecer e conclui que pagou -- e o dinheiro nunca se moveu;
 *   3. que nao amortiza nada. Antecipar parcela e abater principal e outra
 *      operacao (tem aritmetica propria e decisao sobre juros), e esta nao e ela.
 *
 * O texto vive aqui, e nao no componente, para ter teste: escrito no JSX ele
 * passaria por qualquer suite intacto.
 */
export function avisoDoCancelamento(params: {
  descricao: string;
  caso: CasoDoEmprestimo;
  nomeDoDevedor: string | null;
}): string {
  const ondeSai =
    params.caso === "auto"
      ? "As parcelas em aberto saem das suas Contas a Pagar"
      : `A dívida sai da sua lista e da tela de ${
          params.nomeDoDevedor ?? "quem deve"
        }`;

  return (
    `Cancelar “${params.descricao}”?\n\n` +
    `${ondeSai}. As parcelas já pagas continuam pagas.\n\n` +
    "Cancelar NÃO registra pagamento e NÃO amortiza nada: nenhum dinheiro se move."
  );
}

/**
 * O que mudou, nos DOIS lados -- a resposta da rota, pelo princípio de
 * `mensagemDaCriacao`.
 *
 * Um "empréstimo cancelado" seco deixaria a pergunta mais importante sem
 * resposta: o que aconteceu com as parcelas pagas, e o que a outra pessoa vai
 * ver. Entao a frase conta as tres coisas que mudaram de estado (as canceladas,
 * as pagas que ficaram, as contas a pagar que sairam) e nomeia quem deixa de ser
 * cobrado.
 */
export function mensagemDoCancelamento(params: {
  caso: CasoDoEmprestimo;
  quantasCanceladas: number;
  quantasPagas: number;
  previsoesApagadas: number;
  nomeDoDevedor: string | null;
}): string {
  const partes: string[] = [
    params.quantasCanceladas === 1
      ? "1 parcela cancelada"
      : `${params.quantasCanceladas} parcelas canceladas`,
  ];

  if (params.caso === "auto") {
    partes.push(
      params.previsoesApagadas === 1
        ? "1 conta a pagar saiu da sua agenda"
        : `${params.previsoesApagadas} contas a pagar saíram da sua agenda`
    );
  } else {
    // O NOME, QUANDO HA UM. Perfil ilegivel e caso real -- desfazer a conexao
    // depois de emprestar deixa a divida de pe e o nome fora de alcance
    // (`quemDevePagar` tem a mesma frase para a lista).
    partes.push(
      `a dívida saiu das despesas de ${
        params.nomeDoDevedor ?? "quem deve"
      }`
    );
  }

  if (params.quantasPagas > 0) {
    partes.push(
      params.quantasPagas === 1
        ? "a parcela já paga continua paga"
        : `as ${params.quantasPagas} parcelas já pagas continuam pagas`
    );
  }

  return `${partes.join("; ")}.`;
}

// ---------------------------------------------------------------------------
// `settled`: O EMPRESTIMO QUE CHEGOU AO FIM (F1 da HMO-393, issue HMO-394)
// ---------------------------------------------------------------------------
// Antes desta fase NINGUEM escrevia `settled`. `mybank_loans_status_check` (053)
// o aceita desde o primeiro dia, as duas leituras filtram `status = 'active'` e
// `problemaDoCancelamento` ja tinha a frase de `emprestimo_ja_quitado` -- mas o
// ciclo de pagamento nao alcancava o status: o PATCH da parcela, que e quem leva
// a ultima a `paid`, nao tocava o emprestimo. Um emprestimo 24/24 quitado ficava
// `active` para sempre, e a unica saida que a tela oferecia era o botao Cancelar.
// Uma divida integralmente honrada terminava carimbada como CANCELADA.
//
// A CONSEQUENCIA E DE REGISTRO, E E POR ISSO QUE O DEFEITO NAO FOI REPORTADO
// --------------------------------------------------------------------------
// Nenhum numero esta errado hoje: as pernas de cada parcela paga estao lancadas
// e o patrimonio fecha. O que esta errado e o que o historico DIZ -- quem paga a
// ultima parcela ve o progresso chegar a "24 de 24" e nada declarar o fim. E o
// oposto da familia HMO-149 ("o numero fecha, o fato nao aconteceu"): aqui o
// fato aconteceu e nenhum numero denuncia que o registro ficou atras.
//
// `settled` E CONSEQUENCIA, NAO A OPERACAO: A ESCRITA FALHA SEM DESFAZER NADA
// ---------------------------------------------------------------------------
// Os tres chamadores gravam `settled` DEPOIS de o dinheiro estar gravado, e
// nenhum deles desfaz coisa alguma se o UPDATE do emprestimo falhar. O estado
// que sobra -- parcela paga, emprestimo `active` -- e exatamente o estado de
// hoje, e e correto em dinheiro: reverter a baixa para preservar o status seria
// trocar um registro atrasado por um pagamento apagado. A resposta diz o que
// ficou; nada e revertido.
//
// E A POSICAO DA ESCRITA E ESCOLHIDA: DEPOIS DO ULTIMO DESFAZIMENTO POSSIVEL
// --------------------------------------------------------------------------
// Na baixa da previsao (Caso A) a quitacao NAO entra no passo 2.5, junto da
// baixa da parcela: aquele passo ainda tem um estorno depois dele (a falha da
// baixa da previsao desfaz as duas pernas E devolve a parcela a `pending`), e o
// estorno nao sabe desfazer o status do emprestimo. Gravar `settled` ali
// deixaria, na falha, um emprestimo `settled` com parcela `pending` -- e como as
// duas telas filtram `active`, a divida viva desapareceria de ambas. A quitacao
// vai depois do ultimo passo que pode voltar atras, onde ja nao ha o que desfazer.
//
// POR QUE NAO HA COLUNA DE DATA
// -----------------------------
// `mybank_loans` nao tem `settled_at`, e nao e omissao da 053: a data em que a
// divida acabou e o `paid_date` da ultima parcela, que ja esta gravado e e o
// unico lugar onde ela nao pode discordar de si mesma. Uma coluna nova aqui
// precisaria ser mantida em sincronia com aquela a cada antecipacao e estorno.
// ---------------------------------------------------------------------------

/** O status do emprestimo que chegou ao fim. `mybank_loans_status_check`, 053. */
export const STATUS_QUITADO = "settled";

/**
 * O emprestimo chegou ao fim? Nenhuma parcela em aberto E ao menos uma `paid`.
 *
 * A EXIGENCIA DE UMA `paid` NAO E DEFENSIVA -- ELA SEPARA TRES ESTADOS
 * -------------------------------------------------------------------
 * "nenhuma parcela em aberto" e verdade em tres mundos diferentes, e so um deles
 * e quitacao:
 *
 *   1. todas pagas -> QUITADO, e e o unico que esta funcao reconhece;
 *   2. todas canceladas -> o emprestimo e `cancelled`, e ja tem rota propria
 *      (`PATCH /api/mybank/loans/[id]`). Chamar isso de quitado diria que uma
 *      divida que ninguem pagou foi honrada;
 *   3. NENHUMA PARCELA -- e este e estado ALCANCAVEL, nao hipotese defensiva. O
 *      POST de `/api/mybank/loans` grava o emprestimo e a serie em DOIS inserts,
 *      e o ramo idempotente do 23505 diz por extenso que o primeiro POST pode ter
 *      "morrido entre o passo 1 e o passo 2". Sem a segunda condicao,
 *      `[].some(...)` e `false`, "nao ha parcela em aberto" e verdade, e o
 *      emprestimo gravado pela metade se declara quitado: ele sai das duas telas
 *      (que filtram `active`) como divida cumprida, e uma divida real desaparece
 *      sem nunca ter sido cobrada.
 *
 * O terceiro e o mutante obrigatorio desta fase. A segunda condicao e a REGRA,
 * nao uma guarda -- apaga-la nao degrada a resposta, inverte-a.
 *
 * `cancelled` NAO BLOQUEIA A QUITACAO, e isso e deliberado: um emprestimo com 23
 * parcelas pagas e a ultima cancelada (a cauda que a antecipacao encurta, na F2)
 * chegou ao fim tanto quanto um 24/24. O que a funcao exige e que nao haja nada
 * EM ABERTO e que algum dinheiro tenha entrado.
 */
export function emprestimoFicouQuitado(params: {
  parcelas: { status: string }[];
}): boolean {
  const aindaEmAberto = params.parcelas.some((p) =>
    STATUS_EM_ABERTO_DA_PARCELA.includes(p.status)
  );
  if (aindaEmAberto) return false;

  return params.parcelas.some((p) => p.status === "paid");
}

/** O patch do emprestimo que se declara quitado. */
export interface QuitacaoDoEmprestimo {
  status: "settled";
}

/**
 * O que a quitacao grava no emprestimo -- `status`, E MAIS NADA.
 *
 * Sem `updated_at`: a 053 tem trigger de carimbo, e escreve-lo aqui a mao
 * competiria com ele. E sem data de quitacao, por nao haver coluna -- ver POR QUE
 * NAO HA COLUNA DE DATA, no cabecalho desta secao.
 *
 * A funcao existe para os tres chamadores escreverem a MESMA coisa: o `UPDATE`
 * esta em tres rotas, e o literal repetido tres vezes e o que deixa duas delas
 * concordarem e a terceira divergir sem que nada reclame.
 */
export function patchDaQuitacaoDoEmprestimo(): QuitacaoDoEmprestimo {
  return { status: "settled" };
}

// ---------------------------------------------------------------------------
// A ANTECIPACAO DE PARCELAS (F2 da HMO-393, issue HMO-395)
// ---------------------------------------------------------------------------
// "Vou adiantar duas parcelas" num emprestimo de 24 x R$ 1.000. A decisao de
// produto e tres frases: DUAS PARCELAS MENOS, as que sobram MANTEM O VALOR, e a
// serie ENCURTA. Nada aqui baixa prestacao.
//
// O DINHEIRO PAGA A CAUDA. NADA E CANCELADO -- E ESSA E A CORRECAO QUE VEM ANTES
// -----------------------------------------------------------------------------
// O desenho obvio -- as parcelas do fim viram `cancelled` E o dinheiro paga as
// proximas em aberto -- EXTINGUE O DOBRO DO QUE FOI PAGO. Num emprestimo de
// R$ 24.000 em 24 x R$ 1.000, com 1 e 2 pagas, entrando R$ 2.000: as parcelas 3
// e 4 viram `paid` e as 23 e 24 viram `cancelled`. Quatro parcelas saem do
// caminho e so duas foram pagas: a divida de R$ 24.000 se resolve com R$ 22.000,
// e o credor recebe R$ 2.000 a menos.
//
// Nenhum CHECK reclama disso, as duas telas ficam consistentes ENTRE SI, e
// `soma(pagas) + soma(em aberto)` passa a dar R$ 22.000 sem que nada compare
// esse numero com `mybank_loans.principal`. E `cancelled` quer dizer "encerrada
// sem dinheiro" neste banco -- `avisoDoCancelamento` promete por extenso, na
// tela, que cancelar NAO amortiza nada.
//
// Entao: as parcelas de MAIOR VENCIMENTO viram `paid`, com `paid_date` e uma
// perna de entrada cada. A parcela 3 continua `pending`, vence no mes que vem,
// com o valor que sempre teve -- nenhum `amount` e tocado em lugar nenhum desta
// secao. A serie que acabava em 08/2028 acaba em 06/2028.
//
// A INVARIANTE QUE ISSO PRESERVA, E ELA E A ASSERCAO DO MUTANTE PRINCIPAL
// ----------------------------------------------------------------------
//   soma(recebido) + soma(em aberto) = principal
//
// Com o dinheiro pagando a cauda ela vale depois de CADA parcela antecipada.
// Com a cauda cancelada ela quebra, e quebra calada. O mutante "a antecipacao
// CANCELA a cauda" tem de morrer numa assercao de SOMATORIO -- uma assercao de
// `status` o mataria pelo motivo errado (os dois desenhos escrevem status
// diferentes; so um deles perde dinheiro).
//
// PARAR NO MEIO E UM ESTADO CONSISTENTE, E E POR ISSO QUE NAO HA TRANSACAO
// -----------------------------------------------------------------------
// Cada parcela antecipada e fechada em si: uma perna de entrada, uma baixa. A
// invariante acima continua valendo depois de cada uma, entao "antecipei 1 das 2
// que pedi" e um resultado, nao um estado quebrado -- e a resposta diz o NUMERO
// em vez de dizer sucesso.
//
// A alternativa (um `.in()` de N ids num UPDATE so) seria atomica na baixa e NAO
// nas N pernas: "4 pernas gravadas, 4 parcelas pagas, 1 perna perdida" e
// irreconciliavel, porque `paid_transaction_id` aponta para uma linha que nao
// existe. Por isso a rota faz uma parcela de cada vez, e desfaz a perna quando a
// baixa dela falha.
//
// JUROS ZERO ESTA USADO, NAO ESCONDIDO -- E A FASE 2 REABRE ESTA FEATURE
// ---------------------------------------------------------------------
// `mybank_loans_interest_rate_fase_1` (053) trava `interest_rate = 0`, e e por
// isso que `valorDaAntecipacao` e uma SOMA SIMPLES: cada real antecipado abate
// principal real a real. Com juro, antecipar tem de descontar o juro NAO-CORRIDO
// da cauda, e somar `amount` passaria a cobrar juro de um tempo que nao existiu.
// Por isso `problemaDaAntecipacao` RECUSA `interest_rate <> 0` em vez de calcular
// errado -- a trava do banco e a razao pela qual a soma esta certa HOJE, e a
// recusa e o que faz o dia em que ela mudar ser um 409 e nao um erro de dinheiro.
//
// ZERO MIGRATION, E ISSO FOI MEDIDO NA 053
// ----------------------------------------
// `installment_total` NAO e tocado, entao `installment_number BETWEEN 1 AND
// installment_total` nao tem como ser violado. `((status='paid') = (paid_date IS
// NOT NULL))` e atendido por `patchDaBaixaDaParcela`. E NAO EXISTE TRAVA DE ORDEM
// DE PAGAMENTO: nenhum CHECK e nenhuma das duas triggers compara
// `installment_number` com o das vizinhas, entao pagar a 24 com a 3 pendente e um
// UPDATE comum.
// ---------------------------------------------------------------------------

/** O estado em que o emprestimo aceita antecipacao. */
export const STATUS_ATIVO = "active";

/** Por que esta antecipacao nao serve. */
export type ProblemaDaAntecipacao =
  | "nao_sou_o_credor"
  | "emprestimo_nao_esta_ativo"
  | "juros_impedem_a_antecipacao"
  | "quantas_invalida"
  | "mais_do_que_em_aberto";

/** O que a escolha da cauda precisa saber de uma parcela. */
export interface ParcelaParaAntecipar {
  id: string;
  installment_number: number;
  installment_total: number;
  amount: number;
  due_date: string;
  status: string;
}

/**
 * As N parcelas em aberto de MAIOR VENCIMENTO -- a cauda da serie.
 *
 * OS DOIS CRITERIOS IMPORTAM, E O SEGUNDO NAO E ENFEITE
 * ----------------------------------------------------
 * `due_date DESC` e o que "encurtar a serie" quer dizer para quem olha a tela: o
 * fim da divida se aproxima. `installment_number DESC` e o desempate, e ele
 * existe porque duas parcelas podem vencer no MESMO dia -- uma serie criada com
 * `primeiro_vencimento` em 31/01 grampeia em fevereiro (ver
 * `serieDeParcelas`), e nada impede dois emprestimos de parcelas coincidirem num
 * mes curto. Sem o desempate as duas sairiam na ordem que o banco devolveu, e um
 * teste de empate nao mediria nada porque `Array.prototype.sort` e ESTAVEL:
 * ele devolveria a ordem do fixture e passaria verde com o criterio ausente
 * (`sort-estavel-faz-o-teste-de-desempate-nao-medir-nada`).
 *
 * `paid` E `cancelled` FICAM FORA, pelo filtro de `STATUS_EM_ABERTO_DA_PARCELA`:
 * antecipar uma parcela ja paga seria pagar duas vezes a mesma coisa, e uma
 * cancelada nao e divida.
 *
 * O `.sort()` ORDENA NO LUGAR, E ELE SO PODE PORQUE O `filter` JA COPIOU
 * ---------------------------------------------------------------------
 * `Array.prototype.filter` devolve um array NOVO, entao o `sort` abaixo mexe na
 * copia e nao na lista que a rota leu do banco. Isso importa porque a rota passa
 * o MESMO array para esta funcao, para `quantasEmAberto` e para
 * `ultimoVencimentoEmAberto`: reordenar a lista de quem chamou como efeito
 * colateral de escolher a cauda nao daria sintoma AQUI, e daria lá -- num rotulo
 * de vencimento ou numa contagem. Quem mexer nesta funcao tem de manter a copia
 * em algum passo; o teste "NAO reordena a lista que recebeu" e o que guarda isso.
 */
export function parcelasDaAntecipacao(params: {
  parcelas: ParcelaParaAntecipar[];
  quantas: number;
}): ParcelaParaAntecipar[] {
  const emAberto = params.parcelas.filter((p) =>
    STATUS_EM_ABERTO_DA_PARCELA.includes(p.status)
  );

  const daCaudaParaCima = emAberto.sort((a, b) => {
    if (a.due_date !== b.due_date) {
      return String(a.due_date) < String(b.due_date) ? 1 : -1;
    }
    return b.installment_number - a.installment_number;
  });

  return daCaudaParaCima.slice(0, params.quantas);
}

/** Quantas parcelas desta serie ainda sao divida. */
export function quantasEmAberto(parcelas: { status: string }[]): number {
  return parcelas.filter((p) => STATUS_EM_ABERTO_DA_PARCELA.includes(p.status))
    .length;
}

/**
 * A antecipacao pode acontecer? `null` quando pode, ou o motivo.
 *
 * A ORDEM E A RESPOSTA, E A PRIMEIRA PERGUNTA E A MESMA DE `problemaDoCancelamento`
 * --------------------------------------------------------------------------------
 * `mybank_loans_select` e `lender OR borrower`: o DEVEDOR enxerga a linha e
 * chega aqui com um emprestimo legivel. Perguntar pelo estado antes diria "esse
 * emprestimo nao esta ativo" a quem nao tem nada a antecipar -- vazando o estado
 * da divida de outra pessoa numa mensagem de erro. Primeiro "isto nao e seu"; o
 * estado so se discute com quem manda nele.
 *
 * E a pergunta e feita ANTES DA ESCRITA, nao so depois: `mybank_loans_update` e
 * `lender_user_id = auth.uid()` nos dois lados e `mybank_installments_trava_do_
 * devedor` (053) levanta `insufficient_privilege` em `paid_date` e
 * `paid_transaction_id` -- mas UPDATE que a POLICY filtra volta 200 com `[]`,
 * sem erro e sem SQLSTATE (`update-filtrado-pela-rls-vira-sucesso`). Sem esta
 * pergunta o devedor receberia "antecipei duas parcelas" e nada teria mudado.
 *
 * `juros_impedem_a_antecipacao` ENTRA NO BLOCO DE ESTADO DO EMPRESTIMO
 * -------------------------------------------------------------------
 * Ele e uma pergunta sobre a linha do emprestimo, como `status`, e por isso vem
 * junto dela -- depois da pergunta de credor, que e a que guarda o vazamento.
 * Ver JUROS ZERO ESTA USADO, no cabecalho desta secao, para o porque de ele ser
 * uma recusa e nao um calculo.
 *
 * O CASO A NAO E MAIS UMA RECUSA AQUI (HMO-396), E O PORQUE E DE DINHEIRO
 * ----------------------------------------------------------------------
 * A F2 recusava o Caso A com um ponteiro para Contas a Pagar. A F3 apagou essa
 * recusa porque o ponteiro podia apontar para uma tela VAZIA: a parcela da
 * cauda vence em 2028 e a previsao dela pode estar fora do horizonte de Contas
 * a Pagar (`skipped-protege-so-o-horizonte-ja-materializado`). Mandar a pessoa
 * pagar lá nao era alternativa; era mandar procurar uma linha que nao esta na
 * tela.
 *
 * Entao o Caso A ANTECIPA, e o que o banco exige dele e uma pergunta que esta
 * funcao NAO TEM COMO FAZER: existe, para cada parcela da cauda, uma previsao
 * `pending` com o elo `mybank:<id>`? Isso e uma leitura, e por isso vive em
 * `paresDaAntecipacaoDoCasoA` -- depois desta funcao, antes da primeira
 * escrita. O que ficou aqui e so o que se decide com o emprestimo e a serie em
 * maos.
 */
export function problemaDaAntecipacao(params: {
  emprestimo: {
    lender_user_id: string;
    borrower_user_id: string;
    status: string;
    interest_rate?: number | string | null;
  };
  meuId: string;
  parcelas: { status: string }[];
  quantas: number;
}): ProblemaDaAntecipacao | null {
  if (params.emprestimo.lender_user_id !== params.meuId) {
    return "nao_sou_o_credor";
  }

  // `cancelled` e `settled` cairiam aqui com a mesma frase, de proposito: os
  // dois sao "nao ha nada em aberto para antecipar", e a frase diz o status para
  // quem le. Separar as duas, como `problemaDoCancelamento` faz, importa lá
  // porque cancelar um emprestimo quitado desmente o banco para quem acabou de
  // receber; aqui as duas respostas seriam a mesma acao (nenhuma).
  if (params.emprestimo.status !== STATUS_ATIVO) {
    return "emprestimo_nao_esta_ativo";
  }

  // `Number(...)` e nao `!== 0`: `numeric` chega do PostgREST como STRING
  // ("0.00"), e `"0.00" !== 0` e verdade -- a recusa dispararia em todo
  // emprestimo da fase 1 e a feature inteira seria inalcancavel.
  if (Number(params.emprestimo.interest_rate ?? 0) !== JUROS_DA_FASE_1) {
    return "juros_impedem_a_antecipacao";
  }

  // INTEIRO E >= 1. `valor` nao existe no contrato desta rota (ver
  // `mensagemDoProblemaDaAntecipacao`), entao o pedido de "R$ 150 contra
  // parcelas de R$ 200" nao tem como ser EXPRESSO -- a recusa esta na forma do
  // corpo, que e mais forte que uma validacao. `2.5 parcelas` e o que sobra para
  // esta pergunta barrar.
  if (!Number.isInteger(params.quantas) || params.quantas < 1) {
    return "quantas_invalida";
  }

  if (params.quantas > quantasEmAberto(params.parcelas)) {
    return "mais_do_que_em_aberto";
  }

  return null;
}

/** A frase que a tela mostra para cada recusa de antecipacao. */
export function mensagemDoProblemaDaAntecipacao(
  problema: ProblemaDaAntecipacao,
  contexto: { status: string; emAberto: number }
): string {
  switch (problema) {
    case "nao_sou_o_credor":
      return "Só quem emprestou pode antecipar parcelas deste empréstimo. Fale com quem emprestou.";
    case "emprestimo_nao_esta_ativo":
      return `Este empréstimo está "${contexto.status}" — não há nada em aberto para antecipar.`;
    case "juros_impedem_a_antecipacao":
      return "Este empréstimo tem juro, e antecipar com juro exige descontar o juro que não correu. Essa conta ainda não existe aqui.";
    case "quantas_invalida":
      // A FRASE DIZ O QUE FAZER COM R$ 150, e nao so recusa. Quem chega aqui
      // provavelmente queria mandar um VALOR; o corpo nao tem esse campo, e a
      // razao precisa estar escrita onde a pessoa a le.
      return (
        "Diga quantas parcelas quer antecipar — um número inteiro, de 1 em diante. " +
        "Esta operação só aceita parcela inteira: pagamento parcial de parcela é outra operação, e não existe hoje."
      );
    case "mais_do_que_em_aberto":
      return contexto.emAberto === 1
        ? "Só resta 1 parcela em aberto neste empréstimo."
        : `Este empréstimo tem ${contexto.emAberto} parcelas em aberto — não dá para antecipar mais do que isso.`;
  }
}

/**
 * Quanto a antecipacao custa -- a SOMA das parcelas escolhidas.
 *
 * SOMA SIMPLES PORQUE O JURO E ZERO, e a trava do banco e quem garante isso
 * (`mybank_loans_interest_rate_fase_1`). Ver o cabecalho desta secao: com juro,
 * somar `amount` cobraria juro de um tempo que nao existiu, e por isso
 * `problemaDaAntecipacao` recusa em vez de esta funcao calcular errado.
 *
 * EM CENTAVOS INTEIROS, e nao somando reais: 24 x 416,67 em float da
 * 9999,999999999998, e o valor da resposta -- que a pessoa confere contra o
 * extrato -- sairia com uma dizima. A aritmetica deste repositorio soma centavos
 * e divide no fim, pela mesma razao que `serieDeParcelas` faz.
 */
export function valorDaAntecipacao(params: {
  parcelasEscolhidas: { amount: number }[];
}): number {
  const centavos = params.parcelasEscolhidas.reduce(
    (total, p) => total + Math.round(Number(p.amount) * 100),
    0
  );

  return centavos / 100;
}

// ---------------------------------------------------------------------------
// A ANTECIPACAO NO CASO A (F3 da HMO-393, issue HMO-396)
// ---------------------------------------------------------------------------
// AS PREVISOES DA CAUDA SAO BAIXADAS, NAO APAGADAS -- E O CRITERIO E O OPOSTO
// DO CANCELAMENTO, PELO MESMO ELO
// ---------------------------------------------------------------------------
// As duas operacoes acham as MESMAS LINHAS pela MESMA chave (`mybank:<id da
// parcela>`), e fazem com elas coisas opostas:
//
//   CANCELAR  -> `chavesDasPrevisoesDoCancelamento` + DELETE. Nada se moveu:
//     a previsao e uma cobranca futura que deixou de existir, e apagar e o que
//     tira a linha de Contas a Pagar.
//   ANTECIPAR -> `chavesDasPrevisoesDaAntecipacao` + UPDATE para `paid`. O
//     dinheiro SE MOVEU: a previsao e o registro de que ele se moveu. Apagada,
//     a parcela ficaria paga, o saldo da conta corrente ficaria menor, e a
//     linha que explica o porque teria desaparecido do historico -- duas pernas
//     em `financial_transactions` sem nenhuma previsao que as explique, que e a
//     direcao de falha de `o-banco-ja-divide-despesa-de-grupo` ao contrario:
//     o fato aconteceu e o registro nao existe.
//
// O par e deliberado, e por isso as duas funcoes sao vizinhas na leitura e tem
// mutante cada uma. A unica coisa que as distingue e o verbo de quem chama.
//
// POR QUE ESTA ROTA TEM DE FAZER O TRABALHO, E NAO MANDAR PARA CONTAS A PAGAR
// --------------------------------------------------------------------------
// A parcela da cauda vence em 2028, e a previsao dela PODE ESTAR FORA DO
// HORIZONTE de Contas a Pagar (`skipped-protege-so-o-horizonte-ja-
// materializado`). A recusa que a F2 escrevia -- "antecipe pagando em Contas a
// Pagar" -- mandava a pessoa para uma tela onde a linha podia nao estar.
//
// A PREVISAO E OBRIGATORIA, E A AUSENCIA DELA E RECUSA E NAO IMPROVISO
// -------------------------------------------------------------------
// E dela que sai a CONTA DE ONDE O DINHEIRO SAI: `mybank_loans` guarda a conta
// credora (`lender_account_id`, o destino) e NAO guarda a conta de pagamento --
// `previsoesDoEmprestimo` recebeu `contaDePagamentoId` na criacao e so a
// previsao a guardou (`account_id`). Sem previsao nao ha de onde debitar, e um
// Caso A sem previsao existe de verdade: a criacao sem `conta_de_pagamento_id`
// grava `[]` previsoes (a segunda guarda de `previsoesDoEmprestimo`). Entao a
// rota RECUSA, nomeando as parcelas -- escolher uma conta por conta propria
// seria mover dinheiro de uma conta que a pessoa nao indicou.
// ---------------------------------------------------------------------------

/**
 * As chaves das previsoes a BAIXAR -- so o Caso A. O espelho de
 * `chavesDasPrevisoesDoCancelamento`, e o espelho e o ponto.
 *
 * `[]` NO CASO B, PELA MESMA RAZAO DE LA: o Caso B nunca gravou linha minha em
 * tabela nenhuma de dinheiro, entao nao ha previsao para baixar -- quem paga a
 * parcela da conexao e `pernaDeEntradaDoPagamento`, com UMA perna, e o dinheiro
 * vem de fora das minhas contas.
 *
 * E A LISTA VAZIA E A MESMA ARMADILHA DO POSTGREST, com um sintoma PIOR
 * --------------------------------------------------------------------
 * `.in("notes", [])` nao filtra nada: a clausula vazia desaparece e a consulta
 * passa a alcancar TODA linha que a RLS entrega. No cancelamento isso apagava a
 * agenda inteira; aqui o verbo e UPDATE para `paid`, e o estrago seria TODA
 * previsao pendente da pessoa virando paga -- contas a pagar que ninguem pagou
 * saindo da tela, com `transaction_id` apontando para a perna de uma parcela de
 * emprestimo. Quem chama GUARDA NO `.length` desta lista.
 */
export function chavesDasPrevisoesDaAntecipacao(params: {
  caso: CasoDoEmprestimo;
  parcelasAntecipadas: { id: string }[];
}): string[] {
  if (params.caso !== "auto") return [];
  return params.parcelasAntecipadas.map((p) => chaveDaParcelaDoMyBank(p.id));
}

/**
 * O que a baixa de uma previsao grava nela -- `paid`, a data e o elo da perna.
 *
 * `transaction_id` APONTA PARA A PERNA DE SAIDA, e nao para a de entrada. E o
 * oposto de `patchDaBaixaDaParcela` (que aponta para a entrada), e as duas
 * estao certas: a previsao responde "de onde saiu o dinheiro desta conta a
 * pagar" e a parcela responde "onde ele entrou". O elo da previsao e tambem o
 * que faz o estorno funcionar -- o DELETE da rota da baixa acha a contraparte
 * por `counterpart_transaction_id = conta.transaction_id`, e esse elo mora na
 * perna de ENTRADA apontando para a de SAIDA.
 *
 * E ESTA FUNCAO E O QUE DISTINGUE BAIXAR DE APAGAR em uma linha de codigo. O
 * mutante que a troca por um DELETE e o da issue: a parcela fica paga, o
 * dinheiro saiu da conta, e a previsao que comprova isso desaparece.
 */
export interface BaixaDaPrevisao {
  status: "paid";
  paid_date: string;
  transaction_id: string;
}

export function patchDaBaixaDaPrevisao(params: {
  paidDate: string;
  pernaDeSaidaId: string;
}): BaixaDaPrevisao {
  return {
    status: "paid",
    paid_date: params.paidDate,
    transaction_id: params.pernaDeSaidaId,
  };
}

/**
 * A previsao do Caso A, como a antecipacao precisa dela para mover o dinheiro.
 *
 * `amount` ENTRA, E NAO E ELE QUE MANDA. A previsao e EDITAVEL em Contas a Pagar
 * -- a pessoa pode ter mudado o valor dela a mao --, e a divida e a PARCELA.
 * Quem chama passa o valor da parcela por `valorPago`; este campo existe para
 * que a linha a baixar chegue inteira, e nao para ser a fonte do dinheiro.
 */
export interface PrevisaoABaixar {
  id: string;
  account_id: string;
  destination_account_id: string | null;
  description: string;
  amount: number;
  category_id: string | null;
  due_date: string;
  notes: string | null;
  created_at?: string | null;
}

/** Uma parcela da cauda ao lado da previsao que a paga. */
export interface ParDaAntecipacaoDoCasoA<P> {
  parcela: P;
  previsao: PrevisaoABaixar;
}

/**
 * Casa cada parcela da cauda com a previsao dela, PELO ELO -- e diz quais
 * ficaram sem.
 *
 * A ORDEM DA SAIDA E A DA CAUDA, e nao a que o banco devolveu
 * ----------------------------------------------------------
 * Os pares saem na ordem de `escolhidas` (`due_date DESC`), porque e nessa
 * ordem que a rota move o dinheiro e e nessa ordem que a resposta lista os
 * numeros. Deixar a ordem do `SELECT ... IN (...)` mandar aqui faria "parei na
 * segunda parcela" querer dizer uma parcela diferente a cada chamada, e o
 * rollback de uma antecipacao parcial deixaria de ser reproduzivel.
 *
 * `parcelasSemPrevisao` SAI SEPARADO EM VEZ DE A FUNCAO DEVOLVER `null`
 * --------------------------------------------------------------------
 * Quem chama precisa dos NUMEROS para a frase ("a parcela 6 nao tem conta a
 * pagar"), e um `null` obrigaria a rota a redescobri-los -- uma segunda copia
 * do mesmo criterio de casamento, que e onde as duas divergem na primeira
 * mudanca. A rota recusa quando a lista nao esta vazia; a decisao de recusar e
 * dela, porque e ela que sabe que nada foi escrito ainda.
 *
 * MAIS DE UMA PREVISAO PARA A MESMA CHAVE: A PRIMEIRA, E A ORDEM NAO IMPORTA
 * -------------------------------------------------------------------------
 * `notes` e campo que a pessoa digita, entao duas linhas com `mybank:<id>` sao
 * possiveis. Nenhum criterio aqui as desempata com honestidade (as duas se
 * dizem a conta a pagar da mesma parcela), e por isso esta funcao pega UMA e a
 * outra fica onde esta -- em aberto, visivel, para quem souber o que ela e.
 * Baixar as duas moveria o dobro do dinheiro da parcela.
 */
export function paresDaAntecipacaoDoCasoA<
  P extends { id: string; installment_number: number },
>(params: {
  escolhidas: P[];
  previsoes: PrevisaoABaixar[];
}): {
  pares: ParDaAntecipacaoDoCasoA<P>[];
  parcelasSemPrevisao: number[];
} {
  const pares: ParDaAntecipacaoDoCasoA<P>[] = [];
  const parcelasSemPrevisao: number[] = [];

  for (const parcela of params.escolhidas) {
    const chave = chaveDaParcelaDoMyBank(parcela.id);
    const previsao = params.previsoes.find((p) => p.notes === chave);

    if (previsao) {
      pares.push({ parcela, previsao });
    } else {
      parcelasSemPrevisao.push(parcela.installment_number);
    }
  }

  return { pares, parcelasSemPrevisao };
}

/**
 * A recusa de "nao achei a conta a pagar desta parcela", com os numeros.
 *
 * A frase diz as DUAS coisas que a pessoa precisa para agir: quais parcelas, e
 * que nada foi antecipado. Sem a segunda, quem pedisse 3 e lesse a recusa nao
 * saberia se as outras 2 entraram -- e tentaria de novo sobre um estado que
 * nao conhece.
 */
export function mensagemDaPrevisaoDaCaudaAusente(numeros: number[]): string {
  const quais = numeros.join(", ");
  // A CONTRACAO VEM NO PROPRIO RAMO, e nao um `de ${plural}` com "a parcela"
  // dentro: a medicao em producao leu "de a parcela 2" na frase. Juntar a
  // preposicao com o artigo e o tipo de coisa que passa por toda assercao de
  // `match` (o trecho "a parcela 2" casa dentro de "de a parcela 2") e aparece
  // inteira na tela.
  const quem =
    numeros.length === 1 ? `da parcela ${quais}` : `das parcelas ${quais}`;

  return (
    `Não encontrei em Contas a Pagar a transferência agendada ${quem} ` +
    "deste empréstimo para você mesmo. É dela que sai a conta de onde o dinheiro é debitado, " +
    "então nada foi antecipado — confira se a conta a pagar foi excluída à mão."
  );
}

/**
 * `AAAA-MM-DD` -> `MM/AAAA`, por fatia de string.
 *
 * NUNCA `new Date(iso).getMonth()`: o construtor le `AAAA-MM-DD` como meia-noite
 * UTC, e no fuso de Sao Paulo o dia 1 volta para o mes anterior -- a frase diria
 * "07/2028" de uma parcela de agosto, e o erro passa verde em CI que roda em UTC
 * (`teste-de-data-passa-em-utc-e-nao-ve-o-bug`).
 *
 * `lib/mybank-na-tela.ts` tem a mesma funcao, privada, e as duas ficam. Este
 * modulo nao importa nada alem de `lancamento` e `transferencia` de proposito --
 * e isso que o deixa compilar na suite sem o runtime do Next --, e importar um
 * modulo de tela por quatro linhas amarraria os dois (a mesma razao pela qual
 * `STATUS_EM_ABERTO_DA_PARCELA` convive com o `STATUS_EM_ABERTO` de lá).
 */
function mesDoVencimentoDaParcela(iso: string): string {
  const [ano, mes] = String(iso).split("-");
  return `${mes}/${ano}`;
}

/**
 * O ultimo vencimento de um conjunto de parcelas, em `MM/AAAA`. `null` em lista
 * vazia -- que e o caso "nao sobrou nada em aberto".
 *
 * ORDENA SOBRE O ISO CRU: `MM/AAAA` nao ordena lexicograficamente ("01/2028"
 * vem antes de "09/2026"), entao o rotulo sai DEPOIS da ordenacao. A mesma
 * armadilha que `escopoDoBlocoDoDevedor` documenta.
 */
export function ultimoVencimentoEmAberto(
  parcelas: { due_date: string; status: string }[]
): string | null {
  const isos = parcelas
    .filter((p) => STATUS_EM_ABERTO_DA_PARCELA.includes(p.status))
    .map((p) => String(p.due_date))
    .sort();

  if (isos.length === 0) return null;

  return mesDoVencimentoDaParcela(isos[isos.length - 1]);
}

/**
 * O que mudou -- e a TERCEIRA frase e a que impede a leitura errada.
 *
 * Tres coisas, e as tres sao necessarias:
 *
 *   1. QUANTAS PARCELAS SAIRAM, e quais numeros. "2 parcelas antecipadas" sem os
 *      numeros deixa quem olha a lista procurando quais sumiram;
 *   2. QUAL ERA E QUAL PASSOU A SER O ULTIMO VENCIMENTO. E a unica frase que diz
 *      "a serie encurtou" com um numero -- e e o que distingue este desenho de
 *      um que so tivesse recebido dinheiro adiantado;
 *   3. QUE O VALOR DE QUEM SOBRA NAO MUDOU. Sem ela a leitura natural de "duas
 *      parcelas menos" e "baixaram minha prestacao", e a pessoa passa a esperar
 *      um debito menor no mes que vem. Nenhum `amount` e tocado por esta
 *      feature, e isso tem de estar dito onde se le.
 *
 * QUANDO O EMPRESTIMO QUITA, A TERCEIRA FRASE SAI -- e nao e economia de texto:
 * "as que sobram mantem o valor" sobre zero parcelas e uma afirmacao sobre um
 * conjunto vazio, e quem acabou de quitar a divida leria uma promessa sobre
 * cobranca futura que nao existe. No lugar dela entra o que de fato aconteceu: o
 * emprestimo esta quitado e sai da lista.
 *
 * `quitado` ENTRA SEPARADO DE `ultimoVencimentoDepois`, E ISSO E UMA CORRECAO
 * --------------------------------------------------------------------------
 * A tentacao e deduzir a quitacao de `ultimoVencimentoDepois === null` -- "nao
 * sobrou vencimento, entao acabou". Os dois NAO sao a mesma coisa, e o estado em
 * que divergem e alcancavel: quando nao sobra parcela em aberto mas o UPDATE de
 * `settled` e filtrado pela policy (200 com `[]`, sem erro), o emprestimo
 * continua `active`. Com a deducao, a frase anunciaria "quitado e sai da lista A
 * receber" de um emprestimo que as duas telas continuam mostrando -- a resposta
 * dizendo o que DEVERIA ter ficado em vez do que ficou, que e exatamente o que a
 * HMO-394 escolheu nao fazer.
 *
 * Por isso ha QUATRO ramos, e os dois ultimos sao dois estados que a frase nao
 * pode confundir: "nada em aberto e status intacto" e "eu NAO SEI o que sobrou".
 *
 * `serieRelida: false` E O RAMO DO "NAO SEI", E ELE NAO E DEFENSIVO
 * ----------------------------------------------------------------
 * A releitura da serie e uma consulta, e consulta falha. Com ela falhando,
 * `ultimoVencimentoDepois` chega `null` -- indistinguivel de "nao sobrou nada".
 * Sem este ramo a frase afirmaria que a divida acabou porque a rota nao
 * conseguiu PERGUNTAR se ela acabou, que e a pior das tres respostas possiveis:
 * o dinheiro entrou de verdade e a pessoa acharia que quitou. Aqui ela diz o que
 * aconteceu (as parcelas antecipadas) e manda conferir o resto.
 *
 * A FRASE DO CASO A E A QUARTA, E ELA E SOBRE A OUTRA TELA (HMO-396)
 * -----------------------------------------------------------------
 * No auto-emprestimo a antecipacao muda uma tela que NAO esta na frente de quem
 * clicou: as contas a pagar daquelas parcelas sairam de "a pagar" e viraram
 * "pagas". Sem dizer isso, quem for conferir encontra duas linhas pagas que nao
 * pagou pela tela de Contas a Pagar e nao tem como saber de onde elas vieram --
 * ou, pior, procura as linhas no lugar de sempre e conclui que foram apagadas.
 * A frase diz tambem DE ONDE o dinheiro saiu, porque no Caso A e a conta
 * corrente da propria pessoa que foi debitada (no Caso B nada sai de conta
 * minha, e por isso a frase nao existe lá).
 */
export function mensagemDaAntecipacao(params: {
  numerosAntecipados: number[];
  ultimoVencimentoAntes: string;
  /** `null` quando nao sobrou parcela em aberto. Irrelevante se `serieRelida` e `false`. */
  ultimoVencimentoDepois: string | null;
  /** O emprestimo se declarou `settled` DE VERDADE (o UPDATE alcancou a linha). */
  quitado: boolean;
  /** A releitura da serie respondeu? `false` quando a consulta falhou. */
  serieRelida: boolean;
  /** `"auto"` acrescenta a frase das contas a pagar baixadas. */
  caso?: CasoDoEmprestimo;
}): string {
  const quantas = params.numerosAntecipados.length;

  const quais = params.numerosAntecipados.join(" e ");
  const oQueSaiu =
    quantas === 1
      ? `Parcela ${quais} antecipada — a do fim da série.`
      : `${quantas} parcelas antecipadas: as do fim da série (${quais}).`;

  // A frase do Caso A entra na ABERTURA, e nao num dos quatro ramos: ela e
  // verdade nos quatro (o dinheiro saiu da conta corrente e as previsoes foram
  // baixadas tanto na antecipacao que quita quanto na que a releitura perdeu), e
  // repeti-la em cada ramo seria a mesma frase em quatro lugares para divergir
  // no primeiro conserto.
  const abertura =
    params.caso === "auto"
      ? `${oQueSaiu} O dinheiro saiu da sua conta corrente para a de investimento, ` +
        `e ${quantas === 1 ? "a conta a pagar dela foi baixada" : "as contas a pagar delas foram baixadas"} ` +
        "em Contas a Pagar — não removidas."
      : oQueSaiu;

  if (params.quitado) {
    return `${abertura} Não sobrou nada em aberto: o empréstimo está quitado e sai da lista A receber.`;
  }

  if (!params.serieRelida) {
    return (
      `${abertura} O dinheiro entrou, mas não consegui reler as parcelas que sobraram: ` +
      "confira a lista A receber."
    );
  }

  if (params.ultimoVencimentoDepois === null) {
    return (
      `${abertura} Não sobrou parcela em aberto, mas o empréstimo continua em atividade: ` +
      "confira a lista A receber."
    );
  }

  return (
    `${abertura} O último vencimento era ${params.ultimoVencimentoAntes} e passou a ser ` +
    `${params.ultimoVencimentoDepois}. As parcelas que sobram mantêm o valor de sempre — ` +
    "antecipar encurta a série, não baixa a prestação."
  );
}

// ---------------------------------------------------------------------------
// O GESTO NA TELA (F4 da HMO-393, issue HMO-397)
// ---------------------------------------------------------------------------
// A F2 deu a frase do DEPOIS (`mensagemDaAntecipacao`). O que falta e a frase do
// ANTES: o dialogo tem de dizer as tres coisas com NUMERO antes de a pessoa
// apertar, porque depois do clique o dinheiro ja saiu da conta de quem paga e
// nao existe "desantecipar" (secao 6 do plano).
//
// POR QUE O TEXTO VIVE AQUI E NAO NO JSX
// --------------------------------------
// E a mesma razao que `avisoDoCancelamento` ja da: escrito dentro do componente
// ele passaria por QUALQUER suite intacto -- `tsc`, `lint` e `build` nao tem
// opiniao sobre uma frase, e a sonda de navegador le o que a tela mostrar sem
// saber o que ela deveria mostrar. Aqui a frase e uma assercao de uma linha, e o
// mutante que apaga a terceira parte dela morre em `test:emprestimo-do-mybank`.
//
// O VALOR CHEGA FORMATADO, E ISSO E DE PROPOSITO
// ---------------------------------------------
// `valorFormatado` e uma string e nao um numero porque este modulo NAO IMPORTA
// `lib/utils` nem `lib/dinheiro` (ver o cabecalho do arquivo: e isso que o deixa
// compilar na suite sem o runtime do Next), e porque reescrever a formatacao de
// real aqui seria o segundo formatador de dinheiro do app -- com o primeiro
// separando o `R$` com NBSP (`intl-pt-br-separa-o-real-com-nbsp`) e este com
// espaco comum. Quem chama passa `formatCurrency(valorDaAntecipacao(...))`: a
// SOMA e desta lib, a MASCARA e de quem ja a tem.
// ---------------------------------------------------------------------------

/**
 * A PREVIA DO DIALOGO -- as tres coisas, antes do clique.
 *
 * AS TRES, E A TERCEIRA E A QUE IMPEDE A LEITURA ERRADA
 * ----------------------------------------------------
 *   1. QUANTO CUSTA AGORA, em reais, com os numeros das parcelas. Sem o valor a
 *      pessoa escolhe "quantas" sem saber quanto sai da conta -- e o gesto nao
 *      tem campo de valor de proposito (decisao (a) da secao 4 do plano), entao
 *      este e o unico lugar onde o total aparece ANTES;
 *   2. QUAL PASSA A SER O ULTIMO VENCIMENTO. E a unica frase que diz "a serie
 *      encurta" com um numero, e e o que distingue este desenho de um que so
 *      recebesse dinheiro adiantado;
 *   3. QUE O VALOR DE QUEM SOBRA NAO MUDA. A leitura natural de "duas parcelas
 *      menos" e "baixaram minha prestacao", e quem acredita nisso passa a
 *      esperar um debito menor no mes que vem. Nenhum `amount` e tocado por esta
 *      feature -- e a variante que BAIXARIA a prestacao foi REJEITADA no cartao
 *      `ae436b4a`, entao a frase nao esta descrevendo uma escolha de
 *      implementacao: ela esta dizendo qual das duas features existe.
 *
 * QUANDO A ANTECIPACAO QUITA, A TERCEIRA SAI -- pela mesma razao de
 * `mensagemDaAntecipacao`: "as que sobram mantem o valor" sobre zero parcelas e
 * uma promessa de cobranca futura que nao existe. No lugar dela entra o que vai
 * acontecer (o emprestimo quita e sai da lista A receber).
 *
 * `ultimoVencimentoDepois === null` E "QUITA" AQUI, E ISSO NAO E O BUG DE
 * `mensagemDaAntecipacao`
 * ----------------------------------------------------------------------
 * Lá os dois estados divergem porque o UPDATE de `settled` pode ter sido
 * filtrado pela policy -- e a frase do DEPOIS nao pode anunciar um estado que o
 * banco nao tem. Aqui nada foi escrito ainda: a previa fala do que a serie em
 * maos diz, e "nao sobra parcela em aberto" e exatamente a condicao de
 * `emprestimoFicouQuitado`. Nao ha terceiro estado para confundir.
 */
export function previaDaAntecipacao(params: {
  /** Os numeros das parcelas da cauda que vao ser pagas, na ordem da serie. */
  numeros: number[];
  /** `formatCurrency(valorDaAntecipacao(...))` -- ver O VALOR CHEGA FORMATADO. */
  valorFormatado: string;
  ultimoVencimentoAntes: string | null;
  /** `null` quando nao sobra parcela em aberto: a antecipacao QUITA. */
  ultimoVencimentoDepois: string | null;
  /** `"auto"` acrescenta de onde o dinheiro sai e o que muda em Contas a Pagar. */
  caso?: CasoDoEmprestimo;
}): string {
  const quantas = params.numeros.length;
  const quais = params.numeros.join(" e ");

  const oQueSai =
    quantas === 1
      ? `Antecipar 1 parcela (a ${quais}, a do fim da série) custa ${params.valorFormatado} agora.`
      : `Antecipar ${quantas} parcelas (as ${quais}, as do fim da série) custa ${params.valorFormatado} agora.`;

  // A FRASE DO CASO A entra na abertura, como em `mensagemDaAntecipacao`: ela e
  // verdade nos dois ramos abaixo, e no Caso A e a conta corrente da propria
  // pessoa que sera debitada -- quem aperta sem ler isso descobre o debito pelo
  // extrato.
  //
  // O NOME E `comecoDaPrevia` E NAO `abertura`, E ISSO NAO E ESTILO
  // --------------------------------------------------------------
  // `mensagemDaAntecipacao` tem, 60 linhas acima, um `const abertura =` seguido
  // do MESMO `params.caso === "auto"` -- e aquele trecho e a ancora de um
  // mutante da F2 ("a frase do CASO A nao diz que as contas a pagar foram
  // BAIXADAS"). Com o mesmo nome aqui, o trecho passa a aparecer DUAS vezes no
  // arquivo e o runner da F2 para com ANCORA AMBIGUA -- e o mutante dela
  // deixaria de ser medido por causa de uma funcao nova que so copiou um
  // critério (`funcao-nova-que-copia-criterio-torna-ancora-alheia-ambigua`).
  const comecoDaPrevia =
    params.caso === "auto"
      ? `${oQueSai} O dinheiro sai da sua conta corrente para a de investimento, ` +
        `e ${quantas === 1 ? "a conta a pagar dela" : "as contas a pagar delas"} ` +
        "é baixada em Contas a Pagar — não removida."
      : oQueSai;

  if (params.ultimoVencimentoDepois === null) {
    return (
      `${comecoDaPrevia} Não sobra nenhuma parcela em aberto: o empréstimo fica quitado ` +
      "e sai da lista A receber."
    );
  }

  // A FRASE E NO FUTURO, E ELA NAO PODE SER A MESMA STRING DA DO DEPOIS
  // -------------------------------------------------------------------
  // Duas razoes, e a segunda e mecanica. A primeira: aqui nada aconteceu ainda
  // -- "o ultimo vencimento ERA 08/2028" seria falso antes do clique, porque ele
  // continua sendo. A segunda: `mensagemDaAntecipacao` fecha com estas MESMAS
  // duas linhas, e repetir o texto ao pe da letra faria o trecho aparecer duas
  // vezes no arquivo -- a ancora do mutante dela ("a mensagem perde a TERCEIRA
  // frase") viraria AMBIGUA e aquele mutante deixaria de ser medido
  // (`funcao-nova-que-copia-criterio-torna-ancora-alheia-ambigua`, que a guarda
  // `mede-ancora-ambigua` pegou nesta PR).
  //
  // O QUE NAO PODE DIVERGIR E A PROMESSA, e ela nao divergiu: as duas dizem que
  // o valor de quem sobra nao muda e que antecipar encurta a serie. Cada uma tem
  // o proprio mutante e a propria assercao, que e o que impede uma de passar a
  // medir a outra (`unificar-criterio-duplicado-apaga-a-medicao-do-outro-modulo`).
  return (
    `${comecoDaPrevia} O último vencimento é ${params.ultimoVencimentoAntes} e passa a ser ` +
    `${params.ultimoVencimentoDepois}. As parcelas que sobram continuam com o valor de sempre: ` +
    "antecipar encurta a série e não baixa a prestação."
  );
}

/**
 * ESTA PARCELA FOI ANTECIPADA? `paid_date < due_date`, e SEM COLUNA NOVA.
 *
 * A FORMA E A DA HMO-366: ESTADO DERIVAVEL, NAO COLUNA
 * ---------------------------------------------------
 * Uma coluna `antecipada` seria uma segunda fonte para um fato que as duas que
 * ja existem respondem juntas, e ela divergiria na primeira baixa feita por
 * outro caminho (o `PATCH` da parcela, o passo 2.5 do `pay/route.ts`). O par
 * `(paid_date, due_date)` ja esta gravado em toda parcela paga, e o CHECK
 * `((status='paid') = (paid_date IS NOT NULL))` da 053 e quem garante que ele
 * nao esta vazio.
 *
 * E ELA TEM TRABALHO A FAZER NA TELA, nao e enfeite: com as parcelas 23 e 24
 * antecipadas, a lista do credor mostra `4/24` ao lado de "vence <parcela 3>".
 * Quem le isso nao tem como saber por que quatro estao pagas se a terceira ainda
 * vence -- e a conclusao disponivel ("a contagem esta errada") e justamente a
 * que a secao 0 do plano mediu como CERTA. O rotulo de antecipada e o que
 * explica a diferenca sem mexer em leitura nenhuma.
 *
 * `<` E NAO `<=`, E A DIFERENCA E UM DIA DE TRABALHO DE SUPORTE
 * -----------------------------------------------------------
 * Pagar a parcela NO DIA do vencimento e pagar em dia, nao antecipar. Com `<=`,
 * toda parcela paga pontualmente apareceria rotulada como antecipada -- e o
 * rotulo perderia o sentido justamente onde ele serve (distinguir a parcela da
 * cauda no meio das pendentes).
 *
 * COMPARACAO DE STRING, E ELA E SEGURA PORQUE OS DOIS CAMPOS SAO `date`
 * ---------------------------------------------------------------------
 * Medido na 053 e nao suposto: `due_date date NOT NULL` (`:325`) e `paid_date
 * date` (`:334`). O PostgREST devolve os dois como `AAAA-MM-DD`, que ordena
 * lexicograficamente igual a cronologicamente -- e e por isso que NAO ha corte
 * de string nem `new Date()` aqui. `new Date(iso)` seria o erro conhecido deste
 * repositorio: o construtor le `AAAA-MM-DD` como meia-noite UTC, e no fuso de
 * Sao Paulo o dia 1 volta para o mes anterior
 * (`teste-de-data-passa-em-utc-e-nao-ve-o-bug`).
 *
 * O VAZIO DEVOLVE `false`, e isso e o certo: parcela sem `paid_date` nao foi
 * paga, entao nao foi antecipada. Um `null` lido como `""` e menor que qualquer
 * data -- sem esta guarda, TODA parcela pendente se rotularia como antecipada.
 */
export function parcelaFoiAntecipada(parcela: {
  paid_date?: string | null;
  due_date?: string | null;
}): boolean {
  const pago = String(parcela.paid_date ?? "");
  const vence = String(parcela.due_date ?? "");

  if (pago === "" || vence === "") return false;

  return pago < vence;
}

// ---------------------------------------------------------------------------
// O AJUSTE DO EMPRESTIMO ATIVO -- editar a divida que esta acontecendo
// ---------------------------------------------------------------------------
// F4 da HMO-444 (issue HMO-447). SEM MIGRATION: as colunas sao as da 053,
// `mybank_loans_update` ja e `lender_user_id = auth.uid()` nos dois lados, e
// `mybank_loans_trava` SO re-valida no UPDATE quando `lender_user_id`,
// `lender_account_id` ou `borrower_user_id` mudam -- nenhum dos tres entra no
// patch daqui, entao ajustar funciona mesmo depois de a conexao ser desfeita.
// Do lado da parcela, `mybank_installments_trava_do_devedor` devolve `NEW` sem
// perguntar nada quando quem escreve e o CREDOR (`053:530`), e e so ele que
// chega aqui.
//
// O QUE NAO EXISTIA: NENHUM CAMINHO DE CORRECAO
// ---------------------------------------------
// O `PATCH` de `loans/[id]` so cancelava: qualquer corpo que nao fosse
// `{"status":"cancelled"}` voltava 400, e a defesa contra editar o valor era a
// AUSENCIA do caminho. Isso deixava um typo na descricao de um emprestimo de 24
// meses sem conserto possivel pela tela -- a unica saida era cancelar a divida
// inteira e criar outra, o que apaga o historico das parcelas ja pagas.
//
// AJUSTAR E DO EMPRESTIMO, E NAO DE UMA PARCELA AVULSA
// ---------------------------------------------------
// A issue fala de valor emprestado, total e % de juros -- grandezas DO
// EMPRESTIMO. Entao o gesto e "este emprestimo passa a valer X, a cauda passa a
// vencer a partir de tal dia", e a serie em aberto e recalculada. A parcela
// avulsa sai depois como caso degenerado (uma pendente so); o contrario nao
// vale -- N edicoes de parcela nao somam um total consistente com o principal.
//
// O NUMERO DE PARCELAS NAO MUDA AQUI, E ISSO E DINHEIRO
// ----------------------------------------------------
// Encurtar a serie significaria cancelar a cauda, e cancelar a cauda PERDE
// DINHEIRO (`cancelar-a-cauda-da-serie-perde-dinheiro-pague-a`: o caminho certo
// e antecipar, que e a rota irma). Esticar mexeria no `installment_total` das
// linhas que ja existem -- inclusive das `paid`, cujo rotulo "3/24" ja foi
// mostrado e ja foi gravado na descricao da perna. `installment_number` e
// `installment_total` NAO entram em patch nenhum deste arquivo.
//
// A RECUSA DO `reported`, E POR QUE ELA VEM ANTES DE QUALQUER CAMPO
// ----------------------------------------------------------------
// `reported` e "o devedor avisou que pagou e eu ainda nao confirmei". Mudar o
// valor embaixo de quem acabou de avisar e pior do que nao deixar ajustar: a
// pessoa pagou R$ 1.000 contra uma parcela que, depois do ajuste, diz R$ 1.200
// -- e nada no banco registra qual era o valor quando ela pagou. A recusa vale
// para o pedido INTEIRO, inclusive o que so mexe na descricao: a parcela
// `reported` e um aviso pendente sobre ESTA serie, e a resposta certa e
// confirmar (ou estornar) o aviso primeiro. A frase nomeia quais.
//
// A PARCELA `paid` E INTOCAVEL, E O RECALCULO E SOBRE O QUE FALTA
// --------------------------------------------------------------
// `paid` tem (ou teve) perna em `financial_transactions`: reescrever o `amount`
// dela faria a divida discordar de um lancamento REALIZADO, e a tela do extrato
// continuaria mostrando o valor antigo. Entao o novo total e repartido sobre o
// que FALTA receber -- `novo total - ja pago` --, e a invariante da 053
// (`soma das parcelas = principal`) continua fechando por construcao:
//   ja pago + (novo total - ja pago) = novo total = novo principal.
//
// O RISCO DE DINHEIRO DESTA FASE: A PREVISAO JA BAIXADA DE UMA PARCELA `pending`
// -----------------------------------------------------------------------------
// No Caso A a parcela tem uma transferencia prevista emparelhada pelo elo
// `mybank:<id da parcela>`. Os dois estados podem DIVERGIR -- a previsao pode
// ter sido baixada em Contas a Pagar sem a parcela ter ido a `paid` (a baixa
// falhando no meio, um estorno pela metade). Reescrever o valor dessa parcela
// mexeria num lancamento ja realizado, e o status `pending` DELA nao avisa
// nada. Por isso `previsoesDoAjuste` le a previsao SEM filtrar por status e a
// confere uma por uma: e a previsao que manda, nao a parcela. Esta e a
// diferenca entre esta leitura e as do cancelamento e da antecipacao, que
// filtram `status = 'pending'` no proprio pedido.
// ---------------------------------------------------------------------------

/** O que o corpo do PATCH de ajuste aceita. Todo campo e opcional. */
export interface PedidoDeAjuste {
  descricao?: unknown;
  total?: unknown;
  taxa?: unknown;
  primeiroVencimentoDaCauda?: unknown;
}

/** Por que este ajuste nao serve. */
export type ProblemaDoAjuste =
  | "nao_sou_o_credor"
  | "emprestimo_nao_esta_ativo"
  | "nada_a_ajustar"
  | "descricao_vazia"
  | "total_invalido"
  | "vencimento_invalido"
  | "juros_fora_da_fase_1"
  | "tem_parcela_reportada"
  | "sem_parcela_pendente"
  | "total_menor_que_o_pago"
  | "cauda_impossivel";

/** O que o ajuste precisa saber de uma parcela ja gravada. */
export interface ParcelaParaAjustar {
  id: string;
  installment_number: number;
  installment_total: number;
  amount: number | string;
  due_date: string;
  status: string;
}

/** O estado da parcela em que o devedor avisou e o credor ainda nao confirmou. */
export const STATUS_AVISADO_DA_PARCELA = "reported";

/** O estado da parcela que ainda nao teve aviso nenhum. */
export const STATUS_PENDENTE_DA_PARCELA = "pending";

/** O estado da parcela ja recebida. */
export const STATUS_PAGO_DA_PARCELA = "paid";

/**
 * O campo `AAAA-MM-DD` chegou em forma de data? O MESMO formato da antecipacao.
 *
 * Em forma de funcao e nao de regex solta porque ela e perguntada em dois
 * lugares (a validacao e o recalculo da cauda), e duas copias do padrao
 * divergiriam na primeira mudanca -- uma aceitando o que a outra recusa, que e
 * como uma data invalida chega ao `somaMeses` e volta `null` por um caminho que
 * ninguem esperava.
 */
export function ehDataISO(valor: unknown): valor is string {
  return typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor);
}

/** As parcelas `pending` desta serie, da primeira para a ultima. */
export function pendentesDaSerie<P extends ParcelaParaAjustar>(
  parcelas: P[]
): P[] {
  return parcelas
    .filter((p) => p.status === STATUS_PENDENTE_DA_PARCELA)
    .slice()
    .sort((a, b) => a.installment_number - b.installment_number);
}

/**
 * Os NUMEROS das parcelas em que o devedor avisou que pagou.
 *
 * Numeros e nao ids: quem le a recusa le a tela, e lá a parcela se chama "3/24".
 * O id de uma parcela nao aparece em lugar nenhum da interface.
 */
export function avisadasDaSerie(parcelas: ParcelaParaAjustar[]): number[] {
  return parcelas
    .filter((p) => p.status === STATUS_AVISADO_DA_PARCELA)
    .map((p) => p.installment_number)
    .sort((a, b) => a - b);
}

/**
 * Quanto desta serie JA FOI RECEBIDO -- a base do "sobre o que falta".
 *
 * SO `paid`. `reported` NAO conta, e isso nao e descuido: "a pessoa avisou" nao
 * e "o dinheiro entrou", e e justamente por isso que a serie com `reported`
 * nao ajusta -- se contasse aqui, o ajuste repartiria o que falta como se o
 * aviso fosse pagamento. A recusa e a guarda; esta funcao nao precisa dela.
 *
 * `Number(...)` POR LINHA: `numeric(15,2)` chega do PostgREST como STRING, e
 * `"1000.00" + "1000.00"` seria `"1000.001000.00"` numa soma com `+` cru.
 */
export function jaRecebidoDaSerie(parcelas: ParcelaParaAjustar[]): number {
  const centavos = parcelas
    .filter((p) => p.status === STATUS_PAGO_DA_PARCELA)
    .reduce((soma, p) => soma + Math.round(Number(p.amount) * 100), 0);

  return centavos / 100;
}

/** Uma parcela da cauda recalculada: o novo valor e o novo vencimento dela. */
export interface ParcelaDaCaudaRecalculada {
  id: string;
  numero: number;
  amount: number;
  due_date: string;
}

/**
 * A cauda `pending` recalculada sobre o que FALTA receber -- ou `null`.
 *
 * `null` quando a repartição nao fecha: `serieDeParcelas` recusa valor que nao
 * da parcela positiva, e `mybank_installments_amount_check` e `CHECK (amount >
 * 0)`. Quem chama transforma o `null` em `cauda_impossivel`, com a frase que diz
 * o minimo -- a mesma forma de `problemaDoEmprestimo`, que recebe
 * `serie: SerieDeParcelas | null` e devolve `serie_impossivel`.
 *
 * A ARITMETICA E A IMPORTADA, E A SOBRA CAI NA ULTIMA DA CAUDA
 * -----------------------------------------------------------
 * `serieDeParcelas` reparte em CENTAVOS INTEIROS e joga a sobra da divisao na
 * parcela M (`lib/lancamento.ts`). E e exatamente isso que faz
 * `soma(cauda) = falta receber` ser exata em vez de aproximada -- tres parcelas
 * de R$ 1.000/3 em ponto flutuante somariam R$ 999,99999999999989, e o
 * emprestimo fecharia com um centavo que nenhuma linha explica. Uma segunda
 * aritmetica aqui divergiria daquela na primeira mudanca.
 *
 * O CASO DE UMA PARCELA SO PRECISA DE RAMO PROPRIO, E O PORQUE E DE LA
 * -------------------------------------------------------------------
 * `serieDeParcelas` recusa `m < 2`, porque "1x" nao e um parcelamento -- e a
 * pergunta de lá e outra (quantas parcelas criar). Aqui a cauda de UMA parcela
 * e um estado comum e legitimo: a serie 24x com 23 pagas. A resposta nesse caso
 * nao tem repartição nenhuma a fazer -- o que falta inteiro vai na unica
 * pendente --, e por isso o ramo e duas linhas e nao uma segunda aritmetica.
 *
 * SEM `primeiroVencimentoDaCauda` OS VENCIMENTOS FICAM COMO ESTAO
 * --------------------------------------------------------------
 * Ajustar o valor sem mexer na data e o pedido mais comum (o total estava
 * errado), e recalcular as datas "de graca" moveria 21 vencimentos que ninguem
 * pediu para mover -- no Caso A, 21 contas a pagar mudando de mes. Quem quer
 * mover a cauda manda o campo.
 */
export function caudaRecalculada<P extends ParcelaParaAjustar>(params: {
  pendentes: P[];
  /** Quanto falta receber, em reais. */
  faltaReceber: number;
  /** O novo vencimento da PRIMEIRA pendente, ou `null` para manter as datas. */
  primeiroVencimentoDaCauda: string | null;
}): ParcelaDaCaudaRecalculada[] | null {
  const { pendentes, faltaReceber, primeiroVencimentoDaCauda } = params;

  if (pendentes.length === 0) return null;
  if (!Number.isFinite(faltaReceber) || faltaReceber <= 0) return null;

  if (primeiroVencimentoDaCauda !== null && !ehDataISO(primeiroVencimentoDaCauda)) {
    return null;
  }

  // UMA PENDENTE: o que falta inteiro vai nela. Ver o cabecalho para o porque de
  // `serieDeParcelas` nao alcancar este caso.
  if (pendentes.length === 1) {
    const unica = pendentes[0];
    return [
      {
        id: unica.id,
        numero: unica.installment_number,
        amount: Math.round(faltaReceber * 100) / 100,
        due_date: primeiroVencimentoDaCauda ?? String(unica.due_date),
      },
    ];
  }

  const serie = serieDeParcelas({
    // STRING, porque e isso que a funcao recebe -- e `toFixed(2)` e nao
    // `String(n)`: um `faltaReceber` de 1000.005 viraria "1000.005" e o
    // `Math.round(valor * 100)` de lá arredondaria para 100001 centavos, um
    // centavo que ninguem pediu. Duas casas e o que a coluna `numeric(15,2)`
    // guarda.
    valor: faltaReceber.toFixed(2),
    base: "total",
    // SEMPRE 1..K, E ESTES NUMEROS NAO SAO OS DA SERIE. A cauda de um emprestimo
    // 24x com 3 pagas e "1..21" para a aritmetica e "4..24" para o banco: o
    // emparelhamento e POSICIONAL, e `installment_number` nunca e escrito.
    // Passar `4` como `parcelaAtual` aqui pediria uma serie de 24 e devolveria
    // 21 valores de 1/24 do que falta -- a divida encolheria para um sexto.
    parcelaAtual: 1,
    totalDeParcelas: pendentes.length,
    vencimentoDaParcelaAtual:
      primeiroVencimentoDaCauda ?? String(pendentes[0].due_date),
  });

  if (!serie) return null;
  if (serie.parcelas.length !== pendentes.length) return null;

  const cauda = pendentes.map((parcela, posicao) => ({
    id: parcela.id,
    numero: parcela.installment_number,
    amount: serie.parcelas[posicao].valor,
    // SEM `primeiroVencimentoDaCauda` CADA UMA FICA COM A DATA DELA, e nao com a
    // que `serieDeParcelas` calculou somando meses a partir da primeira: a cauda
    // pode ter vencimentos que nao estao a um mes exato de distancia (um
    // grampeamento de fim de mes, uma parcela que foi editada em Contas a
    // Pagar), e aceitar as datas da serie moveria vencimentos sem pedido.
    due_date:
      primeiroVencimentoDaCauda === null
        ? String(parcela.due_date)
        : serie.parcelas[posicao].vencimento,
  }));

  // O CHECK DA 053 PERGUNTADO AQUI: `amount > 0`. `serieDeParcelas` ja recusa
  // parcela nao-positiva no valor COMUM, e nao na ULTIMA -- a sobra da divisao
  // (`totalEmCentavos - parcelaEmCentavos * (m - 1)`) pode sair zero ou negativa
  // quando o que falta e pequeno para o tamanho da cauda (R$ 0,02 em 3
  // parcelas: 1, 1, e 0). Sem esta pergunta a ultima parcela derrubaria o
  // UPDATE dela em 23514 com as outras duas JA GRAVADAS.
  if (cauda.some((p) => !(p.amount > 0))) return null;

  return cauda;
}

/** O ajuste decidido: o que muda no emprestimo e o que muda em cada parcela. */
export interface AjusteDoEmprestimo {
  /** O patch de `mybank_loans`, ou `null` quando nada da linha muda. */
  patchDoEmprestimo: { description?: string; principal?: number } | null;
  /**
   * Uma entrada por parcela `pending` que muda. As `paid` NUNCA entram, e as
   * `reported` nao chegam aqui (a recusa vem antes).
   */
  parcelas: {
    id: string;
    numero: number;
    /**
     * O patch de `mybank_installments` -- SO o que mudou de verdade. Nunca tem
     * `installment_*`, `status`, `paid_date` nem `paid_transaction_id`.
     *
     * Pode vir VAZIO: e a parcela cujo valor e vencimento nao mudaram e que esta
     * na lista so porque a DESCRICAO mudou. Quem chama pula o UPDATE dela (um
     * `update({})` no PostgREST e 400, e nao um no-op) e ajusta so a cobranca.
     */
    patch: { amount?: number; due_date?: string };
    /**
     * O ESTADO INTEIRO que a previsao do Caso A passa a ter -- os tres campos,
     * sempre preenchidos.
     *
     * ESTADO E NAO PATCH, E A DIFERENCA E DINHEIRO. A previsao e EDITAVEL em
     * Contas a Pagar: nada impede que o `amount` dela ja esteja diferente do da
     * parcela antes deste pedido. Se a cobranca saisse do `patch` acima (que so
     * tem o que mudou), a parcela que entrou na lista so pela descricao deixaria
     * a previsao com o valor divergente que ela ja tinha -- a cobranca
     * perpetuando uma divergencia que o ajuste tinha tudo para fechar. Os tres
     * campos saem da PARCELA ajustada, que e a divida.
     */
    cobranca: AjusteDaPrevisao;
  }[];
  /** Quanto ja foi recebido, em reais. */
  jaRecebido: number;
  /** O total depois do ajuste, em reais -- o novo `principal`. */
  total: number;
}

/**
 * A descricao do emprestimo DEPOIS do ajuste -- a nova, ou a que ja estava.
 *
 * Em funcao propria porque ela e perguntada em dois lugares (o patch do
 * emprestimo e a descricao de cada previsao do Caso A), e as duas tem de dar a
 * MESMA resposta: um `pedido.descricao ?? emprestimo.description` repetido nos
 * dois seria a copia que diverge quando o `trim()` entrar em um so, e o sintoma
 * seria a previsao de Contas a Pagar com um espaco que o emprestimo nao tem.
 */
export function descricaoDepoisDoAjuste(params: {
  descricaoAtual: string;
  pedida: unknown;
}): string {
  return typeof params.pedida === "string" && params.pedida.trim()
    ? params.pedida.trim()
    : String(params.descricaoAtual ?? "").trim();
}

/**
 * O ajuste pode acontecer? `null` quando pode, ou o motivo.
 *
 * A ORDEM E A RESPOSTA, E A PRIMEIRA PERGUNTA E A MESMA DAS OUTRAS DUAS ROTAS
 * --------------------------------------------------------------------------
 * `mybank_loans_select` e `lender OR borrower`: o DEVEDOR enxerga a linha e
 * chega aqui com um emprestimo legivel. Perguntar pelo estado antes diria "esse
 * emprestimo nao esta ativo" a quem nao manda nele -- vazando o estado da
 * divida de outra pessoa numa mensagem de erro. Primeiro "isto nao e seu".
 *
 * `tem_parcela_reportada` VEM ANTES DOS CAMPOS, E NAO DEPOIS
 * ---------------------------------------------------------
 * A recusa do aviso pendente e sobre a SERIE, e ela vale para o pedido inteiro
 * -- inclusive para o que so corrige um typo. Deixa-la para depois da validacao
 * dos campos faria "descricao vazia" ganhar de "tem uma parcela avisada": a
 * pessoa consertaria o corpo, mandaria de novo e SO ENTAO descobriria que o
 * pedido nao tinha como passar. A recusa mais cara de resolver vem primeiro.
 *
 * `cauda_impossivel` E A ULTIMA, pela mesma razao de `serie_impossivel` em
 * `problemaDoEmprestimo`: ela e a unica que depende de uma conta ja feita, e
 * dizer "confira o valor" a quem mandou uma data malformada seria apontar para
 * o campo errado.
 */
export function problemaDoAjuste(params: {
  emprestimo: {
    lender_user_id: string;
    status: string;
    interest_rate?: number | string | null;
  };
  meuId: string;
  parcelas: ParcelaParaAjustar[];
  pedido: PedidoDeAjuste;
  /** O que `caudaRecalculada` devolveu, ou `null` -- inclusive quando nao ha o que recalcular. */
  cauda: ParcelaDaCaudaRecalculada[] | null;
}): ProblemaDoAjuste | null {
  const { emprestimo, meuId, parcelas, pedido } = params;

  if (emprestimo.lender_user_id !== meuId) return "nao_sou_o_credor";

  // `settled` e `cancelled` cairiam aqui com a mesma frase, e e o certo: nos
  // dois a divida ja acabou, e ajustar o valor de um emprestimo encerrado
  // reescreveria um fato. A frase diz o status.
  if (emprestimo.status !== STATUS_ATIVO) return "emprestimo_nao_esta_ativo";

  const mexeNaDescricao = pedido.descricao !== undefined;
  const mexeNoTotal = pedido.total !== undefined;
  const mexeNaTaxa = pedido.taxa !== undefined;
  const mexeNoVencimento = pedido.primeiroVencimentoDaCauda !== undefined;

  // CORPO VAZIO E UM PEDIDO SEM RESPOSTA, e nao um 200 que nao fez nada: um
  // `{}` que devolvesse sucesso faria a tela dizer "ajustado" sem ter ajustado,
  // e e o corpo que um cliente com um campo escrito errado manda.
  if (!mexeNaDescricao && !mexeNoTotal && !mexeNaTaxa && !mexeNoVencimento) {
    return "nada_a_ajustar";
  }

  // A DESCRICAO EM BRANCO E RECUSA E NAO "MANTEM A ANTIGA": `{descricao: ""}` e
  // o campo apagado na tela, e gravar a antiga ali faria o formulario mostrar de
  // volta um texto que a pessoa acabou de apagar. `mybank_loans.description` e
  // `NOT NULL` -- quem quer trocar o texto manda o texto novo.
  if (mexeNaDescricao) {
    if (typeof pedido.descricao !== "string" || !pedido.descricao.trim()) {
      return "descricao_vazia";
    }
  }

  // A TRAVA `mybank_loans_interest_rate_fase_1` (053) EM FORMA DE FRASE.
  //
  // `CHECK (interest_rate = 0)` e quem a solta e a migration 062 (HMO-445), que
  // ESTA em `main` -- e isso NAO muda esta recusa, por dois motivos:
  //
  //   1. ESTAR EM `main` NAO E ESTAR COLADA. `deploy-ships-code-not-schema`: o
  //      deploy leva o codigo e nao o schema, e a colagem da 062 em producao nao
  //      foi medida. Aceitar `taxa: 2` antes dela derrubaria o UPDATE em 23514 --
  //      e, pior, SO depois de as parcelas da cauda ja terem sido reescritas,
  //      porque o emprestimo e o ultimo passo da ordem. A propria 062 escreve
  //      esse risco no cabecalho dela.
  //   2. A ARITMETICA DO JURO E DA F3, E NAO DESTA FILHA. Com a trava solta,
  //      `total` passa a ser principal + juros e `principal` deixa de sair do
  //      `total` (ver o patch do emprestimo). Enquanto essa conta nao existir,
  //      aceitar a taxa seria gravar um numero sem ninguem para interpreta-lo.
  //
  // A recusa e a mesma escolha da antecipacao, que prefere recusar a calcular
  // errado. Quem for fazer a F3 muda ESTA linha e a do `principal`, nas duas
  // pontas, e nao uma so.
  //
  // `Number(...)` E NAO `!== 0`: `numeric` chega do PostgREST como STRING
  // ("0.00"), e quem reenvia a taxa que leu mandaria `"0.00"` -- que `!== 0` e
  // verdade. A recusa dispararia em todo emprestimo da fase 1.
  if (mexeNaTaxa && Number(pedido.taxa) !== JUROS_DA_FASE_1) {
    return "juros_fora_da_fase_1";
  }

  if (mexeNoTotal) {
    const total = Number(pedido.total);
    if (!Number.isFinite(total) || total <= 0) return "total_invalido";
  }

  if (mexeNoVencimento && !ehDataISO(pedido.primeiroVencimentoDaCauda)) {
    return "vencimento_invalido";
  }

  if (avisadasDaSerie(parcelas).length > 0) return "tem_parcela_reportada";

  // DAQUI PARA BAIXO O PEDIDO MEXE NA SERIE. A descricao sozinha nao precisa de
  // parcela pendente nenhuma: trocar o texto de um emprestimo cujas 24 parcelas
  // estao todas pagas e um conserto legitimo, e recusa-lo por "nao ha nada em
  // aberto" seria trancar a unica coisa que sobrou para consertar.
  if (!mexeNoTotal && !mexeNoVencimento) return null;

  if (pendentesDaSerie(parcelas).length === 0) return "sem_parcela_pendente";

  if (mexeNoTotal) {
    const total = Number(pedido.total);
    const jaRecebido = jaRecebidoDaSerie(parcelas);

    // `<=` E NAO `<`, E O IGUAL E O CASO QUE IMPORTA. Com `total === jaRecebido`
    // sobra R$ 0,00 para repartir entre as pendentes, e `amount > 0` recusaria
    // cada uma delas. A frase diz quanto ja foi recebido -- sem o numero, "o
    // total e baixo demais" nao diz o que fazer.
    if (total <= jaRecebido) return "total_menor_que_o_pago";
  }

  if (!params.cauda) return "cauda_impossivel";

  return null;
}

/** A frase que a tela mostra para cada recusa de ajuste. */
export function mensagemDoProblemaDoAjuste(
  problema: ProblemaDoAjuste,
  contexto: {
    status: string;
    avisadas: number[];
    jaRecebido: number;
    pendentes: number;
  }
): string {
  switch (problema) {
    case "nao_sou_o_credor":
      return "Só quem emprestou pode ajustar este empréstimo. Fale com quem emprestou.";
    case "emprestimo_nao_esta_ativo":
      return `Este empréstimo está "${contexto.status}" — não há mais nada a ajustar nele.`;
    case "nada_a_ajustar":
      return 'Diga o que ajustar: "descricao", "total" ou "primeiroVencimentoDaCauda".';
    case "descricao_vazia":
      return "Diga para que é o empréstimo — a descrição não pode ficar em branco.";
    case "total_invalido":
      return "O total a receber tem que ser um valor maior que zero.";
    case "vencimento_invalido":
      return "O primeiro vencimento da cauda tem que ser uma data no formato AAAA-MM-DD.";
    case "juros_fora_da_fase_1":
      return "Nesta fase o MyBank só empresta a juro zero — a taxa não pode ser ajustada ainda.";
    case "tem_parcela_reportada":
      // A CONTRACAO VEM NO PROPRIO RAMO, como em
      // `mensagemDaPrevisaoDaCaudaAusente`: a medicao em producao leu "de a
      // parcela 2" quando a frase montava `de ${plural}` com "a parcela" dentro.
      return contexto.avisadas.length === 1
        ? `A parcela ${contexto.avisadas[0]} está marcada como paga pelo devedor e você ainda não confirmou. ` +
            "Confirme (ou desfaça) esse aviso antes de ajustar — mudar o valor agora reescreveria uma parcela que alguém já pagou."
        : `As parcelas ${contexto.avisadas.join(", ")} estão marcadas como pagas pelo devedor e você ainda não confirmou. ` +
            "Confirme (ou desfaça) esses avisos antes de ajustar — mudar o valor agora reescreveria parcelas que alguém já pagou.";
    case "sem_parcela_pendente":
      return "Não há parcela em aberto para recalcular: todas já foram recebidas. Só a descrição pode ser ajustada.";
    case "total_menor_que_o_pago":
      return (
        `Já foram recebidos ${emReais(contexto.jaRecebido)} deste empréstimo, e as parcelas pagas não são reescritas. ` +
        `O novo total tem que ser maior que isso.`
      );
    case "cauda_impossivel":
      return (
        `O que sobra para as ${contexto.pendentes} parcela(s) em aberto não dá um valor positivo para cada uma. ` +
        "Confira o total e o primeiro vencimento."
      );
  }
}

/**
 * "R$ 1.000,00" -- o valor na frase da recusa.
 *
 * LOCAL E NAO `lib/dinheiro.ts`, e o motivo esta no cabecalho deste arquivo:
 * `test:emprestimo-do-mybank` compila este modulo com `lib/lancamento.ts` e
 * `lib/transferencia.ts` por arrasto, e os dois sao puros. Um import de
 * `lib/dinheiro.ts` (que importa o resto do app) derrubaria a suite.
 *
 * `Intl` NAO E USADO DE PROPOSITO: `toLocaleString("pt-BR")` separa o "R$" do
 * numero com um ESPACO QUE NAO QUEBRA (U+00A0), e toda assercao de `includes`
 * sobre a frase passa a depender de um byte invisivel
 * (`intl-pt-br-separa-o-real-com-nbsp`).
 */
function emReais(valor: number): string {
  const centavos = Math.round(Math.abs(valor) * 100);
  const inteiros = String(Math.floor(centavos / 100)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    "."
  );
  return `R$ ${inteiros},${String(centavos % 100).padStart(2, "0")}`;
}

/**
 * O QUE MUDA EM QUE. Esta e a funcao que a issue manda separar da escrita.
 *
 * TOTAL -- ela nao recusa nada. `problemaDoAjuste` roda antes e e quem decide se
 * o pedido serve; aqui so se monta o patch. Juntar as duas faria a rota ter de
 * distinguir "nao serve" de "nao ha nada a mudar" pelo mesmo `null`.
 *
 * A PRESENCA DO CAMPO MANDA, E NAO A DIFERENCA
 * -------------------------------------------
 * `{descricao: "Moto"}` grava "Moto" mesmo que a descricao ja seja "Moto", e
 * reescreve a descricao das previsoes do Caso A junto. Isso e deliberado: a
 * previsao e EDITAVEL em Contas a Pagar, e a pessoa pode ter mudado o texto dela
 * a mao -- "mandar o valor que eu quero que fique" e o unico contrato em que
 * reenviar o mesmo pedido CONSERTA a divergencia em vez de virar um no-op.
 *
 * O MUTANTE QUE ESTA FUNCAO EXISTE PARA MATAR
 * ------------------------------------------
 * `pendentesDaSerie` trocado por `parcelas` -- o ajuste reescrevendo TODAS as
 * parcelas em vez de so as em aberto. Ele nao da erro em lugar nenhum: a RLS
 * aceita (o credor manda na parcela dele), a trigger do devedor passa direto, o
 * CHECK de `amount > 0` passa. O que acontece e que a parcela `paid` de R$ 1.000
 * passa a dizer R$ 1.200 e a perna de R$ 1.000 que a pagou continua no extrato
 * -- a divida discordando de um lancamento REALIZADO, sem nenhum sintoma.
 */
export function ajusteDoEmprestimo(params: {
  emprestimo: { description: string; principal: number | string };
  parcelas: ParcelaParaAjustar[];
  pedido: PedidoDeAjuste;
  /** O que `caudaRecalculada` devolveu -- `null` quando o pedido nao mexe na serie. */
  cauda: ParcelaDaCaudaRecalculada[] | null;
}): AjusteDoEmprestimo {
  const { emprestimo, parcelas, pedido, cauda } = params;

  const descricao = descricaoDepoisDoAjuste({
    descricaoAtual: emprestimo.description,
    pedida: pedido.descricao,
  });

  const jaRecebido = jaRecebidoDaSerie(parcelas);
  const total =
    pedido.total !== undefined
      ? Math.round(Number(pedido.total) * 100) / 100
      : Math.round(Number(emprestimo.principal) * 100) / 100;

  const patchDoEmprestimo: { description?: string; principal?: number } = {};

  if (pedido.descricao !== undefined) {
    patchDoEmprestimo.description = descricao;
  }

  // `principal` E `total` SAO A MESMA COISA ENQUANTO A FASE 1 DURAR, e esta e a
  // linha que muda quando ela acabar. A juro zero o que se empresta e o que se
  // recebe; com a 062 colada e a F3 de pe, `total` passa a ser principal + juros
  // e `principal` deixa de sair daqui -- e `juros_fora_da_fase_1` e a recusa que
  // garante que ninguem chegue neste ponto com taxa diferente de zero.
  if (pedido.total !== undefined) {
    patchDoEmprestimo.principal = total;
  }

  // `installment_count` NAO ENTRA NO PATCH. Ver O NUMERO DE PARCELAS NAO MUDA
  // AQUI, no cabecalho desta secao: cortar a cauda perde dinheiro e esticar
  // reescreve o `installment_total` das linhas que ja existem.

  const porId = new Map(
    pendentesDaSerie(parcelas).map((p) => [p.id, p])
  );

  const linhas: AjusteDoEmprestimo["parcelas"] = [];

  for (const nova of cauda ?? []) {
    // SO AS `pending`, E O FILTRO E AQUI E NAO NO CHAMADOR. `caudaRecalculada`
    // recebe as pendentes, entao esta pergunta e redundante HOJE -- e ela e a
    // que continua certa se um dia a cauda vier de outro lugar. O id que nao
    // esta no mapa simplesmente nao entra: escrever numa parcela `paid` e o
    // defeito que esta secao inteira existe para impedir.
    const atual = porId.get(nova.id);
    if (!atual) continue;

    const patch: { amount?: number; due_date?: string } = {};

    // O PATCH DA PARCELA SO LEVA O QUE MUDOU DE VERDADE -- e ele pode sair
    // VAZIO. Um `update({})` no PostgREST e 400 (`PGRST102`) e nao um no-op,
    // entao quem chama pula o UPDATE da parcela de patch vazio.
    if (Math.round(Number(atual.amount) * 100) !== Math.round(nova.amount * 100)) {
      patch.amount = nova.amount;
    }

    if (String(atual.due_date) !== nova.due_date) {
      patch.due_date = nova.due_date;
    }

    // TODA PENDENTE ENTRA NA LISTA, INCLUSIVE A DE PATCH VAZIO
    // -------------------------------------------------------
    // A tentacao e `if (Object.keys(patch).length === 0) continue` -- 21
    // escritas de previsao economizadas num pedido que so mexeu na primeira
    // parcela. E ela esta ERRADA, por duas razoes que so aparecem juntas:
    //
    //   1. A PREVISAO PODE ESTAR FORA DE SINCRONIA SOZINHA. Ela e editavel em
    //      Contas a Pagar, e esta funcao nao a VE: decidir pelo diff da PARCELA
    //      se a COBRANCA e reescrita faz a divergencia entre as duas ficar
    //      congelada para sempre -- nenhum pedido futuro a alcanca, porque a
    //      parcela ja esta no valor pedido.
    //   2. A PASSAGEM QUE PAROU NO MEIO DEIXA EXATAMENTE ESSE ESTADO. A parcela
    //      2 foi reescrita e a previsao dela nao; repetir o MESMO pedido e o que
    //      termina o servico (ver A ORDEM DO AJUSTE no cabecalho da rota), e com
    //      o `continue` a segunda passagem pularia justamente a linha que
    //      faltou. O contrato "mande o estado que voce quer" deixaria de
    //      convergir -- e a unica saida seria editar a conta a pagar a mao.
    //
    // O custo e N escritas de previsao no Caso A, com N <= 60 pelo alcance de
    // `serieDeParcelas`, e cada uma e idempotente.

    linhas.push({
      id: nova.id,
      numero: nova.numero,
      patch,
      cobranca: patchDaPrevisaoDoAjuste({
        descricao: descricaoDaParcela(
          descricao,
          nova.numero,
          // `installment_total` DA LINHA GRAVADA, e nao `pendentes.length`: o
          // rotulo e "4/24" e nao "1/21". A cauda e um recorte da serie, e o
          // numero total continua sendo o da serie inteira.
          atual.installment_total
        ),
        // DA CAUDA RECALCULADA, E NAO DO `patch`: os dois sao iguais quando o
        // valor mudou, e SO a cauda tem resposta quando ele nao mudou.
        amount: nova.amount,
        dueDate: nova.due_date,
      }),
    });
  }

  return {
    patchDoEmprestimo:
      Object.keys(patchDoEmprestimo).length > 0 ? patchDoEmprestimo : null,
    parcelas: linhas,
    jaRecebido,
    total,
  };
}

/**
 * As chaves `mybank:<id>` das previsoes a ajustar -- `[]` no Caso B.
 *
 * `[]` NO CASO B pela razao de sempre: lá nao existe previsao minha. E A LISTA
 * VAZIA E A MESMA ARMADILHA DO POSTGREST -- `.in("notes", [])` nao filtra nada,
 * a clausula desaparece e a consulta alcanca TODA linha que a RLS entrega. Aqui
 * o verbo e UPDATE de `amount`/`due_date`/`description`, e o estrago seria TODA
 * previsao da pessoa -- a agenda inteira de Contas a Pagar -- virando uma
 * parcela deste emprestimo. Quem chama GUARDA NO `.length` desta lista.
 */
export function chavesDasPrevisoesDoAjuste(params: {
  caso: CasoDoEmprestimo;
  parcelasAjustadas: { id: string }[];
}): string[] {
  if (params.caso !== "auto") return [];
  return params.parcelasAjustadas.map((p) => chaveDaParcelaDoMyBank(p.id));
}

/** Uma previsao do Caso A como o ajuste precisa dela: com o STATUS. */
export interface PrevisaoAAjustar {
  id: string;
  description: string;
  amount: number | string;
  due_date: string;
  notes: string | null;
  /** `pending`, `paid`, `skipped`... -- e e ele que decide se a linha e tocada. */
  status: string;
}

/** Uma parcela a ajustar ao lado da previsao que a cobra. */
export interface ParDoAjusteDoCasoA<P> {
  parcela: P;
  previsao: PrevisaoAAjustar;
}

/**
 * Casa cada parcela a ajustar com a previsao dela, PELO ELO -- e separa as tres
 * respostas possiveis.
 *
 * ESTA FUNCAO E A GUARDA DE DINHEIRO DESTA FILHA
 * ---------------------------------------------
 * `comPrevisaoBaixada` e o caso que a issue nomeia: a parcela ainda esta
 * `pending` e a previsao dela JA FOI BAIXADA. Os dois estados divergem de
 * verdade -- a baixa que falhou depois de gravar as pernas, um estorno pela
 * metade --, e o status `pending` DA PARCELA nao avisa nada. Reescrever o
 * `amount` dela mexeria num lancamento REALIZADO: as duas pernas de R$ 1.000 no
 * extrato e a parcela dizendo R$ 1.200, sem nada no caminho reclamando. Quem
 * chama RECUSA o pedido inteiro quando esta lista nao esta vazia -- e por isso a
 * leitura que a alimenta NAO filtra `status = 'pending'`, ao contrario das do
 * cancelamento e da antecipacao. Filtrar lá e o mutante: a previsao baixada
 * sumiria da leitura, a parcela cairia em `semPrevisao`, e o ajuste seguiria.
 *
 * `semPrevisao` NAO E RECUSA, E A DIFERENCA E A DIRECAO DO ESTRAGO
 * ---------------------------------------------------------------
 * Previsao AUSENTE quer dizer que a conta a pagar daquela parcela ja tinha sido
 * apagada a mao ANTES deste pedido -- um estrago que existe com ou sem o
 * ajuste, e que o ajuste nao aumenta. Recusar aqui trancaria o conserto por
 * causa de um dano anterior: a pessoa nao teria como arrumar o valor da divida
 * porque falta uma linha em outra tela. Entao a parcela e ajustada e a resposta
 * DIZ quais previsoes nao foram achadas. E o oposto da antecipacao, que recusa
 * -- e o motivo da diferenca e que lá a CONTA DE ONDE O DINHEIRO SAI mora na
 * previsao, e sem ela nao ha como mover dinheiro nenhum. Aqui nao se move
 * dinheiro: so se reescreve quanto se deve.
 *
 * MAIS DE UMA PREVISAO PARA A MESMA CHAVE: A PRIMEIRA, como em
 * `paresDaAntecipacaoDoCasoA`. `notes` e campo que a pessoa digita, nenhum
 * criterio desempata com honestidade, e ajustar as duas nao e pior nem melhor do
 * que ajustar uma -- mas ser consistente com a outra rota e o que faz as duas
 * serem lidas juntas.
 */
export function previsoesDoAjuste<P extends { id: string; numero: number }>(params: {
  parcelasAjustadas: P[];
  previsoes: PrevisaoAAjustar[];
}): {
  pares: ParDoAjusteDoCasoA<P>[];
  /** Os NUMEROS das parcelas cuja previsao nao esta mais `pending`. */
  comPrevisaoBaixada: number[];
  /** Os NUMEROS das parcelas sem previsao nenhuma no elo. */
  semPrevisao: number[];
} {
  const pares: ParDoAjusteDoCasoA<P>[] = [];
  const comPrevisaoBaixada: number[] = [];
  const semPrevisao: number[] = [];

  for (const parcela of params.parcelasAjustadas) {
    const chave = chaveDaParcelaDoMyBank(parcela.id);
    const previsao = params.previsoes.find((p) => p.notes === chave);

    if (!previsao) {
      semPrevisao.push(parcela.numero);
      continue;
    }

    // `!== 'pending'` E NAO `=== 'paid'`: `skipped` e `cancelled` tambem sao
    // linhas que alguem decidiu sobre, e reescrever o valor de uma previsao
    // pulada a traria de volta a agenda com um valor novo. A pergunta e "esta
    // linha ainda esta em aberto", e so uma resposta e sim.
    if (previsao.status !== STATUS_PENDENTE_DA_PARCELA) {
      comPrevisaoBaixada.push(parcela.numero);
      continue;
    }

    pares.push({ parcela, previsao });
  }

  return { pares, comPrevisaoBaixada, semPrevisao };
}

/** A recusa de "a conta a pagar desta parcela ja foi baixada", com os numeros. */
export function mensagemDaPrevisaoJaBaixada(numeros: number[]): string {
  const quais = numeros.join(", ");
  const uma = numeros.length === 1;

  return (
    (uma
      ? `A conta a pagar da parcela ${quais} já foi baixada em Contas a Pagar, `
      : `As contas a pagar das parcelas ${quais} já foram baixadas em Contas a Pagar, `) +
    (uma
      ? "mas a parcela continua em aberto. "
      : "mas as parcelas continuam em aberto. ") +
    "Nada foi ajustado: mudar o valor agora faria a dívida discordar de um lançamento que já aconteceu. " +
    "Confirme a parcela (ou estorne a baixa) antes de ajustar."
  );
}

/** O que o ajuste grava na previsao do Caso A. */
export interface AjusteDaPrevisao {
  description: string;
  amount: number;
  due_date: string;
}

/**
 * O patch da previsao -- os TRES campos, sempre, e nenhum a mais.
 *
 * `status` E `transaction_id` FORA DO PATCH, e isso e o que impede este caminho
 * de baixar uma conta a pagar sem mover dinheiro. O mutante que acrescenta
 * `status: "paid"` aqui e o da secao: a previsao sairia de Contas a Pagar, a
 * parcela continuaria `pending`, e nenhuma perna teria sido gravada -- a pessoa
 * deixaria de ser cobrada por uma divida que ela ainda deve.
 *
 * OS TRES JUNTOS E NAO SO O QUE MUDOU: a previsao e a COBRANCA de uma parcela, e
 * os tres campos dela saem todos da parcela ajustada. Mandar so o `amount`
 * deixaria a descricao "Motoo (3/24)" numa cobranca cujo valor acabou de mudar,
 * e seria a tela mostrando metade do ajuste.
 */
export function patchDaPrevisaoDoAjuste(params: {
  descricao: string;
  amount: number;
  dueDate: string;
}): AjusteDaPrevisao {
  return {
    description: params.descricao,
    amount: params.amount,
    due_date: params.dueDate,
  };
}

/**
 * A frase do ajuste -- o que mudou, e em QUE OUTRA TELA tambem mudou.
 *
 * A FRASE SAI DO QUE FOI GRAVADO, e nao do que foi pedido: o laco das parcelas
 * pode parar no meio, e dizer "21 parcelas ajustadas" de 3 seria a resposta
 * mentindo sobre a divida que ela mesma reescreveu.
 */
export function mensagemDoAjuste(params: {
  quantasParcelas: number;
  total: number;
  jaRecebido: number;
  caso: CasoDoEmprestimo;
  previsoesAjustadas: number;
  previsoesAusentes: number[];
  mudouADescricao: boolean;
  mudouOTotal: boolean;
  /** `false` quando o UPDATE do emprestimo nao alcancou a linha. */
  emprestimoAtualizado: boolean;
}): string {
  const partes: string[] = [];

  if (params.mudouOTotal) {
    partes.push(
      `O empréstimo passou a valer ${emReais(params.total)}` +
        (params.jaRecebido > 0
          ? `, com ${emReais(params.jaRecebido)} já recebidos e o resto dividido entre as ${params.quantasParcelas} parcela(s) em aberto.`
          : `, dividido entre as ${params.quantasParcelas} parcela(s) em aberto.`)
    );
  } else if (params.quantasParcelas > 0) {
    partes.push(`${params.quantasParcelas} parcela(s) em aberto foram atualizadas.`);
  }

  if (params.mudouADescricao) {
    partes.push("A descrição foi trocada.");
  }

  // O QUE MUDOU NA OUTRA TELA. No Caso A a parcela e tambem uma conta a pagar, e
  // sem esta frase a pessoa nao sabe que Contas a Pagar acompanhou -- e iria lá
  // editar as 21 linhas a mao.
  if (params.caso === "auto" && params.previsoesAjustadas > 0) {
    partes.push(
      `${params.previsoesAjustadas} conta(s) a pagar foram atualizadas junto, em Contas a Pagar.`
    );
  }

  // E O QUE NAO MUDOU LÁ, pelo mesmo motivo. A previsao ausente e um estrago
  // ANTERIOR a este pedido (ver `previsoesDoAjuste`), e calar sobre ela faria a
  // pessoa descobrir sozinha, meses depois, que aquela parcela nunca aparece em
  // Contas a Pagar.
  if (params.previsoesAusentes.length > 0) {
    partes.push(
      `A parcela ${params.previsoesAusentes.join(", ")} não tem conta a pagar em Contas a Pagar — ` +
        "a dívida foi ajustada, mas essa cobrança não existe lá para ser atualizada."
    );
  }

  if (!params.emprestimoAtualizado) {
    partes.push(
      "Atenção: as parcelas foram ajustadas e o valor total do empréstimo não — tente de novo."
    );
  }

  return partes.join(" ");
}
