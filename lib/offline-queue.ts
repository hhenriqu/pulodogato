// =====================================================
// A FILA DE LANCAMENTOS FEITOS SEM REDE
// =====================================================
// Lancar uma despesa e a unica coisa que o app precisa aceitar offline. E
// justamente a que acontece longe do wi-fi: no caixa do mercado, no
// estacionamento, na fila do restaurante. Quem tem que esperar a rede voltar
// para anotar R$ 32 de almoco nao anota -- e um controle financeiro com buracos
// e pior que nenhum, porque os numeros continuam parecendo completos.
//
// Este modulo e a parte da fila que nao depende de navegador: o que pode
// entrar, como a linha e montada, em que ordem sai e o que fazer com cada tipo
// de erro. O IndexedDB fica em `lib/offline-store.ts`, e e de proposito burro.
//
// -----------------------------------------------------------------------------
// A ARMADILHA CENTRAL: REPETIR O ENVIO E COBRAR DUAS VEZES
// -----------------------------------------------------------------------------
// Toda fila que reenvia tem o mesmo ponto cego, e ele nao e "a rede caiu": e a
// rede cair DEPOIS de o servidor gravar. O insert chega, o Postgres confirma, e
// a resposta se perde na volta. Para o aparelho isso e indistinguivel de nunca
// ter chegado. Ele tenta de novo -- e o almoco de R$ 32 vira R$ 64 de gasto,
// sem erro nenhum em lugar nenhum.
//
// Por isso o `id` da transacao nasce AQUI, no aparelho, antes do primeiro
// envio, e vai junto na linha. A coluna e `uuid DEFAULT gen_random_uuid()`,
// entao ela aceita um id de fora, e a chave primaria transforma o reenvio em
// `ON CONFLICT (id) DO NOTHING`: a segunda tentativa nao grava nada e nao
// dispara os triggers de saldo de novo.
//
// O efeito colateral disso e a segunda armadilha, e ela morde na direcao
// oposta -- ver `interpretarRespostaDeEnvio`.
// =====================================================

/** Um lancamento esperando a rede voltar. */
export interface ItemDaFila {
  /** O mesmo uuid que vai como `id` da transacao. E a chave de idempotencia. */
  id: string;
  linha: LinhaDeTransacao;
  /** `Date.now()` de quando a pessoa tocou em "Salvar". */
  criadoEm: number;
  /** Quantas vezes ja tentamos enviar. */
  tentativas: number;
  ultimoErro: string | null;
  /**
   * `pendente` = ainda vai tentar. `falhou` = nao adianta tentar de novo, e a
   * tela precisa mostrar isto para a pessoa relancar. Nunca apagamos em
   * silencio: um lancamento que some sem aviso e dinheiro que sumiu do
   * controle sem ninguem saber.
   */
  estado: "pendente" | "falhou";
}

/** Exatamente o objeto que vai para `.from("financial_transactions")`. */
export interface LinhaDeTransacao {
  id: string;
  user_id: string;
  service_id: string;
  category_id: string;
  account_id: string | null;
  description: string;
  amount: number;
  transaction_date: string;
  transaction_type: string;
  notes: string | null;
  is_shared: boolean;
  group_id: null;
  /**
   * Moeda deste lancamento (ISO 4217, migration 022).
   *
   * Obrigatoria na linha, e nao opcional: a coluna tem DEFAULT 'BRL', entao uma
   * linha SEM o campo entra como real sem erro nenhum. Um lancamento feito
   * offline numa conta em dolar seria gravado em reais na sincronizacao, e o
   * relatorio o somaria no balde errado -- o tipo de defeito que so aparece
   * conferindo lancamento por lancamento.
   */
  currency: string;
  /**
   * A cotacao do dia da compra (migration 026, HMO-182).
   *
   * Obrigatoria na linha pelo mesmo motivo que `currency`, e com uma
   * consequencia pior se faltar. A 026 pos um CHECK que cruza as duas:
   *
   *     CHECK ((currency = 'BRL') = (exchange_rate = 1))
   *
   * e a coluna nasceu com `DEFAULT 1`. Uma linha desta fila com `currency:
   * 'USD'` e sem cotacao monta o par `(USD, 1)`, que o banco recusa com 23514 --
   * e aqui isso e muito pior que na tela online, porque a recusa acontece na
   * SINCRONIZACAO, longe de quem lancou: o item volta para a fila como `falhou`
   * e fica la para sempre, sem que nenhuma tentativa futura possa dar outro
   * resultado. O dinheiro nao se perde, mas o lancamento nunca entra.
   *
   * 1 para BRL, sempre -- e o unico valor que o CHECK aceita em real.
   */
  exchange_rate: number;
}

