// =====================================================
// A LEITURA QUE ALIMENTA A SINTESE DA FATURA ABERTA (HMO-227)
// =====================================================
// A REGRA mora em `lib/agenda-do-cartao.ts` (funcao pura, com teste e
// mutantes). Aqui fica a parte que precisa de banco -- e ela tambem e
// compartilhada, de proposito.
//
// POR QUE A CONSULTA TAMBEM E COMPARTILHADA, e nao so a funcao pura
// -----------------------------------------------------------------
// A HMO-209 ja aprendeu isso com o filtro: `/api/scheduled-transactions`
// alimenta as linhas e `/api/scheduled-transactions/summary` alimenta o
// cabecalho da MESMA pagina. Compartilhar a funcao pura e deixar cada rota
// montar a propria consulta nao fecha o furo -- bastaria uma das duas filtrar
// `invoice_month` com um limite diferente para o cabecalho e as linhas voltarem
// a discordar, agora por uma diferenca que nenhum teste de funcao pura ve. As
// duas rotas chamam ESTA funcao, e ela faz as duas consultas.
//
// AS DUAS CONSULTAS, E POR QUE SAO DUAS
// -------------------------------------
//   1. `card_invoice_lines` -- de onde sai o total da fatura aberta.
//   2. `scheduled_transactions` filtrada pelas CHAVES exatas -- quais daquelas
//      faturas ja foram fechadas e portanto nao podem ser sintetizadas.
//
// A segunda NAO pode ser substituida pelas linhas que a rota ja tem em maos, e
// esse foi o primeiro desenho. A lista da tela consulta com `status=open`
// (pendente ou vencida), entao uma fatura ja PAGA nao esta naquele resultado: a
// de-duplicacao olharia um conjunto sem ela, sintetizaria a fatura de novo, e a
// pessoa que acabou de pagar a fatura a veria reaparecer em Contas a Pagar
// cobrando o mesmo valor. Sem erro, e com o pagamento registrado corretamente
// do outro lado -- so a tela mentindo.
//
// A segunda consulta e por `.in("notes", chaves)`, e nao por janela de data:
// a chave e (mes, cartao), e e exatamente o que a sintese precisa saber. Por
// data, uma fatura fechada cujo `due_date` o usuario editou cairia fora da
// janela e voltaria a ser sintetizada -- a fatura em dobro de novo, por um
// caminho que ninguem procura.
// =====================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sintetizarFaturasAbertas,
  type LinhaDeFaturaAberta,
  type SinteseDaFatura,
} from "@/lib/agenda-do-cartao";
import { chaveFatura } from "@/lib/card-invoice";
import { linhaDaCobrancaNaFatura } from "@/lib/cobranca-no-cartao";
import {
  cobrancasPendentesNosCartoes,
  lancarCobrancasDoCartao,
  vencimentosDasFaturas,
} from "@/lib/services/cobranca-no-cartao";

/** 'AAAA-MM-DD' -> 'AAAA-MM-01' com N meses somados (N pode ser negativo). */
function mesDeslocado(data: string, meses: number): string {
  const ano = Number(data.slice(0, 4));
  const mes = Number(data.slice(5, 7));
  // Base 0 para o calculo e de volta para base 1 na saida.
  const total = ano * 12 + (mes - 1) + meses;
  const anoFinal = Math.floor(total / 12);
  const mesFinal = total - anoFinal * 12 + 1;
  return `${String(anoFinal).padStart(4, "0")}-${String(mesFinal).padStart(2, "0")}-01`;
}

/**
 * As faturas abertas que vencem dentro de [de, ate].
 *
 * A JANELA DA CONSULTA E POR `invoice_month`, E ELA COMECA UM MES ANTES.
 * `card_invoice_due_date()` pode jogar o vencimento para o mes SEGUINTE ao da
 * fatura (e o que acontece em todo cartao cujo `due_day` e menor ou igual ao
 * `closing_day`: fecha dia 28, vence dia 5). Consultar `invoice_month` a partir
 * do mes de `de` perderia justamente a fatura que esta vencendo agora -- a
 * unica que a pessoa abre a tela para ver. O mes a mais nao traz linha extra
 * para a tela: a peneira de janela da funcao pura usa o `due_date` de verdade.
 *
 * Em caso de ERRO de leitura devolve listas vazias e registra no log. Nao
 * lanca: a agenda gravada ainda tem valor, e derrubar a tela inteira por causa
 * da previsao da fatura troca uma linha que falta por uma pagina vazia. O
 * contrario -- inventar uma fatura a partir de uma leitura incompleta -- e que
 * nao pode acontecer, e nao acontece: sem linhas nao ha sintese.
 */
