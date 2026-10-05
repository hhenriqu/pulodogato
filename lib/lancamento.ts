// ---------------------------------------------------------------------------
// O QUE CADA TELA DE LANCAMENTO PEDE, E O QUE ELA GRAVA (HMO-165)
// ---------------------------------------------------------------------------
// Receita e despesa passaram a ter tela propria. O formulario antigo era um
// bloco de 600 linhas dentro de `personal-finance` que trocava os campos por
// `if (formData.transaction_type === ...)`: quem abria para lancar uma receita
// via, aparecendo e desaparecendo, o seletor de natureza da despesa, o
// parcelamento e o rateio.
//
// Este arquivo e o unico lugar que responde as quatro perguntas que as duas
// telas fazem igual:
//
//   1. quais campos aparecem  -> `camposDoTipo`
//   2. quais categorias servem -> `categoriasDoTipo`
//   3. quais contas servem     -> `contasDoSeletor`
//   4. o lancamento esta valido, e com que sinal ele e gravado
//                              -> `validarLancamento` e `valorGravado`
//
// Ele existe separado do componente por um motivo pratico: as regras de
// dinheiro dao para testar sem navegador, e as tres copias que existiam antes
// (a tela, a fila offline, a rota de parcelas) foi exatamente como a
// transferencia passou a contar duas vezes.
//
// A CONTABILIZACAO nao esta aqui: soma de periodo e `lib/movimentacoes.ts`.
// ---------------------------------------------------------------------------

/** Os dois tipos que tem tela propria. Transferencia e a HMO-164. */
export type TipoLancamento = "income" | "expense";

/**
 * Natureza do lancamento. Nao e coluna nova no banco: cada valor ROTEIA para um
 * modelo que ja existe.
 *
 *   one_off    -> `financial_transactions`, como sempre foi
 *   card       -> a mesma transacao, mas numa conta `credit_card`, que e o que
 *                 faz a compra entrar na fatura (migration 006)
 *   fixed      -> `recurring_rules` (005), que gera a agenda mes a mes
 *   card_fixed -> a MESMA `recurring_rules`, com o `account_id` de um cartao
 *
 * Guardar um quarto rotulo solto em `financial_transactions` criaria uma
 * segunda fonte de verdade para "e fixa?", competindo com a regra.
 *
 * O nome fala de despesa por heranca: ate a HMO-170 so a despesa tinha este
 * seletor. Hoje a RECEITA tambem tem -- salario e o caso que motivou a issue --
 * e quem diz quais valores cabem em cada tela e `naturezasDoTipo`.
 *
 * ---------------------------------------------------------------------------
 * ESTE ENUM SAO DUAS PERGUNTAS, E DESDE A HMO-254 A TELA FAZ AS DUAS SEPARADAS
 * ---------------------------------------------------------------------------
 * "Despesas pontuais devem se chamar apenas despesa, e so poder ser lancada em
 * contas correntes e ter um checkbox de Fixa. (...) Gastos no cartao, so pode
 * ser aplicado no cartao e tem o check box ao lado do parcelamento, voce
 * escolhe, fixo ou parcelado ou caso nenhum nem outro ambos desmarcados ai e
 * gasto normal."
 *
 * Sao dois eixos independentes, e o seletor de tres itens os misturava:
 *
 *               | nao fixa   | fixa
 *   ------------+------------+-------------
 *   na conta    | one_off    | fixed
 *   no cartao   | card       | card_fixed
 *
 * `card_fixed` e a casa que NAO EXISTIA. Escolher "Despesa Fixa" no seletor
 * antigo abria a lista de contas inteira -- cartao incluso --, entao a
 * assinatura cobrada no cartao era cadastravel; mas a tela chamava aquilo de
 * "Despesa Fixa" e `camposDoTipo` respondia `ehNoCartao: false`, ou seja o
 * rotulo dizia "Conta/Cartao" e nada obrigava a escolher o cartao. A coluna
 * `recurring_rules.account_id` sempre aceitou um cartao; o que faltava era a
 * tela saber que aquele caso existe.
 *
 * O EIXO NAO VIROU DOIS CAMPOS NO ESTADO de proposito. `ValoresDeLancamento` e
 * um objeto so que atravessa as tres telas (despesa, receita, transferencia), e
 * `natureza` ja e lido por `lib/transferencia.ts` e pela fila offline. Um
 * segundo campo `fixa: boolean` ao lado dele seriam duas fontes para a mesma
 * pergunta, e a divergencia entre elas e invisivel: `natureza: "card"` com
 * `fixa: true` nao da erro em lugar nenhum -- grava a compra e perde a regra.
 * Aqui a composicao e uma funcao (`naturezaDoLugar`) e a decomposicao sao duas
 * (`lugarDaNatureza`, `ehNaturezaFixa`), e o estado continua com um campo.
 *
 * NAO COMPARE `natureza === "fixed"` EM LUGAR NENHUM. Use `ehNaturezaFixa`. A
 * comparacao crua compila, responde `false` para `card_fixed` e manda a
 * assinatura do cartao para `financial_transactions` como uma compra avulsa --
 * sem erro, sem log, e a regra mensal que a pessoa pediu nunca existe. Os
 * `Record<NaturezaDespesa, ...>` da tela pegam a omissao no `tsc`; uma
 * comparacao com string nao.
 */
export type NaturezaDespesa = "one_off" | "card" | "fixed" | "card_fixed";

/**
 * O eixo "onde o dinheiro sai", que e o que o seletor da tela pergunta desde a
 * HMO-254. Duas opcoes, e nao tres: "fixa" saiu daqui e virou checkbox.
 */
export type LugarDoLancamento = "conta" | "cartao";

/**
 * Esta natureza vira uma REGRA (`recurring_rules`) em vez de um lancamento?
 *
 * A UNICA leitura autorizada do eixo "fixa". Ver o aviso em `NaturezaDespesa`.
 */
export function ehNaturezaFixa(natureza: NaturezaDespesa): boolean {
  return natureza === "fixed" || natureza === "card_fixed";
}

/**
 * Esta natureza aponta para um cartao de credito?
 *
 * Vale para a compra (`card`) e para a regra mensal cobrada no cartao
 * (`card_fixed`): as duas precisam que o seletor de conta liste SO cartoes e
 * que a escolha seja obrigatoria. O que as separa nao e isto, e
 * `ehCompraNoCartao` em `camposDoTipo` -- a compra ja aconteceu, a regra nunca
 * acontece.
 */
export function ehNaturezaNoCartao(natureza: NaturezaDespesa): boolean {
  return natureza === "card" || natureza === "card_fixed";
}

/** A decomposicao do eixo "onde". Par de `naturezaDoLugar`. */
export function lugarDaNatureza(natureza: NaturezaDespesa): LugarDoLancamento {
  return ehNaturezaNoCartao(natureza) ? "cartao" : "conta";
}

/**
 * A composicao: o seletor diz o lugar, a checkbox diz se e fixa, e as duas
 * respostas viram UM valor de `natureza`.
 *
 * Existe como funcao pura, e nao como ternario no `onChange` da tela, porque os
 * dois controles escrevem no MESMO campo: a checkbox precisa do lugar atual
 * para saber se produz `fixed` ou `card_fixed`, e o seletor precisa do estado
 * atual da checkbox para nao desligar a regra ao trocar de conta para cartao.
 * Escrito duas vezes no JSX, um dos dois esquece o outro eixo -- e o que se
 * perde e sempre o mesmo: marcar "Fixa" e depois trocar para cartao gravaria a
 * compra, com a checkbox ainda marcada na tela.
 */
export function naturezaDoLugar(
  lugar: LugarDoLancamento,
  fixa: boolean
): NaturezaDespesa {
  if (lugar === "cartao") return fixa ? "card_fixed" : "card";
  return fixa ? "fixed" : "one_off";
}

/**
 * Por quanto tempo a regra se repete (HMO-170).
 *
 *   indefinida -> todo mes, sem fim. `max_occurrences` NULL na regra.
 *   contada    -> por N meses. Vira `max_occurrences` = N.
 *
 * Nao existe "por N meses" como data final na tela de proposito: o usuario
 * conta MESES ("financiei em 18x", "o aluguel vai ate o fim do contrato, 10
 * meses"), e pedir a data de fim obriga ele a fazer a conta de calendario que o
 * `lib/recurrence.ts` ja sabe fazer -- inclusive o mes curto.
 */
export type DuracaoDaRepeticao = "indefinida" | "contada";

/**
 * O valor que esta no campo de valor e o da PARCELA ou o do TOTAL? (HMO-211)
 *
 * A pergunta e literalmente a da issue, e ela existe porque as duas leituras do
 * mesmo numero digitado dao compras dez vezes diferentes: "1.000" em 10x e uma
 * compra de R$ 1.000 ou de R$ 10.000, e nada na tela antiga perguntava qual.
 *
 * O que havia antes eram DOIS campos -- "Numero de Parcelas" e "Valor da
 * Parcela" -- e o total era derivado em silencio (`valor = parcela * N`). Quem
 * digitasse no campo de valor de cima o preco da etiqueta e depois marcasse
 * parcelar via o proprio numero ser sobrescrito pela multiplicacao, sem aviso.
 */
export type BaseDoValorParcelado = "parcela" | "total";

/** O maximo de meses que a tela aceita em "por N meses". */
export const MAX_MESES_DE_REPETICAO = 360;

/**
 * Os tipos que podem virar REGRA mensal (HMO-172).
 *
 * `TipoLancamento` continua sendo "os tipos que tem tela com categoria,
 * natureza e rateio" -- transferencia nao e um deles e nao deve passar a ser,
 * porque ela nao tem categoria nem natureza de gasto. O que ela PASSA a
 * compartilhar e so a pergunta "isto se repete todo mes?", e e esse o recorte
 * deste tipo.
 *
 * Alargar `TipoLancamento` em vez de criar este alias teria sido o erro barato:
 * ele e o parametro de `camposDoTipo`, `validarLancamento`, `valorGravado` e
 * `rotaDoTipo`, e nenhuma dessas funcoes sabe o que fazer com transferencia --
 * o compilador deixaria passar `valorGravado("transfer", 500)`, que devolveria
 * `-500` (o ramo `else`) e gravaria a transferencia como receita.
 */
export type TipoDeRegra = TipoLancamento | "transfer";

/**
 * Quais naturezas cabem nesta tela.
 *
 * Nem receita nem transferencia tem "no cartao", e por motivos diferentes que
 * dao no mesmo lugar:
 *
 *   * RECEITA: cartao de credito e instrumento de PAGAMENTO, e uma entrada
 *     apontada para ele entraria na fatura reduzindo o que se deve -- que e um
 *     estorno, nao uma receita.
 *   * TRANSFERENCIA (HMO-172): mover dinheiro PARA um cartao e quitar divida, e
 *     esse caminho ja existe e e outro (o pagamento da fatura, em Contas
 *     Previstas). Oferecer "no cartao" aqui criaria uma segunda forma de pagar
 *     fatura que nao passa por `pernasDoPagamentoDeFatura` -- duas fontes para a
 *     mesma regra de sinal, que e exatamente o que a HMO-149 custou.
 *
 * O cartao continua valendo como DESTINO de uma transferencia pontual; quem
 * decide isso e `validarContasDaTransferencia`, nao esta funcao.
 */
export function naturezasDoTipo(tipo: TipoDeRegra): NaturezaDespesa[] {
  return tipo === "expense"
    ? ["one_off", "card", "fixed", "card_fixed"]
    : ["one_off", "fixed"];
}

/**
 * Quais LUGARES o seletor desta tela oferece (HMO-254).
 *
 * E esta a funcao que alimenta o seletor da despesa hoje, e nao
 * `naturezasDoTipo` -- que passou a ser "quais naturezas esta tela consegue
 * PRODUZIR", usada pela transferencia (que mantem o seletor de frequencia de
 * tres... de dois itens) e pelos testes de cobertura dos rotulos.
 *
 * Receita tem um lugar so, e por isso a tela dela nao mostra seletor nenhum
 * desde a HMO-254: um `<Select>` com uma opcao e uma pergunta sem alternativa.
 * O eixo "fixa" dela continua na tela, como checkbox -- salario e o caso que
 * motivou a HMO-170 e ele nao pode sumir.
 */
export function lugaresDoTipo(tipo: TipoDeRegra): LugarDoLancamento[] {
  return tipo === "expense" ? ["conta", "cartao"] : ["conta"];
}

export interface CategoriaDeLancamento {
  id: string;
  name: string;
  is_expense: boolean;
}

