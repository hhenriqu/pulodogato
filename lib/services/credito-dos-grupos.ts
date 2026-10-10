/**
 * LER O CREDITO A RECEBER DE TODOS OS MEUS GRUPOS -- as seis consultas, num
 * lugar so.
 *
 * Extraido de app/api/expense-groups/my-credit/route.ts na HMO-364 (fase F3 da
 * HMO-360), SEM MUDAR UMA CONSULTA: a aba Receitas passou a precisar do mesmo
 * credito dentro do cartao «Previsto», e as duas alternativas eram piores.
 *
 *   * COPIAR as seis consultas para a outra rota cria a segunda implementacao
 *     da mesma leitura. Elas empatariam hoje e divergiriam na primeira mudanca
 *     -- e a divergencia apareceria como "o bloco A receber mostra R$ 106,60 e
 *     o Previsto de Receitas conta R$ 53,30", dois numeros plausiveis sem nada
 *     na tela dizendo por que. E a familia de
 *     `fontes-consistentes-que-discordam`, que este app paga desde a 033;
 *   * CHAMAR a rota por HTTP de dentro da outra rota troca uma leitura de banco
 *     por uma ida a rede com cookie forjado, e a sessao da service role nao
 *     atravessa.
 *
 * A ARITMETICA NAO ESTA AQUI, E NUNCA ESTEVE NA ROTA. `fecharMes`
 * (lib/fechamento-do-grupo.ts), `divisaoDoPeriodo` (lib/divisao-configurada.ts)
 * e `creditoAReceber` (lib/credito-de-grupo.ts) continuam sendo quem decide
 * dinheiro, cada uma com teste e mutantes proprios. Este modulo le, agrupa e
 * repassa.
 *
 * O ERRO VOLTA COMO VALOR, E NAO COMO EXCECAO NEM COMO 500
 * -------------------------------------------------------
 * As duas chamadoras precisam de desfechos OPOSTOS para a mesma falha:
 *
 *   * `my-credit` existe para responder o credito -- sem ele a resposta nao
 *     tem conteudo, e ela devolve 500 com a mensagem de cada consulta (a
 *     mensagem e por consulta desde a HMO-245 e continua byte a byte igual);
 *   * `movimentacoes/resumo?tipo=income` existe para responder Total, Previsto
 *     e Realizado. Trocar os tres numeros do mes por uma tela de erro por causa
 *     do reembolso seria o pior dos dois -- a mesma decisao que a consulta 3b e
 *     a materializacao da agenda ja tomam naquele arquivo. Ela segue com o
 *     credito zerado e um `console.error`.
 *
 * Por isso o retorno e um resultado discriminado e nao um `throw`: um `throw`
 * aqui obrigaria a segunda chamadora a um `try` em volta para descartar, e
 * `catch` vazio e onde erro de verdade vai morrer em silencio.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fecharMes,
  linhaDoRealizado,
  linhaDoPrevisto,
  type LinhaCrua,
} from "@/lib/fechamento-do-grupo";
import { divisaoDoPeriodo } from "@/lib/divisao-configurada";
import {
  creditoAReceber,
  type CreditoAReceber,
  type FechamentoDeGrupo,
} from "@/lib/credito-de-grupo";

/** O credito lido, ou a mensagem que a rota de credito devolve em 500. */
export type LeituraDoCredito =
  | { ok: true; credito: CreditoAReceber }
  | { ok: false; mensagem: string };

/** O credito vazio -- a resposta de quem nao participa de grupo nenhum. */
export const CREDITO_VAZIO: CreditoAReceber = {
  linhas: [],
  total: 0,
  sem_devedor: 0,
};

/**
 * O credito a receber do usuario nos meses pedidos.
 *
 * `meses` em 'AAAA-MM' -- o grao de `fecharMes`. Quem converte o periodo da
 * tela em meses e `mesesDoPeriodo` (lib/periodo-do-painel.ts), nas chamadoras:
 * as duas leem `?de=`/`?ate=` com funcoes diferentes (`lerPeriodo` e
 * `periodoDaQuery`, que divergem no que fazem com data invalida) e trazer essa
 * escolha para dentro daqui a esconderia.
 */
