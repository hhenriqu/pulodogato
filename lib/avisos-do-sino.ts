/**
 * OS AVISOS DO SINO DO CABECALHO.
 *
 * O sino mostrava SO convite de grupo. O resto era um TODO dentro de
 * `useNotifications` ("Lembretes de transacoes", etc.), e o `GET
 * /api/notifications` -- que ja sabia o que vence -- nunca foi lido por ele: a
 * conta vencida aparecia em /dashboard/notifications e o sino dizia "Voce esta
 * em dia com tudo!". E o "lido" morava so no estado do componente: o polling de
 * 30s trazia a mesma lista de volta e o numero vermelho reaparecia.
 *
 * Este modulo e a parte sem I/O: quem le o banco e
 * `app/api/notifications/sino/route.ts`, quem desenha e
 * `components/ui/notifications.tsx`. As familias:
 *
 *   vencimento   conta a vencer (janela do usuario) ou vencida -- a frase e a de
 *                `textoDoAviso`, a mesma do push e do e-mail;
 *   cartao       a fatura do cartao fecha hoje ou nos proximos dias;
 *   grupo        o grupo com dia de fechamento fecha hoje ou nos proximos dias;
 *   aprovacao    alguem dividiu uma despesa com voce e espera a sua resposta,
 *                alguem marcou um pagamento para voce e espera a sua
 *                confirmacao, ou alguem pediu para entrar no grupo que voce
 *                administra.
 *
 * O convite de grupo continua vindo de `list_my_group_invitations()` no
 * cliente, como antes (HMO-196).
 *
 * O ID DO AVISO MUDA QUANDO O AVISO MUDA
 * --------------------------------------
 * O "lido" e guardado pelo id (no navegador; ver `lidosValidos`). Se o id do
 * fechamento do cartao fosse so o id do cartao, marcar como lido em outubro
 * silenciaria novembro para sempre. Entao o id leva a DATA do evento, e a conta
 * que passa de "vence amanha" para "vencida" ganha id novo -- e volta a contar.
 */

import { addMonthsClamped, isIsoDate, lastDayOfMonth } from "@/lib/recurrence";
import { formatarBRL, textoDoAviso, type BillAlert } from "@/lib/services/notifications";

/** Quantos dias antes do fechamento (cartao e grupo) o sino comeca a avisar. */
export const DIAS_DE_ANTECEDENCIA_DO_FECHAMENTO = 3;

export type FamiliaDoAviso =
  | "vencimento"
  | "vencida"
  | "cartao"
  | "grupo"
  | "aprovacao";

/** A acao que o sino oferece no proprio aviso, quando ha uma. */
export type AcaoDoAviso = { tipo: "divisao"; split_id: string };

export interface AvisoDoSino {
  id: string;
  familia: FamiliaDoAviso;
  titulo: string;
  mensagem: string;
  /** Para onde o clique leva. */
  href: string;
  /** A data do evento (vencimento, fechamento) ou do pedido, `YYYY-MM-DD`. */
  data: string;
  /** Menor = mais urgente. Vencida 0, aprovacao 1, o resto pelos dias. */
  prioridade: number;
  acao?: AcaoDoAviso;
}

function paraUtc(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number);
  return Date.UTC(a, m - 1, d);
}

/** Dias de `de` ate `ate`, as duas `YYYY-MM-DD`. Negativo = ja passou. */
export function diasEntre(de: string, ate: string): number {
  return Math.round((paraUtc(ate) - paraUtc(de)) / 86_400_000);
}

/**
 * O proximo dia `dia` do mes em ou depois de `hoje`, com o dia apertado ao fim
 * do mes (cartao que fecha dia 31 fecha 30/11 e 28/02).
 *
 * Diferente de `proximoFechamento` do grupo, que so aceita 1..28 por regra: o
 * cartao aceita qualquer dia, e a fatura de fato fecha no ultimo dia do mes
 * curto.
 */