export interface ContaDeLancamento {
  id: string;
  name: string;
  account_type?: string | null;
  /**
   * Moeda da conta (022). Ela SUGERE a moeda do lancamento -- ver
   * `moedaSugerida` em lib/moeda.ts, que e quem resolve a precedencia entre a
   * conta e o proprio lancamento.
   */
  currency?: string | null;
}

/** Quais blocos do formulario existem para este tipo e esta natureza. */
export interface CamposDoTipo {
  /**
   * O seletor "Despesa" x "Gasto no Cartao" (HMO-254).
   *
   * So a DESPESA tem: `lugaresDoTipo("income")` devolve um lugar so, e um
   * seletor de uma opcao e enfeite que ocupa a linha mais alta do formulario.
   * Era `true` nas duas telas quando ele tinha tres itens (HMO-170).
   */
  natureza: boolean;
  /**
   * A checkbox "Fixa" -- o eixo que saiu do seletor (HMO-254).
   *
   * Existe nas DUAS telas, porque a receita fixa (salario) e o caso da HMO-170
   * e ele nao tem outro caminho. Nao existe EDITANDO, pela razao de sempre: o
   * que esta gravado e um lancamento, e uma regra se edita em Contas Previstas
   * (`lib/recorrencia-edicao.ts`).
   */
  fixa: boolean;
  /** "Fixa" x "Fixa (todo mes)" -- o rotulo muda com o lugar. */
  rotuloDaFixa: string;
  /** A frase sob a checkbox "Fixa": ela diz o que marcar vai GRAVAR. */
  ajudaDaFixa: string;
  /** O dia do vencimento da regra mensal. So natureza fixa. */
  diaDeVencimento: boolean;
  /** "Todos os meses" x "por N meses". So natureza fixa (HMO-170). */
  duracao: boolean;
  /** Parcelar em N vezes. So despesa, e so criando. */
  parcelamento: boolean;
  /** Dividir com grupo ou conexoes. So despesa. */
  rateio: boolean;
  /** O seletor de conta e obrigatorio (gasto no cartao). */
  contaObrigatoria: boolean;
  /**
   * O seletor "em qual fatura isso cai" (HMO-281 / HMO-289).
   *
   * So na COMPRA no cartao (`natureza === "card"`). Fora do cartao a pergunta
   * nao tem resposta -- uma despesa em conta corrente nao cai em fatura nenhuma
   * --, e na assinatura cobrada no cartao (`card_fixed`) ela tem resposta mas
   * nao tem onde ser gravada: aquele lancamento vira regra em `recurring_rules`,
   * que nao tem a coluna. O porque longo esta em `camposDoTipo`.
   *
   * Vale EDITANDO, ao contrario de `parcelamento`: a escolha da fatura e um
   * campo da propria linha, e nao a criacao de N linhas novas. Trocar a fatura
   * de uma compra ja gravada e justamente o conserto de quem lancou errado --
   * e e o motivo de `gravarTransacao` mandar o campo tambem no `update`.
   */
  faturaDoLancamento: boolean;
  /** O rotulo do seletor de conta muda com a natureza. */
  rotuloDaConta: string;
  /** O rotulo do seletor de natureza muda com o tipo. */
  rotuloDaNatureza: string;

  /**
   * A checkbox "ja paguei" / "ja recebi" (HMO-188).
   *
   * Nao aparece em natureza FIXA -- uma regra mensal ja e previsao por
   * definicao, e a confirmacao dela acontece mes a mes em Contas Previstas.
   * Nao aparece EDITANDO: o que esta gravado e uma transacao, ou seja dinheiro
   * que ja andou e que ja esta no saldo da conta. Desmarcar a checkbox ali
   * significaria apagar a transacao e criar uma previsao no lugar -- e o
   * caminho de volta ja existe e e outro (o estorno da baixa, em Contas
   * Previstas).
   */
  confirmacao: boolean;
  /**
   * O campo da data em que o dinheiro ANDOU. Some quando a pessoa desmarca a
   * confirmacao: um lancamento que ainda nao aconteceu nao tem data de
   * pagamento, e deixar o campo na tela com a data de hoje faria ela parecer
   * uma resposta.
   *
   * Some tambem em natureza FIXA (HMO-247) -- ver `camposDoTipo`.
   */
  dataDeRealizacao: boolean;
  /** O campo da data PREVISTA. Nao aparece em natureza fixa: la quem diz quando e `diaDeVencimento`. */
  dataPrevista: boolean;
  /** O rotulo do campo de data muda com o tipo: pagamento x recebimento. */
  rotuloDaData: string;
  /** O rotulo da data prevista diz se ela e obrigatoria. */
  rotuloDaDataPrevista: string;
  /** "Ja paguei" x "Ja recebi". */
  rotuloDaConfirmacao: string;
}

/**
 * Nada aqui olha para o estado da tela alem do que esta na assinatura: e uma
 * funcao de tres entradas, e e ela que o teste de renderizacao usa como
 * oraculo do que devia estar em tela.
 *
 * `editando` derruba parcelamento e despesa fixa de proposito. Uma transacao
 * ja gravada e um lancamento, nao uma regra -- e parcelar o que ja existe
 * exigiria desfazer a linha e criar N no lugar.
 */
export function camposDoTipo(
  tipo: TipoLancamento,
  natureza: NaturezaDespesa,
  editando: boolean,
  // Default `true` de proposito: todo chamador anterior a HMO-188 passava tres
  // argumentos, e o comportamento deles era o do lancamento CONFIRMADO -- a
  // tela gravava a transacao direto. Um default `false` mudaria o que aqueles
  // chamadores veem sem que nenhum deles tenha mudado de linha.
  confirmado: boolean = true
): CamposDoTipo {
  // Uma regra de repeticao so se CRIA aqui; editar uma que existe e outra
  // tela, porque a pergunta "muda so este mes ou os proximos tambem?" nao tem
  // resposta sobre um lancamento ja gravado. Ver `lib/recorrencia-edicao.ts`.
  // `ehNaturezaFixa` e nao `natureza === "fixed"` (HMO-254): a regra cobrada no
  // cartao e fixa do mesmo jeito, e a comparacao crua a deixaria com campo de
  // data, checkbox de "ja paguei" e destino `transacao` -- a assinatura viraria
  // uma compra avulsa. Ver o aviso no tipo `NaturezaDespesa`.
  const ehFixa = ehNaturezaFixa(natureza) && !editando;

  // -------------------------------------------------------------------------
  // UM GASTO NO CARTAO JA ACONTECEU (HMO-209)
  // -------------------------------------------------------------------------
  // "Ja paguei?" nao e uma pergunta que caiba numa compra no cartao, e a
  // resposta errada custava dinheiro na tela: com a checkbox desmarcada a
  // compra ia para `scheduled_transactions` com o `account_id` do cartao, e
  // aparecia em Contas a Pagar AO LADO da fatura cheia daquele cartao -- a
  // mesma compra cobrada duas vezes, uma individual e outra dentro da fatura.
  //
  // A compra aconteceu no ato: ela rebaixa o saldo do cartao (a divida) agora,
  // e e `transaction_date` que `card_invoice_month()` usa para decidir em que
  // fatura ela cai. O que ainda nao aconteceu e o PAGAMENTO DA FATURA, que e
  // outro ato, em outra tela (`lib/card-invoice.ts`), com duas pernas
  // `transfer` para nao contar a despesa de novo.
  //
  // Por isso a data CONTINUA na tela -- so deixa de ser "data do pagamento" e
  // passa a ser "data da compra" --, e o que sai sao a checkbox e a data
  // prevista: uma previsao de pagamento para uma linha que nao espera pagamento
  // nenhum.
  //
  // Sem `editando` na condicao de proposito: uma compra no cartao nao tem data
  // prevista nem quando esta sendo editada, e `ehNoCartao` abaixo (o rotulo e a
  // obrigatoriedade do cartao) ja era assim.
  const ehCompraNoCartao = tipo === "expense" && natureza === "card";

  // A confirmacao so e uma PERGUNTA quando ha duas respostas possiveis. Em
  // natureza fixa nao ha: a regra e previsao por definicao. Editando tambem
  // nao: o que esta gravado ja mexeu no saldo. E no cartao nao ha: a compra
  // aconteceu.
  const confirmacao =
    !ehFixa && !editando && !ehNaturezaFixa(natureza) && !ehCompraNoCartao;
  // Quando a checkbox nao existe, `confirmado` nao pode mandar na tela. No
  // cartao essa leitura e a TRAVA da HMO-209: `destinoDoLancamento` decide pelo
  // `dataDeRealizacao` que sai daqui, entao o estado desmarcado herdado da
  // natureza anterior nao consegue mandar a compra para a agenda. Na edicao ela
  // e o que impede o Salvar de uma transacao gravada de virar previsao nova.
  const ehPrevisao = confirmacao && !confirmado;

  // -------------------------------------------------------------------------
  // A DESPESA FIXA NAO TEM CAMPO DE DATA (HMO-247)
  // -------------------------------------------------------------------------
  // A queixa e literal: "se escolhemos qual o dia do vencimento da despesa
  // fixa, nao precisamos ter o campo Data, isso tem confundido o usuario".
  //
  // E a confusao nao e estetica. O campo era o `start_date` da regra, nao um
  // vencimento -- mas na tela ele aparecia como "Data", logo abaixo de "Vence
  // todo dia 10", e nao havia nada que dissesse a diferenca. Duas datas, uma
  // pergunta: quem lia "Data" como "a data da primeira cobranca" preenchia 10
  // ali tambem, ou mudava o campo e nao via efeito nenhum -- porque `due_day` e
  // quem manda.
  //
  // Nao se perde resposta nenhuma ao tirar o campo: `firstOccurrence`
  // (lib/recurrence.ts) ja deriva a primeira ocorrencia do `due_day` a partir do
  // `start_date`, e a rota POST /api/recurring-rules ja defaulta `start_date`
  // para hoje. Uma regra que comeca hoje com vencimento no dia 10 cobra dia 10
  // deste mes se ele ainda nao passou, e do mes que vem se passou -- que e
  // exatamente o que a pessoa quer dizer ao escolher o dia.
  //
  // O par disto esta em `regraDeRecorrencia`: com o campo fora da tela,
  // `start_date` NAO pode mais sair de `valores.data`. O estado do formulario e
  // um objeto so, e uma data digitada em "pontual" sobrevive a troca para
  // "fixa" -- ela viraria um `start_date` no futuro, atrasando a primeira
  // cobranca por meses, com o campo invisivel e nenhum erro na tela.
  // O eixo "fixa" como PERGUNTA. Fora da edicao ele e sempre uma pergunta --
  // inclusive no cartao, que e a metade nova da HMO-254 ("voce escolhe, fixo ou
  // parcelado"). `ehFixa` acima e a RESPOSTA; esta e a existencia da checkbox, e
  // confundir as duas tiraria a checkbox da tela assim que ela fosse marcada,
  // deixando a pessoa sem como desmarcar.
  const fixa = !editando;

  const comum = {
    // So a despesa escolhe o lugar (HMO-254). Ver `lugaresDoTipo`.
    natureza: tipo === "expense",
    fixa,
    diaDeVencimento: ehFixa,
    duracao: ehFixa,
    confirmacao,
    dataDeRealizacao: !ehPrevisao && !ehFixa,
    // Em fixa quem diz quando e `diaDeVencimento`; um segundo campo de data
    // prevista ali seriam duas respostas para a mesma pergunta. No cartao a
    // compra ja aconteceu: nao ha o que prever.
    dataPrevista: !ehFixa && !ehCompraNoCartao,
    rotuloDaDataPrevista: ehPrevisao ? "Data prevista *" : "Data prevista",
  };

  if (tipo === "income") {
    return {
      ...comum,
      parcelamento: false,
      rateio: false,
      contaObrigatoria: false,
      // Receita nao tem cartao: `lugaresDoTipo("income")` devolve um lugar so, e
      // `contaObrigatoria` acima e `false` pela mesma razao. Um seletor de fatura
      // na tela de receita perguntaria em que fatura um salario cai.
      faturaDoLancamento: false,
      rotuloDaConta: "Conta de entrada",
      rotuloDaFixa: "Receita fixa (todo mês)",
      ajudaDaFixa:
        "Salário, aluguel recebido, mensalidade: vira uma regra mensal em Contas Previstas, que passa a prever essa entrada todo mês.",
      // O seletor nao existe mais na receita (`natureza: tipo === "expense"`),
      // mas o rotulo FICA preenchido: um `""` aqui seria um campo que a tela
      // ainda pode ler, e o dia em que a receita voltar a ter seletor ele
      // apareceria sem titulo. Ver `rotuloDaData` logo abaixo, pela mesma razao.
      rotuloDaNatureza: "Tipo de Receita *",
      // SEM UM RAMO PARA FIXA (HMO-247): o campo nao existe mais ali. Um
      // `ehFixa ? "Data"` sobrevivendo aqui seria rotulo de campo inexistente --
      // e o lugar exato onde o campo volta sem ninguem decidir que ele voltou.
      rotuloDaData: "Data do recebimento",
      rotuloDaConfirmacao: "Já recebi",
    };
  }

  // Inclui `card_fixed` (HMO-254): o seletor de conta e a obrigatoriedade dele
  // sao os mesmos da compra -- "so pode ser aplicado no cartao" vale para a
  // assinatura tanto quanto para a compra avulsa.
  const ehNoCartao = ehNaturezaNoCartao(natureza);

  return {
    ...comum,
    // PARCELAR E COISA DE CARTAO (HMO-211)
    //
    // O pedido e literal: "deve ser um checkbox abaixo do valor DO CARTAO". Ate
    // aqui a checkbox aparecia em toda despesa, e fora do cartao ela nao
    // funcionava: a rota gravava em `transaction_installments`, uma tabela sem
    // leitor nenhum no app, e a compra parcelada desaparecia de Lancamentos, de
    // Contas a Pagar e da fatura. Nao ha nada de util sendo retirado da tela.
    //
    // E nao e um buraco no produto. Uma serie fora do cartao tem a parcela N
    // paga e as seguintes nao, o que exigiria escrever em DUAS tabelas na mesma
    // operacao (`financial_transactions` + `scheduled_transactions`) -- e meia
    // serie gravada e dinheiro errado e plausivel. O caminho que faz isso certo
    // ja existe: despesa fixa com duracao "por N meses" (`max_occurrences`, 005)
    // gera as N ocorrencias em Contas a Pagar, cada uma baixada no mes dela. E o
    // que um financiamento ou um boleto em 10x e de verdade.
    // `natureza === "card"` E NAO `ehNoCartao` (HMO-254)
    //
    // "voce escolhe, fixo ou parcelado" -- as duas sao exclusivas, e e esta
    // linha que faz a exclusao. Marcar "Fixa" no cartao produz `card_fixed`, o
    // bloco de parcelamento sai da tela, e `validarLancamento` para de cobrar os
    // campos de parcela (ele so os cobra quando `campos.parcelamento`).
    //
    // A exclusao TEM de morar aqui e nao so no `onChange` da checkbox: o estado
    // do formulario e um objeto so, e `parcelado: true` sobrevive a marcacao da
    // checkbox. Com o bloco fora da tela e `campos.parcelamento` falso,
    // `destinoDoLancamento` nao consegue escolher "parcelas" -- o ramo dele exige
    // as duas coisas. Um `parcelado` esquecido no estado nao cria serie nenhuma.
    parcelamento: !editando && natureza === "card",
    rateio: true,
    contaObrigatoria: ehNoCartao,
    // `natureza === "card"` E NAO `ehNaturezaNoCartao` -- E A ISSUE PEDIA O
    // SEGUNDO
    //
    // A HMO-289 especificou `tipo === "expense" && ehNaturezaNoCartao(natureza)`,
    // "o mesmo eixo que ja governa `contaObrigatoria` e `parcelamento`". Mas
    // aquele eixo nao e um: `contaObrigatoria` usa `ehNoCartao` e `parcelamento`
    // usa `natureza === "card"`, e esta pergunta fica do lado do `parcelamento`.
    //
    // O motivo e o DESTINO, nao a tela. Em `card_fixed` o
    // `destinoDoLancamento` devolve "regra": o lancamento vira linha de
    // `recurring_rules`, e `recurring_rules` NAO TEM `invoice_month_override`
    // (a 041 pos a coluna em `financial_transactions`). Com `ehNoCartao` aqui, a
    // assinatura do cartao mostraria o seletor de faturas, a pessoa escolheria
    // marco, e a escolha seria descartada em silencio -- nenhum erro, nenhum
    // campo faltando, e a cobranca caindo na fatura da data de cada ocorrencia.
    // Oferecer a escolha e joga-la fora e pior que nao oferecer: a tela afirma
    // uma coisa que o banco nao guarda.
    //
    // E nao ha resposta a dar ali: quem decide a fatura de cada ocorrencia de
    // uma regra mensal e a data em que ela for materializada, doze faturas
    // diferentes ao longo do ano. "Em qual fatura isso cai" nao e uma pergunta
    // com uma resposta quando o lancamento e uma regra.
    //
    // `editando` NAO entra: ver `faturaDoLancamento` no tipo.
    faturaDoLancamento: natureza === "card",
    // "Conta/Cartao" SAIU (HMO-254): o cartao nao esta mais nesta lista. Ver
    // `contasDoSeletor` -- o rotulo e a lista tem de dizer a mesma coisa, senao
    // o titulo oferece um cartao que o seletor nao tem.
    rotuloDaConta: ehNoCartao ? "Cartão *" : "Conta",
    rotuloDaFixa: ehNoCartao ? "Fixa (todo mês)" : "Fixa",
    ajudaDaFixa: ehNoCartao
      ? "Assinatura ou mensalidade cobrada no cartão todo mês: vira uma regra mensal, e não uma compra única."
      : "Vira uma regra mensal em Contas Previstas, que passa a cobrar você todo mês.",
    rotuloDaNatureza: "Tipo de Despesa *",
    // "Data do pagamento" no cartao seria a pergunta errada: o que esta sendo
    // anotado e a COMPRA, e o rotulo e a unica coisa na tela que diz isso. A
    // data tambem nao e cosmetica -- e ela que decide em que fatura a compra
    // cai (`card_invoice_month()`).
    //
    // Sem ramo para fixa (HMO-247) -- ver o comentario gemeo no ramo da receita.
    rotuloDaData: ehNoCartao ? "Data da compra" : "Data do pagamento",
    rotuloDaConfirmacao: "Já paguei",
  };
}