/** O que a tela coletou do formulario, antes de virar linha. */
export interface EntradaDeLancamento {
  userId: string;
  serviceId: string;
  categoryId: string;
  accountId: string | null;
  descricao: string;
  /** Como veio do input: string, ainda nao numero. */
  valor: string;
  /** "expense" | "income" | "transfer" */
  tipo: string;
  /** `is_expense` da categoria escolhida, quando ha categoria. */
  categoriaEhDespesa?: boolean;
  /** YYYY-MM-DD */
  data: string;
  notas: string | null;
  parcelado: boolean;
  compartilhado: boolean;
  grupoId: string | null;
  /** Esta editando um lancamento que ja existe, em vez de criar. */
  editando: boolean;
  /**
   * `NaturezaDespesa` de lib/lancamento.ts, como texto -- despesa fixa nao e
   * lancamento. Quais valores sao fixos: `NATUREZAS_FIXAS`, logo abaixo.
   *
   * `string` E NAO O TIPO, de proposito: a entrada pode vir de uma versao
   * ANTIGA da tela, servida do cache do service worker, e um valor que aquela
   * versao conhecia e esta nao e um dado real que precisa ser avaliado -- nao um
   * erro de compilacao. E a razao pela qual a lista abaixo e por extenso.
   */
  tipoDeDespesa?: string;
  /**
   * Moeda escolhida na tela (ISO 4217). Opcional na ENTRADA porque quem chama
   * pode nao ter o campo (versao antiga da tela guardada no cache do service
   * worker); ausente cai em BRL, que e o mesmo DEFAULT da coluna.
   */
  moeda?: string;
  /**
   * A cotacao digitada na tela, como texto (migration 026, HMO-182).
   *
   * Opcional na ENTRADA pelo mesmo motivo que `moeda`: uma versao antiga da tela,
   * servida do cache do service worker, nao tem este campo. Ausente em BRL nao e
   * problema (a cotacao e 1). Ausente em moeda estrangeira e o caso que
   * `avaliarLancamento` recusa -- ver o motivo `sem-cotacao`.
   */
  cotacao?: string;
  /**
   * A pessoa ja pagou / ja recebeu? (HMO-188)
   *
   * Opcional na ENTRADA pelo mesmo motivo que `moeda` e `cotacao`: uma versao
   * antiga da tela, servida do cache do service worker, nao tem este campo.
   * AUSENTE quer dizer confirmado -- que e exatamente o que aquela tela fazia,
   * gravar a transacao direto. Tratar ausente como "previsto" mandaria todo
   * lancamento offline de uma tela em cache para a recusa.
   */
  confirmado?: boolean;
}

