"use client";

// ---------------------------------------------------------------------------
// OS GASTOS DE UM CARTAO (HMO-210)  /dashboard/cartoes/[id]
// ---------------------------------------------------------------------------
// Fase 3 da HMO-208. A Fase 2 (HMO-209) tirou a compra individual de cartao de
// Contas a Pagar, para a mesma despesa nao ser somada duas vezes ao lado da
// fatura cheia. Esta tela e o lugar onde aquelas compras voltam a aparecer --
// agora dentro da fatura a que elas pertencem, e com o mes no rotulo.
//
// SO A FIACAO ESTA AQUI. A marcacao esta em `components/cartoes/FaturaDoCartao`
// e as regras em `lib/fatura-do-cartao.ts`, porque e isso que o teste consegue
// renderizar e afirmar sem navegador.
//
// NAO HA ROTA NOVA, de proposito. `GET /api/card-invoices` ja aceita
// `account_id` e decide o mes da compra pela view `card_invoice_lines` (006).
// Uma segunda consulta aquela view seria uma segunda chance de divergir da
// primeira -- e a divergencia apareceria como "o painel diz R$ 1.200 e o
// cartao diz R$ 1.340", sem nada ficar vermelho.
//
// DUAS LEITURAS, UM ESTADO
// ------------------------
// O cabecalho (nome, limite, fechamento/vencimento) vem do CADASTRO, e a lista
// vem da FATURA: duas chamadas. `estadoDaTela` reduz as duas a mais pessimista
// antes de qualquer numero aparecer, senao o cadastro fresco libera o total de
// uma fatura que nao carregou -- "R$ 0,00" indistinguivel de um mes sem compra.
//
// NAO ha `useSearchParams` nesta rota. Sob `[id]` o Next consome a chave de
// mesmo nome ao montar `params`, e `searchParams.get("id")` volta `null`
// (HMO-142). O cartao escolhido viaja para o formulario de despesa por
// `PARAM_DO_CARTAO`, que vale `cartao`.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CardInvoice } from "@/types/financial";
import { useContas } from "@/lib/hooks/useContas";
import { buscarLeitura, type EstadoDaLeitura } from "@/lib/offline-leitura";
import {
  cartaoDaTela,
  estadoDaTela,
  faturaDoCartao,
  mesCorrenteDaFatura,
} from "@/lib/fatura-do-cartao";
import {
  FaixaDadoDoAparelho,
  PainelErroDoServidor,
  PainelSemRede,
} from "@/components/SemRede";
import { FaturaDoCartao } from "@/components/cartoes/FaturaDoCartao";

interface RespostaDeFaturas {
  month?: string;
  invoices?: CardInvoice[];
}

export default function GastosDoCartaoPage() {
  const params = useParams<{ id: string }>();
  const idDoCartao = typeof params?.id === "string" ? params.id : "";

  // O cadastro. `include_inactive=1` ja vem de dentro do hook, entao abrir o
  // link de um cartao arquivado mostra a fatura dele em vez de "nao e seu".
  const {
    ativas,
    arquivadas,
    carregando: carregandoContas,
    estado: estadoDasContas,
    guardadoEm,
    carregar: recarregarContas,
  } = useContas("cartao");

  const [mes, setMes] = useState(() => mesCorrenteDaFatura());
  const [faturas, setFaturas] = useState<CardInvoice[] | null>(null);
  const [estadoDaFatura, setEstadoDaFatura] = useState<EstadoDaLeitura | null>(
    null
  );

  const conta = useMemo(
    () => cartaoDaTela([...ativas, ...arquivadas], idDoCartao),
    [ativas, arquivadas, idDoCartao]
  );

  const carregarFatura = useCallback(async () => {
    if (!idDoCartao) return;

    setEstadoDaFatura(null);
    const leitura = await buscarLeitura<RespostaDeFaturas>(
      `/api/card-invoices?account_id=${encodeURIComponent(
        idDoCartao
      )}&month=${mes}`
    );

    setEstadoDaFatura(leitura.estado);
    // So sobrescreve quando houve corpo: zerar no caminho de falha apagaria da
    // tela a fatura que uma busca anterior ja tinha trazido, e a lista sumiria
    // ao perder o sinal -- mesma regra do `useContas`.
    if (leitura.dados) setFaturas(leitura.dados.invoices ?? []);
  }, [idDoCartao, mes]);

  useEffect(() => {
    carregarFatura();
  }, [carregarFatura]);

  const estado = estadoDaTela([estadoDasContas, estadoDaFatura]);

  const recarregar = useCallback(() => {
    recarregarContas();
    carregarFatura();
  }, [recarregarContas, carregarFatura]);

  if (carregandoContas || estadoDaFatura === null) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-info" />
      </div>
    );
  }

  // Sem cadastro nao ha cabecalho, e sem cabecalho a lista de gastos nao tem
  // dono. Os dois motivos de `conta` ser nula terminam aqui de proposito:
  // "nao e seu" e "nao existe" merecem a mesma tela, porque distinguir os dois
  // contaria a um estranho que aquele id existe.
  if (!conta) {
    if (estado === "sem-rede") {
      return <PainelSemRede oQue="este cartão" aoTentarDeNovo={recarregar} />;
    }
    if (estado === "erro-do-servidor") {
      return (
        <PainelErroDoServidor oQue="este cartão" aoTentarDeNovo={recarregar} />
      );
    }

    return (
      <Card>
        <CardContent className="space-y-4 py-10 text-center">
          <p className="font-medium text-foreground">Cartão não encontrado</p>
          <p className="text-sm text-muted-foreground">
            Ele pode ter sido removido, ou o endereço não é de um cartão seu.
          </p>
          <Button variant="outline" asChild>
            <Link href="/dashboard/cartoes">Voltar para Cartões</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {estado === "do-aparelho" && (
        <FaixaDadoDoAparelho
          guardadoEm={guardadoEm}
          soLeitura
          aoTentarDeNovo={recarregar}
        />
      )}

      <FaturaDoCartao
        conta={conta}
        fatura={faturaDoCartao(faturas, idDoCartao)}
        mes={mes}
        estado={estado}
        aoMudarMes={setMes}
      />
    </div>
  );
}
