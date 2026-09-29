"use client";

// ---------------------------------------------------------------------------
// O QUE AS DUAS TELAS DE CADASTRO COMPARTILHAM (HMO-166)
// ---------------------------------------------------------------------------
// Contas e Cartoes sao telas diferentes -- campos diferentes, totais diferentes,
// cada cartao com um aviso que conta nenhuma tem. O que elas NAO tem de
// diferente e a conversa com `/api/financial-accounts`: buscar, salvar,
// arquivar, reativar, e o tratamento de leitura sem rede.
//
// Isso mora aqui por um motivo concreto deste repositorio: tres copias da mesma
// soma divergem na primeira mudanca, e foi assim que a transferencia passou a
// contar duas vezes. Duas copias de um `fetch` que grava conta divergiriam do
// mesmo jeito -- e a que divergisse seria a menos usada, que e a que ninguem
// confere.
//
// Ele busca a lista INTEIRA e filtra por escopo no cliente, de proposito:
// `include_inactive=1` ja e a unica chamada do app que traz conta arquivada, e
// o modo offline le do catalogo do aparelho, onde nao ha filtro do servidor
// para pedir. Ver `lib/offline-leitura.ts`.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FinancialAccount } from "@/types/financial";
import {
  contasDoEscopo,
  corpoDaConta,
  validarConta,
  type EscopoDeConta,
  type ValoresDaConta,
} from "@/lib/contas";
import {
  buscarLeitura,
  type EstadoDaLeitura,
} from "@/lib/offline-leitura";
import { toast } from "sonner";

export interface UseContas {
  /** Ativas, so as do escopo desta tela. */
  ativas: FinancialAccount[];
  /** Arquivadas, so as do escopo desta tela. */
  arquivadas: FinancialAccount[];
  carregando: boolean;
  salvando: boolean;
  /** De onde veio o que esta na tela. `null` = ainda nao carregou. */
  estado: EstadoDaLeitura | null;
  guardadoEm: Date | null;
  carregar: () => Promise<void>;
  /** `true` quando gravou. O erro ja foi para a tela em forma de mensagem. */
  salvar: (valores: ValoresDaConta) => Promise<boolean>;
  arquivar: (conta: FinancialAccount) => Promise<void>;
  reativar: (conta: FinancialAccount) => Promise<void>;
}

export function useContas(escopo: EscopoDeConta): UseContas {
  const [contas, setContas] = useState<FinancialAccount[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [estado, setEstado] = useState<EstadoDaLeitura | null>(null);
  const [guardadoEm, setGuardadoEm] = useState<Date | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    // include_inactive: estas sao as unicas telas que mostram conta arquivada,
    // para poder reativar. O resto do app so enxerga as ativas.
    const leitura = await buscarLeitura<{ accounts?: FinancialAccount[] }>(
      "/api/financial-accounts?include_inactive=1"
    );

    setEstado(leitura.estado);
    setGuardadoEm(leitura.guardadoEm);

    // So sobrescreve a lista quando houve resposta com corpo. Zerar aqui no
    // caminho de falha apagaria da tela o que uma busca anterior ja tinha
    // trazido -- e a pessoa veria as contas sumirem ao perder o sinal.
    if (leitura.dados) setContas(leitura.dados.accounts ?? []);

    setCarregando(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const doEscopo = useMemo(
    () => contasDoEscopo(contas, escopo),
    [contas, escopo]
  );
  const ativas = useMemo(() => doEscopo.filter((c) => c.is_active), [doEscopo]);
  const arquivadas = useMemo(
    () => doEscopo.filter((c) => !c.is_active),
    [doEscopo]
  );

  const salvar = useCallback(
    async (valores: ValoresDaConta) => {
      const impedimento = validarConta(valores, escopo);
      if (impedimento) {
        toast.error(impedimento);
        return false;
      }

      setSalvando(true);
      try {
        const resposta = await fetch(
          valores.id
            ? `/api/financial-accounts/${valores.id}`
            : "/api/financial-accounts",
          {
            method: valores.id ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(corpoDaConta(valores, escopo)),
          }
        );

        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(dados.error ?? "falha ao salvar");

        const substantivo = escopo === "cartao" ? "Cartão" : "Conta";
        toast.success(
          valores.id ? `${substantivo} atualizado` : `${substantivo} criado`
        );
        await carregar();
        return true;
      } catch (erro) {
        toast.error(erro instanceof Error ? erro.message : "Erro ao salvar");
        return false;
      } finally {
        setSalvando(false);
      }
    },
    [escopo, carregar]
  );

  const arquivar = useCallback(
    async (conta: FinancialAccount) => {
      try {
        const resposta = await fetch(`/api/financial-accounts/${conta.id}`, {
          method: "DELETE",
        });
        if (!resposta.ok) throw new Error("falha ao arquivar");
        toast.success(`${conta.name} foi arquivado`);
        await carregar();
      } catch {
        toast.error("Não foi possível arquivar");
      }
    },
    [carregar]
  );

  const reativar = useCallback(
    async (conta: FinancialAccount) => {
      try {
        const resposta = await fetch(`/api/financial-accounts/${conta.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ is_active: true }),
        });
        if (!resposta.ok) throw new Error("falha ao reativar");
        toast.success(`${conta.name} voltou para a lista`);
        await carregar();
      } catch {
        toast.error("Não foi possível reativar");
      }
    },
    [carregar]
  );

  return {
    ativas,
    arquivadas,
    carregando,
    salvando,
    estado,
    guardadoEm,
    carregar,
    salvar,
    arquivar,
    reativar,
  };
}
