"use client";

// -----------------------------------------------------------------------------
// A TELA INICIAL MOSTRAVA A CARTEIRA DE OUTRA PESSOA
// -----------------------------------------------------------------------------
// Ate a HMO-124 este arquivo montava `mockSummary` e `mockPortfolio` em cima de
// um `// TODO: Implementar chamadas para API` e renderizava tudo como se fosse
// real: R$ 55.000 de carteira, R$ 1.200 de dividendos, 100 acoes da PETR4 e um
// grafico de performance com meses de 2024 escritos no codigo. Era a PRIMEIRA
// tela depois do login -- toda pessoa que entrasse no app via o patrimonio de
// ninguem, com dois digitos de rentabilidade, e nao havia nada na tela dizendo
// que aquilo era exemplo.
//
// O conserto nao e "ligar as APIs do portfolio": elas leem `transactions`,
// `dividends` e `assets`, tabelas de um produto de investimentos que nunca
// existiu neste banco. O conserto e a tela inicial mostrar o dinheiro que o
// app de fato administra -- contas, o mes corrente, o que vence e as metas --
// usando as rotas que as fases 1 a 5 construiram.
//
// Nenhum numero aqui e calculado nesta tela: todos vem das mesmas rotas que
// alimentam as telas de detalhe. Recalcular localmente criaria uma segunda
// versao da mesma conta, e as duas telas passariam a discordar.
//
// -----------------------------------------------------------------------------
// O PAINEL PASSOU A TER UM PERIODO (HMO-173)
// -----------------------------------------------------------------------------
// Ate aqui a tela nao tinha eixo de tempo: cada rota decidia sozinha de que mes
// estava falando, e o mes "corrente" era calculado com
// `new Date().toISOString()`, que e UTC. Em America/Sao_Paulo, das 21:00 as
// 23:59 do ultimo dia do mes esse valor ja era o mes SEGUINTE -- e como o
// resumo de contas previstas chega com varios meses, o `find` ACHAVA outubro e
// o tile "a vencer neste mes" mostrava as contas de outubro no dia 30 de
// setembro. Agora existe um `periodo` so, ele nasce de `today()` (fuso de Sao
// Paulo) e desce para todo bloco.
//
// A REGRA QUE VALE PARA CADA BLOCO
// ---------------------------------
// Ou ele honra o periodo, ou ele DIZ na tela que nao tem eixo de tempo. Nao ha
// terceira opcao, e a razao e especifica: `financial_accounts.current_balance`
// e o saldo de HOJE, nao existe versao dele para julho. Navegar para julho e
// continuar exibindo o mesmo numero debaixo do rotulo "julho" seria uma
// afirmacao falsa sobre o dinheiro do usuario -- do tipo que nao da erro, nao
// fica vazia e nao levanta suspeita.
//
// Por isso:
//   * resumo de entrada/saida e contas previstas -> passam o periodo adiante
//   * saldo das contas, em periodo que ja terminou -> vem de `net_worth_history`
//     (patrimonio no fim daquele mes); quando nao da, o numero de hoje aparece
//     com o rotulo "hoje", explicitamente FORA do periodo
//   * custo fixo mensal -> e uma definicao do presente, rotulado como tal
//   * "quanto posso gastar" e metas -> falam do mes corrente por definicao;
//     fora dele, somem e explicam por que sumiram
// -----------------------------------------------------------------------------

import { ReactNode, Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Wallet,
  TrendingUp,
  TrendingDown,
  CalendarClock,
  AlertTriangle,
  Target,
  Plus,
  FileUp,
  Users,
  ArrowRight,
  Coins,
  CreditCard,
  Settings,
} from "lucide-react";
import {
  agruparEmLinhas,
  layoutPadrao,
  normalizarLayout,
  secoesVisiveis,
} from "@/lib/dashboard-layout";
import { today } from "@/lib/recurrence";
import {
  contemHoje,
  lerPeriodo,
  periodoParaQuery,
  rotuloDoPeriodo,
  rotuloDoSaldo,
  somarPrevistas,
  terminaNoPassado,
  type Periodo,
} from "@/lib/periodo-do-painel";
import { SeletorDePeriodo } from "@/components/dashboard/SeletorDePeriodo";
import { PrevistoXRealizado } from "@/components/dashboard/PrevistoXRealizado";
import {
  somarMesesPrevistos,
  type PrevistoDoPeriodo,
} from "@/lib/previsto-x-realizado";

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor);

