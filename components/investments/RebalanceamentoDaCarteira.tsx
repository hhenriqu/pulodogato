"use client";

// O REBALANCEAMENTO DA CARTEIRA -- a aba Controle da planilha "Rebalanceamento
// de Carteira", dentro da tela de investimentos.
//
// A pessoa da um peso a cada ativo (a "Nota" da planilha) e, se quiser, um
// setor; digita quanto vai aportar; e a tabela diz, ativo por ativo, quanto ela
// quer ter, quanto falta, se o ativo esta abaixo do alvo ("Aportar") ou acima
// ("Aguardar"), e como dividir o aporte em cotas inteiras. A conta inteira e
// lib/rebalanceamento.ts, com suite propria -- aqui so se monta a entrada e se
// imprime a saida.
//
// O peso e o setor vem de GET /api/investments/rebalanceamento, e nao da rota
// da carteira: ver o cabecalho daquela rota para o porque (a migration 073 pode
// ainda nao estar colada). A posicao e o preco vem da carteira que a pagina ja
// carregou -- o mesmo "Valor Atual" da tabela de posicoes, para os dois
// numeros fecharem.
//
// O peso e do usuario, e a tela so faz a conta dele: por isso os rotulos sao
// "Peso", "Aportar" e "Aguardar", e nao vocabulario de recomendacao (ver
// VOCABULARIO_PROIBIDO em lib/crivos.ts e o teste dos rotulos).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Calculator, Scale } from "lucide-react";
import { formatCurrency, formatPercentage } from "@/lib/utils";
import type { AssetType, Posicao } from "@/lib/investments";
import {
  ROTULO_DA_SITUACAO,
  ROTULO_DO_PESO,
  calcularRebalanceamento,
  lerAporte,
  lerPeso,
  modeloDoTipo,
  type AtivoParaRebalancear,
  type LinhaDoRebalanceamento,
  type ModeloDaCalculadora,
} from "@/lib/rebalanceamento";
import { CalculadoraDePeso } from "@/components/investments/CalculadoraDePeso";
import { GraficosDoRebalanceamento } from "@/components/charts/GraficosDoRebalanceamento";

interface AtivoDaCarteira {
  id: string;
  symbol: string;
  type: AssetType;
  current_price: number | string | null;
}

interface PesoDaRota {
  asset_id: string;
  target_weight: number | string | null;
  sector: string | null;
}

interface RebalanceamentoDaCarteiraProps {
  ativos: AtivoDaCarteira[];
  posicoes: Posicao[];
}

type Edicao = Record<string, { peso: string; setor: string }>;

function pesoParaCampo(valor: number | string | null): string {
  const n = lerPeso(valor);
  return n === null ? "" : String(n).replace(".", ",");
}

function percentualOuTraco(fracao: number | null): string {
  return fracao === null ? "—" : formatPercentage(fracao * 100);
}

function cotas(valor: number | null, casas: number): string {
  if (valor === null) return "—";
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
}

