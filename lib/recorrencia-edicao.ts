// ---------------------------------------------------------------------------
// ALTERAR OU APAGAR UMA OCORRENCIA: SO ESTA, DESTA EM DIANTE, OU TODAS
// ---------------------------------------------------------------------------
// HMO-170 entregou os dois primeiros alcances na EDICAO. A HMO-228 acrescenta o
// terceiro (`todas`) e estende os tres para a EXCLUSAO.
//
// A issue pede tres coisas de uma edicao numa serie que se repete:
//
//   - "alterar apenas esse registro"      -> `apenas_esta`
//   - "esse e os proximos"                -> `esta_e_proximas`
//   - "ou todas as parcelas"              -> `todas`
//   - "mas nunca mudar o que ja passou"   -> a garantia que vale nos TRES casos
//
// O que este arquivo decide e SO isto: dado o alcance e a ocorrencia clicada
// (a ancora), quais linhas recebem a alteracao. Ele nao fala com o banco, e por
// isso da para testar a regra que erra dinheiro sem subir Postgres.
//
// O QUE E "O QUE JA PASSOU"
// -------------------------
// Nao e "data no passado". E `status = 'paid'`: a ocorrencia paga tem uma
// `financial_transactions` amarrada nela (a coluna `transaction_id` da migration
// 005), ou seja o dinheiro ja se moveu e o mes ja fechou. Mudar o valor dela
// reescreveria um extrato que a pessoa ja conferiu.
//
// Uma conta VENCIDA e nao paga continua sendo presente: ela e uma obrigacao
// aberta, aparece em "Vencidas" na tela de contas previstas, e e justamente a
// que a pessoa vai querer corrigir ("a luz veio 340, nao 300"). Tratar
// `due_date < hoje` como passado impediria a correcao mais comum que existe.
//
// Por isso a barreira NAO e a data de hoje: e a data da ANCORA. Quem clicou em
// novembro pediu para mexer de novembro para frente, e outubro em aberto nao
// pode ser arrastado junto -- nem quando outubro ainda esta pendente.
//
// POR QUE A ANCORA E A BARREIRA, E NAO `hoje`
// -------------------------------------------
// Uma versao anterior desta regra usava `due_date >= hoje`, copiada da rota que
// edita a REGRA (`/api/recurring-rules/{id}`, que propaga para "todas as
// pendentes futuras"). Nas duas telas isso parece igual, e nao e: editando a
// ancora de dezembro com o alcance "esta e as proximas", o filtro por `hoje`
// tambem reescreveria outubro e novembro, que estao pendentes e sao ANTERIORES
// a ancora. A pessoa pediu "daqui para frente" e recebeu "desde sempre".
//
// E O `todas`, QUE E O UNICO QUE OLHA PARA TRAS (HMO-228)
// -------------------------------------------------------
// `todas` e o unico alcance que alcanca ocorrencias ANTERIORES a ancora, e por
// isso ele nao e "mais um item no Select": ele e o unico que pode reescrever um
// mes que a pessoa ja conferiu.
//
// A garantia da HMO-170 continua valendo nele, e continua valendo PELO MESMO
// MOTIVO de sempre: por `status`, nao por data. `todas` significa **todas as
// abertas** -- toda ocorrencia `pending`, do primeiro mes ao ultimo
// materializado. O que estiver `paid`, `skipped` ou `cancelled` fica de fora.
//
// Trocar essa barreira por uma de data (`due_date >= hoje`, a tentacao obvia
// de quem escreve "nunca mude o passado") produz os dois erros de uma vez:
//
//   - deixa de alterar a conta VENCIDA e nao paga, que e justamente a que a
//     pessoa escolheu "todas" para corrigir;
//   - e NAO protege a conta paga ANTECIPADAMENTE -- dezembro quitado em outubro
//     tem `due_date` no futuro, passaria pelo filtro de data e teria o valor
//     reescrito depois de o dinheiro ter andado.
//
// O mutante `todas_barreira_por_data` em scripts/mutantes-alcance-da-serie.mjs
// existe para que essa troca fique vermelha.
//
// E a contagem de `preservadas` nao e enfeite: um "todas" que deixou 3 meses de
// fora em silencio e indistinguivel de um "todas" que mentiu. A rota devolve o
// numero e a tela mostra.
// ---------------------------------------------------------------------------

/** Os tres alcances que a tela oferece. */
export type AlcanceDaEdicao = "apenas_esta" | "esta_e_proximas" | "todas";

export const ALCANCES: AlcanceDaEdicao[] = [
  "apenas_esta",
  "esta_e_proximas",
  "todas",
];

