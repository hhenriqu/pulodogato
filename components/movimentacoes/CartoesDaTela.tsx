"use client";

// -----------------------------------------------------------------------------
// OS TRES NUMEROS DA ISSUE: Total, Previsto e Realizado (HMO-246)
// -----------------------------------------------------------------------------
// "Essas telas devem contar apenas com Total, Previsto, Realizado."
//
// ARQUIVO PROPRIO, E ISSO NAO E ORGANIZACAO
// -----------------------------------------
// E o que torna estes tres cartoes TESTAVEIS. `TelaDeMovimentacao.tsx` importa
// `next/navigation` no topo, e `next/navigation` NAO roda no node: ele e
// resolvido pelo runtime do Next (ver o cabecalho de
// scripts/resolve-next-subpaths.mjs). Com os cartoes la dentro, um teste que
// renderizasse a marcacao morreria no import -- e e por isso que este recorte
// mora aqui, sem hook nenhum. Props entram, marcacao sai.
//
// AS DUAS CLASSES DE DEFEITO QUE SO A MARCACAO DENUNCIA
// ----------------------------------------------------
//   1. NUMERO CERTO NO CARTAO ERRADO. `resumoDaTela` tem 34 assercoes e 26
//      mutantes, e TODAS passariam verdes com o JSX imprimindo `previsto` no
//      cartao "Realizado": a aritmetica estaria exata e a tela ignorando ela.
//      Nao quebra build, nao fica vazio, e os dois numeros sao plausiveis. A
//      unica coisa que denuncia e ler o HTML.
//
//   2. O ZERO CONFIANTE. Sem leitura, estes cartoes NAO podem imprimir
//      "R$ 0,00". Numa tela que responde "quanto eu gastei neste mes", um zero
//      sem dado atras nao parece erro -- parece um mes barato. E "nao aparece"
//      e propriedade da marcacao: nenhum teste de funcao pura alcanca.
//
// Ver scripts/test-cartoes-da-tela.mjs.
//
// TRES CARTOES, E SO TRES
// -----------------------
// O que nao e cartao fica escrito em uma linha embaixo do cartao a que
// pertence: o previsto que JA VENCEU e nota do cartao "Previsto". Na tela de
// Despesas um quarto cartao vermelho seria lido como mais uma divida; na de
// Receitas ele diria que o atraso de quem paga voce e divida sua.
// -----------------------------------------------------------------------------

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NumeroIndisponivel } from "@/components/SemRede";
import { podeMostrarNumero, type EstadoDaLeitura } from "@/lib/offline-leitura";
import type {
  ResumoDaTela,
  TelaDeMovimentacao as TelaDoCatalogo,
} from "@/lib/telas-de-movimentacao";

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor);

export function CartoesDaTela({
  tela,
  cor,
  resumo,
  vencido,
  estado,
}: {
  /** A tela do catalogo: e dela que saem as duas legendas. */
  tela: TelaDoCatalogo;
  /** A classe de cor da tela, em token. Ver `APARENCIA` no container. */
  cor: string;
  /** `null` = nao houve leitura. Nenhum numero pode sair daqui. */
  resumo: ResumoDaTela | null;
  vencido: { total: number; quantidade: number };
  estado: EstadoDaLeitura | null;
}) {
  /**
   * O valor, ou o travessao.
   *
   * A porta unica de todo numero destes cartoes. `podeMostrarNumero` responde
   * "ha dado atras disto" (ver lib/offline-leitura.ts) e `resumo` responde "a
   * resposta trouxe o campo" -- as duas condicoes, porque uma resposta antiga
   * guardada no aparelho pode ser `ok` e nao ter `resumo`.
   */
  const numero = (valor: number | undefined) =>
    podeMostrarNumero(estado) && resumo ? (
      moeda(valor ?? 0)
    ) : (
      <NumeroIndisponivel />
    );

  return (
    /* grid-cols-1 explicito: sem ele o `grid` estoura a largura no celular e a
       pagina ganha scroll horizontal. */
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Total</CardDescription>
          <CardTitle className={`text-2xl ${cor}`}>
            {numero(resumo?.total)}
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            previsto + realizado ·{" "}
            {podeMostrarNumero(estado) && resumo
              ? `${resumo.quantidade} lançamento(s)`
              : "—"}
          </p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Previsto</CardDescription>
          <CardTitle className="text-2xl">{numero(resumo?.previsto)}</CardTitle>
          <p className="text-xs text-muted-foreground">{tela.oQueOPrevistoE}</p>
          {/*
            O VENCIDO E NOTA, NAO CARTAO. A issue pede tres numeros, e o
            sentido desta linha muda com a tela: em Despesas e divida sua
            atrasada; em Receitas e atraso de quem paga voce. Um quarto cartao
            vermelho diria a mesma coisa nas duas.

            `podeMostrarNumero` tambem aqui, e nao so nos tres: "R$ 400 já
            venceu" dito sobre um cache de ontem e uma divida que pode ja ter
            sido paga.
          */}
          {podeMostrarNumero(estado) && vencido.quantidade > 0 && (
            <p className="text-xs text-warning">
              {moeda(vencido.total)} em {vencido.quantidade}{" "}
              {vencido.quantidade === 1 ? "linha" : "linhas"} que já
              {vencido.quantidade === 1 ? " venceu" : " venceram"}
            </p>
          )}
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Realizado</CardDescription>
          <CardTitle className="text-2xl">{numero(resumo?.realizado)}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {tela.oQueORealizadoE}
          </p>
        </CardHeader>
      </Card>
    </div>
  );
}
