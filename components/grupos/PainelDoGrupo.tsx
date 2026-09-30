"use client";

/**
 * O painel do grupo (HMO-201, parte 3).
 *
 * "Grupos tambem devem ter uma especie de dashboard dando os totais de gastos
 * e separado por categoria, alem de ter [...] a possibilidade de escolher o
 * periodo de datas."
 *
 * TUDO AQUI E DO GRUPO INTEIRO, E ISSO PRECISA ESTAR ESCRITO NA TELA
 * -------------------------------------------------------------------
 * As duas rotas sao chamadas com `groupId`, e nesse modo elas NAO filtram por
 * `user_id`: o numero e o gasto da viagem toda, de todos os membros. E a
 * leitura certa para um painel de grupo -- mas e a leitura ERRADA se alguem
 * ler "R$ 3.000" achando que gastou isso. A aba de Balancos e que responde
 * "quanto eu devo"; aqui a legenda diz, em texto, de quem e o dinheiro.
 *
 * POR QUE O PERIODO E O MESMO COMPONENTE DO PAINEL PRINCIPAL
 * -----------------------------------------------------------
 * `SeletorDePeriodo` ja resolve preset, mes a mes e intervalo personalizado,
 * e ja trata a edicao meio-feita (trocar o `de` para depois do `ate` sem a
 * tela pular sozinha). Escrever um segundo seletor aqui seria duas regras de
 * periodo para manter -- e, quando elas divergissem, dois numeros diferentes
 * para o mesmo mes em duas telas do mesmo app.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SeletorDePeriodo } from "@/components/dashboard/SeletorDePeriodo";
import {
  periodoCorrente,
  periodoParaQuery,
  rotuloDoPeriodo,
  type Periodo,
} from "@/lib/periodo-do-painel";
import { formatarValor } from "@/lib/dinheiro";
import { today } from "@/lib/recurrence";
import { ArrowDownCircle, ArrowUpCircle, PieChart, Wallet } from "lucide-react";

interface CategoriaDoPainel {
  category_id: string;
  category: { name: string; color_hex?: string | null } | null;
  expense: number;
  income: number;
  transaction_count: number;
  share: number;
}

interface ResumoDoFluxo {
  total_income: number;
  total_expense: number;
  net: number;
  transaction_count: number;
}

export function PainelDoGrupo({
  groupId,
  /**
   * Hoje em America/Sao_Paulo. `today()` e o mesmo helper que bills, budgets,
   * goals e o painel principal usam -- e nao `new Date()`, que nas tres
   * ultimas horas do mes devolve o mes SEGUINTE em UTC e faria o painel abrir
   * num periodo que a pessoa nao escolheu.
   */
  hoje = today(),
}: {
  groupId: string;
  hoje?: string;
}) {
  const [periodo, setPeriodo] = useState<Periodo>(() => periodoCorrente(hoje));
  const [categorias, setCategorias] = useState<CategoriaDoPainel[]>([]);
  const [fluxo, setFluxo] = useState<ResumoDoFluxo | null>(null);
  const [moeda, setMoeda] = useState("BRL");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);

    const query = `${periodoParaQuery(periodo)}&groupId=${groupId}`;

    try {
      // Em paralelo: em serie, o painel esperaria a soma dos dois tempos de
      // resposta antes de mostrar qualquer coisa.
      const [rCategorias, rFluxo] = await Promise.all([
        fetch(`/api/reports/categories?${query}`),
        fetch(`/api/reports/cash-flow?${query}`),
      ]);

      if (!rCategorias.ok || !rFluxo.ok) {
        setErro("Não foi possível carregar o painel deste grupo.");
        setCarregando(false);
        return;
      }

      const dCategorias = await rCategorias.json();
      const dFluxo = await rFluxo.json();

      setCategorias(dCategorias.categories ?? []);
      setFluxo(dFluxo.summary ?? null);
      // A moeda vem da resposta, e nao de uma constante: um grupo de viagem
      // pode estar inteiro em dolar, e rotular aquilo como real seria um
      // numero certo com o simbolo errado.
      setMoeda(dCategorias.currency ?? dFluxo.currency ?? "BRL");
    } catch (e) {
      console.error("Erro no painel do grupo:", e);
      setErro("Não foi possível carregar o painel deste grupo.");
    }

    setCarregando(false);
  }, [groupId, periodo]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const totalGasto = fluxo?.total_expense ?? 0;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="h-5 w-5" />
            Painel do grupo
          </CardTitle>
          <CardDescription>
            Os valores abaixo são do grupo inteiro, somando o que todos os
            membros lançaram — não apenas a sua parte. Quanto cada um deve está
            na aba Balanços.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SeletorDePeriodo
            periodo={periodo}
            hoje={hoje}
            aoMudar={setPeriodo}
          />
        </CardContent>
      </Card>

      {erro && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-destructive">{erro}</p>
          </CardContent>
        </Card>
      )}

      {/* `grid-cols-1` explicito: sem ele os tres tiles viram uma linha so no
          celular e a pagina ganha rolagem horizontal (HMO-184). */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground">
              <ArrowDownCircle className="h-4 w-4" />
              <span className="text-sm">Gastos do período</span>
            </div>
            <p className="text-2xl font-bold text-destructive mt-1">
              {carregando ? "—" : formatarValor(totalGasto, moeda)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground">
              <ArrowUpCircle className="h-4 w-4" />
              <span className="text-sm">Entradas do período</span>
            </div>
            <p className="text-2xl font-bold text-success mt-1">
              {carregando ? "—" : formatarValor(fluxo?.total_income ?? 0, moeda)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Wallet className="h-4 w-4" />
              <span className="text-sm">Lançamentos</span>
            </div>
            <p className="text-2xl font-bold mt-1">
              {carregando ? "—" : (fluxo?.transaction_count ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Por categoria</CardTitle>
          <CardDescription>{rotuloDoPeriodo(periodo)}</CardDescription>
        </CardHeader>
        <CardContent>
          {carregando ? (
            <p className="text-sm text-muted-foreground">Carregando...</p>
          ) : categorias.length === 0 ? (
            // Estado vazio explicito. Sem ele a tela mostraria um card em
            // branco, que se le como "quebrou" e nao como "nao houve gasto".
            <p className="text-sm text-muted-foreground">
              Nenhum lançamento neste grupo no período escolhido.
            </p>
          ) : (
            <div className="space-y-3">
              {categorias.map((c) => (
                <div key={c.category_id} className="space-y-1">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium truncate">
                      {c.category?.name ?? "Sem categoria"}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatarValor(c.expense, moeda)}{" "}
                      <span className="text-muted-foreground">
                        ({Math.round(c.share * 100)}%)
                      </span>
                    </span>
                  </div>
                  {/* A barra usa `share`, que a rota calcula sobre o total DA
                      MESMA MOEDA. Recalcular aqui dividindo pelo total geral
                      misturaria moedas e daria barras que nao somam 100%. */}
                  <div className="h-2 w-full rounded bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary"
                      style={{ width: `${Math.min(c.share * 100, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
