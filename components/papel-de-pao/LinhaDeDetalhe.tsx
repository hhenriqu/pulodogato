"use client";

// -----------------------------------------------------------------------------
// UMA LINHA DA LISTA QUE O CHEVRON ABRE
// -----------------------------------------------------------------------------
// EXTRAIDO de PainelDePapel.tsx na HMO-365 (F2 da HMO-360), sem mudanca de
// comportamento: o corpo abaixo e o mesmo que nasceu na HMO-300, e as 48
// assercoes de `test:papel-na-tela` continuam sendo a medicao dele.
//
// POR QUE O ARQUIVO PROPRIO, e isso nao e organizacao: a F2 precisa do MESMO
// renderizador de linha num segundo lugar -- o painel "pra quem pagar" da aba
// Despesas. A issue e explicita sobre isso ("o chevron: reusar, nao reescrever"),
// e o motivo nao e economia de linhas. Sao as regras ESCRITAS nesta linha que
// nao podem divergir entre os dois paineis:
//
//   * `de_grupo` carrega o rotulo que impede o valor pela metade de parecer erro
//     de digitacao;
//   * `diaEMes` le a data dos COMPONENTES da string ISO, nunca por `new Date` --
//     um `new Date("2026-03-01")` e meia-noite UTC e imprime 28 de FEVEREIRO em
//     America/Sao_Paulo (o defeito que custou a HMO-173);
//   * a fatura sintetizada sai sem acao e COM o caminho de volta.
//
// Uma segunda copia destas tres empataria hoje e divergiria na primeira correcao
// feita de um lado so -- e as duas telas mostram DINHEIRO, lado a lado, na mesma
// navegacao.
// -----------------------------------------------------------------------------

import Link from "next/link";
import { formatCurrency } from "@/lib/utils";
import { caminhoDoCartaoNoMes } from "@/lib/fatura-do-cartao";
import { EloDaFatura } from "@/components/fatura/EloDaFatura";
import type { LinhaDoDetalhe } from "@/lib/papel-de-pao";

/** "28/03" -- dia e mes, dos COMPONENTES da string ISO. */
export function diaEMes(data: string): string {
  // Sem `new Date`: `new Date("2026-03-01")` e meia-noite UTC e em
  // America/Sao_Paulo imprime 28 de FEVEREIRO. E o defeito que custou a
  // HMO-173, e aqui ele apareceria como uma lista de datas um dia atrasadas
  // debaixo de um total certo.
  return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

/** O rotulo que impede o valor pela metade de parecer erro de digitacao. */
export const ROTULO_DE_GRUPO = "minha parte do grupo";

/**
 * UMA LINHA DA LISTA.
 *
 * O `valor` ja vem como a MINHA parte, dividida pela rota -- esta tela nao
 * divide nada. E e por isso que `de_grupo` tem rotulo: sem ele, metade do
 * aluguel debaixo do nome do aluguel inteiro se le como erro de digitacao, e a
 * pessoa vai procurar um defeito que nao existe.
 *
 * A FATURA ABERTA SINTETIZADA (`gravada: false`) SAI SEM ACAO E COM O CAMINHO
 * DE VOLTA. Ela nao tem `scheduled_transactions.id` -- e calculada de
 * `card_invoice_lines` a cada leitura --, entao nao ha o que editar; o que ela
 * tem e um cartao e um mes, e `caminhoDoCartaoNoMes` monta o link que leva
 * aquela fatura naquele mes (sem o mes, o link abriria o mes corrente do
 * cartao certo -- o destino plausivel e errado que ninguem reporta).
 *
 * `posso_editar` CHEGA E NAO E USADO AQUI. Ele nasce na rota na HMO-300 e e a
 * 10/10 quem o consome, em `SecaoDaTela`. Os dois campos estao em corrente de
 * proposito: duas PRs definindo um campo de mesmo nome em paralelo colidem na
 * adicao, e neste repositorio esse conflito ja apareceu exatamente assim.
 */
export function LinhaDeDetalhe({
  linha,
  valorDaFatura = null,
  aoConcluirElo,
}: {
  linha: LinhaDoDetalhe;
  /**
   * O valor da fatura ABERTA do cartao desta suspeita -- so para a frase do
   * cartao de confirmacao. `null` quando a lista nao a tem.
   */
  valorDaFatura?: number | null;
  aoConcluirElo?: () => void;
}) {
  const nome = linha.descricao?.trim() || "sem descrição";

  return (
    <li
      className="flex items-baseline justify-between gap-3 text-sm"
      data-linha-do-detalhe={linha.id ?? ""}
      data-de-grupo={linha.de_grupo ? "sim" : "nao"}
      data-gravada={linha.gravada ? "sim" : "nao"}
    >
      <span className="min-w-0 flex-1 break-words">
        <span className="text-muted-foreground mr-2">{diaEMes(linha.data)}</span>
        {linha.fatura ? (
          <Link
            href={caminhoDoCartaoNoMes(linha.fatura.accountId, linha.fatura.mes)}
            className="underline underline-offset-2"
          >
            {nome}
          </Link>
        ) : (
          nome
        )}
        {linha.de_grupo && (
          <span className="text-muted-foreground"> ({ROTULO_DE_GRUPO})</span>
        )}
        {/* O ELO DA FATURA -- HMO-305. Ele desenha o rotulo e a acao, e devolve
            `null` nas linhas que nao tem nem suspeita nem elo (a grande
            maioria), deixando o espacamento da linha como era. Sem
            `aoConcluirElo` ele nem e montado: ver a prop. */}
        {linha.id && aoConcluirElo && (
          <EloDaFatura
            previsaoId={linha.id}
            suspeita={linha.fatura_suspeita}
            elo={linha.elo_da_fatura}
            valorDaFaturaFormatado={
              valorDaFatura !== null ? formatCurrency(valorDaFatura) : null
            }
            valorDaPrevisaoFormatado={formatCurrency(linha.valor)}
            aoConcluir={aoConcluirElo}
          />
        )}
      </span>
      <span className="font-papel shrink-0" data-valor-do-detalhe={linha.valor}>
        {formatCurrency(linha.valor)}
      </span>
    </li>
  );
}
