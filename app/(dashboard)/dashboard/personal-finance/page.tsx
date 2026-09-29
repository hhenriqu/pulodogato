"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";
import { useSubscription } from "@/lib/hooks/useSubscription";
import { PlanBadge } from "@/components/subscription/PlanGuards";
import {
  QuickUsage,
  UsageLimitsCard,
} from "@/components/subscription/UsageLimits";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { resumoDoPeriodo } from "@/lib/movimentacoes";
import { rotaDoTipo, tipoDoLancamento } from "@/lib/lancamento";
import { ROTA_DA_TRANSFERENCIA } from "@/lib/transferencia";
import {
  guardarCatalogo,
  lerCatalogo,
  decidirAbertura,
  type CatalogoDeLancamento,
} from "@/lib/offline-cache";
import {
  classificarFalhaDeAuth,
  lerSessaoLembrada,
} from "@/lib/offline-session";
import {
  Wallet,
  Plus,
  TrendingDown,
  TrendingUp,
  Receipt,
  DollarSign,
  Pencil,
  Trash2,
  Share2,
  Crown,
  ArrowRightLeft,
} from "lucide-react";
import Link from "next/link";

interface TransactionCategory {
  id: string;
  service_id: string;
  name: string;
  description: string;
  icon: string;
  color_hex: string;
  is_expense: boolean;
}

interface FinancialTransaction {
  id: string;
  user_id: string;
  service_id: string;
  category_id: string;
  account_id?: string;
  description: string;
  amount: number;
  transaction_date: string;
  transaction_type?: string;
  attachment_url?: string;
  notes?: string;
  is_shared: boolean;
  group_id?: string;
  created_at: string;
  category?: TransactionCategory;
  expense_splits?: ExpenseSplit[];
}

interface ExpenseSplit {
  id: string;
  participant_id: string;
  percentage: number;
  amount: number;
  status: "pending" | "approved" | "rejected" | "expired";
  participant?: {
    full_name: string;
    avatar_url?: string;
  };
}

