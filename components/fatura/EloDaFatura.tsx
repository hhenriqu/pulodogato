"use client";

// -----------------------------------------------------------------------------
// "ESTA PREVISAO E A FATURA DO NUBANK DE MARCO" -- HMO-305
// -----------------------------------------------------------------------------
// O rotulo, a acao, o cartao de confirmacao e o desfazer. UM componente para as
// DUAS telas que mostram a suspeita (o painel do modo Papel de Pao e a tela de
// Despesas), pela mesma razao que as frases moram numa lib: as duas respondem a
// mesma pergunta sobre a mesma linha, e duas implementacoes divergiriam -- uma
// ganharia o aviso da anotacao, a outra nao, e ninguem notaria ate alguem perder
// um texto que escreveu.
//
// O QUE ESTE COMPONENTE NAO FAZ: CONTA. Nenhum numero e calculado aqui. Os dois
// valores que aparecem no cartao de confirmacao chegam JA FORMATADOS da tela que
// os tem na lista, e as frases vem de `lib/elo-da-fatura.ts`. O efeito no total
// e produzido pela proxima LEITURA -- `sintetizarFaturasAbertas` para de
// sintetizar a fatura cuja chave agora existe na agenda --, e nao por nada que
// esta tela some ou esconda.
//
// POR QUE UM CARTAO DE CONFIRMACAO, E NAO UM CLIQUE DIRETO
// --------------------------------------------------------
// Porque este e o unico botao do modulo que MUDA UM NUMERO DE DINHEIRO. Ele faz
// o mes somar R$ 800 menos, e a unica defesa contra um elo errado e a pessoa ter
// lido o que ia acontecer: qual fatura, qual mes, quanto sai do total, e que a
// anotacao dela vai ser substituida. Um clique direto trocaria "a pessoa decide"
// por "a pessoa descobre depois".
//
// E POR QUE O DESFAZER TEM CONFIRMACAO TAMBEM: ele erra na direcao OPOSTA e
// igualmente caro -- devolve para a tela uma divida que ja estava contada, e o
// mes passa a pedir mais dinheiro do que a pessoa deve.
//
// SEM `next/navigation` AQUI, e isso e requisito e nao estilo: ele nao roda no
// node (ver scripts/resolve-next-subpaths.mjs), e um teste que renderizasse esta
// marcacao morreria no import antes da primeira assercao. Quem recarrega a tela
// depois da escrita e `aoConcluir`, que o container passa.
// -----------------------------------------------------------------------------

