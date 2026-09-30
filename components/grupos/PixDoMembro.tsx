"use client";

/**
 * O Pix do colega, na tela do grupo (HMO-201, parte 1).
 *
 * "para que o colega do grupo possa copiar e fazer o pagamento" -- entao o
 * lugar disto e ao lado de quem esta com saldo A RECEBER, que e literalmente
 * a pessoa para quem alguem precisa mandar dinheiro.
 *
 * QUEM FILTRA E A RLS, NAO ESTE ARQUIVO
 * -------------------------------------
 * A consulta pede as chaves de todos os membros do grupo de uma vez. A policy
 * `user_pix_keys_select` (migration 032) e quem decide o que volta: o dono e
 * quem divide um grupo ATIVO com ele. Um membro que nao cadastrou chave
 * simplesmente nao tem linha, e a tela mostra "sem chave Pix" -- que e
 * informacao util, e nao um estado de erro.
 *
 * O QUE SE COPIA NAO E O QUE SE VE
 * --------------------------------
 * A tela mostra `529.982.247-25` porque assim da para conferir; o botao copia
 * `52998224725`, que e o que o banco aceita. Os dois vem de funcoes
 * diferentes de propósito (`formatarChavePix` x `chaveParaCopiar`), e ha um
 * teste em scripts/test-chave-pix.mjs que falha se alguem unificar as duas.
 */

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import {
  ROTULO_DA_CHAVE_PIX,
  chaveParaCopiar,
  formatarChavePix,
  type TipoDeChavePix,
} from "@/lib/chave-pix";

export type ChavePixDeMembro = {
  readonly chave: string;
  readonly tipo: TipoDeChavePix;
};

/** Indexado por `user_id`. Ausente = a pessoa nao cadastrou chave. */
export type ChavesPixPorMembro = ReadonlyMap<string, ChavePixDeMembro>;

/**
 * Le de uma vez as chaves visiveis para quem esta olhando.
 *
 * `userIds.join()` como dependencia, e nao o array: um array literal e um
 * objeto novo a cada render, e usa-lo como dependencia refaz a consulta em
 * todo render -- uma ida ao banco por quadro de animacao da tela.
 */
export function useChavesPixDoGrupo(userIds: string[]): ChavesPixPorMembro {
  const [chaves, setChaves] = useState<ChavesPixPorMembro>(new Map());
  const chaveDaDependencia = userIds.slice().sort().join(",");

  useEffect(() => {
    const ids = chaveDaDependencia ? chaveDaDependencia.split(",") : [];
    if (ids.length === 0) {
      setChaves(new Map());
      return;
    }

    let vivo = true;
    const supabase = createClient();

    (async () => {
      const { data, error } = await supabase
        .from("user_pix_keys")
        .select("user_id, pix_key, pix_key_type")
        .in("user_id", ids);

      if (!vivo) return;

      if (error) {
        // Nao vira toast: o Pix e um extra ao lado do saldo, e o saldo e a
        // informacao principal da tela. Falhar aqui nao pode encher a tela de
        // aviso sobre uma coisa que a pessoa talvez nem estivesse procurando.
        console.error("Erro ao ler as chaves Pix do grupo:", error);
        return;
      }

      setChaves(
        new Map(
          (data ?? []).map((l) => [
            l.user_id as string,
            {
              chave: l.pix_key as string,
              tipo: l.pix_key_type as TipoDeChavePix,
            },
          ])
        )
      );
    })();

    return () => {
      vivo = false;
    };
  }, [chaveDaDependencia]);

  return chaves;
}

export function PixDoMembro({
  pix,
  nome,
}: {
  pix: ChavePixDeMembro | undefined;
  nome: string;
}) {
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 2000);
    return () => clearTimeout(t);
  }, [copiado]);

  if (!pix) {
    return (
      <p className="text-xs text-muted-foreground">
        {nome} ainda não cadastrou chave Pix
      </p>
    );
  }

  const copiar = async () => {
    const texto = chaveParaCopiar(pix.chave);
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      toast.success(`Chave Pix de ${nome} copiada`);
    } catch {
      // `navigator.clipboard` exige contexto seguro e permissao; em iOS ele
      // tambem recusa fora de um gesto direto. Sem este ramo, a falha some no
      // console e a pessoa fica achando que copiou -- e cola a coisa errada
      // no banco.
      toast.error("Não foi possível copiar. A chave está na tela para copiar à mão.");
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">
        {ROTULO_DA_CHAVE_PIX[pix.tipo]}:{" "}
        <span className="font-mono text-foreground">
          {formatarChavePix(pix.chave, pix.tipo)}
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2"
        onClick={copiar}
        aria-label={`Copiar chave Pix de ${nome}`}
      >
        {copiado ? (
          <Check className="h-3.5 w-3.5 text-success" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}
