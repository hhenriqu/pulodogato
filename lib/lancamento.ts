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
 * Natureza da despesa. Nao e coluna nova no banco: cada valor ROTEIA para um
 * modelo que ja existe.
 *
 *   one_off -> `financial_transactions`, como sempre foi
 *   card    -> a mesma transacao, mas numa conta `credit_card`, que e o que faz
 *              a compra entrar na fatura (migration 006)
 *   fixed   -> `recurring_rules` (005), que gera a agenda mes a mes
 *
 * Guardar um quarto rotulo solto em `financial_transactions` criaria uma
 * segunda fonte de verdade para "e fixa?", competindo com a regra.
 */
export type NaturezaDespesa = "one_off" | "card" | "fixed";

export interface CategoriaDeLancamento {
  id: string;
  name: string;
  is_expense: boolean;
}

export interface ContaDeLancamento {
  id: string;
  name: string;
  account_type?: string | null;
}

/** Quais blocos do formulario existem para este tipo e esta natureza. */
export interface CamposDoTipo {
  /** O seletor pontual / cartao / fixa. So despesa tem. */
  natureza: boolean;
  /** O dia do vencimento da regra mensal. So despesa fixa. */
  diaDeVencimento: boolean;
  /** Parcelar em N vezes. So despesa, e so criando. */
  parcelamento: boolean;
  /** Dividir com grupo ou conexoes. So despesa. */
  rateio: boolean;
  /** O seletor de conta e obrigatorio (gasto no cartao). */
  contaObrigatoria: boolean;
  /** O rotulo do seletor de conta muda com a natureza. */
  rotuloDaConta: string;
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
  editando: boolean
): CamposDoTipo {
  if (tipo === "income") {
    return {
      natureza: false,
      diaDeVencimento: false,
      parcelamento: false,
      rateio: false,
      contaObrigatoria: false,
      rotuloDaConta: "Conta de entrada",
    };
  }

  const ehNoCartao = natureza === "card";

  return {
    natureza: true,
    diaDeVencimento: natureza === "fixed" && !editando,
    parcelamento: !editando,
    rateio: true,
    contaObrigatoria: ehNoCartao,
    rotuloDaConta: ehNoCartao ? "Cartão *" : "Conta/Cartão",
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
  /** YYYY-MM-DD */
  data: string;
  notas: string;

  // So despesa usa daqui para baixo.
  natureza: NaturezaDespesa;
  diaDeVencimento: string;
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
    notas: "",
    natureza: "one_off",
    diaDeVencimento: "",
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

  if (!/^\d{4}-\d{2}-\d{2}$/.test(valores.data)) {
    return { ok: false, mensagem: "Informe a data." };
  }

  const campos = camposDoTipo(tipo, valores.natureza, contexto.editando);

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
