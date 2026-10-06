"use client";

// -----------------------------------------------------------------------------
// "DE QUAL CONTA O DINHEIRO SAIU?" -- O DIALOGO E A SEQUENCIA (HMO-312)
// -----------------------------------------------------------------------------
// Fase F13 da HMO-309. EXTRACAO: este componente e, linha por linha, o dialogo
// que morava em `app/(dashboard)/dashboard/bills/page.tsx` mais as duas funcoes
// de escrita que o alimentavam (`materializarFatura` e a metade de `darBaixa`
// que trata a fatura). Contas a Pagar passou a consumi-lo sem mudar um pixel.
//
// POR QUE A SEQUENCIA MORA AQUI, E NAO EM CADA TELA
// -------------------------------------------------
// Porque ela e DUAS requisicoes sem transacao de banco, e o meio delas tem um
// galho de corrida: o `close` pode responder 409 "esta fatura ja foi fechada",
// que **nao e erro** -- e o que acontece quando outra aba (ou o botao "Fechar
// fatura" de Orcamentos) fechou a fatura entre a abertura do dialogo e o
// clique. Reimplementar isso na tela de Despesas seria a segunda implementacao
// da de-duplicacao de fatura neste repositorio, e as duas divergem na primeira
// correcao. A decisao em si e pura e mora em `lib/pagamento-da-fatura.ts`; aqui
// fica so o que precisa de `fetch` e de estado.
//
// AS DUAS FRASES DE PATRIMONIO SAO METADE DA FEATURE
// --------------------------------------------------
// Pagar a fatura nao muda o patrimonio -- a despesa foi a compra, e esta baixa
// so move dinheiro da conta para o cartao. Quem acabou de informar R$ 1.000 e
// ve o patrimonio parado conclui que a tela nao registrou, e registra de novo.
// A frase aparece ANTES (no dialogo) e DEPOIS (no toast do galho
// `is_transfer`), e as duas vem da lib -- nenhuma mora em tela.
//
// O QUE ESTE COMPONENTE NAO FAZ: CONTAR. Nenhum numero sai daqui. O valor e o
// vencimento vem do descritor, e quem tira a fatura da lista depois do
// pagamento e a proxima LEITURA (`aoPagar` -> `carregar`), nunca um `setX`
// local: quem de-duplica a fatura e `sintetizarFaturasAbertas`, e mexer na
// lista do lado do cliente seria a segunda aritmetica do mesmo numero.
//
// SEM `next/navigation` AQUI, pela mesma razao que em `EloDaFatura.tsx`: ele nao
// roda no node, e um teste que renderizasse esta marcacao morreria no import
// antes da primeira assercao.
// -----------------------------------------------------------------------------

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ERRO_DA_BAIXA,
  ERRO_DE_REDE_NA_BAIXA,
  ERRO_DE_REDE_NO_FECHAMENTO,
  FRASE_DO_PATRIMONIO_ANTES,
  FRASE_DO_PATRIMONIO_DEPOIS,
  FRASE_SEM_CONTA_PAGADORA,
  PERGUNTA_DA_CONTA_PAGADORA,
  ROTULO_DE_CONFIRMAR,
  TITULO_DO_PAGAMENTO,
  avisoDaFaturaAberta,
  chaveDaEscrita,
  faturaDepoisDoFechamento,
  hojeEmSaoPaulo,
  pedidoDeBaixaDaFatura,
  pedidoDeFechamento,
  toastDaFaturaPaga,
  type FaturaPagavel,
} from "@/lib/pagamento-da-fatura";

/** Uma conta que pode pagar a fatura -- ja peneirada por `contasQuePodemPagar`. */
export interface ContaQuePaga {
  id: string;
  name: string;
}