export async function faturasPrevistasDaJanela(
  supabase: SupabaseClient,
  userId: string,
  janela: { de: string; ate: string; hoje: string }
): Promise<SinteseDaFatura> {
  const vazio: SinteseDaFatura = { previstas: [], semVencimento: [] };

  const mesInicial = mesDeslocado(janela.de, -1);
  const mesFinal = mesDeslocado(janela.ate, 0);

  // A COBRANCA QUE VENCEU VIRA COMPRA ANTES DA LEITURA (24/10/2026). Antes, e
  // nao depois: lida primeiro, a compra lancada agora ficaria de fora da soma
  // e a conta prevista dela -- ja paga -- tambem, e a fatura sairia MENOR por
  // uma leitura. Nao lanca erro; ver `lancarCobrancasDoCartao`.
  await lancarCobrancasDoCartao(supabase, userId, janela.hoje);

  // `user_id` E OBRIGATORIO AQUI, e a RLS nao substitui. A policy de
  // `financial_transactions` (002) tem um OR para membro de grupo, entao a
  // view devolve tambem a compra de grupo lancada no cartao de OUTRA pessoa --
  // e somada no agrupamento por cartao ela inflaria a fatura prevista com o
  // gasto de quem divide a casa, num cartao que nem e meu.
  const { data: linhas, error } = await supabase
    .from("card_invoice_lines")
    .select(
      "account_id, account_name, invoice_month, invoice_due_date, invoice_amount"
    )
    .eq("user_id", userId)
    .gte("invoice_month", mesInicial)
    .lte("invoice_month", mesFinal);

  if (error) {
    console.error("Agenda seguiu sem a previsao da fatura do cartão:", error);
    return vazio;
  }

  const lancadas = (linhas ?? []) as LinhaDeFaturaAberta[];

  // AS COBRANCAS QUE AINDA VAO CAIR NA FATURA (24/10/2026). Entram como linhas
  // da MESMA soma: a regra e que elas sao compras que ainda nao aconteceram, e
  // e por esta soma que a fatura aberta chega a Contas a Pagar, ao Previsto da
  // aba Despesas e a previsao do painel. Uma leitura que falha nao derruba a
  // fatura -- ela sai so com o que ja foi lancado, que e o que saia antes.
  const previstas = await linhasDasCobrancas(supabase, userId, lancadas, janela.ate);

  const abertas = [...lancadas, ...previstas];
  if (abertas.length === 0) return vazio;

  // As chaves candidatas, uma por cartao+mes que apareceu na view.
  const chaves = Array.from(
    new Set(
      abertas
        .filter((l) => l.account_id && l.invoice_month)
        .map((l) => chaveFatura(l.invoice_month, l.account_id))
    )
  );

  const { data: fechadas, error: erroFechadas } = await supabase
    .from("scheduled_transactions")
    .select("notes")
    .eq("user_id", userId)
    .in("notes", chaves);

  if (erroFechadas) {
    // SEM A SEGUNDA LEITURA NAO SE SINTETIZA NADA. Seguir com o conjunto vazio
    // de chaves significaria "nenhuma fatura foi fechada", e o resultado seria
    // a fatura em dobro na agenda -- as duas linhas plausiveis, com o mesmo
    // valor e o mesmo vencimento. Entre nao mostrar a previsao e cobrar duas
    // vezes, a previsao que falta e o erro barato.
    console.error(
      "Agenda seguiu sem a previsao da fatura: não foi possível conferir quais faturas já foram fechadas:",
      erroFechadas
    );
    return vazio;
  }

  return sintetizarFaturasAbertas({
    userId,
    linhas: abertas,
    chavesPersistidas: (fechadas ?? [])
      .map((f) => f.notes)
      .filter((n): n is string => typeof n === "string"),
    de: janela.de,
    ate: janela.ate,
    hoje: janela.hoje,
  });
}

/**
 * As cobrancas pendentes nos cartoes como linhas da fatura aberta.
 *
 * O VENCIMENTO: a fatura que ja tem compra lancada traz o dela na propria
 * linha da view, e e esse que vale -- o mesmo que a fatura mostra. So a fatura
 * que por enquanto so tem cobranca prevista pergunta ao banco
 * (`vencimentosDasFaturas`). A que nao deu para calcular fica de fora: sem
 * vencimento conhecido nao ha dia para pôr na agenda, e o aviso de "cartao sem
 * vencimento" seria falso para um cartao que tem `due_day`.
 */
async function linhasDasCobrancas(
  supabase: SupabaseClient,
  userId: string,
  lancadas: LinhaDeFaturaAberta[],
  ate: string
): Promise<LinhaDeFaturaAberta[]> {
  const lidas = await cobrancasPendentesNosCartoes(supabase, userId, { ate });
  if (!lidas || lidas.cobrancas.length === 0) return [];

  const conhecidos = new Map<string, string>();
  for (const l of lancadas) {
    if (l.account_id && l.invoice_month && l.invoice_due_date) {
      conhecidos.set(`${l.account_id}|${l.invoice_month}`, l.invoice_due_date);
    }
  }

  const faltam = lidas.cobrancas.filter(
    (c) => !conhecidos.has(`${c.account_id}|${c.invoice_month}`)
  );
  const perguntados = faltam.length
    ? await vencimentosDasFaturas(supabase, faltam, lidas.cartoes)
    : new Map<string, string | null>();

  const linhas: LinhaDeFaturaAberta[] = [];
  for (const c of lidas.cobrancas) {
    const chave = `${c.account_id}|${c.invoice_month}`;
    const vencimento = conhecidos.has(chave)
      ? (conhecidos.get(chave) as string)
      : perguntados.get(chave);
    if (vencimento === undefined) continue;
    linhas.push(linhaDaCobrancaNaFatura(c, vencimento));
  }
  return linhas;
}
