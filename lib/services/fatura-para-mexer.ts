/**
 * A FATURA QUE SE VAI MOVER OU PARCELAR: o cartao do usuario e a linha da
 * agenda dela, se a fatura ja foi fechada.
 *
 * As duas acoes (app/api/card-invoices/mover e /parcelar) recusam a fatura
 * PAGA -- mexer nela depois da baixa desfaria a conta que a baixa fechou -- e
 * apagam a linha PENDENTE: a fatura fechada guardou um total que deixa de
 * existir, e a seguinte e fechada de novo quando chegar a hora.
 */
import { NextResponse } from "next/server";
import { chaveFatura } from "@/lib/card-invoice";
import { primeiroDiaDaFatura } from "@/lib/mover-e-parcelar-fatura";

export type FaturaParaMexer =
  | {
      ok: true;
      mes: string;
      cartao: { id: string; name: string };
      /** A linha da agenda da fatura fechada e ainda pendente, ou `null`. */
      pendenteId: string | null;
    }
  | { ok: false; resposta: NextResponse };

export async function faturaParaMexer(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  body: { account_id?: unknown; month?: unknown }
): Promise<FaturaParaMexer> {
  const recusa = (error: string, status: number) => ({
    ok: false as const,
    resposta: NextResponse.json({ error }, { status }),
  });

  const accountId =
    typeof body.account_id === "string" && body.account_id ? body.account_id : null;
  const mes =
    typeof body.month === "string" ? primeiroDiaDaFatura(body.month) : null;
  if (!accountId) return recusa("Cartão é obrigatório", 400);
  if (!mes) return recusa("Mês deve estar no formato AAAA-MM", 400);

  const { data: cartao } = await supabase
    .from("financial_accounts")
    .select("id, name, account_type")
    .eq("id", accountId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!cartao) return recusa("Cartão não encontrado", 404);
  if (cartao.account_type !== "credit_card") {
    return recusa("Esta conta não é um cartão de crédito", 400);
  }

  const { data: prevista, error } = await supabase
    .from("scheduled_transactions")
    .select("id, status")
    .eq("user_id", userId)
    .eq("notes", chaveFatura(mes, accountId))
    .maybeSingle();
  if (error) {
    console.error("Erro ao ler a fatura fechada:", error);
    return recusa("Não foi possível ler a fatura", 500);
  }
  if (prevista && prevista.status === "paid") {
    return recusa(
      "Esta fatura já foi paga. Estorne o pagamento antes de mexer nela.",
      409
    );
  }

  return {
    ok: true,
    mes,
    cartao: { id: cartao.id, name: cartao.name },
    pendenteId: prevista && prevista.status === "pending" ? prevista.id : null,
  };
}
