"use client";

// Contas previstas e gastos fixos.
//
// A tela responde, em ordem: o que esta vencido, o que vence agora, quanto
// ainda sai este mes. E so depois disso oferece o cadastro -- quem abre esta
// tela quer saber se esqueceu de pagar algo, nao cadastrar.

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
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  AlertCircle,
  CalendarClock,
  Check,
  Loader2,
  Paperclip,
  Plus,
  Repeat,
  SkipForward,
  Wallet,
} from "lucide-react";
import { Receipts } from "@/components/Receipts";
import type {
  RecurringRule,
  ScheduledTransaction,
  TransactionCategory,
  FinancialAccount,
  RecurrenceFrequency,
} from "@/types/financial";

const FREQUENCIAS: Array<{ valor: RecurrenceFrequency; rotulo: string }> = [
  { valor: "weekly", rotulo: "Semanal" },
  { valor: "biweekly", rotulo: "Quinzenal" },
  { valor: "monthly", rotulo: "Mensal" },
  { valor: "bimonthly", rotulo: "Bimestral" },
  { valor: "quarterly", rotulo: "Trimestral" },
  { valor: "semiannual", rotulo: "Semestral" },
  { valor: "annual", rotulo: "Anual" },
];

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);

// 'YYYY-MM-DD' formatado sem passar por new Date(): a string ISO e lida como
// UTC e, no Brasil, voltaria um dia no fuso local.
const dataCurta = (iso: string) => {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano.slice(2)}`;
};

interface FormGastoFixo {
  description: string;
  amount: string;
  category_id: string;
  account_id: string;
  frequency: RecurrenceFrequency;
  due_day: string;
  // O aluguel dividido com a esposa, a internet da casa. As tabelas do 005 ja
  // tinham group_id e a API ja aceitava; faltava a tela -- sem ela o gasto fixo
  // compartilhado nascia sempre pessoal e os outros membros nunca o viam.
  group_id: string;
}

interface FormContaAvulsa {
  description: string;
  amount: string;
  category_id: string;
  account_id: string;
  due_date: string;
}

const HOJE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

export default function BillsPage() {
  const [scheduled, setScheduled] = useState<ScheduledTransaction[]>([]);
  const [rules, setRules] = useState<RecurringRule[]>([]);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  // Grupos de despesa (casa, viagem) -- nao confundir com `grupos` mais
  // abaixo, que agrupa as contas por vencimento.
  const [gruposDespesa, setGruposDespesa] = useState<{ id: string; name: string }[]>([]);
  const [custoFixo, setCustoFixo] = useState(0);
  const [loading, setLoading] = useState(true);
  const [agindo, setAgindo] = useState<string | null>(null);
  const [dialogFixo, setDialogFixo] = useState(false);
  const [dialogAvulsa, setDialogAvulsa] = useState(false);

  const [formFixo, setFormFixo] = useState<FormGastoFixo>({
    description: "",
    amount: "",
    category_id: "",
    account_id: "",
    frequency: "monthly",
    due_day: "5",
    group_id: "",
  });

  const [formAvulsa, setFormAvulsa] = useState<FormContaAvulsa>({
    description: "",
    amount: "",
    category_id: "",
    account_id: "",
    due_date: HOJE,
  });

  const carregar = useCallback(async () => {
    try {
      const [respAgenda, respRegras, respCategorias, respContas, respResumo, respGrupos] =
        await Promise.all([
        fetch("/api/scheduled-transactions?status=open"),
        fetch("/api/recurring-rules"),
        fetch("/api/personal-finance/categories"),
        fetch("/api/financial-accounts"),
        fetch("/api/scheduled-transactions/summary?months=1"),
        fetch("/api/expense-groups"),
      ]);

      if (respAgenda.ok) {
        const dados = await respAgenda.json();
        setScheduled(dados.scheduled ?? []);
      } else {
        toast.error("Não foi possível carregar as contas previstas");
      }

      if (respRegras.ok) {
        const dados = await respRegras.json();
        setRules(dados.rules ?? []);
      }

      if (respCategorias.ok) {
        const dados = await respCategorias.json();
        setCategories(dados.categories ?? dados ?? []);
      }

      if (respContas.ok) {
        const dados = await respContas.json();
        setAccounts(dados.accounts ?? dados ?? []);
      }

      if (respResumo.ok) {
        const dados = await respResumo.json();
        setCustoFixo(dados.fixed_monthly_cost ?? 0);
      }

      if (respGrupos.ok) {
        const dados = await respGrupos.json();
        setGruposDespesa(dados.groups ?? []);
      }
    } catch (erro) {
      console.error("Erro ao carregar contas previstas:", erro);
      toast.error("Erro ao carregar a página");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const despesas = useMemo(
    () => categories.filter((categoria) => categoria.is_expense),
    [categories]
  );

  const grupos = useMemo(() => {
    const vencidas: ScheduledTransaction[] = [];
    const semana: ScheduledTransaction[] = [];
    const depois: ScheduledTransaction[] = [];

    for (const conta of scheduled) {
      const dias = conta.days_until_due ?? 0;
      if (conta.effective_status === "overdue") vencidas.push(conta);
      else if (dias <= 7) semana.push(conta);
      else depois.push(conta);
    }

    return { vencidas, semana, depois };
  }, [scheduled]);

  const totais = useMemo(() => {
    const soma = (lista: ScheduledTransaction[]) =>
      lista.reduce((total, conta) => total + Number(conta.amount), 0);
    return {
      vencido: soma(grupos.vencidas),
      aberto: soma([...grupos.vencidas, ...grupos.semana, ...grupos.depois]),
    };
  }, [grupos]);

  const darBaixa = async (conta: ScheduledTransaction) => {
    setAgindo(conta.id);
    try {
      const resposta = await fetch(`/api/scheduled-transactions/${conta.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paid_date: HOJE }),
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível dar baixa");
        return;
      }

      toast.success(`${conta.description} paga`);
      await carregar();
    } catch (erro) {
      console.error(erro);
      toast.error("Erro ao dar baixa");
    } finally {
      setAgindo(null);
    }
  };

  const pular = async (conta: ScheduledTransaction) => {
    setAgindo(conta.id);
    try {
      const resposta = await fetch(`/api/scheduled-transactions/${conta.id}`, {
        method: "DELETE",
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível pular");
        return;
      }

      toast.success(dados.message ?? "Conta removida da agenda");
      await carregar();
    } catch (erro) {
      console.error(erro);
      toast.error("Erro ao pular a conta");
    } finally {
      setAgindo(null);
    }
  };

  const criarGastoFixo = async () => {
    if (!formFixo.description.trim() || !formFixo.amount || !formFixo.category_id) {
      toast.error("Preencha descrição, valor e categoria");
      return;
    }

    setAgindo("novo-fixo");
    try {
      const resposta = await fetch("/api/recurring-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: formFixo.description,
          amount: Number(formFixo.amount),
          category_id: formFixo.category_id,
          account_id: formFixo.account_id || undefined,
          frequency: formFixo.frequency,
          due_day: formFixo.due_day ? Number(formFixo.due_day) : undefined,
          group_id: formFixo.group_id || undefined,
        }),
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível criar o gasto fixo");
        return;
      }

      toast.success(
        dados.scheduled_created
          ? `Gasto fixo criado — ${dados.scheduled_created} vencimento(s) na agenda`
          : "Gasto fixo criado"
      );
      setDialogFixo(false);
      setFormFixo({
        description: "",
        amount: "",
        category_id: "",
        account_id: "",
        frequency: "monthly",
        due_day: "5",
        group_id: "",
      });
      await carregar();
    } catch (erro) {
      console.error(erro);
      toast.error("Erro ao criar o gasto fixo");
    } finally {
      setAgindo(null);
    }
  };

  const criarContaAvulsa = async () => {
    if (!formAvulsa.description.trim() || !formAvulsa.amount || !formAvulsa.category_id) {
      toast.error("Preencha descrição, valor e categoria");
      return;
    }

    setAgindo("nova-avulsa");
    try {
      const resposta = await fetch("/api/scheduled-transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: formAvulsa.description,
          amount: Number(formAvulsa.amount),
          category_id: formAvulsa.category_id,
          account_id: formAvulsa.account_id || undefined,
          due_date: formAvulsa.due_date,
        }),
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível criar a conta");
        return;
      }

      toast.success("Conta prevista criada");
      setDialogAvulsa(false);
      setFormAvulsa({
        description: "",
        amount: "",
        category_id: "",
        account_id: "",
        due_date: HOJE,
      });
      await carregar();
    } catch (erro) {
      console.error(erro);
      toast.error("Erro ao criar a conta");
    } finally {
      setAgindo(null);
    }
  };

  const Linha = ({ conta }: { conta: ScheduledTransaction }) => {
    const vencida = conta.effective_status === "overdue";
    const dias = conta.days_until_due ?? 0;
    // O comprovante fica fechado por padrao: a lista existe para responder "o
    // que falta pagar", e um bloco de anexo por conta afogaria essa resposta.
    const [anexosAbertos, setAnexosAbertos] = useState(false);

    return (
      <div className="border-b border-gray-100 py-3 last:border-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className="mt-1 h-8 w-1 rounded"
            style={{ backgroundColor: conta.category?.color_hex ?? "#94a3b8" }}
          />
          <div>
            <p className="font-medium text-gray-900">{conta.description}</p>
            <p className="text-sm text-gray-500">
              {dataCurta(conta.due_date)}
              {conta.category ? ` · ${conta.category.name}` : ""}
              {conta.group ? ` · ${conta.group.name}` : ""}
              {conta.recurring_rule_id ? " · fixo" : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:justify-end">
          <div className="text-right">
            <p className="font-semibold text-gray-900">{moeda(Number(conta.amount))}</p>
            <Badge variant={vencida ? "destructive" : "secondary"} className="mt-1">
              {vencida
                ? `${Math.abs(dias)} dia(s) em atraso`
                : dias === 0
                  ? "vence hoje"
                  : `em ${dias} dia(s)`}
            </Badge>
          </div>

          <div className="flex gap-1">
            <Button
              size="sm"
              onClick={() => darBaixa(conta)}
              disabled={agindo === conta.id}
              title="Marcar como paga"
            >
              {agindo === conta.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => pular(conta)}
              disabled={agindo === conta.id}
              title="Pular este vencimento"
            >
              <SkipForward className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAnexosAbertos((v) => !v)}
              title="Comprovante"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

        {/* O componente so e montado quando abre: cada instancia faz uma
            chamada a API, e montar um por conta da lista dispararia dezenas de
            requisicoes para anexos que ninguem pediu para ver. */}
        {anexosAbertos && (
          <div className="mt-3 rounded-md bg-gray-50 p-3">
            <Receipts alvo={{ scheduled_transaction_id: conta.id }} />
          </div>
        )}
      </div>
    );
  };

  const Secao = ({
    titulo,
    icone,
    contas,
    vazio,
  }: {
    titulo: string;
    icone: React.ReactNode;
    contas: ScheduledTransaction[];
    vazio: string;
  }) => (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {icone}
          {titulo}
          <span className="text-sm font-normal text-gray-500">({contas.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {contas.length === 0 ? (
          <p className="py-2 text-sm text-gray-500">{vazio}</p>
        ) : (
          contas.map((conta) => <Linha key={conta.id} conta={conta} />)
        )}
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contas Previstas</h1>
          <p className="text-sm text-gray-500">
            O que ainda vai sair, e os gastos que se repetem todo mês.
          </p>
        </div>

        <div className="flex gap-2">
          <Dialog open={dialogAvulsa} onOpenChange={setDialogAvulsa}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Conta avulsa
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nova conta prevista</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Descrição *</Label>
                  <Input
                    value={formAvulsa.description}
                    onChange={(evento) =>
                      setFormAvulsa((atual) => ({ ...atual, description: evento.target.value }))
                    }
                    placeholder="IPTU parcela única"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Valor *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formAvulsa.amount}
                      onChange={(evento) =>
                        setFormAvulsa((atual) => ({ ...atual, amount: evento.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label>Vencimento *</Label>
                    <Input
                      type="date"
                      value={formAvulsa.due_date}
                      onChange={(evento) =>
                        setFormAvulsa((atual) => ({ ...atual, due_date: evento.target.value }))
                      }
                    />
                  </div>
                </div>
                <div>
                  <Label>Categoria *</Label>
                  <Select
                    value={formAvulsa.category_id}
                    onValueChange={(valor) =>
                      setFormAvulsa((atual) => ({ ...atual, category_id: valor }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {despesas.map((categoria) => (
                        <SelectItem key={categoria.id} value={categoria.id}>
                          {categoria.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Conta (opcional)</Label>
                  <Select
                    value={formAvulsa.account_id}
                    onValueChange={(valor) =>
                      setFormAvulsa((atual) => ({ ...atual, account_id: valor }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((conta) => (
                        <SelectItem key={conta.id} value={conta.id}>
                          {conta.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  className="w-full"
                  onClick={criarContaAvulsa}
                  disabled={agindo === "nova-avulsa"}
                >
                  {agindo === "nova-avulsa" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={dialogFixo} onOpenChange={setDialogFixo}>
            <DialogTrigger asChild>
              <Button>
                <Repeat className="mr-2 h-4 w-4" />
                Gasto fixo
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo gasto fixo</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Descrição *</Label>
                  <Input
                    value={formFixo.description}
                    onChange={(evento) =>
                      setFormFixo((atual) => ({ ...atual, description: evento.target.value }))
                    }
                    placeholder="Aluguel"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Valor *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formFixo.amount}
                      onChange={(evento) =>
                        setFormFixo((atual) => ({ ...atual, amount: evento.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <Label>Dia do vencimento</Label>
                    <Input
                      type="number"
                      min="1"
                      max="31"
                      value={formFixo.due_day}
                      onChange={(evento) =>
                        setFormFixo((atual) => ({ ...atual, due_day: evento.target.value }))
                      }
                    />
                  </div>
                </div>
                <div>
                  <Label>Frequência</Label>
                  <Select
                    value={formFixo.frequency}
                    onValueChange={(valor: RecurrenceFrequency) =>
                      setFormFixo((atual) => ({ ...atual, frequency: valor }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FREQUENCIAS.map((frequencia) => (
                        <SelectItem key={frequencia.valor} value={frequencia.valor}>
                          {frequencia.rotulo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Categoria *</Label>
                  <Select
                    value={formFixo.category_id}
                    onValueChange={(valor) =>
                      setFormFixo((atual) => ({ ...atual, category_id: valor }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {despesas.map((categoria) => (
                        <SelectItem key={categoria.id} value={categoria.id}>
                          {categoria.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Conta (opcional)</Label>
                  <Select
                    value={formFixo.account_id}
                    onValueChange={(valor) =>
                      setFormFixo((atual) => ({ ...atual, account_id: valor }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((conta) => (
                        <SelectItem key={conta.id} value={conta.id}>
                          {conta.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Gasto fixo compartilhado: o aluguel dividido com a esposa, a
                    internet da casa. As tabelas do 005 sempre tiveram group_id
                    e a API sempre aceitou -- faltava este seletor, e sem ele
                    toda regra nascia pessoal e invisivel para os outros
                    membros. So aparece para quem tem grupo. */}
                {gruposDespesa.length > 0 && (
                  <div>
                    <Label>Dividir com um grupo (opcional)</Label>
                    <Select
                      value={formFixo.group_id || "pessoal"}
                      onValueChange={(valor) =>
                        setFormFixo((atual) => ({
                          ...atual,
                          group_id: valor === "pessoal" ? "" : valor,
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Só meu" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pessoal">Só meu</SelectItem>
                        {gruposDespesa.map((grupo) => (
                          <SelectItem key={grupo.id} value={grupo.id}>
                            {grupo.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-xs text-gray-500">
                      Os membros do grupo passam a ver esta conta na agenda
                      deles — sem enxergar o resto das suas contas.
                    </p>
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={criarGastoFixo}
                  disabled={agindo === "novo-fixo"}
                >
                  {agindo === "novo-fixo" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Salvar
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Em atraso</CardDescription>
            <CardTitle className="text-2xl text-red-600">{moeda(totais.vencido)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total em aberto</CardDescription>
            <CardTitle className="text-2xl">{moeda(totais.aberto)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Custo fixo mensal</CardDescription>
            <CardTitle className="text-2xl">{moeda(custoFixo)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Secao
        titulo="Vencidas"
        icone={<AlertCircle className="h-4 w-4 text-red-600" />}
        contas={grupos.vencidas}
        vazio="Nada em atraso."
      />
      <Secao
        titulo="Próximos 7 dias"
        icone={<CalendarClock className="h-4 w-4 text-amber-600" />}
        contas={grupos.semana}
        vazio="Nenhuma conta vence nesta semana."
      />
      <Secao
        titulo="Mais adiante"
        icone={<Wallet className="h-4 w-4 text-blue-600" />}
        contas={grupos.depois}
        vazio="Nada previsto no período."
      />

      {rules.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Repeat className="h-4 w-4 text-gray-600" />
              Gastos fixos ativos
              <span className="text-sm font-normal text-gray-500">({rules.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rules.map((regra) => (
              <div
                key={regra.id}
                className="flex items-center justify-between border-b border-gray-100 py-2 last:border-0"
              >
                <div>
                  <p className="font-medium text-gray-900">{regra.description}</p>
                  <p className="text-sm text-gray-500">
                    {FREQUENCIAS.find((f) => f.valor === regra.frequency)?.rotulo ?? regra.frequency}
                    {regra.due_day ? ` · dia ${regra.due_day}` : ""}
                    {regra.category ? ` · ${regra.category.name}` : ""}
                  </p>
                </div>
                <p className="font-semibold text-gray-900">{moeda(Number(regra.amount))}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
