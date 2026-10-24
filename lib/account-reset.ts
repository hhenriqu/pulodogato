// -----------------------------------------------------------------------------
// COMECAR DO ZERO SEM PERDER A CONTA
// -----------------------------------------------------------------------------
// "Um botao para excluir tudo e comecar do zero como se fosse uma conta nova"
// (HMO-159). Este modulo e o PLANO desse apagamento -- a lista de tabelas, na
// ordem, com o motivo de cada posicao. Quem executa e
// app/api/account/reset/route.ts; aqui nao ha cliente de banco nenhum, de
// proposito: a ordem e a parte que da para provar num teste, e um teste que
// precisasse de Postgres nao rodaria no CI que roda em todo PR.
//
// O QUE ESTE RESET NAO FAZ, E POR QUE
// -----------------------------------
// 1. NAO apaga a conta de acesso (auth.users) nem o perfil. O pedido e
//    "comecar do zero", nao "sumir": a pessoa continua logada, com o mesmo
//    email e a mesma assinatura. Apagar o perfil derrubaria junto a assinatura
//    gratuita, que nasce de um trigger AFTER INSERT ON profiles -- a conta
//    voltaria sem plano, e nada na tela diria por que.
//
// 2. NAO apaga, nem abandona, GRUPO DE DESPESA -- e nada do que envolve outra
//    pessoa (24/10/2026). Um grupo tem outras pessoas dentro. Apagar um grupo
//    a partir de um botao que diz "limpar MEUS dados" destruiria o historico
//    de quem nunca clicou em nada; sair do grupo calado deixaria uma divida em
//    aberto sem ninguem saber. As duas coisas sao decisoes que tem tela
//    propria, com as consequencias escritas. O reset conta quantos grupos
//    sobraram e manda o usuario para la.
//
//    Ate 24/10/2026 o reset apagava as linhas DO USUARIO dentro do grupo (a
//    despesa de grupo que ele lancou, a conta prevista do grupo), e o saldo do
//    grupo mudava para os outros membros. Com o fechamento (067) e a divisao
//    com pessoa (070) isso deixou de ser so uma consequencia: as travas
//    recusam apagar a conta do fechamento e a conta da divisao, e UMA linha
//    recusada derrubava o DELETE do passo inteiro. O Helio decidiu: "grupos e
//    MyBank de fato nao podem ser apagados, pode manter. so preciso disso bem
//    descrito." Ver "O QUE FICA" abaixo.
//
// 3. NAO recria as contas padrao. Nao precisa: `create_default_accounts`
//    ja e chamada pelo GET /api/financial-accounts quando o usuario nao tem
//    conta nenhuma, e ela mesma verifica isso antes de inserir. Depois do
//    reset, a primeira visita ao painel recria Conta Corrente e Dinheiro
//    zeradas (DUAS desde a 056; antes dela eram quatro, com Cartao de Credito
//    e PIX) -- literalmente o estado de conta nova. Recriar aqui tambem so
//    criaria um segundo lugar com a mesma regra.
//
// POR QUE O APAGAMENTO USA A SESSAO DO USUARIO, E NAO A CHAVE DE SERVICO
// ----------------------------------------------------------------------
// A chave de servico tem BYPASSRLS. Com ela, um `user_id` errado numa unica
// linha deste plano -- um copiar-e-colar, uma coluna que mudou de nome --
// apaga o dado de OUTRA pessoa, e a operacao termina com sucesso. Com a sessao
// do usuario, a mesma linha errada apaga zero linhas: a policy de DELETE de
// cada tabela ja exige `user_id = auth.uid()`. O pior caso deixa de ser
// "destruiu o banco" e passa a ser "nao apagou tudo", que a propria resposta
// da rota denuncia por contagem.
//
// Todas as tabelas deste plano tem policy de DELETE para `authenticated`
// restrita ao dono (002_rls_lockdown e seguintes). Nenhuma depende de
// service_role.
//
// O QUE FICA, E POR QUE (24/10/2026)
// ----------------------------------
// Fica tudo o que outra pessoa ve ou de que outra pessoa depende:
//
//   * GRUPO: o lancamento e a conta prevista de grupo, a recorrencia, o
//     orcamento e a meta de grupo, o aporte em meta de grupo, a conta do
//     fechamento ("Pagamento ao grupo", "A receber do grupo") e o comprovante
//     de acerto. Quem esta no grupo continua vendo as despesas que os outros
//     lancam -- e o que a Leticia viu na conta "nova" dela.
//   * DIVISAO COM PESSOA: o lancamento dividido e as contas "Pagamento a" e
//     "A receber de" que nasceram dele (070). Apagar o lancamento apagaria a
//     conta da OUTRA pessoa junto, pelo trigger da divisao.
//   * MYBANK: as contas previstas e os lancamentos com o elo `mybank:<id>`.
//     O emprestimo e as parcelas nem estao no plano.
//   * O PAGAMENTO DE UMA CONTA QUE FICOU: apagar o lancamento que quitou uma
//     conta reabriria a conta (065) -- "Pagamento a Lais" voltaria a aparecer
//     em aberto, ja paga.
//   * A CONTA (de banco) ONDE ALGUM DESSES MORA: a chave estrangeira recusa
//     apagar a conta de um lancamento que ficou. O saldo dela passa a ser so a
//     soma do que ficou, e a tela de configuracoes diz isso antes do clique.
//
// O que fica e dito de dois jeitos, e os dois estao no plano: `ficam` sao
// regras sobre a propria linha (viram filtro do DELETE), e `elos` sao ids que
// so se conhecem lendo outra tabela no meio do reset (`ConjuntoQueFica`).
//
// QUANDO O BANCO RECUSA MESMO ASSIM
// ---------------------------------
// O DELETE de um passo e UM comando: uma linha que um trigger ou uma chave
// recusa derruba o passo inteiro. Entao o passo que falha e refeito por id, em
// lotes, e o lote recusado e partido ao meio ate achar a linha que o banco nao
// solta (`apagarEmLotes`). Ela fica, e o relatorio diz qual o motivo. Um caso
// que este plano nao previu deixa de travar o resto do reset.
// -----------------------------------------------------------------------------