// 'AAAA-MM-DD' -> 'DD/MM'. Fatiando a string, sem passar por Date: um
// `new Date('2026-09-30')` nasce em UTC e, no fuso de Sao Paulo, imprimiria 29.
const diaEMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

interface Conta {
  id: string;
  name: string;
  account_type: string;
  current_balance: number | string;
}

interface ResumoFluxo {
  total_income: number;
  total_expense: number;
  net: number;
}

interface ResumoMesPrevisto {
  month: string;
  total_pending: number;
  total_overdue: number;
  count_pending: number;
  count_overdue: number;
  fixed_monthly_cost: number;
}

interface PossoGastar {
  ate: string;
  diasRestantes: number;
  disponivel: number;
  receitasPrevistas: number;
  compromissos: number;
  compromissosVencidos: number;
  dividaDeCartao: number;
  reservaDeMetas: number;
  livre: number;
  porDia: number;
  cartoes: { id: string; name: string; divida: number }[];
  metas: {
    id: string;
    title: string;
    alvoMensal: number;
    aportado: number;
    reserva: number;
    derivado: boolean;
  }[];
}

interface Meta {
  id: string;
  title: string;
  target_amount: number | string;
  saved: number | string;
  progress_ratio: number | string;
  status: string;
}

// `useSearchParams` obriga a um limite de Suspense: sem ele o `next build`
// para com "useSearchParams() should be wrapped in a suspense boundary". O
// componente de verdade e o `Painel` abaixo.
export default function DashboardPage() {
  return (
    <Suspense fallback={<Girando />}>
      <Painel />
    </Suspense>
  );
}

function Girando() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

