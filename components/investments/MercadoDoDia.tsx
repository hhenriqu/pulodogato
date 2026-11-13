"use client";

// ---------------------------------------------------------------------------
// O MERCADO DO DIA (HMO-193, entrega 3)
// ---------------------------------------------------------------------------
// Consulta de acao por ticker + maiores altas e maiores baixas do dia.
//
// Todo numero daqui vem de GET /api/investments/mercado. Nenhum e calculado na
// tela, e -- mais importante para esta entrega -- NENHUM vem da brapi direto.
// A rota existe justamente para o filtro de liquidez de lib/mercado.ts ser o
// unico caminho: ligada na lista crua, esta tela publicaria "IGTI4F +16,82%"
// porque QUATRO papeis trocaram de mao. Ver o cabecalho de lib/mercado.ts.
//
// O QUE ESTA TELA NAO PROMETE
// ---------------------------
//   - preco ao vivo: o plano gratuito da brapi atrasa ~30 min, e o bloco diz
//     isso com todas as letras em vez de deixar o numero passar por tempo real;
//   - recomendacao: "maiores altas" e um fato publico sobre o dia. O rodape
//     nega indicacao de compra de forma explicita, e o vocabulario da tela nao
//     pode sugerir acao -- ha teste sobre isso em scripts/test-mercado.mjs.
//
// A busca por ticker pode estar DESLIGADA (sem `BRAPI_TOKEN` configurado). Nesse
// caso o campo some e o motivo aparece escrito, em vez de todo ticker digitado
// responder "nao encontrei" -- que seria mentira. Os rankings nao dependem da
// chave e continuam de pe.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { TrendingUp, TrendingDown, Search, Info } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import type { Cotacao, Direcao, ItemDoRanking } from "@/lib/mercado";

interface RankingDaTela {
  direcao: Direcao;
  itens: ItemDoRanking[];
  mensagem: string | null;
}

interface RespostaDoMercado {
  altas: RankingDaTela;
  baixas: RankingDaTela;
  aviso: string;
  avisoDeAtraso: string;
  buscaDisponivel: boolean;
  apuradoEm: string;
}

/**
 * `2026-09-30T19:31:00Z` -> `30/09 às 16:31`.
 *
 * O bloco se chama "do dia" e o service worker guarda resposta de `/api/` por
 * ate 24h -- sem este carimbo, o ranking de ontem apareceria como o de hoje,
 * com todo campo no lugar e nada na tela mudando. Traz a DATA junto da hora de
 * proposito: so a hora nao distingue ontem de agora.
 */
function formatarApuracao(iso: string): string | null {
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(quando)
    .replace(", ", " às ");
}

