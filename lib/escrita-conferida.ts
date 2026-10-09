/**
 * Zero linha e FALHA, nao sucesso (HMO-203).
 *
 * Este modulo existe por causa de uma resposta medida em producao em
 * 2026-09-30, na rota de restaurar grupo:
 *
 *     ANTES:  is_active=false  archived_at=<set>  restored_at=null
 *     rota:   HTTP 200 {"success":true,"message":"Grupo restaurado com sucesso!"}
 *     DEPOIS: is_active=false  archived_at=<set>  restored_at=null
 *
 * O codigo da rota parecia correto:
 *
 *     const { error } = await supabase.from("expense_groups")
 *       .update({ is_active: true, ... }).eq("id", groupId);
 *     if (error) { ...500... }
 *
 * ===========================================================================
 * POR QUE `if (error)` NAO DISPARA
 * ===========================================================================
 * A policy de UPDATE daquela tabela e `USING (is_group_admin(id))`, e o chamador
 * tinha deixado de passar nela. A RLS, nesse caso, **filtra as linhas em vez de
 * recusar o comando**: o PATCH volta `HTTP 200` com corpo `[]`. Nao ha erro,
 * nao ha SQLSTATE, nao ha log. `42501` so aparece quando falta GRANT -- nao
 * quando a policy simplesmente nao casa com a linha.
 *
 * E `supabase-js` **sem `.select()` nao devolve contagem**: `data` vem `null` e
 * `error` vem `null`. Os dois unicos sinais que a rota tinha eram indistinguiveis
 * entre "escreveu" e "nao escreveu nada".
 *
 * Nao da para auditar isso lendo o codigo da rota: o defeito mora na combinacao
 * RLS + driver. O que da e exigir `.select()` em toda escrita sob RLS e tratar
 * a lista vazia como falha -- e e so isso que este arquivo faz.
 *
 * ===========================================================================
 * POR QUE UM MODULO, E NAO UM `if` EM CADA ROTA
 * ===========================================================================
 * Tres razoes, em ordem de peso:
 *
 *   1. o `if` certo tem um detalhe facil de errar: `data` pode ser `null`
 *      (quando o `.select()` foi esquecido) e isso NAO e o mesmo que `[]`
 *      (quando a RLS filtrou). Tratar os dois como "zero linhas" esconde o
 *      primeiro, que e um defeito de programacao e nao um de permissao -- e
 *      quem o escondeu volta a ter uma rota que mente. Aqui eles tem motivos
 *      diferentes;
 *   2. tem teste proprio. Um `if` repetido em oito rotas nao tem como ter;
 *   3. a mensagem. "Zero linhas" nao e informacao para quem le o log: o que
 *      ajuda e a frase que nomeia a escrita e lembra a causa provavel, porque
 *      ela e quase sempre a mesma (RLS que o pre-check da rota nao reproduz).
 *
 * ===========================================================================
 * O QUE ESTE MODULO NAO FAZ
 * ===========================================================================
 * Nao transforma zero linha em HTTP 500 por conta propria, e nao escolhe o
 * status. Em algumas rotas zero linha e **404** ("esse membro nao esta
 * pendente"), noutras e **500** ("o banco recusou em silencio uma escrita que o
 * pre-check aprovou"). Quem sabe a diferenca e a rota; este arquivo entrega o
 * fato e a frase.
 *
 * Nao serve para escrita cuja resposta certa e "zero linha esta bom" -- um
 * `delete` de compensacao num caminho de erro, por exemplo, onde a linha pode
 * ja nao existir. Forcar a conferencia ali mascararia o erro original.
 */

/**
 * A forma do retorno de `supabase-js` para `.update(...).select(...)` e
 * `.delete().select(...)`. Declarada aqui, e nao importada do tipo gerado,
 * porque o que este modulo precisa saber e so isto -- e porque um tipo mais
 * preciso obrigaria cada chamador a provar o shape das colunas que ele pediu no
 * `.select()`, que nao tem nada a ver com contar linhas.
 */
export type RespostaDeEscrita = {
  data: unknown[] | null;
  error: { message: string } | null;
};

export type EscritaConferida =
  | { ok: true; linhas: number }
  /** O banco recusou com erro de verdade: CHECK, FK, trigger, falta de GRANT. */
  | { ok: false; motivo: "erro"; mensagem: string }
  /**
   * A escrita "passou" e nao pegou nenhuma linha. Em rota sob RLS este e o caso
   * da HMO-203, e e o unico que nao se anuncia.
   */
  | { ok: false; motivo: "nenhuma-linha"; mensagem: string }
  /**
   * `data` nulo com `error` nulo: o `.select()` nao foi encadeado, entao NAO HA
   * contagem para conferir. Separado de "nenhuma-linha" de proposito -- aqui a
   * escrita pode ter funcionado perfeitamente, e o defeito e no chamador. Juntar
   * os dois casos daria a uma rota sem `.select()` a aparencia de uma rota
   * barrada pela RLS, e o conserto iria para o lugar errado.
   */
  | { ok: false; motivo: "sem-select"; mensagem: string };

/**
 * @param resposta  o `{ data, error }` devolvido por `.update(...).select(...)`
 *                  ou `.delete().select(...)`. O `.select()` NAO e opcional.
 * @param oQueFalhou  a escrita, nomeada do ponto de vista de quem le o log:
 *                    "restaurar o grupo", "arquivar os membros". Entra nas
 *                    mensagens.
 */
export function conferirEscrita(
  resposta: RespostaDeEscrita,
  oQueFalhou: string
): EscritaConferida {
  // O erro vem primeiro: quando ele existe, `data` e nulo de qualquer forma, e
  // diagnosticar "nenhuma linha" em cima de um CHECK violado mandaria procurar
  // policy onde o problema e dado.
  if (resposta.error) {
    return {
      ok: false,
      motivo: "erro",
      mensagem: `Nao foi possivel ${oQueFalhou}: ${resposta.error.message}`,
    };
  }

  if (resposta.data === null) {
    return {
      ok: false,
      motivo: "sem-select",
      mensagem:
        `A escrita de "${oQueFalhou}" foi feita sem .select(), entao nao ha como ` +
        `saber se ela pegou alguma linha. Encadeie .select() e confira as linhas ` +
        `afetadas -- ver lib/escrita-conferida.ts (HMO-203).`,
    };
  }

  if (resposta.data.length === 0) {
    return {
      ok: false,
      motivo: "nenhuma-linha",
      mensagem:
        `Nao foi possivel ${oQueFalhou}: o banco nao encontrou nenhuma linha ` +
        `para escrever. Em escrita sob RLS isto costuma ser a policy recusando ` +
        `em silencio (ela FILTRA em vez de recusar), e nao um erro de dado.`,
    };
  }

  return { ok: true, linhas: resposta.data.length };
}
