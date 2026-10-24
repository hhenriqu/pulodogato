// ---------------------------------------------------------------------------
// MyBank -- AS SETE LEITURAS DE DINHEIRO, uma funcao pura por recorte
// (HMO-372, F4 da HMO-368)
// ---------------------------------------------------------------------------
// A F2 (HMO-370) decidiu o que cada caso ESCREVE. Esta fase decide o que cada
// leitura VE, e as duas coisas nao sao a mesma: feature de dinheiro aqui quase
// nunca quebra na escrita; quebra numa leitura que ninguem listou.
//
// O QUE JA ESTAVA CERTO POR CONSTRUCAO, E NAO SE MEXE
// ---------------------------------------------------
// Medido antes de escrever uma linha deste arquivo (ver
// scripts/test-leituras-do-mybank.mjs, bloco "o retrato de hoje"):
//
//   * CASO A (auto-emprestimo) ja aparece UMA vez em Contas a Pagar e no «A
//     vencer»: a parcela e uma linha de `scheduled_transactions` com
//     `transaction_type = 'transfer'`, e `direcaoDaAgenda('transfer')` devolve
//     `'expense'` (HMO-303). A leitura nao precisava de nada novo -- e por isso
//     o mutante dessa leitura NAO e "fiz funcionar", e sim "continua UMA vez";
//   * o «Total de contas» do modo Papel de Pao ja a DEIXA FORA, porque ele usa
//     `classeDaAgenda`, que enxerga `transfer` (a decisao 3: o principal
//     emprestado fica fora do patrimonio na fase 1);
//   * CASO B nao escreve linha minha nenhuma (`previsoesDoEmprestimo` devolve
//     `[]`), entao o meu safe-to-spend nao desconta o que a conexao paga.
//
// O QUE FALTAVA EM TODAS ELAS: O LADO DO DEVEDOR
// ----------------------------------------------
// A view `mybank_due_entries` (F1) nasceu sem leitor. Enquanto ela nao for
// unida as leituras, a Lais abre Contas a Pagar e NAO VE a parcela que ela
// deve -- a divida existe no banco, a RLS a entrega para ela, e nenhuma tela
// pergunta. E o `tabela-sem-leitor-parece-feature-pronta` em forma de dinheiro.
//
// A view ja resolve tres coisas que este modulo NAO repete:
//   1. `borrower_user_id = auth.uid()` -- so a minha divida;
//   2. `borrower_user_id IS DISTINCT FROM lender_user_id` -- o auto-emprestimo
//      fica FORA, porque ele ja esta em `scheduled_transactions`. E esta a
//      trava do "aparece uma vez";
//   3. `status IN ('pending','reported')` -- o que ainda nao foi confirmado.
//
// POR QUE AS FUNCOES SAO PURAS E O RECORTE DE DATA MORA AQUI
// ----------------------------------------------------------
// `leitura-sem-recorte-de-data-soma-o-horizonte`: a view NAO tem recorte de
// periodo, de proposito (ela e a divida inteira). Cada uma das quatro leituras
// tem uma janela DIFERENTE -- Contas a Pagar usa `from`/`to` da query,
// `/summary` usa `de`/`ate`, o safe-to-spend usa `<= fim do mes` SEM piso, e a
// tela de movimentacao usa o periodo do painel. Uma consulta por rota com o
// filtro escrito a mao em quatro lugares e quatro chances de esquecer o `lte`;
// `parcelasDevidasNoPeriodo` e o unico lugar onde o recorte existe, e ela
// aceita `de: null` porque o safe-to-spend PRECISA da parcela vencida do mes
// passado (dinheiro que ainda vai sair).
//
// DESDE A FASE 5 DO MODELO NOVO (RN021.3) SO O JURO ENTRA NO RESULTADO
// ------------------------------------------------------------------
// As abas Receitas e Despesas sao as duas metades do Resultado do mes (RN016).
// O principal do emprestimo e transferencia nos dois lados, e o que entra e o
// juro de cada parcela: receita para quem emprestou (`aReceberDoMyBank`) e
// despesa para quem pegou (`jurosDevidosNaAgenda` no previsto,
// `jurosPagosComoRealizados` no realizado). O juro de cada parcela sai da view
// `mybank_installment_interest` (071), pelo rateio da serie que a confirmacao
// usa. Contas a Pagar e o safe-to-spend continuam com a parcela cheia, porque
// la a pergunta e quanto sai da conta.
//
// NAO HA IMPORT COM `@/` ALEM DE `emprestimo-do-mybank`, e ele e puro (so
// `lancamento` e `transferencia`, os dois sem import proprio). E isso que deixa
// este modulo compilar na suite sem o runtime do Next.
// ---------------------------------------------------------------------------

