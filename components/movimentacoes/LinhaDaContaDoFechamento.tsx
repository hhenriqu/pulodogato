"use client";

// A CONTA DO FECHAMENTO JA QUITADA, NA LISTA DA FINANCAS PESSOAIS (fase 4).
//
// "Pagamento ao grupo" ou "A receber do grupo", gerada pelo fechamento do
// periodo e quitada pelo acerto. Ela entra nos cartoes de Receitas e Despesas
// (o Resultado do mes, RN017.6), e a lista tem de mostra-la: um total que
// soma uma linha que a lista nao tem e indistinguivel de bug.
//
// SEM BOTAO NENHUM: ela nao e uma transacao, e se quita pelo acerto no grupo
// (RN018.12). Ver `comAsContasDoFechamento` em lib/fechamento-no-resultado.ts.

import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { dataNaTela } from "@/lib/data-na-tela";
import type { ContaDoFechamentoRealizada } from "@/lib/fechamento-no-resultado";

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

export function LinhaDaContaDoFechamento({
  conta,
}: {
  conta: ContaDoFechamentoRealizada;
}) {
  const despesa = conta.transaction_type === "expense";

  return (
    <div
      className="flex items-center justify-between gap-3 p-3 border rounded-lg border-dashed"
      data-conta-do-fechamento={conta.id}
    >
      {/* `min-w-0` nos dois niveis e `truncate`, como na linha comum (HMO-185). */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center bg-muted text-muted-foreground">
          <Users className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="font-medium truncate">{conta.description}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <Badge variant="outline" className="shrink-0">
              Fechamento do grupo
            </Badge>
            <span>{conta.category.name}</span>
            <span>•</span>
            <span>{dataNaTela(conta.transaction_date)}</span>
          </div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className={`font-semibold ${despesa ? "text-destructive" : "text-success"}`}>
          {despesa ? "-" : "+"}
          {formatCurrency(Math.abs(conta.amount))}
        </p>
      </div>
    </div>
  );
}
