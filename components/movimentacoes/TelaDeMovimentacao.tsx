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
// ESTE ARQUIVO E A URL E O CROMO; O CORPO DA TELA MORA EM OUTRO (HMO-301)
// ----------------------------------------------------------------------
// Aqui ficam o titulo, o seletor de periodo, a porta de lancar e o caminho de
// volta ao mes corrente -- tudo que depende de `next/navigation`, porque o
// periodo vive na querystring. A LEITURA, a lista e as tres acoes
// (Editar/Excluir/Confirmar) ficam em
// `components/movimentacoes/ListaDeMovimentacao.tsx`.
//
// A fronteira e exatamente `next/navigation`, que NAO roda no node: com a
// leitura aqui dentro, nada neste repositorio conseguia montar a lista num
// navegador e medir a coisa que a HMO-301 pede -- que confirmar uma linha a
// MOVA de "Previsto no período" para "Realizado no período". Um teste que
// importasse este arquivo morreria no import, antes da primeira assercao.
// `scripts/test-lista-na-tela.mjs` monta o outro em Chromium de verdade.
//
// `CartoesDaTela.tsx` e `SecaoDaTela.tsx` continuam separados pela mesma razao,
// e com as suites que ja tinham (test-cartoes-da-tela.mjs e
// test-secao-da-tela.mjs, por `react-dom/server`): elas pegam o `previsto`
// impresso no cartao "Realizado" -- um defeito que a aritmetica inteira aprova
// --, o `?mes=` que o link da fatura leva, e agora QUAIS botoes cada estado de
// linha ganha.
//
// O ZERO CONFIANTE NAO PODE APARECER
// ----------------------------------
// Todo numero passa por `podeMostrarNumero` e vira travessao quando nao houve
// leitura (ver lib/offline-leitura.ts), e toda frase de secao vazia passa por
// `podeAfirmarVazio`. Esta tela existe para responder "quanto eu gastei neste
// mes"; um "R$ 0,00" dito sem dado atras e a pior resposta possivel para essa
// pergunta -- ela nao parece um erro, parece um mes barato.
// -----------------------------------------------------------------------------

import { useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRightLeft,
  CalendarRange,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { SeletorDePeriodo } from "@/components/dashboard/SeletorDePeriodo";
import { ListaDeMovimentacao } from "@/components/movimentacoes/ListaDeMovimentacao";
import type { AparenciaDaTela } from "@/components/movimentacoes/SecaoDaTela";
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
  telaDoTipo,
  TELAS_DE_MOVIMENTACAO,
  type TipoDaTela,
} from "@/lib/telas-de-movimentacao";

/**
 * O icone, a cor e as palavras de cada tela. Em token, nunca em hex
 * (check-color-tokens).
 *
 * `palavraDaLinha` e o nome, no singular, do que a linha COMUM e nesta tela --
 * ele so vai para o `aria-label` do icone da linha (`SecaoDaTela`), nunca para
 * a tela. Ele e por TELA e nao por `natureza` porque `natureza: "despesa"` e o
 * nome do caso comum nas tres (ver `NaturezaDaLinha`): "Despesa" dito embaixo
 * de um salario previsto seria um rotulo errado sobre um numero certo.
 */
