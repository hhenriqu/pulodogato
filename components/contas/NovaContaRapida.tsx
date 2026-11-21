"use client";

// Criar uma conta ou um cartao sem sair da tela onde ele faltou.
//
// Nasceu na importacao de extrato: quem chega com o CSV do Mercado Pago e nao
// tem a conta "Mercado Pago" no app precisava abandonar a tela, ir em Contas,
// cadastrar e voltar -- e perdia o arquivo escolhido no caminho. Aqui so vai o
// minimo (nome, tipo e, no cartao, fechamento e vencimento); o resto se edita
// depois na tela da conta.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { TIPOS_DE_CONTA } from "@/lib/contas";
import type { AccountType, FinancialAccount } from "@/types/financial";

interface Props {
  /** Nome e tipo que ja chegam preenchidos (ex.: "Mercado Pago", conta corrente). */
  nomeSugerido?: string;
  tipoSugerido?: AccountType;
  /** Tipos que a tela aceita aqui. Sem a lista, todos. */
  tiposPermitidos?: AccountType[];
  onCriada: (conta: FinancialAccount) => void;
  onCancelar: () => void;
  /**
   * As contas que ja existem. Com elas, o nome repetido ganha um aviso e o
   * atalho "Usar esta" (QA do Mercado Pago, B2): o cadastro sugeria
   * "Mercado Pago" para quem ja tinha uma conta com esse nome, e o usuario
   * acabava com duas.
   */
  contasExistentes?: FinancialAccount[];
  onUsarExistente?: (conta: FinancialAccount) => void;
}

const mesmoNome = (a: string, b: string) =>
  a.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase() ===
  b.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

const diaValido = (texto: string) => {
  const n = Number(texto);
  return Number.isInteger(n) && n >= 1 && n <= 31;
};

export function NovaContaRapida({
  nomeSugerido = "",
  tipoSugerido = "checking",
  tiposPermitidos,
  onCriada,
  onCancelar,
  contasExistentes = [],
  onUsarExistente,
}: Props) {
  const tipos = TIPOS_DE_CONTA.filter((t) => !tiposPermitidos || tiposPermitidos.includes(t.valor));
  const [nome, setNome] = useState(nomeSugerido);
  const [tipo, setTipo] = useState<AccountType>(
    tipos.some((t) => t.valor === tipoSugerido) ? tipoSugerido : tipos[0]?.valor ?? "checking"
  );
  const [fechamento, setFechamento] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [salvando, setSalvando] = useState(false);

  const ehCartao = tipo === "credit_card";
  const repetida = nome.trim() ? contasExistentes.find((c) => mesmoNome(c.name, nome)) : undefined;

  const salvar = async () => {
    if (!nome.trim()) {
      toast.error("Dê um nome para a conta");
      return;
    }
    // Sem fechamento e vencimento o cartao nao sabe em que fatura cada compra
    // cai, e a fatura importada ficaria sem mes.
    if (ehCartao && (!diaValido(fechamento) || !diaValido(vencimento))) {
      toast.error("Informe os dias de fechamento e de vencimento do cartão (1 a 31)");
      return;
    }

    setSalvando(true);
    try {
      const r = await fetch("/api/financial-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nome.trim(),
          account_type: tipo,
          ...(ehCartao ? { closing_day: Number(fechamento), due_day: Number(vencimento) } : {}),
        }),
      });
      const dados = await r.json().catch(() => ({}));
      if (!r.ok || !dados.account) {
        toast.error(dados.error ?? "Não foi possível criar a conta");
        return;
      }
      toast.success(ehCartao ? `Cartão "${dados.account.name}" criado` : `Conta "${dados.account.name}" criada`);
      onCriada(dados.account as FinancialAccount);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border bg-muted/40 p-3">
      <p className="text-sm font-medium">Nova conta ou cartão</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="nova-conta-nome" className="text-xs">Nome</Label>
          <Input id="nova-conta-nome" value={nome} onChange={(e) => setNome(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tipo</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as AccountType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tipos.map((t) => (
                <SelectItem key={t.valor} value={t.valor}>
                  {t.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {ehCartao && (
          <>
            <div className="space-y-1">
              <Label htmlFor="nova-conta-fechamento" className="text-xs">Dia do fechamento</Label>
              <Input
                id="nova-conta-fechamento"
                inputMode="numeric"
                value={fechamento}
                onChange={(e) => setFechamento(e.target.value.replace(/\D/g, "").slice(0, 2))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nova-conta-vencimento" className="text-xs">Dia do vencimento</Label>
              <Input
                id="nova-conta-vencimento"
                inputMode="numeric"
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value.replace(/\D/g, "").slice(0, 2))}
              />
            </div>
          </>
        )}
      </div>
      {repetida && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warning/30 bg-warning/10 p-2 text-sm">
          <span>
            Você já tem uma conta chamada <strong>{repetida.name}</strong>. Mude o nome para criar outra
            {onUsarExistente ? ", ou use a que já existe." : "."}
          </span>
          {onUsarExistente && (
            <Button size="sm" variant="secondary" onClick={() => onUsarExistente(repetida)}>
              Usar esta
            </Button>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button size="sm" disabled={salvando || Boolean(repetida)} onClick={salvar}>
          {salvando && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
          Criar
        </Button>
        <Button size="sm" variant="ghost" disabled={salvando} onClick={onCancelar}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
