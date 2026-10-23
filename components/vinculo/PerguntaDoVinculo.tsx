"use client";

// ---------------------------------------------------------------------------
// "ISSO E O PAGAMENTO DE <PREVISTA>?" -- DEPOIS DO SALVAR DO LANCAMENTO
// ---------------------------------------------------------------------------
// O lancamento JA ESTA GRAVADO quando esta pergunta aparece. Ela nao trava
// nada: "Nao" (ou fechar) segue o caminho de sempre do Salvar, e "Sim" so
// acrescenta o vinculo pela rota `POST .../{id}/vincular`. Nunca vincular sem
// confirmacao e a regra -- e e por isso que a pergunta e um dialogo com um
// botao por prevista, e nao uma caixa pre-marcada.
//
// Quem decide QUAIS previstas aparecem e `previstasCorrespondentes`
// (lib/vinculo-da-prevista.ts), servida por
// `GET /api/scheduled-transactions/correspondentes`. Este componente nao sabe a
// regra: so pergunta.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dataCurtaNaTela } from "@/lib/data-na-tela";
import { formatCurrency } from "@/lib/utils";

export interface PrevistaSugerida {
  id: string;
  description: string | null;
  amount: number | string;
  due_date: string;
}

export interface PerguntaDoVinculoProps {
  /** O lancamento recem-gravado e as previstas que ele parece pagar. */
  pergunta: { transacaoId: string; previstas: PrevistaSugerida[] } | null;
  /** Chamado nos dois desfechos -- vinculou ou nao. E o fim do Salvar. */
  aoTerminar: () => void;
}

/**
 * Procura as previstas que o lancamento parece pagar. Devolve `[]` em qualquer
 * falha: a pergunta e um extra do Salvar, e um erro aqui nao pode virar "nao
 * consegui gravar" -- o lancamento ja esta gravado.
 */
export async function buscarPrevistasCorrespondentes(
  transacaoId: string
): Promise<PrevistaSugerida[]> {
  try {
    const resposta = await fetch(
      `/api/scheduled-transactions/correspondentes?transaction_id=${encodeURIComponent(transacaoId)}`
    );
    if (!resposta.ok) return [];
    const dados = await resposta.json();
    return Array.isArray(dados.scheduled) ? dados.scheduled : [];
  } catch {
    return [];
  }
}

export function PerguntaDoVinculo({ pergunta, aoTerminar }: PerguntaDoVinculoProps) {
  const [vinculando, setVinculando] = useState<string | null>(null);

  const vincular = async (previsto: PrevistaSugerida) => {
    if (!pergunta) return;
    setVinculando(previsto.id);
    try {
      const resposta = await fetch(
        `/api/scheduled-transactions/${previsto.id}/vincular`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transaction_id: pergunta.transacaoId }),
        }
      );
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível vincular a conta prevista.");
        return;
      }
      toast.success(
        `${previsto.description ?? "Conta prevista"} marcada como paga por este lançamento.`
      );
      aoTerminar();
    } catch {
      toast.error("Não foi possível vincular a conta prevista.");
    } finally {
      setVinculando(null);
    }
  };

  return (
    <Dialog
      open={Boolean(pergunta)}
      onOpenChange={(aberto) => {
        if (!aberto && !vinculando) aoTerminar();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Isso é o pagamento de uma conta prevista?</DialogTitle>
          <DialogDescription>
            O lançamento foi gravado. Se ele paga uma destas contas, ela sai do
            previsto e o valor não é contado duas vezes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {(pergunta?.previstas ?? []).map((p) => (
            <Button
              key={p.id}
              variant="outline"
              className="h-auto w-full justify-between whitespace-normal py-3 text-left"
              disabled={Boolean(vinculando)}
              onClick={() => vincular(p)}
            >
              <span>
                Sim, é {p.description ?? "esta conta"}
                <span className="block text-xs text-muted-foreground">
                  vence {dataCurtaNaTela(p.due_date)}
                </span>
              </span>
              <span className="flex items-center gap-2 font-semibold">
                {vinculando === p.id && <Loader2 className="h-4 w-4 animate-spin" />}
                {formatCurrency(Math.abs(Number(p.amount)))}
              </span>
            </Button>
          ))}
          <Button
            variant="ghost"
            className="w-full"
            disabled={Boolean(vinculando)}
            onClick={aoTerminar}
          >
            Não, é outro gasto
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