/**
 * Uma regra de "esta linha fica", sobre uma coluna da propria linha.
 *
 *   * `preenchida`: fica quando a coluna nao e nula (`group_id`, por exemplo);
 *   * `comeca_com`: fica quando o texto comeca com `prefixo` (`notes` com o elo
 *     `mybank:<id>`). A linha com a coluna NULA sai: `NOT LIKE` sobre NULL e
 *     NULL, e um filtro escrito so com ele deixaria no banco todo lancamento
 *     sem anotacao -- quase todos.
 */
export interface RegraQueFica {
  coluna: string;
  quando: "preenchida" | "comeca_com";
  prefixo?: string;
  /** O porque, como a tela escreve: "lançamento de grupo". */
  motivo: string;
}

/**
 * Os conjuntos de ids que so se conhecem lendo o banco NO MEIO do reset.
 *
 *   * `metas_de_grupo`: as metas com `group_id` que eu vejo (as minhas e as
 *     dos grupos em que estou). Fica o meu aporte nelas.
 *   * `lancamentos_divididos`: os lancamentos com `expense_splits` (a divisao
 *     com pessoa). `is_shared` nao serve de regra: a parcela de grupo tambem o
 *     liga, e nada no banco prende a coluna a existencia da divisao.
 *   * `lancamentos_das_contas_que_ficam`: o `transaction_id` das contas
 *     previstas que sobraram. So existe DEPOIS do passo das contas previstas.
 *   * `contas_que_ficam`: as contas (de banco) dos lancamentos, das contas
 *     previstas e das recorrencias que sobraram, mais a conta de onde sai o
 *     emprestimo do MyBank. So existe depois dos tres passos.
 */
export type ConjuntoQueFica =
  | "metas_de_grupo"
  | "lancamentos_divididos"
  | "lancamentos_das_contas_que_ficam"
  | "contas_que_ficam";

