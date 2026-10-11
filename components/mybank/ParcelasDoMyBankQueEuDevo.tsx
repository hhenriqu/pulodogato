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
//
// ---------------------------------------------------------------------------
// O ESCOPO DESTE BLOCO E A DIVIDA INTEIRA, DE PROPOSITO -- HMO-381
// ---------------------------------------------------------------------------
// A HMO-381 mediu em producao dois escopos na mesma tela sem rotulo nenhum: o
// card "Total a pagar" e os tres grupos da agenda falavam da janela da pagina
// (2026-10-01 a 2027-01-01, R$ 160,00) e este bloco mostrava 25 linhas, ate
// 15/10/2028. A issue oferecia duas saidas -- o bloco obedecer a janela, ou o
// bloco dizer que nao a segue. ESTE BLOCO FICA FORA DA JANELA, e a razao e um
// achado que o print nao mostrava:
//
// A AGENDA JA MOSTRA AS PARCELAS EM JANELA. `GET /api/scheduled-transactions`
// funde a divida do MyBank na agenda desde a HMO-372 (`lerDividaDoMyBank`,
// recortada por `{ de, ate }`), e `/dashboard/bills` NAO filtra essas linhas --
// `ehParcelaDoMyBank` existe em `lib/leituras-do-mybank.ts` sem um unico
// chamador. As tres linhas de "Mais adiante" do print SAO parcelas de MyBank.
//
// Entao um bloco recortado pela janela seria exatamente redundante: as mesmas
// linhas, nenhuma a mais, logo acima das da agenda. Com o escopo inteiro ele
// responde uma pergunta que nenhum outro pedaco da tela responde -- "quanto eu
// ainda devo ao todo" -- e e o unico lugar com o gesto de `reported`, que a
// linha da agenda nao tem.
//
// O QUE A ESCOLHA OBRIGA A ENTREGAR, e sem o que ela seria so o defeito com
// outro nome:
//
//   1. O ESCOPO DITO NA TELA (`data-escopo`), com o periodo MEDIDO nas parcelas
//      carregadas. `SUBTITULO_DO_DEVEDOR` explica o que o bloco E; ele nunca
//      disse de que periodo fala, e era isso que fazia os dois escopos se
//      confundirem.
//   2. O COLAPSO depois de `PARCELAS_VISIVEIS_FECHADO` linhas. Sem ele a
//      escolha nao conserta o sintoma que a issue abriu: o bloco empurrava o
//      resto da pagina 3.000 pixels para baixo.
//
// A SOBREPOSICAO EM SI -- a parcela em janela aparecendo em DUAS linhas da mesma
// tela, uma na agenda e uma aqui -- nao e desta issue. Ela se resolve tirando a
// linha de MyBank da agenda (e `ehParcelaDoMyBank` existe para isso) ou tirando
// este bloco da tela, e as duas mexem em "Total a pagar".
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
  blocoDoDevedor,
  escopoDoBlocoDoDevedor,
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
  // FECHADO E O ESTADO INICIAL: o bloco comprido e o sintoma da HMO-381, e
  // nascer aberto deixaria o conserto valendo so para quem toca no botao.
  const [aberto, setAberto] = useState(false);

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

  const bloco = blocoDoDevedor(parcelas, aberto);

  return (
    <Card id="mybank-que-eu-devo">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <HandCoins className="h-4 w-4" />
          {TITULO_DO_DEVEDOR}
        </CardTitle>
        <CardDescription>{SUBTITULO_DO_DEVEDOR}</CardDescription>
        {/* O ESCOPO, em ancora PROPRIA e nao dentro da frase acima: as duas
            dizem coisas de naturezas diferentes (o que o bloco e, e de que
            periodo ele fala), e juntas num paragrafo so a segunda se perde --
            era justamente ela que faltava. Separada, ela tambem e assertavel
            sem que a assercao case com o resto do subtitulo. */}
        <CardDescription data-escopo>
          {escopoDoBlocoDoDevedor(parcelas)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {bloco.visiveis.map((parcela) => (
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

        {/* O BOTAO DO COLAPSO.
            `rotuloDoBotao === null` e o caso em que a lista cabe inteira: ali
            nao ha botao nenhum, e nao um botao vazio. O rotulo diz QUANTAS
            faltam -- ver `blocoDoDevedor`. */}
        {bloco.rotuloDoBotao ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="w-full"
            data-expandir
            data-escondidas={bloco.escondidas}
            onClick={() => setAberto((estava) => !estava)}
          >
            {bloco.rotuloDoBotao}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
