"use client";

// ---------------------------------------------------------------------------
// A PERGUNTA DO ALCANCE, ONDE A PESSOA CLICA (HMO-228)
// ---------------------------------------------------------------------------
// "Ao apagar ou alterar uma conta parcelada ou fixa, perguntar se quer
// apagar/alterar apenas aquela parcela, a partir daquela parcela ou todas as
// parcelas."
//
// Antes da HMO-228 esta pergunta existia em UM lugar: o dialogo de edicao de
// `bills/page.tsx`. Mas uma parcela e apagada na lista de Lancamentos e vista na
// tela do cartao -- e nos dois lugares a exclusao acontecia sem perguntar nada.
// Por isso o dialogo e compartilhado: tres telas, uma pergunta, um texto.
//
// O ALCANCE VIAJA NO CORPO, E ESTE COMPONENTE NAO SABE DE REDE
// -----------------------------------------------------------
// Ele devolve a escolha por `aoConfirmar(alcance, base)` e nao chama fetch. A
// alternativa -- um laco no cliente aplicando id por id -- fica aplicado PELA
// METADE quando a conexao cai, e o estado pela metade de uma serie nao tem como
// ser descoberto depois: nada na tela distingue "3 de 8 alteradas" de "a serie
// tinha 3".
//
// POR QUE O TEXTO NAO ESTA AQUI
// -----------------------------
// As palavras moram em `lib/alcance-na-tela.ts`, puro. O `SelectValue` do Radix
// nao renderiza no servidor, entao um teste de render de servidor ve o gatilho
// VAZIO; com a regra num modulo puro, o texto de cada opcao e a consequencia
// declarada sao verificaveis sem navegador.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  consequenciaNaTela,
  opcoesDeAlcance,
  precisaPerguntarBase,
  type Acao,
  type Alcance,
  type TipoDeSerie,
} from "@/lib/alcance-na-tela";
import type { BaseDoValorParcelado } from "@/lib/lancamento";

export interface DialogoDeAlcanceProps {
  aberto: boolean;
  aoFechar: () => void;
  tipo: TipoDeSerie;
  acao: Acao;
  /** O rotulo da linha clicada: a data, numa conta fixa; "parcela 3", numa serie. */
  ancora: string;
  /** M, so na parcela. */
  totalDeParcelas?: number | null;
  /** O valor muda neste pedido? Decide se a pergunta de base aparece. */
  mudaValor?: boolean;
  /**
   * O total da compra como esta hoje, e como fica depois -- por alcance.
   *
   * A TELA TEM DE MOSTRAR O TOTAL RECALCULADO ANTES DO SALVAR. Em "a partir
   * daquela" as parcelas anteriores ficam com o valor velho, entao o total
   * DEIXA de ser `parcela x M`; sem este numero a tela afirma um total que o
   * banco nao tem. A funcao recebe o alcance porque o total depende dele.
   */
  totalDaCompra?: {
    antes: number;
    depois: (alcance: Alcance, base: BaseDoValorParcelado) => number | null;
  };
  aoConfirmar: (alcance: Alcance, base: BaseDoValorParcelado) => void | Promise<void>;
  salvando?: boolean;
}

const moeda = (v: number) => {
  // A MAO, e nao `toLocaleString`: ha Node sem full-icu que devolve o formato
  // en-US para qualquer locale pedido, e este texto entra em assercao de teste.
  // Mesma razao de `resumoDaSerie` em lib/lancamento.ts.
  const centavos = Math.round(v * 100);
  const sinal = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  const inteiros = String(Math.floor(abs / 100)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    "."
  );
  return `${sinal}R$ ${inteiros},${String(abs % 100).padStart(2, "0")}`;
};