/**
 * Os passos que tem de ter rodado antes de um conjunto ser lido. Lido antes,
 * ele ve as linhas que o passo ainda vai apagar e segura o que devia sair --
 * ou, no caso das contas, deixa sair a conta de um lancamento que fica, e o
 * banco recusa o passo.
 */
export const LIDO_DEPOIS_DE: Record<ConjuntoQueFica, string[]> = {
  metas_de_grupo: [],
  lancamentos_divididos: [],
  lancamentos_das_contas_que_ficam: ["scheduled_transactions"],
  contas_que_ficam: [
    "scheduled_transactions",
    "recurring_rules",
    "financial_transactions",
  ],
};

/** Fica a linha cuja `coluna` esta no `conjunto`. */
export interface EloQueFica {
  coluna: string;
  conjunto: ConjuntoQueFica;
  motivo: string;
}

/** Um passo do apagamento: uma tabela, filtrada pela coluna do dono. */
export interface PassoDeReset {
  /** Nome da tabela em public. */
  tabela: string;
  /** Coluna que carrega o id do dono. */
  coluna: string;
  /** Como o passo aparece no relatorio devolvido ao usuario. */
  rotulo: string;
  /**
   * Tabelas DESTE plano que esta tabela referencia por chave estrangeira sem
   * ON DELETE CASCADE -- ou seja, as que precisam ser apagadas DEPOIS dela.
   *
   * Este campo nao e documentacao: e o que
   * scripts/test-account-reset.mjs confere. Sem ele, a unica forma de
   * descobrir que a ordem quebrou seria um usuario clicando no botao e
   * recebendo `violates foreign key constraint` no meio do caminho -- com
   * parte do dado ja apagado e parte nao, que e o pior estado possivel para
   * uma operacao destrutiva.
   */
  apontaPara: string[];
  /** As linhas desta tabela que ficam, pela propria linha. */
  ficam?: RegraQueFica[];
  /** As linhas que ficam por estarem num conjunto lido no meio do reset. */
  elos?: EloQueFica[];
}

/**
 * A ordem do apagamento: filhos antes dos pais.
 *
 * A armadilha que fixa esta ordem esta em 001_baseline:
 *
 *   financial_transactions_account_id_fkey
 *     FOREIGN KEY (account_id) REFERENCES financial_accounts(id);
 *
 * Sem `ON DELETE` nenhum -- ou seja, NO ACTION. Apagar `financial_accounts`
 * antes das transacoes nao cascateia: levanta erro. O mesmo vale para
 * recurring_rules e scheduled_transactions, que tambem apontam para contas sem
 * cascata.
 */
