"use client";

// ---------------------------------------------------------------------------
// RELATORIO DE LANCAMENTOS COM DATA DE REFERENCIA (comparacao com o Minhas
// Financas)
// ---------------------------------------------------------------------------
// Periodo, data de referencia (Lancamento / Vencimento / Efetivacao), situacao
// (Todas / Efetivadas / Pendentes), tipo e tag, com a lista e os totais. A
// regra esta em lib/relatorio-de-lancamentos.ts e a consulta em
// /api/reports/lancamentos; este componente so pede e desenha.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CampoDeData } from "@/components/ui/campo-de-data";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatarValor } from "@/lib/dinheiro";
import { today } from "@/lib/recurrence";
import {
  ROTULO_DA_REFERENCIA,
  ROTULO_DA_SITUACAO,
  type DataDeReferencia,
  type LinhaDoRelatorio,
  type Situacao,
} from "@/lib/relatorio-de-lancamentos";

type Tipo = "expense" | "income" | "";

interface Resposta {
  linhas: LinhaDoRelatorio[];
  receitas: number;
  despesas: number;
  saldo: number;
}

function ultimoDiaDoMes(dia: string): string {
  const ano = Number(dia.slice(0, 4));
  const mes = Number(dia.slice(5, 7));
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${dia.slice(0, 7)}-${String(ultimo).padStart(2, "0")}`;
}

function dataCurta(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;
}

export function RelatorioDeLancamentos() {
  const hoje = today();
  const [de, setDe] = useState(`${hoje.slice(0, 7)}-01`);
  const [ate, setAte] = useState(ultimoDiaDoMes(hoje));
  const [referencia, setReferencia] = useState<DataDeReferencia>("vencimento");
  const [situacao, setSituacao] = useState<Situacao>("todas");
  const [tipo, setTipo] = useState<Tipo>("expense");
  const [tag, setTag] = useState("");
  const [tagAplicada, setTagAplicada] = useState("");
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [carregando, setCarregando] = useState(false);

  useEffect(() => {
    if (!de || !ate || ate < de) return;
    let vivo = true;
    setCarregando(true);
    setFalhou(false);
    const busca = new URLSearchParams({ de, ate, referencia, situacao });
    if (tipo) busca.set("tipo", tipo);
    if (tagAplicada) busca.set("tag", tagAplicada);
    void (async () => {
      try {
        const r = await fetch(`/api/reports/lancamentos?${busca.toString()}`);
        const dados = await r.json();
        if (!vivo) return;
        if (!r.ok || !Array.isArray(dados.linhas)) {
          setFalhou(true);
          return;
        }
        setResposta(dados as Resposta);
      } catch (erro) {
        console.error(erro);
        if (vivo) setFalhou(true);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [de, ate, referencia, situacao, tipo, tagAplicada]);

  const grupo = <T extends string>(
    valores: readonly T[],
    atual: T,
    rotulos: Record<T, string>,
    mudar: (v: T) => void
  ) => (
    <div className="flex flex-wrap gap-1">
      {valores.map((v) => (
        <Button
          key={v}
          size="sm"
          variant={v === atual ? "default" : "outline"}
          onClick={() => mudar(v)}
        >
          {rotulos[v]}
        </Button>
      ))}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lançamentos do período</CardTitle>
        <CardDescription>
          Escolha qual data vale: a do lançamento, a do vencimento ou a da
          efetivação. Pendentes são as previsões que ainda não foram pagas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="rel-de" className="text-xs">
              Data inicial
            </Label>
            <CampoDeData id="rel-de" value={de} onChange={setDe} />
          </div>
          <div>
            <Label htmlFor="rel-ate" className="text-xs">
              Data final
            </Label>
            <CampoDeData id="rel-ate" value={ate} onChange={setAte} />
          </div>
          <div>
            <Label htmlFor="rel-tipo" className="text-xs">
              Tipo
            </Label>
            <select
              id="rel-tipo"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as Tipo)}
            >
              <option value="expense">Despesas</option>
              <option value="income">Receitas</option>
              <option value="">Receitas e despesas</option>
            </select>
          </div>
          <div>
            <Label htmlFor="rel-tag" className="text-xs">
              Tag
            </Label>
            <Input
              id="rel-tag"
              placeholder="#viagem"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              onBlur={() => setTagAplicada(tag)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setTagAplicada(tag);
              }}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Data de referência</p>
            {grupo(
              ["lancamento", "vencimento", "efetivacao"] as const,
              referencia,
              ROTULO_DA_REFERENCIA,
              setReferencia
            )}
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Situação</p>
            {grupo(
              ["todas", "efetivadas", "pendentes"] as const,
              situacao,
              ROTULO_DA_SITUACAO,
              setSituacao
            )}
          </div>
        </div>

        {ate < de ? (
          <p className="text-sm text-destructive">
            A data final tem de ser igual ou depois da inicial.
          </p>
        ) : falhou ? (
          <p className="text-sm text-destructive">
            Não foi possível montar o relatório.
          </p>
        ) : !resposta || carregando ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Montando o relatório…
          </p>
        ) : (
          <>
            <div className="flex flex-wrap gap-6 text-sm">
              <span>
                Receitas{" "}
                <strong className="text-success">
                  {formatarValor(resposta.receitas, "BRL")}
                </strong>
              </span>
              <span>
                Despesas{" "}
                <strong className="text-destructive">
                  {formatarValor(resposta.despesas, "BRL")}
                </strong>
              </span>
              <span>
                Saldo <strong>{formatarValor(resposta.saldo, "BRL")}</strong>
              </span>
            </div>
            {resposta.linhas.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum lançamento neste período com esses filtros.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="py-2 pr-3 text-left font-medium">
                        {ROTULO_DA_REFERENCIA[referencia]}
                      </th>
                      <th className="py-2 pr-3 text-left font-medium">Descrição</th>
                      <th className="py-2 pr-3 text-left font-medium">Situação</th>
                      <th className="py-2 pl-3 text-right font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resposta.linhas.map((l) => (
                      <tr key={`${l.origem}:${l.id}`} className="border-b border-border/60">
                        <td className="py-2 pr-3 tabular-nums">{dataCurta(l.data)}</td>
                        <td className="py-2 pr-3">
                          {l.descricao}
                          {l.tags.map((t) => (
                            <span key={t} className="ml-1 text-xs text-info">
                              #{t}
                            </span>
                          ))}
                          {!l.soma && (
                            <span className="ml-1 text-xs text-warning">
                              · fora dos totais
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 text-xs text-muted-foreground">
                          {l.origem === "pendente" ? "Pendente" : "Efetivada"}
                        </td>
                        <td
                          className={`py-2 pl-3 text-right tabular-nums ${
                            l.tipo === "income" ? "text-success" : "text-destructive"
                          }`}
                        >
                          {l.tipo === "income" ? "" : "-"}
                          {formatarValor(l.valor, "BRL")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
