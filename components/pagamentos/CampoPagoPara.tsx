"use client";

import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PessoaParaPagamento } from "@/lib/pagamento-entre-pessoas";

import { Dica } from "@/components/ui/dica";
/**
 * "Pagamento para alguém da família" no formulário de despesa (081). Escolher
 * uma pessoa faz a despesa, ao salvar, aparecer para ela como "a lançar".
 * Sem ninguém nos seus grupos, o campo não aparece.
 */
export function CampoPagoPara({
  valor,
  aoMudar,
}: {
  valor: string;
  aoMudar: (userId: string) => void;
}) {
  const [pessoas, setPessoas] = useState<PessoaParaPagamento[]>([]);

  useEffect(() => {
    let vivo = true;
    fetch("/api/pagamentos-entre-pessoas/pessoas")
      .then((r) => (r.ok ? r.json() : { pessoas: [] }))
      .then((j) => {
        if (vivo) setPessoas(j.pessoas ?? []);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, []);

  if (pessoas.length === 0) return null;

  return (
    <div className="space-y-2 p-4 border rounded-lg bg-muted/20">
      <div className="flex items-center gap-1">
        <Label>Pagamento para alguém da família</Label>
        <Dica rotulo="Sobre pagamento para a família">
          A pessoa vê o pagamento e confirma em qual conta dela o dinheiro entrou.
        </Dica>
      </div>
      <Select
        value={valor || "ninguem"}
        onValueChange={(v: string) => aoMudar(v === "ninguem" ? "" : v)}
      >
        <SelectTrigger>
          <SelectValue placeholder="Ninguém" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ninguem">Não, é uma despesa comum</SelectItem>
          {pessoas.map((p) => (
            <SelectItem key={p.user_id} value={p.user_id}>
              {p.nome}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
