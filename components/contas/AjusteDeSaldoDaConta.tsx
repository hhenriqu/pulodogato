"use client";

// ---------------------------------------------------------------------------
// O AJUSTE DE SALDO DA CONTA, NO DIALOGO DA LISTA DE CONTAS (HMO-409)
// ---------------------------------------------------------------------------
// "Ajuste de saldo tambem para contas, nao so para cartao."
//
// POR QUE UM COMPONENTE NOVO, E NAO `components/cartoes/AjusteDeSaldo.tsx`
// COM PROPS
// -----------------------------------------------------------------------
// A aritmetica e reusada (ela e a MESMA funcao -- ver `ajusteParaOSaldoFicarEm`),
// a casca nao. Generalizar o bloco do cartao exigiria prop de mes, prop de
// rotulo de fatura e um `if` em cada frase, e cada edicao dessas MOVE o endereco
// das assercoes de `npm run test:ajuste-na-tela` sem nenhuma delas ficar
// vermelha: a suite continuaria verde medindo outro componente. Nesta base isso
// ja custou tempo. Duplicar a casca e reusar a aritmetica e o caminho barato.
//
// SEM `fetch` E SEM HOOK DE DADOS, pelo mesmo motivo do bloco do cartao: so
// assim o teste renderiza a tela de verdade com `react-dom/server` e afirma
// sobre o HTML que sai. Quem fala com `/api/financial-accounts/ajuste` e a
// pagina.
//
// E SEM O `<Dialog>` EM VOLTA, que fica na pagina: o `DialogContent` do Radix
// so existe atras de um portal e de um estado de abertura, e um teste de
// servidor sobre ele nao renderiza o conteudo -- a suite mediria uma casca
// vazia e passaria verde com o formulario inteiro apagado.
//
// AS CINCO COISAS QUE ESTE BLOCO NAO PODE FAZER
// ---------------------------------------------
//   1. Imprimir numero sem ter conseguido ler. Todo valor passa por
//      `podeMostrarNumero()`, igual ao resto da tela.
//   2. Dizer "esta conta nao tem ajuste" sem ter conseguido conferir. A pagina
//      distingue "o GET falhou" (`podeConferir` falso) de "nao ha ajuste neste
//      dia" (`valorAtual` nulo). Sem o pedagio, o bloco ofereceria "Ajustar
//      saldo" sobre uma conta JA ajustada, e a pessoa somaria a mesma
//      diferenca de novo.
//   3. Mostrar a previa sem dizer QUAL conta e EM QUE DIA. O dia nao e
//      decoracao aqui: e ele que decide em que mes do grafico de patrimonio o
//      degrau aparece, e e ele que forma a chave canonica -- "o saldo passa
//      para X" sem data e um numero certo respondendo uma pergunta que o leitor
//      nao sabe qual e.
//   4. Oferecer "Salvar" com cara de erro quando a conta JA BATE. Digitar o
//      numero do banco e descobrir que ele coincide com os lancamentos e o
//      melhor resultado possivel, e tem texto proprio -- com o aviso de que o
//      ajuste que estiver gravado vai sair, porque e isso que a rota faz.
//   5. Chamar a diferenca de "acrescimo" ou "abatimento". No cartao, positivo
//      quer dizer MAIS DIVIDA; aqui quer dizer MAIS DINHEIRO. Herdar o
//      vocabulario do cartao poria a palavra que significa "voce deve mais" em
//      cima de um saldo que subiu.
// ---------------------------------------------------------------------------

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CampoDeValor } from "@/components/ui/campo-de-valor";
import { formatarValor } from "@/lib/dinheiro";
import { dataNaTela } from "@/lib/data-na-tela";
import { podeMostrarNumero, type EstadoDaLeitura } from "@/lib/offline-leitura";
import { NumeroIndisponivel } from "@/components/SemRede";
import {
  ajusteParaOSaldoFicarEm,
  saldoComOAjuste,
} from "@/lib/ajuste-de-saldo-da-conta";

