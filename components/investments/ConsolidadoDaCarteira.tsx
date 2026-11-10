"use client";

// ---------------------------------------------------------------------------
// O CONSOLIDADO DA CARTEIRA -- quanto ha em cada classe
// ---------------------------------------------------------------------------
// O quadro "Minha carteira" das corretoras: uma linha por classe (Renda Fixa,
// Fundos, Acoes, FIIs, Internacional) com a fatia no total, o valor de hoje e o
// rendimento bruto. Os numeros vem prontos de `comporConsolidado`
// (lib/carteira-na-tela.ts); aqui so se desenha. Devolve `null` com a carteira
// vazia, como o bloco por conta.
// ---------------------------------------------------------------------------

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatarValor } from "@/lib/dinheiro";
import type { Consolidado } from "@/lib/investments";
import { Dica } from "@/components/ui/dica";

/** As mesmas cores do grafico de alocacao, pela mesma chave (o rotulo). */
const COR_DA_CLASSE: Record<string, string> = {
  Ações: "#3b82f6",
  FIIs: "#10b981",
  "Renda Fixa": "#f59e0b",
  Fundos: "#ec4899",
  Internacional: "#8b5cf6",
};

export function ConsolidadoDaCarteira({ dados }: { dados: Consolidado }) {
  if (dados.classes.length === 0) return null;

  return (
    <Card data-bloco="consolidado">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5">
          Minha carteira
          <Dica rotulo="Sobre o consolidado">
            Tudo o que você tem investido, por classe. Renda fixa com indexador
            entra pelo valor de hoje calculado pelo CDI/IPCA; os demais, pelo
            preço atual informado ou cotado.
          </Dica>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-3xl font-bold tabular-nums">
            {formatarValor(dados.total)}
          </span>
          <span
            className={`text-sm tabular-nums ${
              dados.rendimento >= 0 ? "text-success" : "text-destructive"
            }`}
          >
            {dados.rendimento >= 0 ? "+" : ""}
            {formatarValor(dados.rendimento)} ({dados.rendimentoPercentual.toLocaleString("pt-BR")}%)
          </span>
        </div>

        {/* A barra empilhada: a fatia de cada classe no total. */}
        <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
          {dados.classes.map((c) => (
            <div
              key={c.tipo}
              style={{
                width: `${c.percentual}%`,
                backgroundColor: COR_DA_CLASSE[c.rotulo] ?? "#94a3b8",
              }}
            />
          ))}
        </div>

        {dados.classes.map((c) => (
          <div
            key={c.tipo}
            data-classe={c.tipo}
            className="flex items-baseline justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: COR_DA_CLASSE[c.rotulo] ?? "#94a3b8" }}
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">
                  {Math.round(c.percentual)}% {c.rotulo}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {c.ativos === 1 ? "1 ativo" : `${c.ativos} ativos`} · aplicado{" "}
                  {formatarValor(c.aplicado)}
                </span>
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-sm font-semibold tabular-nums">
                {formatarValor(c.valor)}
              </span>
              <span
                className={`block text-xs tabular-nums ${
                  c.rendimento >= 0 ? "text-success" : "text-destructive"
                }`}
              >
                {c.rendimento >= 0 ? "+" : ""}
                {formatarValor(c.rendimento)}
              </span>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
