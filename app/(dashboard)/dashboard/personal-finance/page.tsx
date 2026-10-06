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
import { toast } from "sonner";
import { classificarMovimentacao } from "@/lib/movimentacoes";
import {
  destinoDoLancamento,
  indiceDeContraparte,
  type ContaDoLancamento,
} from "@/lib/destino-do-lancamento";
import {
  linhasDaLista,
  nomesDosPagadores,
  notaDasPartesDeTerceiros,
  partesDeTerceirosNaLista,
  resumoComPartesDeGrupo,
  type DespesaDeGrupoLida,
  type LancamentoDeTerceiro,
  type ParteDeGrupoBruta,
  type PerfilDePagador,
} from "@/lib/parte-de-grupo-na-lista";
import {
  devedorNaLinha,
  notaDoCreditoAReceber,
  type CreditoAReceber,
} from "@/lib/credito-de-grupo";
import { LinhaDaParteDeGrupo } from "@/components/movimentacoes/LinhaDaParteDeGrupo";
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
import { PARAM_DE_ORIGEM, comOrigem } from "@/lib/retorno-do-lancamento";
import { useOrigemDaTela } from "@/lib/hooks/useOrigemDaTela";
import { frasePreservadas, type Alcance } from "@/lib/alcance-na-tela";
import { DialogoDeAlcance } from "@/components/series/DialogoDeAlcance";
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
  type ContaEmCache,
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
  HandCoins,
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
  /**
   * "parcela N de M" (HMO-211, migration 035).
   *
   * E ESTA INTERFACE E A SEGUNDA `FinancialTransaction` DO REPOSITORIO: a outra
   * esta em `types/financial.ts`, exportada, e esta aqui a sombreia nesta
   * pagina. As duas descrevem a MESMA tabela, e as duas estavam sem as colunas
   * da 035 -- que ja estava em producao.
   *
   * O modo de falha nao e o `tsc` reclamando: e o contrario. A consulta desta
   * lista usa `select("*")`, entao as colunas CHEGAM em runtime e simplesmente
   * nao existem para o compilador. Toda leitura delas desaparece sem erro, e o
   * botao de apagar parcela trataria toda parcela como compra avulsa --
   * apagando uma linha de dez. Foi o `tsc` reprovando o botao que mostrou a
   * falta, primeiro na interface compartilhada e depois nesta.
   *
   * Nao unifiquei as duas neste PR: a interface compartilhada tem campos que
   * esta pagina nao usa e vice-versa, e fundi-las mexeria em telas que a HMO-228
   * nao toca. Mas quem for acrescentar a proxima coluna precisa saber que ela
   * tem de ser escrita em DOIS lugares, senao ela funciona em metade do app.
   */
  installment_number?: number | null;
  installment_total?: number | null;
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
  /**
   * Esta tela, com os filtros que estao na URL, para os modais de lancamento
   * saberem para onde voltar (HMO-249).
   *
   * Sem isto o modal cairia no fallback -- que e esta MESMA rota, mas sem a
   * query: quem estava filtrando por categoria perderia o filtro ao salvar, e
   * concluiria que o lancamento foi para o lugar errado.
   */
  const origem = useOrigemDaTela();

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
  /**
   * O QUE OS OUTROS ME DEVEM NOS GRUPOS, NO PERIODO DA TELA (HMO-245 F10).
   *
   * `null` enquanto nao respondeu e tambem quando a chamada falhou, pelo mesmo
   * motivo de `resumoDeGrupos`: um R$ 0,00 aqui e indistinguivel de "ninguem te
   * deve nada" e mandaria a pessoa concluir que nao tem nada a receber quando
   * so a consulta caiu.
   *
   * Estado SEPARADO de `resumoDeGrupos` de proposito -- as duas respostas vem
   * de fontes diferentes e DIVERGEM: aquela le `group_member_balances` (so o
   * realizado, acumulado, sem mes) e esta fecha o mes com `fecharMes` (previsto
   * junto com realizado). Juntar as duas num estado so e convidar a tela a
   * exibir uma com o rotulo da outra.
   */
  const [creditoDeGrupo, setCreditoDeGrupo] = useState<CreditoAReceber | null>(
    null
  );
  /**
   * A consulta do credito falhou neste periodo.
   *
   * Mesma razao de `partesFalharam`, com o sinal invertido: aqui a falha deixa
   * o valor a receber INVISIVEL, e invisivel se le como inexistente. A bandeira
   * e o que separa "ninguem te deve nada" de "nao foi possivel conferir".
   */
  const [creditoFalhou, setCreditoFalhou] = useState(false);
  /**
   * A parcela cuja exclusao esta esperando a pergunta do alcance (HMO-228).
   *
   * A linha vem da lista desta tela, que e `FinancialTransaction[]` -- entao e
   * esse o tipo aqui tambem. Era `any` porque "o resto da lista tambem e", o
   * que deixou de valer: `installment_number` e `transaction_type`, os dois
   * campos que o fluxo de exclusao le, estao declarados na interface.
   */
  const [parcelaParaApagar, setParcelaParaApagar] =
    useState<FinancialTransaction | null>(null);
  const [apagandoParcela, setApagandoParcela] = useState(false);

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
  //
  // E A PARCELA NAO SAI POR AQUI (HMO-228)
  // --------------------------------------
  // Uma parcela de cartao e uma linha de uma SERIE de N linhas amarradas por
  // `installment_parent_id`. Apagar a parcela 3 de 10 por esta rota apaga uma
  // linha e deixa nove -- e a fatura de cada mes restante continua fechando num
  // valor plausivel e errado, sem erro em lugar nenhum. A unica forma de
  // descobrir seria reconferir dez faturas a mao.
  //
  // Entao a linha que tem `installment_number` abre a pergunta do alcance
  // (`parcelaParaApagar`) e sai por `/api/financial-installments/serie/{id}`,
  // que sabe o que e uma serie. Ver `pedirExclusao` abaixo.
  const deleteTransaction = async (transaction: FinancialTransaction) => {
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

  /**
   * Abre a pergunta do alcance quando a linha e uma parcela; senao segue o
   * caminho de sempre.
   *
   * `installment_number` e a marca de que a linha pertence a uma serie: ela e
   * NULL em toda compra avulsa (035), e e NOT NULL junto com
   * `installment_total` por CHECK -- entao nao existe o estado "e parcela mas
   * nao se sabe de quantas".
   */
  const pedirExclusao = (transaction: FinancialTransaction) => {
    if (transaction?.installment_number) {
      setParcelaParaApagar(transaction);
      return;
    }
    void deleteTransaction(transaction);
  };

  /** Apaga a serie no alcance escolhido, pela rota que conhece a serie. */
  const apagarParcela = async (
    transaction: FinancialTransaction,
    alcance: Alcance
  ) => {
    setApagandoParcela(true);
    try {
      const resposta = await fetch(
        `/api/financial-installments/serie/${transaction.id}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          // O alcance no CORPO: um laco de ids aqui ficaria aplicado pela
          // metade quando a conexao cai, e meia serie apagada nao tem como ser
          // descoberta depois.
          body: JSON.stringify({ alcance }),
        }
      );
      const dados = await resposta.json().catch(() => ({}));

      if (!resposta.ok) {
        toast.error(
          dados.error || `A exclusão foi recusada (HTTP ${resposta.status}).`
        );
        return;
      }

      // A CONTAGEM DO QUE FICOU DE FORA, NA TELA.
      // Dois numeros: o que ficou por escolha e o que ficou por fatura paga. O
      // segundo e uma recusa que a pessoa nao pediu, e e ele que explica um
      // total da compra diferente do esperado.
      const aviso = frasePreservadas({
        preservadas: Number(dados.preservadas ?? 0),
        porFaturaPaga: Number(dados.preservadas_por_fatura_paga ?? 0),
      });
      toast.success(
        aviso ? `${dados.message} ${aviso}` : (dados.message ?? "Parcela apagada")
      );

      setParcelaParaApagar(null);
      recarregar();
    } catch (error) {
      console.error("Erro ao apagar a série de parcelas:", error);
      toast.error("Erro ao apagar a parcela");
    } finally {
      setApagandoParcela(false);
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
   * O CREDITO DE GRUPO DO PERIODO, COMO A RECEBER (HMO-245 F10).
   *
   * Try/catch PROPRIO, como `carregarGrupos`: qualquer falha aqui -- grupo
   * nenhum, rota fora do ar, 500 -- cairia no catch que trata FALTA DE REDE se
   * ficasse dentro do `try` grande do `loadData`, e a tela reagiria repondo o
   * catalogo do aparelho e avisando "sem conexão" com a lista ja carregada. Um
   * recurso secundario nao pode apagar o principal.
   *
   * A BANDEIRA SOBE NO `catch` E NO `!ok`, E DESCE NO SUCESSO. O `!resposta.ok`
   * nao pode sair calado como em `carregarGrupos`: lá o silencio esconde um
   * cartão, aqui esconderia DINHEIRO A RECEBER, e a tela sem o valor se le como
   * "ninguem te deve nada". Ver `creditoFalhou`.
   *
   * O periodo vai na querystring e a rota o repassa a `lerPeriodo`, o mesmo
   * `de`/`ate` dos tres cartoes -- sem isso o credito seria de um recorte de
   * tempo diferente do resto da tela, que e o defeito de rotulo que o painel
   * desta casa ja teve.
   */
  const carregarCreditoDeGrupo = async () => {
    try {
      const resposta = await fetch(
        `/api/expense-groups/my-credit?${periodoParaQuery(periodo)}`
      );

      if (!resposta.ok) {
        setCreditoFalhou(true);
        return;
      }

      const dados = await resposta.json();
      if (!dados?.credito) {
        setCreditoFalhou(true);
        return;
      }

      setCreditoDeGrupo(dados.credito);
      setCreditoFalhou(false);
    } catch (erro) {
      console.error("Erro ao carregar o credito de grupo:", erro);
      setCreditoFalhou(true);
    }
  };

  /**
   * O NOME DE QUEM PAGOU, PARA A LINHA DA PARTE DE GRUPO (HMO-274)
   *
   * Terceira consulta, e CONSULTA e nao embed. Um
   * `pagador:profiles(full_name)` pendurado na consulta das despesas seria mais
   * curto. Hoje ele funcionaria: `financial_transactions` tem UMA FK para
   * `profiles` (`scripts/check-embed-ambiguo.mjs` confirma). O problema e o
   * amanha -- a segunda FK para `profiles` faz o PostgREST responder PGRST201
   * ("could not embed because more than one relationship was found") e derruba
   * uma consulta que ninguem tocou, com o apagao aparecendo longe da migration
   * que o causou. Nomear a FK no embed resolveria, ao custo de carregar um nome
   * de constraint aqui dentro; a consulta separada nao tem nem um nem outro.
   *
   * O ERRO AQUI NAO PROPAGA, DE PROPOSITO
   * -------------------------------------
   * Esta funcao devolve um mapa VAZIO quando a leitura falha, em vez de lancar.
   * Lancar cairia no catch de `carregarPartesDeGrupo`, que levanta
   * `partesFalharam` e substitui a lista de partes por um aviso -- ou seja, o
   * nome faltando apagaria as linhas inteiras. Mapa vazio deixa cada linha no
   * lugar com o rotulo de fallback, que e menos informacao e nao informacao
   * errada. Ver `pagadorNaLinha` em lib/parte-de-grupo-na-lista.ts.
   *
   * O PERFIL PODE SIMPLESMENTE NAO VIR, SEM ERRO
   * --------------------------------------------
   * As policies de SELECT de `profiles` sao `id = auth.uid()`, `is_public =
   * TRUE` (002) e "conexao aceita" (010). NENHUMA delas olha `group_members`:
   * dividir a conta com alguem nao me da o perfil dele. Para o membro de perfil
   * fechado que nao e minha conexao a linha nao vem, e o PostgREST nao reclama
   * -- devolve menos linhas. E esse o caminho do fallback, e ele e normal.
   */
  const nomesDeQuemPagou = async (
    despesas: Map<string, DespesaDeGrupoLida>
  ): Promise<Map<string, string>> => {
    const pagadores = Array.from(
      new Set(
        Array.from(despesas.values())
          .map((d) => d.user_id)
          .filter(Boolean)
      )
    );

    // `.in()` com lista vazia devolve TUDO em algumas versoes do PostgREST (o
    // mesmo cuidado esta em app/api/expense-groups/my-balance/route.ts). Aqui
    // "tudo" seria todo perfil publico do banco para montar zero nomes.
    if (pagadores.length === 0) return new Map();

    const { data: perfis, error } = await supabase
      .from("profiles")
      .select("id, full_name, nickname")
      .in("id", pagadores);

    if (error) {
      console.error("Nao foi possivel ler o nome de quem pagou:", error);
      return new Map();
    }

    return nomesDosPagadores((perfis || []) as PerfilDePagador[]);
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

      // `user_id` entrou aqui na HMO-274: e quem PAGOU. A view do 033 nao tem
      // esse id -- ela expoe o booleano `paguei_eu` --, e esta linha de
      // `financial_transactions` e justamente a de quem desembolsou.
      const { data: despesas, error: erroDaDescricao } = await supabase
        .from("financial_transactions")
        .select(
          "id, user_id, description, amount, category:transaction_categories(*)"
        )
        .in("id", ids)
        .returns<DespesaDeGrupoLida[]>();

      if (erroDaDescricao) throw erroDaDescricao;

      const porId = new Map<string, DespesaDeGrupoLida>(
        (despesas || []).map((d) => [d.id, d])
      );

      const { linhas, semDescricao } = partesDeTerceirosNaLista(
        partes as ParteDeGrupoBruta[],
        porId,
        await nomesDeQuemPagou(porId)
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
      // `ContaEmCache` e nao `ContaDoLancamento`: estas contas existem so para
      // alimentar o catalogo offline, e `account_type` e obrigatorio la --
      // naquele outro tipo ele e opcional, o que nao vale para esta fonte
      // (`/api/financial-accounts` le a coluna, que e NOT NULL).
      let contasCarregadas: ContaEmCache[] = [];

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
      await carregarCreditoDeGrupo();

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
          contas: contasCarregadas.map((c) => ({
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
  //
  // A PARTE DE GRUPO ENTRA EM "Despesas" (HMO-275). Decisao do Helio em
  // 04/10/2026: o cartao significa O QUE ME CUSTOU -- inteiro quando eu paguei,
  // minha parte quando outro pagou. Antes desta issue a parte ficava
  // deliberadamente de fora dos tres cartoes, escrita embaixo do saldo.
  // `resumoComPartesDeGrupo` e quem soma, e e ele que RECALCULA o saldo: somar
  // em `despesas` e repassar o `saldo` de `resumoDoPeriodo` poria os tres
  // cartoes se contradizendo sob a legenda "Receitas - Despesas". Ver o
  // cabecalho daquela funcao.
  const calculateBalance = () => {
    const resumo = resumoComPartesDeGrupo(transactions, partesDeGrupo);

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

  // A LISTA INTEIRA, SEM RECORTE DE TIPO (HMO-246)
  // ----------------------------------------------
  // "Finanças pessoais deve ser uma grande lista de transações e lançamentos
  // indiferente do que for." Era aqui que o recorte entrava: a tela tinha
  // quatro abas (Lançamentos / Receitas / Despesas / Transferências) e
  // `linhasDaLista` recebia a escolhida.
  //
  // As abas saíram, e o motivo não é só o pedido da issue -- elas filtravam
  // SÓ a lista. Os três cartões acima continuavam somando o mês inteiro, então
  // abrir "Transferências" dava uma lista de transferências com "Despesas
  // R$ 4.200" logo em cima dela. Quem quer o recorte de um tipo agora tem uma
  // tela própria, e lá os totais são DAQUELE tipo -- com o previsto dentro.
  //
  // `"todos"` fica escrito aqui, e não some junto com a barra: `linhasDaLista`
  // é compartilhada e o parâmetro continua sendo o que decide o que entra.
  // Quem lê esta linha vê qual é a resposta desta tela.
  //
  // DUAS FONTES, UMA LISTA (HMO-215). `linhasDaLista` junta as minhas linhas com
  // a minha parte das despesas de grupo que outra pessoa pagou, em ordem de
  // data -- coladas sem reordenar, as partes de setembro cairiam no fim, abaixo
  // das minhas de marco.
  const visiveis = linhasDaLista(transactions, partesDeGrupo, "todos");

  // O elo entre as duas pernas de cada transferencia, montado uma vez por
  // render em vez de por linha: `destinoDoLancamento` precisa achar a
  // contraparte, e uma varredura do array dentro do `.map()` seria O(n²) numa
  // lista que vai a 50 linhas por pagina e nao tem teto de paginas.
  const contrapartes = indiceDeContraparte(transactions);

  // Quanto as partes de grupo somam, para a tela poder dizer que elas estao na
  // lista e FORA dos tres cartoes. Ver o cabecalho de
  // lib/parte-de-grupo-na-lista.ts.
  const notaDasPartes = notaDasPartesDeTerceiros(partesDeGrupo);

  // O QUE OS OUTROS ME DEVEM, PARA O CARTAO DE RECEITAS DIZER QUE ESTA FORA
  // DELE (HMO-245 F10).
  //
  // `null` quando nao ha credito E quando a consulta nao respondeu -- os dois
  // apagam a frase, e e `creditoFalhou` quem distingue os dois na tela. A conta
  // de `quantos`/`grupos` vive em `notaDoCreditoAReceber`, e nao num `.length`
  // no meio do JSX: a frase concorda em numero com eles, e concordancia
  // calculada no JSX e o que divergiu do numero no cartao de Despesas antes da
  // HMO-275.
  const notaDoCredito = creditoDeGrupo
    ? notaDoCreditoAReceber(creditoDeGrupo)
    : null;

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
    // `"todos"` pelo mesmo motivo de `linhasDaLista` acima: a tela nao tem mais
    // recorte de tipo (HMO-246). `descreverLista` continua aceitando o filtro
    // porque e ele quem decide a FRASE -- e as tres telas novas tambem contam
    // quantas linhas mostram.
    filtro: "todos",
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
          {/*
            A FRASE DIZ O QUE ESTA TELA É, e desde a HMO-246 ela também diz o
            que ela NÃO é. Esta é a lista inteira, "indiferente do que for"; o
            recorte de um tipo -- com Previsto e Realizado -- tem tela própria,
            e os links estão aqui porque era nas abas que a pessoa procurava
            aquilo. Um recorte que muda de lugar sem deixar rastro se lê como
            feature removida.
          */}
          <p className="text-muted-foreground">
            Seus lançamentos e o resumo de{" "}
            <span className="font-medium text-foreground">
              {rotuloDoPeriodo(periodo)}
            </span>
            . Todos os tipos, numa lista só — receita, despesa e transferência
            se lançam em telas próprias.
          </p>
          <p className="text-sm text-muted-foreground">
            O total de um tipo só, com o previsto dentro, está em{" "}
            <Link
              href="/dashboard/receitas"
              className="underline hover:text-foreground"
            >
              Receitas
            </Link>
            ,{" "}
            <Link
              href="/dashboard/despesas"
              className="underline hover:text-foreground"
            >
              Despesas
            </Link>{" "}
            e{" "}
            <Link
              href="/dashboard/transferencias"
              className="underline hover:text-foreground"
            >
              Transferências
            </Link>
            .
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
                <Link href={comOrigem("/dashboard/movimentacoes/receita", origem)}>
                  <TrendingUp className="h-4 w-4 text-success" />
                  Nova Receita
                </Link>
              </Button>
              <Button asChild className="gap-2">
                <Link href={comOrigem("/dashboard/movimentacoes/despesa", origem)}>
                  <TrendingDown className="h-4 w-4" />
                  Nova Despesa
                </Link>
              </Button>
              {/* A terceira porta (HMO-164). Ate aqui transferencia era uma
                  opcao DENTRO do formulario de lancamento, e por isso gravava
                  uma linha so, com categoria de despesa. */}
              <Button variant="outline" asChild className="gap-2">
                <Link href={comOrigem(ROTA_DA_TRANSFERENCIA, origem)}>
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
            {/*
              O QUE OS OUTROS ME DEVEM ESTÁ FORA DESTE NÚMERO (HMO-245 F10)
              ------------------------------------------------------------
              Esta frase é o OPOSTO da que a HMO-275 pôs no cartão de Despesas:
              lá ela ABRE o total ("inclui X"); aqui ela diz que existe um
              valor FORA dele, e que estar fora é a decisão, não um esquecimento.

              O crédito sai de `fecharMes`, que soma PREVISTO JUNTO COM
              REALIZADO por desenho -- é o pedido da HMO-245. Então os R$ 106,60
              do exemplo são crédito sobre uma conta de internet que ninguém
              pagou ainda. Somá-los aqui publicaria receita inexistente, e o
              saldo continuaria fechando: é a família de defeito do "a vencer"
              que este app já pagou uma vez. Mesma régua da HMO-265 -- conta
              quando a fatura é paga, não na compra.

              O "a receber" e o "previsto" são os dois rótulos que impedem a
              leitura errada: sem eles, um valor em verde ao lado de "Receitas"
              se lê como dinheiro que entrou.
            */}
            {notaDoCredito && (
              <p className="text-xs text-muted-foreground">
                + {formatCurrency(notaDoCredito.total)} a receber de{" "}
                {notaDoCredito.quantos === 1
                  ? "1 pessoa"
                  : `${notaDoCredito.quantos} pessoas`}{" "}
                em{" "}
                {notaDoCredito.grupos === 1
                  ? "1 grupo"
                  : `${notaDoCredito.grupos} grupos`}{" "}
                — previsto, fora deste total
              </p>
            )}
            {/*
              O erro e o vazio são o MESMO estado para quem olha: nenhum valor
              a receber escrito na tela. As leituras são opostas -- "ninguém te
              deve nada" e "não foi possível conferir" --, e sem esta linha a
              tela escolheria sempre a primeira.
            */}
            {creditoFalhou && (
              <p className="text-xs text-warning">
                Não foi possível conferir o que os grupos têm a te pagar neste
                período.
              </p>
            )}
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
            {/*
              A MINHA PARTE DO QUE OUTROS PAGARAM, DENTRO DESTE NÚMERO (HMO-275)
              -----------------------------------------------------------------
              Até a HMO-275 esta frase ficava embaixo do cartão de Saldo e
              terminava ressalvando que a parte estava na lista e FORA do saldo:
              ela aparecia na lista (pedido da HMO-215) e de propósito não
              entrava em cartão nenhum. (A ressalva está parafraseada de
              propósito -- a string exata não vive mais neste arquivo, e um grep
              por ela tem que dar zero.)
              A decisão do Hélio em 04/10/2026 fechou o critério -- o cartão
              significa O QUE ME CUSTOU, inteiro quando eu paguei e minha parte
              quando outro pagou --, então a parte entrou aqui e a frase mudou de
              lugar e de função: ela não avisa mais de um valor omitido, ela ABRE
              este total.

              Ela não é enfeite. Sem ela, quem somasse à mão as linhas que
              reconhece como suas chegaria a um número MENOR que o do cartão, e
              não teria como descobrir de onde vem a diferença -- é o mesmo
              motivo da linha de transferências no cartão de Saldo.

              O "(sua parte)" é o que impede a leitura errada mais provável
              aqui: o valor escrito é a fração que me cabe, não o valor cheio da
              despesa de quem pagou.
            */}
            {notaDasPartes && (
              <p className="text-xs text-muted-foreground">
                inclui {formatCurrency(notaDasPartes.total)} de{" "}
                {notaDasPartes.quantas === 1
                  ? "1 despesa de grupo que outra pessoa pagou"
                  : `${notaDasPartes.quantas} despesas de grupo que outras pessoas pagaram`}{" "}
                (sua parte)
              </p>
            )}
            {/*
              O erro e o vazio são o MESMO array, e têm leituras opostas: um diz
              "você não deve nada em grupo este mês" e o outro diz "este total
              está incompleto". Sem esta linha a tela escolheria sempre a
              primeira -- o "zero confiante" que esta tela já pagou duas vezes.

              E desde a HMO-275 o aviso subiu de gravidade, e por isso mudou de
              cartão: antes a falha deixava só a LISTA curta; agora ela deixa
              este NÚMERO baixo, e um gasto subestimado é o que faz a pessoa
              decidir gastar o que não tem.
            */}
            {partesFalharam && (
              <p className="text-xs text-warning">
                Sua parte das despesas de grupo não carregou: este total e a
                lista abaixo podem estar incompletos.
              </p>
            )}
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
              A minha parte do que outros pagaram está DENTRO de "Despesas"
              desde a HMO-275, e portanto dentro deste saldo. A frase que a
              detalhava (e o aviso de falha de carregamento) mora no cartão de
              Despesas, ao lado do número que ela abre.
            */}
          </CardContent>
        </Card>
      </div>

      {/*
        QUEM ME DEVE, POR GRUPO E POR PESSOA (HMO-245, fase 10)
        -------------------------------------------------------
        Até esta fase o lado da receita NÃO EXISTIA: zero ocorrências de crédito
        de grupo em qualquer cartão ou lista de receita. No mês da internet do
        C6 o Hélio tem R$ 106,60 a receber da Lais e da Bia, e nada na tela
        dele dizia isso.

        A RECEBER, E NÃO RECEBIDO -- A DECISÃO QUE ESTE BLOCO CARREGA
        O valor sai de `fecharMes`, que soma PREVISTO JUNTO COM REALIZADO por
        desenho (é o pedido da HMO-245: para dividir o mês, "já aconteceu" e
        "vence dia 15" saem do mesmo bolso dentro do mesmo mês). Logo o crédito
        pode ser inteiramente sobre conta que ninguém pagou -- e a Lais pode não
        pagar. Então ele é previsto, rotulado, e FORA do cartão de Receitas. A
        receita realizada do grupo é a quitação, e só ela (HMO-276 e a fase 12).

        Fora do grid de cima de propósito, como o cartão da HMO-175: um quarto
        cartão ali dentro herdaria a altura e a legenda dos vizinhos, e este
        bloco é uma LISTA de pessoas, não um número.

        O rótulo de período é o mesmo `notaDosTotais` dos três cartões, e ele
        está aqui porque o recorte de tempo é o mesmo `de`/`ate` -- um bloco de
        dinheiro sem eixo de tempo escrito mente no rótulo.

        Ele some quando não há crédito nenhum: "R$ 0,00 a receber de grupos" na
        tela de quem não participa de grupo nenhum é ruído que parece recurso
        quebrado. O caminho de FALHA não some -- ele está escrito no cartão de
        Receitas acima, ao lado do número que ficaria incompleto.
      */}
      {creditoDeGrupo && creditoDeGrupo.linhas.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="space-y-1">
              <CardTitle className="text-sm font-medium">
                A receber dos grupos
              </CardTitle>
              <CardDescription>
                Previsto: o que cabe a cada um nas despesas do período e ainda
                não foi quitado
              </CardDescription>
            </div>
            <HandCoins className="h-4 w-4 shrink-0" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-2xl font-bold text-success">
                {formatCurrency(creditoDeGrupo.total)}
              </div>
              <p className="text-xs text-muted-foreground">
                A receber · {notaDosTotais}
              </p>
              {/*
                O total é a SOMA DAS LINHAS abaixo, e não o meu saldo no
                fechamento. Os dois concordam em todo mês que fecha, e é por
                isso que escolher o errado seria barato e invisível: o critério
                é o que a HMO-275 fixou -- o número grande tem de bater com a
                soma das linhas que a pessoa consegue apontar na tela.

                Quando sobra crédito meu sem devedor nomeado (o centavo de
                tolerância de `simplifySettlements` descarta saldo de até R$
                0,01), a diferença aparece escrita em vez de desaparecer.
              */}
              {creditoDeGrupo.sem_devedor > 0 && (
                <p className="text-xs text-muted-foreground">
                  mais {formatCurrency(creditoDeGrupo.sem_devedor)} sem devedor
                  identificado no acerto
                </p>
              )}
            </div>

            {/* `grid-cols-1` explícito: sem ele o trilho automático usa o
                conteúdo mínimo como piso e a linha estoura a largura do
                celular (HMO-168). */}
            <div className="grid grid-cols-1 gap-2">
              {creditoDeGrupo.linhas.map((linha) => {
                // O nome pode simplesmente não vir, sem erro: nenhuma policy de
                // SELECT de `profiles` olha `group_members`, então dividir a
                // conta com alguém não dá acesso ao perfil dele. O rótulo de
                // fallback mora em `devedorNaLinha`, com teste -- uma linha de
                // crédito sem menção a outra pessoa se lê como receita própria.
                const devedor = devedorNaLinha(linha);

                return (
                  <Link
                    key={`${linha.group_id} ${linha.devedor_user_id}`}
                    href={`/dashboard/expense-groups/${linha.group_id}`}
                    className="flex items-center justify-between gap-3 p-3 border rounded-lg transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <p
                        className={`font-medium truncate ${
                          devedor.temNome ? "" : "text-muted-foreground"
                        }`}
                      >
                        {devedor.texto}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {linha.grupo}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold text-success">
                        {formatCurrency(linha.valor)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        te deve
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              Entra em Receitas quando a quitação for registrada, na tela do
              grupo.
            </p>
          </CardContent>
        </Card>
      )}

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
        A BARRA DE ABAS SAIU (HMO-246)
        ------------------------------
        Aqui havia quatro abas -- Lançamentos / Receitas / Despesas /
        Transferências -- e elas filtravam a lista por tipo. Duas coisas as
        tiraram, e a segunda é a que custava:

          1. "Finanças pessoais deve ser uma grande lista de transações e
             lançamentos indiferente do que for." O recorte por tipo agora é
             tela própria: /dashboard/receitas, /dashboard/despesas e
             /dashboard/transferencias.

          2. ELAS FILTRAVAM SÓ A LISTA. Os três cartões acima nunca souberam do
             filtro: somavam o período inteiro, sempre. Abrir "Transferências"
             dava uma lista com três linhas de transferência e, parado logo
             acima dela, "Despesas R$ 4.200" -- um número certo que, naquela
             posição, se lê como o total da lista embaixo. As telas novas não
             têm esse problema por construção: os totais de lá são do tipo da
             tela, e trazem o PREVISTO junto, que é o que as abas nunca tiveram.

        O que fica para quem procurava um tipo sem sair daqui: a lista continua
        rotulando cada linha (tipo, conta, categoria, grupo), que é o que a
        HMO-162 e a HMO-215 puseram nela.
      */}
      <div className="space-y-4">
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
                                  query: {
                                    id: transaction.id,
                                    // HMO-249: fechar a edicao volta para ESTA
                                    // lista, com o filtro e o periodo que ela
                                    // tem agora -- nao para a lista zerada.
                                    [PARAM_DE_ORIGEM]: origem,
                                  },
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
                            onClick={() => pedirExclusao(transaction)}
                            className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                            title={
                              transaction.installment_number
                                ? "Apagar parcela (só esta, desta em diante, ou todas)"
                                : "Excluir transação"
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                    );
                  })}
                </div>
              ) : (
                /*
                  Aqui havia um TERCEIRO ramo, para "vazio por causa do filtro":
                  `carregados > 0` com `visiveis` em zero, que acontecia quando
                  a aba "Transferências" estava aberta num mês sem nenhuma. Ele
                  saiu com as abas (HMO-246), e não por economia -- ele ficou
                  INALCANÇÁVEL: com `filtro = "todos"`, `linhasDaLista` não
                  descarta linha nenhuma, então `visiveis.length` é exatamente
                  `carregados` e os dois só são zero juntos. Um ramo morto que
                  parece vivo é pior que ramo nenhum: ele convida a próxima
                  pessoa a mantê-lo funcionando.

                  O recorte por tipo que aquele ramo explicava agora tem tela
                  própria, e lá a frase de vazio nomeia o tipo E o período.
                */
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
                      <Link href={comOrigem("/dashboard/movimentacoes/receita", origem)}>
                        <TrendingUp className="h-4 w-4 text-success" />
                        Nova Receita
                      </Link>
                    </Button>
                    <Button asChild className="gap-2">
                      <Link href={comOrigem("/dashboard/movimentacoes/despesa", origem)}>
                        <TrendingDown className="h-4 w-4" />
                        Nova Despesa
                      </Link>
                    </Button>
                    <Button variant="outline" asChild className="gap-2">
                      <Link href={comOrigem(ROTA_DA_TRANSFERENCIA, origem)}>
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

                Fica FORA do ramo de `visiveis.length > 0`, e isso CONTINUA
                valendo depois de as abas saírem (HMO-246). O caso que importa
                mudou de forma mas não desapareceu: um período em que as 50
                primeiras linhas são todas de grupo e descartadas por
                `partesDeTerceirosNaLista` abre a lista vazia com mais páginas
                atrás. Se o botão morasse dentro do ramo da lista cheia, a única
                tela que precisa dele seria a única que não o teria.
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
      </div>

      {/* A PERGUNTA DO ALCANCE NA EXCLUSAO DE PARCELA (HMO-228).
          O mesmo componente de Contas a Pagar e da tela do cartao. A parcela e
          apagada AQUI -- e era aqui que nao se perguntava nada. */}
      {parcelaParaApagar && (
        <DialogoDeAlcance
          aberto
          aoFechar={() => setParcelaParaApagar(null)}
          tipo="parcela"
          acao="apagar"
          ancora={`parcela ${parcelaParaApagar.installment_number}`}
          totalDeParcelas={parcelaParaApagar.installment_total}
          salvando={apagandoParcela}
          aoConfirmar={(escolhido) =>
            apagarParcela(parcelaParaApagar, escolhido)
          }
        />
      )}
    </div>
  );
}