interface AjusteDeSaldoDaContaProps {
  /** O nome da conta, para a frase da previa nomear o que vai mudar. */
  nomeDaConta: string;
  /** O dia do ajuste, 'AAAA-MM-DD'. E a chave canonica e a data do lancamento. */
  data: string;
  moeda?: string;
  /** A mais pessimista das leituras da pagina. `null` = ainda carregando. */
  estado: EstadoDaLeitura | null;
  /**
   * O GET do ajuste deste dia respondeu? `false` = nao da para afirmar nada
   * sobre o ajuste desta conta -- ver o item 2 do cabecalho.
   */
  podeConferir: boolean;
  /**
   * O ajuste que ja esta valendo, COMO ELE MOVE O SALDO (`amount` cru, positivo
   * sobe). `null` = nao ha ajuste neste dia.
   */
  valorAtual: number | null;
  /**
   * O saldo da conta SEM ajuste nenhum. E a base da previa.
   *
   * `null` quando a pagina nao conseguiu ler: sem ele nao ha subtracao
   * possivel, e um `0` no lugar faria a previa anunciar um ajuste do valor
   * INTEIRO que a pessoa digitou.
   */
  saldoSemAjuste: number | null;
  /**
   * QUANTO A CONTA MOSTRA HOJE, em notacao plana ("2380.00"), como
   * `CampoDeValor` emite. Nao e o valor do ajuste -- ver o cabecalho.
   */
  saldoReal: string;
  descricao: string;
  salvando?: boolean;
  aoMudarSaldoReal: (valorPlano: string) => void;
  aoMudarDescricao: (descricao: string) => void;
  aoSalvar: () => void;
  aoRemover: () => void;
  aoFechar: () => void;
}