/** `+3,41%` / `-1,20%`. O sinal explicito e o que evita ler queda como alta. */
function formatarVariacao(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2).replace(".", ",")}%`;
}

/** `6.522.400` acoes. */
function formatarAcoes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

function corDaVariacao(v: number | null): string {
  if (v === null || v === 0) return "text-muted-foreground";
  return v > 0 ? "text-success" : "text-destructive";
}

function ListaDoRanking({ ranking }: { ranking: RankingDaTela }) {
  const eAlta = ranking.direcao === "altas";
  const Icone = eAlta ? TrendingUp : TrendingDown;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icone className={`h-4 w-4 ${eAlta ? "text-success" : "text-destructive"}`} />
          {eAlta ? "Maiores altas do dia" : "Maiores baixas do dia"}
        </CardTitle>
        <CardDescription>
          Ações com liquidez. Mercado fracionário e papel praticamente sem negócio
          ficam de fora.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {ranking.mensagem ? (
          <p className="text-sm text-muted-foreground">{ranking.mensagem}</p>
        ) : ranking.itens.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma ação com liquidez suficiente para listar hoje.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {ranking.itens.map((item) => (
              <li
                key={item.ticker}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <p className="font-medium">{item.ticker}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {item.nome}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`font-medium tabular-nums ${corDaVariacao(item.variacao)}`}>
                    {formatarVariacao(item.variacao)}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {formatCurrency(item.preco)} · {formatarAcoes(item.acoesNegociadas)} ações
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function MercadoDoDia() {
  const [dados, setDados] = useState<RespostaDoMercado | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroGeral, setErroGeral] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [cotacao, setCotacao] = useState<Cotacao | null>(null);
  const [mensagemDaBusca, setMensagemDaBusca] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const resposta = await fetch("/api/investments/mercado");
        if (!resposta.ok) throw new Error(String(resposta.status));
        const json = (await resposta.json()) as RespostaDoMercado;
        if (vivo) setDados(json);
      } catch {
        // Cotacao de terceiro nao derruba a tela de investimentos: a carteira
        // vem do nosso banco e nao depende disto.
        if (vivo) setErroGeral("Não consegui carregar o mercado do dia agora.");
      } finally {
        if (vivo) setCarregando(false);
      }
    })();

    return () => {
      vivo = false;
    };
  }, []);

  const consultar = useCallback(
    async (evento: React.FormEvent) => {
      evento.preventDefault();
      const ticker = busca.trim().toUpperCase();
      if (!ticker) return;

      setBuscando(true);
      setCotacao(null);
      setMensagemDaBusca(null);

      try {
        const resposta = await fetch(
          `/api/investments/mercado?ticker=${encodeURIComponent(ticker)}`,
        );
        const json = (await resposta.json()) as {
          cotacao: Cotacao | null;
          mensagem?: string;
        };

        if (json.cotacao) setCotacao(json.cotacao);
        else setMensagemDaBusca(json.mensagem ?? `Não encontrei ${ticker} na B3.`);
      } catch {
        setMensagemDaBusca("Não consegui falar com a brapi agora.");
      } finally {
        setBuscando(false);
      }
    },
    [busca],
  );

  if (carregando) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mercado do dia</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Carregando…</p>
        </CardContent>
      </Card>
    );
  }

  if (erroGeral || !dados) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mercado do dia</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{erroGeral}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mercado do dia</CardTitle>
          <CardDescription>
            {formatarApuracao(dados.apuradoEm)
              ? `Apurado em ${formatarApuracao(dados.apuradoEm)}. ${dados.avisoDeAtraso}`
              : dados.avisoDeAtraso}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {dados.buscaDisponivel ? (
            <form onSubmit={consultar} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[10rem] flex-1 space-y-2">
                <Label htmlFor="mercado-ticker">Consultar ação</Label>
                <Input
                  id="mercado-ticker"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value.toUpperCase())}
                  placeholder="PETR4"
                  maxLength={8}
                  autoComplete="off"
                />
              </div>
              <Button type="submit" disabled={buscando || busca.trim().length === 0}>
                <Search className="mr-2 h-4 w-4" />
                {buscando ? "Consultando…" : "Consultar"}
              </Button>
            </form>
          ) : (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                A consulta por código de negociação precisa de uma chave da brapi,
                que ainda não está configurada neste app. As maiores altas e baixas
                abaixo continuam funcionando.
              </AlertDescription>
            </Alert>
          )}

          {mensagemDaBusca && (
            <p className="text-sm text-muted-foreground">{mensagemDaBusca}</p>
          )}

          {cotacao && (
            <div className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium">{cotacao.ticker}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {cotacao.nome}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold tabular-nums">
                    {formatCurrency(cotacao.preco)}
                  </p>
                  <p
                    className={`text-sm tabular-nums ${corDaVariacao(cotacao.variacaoPercentual)}`}
                  >
                    {formatarVariacao(cotacao.variacaoPercentual)}
                  </p>
                </div>
              </div>

              <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                <div className="flex justify-between gap-2">
                  <dt>Mínima do dia</dt>
                  <dd className="tabular-nums">
                    {cotacao.minimaDoDia === null ? "—" : formatCurrency(cotacao.minimaDoDia)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Máxima do dia</dt>
                  <dd className="tabular-nums">
                    {cotacao.maximaDoDia === null ? "—" : formatCurrency(cotacao.maximaDoDia)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Fechamento anterior</dt>
                  <dd className="tabular-nums">
                    {cotacao.fechamentoAnterior === null
                      ? "—"
                      : formatCurrency(cotacao.fechamentoAnterior)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt>Ações negociadas</dt>
                  <dd className="tabular-nums">{formatarAcoes(cotacao.acoesNegociadas)}</dd>
                </div>
              </dl>

              <p className="mt-3 text-xs text-muted-foreground">{cotacao.aviso}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* grid-cols-1 explicito: sem ele o bloco estoura a largura no celular. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ListaDoRanking ranking={dados.altas} />
        <ListaDoRanking ranking={dados.baixas} />
      </div>

      <p className="text-xs text-muted-foreground">{dados.aviso}</p>
    </div>
  );
}