/**
 * Os valores de `tipoDeDespesa` que significam "isto e uma REGRA, nao um
 * lancamento" (HMO-254).
 *
 * POR EXTENSO E NAO IMPORTADO DE lib/lancamento.ts, e isto e a mesma decisao
 * que `moeda: "BRL"` em `valoresIniciais`: este modulo compila sozinho em
 * `test:offline-queue`, e o campo que ele le e `string` (ver `tipoDeDespesa`)
 * porque a entrada pode vir de uma tela em cache. O que impede a copia de
 * divergir NAO e o import, e o caso "a lista daqui e `ehNaturezaFixa` concordam
 * em toda natureza" em scripts/test-offline-queue.mjs, que compila os dois
 * modulos e compara -- o mesmo arranjo que scripts/test-moeda.mjs usa para
 * `MOEDA_PADRAO`.
 *
 * ERA A COMPARACAO `=== "fixed"`, E ELA FUROU NA HMO-254. Com `card_fixed`
 * nascendo na tela, a assinatura do cartao lancada sem rede passava por esta
 * peneira como despesa PONTUAL: a fila gravava uma `financial_transactions`, o
 * aviso dizia "guardei no aparelho", e quando a conexao voltasse a regra mensal
 * que a pessoa pediu nao existiria -- mas a compra daquele mes existiria duas
 * vezes, uma da fila e outra da ocorrencia que ela ia cadastrar de novo ao
 * perceber. A lista fecha o modo de falha para todo valor novo do enum: quem
 * adicionar um "fixo" e esquecer daqui quebra o teste de concordancia.
 */
export const NATUREZAS_FIXAS: string[] = ["fixed", "card_fixed"];

export type MotivoDeRecusa =
  | "parcelado"
  | "compartilhado"
  | "despesa-fixa"
  | "transferencia"
  | "edicao"
  | "sem-cotacao"
  | "previsto"
  | "invalido";

export type Avaliacao =
  | { ok: true; linha: LinhaDeTransacao }
  | { ok: false; motivo: MotivoDeRecusa; mensagem: string };

/**
 * Este lancamento pode ir para a fila?
 *
 * O criterio nao e "da para gravar depois" -- quase tudo daria. E "da para
 * gravar depois SEM errar dinheiro". As cinco recusas abaixo tem todas a
 * mesma causa: elas nao sao um insert, sao varios -- em tabelas diferentes, ou
 * duas linhas que so fazem sentido juntas -- e um reenvio que acerta metade
 * deixa o livro desencontrado de um jeito que ninguem percebe olhando a tela.
 */
