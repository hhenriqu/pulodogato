"use client";

// Contas e cartoes.
//
// O app inteiro ja dependia de `financial_accounts` -- lancamento, orcamento,
// fatura, extrato e meta pedem uma conta --, mas nao havia tela para cadastrar
// nenhuma. Quem abria o app recebia as contas padrao criadas pelo
// `create_default_accounts` no primeiro GET e nunca conseguia trocar o nome do
// banco, dizer os quatro digitos do cartao ou informar fechamento e vencimento.
//
// Sem fechamento e vencimento o `card_invoice_month()` (migration 006) trata
// toda compra como da fatura do proprio mes: a fatura nao fecha e a compra de
// dia 28 aparece no mes errado. Por isso o formulario cobra os dois dias quando
// o tipo e cartao de credito.
//
// ESTA TELA ABRE SEM REDE (HMO-145). Ate aqui ela nao entrava no precache por
// um motivo especifico: offline a busca falhava, a lista ficava vazia, e o
// `useMemo` dos totais somava lista vazia. O resultado era
//
//     Saldo somado das contas  R$ 0,00
//     Faturas em aberto        R$ 0,00
//     Voce ainda nao tem contas / Cadastre sua conta corrente...
//
// para quem tem seis contas cadastradas. Nada disso e erro de calculo -- e o
// app afirmando sobre o dinheiro da pessoa uma coisa que ele nao tem como
// saber. Agora cada numero passa por `podeMostrarNumero()`, e a frase de
// estado vazio exige `podeAfirmarVazio()`: ver `lib/offline-leitura.ts`.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Archive,
  ArchiveRestore,
  CreditCard,
  Landmark,
  Loader2,
  Pencil,
  PiggyBank,
  Plus,
  Smartphone,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type { FinancialAccount, AccountType } from "@/types/financial";
import {
  buscarLeitura,
  podeAfirmarVazio,
  podeMostrarNumero,
  type EstadoDaLeitura,
} from "@/lib/offline-leitura";
import {
  FaixaDadoDoAparelho,
  NumeroIndisponivel,
  PainelErroDoServidor,
  PainelSemRede,
} from "@/components/SemRede";
import { useEstaOnline } from "@/lib/hooks/useEstaOnline";

const TIPOS: Array<{
  valor: AccountType;
  rotulo: string;
  icone: typeof Wallet;
  /** Tipos em que a fatura existe: so eles pedem fechamento/vencimento. */
  fatura?: boolean;
}> = [
  { valor: "checking", rotulo: "Conta corrente", icone: Landmark },
  { valor: "savings", rotulo: "Poupança", icone: PiggyBank },
  { valor: "credit_card", rotulo: "Cartão de crédito", icone: CreditCard, fatura: true },
  { valor: "debit_card", rotulo: "Cartão de débito", icone: CreditCard },
  { valor: "cash", rotulo: "Dinheiro", icone: Wallet },
  { valor: "digital", rotulo: "Carteira digital", icone: Smartphone },
  { valor: "investment", rotulo: "Investimento", icone: TrendingUp },
  { valor: "other", rotulo: "Outra", icone: Wallet },
];

const porTipo = (tipo: AccountType) =>
  TIPOS.find((t) => t.valor === tipo) ?? TIPOS[TIPOS.length - 1];

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor);

type Formulario = {
  id?: string;
  name: string;
  account_type: AccountType;
  bank_name: string;
  last_four_digits: string;
  credit_limit: string;
  closing_day: string;
  due_day: string;
};

const VAZIO: Formulario = {
  name: "",
  account_type: "checking",
  bank_name: "",
  last_four_digits: "",
  credit_limit: "",
  closing_day: "",
  due_day: "",
};

