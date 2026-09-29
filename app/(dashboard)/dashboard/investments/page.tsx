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
import { CampoDeValor } from "@/components/ui/campo-de-valor";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Plus, AlertTriangle, Trash2, Tag } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  ROTULO_TIPO,
  TIPOS_DE_ATIVO,
  type AssetType,
  type InvestmentKind,
  type Posicao,
  type ResumoCarteira,
  type FatiaAlocacao,
  type PontoEvolucao,
} from "@/lib/investments";

interface AtivoDaTela {
  id: string;
  symbol: string;
  name: string;
  type: AssetType;
  currency: string | null;
  current_price: number | string | null;
  current_price_at: string | null;
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

const ROTULO_KIND: Record<InvestmentKind, string> = {
  buy: "Compra",
  sell: "Venda",
  dividend: "Provento",
};

/** Hoje em AAAA-MM-DD, que e o formato que o input date e a rota esperam. */
function hojeISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function InvestmentsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [carteira, setCarteira] = useState<Carteira | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Formulario de ativo
  const [novoSymbol, setNovoSymbol] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novoTipo, setNovoTipo] = useState<AssetType>("stock");
  const [novoPreco, setNovoPreco] = useState("");

  // Formulario de lancamento
  const [lancAtivo, setLancAtivo] = useState("");
  const [lancKind, setLancKind] = useState<InvestmentKind>("buy");
  const [lancQuantidade, setLancQuantidade] = useState("");
  const [lancPreco, setLancPreco] = useState("");
  const [lancTaxas, setLancTaxas] = useState("");
  const [lancData, setLancData] = useState(hojeISO());

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
  }, []);

  useEffect(() => {
    const iniciar = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUser(user);
      if (user) await carregar();
      setCarregando(false);
    };
    iniciar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function cadastrarAtivo(evento: React.FormEvent) {
    evento.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const resposta = await fetch("/api/investments/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: novoSymbol,
          name: novoNome,
          type: novoTipo,
          currentPrice: novoPreco === "" ? null : novoPreco,
        }),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) {
        setErro(corpo?.error || "Nao foi possivel cadastrar o ativo");
        return;
      }
      setNovoSymbol("");
      setNovoNome("");
      setNovoPreco("");
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  async function lancar(evento: React.FormEvent) {
    evento.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const resposta = await fetch("/api/investments/transactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId: lancAtivo,
          kind: lancKind,
          quantity: lancQuantidade,
          unitPrice: lancPreco,
          fees: lancTaxas === "" ? 0 : lancTaxas,
          tradeDate: lancData,
        }),
      });
      const corpo = await resposta.json();
      if (!resposta.ok) {
        setErro(corpo?.error || "Nao foi possivel gravar o lancamento");
        return;
      }
      setLancQuantidade("");
      setLancPreco("");
      setLancTaxas("");
      await carregar();
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
      if (lancAtivo === assetId) setLancAtivo("");
      await carregar();
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
        <div className="space-y-1">
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <TrendingUp className="h-8 w-8" />
            Investimentos
          </h1>
          <p className="text-muted-foreground">
            Carteira lançada por você. Os preços atuais são os que você informar
            — não há cotação automática.
          </p>
        </div>

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

        <PortfolioTable
          data={posicoes}
          onAddTransaction={(assetId) => {
            setLancAtivo(assetId);
            setLancKind("buy");
          }}
        />

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
                Nenhum ativo ainda. Cadastre o primeiro no formulário abaixo.
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
              </div>
            ))}
          </CardContent>
        </Card>

        {/* --- Cadastrar ativo --------------------------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Cadastrar ativo</CardTitle>
            <CardDescription>
              O código é como você identifica o ativo na sua carteira. Não há
              lista fechada de códigos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={cadastrarAtivo}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              <div className="space-y-2">
                <Label htmlFor="novo-symbol">Código</Label>
                <Input
                  id="novo-symbol"
                  value={novoSymbol}
                  onChange={(e) => setNovoSymbol(e.target.value.toUpperCase())}
                  placeholder="PETR4"
                  maxLength={16}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="novo-nome">Nome</Label>
                <Input
                  id="novo-nome"
                  value={novoNome}
                  onChange={(e) => setNovoNome(e.target.value)}
                  placeholder="Petrobras PN"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="novo-tipo">Tipo</Label>
                <Select
                  value={novoTipo}
                  onValueChange={(v) => setNovoTipo(v as AssetType)}
                >
                  <SelectTrigger id="novo-tipo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_DE_ATIVO.map((t) => (
                      <SelectItem key={t} value={t}>
                        {ROTULO_TIPO[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                {/* Cotacao, nao valor em reais: fica sem mascara. Ver o bloco
                    de Quantidade para o porque. */}
                <Label htmlFor="novo-preco">Preço atual (opcional)</Label>
                <Input
                  id="novo-preco"
                  type="number"
                  step="0.00000001"
                  min="0"
                  value={novoPreco}
                  onChange={(e) => setNovoPreco(e.target.value)}
                  placeholder="31,50"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-4">
                <Button type="submit" disabled={salvando}>
                  <Plus className="h-4 w-4 mr-2" />
                  Cadastrar ativo
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* --- Lançar compra, venda ou provento ---------------------------- */}
        <Card>
          <CardHeader>
            <CardTitle>Lançar movimentação</CardTitle>
            <CardDescription>
              Em provento, a quantidade são as cotas que receberam e o valor é o
              valor por cota.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ativos.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Cadastre um ativo antes de lançar.
              </p>
            ) : (
              <form
                onSubmit={lancar}
                className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                <div className="space-y-2">
                  <Label htmlFor="lanc-ativo">Ativo</Label>
                  <Select value={lancAtivo} onValueChange={setLancAtivo}>
                    <SelectTrigger id="lanc-ativo">
                      <SelectValue placeholder="Escolha o ativo" />
                    </SelectTrigger>
                    <SelectContent>
                      {ativos.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.symbol} — {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lanc-kind">Movimentação</Label>
                  <Select
                    value={lancKind}
                    onValueChange={(v) => setLancKind(v as InvestmentKind)}
                  >
                    <SelectTrigger id="lanc-kind">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ROTULO_KIND) as InvestmentKind[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {ROTULO_KIND[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lanc-data">Data</Label>
                  <Input
                    id="lanc-data"
                    type="date"
                    value={lancData}
                    max={hojeISO()}
                    onChange={(e) => setLancData(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  {/* POR QUE QUANTIDADE E COTACAO NAO LEVAM A MASCARA DE R$
                      (HMO-171)

                      A mascara de dinheiro tem as casas da MOEDA -- duas, em
                      real. Estes campos tem oito (`step="0.00000001"`), e por
                      um motivo: cripto e fracao de cota nao cabem em centavos.

                      Mascarar aqui nao deixaria o campo feio, arredondaria o
                      dado: um preco de 0,00000001 viraria R$ 0,01, um erro de um
                      milhao de vezes, em silencio -- exatamente a classe de bug
                      que a mascara foi criada para evitar. E quantidade de cotas
                      nem e dinheiro; nao tem simbolo de moeda para levar.

                      Se um dia a cotacao precisar de mascara, ela precisa de
                      casas por CAMPO e nao por moeda, que e outra decisao. */}
                  <Label htmlFor="lanc-quantidade">
                    {lancKind === "dividend" ? "Cotas" : "Quantidade"}
                  </Label>
                  <Input
                    id="lanc-quantidade"
                    type="number"
                    step="0.00000001"
                    min="0"
                    value={lancQuantidade}
                    onChange={(e) => setLancQuantidade(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lanc-preco">
                    {lancKind === "dividend"
                      ? "Valor por cota"
                      : "Preço unitário"}
                  </Label>
                  <Input
                    id="lanc-preco"
                    type="number"
                    step="0.00000001"
                    min="0"
                    value={lancPreco}
                    onChange={(e) => setLancPreco(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lanc-taxas">Taxas (opcional)</Label>
                  {/* Taxa de corretagem e dinheiro comum, com duas casas: entra
                      mascarado como todo campo de valor do app (HMO-171). Os
                      campos de COTACAO acima nao -- ver o comentario deles. */}
                  <CampoDeValor
                    id="lanc-taxas"
                    value={lancTaxas}
                    onChange={setLancTaxas}
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <Button type="submit" disabled={salvando || !lancAtivo}>
                    <Plus className="h-4 w-4 mr-2" />
                    Lançar {ROTULO_KIND[lancKind].toLowerCase()}
                  </Button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </SoftFeatureGuard>
  );
}
