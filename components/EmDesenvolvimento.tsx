"use client";

// -----------------------------------------------------------------------------
// O estado honesto de uma tela que ainda nao existe.
// -----------------------------------------------------------------------------
// Ate a HMO-124, Investimentos e Trading eram telas ESTATICAS que simulavam um
// produto: "R$ 0,00 / Valor Total", "0,00% / Rentabilidade", e botoes
// ("Adicionar Investimento", "Nova Transacao", "Ver Relatorios") sem nenhum
// onClick. As rotas de API por tras liam `dividends`, `transactions` e
// `assets` -- tabelas que nunca existiram neste banco.
//
// Um "R$ 0,00" dito com confianca e pior do que um aviso: ele e indistinguivel
// de um saldo zerado de verdade. Quem cadastrasse investimentos em outro lugar
// e abrisse esta tela concluiria que o app perdeu os dados, e quem clicasse no
// botao concluiria que o app esta quebrado. As duas conclusoes sao erradas: a
// funcionalidade nunca foi construida.
//
// Este componente diz isso em uma frase e oferece o que existe hoje.
// -----------------------------------------------------------------------------

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Hammer } from "lucide-react";

interface Props {
  titulo: string;
  /** O que a tela vai fazer quando existir, em uma frase. */
  descricao: string;
}

export function EmDesenvolvimento({ titulo, descricao }: Props) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center p-10 text-center">
        <Hammer className="h-12 w-12 text-muted-foreground mb-4" />
        <h3 className="text-lg font-medium mb-2">
          {titulo} ainda não está disponível
        </h3>
        <p className="text-muted-foreground mb-6 max-w-md">{descricao}</p>
        <div className="flex gap-2 flex-wrap justify-center">
          <Button asChild>
            <Link href="/dashboard">Voltar para a visão geral</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/personal-finance">Finanças Pessoais</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
