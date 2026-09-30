"use client";

// -----------------------------------------------------------------------------
// O BLOCO "PREVISTO x REALIZADO" DO PAINEL (HMO-186)
// -----------------------------------------------------------------------------
// Tres linhas -- entradas, despesas, resultado -- cada uma com o que o periodo
// PREVIA e o que de fato ACONTECEU, mais a diferenca entre os dois.
//
// Componente burro, igual ao SeletorDePeriodo: a aritmetica toda (somar a
// agenda, calcular a diferenca, escalar as barras, decidir em que linha "mais"
// e melhor) mora em lib/previsto-x-realizado.ts, onde o teste alcanca sem
// montar React. O que sobra aqui e marcacao.
//
// AS BARRAS SAO DUAS, NAO UMA DE PROGRESSO
// -----------------------------------------
// A tentacao era usar o <Progress> que o painel ja tem, com realizado sobre
// previsto. Nao serve: progresso satura em 100%, e o caso interessante e
// justamente o estouro -- gastar o dobro do previsto e ver a mesma barra cheia
// de quem gastou exatamente o previsto. Duas barras na mesma escala mostram a
// razao entre os numeros em qualquer direcao, inclusive negativa.
//
// O QUE ESTE BLOCO NAO PODE DEIXAR O USUARIO CONCLUIR
// ---------------------------------------------------
// Que a diferenca em despesas e "estouro de plano". As duas colunas nao cobrem
// o mesmo universo: o previsto e a AGENDA (aluguel, escola, salario) e o
// realizado e tudo (agenda + supermercado + posto + lanche de terca). Para a
// maioria das pessoas despesa realizada vai passar da prevista quase todo mes,
// e isso e normal. Dai a nota de rodape e a contagem de linhas da agenda: sem
// elas o bloco produz um numero plausivel e uma conclusao falsa -- que e o pior
// defeito que uma tela de dinheiro pode ter, porque nao levanta suspeita.
//
// E dai, tambem, o estado `semPrevisao`: com a agenda vazia o bloco NAO mostra
// "previsto R$ 0,00". Zero contra R$ 4.000 realizados se le como "R$ 4.000
// acima do previsto", quando o que houve foi ausencia de previsao.
// -----------------------------------------------------------------------------

import Link from "next/link";
import { Scale } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  compararPrevistoRealizado,
  type PrevistoDoPeriodo,
  type RealizadoDoPeriodo,
} from "@/lib/previsto-x-realizado";

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor);

/**
 * A diferenca com sinal explicito.
 *
 * `+`/`−` escritos a mao em vez de `signDisplay: "always"` do Intl porque o
 * sinal do Intl cola no simbolo da moeda (`+R$ 100,00`) e porque o zero
 * merece palavra, nao sinal: "igual ao previsto" e uma informacao, "+ R$ 0,00"
 * e um enigma.
 */
function Diferenca({
  valor,
  maiorEMelhor,
}: {
  valor: number;
  maiorEMelhor: boolean;
}) {
  if (valor === 0) {
    return (
      <span className="text-muted-foreground">Igual ao previsto</span>
    );
  }

  // Quem e "bom" depende da linha: entrada acima do previsto e boa, despesa
  // acima do previsto nao e. A decisao vem da lib, nao de um ternario aqui.
  const bom = maiorEMelhor ? valor > 0 : valor < 0;

  return (
    <span className={bom ? "text-success" : "text-destructive"}>
      {valor > 0 ? "+" : "−"} {moeda(Math.abs(valor))}
    </span>
  );
}

interface Props {
  previsto: PrevistoDoPeriodo;
  realizado: RealizadoDoPeriodo;
  /** O periodo em uma palavra, como o resto do painel o nomeia. */
  rotulo: string;
  /**
   * A rota nao conseguiu ler a direcao das linhas da agenda. Sem ela toda linha
   * cairia em despesa, e o resultado previsto ficaria negativo no valor do
   * salario -- um numero plausivel que ninguem calculou.
   */
  indisponivel?: boolean;
}

