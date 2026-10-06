"use client";

// ---------------------------------------------------------------------------
// UM CARTAO NA LISTA (HMO-210)
// ---------------------------------------------------------------------------
// Extraido de `cartoes/page.tsx` quando o cartao virou link para a tela de
// gastos dele. A extracao existe por uma razao de teste: a afirmacao que
// importa aqui e sobre a ARVORE ("Editar nao esta dentro da area clicavel"), e
// uma pagina com hook de dados nao da para renderizar em `react-dom/server`.
//
// A ARMADILHA QUE ISTO EVITA
// --------------------------
// Editar e Arquivar estavam DENTRO do card. Envolver o card inteiro num link
// deixaria os dois dentro da area clicavel, e `<button>` dentro de `<a>` nao
// so e marcacao invalida: clicar em "Arquivar" dispara o arquivamento E
// navega. A pessoa arquiva o cartao e cai na tela dele.
//
// A saida escolhida foi tirar os botoes de dentro do link, e nao
// `stopPropagation` neles. Duas razoes:
//
//   - `stopPropagation` resolve o clique do mouse e nao resolve o teclado: o
//     link continua sendo o ancestral, e `Enter` sobre o botao ainda navega em
//     parte dos navegadores;
//   - a prova fica barata. "o botao nao esta dentro do <a>" se le do HTML; "o
//     handler chama stopPropagation" exige simular evento, e passa verde se
//     alguem adicionar um terceiro botao sem a chamada.
//
// O NUMERO DESTE CARD MUDOU NA HMO-290
// ------------------------------------
// Ele imprimia `Math.abs(conta.current_balance)` sob o rotulo "Fatura atual".
// Aquilo e a divida INTEIRA do cartao, e nao a fatura: uma compra de R$ 3.000
// em 10x aparecia como "Fatura atual: R$ 3.000" no mes da compra, quando aquele
// mes cobra R$ 300 dela. O numero agora vem da fatura, por
// `lib/fatura-do-periodo`, que le a resposta de `GET /api/card-invoices`.
//
// TRES COISAS VIERAM JUNTO, E NENHUMA E ENFEITE
// ---------------------------------------------
//   1. O ROTULO DIZ O MES. Um numero de fatura exige dizer QUAL fatura -- e
//      esta tela nao tinha periodo nenhum. Sem o mes no rotulo o painel mente
//      no rotulo, e e a mesma razao de `rotuloDaFatura` devolver `null` em vez
//      de "undefined de 2026". Com `rotuloDoMes` nulo o numero nao sai.
//   2. `estado` ENTROU NAS PROPS. A tela passou a fazer DUAS leituras (o
//      cadastro e as faturas) onde fazia uma, e este card abre sem rede. Com a
//      leitura de faturas falhando e o cadastro fresco, o card imprimiria
//      "R$ 0,00" embaixo do nome do cartao certo -- indistinguivel de um mes
//      sem compra nenhuma. Quem junta os dois estados na mais pessimista e o
//      `estadoDaTela`, na pagina.
//   3. A LINHA DAS PARCELAS FUTURAS. Sem ela a troca seria so um numero menor,
//      e os R$ 2.700 das nove parcelas seguintes nao apareceriam em tela de
//      cartao nenhuma.
// ---------------------------------------------------------------------------

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Archive, CreditCard, Pencil } from "lucide-react";
import type { CardInvoice, FinancialAccount } from "@/types/financial";
import { faltaFatura } from "@/lib/contas";
import { formatarValor } from "@/lib/dinheiro";
import { caminhoDoCartao, rotuloDoCiclo } from "@/lib/fatura-do-cartao";
import {
  parcelasFuturasDaFatura,
  totalDaFatura,
} from "@/lib/fatura-do-periodo";
import { podeMostrarNumero, type EstadoDaLeitura } from "@/lib/offline-leitura";
import { NumeroIndisponivel } from "@/components/SemRede";

