"use client";

// "Este mes esta fora do meu normal?"
//
// Le GET /api/anomalies. Toda a aritmetica mora em lib/anomalies.ts, com teste
// unitario proprio -- aqui nao ha conta nenhuma, so formatacao.
//
// TRES ESTADOS, E ELES NAO SAO O MESMO
// ------------------------------------
//   - SEM BASE (`temBase` falso): o app ainda nao tem historico para julgar.
//     Dizer "esta tudo normal" aqui seria uma afirmacao que os dados nao
//     sustentam, e e exatamente o que o usuario novo veria.
//   - COM BASE E SEM ALERTA: ai sim, "dentro do normal" e uma afirmacao.
//   - COM ALERTA: a lista.
//
// A tela diz o DIA DO CORTE em toda leitura. Sem isso o numero fica ambiguo no
// meio do mes -- "alimentacao 60% acima" acima de que, do mes inteiro? -- e o
// usuario compara com o total do mes anterior, que e a comparacao errada.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface Comparacao {
  chave: string;
  rotulo: string;
  atual: number;
  tipico: number;
  excesso: number;
  razao: number | null;
  mesesBase: number;
  anomalia: boolean;
}

interface Resposta {
  mes: string;
  ateODia: number;
  temBase: boolean;
  truncado: boolean;
  alertas: Comparacao[];
}

const NOMES_DOS_MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function rotuloDoMes(mes: string): string {
  const i = Number(mes.slice(5, 7)) - 1;
  return NOMES_DOS_MESES[i] ?? mes;
}

function brl(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

export function AnomaliesCard() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch("/api/anomalies");
      if (!r.ok) throw new Error("falha ao carregar");
      setDados((await r.json()) as Resposta);
    } catch {
      setErro("Não foi possível calcular agora.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (carregando) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fora do normal</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Calculando…</p>
        </CardContent>
      </Card>
    );
  }

  if (erro || !dados) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Fora do normal</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{erro}</p>
        </CardContent>
      </Card>
    );
  }

  const { alertas, temBase, ateODia, mes } = dados;
  const janela = `1 a ${ateODia} de ${rotuloDoMes(mes)}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {alertas.length > 0 ? (
            <AlertTriangle className="h-4 w-4 text-destructive" />
          ) : (
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          )}
          Fora do normal
        </CardTitle>
        <CardDescription>
          {/* A janela e comparada contra os MESMOS dias dos meses anteriores --
              e o que impede o app de acusar "queda de 90%" todo comeco de mes. */}
          {janela}, contra os mesmos dias dos meses anteriores.
        </CardDescription>
      </CardHeader>

      <CardContent>
        {!temBase ? (
          <p className="text-sm text-muted-foreground">
            Ainda não há meses suficientes para dizer o que é o seu normal. A
            comparação começa depois de três meses de histórico.
          </p>
        ) : alertas.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nada fora do normal até aqui.
          </p>
        ) : (
          <ul className="space-y-3">
            {alertas.slice(0, 5).map((a) => (
              <li
                key={`${a.chave}-${a.rotulo}`}
                className="flex items-baseline justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.rotulo}</p>
                  <p className="text-xs text-muted-foreground">
                    normal: {brl(a.tipico)} · agora: {brl(a.atual)}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-destructive">
                  +{brl(a.excesso)}
                </span>
              </li>
            ))}
          </ul>
        )}

        {dados.truncado && (
          <p className="mt-3 text-xs text-muted-foreground">
            Há mais lançamentos do que cabe numa leitura; a comparação pode
            estar incompleta.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
