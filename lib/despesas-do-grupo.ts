/**
 * A DESPESA DE GRUPO NA ABA DESPESAS, NUMA LINHA SO (pedido do Helio, 24/10/2026).
 *
 * "Um custo lancado em um grupo por outra pessoa deve ser exibido o total
 * nomeado Despesas do Grupo {nome}, e um chevron que voce pode clicar e ele
 * mostra os custos detalhados por despesa, ou clica em cima e te leva ao grupo.
 * Abaixo, onde tem os Pagamentos ao grupo, exibe as transferencias que devem
 * ser realizadas, e um icone de copia e cola que ja gera o valor e o Pix da
 * pessoa."
 *
 * TRES ESPECIES DE LINHA, UMA FORMA SO
 * ------------------------------------
 *   * `estimativa` -- o grupo com dia de fechamento, ANTES do fechamento. A
 *     conta prevista que outro membro lancou nao aparece no mes em que vence:
 *     ela vira a estimativa do fechamento, no mes do fechamento, e so no
 *     Previsto ("O lancamento no grupo de outubro deveria fechar dia 01 e
 *     aparecer pras pessoas em novembro apenas", "como previsto, e bem claro
 *     que e o previsto"). O detalhe e por despesa, com a minha parte de cada
 *     uma, e o que eu ja paguei abatido;
 *   * `conta_do_fechamento` -- o mesmo grupo DEPOIS do fechamento: a conta
 *     "Pagamento ao grupo X" de verdade, com o detalhe do que fechou e os Pix
 *     que a quitam (RN019.5);
 *   * `sem_fechamento` -- o grupo sem dia de fechamento. As contas dos outros
 *     continuam no mes delas, pela minha parte (regra do pagador), mas numa
 *     linha so por grupo e por mes.
 *
 * NENHUM NUMERO MUDA AQUI
 * ----------------------
 * Este modulo so DESCREVE linhas que a lista ja tem: `linhas` diz quais ids da
 * lista a linha do grupo agrega, e o valor dela na tela e a soma dessas linhas.
 * O resumo da aba (Total, Previsto, Realizado) e a lista continuam vindo de
 * `linhasDaTela` e `resumoDaTela`, sem nada daqui no meio.
 *
 * Funcoes puras, sem I/O.
 */

import { ratearPorPeso } from "@/lib/fechamento-do-grupo";
import { chaveDaEstimativa, type EstimativaDoGrupo } from "@/lib/fechamento-no-resultado";
import type { ItemDoFechamento, PosicaoNoPeriodo } from "@/lib/fechamento-por-periodo";
import { toCents, toReais } from "@/lib/settlement";

/**
 * O prefixo do `transaction_id` da conta prevista quando ela entra na conta da
 * estimativa como se fosse despesa (lib/services/fechamento-no-resultado.ts).
 * Nao e uuid, e por isso nunca chega a `group_closing_items`: o cron fecha so
 * o realizado.
 */
export const PREFIXO_DA_PREVISTA_NA_ESTIMATIVA = "prevista:";

/** Uma despesa do grupo, no detalhe que o chevron abre. */
export interface ItemDoGrupoNaLista {
  descricao: string | null;
  /** `YYYY-MM-DD`: a data da despesa, ou o vencimento da conta prevista. */
  data: string;
  /** Quem lancou: o pagador da despesa, ou o dono da conta prevista. */
  quem_lancou: string | null;
  /** O nome de quem lancou, quando o perfil e legivel. A rota preenche. */
  nome_de_quem_lancou: string | null;
  /** BRL, positivo. */
  valor_cheio: number;
  /** BRL, positivo. A soma das partes e a minha responsabilidade, exata. */
  minha_parte: number;
  /** A conta ainda nao foi paga por quem a lancou. */
  prevista: boolean;
}

