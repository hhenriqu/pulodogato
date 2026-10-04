"use client";

// -----------------------------------------------------------------------------
// A TELA DE UMA MOVIMENTACAO SO (HMO-246)
// -----------------------------------------------------------------------------
// "Devemos ter uma tela apenas para receitas, uma apenas para despesas e uma
// para transferencia. Essas telas devem contar apenas com Total, Previsto,
// Realizado e exibir os lancamentos que estiverem naquele periodo. Uma otima
// tela para usar de referencia e a de contas previstas porem com a possibilidade
// de escolher o periodo."
//
// UM COMPONENTE PARA AS TRES, e nao tres arquivos. O que muda entre elas e o
// `tipo` e os rotulos, e os rotulos vem de `TELAS_DE_MOVIMENTACAO`. Tres copias
// deste arquivo divergiriam na primeira mudanca -- e o que divergiria primeiro
// e o que menos pode: a conta de Total, Previsto e Realizado.
//
// OS TRES CARTOES MORAM EM OUTRO ARQUIVO, DE PROPOSITO
// ----------------------------------------------------
// `components/movimentacoes/CartoesDaTela.tsx`. Este arquivo importa
// `next/navigation`, que NAO roda no node -- com os cartoes aqui dentro, o
// teste que renderiza a marcacao deles morreria no import. La eles sao funcao
// pura de props, e scripts/test-cartoes-da-tela.mjs le o HTML que sai: e a
// unica coisa capaz de pegar o `previsto` impresso no cartao "Realizado", que e
// um defeito que a aritmetica inteira aprova.
//
// O ZERO CONFIANTE NAO PODE APARECER
// ----------------------------------
// Todo numero passa por `podeMostrarNumero` e vira travessao quando nao houve
// leitura (ver lib/offline-leitura.ts), e toda frase de secao vazia passa por
// `podeAfirmarVazio`. Esta tela existe para responder "quanto eu gastei neste
// mes"; um "R$ 0,00" dito sem dado atras e a pior resposta possivel para essa
// pergunta -- ela nao parece um erro, parece um mes barato.
// -----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRightLeft,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  CreditCard,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SeletorDePeriodo } from "@/components/dashboard/SeletorDePeriodo";
import { CartoesDaTela } from "@/components/movimentacoes/CartoesDaTela";
import {
  FaixaDadoDoAparelho,
  PainelErroDoServidor,
  PainelSemRede,
} from "@/components/SemRede";
import {
  buscarLeitura,
  podeAfirmarVazio,
  type EstadoDaLeitura,
} from "@/lib/offline-leitura";
import {
  ehPeriodoCorrente,
  lerPeriodo,
  periodoCorrente,
  periodoParaQuery,
  rotuloDoPeriodo,
  type Periodo,
} from "@/lib/periodo-do-painel";
import { today } from "@/lib/recurrence";
import { ROTA_DA_TRANSFERENCIA } from "@/lib/transferencia";
import { comOrigem } from "@/lib/retorno-do-lancamento";
import { useOrigemDaTela } from "@/lib/hooks/useOrigemDaTela";
import {
  secoesDaTela,
  telaDoTipo,
  TELAS_DE_MOVIMENTACAO,
  type LinhaDaTela,
  type ResumoDaTela,
  type TipoDaTela,
} from "@/lib/telas-de-movimentacao";

/** O que a rota responde. */
interface RespostaDaTela {
  resumo?: ResumoDaTela;
  vencido?: { total: number; quantidade: number };
  linhas?: LinhaDaTela[];
  fatura_sem_vencimento?: { account_name: string | null; total: number }[];
}

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor);

/** 'AAAA-MM-DD' -> 'DD/MM'. Fatiado, nao `new Date`: ver `linhasDaTela`. */
const dataCurta = (iso: string) =>
  iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—";