import { SELO_DO_MYBANK, chaveDaParcelaDoMyBank } from "@/lib/emprestimo-do-mybank";

/**
 * Uma linha de `mybank_due_entries` -- o que EU devo, do jeito que a view
 * entrega.
 *
 * `amount` e `number | string` porque o PostgREST entrega `numeric(15,2)` como
 * STRING. Ler `"1000.00"` como numero e `Number(...)`, e e `valorDaParcela`
 * quem o faz num lugar so: `l.amount + 0` em quatro rotas produziria
 * concatenacao em uma delas.
 */
export interface ParcelaDevida {
  id: string;
  loan_id: string;
  lender_user_id: string;
  description: string;
  amount: number | string;
  due_date: string;
  status: string;
  installment_number: number;
  installment_total: number;
  reported_at?: string | null;
}

/**
 * O numero da parcela, em BRL positivo. A view tem `CHECK (amount > 0)`.
 *
 * O parametro e ESTRUTURAL (`{ amount }`) e nao `ParcelaDevida`: os dois lados
 * da divida passam por aqui -- a parcela que eu devo e a que a conexao me deve
 * --, e as duas formas sao diferentes de proposito (uma conhece o credor, a
 * outra o devedor). Tipar pelo lado do devedor obrigaria o lado do credor a
 * carregar quatro campos que ele nao tem.
 */
const valorDaParcela = (parcela: { amount: number | string }): number => {
  const n = Number(parcela.amount ?? 0);
  // `Math.abs` e nao so `Number`: um valor negativo que escapasse do CHECK do
  // banco viraria uma divida que DIMINUI o "a pagar", e esse e o unico sinal de
  // que a soma esta errada -- o total desceria sem nenhuma linha errada.
  return Number.isFinite(n) ? Math.abs(n) : 0;
};

/** Centavos, sem o ruido de ponto flutuante acumulado na soma. */
const centavos = (valor: number) => Number(valor.toFixed(2));

/**
 * O RECORTE DE DATA, num lugar so.
 *
 * `de: null` quer dizer SEM PISO, e nao "o comeco dos tempos por descuido": e o
 * que o safe-to-spend precisa, porque uma parcela que venceu no mes passado e
 * nao foi paga continua sendo dinheiro que vai sair. As outras tres leituras
 * passam as duas pontas.
 *
 * O teto e `<=` e o piso e `>=`, iguais ao `.gte`/`.lte` das quatro rotas: o
 * dia do vencimento pertence ao periodo que termina nele.
 */
export function parcelasDevidasNoPeriodo(
  parcelas: ParcelaDevida[],
  janela: { de: string | null; ate: string }
): ParcelaDevida[] {
  return parcelas.filter((parcela) => {
    const vencimento = String(parcela.due_date);
    if (janela.de !== null && vencimento < janela.de) return false;
    return vencimento <= janela.ate;
  });
}