export interface DialogoDePagamentoDaFaturaProps {
  /** A fatura escolhida, ou `null` com o dialogo fechado. */
  fatura: FaturaPagavel | null;
  /**
   * As contas que podem pagar, JA peneiradas pela tela com
   * `contasQuePodemPagar`. Lista vazia nao esconde o dialogo: ela troca o
   * seletor pela frase que diz o que falta cadastrar.
   */
  contasPagadoras: ContaQuePaga[];
  /** Fechar o dialogo -- no cancelamento e depois do sucesso. */
  aoFechar: () => void;
  /** Recarregar a lista. A LEITURA e quem tira a fatura do previsto. */
  aoPagar: () => void | Promise<void>;
  /**
   * A chave da linha que esta escrevendo, para a tela manter o spinner dela.
   *
   * Opcional porque nao toda tela tem esse estado. Contas a Pagar tem (`agindo`)
   * e passa o setter: sem isto a linha por tras do dialogo pararia de girar, que
   * e uma mudanca de comportamento numa fase que promete nao ter nenhuma.
   */
  aoMudarEscrita?: (chave: string | null) => void;
}

/** 'AAAA-MM-DD' -> '05/10/26', sem passar por `new Date()`. */
// A string ISO e lida como UTC e, no Brasil, voltaria um dia no fuso local --
// a fatura que vence dia 01 apareceria vencendo dia 30 do mes anterior.
function dataCurta(iso: string): string {
  const [ano, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${ano.slice(2)}`;
}

function moeda(valor: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor);
}

export function DialogoDePagamentoDaFatura({
  fatura,
  contasPagadoras,
  aoFechar,
  aoPagar,
  aoMudarEscrita,
}: DialogoDePagamentoDaFaturaProps) {
  const [escrevendo, setEscrevendo] = useState(false);

  // A ESCOLHA E GUARDADA COM A CHAVE DA FATURA, e o default e DERIVADO -- nao ha
  // `useEffect` que "reseta ao abrir". Com um efeito, o reset dependeria de
  // `contasPagadoras`, e uma tela que monte essa lista a cada render (a de
  // Despesas vai busca-la ao abrir o dialogo) faria o efeito rodar em todo
  // render e apagar a escolha da pessoa no meio do preenchimento. Comparando a
  // chave, trocar de fatura volta para a primeira conta e ficar na mesma fatura
  // preserva a escolha, sem efeito nenhum.
  const chave = fatura ? chaveDaEscrita(fatura) : null;
  const [escolha, setEscolha] = useState<{
    chave: string;
    contaId: string;
  } | null>(null);
  const contaPagadora =
    escolha && escolha.chave === chave
      ? escolha.contaId
      : contasPagadoras[0]?.id ?? "";

  function marcarEscrita(nova: string | null) {
    setEscrevendo(nova !== null);
    aoMudarEscrita?.(nova);
  }

  /**
   * A BAIXA. Uma escrita, e ela vale para os TRES sabores de fatura: a que
   * acabou de ser materializada, a que ja estava fechada, e a previsao que a
   * pessoa ligou a fatura (HMO-305).
   */
  async function darBaixa(gravada: FaturaPagavel) {
    const pedido = pedidoDeBaixaDaFatura(gravada, contaPagadora, hojeEmSaoPaulo());
    // `null` aqui e impossivel pelo caminho da tela (o botao exige a conta e a
    // fatura ja esta gravada), e e justamente por isso que ele nao vira toast:
    // um erro inventado para um estado inalcancavel e texto que ninguem le.
    if (!pedido) return;

    marcarEscrita(chaveDaEscrita(gravada));
    try {
      const resposta = await fetch(pedido.url, {
        method: pedido.metodo,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pedido.corpo),
      });
      const dados = await resposta.json();

      if (!resposta.ok) {
        toast.error(dados.error ?? ERRO_DA_BAIXA);
        return;
      }

      // O galho `is_transfer` e onde a segunda frase de patrimonio vive. A rota
      // e quem sabe a direcao de verdade, e `dados.message` vem dela.
      if (dados.is_transfer) {
        toast.success(dados.message ?? toastDaFaturaPaga(gravada), {
          description: FRASE_DO_PATRIMONIO_DEPOIS,
        });
      } else {
        toast.success(dados.message ?? toastDaFaturaPaga(gravada));
      }

      aoFechar();
      await aoPagar();
    } catch (erro) {
      console.error(erro);
      toast.error(ERRO_DE_REDE_NA_BAIXA);
    } finally {
      marcarEscrita(null);
    }
  }

  /**
   * O "Confirmar pagamento", para os tres sabores.
   *
   * Fechada (e previsao ligada): UMA escrita. Aberta: DUAS, nesta ordem --
   * materializa e paga. Um clique, nao dois: a pessoa nao precisa saber que
   * "fechar a fatura" existe para informar que pagou o cartao, e era justamente
   * esse passo escondido em outra tela que fazia a fatura nunca chegar a Contas
   * a Pagar.
   *
   * Se a materializacao falhar, a baixa NAO acontece. O estado fica inalterado
   * -- nenhuma fatura meio-paga.
   */
  async function confirmar() {
    if (!fatura || !contaPagadora) return;

    const fechamento = pedidoDeFechamento(fatura);
    if (!fechamento) {
      await darBaixa(fatura);
      return;
    }

    // O spinner comeca na chave canonica (a fatura aberta nao tem id) e, se a
    // materializacao der certo, `darBaixa` assume com o id da linha real.
    marcarEscrita(chaveDaEscrita(fatura));

    let gravada: FaturaPagavel | null = null;
    try {
      const resposta = await fetch(fechamento.url, {
        method: fechamento.metodo,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fechamento.corpo),
      });
      const resultado = faturaDepoisDoFechamento(fatura, {
        ok: resposta.ok,
        status: resposta.status,
        dados: await resposta.json(),
      });
      if ("erro" in resultado) toast.error(resultado.erro);
      else gravada = resultado.fatura;
    } catch (erro) {
      console.error(erro);
      toast.error(ERRO_DE_REDE_NO_FECHAMENTO);
    } finally {
      if (!gravada) marcarEscrita(null);
    }

    if (!gravada) return;

    await darBaixa(gravada);
  }

  const aviso = fatura ? avisoDaFaturaAberta(fatura) : null;

  return (
    <Dialog
      open={fatura !== null}
      onOpenChange={(aberto) => {
        if (!aberto) aoFechar();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TITULO_DO_PAGAMENTO}</DialogTitle>
        </DialogHeader>

        {fatura && (
          <div className="space-y-4">
            <div className="rounded-lg border border-border p-3">
              <p className="font-medium text-foreground">{fatura.descricao}</p>
              <p className="text-sm text-muted-foreground">
                {moeda(fatura.valor)} · vence em {dataCurta(fatura.vencimento)}
              </p>
              {aviso && (
                <p className="mt-2 text-xs text-muted-foreground">{aviso}</p>
              )}
            </div>

            {contasPagadoras.length === 0 ? (
              <p className="text-sm text-destructive">
                {FRASE_SEM_CONTA_PAGADORA}
              </p>
            ) : (
              <>
                <div>
                  <Label>{PERGUNTA_DA_CONTA_PAGADORA}</Label>
                  <Select
                    value={contaPagadora}
                    onValueChange={(contaId) =>
                      setEscolha({ chave: chaveDaEscrita(fatura), contaId })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                    <SelectContent>
                      {contasPagadoras.map((conta) => (
                        <SelectItem key={conta.id} value={conta.id}>
                          {conta.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <p className="text-xs text-muted-foreground">
                  {FRASE_DO_PATRIMONIO_ANTES}
                </p>

                {/* `escrevendo` e nao `chave === <id da fatura>`: na fatura
                    ABERTA sao DUAS escritas, e a chave do spinner muda entre
                    elas (a canonica no `close`, o id real na baixa). Comparar
                    com uma das duas deixaria o botao clicavel no meio -- e o
                    segundo clique fecharia a fatura de novo. */}
                <Button
                  className="w-full"
                  disabled={!contaPagadora || escrevendo}
                  onClick={confirmar}
                >
                  {escrevendo && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {ROTULO_DE_CONFIRMAR}
                </Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
