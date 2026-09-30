"use client";

/**
 * A barra "quanto ja gastamos da viagem", desenhada num lugar so.
 *
 * POR QUE UM COMPONENTE, E NAO DOIS JSX PARECIDOS
 * ----------------------------------------------
 * A barra nasceu na tela de Orcamento, aba Grupo (HMO-138). A HMO-180 a levou
 * para DENTRO da tela do grupo, que e onde a pergunta e feita -- e a tentacao
 * ali era escrever o cartao de novo, com o mesmo `Math.round(ratio * 100)` e a
 * mesma escolha de cor.
 *
 * Duas copias nao quebram nada hoje: elas divergem no dia em que uma das duas
 * mudar. O sintoma seria a mesma viagem mostrando percentuais diferentes em
 * duas telas, sem erro no console e sem teste vermelho -- e quem olha nao tem
 * como saber qual das duas esta certa. A conta (`separarOrcamentos`) ja morava
 * em lib/orcamento-de-grupo.ts por esse motivo; o DESENHO passou a morar aqui
 * pelo mesmo.
 *
 * O que muda entre as duas telas e so a acao por linha: a de Orcamento remove
 * o teto, a do grupo nao mexe em teto nenhum. Por isso `acaoDaLinha` e um slot
 * opcional em vez de um `if` sobre qual tela chamou.
 */

import type { ReactNode } from "react";
import { Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { formatCurrency } from "@/lib/utils";
import {
  fraseDoRestante,
  type GrupoOrcado,
  type StatusDeConsumo,
} from "@/lib/orcamento-de-grupo";
import type { BudgetWithConsumption } from "@/types/financial";

/**
 * Cor do percentual pelo status que a view calculou.
 *
 * Nao recalcula limiar nenhum: `alert_threshold` e por teto e a view ja aplicou
 * o de cada um. Refazer a comparacao aqui daria uma terceira versao da regra.
 */
function corDoStatus(status: StatusDeConsumo): string {
  if (status === "exceeded") return "text-destructive";
  if (status === "alert") return "text-warning";
  return "text-success";
}

/**
 * A barra para em 100 mesmo quando estourou; o percentual ao lado e quem conta
 * o tamanho do estouro. Uma barra de 180% vira ruido, e `Progress` acima de 100
 * so empurra o indicador para fora do trilho.
 */
const larguraDaBarra = (pct: number) => Math.min(pct, 100);

const percentual = (ratio: number) => Math.round(ratio * 100);

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * 'AAAA-MM' ou 'AAAA-MM-DD' -> 'setembro de 2025'.
 *
 * Fatiado da string, sem `new Date()`: a ISO e lida como UTC e, no Brasil, o
 * primeiro dia do mes voltaria um dia -- o que rotularia a barra de setembro
 * como agosto. Um teto no mes errado nao da erro, so mostra o numero de outro
 * mes debaixo do nome deste.
 */
const nomeDoMes = (iso: string) => {
  const [ano, mes] = iso.split("-");
  return `${MESES[Number(mes) - 1] ?? iso} de ${ano}`;
};

/** Um teto por categoria: a linha de dentro do cartao da viagem. */
export function LinhaDeTeto({
  budget,
  acao,
}: {
  budget: BudgetWithConsumption;
  /** Botao da tela que sabe agir sobre o teto (remover, editar). Opcional. */
  acao?: ReactNode;
}) {
  const pct = percentual(Number(budget.consumed_ratio));
  const restante = Number(budget.remaining);

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {budget.category?.name ?? "Categoria"}
          </p>
          <p className="text-sm text-muted-foreground">
            {formatCurrency(Number(budget.spent))} de{" "}
            {formatCurrency(Number(budget.amount_limit))}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-semibold ${corDoStatus(
              budget.consumption_status
            )}`}
          >
            {pct}%
          </span>
          {acao}
        </div>
      </div>

      <Progress value={larguraDaBarra(pct)} />

      <p className="text-sm">
        {restante >= 0 ? (
          <span className="text-muted-foreground">
            Restam {formatCurrency(restante)}
          </span>
        ) : (
          <span className="font-medium text-destructive">
            Estourou {formatCurrency(Math.abs(restante))}
          </span>
        )}
      </p>
    </div>
  );
}

/**
 * Uma viagem (ou a casa): a barra do grupo inteiro em cima, os tetos por
 * categoria embaixo.
 *
 * A barra de cima e a resposta que a tela existe para dar -- "quanto já
 * gastamos da viagem" -- e ela soma o gasto de TODOS os membros, nao só o de
 * quem esta olhando: quem paga o hotel e quem paga a gasolina consomem o mesmo
 * teto. Por isso a frase de apoio diz isso com todas as letras; sem ela, o
 * numero parece alto demais para quem lembra so do que pagou.
 */
export function CartaoOrcamentoGrupo({
  grupo,
  acaoDaLinha,
  /**
   * Substitui o nome do grupo no titulo. A tela do grupo ja tem o nome no
   * cabecalho da pagina e prefere dizer de que MES e a barra -- repetir o nome
   * ali seria a unica informacao que aquele titulo nao daria.
   */
  titulo,
  /**
   * Mes a que a barra se refere ('AAAA-MM' ou 'AAAA-MM-DD'), quando a tela nao
   * o diz por conta propria.
   *
   * A de Orcamento tem o seletor de mes no cabecalho e nao precisa; a do grupo
   * nao tem nada que datasse a barra, e "ja gastamos R$ 1.200" sem mes nao e
   * uma frase verificavel. Quem passa isto deve passar o mes que a RESPOSTA
   * trouxe, nao o que a tela pediu: sao a mesma coisa hoje, e no dia em que a
   * rota corrigir o pedido o rotulo acompanha em vez de mentir.
   */
  mes,
}: {
  grupo: GrupoOrcado<BudgetWithConsumption>;
  acaoDaLinha?: (budget: BudgetWithConsumption) => ReactNode;
  titulo?: string;
  mes?: string;
}) {
  const pct = percentual(grupo.ratio);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 shrink-0" />
              <span className="truncate">{titulo ?? grupo.group_name}</span>
            </CardTitle>
            <CardDescription>
              {formatCurrency(grupo.gasto)} de {formatCurrency(grupo.limite)}
              {mes ? ` em ${nomeDoMes(mes)}` : ""} — soma o gasto de todos os
              membros
            </CardDescription>
          </div>
          <span
            className={`text-lg font-semibold ${corDoStatus(grupo.status)}`}
          >
            {pct}%
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Progress value={larguraDaBarra(pct)} />
          <p
            className={`text-sm ${
              grupo.restante < 0
                ? "font-medium text-destructive"
                : "text-muted-foreground"
            }`}
          >
            {fraseDoRestante(grupo)}
          </p>
        </div>

        {/* grid-cols-1 explicito: sem ele o trilho `auto` usa min-content como
            piso e a linha larga estoura a largura da pagina no celular. */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {grupo.orcamentos.map((b) => (
            <LinhaDeTeto key={b.id} budget={b} acao={acaoDaLinha?.(b)} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
