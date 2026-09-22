"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useFinancialData, useTransactions } from "@/lib/hooks/useFinancial";
import type { NewTransactionForm } from "@/types/financial";

interface SimpleTransactionFormProps {
  onSuccess?: () => void;
}

export function SimpleTransactionForm({
  onSuccess,
}: SimpleTransactionFormProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { categories, accounts, loading: loadingData } = useFinancialData();
  const { createTransaction } = useTransactions();

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
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !formData.description ||
      !formData.category_id ||
      formData.amount <= 0
    ) {
      toast.error("Preencha todos os campos obrigatórios");
      return;
    }

    try {
      setIsSubmitting(true);

      const result = await createTransaction(formData);

      if (result.success) {
        toast.success(
          formData.is_installment && result.installments
            ? `Parcelamento criado com sucesso! ${result.installments.length} parcelas geradas.`
            : "Transação criada com sucesso!"
        );

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
        });

        setIsOpen(false);
        onSuccess?.();
      }
    } catch (error: any) {
      toast.error(error.message || "Erro ao criar transação");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtrar categorias baseado no tipo de transação
  const filteredCategories = categories.filter((category) => {
    if (formData.transaction_type === "expense") return category.is_expense;
    if (formData.transaction_type === "income") return !category.is_expense;
    return true;
  });

  if (!isOpen) {
    return (
      <Button onClick={() => setIsOpen(true)} size="lg">
        <Plus className="h-5 w-5 mr-2" />
        Novo Lançamento
      </Button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
      <div className="bg-card rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b">
          <h2 className="text-xl font-semibold">Novo Lançamento</h2>
          <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Descrição */}
          <div>
            <Label htmlFor="description">Descrição *</Label>
            <Input
              id="description"
              value={formData.description}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  description: e.target.value,
                }))
              }
              placeholder="Ex: Almoço no restaurante"
              required
            />
          </div>

          {/* Valor e Data */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="amount">Valor *</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                value={formData.amount}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    amount: Number(e.target.value),
                  }))
                }
                placeholder="0,00"
                required
              />
            </div>

            <div>
              <Label htmlFor="date">Data *</Label>
              <Input
                id="date"
                type="date"
                value={formData.transaction_date}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    transaction_date: e.target.value,
                  }))
                }
                required
              />
            </div>
          </div>

          {/* Tipo de Transação */}
          <div>
            <Label>Tipo de Transação *</Label>
            <Select
              value={formData.transaction_type}
              onValueChange={(value: any) =>
                setFormData((prev) => ({ ...prev, transaction_type: value }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="expense">💸 Despesa</SelectItem>
                <SelectItem value="income">💰 Receita</SelectItem>
                <SelectItem value="transfer">🔄 Transferência</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Categoria */}
          <div>
            <Label>Categoria *</Label>
            <Select
              value={formData.category_id}
              onValueChange={(value) =>
                setFormData((prev) => ({ ...prev, category_id: value }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma categoria" />
              </SelectTrigger>
              <SelectContent>
                {filteredCategories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: category.color_hex }}
                      />
                      {category.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Conta */}
          <div>
            <Label>Conta</Label>
            <Select
              value={formData.account_id || "none"}
              onValueChange={(value) =>
                setFormData((prev) => ({
                  ...prev,
                  account_id: value === "none" ? null : value,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione uma conta (opcional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhuma conta</SelectItem>
                {accounts.map((account) => (
                  <SelectItem key={account.id} value={account.id}>
                    {account.name} ({account.account_type})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Parcelamento */}
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="is_installment"
              checked={formData.is_installment}
              onChange={(e) =>
                setFormData((prev) => ({
                  ...prev,
                  is_installment: e.target.checked,
                }))
              }
            />
            <Label htmlFor="is_installment">Parcelamento</Label>
          </div>

          {formData.is_installment && (
            <div>
              <Label htmlFor="installment_count">Número de Parcelas</Label>
              <Input
                id="installment_count"
                type="number"
                min="2"
                max="48"
                value={formData.installment_count}
                onChange={(e) =>
                  setFormData((prev) => ({
                    ...prev,
                    installment_count: Number(e.target.value),
                  }))
                }
              />
            </div>
          )}

          {/* Observações */}
          <div>
            <Label htmlFor="notes">Observações</Label>
            <Textarea
              id="notes"
              value={formData.notes}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, notes: e.target.value }))
              }
              placeholder="Informações adicionais..."
            />
          </div>

          {/* Botões */}
          <div className="flex justify-end space-x-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting || loadingData}>
              {isSubmitting ? "Criando..." : "Criar Lançamento"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
