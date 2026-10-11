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