export function avaliarLancamento(
  entrada: EntradaDeLancamento,
  id: string
): Avaliacao {
  if (entrada.editando) {
    return {
      ok: false,
      motivo: "edicao",
      mensagem:
        "Editar um lancamento precisa de conexao: a versao que esta no servidor pode ter mudado.",
    };
  }

  if (entrada.parcelado) {
    // Parcelamento vira N transacoes amarradas por `installment_parent_id`, e
    // quem as monta e uma rota do servidor. Enfileirar so o pedido faria a
    // fila carregar uma intencao, nao um fato -- e a compra de 10x apareceria
    // inteira ou nenhuma, dependendo de onde a rede cortasse.
    return {
      ok: false,
      motivo: "parcelado",
      mensagem: "Compra parcelada precisa de conexao para gerar as parcelas.",
    };
  }

  if (NATUREZAS_FIXAS.includes(entrada.tipoDeDespesa ?? "")) {
    // Despesa fixa nao e lancamento: e uma regra em `recurring_rules`, e quem
    // a materializa e a rota. Gravar uma transacao aqui cobraria o valor duas
    // vezes -- agora e de novo quando a ocorrencia do mes for baixada.
    return {
      ok: false,
      motivo: "despesa-fixa",
      mensagem: "Despesa fixa precisa de conexao para criar a regra mensal.",
    };
  }

  if (entrada.confirmado === false) {
    // O LANCAMENTO QUE AINDA NAO ACONTECEU NAO CABE NESTA FILA (HMO-188)
    //
    // A fila grava `LinhaDeTransacao`, ou seja uma linha de
    // `financial_transactions`. Uma previsao e uma linha de
    // `scheduled_transactions`, e a diferenca nao e de tabela: toda linha de
    // `financial_transactions` mexe no saldo da conta no INSERT
    // (`update_account_balance_trigger`) e entra no realizado de todo relatorio.
    //
    // Sem esta porta a fila gravaria a previsao como transacao -- o dinheiro
    // sairia do saldo hoje, o relatorio do mes contaria um gasto que nao houve,
    // e a conta continuaria aparecendo como a pagar em Contas Previstas quando a
    // pessoa a lancasse de novo. E o pior: com a checkbox desmarcada e o aviso
    // "guardei no aparelho", nada na tela indicaria que o destino mudou.
    //
    // A comparacao e `=== false`, e nao `!entrada.confirmado`: ausente quer dizer
    // confirmado (tela antiga em cache), e `!undefined` recusaria todas elas.
    return {
      ok: false,
      motivo: "previsto",
      mensagem:
        "Lancamento previsto precisa de conexao: ele vai para as contas previstas, nao para o saldo.",
    };
  }

  if (entrada.tipo === "transfer") {
    // Transferencia sao DUAS linhas que se anulam (HMO-164). A fila envia uma
    // linha de cada vez e cada envio falha por conta propria, entao um reenvio
    // que acerta metade deixaria o dinheiro so saindo, ou so entrando -- e o
    // saldo das duas contas erraria pelo valor inteiro.
    //
    // Esta porta vem ANTES da checagem de categoria de proposito. Transferencia
    // nao tem categoria, entao sem ela a recusa acontecia mesmo assim, so que
    // pelo ramo `invalido` com a mensagem "Escolha uma categoria" -- mandando a
    // pessoa procurar um campo que a tela de transferencia nao tem.
    return {
      ok: false,
      motivo: "transferencia",
      mensagem:
        "Transferencia precisa de conexao: ela grava duas linhas, e metade delas erraria o saldo das duas contas.",
    };
  }

  if (entrada.compartilhado || (entrada.grupoId && entrada.grupoId !== "none")) {
    // Divisao escreve em `expense_splits`, `group_transactions` e
    // `group_expense_splits`, e o rateio depende de quem esta ATIVO no grupo
    // agora -- uma lista que o aparelho offline nao tem como consultar. Um
    // rateio calculado com a lista de ontem cobra do membro errado.
    return {
      ok: false,
      motivo: "compartilhado",
      mensagem: "Dividir a despesa precisa de conexao para ler quem esta no grupo.",
    };
  }

  const valor = Number.parseFloat(entrada.valor);
  if (!Number.isFinite(valor) || valor === 0) {
    return { ok: false, motivo: "invalido", mensagem: "Informe um valor." };
  }

  if (!entrada.descricao.trim()) {
    return { ok: false, motivo: "invalido", mensagem: "Informe a descricao." };
  }

  if (!entrada.categoryId) {
    return { ok: false, motivo: "invalido", mensagem: "Escolha uma categoria." };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(entrada.data)) {
    return { ok: false, motivo: "invalido", mensagem: "Informe a data." };
  }

  if (!entrada.userId || !entrada.serviceId) {
    // Sem esses dois o insert e recusado pela RLS e pelo NOT NULL. Barrar
    // antes de enfileirar evita uma linha que so vai falhar daqui a horas,
    // longe do formulario que poderia ter avisado.
    return {
      ok: false,
      motivo: "invalido",
      mensagem: "Abra o app com conexao uma vez antes de lancar offline.",
    };
  }

  // -----------------------------------------------------------------------
  // MOEDA ESTRANGEIRA SEM COTACAO NAO PODE ENTRAR NA FILA (HMO-182)
  // -----------------------------------------------------------------------
  // Esta e a ultima porta, e ela existe porque o CHECK da 026 torna esta linha
  // IMPOSSIVEL de gravar, nao apenas arriscada:
  //
  //     CHECK ((currency = 'BRL') = (exchange_rate = 1))
  //
  // A coluna `exchange_rate` tem DEFAULT 1, entao `(USD, sem cotacao)` vira
  // `(USD, 1)` -- o par proibido -- e volta 23514.
  //
  // Recusar AQUI, e nao deixar a sincronizacao descobrir, e a diferenca entre
  // um aviso no formulario e um item que fica `falhou` na fila para sempre. A
  // fila reenvia, e o reenvio nao pode dar outro resultado: nao ha rede que
  // conserte uma cotacao que nunca foi digitada. O comentario de
  // `LinhaDeTransacao.exchange_rate` tem o resto.
  //
  // A cotacao nao e buscavel offline -- a PTAX mora numa API -- entao a unica
  // saida honesta e pedir conexao, como as outras recusas desta funcao fazem.
  const moeda = moedaDaEntrada(entrada);
  if (moeda !== "BRL" && cotacaoDaEntrada(entrada) === null) {
    return {
      ok: false,
      motivo: "sem-cotacao",
      mensagem: `Lancamento em ${moeda} precisa da cotacao do dia, e ela vem do Banco Central -- o aparelho offline nao tem como busca-la. Lance com conexao, ou informe a cotacao na tela.`,
    };
  }

  return { ok: true, linha: montarLinha(entrada, id, valor) };
}

