"use client";

// -----------------------------------------------------------------------------
// OS TILES DE RECEITA E DESPESA EM TRES NUMEROS (HMO-174)
// -----------------------------------------------------------------------------
// Onde o painel mostrava "Entrou" e "Saiu" -- um numero cada, o mes inteiro
// agregado sem comparar com hoje --, mostra agora tres:
//
//   Realizado      o que ja aconteceu
//   Previsao       o que ainda vai acontecer ate o fim do periodo
//   Total esperado a soma dos dois
//
// Componente burro, igual ao PrevistoXRealizado: a aritmetica inteira mora em
// lib/realizado-e-previsao.ts, onde o teste alcanca sem montar React. O que
// sobra aqui e marcacao -- e as duas decisoes de marcacao que a lib nao pode
// tomar por ele.
//
// A PRIMEIRA: QUAL DOS TRES E O NUMERO GRANDE
// --------------------------------------------
// O Total esperado. E ele que responde a pergunta pela qual o tile existe
// ("quanto este mes vai me custar?"), e e ele que o usuario compara com o
// saldo. Realizado e Previsao ficam embaixo, LADO A LADO e rotulados -- nao
// empilhados numa nota de rodape: as duas parcelas precisam ser lidas como um
// par que soma, e uma delas em letra menor que a outra sugere hierarquia onde
// nao ha.
//
// A SEGUNDA: O TILE NUNCA IMPRIME SO O TOTAL
// -------------------------------------------
// Mesmo em periodo passado (Previsao zero) ou futuro (Realizado zero) as tres
// linhas aparecem, com a que vale zero dizendo POR QUE. Esconder a linha vazia
// pareceria arrumado e produziria a leitura errada: um tile com um numero so,
// sem eixo de tempo, e exatamente o que esta issue veio consertar. Zero
// explicado e informacao; linha ausente e ambiguidade.
// -----------------------------------------------------------------------------

import { TrendingDown, TrendingUp } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import type { LadoDoPainel } from "@/lib/realizado-e-previsao";

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor);

export type LadoDoTile = "receita" | "despesa";

interface Props {
  lado: LadoDoTile;
  numeros: LadoDoPainel;
  /** O periodo em uma palavra, como o resto do painel o nomeia. */
  rotulo: string;
  /**
   * Nao ha mais nada por vir neste periodo -- ele ja acabou. Muda a frase da
   * linha de Previsao, nao o numero.
   */
  periodoEncerrado: boolean;
  /** O periodo ainda nao comecou: nada foi realizado, e isso nao e falta de dado. */
  periodoFuturo: boolean;
  /**
   * A rota nao conseguiu ler as assinaturas detectadas. A Previsao fica
   * OTIMISTA -- menor que a verdade --, e o tile precisa dizer isso: um total
   * esperado baixo demais e o pior lado do erro aqui.
   */
  previsaoIncompleta?: boolean;
}

