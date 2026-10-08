"use client";

// A tela de investimentos (HMO-169).
//
// Ela existe para ligar quatro componentes que estavam escritos e sem
// importador desde a HMO-163 -- DashboardSummary, PortfolioTable,
// AssetAllocationChart e PerformanceChart. Eles nao foram apagados porque nao
// eram codigo morto: era a TELA deles que faltava, e a tela faltava porque nao
// havia de onde o dado vir. A migration 021 criou de onde.
//
// Todos os numeros vem de GET /api/investments. Nenhum e calculado aqui -- e a
// condicao que a HMO-124 deixou escrita ("os numeros da tela vem das rotas,
// nunca calculados na tela") depois de encontrar esta mesma pagina mostrando
// R$ 55.000 de carteira e 100 acoes da PETR4 que nunca existiram.
//
// O QUE ESTA TELA NAO PROMETE
// ---------------------------
// Nao ha cotacao automatica: o preco atual e informado a mao pelo usuario, e a
// tela diz isso em vez de deixar o numero passar por cotacao de mercado. Ativo
// sem preco e avaliado pelo custo e entra no aviso do topo. Ver o cabecalho de
// lib/investments.ts.

import { useState, useEffect, useCallback } from "react";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/client";
import { SoftFeatureGuard } from "@/components/subscription/SoftFeatureGuard";
import { DashboardSummary } from "@/components/DashboardSummary";
import { PortfolioTable } from "@/components/PortfolioTable";
import { AssetAllocationChart } from "@/components/charts/AssetAllocationChart";
import { PerformanceChart } from "@/components/charts/PerformanceChart";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Plus, AlertTriangle, Trash2, Tag } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  CrivosDeFundamento,
  type DadosDosCrivos,
} from "@/components/investments/CrivosDeFundamento";
import {
  ModalDeMovimentacao,
  type ValoresDaMovimentacao,
} from "@/components/investments/ModalDeMovimentacao";
import {
  ModalDeCadastroDeAtivo,
  type ValoresDoAtivo,
} from "@/components/investments/ModalDeCadastroDeAtivo";
import type { LimitesDosCrivos } from "@/lib/crivos";
import {
  ROTULO_TIPO,
  type AssetType,
  type InvestmentKind,
  type Posicao,
  type ResumoCarteira,
  type FatiaAlocacao,
  type PontoEvolucao,
} from "@/lib/investments";
import {
  CamposDeRendaFixa,
  RendaFixaDaCarteira,
  corpoDeRendaFixa,
  type RendaFixaDaRota,
  type ValoresDeRendaFixa,
} from "@/components/RendaFixaDaCarteira";

interface AtivoDaTela {
  id: string;
  symbol: string;
  name: string;
  type: AssetType;
  currency: string | null;
  current_price: number | string | null;
  current_price_at: string | null;
  // Os seis campos da migration 031 (HMO-192). Nulos em todo ativo cadastrado
  // antes dela, e e por isso que a edicao existe: o preenchimento e progressivo.
  fixed_income_product?: string | null;
  index_kind?: string | null;
  index_percentage?: number | string | null;
  spread_annual?: number | string | null;
  applied_date?: string | null;
  maturity_date?: string | null;
}

interface LancamentoDaTela {
  id: string;
  asset_id: string;
  kind: InvestmentKind;
  quantity: number | string;
  unit_price: number | string;
  fees: number | string | null;
  trade_date: string;
}

interface Carteira {
  assets: AtivoDaTela[];
  transactions: LancamentoDaTela[];
  positions: Posicao[];
  summary: ResumoCarteira;
  allocation: FatiaAlocacao[];
  evolution: PontoEvolucao[];
}