/** Uma linha do detalhe que ABATE o que eu devo ("Você já pagou"). */
export interface AbatimentoDoGrupo {
  rotulo: string;
  /** BRL. Positivo abate; negativo soma (acerto que eu recebi). */
  valor: number;
}

/** Um Pix que eu tenho de mandar para quitar a conta do fechamento. */
export interface TransferenciaDoAcerto {
  para_user_id: string;
  /** `full_name`, ou `null` quando o perfil nao e legivel. */
  nome: string | null;
  /** BRL, positivo. */
  valor: number;
}

export type TipoDoGrupoNaLista = "estimativa" | "conta_do_fechamento" | "sem_fechamento";

export interface GrupoNaLista {
  /** A chave da linha na tela. */
  chave: string;
  tipo: TipoDoGrupoNaLista;
  group_id: string;
  /** O nome do grupo, ou `null` quando ele nao e legivel. */
  nome: string | null;
  /** O tipo da linha: Despesas ou Receitas. */
  direcao: "expense" | "income";
  /**
   * Os ids das linhas da lista (`LinhaDaTela.id`) que esta linha agrega. A
   * tela desenha a linha do grupo no lugar da primeira delas e esconde as
   * outras; o valor e a soma delas.
   */
  linhas: string[];
  /** O dia do fechamento (`YYYY-MM-DD`), ou `null` no grupo que nao fecha. */
  fechamento: string | null;
  itens: ItemDoGrupoNaLista[];
  abatimentos: AbatimentoDoGrupo[];
  transferencias: TransferenciaDoAcerto[];
}

export const ROTULO_JA_PAGUEI = "Você já pagou";
export const ROTULO_VOU_PAGAR = "Contas que você lançou";
export const ROTULO_ACERTOS = "Acertos já feitos";

/** "Despesas do Grupo Casa" -- o nome que o Helio pediu, letra por letra. */
export function tituloDoGrupo(g: Pick<GrupoNaLista, "tipo" | "nome" | "direcao">): string {
  const nome = g.nome ?? "do grupo";
  if (g.direcao === "income") return `A receber do Grupo ${nome}`;
  return `Despesas do Grupo ${nome}`;
}

/** 'AAAA-MM-DD' -> 'DD/MM', por fatia. Nunca `new Date`: o fuso desloca o dia. */
function diaEMes(iso: string): string {
  return iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : iso;
}

/**
 * O selo da estimativa: diz que e PREVISTO e ate quando. "Pode aparecer mas
 * como previsto, e bem claro que e o previsto."
 */
export function seloDoGrupo(g: Pick<GrupoNaLista, "tipo" | "fechamento">): string | null {
  if (g.tipo === "estimativa" && g.fechamento) {
    return `previsto até o fechamento de ${diaEMes(g.fechamento)}`;
  }
  if (g.tipo === "conta_do_fechamento" && g.fechamento) {
    return `fechamento de ${diaEMes(g.fechamento)}`;
  }
  return null;
}

/** O caminho da tela do grupo, para onde o nome da linha leva. */
export function caminhoDoGrupo(groupId: string): string {
  return `/dashboard/expense-groups/${encodeURIComponent(groupId)}`;
}

const reais = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);

/** "Transferir R$ 250,00 para Helio". */
export function textoDaTransferencia(t: Pick<TransferenciaDoAcerto, "nome" | "valor">): string {
  return `Transferir ${reais(t.valor)} para ${t.nome ?? "outro membro do grupo"}`;
}

/**
 * A minha parte de cada despesa, em centavos exatos: a minha responsabilidade
 * repartida entre as despesas pelo valor de cada uma, com o centavo que sobra
 * pelo maior resto (`ratearPorPeso`). A soma e a responsabilidade, sempre --
 * um detalhe que nao soma o total ao lado dele e lido como erro de conta.
 */