/**
 * Este alcance sai da ancora e pega irmas?
 *
 * Existe como funcao para que a rota decida se precisa buscar a serie no banco
 * sem repetir a condicao. Esquecer o `todas` nesse `if` -- o erro natural ao
 * acrescentar o terceiro alcance a um `if` escrito para dois -- faria a rota
 * planejar sobre uma lista VAZIA de irmas e responder "alterei 1 ocorrencia"
 * com cara de sucesso, sem erro em lugar nenhum.
 */
export function alcancaIrmas(alcance: AlcanceDaEdicao): boolean {
  return alcance !== "apenas_esta";
}

export function ehAlcanceValido(valor: unknown): valor is AlcanceDaEdicao {
  return ALCANCES.includes(valor as AlcanceDaEdicao);
}

/**
 * O minimo que a decisao precisa saber de uma ocorrencia. E de proposito menor
 * que a linha do banco: tudo que nao entra aqui nao pode influenciar o alcance.
 */
export interface OcorrenciaParaAlcance {
  id: string;
  /** YYYY-MM-DD */
  due_date: string;
  status: string;
  recurring_rule_id: string | null;
}

export interface PlanoDeEdicao {
  /** As ocorrencias que recebem o patch, a ancora inclusa. */
  ids: string[];
  /**
   * A REGRA tambem muda? So em `esta_e_proximas`, e so quando a ancora veio de
   * uma regra. Sem isto, a alteracao valeria para as ocorrencias que JA estao
   * na agenda e a proxima geracao traria o valor velho de volta -- o aluguel
   * reajustado voltaria a 2.500 no mes seguinte ao ultimo materializado, sem
   * ninguem ter pedido.
   */
  atualizarRegra: boolean;
  /**
   * A data da ancora, para a rota poder explicar o que fez.
   *
   * Em `esta_e_proximas` ela E a barreira. Em `todas` ela e so a ocorrencia
   * clicada: ali nao ha barreira de data, e e por isso que este campo nao se
   * chama `barreiraEm`.
   */
  ancoraEm: string;
  /**
   * Ocorrencias que a edicao deixou de fora DE PROPOSITO, por serem anteriores
   * a ancora ou por ja estarem pagas. A rota devolve a contagem para a tela
   * poder dizer "3 meses anteriores ficaram como estavam" -- um numero que nao
   * aparece e uma garantia que ninguem ve.
   */
  preservadas: string[];
}

/**
 * Quais linhas esta edicao toca.
 *
 * `ancora` e a ocorrencia clicada. `irmas` sao as outras ocorrencias da MESMA
 * regra (a ancora pode vir na lista ou nao; o resultado e o mesmo).
 *
 * A ancora entra sempre, mesmo paga: quem barra a edicao de uma ocorrencia paga
 * e a rota, com um 409 que explica o estorno, e nao este calculo. Se a barra
 * estivesse aqui, o pedido voltaria um "nada para atualizar" generico.
 */
export function planejarEdicao(
  alcance: AlcanceDaEdicao,
  ancora: OcorrenciaParaAlcance,
  irmas: OcorrenciaParaAlcance[]
): PlanoDeEdicao {
  const base: PlanoDeEdicao = {
    ids: [ancora.id],
    atualizarRegra: false,
    ancoraEm: ancora.due_date,
    preservadas: [],
  };

  // Conta avulsa (sem regra) nao tem "proximas": ela e uma linha so. Aceitar
  // `esta_e_proximas` aqui e inofensivo justamente porque nao ha irma para
  // arrastar, e recusar obrigaria a tela a saber disso antes de pedir.
  if (alcance === "apenas_esta" || !ancora.recurring_rule_id) return base;

  const daMesmaRegra = irmas.filter(
    (o) => o.id !== ancora.id && o.recurring_rule_id === ancora.recurring_rule_id
  );

  const alcancadas: string[] = [];
  const preservadas: string[] = [];

  for (const irma of daMesmaRegra) {
    // A barreira de DATA, e ela so existe em `esta_e_proximas`. `>=` e sobre a
    // data da ancora, nao sobre hoje -- ver o cabecalho. Duas ocorrencias no
    // mesmo dia (possivel numa serie que trocou de dia de vencimento) andam
    // juntas, que e a leitura de "as proximas".
    //
    // Em `todas` nao ha barreira de data NENHUMA, e e disso que o alcance
    // consiste: ele e o unico que alcanca o que vence antes da ancora. Quem
    // protege o mes conferido ali e so o `status` logo abaixo.
    if (alcance === "esta_e_proximas" && irma.due_date < ancora.due_date) {
      preservadas.push(irma.id);
      continue;
    }

    // Paga e passado, mesmo com vencimento depois da ancora: quem adiantou o
    // pagamento de dezembro ja moveu o dinheiro de dezembro.
    //
    // 'skipped' e 'cancelled' tambem ficam fora, por outro motivo: a pessoa
    // tirou aquele mes da agenda de proposito. Reescrever o valor de uma
    // ocorrencia pulada nao a ressuscita, mas deixa a linha inconsistente com
    // a decisao que a criou, e a proxima leitura nao sabe qual das duas vale.
    if (irma.status !== "pending") {
      preservadas.push(irma.id);
      continue;
    }

    alcancadas.push(irma.id);
  }

  return {
    ids: [ancora.id, ...alcancadas],
    atualizarRegra: true,
    ancoraEm: ancora.due_date,
    preservadas,
  };
}

