"use client";

import { Suspense, useCallback, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { User } from "@supabase/supabase-js";
import { useSubscription } from "@/lib/hooks/useSubscription";
import { PlanBadge } from "@/components/subscription/PlanGuards";
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
import {
  FILTROS_DE_LANCAMENTO,
  classificarMovimentacao,
  resumoDoPeriodo,
  type FiltroDeLancamento,
} from "@/lib/movimentacoes";
import {
  destinoDoLancamento,
  indiceDeContraparte,
  type ContaDoLancamento,
} from "@/lib/destino-do-lancamento";
import {
  contarComPartes,
  linhasDaLista,
  notaDasPartesDeTerceiros,
  partesDeTerceirosNaLista,
  type DespesaDeGrupoLida,
  type LancamentoDeTerceiro,
  type ParteDeGrupoBruta,
} from "@/lib/parte-de-grupo-na-lista";
import {
  TAMANHO_DA_PAGINA,
  descreverLista,
  faixaDaPagina,
  notaDoTotal,
  temMaisParaCarregar,
} from "@/lib/lista-de-lancamentos";
import {
  ehPeriodoCorrente,
  lerPeriodo,
  periodoCorrente,
  periodoParaQuery,
  rotuloDoPeriodo,
  type Periodo,
} from "@/lib/periodo-do-painel";
import { today } from "@/lib/recurrence";
import { SeletorDePeriodo } from "@/components/dashboard/SeletorDePeriodo";
import { rotaDoTipo, tipoDoLancamento } from "@/lib/lancamento";
import { ROTA_DA_TRANSFERENCIA } from "@/lib/transferencia";
import {
  rotuloDoResumo,
  precisaDetalhar,
  type ResumoDeGrupos,
} from "@/lib/grupos";
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
  ArrowRightLeft,
  Users,
  Download,
  CalendarRange,
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
  account_id?: string | null;
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
  /**
   * O elo entre as duas pernas de uma transferencia (migration 015).
   *
   * Vinha no `*` da consulta desde sempre e nao tinha leitor. E de UMA VIA:
   * so a perna de entrada o grava -- ver `indiceDeContraparte`.
   */
  counterpart_transaction_id?: string | null;
  /** A conta do lancamento. `null` quando a linha nao tem conta registrada. */
  account?: ContaDoLancamento | null;
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

// `useSearchParams` obriga a um limite de Suspense: sem ele o `next build` para
// com "useSearchParams() should be wrapped in a suspense boundary". O
// componente de verdade e o `Lancamentos` abaixo -- mesmo desenho da tela
// inicial (ver app/(dashboard)/dashboard/page.tsx).
export default function PersonalFinancePage() {
  return (
    <Suspense fallback={<Girando />}>
      <Lancamentos />
    </Suspense>
  );
}

// No escopo do modulo porque `LinhaDaParteDeGrupo` tambem formata dinheiro, e
// duas funcoes de moeda na mesma tela e uma oportunidade de divergirem no
// numero de casas.
const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

function Girando() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

function Lancamentos() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // O fuso de Sao Paulo, uma vez so, para a tela inteira concordar sobre que dia
  // e hoje -- o mesmo `today()` do painel inicial, de bills, budgets e goals.
  const hoje = today();

  // ---------------------------------------------------------------------
  // O PERIODO MORA NA URL, COMO NO PAINEL INICIAL
  // ---------------------------------------------------------------------
  // Nao e `useState`, pelos mesmos tres motivos da HMO-173: recarregar volta
  // para o mes corrente, mandar o link manda o mes de quem abrir, e o botao
  // voltar sai da tela em vez de desfazer a navegacao de periodo.
  //
  // E ele existe, antes de tudo, porque a lista nao tinha periodo NENHUM: ela
  // pedia as 50 linhas mais recentes de toda a historia do usuario, e os
  // cartoes somavam essas 50 debaixo do subtitulo "o resumo do mes". Ver o
  // cabecalho de lib/lista-de-lancamentos.ts.
  const periodo = lerPeriodo(
    searchParams.get("de"),
    searchParams.get("ate"),
    hoje
  );

  const irPara = useCallback(
    (novo: Periodo) => {
      router.push(
        `/dashboard/personal-finance?${periodoParaQuery(novo)}`
      );
    },
    [router]
  );

  const [user, setUser] = useState<User | null>(null);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  /**
   * A ultima pagina lida veio cheia -- entao pode haver mais no periodo.
   *
   * Comeca `false`: antes da primeira resposta a tela nao pode oferecer
   * "Carregar mais", porque nao sabe se ha o que carregar.
   */
  const [temMais, setTemMais] = useState(false);
  /** Buscando a pagina seguinte, com a lista atual ainda na tela. */
  const [carregandoMais, setCarregandoMais] = useState(false);
  /** Refazendo a consulta do periodo -- a lista fica fora da tela enquanto isso. */
  const [atualizando, setAtualizando] = useState(false);
  /**
   * O `service_id` de `personal_finance`, guardado no primeiro carregamento.
   *
   * Sem ele, "Carregar mais" teria que reconsultar `financial_services` a cada
   * clique para descobrir de novo um id que nunca muda.
   */
  const [serviceId, setServiceId] = useState<string | undefined>(undefined);
  /** Qual dos quatro filtros da lista esta selecionado. */
  const [filtro, setFiltro] = useState<FiltroDeLancamento>("todos");
  /** De quando sao os dados na tela, quando eles vieram do aparelho. */
  const [catalogoDe, setCatalogoDe] = useState<number | null>(null);
  /**
   * O acerto com os grupos (HMO-175). `null` enquanto nao respondeu e tambem
   * quando a chamada falhou: o cartao some, em vez de mostrar R$ 0,00 -- um
   * zero aqui e indistinguivel de "esta tudo quitado", e mandaria a pessoa
   * concluir que nao deve nada quando so a consulta caiu.
   */
  const [resumoDeGrupos, setResumoDeGrupos] = useState<ResumoDeGrupos | null>(
    null
  );
  /** id -> nome dos meus grupos ativos, para rotular a linha do lançamento. */
  const [nomeDoGrupo, setNomeDoGrupo] = useState<Record<string, string>>({});
  /**
   * A minha parte das despesas de grupo que OUTRA pessoa pagou (HMO-215).
   *
   * Estado PROPRIO, e não anexado a `transactions`, por dois motivos que valem
   * dinheiro e paginação:
   *
   * - `carregarMais` deriva a próxima página de `transactions.length`. Misturar
   *   linhas que não vieram do `.range()` faria a lista pedir a página 3 de um
   *   conjunto que está na página 1, e aparecer com um buraco no meio;
   * - elas não são linhas minhas: não dá para editar nem excluir. Ver o
   *   cabeçalho de lib/parte-de-grupo-na-lista.ts.
   */
  const [partesDeGrupo, setPartesDeGrupo] = useState<LancamentoDeTerceiro[]>([]);
  /**
   * A consulta das partes falhou neste período.
   *
   * Existe porque o estado de erro e o de "não há parte nenhuma" sao o MESMO
   * array vazio, e os dois têm leituras opostas na tela: um diz "você não deve
   * nada em grupo este mês" e o outro diz "a lista está incompleta e eu não vou
   * te contar". Sem esta bandeira a tela escolheria sempre a primeira.
   */
  const [partesFalharam, setPartesFalharam] = useState(false);

  const { canCreateMore, planConfig } = useSubscription(user);

  // Função para deletar transação
  //
  // TODA EXCLUSAO SAI POR UMA ROTA -- NENHUMA POR `supabase.delete()` DAQUI
  // ------------------------------------------------------------------------
  // Transferencia sempre saiu por rota (HMO-164), porque ela sao DUAS linhas e
  // um delete cru apaga uma: a FK de `counterpart_transaction_id` e ON DELETE
  // SET NULL (015), entao a outra perna nao e apagada nem da erro -- ela fica,
  // com o elo zerado, mexendo o saldo de UMA conta. Meia transferencia nao tem
  // sintoma: o extrato parece completo e o patrimonio esta errado pelo valor
  // inteiro.
  //
  // Receita e despesa iam pelo outro caminho: um `.from("financial_transactions")
  // .delete()` escrito aqui, com `/api/personal-finance/transactions/[id]`
  // parada do lado fazendo a MESMA coisa mais um passo. Dois caminhos de escrita
  // para a mesma operacao e o defeito que a HMO-118 pediu para eliminar, e o
  // motivo nao e estetico: eles nao divergem hoje -- `group_transactions` cai
  // por CASCADE (001), entao o passo extra da rota e redundante --, mas o
  // proximo cuidado que a exclusao precisar (um estorno, um aviso de grupo, uma
  // linha de auditoria) vai ser escrito em UM dos dois. Quem apagar pela tela
  // nao recebe esse cuidado, e nada nessa situacao parece errado.
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
      const resposta = await fetch(
        ehTransferencia
          ? `/api/movimentacoes/transferencia?id=${transaction.id}`
          : `/api/personal-finance/transactions/${transaction.id}`,
        { method: "DELETE" }
      );
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        // A mensagem da rota vem em `error`; sem ela, uma frase que diz o que
        // aconteceu. Um `throw new Error(undefined)` chegaria no catch como
        // "Erro ao excluir transação" e esconderia o status.
        throw new Error(
          dados.error || `A exclusão foi recusada (HTTP ${resposta.status}).`
        );
      }
      // A frase de sucesso e escrita aqui, e a da rota so vale para a
      // transferencia -- que e quem tem algo a mais para contar ("as duas
      // pernas"). `/api/personal-finance/transactions/[id]` responde
      // "Transaction deleted successfully", em ingles: repassar `dados.message`
      // sem olhar poria ingles num toast de um app em portugues.
      toast.success(
        ehTransferencia
          ? dados.message || "Transferência excluída."
          : "Transação excluída com sucesso!"
      );

      recarregar();
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

  // Recarrega a primeira pagina do periodo. E o que a tela faz ao abrir, ao
  // trocar de periodo e depois de excluir um lancamento.
  const recarregar = () => {
    loadData();
  };

  // Depende do periodo: trocar de mes tem que refazer a consulta, senao a seta
  // muda o rotulo e os numeros continuam os do mes anterior -- que e
  // exatamente a classe de defeito que esta issue esta corrigindo.
  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo.de, periodo.ate]);

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

  /**
   * O acerto com os grupos, num try/catch PROPRIO.
   *
   * Dentro do `try` grande do `loadData` esta chamada teria um efeito que ela
   * nao deveria ter: qualquer falha aqui -- grupo nenhum, rota fora do ar, 500
   * -- cairia no catch que trata FALTA DE REDE, e a tela reagiria repondo o
   * catalogo do aparelho e avisando "sem conexão", com a lista de lançamentos
   * que ja tinha carregado. Um recurso secundario nao pode apagar o principal.
   *
   * Quem participa de zero grupos recebe um resumo com zero grupos, e o cartao
   * simplesmente nao aparece -- nao ha erro nenhum nesse caminho.
   */
  const carregarGrupos = async () => {
    try {
      const resposta = await fetch("/api/expense-groups/my-balance");
      if (!resposta.ok) return;

      const dados = await resposta.json();
      if (!dados?.resumo) return;

      setResumoDeGrupos(dados.resumo);
      setNomeDoGrupo(
        Object.fromEntries(
          (dados.grupos || []).map((g: { id: string; name: string }) => [
            g.id,
            g.name,
          ])
        )
      );
    } catch (erro) {
      console.error("Erro ao carregar o acerto dos grupos:", erro);
    }
  };

  /**
   * A MINHA PARTE DAS DESPESAS DE GRUPO QUE OUTRA PESSOA PAGOU (HMO-215)
   *
   * O pedido da issue e "todos os lancamentos, indiferente de onde foi", e este
   * era o unico buraco de verdade: a consulta de cima filtra `user_id = eu`, e
   * a despesa que a Ana pagou na viagem e uma linha DELA. A minha parte esta
   * gravada em `group_expense_splits`, o painel ja a conta como realizado desde
   * a HMO-202 -- e a LISTA, que e onde a pessoa vai perguntar "o que foi
   * lancado?", nunca a mostrou. O mes dela parecia mais barato do que foi.
   *
   * DUAS CONSULTAS, E A SEGUNDA NAO E PREGUICA
   * ------------------------------------------
   * `group_share_entries` (033) e a unica definicao de "minha parte" do lado do
   * realizado, e ela devolve `category_id` e `transaction_id` -- nao a
   * DESCRICAO. Uma linha "R$ 200,00 · Lazer · 18/09" sem dizer de que despesa e
   * so acrescenta um valor que a pessoa nao reconhece.
   *
   * A descricao sai de `financial_transactions`, e a RLS permite: a policy de
   * SELECT do 002 e `user_id = auth.uid() OR (group_id IS NOT NULL AND
   * is_group_member(group_id))`. Ela e lida pelos ids que a view devolveu, e
   * nao por um filtro de grupo -- com `.in("id", ...)` nao ha como voltar linha
   * de grupo nenhum alem das que ja tem parte minha.
   *
   * O `.eq("user_id", user.id)` NA VIEW E OBRIGATORIO, e esta no comentario dela
   * no banco: ela nao filtra por usuario, e a mesma policy com `OR` que torna a
   * descricao legivel faz a view devolver a parte dos OUTROS membros tambem.
   * Sem o filtro, a lista somaria o rateio de gente que nao sou eu.
   *
   * Try/catch PROPRIO, como `carregarGrupos`: um banco sem a 033 aplicada
   * responde erro aqui, e dentro do try grande do `loadData` isso cairia no
   * catch que trata FALTA DE REDE -- a tela apagaria a lista que ja carregou e
   * anunciaria "sem conexão". Recurso secundario nao derruba o principal.
   */
  const carregarPartesDeGrupo = async (userId: string) => {
    try {
      const { data: partes, error } = await supabase
        .from("group_share_entries")
        .select(
          "id, transaction_id, group_id, transaction_date, category_id, transaction_type, currency, amount, split_status, paguei_eu"
        )
        .eq("user_id", userId)
        .eq("paguei_eu", false)
        .gte("transaction_date", periodo.de)
        .lte("transaction_date", periodo.ate)
        .order("transaction_date", { ascending: false });

      if (error) throw error;
      if (!partes || partes.length === 0) {
        setPartesDeGrupo([]);
        return;
      }

      const ids = Array.from(
        new Set((partes as ParteDeGrupoBruta[]).map((p) => p.transaction_id))
      );

      const { data: despesas, error: erroDaDescricao } = await supabase
        .from("financial_transactions")
        .select("id, description, amount, category:transaction_categories(*)")
        .in("id", ids);

      if (erroDaDescricao) throw erroDaDescricao;

      const porId = new Map<string, DespesaDeGrupoLida>(
        (despesas || []).map((d: any) => [d.id as string, d as DespesaDeGrupoLida])
      );

      const { linhas, semDescricao } = partesDeTerceirosNaLista(
        partes as ParteDeGrupoBruta[],
        porId
      );

      // Uma parte sem a despesa e DESCARTADA, e o descarte aparece. Sem este
      // aviso a lista ficaria com menos linhas do que existe e nada diria
      // isso -- o "zero confiante" desta tela, em versão menor.
      if (semDescricao > 0) {
        console.error(
          `${semDescricao} parte(s) de grupo sem a despesa correspondente legível; ficaram fora da lista.`
        );
      }

      setPartesDeGrupo(linhas);
    } catch (erro) {
      console.error("Erro ao carregar a minha parte das despesas de grupo:", erro);
      // A bandeira, e nao um array vazio em silencio: vazio aqui se le na tela
      // como "você não deve nada em grupo este mês", que e uma afirmacao que
      // esta consulta acabou de nao poder fazer. Ver `partesFalharam`.
      setPartesFalharam(true);
    }
  };

  /**
   * Uma pagina de lancamentos DO PERIODO ESCOLHIDO.
   *
   * O `.limit(50)` que estava aqui nao tinha recorte de data nenhum: trazia as
   * 50 linhas mais recentes de toda a historia do usuario. Agora ha `gte`/`lte`
   * sobre `transaction_date` -- que e `date` no banco (001), entao os dois
   * extremos sao inclusivos e exatos, sem a armadilha de fuso que um
   * `timestamptz` traria.
   *
   * POR QUE TRES `order`, E NAO UM
   * ------------------------------
   * `transaction_date` e so a data: um dia com quatro lancamentos tem quatro
   * linhas empatadas, e o Postgres nao promete ordem entre linhas empatadas --
   * nem que ela seja a mesma em duas consultas. Com `.range()` isso deixa de
   * ser detalhe: a mesma linha pode voltar na pagina 1 e na pagina 2 (uma
   * duplicata na lista, indistinguivel de uma despesa lancada duas vezes) ou em
   * nenhuma das duas (a linha desaparece, que e o defeito que esta issue esta
   * consertando, agora com paginacao em vez de limite). `created_at` desempata
   * quase sempre e `id` fecha o resto -- e o par e ESTAVEL, que e o que a
   * paginacao exige.
   *
   * O `error` e lancado, e nao descartado. `const { data } = await ...` era o
   * que estava aqui: qualquer falha de consulta virava `data: null`, a tela
   * mostrava zero lancamento e nada dizia que a lista nao carregou. Quem cai no
   * catch de `loadData` hoje recebe a mensagem de FALTA DE REDE, que para um
   * erro de banco e o rotulo errado -- mas um rotulo errado que avisa e melhor
   * do que um zero confiante que nao avisa.
   */
  const consultarPagina = async (
    userId: string,
    serviceId: string | undefined,
    pagina: number
  ): Promise<FinancialTransaction[]> => {
    const faixa = faixaDaPagina(pagina);

    const { data, error } = await supabase
      .from("financial_transactions")
      .select(
        `
        *,
        category:transaction_categories(*),
        account:financial_accounts(id, name, account_type),
        expense_splits(
          *,
          participant:profiles!expense_splits_participant_id_fkey(full_name, avatar_url)
        )
      `
      )
      .eq("user_id", userId)
      .eq("service_id", serviceId)
      .gte("transaction_date", periodo.de)
      .lte("transaction_date", periodo.ate)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(faixa.de, faixa.ate);

    if (error) throw error;
    return (data || []) as FinancialTransaction[];
  };

  /**
   * A pagina seguinte, anexada ao fim da lista.
   *
   * A pagina e derivada do que ja esta na tela (`transactions.length /
   * TAMANHO_DA_PAGINA`) em vez de vir de um contador em estado. Um contador
   * proprio teria que ser zerado em toda troca de periodo, em toda exclusao e
   * em todo recarregamento -- e o dia em que um desses esquecesse, a lista
   * pediria a pagina 3 de um periodo que acabou de voltar para a pagina 1 e
   * apareceria com um buraco no meio.
   */
  const carregarMais = async () => {
    if (!user || carregandoMais) return;

    setCarregandoMais(true);
    try {
      const proxima = await consultarPagina(
        user.id,
        serviceId,
        Math.floor(transactions.length / TAMANHO_DA_PAGINA)
      );

      setTransactions((atuais) => [...atuais, ...proxima]);
      setTemMais(temMaisParaCarregar(proxima.length));
    } catch (erro) {
      console.error("Erro ao carregar mais lançamentos:", erro);
      // Sem `setTemMais(false)`: o botao continua ali para uma segunda
      // tentativa. Esconde-lo depois de uma falha deixaria a pessoa com uma
      // lista cortada e nenhum caminho para o resto dela.
      toast.error(
        "Não foi possível carregar mais lançamentos. Tente novamente."
      );
    } finally {
      setCarregandoMais(false);
    }
  };

  const loadData = async () => {
    // A LISTA DA TELA E ZERADA ANTES DA CONSULTA, E ISSO E DE PROPOSITO.
    //
    // Sem isto, trocar de mes com a seta deixa as linhas do mes ANTERIOR na
    // tela debaixo do rotulo do mes novo, enquanto a consulta corre -- e se ela
    // falhar, elas ficam ali. Sao os lancamentos de agosto apresentados como os
    // de setembro: nenhum erro, nenhuma tela vazia, e o mesmo defeito que este
    // seletor de periodo existe para eliminar.
    //
    // O vazio nao pisca como "nenhum lançamento" porque `atualizando` troca a
    // lista por um indicador de carga -- ver o JSX.
    setAtualizando(true);
    setTransactions([]);
    setTemMais(false);
    // As partes de grupo sao do PERIODO tambem (HMO-215): deixa-las na tela ao
    // trocar de mes poria a minha parte do jantar de setembro debaixo do rotulo
    // de agosto -- o mesmo defeito que o seletor de periodo existe para
    // eliminar, agora pela outra fonte.
    setPartesDeGrupo([]);
    setPartesFalharam(false);

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

      // A primeira pagina do periodo escolhido.
      setServiceId(serviceData?.id);

      const primeiraPagina = await consultarPagina(
        user.id,
        serviceData?.id,
        0
      );

      setTransactions(primeiraPagina);
      setTemMais(temMaisParaCarregar(primeiraPagina.length));

      await carregarGrupos();
      await carregarPartesDeGrupo(user.id);

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
      setAtualizando(false);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const { income, expenses, balance, transferido, transferencias } =
    calculateBalance();

  // As duas saem da mesma fonte que os cartoes do topo (`classificarMovimentacao`),
  // de proposito: a aba "Despesas" tem que mostrar exatamente as linhas que o
  // cartao "Despesas" somou. Filtrar aqui por sinal do valor daria uma lista
  // que discorda do total logo acima dela, na mesma tela.
  //
  // DUAS FONTES, UMA LISTA (HMO-215). `linhasDaLista` junta as minhas linhas com
  // a minha parte das despesas de grupo que outra pessoa pagou, em ordem de
  // data -- coladas sem reordenar, as partes de setembro cairiam no fim, abaixo
  // das minhas de marco. `contarComPartes` conta as duas fontes pelo mesmo
  // critério: a contagem na barra de abas tem que casar com o que a aba mostra,
  // senão "Despesas 4" abre com seis linhas.
  const visiveis = linhasDaLista(transactions, partesDeGrupo, filtro);
  const contagem = contarComPartes(transactions, partesDeGrupo);

  // O elo entre as duas pernas de cada transferencia, montado uma vez por
  // render em vez de por linha: `destinoDoLancamento` precisa achar a
  // contraparte, e uma varredura do array dentro do `.map()` seria O(n²) numa
  // lista que vai a 50 linhas por pagina e nao tem teto de paginas.
  const contrapartes = indiceDeContraparte(transactions);

  // Quanto as partes de grupo somam, para a tela poder dizer que elas estao na
  // lista e FORA dos tres cartoes. Ver o cabecalho de
  // lib/parte-de-grupo-na-lista.ts.
  const notaDasPartes = notaDasPartesDeTerceiros(partesDeGrupo);

  // QUANTAS LINHAS A LISTA TEM, SOMANDO AS DUAS FONTES.
  //
  // `transactions.length` sozinho mentia de um jeito que da para ver na tela:
  // quem so tem parte de grupo no mes (nao pagou nada, deve a sua parte do
  // jantar) teria `carregados = 0`, e `descreverLista` responde a isso com
  // "Nenhum lançamento em setembro de 2026" -- escrito logo acima da linha do
  // jantar, que esta ali na lista. A frase e a lista se contradizendo no mesmo
  // cartao.
  //
  // `temMais` continua saindo so da paginacao das MINHAS linhas, e esta certo:
  // as partes de grupo vem todas de uma vez, nao ha pagina seguinte delas.
  const carregados = transactions.length + partesDeGrupo.length;

  // O que a lista diz sobre si mesma: quantas linhas, DE QUE PERIODO, e se
  // falta alguma. A regra esta em lib/lista-de-lancamentos.ts, com teste, e nao
  // aqui no JSX -- ver o cabecalho daquele arquivo.
  // A linha debaixo dos tres cartoes. Era a string "Este mês", escrita no JSX --
  // ver `notaDoTotal`.
  const notaDosTotais = notaDoTotal({
    rotuloDoPeriodo: rotuloDoPeriodo(periodo),
    temMais,
  });

  const descricaoDaLista = descreverLista({
    rotuloDoPeriodo: rotuloDoPeriodo(periodo),
    filtro,
    visiveis: visiveis.length,
    carregados,
    temMais,
  });

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
          {/*
            O periodo entra na frase, e nao e enfeite: ela dizia "o resumo do
            mês" enquanto os cartoes somavam as 50 linhas mais recentes de toda
            a historia do usuario, sem recorte de data nenhum. Para quem lança
            vinte vezes por mês, "o resumo do mês" somava dois meses e meio.
            Ver lib/lista-de-lancamentos.ts.
          */}
          <p className="text-muted-foreground">
            Seus lançamentos e o resumo de{" "}
            <span className="font-medium text-foreground">
              {rotuloDoPeriodo(periodo)}
            </span>
            . Receita e despesa se lançam em telas próprias.
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

      {/*
        O SELETOR DE PERIODO, E O EXPORT QUE SEGUE O PERIODO
        ---------------------------------------------------
        O mesmo componente da tela inicial, sobre a mesma lib -- e o `Periodo`
        vive na URL, entao o link que a pessoa manda mostra o mes dela e o botao
        voltar do navegador anda entre periodos.

        O "Exportar CSV" e um `<a>`, e nao um `onClick` com `fetch` e Blob: a
        rota ja responde com `Content-Disposition: attachment`, e um link deixa o
        download nas maos do navegador -- inclusive "salvar como", que um Blob
        em memoria nao oferece.

        O `de`/`ate` no link e o que mantem o arquivo e a tela falando do MESMO
        periodo. E a rota e a de /api/personal-finance/, nao a de relatorios:
        aquela exclui os lançamentos de grupo e nao filtra `service_id`, entao o
        arquivo sairia com linhas que esta lista nao mostra e SEM linhas que ela
        mostra. Ver o cabecalho de
        app/api/personal-finance/transactions/export/route.ts.
      */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SeletorDePeriodo periodo={periodo} hoje={hoje} aoMudar={irPara} />

        <Button variant="outline" asChild className="gap-2">
          <a
            href={`/api/personal-finance/transactions/export?${periodoParaQuery(
              periodo
            )}`}
          >
            <Download className="h-4 w-4" />
            Exportar CSV
          </a>
        </Button>
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
            <p className="text-xs text-muted-foreground">{notaDosTotais}</p>
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
            <p className="text-xs text-muted-foreground">{notaDosTotais}</p>
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
            <p className="text-xs text-muted-foreground">
              Receitas - Despesas · {notaDosTotais}
            </p>
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
            {/*
              A MINHA PARTE DO QUE OUTROS PAGARAM, ESCRITA E FORA DOS CARTOES
              --------------------------------------------------------------
              Ela está na LISTA (é o pedido da HMO-215: "todos os lançamentos,
              indiferente de onde foi") e não entra nos três cartões. O motivo
              está no cabeçalho de lib/parte-de-grupo-na-lista.ts, e é de
              significado, não de preguiça: o cartão "Despesas" soma as MINHAS
              linhas, e numa despesa de grupo que eu paguei ele soma o valor
              CHEIO -- R$ 400 do hotel, que é o que saiu da minha conta.
              Acrescentar "a minha parte do que os outros pagaram" misturaria
              dois critérios dentro de um número só: valor cheio de um lado,
              fração do outro. O resultado não seria nem "o que saiu de mim" nem
              "o que me cabe", e nada na tela denunciaria isso.

              É a mesma saída que a transferência recebeu logo acima: a linha
              aparece na lista, o valor aparece escrito aqui, e o cartão continua
              significando uma coisa só.
            */}
            {notaDasPartes && (
              <p className="text-xs text-muted-foreground">
                + {formatCurrency(notaDasPartes.total)} em{" "}
                {notaDasPartes.quantas === 1
                  ? "1 despesa de grupo que outra pessoa pagou"
                  : `${notaDasPartes.quantas} despesas de grupo que outras pessoas pagaram`}
                , na lista e fora do saldo
              </p>
            )}
            {/*
              O erro e o vazio sao o MESMO array, e têm leituras opostas: um diz
              "você não deve nada em grupo este mês" e o outro diz "a lista está
              incompleta". Sem esta linha a tela escolheria sempre a primeira --
              o "zero confiante" que esta tela já pagou duas vezes.
            */}
            {partesFalharam && (
              <p className="text-xs text-warning">
                Sua parte das despesas de grupo não carregou: a lista abaixo pode
                estar incompleta.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/*
        O ACERTO COM OS GRUPOS (HMO-175)
        --------------------------------
        Uma despesa de grupo é gravada inteira na minha conta -- quem pagou o
        restaurante desembolsou os R$ 300, não os R$ 100 da parte dele. Então o
        cartão "Despesas" acima está certo e, ainda assim, não responde "quanto
        disso volta pra mim?". Esse número vivia só dentro da tela de cada
        grupo, uma tela por grupo, e nunca somado.

        Fora do grid de cima de propósito: os três cartões falam do MÊS, e este
        fala do saldo acumulado em aberto, que não tem recorte de mês nenhum.
        Um quarto cartão ali dentro herdaria o "Este mês" dos vizinhos e diria
        uma data que a conta não tem.

        Ele some quando não há grupo com saldo aberto -- e quando a consulta
        falha (`resumoDeGrupos` fica `null`). Ver a nota do estado.
      */}
      {resumoDeGrupos && resumoDeGrupos.grupos.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="space-y-1">
              <CardTitle className="text-sm font-medium">
                {rotuloDoResumo(resumoDeGrupos).titulo}
              </CardTitle>
              <CardDescription>
                O que cabe a você nas despesas dos grupos, menos o que você já
                pagou por eles
              </CardDescription>
            </div>
            <Users className="h-4 w-4 shrink-0" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div
                className={`text-2xl font-bold ${
                  rotuloDoResumo(resumoDeGrupos).estado === "devo"
                    ? "text-destructive"
                    : "text-success"
                }`}
              >
                {formatCurrency(rotuloDoResumo(resumoDeGrupos).valor)}
              </div>
              {/*
                O líquido sozinho mente quando há grupos nos dois sentidos:
                dever R$ 500 na viagem e ter R$ 500 a receber em casa dá zero,
                e ninguém paga a viagem com um crédito que está com outras
                pessoas. Nesse caso as duas pontas aparecem escritas.
              */}
              {precisaDetalhar(resumoDeGrupos) && (
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(resumoDeGrupos.aPagar)} a pagar e{" "}
                  {formatCurrency(resumoDeGrupos.aReceber)} a receber, em grupos
                  diferentes
                </p>
              )}
            </div>

            {/* `grid-cols-1` explícito: sem ele o trilho automático usa o
                conteúdo mínimo como piso e a linha estoura a largura do
                celular (HMO-168). */}
            <div className="grid grid-cols-1 gap-2">
              {resumoDeGrupos.grupos.map((grupo) => (
                <Link
                  key={grupo.group_id}
                  href={`/dashboard/expense-groups/${grupo.group_id}`}
                  className="flex items-center justify-between gap-3 p-3 border rounded-lg transition-colors hover:bg-muted/50"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{grupo.nome}</p>
                    <p className="text-xs text-muted-foreground">
                      Você pagou {formatCurrency(grupo.total_paid)} · sua parte
                      é {formatCurrency(grupo.total_owed)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p
                      className={`font-semibold ${
                        grupo.devo > 0 ? "text-destructive" : "text-success"
                      }`}
                    >
                      {formatCurrency(Math.abs(grupo.devo))}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {grupo.devo > 0 ? "você deve" : "a receber"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Quem paga quem está na tela de cada grupo.
            </p>
          </CardContent>
        </Card>
      )}

      {/*
        A barra agora filtra a lista por TIPO -- ela não troca de assunto.

        Antes eram "Lançamentos" e "Limites", e a segunda não falava de dinheiro
        nenhum: era quanto do plano já foi usado. Ela mudou de tela (está em
        Configurações › Plano e limites), e o lugar ficou para o que esta tela
        de fato precisava. Os três tipos sempre estiveram na lista -- a consulta
        nunca filtrou por tipo --, só que misturados e sem rótulo: uma perna de
        transferência tem a mesma cara de uma despesa, valor negativo e tudo.

        Sem `grid w-full`: o `TabsList` deste projeto já resolve o estouro no
        celular com `overflow-x-auto`, e o trilho de grid não escapa disso --
        ele cresce até o conteúdo mínimo, e "Transferências" sem quebra tem um
        mínimo largo. Foi assim que a barra de abas empurrou a página inteira
        para o lado na HMO-168.
      */}
      <Tabs
        value={filtro}
        onValueChange={(v) => setFiltro(v as FiltroDeLancamento)}
        className="w-full"
      >
        <TabsList>
          {FILTROS_DE_LANCAMENTO.map((f) => (
            <TabsTrigger key={f.id} value={f.id} className="gap-1.5">
              {f.rotulo}
              {/*
                A contagem é o que responde "cadê minhas transferências?" sem
                exigir um clique: um zero aqui distingue "não há linha desse
                tipo" de "a aba abriu vazia porque quebrou".
              */}
              <span className="text-xs text-muted-foreground">
                {contagem[f.id]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>

        {/*
          Um `TabsContent` por filtro, todos com o MESMO conteúdo: o Radix só
          monta o painel do valor ativo, e `visiveis` já está filtrado por
          `filtro`. Um painel só, fora do `Tabs`, deixaria os outros três
          gatilhos sem painel nenhum -- que é exatamente o bug das abas vazias
          que esta tela já teve.
        */}
        {FILTROS_DE_LANCAMENTO.map((f) => (
          <TabsContent key={f.id} value={f.id} className="space-y-4">
          {/* Transactions List */}
          <Card>
            <CardHeader>
              {/*
                Era "Transações Recentes" + "Últimas movimentações financeiras",
                e nenhum dos dois dizia RECENTES ATE QUANDO. A lista trazia 50
                linhas sem recorte de data; agora as duas frases saem de
                `descreverLista`, que nomeia o periodo e admite quando a lista
                esta cortada.
              */}
              <CardTitle>{descricaoDaLista.titulo}</CardTitle>
              <CardDescription>{descricaoDaLista.descricao}</CardDescription>
            </CardHeader>
            <CardContent>
              {/*
                Enquanto a consulta do periodo corre, a lista sai da tela e da
                lugar a um indicador. Sem isto o vazio de `setTransactions([])`
                pisca como "Nenhum lançamento em setembro de 2026" -- um zero
                confiante em cima de um periodo que ainda nao foi lido.
              */}
              {atualizando ? (
                <div
                  className="flex items-center justify-center py-8"
                  aria-live="polite"
                >
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                  <span className="sr-only">Carregando lançamentos</span>
                </div>
              ) : visiveis.length > 0 ? (
                <div className="space-y-3">
                  {visiveis.map((linha) => {
                    /*
                      DUAS FORMAS DE LINHA, E O `kind` OBRIGA A DECIDIR (HMO-215)
                      ----------------------------------------------------------
                      A minha parte de uma despesa que outra pessoa pagou nao e
                      uma linha minha: nao tem conta, nao da para editar e nao da
                      para excluir -- apagar a parte daqui mexeria na despesa de
                      quem pagou. Fosse um `FinancialTransaction` com campos
                      opcionais, os dois botoes de acao apareceriam em cima dela
                      e o `onClick` chamaria
                      `/api/personal-finance/transactions/<id de uma parte>`:
                      um 404 que, para quem clicou, se le como "o app nao
                      conseguiu apagar".

                      Com a uniao discriminada esquecer um ramo e erro de
                      compilacao. Ver lib/parte-de-grupo-na-lista.ts.
                    */
                    if (linha.kind === "parte") {
                      return (
                        <LinhaDaParteDeGrupo
                          key={linha.parte.id}
                          parte={linha.parte}
                          nomeDoGrupo={nomeDoGrupo}
                        />
                      );
                    }

                    const transaction = linha.mov;
                    const destino = destinoDoLancamento(
                      transaction,
                      contrapartes
                    );

                    return (
                    /*
                      A LINHA DO LANCAMENTO, E OS 693px (HMO-185)
                      -------------------------------------------
                      Medida em producao, esta linha fazia o documento inteiro
                      ter 693px de largura -- no iPhone de 390px e no de 320px,
                      o MESMO 693. Largura que nao muda com a viewport nao e
                      "quase coubesse": e piso de min-content. Um flex container
                      sem quebra nao encolhe abaixo da soma do que tem dentro, e
                      aqui dentro havia um `<p>` com a descricao inteira numa
                      linha so e, embaixo dele, uma fila de selo + categoria +
                      ponto + data + selo do grupo que tambem nao quebrava.

                      Esta e a tela que o Helio chamou de "lancamentos de
                      receitas e despesas". As telas de CADASTRO
                      (/movimentacoes/receita e /despesa) foram medidas junto e
                      estao limpas nas duas larguras -- o vazamento e da lista.

                      Tres mudancas carregam o conserto, e cada uma foi
                      medida sozinha em navegador:
                        - `min-w-0` no bloco da esquerda (o do `flex-1`) E no
                          embrulho do texto. Sao DOIS, e os dois pesam: tirando
                          so o do bloco da esquerda a pagina volta a 614px numa
                          viewport de 390. Sem eles o `truncate` nunca chega a
                          agir, porque o minimo automatico de um item flex e o
                          min-content dele;
                        - `truncate` na descricao, que e o que de fato permite
                          a linha ficar menor que o texto;
                        - `flex-wrap` na fila de metadados, com `gap-y` para as
                          linhas nao se colarem (a licao do `space-x-*` da
                          HMO-160).

                      O `shrink-0` do circulo e o do bloco do valor NAO estao
                      nessa conta: removidos dos quatro blocos na pagina
                      renderizada, a largura fica em 320/320 exatamente igual.
                      Ficam como defesa -- o dia em que o valor ganhar uma
                      segunda linha (a conversao de moeda ja faz isso na tela
                      de grupo) eles passam a importar -- mas quem conserta
                      hoje sao os tres de cima. Nao ha caso em
                      test-mobile-overflow.mjs exigindo os `shrink-0`, de
                      proposito: um teste sobre classe inerte nao sabe falhar
                      por motivo de verdade.
                    */
                    <div
                      key={transaction.id}
                      className="flex items-center justify-between gap-3 p-3 border rounded-lg transition-colors hover:bg-muted/50"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div
                          className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white"
                          style={{
                            backgroundColor: transaction.category?.color_hex,
                          }}
                        >
                          <Receipt className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium truncate">
                            {transaction.description}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                            {/*
                              O tipo, escrito, em toda linha. Sem ele a perna de
                              saída de uma transferência é indistinguível de uma
                              despesa: as duas chegam com valor negativo e são
                              pintadas de vermelho logo ali do lado. Quem
                              procurava para onde foi o dinheiro lia um gasto
                              que nunca existiu.
                            */}
                            <Badge variant="outline" className="shrink-0">
                              {
                                {
                                  income: "Receita",
                                  expense: "Despesa",
                                  transfer: "Transferência",
                                }[classificarMovimentacao(transaction)]
                              }
                            </Badge>
                            <span>{transaction.category?.name}</span>
                            {/*
                              O DESTINO (HMO-215)
                              -------------------
                              `account_id` esta na linha desde o 001 e nao tinha
                              leitor nenhum nesta tela. Faltando ele:

                              - uma transferencia nao dizia entre QUAIS contas.
                                As duas pernas sao duas linhas com a mesma
                                descricao e o mesmo valor, uma verde e uma
                                vermelha, as duas com o selo "Transferência" --
                                e nada na tela dizia qual saiu da corrente;
                              - duas despesas iguais em contas diferentes
                                (mesmo mercado, mesmo valor, mesmo dia, uma no
                                cartao e uma no debito) ficavam IDENTICAS na
                                lista, e a leitura natural e que a despesa foi
                                lancada em duplicata. Essa leitura termina em
                                alguem apagando uma despesa real.

                              A frase inteira sai de `destinoDoLancamento`, com
                              teste: ela depende do TIPO da linha (em receita a
                              conta e o destino, em despesa e a origem, em
                              transferencia sao as duas pontas, que estao em
                              duas linhas diferentes do banco) e nunca desenha
                              uma seta com um lado em branco.

                              Linha sem conta nao mostra nada em vez de mostrar
                              "Sem conta": a maioria das linhas de grupo nao tem
                              conta, e um selo cinza repetido em toda despesa de
                              grupo seria ruido no lugar da informacao.
                            */}
                            {!destino.faltaConta && (
                              <>
                                <span>•</span>
                                <span className="truncate">{destino.texto}</span>
                              </>
                            )}
                            <span>•</span>
                            <span>
                              {new Date(
                                transaction.transaction_date
                              ).toLocaleDateString("pt-BR")}
                            </span>
                            {/*
                              O NOME DO GRUPO, e não "Compartilhado" (HMO-175).

                              O selo genérico aparecia igual para os dois tipos
                              de rateio -- grupo e conexão avulsa -- e não
                              dizia com QUEM. Quem lançava a despesa marcando o
                              grupo não tinha, nesta tela, nenhuma confirmação
                              de que ela de fato entrou lá: uma despesa de
                              grupo e uma dividida com uma pessoa só ficavam
                              com exatamente a mesma cara.

                              O selo genérico continua para o rateio sem grupo,
                              e para o grupo cujo nome não veio (a chamada de
                              grupos falha sem derrubar a lista): ali "•
                              Compartilhado" é menos informação, não informação
                              errada.
                            */}
                            {transaction.is_shared && (
                              <>
                                <span>•</span>
                                <Badge
                                  variant="outline"
                                  className="flex items-center gap-1"
                                >
                                  {transaction.group_id &&
                                  nomeDoGrupo[transaction.group_id] ? (
                                    <>
                                      <Users className="h-3 w-3" />
                                      {nomeDoGrupo[transaction.group_id]}
                                    </>
                                  ) : (
                                    <>
                                      <Share2 className="h-3 w-3" />
                                      Compartilhado
                                    </>
                                  )}
                                </Badge>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
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
                              title="Transferência não se edita por aqui: são duas pernas, e abrir só uma deixaria a outra órfã"
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
                    );
                  })}
                </div>
              ) : carregados > 0 ? (
                /*
                  Vazio por causa do FILTRO, não por falta de lançamento. Os
                  dois casos são diferentes e a mensagem antiga só sabia um
                  deles: "Nenhum lançamento ainda" numa conta com 40 despesas,
                  só porque a aba "Transferências" está aberta, é a tela
                  afirmando com confiança algo falso -- e o botão "Nova Receita"
                  logo abaixo manda resolver o problema errado.
                */
                <div className="text-center py-8 space-y-4">
                  <Receipt className="h-12 w-12 text-muted-foreground mx-auto" />
                  <div>
                    <h3 className="text-lg font-medium mb-2">
                      Nenhum lançamento deste tipo
                    </h3>
                    <p className="text-muted-foreground">
                      {rotuloDoPeriodo(periodo)} tem {carregados}{" "}
                      lançamento(s) carregado(s), e nenhum em{" "}
                      {f.rotulo.toLowerCase()}.
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => setFiltro("todos")}>
                    Ver todos os lançamentos
                  </Button>
                </div>
              ) : (
                /*
                  Periodo vazio. A mensagem antiga era "Nenhum lançamento ainda
                  / Comece registrando o que entrou ou o que saiu" -- e sem
                  periodo ela estava certa, porque a consulta varria a historia
                  inteira. Com periodo ela viraria a mentira mais facil desta
                  tela: quem navega para agosto e nao lançou nada em agosto leria
                  "ainda", como se a conta dele estivesse vazia, com trezentos
                  lançamentos em setembro a uma seta de distancia.

                  Por isso o titulo nomeia o periodo, e o caminho de volta para
                  o mes corrente aparece ANTES dos botoes de lançar sempre que
                  nao e nele que a pessoa esta.
                */
                <div className="text-center py-8 space-y-4">
                  <Receipt className="h-12 w-12 text-muted-foreground mx-auto" />
                  <div>
                    <h3 className="text-lg font-medium mb-2">
                      Nenhum lançamento em {rotuloDoPeriodo(periodo)}
                    </h3>
                    <p className="text-muted-foreground">
                      {ehPeriodoCorrente(periodo, hoje)
                        ? "Comece registrando o que entrou ou o que saiu."
                        : "Outros períodos podem ter lançamentos — use as setas acima."}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    {!ehPeriodoCorrente(periodo, hoje) && (
                      <Button
                        variant="secondary"
                        className="gap-2"
                        onClick={() => irPara(periodoCorrente(hoje))}
                      >
                        <CalendarRange className="h-4 w-4" />
                        Ver {rotuloDoPeriodo(periodoCorrente(hoje))}
                      </Button>
                    )}
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
                    <Button variant="outline" asChild className="gap-2">
                      <Link href={ROTA_DA_TRANSFERENCIA}>
                        <ArrowRightLeft className="h-4 w-4 text-info" />
                        Transferência
                      </Link>
                    </Button>
                  </div>
                </div>
              )}

              {/*
                O BOTAO QUE FALTAVA -- E QUE E O CORACAO DESTA ISSUE
                ---------------------------------------------------
                Com `.limit(50)` e nenhuma paginacao, o lançamento numero 51
                simplesmente nao existia para o usuario: sem "carregar mais",
                sem periodo para navegar, e sem nada na tela dizendo que a
                lista terminava ali.

                Fica FORA do ramo de `visiveis.length > 0` de proposito. O caso
                que importa e justamente o contrario: filtro "Transferências"
                aberto, zero linhas visiveis entre as 50 carregadas, e as
                transferências mais antigas na pagina seguinte. Se o botao
                morasse dentro do ramo da lista cheia, a unica tela que precisa
                dele seria a unica que nao o teria.
              */}
              {temMais && !atualizando && (
                <div className="mt-4 flex flex-col items-center gap-2">
                  <Button
                    variant="outline"
                    onClick={carregarMais}
                    disabled={carregandoMais}
                    className="gap-2"
                  >
                    {carregandoMais ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current" />
                        Carregando…
                      </>
                    ) : (
                      <>
                        <Plus className="h-4 w-4" />
                        Carregar mais
                      </>
                    )}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {transactions.length} lançamentos carregados de{" "}
                    {rotuloDoPeriodo(periodo)}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

/**
 * UMA LINHA QUE NAO E MINHA: A MINHA PARTE DO QUE OUTRA PESSOA PAGOU (HMO-215)
 * ---------------------------------------------------------------------------
 * Componente proprio, e nao um ramo dentro da linha normal, porque o que ela
 * NAO tem e o que importa:
 *
 * - SEM BOTAO DE EXCLUIR. Apagar esta linha mexeria na despesa de quem pagou, e
 *   o id dela e de `group_expense_splits` -- mandar isso para
 *   `/api/personal-finance/transactions/[id]` volta 404, que para quem clicou se
 *   le como "o app nao conseguiu apagar". A conversa sobre o rateio acontece na
 *   tela do grupo, e e para la que a linha leva.
 * - SEM BOTAO DE EDITAR, pela mesma razao.
 * - SEM CONTA. O dinheiro saiu da conta de outra pessoa; nao ha destino meu a
 *   mostrar, e inventar um seria afirmar que a despesa passou por uma conta
 *   minha.
 *
 * O que ela TEM, e que a linha comum nao precisa: o grupo, o valor CHEIO da
 * despesa ao lado da minha parte (sem ele, "R$ 200,00" num jantar de R$ 600
 * nao se reconhece) e o aviso de rateio ainda nao aprovado.
 */
function LinhaDaParteDeGrupo({
  parte,
  nomeDoGrupo,
}: {
  parte: LancamentoDeTerceiro;
  nomeDoGrupo: Record<string, string>;
}) {
  const grupo = nomeDoGrupo[parte.groupId];

  return (
    <Link
      href={`/dashboard/expense-groups/${parte.groupId}`}
      className="flex items-center justify-between gap-3 p-3 border rounded-lg border-dashed transition-colors hover:bg-muted/50"
    >
      {/*
        `min-w-0` nos dois niveis e `truncate` na descricao, como na linha comum:
        sem eles o minimo de min-content de um item flex estoura a largura do
        celular e a pagina inteira ganha scroll horizontal (HMO-185).
      */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white"
          style={{ backgroundColor: parte.categoria?.color_hex ?? undefined }}
        >
          <Users className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="font-medium truncate">{parte.description}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {/*
              "Minha parte" e nao "Despesa": o valor ao lado NAO e o que foi
              gasto, e a fracao que cabe a mim de uma despesa maior. O selo
              generico "Despesa" faria a pessoa ler R$ 200,00 como o preco do
              jantar.
            */}
            <Badge variant="outline" className="shrink-0">
              Minha parte
            </Badge>
            {parte.categoria?.name && <span>{parte.categoria.name}</span>}
            <span>•</span>
            <span>
              {new Date(parte.transactionDate).toLocaleDateString("pt-BR")}
            </span>
            <span>•</span>
            <Badge variant="outline" className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {/*
                O nome do grupo quando ele veio, e "Grupo" quando a chamada de
                grupos falhou sem derrubar a lista. Ali "Grupo" e menos
                informacao, nao informacao errada -- a mesma regra do selo da
                linha comum.
              */}
              {grupo || "Grupo"}
            </Badge>
            {/*
              Rateio ainda nao aprovado. A view do 033 ja descarta `rejected` e
              `expired`; `pending` entra porque o dinheiro e devido de todo
              jeito -- mas sem este selo a linha afirmaria um acerto fechado que
              ainda esta em aberto.
            */}
            {parte.splitStatus === "pending" && (
              <>
                <span>•</span>
                <Badge variant="outline" className="shrink-0">
                  a aprovar
                </Badge>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="font-semibold text-destructive">
          {formatCurrency(Math.abs(parte.amount))}
        </p>
        {/*
          O valor cheio embaixo da parte. Sem ele "R$ 200,00 · Hotel em Paraty"
          se le como o preco do hotel, e a pessoa nao tem como conferir a divisao
          sem abrir a tela do grupo.
        */}
        <p className="text-xs text-muted-foreground">
          de {formatCurrency(Math.abs(parte.totalDaDespesa))}
        </p>
      </div>
    </Link>
  );
}