export function partesPorDespesa(
  valores: readonly number[],
  minhaResponsabilidade: number
): number[] {
  const pesos = valores.map((v, i) => ({ user_id: String(i), peso: toCents(Math.abs(v)) }));
  if (pesos.every((p) => p.peso === 0)) return valores.map(() => 0);
  const partes = ratearPorPeso(toCents(Math.abs(minhaResponsabilidade)), pesos);
  return valores.map((_, i) => toReais(partes.get(String(i)) ?? 0));
}

/**
 * O detalhe de um periodo do grupo para um membro, a partir da MESMA conta que
 * gera a estimativa e o fechamento (`fecharPeriodo`) -- ou da foto gravada,
 * quando o periodo ja fechou (`group_closings.members` e
 * `group_closing_items`).
 *
 * A soma fecha com a conta: soma das partes - abatimentos = o que eu devo
 * (`responsabilidade - pago - acertos`). Do lado de quem recebe, e o mesmo
 * numero com o sinal trocado.
 */
export function detalheDoPeriodo(
  fechamento: {
    membros: readonly Pick<PosicaoNoPeriodo, "user_id" | "pago" | "acertos" | "responsabilidade">[];
    itens: readonly Pick<ItemDoFechamento, "kind" | "transaction_id" | "from_user_id" | "amount" | "item_date" | "description">[];
  },
  userId: string
): { itens: ItemDoGrupoNaLista[]; abatimentos: AbatimentoDoGrupo[] } {
  const eu = fechamento.membros.find((m) => m.user_id === userId);
  const despesas = fechamento.itens.filter((i) => i.kind === "despesa");
  const partes = partesPorDespesa(
    despesas.map((d) => Number(d.amount) || 0),
    Number(eu?.responsabilidade) || 0
  );

  const itens: ItemDoGrupoNaLista[] = despesas
    .map((d, i) => ({
      descricao: d.description ?? null,
      data: d.item_date,
      quem_lancou: d.from_user_id ?? null,
      nome_de_quem_lancou: null,
      valor_cheio: toReais(toCents(Math.abs(Number(d.amount) || 0))),
      minha_parte: partes[i],
      prevista: String(d.transaction_id ?? "").startsWith(PREFIXO_DA_PREVISTA_NA_ESTIMATIVA),
    }))
    // Por data, e o que eu lancei por ultimo dentro do dia nao importa.
    .sort((a, b) => a.data.localeCompare(b.data));

  // O que eu "paguei" na conta do periodo tem duas origens, e a tela diz as
  // duas: a despesa que eu ja paguei de verdade e a conta prevista que EU lancei
  // e que entra na estimativa como se ja estivesse paga (ela vai estar, no dia
  // dela). Juntar as duas num "Você já pagou" afirmaria um pagamento que nao
  // aconteceu.
  let pagoCents = 0;
  let lancadoCents = 0;
  for (const d of despesas) {
    if (d.from_user_id !== userId) continue;
    const c = toCents(Math.abs(Number(d.amount) || 0));
    if (String(d.transaction_id ?? "").startsWith(PREFIXO_DA_PREVISTA_NA_ESTIMATIVA)) {
      lancadoCents += c;
    } else {
      pagoCents += c;
    }
  }
  const acertosCents = toCents(Number(eu?.acertos) || 0);

  const abatimentos: AbatimentoDoGrupo[] = [];
  if (pagoCents !== 0) abatimentos.push({ rotulo: ROTULO_JA_PAGUEI, valor: toReais(pagoCents) });
  if (lancadoCents !== 0) abatimentos.push({ rotulo: ROTULO_VOU_PAGAR, valor: toReais(lancadoCents) });
  if (acertosCents !== 0) abatimentos.push({ rotulo: ROTULO_ACERTOS, valor: toReais(acertosCents) });

  return { itens, abatimentos };
}

/**
 * A estimativa do fechamento como linha de grupo. Ela agrega UMA linha da
 * lista, a da propria estimativa (`chaveDaEstimativa`), e o detalhe vem pronto
 * de `lerEstimativasDoFechamento`.
 */
