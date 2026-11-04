"use client";

// -----------------------------------------------------------------------------
// O BLOCO "MAPA DE CALOR" DO PAINEL
// -----------------------------------------------------------------------------
// Um calendario do periodo escolhido, cada dia pintado pelo quanto saiu nele.
// A conta (somar por dia, os quatro niveis, o futuro apagado) mora em
// lib/mapa-de-calor.ts; a leitura, em /api/dashboard/mapa-de-calor. Aqui so ha
// marcacao.
//
// O bloco busca os proprios dados em vez de entrar no `carregar` do painel: ele
// e o unico consumidor da rota, e uma falha dela tem de apagar so este cartao,
// nao atrasar os quatro numeros. A regra de periodo do painel continua valendo
// -- ele honra `de`/`ate` e recarrega quando eles mudam.
//
// O LIMITE QUE A LEGENDA TEM DE DIZER
// -----------------------------------
// O cartao aqui conta no dia da COMPRA, e o resumo do painel conta pela fatura
// paga. Os dois totais diferem de proposito, e sem a frase de rodape a diferenca
// pareceria defeito. Ver o cabecalho de lib/mapa-de-calor.ts.
// -----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { Flame } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NumeroIndisponivel } from "@/components/SemRede";
import {
  diaEMesDoMapa,
  diasDoPeriodo,
  MAXIMO_DE_DIAS_DO_MAPA,
  rotuloDaSemana,
  type CelulaDoMapa,
  type MapaDeCalor as Mapa,
  type NivelDoMapa,
} from "@/lib/mapa-de-calor";

import { Dica } from "@/components/ui/dica";
const DIAS_DA_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"];

/** Uma cor so, em quatro intensidades: tokens do tema, nos dois modos. */
const COR_DO_NIVEL: Record<NivelDoMapa, string> = {
  0: "bg-muted",
  1: "bg-destructive/20",
  2: "bg-destructive/45",
  3: "bg-destructive/70",
  4: "bg-destructive",
};

const TEXTO_DO_NIVEL: Record<NivelDoMapa, string> = {
  0: "text-muted-foreground",
  1: "text-foreground",
  2: "text-foreground",
  3: "text-destructive-foreground",
  4: "text-destructive-foreground",
};

function formatador(codigo: string) {
  try {
    const f = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: codigo,
    });
    return (v: number) => f.format(v);
  } catch {
    const f = new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
    return (v: number) => f.format(v);
  }
}

interface Resposta {
  mapa: Mapa;
  moeda: string;
  outras_moedas: number;
}