export const PLANO_DE_RESET: PassoDeReset[] = [
  {
    tabela: "receipts",
    coluna: "user_id",
    rotulo: "Comprovantes",
    apontaPara: ["financial_transactions", "scheduled_transactions"],
    // O comprovante de acerto e o unico que outro membro le (receipts_select,
    // 009). O de lancamento e o de conta prevista sao so meus, e saem mesmo
    // quando a linha a que se prendem fica.
    ficam: [
      {
        coluna: "settlement_id",
        quando: "preenchida",
        motivo: "comprovante de acerto de grupo",
      },
    ],
  },
  {
    tabela: "bill_notifications",
    coluna: "user_id",
    rotulo: "Avisos de conta",
    apontaPara: ["scheduled_transactions", "detected_recurrences"],
  },
  {
    tabela: "goal_contributions",
    coluna: "user_id",
    rotulo: "Aportes em metas",
    apontaPara: ["financial_goals"],
    elos: [
      {
        coluna: "goal_id",
        conjunto: "metas_de_grupo",
        motivo: "aporte em meta de grupo",
      },
    ],
  },
  {
    tabela: "financial_goals",
    coluna: "user_id",
    rotulo: "Metas",
    apontaPara: ["financial_accounts"],
    ficam: [{ coluna: "group_id", quando: "preenchida", motivo: "meta de grupo" }],
  },
  {
    tabela: "budgets",
    coluna: "user_id",
    rotulo: "Orçamentos",
    apontaPara: [],
    ficam: [
      { coluna: "group_id", quando: "preenchida", motivo: "orçamento de grupo" },
    ],
  },
  {
    tabela: "scheduled_transactions",
    coluna: "user_id",
    rotulo: "Contas previstas",
    apontaPara: [
      "recurring_rules",
      "financial_accounts",
      "financial_transactions",
    ],
    // As duas do meio as travas da 068 e da 070 recusariam de qualquer jeito.
    // Estar aqui e o que impede que UMA delas derrube o passo inteiro.
    ficam: [
      { coluna: "group_id", quando: "preenchida", motivo: "conta de grupo" },
      {
        coluna: "group_closing_id",
        quando: "preenchida",
        motivo: "conta do fechamento de um grupo",
      },
      {
        coluna: "expense_split_id",
        quando: "preenchida",
        motivo: "conta de uma divisão com pessoa",
      },
      {
        coluna: "notes",
        quando: "comeca_com",
        prefixo: "mybank:",
        motivo: "parcela do MyBank",
      },
    ],
  },
  {
    tabela: "recurring_rules",
    coluna: "user_id",
    rotulo: "Recorrências cadastradas",
    apontaPara: ["financial_accounts"],
    ficam: [
      { coluna: "group_id", quando: "preenchida", motivo: "recorrência de grupo" },
    ],
  },
  {
    tabela: "detected_recurrences",
    coluna: "user_id",
    rotulo: "Assinaturas detectadas",
    apontaPara: [],
  },
  {
    tabela: "categorization_rules",
    coluna: "user_id",
    rotulo: "Regras de categorização",
    apontaPara: [],
  },
  {
    // payroll_deductions vai junto: FK com ON DELETE CASCADE para
    // payroll_entries. Nao aparece como passo proprio porque um passo que
    // sempre apaga zero linhas (as filhas ja foram) daria um relatorio
    // mentiroso -- "Descontos: 0" com holerite cheio de descontos.
    tabela: "payroll_entries",
    coluna: "user_id",
    rotulo: "Holerites",
    apontaPara: ["financial_accounts", "financial_transactions"],
  },
  {
    // statement_entries vai junto, por CASCADE a partir do import.
    tabela: "statement_imports",
    coluna: "user_id",
    rotulo: "Extratos importados",
    apontaPara: ["financial_accounts"],
  },
  // PARCELAMENTO NAO TEM PASSO PROPRIO, E NAO E ESQUECIMENTO (HMO-225).
  //
  // Ate a HMO-358 havia um passo para `transaction_installments`. A tabela ficou
  // orfa: desde a 035 a serie parcelada e materializada em
  // `financial_transactions` (uma linha por mes de fatura), entao as parcelas de
  // hoje ja sao apagadas no passo de `financial_transactions` abaixo. Um passo
  // proprio para a tabela antiga so produziria "Parcelamentos: 0" num relatorio
  // de quem acabou de apagar uma compra em 10x -- o mesmo relatorio mentiroso
  // que o comentario de `payroll_deductions` acima descreve.
  {
    // O apagamento das transacoes dispara os triggers de saldo do baseline,
    // que recalculam financial_accounts.current_balance. As contas que nao
    // guardam nada que fica chegam zeradas ao passo delas.
    //
    // O lancamento de grupo e o dividido ficam (ver "O QUE FICA" no topo), e
    // por isso nada cascateia para `group_transactions` nem para
    // `expense_splits`: o saldo dos grupos e as contas da divisao continuam
    // iguais para os outros.
    tabela: "financial_transactions",
    coluna: "user_id",
    rotulo: "Lançamentos",
    apontaPara: ["financial_accounts"],
    ficam: [
      { coluna: "group_id", quando: "preenchida", motivo: "lançamento de grupo" },
      {
        coluna: "notes",
        quando: "comeca_com",
        prefixo: "mybank:",
        motivo: "lançamento do MyBank",
      },
    ],
    elos: [
      {
        coluna: "id",
        conjunto: "lancamentos_divididos",
        motivo: "lançamento dividido com uma pessoa",
      },
      {
        coluna: "id",
        conjunto: "lancamentos_das_contas_que_ficam",
        motivo: "pagamento de uma conta que ficou",
      },
    ],
  },
  // A CARTEIRA DE INVESTIMENTOS (24/10/2026). Ficava para tras: "conta nova"
  // com PETR4 na carteira. As operacoes cascateiam do ativo (021), e vem antes
  // so para o relatorio contar as duas. `investment_assets.account_id` e
  // ON DELETE SET NULL (059), entao a ordem com as contas nao importa.
  {
    tabela: "investment_transactions",
    coluna: "user_id",
    rotulo: "Operações de investimento",
    apontaPara: [],
  },
  {
    tabela: "investment_assets",
    coluna: "user_id",
    rotulo: "Ativos da carteira",
    apontaPara: [],
  },
  {
    tabela: "financial_accounts",
    coluna: "user_id",
    rotulo: "Contas e cartões",
    apontaPara: [],
    elos: [
      {
        coluna: "id",
        conjunto: "contas_que_ficam",
        motivo: "conta onde ficou um lançamento, uma conta prevista ou um empréstimo do MyBank",
      },
    ],
  },
  {
    tabela: "push_subscriptions",
    coluna: "user_id",
    rotulo: "Dispositivos com notificação",
    apontaPara: [],
  },
  {
    tabela: "notification_preferences",
    coluna: "user_id",
    rotulo: "Preferências de notificação",
    apontaPara: [],
  },
];