/**
 * Os campos que uma edicao de ocorrencia pode propagar para as proximas.
 *
 * `due_date` NAO esta aqui, e essa ausencia e a decisao mais importante deste
 * arquivo. Copiar a data da ancora para as irmas colocaria dezembro, janeiro e
 * fevereiro todos vencendo no mesmo dia -- o indice unico
 * `idx_scheduled_rule_due_unique` (005) recusaria a segunda, e a edicao
 * voltaria um erro de banco sem relacao visivel com o que foi pedido.
 *
 * Mudar o DIA de vencimento de uma serie e alterar o calendario dela, e isso
 * vive na regra (`due_day` em `/api/recurring-rules/{id}`), que sabe apagar a
 * agenda pendente e gerar de novo. A rota recusa a combinacao em vez de aplicar
 * so na ancora: aplicar metade calada e o modo de falha que este projeto ja
 * pagou varias vezes.
 */
export const CAMPOS_PROPAGAVEIS = [
  "description",
  "amount",
  "category_id",
  "account_id",
  "notes",
] as const;

export type CampoPropagavel = (typeof CAMPOS_PROPAGAVEIS)[number];

/**
 * O patch cabe no alcance pedido?
 *
 * Devolve o motivo da recusa em vez de um booleano para que a rota responda o
 * que fazer ("mude o dia na regra"), e nao so que nao deu.
 */