export function gruposDasEstimativas(
  estimativas: readonly EstimativaDoGrupo[]
): GrupoNaLista[] {
  return estimativas.map((e) => ({
    chave: chaveDaEstimativa(e),
    tipo: "estimativa" as const,
    group_id: e.group_id,
    nome: e.nome.trim() || null,
    direcao: e.tipo,
    linhas: [chaveDaEstimativa(e)],
    fechamento: e.vencimento,
    itens: e.detalhe?.itens ?? [],
    abatimentos: e.detalhe?.abatimentos ?? [],
    transferencias: [],
  }));
}

/** Os Pix em que EU pago, dos pares que quitam o que esta em aberto. */
export function transferenciasDoMembro(
  pares: readonly { de_user_id: string; para_user_id: string; valor: number }[],
  userId: string,
  nomes: ReadonlyMap<string, string>
): TransferenciaDoAcerto[] {
  return pares
    .filter((p) => p.de_user_id === userId && p.para_user_id !== userId && p.valor > 0)
    .map((p) => ({
      para_user_id: p.para_user_id,
      nome: nomes.get(p.para_user_id) ?? null,
      valor: p.valor,
    }));
}

/** Uma conta de grupo de outro membro, no grupo sem dia de fechamento. */
export interface ContaDeOutroMembro {
  /** O id da linha na lista (`LinhaDaTela.id`). */
  id: string;
  group_id: string;
  descricao: string | null;
  data: string;
  quem_lancou: string | null;
  /** O valor da conta, cheio. */
  valor_cheio: number;
  /** O que entrou na lista: a minha parte. */
  minha_parte: number;
}

/**
 * As contas dos outros membros do grupo sem fechamento, uma linha por grupo e
 * por mes. O mes entra na chave porque a tela pode pedir um intervalo maior
 * que um mes, e "Despesas do Grupo Casa" de outubro e de novembro sao duas
 * contas diferentes.
 *
 * A ordem dos grupos e a da primeira conta de cada um na entrada, que ja vem
 * na ordem da lista: a linha do grupo fica onde a primeira conta dele estava.
 */
export function gruposSemFechamento(
  contas: readonly ContaDeOutroMembro[],
  nomesDosGrupos: ReadonlyMap<string, string>,
  nomes: ReadonlyMap<string, string>
): GrupoNaLista[] {
  const porChave = new Map<string, GrupoNaLista>();
  for (const c of contas) {
    const mes = c.data.slice(0, 7);
    const chave = `grupo:${c.group_id}:${mes}`;
    let g = porChave.get(chave);
    if (!g) {
      g = {
        chave,
        tipo: "sem_fechamento",
        group_id: c.group_id,
        nome: nomesDosGrupos.get(c.group_id) ?? null,
        direcao: "expense",
        linhas: [],
        fechamento: null,
        itens: [],
        abatimentos: [],
        transferencias: [],
      };
      porChave.set(chave, g);
    }
    g.linhas.push(c.id);
    g.itens.push({
      descricao: c.descricao,
      data: c.data,
      quem_lancou: c.quem_lancou,
      nome_de_quem_lancou: c.quem_lancou ? nomes.get(c.quem_lancou) ?? null : null,
      valor_cheio: c.valor_cheio,
      minha_parte: c.minha_parte,
      prevista: true,
    });
  }
  const grupos = Array.from(porChave.values());
  for (const g of grupos) g.itens.sort((a, b) => a.data.localeCompare(b.data));
  return grupos;
}

/** Preenche o nome de quem lancou cada item, pelo mapa de perfis da rota. */
export function comOsNomes(
  itens: readonly ItemDoGrupoNaLista[],
  nomes: ReadonlyMap<string, string>
): ItemDoGrupoNaLista[] {
  return itens.map((i) => ({
    ...i,
    nome_de_quem_lancou: i.quem_lancou ? nomes.get(i.quem_lancou) ?? null : null,
  }));
}
