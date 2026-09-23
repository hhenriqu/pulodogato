"use client";

// Contracheque: salario bruto e os descontos em folha.
//
// A tela existe porque "quanto eu ganho" nao e uma pergunta de um numero so.
// O bruto e o que o contrato diz, o liquido e o que cai na conta, e a
// diferenca entre os dois (INSS, IRRF, plano, sindicato) some se so o liquido
// for lancado -- e some justamente a parte que o usuario quer conferir.
//
// O que vira LANCAMENTO e o liquido, uma vez so. Ver o cabecalho da migration
// 012 para por que o bruto como receita e cada desconto como despesa seria
// errado de um jeito que nao falha em lugar nenhum.

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
  Loader2,
  Plus,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import type { FinancialAccount, TransactionCategory } from "@/types/financial";

const TIPOS_DESCONTO = [
  { valor: "INSS", rotulo: "INSS" },
  { valor: "IRRF", rotulo: "Imposto de Renda (IRRF)" },
  { valor: "PENSION", rotulo: "Previdência privada" },
  { valor: "HEALTH", rotulo: "Plano de saúde" },
  { valor: "UNION", rotulo: "Sindicato" },
  { valor: "ADVANCE", rotulo: "Adiantamento / vale" },
  { valor: "OTHER", rotulo: "Outro desconto" },
] as const;

const rotuloDesconto = (kind: string) =>
  TIPOS_DESCONTO.find((t) => t.valor === kind)?.rotulo ?? kind;

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor);

const mesPorExtenso = (iso: string) => {
  // `new Date("2026-03-01")` e lido como UTC e, em fuso negativo, volta para
  // 29/02 -- o mes inteiro apareceria errado na tela. Por isso a data e
  // desmontada em numeros em vez de passar pelo parser.
  const [ano, mes] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(ano, mes - 1, 1));
};

type Desconto = { kind: string; description: string; amount: string };

type Contracheque = {
  id: string;
  reference_month: string;
  employer: string;
  gross_amount: number;
  total_deductions: number;
  net_amount: number;
  inss_amount: number;
  irrf_amount: number;
  transaction_id: string | null;
  deductions: Array<{
    id: string;
    kind: string;
    description: string | null;
    amount: number;
  }>;
};

const mesAtual = () => new Date().toISOString().slice(0, 7);