/**
 * As categorias que cabem neste tipo.
 *
 * O catalogo do aparelho (modo offline) guarda as duas naturezas juntas, entao
 * o filtro precisa existir mesmo sem rede -- nao da para confiar em uma
 * consulta filtrada no servidor.
 */
export function categoriasDoTipo<T extends { is_expense: boolean }>(
  categorias: T[],
  tipo: TipoLancamento
): T[] {
  const querDespesa = tipo === "expense";
  return categorias.filter((c) => c.is_expense === querDespesa);
}

/**
 * As contas que cabem no seletor.
 *
 * "Gasto no cartao" so lista cartao de credito. E o `account_type` que faz a
 * compra entrar na fatura -- apontar para a conta corrente gravaria um gasto
 * que sai do saldo hoje, que e o oposto do que a pessoa pediu.
 *
 * ---------------------------------------------------------------------------
 * E A DESPESA NAO LISTA CARTAO NENHUM (HMO-254)
 * ---------------------------------------------------------------------------
 * "so poder ser lancada em contas correntes". O recorte era de UMA via: o
 * cartao filtrava a lista para cartoes, e todo o resto mostrava a lista inteira
 * -- cartoes inclusos. Escolher "Despesa Pontual" e apontar para o cartao
 * gravava uma `financial_transactions` com o `account_id` do cartao, que e
 * exatamente a linha que a view `card_invoice_lines` (006/035) recolhe: a
 * despesa entrava na fatura do mes, sem ter passado por nenhuma das travas do
 * caminho do cartao. O rotulo "Conta/Cartao" convidava para isso.
 *
 * O que se perdia nao era so arrumacao. O caminho "Despesa Pontual + cartao"
 * oferece a checkbox "Ja paguei" (`ehCompraNoCartao` e falso ali, porque ele
 * olhava `natureza === "card"`), e desmarcada ela manda a compra para
 * `scheduled_transactions` com o `account_id` do cartao -- o defeito da HMO-209
 * inteiro, pela porta ao lado da que foi fechada. Com o cartao fora desta lista
 * a porta nao existe mais: nao ha como apontar uma despesa de conta para um
 * cartao.
 *
 * "CONTA CORRENTE" AQUI E "NAO E CARTAO", E NAO `account_type = 'checking'`.
 * Dinheiro, carteira digital e cartao de debito sao onde as despesas do dia a
 * dia acontecem, e todos tres moram na tela "Contas" (`escopoDoTipo`, em
 * lib/contas.ts). Recortar pelo literal `checking` tiraria do seletor as contas
 * que mais recebem lancamento, e a pessoa nao teria onde lancar o almoco pago
 * em dinheiro. O recorte e o mesmo que `contasDeOrigem` (lib/transferencia.ts)
 * ja usa, pelo mesmo motivo e com o mesmo literal.
 *
 * A RECEITA FICA COMO ESTAVA, de proposito: a HMO-254 fala de despesa, e um
 * estorno lancado como entrada no cartao e um caso real que esta tela e a unica
 * a cobrir hoje. Tirar o cartao daqui tambem apagaria aquele caminho sem que
 * nenhuma issue tenha pedido -- e sem aviso na tela de quem usa.
 */
export function contasDoSeletor<T extends { account_type?: string | null }>(
  contas: T[],
  tipo: TipoLancamento,
  natureza: NaturezaDespesa
): T[] {
  if (tipo !== "expense") return contas;
  // `ehNaturezaNoCartao` e nao `=== "card"`: a regra mensal cobrada no cartao
  // (`card_fixed`) precisa do MESMO seletor de cartoes. Com a comparacao crua
  // ela cairia no ramo de baixo e listaria tudo MENOS cartoes -- um "Gasto Fixo
  // no Cartao" sem nenhum cartao para escolher, e `contaObrigatoria` cobrando um
  // campo que a tela nao consegue preencher.
  if (ehNaturezaNoCartao(natureza)) {
    return contas.filter((c) => c.account_type === "credit_card");
  }
  return contas.filter((c) => c.account_type !== "credit_card");
}

/**
 * O estado do formulario. Uma so forma para as duas telas: a de receita
 * carrega os campos de despesa sem usar, e isso e melhor que dois objetos que
 * divergem -- `camposDoTipo` e quem decide o que vai para a tela, e
 * `validarLancamento` e quem decide o que conta.
 */
export interface ValoresDeLancamento {
  descricao: string;
  /** Como veio do input: string, ainda nao numero. */
  valor: string;
  categoriaId: string;
  /**
   * A subcategoria, dentro da categoria escolhida (HMO-216).
   *
   * Opcional no tipo, e nao `string` com `""`, porque ela e opcional no banco:
   * `financial_transactions.subcategory_id` e nulavel, e a FK COMPOSTA da 036
   * usa `MATCH SIMPLE` -- lancamento sem subcategoria passa, e lancamento COM
   * subcategoria e obrigado a usar uma daquela categoria.
   *
   * Quem mantem as duas coerentes na tela e `subcategoriaCoerente`
   * (lib/categorias.ts): trocar de categoria sem trocar isto aqui e o caminho
   * direto para um 23503 na hora de salvar.
   *
   * NAO entra em conta nenhuma. Subcategoria nao muda sinal, nao muda natureza
   * e nao e somada: `valorGravado` e `validarLancamento` a ignoram de
   * proposito, e quem soma continua somando por categoria.
   */
  subcategoriaId?: string;
  contaId: string;
  /**
   * Quando o dinheiro ANDOU (YYYY-MM-DD). Vai para
   * `financial_transactions.transaction_date`, que e a coluna que todo
   * relatorio soma para dizer em que mes houve entrada ou saida.
   *
   * Nao e o dia do lancamento: esse e `launch_date`, que a tela nao pede porque
   * ela SABE (e hoje) e o banco tem DEFAULT para ele.
   */
  data: string;
  /**
   * Quando se esperava que acontecesse (YYYY-MM-DD, HMO-188).
   *
   * Dois destinos, dependendo de `confirmado`:
   *   confirmado  -> `financial_transactions.expected_date`, ao lado da data
   *                  real. E o que permite responder "pagou atrasado?".
   *   previsto    -> `scheduled_transactions.due_date`, o vencimento da conta
   *                  que ainda vai acontecer.
   */
  dataPrevista: string;
  /**
   * A pessoa ja pagou (despesa) ou ja recebeu (receita)? (HMO-188)
   *
   * `true` grava uma transacao, como sempre foi. `false` grava uma conta
   * PREVISTA -- e essa e a diferenca que importa, porque toda linha de
   * `financial_transactions` mexe no saldo da conta no instante do INSERT
   * (`update_account_balance_trigger`) e entra no realizado de todo relatorio.
   * Um lancamento nao confirmado gravado ali sairia gastando dinheiro que nao
   * saiu.
   *
   * Nasce `true`: o caso comum e anotar o que acabou de acontecer.
   */
  confirmado: boolean;
  notas: string;