export function MapaDeCalor({
  de,
  ate,
  rotulo,
}: {
  de: string;
  ate: string;
  /** O periodo em palavras, o mesmo dos outros tiles. */
  rotulo: string;
}) {
  const longoDemais = diasDoPeriodo(de, ate) > MAXIMO_DE_DIAS_DO_MAPA;
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [estado, setEstado] = useState<"carregando" | "pronto" | "erro">(
    "carregando",
  );

  useEffect(() => {
    if (longoDemais) return;
    let cancelado = false;
    setEstado("carregando");
    fetch(`/api/dashboard/mapa-de-calor?de=${de}&ate=${ate}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const d = (await r.json()) as Resposta;
        if (!d?.mapa?.semanas) throw new Error("resposta sem mapa");
        if (!cancelado) {
          setResposta(d);
          setEstado("pronto");
        }
      })
      .catch(() => {
        // Sem o mapa, o cartao diz que nao tem dado. Um calendario todo cinza
        // se leria como "nao gastei nada no mes".
        if (!cancelado) {
          setResposta(null);
          setEstado("erro");
        }
      });
    return () => {
      cancelado = true;
    };
  }, [de, ate, longoDemais]);

  const moeda = formatador(resposta?.moeda ?? "BRL");
  const mapa = resposta?.mapa;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Flame className="h-5 w-5" />
          Mapa de calor dos gastos
          <Dica rotulo="Como o mapa conta os gastos">
            Cada despesa conta no dia em que aconteceu — a compra no cartão no
            dia da compra, e não no vencimento da fatura. Por isso o total
            daqui pode diferir das Saídas do resumo. Transferências e
            lançamentos fora dos totais não entram.
            {resposta && resposta.outras_moedas > 0 && (
              <>
                {" "}
                {resposta.outras_moedas}{" "}
                {resposta.outras_moedas === 1
                  ? "lançamento em outra moeda ficou"
                  : "lançamentos em outra moeda ficaram"}{" "}
                de fora.
              </>
            )}
          </Dica>
        </CardTitle>
        <CardDescription>
          Quanto saiu em cada dia — <span className="lowercase">{rotulo}</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {longoDemais ? (
          <p className="text-sm text-muted-foreground">
            O mapa de calor desenha períodos de até {MAXIMO_DE_DIAS_DO_MAPA}{" "}
            dias. Escolha um período menor para vê-lo.
          </p>
        ) : estado === "erro" ? (
          <p className="text-sm text-muted-foreground">
            <NumeroIndisponivel /> Não foi possível montar o mapa agora.
          </p>
        ) : !mapa ? (
          <div className="h-40 animate-pulse rounded-md bg-muted" />
        ) : (
          <div
            aria-busy={estado === "carregando"}
            className={
              estado === "carregando"
                ? "space-y-4 opacity-50 transition-opacity"
                : "space-y-4 transition-opacity"
            }
          >
            <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] md:items-center">
              <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-1 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Total no período</p>
                  <p className="text-lg font-semibold">{moeda(mapa.total)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Média por dia</p>
                  <p className="text-lg font-semibold">
                    {moeda(mapa.mediaPorDia)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Dia mais caro</p>
                  <p className="text-lg font-semibold">
                    {mapa.maiorDia ? (
                      <>
                        {moeda(mapa.maiorDia.valor)}{" "}
                        <span className="text-sm font-normal text-muted-foreground">
                          em {diaEMesDoMapa(mapa.maiorDia.data)}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        Nenhum gasto
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <Calendario semanas={mapa.semanas} moeda={moeda} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <span>Menos</span>
                {([0, 1, 2, 3, 4] as NivelDoMapa[]).map((n) => (
                  <span
                    key={n}
                    className={`h-3 w-3 rounded-sm ${COR_DO_NIVEL[n]}`}
                    aria-hidden
                  />
                ))}
                <span>Mais</span>
              </div>
              <span>
                {mapa.diasComGasto} de {mapa.diasPassados}{" "}
                {mapa.diasPassados === 1 ? "dia" : "dias"} com gasto
              </span>
            </div>

          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Calendario({
  semanas,
  moeda,
}: {
  semanas: CelulaDoMapa[][];
  moeda: (v: number) => string;
}) {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="grid grid-cols-[2rem_repeat(7,minmax(0,1fr))] gap-1 text-center text-xs text-muted-foreground">
        <span />
        {DIAS_DA_SEMANA.map((d, i) => (
          <span key={i} aria-hidden>
            {d}
          </span>
        ))}
      </div>
      <div className="mt-1 space-y-1" role="grid" aria-label="Gasto por dia">
        {semanas.map((semana, i) => (
          <div
            key={i}
            role="row"
            className="grid grid-cols-[2rem_repeat(7,minmax(0,1fr))] gap-1"
          >
            <span className="self-center text-left text-xs text-muted-foreground">
              {rotuloDaSemana(semana, i === 0)}
            </span>
            {semana.map((celula, j) => (
              <Celula
                key={celula.data ?? `v${i}-${j}`}
                celula={celula}
                moeda={moeda}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Celula({
  celula,
  moeda,
}: {
  celula: CelulaDoMapa;
  moeda: (v: number) => string;
}) {
  if (!celula.data) return <span role="gridcell" aria-hidden />;

  const quando = diaEMesDoMapa(celula.data);
  const descricao = celula.futuro
    ? `${quando}: ainda não chegou`
    : celula.valor > 0
      ? `${quando}: ${moeda(celula.valor)}`
      : `${quando}: nenhum gasto`;

  return (
    <span
      role="gridcell"
      title={descricao}
      aria-label={descricao}
      className={`flex aspect-square items-center justify-center rounded-sm text-[0.65rem] leading-none ${
        celula.futuro
          ? "border border-dashed border-border text-muted-foreground/60"
          : `${COR_DO_NIVEL[celula.nivel]} ${TEXTO_DO_NIVEL[celula.nivel]}`
      }`}
    >
      {celula.dia}
    </span>
  );
}
