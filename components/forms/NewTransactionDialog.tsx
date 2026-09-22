"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FormField } from "@/components/ui/form";

import { useFinancialData, useTransactions } from "@/lib/hooks/useFinancial";
import type { NewTransactionForm } from "@/types/financial";

interface NewTransactionDialogProps {
  trigger?: React.ReactNode;
  onSuccess?: () => void;
}

// Hook para buscar grupos do usuário
const useUserGroups = () => {
  const [groups, setGroups] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/expense-groups")
      .then((res) => res.json())
      .then((data) => {
        setGroups(data.groups || []);
        setLoading(false);
      })
      .catch(() => {
        setGroups([]);
        setLoading(false);
      });
  }, []);

  return { groups, loading };
};

export function NewTransactionDialog({
  trigger,
  onSuccess,
}: NewTransactionDialogProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { categories, accounts, loading: loadingData } = useFinancialData();
  const { createTransaction } = useTransactions();
  const { groups, loading: loadingGroups } = useUserGroups();

  const [formData, setFormData] = useState<NewTransactionForm>({
    description: "",
    amount: 0,
    transaction_date: new Date().toISOString().split("T")[0],
    category_id: "",
    account_id: null,
    transaction_type: "expense",
    notes: "",
    is_shared: false,
    is_installment: false,
    installment_count: 2,
    group_id: undefined,
  });

  // Filtrar categorias baseado no tipo de transação
  const filteredCategories = categories.filter((category) => {
    if (formData.transaction_type === "expense") return category.is_expense;
    if (formData.transaction_type === "income") return !category.is_expense;
    return true; // Para transfer, mostrar todas
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.description.trim()) {
      toast.error("Descrição é obrigatória");
      return;
    }

    if (formData.amount <= 0) {
      toast.error("Valor deve ser maior que zero");
      return;
    }

    if (!formData.category_id) {
      toast.error("Categoria é obrigatória");
      return;
    }

    try {
      setIsSubmitting(true);

      console.log("📤 ENVIANDO DADOS PARA createTransaction:", formData);
      console.log("🎯 Group ID no momento do envio:", formData.group_id);
      console.log("📋 Campos completos:", Object.keys(formData));

      const result = await createTransaction(formData);

      if (result.success) {
        toast.success("Transação criada com sucesso!");
        // Reset form
        setFormData({
          description: "",
          amount: 0,
          transaction_date: new Date().toISOString().split("T")[0],
          category_id: "",
          account_id: null,
          transaction_type: "expense",
          notes: "",
          is_shared: false,
          is_installment: false,
          installment_count: 2,
          group_id: undefined,
        });
        setOpen(false);
        onSuccess?.();
      } else {
        toast.error(result.error || "Erro ao criar transação");
      }
    } catch (error) {
      console.error("Erro ao criar transação:", error);
      toast.error("Erro inesperado ao criar transação");
    } finally {
      setIsSubmitting(false);
    }
  };

  const updateField = (field: keyof NewTransactionForm, value: any) => {
    console.log(`🔄 Atualizando campo ${field}:`, value);
    setFormData((prev) => {
      const newData = { ...prev, [field]: value };
      console.log("📝 Novo estado formData:", newData);
      return newData;
    });
  };

  // Monitorar mudanças no dialog
  useEffect(() => {
    console.log("📂 Dialog estado mudou para:", open);
    console.log("📝 FormData atual:", formData);
  }, [open, formData.group_id]);

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        console.log("🔄 Dialog mudando para:", isOpen);
        setOpen(isOpen);
      }}
    >
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <PlusIcon className="mr-2 h-4 w-4" />
            Nova Transação
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova Transação</DialogTitle>
          <DialogDescription>
            Adicione uma nova transação financeira
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Tipo da Transação */}
          <FormField>
            <Label htmlFor="transaction_type">Tipo de Transação</Label>
            <Select
              value={formData.transaction_type}
              onValueChange={(value) => updateField("transaction_type", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione o tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">Despesa</SelectItem>
                <SelectItem value="income">Receita</SelectItem>
                <SelectItem value="transfer">Transferência</SelectItem>
              </SelectContent>
            </Select>
          </FormField>

          {/* Descrição */}
          <FormField>
            <Label htmlFor="description">Descrição</Label>
            <Input
              id="description"
              placeholder="Ex: Almoço no restaurante"
              value={formData.description}
              onChange={(e) => updateField("description", e.target.value)}
            />
          </FormField>

          {/* Valor */}
          <FormField>
            <Label htmlFor="amount">Valor (R$)</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              placeholder="0,00"
              value={formData.amount || ""}
              onChange={(e) =>
                updateField("amount", parseFloat(e.target.value) || 0)
              }
            />
          </FormField>

          {/* Data */}
          <FormField>
            <Label htmlFor="transaction_date">Data</Label>
            <Input
              id="transaction_date"
              type="date"
              value={formData.transaction_date}
              onChange={(e) => updateField("transaction_date", e.target.value)}
            />
          </FormField>

          {/* Categoria */}
          <FormField>
            <Label htmlFor="category_id">Categoria</Label>
            <Select
              value={formData.category_id}
              onValueChange={(value) => updateField("category_id", value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma categoria" />
              </SelectTrigger>
              <SelectContent>
                {filteredCategories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          {/* Conta */}
          <FormField>
            <Label htmlFor="account_id">Conta</Label>
            <Select
              value={formData.account_id || ""}
              onValueChange={(value) =>
                updateField("account_id", value || null)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma conta" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Nenhuma conta</SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          {/* Grupo (novo campo) */}
          <FormField>
            <Label htmlFor="group_id">
              Grupo de Despesa (opcional)
              {loadingGroups && " (carregando...)"}
              {!loadingGroups && ` (${groups.length} disponíveis)`}
            </Label>
            <Select
              value={formData.group_id || ""}
              onValueChange={(value) => {
                console.log("🔄 Mudando grupo para:", value);
                console.log(
                  "📋 Grupos disponíveis:",
                  groups.map((g) => ({ id: g.id, name: g.name }))
                );
                updateField("group_id", value === "" ? undefined : value);
              }}
              disabled={loadingGroups}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um grupo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Sem grupo</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {formData.group_id && (
              <div className="text-sm text-success mt-1">
                ✅ Grupo selecionado:{" "}
                {groups.find((g) => g.id === formData.group_id)?.name ||
                  formData.group_id}
              </div>
            )}
            <div className="text-xs text-muted-foreground mt-1 p-2 bg-muted rounded">
              🔍 DEBUG: group_id = "{formData.group_id || "undefined"}"
            </div>
          </FormField>

          {/* Parcelamento */}
          <div className="space-y-4">
            <div className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label className="text-base">Transação Parcelada</Label>
                <Label className="text-sm text-muted-foreground">
                  Dividir em várias parcelas
                </Label>
              </div>
              <Switch
                checked={formData.is_installment}
                onCheckedChange={(checked) =>
                  updateField("is_installment", checked)
                }
              />
            </div>

            {formData.is_installment && (
              <FormField>
                <Label htmlFor="installment_count">Número de Parcelas</Label>
                <Input
                  id="installment_count"
                  type="number"
                  min="2"
                  max="60"
                  value={formData.installment_count || ""}
                  onChange={(e) =>
                    updateField(
                      "installment_count",
                      parseInt(e.target.value) || 2
                    )
                  }
                />
              </FormField>
            )}
          </div>

          {/* Notas */}
          <FormField>
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Textarea
              id="notes"
              placeholder="Observações adicionais..."
              value={formData.notes || ""}
              onChange={(e) => updateField("notes", e.target.value)}
            />
          </FormField>

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || loadingData || loadingGroups}
            >
              {isSubmitting ? "Criando..." : "Criar Transação"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