export function RebalanceamentoDaCarteira({
  ativos,
  posicoes,
}: RebalanceamentoDaCarteiraProps) {
  const [carregando, setCarregando] = useState(true);
  const [migracaoPendente, setMigracaoPendente] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvos, setSalvos] = useState<Edicao>({});
  const [edicao, setEdicao] = useState<Edicao>({});
  const [aporteTexto, setAporteTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [calculadora, setCalculadora] = useState<{
    assetId: string;
    symbol: string;
    modelo: ModeloDaCalculadora;
  } | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const resposta = await fetch("/api/investments/rebalanceamento");
      const corpo = await resposta.json();
      if (!resposta.ok) {
        setErro(corpo?.error || "Não foi possível carregar os pesos");
        return;
      }
      setMigracaoPendente(Boolean(corpo.migracaoPendente));
      const lidos: Edicao = {};
      for (const p of (corpo.pesos ?? []) as PesoDaRota[]) {
        lidos[p.asset_id] = {
          peso: pesoParaCampo(p.target_weight),
          setor: p.sector ?? "",
        };
      }
      setSalvos(lidos);
      setEdicao(lidos);
    } catch {
      setErro("Não foi possível carregar os pesos");
    } finally {
      setCarregando(false);
    }
  }, []);

  // Recarrega quando a lista de ativos muda (ativo novo cadastrado ou
  // removido): sem isso o ativo novo apareceria sem a linha de edicao.
  const chaveDosAtivos = ativos.map((a) => a.id).join(",");
  useEffect(() => {
    carregar();
  }, [carregar, chaveDosAtivos]);

  const campos = (assetId: string) =>
    edicao[assetId] ?? { peso: "", setor: "" };

  const entrada: AtivoParaRebalancear[] = useMemo(() => {
    const porAtivo = new Map(posicoes.map((p) => [p.asset_id, p]));
    return ativos.map((a) => {
      const p = porAtivo.get(a.id);
      const preco = a.current_price === null ? null : Number(a.current_price);
      const c = edicao[a.id] ?? { peso: "", setor: "" };
      return {
        asset_id: a.id,
        symbol: a.symbol,
        peso: lerPeso(c.peso.replace(",", ".")),
        setor: c.setor.trim() === "" ? null : c.setor.trim(),
        preco: preco !== null && Number.isFinite(preco) && preco > 0 ? preco : null,
        quantidade: p?.total_quantity ?? 0,
        valorAtual: p?.current_value ?? 0,
        resultado: p?.profit_loss ?? 0,
        variacao: p?.profit_loss_percentage ?? 0,
        semCota: a.type === "fixed_income",
      };
    });
  }, [ativos, posicoes, edicao]);

  const aporte = lerAporte(aporteTexto);
  const r = useMemo(() => calcularRebalanceamento(entrada, aporte), [entrada, aporte]);

  const alterados = ativos.filter((a) => {
    const atual = campos(a.id);
    const antes = salvos[a.id] ?? { peso: "", setor: "" };
    return atual.peso.trim() !== antes.peso.trim() || atual.setor.trim() !== antes.setor.trim();
  });

  function editar(assetId: string, campo: "peso" | "setor", valor: string) {
    setAviso(null);
    setEdicao((e) => ({
      ...e,
      [assetId]: { ...(e[assetId] ?? { peso: "", setor: "" }), [campo]: valor },
    }));
  }

  async function salvar() {
    if (alterados.length === 0) return;
    setSalvando(true);
    setAviso(null);
    try {
      const resposta = await fetch("/api/investments/rebalanceamento", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: alterados.map((a) => ({
            asset_id: a.id,
            peso: campos(a.id).peso.trim().replace(",", "."),
            setor: campos(a.id).setor,
          })),
        }),
      });
      const corpo = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        setAviso(corpo?.error || "Não foi possível salvar");
        return;
      }
      // Relê do banco: o "salvo" passa a ser o que foi gravado, e nao o que a
      // tela acha que gravou.
      await carregar();
      setAviso("Pesos e setores salvos.");
    } catch {
      setAviso("Não foi possível salvar");
    } finally {
      setSalvando(false);
    }
  }

  if (ativos.length === 0) return null;

  const linhaPorAtivo = new Map<string, LinhaDoRebalanceamento>(
    r.linhas.map((l) => [l.asset_id, l])
  );
  const tipoPorAtivo = new Map(ativos.map((a) => [a.id, a.type]));
  // Quem participa na ordem da conta (quem mais falta primeiro); quem esta
  // sem peso por ultimo, em ordem alfabetica.
  const ordem = [
    ...r.linhas.map((l) => l.asset_id),
    ...ativos
      .filter((a) => !linhaPorAtivo.has(a.id))
      .sort((x, y) => x.symbol.localeCompare(y.symbol))
      .map((a) => a.id),
  ];
  const simboloPorAtivo = new Map(ativos.map((a) => [a.id, a.symbol]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="h-5 w-5" />
          Rebalanceamento
        </CardTitle>
        <CardDescription>
          Dê um peso a cada ativo: o % ideal é o peso dividido pela soma dos
          pesos. Ativo sem peso fica fora da conta; peso 0 quer dizer zerar o
          ativo. A conta é sua, com os pesos que você escolher.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {carregando && <p className="text-sm text-muted-foreground">Carregando…</p>}

        {erro && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}

        {migracaoPendente && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              O rebalanceamento ainda não está liberado no banco: falta aplicar a
              migration 073 no Supabase. O resto da carteira não depende disso.
            </AlertDescription>
          </Alert>
        )}

        {!carregando && !erro && !migracaoPendente && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1">
                <Label htmlFor="aporte-do-rebalanceamento">Quanto vou aportar</Label>
                <Input
                  id="aporte-do-rebalanceamento"
                  inputMode="decimal"
                  placeholder="R$ 0,00"
                  value={aporteTexto}
                  onChange={(e) => setAporteTexto(e.target.value)}
                />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Carteira com peso</p>
                <p className="text-xl font-semibold">{formatCurrency(r.valorDaCarteira)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Base (carteira + aporte)</p>
                <p className="text-xl font-semibold">{formatCurrency(r.base)}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Falta para o alvo</p>
                <p className="text-xl font-semibold">{formatCurrency(r.faltaTotal)}</p>
              </div>
            </div>

            {aporte > 0 && r.linhas.length > 0 && (
              <p className="text-sm text-muted-foreground">
                O aporte de {formatCurrency(r.aporte)} vai para os ativos abaixo do
                alvo, na proporção do que falta em cada um
                {r.faltaTotal > r.aporte
                  ? " (falta mais do que o aporte, então cada um recebe uma parte)"
                  : ""}
                . Em cotas inteiras sobram {formatCurrency(r.sobraDoArredondamento)}.
              </p>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ativo</TableHead>
                  <TableHead>Setor</TableHead>
                  <TableHead>{ROTULO_DO_PESO}</TableHead>
                  <TableHead className="text-right">% ideal</TableHead>
                  <TableHead className="text-right">% tenho</TableHead>
                  <TableHead className="text-right">Tenho</TableHead>
                  <TableHead className="text-right">Quero</TableHead>
                  <TableHead className="text-right">Falta</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Faltam (cotas)</TableHead>
                  <TableHead className="text-right">Do aporte</TableHead>
                  <TableHead className="text-right">Cotas do aporte</TableHead>
                  <TableHead className="text-right">Resultado</TableHead>
                  <TableHead className="text-right">Variação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordem.map((assetId) => {
                  const l = linhaPorAtivo.get(assetId);
                  const symbol = simboloPorAtivo.get(assetId) ?? "";
                  const c = campos(assetId);
                  return (
                    <TableRow key={assetId}>
                      <TableCell className="font-medium">{symbol}</TableCell>
                      <TableCell>
                        <Input
                          aria-label={`Setor de ${symbol}`}
                          className="h-8 w-32"
                          value={c.setor}
                          maxLength={60}
                          onChange={(e) => editar(assetId, "setor", e.target.value)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Input
                            aria-label={`${ROTULO_DO_PESO} de ${symbol}`}
                            className="h-8 w-16"
                            inputMode="decimal"
                            placeholder="—"
                            value={c.peso}
                            onChange={(e) => editar(assetId, "peso", e.target.value)}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Calcular o peso pelos critérios"
                            aria-label={`Calcular o peso de ${symbol}`}
                            onClick={() =>
                              setCalculadora({
                                assetId,
                                symbol,
                                modelo: modeloDoTipo(tipoPorAtivo.get(assetId) ?? "stock"),
                              })
                            }
                          >
                            <Calculator className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                      {l ? (
                        <>
                          <TableCell className="text-right">
                            {percentualOuTraco(l.percentualIdeal)}
                          </TableCell>
                          <TableCell className="text-right">
                            {percentualOuTraco(l.percentualAtual)}
                          </TableCell>
                          <TableCell className="text-right">{formatCurrency(l.valorAtual)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(l.valorAlvo)}</TableCell>
                          <TableCell
                            className={`text-right ${l.falta > 0 ? "text-success" : "text-muted-foreground"}`}
                          >
                            {formatCurrency(l.falta)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={l.situacao === "aportar" ? "default" : "outline"}>
                              {ROTULO_DA_SITUACAO[l.situacao]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{cotas(l.cotasQueFaltam, 2)}</TableCell>
                          <TableCell className="text-right">
                            {l.doAporte > 0 ? formatCurrency(l.doAporte) : "—"}
                          </TableCell>
                          <TableCell className="text-right">
                            {l.doAporte > 0 ? cotas(l.cotasDoAporte, 0) : "—"}
                          </TableCell>
                          <TableCell
                            className={`text-right ${l.resultado >= 0 ? "text-success" : "text-destructive"}`}
                          >
                            {formatCurrency(l.resultado)}
                          </TableCell>
                          <TableCell
                            className={`text-right ${l.variacao >= 0 ? "text-success" : "text-destructive"}`}
                          >
                            {formatPercentage(l.variacao)}
                          </TableCell>
                        </>
                      ) : (
                        <TableCell colSpan={11} className="text-sm text-muted-foreground">
                          Sem peso: fora do rebalanceamento.
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                onClick={salvar}
                disabled={salvando || alterados.length === 0}
              >
                {salvando ? "Salvando…" : "Salvar pesos e setores"}
              </Button>
              {alterados.length > 0 && !salvando && (
                <span className="text-sm text-muted-foreground">
                  {alterados.length === 1
                    ? "1 ativo com mudança não salva."
                    : `${alterados.length} ativos com mudança não salva.`}
                </span>
              )}
              {aviso && <span className="text-sm">{aviso}</span>}
            </div>

            {r.linhas.length > 0 && (
              <GraficosDoRebalanceamento linhas={r.linhas} setores={r.setores} />
            )}
          </>
        )}

        <CalculadoraDePeso
          ativo={calculadora}
          aoFechar={() => setCalculadora(null)}
          aoUsar={(peso) => {
            if (!calculadora) return;
            editar(calculadora.assetId, "peso", String(peso).replace(".", ","));
          }}
        />
      </CardContent>
    </Card>
  );
}