import { useState } from "react";
import { AlertCircle, Link2, Link2Off, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { rotuloDaFatura } from "@/lib/fatura-do-cartao";
import {
  ROTULO_DE_DESLIGAR,
  ROTULO_DE_LIGAR,
  ROTULO_DE_SUSPEITA,
  efeitoDoDesfazer,
  efeitoDoElo,
  perguntaDoElo,
  type SuspeitaDeFatura,
} from "@/lib/elo-da-fatura";

/** O rotulo da linha que JA tem o elo -- o par de `ROTULO_DE_SUSPEITA`. */
export const ROTULO_LIGADA = "ligada à fatura";

export interface EloDaFaturaProps {
  /** `scheduled_transactions.id` da previsao. */
  previsaoId: string;
  /**
   * A suspeita, quando a linha PODE ser a fatura. `null` nas outras -- e,
   * importante, `null` tambem na linha que JA tem o elo: e assim que o rotulo
   * de suspeita some sozinho quando o elo passa a existir.
   */
  suspeita: SuspeitaDeFatura | null;
  /** O elo JA ligado, quando ele existe e pode ser desfeito. */
  elo: { accountId: string; mes: string } | null;
  /**
   * O valor da FATURA ABERTA deste cartao neste mes, formatado pela tela.
   *
   * Ele sai da propria lista que a tela recebeu (a linha da fatura
   * sintetizada), e nao de uma conta feita aqui. `null`/ausente quando a tela
   * nao a achou: a frase sai sem numero, em vez de sair com um numero
   * inventado.
   */
  valorDaFaturaFormatado?: string | null;
  /** O valor DESTA previsao, formatado -- a grandeza que o desfazer devolve. */
  valorDaPrevisaoFormatado?: string | null;
  /** Recarregar a tela depois da escrita. A rota mudou o numero dela. */
  aoConcluir?: () => void;
}

type Fase = "parado" | "confirmando_elo" | "confirmando_desfazer" | "gravando";

export function EloDaFatura({
  previsaoId,
  suspeita,
  elo,
  valorDaFaturaFormatado = null,
  valorDaPrevisaoFormatado = null,
  aoConcluir,
}: EloDaFaturaProps) {
  const [fase, setFase] = useState<Fase>("parado");
  const [erro, setErro] = useState<string | null>(null);

  // Nada a dizer sobre esta linha: nem suspeita, nem elo. Devolve `null` e nao
  // um fragmento vazio -- um `<span>` de 0px com `gap` muda o espacamento da
  // linha, e a linha sem elo tem de desenhar IGUAL a de antes desta issue.
  if (!suspeita && !elo) return null;

  const mes = suspeita?.mes ?? elo?.mes ?? null;
  const rotuloDoMes = rotuloDaFatura(mes);

  async function escrever(metodo: "POST" | "DELETE") {
    setErro(null);
    setFase("gravando");

    try {
      const resposta = await fetch(
        `/api/scheduled-transactions/${previsaoId}/elo-de-fatura`,
        {
          method: metodo,
          headers:
            metodo === "POST" ? { "Content-Type": "application/json" } : undefined,
          body:
            metodo === "POST" && suspeita
              ? JSON.stringify({
                  account_id: suspeita.accountId,
                  mes: suspeita.mes,
                })
              : undefined,
        }
      );

      const corpo = await resposta.json().catch(() => null);

      if (!resposta.ok) {
        // A MENSAGEM DA ROTA, e nao uma generica: as seis recusas do POST dizem
        // coisas diferentes ("esta é uma despesa de grupo", "esta fatura já está
        // na agenda em outra linha"), e trocar as seis por "erro ao salvar"
        // apagaria a unica explicacao que existe.
        setErro(corpo?.error ?? "Não foi possível concluir. Tente de novo.");
        setFase("parado");
        return;
      }

      setFase("parado");
      aoConcluir?.();
    } catch {
      // Offline, ou a rota caiu. A linha continua como estava -- e o numero
      // tambem, que e o ponto: a escrita e a de-duplicacao sao a MESMA coisa,
      // entao uma escrita que nao aconteceu nao muda numero nenhum.
      setErro("Sem conexão com o servidor. A previsão continua como estava.");
      setFase("parado");
    }
  }

  const gravando = fase === "gravando";

  return (
    <span className="block" data-elo-da-fatura={previsaoId}>
      {/* O ROTULO. Ele e o que a issue irma (caminho 3) poria na tela, e esta
          issue o entrega junto com o botao que o resolve -- rotulo sem caminho
          de saida aponta um problema e nao deixa resolver. */}
      {suspeita && (
        <span className="text-muted-foreground" data-rotulo-do-elo="suspeita">
          {" · "}
          {ROTULO_DE_SUSPEITA}
        </span>
      )}
      {elo && (
        <span className="text-muted-foreground" data-rotulo-do-elo="ligada">
          {" · "}
          {ROTULO_LIGADA}
          {rotuloDoMes ? ` de ${rotuloDoMes}` : ""}
        </span>
      )}

      {fase === "parado" && (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-1 py-0 text-xs"
          onClick={() => setFase(suspeita ? "confirmando_elo" : "confirmando_desfazer")}
          data-acao-do-elo={suspeita ? "ligar" : "desfazer"}
        >
          {suspeita ? (
            <Link2 className="mr-1 h-3 w-3" aria-hidden="true" />
          ) : (
            <Link2Off className="mr-1 h-3 w-3" aria-hidden="true" />
          )}
          {suspeita ? ROTULO_DE_LIGAR : ROTULO_DE_DESLIGAR}
        </Button>
      )}

      {/* ----------------------------------------------------------------
          O CARTAO DE CONFIRMACAO DE LIGAR
          ----------------------------------------------------------------
          As tres frases, nesta ordem: QUAL fatura (`perguntaDoElo`), o que
          acontece com o NUMERO (`efeitoDoElo`), e o que acontece com a
          ANOTACAO (`suspeita.aviso`, so quando ha uma). A terceira e a que nao
          da para desfazer, e por isso ela esta ANTES do clique e nao depois.
      */}
      {suspeita && (fase === "confirmando_elo" || (gravando && !elo)) && (
        <span
          className="mt-2 block rounded-md border bg-muted/40 p-3 text-xs"
          data-confirmacao-do-elo="ligar"
          role="group"
          aria-label={ROTULO_DE_LIGAR}
        >
          <span className="block font-medium text-foreground">
            {perguntaDoElo(suspeita.nomeDoCartao, rotuloDoMes)}
          </span>
          <span className="mt-1 block text-muted-foreground">
            {efeitoDoElo(valorDaFaturaFormatado)}
          </span>
          {suspeita.aviso && (
            <span className="mt-1 block text-muted-foreground" data-aviso-do-elo="sim">
              {suspeita.aviso}
            </span>
          )}
          <span className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              className="h-7"
              disabled={gravando}
              onClick={() => escrever("POST")}
              data-confirmar-elo="ligar"
            >
              {gravando && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Ligar à fatura
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              disabled={gravando}
              onClick={() => setFase("parado")}
            >
              Cancelar
            </Button>
          </span>
        </span>
      )}

      {/* O CARTAO DE DESFAZER. Mesma forma, sinal oposto: aqui o numero SOBE. */}
      {elo && (fase === "confirmando_desfazer" || (gravando && !suspeita)) && (
        <span
          className="mt-2 block rounded-md border bg-muted/40 p-3 text-xs"
          data-confirmacao-do-elo="desfazer"
          role="group"
          aria-label={ROTULO_DE_DESLIGAR}
        >
          <span className="block font-medium text-foreground">
            Desfazer o elo com a fatura
            {rotuloDoMes ? ` de ${rotuloDoMes}` : ""}?
          </span>
          <span className="mt-1 block text-muted-foreground">
            {efeitoDoDesfazer(valorDaPrevisaoFormatado)}
          </span>
          <span className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7"
              disabled={gravando}
              onClick={() => escrever("DELETE")}
              data-confirmar-elo="desfazer"
            >
              {gravando && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
              Desfazer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7"
              disabled={gravando}
              onClick={() => setFase("parado")}
            >
              Cancelar
            </Button>
          </span>
        </span>
      )}

      {erro && (
        <span
          className="mt-1 flex items-start gap-1 text-xs text-destructive"
          data-erro-do-elo="sim"
        >
          <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          {erro}
        </span>
      )}
    </span>
  );
}
