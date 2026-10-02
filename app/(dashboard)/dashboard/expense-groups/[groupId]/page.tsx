"use client";

import { useCallback, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CampoDeValor } from "@/components/ui/campo-de-valor";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { toast } from "sonner";
import {
  ArrowLeft,
  Plus,
  Calendar,
  DollarSign,
  Users,
  TrendingUp,
  ChevronDown,
  ChevronRight,
  Receipt,
  Calculator,
  Crown,
  AlertCircle,
  CheckCircle,
  Clock,
} from "lucide-react";
import SplitSuggestions, {
  type SplitSuggestion,
} from "@/components/financial/SplitSuggestions";
import { CartaoOrcamentoGrupo } from "@/components/financial/CartaoOrcamentoGrupo";
import {
  orcamentoDoGrupo,
  type GrupoOrcado,
} from "@/lib/orcamento-de-grupo";
import type { BudgetWithConsumption } from "@/types/financial";
import { CampoDeCotacao } from "@/components/movimentacoes/CampoDeCotacao";
import { MOEDA_PADRAO, formatarValor, moedaPorCodigo } from "@/lib/dinheiro";
import { opcoesDeMoeda } from "@/lib/moeda";
import {
  acoesDaParte,
  ehParteDe,
  rotuloDaAcao,
  type AcaoDaParte,
} from "@/lib/aprovacao-de-parte";
import { cotacaoDigitada, taxaParaGravar, valorEmReais } from "@/lib/cambio";
import { PixDoMembro, useChavesPixDoGrupo } from "@/components/grupos/PixDoMembro";
import { PainelDoGrupo } from "@/components/grupos/PainelDoGrupo";
import {
  acertoNaMoedaDaViagem,
  avisoDeSobra,
  avisoSemConversao,
  moedaDaViagem,
  moedaSugeridaDaDespesa,
  rotuloDaConversao,
  saldoNaMoedaDaViagem,
} from "@/lib/moeda-do-grupo";

interface ExpenseGroup {
  id: string;
  name: string;
  description: string;
  group_code: string;
  group_type: "public" | "private";
  default_split_type: "equal" | "percentage" | "custom" | "proportional";
  /** A moeda da viagem (`expense_groups.currency`, migration 026). */
  currency?: string | null;
  photo_url?: string;
  created_at: string;
  creator?: {
    full_name: string;
    avatar_url?: string;
  };
  members?: GroupMember[];
  /**
   * Quem pediu para entrar pelo codigo e ainda aguarda o admin (HMO-190).
   * Nunca entra em `members`: pendente nao e membro e nao divide despesa.
   */
  pendingMembers?: GroupMember[];
}

interface GroupMember {
  id: string;
  role: "admin" | "member";
  status: "active" | "inactive" | "pending" | "removed";
  percentage: number;
  user: {
    id: string;
    full_name: string;
    avatar_url?: string;
  };
}

interface GroupTransaction {
  id: string;
  description: string;
  /** NESTA moeda (`currency`), nunca em real. Ver `exchange_rate`. */
  amount: number;
  /** A moeda da despesa (022). Ausente em resposta mais antiga que a tela. */
  currency?: string | null;
  /**
   * A cotacao congelada do dia da compra (026). `amount * exchange_rate` e o
   * valor em real -- a mesma conta que `group_member_balances` faz.
   */
  exchange_rate?: number | null;
  transaction_date: string;
  created_at: string;
  payer: {
    id: string;
    full_name: string;
    avatar_url?: string;
  };
  splits: {
    id: string;
    amount: number;
    percentage: number;
    status: "pending" | "approved" | "rejected";
    member: {
      id: string;
      full_name: string;
      avatar_url?: string;
    };
  }[];
  category?: {
    name: string;
    icon: string;
  };
}

/**
 * Uma despesa do grupo que ainda NAO aconteceu: conta prevista com `group_id`.
 *
 * Nao tem `splits`, e a diferenca importa. A divisao de verdade so existe
 * depois que a transacao nasce (na baixa), entao aqui `share_amount` e o que
 * cada membro VAI dever -- calculado pela mesma regra que o trigger usa, e nao
 * uma divida que alguem ja possa aprovar ou recusar.
 */
interface GroupScheduled {
  id: string;
  description: string;
  amount: number;
  share_amount: number;
  due_date: string;
  status: "pending" | "overdue" | "paid" | "cancelled";
  is_overdue: boolean;
  days_until_due: number;
  is_recurring: boolean;
  payer: {
    id: string;
    full_name: string;
    avatar_url?: string;
  } | null;
  category?: {
    name: string;
    icon?: string;
  } | null;
}

interface BalanceSummary {
  member: {
    id: string;
    full_name: string;
    avatar_url?: string;
  };
  balance: number; // Positivo = a receber, Negativo = deve pagar
  transactions_count: number;
}

interface TransferSuggestion {
  from: {
    id: string;
    full_name: string;
    avatar_url?: string;
  };
  to: {
    id: string;
    full_name: string;
    avatar_url?: string;
  };
  amount: number;
}

/**
 * Como a tela apresenta o saldo do grupo (migration 026, HMO-182).
 *
 * `amount_currency` e a moeda dos NUMEROS (BRL) e `group_currency` e a moeda da
 * VIAGEM. As duas vem da view; `today_rate` e a cotacao de hoje que a rota
 * buscou, e ela e `null` sem drama (grupo em real, PTAX sem cobertura, Banco
 * Central fora do ar). `null` significa "mostre em real", nunca "use 1".
 */
interface ContextoDeMoeda {
  amount_currency: string;
  group_currency: string;
  today_rate: number | null;
  today_rate_date: string | null;
  today: string;
}

/** Um pagamento de um membro para outro, ja registrado (migration 007). */
interface Settlement {
  id: string;
  amount: number;
  /** A moeda em que o pagamento foi feito de verdade (026). */
  currency?: string | null;
  /** A cotacao congelada no dia do pagamento (026). */
  exchange_rate?: number | null;
  /** `amount * exchange_rate`: o que este pagamento abateu da dívida, em real. */
  amount_in_brl?: number | null;
  settled_on: string;
  note?: string | null;
  from_user: { id: string; full_name: string; avatar_url?: string };
  to_user: { id: string; full_name: string; avatar_url?: string };
  /** A RLS so deixa desfazer quem registrou; a API ja resolve isto. */
  can_delete: boolean;
}

/**
 * Inicial do nome para o avatar.
 *
 * `full_name` e opcional em profiles e chega null para quem nunca preencheu o
 * perfil. `null.charAt(0)` derruba a tela inteira com "Cannot read properties
 * of null" -- e a pessoa sem nome aparece justamente na tela de grupo, que e
 * onde entram os convidados recem-chegados.
 */
const inicial = (nome?: string | null) =>
  nome && nome.length > 0 ? nome.charAt(0).toUpperCase() : "?";

