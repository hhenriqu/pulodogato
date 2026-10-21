/**
 * O MENU AGRUPADO, o array plano que sai dele, e os filtros que decidem quem
 * aparece.
 *
 * O MENU VIROU MENU + SUBMENU NA HMO-423. Ele tinha 28 itens de primeiro nivel
 * numa lista unica que nao caber na tela era o menor dos problemas: nenhuma
 * ordem de 28 linhas conta uma historia, e procurar "Orcamento" entre
 * "Contracheque" e "Importar Extrato" e varredura, nao navegacao. Agora sao 8
 * ENTRADAS de primeiro nivel -- duas telas soltas (Dashboard, Grupos) e seis
 * grupos que abrem submenu --, e as 29 telas continuam todas la dentro: este PR
 * nao esconde tela nenhuma, nao cria gate de plano nenhum e nao muda `href`
 * nenhum dos que ja existiam.
 *
 * `menuAgrupado` E A FONTE, `navigation` SAI DELE
 * ----------------------------------------------
 * A tentacao e declarar os grupos ao lado da lista plana que o resto do codigo
 * ja le. As duas divergiriam na primeira tela nova -- uma apareceria no menu e
 * nao no filtro do modo papel, ou o contrario, sem nada falhar. Entao a lista
 * plana e DERIVADA (`menuAgrupado.flatMap`), e nao ha como acrescentar item sem
 * dizer em que grupo ele mora.
 *
 * O preco dessa escolha: a ORDEM de `navigation` e a ordem de leitura dos
 * grupos, nao mais a ordem visual de um menu plano. Quem depende de ordem
 * (`ROTAS_DO_MENU_DE_PAPEL`, que e conjunto, nao) tem de saber disso.
 *
 * Estava dentro de `components/Sidebar.tsx` ate a HMO-284. Saiu de la por um
 * motivo so: o modo papel de pao acrescentou um SEGUNDO filtro sobre este mesmo
 * array (`lib/menu-do-papel.ts`), e a unica forma honesta de provar "com o modo
 * ligado o menu tem EXATAMENTE 3 itens, desligado tem 29" e a suite ler o array
 * de verdade. (Eram 8 itens ate a HMO-466; o numero muda, o arranjo nao.) Compilar o `Sidebar` inteiro para isso arrastaria o cliente do
 * Supabase, o `useSubscription` e o `next/navigation` para dentro de um teste de
 * Node que nao renderiza nada; reescrever a lista no teste seria pior ainda --
 * seria a segunda lista que a issue proibe, e ela ficaria verde para sempre
 * medindo a si mesma.
 *
 * Entao aqui moram os DADOS e os PREDICADOS (puros, testaveis), e no `Sidebar`
 * ficou a RENDERIZACAO.
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
  HandCoins,
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
  Coins,
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

/**
 * UM GRUPO DO MENU: um rotulo que abre submenu, e os itens dele.
 *
 * O grupo NAO tem `href` de proposito. Dar-lhe um faria o clique no rotulo ser
 * duas coisas ao mesmo tempo (abrir o submenu e navegar), e qual das duas
 * acontece e exatamente o tipo de ambiguidade que o menu antigo nao tinha. Quem
 * abre e fecha e o `Sidebar`; quem navega e o item de dentro.
 *
 * O grupo tambem NAO tem campo de acesso (`requiredFeature`, `requiredPlans`,
 * `isPremium`). Quem decide visibilidade continua sendo o ITEM, um por um, e o
 * grupo aparece se sobrou pelo menos um item dele -- ver `filtrarMenuAgrupado`.
 * Um `requiredPlans` no grupo seria um terceiro lugar para esconder tela, e o
 * primeiro que ninguem lembraria de conferir.
 */
export interface GrupoDeMenu {
  nome: string;
  icon: React.ElementType;
  itens: NavigationItem[];
}

/** Uma entrada de primeiro nivel: uma tela solta, ou um grupo com submenu. */
export type EntradaDoMenu = NavigationItem | GrupoDeMenu;

/** Discriminador de `EntradaDoMenu`. O grupo e quem tem `itens`. */
export function ehGrupo(entrada: EntradaDoMenu): entrada is GrupoDeMenu {
  return "itens" in entrada;
}