/**
 * O que o usuario precisa digitar para o botao funcionar.
 *
 * Um dialogo de "tem certeza?" com um botao vermelho e clicado no automatico
 * -- e esta operacao nao tem desfazer. Digitar a frase e o unico atrito que
 * separa "quero limpar tudo" de "cliquei sem ler". Em portugues e sem acento
 * de proposito: a comparacao ja normaliza, mas a frase que aparece na tela
 * tem que ser digitavel em qualquer teclado, inclusive o do celular.
 */
export const FRASE_DE_CONFIRMACAO = "APAGAR TUDO";

/**
 * Confere a frase digitada.
 *
 * Aceita espaco sobrando nas pontas e qualquer caixa -- teclado de celular
 * capitaliza sozinho, e reprovar "Apagar tudo" seria um atrito sem proposito,
 * que so ensina a pessoa a copiar e colar. O que a frase precisa garantir e
 * INTENCAO, e quem digitou "apagar tudo" teve a intencao.
 */
export function confirmacaoValida(digitado: unknown): boolean {
  if (typeof digitado !== "string") return false;
  return (
    digitado.trim().toLocaleUpperCase("pt-BR") ===
    FRASE_DE_CONFIRMACAO.toLocaleUpperCase("pt-BR")
  );
}

/** O resultado de um passo, como volta para a tela. */
export interface ResultadoDePasso {
  tabela: string;
  rotulo: string;
  /** Linhas apagadas, ou null quando o passo falhou. */
  apagadas: number | null;
  erro?: string;
  /** Linhas que ficaram de proposito: as regras e os elos do passo. */
  mantidas?: number;
  /** Os porques de quem ficou, na ordem do plano. */
  motivos?: string[];
  /** Linhas que o banco recusou apagar mesmo fora das regras. */
  recusadas?: number;
  /** O porque da primeira recusa, como a tela escreve. */
  motivoDaRecusa?: string;
}

/**
 * Le o relatorio dos passos e diz se o reset terminou inteiro.
 *
 * Separado da rota porque e a pergunta que a TELA faz, e ela nao pode
 * responder "deu certo" so porque a resposta chegou com HTTP 200. Um reset
 * parcial -- tres tabelas apagadas, a quarta recusada pela RLS -- deixa a
 * conta num estado que nao e nem o antigo nem o novo, e e exatamente o estado
 * que precisa aparecer escrito na tela em vez de virar um "pronto!".
 *
 * O que FICOU de proposito (`mantidas`) nao tira o "pronto": e o plano. O que
 * o banco RECUSOU (`recusadas`) tira, porque nao era para estar la.
 */