export default function PayrollPage() {
  const [contracheques, setContracheques] = useState<Contracheque[]>([]);
  const [contas, setContas] = useState<FinancialAccount[]>([]);
  const [categorias, setCategorias] = useState<TransactionCategory[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState(false);

  const [mes, setMes] = useState(mesAtual());
  const [empregador, setEmpregador] = useState("");
  const [bruto, setBruto] = useState("");
  const [contaId, setContaId] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [descontos, setDescontos] = useState<Desconto[]>([
    { kind: "INSS", description: "", amount: "" },
    { kind: "IRRF", description: "", amount: "" },
  ]);

  const carregar = useCallback(async () => {
    try {
      const [folha, contasResp, categoriasResp] = await Promise.all([
        fetch("/api/payroll"),
        fetch("/api/financial-accounts"),
        fetch("/api/personal-finance/categories").catch(() => null),
      ]);

      if (folha.ok) {
        const dados = await folha.json();
        setContracheques(dados.entries ?? []);
      }

      if (contasResp.ok) {
        const dados = await contasResp.json();
        setContas(dados.accounts ?? []);
      }

      if (categoriasResp?.ok) {
        const dados = await categoriasResp.json();
        // So categoria de RECEITA: o liquido e receita, e oferecer categoria de
        // despesa aqui gravaria o salario do lado errado do relatorio.
        setCategorias(
          (dados.categories ?? []).filter(
            (c: TransactionCategory) => !c.is_expense
          )
        );
      }
    } catch {
      toast.error("Não foi possível carregar os contracheques");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const totalDescontos = useMemo(
    () =>
      descontos.reduce((soma, d) => {
        const valor = parseFloat(d.amount);
        return soma + (Number.isFinite(valor) && valor > 0 ? valor : 0);
      }, 0),
    [descontos]
  );

  const brutoNumero = parseFloat(bruto) || 0;
  const liquidoPrevisto = brutoNumero - totalDescontos;

  const resumoAno = useMemo(() => {
    const ano = new Date().getFullYear();
    const doAno = contracheques.filter((c) =>
      c.reference_month.startsWith(String(ano))
    );
    return {
      bruto: doAno.reduce((s, c) => s + Number(c.gross_amount), 0),
      descontos: doAno.reduce((s, c) => s + Number(c.total_deductions), 0),
      liquido: doAno.reduce((s, c) => s + Number(c.net_amount), 0),
      meses: doAno.length,
    };
  }, [contracheques]);

  function limpar() {
    setMes(mesAtual());
    setEmpregador("");
    setBruto("");
    setContaId("");
    setCategoriaId("");
    setDescontos([
      { kind: "INSS", description: "", amount: "" },
      { kind: "IRRF", description: "", amount: "" },
    ]);
  }

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();

    if (!brutoNumero || brutoNumero <= 0) {
      toast.error("Informe o salário bruto");
      return;
    }

    if (liquidoPrevisto <= 0) {
      toast.error(
        "Os descontos somam o bruto ou mais. Confira os valores antes de salvar."
      );
      return;
    }

    setSalvando(true);
    try {
      const resposta = await fetch("/api/payroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference_month: mes,
          employer: empregador.trim() || "Principal",
          gross_amount: brutoNumero,
          account_id: contaId || null,
          category_id: categoriaId || null,
          // Linha em branco nao e desconto: quem deixou o campo vazio nao quis
          // descontar zero, quis nao descontar.
          deductions: descontos
            .filter((d) => parseFloat(d.amount) > 0)
            .map((d) => ({
              kind: d.kind,
              description: d.description.trim() || null,
              amount: parseFloat(d.amount),
            })),
        }),
      });

      const dados = await resposta.json();
      if (!resposta.ok) {
        toast.error(dados.error ?? "Erro ao salvar o contracheque");
        return;
      }

      toast.success(
        contaId && categoriaId
          ? "Contracheque salvo e o líquido foi lançado na conta."
          : "Contracheque salvo. Sem conta e categoria, ele não virou lançamento."
      );
      setAberto(false);
      limpar();
      await carregar();
    } catch {
      toast.error("Erro ao salvar o contracheque");
    } finally {
      setSalvando(false);
    }
  }

  async function apagar(contracheque: Contracheque) {
    try {
      const resposta = await fetch(`/api/payroll/${contracheque.id}`, {
        method: "DELETE",
      });
      const dados = await resposta.json();

      if (resposta.status === 207) {
        toast.warning(dados.error);
      } else if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível apagar");
        return;
      } else {
        toast.success("Contracheque apagado");
      }

      await carregar();
    } catch {
      toast.error("Não foi possível apagar");
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
          <h1 className="text-2xl font-bold text-foreground">Contracheque</h1>
          <p className="text-sm text-muted-foreground">
            O bruto, o que foi descontado e o que realmente caiu na conta.
          </p>
        </div>
        <Button
          onClick={() => {
            limpar();
            setAberto(true);
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Lançar contracheque
        </Button>
      </div>

      {resumoAno.meses > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Bruto no ano</CardDescription>
              <CardTitle className="text-2xl">
                {moeda(resumoAno.bruto)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {resumoAno.meses}{" "}
                {resumoAno.meses === 1 ? "contracheque" : "contracheques"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Descontado no ano</CardDescription>
              <CardTitle className="text-2xl text-warning">
                {moeda(resumoAno.descontos)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {resumoAno.bruto > 0
                  ? `${((resumoAno.descontos / resumoAno.bruto) * 100).toFixed(1)}% do bruto`
                  : "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Líquido no ano</CardDescription>
              <CardTitle className="text-2xl text-success">
                {moeda(resumoAno.liquido)}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                É este valor que entra nos relatórios.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {contracheques.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <Wallet className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium text-foreground">
              Nenhum contracheque lançado
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              Lance o salário bruto e os descontos para acompanhar quanto de
              fato sobra por mês.
            </p>
            <Button
              onClick={() => {
                limpar();
                setAberto(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Lançar o primeiro
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {contracheques.map((c) => (
            <Card key={c.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <CardTitle className="text-base capitalize">
                      {mesPorExtenso(c.reference_month)}
                    </CardTitle>
                    <CardDescription>{c.employer}</CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    {!c.transaction_id && (
                      <Badge
                        variant="outline"
                        className="border-warning/30 text-warning"
                      >
                        Sem lançamento
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => apagar(c)}
                      aria-label="Apagar contracheque"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Bruto</p>
                    <p className="text-lg font-semibold">
                      {moeda(Number(c.gross_amount))}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Descontos</p>
                    <p className="text-lg font-semibold text-warning">
                      − {moeda(Number(c.total_deductions))}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Líquido</p>
                    <p className="text-lg font-semibold text-success">
                      {moeda(Number(c.net_amount))}
                    </p>
                  </div>
                </div>

                {c.deductions.length > 0 && (
                  <div className="space-y-1 border-t border-border pt-3">
                    {c.deductions.map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-muted-foreground">
                          {rotuloDesconto(d.kind)}
                          {d.description ? ` · ${d.description}` : ""}
                        </span>
                        <span>− {moeda(Number(d.amount))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Lançar contracheque</DialogTitle>
          </DialogHeader>

          <form onSubmit={salvar} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="mes">Mês de referência *</Label>
                <Input
                  id="mes"
                  type="month"
                  value={mes}
                  onChange={(e) => setMes(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="empregador">Empregador</Label>
                <Input
                  id="empregador"
                  value={empregador}
                  onChange={(e) => setEmpregador(e.target.value)}
                  placeholder="Principal"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bruto">Salário bruto *</Label>
              <Input
                id="bruto"
                type="number"
                step="0.01"
                value={bruto}
                onChange={(e) => setBruto(e.target.value)}
                placeholder="0,00"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Descontos em folha</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setDescontos([
                      ...descontos,
                      { kind: "OTHER", description: "", amount: "" },
                    ])
                  }
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Adicionar
                </Button>
              </div>

              {descontos.map((desconto, indice) => (
                <div key={indice} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Select
                      value={desconto.kind}
                      onValueChange={(valor) => {
                        const copia = [...descontos];
                        copia[indice] = { ...copia[indice], kind: valor };
                        setDescontos(copia);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TIPOS_DESCONTO.map((tipo) => (
                          <SelectItem key={tipo.valor} value={tipo.valor}>
                            {tipo.rotulo}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-32 space-y-1">
                    <Input
                      type="number"
                      step="0.01"
                      value={desconto.amount}
                      onChange={(e) => {
                        const copia = [...descontos];
                        copia[indice] = {
                          ...copia[indice],
                          amount: e.target.value,
                        };
                        setDescontos(copia);
                      }}
                      placeholder="0,00"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDescontos(descontos.filter((_, i) => i !== indice))
                    }
                    aria-label="Remover desconto"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}

              <p className="text-xs text-muted-foreground">
                O FGTS não entra aqui: ele é depositado pelo empregador e não
                reduz o seu bruto.
              </p>
            </div>

            {/* O resultado aparece antes de salvar. Um zero a mais no IRRF e um
                erro de digitacao comum, e aqui ele fica visivel na hora. */}
            {brutoNumero > 0 && (
              <div className="rounded-md bg-muted p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Bruto</span>
                  <span>{moeda(brutoNumero)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Descontos</span>
                  <span className="text-warning">− {moeda(totalDescontos)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between border-t border-border pt-1 font-semibold">
                  <span>Líquido</span>
                  <span
                    className={
                      liquidoPrevisto > 0 ? "text-success" : "text-destructive"
                    }
                  >
                    {moeda(liquidoPrevisto)}
                  </span>
                </div>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Conta onde o líquido cai</Label>
                <Select value={contaId} onValueChange={setContaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Opcional" />
                  </SelectTrigger>
                  <SelectContent>
                    {contas
                      .filter((c) => c.account_type !== "credit_card")
                      .map((conta) => (
                        <SelectItem key={conta.id} value={conta.id}>
                          {conta.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Categoria da receita</Label>
                <Select value={categoriaId} onValueChange={setCategoriaId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Opcional" />
                  </SelectTrigger>
                  <SelectContent>
                    {categorias.map((categoria) => (
                      <SelectItem key={categoria.id} value={categoria.id}>
                        {categoria.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Com conta e categoria, o líquido vira um lançamento de receita.
              Sem eles, o contracheque fica guardado só como registro.
            </p>

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
                Salvar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
