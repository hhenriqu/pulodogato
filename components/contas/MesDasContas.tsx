"use client";

// ---------------------------------------------------------------------------
// O MES DAS CONTAS (comparacao com o Minhas Financas)
// ---------------------------------------------------------------------------
// A tabela da tela Contas do Minhas Financas: por conta e para o mes escolhido,
// saldo inicial, receitas, despesas, transferencias recebidas e enviadas, saldo
// realizado e previsto. A regra esta em lib/saldo-por-conta.ts; este componente
// so busca e desenha.
//
// SO ONLINE: a rota le lancamentos e agenda, e o catalogo do aparelho nao tem
// nenhum dos dois. Sem rede a tabela nao aparece -- uma tabela de zeros seria o
// zero confiante de lib/offline-leitura.ts.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { FinancialAccount } from "@/types/financial";
import type { MesDaConta } from "@/lib/saldo-por-conta";
import { formatarValor } from "@/lib/dinheiro";
import { today } from "@/lib/recurrence";

const NOMES_DOS_MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function andarMes(mes: string, passo: number): string {
  const ano = Number(mes.slice(0, 4));
  const indice = Number(mes.slice(5, 7)) - 1 + passo;
  const novoAno = ano + Math.floor(indice / 12);
  const novoMes = ((indice % 12) + 12) % 12;
  return `${novoAno}-${String(novoMes + 1).padStart(2, "0")}`;
}

function nomeDoMes(mes: string): string {
  return `${NOMES_DOS_MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;
}

const COLUNAS: { chave: keyof Omit<MesDaConta, "conta_id">; rotulo: string }[] = [
  { chave: "saldo_inicial", rotulo: "Saldo inicial" },
  { chave: "receitas", rotulo: "Receitas" },
  { chave: "despesas", rotulo: "Despesas" },
  { chave: "transf_credito", rotulo: "Transf. créd." },
  { chave: "transf_debito", rotulo: "Transf. déb." },
  { chave: "saldo", rotulo: "Saldo" },
  { chave: "previsto", rotulo: "Previsto" },
];

export function MesDasContas({ contas }: { contas: FinancialAccount[] }) {
  const [mes, setMes] = useState(() => today().slice(0, 7));
  const [linhas, setLinhas] = useState<MesDaConta[] | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;
    setLinhas(null);
    setFalhou(false);
    void (async () => {
      try {
        const resposta = await fetch(`/api/financial-accounts/mes?mes=${mes}`);
        const dados = await resposta.json();
        if (!vivo) return;
        if (!resposta.ok || !Array.isArray(dados.contas)) {
          setFalhou(true);
          return;
        }
        setLinhas(dados.contas as MesDaConta[]);
      } catch (erro) {
        console.error(erro);
        if (vivo) setFalhou(true);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [mes]);

  // So as contas que estao na tela (o recorte vale aqui tambem), na ordem dela.
  const daTela = useMemo(() => {
    if (!linhas) return [];
    const porId = new Map(linhas.map((l) => [l.conta_id, l]));
    return contas
      .map((conta) => ({ conta, linha: porId.get(conta.id) }))
      .filter(
        (x): x is { conta: FinancialAccount; linha: MesDaConta } =>
          x.linha !== undefined
      );
  }, [contas, linhas]);

  // O total soma so as contas em real que somam nos totais: somar dolar com
  // real daria um numero que nao e de moeda nenhuma.
  const total = useMemo(() => {
    const soma: Record<string, number> = {};
    let alguma = false;
    for (const { conta, linha } of daTela) {
      if (conta.include_in_total === false) continue;
      if ((conta.currency ?? "BRL") !== "BRL") continue;
      alguma = true;
      for (const { chave } of COLUNAS) {
        soma[chave] = (soma[chave] ?? 0) + Math.round(linha[chave] * 100);
      }
    }
    if (!alguma) return null;
    const emReais: Record<string, number> = {};
    for (const { chave } of COLUNAS) emReais[chave] = (soma[chave] ?? 0) / 100 || 0;
    return emReais;
  }, [daTela]);

  const corDoValor = (chave: string, valor: number) =>
    (chave === "saldo" || chave === "previsto" || chave === "saldo_inicial") &&
    valor < 0
      ? "text-destructive"
      : "";

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Mês das contas</CardTitle>
            <CardDescription className="text-xs">
              Receitas e despesas incluem as previstas do mês. Saldo é o
              realizado até hoje; Previsto é como o mês termina.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Mês anterior"
              onClick={() => setMes((m) => andarMes(m, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[9rem] text-center text-sm font-medium">
              {nomeDoMes(mes)}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Próximo mês"
              onClick={() => setMes((m) => andarMes(m, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {falhou ? (
          <p className="text-sm text-destructive">
            Não foi possível calcular o mês das contas.
          </p>
        ) : linhas === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Calculando o mês…
          </p>
        ) : daTela.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma conta nesta tela.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="py-2 pr-3 text-left font-medium">Conta</th>
                  {COLUNAS.map((c) => (
                    <th key={c.chave} className="py-2 pl-3 text-right font-medium">
                      {c.rotulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {daTela.map(({ conta, linha }) => (
                  <tr key={conta.id} className="border-b border-border/60">
                    <td className="py-2 pr-3">{conta.name}</td>
                    {COLUNAS.map((c) => (
                      <td
                        key={c.chave}
                        className={`py-2 pl-3 text-right tabular-nums ${corDoValor(
                          c.chave,
                          linha[c.chave]
                        )}`}
                      >
                        {formatarValor(linha[c.chave], conta.currency ?? "BRL")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {total && (
                <tfoot>
                  <tr className="font-medium">
                    <td className="py-2 pr-3">Total</td>
                    {COLUNAS.map((c) => (
                      <td
                        key={c.chave}
                        className={`py-2 pl-3 text-right tabular-nums ${corDoValor(
                          c.chave,
                          total[c.chave]
                        )}`}
                      >
                        {formatarValor(total[c.chave], "BRL")}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