export function resetCompleto(passos: ResultadoDePasso[]): boolean {
  return (
    passos.length > 0 &&
    passos.every(
      (p) => p.apagadas !== null && !p.erro && !((p.recusadas ?? 0) > 0)
    )
  );
}

/** Quantas linhas o reset apagou ao todo, ignorando os passos que falharam. */
export function totalApagado(passos: ResultadoDePasso[]): number {
  return passos.reduce((soma, p) => soma + (p.apagadas ?? 0), 0);
}

/** Quantas linhas ficaram de proposito, somando os passos. */
export function totalMantido(passos: ResultadoDePasso[]): number {
  return passos.reduce((soma, p) => soma + (p.mantidas ?? 0), 0);
}

// -----------------------------------------------------------------------------
// A EXECUCAO
// -----------------------------------------------------------------------------
// O banco entra por uma interface pequena (`BancoDoReset`), e nao pelo client
// do Supabase: e o que deixa a ordem das leituras, o refazer por lotes e o
// relatorio serem provados em scripts/test-account-reset.mjs sem Postgres. A
// rota implementa a interface com o client da sessao.

/** O erro como o PostgREST o devolve. */
export interface ErroDoBanco {
  message: string;
  code?: string;
}

/** Os ids que ficam fora do DELETE, por coluna. */
export interface ExclusaoPorIds {
  coluna: string;
  ids: string[];
}

export interface BancoDoReset {
  /** Um DELETE so: as regras do passo como filtro, e as exclusoes por id. */
  apagarDeUmaVez(
    passo: PassoDeReset,
    exclusoes: ExclusaoPorIds[]
  ): Promise<{ apagadas: number | null; erro: ErroDoBanco | null }>;
  /**
   * As linhas que o passo apagaria pelas regras, com `id` e as colunas dos
   * elos. Todas, paginando.
   */
  lerLinhasQueSaem(
    passo: PassoDeReset
  ): Promise<{ linhas: Record<string, unknown>[] | null; erro: ErroDoBanco | null }>;
  /** DELETE por id, do dono. */
  apagarIds(
    passo: PassoDeReset,
    ids: string[]
  ): Promise<{ apagadas: number | null; erro: ErroDoBanco | null }>;
  /** Quantas linhas do dono sobraram na tabela, ou null se nao deu para contar. */
  contarRestantes(passo: PassoDeReset): Promise<number | null>;
  /** Os ids de um conjunto que fica. */
  lerConjunto(
    conjunto: ConjuntoQueFica
  ): Promise<{ ids: string[] | null; erro: ErroDoBanco | null }>;
}

/**
 * Quantos ids cabem num `not.in.(...)` da URL. Um uuid tem 36 caracteres:
 * 150 dao uns 5,6 KB, abaixo do limite de URL de qualquer proxy no caminho.
 * Acima disso o passo vai direto para os lotes.
 */
export const MAXIMO_DE_IDS_NO_FILTRO = 150;

/** O tamanho do lote do DELETE por id: 100 uuids, uns 3,7 KB de URL. */
export const TAMANHO_DO_LOTE = 100;

/**
 * Quantas chamadas a bissecao pode gastar ALEM de uma por lote. Uma linha
 * recusada num lote de 100 custa umas 14; um passo em que o banco recusa tudo
 * (uma policy que sumiu, por exemplo) pararia aqui em vez de fazer 200
 * chamadas por lote.
 */
export const FOLGA_DA_BISSECAO = 60;

/** O porque de uma recusa, numa frase que a tela pode mostrar. */
export function motivoDaRecusa(erro: ErroDoBanco | null | undefined): string {
  if (!erro) return "o banco recusou sem dizer por quê";
  // 23503: outra linha aponta para esta (chave estrangeira). E o caso de uma
  // conta de banco que guarda um lancamento que ficou e que o plano nao previu.
  if (erro.code === "23503") {
    return "outro registro que ficou aponta para ele";
  }
  return erro.message || "o banco recusou sem dizer por quê";
}

