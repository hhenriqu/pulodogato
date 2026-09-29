"use client";

// Arquivadas: identico nas duas telas, e o texto e o mesmo porque a regra e a
// mesma -- some da lista e dos seletores, o historico de lancamentos fica
// inteiro. Cada tela so passa as suas (`useContas` ja filtrou por escopo).

import { Archive, ArchiveRestore } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { porTipo } from "@/lib/contas";
import type { FinancialAccount } from "@/types/financial";

interface ContasArquivadasProps {
  contas: FinancialAccount[];
  aoReativar: (conta: FinancialAccount) => void;
}

export function ContasArquivadas({
  contas,
  aoReativar,
}: ContasArquivadasProps) {
  if (contas.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Archive className="h-4 w-4 text-muted-foreground" />
          Arquivadas
          <span className="text-sm font-normal text-muted-foreground">
            ({contas.length})
          </span>
        </CardTitle>
        <CardDescription>
          Some da lista e dos seletores, mas o histórico de lançamentos continua
          inteiro.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {contas.map((conta) => (
          <div
            key={conta.id}
            className="flex items-center justify-between border-b border-border py-2 last:border-0"
          >
            <div>
              <p className="font-medium text-foreground">{conta.name}</p>
              <p className="text-sm text-muted-foreground">
                {porTipo(conta.account_type).rotulo}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => aoReativar(conta)}
            >
              <ArchiveRestore className="mr-1 h-3 w-3" />
              Reativar
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
