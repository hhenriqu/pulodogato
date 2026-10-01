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
 *   one_off -> `financial_transactions`, como sempre foi
 *   card    -> a mesma transacao, mas numa conta `credit_card`, que e o que faz
 *              a compra entrar na fatura (migration 006)
 *   fixed   -> `recurring_rules` (005), que gera a agenda mes a mes
 *
 * Guardar um quarto rotulo solto em `financial_transactions` criaria uma
 * segunda fonte de verdade para "e fixa?", competindo com a regra.
 *
 * O nome fala de despesa por heranca: ate a HMO-170 so a despesa tinha este
 * seletor. Hoje a RECEITA tambem tem -- salario e o caso que motivou a issue --
 * e quem diz quais valores cabem em cada tela e `naturezasDoTipo`.
 */
export type NaturezaDespesa = "one_off" | "card" | "fixed";

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

/** O maximo de meses que a tela aceita em "por N meses". */
export const MAX_MESES_DE_REPETICAO = 360;

/**
 * Quais naturezas cabem nesta tela.
 *
 * Receita nao tem "no cartao": cartao de credito e instrumento de PAGAMENTO, e
 * uma entrada apontada para ele entraria na fatura reduzindo o que se deve --
 * que e um estorno, nao uma receita.
 */
export function naturezasDoTipo(tipo: TipoLancamento): NaturezaDespesa[] {
  return tipo === "expense"
    ? ["one_off", "card", "fixed"]
    : ["one_off", "fixed"];
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
  /** O seletor pontual / cartao / fixa. As duas telas tem (HMO-170). */
  natureza: boolean;
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
  const ehFixa = natureza === "fixed" && !editando;

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
    !ehFixa && !editando && natureza !== "fixed" && !ehCompraNoCartao;
  // Quando a checkbox nao existe, `confirmado` nao pode mandar na tela -- senao
  // um `confirmado: false` parado no estado apagaria o campo de data de uma
  // despesa fixa, e `data` e o `start_date` da regra. No cartao essa mesma
  // leitura e a TRAVA da HMO-209: `destinoDoLancamento` decide pelo
  // `dataDeRealizacao` que sai daqui, entao o estado desmarcado herdado da
  // natureza anterior nao consegue mandar a compra para a agenda.
  const ehPrevisao = confirmacao && !confirmado;

  const comum = {
    natureza: true,
    diaDeVencimento: ehFixa,
    duracao: ehFixa,
    confirmacao,
    dataDeRealizacao: !ehPrevisao,
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
      rotuloDaConta: "Conta de entrada",
      rotuloDaNatureza: "Tipo de Receita *",
      rotuloDaData: ehFixa ? "Data" : "Data do recebimento",
      rotuloDaConfirmacao: "Já recebi",
    };
  }

  const ehNoCartao = natureza === "card";

  return {
    ...comum,
    parcelamento: !editando,
    rateio: true,
    contaObrigatoria: ehNoCartao,
    rotuloDaConta: ehNoCartao ? "Cartão *" : "Conta/Cartão",
    rotuloDaNatureza: "Tipo de Despesa *",
    // "Data do pagamento" no cartao seria a pergunta errada: o que esta sendo
    // anotado e a COMPRA, e o rotulo e a unica coisa na tela que diz isso. A
    // data tambem nao e cosmetica -- e ela que decide em que fatura a compra
    // cai (`card_invoice_month()`).
    rotuloDaData: ehFixa
      ? "Data"
      : ehNoCartao
        ? "Data da compra"
        : "Data do pagamento",
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
 */
export function contasDoSeletor<T extends { account_type?: string | null }>(
  contas: T[],
  tipo: TipoLancamento,
  natureza: NaturezaDespesa
): T[] {
  if (tipo === "expense" && natureza === "card") {
    return contas.filter((c) => c.account_type === "credit_card");
  }
  return contas;
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

  /** Pontual, no cartao ou fixa. As duas telas usam (HMO-170). */
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

  // So despesa usa daqui para baixo.
  parcelado: boolean;
  totalDeParcelas: number;
  valorDaParcela: string;
  primeiroVencimento: string;
  compartilhado: boolean;
  grupoId: string;
  rateios: { participanteId: string; percentual: number }[];
}

export function hojeISO(): string {
  return new Date().toISOString().split("T")[0];
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
    parcelado: false,
    totalDeParcelas: 1,
    valorDaParcela: "",
    primeiroVencimento: hojeISO(),
    compartilhado: false,
    grupoId: "",
    rateios: [],
  };
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
    return { ok: false, mensagem: "Escolha em qual cartão foi o gasto." };
  }

  if (campos.diaDeVencimento) {
    const dia = Number(valores.diaDeVencimento);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
      return {
        ok: false,
        mensagem: "Informe o dia do vencimento, entre 1 e 31.",
      };
    }
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

  // PARCELAR E DEIXAR PREVISTO SAO A MESMA PERGUNTA, RESPONDIDA DUAS VEZES
  //
  // Parcelamento ja cria N cobrancas FUTURAS, cada uma com o seu vencimento,
  // em `transaction_installments`. Combinar com "ainda nao paguei" nao tem uma
  // leitura so: e a primeira parcela que fica prevista, ou todas? Recusar com a
  // razao e melhor do que escolher uma das duas em silencio -- e sem esta porta
  // o ramo de parcelas venceria o de previsao no `destinoDoLancamento` e a
  // checkbox desmarcada simplesmente nao faria nada.
  //
  // A LEITURA E `campos.dataDeRealizacao`, E NAO `!valores.confirmado` (HMO-209)
  //
  // E a diferenca entre uma mensagem util e uma mensagem impossivel. No cartao
  // nao existe mais checkbox para marcar: "Marque 'Ja paguei'" mandaria a pessoa
  // procurar um campo que nao esta na tela, e nao haveria como obedecer. Lido
  // pelos CAMPOS, este ramo simplesmente nao alcanca o cartao -- `camposDoTipo`
  // devolve `dataDeRealizacao: true` la sempre --, e isso e o comportamento
  // certo, nao um furo: comprar em 12x no cartao e o caso normal, e a compra
  // parcelada ja aconteceu. Ela vai para `transaction_installments` pelo ramo de
  // `parcelas`, com os vencimentos de cada parcela.
  if (valores.parcelado && campos.parcelamento && !campos.dataDeRealizacao) {
    return {
      ok: false,
      mensagem:
        "Parcelado já cria as parcelas futuras com os vencimentos delas. Marque \"Já paguei\" ou desligue o parcelamento.",
    };
  }

  // Parcelamento so existe onde `camposDoTipo` o mostra. Sem esta porta, uma
  // receita com `parcelado: true` no estado (ou uma edicao) cairia nas regras
  // de parcela, que a tela nem exibe -- e a mensagem falaria de um campo
  // invisivel.
  if (valores.parcelado && campos.parcelamento) {
    const parcela = Number.parseFloat(valores.valorDaParcela);
    if (!Number.isFinite(parcela) || parcela <= 0) {
      return { ok: false, mensagem: "Valor da parcela deve ser maior que zero." };
    }
    if (!Number.isInteger(valores.totalDeParcelas) || valores.totalDeParcelas < 2) {
      return { ok: false, mensagem: "Número de parcelas deve ser maior que 1." };
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
 */
export function regraDeRecorrencia(
  tipo: TipoLancamento,
  valores: ValoresDeLancamento
): {
  description: string;
  amount: number;
  category_id: string;
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
    account_id: valores.contaId || null,
    transaction_type: tipo,
    frequency: "monthly",
    due_day: Number(valores.diaDeVencimento),
    start_date: valores.data,
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

  if (campos.diaDeVencimento && valores.natureza === "fixed") return "regra";
  if (valores.parcelado && campos.parcelamento) return "parcelas";
  // `dataDeRealizacao` e a leitura certa, e nao `!valores.confirmado`: quando a
  // checkbox nao esta na tela (fixa, edicao, cartao) um `confirmado: false`
  // parado no estado nao pode desviar o lancamento. Os dois ramos acima ja
  // cobrem fixa e parcelas, mas a EDICAO nao -- e editar uma transacao gravada
  // nunca pode virar uma previsao nova, senao o Salvar criaria uma segunda linha
  // e deixaria a original no saldo.
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
    account_id: valores.contaId || null,
    group_id: valores.grupoId || null,
    due_date: valores.dataPrevista,
    transaction_type: tipo,
    notes: valores.notas || null,
  };
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