export async function lerCreditoDosGrupos(
  supabase: SupabaseClient,
  userId: string,
  meses: readonly string[]
): Promise<LeituraDoCredito> {
  // ----------------------------------------------------------------
  // 1. Os MEUS grupos, e so os nao arquivados
  // ----------------------------------------------------------------
  // Arquivar zera `is_active` em `expense_groups` e NAO toca a participacao,
  // que segue `active`. Sem o cruzamento, a viagem de 2024 arquivada com um
  // residuo continuaria cobrando esse residuo na tela principal, com link
  // para um grupo que saiu da listagem -- o mesmo cuidado de `my-balance`.
  const { data: minhas, error: erroMinhas } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId)
    .eq("status", "active");

  if (erroMinhas) {
    console.error("Erro ao ler os meus grupos:", erroMinhas);
    return { ok: false, mensagem: "Não foi possível carregar os seus grupos" };
  }

  const meusIds = Array.from(
    new Set((minhas ?? []).map((m) => m.group_id).filter(Boolean))
  );

  if (meusIds.length === 0) return { ok: true, credito: CREDITO_VAZIO };

  const { data: grupos, error: erroGrupos } = await supabase
    .from("expense_groups")
    .select("id, name, default_split_type")
    .in("id", meusIds)
    .eq("is_active", true);

  if (erroGrupos) {
    console.error("Erro ao ler os grupos ativos:", erroGrupos);
    return { ok: false, mensagem: "Não foi possível carregar os seus grupos" };
  }

  const ativos = grupos ?? [];
  if (ativos.length === 0) return { ok: true, credito: CREDITO_VAZIO };

  const groupIds = ativos.map((g) => g.id);

  // ----------------------------------------------------------------
  // 2. Os membros ativos de cada grupo, em ordem ESTAVEL, com o peso
  // ----------------------------------------------------------------
  // A ordem e o desempate do centavo em `ratearPorPeso`: na divisao igual
  // TODOS os restos empatam, entao quem leva o centavo e quem vem primeiro
  // nesta lista. Sem ordem fixa, o centavo trocaria de pessoa a cada
  // carregamento da tela. `joined_at` resolve quase sempre; `user_id` cobre
  // dois membros entrando no mesmo instante.
  //
  // O `.order()` vem do banco e vale para a lista INTEIRA; o agrupamento por
  // grupo abaixo preserva essa ordem porque percorre as linhas na ordem
  // recebida.
  const { data: membrosCrus, error: erroMembros } = await supabase
    .from("group_members")
    .select("group_id, user_id, joined_at, percentage")
    .in("group_id", groupIds)
    .eq("status", "active")
    .order("joined_at", { ascending: true })
    .order("user_id", { ascending: true });

  if (erroMembros) {
    console.error("Erro ao ler os membros dos grupos:", erroMembros);
    return {
      ok: false,
      mensagem: "Não foi possível carregar os membros dos seus grupos",
    };
  }

  const membrosPorGrupo = new Map<
    string,
    { user_id: string; percentage: number | null }[]
  >();
  for (const m of membrosCrus ?? []) {
    if (!m.user_id) continue;
    const lista = membrosPorGrupo.get(m.group_id) ?? [];
    lista.push({ user_id: m.user_id, percentage: m.percentage });
    membrosPorGrupo.set(m.group_id, lista);
  }

  // ----------------------------------------------------------------
  // 3. O nome dos devedores
  // ----------------------------------------------------------------
  // O perfil pode simplesmente NAO VIR, sem erro: as policies de SELECT de
  // `profiles` sao `id = auth.uid()`, `is_public = TRUE` (002) e "conexao
  // aceita" (010), e nenhuma delas olha `group_members`. Dividir a conta com
  // alguem nao da acesso ao perfil dele, e o PostgREST nao reclama -- devolve
  // menos linhas. Esse caminho e normal, e quem escreve o rotulo no lugar do
  // nome e `devedorNaLinha` (lib/credito-de-grupo.ts).
  const userIds = Array.from(
    new Set((membrosCrus ?? []).map((m) => m.user_id).filter(Boolean))
  );

  const { data: perfis } = userIds.length
    ? await supabase.from("profiles").select("id, full_name").in("id", userIds)
    : { data: [] as { id: string; full_name: string | null }[] };

  const nomePorUsuario = new Map(
    (perfis ?? []).map((p) => [p.id, p.full_name ?? null] as const)
  );

  // ----------------------------------------------------------------
  // 4. O REALIZADO de todos os grupos
  // ----------------------------------------------------------------
  // Duas consultas em vez de um embed, pelo mesmo motivo da rota do
  // fechamento: `financial_transactions` tem uma coluna `group_id` E e alvo
  // de `group_transactions.transaction_id`, e embed com mais de um caminho
  // possivel responde PGRST201 numa rota que ninguem tocou -- o apagao que a
  // 038 ja causou neste projeto.
  const { data: vinculos, error: erroVinculos } = await supabase
    .from("group_transactions")
    .select("group_id, transaction_id")
    .in("group_id", groupIds);

  if (erroVinculos) {
    console.error("Erro ao ler as despesas dos grupos:", erroVinculos);
    return {
      ok: false,
      mensagem: "Não foi possível carregar as despesas dos seus grupos",
    };
  }

  const idsDeTransacao = Array.from(
    new Set((vinculos ?? []).map((v) => v.transaction_id).filter(Boolean))
  );

  const { data: realizadas, error: erroRealizadas } = idsDeTransacao.length
    ? await supabase
        .from("financial_transactions")
        .select(
          "id, description, amount, exchange_rate, transaction_date, user_id, transaction_type"
        )
        .in("id", idsDeTransacao)
    : { data: [], error: null };

  if (erroRealizadas) {
    console.error("Erro ao ler as transacoes dos grupos:", erroRealizadas);
    return {
      ok: false,
      mensagem: "Não foi possível carregar as despesas dos seus grupos",
    };
  }

  const realizadaPorId = new Map(
    (realizadas ?? []).map((t) => [t.id, t] as const)
  );

  // A MESMA transacao pode estar vinculada a mais de um grupo, e o vinculo e
  // que diz a qual. Percorrer `group_transactions` -- e nao as transacoes --
  // e o que mantem cada linha no grupo dela.
  const realizadoPorGrupo = new Map<string, LinhaCrua[]>();
  for (const v of vinculos ?? []) {
    const transacao = realizadaPorId.get(v.transaction_id);
    if (!transacao) continue;
    const lista = realizadoPorGrupo.get(v.group_id) ?? [];
    lista.push(linhaDoRealizado(transacao));
    realizadoPorGrupo.set(v.group_id, lista);
  }

  // ----------------------------------------------------------------
  // 5. O PREVISTO de todos os grupos
  // ----------------------------------------------------------------
  // `direction` e lida da view e repassada crua: a precedencia entre o tipo
  // da ocorrencia e o da regra recorrente e da 027, e refazer esse COALESCE
  // aqui e o defeito que ela fechou. A exclusao da conta com baixa
  // (`status = 'paid'`) mora em `linhaDoPrevisto`, e nao num `.neq()` daqui:
  // um filtro de consulta trocado numa refatoracao nao quebra assercao
  // nenhuma, e o defeito que ele cria e um total dobrado que parece plausivel.
  const { data: previstas, error: erroPrevistas } = await supabase
    .from("scheduled_transactions_effective")
    .select(
      "id, description, amount, due_date, user_id, status, direction, group_id"
    )
    .in("group_id", groupIds);

  if (erroPrevistas) {
    console.error("Erro ao ler as previstas dos grupos:", erroPrevistas);
    return {
      ok: false,
      mensagem: "Não foi possível carregar as contas previstas",
    };
  }

  const previstoPorGrupo = new Map<string, LinhaCrua[]>();
  for (const p of previstas ?? []) {
    const linha = linhaDoPrevisto(p);
    if (!linha) continue;
    const lista = previstoPorGrupo.get(p.group_id) ?? [];
    lista.push(linha);
    previstoPorGrupo.set(p.group_id, lista);
  }

  // ----------------------------------------------------------------
  // 6. Um fechamento por grupo e por mes, e o recorte do meu credito
  // ----------------------------------------------------------------
  const fechamentos: FechamentoDeGrupo[] = [];

  for (const grupo of ativos) {
    const membrosDoGrupo = membrosPorGrupo.get(grupo.id) ?? [];
    if (membrosDoGrupo.length === 0) continue;

    // Quem decide se o peso gravado vale -- modo `percentage` com a soma
    // fechando 100% -- e `divisaoDoPeriodo`. Este modulo le e repassa; ele nao
    // tem regra propria sobre porcentagem.
    const divisao = divisaoDoPeriodo(grupo.default_split_type, membrosDoGrupo);

    // O peso vai DENTRO do membro, e nao num array paralelo:
    // `divisaoDoPeriodo` devolve na ordem que recebeu, que e a ordem estavel
    // da consulta. Um segundo array e uma ordem a mais para sair de
    // sincronia, e o defeito que ela produz e a parte de A no nome de B.
    const membros = membrosDoGrupo.map((m, i) => ({
      user_id: m.user_id,
      full_name: nomePorUsuario.get(m.user_id) ?? null,
      peso: divisao.pesos[i].peso,
    }));

    const linhas = [
      ...(realizadoPorGrupo.get(grupo.id) ?? []),
      ...(previstoPorGrupo.get(grupo.id) ?? []),
    ];

    for (const mes of meses) {
      fechamentos.push({
        grupo: { id: grupo.id, nome: grupo.name },
        fechamento: fecharMes(linhas, membros, mes),
      });
    }
  }

  return { ok: true, credito: creditoAReceber(fechamentos, userId) };
}
