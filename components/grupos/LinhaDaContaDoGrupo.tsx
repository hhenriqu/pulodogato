"use client";

// ---------------------------------------------------------------------------
// A CONTA DE GRUPO DE OUTRA PESSOA COMO *UMA* LINHA DA AGENDA -- HMO-411
// ---------------------------------------------------------------------------
// O porque desta linha ter desenho proprio -- e de cada um dos quatro botoes
// da `Linha` comum falhar CALADO nela -- esta no cabecalho de
// `lib/conta-de-grupo-na-agenda.ts`. O molde e
// `components/mybank/LinhaDaParcelaDoMyBank.tsx`, que existe pela mesma razao.
//
// O VALOR QUE ESTA LINHA MOSTRA E O DA CONTA INTEIRA, E NAO A MINHA PARTE
// ----------------------------------------------------------------------
// Ele chega ja formatado pela tela, pela mesma `moeda()` das outras linhas, e
// e o mesmo numero que «Total a pagar» soma -- a agenda nunca dividiu a linha
// pela parte de cada um (quem divide sao o cabecalho `/summary` e o painel).
// Trocar so o numero DESTA linha pela minha parte faria a lista e o cabecalho
// da MESMA tela discordarem, que e a familia `fontes-consistentes-que-discordam`
// e ja custou caro aqui (HMO-227). O selo e que diz de quem a conta e.
//
// O BOTAO NAO SOME DEPOIS DO TOQUE, VIRA ESTADO
// ---------------------------------------------
// Mesma decisao da linha do MyBank: um botao que desaparece deixa a pessoa sem
// saber se o toque pegou, e `reported` e justamente o intervalo em que nada
// mais depende dela. A frase diz o que falta e de quem -- e ao lado fica o
// «Desfazer», que existe porque o estado e reversivel ate o dono confirmar
// (a policy de DELETE da 055 nasceu para este botao).

import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { dataOuMomentoNaTela } from "@/lib/data-na-tela";
import {
  estadoDaMinhaParte,
  FALTA_O_DONO_CONFIRMAR,
  ROTULO_DESFAZER,
  ROTULO_JA_AVISADO,
  ROTULO_PARA_AVISAR,
  type LinhaComDono,
} from "@/lib/conta-de-grupo-na-agenda";

/** O que esta linha precisa da conta prevista para se desenhar. */
export interface ContaDeGrupoNaAgenda extends LinhaComDono {
  id: string;
  description: string;
  due_date: string;
  days_until_due?: number | null;
  my_effective_status?: string | null;
  /** O nome do grupo, quando o embed veio. */
  group?: { name?: string | null } | null;
}

export function LinhaDaContaDoGrupo({
  conta,
  valor,
  aoAvisar,
  online = true,
}: {
  conta: ContaDeGrupoNaAgenda;
  /** O valor JA FORMATADO pela tela -- a mesma `moeda()` das outras linhas. */
  valor: string;
  /** Recarregar a agenda: o aviso muda `my_status` e com ele esta linha. */
  aoAvisar: () => void | Promise<void>;
  online?: boolean;
}) {
  const [agindo, setAgindo] = useState(false);

  // `my_effective_status` E NAO `effective_status`: aquele e o do DONO, e numa
  // conta que ele ja pagou ele vale `paid` -- a linha apareceria "em dia" para
  // quem ainda deve a parte dela, inclusive depois do vencimento.
  const vencida = conta.my_effective_status === "overdue";
  const dias = conta.days_until_due ?? 0;
  const estado = estadoDaMinhaParte(conta);

  async function chamar(method: "POST" | "DELETE", caiuBem: string) {
    setAgindo(true);
    try {
      const resposta = await fetch(
        `/api/scheduled-transactions/${conta.id}/minha-baixa`,
        { method }
      );
      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? caiuBem);
        return;
      }

      toast.success(dados.message ?? caiuBem);
      await aoAvisar();
    } catch (e) {
      console.error("Erro no aviso da parte do grupo:", e);
      toast.error("Não foi possível registrar o aviso.");
    } finally {
      setAgindo(false);
    }
  }

  return (
    <div
      className="border-b border-border py-3 last:border-0"
      // O ID NO DOM, e nao so na memoria do React: e por ele que a sonda de
      // navegador afirma que ESTA linha tem o botao unico e NAO tem os quatro
      // da agenda. Sem um marcador a assercao sairia do texto, e "o botao de
      // pagar sumiu" passa verde numa conta vazia.
      data-conta-de-grupo={conta.id}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          {/* A mesma tarja neutra da fatura sintetizada e da parcela do
              MyBank: o que esta linha tem de proprio e o selo, nao a cor. */}
          <div className="mt-1 h-8 w-1 rounded" style={{ backgroundColor: "#94a3b8" }} />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">{conta.description}</p>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{dataOuMomentoNaTela(conta.due_date)}</span>
              {/* O SELO. Sem ele esta linha e INDISTINGUIVEL de uma conta de
                  luz: mesmo formato, mesmo vencimento, mesmo valor -- e as
                  duas se pagam de formas diferentes. */}
              <Badge variant="outline" data-selo-do-grupo>
                {conta.group?.name ? `Grupo · ${conta.group.name}` : "Conta do grupo"}
              </Badge>
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

          {estado === "pendente" ? (
            <Button
              size="sm"
              variant="outline"
              data-avisar-parte={conta.id}
              disabled={agindo || !online}
              onClick={() => chamar("POST", "Não foi possível avisar.")}
            >
              {ROTULO_PARA_AVISAR}
            </Button>
          ) : estado === "avisado" ? (
            <div className="flex items-center gap-2">
              <span
                data-parte-avisada={conta.id}
                className="text-xs text-muted-foreground"
              >
                {ROTULO_JA_AVISADO} · {FALTA_O_DONO_CONFIRMAR}
              </span>
              <Button
                size="sm"
                variant="ghost"
                data-desfazer-parte={conta.id}
                disabled={agindo || !online}
                onClick={() => chamar("DELETE", "Não foi possível desfazer.")}
              >
                {ROTULO_DESFAZER}
              </Button>
            </div>
          ) : (
            // CONFIRMADO pelo dono: nao ha mais gesto nenhum aqui. O
            // «Desfazer» sai de proposito -- a policy de DELETE da 055 tem
            // `status <> 'paid'`, entao o botao so poderia falhar.
            <span
              data-parte-confirmada={conta.id}
              className="text-xs text-muted-foreground"
            >
              Sua parte foi confirmada
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
