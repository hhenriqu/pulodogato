"use client";

import { useCallback, useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CampoDeValor } from "@/components/ui/campo-de-valor";
import { CampoDeData } from "@/components/ui/campo-de-data";
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
  Users,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  Calculator,
  Crown,
  AlertCircle,
  CheckCircle,
  Clock,
  CalendarCheck,
  Trash2,
} from "lucide-react";
import { AdicionarSemConta } from "@/components/grupos/AdicionarSemConta";
import SplitSuggestions, {
  type SplitSuggestion,
} from "@/components/financial/SplitSuggestions";
import { partesParaGravar } from "@/lib/sugestao-de-divisao";
import { CartaoOrcamentoGrupo } from "@/components/financial/CartaoOrcamentoGrupo";
import {
  orcamentoDoGrupo,
  type GrupoOrcado,
} from "@/lib/orcamento-de-grupo";
import type { BudgetWithConsumption } from "@/types/financial";
import { CampoDeCotacao } from "@/components/movimentacoes/CampoDeCotacao";
import { MOEDA_PADRAO, formatarValor, moedaPorCodigo } from "@/lib/dinheiro";
import { opcoesDeMoeda } from "@/lib/moeda";
import { cotacaoDigitada, taxaParaGravar, valorEmReais } from "@/lib/cambio";
import { PixDoMembro, useChavesPixDoGrupo } from "@/components/grupos/PixDoMembro";
import { PainelDoGrupo } from "@/components/grupos/PainelDoGrupo";
import {
  DivisaoDoGrupo,
  type MembroDaDivisao,
} from "@/components/grupos/DivisaoDoGrupo";
import { FechamentoDoMes } from "@/components/grupos/FechamentoDoMes";
import {
  FechamentoDoPeriodo,
  type AcertoSugerido,
} from "@/components/grupos/FechamentoDoPeriodo";
import { today } from "@/lib/recurrence";
import { dataNaTela } from "@/lib/data-na-tela";
import {
  mesDaData,
  recortarPrevistas,
  recortarRealizado,
  rotuloDoMes,
} from "@/lib/periodo-do-grupo";
import {
  acertoNaMoedaDaViagem,
  avisoDeSobra,
  avisoSemConversao,
  moedaDaViagem,
  moedaSugeridaDaDespesa,
  rotuloDaConversao,
  saldoNaMoedaDaViagem,
  type AcertoParaGravar,
} from "@/lib/moeda-do-grupo";
import { tipoDoGrupo, type TipoDoGrupo } from "@/lib/tipo-do-grupo";
import { SeloDoTipoDoGrupo } from "@/components/grupos/EscolhaDoTipoDoGrupo";
import {
  DialogoDeAcerto,
  type ContaParaEscolher,
} from "@/components/grupos/DialogoDeAcerto";
import { direcaoDoAcerto, type DirecaoDoAcerto } from "@/lib/acerto-em-lancamento";
import {
  comoEuVejoOAcerto,
  type AcertoVistoPorMim,
} from "@/lib/perna-da-contraparte";
import { ModalDeLancamento } from "@/components/movimentacoes/ModalDeLancamento";
import { SalvarEContinuar } from "@/components/movimentacoes/SalvarEContinuar";
import { proximaDespesaDeGrupo } from "@/lib/retorno-do-lancamento";
import { mesVizinho, minhaPosicaoNaConta } from "@/lib/minha-parte-na-conta";

import { Dica } from "@/components/ui/dica";
/**
 * O estado do formulario de "Adicionar Nova Despesa" como ele ABRE (HMO-251).
 *
 * Extraido de dentro do `useState` porque agora ele tem TRES leitores, e os tres
 * precisam concordar: a abertura, o fechamento depois de salvar e o `inicial` de
 * `proximaDespesaDeGrupo` -- que e quem decide qual campo fica limpo. Escrever o
 * objeto a mao no terceiro lugar e o jeito de o reset divergir do padrao da tela
 * no dia em que um campo novo entrar: ele nasceria preenchido na abertura e
 * `undefined` depois do reset, sem erro nenhum.
 *
 * `moedaDoGrupo` e parametro porque na primeira renderizacao o grupo ainda nao
 * carregou (`group` e `null`), e `moedaSugeridaDaDespesa(null, null)` devolve a
 * moeda padrao -- que e exatamente o que a tela mostrava antes desta issue.
 */
function valoresIniciaisDaDespesa(moedaDoGrupo: string | null | undefined) {
  return {
    description: "",
    amount: "",
    category_id: "",
    transaction_date: new Date().toISOString().split("T")[0],
    notes: "",
    split_type: "equal" as "equal" | "percentage" | "custom",
    currency: moedaSugeridaDaDespesa(moedaDoGrupo, null),
    // A cotacao do dia da compra, como TEXTO -- e o que `CampoDeCotacao`
    // manipula, e aceitar virgula depende de a leitura ser de texto.
    cotacao: "",
    // Quem pagou (077). Vazio = eu, e a despesa entra na minha conta como
    // sempre. A linha de outro membro = a despesa paga por outro, so no grupo.
    paid_by_member_id: "",
  };
}

