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
import { LEGENDA_DO_BRUTO } from "@/lib/legenda-do-bruto-e-do-liquido";
import type {
  ResumoComReembolso,
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
  /**
   * `null` = nao houve leitura. Nenhum numero pode sair daqui.
   *
   * `ResumoComReembolso` e nao `ResumoDaTela` desde a HMO-364: o reembolso
   * previsto do grupo entra DENTRO de `previsto` na aba Receitas, e sem o campo
   * ao lado nao ha como a tela dizer que ele esta ali -- um valor a mais sem
   * rotulo e indistinguivel de bug.
   */
  resumo: ResumoComReembolso | null;
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

          {/*
            O REEMBOLSO DO GRUPO, DITO ONDE ELE ESTA (HMO-364, fase F3).

            O valor JA ESTA dentro do numero acima -- `resumoComReembolsoPrevisto`
            o soma no «Previsto» da aba Receitas. Esta linha existe porque sem
            ela ele seria invisivel: o cartao subiria R$ 300 e nada na tela
            diria de onde vieram, que e o quinto numero sem rotulo da familia
            `despesa-de-grupo-tem-tres-convencoes`.

            E ela diz PREVISTO em voz alta, porque o risco de leitura e o
            contrario: "a receber" num cartao verde se le como dinheiro que ja
            entrou. A Lais pode nao pagar, e a conta do grupo tambem pode nao
            ser paga -- as duas pontas sao promessa, e e por isso que as duas
            estao no previsto e nenhuma no realizado.

            `podeMostrarNumero` tambem aqui, e pelo motivo do vencido logo
            acima: "R$ 300 a receber" dito sobre um cache de ontem pode ja ter
            sido pago.
          */}
          {podeMostrarNumero(estado) && resumo?.reembolso_previsto && (
            <p className="text-xs text-muted-foreground">
              inclui {moeda(resumo.reembolso_previsto.total)} de reembolso
              previsto de {resumo.reembolso_previsto.quantos}{" "}
              {resumo.reembolso_previsto.quantos === 1 ? "pessoa" : "pessoas"} em{" "}
              {resumo.reembolso_previsto.grupos}{" "}
              {resumo.reembolso_previsto.grupos === 1 ? "grupo" : "grupos"} —
              ainda não recebido
            </p>
          )}

          {/*
            A PERGUNTA QUE ESTE NUMERO RESPONDE (HMO-364, fase F5).

            So na aba Despesas, e ela e entrega e nao enfeite: desde a fase F1b
            este «Previsto» conta a conta de grupo que a pessoa paga INTEIRA, e
            o cartao «Quanto ainda posso gastar» do painel conta so a parte
            dela. Os dois numeros estao certos e vao discordar na mesma
            navegacao. Sem esta linha, o menor dos dois se le como conta
            perdida, e o caminho dessa estranheza termina em alguem
            "consertando" a conta por fora.

            O texto mora em lib/legenda-do-bruto-e-do-liquido.ts junto com o do
            outro lado: editar um e esquecer o outro produz duas legendas que se
            contradizem, que e pior do que nenhuma.
          */}
          {tela.tipo === "expense" && (
            <p className="text-xs text-muted-foreground">{LEGENDA_DO_BRUTO}</p>
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