/**
 * Uma parcela devida no formato da AGENDA -- a linha que Contas a Pagar une.
 *
 * A forma e a de `FaturaPrevista` (lib/agenda-do-cartao.ts), e nao uma invencao
 * nova: ela e o precedente deste repositorio para "linha calculada que entra na
 * agenda sem estar gravada em `scheduled_transactions`", e
 * `agendaComFaturasAbertas` ja sabe ordenar a uniao por `due_date`.
 *
 * `id: null` E DELIBERADO, com o id de verdade em campo PROPRIO
 * ------------------------------------------------------------
 * Esta linha nao e uma `scheduled_transaction`, e um `id` preenchido faria
 * qualquer tela mandar `PATCH /api/scheduled-transactions/<id>` ou
 * `.../pay` sobre um uuid que aquela tabela nao tem -- 404, ou pior, a baixa de
 * uma linha alheia se o uuid um dia colidir. O id que a acao usa e
 * `mybank_installment_id`, que vai para `PATCH /api/mybank/installments/[id]`.
 * E a mesma razao pela qual a fatura sintetizada tambem nasce com `id: null`.
 */
export interface ParcelaDevidaNaAgenda {
  /** SEMPRE null: esta linha e calculada, nao gravada. Ver acima. */
  id: null;
  /** O discriminante da uniao. Sempre `true`. */
  parcela_do_mybank: true;
  /** O id que `PATCH /api/mybank/installments/[id]` recebe. */
  mybank_installment_id: string;
  mybank_loan_id: string;
  /** Quem emprestou -- o `lender_user_id`. O NOME e resolvido na tela. */
  lender_user_id: string;
  /** De quem esta divida e: o proprio dono da leitura, por construcao da view. */
  user_id: string;
  description: string;
  amount: number;
  due_date: string;
  /**
   * `'pending'` tambem quando a parcela esta `reported`.
   *
   * `reported` quer dizer "eu avisei que paguei e o credor ainda nao
   * confirmou", e nesse intervalo o dinheiro AINDA E DIVIDA: o credor pode nao
   * ter recebido. Mapear `reported` para `'paid'` aqui faria o «A vencer»
   * descer no instante do clique do devedor -- um botao que paga a conta.
   * A convencao e a da HMO-366, e a view entrega os dois status por isso.
   */
  status: "pending";
  /**
   * O status DE VERDADE da parcela no MyBank -- `pending` ou `reported`.
   *
   * ELE EXISTE PORQUE O `status` ACIMA NAO PODE DIZE-LO (HMO-386). Aquele campo
   * e de DINHEIRO: ele e `'pending'` tambem quando a parcela esta `reported`, de
   * proposito, senao o «A vencer» desceria no instante do clique do devedor.
   * Mas a TELA precisa da distincao para o GESTO: quem ja avisou nao avisa de
   * novo, e o botao vira a frase de espera ("falta quem emprestou confirmar").
   *
   * Sem este campo a linha da agenda ofereceria "Avisar que paguei" a quem ja
   * avisou -- e o segundo PATCH responde 200 sem mudar nada, entao o sintoma
   * seria um botao que parece funcionar e nao faz diferenca nenhuma. Era este o
   * unico motivo pelo qual o gesto so existia no bloco do devedor, e por isso
   * ele nasce aqui junto da HMO-386, que moveu o gesto para a linha.
   *
   * `reported_at` NAO SERVE NO LUGAR DELE: ele continua preenchido depois de o
   * credor confirmar, e quem decide o estado e o `status`.
   */
  mybank_status: "pending" | "reported";
  effective_status: "pending" | "overdue";
  /**
   * O ESTADO DA PESSOA (HMO-411). Aqui ele e SEMPRE a copia dos dois acima.
   *
   * Divida de MyBank nao e conta de grupo: ela nao tem `group_id` e nao tem
   * linha em `group_bill_payments`. Quem le e sempre o devedor, entao
   * `my_status === status` por construcao.
   *
   * `my_status` SEGUE `status` E NAO `mybank_status`, E ISSO E A MESMA DECISAO
   * DE DINHEIRO DOS DOIS CAMPOS ACIMA: ele e `'pending'` tambem quando a
   * parcela esta `reported`, porque nesse intervalo a divida AINDA EXISTE --
   * o credor pode nao ter recebido. Fazer `my_status` seguir `mybank_status`
   * poria `'reported'` num campo que as somas de dinheiro filtram por
   * `'pending'`, e o «A vencer» desceria no instante do clique do devedor: um
   * botao que paga a conta. A distincao para a TELA continua em
   * `mybank_status`, que e quem o botao le.
   *
   * ELES NAO SAO DECORACAO: sem estes dois campos a parcela chega `undefined`
   * em todo filtro por `my_status` e cai calada para fora de «Total a pagar».
   */
  my_status: "pending";
  my_effective_status: "pending" | "overdue";
  days_until_due: number;
  /**
   * `'expense'` E NAO `'transfer'`, e esta e a unica assimetria com o Caso A.
   *
   * No auto-emprestimo o dinheiro vai da minha conta corrente para a MINHA
   * conta de investimento: patrimonio nenhum muda, e por isso aquela linha e
   * `transfer` e o «Total de contas» a deixa de fora. Aqui o dinheiro sai das
   * contas da DEVEDORA e vai para a conta de outra pessoa -- ele deixa de ser
   * dela. Gravar `transfer` neste lado tiraria a parcela do «Total de contas»
   * dela: uma divida de R$ 1.000 por mes que nenhuma tela soma.
   */
  direction: "expense";
  /** O elo `mybank:<id>`, a mesma chave da perna do Caso A. */
  notes: string;
  /** Divida de MyBank nao e de grupo: nao passa pelo rateio. */
  group_id: null;
  recurring_rule_id: null;
  /** O selo que a tela mostra. */
  selo: string;
  installment_number: number;
  installment_total: number;
}

