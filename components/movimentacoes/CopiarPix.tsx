"use client";

/**
 * O COPIA E COLA DO PIX DE UMA TRANSFERENCIA (24/10/2026).
 *
 * "Um icone de copia e cola que ja gera uma linha de valor e pix da pessoa pra
 * ela pagar no banco." O botao copia o BR Code (o "Pix copia e cola") com a
 * chave de quem recebe e o valor: no app do banco a pessoa cola e o valor ja
 * vem preenchido. Quem monta o codigo e `codigoPixCopiaECola`
 * (lib/chave-pix.ts), testado contra o exemplo do manual do Banco Central.
 *
 * SEM CHAVE, O BOTAO COPIA SO O VALOR, e a linha diz por que: "Helio nao
 * cadastrou chave Pix". Esconder o botao deixaria a pessoa sem o numero na mao
 * justamente no caso em que ela vai ter de digitar tudo.
 *
 * SEM `sonner` E SEM HOOK DE DADOS: o retorno do clique e na propria linha
 * ("copiado"), e a chave chega pronta por prop. Assim o componente renderiza
 * no node (scripts/test-secao-da-tela.mjs) sem esboco nenhum.
 */

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { codigoPixCopiaECola, type TipoDeChavePix } from "@/lib/chave-pix";

export interface PixParaCopiar {
  chave: string;
  tipo: TipoDeChavePix;
}

/** O valor como o campo do banco aceita: "250,00". */
export function valorParaColar(valor: number): string {
  return (Math.round(valor * 100) / 100).toFixed(2).replace(".", ",");
}

/** O que o botao copia: o BR Code, ou so o valor quando nao ha chave. */
export function textoParaCopiar(
  pix: PixParaCopiar | null | undefined,
  valor: number,
  nome: string | null
): string {
  if (pix) {
    const codigo = codigoPixCopiaECola({ chave: pix.chave, valor, nome });
    if (codigo) return codigo;
  }
  return valorParaColar(valor);
}

export function CopiarPix({
  pix,
  valor,
  nome,
}: {
  pix: PixParaCopiar | null | undefined;
  valor: number;
  /** O nome de quem recebe, ou `null` quando o perfil nao e legivel. */
  nome: string | null;
}) {
  const [estado, setEstado] = useState<"parado" | "copiado" | "falhou">("parado");

  useEffect(() => {
    if (estado !== "copiado") return;
    const t = setTimeout(() => setEstado("parado"), 2000);
    return () => clearTimeout(t);
  }, [estado]);

  const texto = textoParaCopiar(pix, valor, nome);
  const quem = nome ?? "esta pessoa";
  const rotulo = pix
    ? `Copiar o Pix copia e cola para ${quem}`
    : `Copiar o valor (${quem} não cadastrou chave Pix)`;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(texto);
      setEstado("copiado");
    } catch {
      // `navigator.clipboard` exige contexto seguro e, no iOS, um gesto direto.
      // Sem este ramo a falha some no console e a pessoa cola outra coisa no
      // banco: o codigo aparece na tela para copiar a mao.
      setEstado("falhou");
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span className="inline-flex items-center gap-1">
        {!pix && (
          <span className="text-xs text-muted-foreground">
            {quem} não cadastrou chave Pix
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={copiar}
          aria-label={rotulo}
          title={rotulo}
          data-copia-e-cola={texto}
        >
          {estado === "copiado" ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          <span className="ml-1 text-xs">
            {estado === "copiado" ? "Copiado" : pix ? "Pix" : "Valor"}
          </span>
        </Button>
      </span>
      {estado === "falhou" && (
        <input
          readOnly
          value={texto}
          aria-label="Copie à mão"
          className="w-56 rounded border border-border bg-background px-1 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
      )}
    </span>
  );
}
