"use client";

// ---------------------------------------------------------------------------
// O LADO DO DEVEDOR, EM CONTAS A PAGAR -- HMO-371 (F3 da HMO-368)
// ---------------------------------------------------------------------------
// "as parcelas aparecem em Contas a Pagar com o selo 'MyBank -- <quem
// emprestou>' e o botao de avisar que pagou."
//
// UM BLOCO PROPRIO, E NAO LINHA DENTRO DA AGENDA
// ----------------------------------------------
// A tentacao e injetar estas parcelas na mesma lista das contas previstas. Elas
// NAO sao linhas de `scheduled_transactions`: nao tem `id` de agenda, nao tem
// categoria, nao tem conta de origem, nao se editam, nao se adiam e o botao
// delas nao e "pagar" -- e "avisar que paguei", que e um gesto de outra
// natureza (ele nao move dinheiro nenhum; quem move e quem recebe).
//
// Misturadas na agenda, elas herdariam as acoes daquela lista e entrariam nos
// totais do topo. Os totais sao assunto da F4 (as sete leituras da secao 3 do
// plano), e mexer neles aqui mudaria "Total a pagar" num PR cuja prova e a tela
// -- o jeito classico de esta feature virar dinheiro errado e plausivel. Por
// isso: bloco separado, com rotulo proprio, e nenhum numero desta tela muda para
// quem nao tem parcela de MyBank.
//
// E ESSE E O CONTROLE NEGATIVO DESTE COMPONENTE: sem linha nenhuma ele devolve
// `null`. Uma conta sem MyBank le a tela de Contas a Pagar EXATAMENTE como lia
// antes -- nenhum card a mais, nenhum total diferente.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { HandCoins } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import { formatCurrency } from "@/lib/utils";
import { dataOuMomentoNaTela } from "@/lib/data-na-tela";
import {
  podeAvisarQuePagou,
  seloDoMyBank,
  ROTULO_DE_AVISAR,
  ROTULO_PARA_AVISAR,
  SUBTITULO_DO_DEVEDOR,
  TITULO_DO_DEVEDOR,
  type ParcelaQueEuDevo,
} from "@/lib/mybank-na-tela";

export function ParcelasDoMyBankQueEuDevo() {
  const [parcelas, setParcelas] = useState<ParcelaQueEuDevo[]>([]);
  const [avisando, setAvisando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch("/api/mybank/due");
      // `ok` CONFERIDO: um 500 deste app responde `{ error: "..." }`, e
      // `dados.parcelas ?? []` leria isso como "nao devo nada". O bloco
      // desapareceria da tela em vez de dizer que a leitura falhou -- e o
      // sintoma seria uma divida que some.
      if (!resposta.ok) return;
      const dados = await resposta.json();
      setParcelas(dados.parcelas ?? []);
    } catch (e) {
      console.error("Erro ao ler as parcelas do MyBank que eu devo:", e);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function avisarQuePaguei(parcela: ParcelaQueEuDevo) {
    setAvisando(parcela.id);
    try {
      const resposta = await fetch(`/api/mybank/installments/${parcela.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // `reported`, e NUNCA `paid`: quem leva a parcela a paga e quem recebe o
        // dinheiro, porque so ele sabe se recebeu. A rota recusa `paid` do
        // devedor com 403, e esta linha e o lado da tela da mesma regra.
        body: JSON.stringify({ status: "reported" }),
      });

      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível avisar.");
        return;
      }

      toast.success(dados.message ?? "Avisamos quem emprestou.");
      await carregar();
    } catch (e) {
      console.error("Erro ao avisar que paguei:", e);
      toast.error("Não foi possível avisar.");
    } finally {
      setAvisando(null);
    }
  }

  // Ver o cabecalho: sem parcela nenhuma, a tela de Contas a Pagar fica
  // identica ao que era antes desta issue.
  if (parcelas.length === 0) return null;

  return (
    <Card id="mybank-que-eu-devo">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <HandCoins className="h-4 w-4" />
          {TITULO_DO_DEVEDOR}
        </CardTitle>
        <CardDescription>{SUBTITULO_DO_DEVEDOR}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {parcelas.map((parcela) => (
          <div
            key={parcela.id}
            data-devo={parcela.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{parcela.descricao}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {/* O SELO, com o nome de quem emprestou. Sem o nome legivel ele
                    diz so "MyBank" e a parcela CONTINUA aqui -- a divida nao
                    deixou de existir porque o contato saiu. */}
                <Badge variant="outline" data-selo>
                  {seloDoMyBank(parcela.quem_emprestou)}
                </Badge>
                <span data-parcela-rotulo>parcela {parcela.rotulo}</span>
                <span>vence {dataOuMomentoNaTela(parcela.vencimento)}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span data-valor className="font-semibold">
                {formatCurrency(parcela.valor)}
              </span>
              {podeAvisarQuePagou(parcela) ? (
                <Button
                  size="sm"
                  variant="outline"
                  data-avisar={parcela.id}
                  disabled={avisando === parcela.id}
                  onClick={() => avisarQuePaguei(parcela)}
                >
                  {ROTULO_PARA_AVISAR}
                </Button>
              ) : (
                // JA AVISOU: o botao vira estado, e nao desaparece.
                //
                // Um botao que some deixa a pessoa sem saber se o toque pegou --
                // e o estado `reported` e justamente o intervalo em que nada
                // mais depende dela. A frase diz o que falta, e de quem.
                <span data-avisado={parcela.id} className="text-xs text-muted-foreground">
                  {ROTULO_DE_AVISAR} · falta quem emprestou confirmar
                </span>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
