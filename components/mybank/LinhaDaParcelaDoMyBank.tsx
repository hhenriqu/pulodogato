"use client";

// ---------------------------------------------------------------------------
// A PARCELA DO MYBANK COMO *UMA* LINHA DA AGENDA -- HMO-386
// ---------------------------------------------------------------------------
// A HMO-372 fundiu a divida do devedor em `GET /api/scheduled-transactions`
// (leitura 1 de 7) e a HMO-371 pos um bloco proprio na mesma tela. As duas
// metades estavam certas separadas, e juntas desenhavam a MESMA parcela duas
// vezes em `/dashboard/bills`: uma linha na agenda e uma linha no bloco. Nenhum
// total discordava -- a parcela entra em «Total a pagar» uma vez, pela agenda --
// e por isso nada ficava vermelho. Medido em producao antes do conserto:
// a descricao da parcela aparecia 4 vezes numa tela com 2 parcelas em janela.
//
// A ISSUE OFERECIA DUAS SAIDAS, E A ESCOLHIDA FOI A QUE NAO MEXE EM DINHEIRO
// -------------------------------------------------------------------------
//   1. tirar a linha de MyBank da agenda e deixar o bloco dono da divida.
//      «Total a pagar» DESCERIA -- a conta a pagar deixaria de ser somada --, e
//      essa e a direcao perigosa: quem olha gasta o que nao tem;
//   2. tirar o BLOCO desta tela (ele foi para `/dashboard/mybank`) e dar a
//      linha da agenda o gesto que so o bloco tinha. «Total a pagar» nao muda:
//      a parcela continua vindo da agenda e continua somada uma vez.
//
// Este componente e a segunda metade da saida 2: sem ele o PR seria "apagar o
// bloco", e o devedor perderia o unico botao que tinha.
//
// POR QUE UMA LINHA PROPRIA E NAO O `Linha` DA TELA
// ------------------------------------------------
// Esta parcela NAO e uma `scheduled_transaction`: ela tem `id: null` (o id de
// verdade mora em `mybank_installment_id`). As quatro acoes da agenda nao
// servem nela, e cada uma falha de um jeito diferente e CALADO:
//
//   * «dar baixa» montaria `POST /api/scheduled-transactions/null/pay`. Hoje o
//     `pedirBaixa` da tela tem um `if (conta.id === null) return`, entao o que
//     a pessoa ve e um botao de pagar que NAO FAZ NADA;
//   * «alterar» e «pular» mandariam PATCH/DELETE no mesmo `null`;
//   * o comprovante se penduraria em `scheduled_transaction_id: null`.
//
// E o gesto que esta parcela precisa nao e nenhum deles: e «avisar que paguei»,
// que nao move dinheiro -- quem move e quem recebe. Por isso a linha tem UM
// botao, e e esse.
//
// O SELO DIZ "MyBank" E NAO "MyBank — <quem emprestou>", E ISSO E DELIBERADO
// -------------------------------------------------------------------------
// O nome de quem emprestou sai de `profiles` e e resolvido por
// `/api/mybank/due` (duas consultas: a view nao tem FK para `profiles`).
// `lerDividaDoMyBank` -- a leitura que alimenta esta linha -- e lida por QUATRO
// rotas de dinheiro, e por uma delas o safe-to-spend: por um rotulo de tela nao
// se acrescenta uma consulta de perfil em quatro leituras de dinheiro. O campo
// `selo` da linha existe exatamente para este caso, e `seloDoMyBank(null)`
// devolve a mesma string quando o perfil esta ilegivel (desfazer a conexao
// depois do emprestimo e um caso real). O nome completo esta em
// `/dashboard/mybank`, onde o bloco da divida inteira agora mora -- e para la
// que o selo aponta.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { toast } from "sonner";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dataOuMomentoNaTela } from "@/lib/data-na-tela";
import {
  podeAvisarQuePagou,
  ROTULO_DE_AVISAR,
  ROTULO_PARA_AVISAR,
} from "@/lib/mybank-na-tela";
import type { ParcelaDevidaNaAgenda } from "@/lib/leituras-do-mybank";

/** Onde a divida INTEIRA mora desde a HMO-386. */
export const ENDERECO_DA_DIVIDA = "/dashboard/mybank";

