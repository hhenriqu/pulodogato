"use client";

// Orcamento por categoria, fatura de cartao e projecao de saldo.
//
// A tela responde, em ordem: o que ja estourou, quanto sobra no fim do mes, e
// so depois o detalhe por categoria. Quem abre esta tela quer saber se pode
// gastar -- nao cadastrar teto.

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
import { CampoDeValor } from "@/components/ui/campo-de-valor";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarClock,
  CreditCard,
  Loader2,
  PiggyBank,
  Plus,
  Repeat,
  TrendingDown,
  Trash2,
  Users,
} from "lucide-react";
import type {
  BudgetWithConsumption,
  CardInvoice,
  ProjectionSummary,
  TransactionCategory,
  FinancialAccount,
} from "@/types/financial";
import {
  separarOrcamentos,
  fraseDoRestante,
  type GrupoOrcado,
} from "@/lib/orcamento-de-grupo";

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);

// 'YYYY-MM-DD' formatado sem passar por new Date(): a string ISO e lida como
// UTC e, no Brasil, voltaria um dia no fuso local.
const dataCurta = (iso: string) => {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano.slice(2)}`;
};

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const nomeDoMes = (iso: string) => {
  const [ano, mes] = iso.split("-");
  return `${MESES[Number(mes) - 1]} de ${ano}`;
};

const HOJE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
  new Date()
);
const MES_CORRENTE = HOJE.slice(0, 7);

interface FormOrcamento {
  category_id: string;
  amount_limit: string;
  alert_threshold: string;
  /** "" = teto pessoal. Preenchido = teto da viagem/casa (HMO-138). */
  group_id: string;
}

/** O valor que o Select usa para "nenhum grupo": Radix nao aceita item com
 *  value="". */
const SEM_GRUPO = "pessoal";

interface FormCartao {
  account_id: string;
  closing_day: string;
  due_day: string;
}

export default function BudgetsPage() {
  const [mes, setMes] = useState(MES_CORRENTE);
  const [budgets, setBudgets] = useState<BudgetWithConsumption[]>([]);
  const [invoices, setInvoices] = useState<CardInvoice[]>([]);
  const [projecao, setProjecao] = useState<ProjectionSummary | null>(null);
  const [categories, setCategories] = useState<TransactionCategory[]>([]);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  // Grupos de despesa (casa, viagem): a lista existe para o seletor do dialogo.
  // Só aparece para quem tem grupo -- ver a nota na aba "Grupo".
  const [grupos, setGrupos] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [agindo, setAgindo] = useState<string | null>(null);
  const [dialogOrcamento, setDialogOrcamento] = useState(false);
  const [dialogCartao, setDialogCartao] = useState(false);

  const [formOrcamento, setFormOrcamento] = useState<FormOrcamento>({
    category_id: "",
    amount_limit: "",
    alert_threshold: "80",
    group_id: "",
  });

  const [formCartao, setFormCartao] = useState<FormCartao>({
    account_id: "",
    closing_day: "",
    due_day: "",
  });

  const carregar = useCallback(async () => {
    try {
      const [rOrc, rFat, rProj, rCat, rCon, rGru] = await Promise.all([
        fetch(`/api/budgets?month=${mes}`),
        fetch(`/api/card-invoices?month=${mes}`),
        fetch("/api/projection"),
        fetch("/api/personal-finance/categories"),
        fetch("/api/financial-accounts"),
        fetch("/api/expense-groups"),
      ]);

      if (rOrc.ok) {
        const dados = await rOrc.json();
        setBudgets(dados.budgets ?? []);
      }
      if (rFat.ok) {
        const dados = await rFat.json();
        setInvoices(dados.invoices ?? []);
      }
      if (rProj.ok) setProjecao(await rProj.json());
      if (rCat.ok) {
        const dados = await rCat.json();
        setCategories(dados.categories ?? dados ?? []);
      }
      if (rCon.ok) {
        const dados = await rCon.json();
        setAccounts(dados.accounts ?? []);
      }
      if (rGru.ok) {
        const dados = await rGru.json();
        setGrupos(dados.groups ?? []);
      }
    } catch (erro) {
      console.error(erro);
      toast.error("Não foi possível carregar os dados");
    } finally {
      setLoading(false);
    }
  }, [mes]);

  useEffect(() => {
    setLoading(true);
    carregar();
  }, [carregar]);

  const cartoes = useMemo(
    () => accounts.filter((c) => c.account_type === "credit_card"),
    [accounts]
  );

  // Teto de gasto so faz sentido em categoria de despesa: um teto de "Salario"
  // seria uma frase sem significado na tela.
  const categoriasDespesa = useMemo(
    () => categories.filter((c) => c.is_expense),
    [categories]
  );

  // A separacao entre teto pessoal e teto de grupo mora em
  // lib/orcamento-de-grupo.ts, com teste. A lista de `/api/budgets` traz os
  // dois juntos (e a RLS do 006 faz isso de proposito), e somar tudo num numero
  // so produziria um "ja gasto" que nao e nem o meu -- inclui o gasto dos
  // outros membros da viagem -- nem o da viagem -- inclui o meu mercado de
  // casa. Ver o cabecalho daquele arquivo.
  const { pessoais, pessoal, grupos: gruposOrcados } = useMemo(
    () => separarOrcamentos(budgets),
    [budgets]
  );

  const totais = useMemo(
    () => ({
      limite: pessoal.limite,
      gasto: pessoal.gasto,
      estourados: pessoais.filter((b) => b.consumption_status === "exceeded"),
      emAlerta: pessoais.filter((b) => b.consumption_status === "alert"),
    }),
    [pessoal, pessoais]
  );

  const criarOrcamento = async () => {
    if (!formOrcamento.category_id || !formOrcamento.amount_limit) {
      toast.error("Escolha a categoria e o teto");
      return;
    }

    setAgindo("novo-orcamento");
    try {
      const resposta = await fetch("/api/budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category_id: formOrcamento.category_id,
          amount_limit: Number(formOrcamento.amount_limit),
          month: mes,
          // A tela fala em porcentagem; a API e o banco guardam a fracao.
          alert_threshold: Number(formOrcamento.alert_threshold) / 100,
          // Vazio tem que virar `undefined`, nunca "": o `group_id || null` da
          // rota converteria a string vazia em NULL de qualquer jeito, mas o
          // guard de participacao dela testa `if (group_id)` -- e um dia em que
          // ele passe a testar `!== undefined` a string vazia atravessaria a
          // checagem e bateria na FK como erro 500.
          group_id: formOrcamento.group_id || undefined,
        }),
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível criar o orçamento");
        return;
      }

      toast.success(
        formOrcamento.group_id ? "Orçamento do grupo criado" : "Orçamento criado"
      );
      setDialogOrcamento(false);
      setFormOrcamento({
        category_id: "",
        amount_limit: "",
        alert_threshold: "80",
        group_id: "",
      });
      await carregar();
    } catch (erro) {
      console.error(erro);
      toast.error("Erro ao criar o orçamento");
    } finally {
      setAgindo(null);
    }
  };

  const removerOrcamento = async (id: string) => {
    setAgindo(id);
    try {
      const resposta = await fetch(`/api/budgets/${id}`, { method: "DELETE" });
      if (!resposta.ok) {
        const dados = await resposta.json();
        toast.error(dados.error ?? "Não foi possível remover");
        return;
      }
      toast.success("Orçamento removido");
      await carregar();
    } catch (erro) {
      console.error(erro);
      toast.error("Erro ao remover o orçamento");
    } finally {
      setAgindo(null);
    }
  };

  const repetirNoProximoMes = async () => {
    setAgindo("repetir");
    try {
      const resposta = await fetch("/api/budgets/carry-forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: mes }),
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível repetir");
        return;
      }

      toast.success(
        dados.criados
          ? `${dados.criados} orçamento(s) criados em ${nomeDoMes(dados.destino)}`
          : `Nada a repetir — ${nomeDoMes(dados.destino)} já está configurado`
      );
    } catch (erro) {
      console.error(erro);
      toast.error("Erro ao repetir os orçamentos");
    } finally {
      setAgindo(null);
    }
  };

  const salvarCartao = async () => {
    if (!formCartao.account_id) {
      toast.error("Escolha o cartão");
      return;
    }

    setAgindo("cartao");
    try {
      const resposta = await fetch(`/api/financial-accounts/${formCartao.account_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closing_day: formCartao.closing_day || null,
          due_day: formCartao.due_day || null,
        }),
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível salvar");
        return;
      }

      toast.success("Cartão configurado");
      setDialogCartao(false);
      setFormCartao({ account_id: "", closing_day: "", due_day: "" });
      await carregar();
    } catch (erro) {
      console.error(erro);
      toast.error("Erro ao configurar o cartão");
    } finally {
      setAgindo(null);
    }
  };

  const fecharFatura = async (accountId: string) => {
    setAgindo(accountId);
    try {
      const resposta = await fetch("/api/card-invoices/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accountId, month: mes }),
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível fechar a fatura");
        return;
      }

      toast.success(
        `Fatura de ${moeda(dados.total)} lançada para ${dataCurta(dados.due_date)}`
      );
      await carregar();
    } catch (erro) {
      console.error(erro);
      toast.error("Erro ao fechar a fatura");
    } finally {
      setAgindo(null);
    }
  };

  const LinhaOrcamento = ({ budget }: { budget: BudgetWithConsumption }) => {
    const ratio = Number(budget.consumed_ratio);
    const pct = Math.round(ratio * 100);
    const status = budget.consumption_status;

    const cor =
      status === "exceeded"
        ? "text-destructive"
        : status === "alert"
        ? "text-warning"
        : "text-success";

    return (
      <div className="flex flex-col gap-2 rounded-lg border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">
              {budget.category?.name ?? "Categoria"}
            </p>
            <p className="text-sm text-muted-foreground">
              {moeda(Number(budget.spent))} de {moeda(Number(budget.amount_limit))}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold ${cor}`}>{pct}%</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removerOrcamento(budget.id)}
              disabled={agindo === budget.id}
              aria-label="Remover orçamento"
            >
              {agindo === budget.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>

        {/* A barra para em 100 mesmo quando estourou; o numero acima e quem
            conta o tamanho do estouro. Uma barra de 180% vira ruido. */}
        <Progress value={Math.min(pct, 100)} />

        <p className="text-sm">
          {Number(budget.remaining) >= 0 ? (
            <span className="text-muted-foreground">
              Restam {moeda(Number(budget.remaining))}
            </span>
          ) : (
            <span className="font-medium text-destructive">
              Estourou {moeda(Math.abs(Number(budget.remaining)))}
            </span>
          )}
        </p>
      </div>
    );
  };

  /**
   * Uma viagem (ou a casa): a barra do grupo inteiro em cima, os tetos por
   * categoria embaixo.
   *
   * A barra de cima e a resposta que a tela existe para dar -- "quanto já
   * gastamos da viagem" -- e ela soma o gasto de TODOS os membros, nao só o de
   * quem esta olhando: quem paga o hotel e quem paga a gasolina consomem o
   * mesmo teto. Por isso a frase de apoio diz isso com todas as letras; sem
   * ela, o numero parece alto demais para quem lembra so do que pagou.
   */
  const CartaoDoGrupo = ({ grupo }: { grupo: GrupoOrcado<BudgetWithConsumption> }) => {
    const pct = Math.round(grupo.ratio * 100);
    const cor =
      grupo.status === "exceeded"
        ? "text-destructive"
        : grupo.status === "alert"
        ? "text-warning"
        : "text-success";

    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4 shrink-0" />
                <span className="truncate">{grupo.group_name}</span>
              </CardTitle>
              <CardDescription>
                {moeda(grupo.gasto)} de {moeda(grupo.limite)} — soma o gasto de
                todos os membros
              </CardDescription>
            </div>
            <span className={`text-lg font-semibold ${cor}`}>{pct}%</span>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Mesma regra da linha individual: a barra para em 100 e o
              percentual acima e quem conta o tamanho do estouro. */}
          <div className="space-y-1">
            <Progress value={Math.min(pct, 100)} />
            <p
              className={`text-sm ${
                grupo.restante < 0
                  ? "font-medium text-destructive"
                  : "text-muted-foreground"
              }`}
            >
              {fraseDoRestante(grupo)}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {grupo.orcamentos.map((b) => (
              <LinhaOrcamento key={b.id} budget={b} />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Orçamento</h1>
          <p className="text-sm text-muted-foreground">
            Quanto você pode gastar em {nomeDoMes(`${mes}-01`)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="w-[170px]"
            aria-label="Mês do orçamento"
          />

          <Dialog open={dialogOrcamento} onOpenChange={setDialogOrcamento}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Novo teto
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Novo teto de gasto</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Select
                    value={formOrcamento.category_id}
                    onValueChange={(v) =>
                      setFormOrcamento({ ...formOrcamento, category_id: v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Escolha a categoria" />
                    </SelectTrigger>
                    <SelectContent>
                      {categoriasDespesa.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  {/* O "(R$)" saiu do rotulo: a mascara ja mostra o simbolo
                      dentro do campo, e os dois juntos escrevem a moeda duas
                      vezes na mesma linha. */}
                  <Label>Teto do mês</Label>
                  <CampoDeValor
                    value={formOrcamento.amount_limit}
                    onChange={(amount_limit) =>
                      setFormOrcamento({ ...formOrcamento, amount_limit })
                    }
                    aria-label="Teto do mês"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Avisar ao atingir (%)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="100"
                    value={formOrcamento.alert_threshold}
                    onChange={(e) =>
                      setFormOrcamento({
                        ...formOrcamento,
                        alert_threshold: e.target.value,
                      })
                    }
                  />
                </div>

                {/* Teto da viagem/casa. Só aparece para quem tem grupo: sem
                    grupo o seletor seria um campo com uma unica opcao chamada
                    "Só eu", que nao decide nada. O teto de grupo e unico por
                    (grupo, categoria, mes) -- vale para o grupo todo, nao por
                    membro -- e por isso o texto de apoio abaixo. */}
                {grupos.length > 0 && (
                  <div className="space-y-2">
                    <Label>De quem é este teto</Label>
                    <Select
                      value={formOrcamento.group_id || SEM_GRUPO}
                      onValueChange={(v) =>
                        setFormOrcamento({
                          ...formOrcamento,
                          group_id: v === SEM_GRUPO ? "" : v,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={SEM_GRUPO}>Só meu (pessoal)</SelectItem>
                        {grupos.map((g) => (
                          <SelectItem key={g.id} value={g.id}>
                            {g.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formOrcamento.group_id && (
                      <p className="text-xs text-muted-foreground">
                        Vale para o grupo inteiro: o consumo soma o gasto de
                        todos os membros, e o teto é um só por categoria.
                      </p>
                    )}
                  </div>
                )}

                <Button
                  className="w-full"
                  onClick={criarOrcamento}
                  disabled={agindo === "novo-orcamento"}
                >
                  {agindo === "novo-orcamento" && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Criar teto
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* ---------- o que ja estourou ---------- */}
      {totais.estourados.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/10">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="h-4 w-4" />
              {totais.estourados.length} orçamento(s) estourado(s)
            </CardTitle>
            <CardDescription className="text-destructive/80">
              {totais.estourados
                .map((b) => b.category?.name ?? "Categoria")
                .join(", ")}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {/* ---------- a resposta curta ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Os dois primeiros cartoes sao SO o teto pessoal. O "(só meu)" só
            entra quando existe teto de grupo: sem grupo ele seria uma ressalva
            sobre uma distincao que nao existe na tela daquela pessoa. */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              Orçado no mês{gruposOrcados.length > 0 ? " (só meu)" : ""}
            </CardDescription>
            <CardTitle className="text-2xl">{moeda(totais.limite)}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              Já gasto{gruposOrcados.length > 0 ? " (só meu)" : ""}
            </CardDescription>
            <CardTitle className="text-2xl">{moeda(totais.gasto)}</CardTitle>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Saldo hoje</CardDescription>
            <CardTitle className="text-2xl">
              {moeda(projecao?.current_total ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>

        <Card
          className={
            (projecao?.projected_total ?? 0) < 0 ? "border-destructive/30 bg-destructive/10" : ""
          }
        >
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingDown className="h-3 w-3" />
              Projeção fim do mês
            </CardDescription>
            <CardTitle
              className={`text-2xl ${
                (projecao?.projected_total ?? 0) < 0 ? "text-destructive" : ""
              }`}
            >
              {moeda(projecao?.projected_total ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Tabs defaultValue="orcamento">
        <TabsList>
          <TabsTrigger value="orcamento">
            <PiggyBank className="mr-2 h-4 w-4" />
            Por categoria
          </TabsTrigger>
          {/* A aba do grupo só existe para quem participa de algum: para quem
              nao participa ela seria uma aba permanentemente vazia. */}
          {grupos.length > 0 && (
            <TabsTrigger value="grupo">
              <Users className="mr-2 h-4 w-4" />
              Grupo
            </TabsTrigger>
          )}
          <TabsTrigger value="faturas">
            <CreditCard className="mr-2 h-4 w-4" />
            Faturas
          </TabsTrigger>
          <TabsTrigger value="projecao">
            <CalendarClock className="mr-2 h-4 w-4" />
            Projeção
          </TabsTrigger>
        </TabsList>

        {/* ---------- por categoria ---------- */}
        <TabsContent value="orcamento" className="space-y-4">
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={repetirNoProximoMes}
              disabled={agindo === "repetir" || budgets.length === 0}
            >
              {agindo === "repetir" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Repeat className="mr-2 h-4 w-4" />
              )}
              Repetir no próximo mês
            </Button>
          </div>

          {/* Só os tetos pessoais: os de grupo tem aba propria. Misturar os
              dois aqui e o que fazia "Já gasto" crescer a cada membro novo da
              viagem -- ver lib/orcamento-de-grupo.ts. */}
          {pessoais.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                <PiggyBank className="mx-auto mb-3 h-8 w-8 opacity-40" />
                <p>Nenhum teto definido para {nomeDoMes(`${mes}-01`)}.</p>
                <p className="text-sm">
                  Comece pelas categorias em que você mais gasta.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {pessoais.map((b) => (
                <LinhaOrcamento key={b.id} budget={b} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---------- grupo: quanto ja gastamos da viagem ---------- */}
        {grupos.length > 0 && (
          <TabsContent value="grupo" className="space-y-4">
            {gruposOrcados.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-muted-foreground">
                  <Users className="mx-auto mb-3 h-8 w-8 opacity-40" />
                  <p>
                    Nenhum teto de grupo em {nomeDoMes(`${mes}-01`)}.
                  </p>
                  <p className="text-sm">
                    Em &ldquo;Novo teto&rdquo;, escolha o grupo para acompanhar
                    o quanto a viagem já consumiu.
                  </p>
                </CardContent>
              </Card>
            ) : (
              gruposOrcados.map((g) => <CartaoDoGrupo key={g.group_id} grupo={g} />)
            )}
          </TabsContent>
        )}

        {/* ---------- faturas ---------- */}
        <TabsContent value="faturas" className="space-y-4">
          <div className="flex justify-end">
            <Dialog open={dialogCartao} onOpenChange={setDialogCartao}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm">
                  <CreditCard className="mr-2 h-4 w-4" />
                  Configurar cartão
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Fechamento e vencimento</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Compra feita depois do fechamento entra na fatura do mês
                    seguinte. Sem esses dois dias a fatura não pode ser fechada.
                  </p>

                  <div className="space-y-2">
                    <Label>Cartão</Label>
                    <Select
                      value={formCartao.account_id}
                      onValueChange={(v) => {
                        const cartao = cartoes.find((c) => c.id === v);
                        setFormCartao({
                          account_id: v,
                          closing_day: cartao?.closing_day
                            ? String(cartao.closing_day)
                            : "",
                          due_day: cartao?.due_day ? String(cartao.due_day) : "",
                        });
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Escolha o cartão" />
                      </SelectTrigger>
                      <SelectContent>
                        {cartoes.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Dia do fechamento</Label>
                      <Input
                        type="number"
                        min="1"
                        max="31"
                        value={formCartao.closing_day}
                        onChange={(e) =>
                          setFormCartao({
                            ...formCartao,
                            closing_day: e.target.value,
                          })
                        }
                        placeholder="28"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Dia do vencimento</Label>
                      <Input
                        type="number"
                        min="1"
                        max="31"
                        value={formCartao.due_day}
                        onChange={(e) =>
                          setFormCartao({ ...formCartao, due_day: e.target.value })
                        }
                        placeholder="5"
                      />
                    </div>
                  </div>

                  <Button
                    className="w-full"
                    onClick={salvarCartao}
                    disabled={agindo === "cartao"}
                  >
                    {agindo === "cartao" && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Salvar
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          {invoices.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-muted-foreground">
                <CreditCard className="mx-auto mb-3 h-8 w-8 opacity-40" />
                <p>Nenhum cartão de crédito cadastrado.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {invoices.map((fatura) => (
                <Card key={fatura.account_id}>
                  <CardHeader className="pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle className="text-base">
                          {fatura.account_name}
                        </CardTitle>
                        <CardDescription>
                          {fatura.line_count} lançamento(s)
                          {fatura.due_date
                            ? ` · vence ${dataCurta(fatura.due_date)}`
                            : " · sem vencimento configurado"}
                        </CardDescription>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="text-xl font-semibold">
                          {moeda(fatura.total)}
                        </span>

                        {fatura.scheduled_transaction_id ? (
                          <Badge variant="secondary">Fechada</Badge>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => fecharFatura(fatura.account_id)}
                            disabled={
                              agindo === fatura.account_id ||
                              fatura.total <= 0 ||
                              !fatura.due_day
                            }
                          >
                            {agindo === fatura.account_id && (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Fechar fatura
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  {fatura.lines.length > 0 && (
                    <CardContent className="space-y-1 pt-0">
                      {fatura.lines.slice(0, 5).map((linha) => (
                        <div
                          key={linha.transaction_id}
                          className="flex justify-between gap-3 text-sm"
                        >
                          <span className="truncate text-muted-foreground">
                            {dataCurta(linha.transaction_date)} · {linha.description}
                          </span>
                          <span
                            className={
                              Number(linha.invoice_amount) < 0
                                ? "shrink-0 text-success"
                                : "shrink-0"
                            }
                          >
                            {moeda(Number(linha.invoice_amount))}
                          </span>
                        </div>
                      ))}
                      {fatura.lines.length > 5 && (
                        <p className="pt-1 text-xs text-muted-foreground">
                          e mais {fatura.lines.length - 5} lançamento(s)
                        </p>
                      )}
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---------- projecao ---------- */}
        <TabsContent value="projecao" className="space-y-4">
          {projecao && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Até {dataCurta(projecao.through)}
                </CardTitle>
                <CardDescription>
                  Saldo de hoje mais tudo que está previsto e ainda não foi pago.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-sm text-muted-foreground">A pagar</p>
                    <p className="text-lg font-semibold text-destructive">
                      {moeda(projecao.scheduled_out)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">A receber</p>
                    <p className="text-lg font-semibold text-success">
                      {moeda(projecao.scheduled_in)}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Vencido</p>
                    <p className="text-lg font-semibold text-warning">
                      {moeda(projecao.overdue_total)}
                    </p>
                  </div>
                </div>

                <div className="space-y-2 border-t pt-3">
                  {projecao.accounts.map((conta) => (
                    <div
                      key={conta.account_id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{conta.account_name}</span>
                        {conta.goes_negative && (
                          <Badge variant="destructive" className="text-xs">
                            fica negativa
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <span className="text-muted-foreground">
                          {moeda(conta.current_balance)}
                        </span>
                        <span className="text-muted-foreground">→</span>
                        <span
                          className={
                            conta.projected_balance < 0
                              ? "font-medium text-destructive"
                              : "font-medium"
                          }
                        >
                          {moeda(conta.projected_balance)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
