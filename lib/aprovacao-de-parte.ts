/**
 * Que acoes cabem numa parte de despesa de grupo, e para quem (HMO-178).
 *
 * Esta regra mora aqui, fora do componente, porque ela e a feature inteira: o
 * cracha de status na tela do grupo existia desde sempre, mas nenhum caminho
 * escrevia outro valor, e o unico jeito de provar que agora existe -- sem
 * subir o app -- e chamar uma funcao pura com os casos de borda e conferir a
 * lista que volta.
 *
 * A regra tem duas metades, e as duas precisam valer:
 *
 *   - a parte e MINHA (aprovar quer dizer "concordo que devo isto"; a rota
 *     responde 403 para parte de outro membro, e o botao nao deve nem aparecer)
 *   - o status atual aceita a transicao
 *
 * Um botao a mais aqui nao e cosmetico: recusar tira a parte de `total_owed` em
 * `group_member_balances`, entao um "Recusar" oferecido na linha errada seria
 * um caminho para mexer no saldo de outra pessoa com dois cliques.
 */

export type StatusDaParte = "pending" | "approved" | "rejected" | "expired";

export type AcaoDaParte = "approve" | "reject" | "reopen";

/**
 * O espelho exato do `ORIGEM_VALIDA` da rota
 * (`app/api/expense-groups/[groupId]/splits/route.ts`). Duplicar a tabela e
 * deliberado: o servidor nao pode confiar na tela, e a tela nao pode ficar
 * esperando um 409 para saber o que desenhar. O que NAO pode e divergir --
 * divergir aqui significa um botao que sempre da erro, ou uma acao possivel
 * que ninguem consegue alcancar.
 */
const ACOES_POR_STATUS: Record<StatusDaParte, AcaoDaParte[]> = {
  pending: ["approve", "reject"],
  approved: ["reopen"],
  rejected: ["reopen"],
  // `expired` nasce de fora do app (nenhum caminho nosso escreve esse valor
  // hoje) e o saldo ja o trata como recusado. Nao oferecemos volta: reabrir
  // algo que o proprio app nao sabe expirar seria inventar uma regra.
  expired: [],
};

/**
 * A parte e de quem esta olhando?
 *
 * Existe como funcao, e nao como `a === b` solto no JSX, por causa de UM caso:
 * `undefined === undefined` e `true`. A sessao ainda carregando (`user` nulo no
 * primeiro render) e um `member` que o join nao trouxe produzem os dois lados
 * indefinidos ao mesmo tempo, e a comparacao ingenua concluiria que a parte e
 * minha -- oferecendo "Recusar" numa linha de dono desconhecido, no instante
 * exato em que a tela abre. A rota barraria (403), mas o botao nao deveria
 * chegar a existir.
 *
 * A rota `/api/expense-groups/[groupId]/transactions` devolve em `split.member`
 * o PERFIL do membro (`profiles.id`, o mesmo id do usuario logado), e nao a
 * linha de `group_members` -- por isso a comparacao certa e contra `user.id`.
 */
export function ehParteDe(
  donoDaParte: string | null | undefined,
  usuarioLogado: string | null | undefined
): boolean {
  if (!donoDaParte || !usuarioLogado) return false;
  return donoDaParte === usuarioLogado;
}

/**
 * `ehMinha` sai de `ehParteDe`. Mantido como booleano na assinatura para que a
 * tabela de transicoes acima possa ser exercitada sozinha, sem inventar ids.
 */
export function acoesDaParte(parte: {
  status: string;
  ehMinha: boolean;
}): AcaoDaParte[] {
  if (!parte.ehMinha) return [];
  return ACOES_POR_STATUS[parte.status as StatusDaParte] ?? [];
}

/** O rotulo que vai no botao. */
export function rotuloDaAcao(acao: AcaoDaParte): string {
  switch (acao) {
    case "approve":
      return "Aprovar";
    case "reject":
      return "Recusar";
    case "reopen":
      return "Reabrir";
  }
}