  /**
   * Onde o lancamento acontece E se ele e fixo, num campo so. As duas telas
   * usam (HMO-170).
   *
   * NAO LEIA ESTE CAMPO COM `===` nos dois eixos: use `ehNaturezaFixa` e
   * `ehNaturezaNoCartao`, e escreva por `naturezaDoLugar` (HMO-254).
   */
  natureza: NaturezaDespesa;
  diaDeVencimento: string;
  /** Se repete sem fim ou por um numero de meses (HMO-170). */
  duracao: DuracaoDaRepeticao;
  /** Como veio do input: string, ainda nao numero. So vale com `contada`. */
  mesesDeRepeticao: string;

  /**
   * A moeda deste lancamento (ISO 4217, migration 022).
   *
   * SEMPRE preenchida, inclusive quando o seletor esta desligado nas
   * configuracoes -- e nesse caso vale a moeda da conta, ou a oficial. Deixar
   * vazia "quando nao importa" faria o campo virar `undefined` no corpo do POST
   * e o valor cair no DEFAULT do banco, o que esta certo para BRL e apaga a
   * moeda de quem usa outra.
   */
  moeda: string;
  /**
   * A checkbox "esta em outra moeda", que REVELA o seletor -- e o que a issue
   * pede literalmente ("uma checkbox ... caso a pessoa ative aparecer um select
   * pra escolher qual moeda usar naquele lancamento").
   *
   * Ela nao e a moeda: e o estado da tela. Desmarcar volta `moeda` para a
   * sugestao da conta, para que a pessoa nao grave em dolar um lancamento cuja
   * checkbox ela desmarcou -- o campo sumiria da tela com o valor dele ainda no
   * estado.
   */
  moedaSobreposta: boolean;

  /**
   * A cotacao do dia da compra, como veio do input: string, ainda nao numero
   * (HMO-182, migration 026).
   *
   * Quantos REAIS vale uma unidade de `moeda`. Vazia quando `moeda` e BRL, e
   * obrigatoria quando nao e -- nao por preciosismo de formulario, mas porque a
   * 026 pos um CHECK que cruza as duas colunas no banco:
   *
   *     CHECK ((currency = 'BRL') = (exchange_rate = 1))
   *
   * A coluna nasceu com DEFAULT 1. Um lancamento em dolar que nao mande cotacao
   * monta a linha (USD, 1), que e exatamente o par proibido -- e o INSERT volta
   * 23514, um erro que quem esta preenchendo nao tem como consertar sozinho. Por
   * isso este campo existe no ESTADO e nao so na tela: o valor tem de chegar ao
   * payload.
   *
   * Quem valida e `validarLancamento` aqui embaixo (a regra tambem esta em
   * lib/cambio.ts, em `cotacaoCoerente`, para quem precisa dela fora do
   * formulario).
   */
  cotacao: string;

  /**
   * Em qual FATURA esta compra cai, em 'AAAA-MM' (HMO-281 / HMO-289).
   *
   * Vai para `financial_transactions.invoice_month_override` como
   * '<mes>-01' -- a 041 pos um CHECK que exige o dia 1, e `card_invoice_lines`
   * faz `COALESCE(override, card_invoice_month(transaction_date, closing_day))`.
   *
   * VAZIA QUER DIZER "NAO ESCOLHI", E NAO "mes zero". O override fica NULO e a
   * fatura volta a sair da data, que e a regra da 006 e o comportamento de antes
   * desta feature. E por isso que o vazio nao e recusado por
   * `validarLancamento`: a falha, se algum dia a tela deixar de preencher o
   * campo, e o app de ontem -- nao dinheiro na fatura errada.
   *
   * A DATA DA COMPRA NAO MUDA. `data` (`transaction_date`) continua sendo o dia
   * em que a compra aconteceu. Gravar dia 1 do mes escolhido ali apagaria um
   * fato: quebraria `expected_date` / "pagou atrasado?" (027), moveria a despesa
   * de mes em todo relatorio que agrupa por `transaction_date`, e mostraria a
   * compra num dia em que ela nao aconteceu.
   *
   * 'AAAA-MM' e nao 'AAAA-MM-01': o que a tela pergunta e um MES, o `<select>`
   * carrega meses, e o `-01` e detalhe da coluna. Quem o acrescenta e o unico
   * lugar que escreve na coluna.
   */
  mesDaFatura: string;

  // So despesa usa daqui para baixo.
  parcelado: boolean;
  /**
   * O que o campo de valor significa quando `parcelado` (HMO-211). Nao ha mais
   * um segundo campo de dinheiro: `valor` e o unico, e este campo e a resposta
   * da pergunta sobre ele.
   */
  baseDoValorParcelado: BaseDoValorParcelado;
  /**
   * O N de "parcela N de M", COMO TEXTO. "1" e a compra que esta comecando
   * agora.
   *
   * TEXTO E NAO NUMERO, E ISSO E O CONSERTO DA HMO-226
   * ---------------------------------------------------
   * Enquanto estes dois campos eram `number`, o input controlado por eles nao
   * tinha estado vazio: apagar o conteudo de um `<input type="number">` entrega
   * `""`, `parseInt("")` e `NaN`, e o `NaN || 1` do `onChange` repunha o "1" no
   * mesmo quadro. O Backspace nao funcionava, e quem queria 6 digitava ao lado
   * do "1" e produzia 16.
   *
   * NAO ha um rascunho de texto em paralelo ao numero: dois campos para a mesma
   * quantidade divergem no primeiro caminho que esqueca de atualizar os dois, e
   * a divergencia aparece como valor GRAVADO diferente do valor na tela. Com um
   * campo so, de texto, a conversao para numero acontece numa borda unica --
   * `parcelaDigitada`, logo abaixo -- e o `tsc` aponta todo ponto que le o
   * campo.
   */
  parcelaAtual: string;
  /** O M de "parcela N de M", como texto. Ver `parcelaAtual`. */
  totalDeParcelas: string;
  compartilhado: boolean;
  grupoId: string;
  rateios: { participanteId: string; percentual: number }[];
}