/** O icone e a cor de cada tela. Em token, nunca em hex (check-color-tokens). */
const APARENCIA: Record<
  TipoDaTela,
  { Icone: typeof TrendingUp; cor: string; rotaDeLancar: string; textoDeLancar: string }
> = {
  income: {
    Icone: TrendingUp,
    cor: "text-success",
    rotaDeLancar: "/dashboard/movimentacoes/receita",
    textoDeLancar: "Nova Receita",
  },
  expense: {
    Icone: TrendingDown,
    cor: "text-destructive",
    rotaDeLancar: "/dashboard/movimentacoes/despesa",
    textoDeLancar: "Nova Despesa",
  },
  transfer: {
    Icone: ArrowRightLeft,
    cor: "text-info",
    rotaDeLancar: ROTA_DA_TRANSFERENCIA,
    textoDeLancar: "Nova Transferência",
  },
};

export function TelaDeMovimentacao({ tipo }: { tipo: TipoDaTela }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // `today()` formata em America/Sao_Paulo. `new Date()` no servidor da Vercel
  // e UTC, e das 21:00 as 23:59 do ultimo dia do mes ele ja esta no mes
  // seguinte -- a tela abriria no mes que a pessoa nao esta.
  const hoje = useMemo(() => today(), []);

  // O periodo vive na URL: o link que a pessoa manda mostra o mes dela, e o
  // botao voltar do navegador anda entre periodos.
  const periodo = lerPeriodo(
    searchParams.get("de"),
    searchParams.get("ate"),
    hoje
  );

  // `telaDoTipo` nunca devolve null aqui -- `tipo` e tipado --, e o `??` existe
  // para o tsc e nao para o runtime. A alternativa seria um `!`, que imprimiria
  // "undefined" num rotulo no dia em que o catalogo e o tipo se separassem.
  const tela = telaDoTipo(tipo) ?? TELAS_DE_MOVIMENTACAO[0];
  const aparencia = APARENCIA[tipo];
  /** Esta tela, com o periodo, para o modal de lancamento saber para onde voltar. */
  const origem = useOrigemDaTela();

  const [resumo, setResumo] = useState<ResumoDaTela | null>(null);
  const [vencido, setVencido] = useState<{ total: number; quantidade: number }>({
    total: 0,
    quantidade: 0,
  });
  const [linhas, setLinhas] = useState<LinhaDaTela[]>([]);
  const [semVencimento, setSemVencimento] = useState<
    { account_name: string | null; total: number }[] | null
  >(null);
  const [estado, setEstado] = useState<EstadoDaLeitura | null>(null);
  const [guardadoEm, setGuardadoEm] = useState<Date | null>(null);
  const [carregando, setCarregando] = useState(true);

  /**
   * O periodo como querystring, calculado FORA do `carregar`.
   *
   * `periodo` e um objeto novo a cada render (`lerPeriodo` constroi um), entao
   * po-lo na lista de dependencias do `useCallback` abaixo faria a busca
   * repetir para sempre -- o `useEffect` depende de `carregar`, que mudaria em
   * cada render. E uma lista com `periodo.de, periodo.ate` e desonesta: o lint
   * cobra `periodo` e tem razao, porque e `periodo` que o corpo le.
   *
   * Uma STRING resolve as duas coisas: ela e comparada por VALOR, entao e
   * estavel enquanto o periodo nao muda, e a dependencia declarada e exatamente
   * o que o corpo usa. E `periodoParaQuery` continua sendo quem escolhe os
   * nomes `de`/`ate` -- montar a querystring a mao aqui os separaria dos que
   * `periodoDaQuery` le na rota, e um `?from=` contra um `get("de")` cai no mes
   * corrente em silencio: o seletor pareceria nao funcionar, sem erro nenhum.
   */
  const queryDoPeriodo = periodoParaQuery(periodo);

  const carregar = useCallback(async () => {
    setCarregando(true);

    const leitura = await buscarLeitura<RespostaDaTela>(
      `/api/movimentacoes/resumo?tipo=${tipo}&${queryDoPeriodo}`
    );

    setEstado(leitura.estado);
    setGuardadoEm(leitura.guardadoEm);

    if (leitura.dados) {
      setResumo(leitura.dados.resumo ?? null);
      setVencido(leitura.dados.vencido ?? { total: 0, quantidade: 0 });
      setLinhas(leitura.dados.linhas ?? []);
      // `?? null` e nao `?? []`: uma resposta guardada no aparelho de antes
      // desta feature nao tem o campo, e `[]` ali afirmaria "nenhum cartao sem
      // vencimento" com base num corpo que nunca respondeu isso.
      setSemVencimento(leitura.dados.fatura_sem_vencimento ?? null);
    } else {
      // A leitura falhou: a lista SAI da tela. Deixar a do periodo anterior
      // seria a tela mostrando setembro com o titulo de outubro.
      setResumo(null);
      setLinhas([]);
    }

    setCarregando(false);
  }, [tipo, queryDoPeriodo]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  /**
   * Trocar de periodo troca a URL -- e e a URL que manda.
   *
   * `router.push` e nao `setState`: o periodo vive na querystring, entao o link
   * que a pessoa manda mostra o mes dela e o botao voltar do navegador anda
   * entre periodos. O efeito acima refaz a leitura porque `queryDoPeriodo`
   * muda.
   *
   * O `as any` e o mesmo do menu lateral (components/Sidebar.tsx), pela mesma
   * razao: `experimental.typedRoutes` tipa o destino como uma UNIAO LITERAL das
   * rotas do app, e `tela.rota` vem de `TELAS_DE_MOVIMENTACAO`, que e uma lib
   * pura -- ela nao pode importar os tipos gerados do Next sem quebrar o build
   * standalone que as suites e o mutador usam. Quem garante que as tres rotas
   * existem e o teste de contrato, que confere cada `rota` do catalogo contra o
   * arquivo de pagina correspondente.
   */
  const irPara = useCallback(
    (novo: Periodo) => {
      router.push(`${tela.rota}?${periodoParaQuery(novo)}` as any);
    },
    [router, tela.rota]
  );

  const { previstas, realizadas } = useMemo(
    () => secoesDaTela(linhas),
    [linhas]
  );

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* No celular o titulo e o botao de lancar empilham: o par nao divide uma
          linha de 320px com mais nada (HMO-168). */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <aparencia.Icone className={`h-8 w-8 ${aparencia.cor}`} />
            {tela.titulo}
          </h1>
          {/*
            O PERIODO ENTRA NA FRASE, e a frase diz o que "Total" significa.
            Sem ela, dois numeros certos por criterios diferentes -- este Total
            (previsto + realizado) e o cartao de Financas Pessoais (so
            realizado) -- se leem como um bug.
          */}
          <p className="text-muted-foreground">
            O que {tela.titulo.toLowerCase()} somam em{" "}
            <span className="font-medium text-foreground">
              {rotuloDoPeriodo(periodo)}
            </span>
            . <strong>Total</strong> é previsto + realizado: o que o período
            compromete, tenha o dinheiro andado ou não.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* A porta de lançar DESTA tela -- e so dela. Finanças Pessoais
              oferece as tres de uma vez porque e a lista de tudo; aqui um
              segundo botao levaria a pessoa a lançar o tipo que ela nao veio
              lançar. O `as any` e o do `irPara` acima, pela mesma razao.

              `comOrigem` leva o endereco DESTA tela, com o `?de=&ate=` dentro
              (HMO-249): sem ele, salvar uma despesa de janeiro devolveria a
              pessoa ao mes corrente, onde ela nao esta. */}
          <Button asChild className="gap-2">
            <Link href={comOrigem(aparencia.rotaDeLancar, origem) as any}>
              <aparencia.Icone className="h-4 w-4" />
              {aparencia.textoDeLancar}
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SeletorDePeriodo periodo={periodo} hoje={hoje} aoMudar={irPara} />

        <Button variant="outline" asChild className="gap-2">
          <Link href="/dashboard/personal-finance">
            Ver todos os lançamentos
          </Link>
        </Button>
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
          oQue={`as ${tela.titulo.toLowerCase()} do período`}
          aoTentarDeNovo={carregar}
        />
      ) : estado === "erro-do-servidor" ? (
        <PainelErroDoServidor
          oQue={`as ${tela.titulo.toLowerCase()} do período`}
          aoTentarDeNovo={carregar}
        />
      ) : (
        <>
          <CartoesDaTela
            tela={tela}
            cor={aparencia.cor}
            resumo={resumo}
            vencido={vencido}
            estado={estado}
          />

          {/*
            A FATURA SEM DATA DE VENCIMENTO (HMO-227)
            Sem `due_day` no cartao o banco nao calcula vencimento, e a fatura
            NAO pode virar linha prevista. Omitir isso deixaria o "Previsto"
            desta tela ignorando um cartao inteiro, sem nada dizendo que ele foi
            ignorado -- um numero menor e plausivel.
          */}
          {tipo === "expense" &&
            semVencimento !== null &&
            semVencimento.length > 0 && (
              <Card className="border-warning/40">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CreditCard className="h-4 w-4 text-warning" />
                    Fatura de cartão fora do previsto
                  </CardTitle>
                  <CardDescription>
                    Estes cartões têm fatura aberta e nenhum dia de vencimento
                    configurado. Sem ele não há data para calcular, e o app não
                    inventa uma — então o valor abaixo está FORA do Previsto.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {semVencimento.map((cartao, i) => (
                    <div
                      key={`${cartao.account_name ?? "cartao"}|${i}`}
                      className="flex items-center justify-between gap-3 border-b border-border py-2 last:border-0"
                    >
                      <p className="font-medium text-foreground">
                        {cartao.account_name ?? "Cartão de crédito"}
                      </p>
                      <div className="flex items-center gap-3">
                        <p className="font-semibold">{moeda(cartao.total)}</p>
                        <Button size="sm" variant="outline" asChild>
                          <Link href="/dashboard/cartoes">Configurar</Link>
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

          <Secao
            titulo="Previsto no período"
            icone={<CalendarClock className="h-4 w-4 text-warning" />}
            subtitulo={tela.oQueOPrevistoE}
            linhas={previstas}
            carregando={carregando}
            vazio={
              podeAfirmarVazio(estado)
                ? "Nada previsto neste período."
                : "Não dá para conferir o previsto agora."
            }
            aparencia={aparencia}
          />

          <Secao
            titulo="Realizado no período"
            icone={<CheckCircle2 className="h-4 w-4 text-success" />}
            subtitulo={tela.oQueORealizadoE}
            linhas={realizadas}
            carregando={carregando}
            vazio={
              podeAfirmarVazio(estado)
                ? `Nenhum lançamento em ${rotuloDoPeriodo(periodo)}.`
                : "Não dá para conferir o realizado agora."
            }
            aparencia={aparencia}
          />

          {/*
            O CAMINHO DE VOLTA PARA O MES CORRENTE.
            Quem navegou para agosto e nao encontrou nada precisa saber que
            outros periodos existem -- sem isto, "Nenhum lançamento" se le como
            "a minha conta esta vazia", com trezentos lançamentos a uma seta de
            distancia.
          */}
          {!ehPeriodoCorrente(periodo, hoje) && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                className="gap-2"
                onClick={() => irPara(periodoCorrente(hoje))}
              >
                <CalendarRange className="h-4 w-4" />
                Ver {rotuloDoPeriodo(periodoCorrente(hoje))}
              </Button>
            </div>
          )}

          {/*
            O QUE NAO ESTA NESTES NUMEROS, DITO EM UMA LINHA.
            A minha parte das despesas de grupo que outra pessoa pagou esta na
            lista de Financas Pessoais (HMO-215) e nao entra aqui: o realizado
            soma o valor CHEIO do que saiu da minha conta, e somar uma FRACAO do
            que saiu da conta de outro misturaria dois criterios num numero so.
            Um valor que falta sem rotulo e indistinguivel de um bug.
          */}
          {tipo === "expense" && (
            <p className="text-xs text-muted-foreground">
              Sua parte das despesas de grupo que outra pessoa pagou não entra
              nestes totais — ela aparece em{" "}
              <Link
                href="/dashboard/personal-finance"
                className="underline hover:text-foreground"
              >
                Finanças Pessoais
              </Link>
              , onde a lista junta as duas origens.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Uma secao da lista, com o subtotal que o cartao de cima prometeu.
 *
 * O subtotal e recalculado AQUI a partir das linhas que a secao desenha, e nao
 * recebido do resumo. E a unica forma de a tela denunciar uma divergencia entre
 * o numero e a lista: iguais, confirmam-se; diferentes, aparecem diferentes na
 * mesma tela. Receber o numero de cima esconderia exatamente o defeito que
 * importa.
 */
function Secao({
  titulo,
  subtitulo,
  icone,
  linhas,
  carregando,
  vazio,
  aparencia,
}: {
  titulo: string;
  subtitulo: string;
  icone: React.ReactNode;
  linhas: LinhaDaTela[];
  carregando: boolean;
  vazio: string;
  aparencia: (typeof APARENCIA)[TipoDaTela];
}) {
  const subtotal = linhas.reduce((soma, l) => soma + l.valor, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            {icone}
            {titulo}
            <span className="text-sm font-normal text-muted-foreground">
              ({linhas.length})
            </span>
          </span>
          {linhas.length > 0 && (
            <span className={`text-base font-semibold ${aparencia.cor}`}>
              {moeda(subtotal)}
            </span>
          )}
        </CardTitle>
        <CardDescription>{subtitulo}</CardDescription>
      </CardHeader>
      <CardContent>
        {/*
          Enquanto a consulta corre, a lista sai da tela e da lugar a um
          indicador. Sem isto o vazio pisca como "Nenhum lançamento em outubro
          de 2026" -- um zero confiante em cima de um periodo que ainda nao foi
          lido.
        */}
        {carregando ? (
          <div className="flex items-center justify-center py-6" aria-live="polite">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            <span className="sr-only">Carregando {titulo.toLowerCase()}</span>
          </div>
        ) : linhas.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{vazio}</p>
        ) : (
          <div className="space-y-1">
            {linhas.map((linha) => (
              <div
                key={linha.id}
                className="flex items-start justify-between gap-3 border-b border-border py-2 last:border-0"
              >
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate font-medium text-foreground">
                    {linha.descricao ?? "Sem descrição"}
                  </p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{dataCurta(linha.data)}</span>
                    {linha.categoria && <span>· {linha.categoria}</span>}
                    {linha.conta && <span>· {linha.conta}</span>}
                    {linha.moeda && <span>· {linha.moeda}</span>}
                    {/*
                      "Vencida" sai de `effective_status`, que a view calcula na
                      hora -- nunca de uma comparacao de data feita aqui. Duas
                      implementacoes da mesma regra divergem, e esta divergiria
                      no fuso do servidor (UTC na Vercel).
                    */}
                    {linha.situacao === "overdue" && (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <AlertCircle className="h-3 w-3" />
                        vencida
                      </span>
                    )}
                    {/* A fatura aberta nao existe em tabela nenhuma: sem rotulo
                        ela se le como uma conta que a pessoa cadastrou e nao
                        encontra em Contas Previstas. */}
                    {!linha.gravada && <span>· fatura aberta do cartão</span>}
                  </p>
                </div>
                <p className="shrink-0 font-semibold">{moeda(linha.valor)}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
