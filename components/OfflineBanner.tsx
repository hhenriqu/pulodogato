"use client";

// =====================================================
// A FAIXA QUE DIZ O QUE ESTA ACONTECENDO
// =====================================================
// Ela existe por um motivo so: sem rede, o app continua parecendo normal. Os
// numeros na tela sao os do ultimo carregamento e nao tem nenhuma marca que os
// distinga dos atuais. Quem abre e ve "saldo R$ 1.240" nao tem como saber que
// aquilo e de ontem -- e um numero desatualizado com cara de atual e pior que
// nenhum numero.
//
// Por isso a faixa fala de DADO, nao de conexao: "o que voce ve pode estar
// desatualizado" resolve a duvida da pessoa; "voce esta offline" ela ja sabe.
// =====================================================

import { CloudOff, RefreshCw, AlertTriangle, Trash2 } from "lucide-react";
import { useOfflineQueue } from "@/lib/hooks/useOfflineQueue";
import { Button } from "@/components/ui/button";

const moeda = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export function OfflineBanner() {
  const { online, resumo, itens, sincronizar, descartar } = useOfflineQueue();

  const falhados = itens.filter((i) => i.estado === "falhou");

  // Online, nada pendente e nada falhado: a faixa some por completo. Uma faixa
  // permanente vira parte do cenario e para de ser lida justamente no dia em
  // que tem algo a dizer.
  if (online && resumo.pendentes === 0 && falhados.length === 0) return null;

  return (
    <div className="print:hidden">
      {!online && (
        <div className="flex items-center gap-2 bg-warning px-4 py-2 text-sm text-warning-foreground">
          <CloudOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            Sem conexao. Os valores na tela sao do ultimo carregamento
            {resumo.pendentes > 0
              ? ` e ${resumo.pendentes} lancamento${
                  resumo.pendentes > 1 ? "s" : ""
                } (${moeda(resumo.totalPendente)}) esperam para subir.`
              : ". Da para lancar mesmo assim."}
          </span>
        </div>
      )}

      {online && resumo.pendentes > 0 && (
        <div className="flex items-center gap-2 bg-info px-4 py-2 text-sm text-info-foreground">
          <RefreshCw className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          <span>
            Enviando {resumo.pendentes} lancamento
            {resumo.pendentes > 1 ? "s" : ""} feito
            {resumo.pendentes > 1 ? "s" : ""} sem conexao...
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="ml-auto h-7"
            onClick={() => void sincronizar()}
          >
            Tentar agora
          </Button>
        </div>
      )}

      {falhados.length > 0 && (
        <div className="bg-destructive px-4 py-2 text-sm text-destructive-foreground">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {falhados.length} lancamento{falhados.length > 1 ? "s" : ""} nao
              pode{falhados.length > 1 ? "ram" : ""} ser salvo
              {falhados.length > 1 ? "s" : ""}. Lance de novo:
            </span>
          </div>
          {/*
            A lista mostra descricao, valor e data de CADA um. E o ponto do
            aviso: sem esses tres dados a pessoa sabe que perdeu alguma coisa e
            nao sabe o que -- e descartar um lancamento sem poder relanca-lo e
            o mesmo que perde-lo em silencio, so que com um aviso vermelho.
          */}
          <ul className="mt-1 space-y-1 pl-6">
            {falhados.map((item) => (
              <li key={item.id} className="flex items-center gap-2">
                <span>
                  {item.linha.description} &middot;{" "}
                  {moeda(Math.abs(item.linha.amount))} &middot;{" "}
                  {item.linha.transaction_date}
                  {item.ultimoErro ? ` (${item.ultimoErro})` : ""}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2"
                  onClick={() => void descartar(item.id)}
                  aria-label={`Descartar ${item.linha.description}`}
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