export function proximaDataDoDia(dia: number, hoje: string): string {
  const [a, m] = hoje.split("-").map(Number);
  const doMes = `${hoje.slice(0, 7)}-${String(
    Math.min(dia, lastDayOfMonth(a, m))
  ).padStart(2, "0")}`;
  return doMes >= hoje ? doMes : addMonthsClamped(`${hoje.slice(0, 7)}-01`, 1, dia);
}

function diaValido(valor: unknown, maximo: number): number | null {
  const n = typeof valor === "string" && valor.trim() !== "" ? Number(valor) : valor;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  return n >= 1 && n <= maximo ? n : null;
}

function quando(dias: number): string {
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  return `em ${dias} dias`;
}

function dataCurta(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

// ---------------------------------------------------------------------------
// VENCIMENTO
// ---------------------------------------------------------------------------

export function avisoDeVencimento(alerta: BillAlert): AvisoDoSino {
  const { title, body } = textoDoAviso(alerta);
  const vencida = alerta.kind === "overdue";
  return {
    id: `vencimento_${alerta.scheduled_transaction_id}_${alerta.kind}`,
    familia: vencida ? "vencida" : "vencimento",
    titulo: title,
    mensagem: body,
    href: "/dashboard/bills",
    data: alerta.due_date,
    prioridade: vencida ? 0 : 2 + Math.max(0, alerta.days_until),
  };
}

// ---------------------------------------------------------------------------
// FECHAMENTO DO CARTAO
// ---------------------------------------------------------------------------

export interface CartaoDoSino {
  id: string;
  name: string;
  closing_day?: number | string | null;
}

export function avisoDeFechamentoDoCartao(
  cartao: CartaoDoSino,
  hoje: string,
  antecedencia = DIAS_DE_ANTECEDENCIA_DO_FECHAMENTO
): AvisoDoSino | null {
  const dia = diaValido(cartao.closing_day, 31);
  if (!dia || !isIsoDate(hoje)) return null;

  const fecha = proximaDataDoDia(dia, hoje);
  const dias = diasEntre(hoje, fecha);
  if (dias < 0 || dias > antecedencia) return null;

  return {
    id: `cartao_${cartao.id}_${fecha}`,
    familia: "cartao",
    titulo:
      dias === 0
        ? `Fatura do ${cartao.name} fecha hoje`
        : `Fatura do ${cartao.name} fecha ${quando(dias)}`,
    mensagem:
      dias === 0
        ? "O que você comprar a partir de amanhã entra na próxima fatura."
        : `Fecha em ${dataCurta(fecha)}. Compras até lá entram nesta fatura.`,
    href: `/dashboard/cartoes/${cartao.id}`,
    data: fecha,
    prioridade: 2 + dias,
  };
}

// ---------------------------------------------------------------------------
// FECHAMENTO DO GRUPO
// ---------------------------------------------------------------------------

export interface GrupoDoSino {
  id: string;
  name: string;
  closing_day?: number | string | null;
}

export function avisoDeFechamentoDoGrupo(
  grupo: GrupoDoSino,
  hoje: string,
  antecedencia = DIAS_DE_ANTECEDENCIA_DO_FECHAMENTO
): AvisoDoSino | null {
  // 1..28: a mesma regra de `diaDeFechamento` (RN018). Fora disso o grupo nao
  // fecha, e o sino nao inventa um dia.
  const dia = diaValido(grupo.closing_day, 28);
  if (!dia || !isIsoDate(hoje)) return null;

  const fecha = proximaDataDoDia(dia, hoje);
  const dias = diasEntre(hoje, fecha);
  if (dias < 0 || dias > antecedencia) return null;

  return {
    id: `grupo_${grupo.id}_${fecha}`,
    familia: "grupo",
    titulo:
      dias === 0
        ? `O grupo ${grupo.name} fecha hoje`
        : `O grupo ${grupo.name} fecha ${quando(dias)}`,
    mensagem:
      dias === 0
        ? "O saldo de cada um vira conta a pagar ou a receber. Lance o que faltou."
        : `Fecha em ${dataCurta(fecha)}. Lance as despesas do grupo antes disso.`,
    href: `/dashboard/expense-groups/${grupo.id}`,
    data: fecha,
    prioridade: 2 + dias,
  };
}

// ---------------------------------------------------------------------------
// APROVACAO
// ---------------------------------------------------------------------------

export interface DivisaoParaAprovar {
  id: string;
  amount: number | string;
  created_at: string;
  descricao: string | null;
  quem_lancou: string | null;
}

export function avisoDeDivisaoParaAprovar(d: DivisaoParaAprovar): AvisoDoSino {
  const quem = d.quem_lancou?.trim() || "Alguém";
  const oque = d.descricao?.trim() ? `"${d.descricao.trim()}"` : "uma despesa";
  return {
    id: `divisao_${d.id}`,
    familia: "aprovacao",
    titulo: `${quem} dividiu ${oque} com você`,
    mensagem: `Sua parte: ${formatarBRL(d.amount)}. Aprove ou recuse.`,
    href: "/dashboard/personal-finance",
    data: d.created_at.slice(0, 10),
    prioridade: 1,
    acao: { tipo: "divisao", split_id: d.id },
  };
}

export interface PagamentoParaConfirmar {
  id: string;
  papel: string;
  situacao: string;
  outra_pessoa: string | null;
  valor: number | string;
  data: string;
  descricao: string | null;
}

/** So o pagamento que EU recebo e ainda nao lancei (`a_lancar`). */
export function avisoDePagamentoParaConfirmar(
  p: PagamentoParaConfirmar
): AvisoDoSino | null {
  if (p.papel !== "recebi" || p.situacao !== "a_lancar") return null;
  const quem = p.outra_pessoa?.trim() || "Alguém";
  return {
    id: `pagamento_${p.id}`,
    familia: "aprovacao",
    titulo: `${quem} lançou um pagamento para você`,
    mensagem: `${formatarBRL(p.valor)}${
      p.descricao?.trim() ? ` · ${p.descricao.trim()}` : ""
    }. Confirme em qual conta entrou.`,
    href: "/dashboard",
    data: p.data,
    prioridade: 1,
  };
}

export interface PedidosDeEntrada {
  group_id: string;
  group_name: string;
  quantos: number;
}

export function avisoDePedidosDeEntrada(p: PedidosDeEntrada): AvisoDoSino | null {
  if (!(p.quantos > 0)) return null;
  return {
    // A contagem no id: um pedido novo volta a acender o sino.
    id: `entrada_${p.group_id}_${p.quantos}`,
    familia: "aprovacao",
    titulo:
      p.quantos === 1
        ? `1 pedido para entrar no grupo ${p.group_name}`
        : `${p.quantos} pedidos para entrar no grupo ${p.group_name}`,
    mensagem: "Você administra o grupo. Aprove ou recuse na página dele.",
    href: `/dashboard/expense-groups/${p.group_id}`,
    data: "",
    prioridade: 1,
  };
}

// ---------------------------------------------------------------------------
// ORDEM E "LIDO"
// ---------------------------------------------------------------------------

/** Mais urgente primeiro; no empate, a data mais proxima. */
export function ordenarAvisos(avisos: AvisoDoSino[]): AvisoDoSino[] {
  return [...avisos].sort(
    (a, b) => a.prioridade - b.prioridade || a.data.localeCompare(b.data) || a.id.localeCompare(b.id)
  );
}

/**
 * Os ids lidos que ainda valem: os que estao na lista de agora. O resto e
 * jogado fora, para o que fica guardado no navegador nao crescer sem limite.
 */
export function lidosValidos(lidos: Iterable<string>, ids: Iterable<string>): string[] {
  const atuais = new Set(ids);
  return Array.from(new Set(lidos)).filter((id) => atuais.has(id));
}

export function contarNaoLidos(ids: Iterable<string>, lidos: Iterable<string>): number {
  const marcados = new Set(lidos);
  return Array.from(new Set(ids)).filter((id) => !marcados.has(id)).length;
}