export function AjusteDeSaldoDaConta({
  nomeDaConta,
  data,
  moeda,
  estado,
  podeConferir,
  valorAtual,
  saldoSemAjuste,
  saldoReal,
  descricao,
  salvando,
  aoMudarSaldoReal,
  aoMudarDescricao,
  aoSalvar,
  aoRemover,
  aoFechar,
}: AjusteDeSaldoDaContaProps) {
  const mostraNumero = podeMostrarNumero(estado);
  const diaNaTela = dataNaTela(data);

  // `ajusteParaOSaldoFicarEm` delega em `ajusteParaFecharEm` -- a MESMA funcao
  // que a rota chama, de proposito. Uma conta propria aqui discordaria do que o
  // POST grava no caso que ninguem testa, e a previa e a unica coisa que a
  // pessoa le antes de confirmar.
  const calculado = ajusteParaOSaldoFicarEm({ saldoReal, saldoSemAjuste });
  // `fecha` e `previa` sao estados DIFERENTES, e nenhum deles e erro: ver o
  // item 4 do cabecalho. `previa` so existe quando ha diferenca a lancar.
  const fecha = calculado.ok && calculado.fecha;
  const previa =
    calculado.ok && !calculado.fecha && saldoSemAjuste !== null
      ? saldoComOAjuste(saldoSemAjuste, calculado.valorNaFatura)
      : null;

  if (!podeConferir) {
    // Nem afirma que nao ha ajuste, nem oferece gravar: um POST daqui
    // reescreveria um ajuste que a tela nao sabe que existe.
    return (
      <div className="space-y-4">
        <Badge variant="outline" className="border-warning/30 text-warning">
          Não foi possível conferir
        </Badge>
        <p className="text-sm text-muted-foreground">
          Não foi possível conferir se {nomeDaConta} já tem ajuste de saldo em{" "}
          {diaNaTela}. Recarregue antes de lançar um, para não trocar um ajuste
          sem querer.
        </p>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={aoFechar}>
            Fechar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Digite o saldo que o banco mostra hoje. A diferença é lançada como um
          movimento em {diaNaTela} — o saldo não é reescrito por cima, para o
          histórico de patrimônio dos meses anteriores continuar igual.
        </p>

        {/* O ESTADO ATUAL, quando ha ajuste. "Nao deu para conferir" ja saiu
            acima, no ramo que nem oferece o formulario. */}
        {valorAtual !== null ? (
          <Badge variant="outline" className="border-info/30 text-info">
            {mostraNumero ? (
              <>
                {valorAtual >= 0 ? "+" : "−"}
                {formatarValor(Math.abs(valorAtual), moeda)} neste dia
              </>
            ) : (
              <NumeroIndisponivel />
            )}
          </Badge>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="saldo-real-da-conta" className="text-xs">
            Quanto a conta mostra hoje
          </Label>
          {/* O campo de dinheiro deste app: MOSTRA "R$ 2.380,00" e EMITE
              "2380.00". Um `<input type="number">` aqui gravaria 2 reais
              quando alguem digitasse "2.380,00" (ver lib/dinheiro.ts). */}
          <CampoDeValor
            id="saldo-real-da-conta"
            value={saldoReal}
            onChange={aoMudarSaldoReal}
            moeda={moeda}
            placeholder="R$ 0,00"
          />
          {/* O campo pede o saldo, e nao a diferenca. Sem esta linha ele e
              indistinguivel de um campo de valor comum -- e quem digitar a
              diferenca grava a diferenca da diferenca. */}
          <p className="text-xs text-muted-foreground">
            O saldo no app do banco. A diferença é calculada e lançada sozinha.
          </p>
        </div>

        <div className="space-y-1">
          <Label htmlFor="descricao-do-ajuste-da-conta" className="text-xs">
            Descrição (opcional)
          </Label>
          <Input
            id="descricao-do-ajuste-da-conta"
            value={descricao}
            onChange={(evento) => aoMudarDescricao(evento.target.value)}
            placeholder="Tarifa, rendimento, lançamento não registrado…"
            maxLength={120}
          />
        </div>
      </div>

      {/* ------------------------------------------------------------------
          A PREVIA, COM A CONTA E O DIA NO ROTULO. Ver o item 3.

          Ela tambem exige `mostraNumero`: a base da conta e o saldo, e uma
          previa calculada sobre um saldo que a tela nao conseguiu ler e um
          numero inventado com cara de numero certo.

          O VALOR DA DIFERENCA VAI NA FRASE, e nao so o saldo final: "passa de
          2.430 para 2.380" obriga o leitor a subtrair para saber o que esta
          sendo lancado, e era justamente a subtracao que esta feature tirou das
          maos dele.

          "ENTRADA" E "SAIDA", e nao "acrescimo"/"abatimento" do cartao: aqui o
          positivo quer dizer que apareceu dinheiro, e nao que a divida subiu.
          ------------------------------------------------------------------ */}
      {previa !== null &&
      calculado.ok &&
      !calculado.fecha &&
      saldoSemAjuste !== null &&
      mostraNumero ? (
        <p className="text-sm text-muted-foreground">
          O saldo de {nomeDaConta} passa de{" "}
          <span className="font-medium text-foreground">
            {formatarValor(saldoSemAjuste, moeda)}
          </span>{" "}
          para{" "}
          <span className="font-semibold text-foreground">
            {formatarValor(previa, moeda)}
          </span>{" "}
          — {calculado.valorNaFatura > 0 ? "entrada de " : "saída de "}
          <span className="font-medium text-foreground">
            {formatarValor(Math.abs(calculado.valorNaFatura), moeda)}
          </span>{" "}
          em {diaNaTela}.
        </p>
      ) : null}

      {/* A CONTA JA BATE. Nao e erro, e nao usa a cor de erro -- e o resultado
          que a pessoa queria. O aviso do ajuste que vai sair e obrigatorio: sem
          ele, "Salvar" sobre uma conta que bate REMOVE dinheiro do saldo sem
          nada na tela ter dito isso. */}
      {fecha && mostraNumero ? (
        <p className="text-sm text-muted-foreground">
          O saldo de {nomeDaConta} já é esse
          {valorAtual !== null ? (
            <>
              {" "}
              — não há diferença a lançar, e o ajuste de{" "}
              <span className="font-medium text-foreground">
                {formatarValor(Math.abs(valorAtual), moeda)}
              </span>{" "}
              de {diaNaTela} vai ser removido.
            </>
          ) : (
            <>: não há diferença a lançar.</>
          )}
        </p>
      ) : null}

      {/* O erro sai da MESMA funcao que a rota usa: o que a tela recusa e o que
          o servidor recusaria, com o mesmo texto. Com o campo vazio nao ha erro
          a mostrar -- quem acabou de abrir o formulario nao errou nada ainda. */}
      {!calculado.ok && saldoReal.trim() !== "" ? (
        <p className="text-sm text-destructive">{calculado.erro}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        {valorAtual !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={aoRemover}
            disabled={salvando}
          >
            Remover ajuste
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={aoFechar} disabled={salvando}>
          Cancelar
        </Button>
        {/* `disabled` em dois casos a mais que `salvando`:
              - a conta nao fecha (campo vazio, valor ilegivel, saldo que nao
                deu para ler). Sem isso o botao manda um POST que o servidor
                recusa, e a pessoa descobre pelo toast de erro o que a tela ja
                sabia;
              - o saldo ja bate E nao ha ajuste gravado. Ai nao existe nada a
                gravar nem a remover, e um botao ativo prometendo "Salvar
                ajuste" sobre um no-op e pior que um botao apagado ao lado da
                frase que explica por que. */}
        <Button
          size="sm"
          onClick={aoSalvar}
          disabled={salvando || !calculado.ok || (fecha && valorAtual === null)}
        >
          {salvando
            ? "Salvando…"
            : fecha && valorAtual !== null
              ? "Remover ajuste"
              : "Salvar ajuste"}
        </Button>
      </div>
    </div>
  );
}