export function DialogoDeAlcance({
  aberto,
  aoFechar,
  tipo,
  acao,
  ancora,
  totalDeParcelas,
  mudaValor = false,
  totalDaCompra,
  aoConfirmar,
  salvando = false,
}: DialogoDeAlcanceProps) {
  // O PADRAO E O MENOS DESTRUTIVO, SEMPRE.
  //
  // `apenas_esta` e o unico alcance que nao pode surpreender: quem clicar em
  // confirmar sem ler muda uma linha. Qualquer outro padrao transforma um clique
  // distraido numa reescrita de serie, e e exatamente o tipo de erro que nao tem
  // desfazer.
  const [alcance, setAlcance] = useState<Alcance>("apenas_esta");
  const [base, setBase] = useState<BaseDoValorParcelado>("parcela");

  const opcoes = opcoesDeAlcance({ tipo, acao, ancora, totalDeParcelas });
  const consequencia = consequenciaNaTela(alcance, opcoes);
  const perguntarBase = precisaPerguntarBase({ tipo, alcance, mudaValor });

  const depois = totalDaCompra?.depois(alcance, base) ?? null;

  const titulo =
    acao === "apagar"
      ? tipo === "parcela"
        ? "Apagar parcela"
        : "Apagar conta"
      : tipo === "parcela"
        ? "Alterar parcela"
        : "Alterar conta";

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) {
          // Reabrir no estado menos destrutivo. Sem isto, fechar com "todas"
          // escolhido e reabrir em OUTRA linha deixaria "todas" pre-selecionado
          // -- a escolha de um pedido vazando para o seguinte.
          setAlcance("apenas_esta");
          setBase("parcela");
          aoFechar();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {tipo === "parcela"
              ? "Esta é uma compra parcelada. Escolha o que a mudança alcança."
              : "Esta conta se repete. Escolha o que a mudança alcança."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border border-border p-3">
            <Label htmlFor="alcance-da-serie">
              {acao === "apagar" ? "Apagar" : "Esta alteração vale para"}
            </Label>
            <Select
              value={alcance}
              onValueChange={(v) => setAlcance(v as Alcance)}
            >
              <SelectTrigger id="alcance-da-serie">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {opcoes.map((o) => (
                  <SelectItem key={o.valor} value={o.valor}>
                    {o.rotulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* A CONSEQUENCIA DECLARADA. Ela nao e ajuda opcional: e o unico
                lugar onde a tela diz que "esta e as proximas" encerra o gasto
                fixo, e que "todas" alcanca meses anteriores em aberto. */}
            <p className="text-xs text-muted-foreground">{consequencia}</p>
          </div>

          {/* A MESMA PERGUNTA QUE A HMO-211 JA FAZ NO LANCAMENTO, COM AS MESMAS
              PALAVRAS. Vocabulario novo para a mesma duvida e como se aprende
              duas regras onde havia uma. */}
          {perguntarBase && (
            <div className="space-y-2 rounded-lg border border-border p-3">
              <Label>O valor digitado é</Label>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    id="alcance-base-parcela"
                    name="alcance-base"
                    checked={base === "parcela"}
                    onChange={() => setBase("parcela")}
                    className="h-4 w-4 accent-primary"
                  />
                  <Label htmlFor="alcance-base-parcela">
                    o valor de cada parcela
                  </Label>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    id="alcance-base-total"
                    name="alcance-base"
                    checked={base === "total"}
                    onChange={() => setBase("total")}
                    className="h-4 w-4 accent-primary"
                  />
                  <Label htmlFor="alcance-base-total">o total da compra</Label>
                </div>
              </div>
            </div>
          )}

          {/* O TOTAL RECALCULADO, ANTES DO SALVAR.
              Os DOIS numeros: "passa a ser R$ 2.600" sozinho nao diz se era
              isso que a pessoa esperava, e e nessa comparacao que ela descobre
              que escolheu o alcance errado. */}
          {totalDaCompra && depois !== null && (
            <p className="text-sm text-foreground">
              Total da compra:{" "}
              <span className="text-muted-foreground line-through">
                {moeda(totalDaCompra.antes)}
              </span>{" "}
              <span className="font-semibold">{moeda(depois)}</span>
            </p>
          )}

          <Button
            className="w-full"
            variant={acao === "apagar" ? "destructive" : "default"}
            disabled={salvando}
            onClick={() => aoConfirmar(alcance, base)}
          >
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {acao === "apagar" ? "Apagar" : "Salvar alteração"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