/** Hoje em AAAA-MM-DD, que e o formato que o input date e a rota esperam. */
function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function InvestmentsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [carteira, setCarteira] = useState<Carteira | null>(null);
  const [crivos, setCrivos] = useState<DadosDosCrivos | null>(null);
  const [erroCrivos, setErroCrivos] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // OS DOIS MODAIS (HMO-252)
  //
  // Os dois formularios desta tela eram `<Card>` empilhados no corpo da pagina,
  // depois da lista de ativos e de dois graficos -- a unica tela de lancamento
  // do app que a HMO-249 nao alcancou. Agora sao modais abertos por botao no
  // cabecalho, e os campos deles sao estado DO MODAL, nao da pagina: cada
  // abertura e uma montagem nova, logo nasce limpa sem efeito de
  // sincronizacao, e nao existe "modal fechado guardando a compra de ontem".
  const [movimentacaoAberta, setMovimentacaoAberta] = useState(false);
  const [cadastroAberto, setCadastroAberto] = useState(false);
  /** O ativo ja escolhido quando a abertura veio do `+` de uma linha. */
  const [ativoDoModal, setAtivoDoModal] = useState("");

  // Renda fixa (HMO-192). `null` cobre dois estados de proposito: ainda nao
  // carregou e nao foi possivel carregar. Nos dois o card nao aparece, e o resto
  // da tela abre igual -- o Banco Central estar fora do ar nao e motivo para a
  // carteira inteira ficar em branco.
  const [rendaFixa, setRendaFixa] = useState<RendaFixaDaRota | null>(null);
  /** Os seis campos em edicao, por asset_id. */
  const [edicaoRf, setEdicaoRf] = useState<Record<string, ValoresDeRendaFixa>>(
    {}
  );

  const supabase = createClient();

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const resposta = await fetch("/api/investments");
      const corpo = await resposta.json();
      if (!resposta.ok) {
        setErro(corpo?.error || "Nao foi possivel carregar a carteira");
        return;
      }
      setCarteira(corpo as Carteira);
    } catch {
      setErro("Nao foi possivel carregar a carteira");
    }

    // Segunda ida, de proposito separada: esta rota fala com o Banco Central e
    // pode demorar ou falhar, e nenhuma das duas coisas pode atrasar ou derrubar
    // a carteira acima. Por isso ela nao esta no mesmo `try` nem usa `setErro`:
    // falha aqui some com o card de renda fixa, nao com a tela.
    try {
      const resposta = await fetch("/api/investments/renda-fixa");
      if (resposta.ok) {
        setRendaFixa((await resposta.json()) as RendaFixaDaRota);
      }
    } catch {
      // Silencio deliberado -- ver acima.
    }
  }, []);

  // Os criterios vem de rota propria, e a falha dela nao derruba a carteira: o
  // fundamento da CVM depende da migration 028 estar aplicada, e a pagina de
  // investimentos precisa abrir do mesmo jeito sem ele. Ver o cabecalho de
  // app/api/investments/crivos/route.ts.
  const carregarCrivos = useCallback(async () => {
    setErroCrivos(null);
    try {
      const resposta = await fetch("/api/investments/crivos");
      const corpo = await resposta.json();
      if (!resposta.ok) {
        setErroCrivos(corpo?.error || "Nao foi possivel carregar os criterios");
        return;
      }
      setCrivos(corpo as DadosDosCrivos);
    } catch {
      setErroCrivos("Nao foi possivel carregar os criterios");
    }
  }, []);

  async function salvarLimites(limites: LimitesDosCrivos) {
    try {
      const resposta = await fetch("/api/investments/crivos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limites }),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) {
        return { ok: false, erro: corpo?.error as string | undefined };
      }
      // Recarrega para que o "valendo agora" passe a ser o que o BANCO tem, e
      // nao o que a tela acha que gravou.
      await carregarCrivos();
      return { ok: true };
    } catch {
      return { ok: false, erro: "Nao foi possivel salvar os criterios" };
    }
  }

  useEffect(() => {
    const iniciar = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
      if (user) await Promise.all([carregar(), carregarCrivos()]);
      setCarregando(false);
    };
    iniciar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Grava o ativo. Devolve a frase de erro, ou `null` quando gravou.
   *
   * A frase VOLTA em vez de ir para `setErro` porque o `<Alert>` desta pagina
   * fica atras do overlay do modal: uma recusa da rota seria invisivel para
   * quem esta com o formulario aberto, e o sintoma e o pior possivel -- o botao
   * que parece nao fazer nada. Quem mostra e o modal (HMO-252).
   */
  async function cadastrarAtivo(
    valores: ValoresDoAtivo
  ): Promise<string | null> {
    setSalvando(true);
    try {
      const resposta = await fetch("/api/investments/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: valores.symbol,
          name: valores.nome,
          type: valores.tipo,
          currentPrice: valores.preco === "" ? null : valores.preco,
          // So renda fixa carrega os seis campos: o CHECK
          // `renda_fixa_so_em_fixed_income` da 031 recusa uma PETR4 com
          // indexador, porque ela apareceria na tela rendendo CDI POR CIMA da
          // variacao de preco -- o rendimento contado duas vezes.
          ...(valores.tipo === "fixed_income"
            ? corpoDeRendaFixa(valores.rendaFixa)
            : {}),
        }),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) {
        return corpo?.error || "Nao foi possivel cadastrar o ativo";
      }
      // Ativo novo muda a lista de criterios tambem -- sem isto o ativo aparece
      // na carteira e nao aparece nos criterios ate a pessoa recarregar a pagina.
      await Promise.all([carregar(), carregarCrivos()]);
      return null;
    } catch {
      return "Nao foi possivel cadastrar o ativo";
    } finally {
      setSalvando(false);
    }
  }

  /** O mesmo contrato de `cadastrarAtivo`: a frase de erro, ou `null`. */
  async function lancar(
    valores: ValoresDaMovimentacao
  ): Promise<string | null> {
    // AS DUAS TRAVAS QUE O CONTROLE DE DATA NATIVO FAZIA SOZINHO (HMO-240)
    //
    // O campo mascarado e um input de TEXTO, e nos dois casos o navegador deixa
    // o formulario passar:
    //
    //   - `required` se satisfaz com o texto parcial na tela ("10/0"), enquanto
    //     o valor emitido e vazio. A rota recusa o vazio com 400, mas a frase
    //     que chega na tela e sobre formato e nao sobre o campo.
    //   - `max` nao existe para texto. Sem esta recusa, uma compra lancada com
    //     data futura entra: `trade_date` so e conferido contra o formato, e um
    //     lancamento no futuro distorce preco medio e rentabilidade sem erro
    //     nenhum no caminho.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valores.data)) {
      return "Informe a data do lancamento, no formato dd/mm/aaaa.";
    }
    if (valores.data > hojeISO()) {
      return "A data do lancamento nao pode ser no futuro.";
    }

    setSalvando(true);
    try {
      const resposta = await fetch("/api/investments/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: valores.assetId,
          kind: valores.kind,
          quantity: valores.quantidade,
          unitPrice: valores.preco,
          fees: valores.taxas === "" ? 0 : valores.taxas,
          tradeDate: valores.data,
        }),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) {
        return corpo?.error || "Nao foi possivel gravar o lancamento";
      }
      // Recarrega mesmo com "Salvar e continuar" ligado: a carteira ATRAS do
      // modal passa a mostrar o lancamento que acabou de entrar, e e por ela
      // que a pessoa confere que a sequencia esta indo.
      await carregar();
      return null;
    } catch {
      return "Nao foi possivel gravar o lancamento";
    } finally {
      setSalvando(false);
    }
  }

  async function atualizarPreco(assetId: string, valor: string) {
    setSalvando(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/investments/assets/${assetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPrice: valor === "" ? null : valor }),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) {
        setErro(corpo?.error || "Nao foi possivel atualizar o preco");
        return;
      }
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  /**
   * Os valores de renda fixa de um ativo: o que esta sendo editado, ou o que
   * veio do banco.
   *
   * `numeric` chega do PostgREST como STRING, e `String(null)` e "null" -- um
   * literal que o input mostraria como texto e a rota recusaria. Daí o `?? ""`.
   */
  function valoresRfDoAtivo(ativo: AtivoDaTela): ValoresDeRendaFixa {
    const emEdicao = edicaoRf[ativo.id];
    if (emEdicao) return emEdicao;
    return {
      fixedIncomeProduct: ativo.fixed_income_product ?? "",
      indexKind: ativo.index_kind ?? "",
      indexPercentage:
        ativo.index_percentage === null || ativo.index_percentage === undefined
          ? ""
          : String(Number(ativo.index_percentage)),
      spreadAnnual:
        ativo.spread_annual === null || ativo.spread_annual === undefined
          ? ""
          : String(Number(ativo.spread_annual)),
      appliedDate: ativo.applied_date ?? "",
      maturityDate: ativo.maturity_date ?? "",
    };
  }

  /**
   * Grava os seis campos da 031 de um ativo.
   *
   * Vao todos juntos porque os CHECK da migration cruzam uns com os outros --
   * ver o PATCH em /api/investments/assets/[assetId].
   */
  async function salvarRendaFixa(ativo: AtivoDaTela) {
    setSalvando(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/investments/assets/${ativo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpoDeRendaFixa(valoresRfDoAtivo(ativo))),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) {
        setErro(corpo?.error || "Nao foi possivel salvar a renda fixa");
        return;
      }
      // Limpa o rascunho DESTE ativo para a tela voltar a mostrar o que o banco
      // gravou. Sem isso, um campo recusado e corrigido pelo servidor (ou um
      // valor normalizado) continuaria na tela com o texto antigo.
      setEdicaoRf((atual) => {
        const proximo = { ...atual };
        delete proximo[ativo.id];
        return proximo;
      });
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function removerAtivo(assetId: string, symbol: string) {
    if (
      !window.confirm(
        `Remover ${symbol} e todos os lancamentos dele? Isso nao pode ser desfeito.`
      )
    ) {
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/investments/assets/${assetId}`, {
        method: "DELETE",
      });
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => null);
        setErro(corpo?.error || "Nao foi possivel remover o ativo");
        return;
      }
      // O ativo removido nao pode continuar pre-escolhido para a proxima
      // abertura do modal: o Select ficaria apontando para um id que nao existe
      // mais, e o Lancar devolveria 404 sem que a tela explicasse nada.
      if (ativoDoModal === assetId) setAtivoDoModal("");
      await Promise.all([carregar(), carregarCrivos()]);
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const resumo = carteira?.summary;
  const ativos = carteira?.assets || [];
  const posicoes = carteira?.positions || [];
  const comExcesso = posicoes.filter((p) => p.exceeded_position);

  return (
    <SoftFeatureGuard feature="investment_tracking" user={user}>
      <div className="container mx-auto py-6 space-y-6">
        {/* O cabecalho, com os dois gestos de criacao (HMO-252). `sm:flex-row`
            e nao `flex-row`: no celular o titulo e os dois botoes empilham, e um
            trilho horizontal com tres itens ai e scroll de lado (HMO-168). */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <TrendingUp className="h-8 w-8" />
              Investimentos
            </h1>
            <p className="text-muted-foreground">
              Carteira lançada por você. Os preços atuais são os que você
              informar — não há cotação automática.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Lancar vem primeiro e e o botao cheio: cadastrar ativo se faz
                uma vez por papel, lancar movimentacao se faz todo mes. */}
            <Button
              onClick={() => {
                setAtivoDoModal("");
                setMovimentacaoAberta(true);
              }}
              disabled={ativos.length === 0}
            >
              <Plus className="h-4 w-4 mr-2" />
              Lançar movimentação
            </Button>
            <Button variant="outline" onClick={() => setCadastroAberto(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Cadastrar ativo
            </Button>
          </div>
        </div>

        {/* O botao desabilitado sem dizer por que e um botao quebrado. */}
        {ativos.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Cadastre um ativo antes de lançar uma movimentação.
          </p>
        )}

        {erro && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}

        {/* O aviso de preço ausente não é decoração: sem ele, "Valor Atual" e
            "Total Investido" aparecem iguais e o usuário conclui que a carteira
            não rendeu nada, em vez de entender que falta informar o preço. */}
        {resumo && resumo.ativosSemPreco > 0 && (
          <Alert>
            <Tag className="h-4 w-4" />
            <AlertDescription>
              {resumo.ativosSemPreco === 1
                ? "1 ativo está sem preço atual e aparece avaliado pelo que custou."
                : `${resumo.ativosSemPreco} ativos estão sem preço atual e aparecem avaliados pelo que custaram.`}{" "}
              Informe o preço na lista de ativos abaixo para ver o resultado.
            </AlertDescription>
          </Alert>
        )}

        {comExcesso.length > 0 && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {comExcesso.map((p) => p.symbol).join(", ")} tem mais vendas do que
              compras lançadas. A posição foi travada em zero — confira os
              lançamentos desse ativo.
            </AlertDescription>
          </Alert>
        )}

        {resumo && (
          <DashboardSummary
            totalInvested={resumo.totalInvested}
            currentValue={resumo.currentValue}
            totalProfitLoss={resumo.totalProfitLoss}
            totalProfitLossPercentage={resumo.totalProfitLossPercentage}
            totalDividends={resumo.totalDividends}
          />
        )}

        {resumo && resumo.realizedProfitLoss !== 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">
                Resultado já realizado
              </CardTitle>
              <CardDescription>
                O que as vendas fecharam. Fica separado do lucro da carteira de
                propósito: vender no lucro não aumenta o valor do que você ainda
                tem.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${
                  resumo.realizedProfitLoss >= 0
                    ? "text-success"
                    : "text-destructive"
                }`}
              >
                {formatCurrency(resumo.realizedProfitLoss)}
              </div>
            </CardContent>
          </Card>
        )}

        {/* `grid-cols-1` explícito na base: um trilho `auto` tem o min-content
            como piso e cresce além do container em vez de apertar, e foi assim
            que oito telas ganharam scroll horizontal no celular (HMO-168). */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {carteira && carteira.allocation.length > 0 && (
            <AssetAllocationChart data={carteira.allocation} />
          )}
          {carteira && carteira.evolution.length > 0 && (
            <PerformanceChart
              data={carteira.evolution}
              title="Evolução do valor investido"
              description="Quanto você tinha aplicado no fim de cada mês. Não é valor de mercado: não há série histórica de cotação, só o preço de hoje."
            />
          )}
        </div>

        {/* O `+` de uma linha ABRE o modal com aquele ativo escolhido. Antes
            desta issue ele so escrevia no estado de um formulario que ficava
            tres secoes abaixo, sem rolar a tela: o clique nao tinha efeito
            visivel nenhum (HMO-252). */}
        <PortfolioTable
          data={posicoes}
          onAddTransaction={(assetId) => {
            setAtivoDoModal(assetId);
            setMovimentacaoAberta(true);
          }}
        />

        {/* Renda fixa que rende sozinha (HMO-192): bruto em destaque, liquido
            estimado ao lado. Devolve `null` quando nao ha renda fixa na
            carteira -- ver o componente. */}
        <RendaFixaDaCarteira dados={rendaFixa} />
        {/* --- Os critérios de fundamento (HMO-195) ------------------------- */}
        {erroCrivos && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {erroCrivos}. A carteira acima não depende disso.
            </AlertDescription>
          </Alert>
        )}
        {crivos && (
          <CrivosDeFundamento dados={crivos} onSalvar={salvarLimites} />
        )}

        {/* --- Ativos cadastrados, com o preço atual editável ---------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Ativos cadastrados</CardTitle>
            <CardDescription>
              O preço atual é informado por você. A data ao lado é de quando você
              informou.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {ativos.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum ativo ainda. Cadastre o primeiro em &ldquo;Cadastrar
                ativo&rdquo;, no topo da tela.
              </p>
            )}

            {ativos.map((ativo) => (
              <div
                key={ativo.id}
                className="grid grid-cols-1 gap-3 border-b pb-4 last:border-b-0 last:pb-0 sm:grid-cols-[1fr_auto] sm:items-end"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{ativo.symbol}</span>
                    <Badge variant="outline">{ROTULO_TIPO[ativo.type]}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{ativo.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {ativo.current_price_at
                      ? `Preço informado em ${formatDate(ativo.current_price_at)}`
                      : "Sem preço informado"}
                  </p>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    {/* Sem a mascara de R$ de proposito: cotacao tem oito
                        casas, e a mascara tem as da moeda. Ver o bloco de
                        Quantidade, mais abaixo, para o porque completo. */}
                    <Label htmlFor={`preco-${ativo.id}`} className="text-xs">
                      Preço atual
                    </Label>
                    <Input
                      id={`preco-${ativo.id}`}
                      type="number"
                      step="0.00000001"
                      min="0"
                      className="w-32"
                      defaultValue={
                        ativo.current_price === null
                          ? ""
                          : String(ativo.current_price)
                      }
                      onBlur={(e) => {
                        const valor = e.target.value;
                        const atual =
                          ativo.current_price === null
                            ? ""
                            : String(Number(ativo.current_price));
                        // Só grava se mudou: sem isso todo clique fora do campo
                        // reescreve a data do preço e a tela passa a dizer
                        // "informado hoje" para um preço de semanas atrás.
                        if (String(Number(valor) || "") !== atual) {
                          atualizarPreco(ativo.id, valor);
                        }
                      }}
                    />
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={`Remover ${ativo.symbol}`}
                    disabled={salvando}
                    onClick={() => removerAtivo(ativo.id, ativo.symbol)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                {/* Os seis campos da 031 so para renda fixa (HMO-192). Este e o
                    caminho que cumpre o "preenchimento progressivo" prometido
                    pela migration: os ativos cadastrados desde a 021 estao
                    todos com os campos nulos, e sem edicao eles nunca ganhariam
                    rendimento automatico -- so quem cadastrasse de novo. */}
                {ativo.type === "fixed_income" && (
                  <div className="space-y-3 sm:col-span-2">
                    <CamposDeRendaFixa
                      idPrefixo={`rf-${ativo.id}`}
                      valores={valoresRfDoAtivo(ativo)}
                      onChange={(v) =>
                        setEdicaoRf((atual) => ({ ...atual, [ativo.id]: v }))
                      }
                      desabilitado={salvando}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={salvando}
                      onClick={() => salvarRendaFixa(ativo)}
                    >
                      Salvar renda fixa de {ativo.symbol}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* --- Os dois modais (HMO-252) -------------------------------------

            Montados CONDICIONALMENTE, e nao com `open={estado}`: fechado, o
            modal nao existe, entao a abertura seguinte e uma montagem nova e o
            formulario nasce limpo sem nenhum efeito de sincronizacao. Nao ha o
            estado "fechado guardando a compra de ontem" para esquecer de
            limpar. (Em `ModalDeLancamento` da HMO-249 o `open` nasce `true`
            pelo mesmo motivo, por outro caminho: la o modal E a rota.) */}
        {movimentacaoAberta && (
          <ModalDeMovimentacao
            ativos={ativos}
            ativoInicial={ativoDoModal}
            hoje={hojeISO()}
            salvando={salvando}
            aoFechar={() => setMovimentacaoAberta(false)}
            aoSalvar={lancar}
          />
        )}

        {cadastroAberto && (
          <ModalDeCadastroDeAtivo
            salvando={salvando}
            aoFechar={() => setCadastroAberto(false)}
            aoSalvar={cadastrarAtivo}
          />
        )}
      </div>
    </SoftFeatureGuard>
  );
}