/** A moeda da entrada, normalizada. Ausente cai em BRL, como o DEFAULT da coluna. */
function moedaDaEntrada(entrada: EntradaDeLancamento): string {
  return entrada.moeda && entrada.moeda.trim()
    ? entrada.moeda.trim().toUpperCase()
    : "BRL";
}

/**
 * A cotacao da entrada, como numero -- ou null.
 *
 * MESMA leitura de `cotacaoDigitada` em lib/cambio.ts, repetida aqui porque este
 * modulo e compilado sozinho pela suite offline (sem o passo que reescreve o
 * alias `@/`). Se as duas divergirem, a fila aceita um texto que a tela recusa,
 * ou o contrario -- e o desfecho de aceitar errado e um item eternamente
 * `falhou`. `scripts/test-offline-queue.mjs` compara as duas.
 */
function cotacaoDaEntrada(entrada: EntradaDeLancamento): number | null {
  const cru = String(entrada.cotacao ?? "").trim();
  if (!/^\d{1,3}([.,]\d{1,8})?$/.test(cru)) return null;
  const n = Number(cru.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0 || n === 1) return null;
  return n;
}

function montarLinha(
  entrada: EntradaDeLancamento,
  id: string,
  valor: number
): LinhaDeTransacao {
  return {
    id,
    user_id: entrada.userId,
    service_id: entrada.serviceId,
    category_id: entrada.categoryId,
    account_id: entrada.accountId || null,
    description: entrada.descricao,
    amount: aplicarSinal(valor, entrada),
    transaction_date: entrada.data,
    transaction_type: entrada.tipo,
    notes: entrada.notas,
    // Os dois sao constantes porque `avaliarLancamento` ja recusou tudo que
    // poderia torna-los outra coisa. Escritos aqui, e nao herdados da entrada,
    // para que afrouxar aquela recusa no futuro quebre o teste em vez de
    // gravar uma despesa marcada como dividida e sem nenhum split.
    is_shared: false,
    group_id: null,
    // Herdada da entrada, ao contrario dos dois de cima: a moeda e escolha da
    // pessoa, nao consequencia de uma recusa. O fallback e o DEFAULT da coluna.
    currency: moedaDaEntrada(entrada),
    // A cotacao acompanha a moeda, sempre (026). 1 em BRL -- o unico valor que o
    // CHECK aceita em real -- e a cotacao digitada em qualquer outra moeda.
    //
    // O `?? 1` nao e um fallback de verdade: `avaliarLancamento` recusou
    // `sem-cotacao` antes de chegar aqui, entao moeda estrangeira sempre tem
    // numero. Ele existe para o tipo, e se algum dia virar o caminho real o banco
    // recusa a linha -- que e melhor que gravar a viagem em dolar valendo um por
    // um.
    exchange_rate:
      moedaDaEntrada(entrada) === "BRL" ? 1 : cotacaoDaEntrada(entrada) ?? 1,
  };
}