interface CartaoDaListaProps {
  conta: FinancialAccount;
  /**
   * A fatura DESTE cartao no mes escolhido, ja casada por `account_id` na
   * pagina.
   *
   * `null` e "nao deu para ler", e nao "fatura zerada": a rota devolve uma
   * entrada para todo cartao ativo, zerada quando o mes nao teve compra. Ver o
   * cabecalho de `lib/fatura-do-periodo`.
   */
  fatura: CardInvoice | null;
  /** O estado das DUAS leituras, ja reduzido pelo `estadoDaTela`. */
  estado: EstadoDaLeitura | null;
  /** "outubro de 2026", ou `null` quando o mes nao da para nomear. */
  rotuloDoMes: string | null;
  aoEditar: (conta: FinancialAccount) => void;
  aoArquivar: (conta: FinancialAccount) => void;
}

export function CartaoDaLista({
  conta,
  fatura,
  estado,
  rotuloDoMes,
  aoEditar,
  aoArquivar,
}: CartaoDaListaProps) {
  const semDias = faltaFatura(conta);
  const ciclo = rotuloDoCiclo(conta);

  const total = totalDaFatura(fatura);
  const parcelasFuturas = parcelasFuturasDaFatura(fatura, conta.id);

  // As TRES condicoes, e cada uma barra um jeito diferente de mentir:
  // `podeMostrarNumero` barra o zero confiante sem rede; `rotuloDoMes` barra o
  // numero sem eixo de tempo; `total !== null` barra o cartao que a resposta
  // nao trouxe.
  const mostraTotal =
    podeMostrarNumero(estado) && rotuloDoMes !== null && total !== null;

  return (
    <Card className="overflow-hidden">
      {/* A area clicavel: tudo que e LEITURA do cartao. Os botoes ficam fora. */}
      <Link
        href={caminhoDoCartao(conta.id)}
        className="block transition-colors hover:bg-muted/50"
      >
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <span
              className="flex h-9 w-9 items-center justify-center rounded-md"
              style={{ backgroundColor: `${conta.color_hex}20` }}
            >
              <CreditCard
                className="h-4 w-4"
                style={{ color: conta.color_hex }}
              />
            </span>
            <div>
              <CardTitle className="text-base">{conta.name}</CardTitle>
              <CardDescription className="text-xs">
                {conta.bank_name || "Cartão de crédito"}
                {conta.last_four_digits
                  ? ` · ••${conta.last_four_digits}`
                  : ""}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            {/* O ROTULO DIZ O MES. "Fatura atual" sobre um numero de fatura nao
                diz a qual fatura o numero responde, e esta tela mostra o mes
                que o seletor escolheu -- que nem sempre e o corrente. */}
            <p className="text-xs text-muted-foreground">
              {rotuloDoMes ? `Fatura de ${rotuloDoMes}` : "Fatura"}
            </p>
            <p className="text-lg font-semibold">
              {mostraTotal ? (
                formatarValor(total, conta.currency)
              ) : (
                <NumeroIndisponivel />
              )}
            </p>

            {/* AS PARCELAS FUTURAS (HMO-290).
                Depois da troca, o risco se inverte: a tela parava de exagerar a
                fatura e passava a esconder o que ja esta comprometido. Esta
                linha e secundaria de proposito -- ela nao e a fatura, e nao soma
                com ela.

                So aparece quando ha numero a mostrar E quando ele nao e zero:
                "+ R$ 0,00 em parcelas futuras" embaixo de toda fatura sem
                parcelamento seria ruido em todo cartao de todo mes. */}
            {mostraTotal && parcelasFuturas !== null && parcelasFuturas > 0 && (
              <p className="text-xs text-muted-foreground">
                + {formatarValor(parcelasFuturas, conta.currency)} em parcelas
                futuras
              </p>
            )}
          </div>

          {conta.credit_limit != null && (
            <p className="text-xs text-muted-foreground">
              Limite {formatarValor(Number(conta.credit_limit), conta.currency)}
            </p>
          )}

          {semDias || !ciclo ? (
            <Badge variant="outline" className="border-warning/30 text-warning">
              Falta fechamento e vencimento
            </Badge>
          ) : (
            <p className="text-xs text-muted-foreground">{ciclo}</p>
          )}

          <p className="text-xs text-info">Ver os gastos deste cartão</p>
        </CardContent>
      </Link>

      {/* FORA do link, de proposito -- ver o cabecalho do arquivo. */}
      <CardContent className="pt-0">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => aoEditar(conta)}>
            <Pencil className="mr-1 h-3 w-3" />
            Editar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => aoArquivar(conta)}>
            <Archive className="mr-1 h-3 w-3" />
            Arquivar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