function Painel() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // O fuso de Sao Paulo, uma vez so, para a tela inteira concordar sobre que
  // dia e hoje. `today()` e o mesmo helper que bills, budgets e goals usam.
  const hoje = today();

  // ---------------------------------------------------------------------
  // A FONTE DA VERDADE DO PERIODO E A URL
  // ---------------------------------------------------------------------
  // Nao e `useState`. Tres coisas quebram com estado local: recarregar a
  // pagina volta para o mes corrente, mandar o link para alguem manda o mes de
  // quem abrir, e o botao voltar do navegador sai do painel em vez de desfazer
  // a navegacao de periodo.
  //
  // `push` e nao `replace`: com replace, o historico nao ganha entrada e
  // voltar NAO anda entre periodos -- que e justamente um dos comportamentos
  // pedidos. Na primeira carga, sem parametro nenhum, nada e escrito na URL:
  // /dashboard continua sendo /dashboard, e voltar dali sai do painel como
  // sempre saiu.
  const periodo = lerPeriodo(
    searchParams.get("de"),
    searchParams.get("ate"),
    hoje
  );

  const irPara = useCallback(
    (novo: Periodo) => {
      router.push(`/dashboard?${periodoParaQuery(novo)}`);
    },
    [router]
  );

  const [carregando, setCarregando] = useState(true);
  // Trocando de periodo, com os numeros do periodo anterior ainda na tela.
  const [atualizando, setAtualizando] = useState(false);
  const [contas, setContas] = useState<Conta[]>([]);
  const [fluxo, setFluxo] = useState<ResumoFluxo | null>(null);
  const [previstas, setPrevistas] = useState<ResumoMesPrevisto | null>(null);
  // O previsto do periodo, separado em entradas e despesas (HMO-186). Vem da
  // MESMA resposta que `previstas` -- nao e uma segunda chamada: a direcao de
  // cada linha da agenda e um campo novo do resumo, e pedir de novo criaria
  // duas versoes do mesmo numero na mesma tela.
  const [previsto, setPrevisto] = useState<PrevistoDoPeriodo | null>(null);
  // A rota nao conseguiu dizer se cada linha da agenda entra ou sai. O bloco
  // escreve "indisponivel" em vez de mostrar tudo como despesa -- que e o que
  // um `?? "expense"` calado faria, com o resultado previsto negativo no valor
  // do salario.
  const [previstoIndisponivel, setPrevistoIndisponivel] = useState(false);
  const [metas, setMetas] = useState<Meta[]>([]);
  const [possoGastar, setPossoGastar] = useState<PossoGastar | null>(null);
  // O patrimonio no fim de um periodo que ja terminou, de `net_worth_history`.
  // `null` significa "nao existe versao historica deste numero" -- e nesse caso
  // o tile mostra o saldo de HOJE, dizendo que e de hoje.
  const [saldoNoFim, setSaldoNoFim] = useState<number | null>(null);
  // A rota nao conseguiu ler as metas -- e o caso, por exemplo, da janela entre
  // o merge do codigo e a migration 018 rodar no banco de producao. O tile
  // escreve "indisponivel" em vez de R$ 0,00: zero seria uma afirmacao sobre o
  // dinheiro do usuario que ninguem conferiu.
  const [reservaIndisponivel, setReservaIndisponivel] = useState(false);
  // A ordem e a visibilidade dos blocos, escolhidas em /dashboard/settings.
  // Comeca no padrao -- TUDO visivel -- e so muda se a rota responder. Um
  // erro de rede aqui nao pode esconder bloco nenhum: a tela inicial mostrando
  // menos do que deveria e indistinguivel de "o app perdeu os meus dados".
  const [ordem, setOrdem] = useState<string[]>(() =>
    secoesVisiveis(layoutPadrao())
  );

  // Recarrega a cada mudanca de periodo. As duas datas na lista de dependencias
  // em vez do objeto: `lerPeriodo` devolve um objeto novo a cada render, e o
  // efeito dispararia para sempre.
  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo.de, periodo.ate]);

  const carregar = async () => {
    // Trocar de periodo NAO volta para o giro de tela cheia: o painel inteiro
    // piscando a cada clique na seta torna a navegacao desagradavel de usar.
    // Mas os numeros da tela ainda sao os do periodo anterior ate a resposta
    // chegar, e deixa-los nitidos debaixo do rotulo novo e -- por alguns
    // instantes -- exatamente o erro que esta issue existe para corrigir:
    // numero de um periodo com o nome de outro. Dai o estado intermediario.
    setAtualizando(true);
    const query = periodoParaQuery(periodo);
    // O periodo ja acabou? Entao "quanto posso gastar" nao tem o que
    // responder: ele fala do que sobra ate o fim do MES CORRENTE. Nem se
    // pergunta.
    const periodoTemHoje = contemHoje(periodo, hoje);
    // Em periodo encerrado E alinhado a mes, existe um saldo historico de
    // verdade: `net_worth_history` (008) reconstroi o patrimonio no fim de
    // cada mes. Em modo intervalo nao existe -- a view tem grao de mes --, e
    // ai o tile mostra o numero de hoje dizendo que e de hoje.
    const temSaldoHistorico =
      periodo.modo === "mes" && terminaNoPassado(periodo, hoje);

    try {
      // Em paralelo de proposito: em serie, a tela inicial esperaria a soma
      // dos tempos de resposta de todas as rotas antes de mostrar qualquer
      // coisa.
      const [
        rContas,
        rFluxo,
        rPrevistas,
        rMetas,
        rPossoGastar,
        rLayout,
        rPatrimonio,
      ] = await Promise.all([
        fetch("/api/financial-accounts"),
        fetch(`/api/reports/cash-flow?${query}`),
        fetch(`/api/scheduled-transactions/summary?${query}`),
        fetch("/api/goals?status=active"),
        periodoTemHoje ? fetch("/api/safe-to-spend") : null,
        fetch("/api/settings/dashboard"),
        temSaldoHistorico ? fetch(`/api/reports/net-worth?${query}`) : null,
      ]);

      if (rContas.ok) {
        const d = await rContas.json();
        setContas(d.accounts ?? []);
      }

      if (rFluxo.ok) {
        const d = await rFluxo.json();
        setFluxo(d.summary ?? null);
      }

      // O patrimonio no fim do periodo e a ULTIMA linha da janela, nao a
      // primeira: a janela vai do comeco do periodo ate o mes em que ele
      // termina, e e esse fim que o tile rotula.
      if (rPatrimonio?.ok) {
        const d = await rPatrimonio.json();
        const meses = d.months ?? [];
        setSaldoNoFim(
          meses.length ? Number(meses[meses.length - 1].net_worth) : null
        );
      } else {
        setSaldoNoFim(null);
      }

      if (rPrevistas.ok) {
        const d = await rPrevistas.json();
        // A rota devolve uma linha POR MES, ja recortada pelo periodo. Somar
        // as linhas e o total do periodo; a versao antiga PROCURAVA a linha do
        // mes corrente calculado em UTC, e nas tres ultimas horas do mes
        // achava a do mes seguinte. Ver lib/periodo-do-painel.ts.
        setPrevistas({
          ...somarPrevistas(d.summary ?? []),
          month: periodo.de.slice(0, 7),
          fixed_monthly_cost: Number(d.fixed_monthly_cost ?? 0),
        });
        // Somar os meses pelo mesmo motivo de `somarPrevistas` acima: a rota
        // devolve uma linha por mes ja recortada pelo periodo, e procurar "o
        // mes" na lista foi o defeito que a HMO-173 corrigiu.
        setPrevisto(somarMesesPrevistos(d.summary ?? []));
        setPrevistoIndisponivel(Boolean(d.previsto_indisponivel));
      }

      if (rMetas.ok) {
        const d = await rMetas.json();
        setMetas((d.goals ?? []).slice(0, 3));
      }

      if (rPossoGastar?.ok) {
        const d = await rPossoGastar.json();
        setPossoGastar(d.safe_to_spend ?? null);
        setReservaIndisponivel(Boolean(d.reserva_indisponivel));
      } else if (!periodoTemHoje) {
        // Limpar e obrigatorio, nao higiene. Sem isto, quem navega de setembro
        // para julho continua vendo o cartao "quanto ainda posso gastar" com o
        // numero de setembro dentro de uma tela que diz julho em tudo mais.
        setPossoGastar(null);
      }

      if (rLayout.ok) {
        const d = await rLayout.json();
        setOrdem(secoesVisiveis(normalizarLayout(d.layout)));
      }
    } catch (erro) {
      console.error("Erro ao carregar o painel:", erro);
    } finally {
      setCarregando(false);
      setAtualizando(false);
    }
  };

  const saldoTotal = contas.reduce(
    (soma, c) => soma + Number(c.current_balance ?? 0),
    0
  );

  if (carregando) return <Girando />;

  const semNada = contas.length === 0 && !previstas?.count_pending;

  // O periodo em uma palavra, para os rotulos dos tiles. "neste mês" so quando
  // o periodo E um mes; nos outros casos o rotulo nomeia o periodo inteiro,
  // porque "neste mês" sobre uma janela de tres meses e simplesmente falso.
  const rotulo = rotuloDoPeriodo(periodo);
  const temHoje = contemHoje(periodo, hoje);

  // O titulo e a nota do tile de saldo saem da lib, nao de um ternario aqui:
  // a regra que eles carregam -- numero sem versao historica nunca aparece
  // debaixo do nome do periodo -- e o aceite da issue, e no JSX ela seria
  // conferida por inspecao visual em vez de por teste.
  const rotuloSaldo = rotuloDoSaldo({
    periodo,
    hoje,
    saldoHistorico: saldoNoFim,
    quantidadeDeContas: contas.length,
  });

  // ------------------------------------------------------------------------
  // OS BLOCOS CONFIGURAVEIS
  // ------------------------------------------------------------------------
  // A partir da HMO-159 a ordem desta tela nao esta mais escrita no JSX: cada
  // bloco vira uma entrada deste mapa, e `ordem` -- que vem da configuracao do
  // usuario -- decide quais aparecem e em que sequencia.
  //
  // As chaves sao os mesmos ids de SECOES_DO_PAINEL, e essa amarracao nao e
  // decorativa: um id que exista no catalogo e nao exista aqui vira um bloco
  // que o usuario liga na configuracao e nunca aparece na tela -- sem erro,
  // sem aviso, apenas ausente.
  //
  // O cabecalho, o estado vazio e o aviso de "escondeu tudo" ficam FORA do
  // mapa, porque nao sao blocos de conteudo: sao a moldura da tela.
  const blocos: Record<string, ReactNode> = {
    resumo: (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* ----------------------------------------------------------------
            O TILE QUE NAO TEM EIXO DE TEMPO
            ----------------------------------------------------------------
            `current_balance` e o saldo de HOJE -- o banco nao guarda historico
            de saldo. Sao dois numeros diferentes debaixo do mesmo icone, e o
            que muda entre eles e a FRASE, nunca o silencio:

              * periodo encerrado e alinhado a mes -> o patrimonio no fim
                daquele mes, reconstruido por `net_worth_history`
              * qualquer outro caso -> o saldo de hoje, dito com todas as
                letras, e o rotulo avisa que ele esta FORA do periodo

            O que nao pode existir e a terceira versao, que era a de antes
            desta issue: o numero de hoje debaixo de uma tela que diz julho. */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Wallet className="h-4 w-4" />
              {rotuloSaldo.titulo}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${
                (saldoNoFim ?? saldoTotal) < 0 ? "text-destructive" : ""
              }`}
            >
              {moeda(saldoNoFim ?? saldoTotal)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {rotuloSaldo.nota}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Entrou
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-success">
              {moeda(fluxo?.total_income ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1 capitalize">
              {rotulo}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              Saiu
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* total_expense ja vem POSITIVO da rota: despesa e gravada
                negativa no banco, e a rota aplica o ABS. Repetir um Math.abs
                aqui seria inofensivo hoje e mentiria no dia em que a rota
                mudasse de convencao -- o numero viraria positivo do mesmo
                jeito e ninguem veria. */}
            <div className="text-2xl font-bold text-destructive">
              {moeda(fluxo?.total_expense ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Saldo do período: {moeda(fluxo?.net ?? 0)}
            </p>
          </CardContent>
        </Card>

        {/* Outro tile sem eixo de tempo, e de um tipo diferente do saldo: o
            custo fixo sai das regras recorrentes ATIVAS, que sao uma
            afirmacao sobre o presente. Ele nao tem versao de julho nem
            reconstrucao possivel -- so o aviso. */}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" />
              Custo fixo mensal
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {moeda(previstas?.fixed_monthly_cost ?? 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {temHoje
                ? "Soma dos gastos fixos cadastrados"
                : "Gastos fixos de hoje — não é do período escolhido"}
            </p>
          </CardContent>
        </Card>
      </div>
    ),

    // ------------------------------------------------------------------
    // Previsto x Realizado (HMO-186)
    // ------------------------------------------------------------------
    // Os dois lados honram o periodo, e por isso este bloco nao precisa de
    // nenhum aviso de "nao e do periodo escolhido": o previsto vem da agenda
    // recortada por `due_date` dentro da janela, o realizado vem do mesmo
    // `/api/reports/cash-flow` que alimenta os tiles "Entrou" e "Saiu".
    //
    // Em periodo FUTURO o realizado vem zerado, e isso esta certo: nada foi
    // realizado ainda. O bloco nao esconde nem inventa -- mostra previsto
    // cheio contra realizado zero, que e exatamente o estado do mundo.
    //
    // Nada e recalculado aqui. `previsto` sai de somarMesesPrevistos sobre a
    // resposta da rota e o realizado sai de `fluxo`, os MESMOS numeros que os
    // tiles de cima mostram -- se este bloco somasse por conta propria, duas
    // partes da mesma tela passariam a discordar sobre o mes.
    "previsto-x-realizado": previsto && (
      <PrevistoXRealizado
        previsto={previsto}
        realizado={{
          entradas: fluxo?.total_income ?? 0,
          // Ja POSITIVO da rota, como o tile "Saiu" documenta. Um Math.abs aqui
          // seria inofensivo hoje e mentiria no dia em que a rota trocasse de
          // convencao -- o numero viraria positivo do mesmo jeito e ninguem
          // veria a troca.
          despesas: fluxo?.total_expense ?? 0,
          resultado: fluxo?.net ?? 0,
        }}
        rotulo={rotulo}
        indisponivel={previstoIndisponivel}
      />
    ),

    // ------------------------------------------------------------------
    // Quanto ainda posso gastar
    // ------------------------------------------------------------------
    /* O numero vem inteiro de /api/safe-to-spend, que por sua vez chama
          lib/safe-to-spend.ts. Nenhuma das cinco parcelas e recalculada aqui:
          refazer a subtracao na tela criaria uma segunda versao da mesma conta,
          e no dia em que a definicao mudasse -- o que entra como divida de
          cartao, por exemplo -- o total e as parcelas passariam a discordar
          dentro do mesmo cartao. */
    // Fora do mes corrente este cartao nao some: ele explica. Um bloco que
    // desaparece sozinho e indistinguivel de bloco quebrado -- e o arquivo ja
    // tomou essa decisao uma vez, no aviso de "escondeu tudo" la embaixo.
    "posso-gastar": !temHoje ? (
      <Card className="border-dashed">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Coins className="h-5 w-5" />
            Quanto ainda posso gastar
          </CardTitle>
          <CardDescription>
            Só existe para o mês corrente: a conta é o que sobra dos próximos
            dias depois do que já está comprometido. Não há versão dela para{" "}
            {rotulo}.
          </CardDescription>
        </CardHeader>
      </Card>
    ) : (
      possoGastar && (
      <Card
        className={
          possoGastar.livre < 0 ? "border-destructive/40" : "border-primary/40"
        }
      >
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Coins className="h-5 w-5" />
            Quanto ainda posso gastar
          </CardTitle>
          <CardDescription>
            O que sobra até {diaEMes(possoGastar.ate)} depois de tudo que já
            está comprometido
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <div
                className={`text-3xl font-bold ${
                  possoGastar.livre < 0 ? "text-destructive" : "text-success"
                }`}
              >
                {moeda(possoGastar.livre)}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {possoGastar.livre > 0
                  ? `${moeda(possoGastar.porDia)} por dia nos ${
                      possoGastar.diasRestantes
                    } ${
                      possoGastar.diasRestantes === 1 ? "dia" : "dias"
                    } que faltam`
                  : "O mês já está comprometido além do que existe em conta — não há verba diária"}
              </p>
            </div>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/bills">
                Ver compromissos
                <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">Em conta</p>
              <p className="font-semibold">{moeda(possoGastar.disponivel)}</p>
              <p className="text-xs text-muted-foreground mt-1">
                Sem investimentos
              </p>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">A receber</p>
              <p className="font-semibold text-success">
                + {moeda(possoGastar.receitasPrevistas)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Receitas previstas
              </p>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground">A pagar</p>
              <p className="font-semibold text-destructive">
                − {moeda(possoGastar.compromissos)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {possoGastar.compromissosVencidos > 0
                  ? `${moeda(possoGastar.compromissosVencidos)} em atraso`
                  : "Contas do mês"}
              </p>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <CreditCard className="h-3 w-3" />
                No cartão
              </p>
              <p className="font-semibold text-destructive">
                − {moeda(possoGastar.dividaDeCartao)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Fatura e período aberto
              </p>
            </div>
            {/* A quinta parcela. Aparece SEMPRE, inclusive zerada: um tile
                  que some quando o valor e zero faz a soma das parcelas nao
                  fechar com o total para quem esta conferindo a conta na mao --
                  e "some quando e zero" e indistinguivel de "o desconto parou
                  de funcionar". */}
            <div className="rounded-lg bg-muted p-3">
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Target className="h-3 w-3" />
                Nas metas
              </p>
              <p
                className={`font-semibold ${
                  reservaIndisponivel
                    ? "text-muted-foreground"
                    : "text-destructive"
                }`}
              >
                {reservaIndisponivel
                  ? "—"
                  : `− ${moeda(possoGastar.reservaDeMetas)}`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {reservaIndisponivel
                  ? "Não foi possível ler as metas"
                  : possoGastar.reservaDeMetas > 0
                    ? "Falta aportar no mês"
                    : "Nada a separar este mês"}
              </p>
            </div>
          </div>

          {/* A divida do cartao e a parcela que mais surpreende quem olha:
                ela inclui a compra de ontem, que ainda nao esta em fatura
                nenhuma. Abrir por cartao e o que evita a conclusao de que o
                numero esta errado. */}
          {possoGastar.cartoes.some((c) => c.divida > 0) && (
            <p className="text-xs text-muted-foreground">
              Cartões:{" "}
              {possoGastar.cartoes
                .filter((c) => c.divida > 0)
                .map((c) => `${c.name} ${moeda(c.divida)}`)
                .join(" · ")}
            </p>
          )}

          {/* Abrir por meta pelo mesmo motivo do cartao: o valor descontado
                NAO e o alvo mensal, e o que ainda falta aportar. Quem ja
                aportou R$ 200 de um alvo de R$ 500 ve "− R$ 300", e sem esta
                linha concluiria que o app esqueceu o aporte. */}
          {possoGastar.metas.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Metas:{" "}
              {possoGastar.metas
                .map((m) =>
                  m.aportado > 0
                    ? `${m.title} ${moeda(m.reserva)} (de ${moeda(
                        m.alvoMensal
                      )}, ${moeda(m.aportado)} já aportado)`
                    : `${m.title} ${moeda(m.reserva)}`
                )
                .join(" · ")}
            </p>
          )}
        </CardContent>
      </Card>
      )
    ),

    // ------------------------------------------------------------------
    // O que ja venceu
    // ------------------------------------------------------------------
    vencidas: !!previstas?.count_overdue && (
      <Card className="border-destructive/30 bg-destructive/10">
        <CardContent className="flex items-center justify-between p-4 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
            <div>
              <p className="font-medium text-destructive">
                {previstas.count_overdue}{" "}
                {previstas.count_overdue === 1
                  ? "conta vencida"
                  : "contas vencidas"}
              </p>
              <p className="text-sm text-destructive">
                {moeda(previstas.total_overdue)} em atraso
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/bills">
              Ver contas
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    ),

    // ------------------------------------------------------------------
    // O que ainda vence
    // ------------------------------------------------------------------
    "a-vencer": (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarClock className="h-5 w-5" />A vencer
          </CardTitle>
          <CardDescription className="capitalize">{rotulo}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold">
              {moeda(previstas?.total_pending ?? 0)}
            </span>
            <Badge variant="secondary">
              {previstas?.count_pending ?? 0}{" "}
              {previstas?.count_pending === 1 ? "conta" : "contas"}
            </Badge>
          </div>
          <Button variant="outline" className="w-full" asChild>
            <Link href="/dashboard/bills">Abrir Contas Previstas</Link>
          </Button>
        </CardContent>
      </Card>
    ),

    // ------------------------------------------------------------------
    // Metas
    // ------------------------------------------------------------------
    metas: (
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="h-5 w-5" />
            Metas
          </CardTitle>
          {/* Progresso de meta e acumulado desde o inicio dela, nao um total
              do periodo: `goal_progress` soma TODOS os aportes. Navegar para
              julho nao muda estas barras -- entao, fora do mes corrente, o
              cartao diz de quando elas falam. Dentro dele a frase seria ruido:
              "ate hoje" e o que qualquer um ja supoe. */}
          {!temHoje && (
            <CardDescription>
              Progresso acumulado até hoje — não é do período escolhido
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {metas.length > 0 ? (
            <>
              {metas.map((meta) => {
                // progress_ratio vem da view goal_progress (aportes dividido
                // pelo alvo). O clamp e para a barra: uma meta superada da
                // ratio acima de 1 e a barra estouraria o card.
                const pct = Math.min(
                  Math.round(Number(meta.progress_ratio ?? 0) * 100),
                  100
                );
                return (
                  <div key={meta.id} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium truncate">{meta.title}</span>
                      <span className="text-muted-foreground shrink-0 ml-2">
                        {pct}%
                      </span>
                    </div>
                    <Progress value={pct} className="h-2" />
                    <p className="text-xs text-muted-foreground">
                      {moeda(Number(meta.saved ?? 0))} de{" "}
                      {moeda(Number(meta.target_amount ?? 0))}
                    </p>
                  </div>
                );
              })}
              <Button variant="outline" className="w-full" asChild>
                <Link href="/dashboard/goals">Ver todas</Link>
              </Button>
            </>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-3">
                Nenhuma meta ativa
              </p>
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard/goals">Criar uma meta</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    ),

    // ------------------------------------------------------------------
    // Contas, uma a uma
    // ------------------------------------------------------------------
    contas: contas.length > 0 && (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Suas contas</CardTitle>
          {/* Mesmo motivo do tile de saldo: `current_balance` e de hoje. A
              abertura por conta nao tem reconstrucao historica -- a view do
              008 devolve o patrimonio TOTAL, nao o saldo de cada conta. */}
          <CardDescription>
            {temHoje ? "Saldo de hoje" : "Saldo de hoje — não é do período escolhido"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {contas.map((conta) => (
              <div
                key={conta.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <span className="text-sm">{conta.name}</span>
                <span
                  className={`text-sm font-medium ${
                    Number(conta.current_balance) < 0 ? "text-destructive" : ""
                  }`}
                >
                  {moeda(Number(conta.current_balance ?? 0))}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    ),

    // ------------------------------------------------------------------
    // Atalhos
    // ------------------------------------------------------------------
    atalhos: (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Button variant="outline" className="h-auto py-4 flex-col" asChild>
          <Link href="/dashboard/statements">
            <FileUp className="h-5 w-5 mb-1" />
            <span className="text-xs">Importar extrato</span>
          </Link>
        </Button>
        <Button variant="outline" className="h-auto py-4 flex-col" asChild>
          <Link href="/dashboard/budgets">
            <Wallet className="h-5 w-5 mb-1" />
            <span className="text-xs">Orçamento</span>
          </Link>
        </Button>
        <Button variant="outline" className="h-auto py-4 flex-col" asChild>
          <Link href="/dashboard/expense-groups">
            <Users className="h-5 w-5 mb-1" />
            <span className="text-xs">Grupos</span>
          </Link>
        </Button>
        <Button variant="outline" className="h-auto py-4 flex-col" asChild>
          <Link href="/dashboard/reports">
            <TrendingUp className="h-5 w-5 mb-1" />
            <span className="text-xs">Relatórios</span>
          </Link>
        </Button>
      </div>
    ),
  };

  // Um bloco pode nao ter o que mostrar hoje -- "Suas contas" sem conta
  // nenhuma, o aviso de vencidas sem conta vencida. Esses vem `false` do mapa
  // acima e sao descartados ANTES do agrupamento em linhas: mantidos, eles
  // ocupariam metade de uma linha com nada dentro, e a tela ficaria com um
  // buraco cuja causa nao esta em lugar nenhum da configuracao.
  const linhas = agruparEmLinhas(ordem.filter((id) => Boolean(blocos[id])));

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Visão geral</h1>
          <p className="text-muted-foreground">
            {temHoje
              ? "Onde o seu dinheiro está hoje, e o que vence nos próximos dias"
              : "O que entrou, saiu e venceu no período escolhido"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" asChild>
            <Link href="/dashboard/settings" aria-label="Configurar o painel">
              <Settings className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild>
            <Link href="/dashboard/personal-finance">
              <Plus className="h-4 w-4 mr-2" />
              Novo lançamento
            </Link>
          </Button>
        </div>
      </div>

      {/* O seletor fica FORA do mapa `blocos`, com o cabecalho e o estado
          vazio: ele nao e um bloco de conteudo, e a moldura da tela. Se
          entrasse no mapa, o usuario poderia desliga-lo em /dashboard/settings
          e ficar sem como sair do mes corrente -- e, pior, sem nada na tela
          explicando por que o painel nao navega mais. */}
      <SeletorDePeriodo periodo={periodo} hoje={hoje} aoMudar={irPara} />

      {/* `aria-busy` alem da opacidade: quem usa leitor de tela nao ve o
          esmaecido, e sem isto ouviria os numeros do periodo anterior como se
          fossem a resposta ja pronta para o periodo novo. */}
      <div
        aria-busy={atualizando}
        className={
          atualizando
            ? "space-y-6 opacity-50 transition-opacity"
            : "space-y-6 transition-opacity"
        }
      >

      {semNada && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-8 text-center">
            <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              Ainda não há nada para mostrar
            </h3>
            <p className="text-muted-foreground mb-4 max-w-md">
              Cadastre uma conta e lance o primeiro gasto — ou importe o extrato
              do banco e o app preenche o mês inteiro de uma vez.
            </p>
            <div className="flex gap-2 flex-wrap justify-center">
              <Button asChild>
                <Link href="/dashboard/personal-finance">
                  <Plus className="h-4 w-4 mr-2" />
                  Lançar um gasto
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href="/dashboard/statements">
                  <FileUp className="h-4 w-4 mr-2" />
                  Importar extrato
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {linhas.map((linha) =>
        linha.length === 1 ? (
          <div key={linha[0]}>{blocos[linha[0]]}</div>
        ) : (
          <div
            key={linha.join("+")}
            className="grid grid-cols-1 lg:grid-cols-2 gap-6"
          >
            {linha.map((id) => (
              <div key={id}>{blocos[id]}</div>
            ))}
          </div>
        )
      )}

      {/* Escondeu tudo. A tela inicial em branco e indistinguivel de tela
          quebrada -- e quem esta olhando para ela ja nao lembra que foi ele
          quem desligou os blocos, meses atras. O caminho de volta tem que
          estar aqui, nao na memoria da pessoa. */}
      {ordem.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center p-8 text-center">
            <Settings className="h-10 w-10 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">
              Todos os blocos estão ocultos
            </h3>
            <p className="text-muted-foreground mb-4 max-w-md">
              O painel está vazio porque nenhum bloco está marcado para
              aparecer. Isso é uma configuração, não um erro.
            </p>
            <Button variant="outline" asChild>
              <Link href="/dashboard/settings">
                <Settings className="h-4 w-4 mr-2" />
                Escolher o que mostrar
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