export default function PersonalFinancePage() {
  const [user, setUser] = useState<User | null>(null);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("transactions");
  /** De quando sao os dados na tela, quando eles vieram do aparelho. */
  const [catalogoDe, setCatalogoDe] = useState<number | null>(null);

  const { canCreateMore, planConfig, isPremium } = useSubscription(user);

  // Função para deletar transação
  //
  // Transferencia sai por outro caminho (HMO-164). Ela sao DUAS linhas, e o
  // delete daqui apaga uma: a FK de `counterpart_transaction_id` e ON DELETE
  // SET NULL (015), entao a outra perna nao e apagada nem da erro -- ela fica,
  // com o elo zerado, mexendo o saldo de UMA conta. Meia transferencia nao tem
  // sintoma: o extrato parece completo e o patrimonio esta errado pelo valor
  // inteiro. A rota apaga o par.
  const deleteTransaction = async (transaction: any) => {
    const ehTransferencia = transaction.transaction_type === "transfer";

    if (
      !confirm(
        ehTransferencia
          ? "Esta é uma transferência: ela existe nas duas contas. Excluir as duas pernas?"
          : "Tem certeza que deseja excluir esta transação?"
      )
    ) {
      return;
    }

    try {
      if (ehTransferencia) {
        const resposta = await fetch(
          `/api/movimentacoes/transferencia?id=${transaction.id}`,
          { method: "DELETE" }
        );
        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.error);
        toast.success(dados.message || "Transferência excluída.");
      } else {
        const { error } = await supabase
          .from("financial_transactions")
          .delete()
          .eq("id", transaction.id)
          .eq("user_id", user?.id);

        if (error) throw error;
        toast.success("Transação excluída com sucesso!");
      }

      loadData();
    } catch (error) {
      console.error("Error deleting transaction:", error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Erro ao excluir transação"
      );
    }
  };

  const supabase = createClient();

  useEffect(() => {
    loadData();
  }, []);

  /**
   * Sem rede, esta tela nao tem lista para mostrar -- ela mostra DE QUANDO e o
   * que o aparelho guardou, e diz que da para lancar mesmo assim.
   *
   * O catalogo em si (categorias, contas, `service_id`) nao entra mais em
   * estado aqui: quem o consome e o formulario, que virou tela propria e le o
   * mesmo `localStorage`. Guardar uma segunda copia em estado nesta tela seria
   * uma copia que ninguem le.
   *
   * Existe como funcao propria porque ha DOIS caminhos sem rede, e so um deles
   * passa pelo catch -- ver `loadData`.
   */
  const reporCatalogo = (catalogo: CatalogoDeLancamento) => {
    setCatalogoDe(catalogo.guardadoEm);
    toast.message("Sem conexão: dá para lançar, envio quando a rede voltar.");
  };

  /** Fim da linha sem rede: nao ha catalogo, e nao ha o que inventar. */
  const avisarAparelhoVazio = () => {
    toast.error(
      "Sem conexão e sem dados no aparelho. Abra esta tela uma vez com internet."
    );
  };

  const loadData = async () => {
    try {
      const { data: dadosDeAuth, error: erroDeAuth } =
        await supabase.auth.getUser();

      if (!dadosDeAuth?.user) {
        // ----------------------------------------------------------------
        // SEM USUARIO NAO QUER DIZER SEM SESSAO
        // ----------------------------------------------------------------
        // `getUser()` vai na rede, e quando a rede falha o supabase-js NAO
        // lanca: ele devolve `user: null` com o erro ao lado. O `if (!user)
        // return;` que estava aqui saia da funcao ANTES do catch que sabia
        // repor o catalogo -- entao offline a tela terminava sem categoria,
        // sem conta, sem `serviceId` e sem usuario, e nada disso aparecia
        // como erro. Era o "funciona offline mas as categorias nao
        // carregaram" de 25/09. A tabela de casos esta em `offline-cache.ts`.
        const abertura = decidirAbertura({
          usuarioConfirmado: null,
          origemDaFalha: classificarFalhaDeAuth(erroDeAuth),
          sessaoLembrada: lerSessaoLembrada(window.localStorage),
          catalogo: lerCatalogo(window.localStorage),
        });

        // O servidor respondeu que a sessao nao vale: quem manda para /login e
        // o layout do dashboard. Nao ha o que repor.
        if (abertura.decisao === "desistir") return;

        if (abertura.usuario) {
          // Vem do bilhete, nao do servidor -- e so o suficiente para o
          // `user_id` da fila e para o submit deixar de recusar por
          // `if (!user)`. Nenhuma leitura sai daqui: as consultas continuam
          // indo com o token de verdade e batendo na RLS.
          setUser({
            id: abertura.usuario.id,
            email: abertura.usuario.email ?? undefined,
          } as User);
        }

        if (abertura.catalogo) reporCatalogo(abertura.catalogo);
        else avisarAparelhoVazio();

        return;
      }

      const user = dadosDeAuth.user;
      setUser(user);

      // Categorias e contas nao aparecem nesta tela: elas sao carregadas para
      // RENOVAR o catalogo do aparelho, no fim desta funcao. Esta e a tela que
      // a pessoa abre primeiro e a que o service worker precacheia, entao e
      // aqui que o catalogo tem a melhor chance de existir antes de faltar
      // rede. Sem isso, quem nunca abriu o formulario COM rede nao conseguiria
      // lancar offline -- e nada nisso apareceria como erro.
      const { data: serviceData } = await supabase
        .from("financial_services")
        .select("id")
        .eq("name", "personal_finance")
        .single();

      // Variaveis locais, nao estado: o catalogo e gravado ainda dentro desta
      // funcao, e `setState` so vale no proximo render -- lendo do estado ele
      // salvaria a lista do carregamento ANTERIOR, e na primeira visita
      // salvaria vazio.
      let categoriasCarregadas: TransactionCategory[] = [];
      let contasCarregadas: any[] = [];

      if (serviceData) {
        const { data: categoriesData } = await supabase
          .from("transaction_categories")
          .select("*")
          .eq("service_id", serviceData.id)
          .eq("is_active", true)
          .order("name");

        categoriasCarregadas = categoriesData || [];
      }

      // Carregar transações
      const { data: transactionsData } = await supabase
        .from("financial_transactions")
        .select(
          `
          *,
          category:transaction_categories(*),
          expense_splits(
            *,
            participant:profiles!expense_splits_participant_id_fkey(full_name, avatar_url)
          )
        `
        )
        .eq("user_id", user.id)
        .eq("service_id", serviceData?.id)
        .order("transaction_date", { ascending: false })
        .limit(50);

      setTransactions(transactionsData || []);

      // Carregar contas financeiras.
      //
      // Elas nao aparecem nesta tela: sao carregadas para entrar no catalogo do
      // aparelho, logo abaixo. Conexoes e grupos sairam daqui junto com o
      // formulario -- quem os usa agora e a tela de despesa, e busca-los aqui
      // eram duas requisicoes por visita para alimentar um bloco que esta tela
      // nao tem mais.
      const accountsResponse = await fetch("/api/financial-accounts");
      const accountsData = await accountsResponse.json();
      if (accountsResponse.ok) {
        contasCarregadas = accountsData.accounts || [];
      }

      // Deu tudo certo: renova o catalogo que vai sustentar o formulario na
      // proxima vez que faltar rede. Fica no fim de proposito -- salvar antes
      // gravaria um catalogo pela metade se alguma das chamadas acima
      // falhasse, e um catalogo pela metade e pior que nenhum: o formulario
      // abriria com meia lista de categorias, sem nada indicando o que falta.
      if (serviceData?.id && categoriasCarregadas.length > 0) {
        guardarCatalogo(window.localStorage, {
          serviceId: serviceData.id,
          categorias: categoriasCarregadas.map((c) => ({
            id: c.id,
            name: c.name,
            is_expense: c.is_expense,
          })),
          contas: contasCarregadas.map((c: any) => ({
            id: c.id,
            name: c.name,
            account_type: c.account_type,
          })),
          guardadoEm: Date.now(),
        });
        setCatalogoDe(null);
      }
    } catch (error) {
      console.error("Error loading data:", error);

      // -------------------------------------------------------------------
      // SEM REDE: A TELA MOSTRA O QUE O APARELHO TEM, E DIZ QUE E ISSO
      // -------------------------------------------------------------------
      // O ramo antigo era so um toast de erro, e o efeito colateral dele era
      // pior que a mensagem: os seletores ficavam VAZIOS. Nao ha como lancar
      // nada sem categoria, entao a fila offline existiria e nao poderia ser
      // usada. E uma tela sem nenhum lancamento, sem aviso de que a lista nao
      // carregou, e o "zero confiante" de que este projeto ja sofreu --
      // parece que os dados sumiram.
      //
      // Aqui o usuario ja esta em estado: quem chega neste catch passou pelo
      // `getUser()` com sucesso e caiu depois, numa das consultas.
      const catalogo = lerCatalogo(window.localStorage);
      if (catalogo) reporCatalogo(catalogo);
      else avisarAparelhoVazio();
    } finally {
      setLoading(false);
    }
  };

  // A separacao das tres movimentacoes esta em lib/movimentacoes.ts, com testes.
  // Aqui ficava uma soma por sinal do valor -- `amount > 0` receita, `amount < 0`
  // despesa -- que contava as DUAS pernas de uma transferencia (migration 015):
  // pagar uma fatura de R$ 1.000 somava R$ 1.000 em Receitas e R$ 1.000 em
  // Despesas. O saldo continuava certo, porque as pernas se anulam, e por isso o
  // erro nao aparecia em lugar nenhum.
  const calculateBalance = () => {
    const resumo = resumoDoPeriodo(transactions);

    return {
      income: resumo.receitas,
      expenses: resumo.despesas,
      balance: resumo.saldo,
      transferido: resumo.transferido,
      transferencias: resumo.transferencias,
    };
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const { income, expenses, balance, transferido, transferencias } =
    calculateBalance();

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header */}
      {/*
        No celular o titulo e a linha de acao empilham (HMO-168): o par
        "selo do plano + Novo Lançamento" mede 257px e nao divide uma linha de
        320px com mais nada. Enquanto ficavam lado a lado a la força, a tela
        inteira ganhava 125px de scroll horizontal.
      */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Wallet className="h-8 w-8" />
            Finanças Pessoais
          </h1>
          <p className="text-muted-foreground">
            Seus lançamentos e o resumo do mês. Receita e despesa se lançam em
            telas próprias.
          </p>
          {/*
            Sem esta linha, a tela offline mostra as categorias do aparelho e
            uma lista de lançamentos VAZIA, com a mesma cara de quem nunca
            lançou nada. O aviso do topo do app diz que não há conexão; este
            diz de quando é o que está na tela, que é a pergunta seguinte.
          */}
          {catalogoDe !== null && (
            <p className="text-sm text-warning">
              Lista de lançamentos indisponível sem conexão. As categorias são
              as de {new Date(catalogoDe).toLocaleString("pt-BR")}.
            </p>
          )}
        </div>
        {/*
          Duas portas em vez de uma, porque receita e despesa deixaram de ser
          uma escolha DENTRO do formulario (HMO-165). A tela antiga abria um
          bloco que era tres formularios sobrepostos: quem vinha lancar uma
          receita via, piscando, a natureza da despesa, o parcelamento e o
          rateio.

          O limite do plano desabilita os dois botoes, e nao um so: o limite e
          de transacoes, nao de receitas. Um botao habilitado que leva a uma
          tela onde o Salvar vai ser recusado e pior que um botao apagado.
        */}
        <div className="flex flex-wrap items-center gap-2">
          {planConfig && <PlanBadge plan={planConfig.id} size="sm" />}
          {canCreateMore("maxTransactions") ? (
            <>
              <Button variant="outline" asChild className="gap-2">
                <Link href="/dashboard/movimentacoes/receita">
                  <TrendingUp className="h-4 w-4 text-success" />
                  Nova Receita
                </Link>
              </Button>
              <Button asChild className="gap-2">
                <Link href="/dashboard/movimentacoes/despesa">
                  <TrendingDown className="h-4 w-4" />
                  Nova Despesa
                </Link>
              </Button>
              {/* A terceira porta (HMO-164). Ate aqui transferencia era uma
                  opcao DENTRO do formulario de lancamento, e por isso gravava
                  uma linha so, com categoria de despesa. */}
              <Button variant="outline" asChild className="gap-2">
                <Link href={ROTA_DA_TRANSFERENCIA}>
                  <ArrowRightLeft className="h-4 w-4 text-info" />
                  Transferência
                </Link>
              </Button>
            </>
          ) : (
            <Button disabled className="gap-2">
              <Plus className="h-4 w-4" />
              Limite de lançamentos atingido
            </Button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Receitas</CardTitle>
            <TrendingUp className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">
              {formatCurrency(income)}
            </div>
            <p className="text-xs text-muted-foreground">Este mês</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Despesas</CardTitle>
            <TrendingDown className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">
              {formatCurrency(expenses)}
            </div>
            <p className="text-xs text-muted-foreground">Este mês</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Saldo</CardTitle>
            <DollarSign className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                balance >= 0 ? "text-success" : "text-destructive"
              }`}
            >
              {formatCurrency(balance)}
            </div>
            <p className="text-xs text-muted-foreground">Receitas - Despesas</p>
            {/*
              Transferencia entre contas proprias nao e receita nem despesa, e
              por isso saiu das duas somas acima. Sem esta linha ela desapareceria
              da tela inteira, e o valor "que faltou" pareceria dado perdido.
            */}
            {transferencias > 0 && (
              <p className="text-xs text-muted-foreground">
                + {formatCurrency(transferido)} em transferências entre contas,
                fora do saldo
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/*
        Duas abas, nao quatro. "Visão Geral" e "Gastos Compartilhados" eram
        gatilhos sem `TabsContent` nenhum: clicar em qualquer uma das duas
        trocava a lista de lançamentos por uma área em branco. Uma aba vazia não
        parece um recurso que falta -- parece que a tela quebrou.

        Os gastos compartilhados têm tela própria (`/dashboard/expense-groups`),
        que é onde eles de fato existem.
      */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="transactions">Lançamentos</TabsTrigger>
          <TabsTrigger value="limits">Limites</TabsTrigger>
        </TabsList>

        <TabsContent value="transactions" className="space-y-4">
          {/* Transactions List */}
          <Card>
            <CardHeader>
              <CardTitle>Transações Recentes</CardTitle>
              <CardDescription>
                Últimas movimentações financeiras
              </CardDescription>
            </CardHeader>
            <CardContent>
              {transactions.length > 0 ? (
                <div className="space-y-3">
                  {transactions.map((transaction) => (
                    <div
                      key={transaction.id}
                      className="flex items-center justify-between p-3 border rounded-lg transition-colors hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-full flex items-center justify-center text-white"
                          style={{
                            backgroundColor: transaction.category?.color_hex,
                          }}
                        >
                          <Receipt className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium">
                            {transaction.description}
                          </p>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>{transaction.category?.name}</span>
                            <span>•</span>
                            <span>
                              {new Date(
                                transaction.transaction_date
                              ).toLocaleDateString("pt-BR")}
                            </span>
                            {transaction.is_shared && (
                              <>
                                <span>•</span>
                                <Badge
                                  variant="outline"
                                  className="flex items-center gap-1"
                                >
                                  <Share2 className="h-3 w-3" />
                                  Compartilhado
                                </Badge>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p
                            className={`font-semibold ${
                              transaction.amount >= 0
                                ? "text-success"
                                : "text-destructive"
                            }`}
                          >
                            {formatCurrency(Math.abs(transaction.amount))}
                          </p>
                          {transaction.expense_splits &&
                            transaction.expense_splits.length > 0 && (
                              <p className="text-xs text-muted-foreground">
                                {transaction.expense_splits.length} pessoa(s)
                              </p>
                            )}
                        </div>
                        <div className="flex items-center gap-1">
                          {/*
                            Editar leva para a tela do TIPO do lançamento, com
                            o id na URL. `tipoDoLancamento` devolve `null` para
                            transferência, e aí o botão fica apagado: uma perna
                            de transferência aberta na tela de despesa viraria
                            uma despesa e deixaria a outra perna órfã -- o saldo
                            passaria a somar sozinho. Transferência é a HMO-164.
                          */}
                          {tipoDoLancamento(transaction) ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              asChild
                              className="h-8 w-8 p-0"
                              title="Editar lançamento"
                            >
                              {/*
                                Objeto, e nao string interpolada: as rotas
                                tipadas do Next recusam `${rota}?id=${id}`
                                porque o tipo da string nao e literal.
                              */}
                              <Link
                                href={{
                                  pathname: rotaDoTipo(
                                    tipoDoLancamento(transaction)!
                                  ),
                                  query: { id: transaction.id },
                                }}
                              >
                                <Pencil className="h-4 w-4" />
                              </Link>
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled
                              className="h-8 w-8 p-0"
                              title="Transferência se edita em Contas e Cartões"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteTransaction(transaction)}
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            title="Excluir transação"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 space-y-4">
                  <Receipt className="h-12 w-12 text-muted-foreground mx-auto" />
                  <div>
                    <h3 className="text-lg font-medium mb-2">
                      Nenhum lançamento ainda
                    </h3>
                    <p className="text-muted-foreground">
                      Comece registrando o que entrou ou o que saiu.
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Button variant="outline" asChild className="gap-2">
                      <Link href="/dashboard/movimentacoes/receita">
                        <TrendingUp className="h-4 w-4 text-success" />
                        Nova Receita
                      </Link>
                    </Button>
                    <Button asChild className="gap-2">
                      <Link href="/dashboard/movimentacoes/despesa">
                        <TrendingDown className="h-4 w-4" />
                        Nova Despesa
                      </Link>
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="limits" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Usage Limits Card */}
            <div className="lg:col-span-2">
              <UsageLimitsCard user={user} />
            </div>

            {/* Quick Stats */}
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Uso Atual</CardTitle>
                  <CardDescription>
                    Resumo do seu uso em tempo real
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <QuickUsage
                    user={user}
                    type="maxTransactions"
                    label="Transações"
                    showUpgrade={true}
                  />
                  <QuickUsage
                    user={user}
                    type="maxAccounts"
                    label="Contas"
                    showUpgrade={true}
                  />
                  <QuickUsage
                    user={user}
                    type="maxCategories"
                    label="Categorias"
                    showUpgrade={true}
                  />
                  <QuickUsage
                    user={user}
                    type="maxExpenseGroups"
                    label="Grupos"
                    showUpgrade={true}
                  />
                </CardContent>
              </Card>

              {!isPremium && (
                <Card className="border-warning/30 bg-warning/10">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Crown className="h-5 w-5 text-warning" />
                      Upgrade Premium
                    </CardTitle>
                    <CardDescription>
                      Desbloqueie funcionalidades avançadas
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      <div className="text-sm space-y-1">
                        <p>✨ Transações ilimitadas</p>
                        <p>📈 Análise de investimentos</p>
                        <p>📊 Relatórios avançados</p>
                        <p>🎯 Alertas personalizados</p>
                      </div>
                      <Button className="w-full" asChild>
                        <Link href="/dashboard/plans">Ver Planos Premium</Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