interface ExpenseGroup {
  id: string;
  name: string;
  description: string;
  group_code: string;
  group_type: "public" | "private";
  /** O que o grupo e (076): a casa ou um evento. */
  group_kind?: TipoDoGrupo | null;
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
  /** Participante sem conta no app (077): so o nome, `user.id` nulo. */
  sem_conta?: boolean;
  user: {
    id: string | null;
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
  /**
   * A despesa paga por outro, lancada so no grupo (077). O `id` e o da linha
   * do grupo, e nao ha lancamento em conta nenhuma.
   */
  so_do_grupo?: boolean;
  created_by?: string | null;
  payer: {
    id: string | null;
    full_name: string;
    avatar_url?: string;
  } | null;
  splits: {
    id: string;
    amount: number;
    percentage: number;
    /**
     * `status` SAIU DAQUI NA HMO-425, e nao da resposta da rota.
     *
     * A tela nao aprova nem recusa parte nenhuma: o campo continua vindo em
     * `/api/expense-groups/[groupId]/transactions` e continua sendo lido pelo
     * SQL que soma `total_owed` (`NOT IN ('rejected','expired')`). O que
     * desapareceu e o LEITOR na tela -- declara-lo aqui sem ninguem usar
     * convidaria o proximo cracha de status a nascer sem caminho que o mude,
     * que era exatamente o rotulo morto que a HMO-178 tinha ido consertar.
     */
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
  /**
   * O ESTADO DE CADA PESSOA NESTA CONTA (HMO-411).
   *
   * Opcional porque a resposta guardada no aparelho de antes desta feature nao
   * tem o campo: `undefined` nao desenha o quadro e a tela volta a ser a de
   * ontem. Uma lista VAZIA, ao contrario, seria uma afirmacao -- e por isso o
   * default aqui nao e `[]`.
   */
  estado_por_membro?: EstadoDoMembroNaPrevista[];
  /**
   * `true` = quem esta olhando NAO criou esta conta, e a RLS da 055 so lhe
   * entrega a propria linha de pagamento. A lista acima esta curta por isso, e
   * nao porque os outros membros estejam pendentes. Os dois casos sao a MESMA
   * lista curta, e sem esta flag o segundo se leria como o primeiro.
   */
  estado_parcial?: boolean;
}

/** Uma pessoa no quadro "quem ja resolveu a parte dela" (HMO-411). */
interface EstadoDoMembroNaPrevista {
  user_id: string;
  full_name: string | null;
  avatar_url?: string | null;
  estado: "pago" | "avisou" | "pendente";
}

/** O que cada estado diz na tela. UMA copia, lida so pelo quadro. */
const FRASE_DO_ESTADO: Record<EstadoDoMembroNaPrevista["estado"], string> = {
  pago: "pagou",
  avisou: "avisou que pagou",
  pendente: "pendente",
};

/** A frase que explica a lista curta de quem nao criou a conta. */
const SO_O_DONO_VE_O_QUADRO =
  "Só quem criou a conta vê o aviso dos outros membros.";

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
    /** Sem conta no app (077): `id` e a linha do membro. */
    sem_conta?: boolean;
  };
  to: {
    id: string;
    full_name: string;
    avatar_url?: string;
    sem_conta?: boolean;
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
  /**
   * Os ids CRUS, ao lado dos embeds (HMO-245, fase 12).
   *
   * E por eles que `comoEuVejoOAcerto` decide a direcao. `from_user.id` nao
   * serve: a RLS de `profiles` descarta o embed de quem nao tem o perfil
   * visivel -- ser do mesmo grupo nao da acesso ao perfil do outro --, e a
   * direcao sairia como "nao sou parte" para quem e parte.
   */
  from_user_id: string;
  to_user_id: string;
  created_by: string;
  /**
   * A MINHA perna deste acerto, ou `null` se eu ainda nao lancei (fase 12).
   *
   * Ela e o unico dado que distingue "ainda nao lancado na sua conta" de "nao
   * aconteceu", e e por isso que ela vem do servidor e nao se deduz da tela: o
   * acerto aparece igual nas duas situacoes.
   */
  minha_perna: {
    id: string;
    amount: number;
    account_id: string | null;
    transaction_type: string | null;
  } | null;
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
  // A barra "quanto ja gastamos da viagem" (HMO-180). `null` = este grupo nao
  // tem teto no mes corrente, e o cartao nem aparece -- mesma regra das
  // Previstas: grupo sem teto continua vendo a tela de antes.
  const [orcamento, setOrcamento] =
    useState<GrupoOrcado<BudgetWithConsumption> | null>(null);
  // O mes que a RESPOSTA trouxe, nao o que a tela pediu: e ele que rotula a
  // barra, e a tela nao pede mes nenhum (a rota resolve o corrente).
  const [mesDoOrcamento, setMesDoOrcamento] = useState("");
  /**
   * O mes da aba de Despesas (HMO-248). UM seletor para a aba inteira.
   *
   * Vive aqui, e nao dentro do cartao de fechamento, porque e ele que recorta
   * tambem as listas "Previstas" e "Despesas" abaixo. Antes nada recortava: o
   * cartao Previstas somava TODAS as parcelas materializadas da despesa fixa --
   * o aluguel de outubro, de novembro e de dezembro no mesmo total -- e a lista
   * de realizadas era presa no mes de hoje.
   *
   * `today()` e nao `new Date()`: a Vercel roda em UTC, e das 21:00 do dia 31
   * em diante o mes do servidor ja virou enquanto o do usuario nao.
   */
  const [mesDoGrupo, setMesDoGrupo] = useState(() => mesDaData(today()));
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
  /**
   * Sobe a cada acerto registrado ou desfeito. O cartao do fechamento le o que
   * esta em aberto por conta propria, e a baixa da 068 muda esse numero junto
   * com o acerto.
   */
  const [versaoDoFechamento, setVersaoDoFechamento] = useState(0);
  /**
   * O acerto que o dialogo esta pedindo a conta (HMO-245, fase 11).
   *
   * `null` = dialogo fechado. Guarda o acerto JA MONTADO por
   * `acertoNaMoedaDaViagem` -- valor, moeda e cotacao -- porque e a escolha
   * "em reais" ou "na moeda da viagem" do botao clicado que o define, e ela nao
   * pode ser recalculada na hora de confirmar: a cotacao de hoje pode ter sido
   * recarregada no meio, e o valor confirmado seria outro que o mostrado.
   */
  const [acertoEmCurso, setAcertoEmCurso] = useState<{
    chave: string;
    direcao: DirecaoDoAcerto;
    fromUserId: string;
    toUserId: string;
    nomeDaContraparte: string | null;
    acerto: AcertoParaGravar;
  } | null>(null);
  /**
   * O acerto JA REGISTRADO que estou lancando na minha conta (fase 12).
   *
   * Estado separado de `acertoEmCurso` de proposito: ali o acerto ainda nao
   * existe e o POST vai criar a quitacao; aqui ele existe, tem id, e o pedido
   * so grava a perna. Um estado so, com um booleano "ja existe?", e o desenho
   * em que um defeito de fluxo registra um acerto DUPLICADO em vez de lancar o
   * que estava na tela.
   *
   * O valor, a moeda e a cotacao vem da QUITACAO -- a 026 congelou as duas
   * ultimas em `settled_on` --, e nunca da cotacao de hoje: a contraparte
   * confirma dias depois, e pela taxa de hoje a perna dela nao fecharia com a
   * do outro lado.
   */
  const [pernaEmCurso, setPernaEmCurso] = useState<{
    settlementId: string;
    direcao: DirecaoDoAcerto;
    nomeDaContraparte: string | null;
    valor: number;
    moeda: string;
    cotacao: number;
  } | null>(null);
  /** O id do acerto cuja perna esta em voo, para travar a linha DELE so. */
  const [pernaSalvando, setPernaSalvando] = useState<string | null>(null);
  /**
   * As contas do usuario, para o campo do dialogo.
   *
   * Carregadas uma vez com o resto da tela, e nao ao abrir o dialogo: abrir e o
   * momento em que a pessoa quer escolher, e um seletor que chega vazio e
   * preenche depois e indistinguivel de "voce nao tem conta".
   */
  const [contas, setContas] = useState<ContaParaEscolher[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("mes");

  // Estados do formulário de nova despesa
  const [showAddExpense, setShowAddExpense] = useState(false);
  // Nasce em real e passa para a moeda do grupo quando o grupo carrega (ver o
  // efeito abaixo). Nao da para inicializar com a moeda do grupo aqui: neste
  // ponto `group` ainda e null -- e e por isso que a fabrica recebe a moeda.
  const [expenseForm, setExpenseForm] = useState(() =>
    valoresIniciaisDaDespesa(null)
  );
  /**
   * "Salvar e continuar" do formulario de despesa do grupo (HMO-251).
   *
   * Mora na pagina, e nao dentro do modal, para sobreviver a gravacao: o estado
   * de um componente desmontado volta ao padrao, e o interruptor precisa
   * continuar ligado para a SEGUNDA despesa da sequencia -- que e o unico caso
   * em que ele serve.
   */
  const [continuarNaDespesa, setContinuarNaDespesa] = useState(false);
  /**
   * Gravacao em curso. Com o modal FECHANDO ao salvar, o duplo clique era
   * barrado pelo proprio desaparecimento do botao; com "Salvar e continuar" o
   * botao fica onde esta, e dois cliques rapidos entram como duas despesas --
   * cada uma rateada entre os participantes pelo trigger do banco. O reset de
   * `proximaDespesaDeGrupo` fecha a janela DEPOIS da resposta; este estado fecha
   * a janela DURANTE a ida e volta, que o reset nao alcanca.
   */
  const [salvandoDespesa, setSalvandoDespesa] = useState(false);
  const [selectedSplitSuggestion, setSelectedSplitSuggestion] =
    useState<SplitSuggestion | null>(null);

  // Estados dos accordions
  // "scheduled" comece aberta: a despesa fixa de grupo era invisivel nesta tela
  // (HMO-177), e nascer fechada atras de um clique repetiria o sintoma.
  // A conta aberta na lista (a divisao dela so aparece ao tocar na linha).
  const [contaAberta, setContaAberta] = useState<string | null>(null);
  const [openSections, setOpenSections] = useState<string[]>([
    "scheduled",
    "current",
  ]);

  // Os oito `load*` abaixo sao `useCallback` porque `loadData` chama todos, e
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

  /**
   * As contas do usuario, para o campo de conta do dialogo de acerto.
   *
   * Falha em silencio no console, como `loadOrcamento`: a lista so e usada
   * dentro do dialogo, e um toast de erro no carregamento da tela apontaria
   * para um campo que a pessoa nem abriu. O dialogo diz o que fazer quando nao
   * ha conta elegivel.
   */
  const loadContas = useCallback(async () => {
    try {
      const response = await fetch("/api/financial-accounts");
      const data = await response.json();
      if (response.ok) {
        setContas(data.accounts || data || []);
      } else {
        console.error("Error loading contas:", data.error);
      }
    } catch (error) {
      console.error("Error loading contas:", error);
    }
  }, []);

  const loadSettlements = useCallback(async () => {
    const response = await fetch(`/api/expense-groups/${groupId}/settlements`);
    const data = await response.json();

    if (response.ok) {
      setSettlements(data.settlements || []);
    } else {
      console.error("Error loading settlements:", data.error);
    }
  }, [groupId]);

  // `loadData` mora DEPOIS dos oito, e nao antes como estava: o array de
  // dependencias e avaliado durante o render, entao com ele la em cima o
  // `loadGroup` ainda nao existiria -- `ReferenceError`, nao aviso de lint.
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
        loadContas(),
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
    loadContas,
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

    // O CLIQUE NAO GRAVA MAIS NADA -- ele abre o dialogo (HMO-245, fase 11).
    //
    // Falta UM dado que ninguem pode adivinhar: a conta por onde o Pix passou.
    // Enquanto o acerto nao gerava lancamento, nao faltava nada e o clique
    // bastava; era por isso que o botao registrava a quitacao e o dinheiro nao
    // se mexia em lugar nenhum.
    const direcao = direcaoDoAcerto({
      fromUserId: transfer.from.id,
      toUserId: transfer.to.id,
      userId: user?.id || "",
    });

    // Nao alcancavel pela tela: o botao so aparece para quem e parte (`souParte`
    // no JSX). Tratado porque a alternativa e um dialogo sem direcao, que diria
    // "saiu da conta" para quem esta recebendo.
    if (!direcao) {
      toast.error(
        "Você só pode registrar um acerto em que paga ou recebe. Peça a quem participou."
      );
      return;
    }

    const contraparte = direcao === "recebi" ? transfer.from : transfer.to;

    setAcertoEmCurso({
      chave: `${transfer.from.id}->${transfer.to.id}`,
      direcao,
      fromUserId: transfer.from.id,
      toUserId: transfer.to.id,
      nomeDaContraparte: contraparte.full_name || null,
      acerto,
    });
  };

  /**
   * Grava a quitacao E a perna de quem registra, com a conta escolhida.
   *
   * O `account_id` e o campo novo e e obrigatorio na rota: sem ele o POST volta
   * 400. Esse acoplamento e deliberado -- um cliente que esquecesse a conta
   * voltaria a registrar quitacao sem lancamento nenhum, que e o defeito que
   * esta fase conserta, e ele nao tem sintoma na tela.
   */
  const registrarAcerto = async (contaId: string) => {
    if (!acertoEmCurso) return;
    const { acerto, chave, fromUserId, toUserId } = acertoEmCurso;

    setSettling(chave);
    try {
      const response = await fetch(
        `/api/expense-groups/${groupId}/settlements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from_user_id: fromUserId,
            to_user_id: toUserId,
            // `amount` esta na moeda de `currency`, nunca em real -- a view faz
            // `amount * exchange_rate` para chegar ao que foi abatido.
            amount: acerto.amount,
            currency: acerto.currency,
            exchange_rate: acerto.exchange_rate,
            account_id: contaId,
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
      // O nome da conta vem da RESPOSTA e nao do estado da tela: e a conta em
      // que o lancamento caiu de verdade. Dizer "Acerto registrado" sozinho nao
      // distingue o comportamento novo do antigo.
      const onde = data.lancamento?.account_name
        ? ` Lançado em ${data.lancamento.account_name}.`
        : "";
      // A baixa da 068: quanto do acerto quitou conta gerada pelo fechamento.
      const baixa = Number(data.baixa) || 0;
      const quitou =
        baixa > 0 ? ` Quitou ${formatarValor(baixa)} das contas do fechamento.` : "";
      toast.success(
        sobra
          ? `Acerto registrado.${onde}${quitou} ${sobra}`
          : `Acerto registrado.${onde}${quitou}`
      );
      setAcertoEmCurso(null);
      setVersaoDoFechamento((v) => v + 1);
      await Promise.all([loadBalances(), loadTransfers(), loadSettlements()]);
    } catch (error) {
      console.error("Erro ao registrar acerto:", error);
      toast.error("Não foi possível registrar o acerto");
    } finally {
      setSettling(null);
    }
  };

  /**
   * Apaga uma despesa paga por outro (077). So ela: a despesa com lancamento
   * se apaga apagando o lancamento, na conta de quem pagou. Valor e pagador
   * nao se editam (as partes foram feitas sobre eles): apagar e lancar de novo.
   */
  const handleApagarDespesaSoDoGrupo = async (id: string) => {
    try {
      const response = await fetch(
        `/api/expense-groups/${groupId}/despesa-paga-por-outro?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data.error || "Não foi possível apagar a despesa");
        return;
      }
      toast.success("Despesa apagada do grupo.");
      await Promise.all([loadTransactions(), loadBalances(), loadTransfers()]);
    } catch (error) {
      console.error("Erro ao apagar despesa so do grupo:", error);
      toast.error("Não foi possível apagar a despesa");
    }
  };

