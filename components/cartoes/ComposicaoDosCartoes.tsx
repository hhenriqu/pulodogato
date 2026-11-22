"use client";

// ---------------------------------------------------------------------------
// A COMPOSICAO DOS CARTOES, EM ROSCA (docs/COMPOSICAO-DA-FATURA.md)
// ---------------------------------------------------------------------------
// "Preciso saber a composicao do meu cartao de credito. Entre o que e gasto
// recorrente como fixo ou assinatura, e o que tenho parcelado e esporadico."
//
// Uma rosca com a legenda EMBAIXO, como foi pedido. Tres lugares a usam:
//
//   * a tela de um cartao (`soMensal`): a fatura do mes do seletor;
//   * a tela de Cartoes e o painel inicial: o MENSAL por padrao, e a chave
//     "Total" mostra quanto seria preciso para QUITAR os cartoes hoje.
//
// Nenhum numero e calculado aqui: tudo vem de GET /api/card-invoices/composicao
// (a regra mora em lib/composicao-da-fatura.ts). O componente busca os
// proprios dados, como a rosca de categorias do painel.
// ---------------------------------------------------------------------------

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import { PieChart as IconeDaRosca } from "lucide-react";
import { Cell, Pie, PieChart } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Dica } from "@/components/ui/dica";
import { NumeroIndisponivel } from "@/components/SemRede";
import { formatarValor } from "@/lib/dinheiro";
import {
  COR_DO_TIPO,
  NOME_DO_TIPO,
  TIPOS_DO_GASTO,
  fatiasDaComposicao,
  recorrenteDa,
  type Composicao,
} from "@/lib/composicao-da-fatura";
import type { RespostaDaComposicao } from "@/lib/services/composicao-da-fatura";

export type VisaoDaComposicao = "mensal" | "total";

const DICA_DO_TIPO = {
  fixo: "Contas fixas no cartão (academia, seguro...): o que se repete todo mês.",
  assinatura: "Contas fixas marcadas como assinatura e as cobranças que o app achou no extrato.",
  parcelado: "Compras parceladas: a parcela do mês, ou todas as que faltam no Total.",
  esporadico: "O resto: compras avulsas, menos os estornos.",
} as const;

