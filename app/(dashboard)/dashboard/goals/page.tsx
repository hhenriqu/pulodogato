"use client";

// Metas de economia.
//
// Esta tela era um MOCK: duas metas escritas no codigo, com um TODO em cima.
// As barras nunca mudavam, "Nova Meta" nao fazia nada e nao havia onde
// registrar que voce guardou dinheiro. Agora le financial_goals / goal_progress
// (migration 008).
//
// A ordem da tela responde "eu chego?" antes de "quanto eu tenho": o topo
// mostra o que falta por mes, porque e o unico numero sobre o qual o usuario
// pode agir hoje.

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
import { Textarea } from "@/components/ui/textarea";
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
  CalendarClock,
  CheckCircle2,
  Loader2,
  PauseCircle,
  PiggyBank,
  Plus,
  Target,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react";
import type {
  GoalWithProgress,
  GoalContribution,
  FinancialAccount,
  ExpenseGroup,
} from "@/types/financial";

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    valor
  );

// 'YYYY-MM-DD' sem passar por new Date(): a string ISO e lida como UTC e, no
// Brasil, voltaria um dia no fuso local. Mesmo cuidado da tela de orcamento.
const dataCurta = (iso: string) => {
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano.slice(2)}`;
};

const HOJE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
}).format(new Date());

interface FormMeta {
  title: string;
  description: string;
  target_amount: string;
  target_date: string;
  account_id: string;
  group_id: string;
}

const FORM_VAZIO: FormMeta = {
  title: "",
  description: "",
  target_amount: "",
  target_date: "",
  account_id: "",
  group_id: "",
};

const ROTULO_ESTADO: Record<string, string> = {
  on_track: "Em andamento",
  reached: "Alcançada",
  overdue: "Prazo vencido",
  paused: "Pausada",
  cancelled: "Cancelada",
};

const COR_ESTADO: Record<string, string> = {
  on_track: "bg-info/10 text-info",
  reached: "bg-success/10 text-success",
  overdue: "bg-destructive/10 text-destructive",
  paused: "bg-warning/10 text-warning",
  cancelled: "bg-muted text-muted-foreground",
};

export default function GoalsPage() {
  const [metas, setMetas] = useState<GoalWithProgress[]>([]);
  const [contas, setContas] = useState<FinancialAccount[]>([]);
  const [grupos, setGrupos] = useState<ExpenseGroup[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const [dialogoAberto, setDialogoAberto] = useState(false);
  const [form, setForm] = useState<FormMeta>(FORM_VAZIO);

  // Aporte: a meta em foco e o valor digitado, mantidos fora do card para o
  // dialogo poder ser um so.
  const [metaDoAporte, setMetaDoAporte] = useState<GoalWithProgress | null>(
    null
  );
  const [valorAporte, setValorAporte] = useState("");
  const [dataAporte, setDataAporte] = useState(HOJE);
  const [aportes, setAportes] = useState<GoalContribution[]>([]);

  const carregar = useCallback(async () => {
    try {
      const [resMetas, resContas, resGrupos] = await Promise.all([
        fetch("/api/goals?status=all"),
        fetch("/api/financial-accounts"),
        fetch("/api/expense-groups"),
      ]);

      if (resMetas.ok) {
        const json = await resMetas.json();
        setMetas(json.goals ?? []);
      } else {
        const json = await resMetas.json().catch(() => ({}));
        toast.error(json.error ?? "Não foi possível carregar as metas");
      }

      if (resContas.ok) {
        const json = await resContas.json();
        setContas(json.accounts ?? json.data ?? []);
      }

      if (resGrupos.ok) {
        const json = await resGrupos.json();
        setGrupos(json.groups ?? json.data ?? []);
      }
    } catch {
      toast.error("Não foi possível carregar as metas");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const criarMeta = async () => {
    if (!form.title.trim()) {
      toast.error("Dê um nome para a meta");
      return;
    }
    if (!form.target_amount || Number(form.target_amount) <= 0) {
      toast.error("O valor da meta precisa ser maior que zero");
      return;
    }

    setSalvando(true);
    try {
      const res = await fetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description || null,
          target_amount: Number(form.target_amount),
          target_date: form.target_date || null,
          account_id: form.account_id || null,
          group_id: form.group_id || null,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(json.error ?? "Não foi possível criar a meta");
        return;
      }

      toast.success("Meta criada");
      setForm(FORM_VAZIO);
      setDialogoAberto(false);
      carregar();
    } finally {
      setSalvando(false);
    }
  };

  const abrirAporte = async (meta: GoalWithProgress) => {
    setMetaDoAporte(meta);
    setValorAporte("");
    setDataAporte(HOJE);
    setAportes([]);

    const res = await fetch(`/api/goals/${meta.id}`);
    if (res.ok) {
      const json = await res.json();
      setAportes(json.contributions ?? []);
    }
  };

  const registrarAporte = async () => {
    if (!metaDoAporte) return;
    if (!valorAporte || Number(valorAporte) <= 0) {
      toast.error("O aporte precisa ser maior que zero");
      return;
    }

    setSalvando(true);
    try {
      const res = await fetch(`/api/goals/${metaDoAporte.id}/contributions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(valorAporte),
          contributed_at: dataAporte,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast.error(json.error ?? "Não foi possível registrar o aporte");
        return;
      }

      toast.success(`${moeda(Number(valorAporte))} guardado`);

      // A rota devolve o progresso ja recalculado: troca so a meta afetada, em
      // vez de recarregar a lista inteira, para a barra mover na hora.
      if (json.goal) {
        setMetas((atuais) =>
          atuais.map((m) =>
            m.id === json.goal.id ? { ...m, ...json.goal } : m
          )
        );
      }

      setMetaDoAporte(null);
    } finally {
      setSalvando(false);
    }
  };

  const desfazerAporte = async (meta: GoalWithProgress, aporteId: string) => {
    const res = await fetch(
      `/api/goals/${meta.id}/contributions?id=${aporteId}`,
      { method: "DELETE" }
    );

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      toast.error(json.error ?? "Não foi possível desfazer o aporte");
      return;
    }

    toast.success("Aporte desfeito");
    setAportes((atuais) => atuais.filter((a) => a.id !== aporteId));
    if (json.goal) {
      setMetas((atuais) =>
        atuais.map((m) => (m.id === json.goal.id ? { ...m, ...json.goal } : m))
      );
    }
  };

  const mudarStatus = async (meta: GoalWithProgress, status: string) => {
    const res = await fetch(`/api/goals/${meta.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? "Não foi possível atualizar a meta");
      return;
    }

    carregar();
  };

  const apagarMeta = async (meta: GoalWithProgress) => {
    const aviso =
      meta.contribution_count > 0
        ? `Apagar "${meta.title}"? Os ${meta.contribution_count} aportes registrados serão perdidos.`
        : `Apagar "${meta.title}"?`;

    if (!window.confirm(aviso)) return;

    const res = await fetch(`/api/goals/${meta.id}`, { method: "DELETE" });

    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      toast.error(json.error ?? "Não foi possível apagar a meta");
      return;
    }

    toast.success("Meta apagada");
    setMetas((atuais) => atuais.filter((m) => m.id !== meta.id));
  };

  // Só as metas vivas entram nos totais do topo. Somar uma meta cancelada no
  // "falta juntar" faria o numero subir quando o usuario desiste de uma meta --
  // o contrario do que desistir significa.
  const ativas = useMemo(
    () => metas.filter((m) => m.status === "active"),
    [metas]
  );

  const totais = useMemo(() => {
    const alvo = ativas.reduce((s, m) => s + Number(m.target_amount), 0);
    const juntado = ativas.reduce((s, m) => s + Number(m.saved), 0);
    const porMes = ativas.reduce(
      (s, m) => s + Number(m.monthly_required ?? 0),
      0
    );
    return { alvo, juntado, porMes, falta: Math.max(alvo - juntado, 0) };
  }, [ativas]);

  if (carregando) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Target className="h-8 w-8" />
            Metas
          </h1>
          <p className="text-muted-foreground">
            Quanto você já juntou e quanto falta por mês para chegar lá
          </p>
        </div>

        <Dialog open={dialogoAberto} onOpenChange={setDialogoAberto}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Nova meta
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nova meta</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="titulo">Nome</Label>
                <Input
                  id="titulo"
                  placeholder="Reserva de emergência"
                  value={form.title}
                  onChange={(e) =>
                    setForm({ ...form, title: e.target.value })
                  }
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="alvo">Quanto quer juntar</Label>
                  <CampoDeValor
                    id="alvo"
                    value={form.target_amount}
                    onChange={(target_amount) =>
                      setForm({ ...form, target_amount })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="prazo">Até quando</Label>
                  <Input
                    id="prazo"
                    type="date"
                    value={form.target_date}
                    onChange={(e) =>
                      setForm({ ...form, target_date: e.target.value })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Opcional. Com prazo, o app calcula o valor por mês.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="descricao">Descrição</Label>
                <Textarea
                  id="descricao"
                  placeholder="Juntar 6 meses de despesas"
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Onde o dinheiro fica guardado</Label>
                <Select
                  value={form.account_id || "nenhuma"}
                  onValueChange={(v) =>
                    setForm({ ...form, account_id: v === "nenhuma" ? "" : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Nenhuma conta" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nenhuma">Nenhuma conta</SelectItem>
                    {contas.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Só uma anotação. O progresso vem dos aportes que você
                  registrar, não do saldo da conta.
                </p>
              </div>

              {grupos.length > 0 && (
                <div className="space-y-2">
                  <Label>Meta de grupo</Label>
                  <Select
                    value={form.group_id || "pessoal"}
                    onValueChange={(v) =>
                      setForm({ ...form, group_id: v === "pessoal" ? "" : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Meta pessoal" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pessoal">Meta pessoal</SelectItem>
                      {grupos.map((g) => (
                        <SelectItem key={g.id} value={g.id}>
                          {g.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Numa meta de grupo, cada membro registra o próprio aporte e
                    todos veem o total.
                  </p>
                </div>
              )}

              <Button
                className="w-full"
                onClick={criarMeta}
                disabled={salvando}
              >
                {salvando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Criar meta
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* O topo responde "eu chego?" antes de "quanto eu tenho". */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Guardar por mês
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{moeda(totais.porMes)}</p>
            <p className="text-xs text-muted-foreground">
              para cumprir todos os prazos
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Já juntado</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-success">
              {moeda(totais.juntado)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Falta</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{moeda(totais.falta)}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Metas em andamento</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{ativas.length}</p>
            <p className="text-xs text-muted-foreground">
              de {metas.length} no total
            </p>
          </CardContent>
        </Card>
      </div>

      {metas.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <PiggyBank className="h-10 w-10 mx-auto text-muted-foreground" />
            <p className="font-medium">Nenhuma meta ainda</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Uma meta é um valor e (opcionalmente) um prazo. O app calcula
              quanto você precisa guardar por mês e acompanha cada aporte.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {metas.map((meta) => {
            const pct = Math.min(Number(meta.progress_ratio) * 100, 100);

            return (
              <Card key={meta.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <CardTitle className="text-lg flex items-center gap-2">
                        {meta.title}
                        {meta.group_id && (
                          <Users className="h-4 w-4 text-muted-foreground" />
                        )}
                      </CardTitle>
                      {meta.description && (
                        <CardDescription>{meta.description}</CardDescription>
                      )}
                    </div>
                    <Badge
                      className={
                        COR_ESTADO[meta.progress_status] ?? COR_ESTADO.on_track
                      }
                    >
                      {ROTULO_ESTADO[meta.progress_status] ?? "Em andamento"}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="font-semibold">
                        {moeda(Number(meta.saved))}
                      </span>
                      <span className="text-muted-foreground">
                        de {moeda(Number(meta.target_amount))}
                      </span>
                    </div>
                    <Progress value={pct} />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{pct.toFixed(0)}%</span>
                      <span>faltam {moeda(Number(meta.remaining))}</span>
                    </div>
                  </div>

                  {/* O numero acionavel: quanto guardar por mes. Sem prazo o
                      app nao inventa um -- dizer "R$ 0,00 por mes" seria falso
                      e nao alarmaria ninguem. */}
                  {meta.monthly_required != null ? (
                    <div className="rounded-lg border bg-muted/40 p-3 text-sm">
                      <div className="flex items-center gap-2 font-medium">
                        <CalendarClock className="h-4 w-4" />
                        {Number(meta.monthly_required) > 0
                          ? `Guarde ${moeda(Number(meta.monthly_required))} por mês`
                          : "Meta alcançada"}
                      </div>
                      {meta.target_date && (
                        <p className="text-xs text-muted-foreground mt-1">
                          até {dataCurta(meta.target_date)}
                          {meta.months_left != null &&
                            ` · ${meta.months_left} ${
                              meta.months_left === 1 ? "mês" : "meses"
                            }`}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Sem prazo definido
                    </p>
                  )}

                  {meta.account && (
                    <p className="text-xs text-muted-foreground">
                      Guardado em {meta.account.name}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => abrirAporte(meta)}>
                      <PiggyBank className="h-4 w-4 mr-2" />
                      Guardar dinheiro
                    </Button>

                    {meta.status === "active" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => mudarStatus(meta, "paused")}
                      >
                        <PauseCircle className="h-4 w-4 mr-2" />
                        Pausar
                      </Button>
                    ) : meta.status === "paused" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => mudarStatus(meta, "active")}
                      >
                        Retomar
                      </Button>
                    ) : null}

                    {meta.progress_status === "reached" &&
                      meta.status === "active" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => mudarStatus(meta, "completed")}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Concluir
                        </Button>
                      )}

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => apagarMeta(meta)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dialogo de aporte: registrar e desfazer, no mesmo lugar. */}
      <Dialog
        open={metaDoAporte !== null}
        onOpenChange={(aberto) => !aberto && setMetaDoAporte(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Guardar dinheiro · {metaDoAporte?.title}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="aporte">Quanto</Label>
                <CampoDeValor
                  id="aporte"
                  value={valorAporte}
                  onChange={setValorAporte}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="data-aporte">Quando</Label>
                <Input
                  id="data-aporte"
                  type="date"
                  value={dataAporte}
                  onChange={(e) => setDataAporte(e.target.value)}
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              O aporte não movimenta o saldo das suas contas. Se você
              transferiu o dinheiro de verdade, lance a transferência também.
            </p>

            <Button
              className="w-full"
              onClick={registrarAporte}
              disabled={salvando}
            >
              {salvando && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Registrar aporte
            </Button>

            {aportes.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <p className="text-sm font-medium">Aportes anteriores</p>
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {aportes.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between text-sm py-1"
                    >
                      <div>
                        <span className="font-medium">
                          {moeda(Number(a.amount))}
                        </span>
                        <span className="text-muted-foreground ml-2">
                          {dataCurta(a.contributed_at)}
                        </span>
                        {metaDoAporte?.group_id && a.user?.full_name && (
                          <span className="text-muted-foreground ml-2">
                            · {a.user.full_name}
                          </span>
                        )}
                      </div>
                      {/* Desfazer so o proprio aporte: a RLS do 008 barra o
                          resto, e sem este guarda o botao apareceria para o
                          aporte de outro membro e falharia com 404. */}
                      {a.is_mine && metaDoAporte && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => desfazerAporte(metaDoAporte, a.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