  /** Remove um participante sem conta que ainda nao tem historico (077). */
  const handleRemoverSemConta = async (memberId: string) => {
    try {
      const response = await fetch(
        `/api/expense-groups/${groupId}/members/${memberId}`,
        { method: "DELETE" }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data.error || "Não foi possível remover o participante");
        return;
      }
      toast.success("Participante removido.");
      await Promise.all([loadGroup(), loadBalances(), loadTransfers()]);
    } catch (error) {
      console.error("Erro ao remover participante sem conta:", error);
      toast.error("Não foi possível remover o participante");
    }
  };

  /**
   * O acerto entre dois participantes SEM CONTA ("o João pagou o Pedro").
   * Nenhum dos dois tem conta no app, entao nao ha perna nem conta a
   * escolher: o admin so registra que o dinheiro passou (077).
   */
  const handleAcertoEntreSemConta = async (transfer: TransferSuggestion) => {
    const chave = `${transfer.from.id}->${transfer.to.id}`;
    setSettling(chave);
    try {
      const response = await fetch(
        `/api/expense-groups/${groupId}/settlements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from_user_id: transfer.from.id,
            to_user_id: transfer.to.id,
            amount: transfer.amount,
            currency: MOEDA_PADRAO,
            exchange_rate: 1,
          }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(data.error || "Não foi possível registrar o acerto");
        return;
      }
      toast.success(
        `Registrado: ${transfer.from.full_name || "Sem nome"} pagou ${transfer.to.full_name || "Sem nome"}.`
      );
      await Promise.all([loadBalances(), loadTransfers(), loadSettlements()]);
    } catch (error) {
      console.error("Erro ao registrar acerto entre sem conta:", error);
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

      // O AVISO VEM DA RESPOSTA (fase 12). A perna da contraparte sobrevive a
      // este DELETE -- a RLS impede que ele a alcance, e isso e o certo: o
      // dinheiro saiu da conta DELA. Sem dizer isso aqui, o lancamento dela
      // fica nos livros para sempre, e quem desfaz e a unica pessoa que sabe,
      // neste instante, que o acerto deixou de valer.
      if (data.aviso) {
        toast.success(`Acerto desfeito. ${data.aviso}`);
      } else {
        toast.success("Acerto desfeito");
      }
      setVersaoDoFechamento((v) => v + 1);
      await Promise.all([loadBalances(), loadTransfers(), loadSettlements()]);
    } catch (error) {
      console.error("Erro ao desfazer acerto:", error);
      toast.error("Não foi possível desfazer o acerto");
    }
  };

  /**
   * Abre o dialogo da conta para um acerto JA REGISTRADO (HMO-245, fase 12).
   *
   * O passo que faltava: a RLS so deixa cada um lancar na propria conta, entao
   * a perna da contraparte precisa da sessao DELA -- e da conta dela, que
   * ninguem tem como adivinhar. Entre o registro e este clique, os dois lados
   * veem estados diferentes do mesmo acerto, e e o rotulo da linha que diz qual.
   */
  const abrirLancamentoDaMinhaPerna = (s: Settlement, direcao: DirecaoDoAcerto) => {
    const contraparte = direcao === "recebi" ? s.from_user : s.to_user;

    setPernaEmCurso({
      settlementId: s.id,
      direcao,
      nomeDaContraparte: contraparte?.full_name || null,
      // Da QUITACAO, nao da tela: `amount` esta na moeda do pagamento e a
      // cotacao e a congelada em `settled_on` (026).
      valor: s.amount,
      moeda: moedaDaViagem(s.currency),
      cotacao: Number(s.exchange_rate ?? 1) || 1,
    });
  };

  /** Grava a MINHA perna do acerto, com a conta escolhida. */
  const lancarMinhaPerna = async (contaId: string) => {
    if (!pernaEmCurso) return;
    const { settlementId } = pernaEmCurso;

    setPernaSalvando(settlementId);
    try {
      const response = await fetch(
        `/api/expense-groups/${groupId}/settlements/${settlementId}/perna`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: contaId }),
        }
      );
      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Não foi possível lançar o acerto na sua conta");
        return;
      }

      // O nome da conta vem da RESPOSTA: e a conta em que o lancamento caiu de
      // verdade. "Lancado" sozinho nao distingue o caminho novo do antigo, que
      // era a quitacao existir sem perna nenhuma deste lado.
      const onde = data.lancamento?.account_name
        ? ` Lançado em ${data.lancamento.account_name}.`
        : "";
      toast.success(`Acerto lançado na sua conta.${onde}`);
      setPernaEmCurso(null);
      // A lista TEM de recarregar: e `minha_perna` que muda o rotulo da linha,
      // e sem isso a tela continuaria dizendo "ainda nao lancado na sua conta"
      // em cima de um lancamento que acabou de cair.
      await Promise.all([loadBalances(), loadTransfers(), loadSettlements()]);
    } catch (error) {
      console.error("Erro ao lancar a perna do acerto:", error);
      toast.error("Não foi possível lançar o acerto na sua conta");
    } finally {
      setPernaSalvando(null);
    }
  };

  /**
   * Remove a MINHA perna, deixando a quitacao de pe (fase 12).
   *
   * O simetrico do lancamento, e o unico desfazer de quem nao registrou: a
   * quitacao nao e dela para apagar. Quem registrou usa Desfazer, que leva a
   * perna junto -- a rota recusa este caminho para ele, e diz por que.
   */
  const removerMinhaPerna = async (settlementId: string) => {
    setPernaSalvando(settlementId);
    try {
      const response = await fetch(
        `/api/expense-groups/${groupId}/settlements/${settlementId}/perna`,
        { method: "DELETE" }
      );
      const data = await response.json();

      if (!response.ok) {
        toast.error(data.error || "Não foi possível remover o lançamento");
        return;
      }

      // Diz o que NAO aconteceu: "lancamento removido" sozinho e lido como
      // "acerto desfeito", e a divida continua quitada no grupo.
      toast.success(
        "Lançamento removido da sua conta. O acerto continua registrado no grupo."
      );
      await Promise.all([loadBalances(), loadTransfers(), loadSettlements()]);
    } catch (error) {
      console.error("Erro ao remover a perna do acerto:", error);
      toast.error("Não foi possível remover o lançamento");
    } finally {
      setPernaSalvando(null);
    }
  };

  /*
   * `handleResponderParte` SAIU AQUI (HMO-425).
   *
   * Ela era o unico caminho do app para aprovar, recusar ou reabrir a propria
   * parte numa despesa do grupo (HMO-178), junto com a rota
   * `PATCH /api/expense-groups/[groupId]/splits`, que saiu tambem.
   *
   * O que isso muda no dinheiro: `group_member_balances` soma em `total_owed`
   * as partes com `status NOT IN ('rejected','expired')`, e nada mais escreve
   * `rejected`. Toda parte nova nasce `pending` e CONTA -- cada membro deve a
   * parte dele, que e a regra que o grupo ja usa em todo o resto da tela
   * (fechamento, rateio, sugestao de transferencia).
   */

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();

    // Um envio por vez. `salvandoDespesa` e conferido aqui, e nao so no
    // `disabled` do botao: o formulario tambem e enviado pelo Enter dentro de um
    // campo de texto, que nao passa pelo botao nenhuma vez.
    if (salvandoDespesa) return;

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
    // A DESPESA PAGA POR OUTRO (077): vai so para o grupo, pela rota propria,
    // e a divisao e a regra do grupo (peso configurado ou partes iguais) --
    // as sugestoes de divisao abaixo sao do lancamento na minha conta.
    if (expenseForm.paid_by_member_id) {
      setSalvandoDespesa(true);
      try {
        const response = await fetch(
          `/api/expense-groups/${groupId}/despesa-paga-por-outro`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              paid_by_member_id: expenseForm.paid_by_member_id,
              amount: parseFloat(expenseForm.amount),
              description: expenseForm.description,
              expense_date: expenseForm.transaction_date,
              currency: expenseForm.currency,
              exchange_rate: taxa,
            }),
          }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          toast.error(data.error || "Erro ao adicionar despesa");
          return;
        }
        toast.success("Despesa registrada no grupo, paga por outra pessoa.");
        const inicial = valoresIniciaisDaDespesa(group?.currency);
        if (continuarNaDespesa) {
          setExpenseForm((atual) => proximaDespesaDeGrupo(atual, inicial));
        } else {
          setShowAddExpense(false);
          setExpenseForm(inicial);
        }
        await Promise.all([loadTransactions(), loadBalances(), loadTransfers()]);
      } catch (error) {
        console.error("Error adding expense paid by other:", error);
        toast.error("Erro ao adicionar despesa");
      } finally {
        setSalvandoDespesa(false);
      }
      return;
    }

    if (expenseForm.split_type !== "equal" && !selectedSplitSuggestion) {
      toast.error(
        "Escolha uma das divisões sugeridas abaixo, ou use a Divisão Igual."
      );
      return;
    }

    setSalvandoDespesa(true);
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
      delete expenseData.paid_by_member_id;

      // Adicionar dados da sugestão selecionada se houver.
      //
      // `partesParaGravar` tira a parte de 0%, e o filtro e OBRIGATORIO desde
      // que a fase 7 ligou a sugestao configurada: `divisaoPorPorcentagem`
      // recusa `percentage <= 0` ("Percentual inválido na divisão: 0,00%"),
      // entao um grupo 100/0 ofereceria uma sugestao que a tela mostra certa e
      // o POST recusa sempre. A tela continua listando o grupo inteiro; so o
      // corpo do POST e recortado. Ver lib/sugestao-de-divisao.ts.
      if (selectedSplitSuggestion) {
        expenseData.split_type = selectedSplitSuggestion.type;
        expenseData.custom_splits = partesParaGravar(
          selectedSplitSuggestion.splits
        ).map((split) => ({
          member_id: split.member_id,
          percentage: split.percentage,
          amount: split.amount,
        }));
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

        // `valoresIniciaisDaDespesa` nas DUAS pernas, e a moeda do grupo e o
        // motivo: ela volta para a moeda da viagem, nao para real -- a proxima
        // despesa da viagem tambem e na moeda da viagem.
        const inicial = valoresIniciaisDaDespesa(group?.currency);

        if (continuarNaDespesa) {
          // A tela FICA. `proximaDespesaDeGrupo` limpa descricao, valor e
          // observacao e mantem categoria, data, moeda, cotacao e tipo de
          // divisao -- o porque de cada campo esta em lib/retorno-do-lancamento.ts.
          //
          // A forma de funcao em `setExpenseForm` e deliberada: entre o clique e
          // esta linha houve um `await` de rede, e `expenseForm` capturado no
          // fechamento e o estado de ANTES. Com um objeto literal, qualquer
          // tecla digitada durante a gravacao seria descartada; com `atual`, o
          // reset se aplica ao estado mais novo.
          setExpenseForm((atual) => proximaDespesaDeGrupo(atual, inicial));
        } else {
          setShowAddExpense(false);
          setExpenseForm(inicial);
        }

        // Limpa nas duas pernas, e e a limpeza de DINHEIRO desta tela. A
        // sugestao guarda o valor absoluto de cada participante, calculado sobre
        // o total da despesa que acabou de ser gravada; reaproveitada na
        // seguinte, ela rateia o numero errado -- e a cobranca errada vai para a
        // conta dos outros, nao para a de quem digitou. Ver
        // `proximaDespesaDeGrupo`.
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
    } finally {
      setSalvandoDespesa(false);
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

  /*
   * `getStatusColor` e `getStatusIcon` SAIRAM AQUI (HMO-425).
   *
   * As duas pintavam o cracha de status da parte, o unico leitor que elas
   * tinham. Sem caminho que escreva `approved` ou `rejected`, o cracha mostrava
   * o relogio de "pendente" em TODA parte de TODA despesa, para sempre -- um
   * icone sem texto que nao distingue estado nenhum e sugere uma fila de
   * aprovacao que nao existe mais.
   */

  const toggleSection = (sectionId: string) => {
    setOpenSections((prev) =>
      prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId]
    );
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

  // As duas listas da aba de Despesas, as duas no mes do seletor (HMO-248).
  // O recorte e por prefixo de string, nao por `new Date(...).getMonth()`: a
  // despesa do dia 1 caia no mes ANTERIOR em todo fuso negativo, o que inclui
  // o celular de quem usa o app e exclui o CI. Ver lib/periodo-do-grupo.ts.
  const despesasDoMes = recortarRealizado(transactions, mesDoGrupo);
  const previstasDoMes = recortarPrevistas(scheduled, mesDoGrupo);
  const rotuloDoMesDoGrupo = rotuloDoMes(mesDoGrupo);

  // Só o admin vê e responde os pedidos de entrada pelo código (HMO-190).
  const souAdmin =
    group.members?.some(
      (member) => member.user?.id === user?.id && member.role === "admin"
    ) ?? false;

  /**
   * Os membros que DIVIDEM a conta (HMO-245, fase 5).
   *
   * `status === "active"` e obrigatorio, nao higiene: o PUT de `split-config`
   * confere o conjunto contra os membros ativos e recusa um que tenha alguem a
   * mais. Quem saiu do grupo continua na lista acima (com o badge do status),
   * entao passar `group.members` cru faria o botao Salvar devolver 400 sempre,
   * num grupo de onde uma pessoa qualquer ja saiu.
   *
   * `percentage` vai cru: quem decide se o numero gravado da para aplicar e
   * `divisaoDoPeriodo`, a mesma funcao do fechamento do mes.
   */
  const membrosDaDivisao: MembroDaDivisao[] = (group.members ?? [])
    .filter((member) => member.status === "active")
    .map((member) => ({
      member_id: member.id,
      nome: member.user?.full_name,
      percentage: member.percentage,
    }));

  /*
    A LINHA DE UM ACERTO NA LISTA DO MES.

    Os pagamentos registrados moravam numa lista propria, na aba Balancos. Na
    tela simplificada eles entram na MESMA lista das contas, na data em que
    aconteceram -- "Fulano pagou Beltrano" e um evento do mes como o mercado ou
    a luz, e e assim que se le o historico do grupo de cima para baixo.

    O corpo e o mesmo de antes, sem mudar uma regra: o estado da minha perna, o
    Desfazer e o "Lancar o que recebi" continuam vindo de `comoEuVejoOAcerto`.
  */
  const linhaDoAcerto = (s: Settlement) => {
                        /*
                          O ESTADO DESTE ACERTO PARA MIM (HMO-245, fase 12).

                          A MESMA funcao que a rota usa para decidir se aceita o
                          pedido. Duas copias da regra -- uma no JSX, outra no
                          servidor -- divergem no caso que importa, e a tela
                          passa a oferecer uma acao que a rota recusa.

                          `minha_perna` e o dado que nao se deduz da tela: o
                          acerto aparece IGUAL lancado e nao lancado, e e por
                          isso que "nao lancado" seria indistinguivel de "nao
                          aconteceu" sem o rotulo.
                        */
                        const visao: AcertoVistoPorMim = comoEuVejoOAcerto({
                          acerto: {
                            from_user_id: s.from_user_id,
                            to_user_id: s.to_user_id,
                            created_by: s.created_by,
                          },
                          userId: user?.id || "",
                          temPerna: Boolean(s.minha_perna),
                          nomeDaConta: contas.find(
                            (c) => c.id === s.minha_perna?.account_id
                          )?.name,
                        });

                        const estaEmVoo = pernaSalvando === s.id;

                        return (
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
                          className="p-3 rounded-lg bg-muted/40 space-y-2"
                        >
                        <div className="flex items-center justify-between gap-3">
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
                            {visao.podeDesfazerOAcerto && (
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

                        {/*
                          O ESTADO DESTE ACERTO NA MINHA CONTA (fase 12).

                          Sem esta linha, a tela de quem nao confirmou mostra o
                          acerto com valor, data e os dois nomes -- e nenhum
                          sinal de que o dinheiro nao passou pela conta dela.
                          "Nao lancado" fica indistinguivel de "nao aconteceu",
                          e o Pix nunca entra no extrato dela.

                          `visao.rotulo` e `null` para o acerto entre outras
                          duas pessoas: ali a frase seria mentira.
                        */}
                        {visao.rotulo && (
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span
                              className={
                                visao.estado === "a_lancar"
                                  ? "text-xs text-warning"
                                  : "text-xs text-muted-foreground"
                              }
                            >
                              {visao.rotulo}
                            </span>

                            {visao.podeLancar && visao.direcao && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={estaEmVoo}
                                onClick={() =>
                                  abrirLancamentoDaMinhaPerna(s, visao.direcao!)
                                }
                              >
                                {visao.direcao === "recebi"
                                  ? "Lançar o que recebi"
                                  : "Lançar o que paguei"}
                              </Button>
                            )}

                            {visao.podeDesfazerSoAMinhaPerna && (
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={estaEmVoo}
                                onClick={() => removerMinhaPerna(s.id)}
                              >
                                Desfazer o meu lançamento
                              </Button>
                            )}
                          </div>
                        )}
                        </div>
                        );
  };

  /** "Você" quando o id e o meu; o nome, quando ha; senao "Sem nome". */
  const nomeNaTela = (
    pessoa: { id?: string | null; full_name?: string | null } | null | undefined
  ) =>
    pessoa?.id && pessoa.id === user?.id
      ? "Você"
      : pessoa?.full_name || "Sem nome";

  const MESES_CURTOS = [
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
  ];

  /*
    UMA CONTA NA LISTA, NO JEITO DIRETO (pedido do Helio, 07/11/2026).

    Tres colunas e nada mais: a data, o que foi e quem pagou quanto, e o que
    isso significa PARA MIM ("você emprestou" / "você deve"). A divisao inteira,
    a cotacao e o Apagar da despesa so do grupo continuam existindo, mas so
    aparecem quando a pessoa toca na linha -- antes vinham abertos em toda
    despesa, e uma lista de dez contas virava uma parede de partes.
  */
  const linhaDaConta = (transaction: GroupTransaction) => {
    const moeda = moedaDaViagem(transaction.currency);
    const posicao = minhaPosicaoNaConta(transaction, user?.id);
    const aberta = contaAberta === transaction.id;
    const dia = transaction.transaction_date?.slice(8, 10) ?? "";
    const mesCurto =
      MESES_CURTOS[Number(transaction.transaction_date?.slice(5, 7)) - 1] ?? "";

    return (
      <li key={`conta-${transaction.id}`} className="py-1">
        <button
          type="button"
          onClick={() => setContaAberta(aberta ? null : transaction.id)}
          aria-expanded={aberta}
          className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted/50"
        >
          <div className="w-9 shrink-0 text-center leading-tight">
            <span className="block text-[10px] uppercase text-muted-foreground">
              {mesCurto}
            </span>
            <span className="block text-lg font-semibold">{dia}</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{transaction.description}</p>
            <p className="truncate text-xs text-muted-foreground">
              {nomeNaTela(transaction.payer)}{" "}
              pagou{" "}
              {formatarValor(transaction.amount, moeda)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {posicao.tipo === "fora" ? (
              <p className="text-xs text-muted-foreground">não participa</p>
            ) : (
              <>
                <p
                  className={`text-xs ${
                    posicao.tipo === "emprestou" ? "text-success" : "text-warning"
                  }`}
                >
                  {posicao.tipo === "emprestou" ? "você emprestou" : "você deve"}
                </p>
                <p
                  className={`font-semibold ${
                    posicao.tipo === "emprestou" ? "text-success" : "text-warning"
                  }`}
                >
                  {formatarValor(posicao.valor, moeda)}
                </p>
              </>
            )}
          </div>
        </button>

        {aberta && (
          <div className="ml-14 mr-2 mb-2 space-y-2 rounded-md bg-muted/40 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{dataNaTela(transaction.transaction_date)}</span>
              {transaction.category && (
                <Badge variant="secondary" className="text-xs">
                  {transaction.category.name}
                </Badge>
              )}
              {/* Na moeda da DESPESA, com o valor em real ao lado so quando a
                  moeda e outra -- pela cotacao congelada do dia da compra. */}
              {moeda !== MOEDA_PADRAO && (
                <span>
                  {formatCurrency(
                    valorEmReais(transaction.amount, transaction.exchange_rate ?? 1)
                  )}{" "}
                  na cotação do dia
                </span>
              )}
              {transaction.so_do_grupo && (
                <Badge variant="outline" className="text-xs">
                  Só no grupo
                </Badge>
              )}
            </div>
            <ul className="space-y-1">
              {transaction.splits.map((split) => (
                <li
                  key={split.id}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate">{nomeNaTela(split.member)}</span>
                  <span className="shrink-0">
                    {formatarValor(split.amount, moeda)}
                  </span>
                </li>
              ))}
            </ul>
            {/* A despesa paga por outro (077): mora so no grupo, nao em conta
                nenhuma. Quem lancou ou o admin apaga; valor e pagador nao se
                editam. */}
            {transaction.so_do_grupo &&
              (transaction.created_by === user?.id || souAdmin) && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => handleApagarDespesaSoDoGrupo(transaction.id)}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Apagar
                </Button>
              )}
          </div>
        )}
      </li>
    );
  };

  // Os acertos do mes do seletor, pelo mesmo recorte de string das contas.
  const acertosDoMes = settlements.filter(
    (s) => mesDaData(s.settled_on) === mesDaData(mesDoGrupo)
  );

  // A lista do mes: contas e acertos juntos, do mais novo para o mais antigo.
  // A data e `YYYY-MM-DD` nos dois, entao a ordem de string e a ordem do tempo.
  const itensDoMes = [
    ...despesasDoMes.map((t) => ({
      chave: `c-${t.id}`,
      data: t.transaction_date ?? "",
      criado: t.created_at ?? "",
      no: linhaDaConta(t),
    })),
    ...acertosDoMes.map((s) => ({
      chave: `a-${s.id}`,
      data: s.settled_on ?? "",
      criado: "",
      no: <li key={`acerto-${s.id}`} className="py-1">{linhaDoAcerto(s)}</li>,
    })),
  ].sort((a, b) => b.data.localeCompare(a.data) || b.criado.localeCompare(a.criado));

  const meuSaldo = balances.find((b) => user?.id && b.member.id === user.id);
  const membrosAtivos = (group.members ?? []).filter(
    (m) => m.status === "active"
  ).length;
  const pedidosPendentes = souAdmin ? group.pendingMembers?.length ?? 0 : 0;

  const irParaQuemPagaQuem = () =>
    document
      .getElementById("quem-paga-quem")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });

  const abrirMembros = () => {
    setActiveTab("members");
    document
      .getElementById("mais-do-grupo")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/*
        A TELA DO GRUPO, SIMPLIFICADA (pedido do Helio, 07/11/2026).

        Antes: quatro cartoes de numeros, o orcamento, quatro abas e, na
        primeira delas, o fechamento do mes inteiro antes da primeira despesa.
        A pergunta de quem abre esta tela e uma de duas -- "o que foi lancado?"
        e "quem paga quem?" -- e cada uma estava atras de um clique ou de uma
        rolagem.

        Agora: o cabecalho com as duas acoes (adicionar despesa e acertar), a
        lista de contas do mes ao lado do "quem paga quem", e o resto (fechamento
        do mes, painel, membros e divisao) embaixo, em "Mais do grupo". Nenhuma
        funcao saiu da tela: so mudou o que aparece primeiro.
      */}
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Voltar para Grupos"
            onClick={() => router.push("/dashboard/expense-groups")}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
              <span className="truncate">{group.name}</span>
              <SeloDoTipoDoGrupo tipo={tipoDoGrupo(group.group_kind)} />
            </h1>
            <p className="text-sm text-muted-foreground">
              {membrosAtivos} {membrosAtivos === 1 ? "pessoa" : "pessoas"} •
              código {group.group_code}
              {pedidosPendentes > 0 && (
                <>
                  {" • "}
                  <button
                    type="button"
                    className="font-medium text-warning underline-offset-2 hover:underline"
                    onClick={abrirMembros}
                  >
                    {pedidosPendentes}{" "}
                    {pedidosPendentes === 1 ? "pedido" : "pedidos"} para entrar
                  </button>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
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
            Adicionar despesa
          </Button>
          <Button
            variant="outline"
            onClick={irParaQuemPagaQuem}
            className="flex items-center gap-2"
          >
            <CheckCircle className="h-4 w-4" />
            Acertar contas
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* ------------------------------------------------------------
            CONTAS LANCADAS
            ------------------------------------------------------------ */}
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">
                    {/* O mes no TITULO: a lista segue o seletor, e um titulo
                        fixo mentiria sobre ela em todo mes que nao e o de hoje. */}
                    Despesas de {rotuloDoMesDoGrupo}
                  </CardTitle>
                  <CardDescription>
                    {despesasDoMes.length} conta
                    {despesasDoMes.length !== 1 ? "s" : ""} • Total:{" "}
                    {formatCurrency(
                      despesasDoMes.reduce(
                        (sum, t) =>
                          sum + valorEmReais(t.amount, t.exchange_rate ?? 1),
                        0
                      )
                    )}
                  </CardDescription>
                </div>
                {/* As setas mexem no MESMO `mesDoGrupo` do seletor do
                    fechamento (em Mais do grupo): dois meses na mesma tela
                    dariam uma lista de um mes e um rateio de outro. */}
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Mês anterior"
                    onClick={() => setMesDoGrupo(mesVizinho(mesDoGrupo, -1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Próximo mês"
                    onClick={() => setMesDoGrupo(mesVizinho(mesDoGrupo, 1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
            {/*
              Previstas: o que o grupo AINDA VAI pagar (HMO-177), no mes do
              seletor (HMO-248).

              Fica separada das outras secoes de proposito. As demais listam
              despesa que ja aconteceu e tem divisao gravada, com uma parte por
              membro; aqui nao ha divisao nenhuma ainda -- ela nasce na baixa da
              conta prevista. Misturar as duas na mesma lista faria o total do
              grupo somar dinheiro que ninguem gastou.

              O RECORTE DE MES E O QUE A HMO-248 CONSERTOU. Uma despesa fixa
              nao grava uma linha: grava uma regra e MATERIALIZA uma parcela por
              mes do horizonte. Sem recorte, o aluguel de R$ 1.800 aparecia tres
              vezes e a legenda dizia "Total: R$ 5.400" -- o aluguel de tres
              meses somado num cartao que nao diz de qual mes fala.

              So aparece quando existe alguma NO MES: mes sem conta prevista
              continua vendo a tela de antes.
            */}
            {previstasDoMes.doMes.length > 0 && (
              <Card>
                <CardHeader
                  className="cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => toggleSection("scheduled")}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Clock className="h-5 w-5" />
                        Previstas de {rotuloDoMesDoGrupo}
                        <Badge variant="outline">
                          {previstasDoMes.doMes.length} a vencer
                        </Badge>
                      </CardTitle>
                      <CardDescription>
                        Ainda não aconteceram • Total:{" "}
                        {formatCurrency(previstasDoMes.total)} • Sua parte:{" "}
                        {formatCurrency(previstasDoMes.parte)}
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
                    {previstasDoMes.doMes.map((item) => (
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
                                {dataNaTela(item.due_date)}
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

                        {/*
                          QUEM JA RESOLVEU A PARTE DELE (HMO-411).

                          Sem este bloco o `reported` que o membro grava em
                          `group_bill_payments` e dado sem leitor -- nesta base
                          o mesmo que nao existir --, e a feature passaria
                          verde com ninguem vendo nada.

                          `item.estado_por_membro &&` e nao `?.length`: a
                          resposta guardada no aparelho de antes desta feature
                          vem sem o campo, e desenhar um quadro vazio ali
                          afirmaria "ninguem avisou" com base num corpo que
                          nunca respondeu isso.
                        */}
                        {item.estado_por_membro && (
                          <div
                            className="mt-3 border-t border-border pt-2"
                            data-quadro-da-prevista={item.id}
                          >
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              {item.estado_por_membro.map((membro, i) => (
                                <span
                                  key={membro.user_id}
                                  data-estado-do-membro={membro.user_id}
                                  data-estado={membro.estado}
                                >
                                  {i > 0 && <span className="mr-2">·</span>}
                                  <span
                                    className={
                                      membro.estado === "pendente"
                                        ? ""
                                        : "text-foreground"
                                    }
                                  >
                                    {membro.full_name ?? "Membro"}{" "}
                                    {FRASE_DO_ESTADO[membro.estado]}
                                  </span>
                                </span>
                              ))}
                            </div>
                            {item.estado_parcial && (
                              <p
                                className="mt-1 text-xs text-muted-foreground"
                                data-quadro-parcial={item.id}
                              >
                                {SO_O_DONO_VE_O_QUADRO}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                )}
              </Card>
            )}

            {/*
              O que o recorte do mes DEIXOU DE FORA, dito em texto (HMO-248).

              Recortar no mes escondia duas coisas uteis: a parcela VENCIDA de
              um mes passado -- que e justamente a que pede acao -- e o aluguel
              do mes que vem. Sumir da tela sem rotulo e indistinguivel de "nao
              existe", e a pessoa que acabou de cadastrar a despesa fixa
              concluiria que ela nao foi gravada.

              Fica FORA do cartao de propósito: aparece tambem quando o mes nao
              tem nenhuma prevista e o cartao acima nem e montado, que e
              exatamente o caso de quem esta olhando o mes errado.
            */}
            {(previstasDoMes.antes.quantidade > 0 ||
              previstasDoMes.depois.quantidade > 0) && (
              <p className="text-xs text-muted-foreground">
                Fora de {rotuloDoMesDoGrupo}:{" "}
                {[
                  previstasDoMes.antes.quantidade > 0 &&
                    `${previstasDoMes.antes.quantidade} vencida${
                      previstasDoMes.antes.quantidade !== 1 ? "s" : ""
                    } antes (${formatCurrency(previstasDoMes.antes.total)})`,
                  previstasDoMes.depois.quantidade > 0 &&
                    `${previstasDoMes.depois.quantidade} a vencer depois (${formatCurrency(
                      previstasDoMes.depois.total
                    )})`,
                ]
                  .filter(Boolean)
                  .join(" • ")}
                . Use as setas acima para ver.
              </p>
            )}

              {itensDoMes.length > 0 ? (
                <ul className="divide-y">{itensDoMes.map((item) => item.no)}</ul>
              ) : (
                <div className="py-10 text-center">
                  <p className="font-medium">Nenhuma conta neste mês</p>
                  <p className="text-sm text-muted-foreground">
                    Toque em &quot;Adicionar despesa&quot; para lançar a primeira.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ------------------------------------------------------------
            QUEM PAGA QUEM
            ------------------------------------------------------------ */}
        <div id="quem-paga-quem" className="scroll-mt-6 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Quem paga quem</CardTitle>
              {/*
                O EIXO DE TEMPO E O RECORTE, ESCRITOS (HMO-404, item 2): este
                saldo sai de `group_member_balances` (007), o ACUMULADO de todos
                os meses, so do realizado e com os acertos netados -- e por isso
                difere do rateio do mes, que soma o previsto. Sem a frase, os
                dois numeros se leem como um deles estando quebrado.
              */}
              <CardDescription>
                Quem deve pagar para quem — acumulado de todos os meses, só do
                que já foi pago, com os acertos já descontados.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* O MEU saldo primeiro, numa frase: e o numero que quem abre a
                  tela quer saber antes de ler a lista de todo mundo. */}
              {meuSaldo && (
                <div className="rounded-lg bg-muted p-3">
                  {meuSaldo.balance > 0.01 ? (
                    <p className="text-sm">
                      Você tem{" "}
                      <span className="font-semibold text-success">
                        {formatCurrency(meuSaldo.balance)}
                      </span>{" "}
                      a receber
                    </p>
                  ) : meuSaldo.balance < -0.01 ? (
                    <p className="text-sm">
                      Você deve{" "}
                      <span className="font-semibold text-warning">
                        {formatCurrency(Math.abs(meuSaldo.balance))}
                      </span>{" "}
                      no total
                    </p>
                  ) : (
                    <p className="text-sm">Você está quitado neste grupo.</p>
                  )}
                </div>
              )}

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

              {/* Transfer Suggestions: o menor numero de transferencias que
                  zera o grupo. Ao registrar, a sugestao sai da lista e o
                  pagamento entra na lista de contas, no mes em que aconteceu. */}
              {transfers.length > 0 ? (
                <ul className="space-y-2">
                  {transfers.map((transfer, index) => {
                    const chave = `${transfer.from.id}->${transfer.to.id}`;
                    // So quem paga ou quem recebe pode registrar: a policy
                    // de INSERT da 007 exige isso, e oferecer o botao a um
                    // terceiro seria prometer uma acao que o banco recusa.
                    const souParte =
                      user?.id === transfer.from.id ||
                      user?.id === transfer.to.id;
                    // QUEM RECEBE NAO PAGOU: o rotulo diz a direcao.
                    const souQuemRecebe = user?.id === transfer.to.id;
                    const souQuemPaga = user?.id === transfer.from.id;

                    // O mesmo pagamento na moeda da viagem, ao cambio de
                    // hoje -- ou `null` quando nao ha o que oferecer. O teste
                    // de moeda vem ANTES da chamada porque
                    // `acertoNaMoedaDaViagem(x, 'BRL', 1)` responde um acerto
                    // valido, e poria um "Paguei em BRL" em todo grupo em real.
                    const naViagem =
                      contextoDeMoeda.group_currency !== MOEDA_PADRAO
                        ? acertoNaMoedaDaViagem(
                            transfer.amount,
                            contextoDeMoeda.group_currency,
                            contextoDeMoeda.today_rate
                          )
                        : null;

                    return (
                      <li
                        key={index}
                        className="space-y-2 rounded-lg border p-3"
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <Avatar className="h-6 w-6 shrink-0">
                            <AvatarImage src={transfer.from.avatar_url} />
                            <AvatarFallback>
                              {inicial(transfer.from.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">
                            {nomeNaTela(transfer.from)}
                          </span>
                          <span className="text-muted-foreground">paga</span>
                          <Avatar className="h-6 w-6 shrink-0">
                            <AvatarImage src={transfer.to.avatar_url} />
                            <AvatarFallback>
                              {inicial(transfer.to.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium">
                            {nomeNaTela(transfer.to)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-end justify-between gap-2">
                          <div>
                            <p className="text-lg font-bold">
                              {formatCurrency(transfer.amount)}
                            </p>
                            {naViagem && (
                              <p className="text-xs text-muted-foreground">
                                ≈{" "}
                                {formatarValor(
                                  naViagem.amount,
                                  naViagem.currency
                                )}{" "}
                                hoje
                              </p>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {/* Entre dois sem conta (077): ninguem com conta
                                e parte, entao o admin registra que o dinheiro
                                passou -- sem perna, sem conta. */}
                            {!souParte &&
                              souAdmin &&
                              transfer.from.sem_conta &&
                              transfer.to.sem_conta && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    handleAcertoEntreSemConta(transfer)
                                  }
                                  disabled={settling === chave}
                                >
                                  {settling === chave
                                    ? "Registrando..."
                                    : "Registrar que pagou"}
                                </Button>
                              )}
                            {souParte && (
                              <Button
                                size="sm"
                                onClick={() => handleLiquidar(transfer)}
                                disabled={settling === chave}
                              >
                                {settling === chave
                                  ? "Registrando..."
                                  : naViagem
                                  ? souQuemRecebe
                                    ? "Recebi em reais"
                                    : "Paguei em reais"
                                  : souQuemRecebe
                                  ? "Já recebi"
                                  : "Já paguei"}
                              </Button>
                            )}
                            {/* O segundo botao so existe quando ha cotacao de
                                hoje: sem ela o clique nao teria para onde ir. */}
                            {souParte && naViagem && (
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
                                {souQuemRecebe ? "Recebi" : "Paguei"} em{" "}
                                {naViagem.currency}
                              </Button>
                            )}
                          </div>
                        </div>
                        {/* O Pix de quem vai RECEBER, para quem vai pagar
                            (HMO-201). So nessa direcao: a chave ao lado de quem
                            deve nao serve para nada. */}
                        {souQuemPaga && (
                          <div className="border-t pt-2">
                            <PixDoMembro
                              pix={chavesPix.get(transfer.to.id)}
                              nome={transfer.to.full_name}
                            />
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                balances.length > 0 && (
                  <div className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3">
                    <CheckCircle className="h-4 w-4 shrink-0 text-success" />
                    <p className="text-sm text-success">
                      Tudo acertado. Ninguém deve nada a ninguém.
                    </p>
                  </div>
                )
              )}

              {/* O saldo de cada um, numa linha so. */}
              {balances.length > 0 && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
                    Saldos
                  </h4>
                  <ul className="divide-y">
                    {balances.map((balance) => {
                      const apresentado = saldoNaMoedaDaViagem(
                        balance.balance,
                        contextoDeMoeda.group_currency,
                        contextoDeMoeda.today_rate
                      );
                      return (
                        <li
                          key={balance.member.id}
                          className="flex items-center justify-between gap-2 py-2"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <Avatar className="h-6 w-6 shrink-0">
                              <AvatarImage src={balance.member.avatar_url} />
                              <AvatarFallback>
                                {inicial(balance.member.full_name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate text-sm">
                              {nomeNaTela(balance.member)}
                            </span>
                          </div>
                          <div className="shrink-0 text-right text-sm">
                            {balance.balance > 0.01 ? (
                              <span className="text-success">
                                recebe {formatCurrency(balance.balance)}
                              </span>
                            ) : balance.balance < -0.01 ? (
                              <span className="text-warning">
                                deve {formatCurrency(Math.abs(balance.balance))}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                quitado
                              </span>
                            )}
                            {/* O mesmo saldo na moeda da viagem, ao cambio de
                                hoje. `Math.abs` porque o sentido ja esta escrito
                                na frase de cima. */}
                            {apresentado.naMoedaDaViagem !== null &&
                              Math.abs(balance.balance) > 0.01 && (
                                <span
                                  className="block text-xs text-muted-foreground"
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
                                </span>
                              )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ----------------------------------------------------------------
          MAIS DO GRUPO: o que antes disputava a primeira dobra da tela.
          Continua tudo aqui, so que embaixo e sob demanda.
          ---------------------------------------------------------------- */}
      <div id="mais-do-grupo" className="scroll-mt-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          {/* `grid-cols-3` acompanha o numero de abas. */}
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="mes">Mês a mês</TabsTrigger>
            <TabsTrigger value="painel">Painel</TabsTrigger>
            <TabsTrigger value="members">
              Membros
              {pedidosPendentes > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                  {pedidosPendentes}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/*
            O fechamento do mes (HMO-245): o total que junta previsto e
            realizado e diz quanto cada um paga no mes. O seletor dele e o MESMO
            `mesDoGrupo` das setas da lista de contas.

            A barra do orcamento (HMO-180) mora aqui tambem: ela so aparece
            quando o grupo tem teto no mes.
          */}
          <TabsContent value="mes" className="space-y-4">
            {orcamento && (
              <CartaoOrcamentoGrupo
                grupo={orcamento}
                titulo="Orçamento do grupo"
                mes={mesDoOrcamento}
              />
            )}
            <FechamentoDoMes
              groupId={groupId}
              mes={mesDoGrupo}
              onMesChange={setMesDoGrupo}
            />
          </TabsContent>

          {/* O painel do grupo (HMO-201): totais e gasto por categoria.
              Montado so com a aba ativa -- ele dispara duas chamadas. */}
          <TabsContent value="painel" className="space-y-4">
            {activeTab === "painel" && <PainelDoGrupo groupId={groupId} />}
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
                          {member.user?.full_name || "Sem nome"}
                          {member.role === "admin" && (
                            <Crown className="h-4 w-4 text-warning" />
                          )}
                          {member.sem_conta && (
                            <Badge variant="outline" className="text-xs">
                              sem conta
                            </Badge>
                          )}
                        </h4>
                        <p className="text-sm text-muted-foreground capitalize">
                          {member.role} • {member.status}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-2">
                      <Badge
                        variant={
                          member.status === "active" ? "default" : "secondary"
                        }
                      >
                        {member.status}
                      </Badge>
                      {/* So quem nao tem conta sai por aqui, e so sem
                          historico: a rota responde 409 se ja dividiu algo. */}
                      {souAdmin && member.sem_conta && (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-label={`Remover ${member.user?.full_name || "participante"}`}
                          onClick={() => handleRemoverSemConta(member.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {/* O amigo do churrasco que nao vai instalar o app (077). So o
                  admin adiciona (RLS de group_members). */}
              {souAdmin && (
                <div className="mt-4">
                  <AdicionarSemConta groupId={groupId} aoAdicionar={loadGroup} />
                </div>
              )}
            </CardContent>
          </Card>

          {/*
            A configuracao da divisao (HMO-245, fase 5).

            Fica na aba de Membros, e nao numa quinta aba, por dois motivos: os
            rotulos de cinco abas nao cabem em 375px (esta tela ja teve estouro
            horizontal), e a pergunta "quanto cada um paga" nasce olhando a
            lista de quem esta no grupo -- logo acima.

            Montada so com a aba ativa: ela busca o fechamento do mes para ter o
            R$ de cada um, e quem veio ver a lista de despesas nao deve pagar
            essa chamada.

            `membrosDaDivisao` filtra por `status === "active"` porque a lista
            acima mostra TODO mundo, inclusive quem saiu -- e o PUT da fase 3
            recusa um conjunto que nao seja exatamente o dos ativos. O mes e o
            `mesDoGrupo`, o mesmo do seletor do fechamento: dois meses na mesma
            tela dariam dois R$ diferentes para a mesma divisao.
          */}
          {activeTab === "members" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5" />
                  Divisão da conta
                </CardTitle>
                <CardDescription>{rotuloDoMesDoGrupo}</CardDescription>
              </CardHeader>
              <CardContent>
                <DivisaoDoGrupo
                  groupId={groupId}
                  membros={membrosDaDivisao}
                  modoGravado={group.default_split_type}
                  mes={mesDoGrupo}
                  ehAdmin={souAdmin}
                  aoGravar={loadGroup}
                />
              </CardContent>
            </Card>
          )}

          {/*
            O fechamento por periodo (RN018, fase 2 do modelo novo): o dia de
            fechamento, a previa do periodo aberto e os fechamentos feitos.
            Logo abaixo da divisao porque o fechamento usa as duas
            configuracoes -- o % de cada um e o dia --, e quem mexe numa precisa
            ver a outra. Montado so com a aba ativa, pelo mesmo motivo da
            divisao: quem veio ver a lista de despesas nao paga esta chamada.
          */}
          {activeTab === "members" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CalendarCheck className="h-5 w-5" />
                  Fechamento do grupo
                </CardTitle>
                <CardDescription>
                  O período fecha num dia do mês, e o saldo de cada um vira uma conta.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FechamentoDoPeriodo
                  groupId={groupId}
                  ehAdmin={souAdmin}
                  versao={versaoDoFechamento}
                  aoAcertar={(sugerido: AcertoSugerido) =>
                    handleLiquidar({
                      from: { id: sugerido.de.id, full_name: sugerido.de.nome },
                      to: { id: sugerido.para.id, full_name: sugerido.para.nome },
                      amount: sugerido.valor,
                    })
                  }
                />
              </CardContent>
            </Card>
          )}
          </TabsContent>
        </Tabs>
      </div>

      {/* ----------------------------------------------------------------
          "ADICIONAR NOVA DESPESA": O MODAL DE VERDADE (HMO-251)
          ----------------------------------------------------------------
          Aqui havia um modal feito a mao: um div com `fixed inset-0
          bg-black/50` e um `<Card>` dentro. Ele PARECIA um modal, e foi por
          isso que a HMO-249 passou por ele sem trocar -- o que faltava nao
          aparece num print da tela:

            - Esc nao fechava, e clique fora nao fechava. A unica saida era
              achar o botao Cancelar, que no celular fica abaixo da dobra de
              um formulario com seletor de categoria e painel de rateio.
            - sem papel de dialogo e sem armadilha de foco: o Tab passeava
              pela pagina ATRAS do overlay, e leitor de tela nao anunciava
              que algo tinha aberto.

          `ModalDeLancamento` resolve os tres de graca, por ser o `Dialog` do
          repo, e ja carrega as decisoes de tamanho (a largura maior, a margem
          de 1rem no celular, a altura maxima com rolagem por dentro) que este
          formulario -- um dos mais altos do app -- precisa. Ele e montado
          CONDICIONALMENTE, como em `ModalDeMovimentacao`: o `open` nasce true
          la dentro, e quem decide se ele existe e o `showAddExpense` daqui.
      */}
      {showAddExpense && (
        <ModalDeLancamento
          titulo="Adicionar Nova Despesa"
          descricao="Registre uma despesa para o grupo"
          aoFechar={() => setShowAddExpense(false)}
        >
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

            {/* QUEM PAGOU (077). "Eu" e o caminho de sempre: a despesa entra
                na minha conta e o grupo divide. Outra pessoa -- com ou sem
                conta no app -- vira uma despesa so do grupo: nao sai de conta
                nenhuma, entra inteira no saldo de quem pagou, e a divisao e a
                regra do grupo. */}
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="paid_by_member">Quem pagou</Label>
                {expenseForm.paid_by_member_id && (
                  <Dica rotulo="Sobre quem pagou">
                    Fica só no grupo: não entra em nenhuma conta, e é dividida
                    pela regra do grupo.
                  </Dica>
                )}
              </div>
              <Select
                value={expenseForm.paid_by_member_id || "eu"}
                onValueChange={(value) =>
                  setExpenseForm({
                    ...expenseForm,
                    paid_by_member_id: value === "eu" ? "" : value,
                  })
                }
              >
                <SelectTrigger id="paid_by_member">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="eu">Eu (lança na minha conta)</SelectItem>
                  {(group.members ?? [])
                    .filter(
                      (m) => m.status === "active" && m.user?.id !== user?.id
                    )
                    .map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.user?.full_name || "Sem nome"}
                        {m.sem_conta ? " (sem conta)" : ""}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="transaction_date">Data</Label>
              {/* `CampoDeData` e nao o controle de data nativo (HMO-240). Aqui
                  a data nao e so rotulo: `exchange_rate` e congelada pela
                  cotacao DO DIA DA COMPRA, entao uma data lida na ordem do
                  aparelho (mm/dd) traria a cotacao do dia errado para o
                  rateio de uma despesa em moeda estrangeira. */}
              <CampoDeData
                id="transaction_date"
                value={expenseForm.transaction_date}
                onChange={(transaction_date) =>
                  setExpenseForm({ ...expenseForm, transaction_date })
                }
                aria-label="Data"
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

            {!expenseForm.paid_by_member_id && (
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
            )}

            {/* Sugestões de Split */}
            {!expenseForm.paid_by_member_id && parseFloat(expenseForm.amount) > 0 && (
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

            {/* O interruptor fica ACIMA dos botoes: ele e uma promessa sobre
                o que o botao de baixo vai fazer, e precisa ser lido antes do
                clique.

                As frases sao proprias porque as padrao nomeiam campos que
                este formulario nao tem ("conta", "grupo" -- aqui o grupo E a
                tela) e deixam de fora justamente o que mais importa nesta:
                a divisao sugerida, que NAO sobrevive. Um texto de apoio que
                nomeia o campo errado e pior que nenhum -- ele e a unica
                fonte sobre o que vai ser apagado, e quem confia nele deixa
                de conferir. Ver `SalvarEContinuar`. */}
            <SalvarEContinuar
              ligado={continuarNaDespesa}
              aoMudar={setContinuarNaDespesa}
              disabled={salvandoDespesa}
              frases={{
                ligado:
                  "A tela fica aberta para a próxima despesa do grupo. Descrição, valor e observações são limpos; categoria, data e moeda continuam. A divisão sugerida precisa ser escolhida de novo.",
                desligado:
                  "Ao salvar, esta tela fecha e você volta para o grupo.",
              }}
            />

            <div className="flex gap-2">
              {/* `disabled` enquanto grava. Com o modal FECHANDO ao salvar, o
                  duplo clique era barrado pelo botao desaparecer; com
                  "Salvar e continuar" ligado o botao fica onde esta, e cada
                  envio repetido e uma despesa nova RATEADA entre os
                  participantes pelo trigger do banco -- cobranca que cai na
                  conta de outras pessoas, nao so na de quem clicou. */}
              <Button type="submit" disabled={salvandoDespesa}>
                {salvandoDespesa ? "Adicionando..." : "Adicionar Despesa"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={salvandoDespesa}
                onClick={() => setShowAddExpense(false)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </ModalDeLancamento>
      )}

      {/* O campo de conta do acerto (HMO-245, fase 11). Fica fora das abas: a
          sugestao de pagamento mora na aba de saldos, mas o dialogo e modal e
          nao deve depender de qual aba esta aberta quando a resposta chega. */}
      {acertoEmCurso && (
        <DialogoDeAcerto
          aberto={true}
          aoFechar={() => setAcertoEmCurso(null)}
          direcao={acertoEmCurso.direcao}
          nomeDaContraparte={acertoEmCurso.nomeDaContraparte}
          valor={acertoEmCurso.acerto.amount}
          moeda={acertoEmCurso.acerto.currency}
          cotacao={acertoEmCurso.acerto.exchange_rate}
          contas={contas}
          aviso={avisoDeSobra(acertoEmCurso.acerto)}
          aoConfirmar={registrarAcerto}
          salvando={settling === acertoEmCurso.chave}
        />
      )}

      {/* A conta da MINHA perna, para um acerto que JA existe (fase 12).
          O mesmo dialogo, porque o dado que falta e o mesmo -- a conta --, com
          titulo e botao proprios: aqui nao se registra acerto nenhum, ele ja
          esta registrado. Sem a troca de texto, "Registrar acerto" sugeriria
          que clicar de novo registra um segundo pagamento.

          `aviso` nao vem: a sobra de centavo e da DIVISAO do valor na moeda da
          viagem, decidida quando o acerto foi registrado. Aqui o valor ja esta
          gravado, e repetir o aviso diria que ha uma escolha a fazer onde nao
          ha. */}
      {pernaEmCurso && (
        <DialogoDeAcerto
          aberto={true}
          aoFechar={() => setPernaEmCurso(null)}
          direcao={pernaEmCurso.direcao}
          nomeDaContraparte={pernaEmCurso.nomeDaContraparte}
          valor={pernaEmCurso.valor}
          moeda={pernaEmCurso.moeda}
          cotacao={pernaEmCurso.cotacao}
          contas={contas}
          titulo={
            pernaEmCurso.direcao === "recebi"
              ? "Lançar o que recebi"
              : "Lançar o que paguei"
          }
          rotuloDoBotao="Lançar na minha conta"
          rotuloSalvando="Lançando..."
          aoConfirmar={lancarMinhaPerna}
          salvando={pernaSalvando === pernaEmCurso.settlementId}
        />
      )}
    </div>
  );
}
