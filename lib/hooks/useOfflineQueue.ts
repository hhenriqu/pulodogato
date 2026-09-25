"use client";

// =====================================================
// A FILA OFFLINE DENTRO DO REACT
// =====================================================
// Cola entre tres pecas que nao se conhecem: as regras (`lib/offline-queue.ts`),
// o armazenamento (`lib/offline-store.ts`) e o Supabase. Aqui nao ha regra
// nova -- o que este arquivo adiciona e QUANDO tentar.
// =====================================================

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  avaliarLancamento,
  interpretarRespostaDeEnvio,
  aplicarResultado,
  ordenarParaEnvio,
  resumirFila,
  novoId,
  type Avaliacao,
  type EntradaDeLancamento,
  type ItemDaFila,
  type ResumoDaFila,
} from "@/lib/offline-queue";
import { lerFila, gravarItem, removerItem } from "@/lib/offline-store";

/**
 * Trava de modulo, nao de componente.
 *
 * O aviso no topo do app e a tela de lancamentos usam o mesmo hook, entao ha
 * duas instancias vivas ao mesmo tempo. Sem esta trava as duas sincronizam
 * juntas: nao duplica lancamento (o `ON CONFLICT (id)` cuida disso), mas manda
 * cada linha duas vezes e faz o contador piscar. A trava e de modulo porque o
 * estado do React e por instancia e nao serviria para nada aqui.
 */
let sincronizando = false;

/** Avisa as outras instancias do hook que a fila mudou. */
const ouvintes = new Set<() => void>();
const avisarTodos = () => ouvintes.forEach((f) => f());

export interface FilaOffline {
  /** `navigator.onLine`, que e confiavel no NEGATIVO e otimista no positivo. */
  online: boolean;
  itens: ItemDaFila[];
  resumo: ResumoDaFila;
  /** Tenta gravar agora; se nao der, enfileira. */
  enfileirar: (entrada: EntradaDeLancamento) => Promise<ResultadoDeEnfileirar>;
  sincronizar: () => Promise<void>;
  descartar: (id: string) => Promise<void>;
}

export type ResultadoDeEnfileirar =
  | { estado: "enfileirado"; id: string }
  | { estado: "recusado"; mensagem: string };

export function useOfflineQueue(): FilaOffline {
  // Comeca `true` de proposito: no servidor nao existe `navigator`, e comecar
  // `false` faria o aviso "voce esta offline" piscar na primeira pintura de
  // TODA visita, inclusive das online.
  const [online, setOnline] = useState(true);
  const [itens, setItens] = useState<ItemDaFila[]>([]);

  const recarregar = useCallback(async () => {
    try {
      setItens(await lerFila());
    } catch {
      // A fila nao abrir nao pode derrubar a tela. O caminho de gravacao NAO
      // engole erro (ver `enfileirar`): la a pessoa precisa saber.
      setItens([]);
    }
  }, []);

  const sincronizar = useCallback(async () => {
    if (sincronizando) return;
    sincronizando = true;

    try {
      const fila = ordenarParaEnvio(await lerFila());
      if (fila.length === 0) return;

      const supabase = createClient();

      for (const item of fila) {
        const { data, error } = await supabase
          .from("financial_transactions")
          // `ignoreDuplicates` vira `ON CONFLICT (id) DO NOTHING`. E ele que
          // torna o reenvio inofensivo -- inclusive para os triggers de saldo,
          // que nao disparam de novo porque nao ha UPDATE.
          //
          // DO NOTHING (e nao DO UPDATE) tambem porque a linha pode ter sido
          // editada no servidor desde entao: sobrescrever com a copia do
          // aparelho desfaria a edicao sem ninguem pedir.
          .upsert(item.linha, { onConflict: "id", ignoreDuplicates: true })
          .select("id");

        const resultado = interpretarRespostaDeEnvio({
          erro: error,
          linhasRetornadas: data?.length ?? 0,
        });

        const proximo = aplicarResultado(item, resultado, error?.message ?? null);

        if (proximo === null) {
          await removerItem(item.id);
        } else {
          await gravarItem(proximo);
          // Sessao vencida: as proximas linhas vao falhar igual. Parar aqui
          // evita gastar a fila inteira contra um 401 -- e mantem a ORDEM,
          // que e o que a pessoa espera ver quando voltar.
          if (resultado === "reautenticar" || resultado === "repetir") break;
        }
      }
    } catch {
      // Sincronizar e sempre "melhor esforco": o que nao foi continua na fila.
    } finally {
      sincronizando = false;
      await recarregar();
      avisarTodos();
    }
  }, [recarregar]);

  const enfileirar = useCallback(
    async (entrada: EntradaDeLancamento): Promise<ResultadoDeEnfileirar> => {
      const id = novoId();
      const avaliacao: Avaliacao = avaliarLancamento(entrada, id);

      if (!avaliacao.ok) {
        return { estado: "recusado", mensagem: avaliacao.mensagem };
      }

      try {
        await gravarItem({
          id,
          linha: avaliacao.linha,
          criadoEm: Date.now(),
          tentativas: 0,
          ultimoErro: null,
          estado: "pendente",
        });
      } catch (erro) {
        // O caso que nao pode ser engolido: sem lugar para guardar, o
        // lancamento nao existe em canto nenhum. Dizer "salvo offline" aqui
        // seria a mentira mais cara que este modulo pode contar.
        return {
          estado: "recusado",
          mensagem:
            "Nao consegui guardar no aparelho. Anote e lance de novo com conexao. " +
            (erro instanceof Error ? erro.message : ""),
        };
      }

      await recarregar();
      avisarTodos();
      // Se por acaso houver rede agora, sai na hora -- offline isto falha e o
      // item simplesmente continua na fila.
      void sincronizar();
      return { estado: "enfileirado", id };
    },
    [recarregar, sincronizar]
  );

  const descartar = useCallback(
    async (id: string) => {
      await removerItem(id);
      await recarregar();
      avisarTodos();
    },
    [recarregar]
  );

  useEffect(() => {
    setOnline(navigator.onLine);
    void recarregar();

    const aoVoltar = () => {
      setOnline(true);
      void sincronizar();
    };
    const aoCair = () => setOnline(false);

    window.addEventListener("online", aoVoltar);
    window.addEventListener("offline", aoCair);
    ouvintes.add(recarregar);

    // O evento `online` nao dispara quando o app ABRE ja com rede -- e esse e
    // o caso mais comum de fila cheia: a pessoa lancou offline, fechou o app, e
    // so voltou a abrir em casa. Sem esta chamada a fila esperaria uma queda de
    // conexao para so entao esvaziar.
    if (navigator.onLine) void sincronizar();

    return () => {
      window.removeEventListener("online", aoVoltar);
      window.removeEventListener("offline", aoCair);
      ouvintes.delete(recarregar);
    };
  }, [recarregar, sincronizar]);

  return {
    online,
    itens,
    resumo: resumirFila(itens),
    enfileirar,
    sincronizar,
    descartar,
  };
}
