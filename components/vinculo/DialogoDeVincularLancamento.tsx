"use client";

// ---------------------------------------------------------------------------
// "JA LANCEI -- VINCULAR A UM LANCAMENTO", NA LISTA DE CONTAS PREVISTAS
// ---------------------------------------------------------------------------
// O caminho de quem lancou a conta a mao ANTES de abrir a agenda: em vez de
// "pagar" (que cria OUTRO lancamento e conta a despesa duas vezes), a pessoa
// escolhe o lancamento que ja fez. A lista vem de
// `GET /api/scheduled-transactions/{id}/vincular` -- so os que a regra aceita
// (mesmo dono, mesma direcao, ainda sem vinculo, ate um mes do vencimento), com
// os que parecem o pagamento (`sugerido`) no topo.
//
// O clique em um lancamento E a confirmacao: o vinculo so acontece ali.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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

interface LancamentoParaEscolher {
  id: string;
  description: string | null;
  amount: number | string;
  transaction_date: string;
  sugerido: boolean;
}

export interface DialogoDeVincularLancamentoProps {
  /** A prevista aberta, ou `null` com o dialogo fechado. */
  prevista: { id: string; description: string | null } | null;
  aoFechar: () => void;
  /** Depois de vincular: a tela recarrega a agenda. */
  aoVincular: () => void | Promise<void>;
}

export function DialogoDeVincularLancamento({
  prevista,
  aoFechar,
  aoVincular,
}: DialogoDeVincularLancamentoProps) {
  const [lancamentos, setLancamentos] = useState<LancamentoParaEscolher[] | null>(null);
  const [vinculando, setVinculando] = useState<string | null>(null);

  useEffect(() => {
    if (!prevista) return;
    let ativo = true;
    setLancamentos(null);
    fetch(`/api/scheduled-transactions/${prevista.id}/vincular`)
      .then((r) => r.json().then((dados) => ({ ok: r.ok, dados })))
      .then(({ ok, dados }) => {
        if (!ativo) return;
        if (!ok) {
          toast.error(dados.error ?? "Não foi possível listar os lançamentos.");
          setLancamentos([]);
          return;
        }
        setLancamentos(Array.isArray(dados.transactions) ? dados.transactions : []);
      })
      .catch(() => {
        if (ativo) setLancamentos([]);
      });
    return () => {
      ativo = false;
    };
  }, [prevista]);

  const vincular = async (lancamento: LancamentoParaEscolher) => {
    if (!prevista) return;
    setVinculando(lancamento.id);
    try {
      const resposta = await fetch(
        `/api/scheduled-transactions/${prevista.id}/vincular`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transaction_id: lancamento.id }),
        }
      );
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível vincular.");
        return;
      }
      toast.success(dados.message ?? "Conta vinculada ao lançamento.");
      await aoVincular();
      aoFechar();
    } catch {
      toast.error("Não foi possível vincular.");
    } finally {
      setVinculando(null);
    }
  };

  return (
    <Dialog
      open={Boolean(prevista)}
      onOpenChange={(aberto) => {
        if (!aberto && !vinculando) aoFechar();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Já lancei: vincular a um lançamento</DialogTitle>
          <DialogDescription>
            Escolha o lançamento que pagou {prevista?.description ?? "esta conta"}.
            A conta prevista fica paga e o lançamento não muda. Para desfazer,
            exclua o lançamento.
          </DialogDescription>
        </DialogHeader>

        {lancamentos === null ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : lancamentos.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            Nenhum lançamento seu, na mesma direção e até um mês do vencimento,
            está livre para vincular.
          </p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {lancamentos.map((l) => (
              <Button
                key={l.id}
                variant="outline"
                className="h-auto w-full justify-between whitespace-normal py-3 text-left"
                disabled={Boolean(vinculando)}
                onClick={() => vincular(l)}
              >
                <span>
                  {l.description ?? "Sem descrição"}
                  <span className="block text-xs text-muted-foreground">
                    {dataCurtaNaTela(l.transaction_date)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {l.sugerido && <Badge variant="secondary">parece este</Badge>}
                  {vinculando === l.id && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span className="font-semibold">
                    {formatCurrency(Math.abs(Number(l.amount)))}
                  </span>
                </span>
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
