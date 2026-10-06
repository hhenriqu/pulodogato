/**
 * O ARRAY DE NAVEGACAO DO MENU, e os filtros que decidem quem aparece.
 *
 * Estava dentro de `components/Sidebar.tsx` ate a HMO-284. Saiu de la por um
 * motivo so: o modo papel de pao acrescentou um SEGUNDO filtro sobre este mesmo
 * array (`lib/menu-do-papel.ts`), e a unica forma honesta de provar "com o modo
 * ligado o menu tem EXATAMENTE 5 itens, desligado tem 27" e a suite ler o array
 * de verdade. Compilar o `Sidebar` inteiro para isso arrastaria o cliente do
 * Supabase, o `useSubscription` e o `next/navigation` para dentro de um teste de
 * Node que nao renderiza nada; reescrever a lista no teste seria pior ainda --
 * seria a segunda lista que a issue proibe, e ela ficaria verde para sempre
 * medindo a si mesma.
 *
 * Entao aqui moram os DADOS e os PREDICADOS (puros, testaveis), e no `Sidebar`
 * ficou a RENDERIZACAO. O conteudo do array desceu byte a byte, comentarios
 * inclusive: nenhum item, rota, icone ou plano mudou nesta mudanca.
 *
 * O arquivo importa `lucide-react` (os icones sao dado do item, nao decisao de
 * tela) e por isso nao mora em `lib/`. Nao importa React, nem hook, nem
 * componente -- e o que o deixa importavel pela suite de Node.
 */
import {
  ArrowRightLeft,
  LayoutDashboard,
  TrendingDown,
  TrendingUp,
  BarChart3,
  User,
  Users,
  Wallet,
  CreditCard,
  Landmark,
  CalendarClock,
  PiggyBank,
  Target,
  Bell,
  FileUp,
  Zap,
  Shield,
  Repeat,
  Tag,
  Tags,
  Calculator,
  LineChart,
  Settings,
} from "lucide-react";

import { PlanFeature, UserPlan } from "@/types/subscription";

export interface NavigationItem {
  name: string;
  href: string;
  icon: React.ElementType;
  requiredFeature?: PlanFeature;
  requiredPlans?: UserPlan[];
  isPremium?: boolean;
}