export default function AccountsPage() {
  const [contas, setContas] = useState<FinancialAccount[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Formulario>(VAZIO);
  // De onde veio o que esta na tela. `null` = ainda nao carregou -- e mesmo
  // nesse caso nenhum total pode aparecer como R$ 0,00.
  const [estado, setEstado] = useState<EstadoDaLeitura | null>(null);
  const [guardadoEm, setGuardadoEm] = useState<Date | null>(null);
  const online = useEstaOnline();

  const carregar = useCallback(async () => {
    setCarregando(true);
    // include_inactive: esta e a unica tela que mostra conta arquivada, para
    // poder reativar. O resto do app so enxerga as ativas.
    const leitura = await buscarLeitura<{ accounts?: FinancialAccount[] }>(
      "/api/financial-accounts?include_inactive=1"
    );

    setEstado(leitura.estado);
    setGuardadoEm(leitura.guardadoEm);

    // So sobrescreve a lista quando houve resposta com corpo. Zerar aqui no
    // caminho de falha apagaria da tela o que uma busca anterior ja tinha
    // trazido -- e a pessoa veria as contas sumirem ao perder o sinal.
    if (leitura.dados) setContas(leitura.dados.accounts ?? []);

    // O aviso de erro agora e o painel no corpo da tela, que fica. O toast
    // desaparece em cinco segundos e deixava para tras justamente a tela de
    // zeros que ele tentava explicar.
    setCarregando(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const ativas = useMemo(() => contas.filter((c) => c.is_active), [contas]);
  const arquivadas = useMemo(() => contas.filter((c) => !c.is_active), [contas]);

  // Cartao de credito guarda o que foi GASTO, nao o que se tem. Somar o saldo
  // dele junto com o da conta corrente daria um "total" que nao e dinheiro
  // nenhum -- por isso o cartao fica de fora e aparece como fatura.
  const totais = useMemo(() => {
    let saldo = 0;
    let fatura = 0;
    for (const conta of ativas) {
      const valor = Number(conta.current_balance ?? 0);
      if (conta.account_type === "credit_card") fatura += Math.abs(valor);
      else saldo += valor;
    }
    return { saldo, fatura };
  }, [ativas]);

  const ehCartao = porTipo(form.account_type).fatura === true;

  function abrirNovo() {
    setForm(VAZIO);
    setAberto(true);
  }

  function abrirEdicao(conta: FinancialAccount) {
    setForm({
      id: conta.id,
      name: conta.name,
      account_type: conta.account_type,
      bank_name: conta.bank_name ?? "",
      last_four_digits: conta.last_four_digits ?? "",
      credit_limit: conta.credit_limit != null ? String(conta.credit_limit) : "",
      closing_day: conta.closing_day != null ? String(conta.closing_day) : "",
      due_day: conta.due_day != null ? String(conta.due_day) : "",
    });
    setAberto(true);
  }

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();

    if (!form.name.trim()) {
      toast.error("Dê um nome para a conta");
      return;
    }

    // O banco tem CHECK de 1 a 31 nos dois dias. Barrar aqui evita um 500 com
    // codigo 23514 que nao diz nada para quem esta preenchendo.
    for (const [rotulo, valor] of [
      ["fechamento", form.closing_day],
      ["vencimento", form.due_day],
    ] as const) {
      if (!valor) continue;
      const dia = Number(valor);
      if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
        toast.error(`O dia de ${rotulo} deve estar entre 1 e 31`);
        return;
      }
    }

    setSalvando(true);
    try {
      const corpo = {
        name: form.name.trim(),
        account_type: form.account_type,
        bank_name: form.bank_name.trim(),
        last_four_digits: form.last_four_digits.trim(),
        credit_limit: form.credit_limit || null,
        // Dia de fatura so faz sentido em cartao. Mandar o que ficou digitado
        // depois de trocar o tipo gravaria fechamento numa conta corrente.
        closing_day: ehCartao ? form.closing_day || null : null,
        due_day: ehCartao ? form.due_day || null : null,
      };

      const resposta = await fetch(
        form.id ? `/api/financial-accounts/${form.id}` : "/api/financial-accounts",
        {
          method: form.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corpo),
        }
      );

      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.error ?? "falha ao salvar");

      toast.success(form.id ? "Conta atualizada" : "Conta criada");
      setAberto(false);
      setForm(VAZIO);
      await carregar();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Erro ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  async function arquivar(conta: FinancialAccount) {
    try {
      const resposta = await fetch(`/api/financial-accounts/${conta.id}`, {
        method: "DELETE",
      });
      if (!resposta.ok) throw new Error("falha ao arquivar");
      toast.success(`${conta.name} foi arquivada`);
      await carregar();
    } catch {
      toast.error("Não foi possível arquivar a conta");
    }
  }

  async function reativar(conta: FinancialAccount) {
    try {
      const resposta = await fetch(`/api/financial-accounts/${conta.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: true }),
      });
      if (!resposta.ok) throw new Error("falha ao reativar");
      toast.success(`${conta.name} voltou para a lista`);
      await carregar();
    } catch {
      toast.error("Não foi possível reativar a conta");
    }
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-info" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Contas e Cartões</h1>
          <p className="text-sm text-muted-foreground">
            Onde seu dinheiro entra, fica e sai.
          </p>
        </div>
        {/*
          Sem rede o envio falharia no fim. Deixar a pessoa preencher nome,
          banco, limite, fechamento e vencimento para perder tudo no botao
          Salvar e pior do que dizer antes que agora nao da.
        */}
        <Button onClick={abrirNovo} disabled={!online}>
          <Plus className="mr-2 h-4 w-4" />
          {online ? "Nova conta" : "Nova conta (precisa de rede)"}
        </Button>
      </div>

      {estado === "do-aparelho" && (
        <FaixaDadoDoAparelho
          guardadoEm={guardadoEm}
          soLeitura
          aoTentarDeNovo={carregar}
        />
      )}

      {/*
        Sem dado, o painel SUBSTITUI os totais e a lista -- nao acompanha. Um
        "R$ 0,00" ao lado de um aviso de sem conexao continua sendo um numero
        na tela, e numero na tela e lido.
      */}
      {estado === "sem-rede" ? (
        <PainelSemRede
          oQue="suas contas"
          aoTentarDeNovo={carregar}
        />
      ) : estado === "erro-do-servidor" ? (
        <PainelErroDoServidor oQue="suas contas" aoTentarDeNovo={carregar} />
      ) : (
        <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Saldo somado das contas</CardDescription>
            <CardTitle
              className={`text-2xl ${
                podeMostrarNumero(estado) && totais.saldo < 0
                  ? "text-destructive"
                  : ""
              }`}
            >
              {podeMostrarNumero(estado) ? (
                moeda(totais.saldo)
              ) : (
                <NumeroIndisponivel />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Cartão de crédito fica de fora: ele guarda o que foi gasto, não o
              que você tem.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Faturas em aberto</CardDescription>
            <CardTitle className="text-2xl text-warning">
              {podeMostrarNumero(estado) ? (
                moeda(totais.fatura)
              ) : (
                <NumeroIndisponivel />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Soma do que já foi gasto nos cartões ativos.
            </p>
          </CardContent>
        </Card>
      </div>

      {ativas.length === 0 && podeAfirmarVazio(estado) ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Wallet className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium text-foreground">
              Você ainda não tem contas
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              Cadastre sua conta corrente e seus cartões para começar a lançar.
            </p>
            <Button onClick={abrirNovo}>
              <Plus className="mr-2 h-4 w-4" />
              Cadastrar a primeira
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ativas.map((conta) => {
            const tipo = porTipo(conta.account_type);
            const Icone = tipo.icone;
            const cartao = conta.account_type === "credit_card";
            const faltaFatura = cartao && (!conta.closing_day || !conta.due_day);

            return (
              <Card key={conta.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="flex h-9 w-9 items-center justify-center rounded-md"
                        style={{ backgroundColor: `${conta.color_hex}20` }}
                      >
                        <Icone
                          className="h-4 w-4"
                          style={{ color: conta.color_hex }}
                        />
                      </span>
                      <div>
                        <CardTitle className="text-base">{conta.name}</CardTitle>
                        <CardDescription className="text-xs">
                          {tipo.rotulo}
                          {conta.bank_name ? ` · ${conta.bank_name}` : ""}
                          {conta.last_four_digits
                            ? ` · ••${conta.last_four_digits}`
                            : ""}
                        </CardDescription>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {cartao ? "Fatura atual" : "Saldo"}
                    </p>
                    <p
                      className={`text-lg font-semibold ${
                        !cartao && Number(conta.current_balance) < 0
                          ? "text-destructive"
                          : ""
                      }`}
                    >
                      {moeda(
                        cartao
                          ? Math.abs(Number(conta.current_balance ?? 0))
                          : Number(conta.current_balance ?? 0)
                      )}
                    </p>
                  </div>

                  {cartao && conta.credit_limit != null && (
                    <p className="text-xs text-muted-foreground">
                      Limite {moeda(Number(conta.credit_limit))}
                    </p>
                  )}

                  {cartao &&
                    (faltaFatura ? (
                      <Badge
                        variant="outline"
                        className="border-warning/30 text-warning"
                      >
                        Falta fechamento e vencimento
                      </Badge>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Fecha dia {conta.closing_day} · vence dia {conta.due_day}
                      </p>
                    ))}

                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => abrirEdicao(conta)}
                    >
                      <Pencil className="mr-1 h-3 w-3" />
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => arquivar(conta)}
                    >
                      <Archive className="mr-1 h-3 w-3" />
                      Arquivar
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {arquivadas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Archive className="h-4 w-4 text-muted-foreground" />
              Arquivadas
              <span className="text-sm font-normal text-muted-foreground">
                ({arquivadas.length})
              </span>
            </CardTitle>
            <CardDescription>
              Some da lista e dos seletores, mas o histórico de lançamentos
              continua inteiro.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {arquivadas.map((conta) => (
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
                  onClick={() => reativar(conta)}
                >
                  <ArchiveRestore className="mr-1 h-3 w-3" />
                  Reativar
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
        </>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Editar conta" : "Nova conta"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={salvar} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Conta do Itaú, Nubank, carteira..."
              />
            </div>

            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select
                value={form.account_type}
                onValueChange={(valor) =>
                  setForm({ ...form, account_type: valor as AccountType })
                }
                // O tipo decide como o saldo e lido em todo o app (cartao entra
                // como fatura, conta entra como saldo). Trocar depois de ter
                // lancamento reinterpretaria o historico inteiro.
                disabled={Boolean(form.id)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS.map((tipo) => (
                    <SelectItem key={tipo.valor} value={tipo.valor}>
                      {tipo.rotulo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.id && (
                <p className="text-xs text-muted-foreground">
                  O tipo não muda depois de criada: ele decide como os
                  lançamentos já feitos são lidos.
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bank">Banco</Label>
                <Input
                  id="bank"
                  value={form.bank_name}
                  onChange={(e) =>
                    setForm({ ...form, bank_name: e.target.value })
                  }
                  placeholder="Opcional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="digits">Últimos 4 dígitos</Label>
                <Input
                  id="digits"
                  inputMode="numeric"
                  maxLength={4}
                  value={form.last_four_digits}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      last_four_digits: e.target.value.replace(/\D/g, ""),
                    })
                  }
                  placeholder="Opcional"
                />
              </div>
            </div>

            {ehCartao && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="limit">Limite</Label>
                  <Input
                    id="limit"
                    inputMode="decimal"
                    value={form.credit_limit}
                    onChange={(e) =>
                      setForm({ ...form, credit_limit: e.target.value })
                    }
                    placeholder="Opcional"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="closing">Dia do fechamento</Label>
                    <Input
                      id="closing"
                      inputMode="numeric"
                      value={form.closing_day}
                      onChange={(e) =>
                        setForm({ ...form, closing_day: e.target.value })
                      }
                      placeholder="1 a 31"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="due">Dia do vencimento</Label>
                    <Input
                      id="due"
                      inputMode="numeric"
                      value={form.due_day}
                      onChange={(e) =>
                        setForm({ ...form, due_day: e.target.value })
                      }
                      placeholder="1 a 31"
                    />
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Sem esses dois dias a fatura não fecha, e uma compra feita
                  depois do fechamento aparece no mês errado.
                </p>
              </>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAberto(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando}>
                {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {form.id ? "Salvar" : "Criar conta"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