/** Os ids, em lotes de `tamanho`. */
export function emLotes<T>(itens: T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) {
    lotes.push(itens.slice(i, i + tamanho));
  }
  return lotes;
}

/** Uma linha que o banco recusou, com o porque. */
export interface Recusa {
  id: string;
  motivo: string;
}

/**
 * Apaga os ids em lotes e, quando um lote e recusado, parte-o ao meio ate
 * achar as linhas que o banco nao solta.
 *
 * O DELETE de um lote e um comando so: uma linha recusada por um trigger
 * derruba as outras 99. A bissecao apaga as 99 e isola a uma, que vira
 * `Recusa` com o porque. `esgotou` diz que a folga acabou: os ids que nao
 * chegaram a ser tentados voltam como recusados tambem, para o relatorio
 * nunca dizer que saiu o que nao saiu.
 */
export async function apagarEmLotes(
  ids: string[],
  apagar: (
    lote: string[]
  ) => Promise<{ apagadas: number | null; erro: ErroDoBanco | null }>,
  opcoes: { tamanho?: number; folga?: number } = {}
): Promise<{ apagadas: number; recusadas: Recusa[]; esgotou: boolean }> {
  const fila = emLotes(ids, opcoes.tamanho ?? TAMANHO_DO_LOTE);
  const limite = fila.length + (opcoes.folga ?? FOLGA_DA_BISSECAO);
  let chamadas = 0;
  let apagadas = 0;
  let esgotou = false;
  const recusadas: Recusa[] = [];

  while (fila.length > 0) {
    const lote = fila.shift() as string[];
    if (chamadas >= limite) {
      esgotou = true;
      for (const id of lote) {
        recusadas.push({ id, motivo: "não tentado: o banco recusou demais neste passo" });
      }
      continue;
    }
    chamadas += 1;
    const { apagadas: n, erro } = await apagar(lote);
    if (!erro) {
      apagadas += n ?? 0;
      continue;
    }
    if (lote.length === 1) {
      recusadas.push({ id: lote[0], motivo: motivoDaRecusa(erro) });
      continue;
    }
    const meio = Math.ceil(lote.length / 2);
    fila.unshift(lote.slice(0, meio), lote.slice(meio));
  }

  return { apagadas, recusadas, esgotou };
}

/** Os motivos de um passo, na ordem do plano: regras, depois elos. */
export function motivosDoPasso(passo: PassoDeReset): string[] {
  return [
    ...(passo.ficam ?? []).map((r) => r.motivo),
    ...(passo.elos ?? []).map((e) => e.motivo),
  ];
}

/**
 * A linha fica por alguma regra do passo? E a mesma pergunta que o filtro do
 * DELETE faz no banco, escrita para a linha na mao -- o teste confere as duas
 * contra os mesmos casos.
 */
export function linhaFicaPelasRegras(
  passo: PassoDeReset,
  linha: Record<string, unknown>
): boolean {
  return (passo.ficam ?? []).some((regra) => {
    const valor = linha[regra.coluna];
    if (regra.quando === "preenchida") return valor !== null && valor !== undefined;
    return typeof valor === "string" && valor.startsWith(regra.prefixo ?? "");
  });
}

/** As exclusoes por id de um passo, juntas por coluna e sem repeticao. */
export function exclusoesPorColuna(
  elos: { coluna: string; ids: string[] }[]
): ExclusaoPorIds[] {
  const porColuna = new Map<string, Set<string>>();
  for (const elo of elos) {
    const ids = porColuna.get(elo.coluna) ?? new Set<string>();
    for (const id of elo.ids) if (id) ids.add(id);
    porColuna.set(elo.coluna, ids);
  }
  return Array.from(porColuna.entries())
    .map(([coluna, ids]) => ({ coluna, ids: Array.from(ids) }))
    .filter((e) => e.ids.length > 0);
}