const APARENCIA: Record<TipoDaTela, AparenciaDaTela> = {
  income: {
    Icone: TrendingUp,
    cor: "text-success",
    rotaDeLancar: "/dashboard/movimentacoes/receita",
    textoDeLancar: "Nova Receita",
    palavraDaLinha: "Receita",
  },
  expense: {
    Icone: TrendingDown,
    cor: "text-destructive",
    rotaDeLancar: "/dashboard/movimentacoes/despesa",
    textoDeLancar: "Nova Despesa",
    palavraDaLinha: "Despesa",
  },
  transfer: {
    Icone: ArrowRightLeft,
    cor: "text-info",
    rotaDeLancar: ROTA_DA_TRANSFERENCIA,
    textoDeLancar: "Nova Transferência",
    palavraDaLinha: "Transferência",
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

  /**
   * O periodo como querystring, calculado FORA da leitura.
   *
   * `periodo` e um objeto novo a cada render (`lerPeriodo` constroi um), entao
   * passa-lo adiante faria a busca repetir para sempre -- o `useEffect` de
   * `ListaDeMovimentacao` depende do `carregar`, que mudaria em cada render. E
   * uma lista de dependencias com `periodo.de, periodo.ate` e desonesta: o lint
   * cobra `periodo` e tem razao, porque e `periodo` que o corpo le.
   *
   * Uma STRING resolve as duas coisas: ela e comparada por VALOR, entao e
   * estavel enquanto o periodo nao muda. E `periodoParaQuery` continua sendo
   * quem escolhe os nomes `de`/`ate` -- montar a querystring a mao aqui os
   * separaria dos que `periodoDaQuery` le na rota, e um `?from=` contra um
   * `get("de")` cai no mes corrente em silencio: o seletor pareceria nao
   * funcionar, sem erro nenhum.
   */
  const queryDoPeriodo = periodoParaQuery(periodo);

  /**
   * Trocar de periodo troca a URL -- e e a URL que manda.
   *
   * `router.push` e nao `setState`: o periodo vive na querystring, entao o link
   * que a pessoa manda mostra o mes dela e o botao voltar do navegador anda
   * entre periodos. A leitura refaz sozinha porque `queryDoPeriodo` muda.
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

      <ListaDeMovimentacao
        tipo={tipo}
        tela={tela}
        aparencia={aparencia}
        queryDoPeriodo={queryDoPeriodo}
        rotuloDoPeriodo={rotuloDoPeriodo(periodo)}
        origem={origem}
        rodape={
          <>
            {/*
              O CAMINHO DE VOLTA PARA O MES CORRENTE.
              Quem navegou para agosto e nao encontrou nada precisa saber que
              outros periodos existem -- sem isto, "Nenhum lançamento" se le como
              "a minha conta esta vazia", com trezentos lançamentos a uma seta de
              distancia.

              ELE VEM POR `rodape` E NAO MORA NA LISTA porque depende do
              `router`, e `next/navigation` dentro de `ListaDeMovimentacao`
              derrubaria a sonda de navegador no import. O LUGAR continua o
              mesmo de antes da HMO-301: dentro do ramo em que a leitura deu
              certo.
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
              <div className="space-y-1 text-xs text-muted-foreground">
                {/*
                  O GASTO NO CARTAO, DITO ONDE ELE FALTA (HMO-260).
                  "Realizado no periodo nunca deve considerar despesas no cartao.
                  Pois ja considera a fatura do cartao pro periodo, entao gastos
                  do cartao devem aparecer apenas no financas pessoais que lista o
                  que voce lancou, e dentro do cartao de credito."

                  A compra sai do Realizado porque ela esta DENTRO da fatura, que
                  o Previsto acima ja soma inteira. Esta frase existe porque sem
                  ela a conta nao fecha aos olhos de quem gasta no cartao: a lista
                  de Financas Pessoais do mesmo mes mostra as compras uma a uma, e
                  o Realizado daqui nao -- e o caminho dessa estranheza termina em
                  alguem lancando a compra outra vez no debito para "consertar".

                  A SEGUNDA ORACAO NAO E ENFEITE. "Esta no Previsto acima" so e
                  verdade enquanto a fatura NAO foi paga: a baixa marca a previsao
                  como `paid` (que sai do previsto pela armadilha 2) e grava uma
                  TRANSFERENCIA de duas pernas (`pernasDoPagamentoDeFatura`), que
                  nao e despesa em tela nenhuma. No mes em que a pessoa paga a
                  fatura, esta tela mostra R$ 0,00 de cartao -- medido. Sem dizer
                  para onde o valor foi, a frase apontaria para um Previsto vazio,
                  que e pior que nao ter frase.
                */}
                <p>
                  Compra no cartão não entra no Realizado: ela está dentro da{" "}
                  <strong>fatura</strong>. Enquanto a fatura está aberta, o
                  Previsto acima já a soma inteira; depois de paga, ela aparece em{" "}
                  <Link
                    href="/dashboard/transferencias"
                    className="underline hover:text-foreground"
                  >
                    Transferências
                  </Link>
                  , porque o dinheiro foi da sua conta para o cartão. Para ver as
                  compras uma a uma, abra{" "}
                  <Link
                    href="/dashboard/cartoes"
                    className="underline hover:text-foreground"
                  >
                    Cartões
                  </Link>{" "}
                  ou{" "}
                  <Link
                    href="/dashboard/personal-finance"
                    className="underline hover:text-foreground"
                  >
                    Finanças Pessoais
                  </Link>
                  .
                </p>
                <p>
                  Sua parte das despesas de grupo que outra pessoa pagou também
                  não entra nestes totais — ela aparece em{" "}
                  <Link
                    href="/dashboard/personal-finance"
                    className="underline hover:text-foreground"
                  >
                    Finanças Pessoais
                  </Link>
                  , onde a lista junta as duas origens.
                </p>
              </div>
            )}
          </>
        }
      />
    </div>
  );
}