export function PrevistoXRealizado({
  previsto,
  realizado,
  rotulo,
  indisponivel = false,
}: Props) {
  const { linhas, semPrevisao } = compararPrevistoRealizado(
    previsto,
    realizado
  );

  const cabecalho = (
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2 text-lg">
        <Scale className="h-5 w-5" />
        Previsto x Realizado
      </CardTitle>
      <CardDescription className="capitalize">{rotulo}</CardDescription>
    </CardHeader>
  );

  if (indisponivel) {
    return (
      <Card className="border-dashed">
        {cabecalho}
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Não foi possível ler se cada conta prevista é entrada ou saída, e sem
            isso o resultado previsto sairia errado. Os números do realizado
            continuam nos outros blocos.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Sem agenda no periodo nao ha comparacao a fazer -- e o caminho de volta tem
  // que estar aqui: "cadastre uma conta prevista" e a unica acao que transforma
  // este bloco em algo util, e quem esta olhando o bloco vazio nao tem como
  // adivinhar isso.
  if (semPrevisao) {
    return (
      <Card className="border-dashed">
        {cabecalho}
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Não havia nada previsto em {rotulo} — nenhuma conta ou receita na
            agenda. O realizado do período foi{" "}
            <span className="font-medium">{moeda(realizado.resultado)}</span>,
            mas não há previsão para comparar com ele.
          </p>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/recurrences">Cadastrar o que é fixo</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {cabecalho}
      <CardContent className="space-y-4">
        {/* Cabecalho da grade. `sr-only` no rotulo da primeira coluna: a
            coluna existe visualmente (ela tem o nome da linha), mas sem texto
            proprio um leitor de tela anunciaria "vazio, Previsto, Realizado,
            Diferença" e a pessoa perderia a referencia da primeira celula. */}
        <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_repeat(3,minmax(0,7rem))] gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="sr-only sm:not-sr-only">Linha</span>
          <span className="hidden sm:block text-right">Previsto</span>
          <span className="hidden sm:block text-right">Realizado</span>
          <span className="hidden sm:block text-right">Diferença</span>
        </div>

        {linhas.map((linha) => (
          <div
            key={linha.chave}
            className={
              linha.chave === "resultado"
                ? "space-y-1 pt-3 border-t"
                : "space-y-1"
            }
          >
            <div className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_repeat(3,minmax(0,7rem))] gap-x-3 items-baseline">
              <span
                className={
                  linha.chave === "resultado"
                    ? "text-sm font-semibold"
                    : "text-sm"
                }
              >
                {linha.rotulo}
              </span>
              {/* No celular as tres colunas nao cabem lado a lado com o rotulo:
                  elas viram uma pilha a direita, com o nome de cada uma antes do
                  valor. Sem os nomes, tres numeros empilhados sem legenda nao
                  dizem qual e qual -- e `grid-cols-4` numa tela de 360px
                  estouraria a largura da pagina (ver HMO-185). */}
              <span className="text-sm text-right sm:tabular-nums">
                <span className="sm:hidden text-xs text-muted-foreground mr-1">
                  Previsto
                </span>
                {moeda(linha.previsto)}
              </span>
              <span className="text-sm text-right font-medium sm:tabular-nums">
                <span className="sm:hidden text-xs text-muted-foreground mr-1">
                  Realizado
                </span>
                {moeda(linha.realizado)}
              </span>
              <span className="text-sm text-right sm:tabular-nums">
                <span className="sm:hidden text-xs text-muted-foreground mr-1">
                  Diferença
                </span>
                <Diferenca
                  valor={linha.diferenca}
                  maiorEMelhor={linha.maiorEMelhor}
                />
              </span>
            </div>

            {/* As duas barras. `aria-hidden` porque elas nao acrescentam
                informacao nenhuma aos numeros que acabaram de ser lidos --
                anunciar duas barras por linha triplicaria o que um leitor de
                tela fala sem dizer nada novo. */}
            <div
              aria-hidden="true"
              className="space-y-0.5 sm:col-span-4 pt-0.5"
            >
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-muted-foreground/60"
                  style={{ width: `${linha.proporcaoPrevisto * 100}%` }}
                />
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${linha.proporcaoRealizado * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}

        {/* A nota que impede a leitura errada. Ela nao e decorativa: sem ela a
            diferenca em despesas se le como estouro de orcamento, e o que ela
            mede na maioria dos meses e apenas o gasto que ninguem agenda. */}
        <p className="text-xs text-muted-foreground">
          O previsto vem da agenda —{" "}
          {previsto.quantidade === 1
            ? "1 conta ou receita"
            : `${previsto.quantidade} contas e receitas`}{" "}
          com vencimento em {rotulo}. Gasto que não está na agenda (mercado,
          combustível, compras do dia) aparece só no realizado, então despesa
          realizada acima da prevista é o normal.
        </p>

        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/bills">Ver a agenda do período</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
