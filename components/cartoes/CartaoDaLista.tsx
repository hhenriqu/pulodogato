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
import type { FinancialAccount } from "@/types/financial";
import { faltaFatura } from "@/lib/contas";
import { formatarValor } from "@/lib/dinheiro";
import { caminhoDoCartao, rotuloDoCiclo } from "@/lib/fatura-do-cartao";

interface CartaoDaListaProps {
  conta: FinancialAccount;
  aoEditar: (conta: FinancialAccount) => void;
  aoArquivar: (conta: FinancialAccount) => void;
}

export function CartaoDaLista({
  conta,
  aoEditar,
  aoArquivar,
}: CartaoDaListaProps) {
  const semDias = faltaFatura(conta);
  const ciclo = rotuloDoCiclo(conta);

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
            <p className="text-xs text-muted-foreground">Fatura atual</p>
            <p className="text-lg font-semibold">
              {formatarValor(
                Math.abs(Number(conta.current_balance ?? 0)),
                conta.currency
              )}
            </p>
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
