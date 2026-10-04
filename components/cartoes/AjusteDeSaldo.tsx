"use client";

// ---------------------------------------------------------------------------
// O AJUSTE DE SALDO DA FATURA, NA TELA DO CARTAO (HMO-253)
// ---------------------------------------------------------------------------
// "Possibilidade de lancar um ajuste de saldo para que a fatura fique igual a
// real sem ter que discriminar o que foi o gasto."
//
// SEM `fetch` E SEM HOOK DE DADOS, pelo mesmo motivo que `FaturaDoCartao` e
// `CamposDeLancamento`: so assim o teste renderiza a tela de verdade com
// `react-dom/server` e afirma sobre o HTML que sai. Quem fala com
// `/api/card-invoices/ajuste` e a pagina.
//
// O CAMPO E "QUANTO O CARTAO DIZ HOJE", E NAO O VALOR DO AJUSTE
// -------------------------------------------------------------
// 2a volta da HMO-253: "deve ser automatico, eu lanco o valor real que esta hoje
// meu cartao e um metodo verifica se e menor ou maior que a fatura, e lanca a
// diferenca somando ou subtraindo."
//
// O que o usuario tem na mao e o numero do app do banco. A versao anterior pedia
// a DIFERENCA e o LADO (dois botoes), isto e, pedia a subtracao de cabeca -- e a
// subtracao de cabeca e feita contra o total que esta na tela, que pode estar
// velho. Agora quem subtrai e o servidor, sobre o total que ele le na hora.
//
// A PREVIA DESTE BLOCO E, POR ISSO, UMA PREVIA E NAO A CONTA FINAL. Ela usa o
// total que a tela carregou; a rota recalcula e pode gravar outra diferenca (se
// uma compra entrou nesse meio). A previa diz o que o usuario precisa decidir
// ("vai acrescentar ou abater?"), e a resposta da rota e que imprime o numero
// que FICOU -- ver `total_da_fatura` em /api/card-invoices/ajuste.
//
// AS QUATRO COISAS QUE ESTE BLOCO NAO PODE FAZER
// ----------------------------------------------
//   1. Imprimir numero sem ter conseguido ler. Todo valor passa por
//      `podeMostrarNumero()`, igual ao resto da tela.
//   2. Dizer "esta fatura nao tem ajuste" sem ter conseguido conferir. A
//      resposta da rota distingue "a consulta falhou" (campo ausente) de "nao
//      ha ajuste" (`null`), e `podeConferirAjuste` e o pedagio. Sem ele, o
//      bloco ofereceria "Ajustar saldo" sobre uma fatura JA ajustada.
//   3. Mostrar a previa com o mes de fora. "A fatura passa de X para Y" sem
//      dizer QUAL fatura e um numero certo respondendo uma pergunta que o
//      leitor nao sabe qual e -- o mesmo defeito que o total da fatura evita
//      andando junto do rotulo do mes.
//   4. Oferecer "Salvar" com cara de erro quando a fatura JA BATE. Digitar o
//      numero do banco e descobrir que ele coincide com as compras e o melhor
//      resultado possivel, e tem texto proprio -- com o aviso de que o ajuste
//      que estiver gravado vai sair, porque e isso que a rota faz.
// ---------------------------------------------------------------------------

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CampoDeValor } from "@/components/ui/campo-de-valor";
import { Scale } from "lucide-react";
import { formatarValor } from "@/lib/dinheiro";
import { podeMostrarNumero, type EstadoDaLeitura } from "@/lib/offline-leitura";
import { NumeroIndisponivel } from "@/components/SemRede";
import {
  ajusteParaFecharEm,
  podeConferirAjuste,
  totalComOAjuste,
  type CategoriaDeAjuste,
} from "@/lib/ajuste-de-fatura";

interface AjusteDeSaldoProps {
  /** 'outubro de 2026'. `null` quando o mes nao da para ler -- ver o item 3. */
  rotuloDoMes: string | null;
  moeda?: string;
  /** A mais pessimista das leituras da pagina. `null` = ainda carregando. */
  estado: EstadoDaLeitura | null;
  /** A categoria reservada do usuario. `undefined` = nao deu para conferir. */
  categoriaDeAjuste: CategoriaDeAjuste;
  /** O ajuste que ja esta valendo, COMO A FATURA O VE. `null` = nao ha. */
  valorAtual: number | null;
  /**
   * O total da fatura sem ajuste nenhum. E a base da previa.
   *
   * `null` quando a tela nao conseguiu ler a fatura: sem ele nao ha subtracao
   * possivel, e um `0` no lugar faria a previa anunciar um ajuste do valor
   * INTEIRO que o usuario digitou. Ver a armadilha 3 de `ajusteParaFecharEm`.
   */
  totalSemAjuste: number | null;
  /** O formulario esta aberto? Quem abre e fecha e a pagina. */
  aberto: boolean;
  /**
   * QUANTO O CARTAO DIZ HOJE, em notacao plana ("1290.00"), como `CampoDeValor`
   * emite. Nao e o valor do ajuste -- ver o cabecalho.
   */
  saldoReal: string;
  descricao: string;
  salvando?: boolean;
  aoAbrir: () => void;
  aoFechar: () => void;
  aoMudarSaldoReal: (valorPlano: string) => void;
  aoMudarDescricao: (descricao: string) => void;
  aoSalvar: () => void;
  aoRemover: () => void;
}