export function hojeISO(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * O dia do vencimento digitado cabe no mes? (1 a 31, inteiro.)
 *
 * Existe exportado porque DOIS lugares precisam da mesma resposta: a recusa em
 * `validarLancamento` e a frase "a primeira cobranca e no proximo dia N" que a
 * tela mostra ao lado do campo (HMO-247). Com a regra escrita duas vezes, a tela
 * acabaria prometendo a primeira cobranca de um dia 0 ou 45 que a validacao
 * recusa -- texto afirmando um vencimento que nunca vai existir.
 *
 * `Number("")` e 0 e `Number("  ")` tambem: o campo vazio reprova por aqui, sem
 * precisar de um teste de string separado.
 */
export function diaDeVencimentoValido(bruto: string): boolean {
  const dia = Number(bruto);
  return Number.isInteger(dia) && dia >= 1 && dia <= 31;
}

/**
 * O mes da fatura digitado da para ler? ('AAAA-MM', mes de 01 a 12.)
 *
 * SEGUNDA COPIA DA MESMA REGRA, DE PROPOSITO -- e a primeira e
 * `rotuloDaFatura` em lib/fatura-do-cartao.ts, que devolve `null` para o
 * ilegivel. A copia existe porque este modulo nao tem import nenhum (ver
 * `valoresIniciais`), e um import aqui derruba `test:lancamento` com
 * ERR_MODULE_NOT_FOUND -- o mesmo motivo de `moeda: "BRL"` nao ser
 * `MOEDA_PADRAO`.
 *
 * E quem impede as duas de divergir NAO e este comentario: e o caso "a recusa
 * daqui e o `null` de `rotuloDaFatura` concordam" em
 * scripts/test-fatura-do-cartao.mjs, que compila os DOIS modulos e compara
 * entrada por entrada. Sem ele, afrouxar um lado deixaria a tela imprimindo
 * "undefined de 2026" sobre um mes que a validacao aceitou.
 *
 * `-01` opcional como em `rotuloDaFatura`: a coluna e `date` e um valor que
 * volta do banco chega como 'AAAA-MM-01'. Aceitar as duas formas e o que
 * permite a EDICAO carregar o que esta gravado sem normalizar antes de validar.
 */
export function mesDaFaturaValido(bruto: string): boolean {
  if (!/^\d{4}-\d{2}(-\d{2})?$/.test(bruto)) return false;
  const mes = Number(bruto.slice(5, 7));
  return mes >= 1 && mes <= 12;
}

export function valoresIniciais(): ValoresDeLancamento {
  return {
    descricao: "",
    valor: "",
    categoriaId: "",
    contaId: "",
    data: hojeISO(),
    // A previsao nasce igual a data real, e nao vazia: no caso comum (anotar o
    // que acabou de acontecer) as duas SAO o mesmo dia, e um campo vazio pediria
    // uma resposta que a pessoa nao precisa dar. Quem pagou atrasado muda uma
    // das duas.
    dataPrevista: hojeISO(),
    confirmado: true,
    notas: "",
    natureza: "one_off",
    diaDeVencimento: "",
    // "indefinida" e o padrao porque e o caso comum de um gasto fixo (aluguel,
    // escola, salario): ele nao tem fim previsto. Quem tem prazo digita.
    duracao: "indefinida",
    mesesDeRepeticao: "",
    // A tela sobrescreve com a moeda da conta / a oficial assim que a
    // preferencia carrega. Este e o fallback de antes disso.
    //
    // LITERAL, e nao `MOEDA_PADRAO` de lib/dinheiro.ts, porque este arquivo nao
    // tem import NENHUM de proposito -- `test:lancamento` o compila sozinho
    // (`tsc lib/lancamento.ts`), sem o passo que reescreve o alias `@/`, e um
    // import aqui derrubaria a suite com ERR_MODULE_NOT_FOUND. Quem impede a
    // terceira copia de divergir e o caso "o padrao daqui e o mesmo de
    // MOEDA_PADRAO" em scripts/test-moeda.mjs, que compila os dois modulos e
    // compara.
    moeda: "BRL",
    moedaSobreposta: false,
    // Vazia, e nao "1": um lancamento em BRL nao tem cotacao para exibir, e o
    // que vai para o banco sai de `taxaParaGravar` (lib/cambio.ts), que devolve
    // 1 para BRL sem olhar para este campo.
    cotacao: "",
    // VAZIA, e nao o mes corrente. Dois motivos, e o segundo e o que importa:
    //
    //   1. este modulo nao tem import NENHUM (ver `moeda` acima), entao
    //      `faturaPadraoDoLancamento` -- que mora em lib/fatura-do-cartao.ts
    //      porque precisa de `periodoDaQuery` -- nao pode ser chamada daqui.
    //   2. o padrao depende da TELA DE ORIGEM (`?de=&ate=`), que `valoresIniciais`
    //      nao conhece. Um mes corrente fixo aqui seria a resposta errada para
    //      quem abriu o formulario de dentro de outubro em novembro -- e, pior,
    //      ele viria do fuso do servidor na renderizacao do Next, nao do fuso de
    //      Sao Paulo onde o cartao fecha.
    //
    // Quem preenche e o formulario, no mesmo `useEffect` que ja sobrescreve a
    // moeda. Enquanto estiver vazia a compra cai na fatura da data, que e a
    // regra da 006.
    mesDaFatura: "",
    parcelado: false,
    // "parcela" e nao "total" porque e a leitura que a maquininha do cartao da:
    // "10x de R$ 100". Nenhuma das duas e inofensiva como padrao, entao a tela
    // mostra a conta feita (parcela E total) antes de salvar -- ver
    // `resumoDaSerie`.
    baseDoValorParcelado: "parcela",
    parcelaAtual: "1",
    // "1" e nao "2": um formulario novo nao esta parcelando, e
    // `validarLancamento` so cobra `>= 2` quando a checkbox esta marcada. Abrir
    // em 2 faria o campo sugerir uma resposta para uma pergunta que nao foi
    // feita.
    //
    // E "1" e nao "": o padrao TEM de ser visivel. O campo vazio e um estado
    // que agora existe (ver `parcelaAtual` no tipo), mas ele e o estado de quem
    // esta no meio de digitar, nao o estado de quem abriu a tela.
    totalDeParcelas: "1",
    compartilhado: false,
    grupoId: "",
    rateios: [],
  };
}

/**
 * A BORDA UNICA entre o texto dos campos de parcela e os numeros N e M.
 *
 * Devolve `NaN` para tudo que nao seja um inteiro nao-negativo escrito por
 * extenso -- e `NaN` e deliberado, porque `Number.isInteger(NaN)` e `false` e
 * toda guarda que ja existe (aqui, em `serieDeParcelas` e na rota) o recusa sem
 * precisar de um caso novo.
 *
 * POR QUE O REGEX, E NAO `parseInt` NEM `Number`
 * -----------------------------------------------
 * As duas conversoes prontas inventam um numero onde nao ha:
 *
 *   parseInt("")    -> NaN   (ok)   mas  parseInt("6x")  -> 6
 *   parseInt("1.5") -> 1            e    Number("")      -> 0
 *   Number(" ")     -> 0            e    Number("1e3")   -> 1000
 *
 * O `0` de `Number("")` e o mais perigoso: ele passa por `Number.isInteger`, e
 * o campo vazio chegaria ao banco como uma quantidade de parcelas. O `6` de
 * `parseInt("6x")` e o mesmo problema de outra forma -- a tela mostra uma coisa
 * e a borda le outra.
 *
 * `|| 1` aqui seria o bug da HMO-226 de volta, so que escondido um nivel mais
 * fundo: cair em 1 e o que faz uma "compra parcelada em 1 vez" ser gravada sem
 * ninguem ter pedido.
 */
export function parcelaDigitada(texto: string): number {
  const limpo = texto.trim();
  if (!/^\d+$/.test(limpo)) return Number.NaN;
  return Number(limpo);
}

export interface ContextoDaValidacao {
  /** A categoria escolhida, para conferir se ela combina com o tipo. */
  categoria?: CategoriaDeLancamento | null;
  editando: boolean;
}

export type Validacao = { ok: true } | { ok: false; mensagem: string };

/**
 * O lancamento pode ser gravado?
 *
 * A ordem das recusas importa: a mais especifica primeiro, porque a mensagem
 * generica ("preencha os campos") manda a pessoa procurar no lugar errado.
 */
export function validarLancamento(
  tipo: TipoLancamento,
  valores: ValoresDeLancamento,
  contexto: ContextoDaValidacao
): Validacao {
  if (!valores.descricao.trim()) {
    return { ok: false, mensagem: "Informe a descrição." };
  }

  if (!valores.categoriaId) {
    return { ok: false, mensagem: "Escolha uma categoria." };
  }

  // -----------------------------------------------------------------------
  // A CATEGORIA TEM QUE COMBINAR COM A TELA
  // -----------------------------------------------------------------------
  // Na tela antiga o sinal do valor saia de um `||`: era negativo se o tipo
  // fosse despesa OU se a categoria fosse de despesa. Com uma tela por tipo, o
  // sinal passa a sair da ROTA -- e e por isso que esta checagem entra.
  //
  // Sem ela, uma receita com categoria de despesa (o catalogo offline tem as
  // duas, e o link de edicao carrega um `category_id` de fora) gravaria
  // `transaction_type = "income"` com valor NEGATIVO. `resumoDoPeriodo` usa
  // `Math.abs` para exibir, entao a tela mostraria o valor certo em Receitas
  // enquanto todo agregado que soma a coluna crua teria a receita subtraindo.
  // O erro nao apareceria na tela que o produziu.
  if (contexto.categoria) {
    const categoriaEhDespesa = contexto.categoria.is_expense;
    if (categoriaEhDespesa !== (tipo === "expense")) {
      return {
        ok: false,
        mensagem:
          tipo === "expense"
            ? "Essa categoria é de receita. Lance por Nova Receita."
            : "Essa categoria é de despesa. Lance por Nova Despesa.",
      };
    }
  }

  const campos = camposDoTipo(
    tipo,
    valores.natureza,
    contexto.editando,
    valores.confirmado
  );

  // A data real so e cobrada quando a tela a MOSTRA. Num lancamento previsto ela
  // esta escondida, e cobra-la mandaria a pessoa preencher um campo que nao
  // existe -- o defeito classico de validar o estado em vez da tela.
  if (campos.dataDeRealizacao && !/^\d{4}-\d{2}-\d{2}$/.test(valores.data)) {
    return { ok: false, mensagem: "Informe a data." };
  }

  // A data prevista e obrigatoria exatamente quando ela e a UNICA data do
  // lancamento: previsto sem vencimento nao tem onde aparecer na agenda.
  if (
    campos.dataPrevista &&
    !campos.dataDeRealizacao &&
    !/^\d{4}-\d{2}-\d{2}$/.test(valores.dataPrevista)
  ) {
    return {
      ok: false,
      mensagem:
        tipo === "expense"
          ? "Informe a data prevista para o pagamento."
          : "Informe a data prevista para o recebimento.",
    };
  }

  // Confirmado, ela e opcional -- mas se estiver preenchida tem que ser data.
  // Uma string pela metade ("2026-1") viraria `expected_date` invalida e o
  // PostgREST responderia 22007 traduzido para "Erro ao gravar o lancamento".
  if (
    campos.dataPrevista &&
    campos.dataDeRealizacao &&
    valores.dataPrevista.trim() !== "" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(valores.dataPrevista)
  ) {
    return { ok: false, mensagem: "A data prevista está incompleta." };
  }

  if (campos.contaObrigatoria && !valores.contaId) {
    // Duas frases porque sao duas perguntas (HMO-254). "Em qual cartao FOI o
    // gasto" pergunta pelo passado, e numa regra mensal nada foi ainda -- a
    // pessoa procuraria na tela por uma compra que ela nao esta lancando.
    return {
      ok: false,
      mensagem: ehNaturezaFixa(valores.natureza)
        ? "Escolha em qual cartão essa despesa é cobrada todo mês."
        : "Escolha em qual cartão foi o gasto.",
    };
  }

  // -----------------------------------------------------------------------
  // A FATURA ESCOLHIDA (HMO-281 / HMO-289)
  // -----------------------------------------------------------------------
  // Duas recusas, e elas NAO sao a mesma com o sinal trocado.
  const mesDaFaturaEscrito = valores.mesDaFatura.trim();

  if (campos.faturaDoLancamento) {
    // ILEGIVEL E RECUSADO; VAZIO NAO.
    //
    // Vazio quer dizer "nao escolhi", e o efeito dele e o app de antes desta
    // feature: o override fica NULO e a fatura sai da data (006). Cobrar o campo
    // aqui transformaria uma tela que ainda nao terminou de carregar -- o
    // `useEffect` que preenche o padrao roda DEPOIS do primeiro render -- numa
    // recusa que a pessoa nao tem como entender.
    //
    // Ilegivel e outra coisa: '2026-13' e '2026-1' chegariam a coluna `date` e o
    // PostgREST responderia 22007/22008 traduzido para "Erro ao gravar o
    // lancamento", sem dizer qual campo. Pior, '2026-13' NAO e recusado pelo
    // CHECK da 041 por ser mes 13 -- ele e recusado por nao ser uma data, e a
    // mensagem fala de sintaxe.
    if (mesDaFaturaEscrito !== "" && !mesDaFaturaValido(mesDaFaturaEscrito)) {
      return { ok: false, mensagem: "Escolha em qual fatura essa compra cai." };
    }
  } else if (mesDaFaturaEscrito !== "") {
    // FORA DA COMPRA NO CARTAO, UM MES ESCOLHIDO E ESTADO VELHO -- e ele e
    // ALCANCAVEL: o estado do formulario e um objeto so, entao escolher o cartao,
    // escolher a fatura de dezembro e depois voltar o seletor para "Despesa"
    // deixa 'AAAA-MM' parado no estado com o campo fora da tela.
    //
    // Recusar e nao ignorar, porque as duas saidas nao contam a mesma historia.
    // `gravarTransacao` manda `null` fora do cartao, entao ignorar daria dinheiro
    // CERTO -- e descartaria em silencio uma escolha que a pessoa fez de
    // proprio punho. Ela sairia da tela achando que a despesa foi para dezembro.
    //
    // E a frase diz o que aconteceu, nao "preencha os campos": o campo que ela
    // precisa olhar nao esta mais na tela.
    return {
      ok: false,
      mensagem: ehNaturezaFixa(valores.natureza)
        ? "Escolher a fatura só vale para uma compra no cartão. Numa despesa fixa, cada cobrança cai na fatura do mês dela."
        : "Escolher a fatura só vale para uma compra no cartão. Volte o tipo para “Gasto no Cartão” ou refaça a escolha.",
    };
  }

  // A MESMA funcao que a tela usa para decidir se mostra a frase "a primeira
  // cobranca e no proximo dia N" -- ver `diaDeVencimentoValido`.
  if (campos.diaDeVencimento && !diaDeVencimentoValido(valores.diaDeVencimento)) {
    return {
      ok: false,
      mensagem: "Informe o dia do vencimento, entre 1 e 31.",
    };
  }

  // Por quantos meses (HMO-170). So cobrado quando a tela MOSTRA o bloco: o
  // estado carrega `mesesDeRepeticao` nas duas telas, e cobrar sem olhar para
  // `campos.duracao` recusaria um lancamento pontual por causa de um campo que
  // ele nao tem.
  if (campos.duracao && valores.duracao === "contada") {
    const meses = Number(valores.mesesDeRepeticao);
    if (!Number.isInteger(meses) || meses < 2) {
      // Menos de 2 nao e repeticao: um mes so e o lancamento pontual, e
      // aceitar 1 aqui criaria uma REGRA que gera uma unica ocorrencia -- a
      // pessoa procuraria em Contas Previstas por uma cobranca mensal que
      // nunca vem de novo.
      return {
        ok: false,
        mensagem: "Por quantos meses? Informe 2 ou mais.",
      };
    }
    if (meses > MAX_MESES_DE_REPETICAO) {
      return {
        ok: false,
        mensagem: `No máximo ${MAX_MESES_DE_REPETICAO} meses. Para algo sem fim, escolha "todos os meses".`,
      };
    }
  }

  // AQUI HAVIA UMA GUARDA QUE DEIXOU DE SER ALCANCAVEL, E ELA FOI REMOVIDA
  //
  // Era a recusa de "parcelado + ainda nao paguei":
  //
  //   if (valores.parcelado && campos.parcelamento && !campos.dataDeRealizacao)
  //
  // Com o parcelamento restrito ao cartao (HMO-211), `campos.parcelamento` e
  // `campos.dataDeRealizacao` passaram a ser verdadeiros no MESMO e unico caso
  // -- `camposDoTipo` devolve `dataDeRealizacao: true` em todo gasto no cartao
  // (HMO-209), porque a compra no cartao ja aconteceu. A condicao e
  // contraditoria: nenhuma entrada a satisfaz.
  //
  // Guarda inalcancavel nao e cinto a mais, e uma trava que ninguem consegue
  // testar: quebre-a e todo teste continua verde, e ela passa a "proteger" um
  // estado que so existe num teste que forja o estado por fora. Quem garante o
  // mesmo invariante hoje e a ordem dos ramos em `destinoDoLancamento`, que TEM
  // teste -- e a negacao explicita de que nenhuma entrada com natureza `card`
  // sai como "previsao".

  // Parcelamento so existe onde `camposDoTipo` o mostra. Sem esta porta, uma
  // receita com `parcelado: true` no estado (ou uma edicao) cairia nas regras
  // de parcela, que a tela nem exibe -- e a mensagem falaria de um campo
  // invisivel.
  if (valores.parcelado && campos.parcelamento) {
    // A ORDEM DESTAS QUATRO RECUSAS E A ORDEM DOS CAMPOS NA TELA (HMO-211)
    //
    // O valor vem primeiro porque ele e o campo de cima, e e dele que a pergunta
    // "parcela ou total" fala. Depois M, depois N, depois a data. Recusar o N
    // antes do M faria a frase falar do segundo numero do par antes do primeiro.
    const valor = Number.parseFloat(valores.valor);
    if (!Number.isFinite(valor) || valor <= 0) {
      return { ok: false, mensagem: "Valor deve ser maior que zero." };
    }

    // A conversao do texto para numero acontece AQUI e em nenhum outro ponto
    // desta funcao -- ver `parcelaDigitada`.
    const totalDeParcelas = parcelaDigitada(valores.totalDeParcelas);
    const parcelaAtual = parcelaDigitada(valores.parcelaAtual);

    // O CAMPO VAZIO TEM FRASE PROPRIA, E NAO UM FALLBACK PARA 1 (HMO-226)
    //
    // Desde que o campo guarda texto, "" e um estado alcancavel: apagar o "1" e
    // apertar Enter envia o formulario SEM passar pelo `onBlur` que repoe o
    // padrao (a submissao implicita do HTML nao desfoca o campo antes). Era
    // tentador deixar o `|| 1` de antes cobrir este caso em silencio -- e e
    // exatamente isso que tornava o bug invisivel: o vazio virava 1, o 1 era
    // recusado por "deve ser 2 ou mais", e a frase mandava a pessoa consertar um
    // numero que ela nao digitou.
    //
    // Separado do `< 2` logo abaixo porque as duas situacoes pedem acoes
    // diferentes: aqui falta responder, lá a resposta esta errada.
    if (!Number.isInteger(totalDeParcelas)) {
      return {
        ok: false,
        mensagem: "Informe em quantas parcelas a compra foi dividida.",
      };
    }
    if (totalDeParcelas < 2) {
      return { ok: false, mensagem: "O total de parcelas deve ser 2 ou mais." };
    }
    if (totalDeParcelas > MAX_PARCELAS) {
      return {
        ok: false,
        mensagem: `No máximo ${MAX_PARCELAS} parcelas.`,
      };
    }

    // "PARCELA 12 DE 10" PRECISA DE UMA FRASE PROPRIA
    //
    // E o erro de digitacao mais provavel desta tela (os dois campos ficam lado
    // a lado, e o par esta invertido na metade das maquininhas). Sem esta
    // recusa, `serieDeParcelas` devolve `null` e o que o usuario veria e a
    // mensagem generica de valor -- mandando ele arrumar o campo certo pelo
    // motivo errado.
    //
    // O vazio tambem tem frase propria aqui, pelo mesmo motivo do M: "entre 1 e
    // 10" nao e um pedido acionavel para quem deixou o campo em branco.
    if (!Number.isInteger(parcelaAtual)) {
      return {
        ok: false,
        mensagem: "Informe qual parcela está sendo lançada.",
      };
    }
    if (parcelaAtual < 1 || parcelaAtual > totalDeParcelas) {
      return {
        ok: false,
        mensagem: `A parcela atual tem que estar entre 1 e ${totalDeParcelas}.`,
      };
    }

    // A DATA E A QUE JA ESTA NA TELA, E NAO UM CAMPO NOVO
    //
    // O bloco antigo tinha um campo "Primeira Parcela" proprio. O pedido nao
    // pede data nenhuma -- pede a checkbox, a pergunta "parcela ou total" e o
    // "N de M" -- e a tela do cartao JA tem a data certa desde a HMO-209: "Data
    // da compra", que e o que `card_invoice_month()` usa para decidir em que
    // fatura a parcela cai. Um segundo campo de data seriam duas respostas para
    // a mesma pergunta, e a errada seria a que o banco ignora.
    //
    // E NAO HA GUARDA DE `!valores.data` AQUI de proposito: a recusa generica
    // ("Informe a data.") ja roda bem antes deste ramo, no bloco de datas. Uma
    // segunda checagem da mesma coisa seria inalcancavel -- quebre-a e nenhum
    // teste fica vermelho, que e como uma trava morre sem ninguem notar.

    // O SUSPENSORIO: a propria funcao que vai gravar tem de aceitar as entradas.
    //
    // As recusas acima sao as frases uteis; esta e a garantia de que nenhuma
    // combinacao que elas deixem passar chega ao banco. Sem ela, uma regra nova
    // dentro de `serieDeParcelas` (um limite de valor, um formato de data)
    // viraria "Erro ao criar parcelas" sem dizer nada.
    if (
      !serieDeParcelas({
        valor: valores.valor,
        base: valores.baseDoValorParcelado,
        parcelaAtual,
        totalDeParcelas,
        vencimentoDaParcelaAtual: valores.data,
      })
    ) {
      return {
        ok: false,
        mensagem: "Não consegui montar as parcelas com esses valores.",
      };
    }

    return { ok: true };
  }

  if (valores.parcelado && contexto.editando) {
    return {
      ok: false,
      mensagem:
        "Não é possível parcelar um lançamento que já existe. Crie um novo.",
    };
  }

  const valor = Number.parseFloat(valores.valor);
  if (!Number.isFinite(valor) || valor <= 0) {
    return { ok: false, mensagem: "Valor deve ser maior que zero." };
  }

  // -----------------------------------------------------------------------
  // A COTACAO DE MOEDA ESTRANGEIRA (HMO-182)
  // -----------------------------------------------------------------------
  // POR ULTIMO, depois do valor, e nao junto da data. Os dois campos ficam
  // vazios num formulario novo, e "informe a cotacao do dolar" antes de "informe
  // o valor" manda a pessoa preencher o campo derivado antes do principal -- e a
  // cotacao e o unico dos dois que a tela sabe buscar sozinha.
  //
  // Esta recusa e o unico jeito de a pessoa ver uma frase util. Sem ela o INSERT
  // sai e o banco responde ao CHECK da 026 com
  //
  //     violates check constraint "financial_transactions_rate_matches_currency"
  //
  // que a tela traduz para "Erro ao gravar o lancamento." -- sem dizer qual
  // campo, sem dizer o que fazer, e num formulario onde o campo de cotacao pode
  // estar vazio justamente porque o Banco Central nao respondeu.
  //
  // O literal "BRL" (em vez de MOEDA_PADRAO de lib/dinheiro.ts) e deliberado:
  // este arquivo nao tem import nenhum, porque `test:lancamento` o compila
  // sozinho sem o passo que reescreve o alias `@/`. O literal repetido e coberto
  // pelo caso "o padrao daqui e o mesmo de MOEDA_PADRAO" em
  // scripts/test-moeda.mjs.
  if (valores.moeda !== "BRL") {
    // -----------------------------------------------------------------------
    // MOEDA ESTRANGEIRA NAO PODE FICAR PREVISTA (HMO-188)
    // -----------------------------------------------------------------------
    // A recusa vem ANTES de pedir a cotacao, porque pedir a cotacao seria pedir
    // um numero que nao existe: a PTAX de uma data futura nao esta publicada. A
    // 026 recusou dar `exchange_rate` a `scheduled_transactions` por essa razao
    // exata, e ela continua valendo.
    //
    // Sem esta recusa o caminho e silencioso e caro: a previsao gravaria a moeda
    // sem cotacao, e a BAIXA insere em `financial_transactions` sem mandar as
    // duas colunas -- o DEFAULT do banco e (BRL, 1). US$ 180 entrariam como
    // R$ 180, com a descricao certa e o saldo fechando. Um erro de 80% para
    // menos, sem erro nenhum.
    if (!campos.dataDeRealizacao) {
      return {
        ok: false,
        mensagem: `Em ${valores.moeda} não dá para deixar previsto: a cotação de uma data futura ainda não existe. Lance no dia em que ${tipo === "expense" ? "pagar" : "receber"}, com a cotação do dia.`,
      };
    }

    // A MESMA LEITURA DE `cotacaoDigitada` EM lib/cambio.ts, REPETIDA AQUI
    //
    // Repetida, e nao importada, pelo motivo acima. O risco de repetir e concreto
    // e vale nomear: se esta leitura fosse mais FROUXA que a de lib/cambio.ts, o
    // formulario aprovaria um texto que `taxaParaGravar` depois le como null,
    // cairia no `?? 1` do payload e tomaria o 23514 do banco -- uma recusa em
    // cima de um valor que a tela disse estar bom.
    //
    // O caso que separa as duas leituras e "1.234", um ponto de milhar: ler como
    // 1,234 aprova um numero que ninguem quis, e ler como 1234 gravaria mil vezes
    // o valor. As duas recusam. `scripts/test-cambio.mjs` compara as duas funcoes
    // numa tabela de entradas exatamente para impedir que uma mude sozinha.
    const cru = String(valores.cotacao).trim();
    const cotacao = /^\d{1,3}([.,]\d{1,8})?$/.test(cru)
      ? Number(cru.replace(",", "."))
      : Number.NaN;

    if (!Number.isFinite(cotacao) || cotacao <= 0) {
      return {
        ok: false,
        mensagem: `Informe quanto vale 1 ${valores.moeda} em reais na data da compra.`,
      };
    }

    // Cotacao 1 em moeda estrangeira e o par que o CHECK proibe, e chegar aqui
    // quase sempre quer dizer "o campo ficou com o valor padrao e ninguem olhou".
    // Recusar com a razao evita o 23514 sem explicacao.
    if (cotacao === 1) {
      return {
        ok: false,
        mensagem: `Cotação 1 vale só para reais. Informe quanto vale 1 ${valores.moeda} em reais.`,
      };
    }
  }

  return { ok: true };
}

/**
 * Com que sinal a linha vai para o banco.
 *
 * Despesa e gravada NEGATIVA neste banco. Quem decide e o TIPO, ou seja a
 * rota, e nao a categoria: numa tela so de despesa nao existe o caso ambiguo
 * que o `||` da tela antiga tentava cobrir, e `validarLancamento` ja recusou a
 * categoria que nao combina.
 *
 * O `Math.abs` nos dois lados e de proposito. O input aceita "-30": sem o abs,
 * uma despesa digitada com o menos na frente viraria `-(-30) = +30` e entraria
 * como se fosse dinheiro entrando.
 */
export function valorGravado(tipo: TipoLancamento, valor: number): number {
  return tipo === "expense" ? -Math.abs(valor) : Math.abs(valor);
}

/**
 * O corpo do POST /api/recurring-rules para um lancamento fixo (HMO-170).
 *
 * Existe como funcao pura por dois motivos que ja custaram dinheiro aqui:
 *
 *   1. O VALOR vai POSITIVO, sempre, nos dois tipos. A regra nao tem sinal --
 *      quem aplica o sinal de despesa e a baixa da ocorrencia. Mandar o valor
 *      ja negativo faria o CHECK `amount > 0` da migration 005 recusar, e a
 *      tela mostraria "nao foi possivel criar" sem dizer por que.
 *   2. `transaction_type` sai do TIPO DA TELA. Antes da HMO-170 a unica regra
 *      criada aqui era de despesa e o valor estava escrito na mao; com a
 *      receita fixa entrando pelo mesmo caminho, um literal "expense" faria o
 *      salario nascer como gasto -- e a agenda cobraria a pessoa pelo proprio
 *      salario.
 *
 * `max_occurrences` e o numero de MESES porque a frequencia e mensal. Se algum
 * dia a tela oferecer outra frequencia, os dois deixam de ser a mesma coisa.
 *
 * `hoje` E PARAMETRO, E E ISSO QUE TORNA O `start_date` TESTAVEL (HMO-247)
 * ----------------------------------------------------------------------
 * Ate a HMO-247 o `start_date` saia de `valores.data`, o campo "Data" que a tela
 * mostrava na despesa fixa. O campo saiu (ver `camposDoTipo`), e ler
 * `valores.data` daqui passou a ser um defeito silencioso: o estado do
 * formulario e um objeto so, a data digitada em "pontual" sobrevive a troca para
 * "fixa", e ela viraria o `start_date` de uma regra -- primeira cobranca meses
 * no futuro, sem campo na tela que explicasse por que.
 *
 * A regra comeca HOJE. Quem decide o primeiro vencimento e `due_day`, via
 * `firstOccurrence` (lib/recurrence.ts): dia 10 com a regra comecando hoje cobra
 * dia 10 deste mes se ele nao passou, do mes que vem se passou.
 *
 * O default `hojeISO()` existe para o chamador da tela nao ter de saber disso; o
 * parametro existe para o teste nao depender do relogio da maquina que o roda.
 */
export function regraDeRecorrencia(
  tipo: TipoLancamento,
  valores: ValoresDeLancamento,
  hoje: string = hojeISO()
): {
  description: string;
  amount: number;
  category_id: string;
  subcategory_id: string | null;
  account_id: string | null;
  transaction_type: TipoLancamento;
  frequency: "monthly";
  due_day: number;
  start_date: string;
  max_occurrences: number | null;
  notes: string | null;
  group_id: string | null;
} {
  return {
    description: valores.descricao,
    amount: Math.abs(Number.parseFloat(valores.valor)),
    category_id: valores.categoriaId,
    // A subcategoria atravessa a DESPESA FIXA (HMO-216). A regra e a semente de
    // toda ocorrencia futura: perder o campo aqui perderia o detalhe em TODOS os
    // meses que a regra vai gerar, nao em um lancamento.
    subcategory_id: valores.subcategoriaId || null,
    account_id: valores.contaId || null,
    transaction_type: tipo,
    frequency: "monthly",
    due_day: Number(valores.diaDeVencimento),
    // NAO `valores.data` (HMO-247): aquele campo saiu da tela. Ver o cabecalho.
    start_date: hoje,
    // NULL e "sem fim": e assim que a migration 005 le a coluna. Mandar 0
    // esbarraria no CHECK `max_occurrences > 0`.
    max_occurrences:
      valores.duracao === "contada" ? Number(valores.mesesDeRepeticao) : null,
    notes: valores.notas || null,
    group_id: valores.grupoId || null,
  };
}

/**
 * Para onde este lancamento vai (HMO-188).
 *
 *   regra     -> `recurring_rules` (005). Natureza fixa nao e lancamento.
 *   parcelas  -> `transaction_installments`, pela rota de parcelas.
 *   previsao  -> `scheduled_transactions`. Nao confirmado: ainda nao aconteceu.
 *   transacao -> `financial_transactions`, como sempre foi.
 *
 * A ORDEM DOS RAMOS E A PROPRIA REGRA, e ela estava espalhada em tres `if`
 * dentro do componente. Sai daqui por dois motivos concretos:
 *
 *   1. `previsao` tinha de entrar no meio de uma cadeia existente, e o lugar
 *      errado na cadeia e invisivel -- posta depois de `parcelas`, a checkbox
 *      desmarcada nao faria nada numa despesa parcelada; posta antes de `regra`,
 *      ela roubaria a despesa fixa e o aluguel viraria uma conta unica.
 *   2. da para testar sem navegador, que e como as regras de dinheiro deste app
 *      sao testadas.
 *
 * `previsao` vem DEPOIS de `regra` e de `parcelas` porque as duas ja sao
 * modelos de futuro, com o seu proprio jeito de gerar as ocorrencias.
 * `validarLancamento` ja recusou parcelado + nao confirmado antes de chegar
 * aqui; a ordem e o cinto, a recusa e o suspensorio.
 */
export type DestinoDoLancamento = "regra" | "parcelas" | "previsao" | "transacao";

export function destinoDoLancamento(
  tipo: TipoLancamento,
  valores: ValoresDeLancamento,
  editando: boolean
): DestinoDoLancamento {
  const campos = camposDoTipo(tipo, valores.natureza, editando, valores.confirmado);

  // `ehNaturezaFixa` E NAO `=== "fixed"` (HMO-254). Com a comparacao crua, um
  // "Gasto Fixo no Cartao" (`card_fixed`) escapa deste ramo: `diaDeVencimento` e
  // `true`, a tela pede o dia do vencimento, a pessoa responde -- e o destino
  // cai em `previsao` logo abaixo (porque `dataDeRealizacao` e falso em toda
  // fixa). A assinatura do cartao viraria UMA conta avulsa em Contas Previstas,
  // nao uma regra mensal, e o dia do vencimento que ela digitou nao seria usado
  // por nada. Zero erro na tela.
  if (campos.diaDeVencimento && ehNaturezaFixa(valores.natureza)) return "regra";
  if (valores.parcelado && campos.parcelamento) return "parcelas";
  // `dataDeRealizacao` e a leitura certa, e nao `!valores.confirmado`: quando a
  // checkbox nao esta na tela (fixa, edicao, cartao) um `confirmado: false`
  // parado no estado nao pode desviar o lancamento. Os dois ramos acima ja
  // cobrem fixa e parcelas, mas a EDICAO nao -- e editar uma transacao gravada
  // nunca pode virar uma previsao nova, senao o Salvar criaria uma segunda linha
  // e deixaria a original no saldo.
  //
  // DESDE A HMO-247 O RAMO `regra` ACIMA E A UNICA COISA QUE SEGURA A FIXA AQUI.
  // Antes, a fixa tinha `dataDeRealizacao: true` (o campo "Data" existia) e esta
  // linha a deixava passar para `transacao`; hoje ela tem `false`, e uma fixa que
  // escapasse do primeiro ramo cairia em `previsao` -- o aluguel viraria UMA
  // conta avulsa em vez de uma regra mensal, que e o defeito que o comentario do
  // cabecalho descreve. O teste cobra os dois tipos no ramo `regra`.
  //
  // E E AQUI QUE A TRAVA DO CARTAO MORA (HMO-209), e nao na UI. Esconder a
  // checkbox nao bastaria: o estado do formulario e um objeto so, `confirmado`
  // sobrevive a troca de natureza, e um `false` herdado de "pontual" mandaria a
  // compra para `scheduled_transactions` com o campo fora da tela -- o defeito
  // original, agora invisivel. Como `camposDoTipo` devolve
  // `dataDeRealizacao: true` em todo gasto no cartao, esta linha nao tem como
  // escolher "previsao" ali.
  //
  // NAO HA UM SEGUNDO `if (natureza === "card")` de proposito: duas guardas para
  // a mesma regra se mascaram uma a outra -- quebre qualquer uma e o teste
  // continua verde, que e como uma trava morre sem ninguem notar. A regra tem um
  // dono (`camposDoTipo`) e o teste cobra a NEGACAO aqui: nenhuma entrada com
  // natureza `card` sai como "previsao".
  if (!campos.dataDeRealizacao) return "previsao";
  return "transacao";
}

/**
 * O corpo do POST /api/scheduled-transactions para um lancamento que ainda nao
 * aconteceu (HMO-188).
 *
 * Existe como funcao pura pelo mesmo motivo de `regraDeRecorrencia`, e o motivo
 * e o mesmo defeito:
 *
 *   1. O VALOR vai POSITIVO. `scheduled_transactions.amount` tem
 *      `CHECK (amount > 0)`, e mandar o valor ja negativo faria o banco recusar
 *      toda despesa prevista com uma mensagem que a tela nao sabe traduzir.
 *   2. `transaction_type` sai do TIPO DA TELA, e e a razao pela qual a migration
 *      027 existe. Sem ele a previsao nao guarda direcao, e a baixa cai no
 *      `?? "expense"` da rota: confirmar o recebimento de R$ 7.000 gravaria
 *      -7000, com valor, descricao e categoria certos e nenhum erro. O salario
 *      entraria tirando dinheiro da conta.
 *
 * `due_date` sai de `dataPrevista`, e nao de `data`: `data` e o dia em que o
 * dinheiro andou, e numa previsao ele ainda nao andou.
 */
export function contaPrevista(
  tipo: TipoLancamento,
  valores: ValoresDeLancamento
): {
  description: string;
  amount: number;
  category_id: string;
  subcategory_id: string | null;
  account_id: string | null;
  group_id: string | null;
  due_date: string;
  transaction_type: TipoLancamento;
  notes: string | null;
} {
  return {
    description: valores.descricao,
    amount: Math.abs(Number.parseFloat(valores.valor)),
    category_id: valores.categoriaId,
    // A subcategoria atravessa a PREVISAO (HMO-216). Sem esta linha a tela
    // aceitaria a subcategoria na despesa prevista e a descartaria em silencio:
    // a baixa copia `category_id` da agenda para o lancamento, e a subcategoria
    // simplesmente nao existiria para copiar.
    //
    // `|| null` e nao `""`: a coluna e uuid, e string vazia volta 22P02.
    subcategory_id: valores.subcategoriaId || null,
    account_id: valores.contaId || null,
    group_id: valores.grupoId || null,
    due_date: valores.dataPrevista,
    transaction_type: tipo,
    notes: valores.notas || null,
  };
}

// ---------------------------------------------------------------------------
// A SERIE DE PARCELAS (HMO-211)
// ---------------------------------------------------------------------------
// "Sobre parcelar, deve ser um checkbox abaixo do valor do cartao e ao clicar
// perguntar se o valor que esta no input e o da parcela ou total, e em qual
// parcela aquela se refere de quantas no total."
//
// TUDO O QUE DECIDE DINHEIRO AQUI E FUNCAO PURA, e o motivo nao e estilo: sao
// quatro entradas (valor, base, N, M) que se combinam de um jeito em que o erro
// nao aparece. Trocar a base multiplica a compra por M. Trocar N por M cria a
// serie ao contrario. Um off-by-one na contagem cria uma parcela a mais, com
// valor plausivel, no mes seguinte ao fim -- e a unica tela que mostraria isso e
// a fatura de um mes que ainda nao chegou.
//
// POR QUE A CONTA E EM CENTAVOS
// -----------------------------
// `1000 / 3` em ponto flutuante da 333.33333333333331, e tres parcelas assim
// somam 999.99999999999989: a fatura fecharia com um centavo de diferenca que
// nenhuma das linhas explica. Em centavos inteiros a soma e exata, e quem
// absorve a sobra da divisao e a ULTIMA parcela -- a mesma escolha que a RPC
// `create_installments` (001) ja fazia, para que o total gravado seja sempre o
// total digitado.
//
// NAO HA IMPORT DE lib/dinheiro.ts DE PROPOSITO. `test:lancamento` compila este
// arquivo sozinho (`tsc lib/lancamento.ts`), sem o passo que reescreve o alias
// `@/`, e um import aqui derrubaria a suite com ERR_MODULE_NOT_FOUND -- o mesmo
// motivo pelo qual `moeda: "BRL"` em `valoresIniciais` e literal.

/** Uma parcela da serie, ja com o valor e o vencimento dela. */
export interface ParcelaDaSerie {
  /** O numero dela na serie: 3, numa "parcela 3 de 10". */
  numero: number;
  /** Em reais, com 2 casas exatas. */
  valor: number;
  /** AAAA-MM-DD. */
  vencimento: string;
}

export interface SerieDeParcelas {
  /** O valor de UMA parcela (a ultima pode diferir em centavos; ver abaixo). */
  valorDaParcela: number;
  /** O valor da compra inteira, as M parcelas. */
  valorTotal: number;
  /**
   * SO as parcelas que faltam: de `parcelaAtual` ate `totalDeParcelas`.
   *
   * Esta e a decisao (A) da HMO-208, e ela e deliberada: lancar "parcela 3 de
   * 10" nao gera linha nenhuma para as parcelas 1 e 2. A alternativa seria
   * gravar a serie toda marcando as anteriores como pagas -- e o app passaria a
   * afirmar pagamentos que ninguem registrou, com `paid_date` sem transacao por
   * tras (a mesma classe de problema da HMO-149: o numero fecha, o fato nao
   * aconteceu). Para lancar uma parcela antiga ha a tela do cartao (HMO-210).
   */
  parcelas: ParcelaDaSerie[];
  /**
   * Quantas parcelas da serie NAO foram criadas por serem anteriores (N-1).
   *
   * Existe para a tela poder dizer isso em voz alta. Um "8 parcelas criadas"
   * numa compra de 10x e, sozinho, indistinguivel de um off-by-one.
   */
  parcelasAnteriores: number;
}

const MAX_PARCELAS = 60;

/**
 * Soma meses a uma data AAAA-MM-DD, grampeando o dia ao ultimo do mes destino.
 *
 * ARITMETICA DE STRING, SEM `Date`, e isto nao e preciosismo. `new Date("2026-
 * 01-31")` e meia-noite UTC; somar mes com `setMonth` e reimprimir com
 * `toISOString` devolve o dia anterior em qualquer fuso a oeste de Greenwich.
 * O sandbox roda em America/Sao_Paulo e o CI em UTC, entao esse bug passaria
 * verde em exatamente um dos dois -- ver `teste-de-data-passa-em-utc-e-nao-ve-o-
 * bug`.
 *
 * O grampo: a parcela de 31 de janeiro vence em 28 de fevereiro, nao em 3 de
 * marco. Sem ele a serie "pula" um mes e duas parcelas caem na mesma fatura.
 */
export function somaMeses(dataISO: string, meses: number): string | null {
  const casa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dataISO);
  if (!casa) return null;

  const ano = Number(casa[1]);
  const mes = Number(casa[2]);
  const dia = Number(casa[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  // Meses contados de 0 para o modulo nao tropecar no 12.
  const indice = (ano * 12 + (mes - 1)) + meses;
  const anoDestino = Math.floor(indice / 12);
  const mesDestino = (indice % 12) + 1;

  // Dia 0 do mes seguinte e o ultimo do mes corrente -- em UTC, que e seguro
  // porque so o NUMERO do dia e lido daqui.
  const ultimoDia = new Date(Date.UTC(anoDestino, mesDestino, 0)).getUTCDate();
  const diaDestino = Math.min(dia, ultimoDia);

  const dd = String(diaDestino).padStart(2, "0");
  const mm = String(mesDestino).padStart(2, "0");
  return `${String(anoDestino).padStart(4, "0")}-${mm}-${dd}`;
}

/**
 * Em que data cada parcela do CARTAO tem de ser gravada para cair na fatura
 * certa.
 *
 * MUDOU DE CASA NA HMO-289, e o motivo e medicao e nao arrumacao: ela era uma
 * funcao privada de `app/api/financial-installments/route.ts`, onde NAO HA COMO
 * TESTA-LA sem subir a rota. O caso que distingue esta funcao da versao
 * quase-certa (abaixo) e o caso mais caro desta feature, e enquanto ela morava
 * la a unica prova possivel era um mutante. Aqui ela cai em `test:lancamento`,
 * ao lado de `somaMeses`, que e a unica coisa de que ela precisa -- este modulo
 * continua sem import nenhum.
 *
 * O PROBLEMA, QUE NAO PARECE UM
 * -----------------------------
 * A tentacao e `transaction_date = dataDaCompra + k meses` e deixar
 * `card_invoice_month()` fazer o resto. Isso erra, e erra calado, porque somar
 * um mes a uma data NAO soma um mes a fatura quando o dia e grampeado pelo fim
 * do mes. Medido com a funcao do banco:
 *
 *   compra 31/01, cartao fecha dia 30
 *     31/01 -> dia 31 > 30            -> fatura de FEVEREIRO
 *     28/02 (31/01 + 1 mes, grampeado) -> dia 28 <= 28 -> fatura de FEVEREIRO
 *
 * Duas parcelas na MESMA fatura, e a serie termina um mes antes do que devia.
 * A fatura de fevereiro fecharia com o dobro, a ultima ficaria vazia, e nada
 * disso aparece como erro -- aparece como um mes caro.
 *
 * A SOLUCAO
 * ---------
 * A primeira parcela (a que a pessoa esta lancando) fica com a data REAL da
 * compra: e o fato, e e ela que define a fatura ancora. As seguintes ficam com
 * o **primeiro dia** do mes da fatura delas, porque dia 1 e o unico dia que
 * `card_invoice_month()` nunca empurra para o mes seguinte -- `1 <= closing_day`
 * vale para todo `closing_day >= 1`, e com `closing_day` NULL a funcao trunca no
 * mes de qualquer jeito. A colocacao passa a ser exata por construcao em vez de
 * depender do calendario.
 *
 * DE ONDE VEM `mesDaFaturaAncora`, E O QUE A HMO-289 MUDOU NISSO
 * -------------------------------------------------------------
 * Sem fatura escolhida, ela e perguntada AO BANCO (`card_invoice_month`) e nao
 * recalculada em TypeScript: essa regra existe num lugar so (006), e uma segunda
 * copia faria a tela e o relatorio discordarem sobre o mesmo cartao no mes em que
 * uma das duas mudasse.
 *
 * COM fatura escolhida (041), a ancora e a ESCOLHA -- e e por isso que ela e
 * parametro desta funcao e nao uma consulta feita aqui dentro. Ignorar a escolha
 * na ancora nao erraria uma linha: erraria a serie. A parcela 1 iria para a
 * fatura escolhida (ela leva o override na linha dela) e as demais seriam
 * contadas da fatura da DATA -- a 2a cairia junto da 1a, e a serie terminaria um
 * mes antes. O mesmo estrago do grampeamento, por outra porta.
 */
export function datasDasParcelasNoCartao(
  serie: SerieDeParcelas,
  dataDaCompra: string,
  mesDaFaturaAncora: string
): string[] | null {
  const datas: string[] = [];

  for (let k = 0; k < serie.parcelas.length; k++) {
    if (k === 0) {
      datas.push(dataDaCompra);
      continue;
    }
    // A CONTAGEM PARTE SEMPRE DA ANCORA, e nao da data anterior. `somaMeses` e
    // quem grampeia o dia, e grampear em cadeia (`somaMeses(datas[k-1], 1)`)
    // arrastaria o erro para frente: de 31/01 sairiam 28/02, 28/03, 28/04 -- e
    // marco apareceria com a parcela no dia 28 de um mes que tem 31.
    const mes = somaMeses(mesDaFaturaAncora, k);
    if (!mes) return null;
    datas.push(mes);
  }

  return datas;
}

/**
 * A serie que vai ser gravada, a partir das quatro respostas da tela.
 *
 * `null` quando as entradas nao formam uma serie -- quem transforma isso em
 * frase para o usuario e `validarLancamento`, que roda antes. Devolver `null` em
 * vez de uma serie vazia e deliberado: uma serie vazia e um sucesso com zero
 * parcelas, e o chamador gravaria nada e avisaria "parcelas criadas".
 */
export function serieDeParcelas(entrada: {
  /** Como veio do campo de valor: string. */
  valor: string;
  base: BaseDoValorParcelado;
  /** N */
  parcelaAtual: number;
  /** M */
  totalDeParcelas: number;
  /** O vencimento da parcela N. */
  vencimentoDaParcelaAtual: string;
}): SerieDeParcelas | null {
  const { base, parcelaAtual: n, totalDeParcelas: m } = entrada;

  if (!Number.isInteger(n) || !Number.isInteger(m)) return null;
  if (m < 2 || m > MAX_PARCELAS) return null;
  // `n > m` e o jeito como "parcela 10 de 3" chega aqui -- inclusive se alguem
  // trocar a ordem dos dois argumentos num chamador.
  if (n < 1 || n > m) return null;

  const valor = Number.parseFloat(entrada.valor);
  if (!Number.isFinite(valor) || valor <= 0) return null;

  // Centavos inteiros a partir daqui. `Math.round` e nao `Math.trunc`: R$ 0,10
  // digitado chega como 0.1, que vezes 100 da 10.000000000000002.
  const digitadoEmCentavos = Math.round(valor * 100);

  // AQUI MORA A PERGUNTA DA ISSUE, E ELA E UM `if` DE DUAS LINHAS
  //
  // Com base "parcela" o total e um multiplo exato e nao ha sobra nenhuma: as M
  // parcelas valem o mesmo. Com base "total" e a divisao que sobra, e a sobra
  // vai na ultima.
  const totalEmCentavos =
    base === "parcela" ? digitadoEmCentavos * m : digitadoEmCentavos;
  const parcelaEmCentavos =
    base === "parcela" ? digitadoEmCentavos : Math.round(digitadoEmCentavos / m);

  if (parcelaEmCentavos <= 0) return null;

  // A ULTIMA PARCELA FECHA O TOTAL
  //
  // A sobra cai na parcela M, e M esta SEMPRE dentro do intervalo criado
  // (N <= M), entao ela nunca se perde numa parcela que nao foi gravada.
  const ultimaEmCentavos =
    totalEmCentavos - parcelaEmCentavos * (m - 1);

  const parcelas: ParcelaDaSerie[] = [];
  for (let numero = n; numero <= m; numero++) {
    const vencimento = somaMeses(entrada.vencimentoDaParcelaAtual, numero - n);
    if (!vencimento) return null;
    parcelas.push({
      numero,
      valor: (numero === m ? ultimaEmCentavos : parcelaEmCentavos) / 100,
      vencimento,
    });
  }

  return {
    valorDaParcela: parcelaEmCentavos / 100,
    valorTotal: totalEmCentavos / 100,
    parcelas,
    parcelasAnteriores: n - 1,
  };
}

/**
 * "Notebook (3/10)" -- a descricao de uma parcela.
 *
 * Em UM lugar porque ela vai para duas tabelas diferentes (a transacao do
 * cartao e a conta prevista) e e o texto que o usuario le na lista. Duas copias
 * divergiriam na primeira mudanca de formato, e a lista mostraria a mesma compra
 * escrita de dois jeitos.
 */
export function descricaoDaParcela(
  descricao: string,
  numero: number,
  total: number
): string {
  return `${descricao.trim()} (${numero}/${total})`;
}

/**
 * "parcela 3 de 10" -- o rotulo, para quem le a tela.
 *
 * Separado de `descricaoDaParcela` de proposito: a descricao e o que foi
 * GRAVADO (e o usuario pode edita-la), o rotulo sai das colunas
 * `installment_number` / `installment_total` da migration 035. Quando os dois
 * discordarem, quem esta certo e o rotulo.
 */
export function rotuloDaParcela(
  numero: number | null | undefined,
  total: number | null | undefined
): string | null {
  if (!numero || !total) return null;
  if (!Number.isInteger(numero) || !Number.isInteger(total)) return null;
  if (numero < 1 || numero > total) return null;
  return `parcela ${numero} de ${total}`;
}

/**
 * O resumo que a tela mostra ANTES de salvar.
 *
 * Existe porque nenhum default de `baseDoValorParcelado` e inofensivo: seja
 * "parcela" ou "total", metade dos usuarios vai digitar pensando no outro. A
 * defesa nao e escolher melhor -- e mostrar a conta feita, com os dois numeros,
 * ao lado da pergunta. `null` quando ainda nao da para fazer a conta: um resumo
 * parcial ("10x de R$ 0,00") se le como resposta.
 */
export function resumoDaSerie(serie: SerieDeParcelas | null): string | null {
  if (!serie) return null;

  // A MAO, e nao `toLocaleString("pt-BR")`: este texto entra em assercao de
  // teste, e depender da base de locale do Node faz o mesmo teste passar numa
  // maquina e falhar noutra sem nada no codigo ter mudado (ha um Node sem
  // full-icu que devolve o formato en-US para qualquer locale pedido). Mesma
  // razao que os nomes de mes em lib/fatura-do-cartao.ts.
  const emReais = (v: number) => {
    const centavos = Math.round(v * 100);
    const inteiros = String(Math.floor(centavos / 100)).replace(
      /\B(?=(\d{3})+(?!\d))/g,
      "."
    );
    return `R$ ${inteiros},${String(centavos % 100).padStart(2, "0")}`;
  };

  const quantas = serie.parcelas.length;
  const primeira = serie.parcelas[0];
  const total = serie.parcelas.length + serie.parcelasAnteriores;

  const cabeca = `${total}x de ${emReais(serie.valorDaParcela)} · total ${emReais(
    serie.valorTotal
  )}`;

  // A FRASE QUE TORNA A DECISAO (A) VISIVEL
  //
  // Sem ela, lancar "parcela 3 de 10" grava 8 linhas e a tela diz "10x" -- e a
  // pessoa so descobriria que as duas primeiras nao existem procurando nas
  // faturas passadas. O que ela faria com essa informacao esta na tela do
  // cartao: lancar a mao a parcela antiga, se quiser.
  if (serie.parcelasAnteriores > 0) {
    return `${cabeca}. Vou registrar ${quantas} parcela${
      quantas === 1 ? "" : "s"
    }, da ${primeira.numero}ª em diante — as ${serie.parcelasAnteriores} anteriores não entram.`;
  }

  return `${cabeca}. ${quantas} parcelas, a partir de ${primeira.vencimento
    .split("-")
    .reverse()
    .join("/")}.`;
}

/**
 * As duas datas que a transacao leva ao banco, alem de `transaction_date`
 * (HMO-188, migration 027).
 *
 * `launch_date` e SEMPRE hoje: e o dia em que a pessoa anotou, e e isso que a
 * coluna significa. Mandar `valores.data` aqui seria copiar a data em que o
 * dinheiro andou e as duas colunas passariam a dizer a mesma coisa -- o dado
 * novo nasceria inutil, e "anotei hoje o aluguel do dia 5" deixaria de ser
 * distinguivel de "paguei o aluguel hoje".
 *
 * `expected_date` e NULL quando a pessoa nao declarou previsao diferente. NULL e
 * "nao havia previsao separada", nao "previsto para hoje" -- devolver a data
 * real aqui faria todo lancamento AFIRMAR que saiu no dia previsto, e um
 * relatorio de atraso sairia com zero atrasos e cara de verdade.
 */
export function datasDaTransacao(valores: ValoresDeLancamento): {
  launch_date: string;
  expected_date: string | null;
} {
  const prevista = valores.dataPrevista.trim();
  return {
    launch_date: hojeISO(),
    expected_date:
      /^\d{4}-\d{2}-\d{2}$/.test(prevista) && prevista !== valores.data
        ? prevista
        : null,
  };
}

/**
 * A rota de cada tipo. Existe como funcao para que o link da lista e o
 * redirecionamento depois de salvar nao escrevam a string na mao.
 */
export function rotaDoTipo(tipo: TipoLancamento): string {
  return tipo === "expense"
    ? "/dashboard/movimentacoes/despesa"
    : "/dashboard/movimentacoes/receita";
}

/**
 * De que tipo e este lancamento ja gravado, para o botao de editar saber para
 * qual tela levar.
 *
 * `transaction_type` manda quando existe. Sem ela sobra a categoria, que sabe
 * mais que o sinal (um estorno de despesa chega positivo e continua sendo da
 * categoria de despesa) -- a mesma ordem de `classificarMovimentacao`.
 *
 * Devolve `null` para transferencia: ela nao tem tela de edicao aqui, e mandar
 * uma perna de transferencia para a tela de despesa faria a outra perna ficar
 * orfa.
 */
export function tipoDoLancamento(linha: {
  amount: number;
  transaction_type?: string | null;
  category?: { is_expense?: boolean } | null;
}): TipoLancamento | null {
  if (linha.transaction_type === "transfer") return null;
  if (linha.transaction_type === "income") return "income";
  if (linha.transaction_type === "expense") return "expense";

  if (linha.category?.is_expense === true) return "expense";
  if (linha.category?.is_expense === false) return "income";

  return linha.amount < 0 ? "expense" : "income";
}