/**
 * Esta linha da agenda e uma parcela devida do MyBank?
 *
 * O parametro e `object` pela mesma razao de `ehFaturaPrevista`: um tipo-alvo
 * so com propriedade opcional e WEAK TYPE para o `tsc`, e passar nele uma
 * `ScheduledTransaction` reprova com TS2345. O cast fica aqui, num lugar so.
 */
export function ehParcelaDoMyBank(linha: object): linha is ParcelaDevidaNaAgenda {
  return (linha as { parcela_do_mybank?: unknown }).parcela_do_mybank === true;
}

/**
 * As parcelas devidas, no formato da agenda.
 *
 * `hoje` ENTRA COMO PARAMETRO e nao sai de `new Date()`: `effective_status` e
 * `days_until_due` sao as duas colunas que a view `scheduled_transactions_effective`
 * calcula com `CURRENT_DATE`, e um `Date` interno faria o teste passar verde em
 * UTC e vermelho aqui (`teste-de-data-passa-em-utc-e-nao-ve-o-bug`). As quatro
 * rotas ja tem `today()` na mao.
 */
export function parcelasDevidasNaAgenda(
  parcelas: ParcelaDevida[],
  hoje: string
): ParcelaDevidaNaAgenda[] {
  return parcelas.map((parcela) => {
    const vencimento = String(parcela.due_date);

    return {
      id: null,
      parcela_do_mybank: true as const,
      mybank_installment_id: parcela.id,
      mybank_loan_id: parcela.loan_id,
      lender_user_id: parcela.lender_user_id,
      user_id: "",
      description: parcela.description,
      amount: valorDaParcela(parcela),
      due_date: vencimento,
      status: "pending" as const,
      // O STATUS DA TELA, separado do de dinheiro (ver o campo).
      //
      // A COMPARACAO E CONTRA `'reported'` E NAO CONTRA `'pending'`: a view
      // entrega `status IN ('pending','reported')` hoje, e um `=== 'pending' ?
      // 'pending' : 'reported'` chamaria de "avisada" qualquer parcela que a
      // view venha a entregar amanha com outro status. A direcao segura e
      // "avisada so quando esta escrito `reported`": o erro possivel passa a ser
      // oferecer o botao a mais, e nao esconder o botao de quem precisa dele.
      mybank_status:
        String(parcela.status) === "reported"
          ? ("reported" as const)
          : ("pending" as const),
      // O MESMO `CASE` da migration 027, em JavaScript: `pending` com
      // vencimento anterior a hoje e `overdue`. Comparacao de string ISO e
      // comparacao de data -- `AAAA-MM-DD` ordena lexicograficamente.
      effective_status: vencimento < hoje ? ("overdue" as const) : ("pending" as const),
      // Os dois de HMO-411, iguais aos de dinheiro acima -- ver o porque no
      // campo `my_status` da interface. Escritos a partir da MESMA expressao,
      // e nao copiados da variavel acima, para que uma mudanca na regra de
      // `overdue` nao deixe metade da dupla para tras.
      my_status: "pending" as const,
      my_effective_status:
        vencimento < hoje ? ("overdue" as const) : ("pending" as const),
      days_until_due: diasAte(vencimento, hoje),
      direction: "expense" as const,
      notes: chaveDaParcelaDoMyBank(parcela.id),
      group_id: null,
      recurring_rule_id: null,
      selo: SELO_DO_MYBANK,
      installment_number: parcela.installment_number,
      installment_total: parcela.installment_total,
    };
  });
}