export function ComposicaoDosCartoes({
  mes,
  accountId,
  soMensal = false,
  rotuloDoMes,
  sinal,
}: {
  /** 'AAAA-MM' da fatura do mensal. */
  mes: string;
  /** Um cartao so; sem ele, todos os ativos. */
  accountId?: string;
  /** Sem a chave Mensal/Total: a tela de um cartao mostra a fatura dela. */
  soMensal?: boolean;
  rotuloDoMes?: string | null;
  /** Muda quando a fatura mudou na tela, para a rosca reler. */
  sinal?: string;
}) {
  const [visao, setVisao] = useState<VisaoDaComposicao>("mensal");
  const [dados, setDados] = useState<RespostaDaComposicao | null>(null);
  const [estado, setEstado] = useState<"carregando" | "pronto" | "erro">("carregando");

  useEffect(() => {
    let vivo = true;
    setEstado("carregando");
    const params = new URLSearchParams({ month: mes });
    if (accountId) params.set("account_id", accountId);
    fetch(`/api/card-invoices/composicao?${params.toString()}`)
      .then(async (r) => {
        const corpo = await r.json();
        if (!vivo) return;
        if (!r.ok || !corpo?.mensal) {
          setEstado("erro");
          return;
        }
        setDados(corpo as RespostaDaComposicao);
        setEstado("pronto");
      })
      .catch((erro) => {
        console.error(erro);
        if (vivo) setEstado("erro");
      });
    return () => {
      vivo = false;
    };
  }, [mes, accountId, sinal]);

  const mostrandoTotal = !soMensal && visao === "total";
  const composicao = dados ? (mostrandoTotal ? dados.total : dados.mensal) : null;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <IconeDaRosca className="h-5 w-5" />
              {soMensal ? "Composição da fatura" : "Composição dos cartões"}
              <Dica rotulo="Como a composição é contada">
                Fixo e assinaturas são o gasto recorrente; parcelado e
                esporádico são o que acaba. No Total, o que seria preciso para
                quitar os cartões hoje: todas as parcelas que faltam e as
                compras ainda não pagas, mais o fixo e as assinaturas só da
                fatura atual (os dos meses seguintes ainda não são dívida).
              </Dica>
            </CardTitle>
            <CardDescription>
              {mostrandoTotal
                ? "Para quitar hoje"
                : rotuloDoMes
                  ? `Fatura de ${rotuloDoMes}`
                  : "Fatura do mês"}
            </CardDescription>
          </div>
          {!soMensal && (
            <div
              role="tablist"
              aria-label="Mensal ou total para quitar"
              className="inline-flex rounded-md border border-input p-0.5 text-xs"
            >
              {(["mensal", "total"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={visao === v}
                  onClick={() => setVisao(v)}
                  className={`rounded px-3 py-1 font-medium transition-colors ${
                    visao === v
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v === "mensal" ? "Mensal" : "TOTAL"}
                </button>
              ))}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {estado === "carregando" && !composicao ? (
          <p className="text-sm text-muted-foreground">Carregando…</p>
        ) : estado === "erro" || !composicao || !dados ? (
          <NumeroIndisponivel />
        ) : (
          <>
            <RoscaDaComposicao
              composicao={composicao}
              rotuloDoCentro={mostrandoTotal ? "para quitar" : "na fatura"}
            />
            {mostrandoTotal && !accountId && dados.cartoes.length > 1 && (
              <ul className="mt-4 space-y-1 border-t pt-3 text-xs text-muted-foreground">
                {dados.cartoes.map((c) => (
                  <li key={c.account_id} className="flex justify-between gap-2">
                    <Link
                      href={`/dashboard/cartoes/${c.account_id}` as Route}
                      className="truncate hover:text-foreground hover:underline"
                    >
                      {c.account_name}
                      {c.include_in_total === false ? " · fora dos totais" : ""}
                    </Link>
                    <span className="shrink-0 tabular-nums">
                      {formatarValor(c.total.total)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {!accountId && dados.fora_dos_totais > 0 && (
              <p className="mt-2 text-xs text-warning">
                {dados.fora_dos_totais === 1
                  ? "1 cartão está fora dos totais e não entra nesta soma."
                  : `${dados.fora_dos_totais} cartões estão fora dos totais e não entram nesta soma.`}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** A rosca com a legenda embaixo: props entram, marcacao sai. */
export function RoscaDaComposicao({
  composicao,
  rotuloDoCentro,
}: {
  composicao: Composicao;
  rotuloDoCentro: string;
}) {
  const fatias = fatiasDaComposicao(composicao);
  const recorrente = recorrenteDa(composicao);
  const desenhado = fatias.reduce((s, f) => s + f.valor, 0);

  if (fatias.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nada lançado nos cartões aqui.</p>
    );
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative h-44 w-44 shrink-0">
        {/* Tamanho FIXO, sem ResponsiveContainer, como a rosca de categorias. */}
        <PieChart width={176} height={176}>
          <Pie
            data={fatias.map((f) => ({ ...f }))}
            dataKey="valor"
            nameKey="nome"
            startAngle={90}
            endAngle={-270}
            innerRadius="68%"
            outerRadius="100%"
            stroke="none"
            isAnimationActive={false}
          >
            {fatias.map((f) => (
              <Cell key={f.tipo} fill={f.cor} />
            ))}
          </Pie>
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-sm font-semibold tabular-nums">
            {formatarValor(composicao.total)}
          </span>
          <span className="text-xs text-muted-foreground">{rotuloDoCentro}</span>
        </div>
      </div>

      {/* A LEGENDA EMBAIXO, com as quatro linhas sempre -- a fatia zerada
          continua na lista, para a soma fechar com o total do centro. */}
      <ul className="w-full min-w-0 space-y-2 text-sm">
        {TIPOS_DO_GASTO.map((t) => {
          const valor = composicao[t];
          const parte = desenhado > 0 && valor > 0 ? valor / desenhado : 0;
          return (
            <li key={t} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: COR_DO_TIPO[t] }}
              />
              <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
                {NOME_DO_TIPO[t]}
                <Dica rotulo={`Sobre ${NOME_DO_TIPO[t]}`}>{DICA_DO_TIPO[t]}</Dica>
              </span>
              <span className="shrink-0 tabular-nums">{formatarValor(valor)}</span>
              <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {Math.round(parte * 100)}%
              </span>
            </li>
          );
        })}
        <li className="flex items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
          <span>Recorrente (fixo + assinaturas)</span>
          <span className="tabular-nums">{formatarValor(recorrente)}</span>
        </li>
        <li className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Acaba (parcelado + esporádico)</span>
          <span className="tabular-nums">
            {formatarValor(composicao.total - recorrente)}
          </span>
        </li>
      </ul>
    </div>
  );
}