/**
 * AS 8 ENTRADAS DE PRIMEIRO NIVEL (HMO-423).
 *
 * Dashboard e Grupos ficaram SOLTOS, sem grupo. Dashboard porque e o destino do
 * login e a tela mais clicada do app -- enterra-la dentro de um submenu custaria
 * um clique em toda volta ao inicio. Grupos porque e a unica tela do assunto
 * dela: um grupo de um item so e um submenu que existe para nao agrupar nada.
 *
 * Os seis grupos sao recortes por PERGUNTA, nao por tabela do banco:
 *
 *   Movimentacoes    -- "o que entrou e saiu"
 *   Contas e Cartoes -- "onde o dinheiro esta"
 *   Planejamento     -- "o que ainda vai acontecer"
 *   Investimentos    -- "o que esta aplicado" (e o MyBank, que empresta dali)
 *   Ferramentas      -- "como eu olho e organizo isso"
 *   Conta e Ajustes  -- "eu e o app"
 */
export const menuAgrupado: EntradaDoMenu[] = [
  {
    name: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    // MOVIMENTACOES: a lista inteira, os tres recortes dela, o contracheque que
    // vira receita e o extrato que vira lancamento. O que junta os seis e a
    // pergunta "o que entrou e saiu" -- todos eles leem (ou criam)
    // `financial_transactions`.
    nome: "Movimentações",
    icon: ArrowRightLeft,
    itens: [
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
        name: "Contracheque",
        href: "/dashboard/payroll",
        icon: Landmark,
        requiredFeature: "personal_finance",
      },
      {
        name: "Importar Extrato",
        href: "/dashboard/statements",
        icon: FileUp,
        requiredFeature: "personal_finance",
      },
    ],
  },
  {
    // CONTAS E CARTOES: as duas metades do passo ZERO, juntas no menu pelo
    // mesmo motivo que estao separadas em tela (HMO-166) -- quem cadastra uma
    // conta corrente nao quer ver campo de fatura, mas quem procura "onde o
    // dinheiro esta" procura as duas no mesmo lugar.
    nome: "Contas e Cartões",
    icon: Wallet,
    itens: [
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
    ],
  },
  {
    // PLANEJAMENTO: tudo que fala do que AINDA NAO ACONTECEU. "Contas
    // Previstas" e a agenda, "Fluxo de Caixa" e a mesma agenda no eixo do
    // tempo, "Avisos" e ela chegando por email, "Orcamento" e o teto do mes,
    // "Metas" e o alvo de longo prazo e "Assinaturas" e o que se repete sem
    // ninguem digitar.
    nome: "Planejamento",
    icon: CalendarClock,
    itens: [
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
        name: "Metas",
        href: "/dashboard/goals",
        icon: Target,
        requiredFeature: "financial_goals",
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
    ],
  },
  {
    // INVESTIMENTOS: A PEDIDO DA HMO-423, e o grupo onde o dinheiro aplicado
    // tem um caminho PARALELO ao das contas do dia a dia.
    //
    // "MyBank" morava no primeiro nivel, entre "Investimentos" e "Patrimônio",
    // e a leitura do menu antigo era que ele fosse um assunto proprio. Ele nao
    // e: ele e a conta de investimento emprestando -- so existe para quem tem
    // conta `account_type = 'investment'`, e a divida volta parcelada para ela.
    //
    // "Contas de Investimento" e o item NOVO desta issue, e e o que fecha o
    // paralelo: "Contas e Cartoes" responde onde esta o dinheiro do mes, e aqui
    // se responde a mesma coisa sobre o que esta aplicado -- mesma tela de
    // cadastro, mesmo CRUD, recortada no tipo. Ela nao e tela nova (ver o
    // `?tipo=investment` abaixo): duplicar o cadastro de conta para mostrar seis
    // contas em vez de oito seria duas telas divergindo no primeiro campo novo.
    nome: "Investimentos",
    icon: TrendingUp,
    itens: [
      {
        // Era "Investimentos" no menu plano. Dentro do grupo de mesmo nome,
        // "Investimentos > Investimentos" nao diz nada; "Carteira" diz o que a
        // tela e. O `href` NAO mudou -- quem tem a tela nos favoritos continua
        // chegando la, e `ROTAS_DO_MENU_DE_PAPEL` nao se mexe.
        name: "Carteira",
        href: "/dashboard/investments",
        icon: TrendingUp,
        requiredFeature: "investment_tracking",
        isPremium: true,
      },
      {
        // A MESMA TELA DE "Contas", RECORTADA NO TIPO (HMO-423). O `?tipo=`
        // e lido por `app/(dashboard)/dashboard/contas/page.tsx`, que filtra a
        // lista, soma o total daquele tipo e abre o formulario novo ja com o
        // tipo escolhido.
        //
        // Isto e o unico `href` com query do menu, e e o que obriga o
        // `itemAtivoDoMenu` a existir: comparando so o `pathname`, "Contas" e
        // "Contas de Investimento" acenderiam juntos.
        name: "Contas de Investimento",
        href: "/dashboard/contas?tipo=investment",
        icon: Coins,
      },
      // "MyBank" entrou na HMO-371, logo abaixo de "Investimentos" de propósito: é
      // a conta de investimento virando banco -- ela empresta, e a dívida volta
      // parcelada. Quem acabou de ver o que tem aplicado tem, uma linha abaixo, a
      // tela que empresta dali.
      //
      // SEM `requiredFeature` E SEM `requiredPlans`, e isso é a Decisão 5 da
      // HMO-368 escrita no array: quem tem conta de investimento tem MyBank. Não há
      // gate novo de plano em nenhuma das três camadas (menu, página, rotas) -- a
      // feature não consome nada além do banco do próprio usuário, e a pergunta que
      // ela responde ("quanto eu emprestei e quanto falta voltar") é justamente a
      // que não pode depender de plano para ser respondida.
      //
      // A tela se protege sozinha quando o pré-requisito falta: sem nenhuma conta
      // `account_type = 'investment'` ela diz o que fazer, com o caminho para
      // Contas. Esconder o item do menu nesse caso seria a feature existindo e ao
      // mesmo tempo não existindo para quem usa o app -- o sintoma que a HMO-145
      // foi consertar.
      {
        name: "MyBank",
        href: "/dashboard/mybank",
        icon: HandCoins,
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
      {
        // Trading desceu para ca na HMO-423 e nao ganhou nem perdeu gate: ele
        // continua com `requiredPlans: ["trader", "admin"]`, que e o UNICO
        // filtro de visibilidade do menu. Sinal de compra e venda e assunto de
        // investimento, e no primeiro nivel ele era a nona entrada de um menu
        // que esta issue foi encurtar.
        name: "Trading",
        href: "/dashboard/trading",
        icon: Zap,
        requiredFeature: "trading_signals",
        requiredPlans: ["trader", "admin"],
        isPremium: true,
      },
    ],
  },
  {
    // SOLTO, sem grupo, e com o `requiredFeature` que ele sempre teve. Dividir
    // conta com outra pessoa nao e subassunto de movimentacao nem de conta: o
    // grupo tem rateio, acerto e gente dentro, e a tela e a raiz de
    // `/dashboard/expense-groups/[groupId]`. Agrupa-lo sozinho seria submenu
    // para nao agrupar nada.
    name: "Grupos",
    href: "/dashboard/expense-groups",
    icon: Users,
    requiredFeature: "expense_groups",
  },
  {
    // FERRAMENTAS: o que serve para OLHAR e ORGANIZAR o que ja esta lancado --
    // nenhuma das quatro cria lancamento, conta ou meta.
    nome: "Ferramentas",
    icon: Calculator,
    itens: [
      // "Transações" saiu do menu na HMO-124. O item levava a uma tela que dizia
      // "Nenhuma transação encontrada" mesmo para quem tinha lançamentos -- ela
      // nunca consultou nada. A lista de verdade é "Finanças Pessoais", em
      // Movimentações; dois itens de menu para a mesma lista só ensinam o
      // usuário a desconfiar do menu. A rota /dashboard/transactions continua
      // existindo e redireciona.
      {
        name: "Relatórios",
        href: "/dashboard/reports",
        icon: BarChart3,
        requiredFeature: "advanced_reports",
        isPremium: true,
      },
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
      // "Regras" entrou na HMO-145. Sem `requiredFeature`, pelo mesmo motivo de
      // "Assinaturas": a regra só lê o que o usuário já digitou e não consome
      // nada além do banco. Gatear atrás de plano esconderia do menu justamente
      // a tela que explica por que a categoria apareceu preenchida.
      {
        name: "Regras",
        href: "/dashboard/categorization",
        icon: Tags,
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
    ],
  },
  {
    // CONTA E AJUSTES: quem eu sou, com quem estou conectado, como o app se
    // comporta -- e o Admin, que e a mesma familia (configuracao, nao dinheiro).
    nome: "Conta e Ajustes",
    icon: Settings,
    itens: [
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
      // "Configurações" saiu do menu na HMO-124 porque /dashboard/settings NÃO
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
    ],
  },
];

/**
 * A LISTA PLANA das 29 telas, na ordem de leitura dos grupos.
 *
 * Derivada, nunca escrita a mao -- ver o cabecalho do arquivo. Quem lia
 * `navigation` antes da HMO-423 continua lendo o mesmo tipo de dado: o modo
 * papel de pao filtra esta lista (ele e PLANO de proposito), e a suite conta os
 * itens por aqui.
 */
export const navigation: NavigationItem[] = menuAgrupado.flatMap((entrada) =>
  ehGrupo(entrada) ? entrada.itens : [entrada]
);

/**
 * O PRIMEIRO filtro do menu: o plano do usuario.
 *
 * Era o `canAccessItem` de dentro do `Sidebar`, que fechava sobre o
 * `subscription` do hook. Aqui o plano entra por ARGUMENTO -- e isso que deixa
 * a suite FIXAR o plano. Sem fixar, a contagem de 29 oscila (ela cai para 28 no
 * plano `trader` e para 27 nos outros) e o teste passaria a medir o plano em vez
 * do modo.
 *
 * A REGRA MUDOU NA HMO-292, e e esta: item sem `requiredPlans` aparece para
 * todo mundo; item COM `requiredPlans` aparece so para quem esta na lista. Ate
 * aqui o predicado olhava se a lista CONTINHA `"admin"` e, se continha, exigia
 * plano `admin` -- o resto da lista era ignorado. "Trading" declara
 * `requiredPlans: ["trader", "admin"]`, e o resultado era que quem PAGAVA o
 * plano `trader` nao via no menu a tela que comprou, enquanto
 * `/dashboard/trading` respondia 200 para ele: a feature existia e ao mesmo
 * tempo nao existia para o dono dela -- o sintoma que a HMO-145 foi consertar.
 * Para "Admin" (`requiredPlans: ["admin"]`) nada mudou: a lista tem um elemento
 * so e ele e o plano exigido.
 *
 * Sem plano (`undefined`, o estado dos primeiros quadros, antes de a assinatura
 * carregar) nao se ve item restrito nenhum. O menu completo e o do `free`, e
 * quem for `trader` ganha "Trading" um quadro depois -- o contrario (mostrar e
 * esconder) e que seria visivel.
 *
 * Itens `isPremium` ou com `requiredFeature` continuam APARECENDO para quem nao
 * tem a feature -- quem os pinta em cinza e poe o cadeado e o `Sidebar`.
 * `requiredFeature` NAO E filtro de visibilidade; `requiredPlans` e.
 *
 * UMA COISA QUE ESTE CONSERTO NAO DECIDE: `/dashboard/trading` renderiza
 * `EmDesenvolvimento`, e a pagina de Planos anuncia "Sinais de trading (em
 * breve)" desde a HMO-198 -- recomendacao de compra e venda e atividade
 * regulada pela CVM, e a decisao de produto foi marcar em breve em vez de
 * construir. Entao o `trader` passa a ver no menu um item que leva a um aviso.
 * Isso e proposital e nao e o que estava errado aqui: o defeito era o predicado
 * LER `requiredPlans` pela metade, e ele leria errado qualquer lista futura.
 * Se um dia a decisao for que a tela nao deve aparecer enquanto nao existir, o
 * lugar disso e o ITEM (tirar do array, ou tirar o `requiredPlans` dele) -- nao
 * um predicado que ignora o que o item declara.
 */
export function podeVerItem(
  item: NavigationItem,
  plano: UserPlan | undefined
): boolean {
  if (!item.requiredPlans) return true;
  if (!plano) return false;

  return item.requiredPlans.includes(plano);
}

/**
 * O MESMO filtro de plano, sobre a ARVORE (HMO-423).
 *
 * Item por item, dentro de cada grupo, com o `podeVerItem` de cima -- nao ha
 * segunda regra de visibilidade aqui, e e de proposito que o grupo nao possa
 * declarar acesso nenhum (ver `GrupoDeMenu`).
 *
 * GRUPO QUE PERDEU TODOS OS ITENS DESAPARECE. Sem isso, um plano sem nenhuma
 * tela de um grupo veria o rotulo abrir um submenu vazio -- a feature existindo
 * e ao mesmo tempo nao existindo, que e o sintoma que a HMO-145 foi consertar,
 * so que em forma de gaveta vazia. Hoje nenhum grupo chega a esvaziar (so duas
 * telas declaram `requiredPlans`, e elas moram em grupos de 5 e de 4 itens);
 * isto e a regra para quando chegar.
 */
export function filtrarMenuAgrupado(
  entradas: readonly EntradaDoMenu[],
  plano: UserPlan | undefined
): EntradaDoMenu[] {
  const visiveis: EntradaDoMenu[] = [];

  for (const entrada of entradas) {
    if (!ehGrupo(entrada)) {
      if (podeVerItem(entrada, plano)) visiveis.push(entrada);
      continue;
    }

    const itens = entrada.itens.filter((item) => podeVerItem(item, plano));
    if (itens.length > 0) visiveis.push({ ...entrada, itens });
  }

  return visiveis;
}

/**
 * O SUBMENU DESTE GRUPO ESTA ABERTO?
 *
 * Funcao pura, e nao um `useState` por grupo dentro do `Sidebar`, porque a
 * regra tem duas fontes e e ai que ela erra:
 *
 * `mexidos` e o que o usuario abriu ou fechou A MAO, por nome de grupo. Quem
 * NAO esta nesse mapa nao esta "fechado": esta em "ninguem mexeu ainda", e ai
 * quem responde e a TELA ATUAL -- o grupo que contem o item ativo abre sozinho.
 *
 * E por isso que o mapa comeca VAZIO e nao precisa de efeito nenhum para se
 * acertar depois de navegar: entrar em `/dashboard/mybank` por um link de
 * dentro de uma pagina abre "Investimentos" no mesmo quadro, com o item
 * marcado. Um `useState` inicializado com "o grupo da tela de agora" ficaria
 * velho na primeira navegacao, e sincroniza-lo pediria um `useEffect` que
 * apagaria a escolha de quem mexeu a mao.
 *
 * O `!== undefined` e deliberado (nao `??` sobre o valor): `false` e uma
 * resposta do usuario -- "eu FECHEI este grupo" -- e tem de vencer a tela atual.
 * Com `||` ou com um `?? regraDaTela` sobre valor booleano, fechar a mao o grupo
 * da tela em que se esta nao funcionaria: ele reabriria no quadro seguinte.
 */
export function grupoAberto(
  grupo: GrupoDeMenu,
  mexidos: Readonly<Record<string, boolean>>,
  hrefAtivo: string | null
): boolean {
  const mexido = mexidos[grupo.nome];
  if (mexido !== undefined) return mexido;

  return grupo.itens.some((item) => item.href === hrefAtivo);
}

/**
 * QUAL ITEM DO MENU ESTA ATIVO para a URL atual -- devolve o `href` vencedor,
 * ou `null` se nenhum casa.
 *
 * O VENCEDOR E O MAIS ESPECIFICO, e e por isso que isto e uma funcao e nao um
 * `pathname === item.href` em cada linha do `Sidebar`. Dois defeitos moram ai:
 *
 * 1. "Dashboard" (`/dashboard`) e prefixo de TODAS as outras rotas do app, e o
 *    teste antigo (`pathname.startsWith(item.href + "/")`) o acendia em toda
 *    tela: quem estava em "Contas" via dois itens marcados, e um deles era
 *    sempre o Dashboard. Aqui `/dashboard/contas` (16 caracteres) ganha de
 *    `/dashboard` (10).
 * 2. "Contas de Investimento" e `/dashboard/contas?tipo=investment`, a MESMA
 *    rota de "Contas" com query. Comparando so o caminho, os dois acendem
 *    juntos sempre. Query vale mais que caminho (o `+ 1000` abaixo), entao com
 *    `?tipo=investment` na barra quem acende e o item do grupo Investimentos, e
 *    sem ele, "Contas".
 *
 * A regra de casamento de query e CONTEM, nao igual: o `href` exige as chaves
 * que declara e ignora o resto (um `&mes=2026-10` na barra nao apaga o item).
 * Um `href` sem query nenhuma casa com qualquer query -- ele so perde do irmao
 * mais especifico, quando esse irmao existe.
 */
export function itemAtivoDoMenu(
  hrefs: readonly string[],
  caminho: string,
  busca = ""
): string | null {
  const atual = new URLSearchParams(busca);
  let vencedor: string | null = null;
  let melhorPeso = -1;

  for (const href of hrefs) {
    const [rota, query = ""] = href.split("?");
    if (caminho !== rota && !caminho.startsWith(rota + "/")) continue;

    const exigidos = new URLSearchParams(query);
    let casa = true;
    exigidos.forEach((valor, chave) => {
      if (atual.get(chave) !== valor) casa = false;
    });
    if (!casa) continue;

    const peso = rota.length + (query ? 1000 : 0);
    if (peso > melhorPeso) {
      melhorPeso = peso;
      vencedor = href;
    }
  }

  return vencedor;
}