export const navigation: NavigationItem[] = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    name: "Finanças Pessoais",
    href: "/dashboard/personal-finance",
    icon: Wallet,
    requiredFeature: "personal_finance",
  },
  // AS TRES TELAS DE UMA MOVIMENTACAO SO (HMO-246), logo abaixo de "Finanças
  // Pessoais" e nessa ordem de proposito: ali esta a lista inteira,
  // "indiferente do que for"; aqui estao os tres recortes dela, cada um com
  // Total, Previsto e Realizado do periodo.
  //
  // Elas NAO duplicam o item acima, e a fronteira e esta: "Finanças Pessoais" e
  // a lista (o que foi lançado, tudo junto, com editar e excluir); estas tres
  // sao a CONTA de um tipo num periodo, e juntam o previsto ao realizado --
  // coisa que o cartão de lá não faz. A legenda de cada uma diz isso, porque
  // dois números certos por critérios diferentes se leem como um bug.
  //
  // Até a HMO-246 este recorte existia como quatro abas DENTRO de Finanças
  // Pessoais, e elas filtravam a lista sem mexer nos totais: a aba
  // "Transferências" abria com as linhas certas e os três cartões do topo
  // continuavam somando o mês inteiro. As abas saíram.
  //
  // Sem `requiredFeature`, ao contrário do item acima: elas só leem o que o
  // usuário já lançou e não consomem nada além do banco. E a pergunta que
  // respondem -- "quanto eu gastei e quanto ainda vai sair neste mês" -- é
  // justamente a que não pode depender de plano para ser respondida.
  {
    name: "Receitas",
    href: "/dashboard/receitas",
    icon: TrendingUp,
  },
  {
    name: "Despesas",
    href: "/dashboard/despesas",
    icon: TrendingDown,
  },
  {
    name: "Transferências",
    href: "/dashboard/transferencias",
    icon: ArrowRightLeft,
  },
  {
    // Sem `requiredFeature` de proposito: cadastrar a conta e o passo ZERO.
    // Toda tela que pede conta (lancamento, orcamento, fatura, extrato, meta)
    // fica inutil antes disto, e travar o cadastro atras de um plano deixaria o
    // usuario preso numa tela que so sabe dizer "selecione uma conta".
    name: "Contas",
    href: "/dashboard/contas",
    icon: Wallet,
  },
  {
    // A outra metade do mesmo passo ZERO (HMO-166), e sem `requiredFeature`
    // pelo mesmo motivo. Duas entradas e nao uma porque as duas telas cadastram
    // coisas diferentes: conta tem saldo, cartao tem fatura, limite e
    // vencimento. Um item so voltaria a ser o menu dizendo que sao a mesma
    // coisa -- que era a premissa da tela que esta issue desfez.
    name: "Cartões",
    href: "/dashboard/cartoes",
    icon: CreditCard,
  },
  {
    name: "Contracheque",
    href: "/dashboard/payroll",
    icon: Landmark,
    requiredFeature: "personal_finance",
  },
  {
    name: "Contas Previstas",
    href: "/dashboard/bills",
    icon: CalendarClock,
    requiredFeature: "personal_finance",
  },
  // "Fluxo de Caixa" entrou na HMO-145, logo abaixo de "Contas Previstas" de
  // propósito: é a mesma agenda, lida no eixo do tempo. Quem acabou de
  // cadastrar uma conta com vencimento tem, uma linha abaixo, a tela que
  // responde o que aquilo faz com o saldo dele.
  //
  // Sem `requiredFeature`, pelo mesmo motivo de "Assinaturas" e "Patrimônio": a
  // previsão só lê o que o usuário já cadastrou e não consome nada além do
  // banco. E a pergunta que ela responde -- "em que dia eu fico no vermelho" --
  // é justamente a que não pode depender de plano para ser respondida.
  {
    name: "Fluxo de Caixa",
    href: "/dashboard/cash-flow",
    icon: LineChart,
  },
  {
    name: "Avisos",
    href: "/dashboard/notifications",
    icon: Bell,
    requiredFeature: "personal_finance",
  },
  {
    name: "Orçamento",
    href: "/dashboard/budgets",
    icon: PiggyBank,
    requiredFeature: "personal_finance",
  },
  {
    name: "Importar Extrato",
    href: "/dashboard/statements",
    icon: FileUp,
    requiredFeature: "personal_finance",
  },
  {
    name: "Investimentos",
    href: "/dashboard/investments",
    icon: TrendingUp,
    requiredFeature: "investment_tracking",
    isPremium: true,
  },
  // "Patrimônio" entrou na HMO-145, logo abaixo de "Investimentos" de
  // propósito: é a tela que responde o que "Investimentos" promete e ainda não
  // entrega -- quanto do que o usuário tem está aplicado.
  //
  // Sem `requiredFeature`, pelo mesmo motivo de "Assinaturas", "Regras" e
  // "Calculadoras": a tela só soma contas que o usuário já cadastrou e não
  // consome nada além do banco. Gatear atrás de plano esconderia do menu
  // justamente o número que dá sentido a todas as outras telas.
  {
    name: "Patrimônio",
    href: "/dashboard/net-worth",
    icon: Landmark,
  },
  // "Assinaturas" entrou na HMO-145. A tela, as rotas e a tabela subiram para
  // produção sem nenhum item de menu apontando para elas: /dashboard/recurrences
  // respondia 200, mas não havia como chegar lá clicando, então a feature
  // existia e ao mesmo tempo não existia para quem usa o app.
  //
  // Vai sem `requiredFeature` de propósito. O detector lê as transações que o
  // usuário já importou e não consome nada além do banco; gatear atrás de um
  // plano repetiria o problema de outra forma -- o item some do menu e a queixa
  // volta a ser "não tem feature nova".
  {
    name: "Assinaturas",
    href: "/dashboard/recurrences",
    icon: Repeat,
  },
  // "Regras" entrou na HMO-145, logo abaixo de "Importar Extrato" e
  // "Assinaturas" de propósito: as três dividem a mesma normalização de
  // descrição, e é importando um extrato que o usuário cria a primeira regra
  // sem perceber.
  //
  // Sem `requiredFeature`, pelo mesmo motivo de "Assinaturas": a regra só lê o
  // que o usuário já digitou e não consome nada além do banco. Gatear atrás de
  // plano esconderia do menu justamente a tela que explica por que a categoria
  // apareceu preenchida.
  // "Categorias" entrou na HMO-216, LOGO ACIMA de "Regras" e nao no fim do
  // menu: as duas telas falam da mesma coisa, e a ordem conta a historia certa
  // -- primeiro a lista de categorias que existe, depois a regra que preenche
  // uma delas sozinha. Invertido, "Regras" apareceria antes de haver o que
  // regrar.
  //
  // Sem `requiredFeature`, pelo mesmo motivo de "Contas": escolher categoria e
  // passo obrigatorio de TODO lancamento (`category_id` e NOT NULL desde o
  // 001). Gatear atras de plano trancaria a pessoa com as 13 do catalogo e
  // nenhuma forma de dizer que elas nao servem.
  {
    name: "Categorias",
    href: "/dashboard/categorias",
    icon: Tag,
  },
  {
    name: "Regras",
    href: "/dashboard/categorization",
    icon: Tags,
  },
  {
    name: "Metas",
    href: "/dashboard/goals",
    icon: Target,
    requiredFeature: "financial_goals",
  },
  // "Calculadoras" entrou na HMO-145. Sem `requiredFeature`, e aqui o motivo é
  // mais forte que o de "Assinaturas" e "Regras": a tela não lê o banco nem
  // uma vez. São quatro funções puras rodando no navegador -- não há custo por
  // uso para gatear, e o item some do menu sem contrapartida nenhuma.
  {
    name: "Calculadoras",
    href: "/dashboard/calculators",
    icon: Calculator,
  },
  // "Transações" saiu daqui na HMO-124. O item levava a uma tela que dizia
  // "Nenhuma transação encontrada" mesmo para quem tinha lançamentos -- ela
  // nunca consultou nada. A lista de verdade é "Finanças Pessoais", logo
  // acima; dois itens de menu para a mesma lista só ensinam o usuário a
  // desconfiar do menu. A rota /dashboard/transactions continua existindo e
  // redireciona.
  {
    name: "Relatórios",
    href: "/dashboard/reports",
    icon: BarChart3,
    requiredFeature: "advanced_reports",
    isPremium: true,
  },
  {
    name: "Grupos",
    href: "/dashboard/expense-groups",
    icon: Users,
    requiredFeature: "expense_groups",
  },
  {
    name: "Trading",
    href: "/dashboard/trading",
    icon: Zap,
    requiredFeature: "trading_signals",
    requiredPlans: ["trader", "admin"],
    isPremium: true,
  },
  {
    name: "Perfil",
    href: "/dashboard/profile",
    icon: User,
  },
  {
    name: "Conexões",
    href: "/dashboard/connections",
    icon: Users,
  },
  // "Configurações" saiu daqui na HMO-124 porque /dashboard/settings NÃO
  // EXISTIA: o item dava 404 do Next para todo usuário logado, sem exceção de
  // plano. A HMO-159 criou a tela, e o item volta apontando para ela.
  //
  // Ele NÃO duplica "Perfil", logo acima, e a fronteira é esta: "Perfil" é
  // quem você é (nome, apelido, perfil público, aceitar conexões);
  // "Configurações" é como o app se comporta (o que aparece no painel, em que
  // ordem) e o que fazer com os seus dados (apagar tudo e recomeçar).
  {
    name: "Configurações",
    href: "/dashboard/settings",
    icon: Settings,
  },
  {
    name: "Admin",
    href: "/dashboard/admin",
    icon: Shield,
    requiredPlans: ["admin"],
  },
];

/**
 * O PRIMEIRO filtro do menu: o plano do usuario.
 *
 * Era o `canAccessItem` de dentro do `Sidebar`, que fechava sobre o
 * `subscription` do hook. Aqui o plano entra por ARGUMENTO -- e isso que deixa
 * a suite FIXAR o plano. Sem fixar, a contagem de 27 oscila (sem plano `admin`
 * o menu tem 26 itens) e o teste passaria a medir o plano em vez do modo.
 *
 * A regra em si nao mudou: so a tela de Admin e restrita; todo o resto passa.
 * Itens `isPremium` ou com `requiredFeature` continuam APARECENDO para quem nao
 * tem a feature -- quem os pinta em cinza e poe o cadeado e o `Sidebar`.
 */
export function podeVerItem(
  item: NavigationItem,
  plano: UserPlan | undefined
): boolean {
  if (item.requiredPlans && item.requiredPlans.includes("admin")) {
    return plano === "admin";
  }

  return true;
}