export function LinhaDaParcelaDoMyBank({
  parcela,
  valor,
  aoAvisar,
  online = true,
}: {
  parcela: ParcelaDevidaNaAgenda;
  /** O valor JA FORMATADO pela tela -- a mesma `moeda()` das outras linhas. */
  valor: string;
  /** Recarregar a agenda: o `reported` muda o rotulo desta linha. */
  aoAvisar: () => void | Promise<void>;
  online?: boolean;
}) {
  const [avisando, setAvisando] = useState(false);

  const vencida = parcela.effective_status === "overdue";
  const dias = parcela.days_until_due ?? 0;
  // `mybank_status` e NAO `status`: aquele e sempre `'pending'` de proposito
  // (ele e o campo de dinheiro). Ver o campo em lib/leituras-do-mybank.ts.
  const podeAvisar = podeAvisarQuePagou({ status: parcela.mybank_status });

  async function avisarQuePaguei() {
    setAvisando(true);
    try {
      const resposta = await fetch(
        `/api/mybank/installments/${parcela.mybank_installment_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // `reported`, e NUNCA `paid`: quem leva a parcela a paga e quem
          // recebe o dinheiro, porque so ele sabe se recebeu. A rota recusa
          // `paid` do devedor com 403, e esta linha e o lado da tela da mesma
          // regra.
          body: JSON.stringify({ status: "reported" }),
        }
      );

      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível avisar.");
        return;
      }

      toast.success(dados.message ?? "Avisamos quem emprestou.");
      await aoAvisar();
    } catch (e) {
      console.error("Erro ao avisar que paguei:", e);
      toast.error("Não foi possível avisar.");
    } finally {
      setAvisando(false);
    }
  }

  return (
    <div
      className="border-b border-border py-3 last:border-0"
      // O ID DA PARCELA NO DOM, e nao so na memoria do React: e por ele que a
      // sonda de `/dashboard/bills` conta quantas vezes a mesma parcela esta
      // desenhada na pagina (HMO-386). Sem um marcador a contagem teria de sair
      // do TEXTO, e a descricao e do emprestimo -- as parcelas dele a repetem.
      data-parcela-do-mybank={parcela.mybank_installment_id}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          {/* A MESMA tarja neutra da fatura sintetizada: divida de MyBank nao
              tem categoria (ela nao e linha de `scheduled_transactions`). */}
          <div className="mt-1 h-8 w-1 rounded" style={{ backgroundColor: "#94a3b8" }} />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{parcela.description}</p>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{dataOuMomentoNaTela(parcela.due_date)}</span>
              {/* O SELO. Sem ele esta linha e INDISTINGUIVEL de uma conta de
                  luz: mesmo formato, mesmo vencimento, mesmo valor -- e as duas
                  se pagam de formas diferentes. O link leva a divida inteira,
                  que e onde o nome de quem emprestou aparece. */}
              <Link href={ENDERECO_DA_DIVIDA} className="hover:underline">
                <Badge variant="outline" data-selo-do-mybank>
                  {parcela.selo}
                </Badge>
              </Link>
              <span data-parcela-rotulo className="text-xs">
                parcela {parcela.installment_number} de {parcela.installment_total}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:justify-end">
          <div className="text-right">
            <p className="font-semibold text-foreground">{valor}</p>
            <Badge variant={vencida ? "destructive" : "secondary"} className="mt-1">
              {vencida
                ? `${Math.abs(dias)} dia(s) em atraso`
                : dias === 0
                  ? "vence hoje"
                  : `em ${dias} dia(s)`}
            </Badge>
          </div>

          {podeAvisar ? (
            <Button
              size="sm"
              variant="outline"
              data-avisar={parcela.mybank_installment_id}
              disabled={avisando || !online}
              onClick={avisarQuePaguei}
            >
              {ROTULO_PARA_AVISAR}
            </Button>
          ) : (
            // JA AVISOU: o botao vira estado, e nao desaparece. Um botao que
            // some deixa a pessoa sem saber se o toque pegou -- e `reported` e
            // justamente o intervalo em que nada mais depende dela. A frase diz
            // o que falta, e de quem.
            <span
              data-avisado={parcela.mybank_installment_id}
              className="text-xs text-muted-foreground"
            >
              {ROTULO_DE_AVISAR} · falta quem emprestou confirmar
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
