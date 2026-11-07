"use client";

// ---------------------------------------------------------------------------
// A PARCELA CHEIA DO MYBANK NA ABA DESPESAS -- decisao do Helio, 07/11/2026
// ---------------------------------------------------------------------------
// "Em despesas nao aparece como despesa o quanto ela tem que pagar ao mybank."
// A aba Despesas de quem pegou mostra so o JURO (RN021.6), e um emprestimo sem
// juro nao aparecia em lugar nenhum dela. A escolha foi "linha a pagar, total
// so com juros": a parcela cheia aparece aqui, com o gesto de avisar que
// pagou, e NENHUM numero dos cartoes muda -- o principal e transferencia
// (RN021.2), e somar a parcela inteira contaria como gasto o dinheiro que a
// pessoa so esta devolvendo.
//
// Painel e nao linha da lista pelo motivo do `PainelPraQuemPagar`: uma linha
// da lista entra no total e herda as acoes de `scheduled_transactions`, e a
// parcela nao e linha de agenda. Sem parcela no periodo, o painel devolve
// `null` e a tela fica exatamente como era.
// ---------------------------------------------------------------------------

import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { LinhaDaParcelaDoMyBank } from "@/components/mybank/LinhaDaParcelaDoMyBank";
import type { ParcelaDevidaNaAgenda } from "@/lib/leituras-do-mybank";

export const TITULO_DAS_PARCELAS_DO_MYBANK = "A pagar no MyBank";

export const NOTA_DAS_PARCELAS_DO_MYBANK =
  "A parcela inteira, para você saber quanto sai da conta. O total desta aba soma só os juros: o resto é a devolução do empréstimo, que é transferência e não despesa.";

export function PainelParcelasDoMyBank({
  parcelas,
  aoAvisar,
  online,
}: {
  parcelas: ParcelaDevidaNaAgenda[];
  aoAvisar: () => void | Promise<void>;
  online: boolean;
}) {
  if (parcelas.length === 0) return null;

  const total = parcelas.reduce((soma, p) => soma + (Number(p.amount) || 0), 0);

  return (
    <Card data-painel="parcelas-do-mybank">
      <CardContent className="pt-6 pb-6">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm text-muted-foreground">{TITULO_DAS_PARCELAS_DO_MYBANK}</p>
          <p className="font-semibold text-foreground">{formatCurrency(total)}</p>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{NOTA_DAS_PARCELAS_DO_MYBANK}</p>

        <div className="mt-2">
          {[...parcelas]
            .sort((a, b) => a.due_date.localeCompare(b.due_date))
            .map((parcela) => (
              <LinhaDaParcelaDoMyBank
                key={parcela.mybank_installment_id}
                parcela={parcela}
                valor={formatCurrency(parcela.amount)}
                aoAvisar={aoAvisar}
                online={online}
              />
            ))}
        </div>
      </CardContent>
    </Card>
  );
}