/** Um passo do plano, executado. */
export async function executarPasso(
  banco: BancoDoReset,
  passo: PassoDeReset
): Promise<ResultadoDePasso> {
  const resultado: ResultadoDePasso = {
    tabela: passo.tabela,
    rotulo: passo.rotulo,
    apagadas: null,
  };

  // 1. Os conjuntos dos elos, lidos AGORA: depois dos passos anteriores.
  //    Sem eles o passo nao roda -- apagar sem saber o que fica e o defeito
  //    que este arquivo existe para impedir.
  const lidos: { coluna: string; ids: string[] }[] = [];
  for (const elo of passo.elos ?? []) {
    const { ids, erro } = await banco.lerConjunto(elo.conjunto);
    if (erro || !ids) {
      resultado.erro = `não consegui ler o que fica (${elo.motivo}): ${
        erro?.message ?? "sem resposta"
      }`;
      return resultado;
    }
    lidos.push({ coluna: elo.coluna, ids });
  }
  const exclusoes = exclusoesPorColuna(lidos);
  const idsExcluidos = exclusoes.reduce((n, e) => n + e.ids.length, 0);

  // 2. O caminho rapido: um DELETE so.
  let recusadas: Recusa[] = [];
  let erroDoPasso: ErroDoBanco | null = null;
  let feito = false;
  if (idsExcluidos <= MAXIMO_DE_IDS_NO_FILTRO) {
    const { apagadas, erro } = await banco.apagarDeUmaVez(passo, exclusoes);
    if (!erro) {
      resultado.apagadas = apagadas ?? 0;
      feito = true;
    } else {
      erroDoPasso = erro;
    }
  }

  // 3. O caminho por id: os ids que saem, menos os excluidos, em lotes.
  if (!feito) {
    const { linhas, erro } = await banco.lerLinhasQueSaem(passo);
    if (erro || !linhas) {
      resultado.erro = (erroDoPasso ?? erro)?.message ?? "sem resposta do banco";
      return resultado;
    }
    const fora = new Map(exclusoes.map((e) => [e.coluna, new Set(e.ids)]));
    const ids = linhas
      .filter(
        (l) =>
          !Array.from(fora.entries()).some(([coluna, ids]) =>
            ids.has(String(l[coluna]))
          )
      )
      .map((l) => String(l.id));
    const lote = await apagarEmLotes(ids, (parte) => banco.apagarIds(passo, parte));
    resultado.apagadas = lote.apagadas;
    recusadas = lote.recusadas;
    if (recusadas.length > 0) {
      resultado.recusadas = recusadas.length;
      resultado.motivoDaRecusa = recusadas[0].motivo;
    }
  }

  // 4. O que sobrou. Num passo sem regra e sem elo, sobra tem de ser zero; o
  //    que nao for e o DELETE que a RLS filtrou em silencio (o modo de falha 2
  //    de scripts/test-account-reset.mjs), e vira erro em vez de "pronto".
  const restantes = await banco.contarRestantes(passo);
  if (restantes !== null) {
    const mantidas = Math.max(0, restantes - recusadas.length);
    const motivos = motivosDoPasso(passo);
    if (motivos.length === 0) {
      if (mantidas > 0) {
        resultado.erro = `${mantidas} ${
          mantidas === 1 ? "linha não saiu" : "linhas não saíram"
        } e o banco não disse por quê`;
      }
    } else if (mantidas > 0) {
      resultado.mantidas = mantidas;
      resultado.motivos = motivos;
    }
  }

  return resultado;
}

/** O plano inteiro, na ordem. Um passo que falha nao para os seguintes. */
export async function executarPlano(
  banco: BancoDoReset,
  plano: PassoDeReset[] = PLANO_DE_RESET
): Promise<ResultadoDePasso[]> {
  const passos: ResultadoDePasso[] = [];
  for (const passo of plano) {
    passos.push(await executarPasso(banco, passo));
  }
  return passos;
}
