"use client";

import { useState } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TAMANHO_MAXIMO_DO_NOME,
  nomeDoParticipanteParaGravar,
} from "@/lib/membro-sem-conta";

import { Dica } from "@/components/ui/dica";
/**
 * Adicionar ao grupo alguem que nao tem conta no app (migration 077).
 *
 * So o nome. A pessoa entra ativa, divide as proximas despesas e aparece no
 * saldo e no acerto; quem tem conta registra por ela o que ela pagou ("Quem
 * pagou" no formulario de despesa).
 *
 * Montado so para o admin: a RLS de `group_members` recusa o resto, e
 * oferecer o campo a quem nao pode seria prometer o que o banco nega.
 */
export function AdicionarSemConta({
  groupId,
  aoAdicionar,
}: {
  groupId: string;
  aoAdicionar: () => void | Promise<void>;
}) {
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);

  const adicionar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (salvando) return;

    const conferido = nomeDoParticipanteParaGravar(nome);
    if (!conferido.ok) {
      toast.error(conferido.erro);
      return;
    }

    setSalvando(true);
    try {
      const resposta = await fetch(`/api/expense-groups/${groupId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: conferido.nome }),
      });
      const data = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        toast.error(data.error || "Não foi possível adicionar o participante");
        return;
      }
      toast.success(`${conferido.nome} entrou no grupo, sem precisar de conta.`);
      setNome("");
      await aoAdicionar();
    } catch (erro) {
      console.error("Erro ao adicionar participante sem conta:", erro);
      toast.error("Não foi possível adicionar o participante");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form onSubmit={adicionar} className="space-y-2 border rounded-lg p-4">
      <div className="flex items-center gap-1">
        <Label htmlFor="participante-sem-conta">
          Adicionar participante sem conta no app
        </Label>
        <Dica rotulo="Sobre participante sem conta">
          Para o amigo que não vai instalar o app. Ele divide as despesas e
          aparece no saldo; você registra por ele o que ele pagou.
        </Dica>
      </div>
      <div className="flex gap-2">
        <Input
          id="participante-sem-conta"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder="Nome, ex.: João"
          maxLength={TAMANHO_MAXIMO_DO_NOME}
          disabled={salvando}
        />
        <Button type="submit" disabled={salvando || !nome.trim()}>
          <UserPlus className="h-4 w-4 mr-1" />
          {salvando ? "Adicionando..." : "Adicionar"}
        </Button>
      </div>
    </form>
  );
}