/**
 * `due_date - CURRENT_DATE` em dias, igual a coluna `days_until_due` da 027.
 *
 * `Date.UTC` nos dois lados e nao `new Date(iso)`: o construtor de string
 * interpreta `AAAA-MM-DD` como meia-noite UTC mas `AAAA-MM-DDTHH` como local, e
 * a diferenca entre os dois faz a conta errar um dia no fuso de Sao Paulo --
 * o que apareceria como uma conta "vence hoje" que venceu ontem.
 */
function diasAte(vencimento: string, hoje: string): number {
  const dia = (iso: string) => {
    const [a, m, d] = iso.split("-").map(Number);
    return Date.UTC(a, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((dia(vencimento) - dia(hoje)) / 86400000);
}

/**
 * A linha da agenda, com o dono preenchido.
 *
 * `user_id` nao sai da view (a view devolve `borrower_user_id` como `user_id`,
 * mas o tipo acima o deixa vazio de proposito): quem o preenche e a rota, com
 * o `user.id` da SESSAO. A razao e a mesma da HMO-311 na fatura sintetizada --
 * `posso_editar` deriva de `ehMinha(crua.user_id, meuUserId)`, e `undefined`
 * ali vira `false`: a parcela chegaria a tela marcada como "linha de outra
 * pessoa" e o botao de avisar que pagou nao apareceria. Um botao que falta e um
 * sintoma que ninguem reporta como bug de dinheiro.
 */
export function comODonoDaLeitura(
  linhas: ParcelaDevidaNaAgenda[],
  meuUserId: string
): ParcelaDevidaNaAgenda[] {
  return linhas.map((linha) => ({ ...linha, user_id: meuUserId }));
}

// ---------------------------------------------------------------------------
// O LADO DO CREDOR: o "a receber" em Receitas (decisao 2 da HMO-368)
// ---------------------------------------------------------------------------
// A forma e a de `lib/services/credito-dos-grupos.ts` + `resumoComReembolsoPrevisto`
// (HMO-364), e o que se reusa e A FORMA, nao o numero: o MyBank entra em CAMPO
// PROPRIO (`a_receber_do_mybank`) e nao dentro de `reembolso_previsto`. Somar os
// dois no mesmo campo apagaria a medicao do credito de grupo -- a familia
// `unificar-criterio-duplicado-apaga-a-medicao-do-outro-modulo` --, e a tela
// perderia a frase que diz de onde vem cada parte.

/** O juro que a conexao ainda me deve no periodo, para o «Previsto» de Receitas. */
export interface AReceberDoMyBank {
  /** BRL, POSITIVO. A soma do juro das parcelas em aberto do periodo. */
  total: number;
  /** Quantas parcelas com juro. */
  parcelas: number;
  /** De quantas pessoas. */
  devedores: number;
  /** De quantos emprestimos. */
  emprestimos: number;
}

/**
 * Uma parcela que a conexao me deve -- do lado do CREDOR, lida de
 * `mybank_installment_interest` (071) com `lender_user_id` = eu.
 *
 * E uma forma diferente de `ParcelaDevida` porque o lado do credor conhece o
 * `borrower_user_id` (quem deve) e nao o `lender_user_id` (que sou eu).
 */
export interface ParcelaAReceber {
  id: string;
  loan_id: string;
  borrower_user_id: string;
  amount: number | string;
  due_date: string;
  status: string;
  /**
   * O juro da parcela, como a view o entrega: nulo quando a ultima parcela da
   * serie nao cabe a sobra do principal (a confirmacao tambem recusa ratear).
   */
  interest_amount: number | string | null;
}

/**
 * O juro da parcela em BRL, ou zero quando ele nao existe.
 *
 * Nulo e zero sao a mesma resposta para quem soma: a parcela nao tem juro que
 * entre no Resultado. Negativo tambem, e pela razao de `valorDaParcela`: um
 * juro negativo que escapasse do rateio DIMINUIRIA a despesa de quem pegou.
 */
const juroDaParcela = (parcela: { interest_amount?: number | string | null }): number => {
  const n = Number(parcela.interest_amount ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * O "a receber" do periodo, ou `null` quando nao ha nada.
 *
 * `null` E NAO `{ total: 0 }`, e a diferenca e a tela: `resumoComAReceberDoMyBank`
 * usa o `null` para NAO mexer no «Previsto» nem acrescentar o campo, e e assim
 * que a conta sem MyBank le exatamente os mesmos numeros de hoje -- o controle
 * negativo desta issue. Um objeto zerado mudaria a FORMA da resposta de toda
 * conta do app, e o contrato da tela e medido por forma.
 *
 * SO O JURO, desde a fase 5 (RN021.3): o principal que volta e transferencia,
 * e a parcela sem juro (emprestimo sem taxa, ou serie cuja ultima parcela nao
 * cabe a sobra) nao entra.
 *
 * AUTO-EMPRESTIMO NAO ENTRA: o juro que eu pago a mim mesmo nao e receita
 * nem despesa, o dinheiro volta para a minha conta de investimento. Quem o
 * exclui e o id do dono da leitura, e nao um `status` ou uma data.
 */
export function aReceberDoMyBank(
  parcelas: ParcelaAReceber[],
  meuUserId: string
): AReceberDoMyBank | null {
  const emAberto = parcelas.filter((parcela) => {
    // A mesma dupla de status da view do devedor: `reported` CONTINUA contando,
    // porque o devedor avisou e eu ainda nao confirmei -- o dinheiro ainda nao
    // esta na minha conta de investimento.
    if (parcela.status !== "pending" && parcela.status !== "reported") return false;
    // O auto-emprestimo. Ver acima.
    if (parcela.borrower_user_id === meuUserId) return false;
    return juroDaParcela(parcela) > 0;
  });

  if (emAberto.length === 0) return null;

  const total = centavos(
    emAberto.reduce((soma, parcela) => soma + juroDaParcela(parcela), 0)
  );

  // `<= 0` e nao `=== 0`: o CHECK do banco e `amount > 0`, e se um dia uma
  // linha escapar dele, somar isso ao «Previsto» de Receitas DERRUBARIA a
  // receita prevista do mes com um numero que a tela apresenta como credito a
  // receber. A mesma guarda de `resumoComReembolsoPrevisto`.
  if (total <= 0) return null;

  return {
    total,
    parcelas: emAberto.length,
    devedores: new Set(emAberto.map((p) => p.borrower_user_id)).size,
    emprestimos: new Set(emAberto.map((p) => p.loan_id)).size,
  };
}

/**
 * A FRASE do cartao, que diz de onde o numero veio.
 *
 * Numero novo no «Previsto» sem legenda nao se distingue de bug -- e o caminho
 * dessa estranheza termina em alguem "consertando" a conta por fora. A razao
 * inteira esta em lib/legenda-do-bruto-e-do-liquido.ts; esta e a mesma decisao
 * aplicada ao MyBank.
 *
 * ESTA E A ORACAO QUE IMPORTA: ela diz que o numero NAO esta no safe-to-spend,
 * que e o outro cartao que a pessoa vai olhar no mesmo minuto. Sem ela, ver
 * R$ 1.000 aqui e nao ve-los la se le como "o app perdeu a parcela".
 *
 * ELA E A SEGUNDA METADE DA FRASE, e nao a frase toda -- HMO-379. A primeira
 * ("inclui R$ 30,00 a receber de 1 pessoa em 1 emprestimo do MyBank") mora no
 * JSX de `components/movimentacoes/CartoesDaTela.tsx`, porque e ela que carrega
 * os NUMEROS: a forma e a do irmao `reembolso_previsto` (HMO-364), que tambem
 * conta pessoas e grupos no proprio cartao.
 *
 * O texto perdeu o "Inclui o que suas conexoes ainda devem no MyBank:" que
 * tinha ao nascer, porque a oracao de cima passou a dizer isso com o valor e as
 * contagens -- as duas juntas repetiriam "inclui" duas vezes numa legenda de
 * uma linha. A constante nao tinha UM consumidor quando foi reescrita (era
 * justamente o defeito da HMO-379), entao nada dependia da forma antiga.
 */
export const LEGENDA_DO_A_RECEBER_DO_MYBANK =
  "é promessa e não dinheiro, então não entra em «Quanto ainda posso gastar».";

// ---------------------------------------------------------------------------
// O LADO DE QUEM PEGOU: o juro em Despesas (fase 5, RN021.3)
// ---------------------------------------------------------------------------

/** Uma linha de `mybank_installment_interest` (071), dos dois lados. */
export interface ParcelaComJuro {
  id: string;
  loan_id: string;
  lender_user_id: string;
  borrower_user_id: string;
  loan_status: string;
  description: string;
  installment_number: number;
  installment_total: number;
  amount: number | string;
  due_date: string;
  status: string;
  interest_amount: number | string | null;
}

/**
 * "Juros: Moto (3/24)". O mesmo texto que `mybank_interest_entries` (071)
 * monta para o juro pago, para a linha nao mudar de nome no dia da baixa.
 */
export function descricaoDoJuro(parcela: {
  description: string;
  installment_number: number;
  installment_total: number;
}): string {
  return `Juros: ${parcela.description} (${parcela.installment_number}/${parcela.installment_total})`;
}

/**
 * O juro que EU devo no MyBank, na janela, no formato da agenda.
 *
 * E a linha da aba Despesas de quem pegou: a parcela de R$ 1.000 com R$ 50 de
 * juro entra como "Juros: Moto (3/24)", R$ 50. Ela passa por
 * `parcelasDevidasNaAgenda` para ter a mesma forma da parcela de Contas a
 * Pagar (`id: null`, a chave `mybank:<id>`, o selo), e a tela a trata igual.
 *
 * OS RECORTES DA `mybank_due_entries` ESTAO AQUI, porque esta view e dos dois
 * lados: so o que eu peguei, sem o auto-emprestimo, de emprestimo ativo, em
 * `pending` ou `reported`. E so a parcela com juro.
 */
export function jurosDevidosNaAgenda(
  parcelas: ParcelaComJuro[],
  meuUserId: string,
  janela: { de: string | null; ate: string },
  hoje: string
): ParcelaDevidaNaAgenda[] {
  const devidas: ParcelaDevida[] = [];
  for (const parcela of parcelas) {
    if (parcela.borrower_user_id !== meuUserId) continue;
    if (parcela.lender_user_id === meuUserId) continue;
    if (parcela.loan_status !== "active") continue;
    if (parcela.status !== "pending" && parcela.status !== "reported") continue;
    const juro = juroDaParcela(parcela);
    if (juro <= 0) continue;
    devidas.push({
      id: parcela.id,
      loan_id: parcela.loan_id,
      lender_user_id: parcela.lender_user_id,
      description: descricaoDoJuro(parcela),
      amount: juro,
      due_date: parcela.due_date,
      status: parcela.status,
      installment_number: parcela.installment_number,
      installment_total: parcela.installment_total,
    });
  }
  return parcelasDevidasNaAgenda(parcelasDevidasNoPeriodo(devidas, janela), hoje);
}

/** A view do juro pago, do lado de quem pegou (071). */
export const VIEW_DOS_JUROS_PAGOS = "mybank_interest_entries";

/**
 * As colunas que as leituras pedem da view. As quatro primeiras sao as de
 * `COLUNAS_DA_PARTE_DE_GRUPO`, e e isso que deixa o modo intervalo dos
 * relatorios somar o juro pela mesma `partesComoTransacoes`.
 */
export const COLUNAS_DOS_JUROS_PAGOS =
  "id, amount, transaction_type, currency, category_id, transaction_date, descricao";

/** Uma linha de `mybank_interest_entries`, como chega do PostgREST. */
export interface JuroPagoCru {
  id: string;
  amount: number | string;
  transaction_type: string | null;
  currency?: string | null;
  category_id?: string | null;
  transaction_date?: string | null;
  descricao?: string | null;
}

/** O prefixo do id da linha sintetizada: o id da parcela nao e uma transacao. */
export const PREFIXO_DO_JURO_PAGO = "juros-do-mybank:";

/**
 * O juro pago no formato de uma linha realizada da tela de Receitas e Despesas,
 * a mesma forma de `ContaDoFechamentoRealizada` (lib/fechamento-no-resultado.ts).
 *
 * `amount` NEGATIVO, que e a convencao de despesa em `financial_transactions`.
 * `notes` leva a chave `mybank:<id da parcela>`, e e ela que da o selo na tela
 * (`ehJuroPagoDoMyBank`). SEM `user_id`, como a conta do fechamento: a linha
 * nao se edita nem se apaga, ela some quando quem emprestou desfaz a baixa.
 */
export interface JuroPagoRealizado {
  id: string;
  description: string;
  amount: number;
  transaction_date: string;
  transaction_type: "expense";
  currency: string;
  category: { name: string; is_expense: boolean };
  notes: string;
  selo: string;
}

export function jurosPagosComoRealizados(
  juros: readonly JuroPagoCru[]
): JuroPagoRealizado[] {
  const linhas: JuroPagoRealizado[] = [];
  for (const juro of juros) {
    if (juro.transaction_type !== "expense") continue;
    const valor = Math.abs(Number(juro.amount) || 0);
    if (!(valor > 0)) continue;
    linhas.push({
      id: `${PREFIXO_DO_JURO_PAGO}${juro.id}`,
      description: juro.descricao ?? "Juros do MyBank",
      amount: -valor,
      transaction_date: juro.transaction_date ?? "",
      transaction_type: "expense",
      currency: juro.currency ?? "BRL",
      category: { name: "Juros do MyBank", is_expense: true },
      notes: chaveDaParcelaDoMyBank(juro.id),
      selo: SELO_DO_MYBANK,
    });
  }
  return linhas;
}
