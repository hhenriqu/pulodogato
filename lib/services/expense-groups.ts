// =====================================================
// GRUPO DE DESPESA - a travessa que impede arquivar devendo
// =====================================================
// Existe uma pergunta que sair do grupo como ULTIMO membro e apagar o grupo
// precisam fazer antes de mexer em qualquer coisa: "ainda ha quem deva a quem
// aqui?". As duas acoes arquivam o grupo, e arquivar esconde o registro da
// divida das duas telas -- nao ha caminho de volta pelo app.
//
// ELA JA MEDIU A COISA ERRADA DUAS VEZES. As duas valem ser lidas antes de
// mexer aqui, porque as duas ficaram VERDES.
//
// 1) HMO-145 -- a pergunta estava escrita duas vezes, nas duas rotas, e nas
//    duas do mesmo jeito errado:
//
//        const { data } = await supabase
//          .from("group_expense_splits").select("id")
//          .eq("group_id", groupId).eq("status", "pending").limit(1);
//        if (data && data.length > 0) { /* recusa */ }
//
//    `group_expense_splits` NAO TEM coluna `group_id` -- ela chega no grupo por
//    `group_transaction_id -> group_transactions.group_id`. Provado contra o
//    PostgREST de producao: aquela consulta responde
//    `400 {"code":"42703","message":"column group_expense_splits.group_id does
//    not exist"}`.
//
//    E o `error` nao era lido. Entao `data` vinha `null`, `data && ...` era
//    falso, e a travessa concluia "nao ha nada pendente" -- SEMPRE. Falha
//    ABERTA, sem erro em lugar nenhum: nem log, nem 500, nem tela estranha.
//    Por isso a resposta aqui tem TRES valores e nao dois, e e por isso que
//    `nao-deu-para-saber` recusa junto com `ha`. "Nao sei" nao pode colapsar em
//    "nao ha" -- foi exatamente esse colapso que produziu o defeito.
//
// 2) HMO-426 -- consertada a consulta, o criterio ficou sendo `status =
//    'pending'` em alguma parte do grupo. Isso media "falta alguem aprovar a
//    propria parte", e a HMO-425 tirou do app o aprovar/recusar: a rota PATCH
//    de `splits`, a lib e os botoes da tela sairam, e nenhum caminho nosso
//    escreve mais nada nessa coluna. Toda parte nasce 'pending' e fica.
//
//    O efeito era a falha FECHADA, o espelho da de cima: grupo com qualquer
//    despesa lancada nao podia mais ser arquivado nem apagado, para sempre, e a
//    unica porta de saida que existia (aprovar as partes uma por uma) tinha
//    sido removida junto. A HMO-425 trocou as duas mensagens, que mandavam
//    "Finalize todas as divisoes primeiro", e deixou o criterio para esta
//    issue.
//
// O CRITERIO QUE FICA: SALDO, E NAO STATUS DE PARTE
// -------------------------------------------------
// "Ainda ha quem deva a quem" e saldo diferente de zero em
// `public.group_member_balances` (view da 007, recolada na 026) -- o mesmo
// numero que a tela do grupo mostra e que `GET .../balances` devolve. Grupo
// acertado, todo mundo em zero, pode ser arquivado; grupo com saldo em aberto
// continua travado.
//
// A diferenca entre os dois criterios e grande e e o ponto da issue: a view
// NETA os acertos ja registrados (`group_settlements`), e nao olha
// `group_expense_splits.status` a nao ser para descartar 'rejected'/'expired'.
// Entao registrar o acerto zera o saldo com as partes todas ainda 'pending', e
// e esse caminho -- que existe no app, em `POST .../settlements` -- que volta a
// ser a porta de saida. database/tests/hmo426_saldo_em_aberto_trava_arquivar_test.sql
// mede exatamente isso contra um Postgres de verdade.
//
// O QUE CONTINUA TRAVADO PARA SEMPRE, E E DE PROPOSITO
// ----------------------------------------------------
// Acerto nenhum zera um grupo cujos saldos NAO SOMAM ZERO -- despesa lancada no
// grupo e nunca rateada, rateio que nao cobre 100% do valor, parte no nome de
// quem ja saiu (ver `residual` em lib/settlement.ts, e o aviso que a tela de
// saldos ja da). Nesses grupos a travessa recusa indefinidamente, e a recusa
// esta certa: alguem pagou pelo grupo e nao foi reembolsado, e arquivar
// esconderia esse registro. A porta de saida ai nao e o acerto, e consertar a
// despesa -- ratear o que ficou sem rateio, ou apagar a linha errada. Quem
// lancou pode fazer as duas coisas (`financial_transactions_update`/`_delete`
// sao do dono), entao ha caminho; ele so nao e o botao de acerto.
//
// A LEITURA VEM ANTES DE QUALQUER ESCRITA, E NAO E SO HIGIENE
// -----------------------------------------------------------
// A view e `security_invoker` e o `WHERE m.status = 'active'` dela recorta pelo
// membro ATIVO. Quem esta saindo ainda e 'active' no instante da checagem --
// depois do UPDATE que arquiva os membros, a mesma leitura devolveria vazio, ou
// seja "nao ha saldo em aberto". Os dois chamadores perguntam antes de escrever,
// e scripts/test-travessa-de-arquivar.mjs exige que nenhuma escrita saia dos
// caminhos de recusa.
// =====================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export type SaldoEmAberto =
  | { situacao: "ha" }
  | { situacao: "nao-ha" }
  | { situacao: "nao-deu-para-saber"; erro: unknown };

/**
 * Ha membro deste grupo com saldo diferente de zero?
 *
 * Tres estados, e `nao-deu-para-saber` NAO e um detalhe de estilo: ver a
 * HMO-145 no cabecalho do arquivo. Quem chama recusa a acao nos dois estados
 * que nao sao `nao-ha`.
 *
 * A COMPARACAO COM ZERO ACONTECE NO POSTGRES, e e deliberado. `net_balance` e
 * `numeric(15,2)`, e o PostgREST entrega numerico como STRING no JSON -- a rota
 * de saldos tem um `Number()` em cada coluna por causa disso. Um criterio
 * escrito aqui em JavaScript teria de reconstruir o numero antes de compara-lo,
 * e `"0.00" !== 0` e justamente o tipo de comparacao que fica verde para o lado
 * errado. Com `neq` o `WHERE net_balance <> 0` e avaliado em numeric exato, uma
 * vez, por quem guarda o valor.
 *
 * `limit(1)`: a pergunta e de existencia. Nenhum chamador quer saber QUEM deve
 * -- a tela de saldos ja mostra isso, e a lista inteira aqui so daria a quem
 * ler a impressao de que a mensagem de recusa nomeia alguem.
 *
 * ZERO LINHA E `nao-ha`, inclusive para um grupo sem nenhum membro ativo. Isso
 * nao e alcancavel pelos dois chamadores (quem arquiva e o admin 'active'; quem
 * sai como ultimo membro ainda e 'active'), e e o unico valor honesto: grupo
 * sem membro ativo nao tem saldo em aberto para proteger.
 */
export async function saldoEmAbertoNoGrupo(
  supabase: SupabaseClient,
  groupId: string
): Promise<SaldoEmAberto> {
  const { data, error } = await supabase
    .from("group_member_balances")
    .select("user_id")
    .eq("group_id", groupId)
    .neq("net_balance", 0)
    .limit(1);

  if (error) return { situacao: "nao-deu-para-saber", erro: error };
  return (data ?? []).length > 0 ? { situacao: "ha" } : { situacao: "nao-ha" };
}