export default function GroupDetailPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.groupId as string;

  const [user, setUser] = useState<User | null>(null);
  const [group, setGroup] = useState<ExpenseGroup | null>(null);
  // Id do pedido de entrada em processamento, para travar os dois botoes
  // daquela linha so (HMO-190).
  const [respondendoPedido, setRespondendoPedido] = useState<string | null>(
    null
  );
  const [transactions, setTransactions] = useState<GroupTransaction[]>([]);
  const [scheduled, setScheduled] = useState<GroupScheduled[]>([]);
  const [balances, setBalances] = useState<BalanceSummary[]>([]);
  const [transfers, setTransfers] = useState<TransferSuggestion[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  /**
   * As chaves Pix dos membros, para quem esta A RECEBER poder ser pago
   * (HMO-201). Sai dos `balances` e nao de `group.members` porque e na lista
   * de saldos que a chave e mostrada, e assim a consulta acompanha exatamente
   * as linhas que a tela vai desenhar. A RLS da migration 032 decide o que
   * volta; membro sem chave cadastrada simplesmente nao aparece no mapa.
   */
  const chavesPix = useChavesPixDoGrupo(balances.map((b) => b.member.id));
  /**
   * O id da parte cuja resposta esta em voo, para desabilitar os botoes DELA.
   * Um booleano global desabilitaria a linha de todo mundo; um id mantem o
   * resto da tela utilizavel enquanto a requisicao vai e volta.
   */
  const [parteEmCurso, setParteEmCurso] = useState<string | null>(null);
  // A barra "quanto ja gastamos da viagem" (HMO-180). `null` = este grupo nao
  // tem teto no mes corrente, e o cartao nem aparece -- mesma regra das
  // Previstas: grupo sem teto continua vendo a tela de antes.
  const [orcamento, setOrcamento] =
    useState<GrupoOrcado<BudgetWithConsumption> | null>(null);
  // O mes que a RESPOSTA trouxe, nao o que a tela pediu: e ele que rotula a
  // barra, e a tela nao pede mes nenhum (a rota resolve o corrente).
  const [mesDoOrcamento, setMesDoOrcamento] = useState("");
  // Sobra que nao pertence a ninguem. Zero em grupo saudavel.
  const [residual, setResidual] = useState(0);
  // Nasce em real nos dois campos e sem cotacao: e o estado correto enquanto a
  // rota nao respondeu, e e o estado FINAL de todo grupo em real. Um `null`
  // inicial obrigaria cada leitura da tela a tratar o caso, e a tentacao seria
  // tratar com `?? 1` -- a cotacao proibida.
  const [contextoDeMoeda, setContextoDeMoeda] = useState<ContextoDeMoeda>({
    amount_currency: MOEDA_PADRAO,
    group_currency: MOEDA_PADRAO,
    today_rate: null,
    today_rate_date: null,
    today: new Date().toISOString().slice(0, 10),
  });
  // Chave "pagador->recebedor" da linha em que o botao esta rodando, para nao
  // registrar o mesmo acerto duas vezes num clique duplo -- o banco aceita
  // pagamentos repetidos de proposito (duas parcelas de R$ 50 sao um fato
  // possivel), entao a protecao contra o clique acidental e aqui.
  const [settling, setSettling] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("expenses");

  // Estados do formulário de nova despesa
  const [showAddExpense, setShowAddExpense] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    description: "",
    amount: "",
    category_id: "",
    transaction_date: new Date().toISOString().split("T")[0],
    notes: "",
    split_type: "equal" as "equal" | "percentage" | "custom",
    // Nasce em real e passa para a moeda do grupo quando o grupo carrega (ver o
    // efeito abaixo). Nao da para inicializar com a moeda do grupo aqui: neste
    // ponto `group` ainda e null.
    currency: MOEDA_PADRAO,
    // A cotacao do dia da compra, como TEXTO -- e o que `CampoDeCotacao`
    // manipula, e aceitar virgula depende de a leitura ser de texto.
    cotacao: "",
  });
  const [selectedSplitSuggestion, setSelectedSplitSuggestion] =
    useState<SplitSuggestion | null>(null);

  // Estados dos accordions
  // "scheduled" comece aberta: a despesa fixa de grupo era invisivel nesta tela
  // (HMO-177), e nascer fechada atras de um clique repetiria o sintoma.
  const [openSections, setOpenSections] = useState<string[]>([
    "scheduled",
    "current",
  ]);

  // Os sete `load*` abaixo sao `useCallback` porque `loadData` chama todos, e
  // com funcao recriada a cada render a dependencia dele nunca estabilizaria --
  // o efeito voltaria a rodar em cada render e recarregaria a tela em laco. As
  // dependencias sao `groupId` (string) e `router` (estavel no App Router).
  const loadGroup = useCallback(async () => {
    const response = await fetch(`/api/expense-groups/${groupId}`);
    const data = await response.json();

    if (response.ok) {
      setGroup(data.group);
    } else {
      toast.error(data.error || "Erro ao carregar grupo");
      router.push("/dashboard/expense-groups");
    }
  }, [groupId, router]);

  /**
   * Aprova ou recusa quem entrou com o codigo do grupo (HMO-190). Em grupo
   * privado a entrada por codigo nasce `pending` e so vira membro aqui.
   */
  const handleResponderPedido = async (
    memberId: string,
    action: "approve" | "reject"
  ) => {
    setRespondendoPedido(memberId);
    try {
      const response = await fetch(
        `/api/expense-groups/${groupId}/members/${memberId}/approve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        }
      );
      const data = await response.json();

      if (response.ok) {
        toast.success(data.message);
        // Recarrega o grupo: o aprovado sai de `pendingMembers` e entra em
        // `members`, e as duas listas da tela vem da mesma resposta.
        await loadGroup();
      } else {
        toast.error(data.error || "Erro ao responder ao pedido");
      }
    } catch (error) {
      console.error("Error responding to join request:", error);
      toast.error("Erro ao responder ao pedido");
    } finally {
      setRespondendoPedido(null);
    }
  };

  const loadTransactions = useCallback(async () => {
    const response = await fetch(`/api/expense-groups/${groupId}/transactions`);
    const data = await response.json();

    if (response.ok) {
      setTransactions(data.transactions || []);
    } else {
      console.error("Error loading transactions:", data.error);
    }
  }, [groupId]);

  // A despesa "fixa" do grupo nao existe em group_transactions ate a baixa da
  // conta prevista -- ate entao ela era invisivel aqui (HMO-177).
  const loadScheduled = useCallback(async () => {
    const response = await fetch(`/api/expense-groups/${groupId}/scheduled`);
    const data = await response.json();

    if (response.ok) {
      setScheduled(data.scheduled || []);
    } else {
      console.error("Error loading scheduled:", data.error);
    }
  }, [groupId]);

  const loadBalances = useCallback(async () => {
    const response = await fetch(`/api/expense-groups/${groupId}/balances`);
    const data = await response.json();

    if (response.ok) {
      setBalances(data.balances || []);
      // A moeda da viagem e a cotacao de hoje chegam junto com o saldo, na mesma
      // resposta, de proposito: uma segunda chamada poderia responder depois e a
      // tela ficaria um instante mostrando o saldo em real sob o rotulo da moeda
      // da viagem -- que e uma afirmacao falsa, ainda que breve.
      setContextoDeMoeda({
        amount_currency: data.amount_currency || MOEDA_PADRAO,
        group_currency: moedaDaViagem(data.group_currency),
        today_rate:
          typeof data.today_rate === "number" ? data.today_rate : null,
        today_rate_date: data.today_rate_date || null,
        today: data.today || new Date().toISOString().slice(0, 10),
      });
    } else {
      console.error("Error loading balances:", data.error);
    }
  }, [groupId]);

  const loadTransfers = useCallback(async () => {
    const response = await fetch(`/api/expense-groups/${groupId}/transfers`);
    const data = await response.json();

    if (response.ok) {
      setTransfers(data.transfers || []);
      // Diferente de zero: o grupo nao fecha. Ver a nota de `residual` em
      // lib/settlement.ts -- despesa sem rateio, rateio parcial, ou parte no
      // nome de quem ja saiu. Sem este aviso o usuario tentaria acertar uma
      // conta que nao tem como terminar.
      setResidual(Number(data.residual) || 0);
    } else {
      console.error("Error loading transfers:", data.error);
    }
  }, [groupId]);

  /**
   * O teto da viagem no mes corrente (HMO-180).
   *
   * A pergunta "quanto ja gastamos da viagem" e feita AQUI, e ate a HMO-180 a
   * resposta morava so em Orcamento > Grupo -- a pessoa tinha que sair desta
   * tela para responder o que estava perguntando nela.
   *
   * A soma NAO e refeita aqui. Ela sai de `separarOrcamentos`, a mesma funcao
   * que a rota e a tela de Orcamento usam, atraves de `orcamentoDoGrupo`. Um
   * `reduce` sobre `data.budgets` no JSX daria o mesmo numero hoje e divergiria
   * no dia em que uma das duas mudasse -- e o sintoma seria duas telas com
   * percentuais diferentes para a mesma viagem, sem erro nenhum aparecer.
   *
   * Falha em silencio de proposito: sem teto cadastrado a rota devolve lista
   * vazia, que e indistinguivel de erro para quem esta olhando a tela -- nos
   * dois casos nao ha barra a mostrar, e um toast de erro sobre um cartao
   * opcional so assustaria. O console guarda o motivo.
   */
  const loadOrcamento = useCallback(async () => {
    const response = await fetch(`/api/budgets?group_id=${groupId}`);
    const data = await response.json();

    if (response.ok) {
      setOrcamento(orcamentoDoGrupo(data.budgets ?? [], groupId));
      setMesDoOrcamento(data.month ?? "");
    } else {
      console.error("Error loading orçamento:", data.error);
    }
  }, [groupId]);

  const loadSettlements = useCallback(async () => {
    const response = await fetch(`/api/expense-groups/${groupId}/settlements`);
    const data = await response.json();

    if (response.ok) {
      setSettlements(data.settlements || []);
    } else {
      console.error("Error loading settlements:", data.error);
    }
  }, [groupId]);

  // `loadData` mora DEPOIS dos sete, e nao antes como estava: o array de
  // dependencias e avaliado durante o render, entao com ele la em cima o
  // `loadGroup` ainda nao existia -- `ReferenceError`, nao aviso de lint. O
  // `tsc` acusou (TS2448) na primeira tentativa.
  const loadData = useCallback(async () => {
    try {
      // Dentro do callback para nao virar dependencia dele: o resto da tela
      // conversa com as rotas, nao com o Supabase direto.
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      setUser(user);

      // Carregar dados do grupo
      await Promise.all([
        loadGroup(),
        loadTransactions(),
        loadScheduled(),
        loadBalances(),
        loadTransfers(),
        loadSettlements(),
        loadOrcamento(),
      ]);
    } catch (error) {
      console.error("Error loading data:", error);
      toast.error("Erro ao carregar dados do grupo");
    } finally {
      setLoading(false);
    }
  }, [
    router,
    loadGroup,
    loadTransactions,
    loadScheduled,
    loadBalances,
    loadTransfers,
    loadSettlements,
    loadOrcamento,
  ]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  /**
   * Registra a transferencia sugerida como paga.
   *
   * Recarrega saldos, sugestoes e historico juntos: os tres derivam do mesmo
   * dado, e atualizar so um deixaria a tela mostrando uma divida que a lista de
   * baixo ja diz estar quitada.
   */
  const handleLiquidar = async (
    transfer: TransferSuggestion,
    /**
     * `"brl"` registra a divida como ela e -- exata, sem sobra. `"viagem"`
     * registra o pagamento na moeda da viagem, ao cambio de hoje, que e o que
     * acontece de verdade quando se paga o amigo em dolar no fim da viagem.
     *
     * O padrao e `"brl"` porque ele nunca deixa centavo em aberto. O caminho da
     * moeda estrangeira quase sempre deixa (a cotacao nao divide redondo), e por
     * isso ele so aparece quando ha cotacao e vem com o aviso de sobra.
     */
    onde: "brl" | "viagem" = "brl"
  ) => {
    const acerto = acertoNaMoedaDaViagem(
      transfer.amount,
      onde === "viagem" ? contextoDeMoeda.group_currency : MOEDA_PADRAO,
      onde === "viagem" ? contextoDeMoeda.today_rate : 1
    );

    // `null` aqui e o que segura o POST de sair sem cotacao e tomar 23514 na
    // cara de quem esta registrando um pagamento que ja foi feito.
    if (!acerto) {
      toast.error(
        "Não consegui a cotação de hoje para registrar nesta moeda. Registre em reais."
      );
      return;
    }

    setSettling(`${transfer.from.id}->${transfer.to.id}`);
    try {
      const response = await fetch(
        `/api/expense-groups/${groupId}/settlements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from_user_id: transfer.from.id,
            to_user_id: transfer.to.id,
            // `amount` esta na moeda de `currency`, nunca em real -- a view faz
            // `amount * exchange_rate` para chegar ao que foi abatido.
            amount: acerto.amount,
            currency: acerto.currency,
            exchange_rate: acerto.exchange_rate,
          }),
        }
      );
      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Não foi possível registrar o acerto");
        return;
      }

      // A sobra e dita DEPOIS de gravar tambem, e nao so no botao: quem confirmou
      // rapido precisa saber que ficou (ou sobrou) centavo, senao o saldo
      // teimoso da proxima tela nao tem explicacao.
      const sobra = avisoDeSobra(acerto);
      toast.success(
        sobra
          ? `Acerto registrado. ${sobra}`
          : "Acerto registrado"
      );
      await Promise.all([loadBalances(), loadTransfers(), loadSettlements()]);
    } catch (error) {
      console.error("Erro ao registrar acerto:", error);
      toast.error("Não foi possível registrar o acerto");
    } finally {
      setSettling(null);
    }
  };

  const handleDesfazerAcerto = async (settlementId: string) => {
    try {
      const response = await fetch(
        `/api/expense-groups/${groupId}/settlements/${settlementId}`,
        { method: "DELETE" }
      );
      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Não foi possível desfazer o acerto");
        return;
      }

      toast.success("Acerto desfeito");
      await Promise.all([loadBalances(), loadTransfers(), loadSettlements()]);
    } catch (error) {
      console.error("Erro ao desfazer acerto:", error);
      toast.error("Não foi possível desfazer o acerto");
    }
  };

  /**
   * Responde pela propria parte numa despesa do grupo (HMO-178).
   *
   * Recarrega saldos e sugestoes junto com a lista, e nao so a lista: recusar
   * tira a parte de `total_owed` em `group_member_balances`. Atualizar so o
   * cracha deixaria a tela mostrando "recusado" ao lado de um saldo que ainda
   * cobra aquele valor -- duas afirmacoes contraditorias na mesma tela, sem
   * erro nenhum aparecer.
   *
   * `residual` costuma ficar diferente de zero depois de uma recusa, e isso
   * esta certo: a despesa passa a estar rateada por menos gente do que o total.
   * O aviso que `loadTransfers` ja traz e quem conta isso.
   */
  const handleResponderParte = async (splitId: string, acao: AcaoDaParte) => {
    // A recusa e a unica que pede motivo, e o motivo e opcional: cancelar o
    // prompt (`null`) aborta a acao inteira, string vazia segue sem comentario.
    let comments: string | undefined;
    if (acao === "reject") {
      const motivo = window.prompt(
        "Por que está recusando esta parte? (opcional)"
      );
      if (motivo === null) return;
      comments = motivo.trim() || undefined;
    }

    setParteEmCurso(splitId);
    try {
      const response = await fetch(`/api/expense-groups/${groupId}/splits`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ splitId, action: acao, comments }),
      });
      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Não foi possível atualizar a parte");
        // Mesmo no erro a lista e recarregada: o 409 quer dizer que a parte
        // mudou por baixo, e deixar o cracha velho na tela repetiria o engano.
        await loadTransactions();
        return;
      }

      toast.success(
        acao === "approve"
          ? "Parte aprovada"
          : acao === "reject"
            ? "Parte recusada"
            : "Parte reaberta"
      );
      await Promise.all([loadTransactions(), loadBalances(), loadTransfers()]);
    } catch (error) {
      console.error("Erro ao responder a parte:", error);
      toast.error("Não foi possível atualizar a parte");
    } finally {
      setParteEmCurso(null);
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!expenseForm.description.trim() || !expenseForm.amount) {
      toast.error("Preencha descrição e valor");
      return;
    }

    // A cotacao do dia da compra. `taxaParaGravar` devolve `null` quando a moeda
    // e estrangeira e o que esta no campo nao serve -- vazio, NaN, zero, ou o 1
    // que o CHECK da 026 proibe. Barrar aqui e o que troca um 23514 do banco
    // ("Erro ao gravar") por uma frase que diz qual campo falta.
    const taxa = taxaParaGravar(
      expenseForm.currency,
      cotacaoDigitada(expenseForm.cotacao)
    );

    if (taxa === null) {
      toast.error(
        `Informe a cotação de ${expenseForm.currency} no dia da compra.`
      );
      return;
    }

    // "Por Percentual" e "Customizada" precisam de uma divisao escolhida, e
    // quem fornece os numeros e o painel de sugestoes logo abaixo do seletor.
    // Sem isso a rota devolve 400 -- o que e certo, mas chega depois de a
    // pessoa ter preenchido tudo. Antes da HMO-190 nao chegava nem o 400: a
    // despesa era gravada em partes IGUAIS e a tela dizia "Despesa adicionada
    // com sucesso!", que e o relato desta issue.
    if (expenseForm.split_type !== "equal" && !selectedSplitSuggestion) {
      toast.error(
        "Escolha uma das divisões sugeridas abaixo, ou use a Divisão Igual."
      );
      return;
    }

    try {
      // Preparar dados da despesa
      const expenseData: Record<string, unknown> = {
        ...expenseForm,
        amount: parseFloat(expenseForm.amount),
        currency: expenseForm.currency,
        // O numero, e nao o texto do campo: `cotacao` sai do payload junto com o
        // resto do spread e seria uma string com virgula no corpo do POST.
        exchange_rate: taxa,
      };
      delete expenseData.cotacao;

      // Adicionar dados da sugestão selecionada se houver
      if (selectedSplitSuggestion) {
        expenseData.split_type = selectedSplitSuggestion.type;
        expenseData.custom_splits = selectedSplitSuggestion.splits.map(
          (split) => ({
            member_id: split.member_id,
            percentage: split.percentage,
            amount: split.amount,
          })
        );
      }

      const response = await fetch(
        `/api/expense-groups/${groupId}/transactions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(expenseData),
        }
      );

      const data = await response.json();

      if (response.ok) {
        toast.success("Despesa adicionada com sucesso!");
        setShowAddExpense(false);
        setExpenseForm({
          description: "",
          amount: "",
          category_id: "",
          transaction_date: new Date().toISOString().split("T")[0],
          notes: "",
          split_type: "equal",
          // Volta para a moeda do grupo, nao para real: a proxima despesa da
          // viagem tambem e na moeda da viagem.
          currency: moedaSugeridaDaDespesa(group?.currency, null),
          cotacao: "",
        });
        setSelectedSplitSuggestion(null);
        await loadTransactions();
        await loadBalances();
        await loadTransfers();
      } else {
        toast.error(data.error || "Erro ao adicionar despesa");
      }
    } catch (error) {
      console.error("Error adding expense:", error);
      toast.error("Erro ao adicionar despesa");
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(amount);
  };

  /**
   * `settled_on` e um DATE do Postgres, que chega como "2026-09-22".
   * `new Date("2026-09-22")` e interpretado como MEIA-NOITE UTC e, no fuso de
   * Brasilia, volta como dia 21 -- o pagamento apareceria um dia antes do que
   * foi registrado. Formatando os pedacos direto, sem Date, isso nao acontece.
   */
  const formatDate = (iso: string) => {
    const [ano, mes, dia] = (iso || "").split("-");
    return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
        return "bg-success/10 text-success";
      case "pending":
        return "bg-warning/10 text-warning";
      case "rejected":
        return "bg-destructive/10 text-destructive";
      default:
        return "bg-muted text-foreground";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "approved":
        return <CheckCircle className="h-3 w-3" />;
      case "pending":
        return <Clock className="h-3 w-3" />;
      case "rejected":
        return <AlertCircle className="h-3 w-3" />;
      default:
        return <Clock className="h-3 w-3" />;
    }
  };

  const toggleSection = (sectionId: string) => {
    setOpenSections((prev) =>
      prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId]
    );
  };

  const groupTransactionsByPeriod = () => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const groups = {
      current: transactions.filter((t) => {
        const date = new Date(t.transaction_date);
        return (
          date.getMonth() === currentMonth && date.getFullYear() === currentYear
        );
      }),
      previous: transactions.filter((t) => {
        const date = new Date(t.transaction_date);
        const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        return date.getMonth() === prevMonth && date.getFullYear() === prevYear;
      }),
      older: transactions.filter((t) => {
        const date = new Date(t.transaction_date);
        const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
        const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
        return (
          date.getFullYear() < prevYear ||
          (date.getFullYear() === prevYear && date.getMonth() < prevMonth)
        );
      }),
    };

    return groups;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="container mx-auto py-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-destructive mb-4">
            Grupo não encontrado
          </h1>
          <Button onClick={() => router.push("/dashboard/expense-groups")}>
            Voltar para Grupos
          </Button>
        </div>
      </div>
    );
  }

  const transactionGroups = groupTransactionsByPeriod();

  // Só o admin vê e responde os pedidos de entrada pelo código (HMO-190).
  const souAdmin =
    group.members?.some(
      (member) => member.user?.id === user?.id && member.role === "admin"
    ) ?? false;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/dashboard/expense-groups")}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Voltar
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Users className="h-8 w-8" />
              {group.name}
            </h1>
            <p className="text-muted-foreground">
              {group.description || "Sem descrição"} • Código:{" "}
              {group.group_code}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            // A moeda do grupo e semeada na ABERTURA, e nao num efeito sobre
            // `group`: um efeito sobrescreveria a moeda que a pessoa acabou de
            // escolher no formulario aberto, na primeira vez que qualquer coisa
            // recarregasse o grupo.
            onClick={() => {
              setExpenseForm((atual) => ({
                ...atual,
                currency: moedaSugeridaDaDespesa(group?.currency, null),
                cotacao: "",
              }));
              setShowAddExpense(true);
            }}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Adicionar Despesa
          </Button>
        </div>
      </div>

      {/* Group Info Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Membros</p>
                <p className="text-2xl font-bold">
                  {group.members?.length || 0}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Despesas</p>
                <p className="text-2xl font-bold">{transactions.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Total Gasto</p>
                <p className="text-2xl font-bold">
                  {/* Cada parcela e convertida ANTES de somar, pela cotacao
                      congelada da propria despesa -- a mesma conta que
                      `group_member_balances` faz no banco. Somar `t.amount` cru
                      juntaria 180 dolares com 1.000 reais e daria 1.180 de moeda
                      nenhuma: um total plausivel, sem erro, e 80% menor do que o
                      real na parte em dolar. */}
                  {formatCurrency(
                    transactions.reduce(
                      (sum, t) =>
                        sum + valorEmReais(t.amount, t.exchange_rate ?? 1),
                      0
                    )
                  )}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2">
              <Calculator className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">Pendências</p>
                <p className="text-2xl font-bold">
                  {balances.filter((b) => Math.abs(b.balance) > 0.01).length}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/*
        A barra do orcamento da viagem (HMO-180).

        Fica ACIMA das abas, e nao dentro de uma delas, porque "quanto ja
        gastamos da viagem" e a pergunta de quem abre esta tela -- atras de um
        clique ela repetiria, em menor escala, o problema que a HMO-180
        resolveu: a resposta existindo num lugar que nao e onde a pergunta e
        feita.

        Só aparece quando o grupo tem teto no mes: grupo sem teto continua vendo
        a tela de antes, como as Previstas da HMO-177. Quem quer criar um teto
        faz isso em Orcamento > Grupo, que e onde o formulario mora.
      */}
      {orcamento && (
        <CartaoOrcamentoGrupo
          grupo={orcamento}
          titulo="Orçamento do grupo"
          mes={mesDoOrcamento}
        />
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        {/* `grid-cols-4` acompanha o numero de abas: com 3 colunas para 4
            gatilhos o ultimo sai da faixa. */}
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="expenses">Despesas</TabsTrigger>
          <TabsTrigger value="painel">Painel</TabsTrigger>
          <TabsTrigger value="balances">Balanços</TabsTrigger>
          <TabsTrigger value="members">Membros</TabsTrigger>
        </TabsList>

        {/* O painel do grupo (HMO-201): totais e gasto por categoria, no
            periodo que a pessoa escolher. Montado so quando a aba esta
            ativa -- ele dispara duas chamadas, e faze-las no carregamento da
            tela custaria isso a quem so veio olhar a lista de despesas. */}
        <TabsContent value="painel" className="space-y-4">
          {activeTab === "painel" && (
            <PainelDoGrupo groupId={groupId} />
          )}
        </TabsContent>

        <TabsContent value="expenses" className="space-y-4">
          {/* Expenses by Period */}
          <div className="space-y-4">
            {/*
              Previstas: o que o grupo AINDA VAI pagar (HMO-177).

              Fica separada das outras secoes de proposito. As demais listam
              despesa que ja aconteceu e tem divisao gravada, que alguem pode
              aprovar ou recusar; aqui nao ha divisao nenhuma ainda -- ela nasce
              na baixa da conta prevista. Misturar as duas na mesma lista faria
              o total do grupo somar dinheiro que ninguem gastou.

              So aparece quando existe alguma: grupo sem despesa fixa continua
              vendo a tela de antes.
            */}
            {scheduled.length > 0 && (
              <Card>
                <CardHeader
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleSection("scheduled")}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5" />
                        Previstas
                        <Badge variant="outline">
                          {scheduled.length} a vencer
                        </Badge>
                      </CardTitle>
                      <CardDescription>
                        Ainda não aconteceram • Total:{" "}
                        {formatCurrency(
                          scheduled.reduce((sum, s) => sum + s.amount, 0)
                        )}{" "}
                        • Sua parte:{" "}
                        {formatCurrency(
                          scheduled.reduce((sum, s) => sum + s.share_amount, 0)
                        )}
                      </CardDescription>
                    </div>
                    {openSections.includes("scheduled") ? (
                      <ChevronDown className="h-5 w-5" />
                    ) : (
                      <ChevronRight className="h-5 w-5" />
                    )}
                  </div>
                </CardHeader>
                {openSections.includes("scheduled") && (
                  <CardContent className="space-y-3">
                    {scheduled.map((item) => (
                      <div key={item.id} className="border rounded-lg p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={item.payer?.avatar_url} />
                              <AvatarFallback>
                                {inicial(item.payer?.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <h4 className="font-medium flex items-center gap-2">
                                {item.description}
                                {item.is_recurring && (
                                  <Badge
                                    variant="secondary"
                                    className="text-xs"
                                  >
                                    Fixa
                                  </Badge>
                                )}
                              </h4>
                              <p className="text-sm text-muted-foreground">
                                {item.payer
                                  ? `Vai pagar: ${item.payer.full_name}`
                                  : "Responsável não identificado"}{" "}
                                • vence{" "}
                                {new Date(
                                  `${item.due_date}T00:00:00`
                                ).toLocaleDateString("pt-BR")}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-lg">
                              {formatCurrency(item.amount)}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              sua parte {formatCurrency(item.share_amount)}
                            </p>
                            <Badge
                              variant="outline"
                              className={`text-xs ${
                                item.is_overdue
                                  ? "bg-destructive/10 text-destructive"
                                  : "bg-warning/10 text-warning"
                              }`}
                            >
                              {item.is_overdue ? "Vencida" : "A vencer"}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            )}

            {/* Current Month */}
            <Card>
              <CardHeader
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => toggleSection("current")}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-5 w-5" />
                      Mês Atual
                      <Badge variant="outline">
                        {transactionGroups.current.length} despesa
                        {transactionGroups.current.length !== 1 ? "s" : ""}
                      </Badge>
                    </CardTitle>
                    <CardDescription>
                      Total:{" "}
                      {formatCurrency(
                        transactionGroups.current.reduce(
                          (sum, t) => sum + t.amount,
                          0
                        )
                      )}
                    </CardDescription>
                  </div>
                  {openSections.includes("current") ? (
                    <ChevronDown className="h-5 w-5" />
                  ) : (
                    <ChevronRight className="h-5 w-5" />
                  )}
                </div>
              </CardHeader>
              {openSections.includes("current") && (
                <CardContent className="space-y-3">
                  {transactionGroups.current.length > 0 ? (
                    transactionGroups.current.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="border rounded-lg p-4"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={transaction.payer.avatar_url} />
                              <AvatarFallback>
                                {inicial(transaction.payer.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <h4 className="font-medium">
                                {transaction.description}
                              </h4>
                              <p className="text-sm text-muted-foreground">
                                Pago por {transaction.payer.full_name} •{" "}
                                {new Date(
                                  transaction.transaction_date
                                ).toLocaleDateString("pt-BR")}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-lg">
                              {/* Na moeda da DESPESA. `formatCurrency` forca
                                  real e escreveria "R$ 180,00" sobre um jantar
                                  de US$ 180. */}
                              {formatarValor(
                                transaction.amount,
                                moedaDaViagem(transaction.currency)
                              )}
                            </p>
                            {moedaDaViagem(transaction.currency) !==
                              MOEDA_PADRAO && (
                              <p className="text-xs text-muted-foreground">
                                {formatCurrency(
                                  valorEmReais(
                                    transaction.amount,
                                    transaction.exchange_rate ?? 1
                                  )
                                )}{" "}
                                na cotação do dia
                              </p>
                            )}
                            {transaction.category && (
                              <Badge variant="secondary" className="text-xs">
                                {transaction.category.name}
                              </Badge>
                            )}
                          </div>
                        </div>

                        {/* Transaction Splits */}
                        <div className="space-y-2">
                          <p className="text-sm font-medium">Divisão:</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {transaction.splits.map((split) => (
                              <div
                                key={split.id}
                                className="flex items-center justify-between p-2 bg-muted rounded"
                              >
                                <div className="flex items-center gap-2">
                                  <Avatar className="h-6 w-6">
                                    <AvatarImage
                                      src={split.member.avatar_url}
                                    />
                                    <AvatarFallback className="text-xs">
                                      {inicial(split.member.full_name)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="text-sm">
                                    {split.member.full_name}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2">
                                  {/* A parte de cada um esta na moeda da
                                      despesa: ela e uma fracao do todo, e
                                      `group_expense_splits` nao tem moeda
                                      propria de proposito (ver a 026). */}
                                  <span className="text-sm font-medium">
                                    {formatarValor(
                                      split.amount,
                                      moedaDaViagem(transaction.currency)
                                    )}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className={`text-xs ${getStatusColor(
                                      split.status
                                    )}`}
                                  >
                                    {getStatusIcon(split.status)}
                                  </Badge>
                                  {/* Ate a HMO-178 o cracha ao lado era um
                                      rotulo que nunca mudava: nenhum caminho do
                                      app escrevia `approved`. Os botoes so
                                      aparecem na propria parte -- ver
                                      `acoesDaParte`. */}
                                  {acoesDaParte({
                                    status: split.status,
                                    ehMinha: ehParteDe(
                                      split.member?.id,
                                      user?.id
                                    ),
                                  }).map((acao) => (
                                    <Button
                                      key={acao}
                                      size="sm"
                                      variant={
                                        acao === "approve"
                                          ? "default"
                                          : "outline"
                                      }
                                      className="h-6 px-2 text-xs"
                                      disabled={parteEmCurso === split.id}
                                      onClick={() =>
                                        handleResponderParte(split.id, acao)
                                      }
                                    >
                                      {rotuloDaAcao(acao)}
                                    </Button>
                                  ))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-muted-foreground py-8">
                      Nenhuma despesa neste período
                    </p>
                  )}
                </CardContent>
              )}
            </Card>

            {/* Previous Month */}
            {transactionGroups.previous.length > 0 && (
              <Card>
                <CardHeader
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleSection("previous")}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5" />
                        Mês Anterior
                        <Badge variant="outline">
                          {transactionGroups.previous.length} despesa
                          {transactionGroups.previous.length !== 1 ? "s" : ""}
                        </Badge>
                      </CardTitle>
                      <CardDescription>
                        Total:{" "}
                        {formatCurrency(
                          transactionGroups.previous.reduce(
                            (sum, t) => sum + t.amount,
                            0
                          )
                        )}
                      </CardDescription>
                    </div>
                    {openSections.includes("previous") ? (
                      <ChevronDown className="h-5 w-5" />
                    ) : (
                      <ChevronRight className="h-5 w-5" />
                    )}
                  </div>
                </CardHeader>
                {openSections.includes("previous") && (
                  <CardContent className="space-y-3">
                    {transactionGroups.previous.map((transaction) => (
                      <div
                        key={transaction.id}
                        className="border rounded-lg p-4"
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarImage src={transaction.payer.avatar_url} />
                              <AvatarFallback>
                                {inicial(transaction.payer.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <div>
                              <h4 className="font-medium">
                                {transaction.description}
                              </h4>
                              <p className="text-sm text-muted-foreground">
                                Pago por {transaction.payer.full_name} •{" "}
                                {new Date(
                                  transaction.transaction_date
                                ).toLocaleDateString("pt-BR")}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-lg">
                              {/* Na moeda da DESPESA. `formatCurrency` forca
                                  real e escreveria "R$ 180,00" sobre um jantar
                                  de US$ 180. */}
                              {formatarValor(
                                transaction.amount,
                                moedaDaViagem(transaction.currency)
                              )}
                            </p>
                            {moedaDaViagem(transaction.currency) !==
                              MOEDA_PADRAO && (
                              <p className="text-xs text-muted-foreground">
                                {formatCurrency(
                                  valorEmReais(
                                    transaction.amount,
                                    transaction.exchange_rate ?? 1
                                  )
                                )}{" "}
                                na cotação do dia
                              </p>
                            )}
                            {transaction.category && (
                              <Badge variant="secondary" className="text-xs">
                                {transaction.category.name}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="balances" className="space-y-4">
          {/* Balance Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calculator className="h-5 w-5" />
                Resumo de Balanços
              </CardTitle>
              <CardDescription>Quem deve pagar para quem</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* A MOEDA DA VIAGEM, E O QUE ELA SIGNIFICA AQUI (HMO-182, item 4)
                    O saldo e em real porque cada despesa foi convertida pela
                    cotacao do dia DELA, congelada -- e por isso o valor do
                    passado nao muda sozinho. A moeda da viagem aparece ao lado,
                    ao cambio de HOJE, dizendo que e de hoje. */}
                {contextoDeMoeda.group_currency !== MOEDA_PADRAO && (
                  <div className="p-3 rounded-lg bg-muted text-sm space-y-1">
                    <p className="font-medium">
                      Viagem em{" "}
                      {moedaPorCodigo(contextoDeMoeda.group_currency).nome}
                    </p>
                    {contextoDeMoeda.today_rate !== null ? (
                      <p className="text-muted-foreground">
                        Os saldos abaixo estão em reais — cada despesa entrou pela
                        cotação do dia em que foi feita, e esse valor não muda. Ao
                        lado, o mesmo saldo em{" "}
                        {contextoDeMoeda.group_currency} pela cotação de hoje
                        {contextoDeMoeda.today_rate_date
                          ? ` (${formatDate(contextoDeMoeda.today_rate_date)})`
                          : ""}
                        , que serve para pagar agora.
                      </p>
                    ) : (
                      <p className="text-muted-foreground">
                        {avisoSemConversao(
                          saldoNaMoedaDaViagem(
                            0,
                            contextoDeMoeda.group_currency,
                            null
                          )
                        )}
                      </p>
                    )}
                  </div>
                )}

                {/* Individual Balances */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {balances.map((balance) => (
                    <div
                      key={balance.member.id}
                      className="border rounded-lg p-4"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-8 w-8">
                            <AvatarImage src={balance.member.avatar_url} />
                            <AvatarFallback>
                              {inicial(balance.member.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <h4 className="font-medium">
                              {balance.member.full_name}
                            </h4>
                            <p className="text-sm text-muted-foreground">
                              {balance.transactions_count} transação
                              {balance.transactions_count !== 1 ? "ões" : ""}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p
                            className={`font-bold text-lg ${
                              balance.balance > 0
                                ? "text-success"
                                : balance.balance < 0
                                ? "text-destructive"
                                : "text-muted-foreground"
                            }`}
                          >
                            {formatCurrency(Math.abs(balance.balance))}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {balance.balance > 0
                              ? "A receber"
                              : balance.balance < 0
                              ? "Deve pagar"
                              : "Quitado"}
                          </p>
                          {/* O mesmo saldo na moeda da viagem. `Math.abs` no
                              valor, igual a linha de cima, porque o sentido
                              ("A receber"/"Deve pagar") ja esta escrito acima --
                              repetir o sinal aqui daria "-US$ 50,00" embaixo de
                              "Deve pagar", que se le como dois menos. */}
                          {(() => {
                            const apresentado = saldoNaMoedaDaViagem(
                              balance.balance,
                              contextoDeMoeda.group_currency,
                              contextoDeMoeda.today_rate
                            );
                            if (apresentado.naMoedaDaViagem === null) return null;
                            return (
                              <p
                                className="text-xs text-muted-foreground"
                                title={
                                  rotuloDaConversao(
                                    apresentado,
                                    contextoDeMoeda.today
                                  ) ?? undefined
                                }
                              >
                                ≈{" "}
                                {formatarValor(
                                  Math.abs(apresentado.naMoedaDaViagem),
                                  apresentado.moeda
                                )}{" "}
                                hoje
                              </p>
                            );
                          })()}
                        </div>
                      </div>

                      {/* O Pix de quem esta A RECEBER (HMO-201). So dele: uma
                          chave ao lado de quem DEVE pagar nao serve para nada,
                          e mostrar a de todo mundo transforma a lista de
                          saldos numa lista de chaves. O `> 0.01` e a mesma
                          tolerancia de centavo usada acima para decidir quem
                          esta quitado -- senao apareceria botao de copiar ao
                          lado de um saldo de R$ 0,00. A propria chave fica de
                          fora: ninguem precisa se pagar. */}
                      {balance.balance > 0.01 &&
                        balance.member.id !== user?.id && (
                          <div className="mt-3 pt-3 border-t">
                            <PixDoMembro
                              pix={chavesPix.get(balance.member.id)}
                              nome={balance.member.full_name}
                            />
                          </div>
                        )}
                    </div>
                  ))}
                </div>

                {/* O grupo nao fecha: avisa antes de sugerir um acerto que
                    nunca termina. */}
                {Math.abs(residual) >= 0.02 && (
                  <div className="flex items-start gap-3 p-4 bg-warning/10 rounded-lg border border-warning/30">
                    <AlertCircle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <p className="font-medium text-warning">
                        As contas deste grupo não fecham por{" "}
                        {formatCurrency(Math.abs(residual))}
                      </p>
                      <p className="text-warning">
                        Sobra um valor que não foi atribuído a ninguém.
                        Costuma ser despesa lançada sem divisão, divisão que não
                        cobre o valor inteiro, ou parte no nome de quem já saiu
                        do grupo. Mesmo acertando tudo abaixo, esse valor
                        continuará aparecendo.
                      </p>
                    </div>
                  </div>
                )}

                {/* Transfer Suggestions */}
                {transfers.length > 0 ? (
                  <div className="space-y-3">
                    <h3 className="text-lg font-semibold">
                      Sugestões de Pagamento
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      O menor número de transferências que zera o grupo. Ao
                      registrar, a sugestão sai da lista.
                    </p>
                    <div className="space-y-2">
                      {transfers.map((transfer, index) => {
                        const chave = `${transfer.from.id}->${transfer.to.id}`;
                        // So quem paga ou quem recebe pode registrar: a policy
                        // de INSERT da 007 exige isso, e oferecer o botao a um
                        // terceiro seria prometer uma acao que o banco recusa.
                        const souParte =
                          user?.id === transfer.from.id ||
                          user?.id === transfer.to.id;

                        // O mesmo pagamento na moeda da viagem, ao cambio de
                        // hoje -- ou `null` quando nao ha o que oferecer.
                        //
                        // O teste de moeda vem ANTES da chamada porque
                        // `acertoNaMoedaDaViagem(x, 'BRL', 1)` responde um acerto
                        // valido (em real, cotacao 1): usar o retorno sozinho
                        // como condicao poria um segundo botao "Paguei em BRL" ao
                        // lado do primeiro, em todo grupo em real do app.
                        const naViagem =
                          contextoDeMoeda.group_currency !== MOEDA_PADRAO
                            ? acertoNaMoedaDaViagem(
                                transfer.amount,
                                contextoDeMoeda.group_currency,
                                contextoDeMoeda.today_rate
                              )
                            : null;

                        return (
                          <div
                            key={index}
                            className="flex items-center justify-between p-4 bg-info/10 rounded-lg border border-info/30"
                          >
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={transfer.from.avatar_url} />
                                <AvatarFallback>
                                  {inicial(transfer.from.full_name)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium">
                                {transfer.from.full_name || "Sem nome"}
                              </span>
                              <TrendingUp className="h-4 w-4 text-info" />
                              <Avatar className="h-8 w-8">
                                <AvatarImage src={transfer.to.avatar_url} />
                                <AvatarFallback>
                                  {inicial(transfer.to.full_name)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium">
                                {transfer.to.full_name || "Sem nome"}
                              </span>
                            </div>
                            <div className="flex items-center gap-4">
                              <div className="text-right">
                                <p className="font-bold text-lg text-info">
                                  {formatCurrency(transfer.amount)}
                                </p>
                                <p className="text-sm text-info">
                                  Pagamento sugerido
                                </p>
                                {/* Quanto e isso na moeda da viagem hoje, para
                                    quem for pagar em dolar no fim da viagem. */}
                                {naViagem && (
                                  <p className="text-xs text-info">
                                    ≈{" "}
                                    {formatarValor(
                                      naViagem.amount,
                                      naViagem.currency
                                    )}{" "}
                                    hoje
                                  </p>
                                )}
                              </div>
                              {souParte && (
                                <div className="flex flex-col gap-1">
                                  <Button
                                    size="sm"
                                    onClick={() => handleLiquidar(transfer)}
                                    disabled={settling === chave}
                                  >
                                    <CheckCircle className="h-4 w-4 mr-1" />
                                    {settling === chave
                                      ? "Registrando..."
                                      : naViagem
                                      ? // So vira "em reais" quando ha a outra
                                        // opcao ao lado. Em grupo em real nao ha
                                        // escolha a explicitar, e "Já paguei" e
                                        // a frase que a tela sempre usou.
                                        "Paguei em reais"
                                      : "Já paguei"}
                                  </Button>
                                  {/* O segundo botao so existe quando ha cotacao
                                      de hoje: sem ela, `acertoNaMoedaDaViagem`
                                      devolve null e o clique nao teria para onde
                                      ir. Oferecer e falhar depois e pior do que
                                      nao oferecer. */}
                                  {naViagem && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() =>
                                        handleLiquidar(transfer, "viagem")
                                      }
                                      disabled={settling === chave}
                                      title={
                                        avisoDeSobra(naViagem) ??
                                        `Registra ${formatarValor(
                                          naViagem.amount,
                                          naViagem.currency
                                        )} à cotação de hoje (${
                                          naViagem.exchange_rate
                                        }).`
                                      }
                                    >
                                      Paguei em {naViagem.currency}
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  balances.length > 0 && (
                    <div className="flex items-center gap-3 p-4 bg-success/10 rounded-lg border border-success/30">
                      <CheckCircle className="h-5 w-5 text-success" />
                      <p className="text-sm text-success">
                        Tudo acertado. Ninguém deve nada a ninguém neste grupo.
                      </p>
                    </div>
                  )
                )}

                {/* Acertos ja registrados */}
                {settlements.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-lg font-semibold">
                      Pagamentos registrados
                    </h3>
                    <div className="space-y-2">
                      {settlements.map((s) => (
                        /*
                          "Fulano pagou Beltrano em 12/03/2026" numa linha que
                          nao quebrava: dois avatares mais dois nomes livres
                          mais a data dao um min-content bem acima de 320px, e
                          o piso de min-content nao encolhe com a viewport --
                          a pagina e que anda para o lado (HMO-185).

                          Aqui a saida e `flex-wrap`, nao `truncate` como na
                          lista de lancamentos: cortar "Fulan... pagou Belt..."
                          tira justamente a informacao da frase. Quebrar em
                          duas linhas nao tira nada.
                        */
                        <div
                          key={s.id}
                          className="flex items-center justify-between gap-3 p-3 border rounded-lg"
                        >
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm min-w-0">
                            <Avatar className="h-6 w-6 shrink-0">
                              <AvatarImage src={s.from_user?.avatar_url} />
                              <AvatarFallback>
                                {inicial(s.from_user?.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium">
                              {s.from_user?.full_name || "Sem nome"}
                            </span>
                            <span className="text-muted-foreground">pagou</span>
                            <Avatar className="h-6 w-6 shrink-0">
                              <AvatarImage src={s.to_user?.avatar_url} />
                              <AvatarFallback>
                                {inicial(s.to_user?.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium">
                              {s.to_user?.full_name || "Sem nome"}
                            </span>
                            <span className="text-muted-foreground">
                              em {formatDate(s.settled_on)}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            {/* Um acerto em dolar tem que aparecer em dolar. Com
                                `formatCurrency` sozinho, US$ 50,00 sairia como
                                "R$ 50,00" -- o mesmo erro de 80% que o CHECK da
                                026 fecha no banco, reaberto na leitura. O valor
                                em real vem embaixo porque e o que a divida
                                abateu, e e o unico numero que soma com os
                                outros acertos da lista. */}
                            <span className="font-semibold text-right">
                              {formatarValor(
                                s.amount,
                                moedaDaViagem(s.currency)
                              )}
                              {moedaDaViagem(s.currency) !== MOEDA_PADRAO && (
                                <span className="block text-xs font-normal text-muted-foreground">
                                  {formatCurrency(
                                    s.amount_in_brl ??
                                      s.amount * (s.exchange_rate ?? 1)
                                  )}{" "}
                                  na cotação do dia
                                </span>
                              )}
                            </span>
                            {s.can_delete && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDesfazerAcerto(s.id)}
                              >
                                Desfazer
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members" className="space-y-4">
          {/* Pedidos de entrada pelo codigo, so para o admin (HMO-190). */}
          {souAdmin && (group.pendingMembers?.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Pedidos para entrar ({group.pendingMembers!.length})
                </CardTitle>
                <CardDescription>
                  Entraram com o código {group.group_code} e aguardam sua
                  aprovação.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {group.pendingMembers!.map((pedido) => (
                    <div
                      key={pedido.id}
                      className="flex items-center justify-between gap-3 p-4 border rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={pedido.user.avatar_url} />
                          <AvatarFallback>
                            {inicial(pedido.user.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <h4 className="font-medium">
                          {pedido.user.full_name}
                        </h4>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={respondendoPedido === pedido.id}
                          onClick={() =>
                            handleResponderPedido(pedido.id, "reject")
                          }
                        >
                          Recusar
                        </Button>
                        <Button
                          size="sm"
                          disabled={respondendoPedido === pedido.id}
                          onClick={() =>
                            handleResponderPedido(pedido.id, "approve")
                          }
                        >
                          Aprovar
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Members List */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Membros do Grupo
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {group.members?.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={member.user.avatar_url} />
                        <AvatarFallback>
                          {inicial(member.user.full_name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <h4 className="font-medium flex items-center gap-2">
                          {member.user.full_name}
                          {member.role === "admin" && (
                            <Crown className="h-4 w-4 text-warning" />
                          )}
                        </h4>
                        <p className="text-sm text-muted-foreground capitalize">
                          {member.role} • {member.status}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <Badge
                        variant={
                          member.status === "active" ? "default" : "secondary"
                        }
                      >
                        {member.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Add Expense Modal */}
      {showAddExpense && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>Adicionar Nova Despesa</CardTitle>
              <CardDescription>
                Registre uma despesa para o grupo
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddExpense} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="description">Descrição *</Label>
                  <Input
                    id="description"
                    value={expenseForm.description}
                    onChange={(e) =>
                      setExpenseForm({
                        ...expenseForm,
                        description: e.target.value,
                      })
                    }
                    placeholder="Ex: Jantar no restaurante"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="amount">Valor *</Label>
                  <CampoDeValor
                    id="amount"
                    value={expenseForm.amount}
                    onChange={(amount) =>
                      setExpenseForm({ ...expenseForm, amount })
                    }
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="transaction_date">Data</Label>
                  <Input
                    id="transaction_date"
                    type="date"
                    value={expenseForm.transaction_date}
                    onChange={(e) =>
                      setExpenseForm({
                        ...expenseForm,
                        transaction_date: e.target.value,
                      })
                    }
                  />
                </div>

                {/* A MOEDA DA DESPESA (HMO-182, itens 2 e 3)
                    Preenchida com a moeda do grupo, e trocavel: "sugerida" e a
                    palavra da decisao, e uma diaria cobrada em dolar numa viagem
                    ao Chile e o caso normal. */}
                <div className="space-y-2">
                  <Label htmlFor="expense_currency">Moeda</Label>
                  <Select
                    value={expenseForm.currency}
                    // Trocar a moeda LIMPA a cotacao, igual ao formulario de
                    // lancamento: a cotacao do dolar nao significa nada para o
                    // euro, e deixa-la ali faria o campo parecer preenchido e
                    // correto -- `CampoDeCotacao` so busca quando esta vazio.
                    onValueChange={(value) =>
                      setExpenseForm({
                        ...expenseForm,
                        currency: value,
                        cotacao: "",
                      })
                    }
                  >
                    <SelectTrigger id="expense_currency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {opcoesDeMoeda().map((o) => (
                        <SelectItem key={o.codigo} value={o.codigo}>
                          {o.rotulo}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* A cotacao do dia da COMPRA. O componente nao renderiza nada em
                    real, e busca a PTAX da `data` -- nao a de hoje. Sem ela o
                    banco recusa a despesa com 23514 (CHECK da 026). */}
                <CampoDeCotacao
                  moeda={expenseForm.currency}
                  data={expenseForm.transaction_date}
                  cotacao={expenseForm.cotacao}
                  valor={expenseForm.amount}
                  aoMudar={(cotacao) =>
                    setExpenseForm({ ...expenseForm, cotacao })
                  }
                />

                <div className="space-y-2">
                  <Label htmlFor="split_type">Tipo de Divisão</Label>
                  <Select
                    value={expenseForm.split_type}
                    onValueChange={(value: "equal" | "percentage" | "custom") =>
                      setExpenseForm({ ...expenseForm, split_type: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="equal">Divisão Igual</SelectItem>
                      <SelectItem value="percentage">Por Percentual</SelectItem>
                      <SelectItem value="custom">Customizada</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Sugestões de Split */}
                {parseFloat(expenseForm.amount) > 0 && (
                  <div className="space-y-2">
                    <SplitSuggestions
                      groupId={groupId}
                      amount={parseFloat(expenseForm.amount)}
                      onSelectSuggestion={setSelectedSplitSuggestion}
                      selectedSuggestion={selectedSplitSuggestion}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="notes">Observações</Label>
                  <Textarea
                    id="notes"
                    value={expenseForm.notes}
                    onChange={(e) =>
                      setExpenseForm({ ...expenseForm, notes: e.target.value })
                    }
                    placeholder="Observações adicionais..."
                    rows={3}
                  />
                </div>

                <div className="flex gap-2">
                  <Button type="submit">Adicionar Despesa</Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowAddExpense(false)}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