/**
 * Despesa e gravada NEGATIVA neste banco.
 *
 * A regra e copia fiel da tela (`personal-finance/page.tsx`): mesma ordem,
 * mesmo `Math.abs`. Ela vale a pena repetir porque o erro aqui nao aparece:
 * uma despesa gravada positiva soma no lugar de subtrair, e o saldo fecha
 * errado para mais, que e o lado que ninguem reclama.
 */
function aplicarSinal(valor: number, entrada: EntradaDeLancamento): number {
  if (entrada.tipo === "expense" || entrada.categoriaEhDespesa) {
    return -Math.abs(valor);
  }
  if (entrada.tipo === "income") return Math.abs(valor);
  return valor;
}

// -----------------------------------------------------------------------------
// ENVIO
// -----------------------------------------------------------------------------

export type ResultadoDoEnvio =
  /** Gravou agora. */
  | "gravado"
  /** Ja estava la (reenvio de algo que tinha dado certo). Tambem e sucesso. */
  | "ja-estava-la"
  /** Falha passageira: tenta de novo depois. */
  | "repetir"
  /** Precisa de sessao valida: para a fila e avisa, mas NAO descarta. */
  | "reautenticar"
  /** Nao vai dar certo nunca: marca como falhou para a pessoa relancar. */
  | "falhou";

interface ErroDeEnvio {
  code?: string;
  message?: string;
  status?: number;
  name?: string;
}

/**
 * A segunda armadilha, e ela e o espelho da primeira.
 *
 * Com `ON CONFLICT (id) DO NOTHING`, o reenvio de uma linha que JA gravou
 * responde **sem erro e com zero linhas**. Quem le "zero linhas" como falha --
 * e e a leitura natural, `.single()` ate estoura -- devolve o item para a fila
 * e tenta de novo. Para sempre. A fila nunca esvazia, o contador do aviso
 * nunca zera, e o motivo e um envio que DEU CERTO.
 *
 * Por isso zero linhas sem erro e sucesso aqui, explicitamente.
 */
export function interpretarRespostaDeEnvio(resposta: {
  erro: unknown;
  linhasRetornadas: number;
}): ResultadoDoEnvio {
  if (!resposta.erro) {
    return resposta.linhasRetornadas > 0 ? "gravado" : "ja-estava-la";
  }
  return classificarErroDeEnvio(resposta.erro);
}

export function classificarErroDeEnvio(erro: unknown): ResultadoDoEnvio {
  const e = (erro ?? {}) as ErroDeEnvio;
  const codigo = e.code ?? "";
  const status = typeof e.status === "number" ? e.status : undefined;

  // Chave duplicada: a linha ja esta la. So chega aqui se o insert for feito
  // sem o `ON CONFLICT`; tratar como sucesso mantem os dois caminhos iguais.
  if (codigo === "23505") return "ja-estava-la";

  // RLS ou token vencido. NAO e descarte: depois do login a mesma linha grava
  // normal. Descartar aqui seria apagar o lancamento de quem so ficou tempo
  // demais offline -- exatamente a pessoa que esta fila veio atender.
  if (codigo === "42501" || status === 401 || status === 403) {
    return "reautenticar";
  }

  // Erros de conteudo. Eles nao mudam com o tempo: a categoria foi apagada, a
  // data nao existe, o check recusou o valor. Repetir isso para sempre trava a
  // fila atras de uma linha que nunca vai passar.
  //   23503 = FK, 23514 = CHECK, 22P02 = texto invalido para o tipo,
  //   22003 = numero fora da faixa (numeric(15,2))
  if (["23503", "23514", "22P02", "22003"].includes(codigo)) return "falhou";
  if (status === 400 || status === 404 || status === 409 || status === 422) {
    return "falhou";
  }

  // 5xx, `status: 0`, fetch cru: passageiro. Default do modulo -- o que nao
  // foi reconhecido acima vira "tenta de novo", porque o custo de repetir e
  // uma requisicao e o custo de descartar e um lancamento perdido.
  return "repetir";
}

