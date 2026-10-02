/**
 * As decisoes do convite de grupo que nao dependem de banco (HMO-197).
 *
 * POR QUE ISTO E UM MODULO, E NAO CODIGO SOLTO NA ROTA
 * ---------------------------------------------------
 * `app/api/expense-groups/invite/route.ts` so e alcancavel com sessao e banco.
 * As tres regras aqui sao as que erram em silencio -- a duplicata que nao e
 * detectada, o email que e gravado num formato que o cadastro nao reconhece, e a
 * mensagem que diz "convite enviado" para um convite que ainda nao foi entregue a
 * ninguem. Fora da rota elas tem teste; dentro, nao teriam.
 *
 * O acoplamento que importa esta anotado em cada funcao: a normalizacao daqui
 * tem de ser a MESMA da migration 039 (`LOWER(btrim(...))`). Se as duas
 * divergirem, o convite e gravado com um `invite_target` que o trigger do
 * cadastro nao casa -- e o convite fica orfao exatamente no caso que a 039
 * existe para resolver, sem erro em lugar nenhum.
 */

/** O que a rota le de cada convite pendente do grupo para decidir duplicata. */
export type ConvitePendente = {
  invited_user_id: string | null;
  invite_target: string | null;
};

/**
 * O email como ele vai para o banco: sem espaco em volta, com a caixa que a
 * pessoa digitou.
 *
 * A caixa e preservada de proposito -- `invite_target` e o que o admin ve na
 * lista de convites do grupo, e "Leticia@Gmail.com" devolvido como
 * "leticia@gmail.com" parece que o sistema corrigiu o que ele escreveu. Quem
 * ignora a caixa e a COMPARACAO, nao o armazenamento.
 */
export function alvoParaGravar(valor: unknown): string {
  return String(valor ?? "").trim();
}

/**
 * A mesma chave que `LOWER(btrim(...))` produz no Postgres.
 *
 * `toLowerCase()` e nao `toLocaleLowerCase()`: o LOWER do Postgres aqui roda com
 * o collation do banco, e usar a locale do servidor Node faria o par divergir em
 * casos como o "I" turco. Email e ASCII na pratica, e a divergencia silenciosa e
 * pior que a limitacao.
 */
export function alvoParaComparar(valor: unknown): string {
  return alvoParaGravar(valor).toLowerCase();
}

/**
 * Ja existe convite pendente para este convidado neste grupo?
 *
 * As DUAS pernas valem sempre, e nao uma OU outra:
 *
 *   * pela CONTA, quando ela existe -- era so isso que a rota olhava, e e o que
 *     impede dois cartoes iguais no sino da mesma pessoa;
 *   * pelo EMAIL, para os convites que ainda nao tem dono. Sem esta perna,
 *     convidar duas vezes alguem que ainda nao se cadastrou grava duas linhas, e
 *     no dia do cadastro o trigger da 039 reclama as duas: a pessoa abre o app e
 *     ve o mesmo convite duplicado.
 *
 * Olhar so a perna da conta tambem deixaria passar a duplicata no caso da conta
 * NAO confirmada: `get_user_by_email` nao a devolve (entao `invitedUserId` e
 * nulo), mas pode haver um convite sem dono para aquele email ali.
 */
export function jaTemConvitePendente(
  pendentes: readonly ConvitePendente[],
  invitedUserId: string | null,
  alvo: string
): boolean {
  const procurado = alvoParaComparar(alvo);

  return pendentes.some(
    (c) =>
      (invitedUserId !== null && c.invited_user_id === invitedUserId) ||
      (c.invited_user_id === null &&
        alvoParaComparar(c.invite_target) === procurado)
  );
}

/** Como o convite chegou (ou vai chegar) ao convidado. */
export type EntregaDeConvite = "in_app" | "on_signup";

export function entregaDoConvite(invitedUserId: string | null): EntregaDeConvite {
  return invitedUserId === null ? "on_signup" : "in_app";
}

/**
 * A frase que o admin le depois de convidar.
 *
 * Os dois casos sao entregas DIFERENTES e a frase tem de dizer qual aconteceu.
 * Essa distincao e o assunto da HMO-196/197, nao um detalhe de texto: a rota
 * antiga respondia sucesso para um convite que nenhuma tela do produto
 * conseguiria mostrar, e o admin ficava esperando uma notificacao que nao existia
 * -- foi assim que 5 convites invisiveis foram criados em producao.
 *
 * Com conta  : o convite JA esta no sino da pessoa.
 * Sem conta  : o convite esta GUARDADO e o cadastro dela o entrega. O texto nao
 *              promete notificacao nenhuma agora, e oferece o codigo do grupo
 *              como caminho mais rapido.
 */
export function mensagemDeConvite(params: {
  invitedUserId: string | null;
  nomeConvidado: string;
  alvo: string;
  groupCode: string;
}): string {
  const { invitedUserId, nomeConvidado, alvo, groupCode } = params;

  if (invitedUserId === null) {
    return (
      `${alvo} ainda não tem conta no PuloDoGato. O convite ficou guardado e ` +
      `aparece no app dela assim que ela se cadastrar com esse email, dentro de ` +
      `14 dias. Para ser mais rápido, passe o código ${groupCode} para ela ` +
      `entrar direto.`
    );
  }

  return (
    `Convite enviado para ${nomeConvidado}. Ele aparece nas notificações do ` +
    `app dela, com Aceitar e Recusar, e vale por 14 dias.`
  );
}
