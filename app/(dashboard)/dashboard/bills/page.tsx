"use client";

// Contas previstas e gastos fixos.
//
// A tela responde, em ordem: o que esta vencido, o que vence agora, quanto
// ainda sai este mes. E so depois disso oferece o cadastro -- quem abre esta
// tela quer saber se esqueceu de pagar algo, nao cadastrar.
//
// ESTA TELA ABRE SEM REDE (HMO-145), e aqui a frase errada era a mais cara do
// app inteiro: offline o `Promise.all` abaixo falhava, as listas ficavam
// vazias e a secao "Vencidas" imprimia **"Nada em atraso."** -- o app dizendo
// a alguem com tres boletos vencidos que esta tudo em dia, com um toast que
// some em cinco segundos como unica ressalva.
//
// A leitura agora vem classificada (`lib/offline-leitura.ts`): sem dado, o
// painel de sem-conexao SUBSTITUI os totais e as tres secoes. As frases de
// "nada previsto" exigem resposta do servidor de agora.

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
  Pencil,
  Plus,
  Repeat,
  SkipForward,
  Wallet,
} from "lucide-react";
import type { AlcanceDaEdicao } from "@/lib/recorrencia-edicao";
import { Receipts } from "@/components/Receipts";
import { ehFatura } from "@/lib/card-invoice";
import { copiaDaPrevisao, direcaoDaAgenda } from "@/lib/previsto-x-realizado";
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
  // De onde veio a agenda -- ela e a tela. Ver `lib/offline-leitura.ts`.
  const [estado, setEstado] = useState<EstadoDaLeitura | null>(null);
  const [guardadoEm, setGuardadoEm] = useState<Date | null>(null);
  const [estadoDoResumo, setEstadoDoResumo] = useState<EstadoDaLeitura | null>(
    null
  );
  const online = useEstaOnline();
  const [agindo, setAgindo] = useState<string | null>(null);
  const [dialogFixo, setDialogFixo] = useState(false);
  const [dialogAvulsa, setDialogAvulsa] = useState(false);
  // Fatura aguardando a escolha da conta pagadora (HMO-149).
  const [faturaParaPagar, setFaturaParaPagar] =
    useState<ScheduledTransaction | null>(null);
  const [contaPagadora, setContaPagadora] = useState("");

  // A ocorrencia em edicao e o alcance escolhido (HMO-170). O alcance volta para
  // "apenas_esta" a cada abertura: ele e a escolha mais conservadora, e herdar a
  // resposta da edicao anterior faria um acerto pontual reajustar a serie sem a
  // pessoa ter pedido de novo.
  const [contaParaEditar, setContaParaEditar] =
    useState<ScheduledTransaction | null>(null);
  const [formEdicao, setFormEdicao] = useState({ description: "", amount: "" });
  const [alcance, setAlcance] = useState<AlcanceDaEdicao>("apenas_esta");

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
    // Seis buscas, e o `Promise.all` de `fetch` cru tinha um efeito que nao
    // se ve lendo o codigo: basta UMA rejeitar para o catch engolir as outras
    // cinco. Sem rede as seis rejeitam, mas online bastava a rede oscilar em
    // qualquer uma delas para a tela inteira abrir vazia.
    //
    // `buscarLeitura` nao rejeita: cada busca volta com o seu proprio estado,
    // e uma nao derruba mais as outras.
    const [agenda, regras, cats, contas, resumo, gruposResp] = await Promise.all([
      buscarLeitura<{ scheduled?: ScheduledTransaction[] }>(
        "/api/scheduled-transactions?status=open"
      ),
      buscarLeitura<{ rules?: RecurringRule[] }>("/api/recurring-rules"),
      buscarLeitura<{ categories?: TransactionCategory[] }>(
        "/api/personal-finance/categories"
      ),
      buscarLeitura<{ accounts?: FinancialAccount[] }>("/api/financial-accounts"),
      buscarLeitura<{ fixed_monthly_cost?: number }>(
        "/api/scheduled-transactions/summary?months=1"
      ),
      buscarLeitura<{ groups?: { id: string; name: string }[] }>(
        "/api/expense-groups"
      ),
    ]);

    // A agenda e a tela: e dela que saem as tres secoes e os dois totais. O
    // estado dela e o estado da pagina.
    setEstado(agenda.estado);
    setGuardadoEm(agenda.guardadoEm);
    if (agenda.dados) setScheduled(agenda.dados.scheduled ?? []);

    if (regras.dados) setRules(regras.dados.rules ?? []);
    if (cats.dados) setCategories(cats.dados.categories ?? []);
    if (contas.dados) setAccounts(contas.dados.accounts ?? []);
    if (gruposResp.dados) setGruposDespesa(gruposResp.dados.groups ?? []);

    // O custo fixo tem estado PROPRIO porque vem de outro endereco: com o
    // cache do aparelho, a agenda pode estar guardada e o resumo nao. Um
    // estado so para a tela inteira mostraria este numero como bom apoiado na
    // resposta de outra busca.
    setEstadoDoResumo(resumo.estado);
    if (resumo.dados) setCustoFixo(resumo.dados.fixed_monthly_cost ?? 0);

    setLoading(false);
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

  // Os cabecalhos, separados por direcao (HMO-187).
  //
  // A soma crua de `conta.amount` juntava receita prevista e despesa prevista:
  // `scheduled_transactions.amount` tem CHECK amount > 0, entao o salario
  // previsto entrava em "Total em aberto" com o mesmo sinal do aluguel. Quem
  // cadastra o salario como regra recorrente via o numero inflar, e "Em atraso"
  // pintava de vermelho um salario que so estava esperando confirmacao de
  // recebimento (HMO-188).
  //
  // A direcao sai de `direcaoDaAgenda` sobre `conta.direction`, a coluna que a
  // view ja resolve (027) -- o mesmo caminho que /api/scheduled-transactions/
  // summary usa, para os dois numeros da mesma tela nao discordarem.
  const totais = useMemo(() => {
    const soma = (lista: ScheduledTransaction[], lado: "income" | "expense") =>
      lista
        .filter((conta) => direcaoDaAgenda(conta.direction) === lado)
        .reduce((total, conta) => total + Math.abs(Number(conta.amount)), 0);

    const emAberto = [...grupos.vencidas, ...grupos.semana, ...grupos.depois];

    return {
      vencidoAPagar: soma(grupos.vencidas, "expense"),
      vencidoAReceber: soma(grupos.vencidas, "income"),
      aPagar: soma(emAberto, "expense"),
      aReceber: soma(emAberto, "income"),
    };
  }, [grupos]);

  // Contas que podem pagar uma fatura: tudo que nao e cartao de credito.
  // Cartao pagando cartao nao existe neste app, e o proprio cartao pagando a
  // propria fatura faria as duas pernas se anularem -- a fatura ficaria paga
  // sem dinheiro nenhum ter saido. A API recusa os dois casos; o seletor nem
  // os oferece.
  const contasPagadoras = useMemo(
    () => accounts.filter((conta) => conta.account_type !== "credit_card"),
    [accounts]
  );

  const darBaixa = async (
    conta: ScheduledTransaction,
    contaPagadoraId?: string
  ) => {
    setAgindo(conta.id);
    try {
      const resposta = await fetch(`/api/scheduled-transactions/${conta.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paid_date: HOJE,
          ...(contaPagadoraId ? { payment_account_id: contaPagadoraId } : {}),
        }),
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível dar baixa");
        return;
      }

      // Pagar a fatura nao muda o patrimonio: a despesa foi a compra, e esta
      // baixa so move dinheiro da conta para o cartao. Quem acabou de pagar
      // R$ 1.000 e ve o patrimonio parado precisa ler isso de alguem -- senao
      // conclui que a tela nao registrou.
      if (dados.is_transfer) {
        toast.success(dados.message ?? `${conta.description} paga`, {
          description:
            "Transferência: saiu da conta e quitou o cartão. O patrimônio não muda — a despesa já foi contada nas compras.",
        });
      } else {
        // `dados.message` vem da rota, que e quem sabe a direcao de verdade (ela
        // le a precedencia ocorrencia -> regra -> expense). O fallback local usa
        // `conta.direction` da view, que diz a mesma coisa.
        toast.success(
          dados.message ??
            (conta.direction === "income"
              ? `${conta.description} recebida`
              : `${conta.description} paga`)
        );
      }

      setFaturaParaPagar(null);
      await carregar();
    } catch (erro) {
      console.error(erro);
      toast.error("Erro ao dar baixa");
    } finally {
      setAgindo(null);
    }
  };

  /** A fatura precisa da conta pagadora antes da baixa; o resto nao. */
  const pedirBaixa = (conta: ScheduledTransaction) => {
    if (ehFatura(conta.notes)) {
      setContaPagadora(contasPagadoras[0]?.id ?? "");
      setFaturaParaPagar(conta);
      return;
    }
    void darBaixa(conta);
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

  /** Abre o dialogo ja com os valores de hoje, para a pessoa corrigir um so. */
  const pedirEdicao = (conta: ScheduledTransaction) => {
    setFormEdicao({
      description: conta.description,
      amount: String(Number(conta.amount)),
    });
    setAlcance("apenas_esta");
    setContaParaEditar(conta);
  };

  /**
   * Grava a edicao no alcance escolhido (HMO-170).
   *
   * Quem decide quais linhas mudam e o servidor -- `lib/recorrencia-edicao.ts`
   * pelo `alcance` que vai aqui. A tela nao monta lista de ids: ela nem tem a
   * serie inteira carregada (a agenda vem filtrada por `status=open`), e montar
   * a lista aqui alteraria so o que esta na tela, deixando de fora os meses que
   * a pessoa nao rolou ate ver.
   */
  const salvarEdicao = async () => {
    const conta = contaParaEditar;
    if (!conta) return;

    const valor = Number(formEdicao.amount);
    if (!formEdicao.description.trim()) {
      toast.error("Informe a descrição");
      return;
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      toast.error("Valor deve ser maior que zero");
      return;
    }

    setAgindo(conta.id);
    try {
      const resposta = await fetch(`/api/scheduled-transactions/${conta.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: formEdicao.description.trim(),
          amount: valor,
          alcance,
        }),
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível alterar");
        return;
      }

      // A contagem do que ficou como estava e o que torna a garantia visivel:
      // "nunca muda o que ja passou" so tranquiliza quem VE o numero.
      const preservadas = Number(dados.preservadas ?? 0);
      toast.success(
        preservadas > 0
          ? `${dados.message} ${preservadas} anterior(es) ficaram como estavam.`
          : dados.message
      );

      setContaParaEditar(null);
      await carregar();
    } catch (erro) {
      console.error(erro);
      toast.error("Erro ao alterar a conta");
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
    // A palavra muda com a DIRECAO (HMO-188). `direction` vem resolvido da view
    // (027): o cliente nao refaz o COALESCE, senao a copia esquecida aqui
    // mostraria o salario previsto com um botao de "pagar".
    const copia = copiaDaPrevisao(conta.direction);
    // O comprovante fica fechado por padrao: a lista existe para responder "o
    // que falta pagar", e um bloco de anexo por conta afogaria essa resposta.
    const [anexosAbertos, setAnexosAbertos] = useState(false);

    return (
      <div className="border-b border-border py-3 last:border-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className="mt-1 h-8 w-1 rounded"
            style={{ backgroundColor: conta.category?.color_hex ?? "#94a3b8" }}
          />
          <div>
            <p className="font-medium text-foreground">{conta.description}</p>
            <p className="text-sm text-muted-foreground">
              {dataCurta(conta.due_date)}
              {conta.category ? ` · ${conta.category.name}` : ""}
              {conta.group ? ` · ${conta.group.name}` : ""}
              {conta.recurring_rule_id ? " · fixo" : ""}
              {ehFatura(conta.notes) ? " · fatura de cartão" : ""}
              {/* Sem este rotulo a receita prevista e INDISTINGUIVEL da conta a
                  pagar na lista: mesmo formato, mesmo valor positivo, mesmo
                  badge de vencimento. O botao muda de titulo, mas titulo de
                  botao so aparece no hover -- e no celular, nunca. */}
              {conta.direction === "income" ? " · a receber" : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:justify-end">
          <div className="text-right">
            <p className="font-semibold text-foreground">{moeda(Number(conta.amount))}</p>
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
              onClick={() => pedirBaixa(conta)}
              disabled={agindo === conta.id || !online}
              title={
                ehFatura(conta.notes)
                  ? "Pagar a fatura (escolher a conta)"
                  : copia.confirmar
              }
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
              onClick={() => pedirEdicao(conta)}
              disabled={agindo === conta.id || !online}
              title={
                conta.recurring_rule_id
                  ? "Alterar (só esta ou as próximas)"
                  : "Alterar esta conta"
              }
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => pular(conta)}
              disabled={agindo === conta.id || !online}
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
          <div className="mt-3 rounded-md bg-muted p-3">
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
          <span className="text-sm font-normal text-muted-foreground">({contas.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {contas.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{vazio}</p>
        ) : (
          contas.map((conta) => <Linha key={conta.id} conta={conta} />)
        )}
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-info" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Contas Previstas</h1>
          <p className="text-sm text-muted-foreground">
            O que ainda vai sair, e os gastos que se repetem todo mês.
          </p>
        </div>

        <div className="flex gap-2">
          <Dialog open={dialogAvulsa} onOpenChange={setDialogAvulsa}>
            <DialogTrigger asChild>
              {/* Cadastrar precisa de rede: o formulario tem sete campos, e
                  perde-los no botao Salvar e pior do que o botao apagado. */}
              <Button variant="outline" disabled={!online}>
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
                    <CampoDeValor
                      value={formAvulsa.amount}
                      onChange={(amount) =>
                        setFormAvulsa((atual) => ({ ...atual, amount }))
                      }
                      aria-label="Valor da conta avulsa"
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
              <Button disabled={!online}>
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
                    <CampoDeValor
                      value={formFixo.amount}
                      onChange={(amount) =>
                        setFormFixo((atual) => ({ ...atual, amount }))
                      }
                      aria-label="Valor da conta fixa"
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
                    <p className="mt-1 text-xs text-muted-foreground">
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

      {estado === "do-aparelho" && (
        <FaixaDadoDoAparelho
          guardadoEm={guardadoEm}
          soLeitura
          aoTentarDeNovo={carregar}
        />
      )}

      {estado === "sem-rede" ? (
        <PainelSemRede
          oQue="as contas previstas"
          aoTentarDeNovo={carregar}
        />
      ) : estado === "erro-do-servidor" ? (
        <PainelErroDoServidor
          oQue="as contas previstas"
          aoTentarDeNovo={carregar}
        />
      ) : (
        <>
      {/* grid-cols-1 explicito: sem ele o `grid` estoura a largura no celular
          e a pagina ganha scroll horizontal. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            {/* "a pagar" no rotulo, e nao so "Em atraso": o cartao passou a
                contar apenas a perna de despesa, e sem a palavra a mudanca de
                numero pareceria dado sumindo. */}
            <CardDescription>Em atraso a pagar</CardDescription>
            <CardTitle className="text-2xl text-destructive">
              {podeMostrarNumero(estado) ? (
                moeda(totais.vencidoAPagar)
              ) : (
                <NumeroIndisponivel />
              )}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total a pagar</CardDescription>
            <CardTitle className="text-2xl">
              {podeMostrarNumero(estado) ? (
                moeda(totais.aPagar)
              ) : (
                <NumeroIndisponivel />
              )}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            {/* O contrapeso do cartao anterior. Sem ele, separar as direcoes
                faria a receita prevista sumir da tela -- e quem cadastrou o
                salario concluiria que o app o perdeu.

                `vencidoAReceber` aparece como nota e nao como cartao proprio:
                receita atrasada e atraso de QUEM PAGA voce, nao divida sua, e
                um quinto cartao vermelho diria o contrario. */}
            <CardDescription>Total a receber</CardDescription>
            <CardTitle className="text-2xl">
              {podeMostrarNumero(estado) ? (
                moeda(totais.aReceber)
              ) : (
                <NumeroIndisponivel />
              )}
            </CardTitle>
            {podeMostrarNumero(estado) && totais.vencidoAReceber > 0 && (
              <p className="text-xs text-muted-foreground">
                {moeda(totais.vencidoAReceber)} já venceu
              </p>
            )}
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Custo fixo mensal</CardDescription>
            {/* Estado proprio: este numero vem de outro endereco, e pode
                faltar com a agenda presente (ou o contrario). */}
            <CardTitle className="text-2xl">
              {podeMostrarNumero(estadoDoResumo) ? (
                moeda(custoFixo)
              ) : (
                <NumeroIndisponivel />
              )}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/*
        As tres frases de vazio passaram a depender de `podeAfirmarVazio`. A
        primeira delas, "Nada em atraso.", e a razao desta tela ter ficado
        fora do precache ate aqui: dita sem dado, ela e o app afirmando que
        voce nao deve nada.
      */}
      <Secao
        titulo="Vencidas"
        icone={<AlertCircle className="h-4 w-4 text-destructive" />}
        contas={grupos.vencidas}
        vazio={
          podeAfirmarVazio(estado)
            ? "Nada em atraso."
            : "Não dá para conferir o que está em atraso agora."
        }
      />
      <Secao
        titulo="Próximos 7 dias"
        icone={<CalendarClock className="h-4 w-4 text-warning" />}
        contas={grupos.semana}
        vazio={
          podeAfirmarVazio(estado)
            ? "Nenhuma conta vence nesta semana."
            : "Não dá para conferir a semana agora."
        }
      />
      <Secao
        titulo="Mais adiante"
        icone={<Wallet className="h-4 w-4 text-info" />}
        contas={grupos.depois}
        vazio={
          podeAfirmarVazio(estado)
            ? "Nada previsto no período."
            : "Não dá para conferir o período agora."
        }
      />

      {rules.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Repeat className="h-4 w-4 text-muted-foreground" />
              Gastos fixos ativos
              <span className="text-sm font-normal text-muted-foreground">({rules.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {rules.map((regra) => (
              <div
                key={regra.id}
                className="flex items-center justify-between border-b border-border py-2 last:border-0"
              >
                <div>
                  <p className="font-medium text-foreground">{regra.description}</p>
                  <p className="text-sm text-muted-foreground">
                    {FREQUENCIAS.find((f) => f.valor === regra.frequency)?.rotulo ?? regra.frequency}
                    {regra.due_day ? ` · dia ${regra.due_day}` : ""}
                    {regra.category ? ` · ${regra.category.name}` : ""}
                  </p>
                </div>
                <p className="font-semibold text-foreground">{moeda(Number(regra.amount))}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
        </>
      )}

      {/* Pagamento de fatura: a unica baixa que pergunta algo antes (HMO-149).
          A fatura nao e um gasto novo -- a compra ja foi o gasto. O que falta
          saber e DE ONDE o dinheiro saiu, e nao havia como adivinhar: e por
          isso que a baixa antiga lancava tudo no proprio cartao e contava a
          despesa duas vezes. */}
      <Dialog
        open={faturaParaPagar !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setFaturaParaPagar(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pagar a fatura</DialogTitle>
          </DialogHeader>

          {faturaParaPagar && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border p-3">
                <p className="font-medium text-foreground">
                  {faturaParaPagar.description}
                </p>
                <p className="text-sm text-muted-foreground">
                  {moeda(Number(faturaParaPagar.amount))} · vence em{" "}
                  {dataCurta(faturaParaPagar.due_date)}
                </p>
              </div>

              {contasPagadoras.length === 0 ? (
                <p className="text-sm text-destructive">
                  Você não tem nenhuma conta que possa pagar a fatura. Cadastre
                  uma conta corrente, poupança ou carteira em Contas — cartão de
                  crédito não paga cartão de crédito.
                </p>
              ) : (
                <>
                  <div>
                    <Label>De qual conta o dinheiro saiu? *</Label>
                    <Select
                      value={contaPagadora}
                      onValueChange={setContaPagadora}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {contasPagadoras.map((conta) => (
                          <SelectItem key={conta.id} value={conta.id}>
                            {conta.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <p className="text-xs text-muted-foreground">
                    Pagar a fatura não é um gasto novo: as compras já foram
                    contadas no mês em que você fez cada uma. Esta baixa tira o
                    dinheiro da conta escolhida e quita a dívida do cartão, então
                    seu patrimônio fica igual — e é isso que estava errado antes.
                  </p>

                  <Button
                    className="w-full"
                    disabled={!contaPagadora || agindo === faturaParaPagar.id}
                    onClick={() => darBaixa(faturaParaPagar, contaPagadora)}
                  >
                    {agindo === faturaParaPagar.id && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Confirmar pagamento
                  </Button>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ALTERAR UMA OCORRENCIA, E ATE ONDE (HMO-170) */}
      <Dialog
        open={contaParaEditar !== null}
        onOpenChange={(aberto) => !aberto && setContaParaEditar(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Alterar conta prevista</DialogTitle>
          </DialogHeader>

          {contaParaEditar && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edicao-descricao">Descrição</Label>
                <Input
                  id="edicao-descricao"
                  value={formEdicao.description}
                  onChange={(e) =>
                    setFormEdicao((f) => ({ ...f, description: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="edicao-valor">Valor</Label>
                <CampoDeValor
                  id="edicao-valor"
                  value={formEdicao.amount}
                  onChange={(amount) => setFormEdicao((f) => ({ ...f, amount }))}
                />
              </div>

              {/* A escolha so existe quando ha serie. Numa conta avulsa nao ha
                  "proximas", e oferecer a pergunta faria a pessoa procurar uma
                  diferenca entre duas opcoes que fazem a mesma coisa. */}
              {contaParaEditar.recurring_rule_id ? (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <Label>Esta alteração vale para</Label>
                  <Select
                    value={alcance}
                    onValueChange={(v) => setAlcance(v as AlcanceDaEdicao)}
                  >
                    <SelectTrigger id="edicao-alcance">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="apenas_esta">
                        Apenas esta ({dataCurta(contaParaEditar.due_date)})
                      </SelectItem>
                      <SelectItem value="esta_e_proximas">
                        Esta e as próximas
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {alcance === "apenas_esta"
                      ? "Só este mês muda. O gasto fixo continua com o valor de hoje."
                      : "Muda este mês, os seguintes ainda em aberto e o próprio gasto fixo. Meses anteriores e já pagos não são alterados."}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Conta avulsa: a alteração vale só para ela.
                </p>
              )}

              <Button
                className="w-full"
                disabled={agindo === contaParaEditar.id}
                onClick={salvarEdicao}
              >
                {agindo === contaParaEditar.id && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Salvar alteração
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
