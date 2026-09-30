// =====================================================
// PULODOGATO - o que a pagina de Planos pode anunciar como PRONTO (HMO-198)
// =====================================================
//
// POR QUE ESTE ARQUIVO EXISTE
// ---------------------------
// A pagina de Planos vendia sinal de trading em tempo real como recurso
// incluido no plano de R$ 79,90/mes. Nao existe tabela, rota nem origem de dado
// por tras: /dashboard/trading mostra `EmDesenvolvimento`. Nao e divida tecnica
// comum -- e promessa comercial com preco ao lado, numa pagina publica.
//
// A decisao de produto (Helio, 30/09) foi marcar o recurso como "em breve", e
// NAO construi-lo: recomendacao de compra e venda e atividade regulada pela
// CVM. Esta lista mexe no rotulo, nunca no recurso.
//
// POR QUE O ESTADO MORA AQUI, E NAO NO JSX
// ----------------------------------------
// O texto do recurso aparecia em DOIS mapas independentes -- um em
// app/(dashboard)/dashboard/plans/page.tsx, outro em
// components/subscription/PlanGuards.tsx. Corrigir so um deixa o outro
// anunciando o recurso como pronto em outro canto da interface, sem quebrar
// build nem teste. `RECURSOS_EM_BREVE` e a unica fonte: os dois mapas passam o
// nome por `comAvisoDeEmBreve`, entao marcar um recurso aqui marca em todos.

import { PlanConfig, PlanFeature } from "@/types/subscription";

/**
 * Recursos que a pagina de Planos lista mas que o produto ainda NAO entrega.
 *
 * Entra aqui o que e anunciado sem existir. Sair daqui exige o recurso
 * construido, nao um rotulo mais simpatico.
 *
 * ESCOPO: a HMO-198 tratou `trading_signals`, que era o unico com decisao
 * explicita do Helio. O mesmo mapa anuncia outros recursos que tambem nao
 * encontrei construidos (portfolio_analysis, advanced_charts, api_access,
 * investment_alerts, multiple_portfolios, real_time_data, advanced_analytics,
 * white_label). Auditar a lista inteira e outra issue -- nao inclua nada aqui
 * sem decisao de produto, porque cada item e um recurso que deixa de ser
 * vendido.
 */
export const RECURSOS_EM_BREVE: readonly PlanFeature[] = ["trading_signals"];

/** O aviso que substitui a promessa de recurso pronto. */
export const AVISO_EM_BREVE = "em breve";

export function estaEmBreve(feature: PlanFeature): boolean {
  return RECURSOS_EM_BREVE.includes(feature);
}

/**
 * O nome do recurso com o aviso, quando ele ainda nao existe.
 *
 * O nome-base precisa NAO conter promessa de prontidao (um "em tempo real",
 * por exemplo): o sufixo so se acrescenta ao fim, entao a promessa sobreviveria
 * dentro do proprio rotulo -- e ainda passaria numa assercao que se contenta em
 * achar "em breve" em algum lugar do texto.
 */
export function comAvisoDeEmBreve(
  nome: string,
  feature: PlanFeature
): string {
  return estaEmBreve(feature) ? `${nome} (${AVISO_EM_BREVE})` : nome;
}

/** Um item da lista "Funcionalidades" do cartao de plano. */
export interface RecursoExibido {
  feature: PlanFeature;
  rotulo: string;
  /** false => a tela mostra o item sem o sinal de "incluido". */
  disponivel: boolean;
}

/**
 * Quantos recursos cabem no cartao.
 *
 * ARMADILHA: este corte e o motivo de o aviso ser uma MUDANCA DE TEXTO no item
 * existente, e nao um item novo na lista. Item novo entra no fim e cai fora do
 * corte -- a mudanca compila, o teste de unidade do mapa passa, e a pagina
 * continua anunciando o recurso do mesmo jeito. Ver o teste que conta os itens
 * do cartao renderizado.
 */
export const LIMITE_DE_RECURSOS_NO_CARTAO = 8;

/**
 * Os nomes que a pagina de Planos imprime.
 *
 * Sao os nomes de venda (mais longos que os de `PlanGuards`), por isso os dois
 * mapas continuam separados. O que eles compartilham e `comAvisoDeEmBreve`.
 */
export const NOMES_NA_PAGINA_DE_PLANOS: Partial<Record<PlanFeature, string>> = {
  personal_finance: "Controle financeiro pessoal",
  advanced_reports: "Relatórios avançados",
  investment_tracking: "Acompanhamento de investimentos",
  portfolio_analysis: "Análise de portfólio",
  // Sem "em tempo real": o sufixo "(em breve)" vem de `comAvisoDeEmBreve`.
  trading_signals: "Sinais de trading",
  advanced_charts: "Gráficos avançados",
  api_access: "Acesso à API",
  priority_support: "Suporte prioritário",
  unlimited_transactions: "Transações ilimitadas",
  expense_groups: "Grupos de gastos compartilhados",
  financial_goals: "Metas financeiras",
  investment_alerts: "Alertas de investimento",
  tax_reports: "Relatórios fiscais",
  custom_categories: "Categorias personalizadas",
  data_export: "Exportação de dados",
  multiple_portfolios: "Múltiplos portfólios",
  real_time_data: "Dados em tempo real",
  advanced_analytics: "Analytics avançados",
  white_label: "White Label",
  user_management: "Gerenciamento de usuários",
  system_monitoring: "Monitoramento do sistema",
};

/**
 * A lista de recursos do cartao de um plano, na ordem em que a tela imprime.
 *
 * Funcao pura para que o teste possa afirmar sobre o corte de 8 e sobre o
 * rotulo sem montar React -- mas o corte so esta PROVADO pelo teste que conta
 * os itens do HTML, porque e la que o item some.
 */
export function listaDeRecursosDoPlano(plan: PlanConfig): RecursoExibido[] {
  return plan.features
    .filter((feature) => NOMES_NA_PAGINA_DE_PLANOS[feature])
    .map((feature) => ({
      feature,
      rotulo: comAvisoDeEmBreve(NOMES_NA_PAGINA_DE_PLANOS[feature]!, feature),
      disponivel: !estaEmBreve(feature),
    }))
    .slice(0, LIMITE_DE_RECURSOS_NO_CARTAO);
}
