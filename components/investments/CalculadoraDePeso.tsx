"use client";

// A calculadora de peso: as abas "Nota Empresa" e "Nota FII" da planilha de
// rebalanceamento, num modal. Cada criterio recebe um valor de 0 a 10, o
// resultado e a media ponderada pela importancia do criterio, e "Usar este
// peso" o leva para a linha do ativo. A conta e lib/rebalanceamento.ts
// (`calcularPesoPelosCriterios`), com suite propria.
//
// Os valores digitados nao sao gravados: a planilha tambem nao guarda -- ela e
// uma folha de rascunho por empresa. O que fica e o peso.

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CRITERIOS_DA_CALCULADORA,
  calcularPesoPelosCriterios,
  type ModeloDaCalculadora,
} from "@/lib/rebalanceamento";

interface CalculadoraDePesoProps {
  /** O ativo em edicao; `null` fecha o modal. */
  ativo: { symbol: string; modelo: ModeloDaCalculadora } | null;
  aoFechar: () => void;
  aoUsar: (peso: number) => void;
}

function lerValor(texto: string): number | null {
  const limpo = texto.trim().replace(",", ".");
  if (limpo === "") return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

export function CalculadoraDePeso({ ativo, aoFechar, aoUsar }: CalculadoraDePesoProps) {
  return (
    <Dialog
      open={ativo !== null}
      onOpenChange={(aberto) => {
        if (!aberto) aoFechar();
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        {/* Montado so com o modal aberto: cada abertura nasce limpa, sem os
            valores do ativo anterior. */}
        {ativo && (
          <CorpoDaCalculadora
            key={`${ativo.symbol}-${ativo.modelo}`}
            symbol={ativo.symbol}
            modeloInicial={ativo.modelo}
            aoUsar={(peso) => {
              aoUsar(peso);
              aoFechar();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function CorpoDaCalculadora({
  symbol,
  modeloInicial,
  aoUsar,
}: {
  symbol: string;
  modeloInicial: ModeloDaCalculadora;
  aoUsar: (peso: number) => void;
}) {
  const [modelo, setModelo] = useState<ModeloDaCalculadora>(modeloInicial);
  const [textos, setTextos] = useState<Record<string, string>>({});

  const criterios = CRITERIOS_DA_CALCULADORA[modelo];
  const valores: Record<string, number | null> = {};
  for (const c of criterios) valores[c.id] = lerValor(textos[c.id] ?? "");
  const resultado = calcularPesoPelosCriterios(criterios, valores);
  const somaDasImportancias = criterios.reduce((s, c) => s + c.importancia, 0);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Calcular o peso de {symbol}</DialogTitle>
        <DialogDescription>
          Dê de 0 a 10 em cada critério. O peso é a média ponderada pela
          importância de cada um, como na sua planilha. Critério em branco fica
          fora da conta.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={modelo === "empresa" ? "default" : "outline"}
          onClick={() => setModelo("empresa")}
        >
          Empresa
        </Button>
        <Button
          type="button"
          size="sm"
          variant={modelo === "fii" ? "default" : "outline"}
          onClick={() => setModelo("fii")}
        >
          FII
        </Button>
      </div>

      <div className="space-y-4">
        {criterios.map((c) => {
          const valor = valores[c.id];
          const foraDaFaixa = valor !== null && (valor < 0 || valor > 10);
          return (
            <div key={c.id} className="grid grid-cols-1 gap-1 sm:grid-cols-[1fr_6rem] sm:items-start sm:gap-3">
              <div>
                <Label htmlFor={`criterio-${c.id}`}>{c.rotulo}</Label>
                <p className="text-xs text-muted-foreground">
                  Importância {Math.round((c.importancia / somaDasImportancias) * 100)}% · {c.dica}
                </p>
              </div>
              <div>
                <Input
                  id={`criterio-${c.id}`}
                  inputMode="decimal"
                  placeholder="0 a 10"
                  value={textos[c.id] ?? ""}
                  onChange={(e) =>
                    setTextos((t) => ({ ...t, [c.id]: e.target.value }))
                  }
                />
                {foraDaFaixa && (
                  <p className="text-xs text-muted-foreground">Conta como {valor! < 0 ? 0 : 10}.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Peso calculado</p>
          <p className="text-2xl font-bold">
            {resultado === null
              ? "—"
              : resultado.toLocaleString("pt-BR", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
          </p>
        </div>
        <Button
          type="button"
          disabled={resultado === null}
          onClick={() => resultado !== null && aoUsar(resultado)}
        >
          Usar este peso
        </Button>
      </div>
    </>
  );
}
