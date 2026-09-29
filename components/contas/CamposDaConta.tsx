"use client";

// ---------------------------------------------------------------------------
// OS CAMPOS DE UMA CONTA, OU DE UM CARTAO (HMO-166)
// ---------------------------------------------------------------------------
// Componente sem banco e sem hook de dados: recebe os valores, devolve as
// mudancas, e decide o que mostrar chamando `camposDoEscopo`. E o que permite o
// teste renderizar os campos de verdade com `react-dom/server` e afirmar sobre
// a arvore que sai -- porque o defeito que esta tela corrige era JSX, e nao
// calculo. Uma funcao pura `mostraLimite(tipo)` passaria verde com os dois
// formularios sobrepostos intactos, do jeito que estavam.
//
// A queixa era esta, literal: quem abria para cadastrar uma conta corrente via
// limite, dia de fechamento e dia de vencimento aparecerem e sumirem conforme
// trocava o tipo no seletor. Agora a tela de Contas nao tem esses tres campos
// em estado nenhum -- nao ha `if` que os traga de volta, porque eles nao estao
// no arquivo do escopo errado, estao atras de `campos.fatura`.
// ---------------------------------------------------------------------------

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CampoDeValor } from "@/components/ui/campo-de-valor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  camposDoEscopo,
  tiposDoEscopo,
  type EscopoDeConta,
  type ValoresDaConta,
} from "@/lib/contas";
import type { AccountType } from "@/types/financial";

interface CamposDaContaProps {
  escopo: EscopoDeConta;
  valores: ValoresDaConta;
  aoMudar: (valores: ValoresDaConta) => void;
  /** Edicao de algo que ja existe: o tipo nao muda mais. */
  editando: boolean;
}

export function CamposDaConta({
  escopo,
  valores,
  aoMudar,
  editando,
}: CamposDaContaProps) {
  const campos = camposDoEscopo(escopo);
  const mudar = (parcial: Partial<ValoresDaConta>) =>
    aoMudar({ ...valores, ...parcial });

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="name">Nome</Label>
        <Input
          id="name"
          value={valores.name}
          onChange={(e) => mudar({ name: e.target.value })}
          placeholder={
            escopo === "cartao"
              ? "Nubank, Visa Infinite, cartão da loja..."
              : "Conta do Itaú, poupança, carteira..."
          }
        />
      </div>

      {/*
        Em Cartoes ha um tipo so, entao nao existe escolha a oferecer: o seletor
        seria um menu de um item. O `account_type` continua sendo gravado -- ele
        vem de `tipoPadraoDoEscopo` nos valores iniciais.
      */}
      {campos.tipo && (
        <div className="space-y-2">
          <Label>Tipo</Label>
          <Select
            value={valores.account_type}
            onValueChange={(valor) =>
              mudar({ account_type: valor as AccountType })
            }
            // O tipo decide como o saldo e lido em todo o app. Trocar depois de
            // ter lancamento reinterpretaria o historico inteiro.
            disabled={editando}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tiposDoEscopo(escopo).map((tipo) => (
                <SelectItem key={tipo.valor} value={tipo.valor}>
                  {tipo.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {editando && (
            <p className="text-xs text-muted-foreground">
              O tipo não muda depois de criada: ele decide como os lançamentos
              já feitos são lidos.
            </p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="bank">Banco</Label>
          <Input
            id="bank"
            value={valores.bank_name}
            onChange={(e) => mudar({ bank_name: e.target.value })}
            placeholder="Opcional"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="digits">Últimos 4 dígitos</Label>
          <Input
            id="digits"
            inputMode="numeric"
            maxLength={4}
            value={valores.last_four_digits}
            onChange={(e) =>
              mudar({ last_four_digits: e.target.value.replace(/\D/g, "") })
            }
            placeholder="Opcional"
          />
        </div>
      </div>

      {campos.fatura && (
        <>
          <div className="space-y-2">
            <Label htmlFor="limit">Limite</Label>
            {/*
              Campo de dinheiro, entao passa pelo CampoDeValor (HMO-171): o
              input cru aceitava "1.000,00", e `parseFloat` disso e 1. Um limite
              de mil reais gravado como um real nao derruba nada -- so faz o
              cartao parecer estourado desde a primeira compra.
            */}
            <CampoDeValor
              id="limit"
              value={valores.credit_limit}
              onChange={(valorPlano) => mudar({ credit_limit: valorPlano })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="closing">Dia do fechamento</Label>
              <Input
                id="closing"
                inputMode="numeric"
                value={valores.closing_day}
                onChange={(e) => mudar({ closing_day: e.target.value })}
                placeholder="1 a 31"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="due">Dia do vencimento</Label>
              <Input
                id="due"
                inputMode="numeric"
                value={valores.due_day}
                onChange={(e) => mudar({ due_day: e.target.value })}
                placeholder="1 a 31"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Sem esses dois dias a fatura não fecha, e uma compra feita depois do
            fechamento aparece no mês errado.
          </p>
        </>
      )}
    </>
  );
}