export function TileRealizadoEPrevisao({
  lado,
  numeros,
  rotulo,
  periodoEncerrado,
  periodoFuturo,
  previsaoIncompleta = false,
}: Props) {
  const ehReceita = lado === "receita";
  const Icone = ehReceita ? TrendingUp : TrendingDown;
  // A cor e do LADO, nao do valor: receita e sempre a cor de entrada e despesa
  // sempre a de saida. Colorir pelo sinal aqui pintaria de verde um mes em que
  // a despesa caiu, e "gastei menos" nao e "entrou dinheiro".
  const cor = ehReceita ? "text-success" : "text-destructive";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-2">
          <Icone className="h-4 w-4" />
          {ehReceita ? "Receitas" : "Despesas"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${cor}`}>{moeda(numeros.total)}</div>
        <p className="text-xs text-muted-foreground mt-1">
          Total esperado <span className="capitalize">{rotulo}</span>
        </p>

        <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t">
          <div>
            <p className="text-xs text-muted-foreground">Realizado</p>
            <p className="text-sm font-semibold">{moeda(numeros.realizado)}</p>
            {periodoFuturo && (
              <p className="text-xs text-muted-foreground mt-0.5">
                O período ainda não começou
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Previsão</p>
            <p className="text-sm font-semibold">{moeda(numeros.previsao)}</p>
            {periodoEncerrado && (
              <p className="text-xs text-muted-foreground mt-0.5">
                O período já terminou
              </p>
            )}
          </div>
        </div>

        {previsaoIncompleta && (
          <p className="text-xs text-destructive mt-2">
            Sem as assinaturas detectadas: a previsão pode estar baixa.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface PropsVariavel {
  /** A estimativa que vale na tela: `porDia * dias`. */
  total: number;
  porDia: number;
  dias: number;
  /**
   * Ha historico suficiente para a mediana significar alguma coisa. Sem base o
   * bloco NAO desenha zero -- zero se le como "voce nao gasta nada", e o que
   * houve foi ausencia de historico.
   */
  temBase: boolean;
  /** Quantos meses fechados sustentam a mediana. */
  mesesBase: number;
  /** O usuario mexeu no valor: a media deixou de ser a fonte. */
  ajustado: boolean;
  onMudar: (porDia: number) => void;
  onRestaurar: () => void;
}

/**
 * A linha do gasto variavel, separada dos seis numeros acima.
 *
 * Decisao de produto do Helio (HMO-145, opcao "separado"): a media de gasto do
 * dia a dia NAO entra em Previsao nem em Total esperado. Ela aparece aqui, com
 * o valor editavel, e a leitura pretendida na tela e "ainda vou gastar R$ 800
 * em contas + R$ 1.500 estimados de gasto variavel".
 *
 * O campo editavel nao e conforto: e a condicao para a media poder existir. O
 * cabecalho do lib/variable-spend.ts estabelece que ela "so pode entrar na
 * conta se ela aparecer na tela e puder ser mudada la" -- um numero invisivel
 * que mexe no total e um numero que o usuario nao tem como conferir nem
 * corrigir. Aqui ela nao mexe em total nenhum, e ainda assim continua visivel
 * e mudavel: o valor que vale na tela e o que esta no campo, e a mediana e so
 * o valor inicial.
 */
export function LinhaDeGastoVariavel({
  total,
  porDia,
  dias,
  temBase,
  mesesBase,
  ajustado,
  onMudar,
  onRestaurar,
}: PropsVariavel) {
  return (
    <Card className="border-dashed">
      <CardContent className="pt-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted-foreground">
              Gasto variável estimado
            </p>
            <div className="text-xl font-bold">{moeda(total)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {dias > 0
                ? `${moeda(porDia)} por dia nos ${dias} ${
                    dias === 1 ? "dia" : "dias"
                  } que faltam`
                : "Não há dias pela frente neste período"}
            </p>
          </div>

          <div className="flex items-end gap-2">
            <label className="text-xs text-muted-foreground">
              Por dia
              <input
                type="number"
                min={0}
                step="1"
                value={porDia}
                onChange={(e) => onMudar(Number(e.target.value))}
                className="mt-1 block w-28 rounded-md border bg-background px-2 py-1 text-sm text-foreground"
                aria-label="Gasto variável por dia"
              />
            </label>
            {ajustado && (
              <button
                type="button"
                onClick={onRestaurar}
                className="text-xs text-muted-foreground underline pb-1"
              >
                Voltar à média
              </button>
            )}
          </div>
        </div>

        {/* A frase que impede a leitura errada. Sem ela, alguem soma este numero
            ao Total esperado de cima e conclui que o app se contradiz -- os dois
            numeros existem de proposito e medem coisas diferentes. */}
        <p className="text-xs text-muted-foreground mt-3">
          Mercado, restaurante, posto: o que não tem conta pedindo.{" "}
          <strong>Não está somado</strong> na previsão nem no total esperado
          acima.{" "}
          {temBase
            ? `A média sai de ${mesesBase} ${
                mesesBase === 1 ? "mês fechado" : "meses fechados"
              }.`
            : "Ainda não há meses fechados suficientes para uma média — o valor inicial é zero."}
        </p>
      </CardContent>
    </Card>
  );
}
