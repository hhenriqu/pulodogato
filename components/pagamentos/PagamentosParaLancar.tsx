"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HandCoins } from "lucide-react";
import {
  aLancarPorMim,
  type PagamentoEntrePessoas,
} from "@/lib/pagamento-entre-pessoas";

import { Dica } from "@/components/ui/dica";
interface Conta {
  id: string;
  name: string;
}

const moeda = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v);

const dataCurta = (iso: string) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
};

/**
 * "Helio te pagou R$ 607,95 -- a lancar" (081). Aparece no painel de quem
 * recebeu enquanto houver pagamento sem confirmar. Confirmar lanca a receita na
 * conta escolhida; "Nao recebi" avisa quem pagou.
 */
export function PagamentosParaLancar() {
  const [pendentes, setPendentes] = useState<PagamentoEntrePessoas[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [contaDe, setContaDe] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/pagamentos-entre-pessoas").catch(() => null);
    if (!r?.ok) return;
    const j = await r.json().catch(() => ({}));
    setPendentes(aLancarPorMim(j.pagamentos ?? []));
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (pendentes.length === 0 || contas.length > 0) return;
    const supabase = createClient();
    supabase
      .from("financial_accounts")
      .select("id, name, account_type, is_active")
      .neq("account_type", "credit_card")
      .order("name")
      .then(({ data }) => {
        const ativas = (data ?? []).filter((c) => c.is_active !== false);
        setContas(ativas.map((c) => ({ id: c.id, name: c.name })));
      });
  }, [pendentes.length, contas.length]);

  if (pendentes.length === 0) return null;

  const confirmar = async (p: PagamentoEntrePessoas) => {
    const conta = contaDe[p.id];
    if (!conta) {
      toast.error("Escolha a conta em que o dinheiro entrou.");
      return;
    }
    setOcupado(p.id);
    const r = await fetch(`/api/pagamentos-entre-pessoas/${p.id}/confirmar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: conta }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setOcupado(null);
    if (!r?.ok) {
      toast.error(j.error ?? "Não foi possível lançar o recebimento.");
      return;
    }
    toast.success(`Recebimento de ${p.outra_pessoa} lançado.`);
    // Recarga inteira: os totais do painel leem o lancamento novo.
    window.location.reload();
  };

  const recusar = async (p: PagamentoEntrePessoas) => {
    setOcupado(p.id);
    const r = await fetch(`/api/pagamentos-entre-pessoas/${p.id}/recusar`, {
      method: "POST",
    }).catch(() => null);
    setOcupado(null);
    if (!r?.ok) {
      toast.error("Não foi possível avisar.");
      return;
    }
    toast.success(`Avisamos ${p.outra_pessoa} que não chegou.`);
    carregar();
  };

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2 font-medium">
        <HandCoins className="h-5 w-5" />
        Pagamentos para você lançar
        <Dica rotulo="Sobre estes pagamentos">
          Alguém da família registrou um pagamento para você. Escolha a conta em
          que o dinheiro entrou para ele aparecer no seu saldo e no seu mês.
        </Dica>
      </div>
      {pendentes.map((p) => (
        <div
          key={p.id}
          className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="min-w-0">
            <p className="font-medium">
              {p.outra_pessoa} te pagou {moeda(Number(p.valor))}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {dataCurta(p.data)}
              {p.descricao ? ` · ${p.descricao}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={contaDe[p.id] ?? ""}
              onValueChange={(v: string) =>
                setContaDe((atual) => ({ ...atual, [p.id]: v }))
              }
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Entrou em…" />
              </SelectTrigger>
              <SelectContent>
                {contas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              disabled={ocupado !== null}
              onClick={() => confirmar(p)}
            >
              {ocupado === p.id ? "Lançando…" : "Lançar"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={ocupado !== null}
              onClick={() => recusar(p)}
            >
              Não recebi
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