/**
 * Teto de tentativas.
 *
 * Existe para o caso que nenhuma das classificacoes acima cobre: um erro que
 * se apresenta como passageiro e nao e. Sem teto, esse item fica repetindo
 * enquanto o app existir. Com teto, ele vira "falhou" e APARECE -- que e o que
 * a pessoa precisa para relancar.
 *
 * Dez e alto de proposito: so conta tentativa que chegou a sair, e uma viagem
 * de fim de semana inteira sem rede nao gasta nenhuma.
 */
export const MAX_TENTATIVAS = 10;

/**
 * Aplica o resultado de um envio ao item, devolvendo o proximo estado.
 *
 * Devolve `null` quando o item deve sair da fila (gravou, de um jeito ou de
 * outro). Funcao pura: quem grava no IndexedDB e o chamador.
 */
export function aplicarResultado(
  item: ItemDaFila,
  resultado: ResultadoDoEnvio,
  mensagemDeErro: string | null = null
): ItemDaFila | null {
  if (resultado === "gravado" || resultado === "ja-estava-la") return null;

  const tentativas = item.tentativas + 1;

  if (resultado === "falhou") {
    return { ...item, tentativas, ultimoErro: mensagemDeErro, estado: "falhou" };
  }

  // "reautenticar" nao gasta o teto: a causa e a sessao, nao o lancamento, e
  // queimar as dez tentativas numa viagem longa transformaria "faca login"
  // em "o seu lancamento virou erro permanente".
  if (resultado === "reautenticar") {
    return { ...item, ultimoErro: mensagemDeErro, estado: "pendente" };
  }

  if (tentativas >= MAX_TENTATIVAS) {
    return { ...item, tentativas, ultimoErro: mensagemDeErro, estado: "falhou" };
  }

  return { ...item, tentativas, ultimoErro: mensagemDeErro, estado: "pendente" };
}

/**
 * A ordem de envio: a mais antiga primeiro.
 *
 * O desempate por `id` nao e capricho. Dois lancamentos feitos no mesmo
 * milissegundo (dar dois "Salvar" seguidos e comum) sairiam em ordem
 * indefinida, e a ordem indefinida e o tipo de coisa que passa verde no teste
 * da maquina e troca de comportamento no celular.
 */
export function ordenarParaEnvio(itens: ItemDaFila[]): ItemDaFila[] {
  return itens
    .filter((i) => i.estado === "pendente")
    .sort((a, b) => a.criadoEm - b.criadoEm || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface ResumoDaFila {
  pendentes: number;
  falhados: number;
  /** Soma dos valores pendentes, em modulo -- e quanto ainda nao esta no servidor. */
  totalPendente: number;
}

export function resumirFila(itens: ItemDaFila[]): ResumoDaFila {
  const pendentes = itens.filter((i) => i.estado === "pendente");
  return {
    pendentes: pendentes.length,
    falhados: itens.filter((i) => i.estado === "falhou").length,
    // `Math.abs` porque despesa e negativa aqui. Sem ele, tres despesas
    // pendentes somam -96 e o aviso mostraria "R$ -96 aguardando" -- ou, pior,
    // uma receita e uma despesa se cancelariam e o aviso diria R$ 0.
    totalPendente: pendentes.reduce((s, i) => s + Math.abs(i.linha.amount), 0),
  };
}

/**
 * Id novo para o lancamento.
 *
 * `crypto.randomUUID` existe em todo navegador que o app suporta (o PWA ja
 * exige service worker). O fallback cobre contexto nao seguro, onde a API some
 * -- http://<ip>:3000 na rede local, que e como se testa no celular.
 */
export function novoId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
