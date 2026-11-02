"use client";

// A conta conjunta na tela da casa (migration 078).
//
//   ContasConjuntasDaCasa  as MINHAS contas (fora cartao), cada uma com a chave
//                          "conjunta desta casa". Marcar abre a conta, o saldo
//                          e o extrato para os membros, e deixa eles lancarem
//                          nela pelo formulario de lancamento.
//   ExtratoDaConjunta      os lancamentos da conta no mes, com quem lancou.

import { useCallback, useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatarValor } from "@/lib/dinheiro";
import { dataCurtaNaTela } from "@/lib/data-na-tela";

interface MinhaConta {
  id: string;
  name: string;
  account_type: string;
  currency: string | null;
  current_balance: number;
  conjunta: boolean;
  deOutraCasa: boolean;
}

export function ContasConjuntasDaCasa({
  grupoId,
  aoMudar,
}: {
  grupoId: string;
  aoMudar: () => void;
}) {
  const [contas, setContas] = useState<MinhaConta[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mexendo, setMexendo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch(`/api/casa/${grupoId}/contas-conjuntas`);
      const corpo = await resposta.json();
      if (!resposta.ok) {
        setErro(corpo.error || "Não foi possível ler as suas contas.");
        return;
      }
      setErro(null);
      setContas(corpo.contas || []);
    } catch {
      setErro("Sem conexão com o servidor.");
    }
  }, [grupoId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function marcar(conta: MinhaConta, conjunta: boolean) {
    setMexendo(conta.id);
    setErro(null);
    try {
      const resposta = await fetch(`/api/casa/${grupoId}/contas-conjuntas`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: conta.id, conjunta }),
      });
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        setErro(corpo.error || "Não foi possível mudar a conta.");
        return;
      }
      await carregar();
      aoMudar();
    } finally {
      setMexendo(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Minhas contas conjuntas</CardTitle>
        <CardDescription>
          Marque a conta que é da casa. Quem mora com você passa a ver o saldo
          e o extrato dela e pode lançar nela. Nome e dados da conta continuam
          só com você. Cartão de crédito não entra: a fatura é de quem tem o
          cartão.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {contas === null && !erro && (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        )}
        {contas?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Você não tem conta (fora cartão) cadastrada.
          </p>
        )}
        {contas?.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 text-sm">
            <div>
              <span className="font-medium">{c.name}</span>
              <span className="block text-xs text-muted-foreground">
                {formatarValor(c.current_balance, c.currency || "BRL")}
                {c.deOutraCasa && " · conjunta de outra casa"}
              </span>
            </div>
            <Switch
              checked={c.conjunta}
              disabled={mexendo === c.id || c.deOutraCasa}
              onCheckedChange={(v) => marcar(c, v)}
              aria-label={`Conta conjunta: ${c.name}`}
            />
          </div>
        ))}
        {erro && <p className="text-sm text-destructive">{erro}</p>}
      </CardContent>
    </Card>
  );
}

interface LinhaDoExtrato {
  id: string;
  data: string;
  descricao: string | null;
  valor: number;
  tipo: string;
  quem: string;
  meu: boolean;
}

export function ExtratoDaConjunta({
  grupoId,
  contaId,
  mes,
  moeda,
}: {
  grupoId: string;
  contaId: string;
  mes: string;
  moeda: string;
}) {
  const [linhas, setLinhas] = useState<LinhaDoExtrato[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const resposta = await fetch(
          `/api/casa/${grupoId}/contas-conjuntas/${contaId}/extrato?mes=${encodeURIComponent(mes)}`
        );
        const corpo = await resposta.json();
        if (!vivo) return;
        if (!resposta.ok) {
          setErro(corpo.error || "Não foi possível ler o extrato.");
          return;
        }
        setLinhas(corpo.lancamentos || []);
      } catch {
        if (vivo) setErro("Sem conexão com o servidor.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, [grupoId, contaId, mes]);

  if (erro) return <p className="text-sm text-destructive">{erro}</p>;
  if (linhas === null) return <p className="text-sm text-muted-foreground">Carregando…</p>;
  if (linhas.length === 0)
    return <p className="text-sm text-muted-foreground">Nenhum lançamento neste mês.</p>;

  return (
    <ul className="rounded border divide-y text-sm">
      {linhas.map((l) => (
        <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2">
          <div>
            <span>{l.descricao || "Sem descrição"}</span>
            <span className="block text-xs text-muted-foreground">
              {dataCurtaNaTela(l.data)} · {l.meu ? "você" : l.quem}
            </span>
          </div>
          <span className={l.valor < 0 ? "text-red-600" : "text-green-600"}>
            {formatarValor(l.valor, moeda)}
          </span>
        </li>
      ))}
    </ul>
  );
}