export function conferirPatchNoAlcance(
  alcance: AlcanceDaEdicao,
  campos: string[]
): { ok: true } | { ok: false; mensagem: string } {
  // `alcancaIrmas` e nao `!== "esta_e_proximas"`: a forma antiga liberava o
  // `todas` sem conferir nada, e mudar `due_date` em "todas as parcelas"
  // colocaria a serie inteira vencendo no mesmo dia -- a colisao no indice
  // unico (rule_id, due_date) da 005 depois de o UPDATE ja ter passado em
  // algumas linhas. Meia serie alterada, erro de banco na tela.
  if (!alcancaIrmas(alcance)) return { ok: true };

  const naoPropagaveis = campos.filter(
    (campo) => !CAMPOS_PROPAGAVEIS.includes(campo as CampoPropagavel)
  );

  if (naoPropagaveis.includes("due_date")) {
    return {
      ok: false,
      mensagem:
        'Mudar o vencimento de várias parcelas é uma alteração no gasto fixo, não em uma conta. Altere o dia na regra, ou escolha "alterar apenas esta".',
    };
  }

  if (naoPropagaveis.length > 0) {
    return {
      ok: false,
      mensagem: `Estes campos valem só para uma ocorrência: ${naoPropagaveis.join(", ")}. Escolha "alterar apenas esta".`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// APAGAR (HMO-228)
// ---------------------------------------------------------------------------
// O DELETE nao oferecia alcance nenhum: toda exclusao de ocorrencia de gasto
// fixo virava `skipped` naquela linha. Quem apagava "a conta fixa" perdia UM
// mes e recebia os outros de volta.
//
// POR QUE `skipped` SOZINHO NAO APAGA UMA CONTA FIXA
// --------------------------------------------------
// `skipped` (e nao DELETE) e o que impede a ocorrencia de ressuscitar: a linha
// fica la e o indice unico (recurring_rule_id, due_date) da 005 segura o lugar
// dela contra o `upsert ... ignoreDuplicates` de `materializarAgenda`.
//
// Mas isso protege **so os meses ja materializados**. `materializarAgenda` roda
// sobre um horizonte rolante (`horizonteAte()`, 3 meses) e a regra continua
// `is_active`: os vencimentos ALEM do horizonte de hoje nao tem linha nenhuma
// segurando o lugar, e serao criados do zero na proxima geracao.
//
// A conta apagada nao volta amanha -- ela volta **alguns meses depois**, que e
// pior, porque ninguem liga uma coisa a outra. Quem apagou em outubro vai
// achar, em fevereiro, que o app recriou a conta sozinho.
//
// Encerrar a regra e o que fecha a torneira. Em `esta_e_proximas` isso e
// `end_date` na data da ancora: `occurrencesBetween` trata `end_date` como
// INCLUSIVO (`if (due > hardEnd) break`), entao a propria ancora continua
// gerando -- e e exatamente o que se quer, porque a linha dela existe e esta
// `skipped`. Nada depois dela volta a ser gerado.
//
// POR QUE `todas` NAO GANHA CODIGO PROPRIO
// ----------------------------------------
// "apagar todas as parcelas de um gasto fixo" e, palavra por palavra, o que
// `DELETE /api/recurring-rules/{id}` ja faz: `is_active = false` na regra e as
// ocorrencias abertas em `cancelled`. Este plano devolve `desativarRegra` para
// que a rota CHAME aquele caminho em vez de crescer um segundo igual -- dois
// lugares que encerram uma regra divergem no primeiro conserto que so um dos
// dois receber.
// ---------------------------------------------------------------------------

export interface PlanoDeExclusao {
  /**
   * Ocorrencias que viram `skipped`, a ancora inclusa. Vazio quando quem age e
   * outro caminho (`desativarRegra` ou `apagarDeVez`).
   */
  idsParaPular: string[];
  /**
   * O que vai em `recurring_rules.end_date`, ou `null` para nao mexer na regra.
   *
   * Sem isto, `esta_e_proximas` marcaria as linhas de hoje e a conta voltaria
   * no primeiro mes que a agenda ainda nao tinha criado. O teste que confere
   * so o `skipped` das linhas passa verde com esse defeito de pe -- por isso a
   * assercao exigida pela issue e sobre a REGRA ter recebido `end_date`.
   */
  encerrarRegraEm: string | null;
  /** `todas`: a rota delega para o caminho que desativa a regra inteira. */
  desativarRegra: boolean;
  /** Linha avulsa (sem regra): DELETE de verdade, em qualquer alcance. */
  apagarDeVez: boolean;
  /**
   * Ocorrencias deixadas de fora de proposito -- pagas, ja puladas ou (em
   * `esta_e_proximas`) anteriores a ancora. A contagem vai para a tela.
   */
  preservadas: string[];
  /** A data da ocorrencia clicada. */
  ancoraEm: string;
}

/**
 * Quais linhas esta exclusao toca, e se a regra tambem tem de ser encerrada.
 *
 * Nao fala com o banco e nao conhece `hoje`: a barreira do que fica de fora e
 * a mesma de `planejarEdicao` -- a data da ancora em `esta_e_proximas`, e o
 * `status` nos tres alcances.
 *
 * A ancora PAGA nao e tratada aqui: quem recusa e a rota, com 409, antes de
 * chamar esta funcao. Se a barra estivesse aqui, o pedido voltaria um
 * "nada para apagar" generico em vez da frase que explica o estorno.
 */
export function planejarExclusao(
  alcance: AlcanceDaEdicao,
  ancora: OcorrenciaParaAlcance,
  irmas: OcorrenciaParaAlcance[]
): PlanoDeExclusao {
  const base: PlanoDeExclusao = {
    idsParaPular: [],
    encerrarRegraEm: null,
    desativarRegra: false,
    apagarDeVez: false,
    preservadas: [],
    ancoraEm: ancora.due_date,
  };

  // Conta avulsa: nao ha regra para ressuscitar a linha, entao DELETE e a
  // resposta honesta -- e ela vale igual nos tres alcances, porque uma linha so
  // nao tem "proximas" nem "todas". Aceitar qualquer alcance aqui, em vez de
  // recusar, evita que a tela precise saber disso antes de pedir.
  if (!ancora.recurring_rule_id) return { ...base, apagarDeVez: true };

  if (alcance === "todas") return { ...base, desativarRegra: true };

  if (alcance === "apenas_esta") {
    return { ...base, idsParaPular: [ancora.id] };
  }

  // esta_e_proximas
  const daMesmaRegra = irmas.filter(
    (o) => o.id !== ancora.id && o.recurring_rule_id === ancora.recurring_rule_id
  );

  const alcancadas: string[] = [];
  const preservadas: string[] = [];

  for (const irma of daMesmaRegra) {
    if (irma.due_date < ancora.due_date) {
      preservadas.push(irma.id);
      continue;
    }
    // Paga fica: o dinheiro andou. `skipped`/`cancelled` tambem, por ja estarem
    // fora da agenda -- remarcar o que ja esta pulado inflaria a contagem que a
    // tela mostra ("pulei 7") com meses que ninguem tirou agora.
    if (irma.status !== "pending") {
      preservadas.push(irma.id);
      continue;
    }
    alcancadas.push(irma.id);
  }

  return {
    ...base,
    idsParaPular: [ancora.id, ...alcancadas],
    encerrarRegraEm: ancora.due_date,
    preservadas,
  };
}