export function AjusteDeSaldo({
  rotuloDoMes,
  moeda,
  estado,
  categoriaDeAjuste,
  valorAtual,
  totalSemAjuste,
  aberto,
  saldoReal,
  descricao,
  salvando,
  aoAbrir,
  aoFechar,
  aoMudarSaldoReal,
  aoMudarDescricao,
  aoSalvar,
  aoRemover,
}: AjusteDeSaldoProps) {
  const mostraNumero = podeMostrarNumero(estado);
  const podeConferir = podeConferirAjuste(categoriaDeAjuste);

  // `ajusteParaFecharEm` e a MESMA funcao que a rota chama, de proposito. Uma
  // conta propria aqui discordaria do que o POST grava no caso que ninguem
  // testa -- e a previa e a unica coisa que o usuario le antes de confirmar.
  const calculado = ajusteParaFecharEm({ saldoReal, totalSemAjuste });
  // `fecha` e `previa` sao estados DIFERENTES, e nenhum deles e erro: ver a
  // armadilha 4 do cabecalho. `previa` so existe quando ha diferenca a lancar.
  const fecha = calculado.ok && calculado.fecha;
  const previa =
    calculado.ok && !calculado.fecha && totalSemAjuste !== null
      ? totalComOAjuste(totalSemAjuste, calculado.valorNaFatura)
      : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4 text-muted-foreground" />
              Ajuste de saldo
            </CardTitle>
            <CardDescription>
              Para a fatura fechar igual à do banco sem detalhar o que foi o
              gasto.
            </CardDescription>
          </div>

          {/* ----------------------------------------------------------------
              O ESTADO ATUAL. Tres situacoes, e nenhuma pode ser confundida
              com outra: nao deu para conferir, nao ha ajuste, ha ajuste.
              ---------------------------------------------------------------- */}
          {!podeConferir ? (
            <Badge variant="outline" className="border-warning/30 text-warning">
              Não foi possível conferir
            </Badge>
          ) : valorAtual !== null ? (
            <Badge variant="outline" className="border-info/30 text-info">
              {mostraNumero ? (
                <>
                  {valorAtual >= 0 ? "+" : "−"}
                  {formatarValor(Math.abs(valorAtual), moeda)} nesta fatura
                </>
              ) : (
                <NumeroIndisponivel />
              )}
            </Badge>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* O bloco NAO afirma "esta fatura nao tem ajuste" quando nao deu para
            conferir, e tambem nao oferece gravar: um POST daqui reescreveria um
            ajuste que a tela nao sabe que existe. */}
        {!podeConferir ? (
          <p className="text-sm text-muted-foreground">
            Não foi possível conferir se esta fatura tem ajuste de saldo agora.
            Recarregue antes de lançar um, para não trocar um ajuste sem querer.
          </p>
        ) : !aberto ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={aoAbrir}>
              {valorAtual !== null ? "Alterar ajuste" : "Ajustar saldo"}
            </Button>
            {valorAtual !== null && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={aoRemover}
                disabled={salvando}
              >
                Remover ajuste
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="saldo-real-do-cartao" className="text-xs">
                  Quanto o cartão diz hoje
                </Label>
                {/* O campo de dinheiro deste app: MOSTRA "R$ 1.290,00" e EMITE
                    "1290.00". Um `<input type="number">` aqui gravaria 1 real
                    quando alguem digitasse "1.290,00" (ver lib/dinheiro.ts). */}
                <CampoDeValor
                  id="saldo-real-do-cartao"
                  value={saldoReal}
                  onChange={aoMudarSaldoReal}
                  moeda={moeda}
                  placeholder="R$ 0,00"
                />
                {/* O campo pede um numero que NAO e o do app, e sem esta linha
                    ele e indistinguivel do campo de valor que estava aqui antes
                    -- quem usou a versao anterior digitaria a diferenca, e a
                    diferenca da diferenca e um ajuste errado plausivel. */}
                <p className="text-xs text-muted-foreground">
                  O total da fatura no app do banco. A diferença é calculada e
                  lançada sozinha.
                </p>
              </div>

              <div className="space-y-1">
                <Label htmlFor="descricao-do-ajuste" className="text-xs">
                  Descrição (opcional)
                </Label>
                <Input
                  id="descricao-do-ajuste"
                  value={descricao}
                  onChange={(evento) => aoMudarDescricao(evento.target.value)}
                  placeholder="IOF, anuidade, compra não lançada…"
                  maxLength={120}
                />
              </div>
            </div>

            {/* --------------------------------------------------------------
                A PREVIA, COM O MES NO ROTULO. "Passa de X para Y" sozinho nao
                diz de que fatura ele fala, e o seletor de mes fica dois blocos
                acima -- o numero certo respondendo uma pergunta que o leitor
                nao sabe qual e.

                Ela tambem exige `mostraNumero`: a base da conta e o total da
                fatura, e uma previa calculada sobre uma fatura que a tela nao
                conseguiu ler e um numero inventado com cara de numero certo.

                O VALOR DA DIFERENCA VAI NA FRASE, e nao so o total final. "Passa
                de 1.240 para 1.290" obriga o leitor a subtrair para saber o que
                esta sendo lancado -- e era justamente a subtracao que esta volta
                da issue tirou das maos dele.
                -------------------------------------------------------------- */}
            {previa !== null &&
            calculado.ok &&
            !calculado.fecha &&
            totalSemAjuste !== null &&
            mostraNumero &&
            rotuloDoMes ? (
              <p className="text-sm text-muted-foreground">
                A fatura de {rotuloDoMes} passa de{" "}
                <span className="font-medium text-foreground">
                  {formatarValor(totalSemAjuste, moeda)}
                </span>{" "}
                para{" "}
                <span className="font-semibold text-foreground">
                  {formatarValor(previa, moeda)}
                </span>{" "}
                —{" "}
                {calculado.valorNaFatura > 0 ? "acréscimo de " : "abatimento de "}
                <span className="font-medium text-foreground">
                  {formatarValor(Math.abs(calculado.valorNaFatura), moeda)}
                </span>
                .
              </p>
            ) : null}

            {/* A FATURA JA BATE. Nao e erro, e nao usa a cor de erro -- e o
                resultado que o usuario queria. O aviso do ajuste que vai sair e
                obrigatorio: sem ele, "Salvar" sobre uma fatura que bate REMOVE
                dinheiro da fatura sem nada na tela ter dito isso. */}
            {fecha && mostraNumero && rotuloDoMes ? (
              <p className="text-sm text-muted-foreground">
                A fatura de {rotuloDoMes} já fecha nesse valor
                {valorAtual !== null ? (
                  <>
                    {" "}
                    — não há diferença a lançar, e o ajuste de{" "}
                    <span className="font-medium text-foreground">
                      {formatarValor(Math.abs(valorAtual), moeda)}
                    </span>{" "}
                    que está valendo vai ser removido.
                  </>
                ) : (
                  <>: não há diferença a lançar.</>
                )}
              </p>
            ) : null}

            {/* O erro sai da MESMA funcao que a rota usa: o que a tela recusa e
                o que o servidor recusaria, com o mesmo texto. Com o campo vazio
                nao ha erro a mostrar -- quem acabou de abrir o formulario nao
                errou nada ainda. */}
            {!calculado.ok && saldoReal.trim() !== "" ? (
              <p className="text-sm text-destructive">{calculado.erro}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {/* `disabled` em dois casos a mais que `salvando`:
                    - a conta nao fecha (campo vazio, valor ilegivel, total da
                      fatura que nao deu para ler). Sem isso o botao manda um
                      POST que o servidor recusa, e o usuario descobre pelo toast
                      de erro o que a tela ja sabia;
                    - a fatura ja bate E nao ha ajuste gravado. Ai nao existe
                      nada a gravar nem a remover, e um botao ativo prometendo
                      "Salvar ajuste" sobre um no-op e pior que um botao apagado
                      ao lado da frase que explica por que. */}
              <Button
                size="sm"
                onClick={aoSalvar}
                disabled={
                  salvando || !calculado.ok || (fecha && valorAtual === null)
                }
              >
                {salvando
                  ? "Salvando…"
                  : fecha && valorAtual !== null
                    ? "Remover ajuste"
                    : "Salvar ajuste"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={aoFechar}
                disabled={salvando}
              >
                Cancelar
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
