"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  AlertTriangle,
  CalendarClock,
  LineChart,
  Repeat,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

// =====================================================
// Previsao de fluxo de caixa (HMO-145)
// =====================================================
// A tela existe para UMA resposta: a data em que o saldo fica negativo. Por
// isso o bloco de cima e uma frase com uma data, e nao um grafico -- o grafico
// vem depois, para mostrar o caminho ate ela.
//
// -----------------------------------------------------------------------
// AS DUAS LINHAS
// -----------------------------------------------------------------------
// A versao anterior desta tela mostrava uma linha so -- so o comprometido -- e
// escrevia no rodape que gasto do dia a dia nao entrava. Era verdadeiro e era
// otimista: a data anunciada era sempre mais tarde que a real.
//
// Agora sao duas. A PROVAVEL, que desconta o gasto variavel tipico, e a
// resposta que a pessoa vive e por isso ela e a manchete. A OTIMISTA continua
// desenhada ao lado, tracejada, porque ela e a unica que sai inteiramente de
// fatos datados -- e o piso.
//
// A condicao para a segunda linha existir e que a media NAO seja invisivel:
// uma data que nasce de um numero escondido e uma data que o usuario nao tem
// como conferir nem corrigir. Dai o cartao "Gasto do dia a dia", que imprime o
// numero, de quantos meses ele saiu, e deixa mudar. Sem historico suficiente a
// segunda linha simplesmente nao aparece -- nao aparece em zero, que seria
// indistinguivel de "voce nao gasta nada".
//
// O ajuste mora no navegador (localStorage), nao no banco: e preferencia de
// leitura de UMA pessoa numa tela, e guardar isso exigiria migration -- ou
// seja, um passo manual em producao -- para nao mudar nenhuma conta.
//
// Toda cor sai de token (bg-card, text-muted-foreground, text-destructive...).
// Uma classe de paleta fixa do Tailwind passa no build e vira um bloco claro no
// modo noturno -- o `npm run check-color-tokens` reprova, ver HMO-144. O
// grafico usa hsl(var(--token)) pelo mesmo motivo: a cor da linha precisa mudar
// junto com o tema.
// =====================================================

interface EventoDoFluxo {
  id: string;
  data: string;
  descricao: string;
  valor: number;
  origem: "prevista" | "recorrencia";
  vencida?: boolean;
  saldoDepois: number;
}

interface DiaDoFluxo {
  data: string;
  entra: number;
  sai: number;
  saldo: number;
  saldoProvavel: number;
}

interface FluxoDeCaixa {
  de: string;
  ate: string;
  dias: number;
  saldoInicial: number;
  comecaNegativo: boolean;
  primeiroDiaNegativo: string | null;
  saldoFinal: number;
  menorSaldo: number;
  diaDoMenorSaldo: string;
  totalEntra: number;
  totalSai: number;
  gastoDiario: number;
  gastoVariavelTotal: number;
  saldoFinalProvavel: number;
  menorSaldoProvavel: number;
  diaDoMenorSaldoProvavel: string;
  primeiroDiaNegativoProvavel: string | null;
  absorvidasPelaAgenda: string[];
  linha: DiaDoFluxo[];
}

interface GastoVariavel {
  porDia: number;
  porMes: number;
  mesesBase: number;
  temBase: boolean;
  meses: { mes: string; total: number }[];
  totalComprometidoDescartado: number;
  chavesDescartadas: number;
}

const HORIZONTES = [30, 60, 90] as const;

/**
 * Onde o ajuste da media fica guardado.
 *
 * Versionado no nome: se um dia a unidade mudar (de reais por dia para reais
 * por mes, por exemplo), a chave nova nasce vazia em vez de ler o numero antigo
 * na unidade errada -- que seria uma linha silenciosamente 30x fora.
 */
const CHAVE_AJUSTE = "pulodogato:cash-flow:gasto-diario:v1";

function formatarBRL(valor: number): string {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatarData(iso: string): string {
  if (!iso) return "-";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}/${ano}`;
}

function formatarDiaMes(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split("-");
  return `${dia}/${mes}`;
}

/**
 * Quantos dias faltam ate `alvo`, contando a partir de `de`.
 *
 * Aritmetica de string convertida em UTC, nunca `new Date(iso)` lido com
 * getDate(): no fuso de Sao Paulo isso devolve o dia anterior, e a tela diria
 * "faltam 11 dias" para quem tem 12.
 */
function diasAte(de: string, alvo: string): number {
  const utc = (iso: string) => {
    const [a, m, d] = iso.split("-").map(Number);
    return Date.UTC(a, m - 1, d);
  };
  return Math.round((utc(alvo) - utc(de)) / 86400000);
}

/**
 * As linhas do saldo, em SVG puro.
 *
 * Sem biblioteca de grafico de proposito: sao 30 a 90 pontos, e o que precisa
 * ficar visivel e uma coisa -- onde a linha cruza o zero. Dois `<path>` e uma
 * regua no zero fazem isso e carregam nada.
 *
 * A escala considera as DUAS series. Escalar so pela otimista jogaria o fundo
 * da provavel para fora do quadro, e o fundo dela e justamente o ponto que a
 * tela precisa mostrar.
 */
function LinhaDoSaldo({
  fluxo,
  comFaixa,
}: {
  fluxo: FluxoDeCaixa;
  comFaixa: boolean;
}) {
  const pontos = fluxo.linha;
  if (pontos.length < 2) return null;

  const largura = 720;
  const altura = 160;
  const saldos = pontos.flatMap((p) =>
    comFaixa ? [p.saldo, p.saldoProvavel] : [p.saldo]
  );
  // O zero entra na escala sempre: sem ele uma serie inteiramente positiva
  // desenharia a regua do zero fora do quadro, e a unica coisa que a tela
  // precisa mostrar sumiria.
  const maximo = Math.max(...saldos, 0);
  const minimo = Math.min(...saldos, 0);
  const amplitude = maximo - minimo || 1;

  const x = (i: number) => (i / (pontos.length - 1)) * largura;
  const y = (v: number) => altura - ((v - minimo) / amplitude) * altura;

  const caminhoDe = (valor: (p: DiaDoFluxo) => number) =>
    pontos
      .map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(valor(p)).toFixed(1)}`)
      .join(" ");

  const yZero = y(0);
  // A cor segue a linha que a tela esta afirmando: a provavel quando ela
  // existe, a otimista quando e a unica.
  const negativo = comFaixa ? fluxo.menorSaldoProvavel < 0 : fluxo.menorSaldo < 0;

  return (
    <svg
      viewBox={`0 0 ${largura} ${altura}`}
      className="h-40 w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={
        comFaixa
          ? `Saldo projetado de ${formatarData(fluxo.de)} a ${formatarData(fluxo.ate)}, em duas linhas: a provável, com gasto do dia a dia, e a otimista, só com o que está comprometido`
          : `Saldo projetado de ${formatarData(fluxo.de)} a ${formatarData(fluxo.ate)}`
      }
    >
      <line
        x1="0"
        x2={largura}
        y1={yZero}
        y2={yZero}
        stroke="hsl(var(--border))"
        strokeWidth="1"
        strokeDasharray="4 4"
      />
      {/* A otimista vai primeiro e tracejada: ela e a referencia, nao a
          resposta. Tracejada tambem e o que a distingue sem depender de cor --
          quem nao distingue as duas cores ainda separa as duas linhas. */}
      {comFaixa && (
        <path
          d={caminhoDe((p) => p.saldo)}
          fill="none"
          stroke="hsl(var(--muted-foreground))"
          strokeWidth="1.5"
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <path
        d={caminhoDe((p) => (comFaixa ? p.saldoProvavel : p.saldo))}
        fill="none"
        stroke={negativo ? "hsl(var(--destructive))" : "hsl(var(--primary))"}
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * O cartao que torna a media VISIVEL -- e por isso legitima.
 *
 * Ele imprime tres coisas que normalmente ficariam escondidas dentro do
 * calculo: o numero em si (por dia e por mes), de quantos meses fechados ele
 * saiu, e quanto foi descartado por ja estar comprometido. A terceira e a que
 * evita a conclusao errada mais provavel: o usuario compara a media com o
 * proprio extrato, acha a diferenca das assinaturas, e conclui que a conta
 * esta quebrada -- quando ela esta certa exatamente por causa dessa diferenca.
 */
function GastoDoDiaADia({
  gasto,
  fluxo,
  indisponivel,
  ajustado,
  rascunho,
  setRascunho,
  aplicar,
}: {
  gasto: GastoVariavel | null;
  fluxo: FluxoDeCaixa;
  indisponivel: boolean;
  ajustado: boolean;
  rascunho: string;
  setRascunho: (v: string) => void;
  aplicar: (v: number | null) => void;
}) {
  if (indisponivel) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-warning bg-warning/10 p-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <span className="text-sm text-foreground">
          Não foi possível ler o seu histórico de gastos agora. A previsão acima
          está <strong>otimista</strong>: só o que já está comprometido entrou na
          conta.
        </span>
      </div>
    );
  }

  const enviar = () => {
    const valor = Number(rascunho.replace(",", "."));
    if (!Number.isFinite(valor) || valor < 0) return;
    aplicar(valor);
    setRascunho("");
  };

  // Sem base e sem ajuste manual nao ha segunda linha, e o cartao passa a
  // explicar por que -- em vez de mostrar um zero que parece um resultado.
  const semBase = !gasto?.temBase && !ajustado;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1">
          <ShoppingCart className="h-3 w-3" />
          Gasto do dia a dia
        </CardDescription>
        <CardTitle className="text-xl text-foreground">
          {semBase ? "Ainda não dá para calcular" : `${formatarBRL(fluxo.gastoDiario)} por dia`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {semBase ? (
          <p className="text-sm text-muted-foreground">
            Mercado, restaurante, combustível: o app precisa de pelo menos{" "}
            <strong className="text-foreground">3 meses fechados</strong> de
            movimento para saber o seu normal
            {gasto && gasto.mesesBase > 0
              ? ` — por enquanto tem ${gasto.mesesBase}`
              : ""}
            . Até lá a previsão mostra só o que está comprometido. Você pode
            informar um valor por conta própria abaixo.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Equivale a{" "}
            <span className="font-medium text-foreground">
              {formatarBRL(fluxo.gastoDiario * 30.44)}
            </span>{" "}
            por mês, e a{" "}
            <span className="font-medium text-foreground">
              {formatarBRL(fluxo.gastoVariavelTotal)}
            </span>{" "}
            nos {fluxo.dias} dias da previsão.{" "}
            {ajustado ? (
              <>Valor informado por você.</>
            ) : (
              <>
                É a mediana de {gasto?.mesesBase} meses fechados
                {gasto && gasto.meses.length > 0
                  ? ` (${gasto.meses[0].mes.replace("-", "/")} a ${gasto.meses[gasto.meses.length - 1].mes.replace("-", "/")})`
                  : ""}
                .
              </>
            )}
          </p>
        )}

        {/* Sem isto o usuario soma as despesas do extrato, acha mais do que a
            tela mostra, e conclui que falta dinheiro na conta. */}
        {!ajustado && gasto && gasto.chavesDescartadas > 0 && (
          <p className="text-xs text-muted-foreground">
            {formatarBRL(gasto.totalComprometidoDescartado)} em{" "}
            {gasto.chavesDescartadas === 1
              ? "1 cobrança recorrente ficou"
              : `${gasto.chavesDescartadas} cobranças recorrentes ficaram`}{" "}
            de fora desta média, porque {gasto.chavesDescartadas === 1 ? "ela já entra" : "elas já entram"}{" "}
            na previsão com data própria.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            aria-label="Gasto do dia a dia, por dia, em reais"
            placeholder={
              gasto?.temBase ? gasto.porDia.toFixed(2) : "Valor por dia"
            }
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") enviar();
            }}
            className="w-36"
          />
          <Button size="sm" variant="outline" onClick={enviar} disabled={!rascunho}>
            Usar este valor
          </Button>
          {ajustado && (
            <Button size="sm" variant="ghost" onClick={() => aplicar(null)}>
              Voltar ao calculado
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          O ajuste vale só neste navegador e não altera nenhum lançamento.
        </p>
      </CardContent>
    </Card>
  );
}

export default function CashFlowPage() {
  const [fluxo, setFluxo] = useState<FluxoDeCaixa | null>(null);
  const [eventos, setEventos] = useState<EventoDoFluxo[]>([]);
  const [gasto, setGasto] = useState<GastoVariavel | null>(null);
  const [semAssinaturas, setSemAssinaturas] = useState(false);
  const [semGasto, setSemGasto] = useState(false);
  const [dias, setDias] = useState<number>(90);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  // `null` = usar o valor calculado. O estado comeca em `undefined` ate o
  // localStorage ser lido, e a primeira busca espera por isso: carregar com o
  // calculado e recarregar com o ajuste faria a linha pular na frente do
  // usuario a cada visita.
  const [ajuste, setAjuste] = useState<number | null | undefined>(undefined);
  const [rascunho, setRascunho] = useState("");

  useEffect(() => {
    try {
      const guardado = window.localStorage.getItem(CHAVE_AJUSTE);
      const valor = guardado === null ? null : Number(guardado);
      setAjuste(valor !== null && Number.isFinite(valor) && valor >= 0 ? valor : null);
    } catch {
      // Navegador com armazenamento bloqueado: segue com o calculado. Uma
      // preferencia de leitura nao vale derrubar a tela.
      setAjuste(null);
    }
  }, []);

  const carregar = useCallback(async () => {
    if (ajuste === undefined) return;
    setCarregando(true);
    setErro(null);
    try {
      const query = new URLSearchParams({ dias: String(dias) });
      if (ajuste !== null) query.set("gastoDiario", String(ajuste));
      const resp = await fetch(`/api/cash-flow?${query}`);
      if (!resp.ok) throw new Error("Não foi possível carregar a previsão.");
      const dados = await resp.json();
      setFluxo(dados.cash_flow);
      setEventos(dados.upcoming || []);
      setGasto(dados.variable_spend ?? null);
      setSemAssinaturas(Boolean(dados.recorrencias_indisponiveis));
      setSemGasto(Boolean(dados.gasto_indisponivel));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setCarregando(false);
    }
  }, [dias, ajuste]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const aplicarAjuste = useCallback((valor: number | null) => {
    setAjuste(valor);
    try {
      if (valor === null) window.localStorage.removeItem(CHAVE_AJUSTE);
      else window.localStorage.setItem(CHAVE_AJUSTE, String(valor));
    } catch {
      // Sem armazenamento o ajuste vale so nesta visita -- e ainda vale.
    }
  }, []);

  // A faixa so existe quando ha um numero POSITIVO de verdade por tras dela.
  // Com gasto diario zero as duas linhas sao a mesma, e desenhar duas linhas
  // sobrepostas com legenda de faixa afirmaria algo que a conta nao afirma.
  const comFaixa = Boolean(fluxo && fluxo.gastoDiario > 0);

  // A data que a tela anuncia e a da linha PROVAVEL quando ela existe: e a que
  // a pessoa vive. A otimista continua visivel logo abaixo, como referencia.
  const diaNegativo = fluxo
    ? comFaixa
      ? fluxo.primeiroDiaNegativoProvavel
      : fluxo.primeiroDiaNegativo
    : null;

  const faltam =
    fluxo && diaNegativo ? diasAte(fluxo.de, diaNegativo) : null;

  const menorSaldo = fluxo
    ? comFaixa
      ? fluxo.menorSaldoProvavel
      : fluxo.menorSaldo
    : 0;
  const diaDoMenorSaldo = fluxo
    ? comFaixa
      ? fluxo.diaDoMenorSaldoProvavel
      : fluxo.diaDoMenorSaldo
    : "";

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <LineChart className="h-6 w-6 text-primary" />
            Previsão de fluxo de caixa
          </h1>
          <p className="text-sm text-muted-foreground">
            Como o seu saldo caminha, dia a dia, com o que já está comprometido.
          </p>
        </div>
        <div className="flex gap-1">
          {HORIZONTES.map((h) => (
            <Button
              key={h}
              variant={dias === h ? "default" : "outline"}
              size="sm"
              onClick={() => setDias(h)}
            >
              {h} dias
            </Button>
          ))}
        </div>
      </div>

      {erro && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 pt-6 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">{erro}</span>
          </CardContent>
        </Card>
      )}

      {/* A rota seguiu sem as assinaturas: a linha ficou OTIMISTA e a tela tem
          que dizer isso. Calar aqui seria mostrar uma data de mergulho mais
          tardia do que a real, que e o erro que esta tela existe para evitar. */}
      {semAssinaturas && (
        <div className="flex items-start gap-2 rounded-md border border-warning bg-warning/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span className="text-sm text-foreground">
            Não foi possível ler as suas assinaturas agora. A previsão abaixo
            está <strong>otimista</strong>: as cobranças recorrentes não entraram
            na conta.
          </span>
        </div>
      )}

      {carregando ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Calculando...
          </CardContent>
        </Card>
      ) : !fluxo ? null : (
        <>
          {/* A resposta pela qual a tela existe. */}
          <Card
            className={
              diaNegativo || fluxo.comecaNegativo ? "border-destructive" : undefined
            }
          >
            <CardHeader className="pb-2">
              <CardDescription>
                {fluxo.comecaNegativo
                  ? "Seu saldo hoje"
                  : diaNegativo
                    ? "Seu saldo fica negativo em"
                    : `Nos próximos ${fluxo.dias} dias`}
              </CardDescription>
              <CardTitle
                className={
                  diaNegativo || fluxo.comecaNegativo
                    ? "text-3xl text-destructive"
                    : "text-3xl text-foreground"
                }
              >
                {fluxo.comecaNegativo
                  ? formatarBRL(fluxo.saldoInicial)
                  : diaNegativo
                    ? formatarData(diaNegativo)
                    : "O saldo não fica negativo"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {fluxo.comecaNegativo ? (
                  <>
                    Você já está no vermelho. No fundo do período o saldo chega a{" "}
                    <span className="font-medium text-destructive">
                      {formatarBRL(menorSaldo)}
                    </span>{" "}
                    em {formatarData(diaDoMenorSaldo)}.
                  </>
                ) : diaNegativo ? (
                  <>
                    {faltam === 0
                      ? "É hoje."
                      : faltam === 1
                        ? "Falta 1 dia."
                        : `Faltam ${faltam} dias.`}{" "}
                    O ponto mais baixo é{" "}
                    <span className="font-medium text-destructive">
                      {formatarBRL(menorSaldo)}
                    </span>{" "}
                    em {formatarData(diaDoMenorSaldo)}.
                  </>
                ) : (
                  <>
                    O menor saldo do período é{" "}
                    <span className="font-medium text-foreground">
                      {formatarBRL(menorSaldo)}
                    </span>
                    , em {formatarData(diaDoMenorSaldo)}.
                  </>
                )}
              </p>

              {/* A manchete fala da linha PROVAVEL. Dizer ao lado o que a
                  otimista responde e o que impede a comparacao com a versao
                  anterior da tela de parecer uma contradicao. */}
              {comFaixa && !fluxo.comecaNegativo && (
                <p className="text-xs text-muted-foreground">
                  Contando o seu gasto do dia a dia.{" "}
                  {fluxo.primeiroDiaNegativo ? (
                    <>
                      Só com o que já está comprometido, a data seria{" "}
                      <strong className="text-foreground">
                        {formatarData(fluxo.primeiroDiaNegativo)}
                      </strong>
                      .
                    </>
                  ) : (
                    <>
                      Só com o que já está comprometido, o saldo{" "}
                      <strong className="text-foreground">não ficaria negativo</strong>{" "}
                      no período.
                    </>
                  )}
                </p>
              )}

              <LinhaDoSaldo fluxo={fluxo} comFaixa={comFaixa} />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{formatarDiaMes(fluxo.de)}</span>
                <span>{formatarDiaMes(fluxo.ate)}</span>
              </div>

              {comFaixa && (
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-0.5 w-5 rounded bg-primary"
                    />
                    Provável (com gasto do dia a dia)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="inline-block h-0.5 w-5 rounded bg-muted-foreground opacity-70"
                    />
                    Otimista (só o comprometido)
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <GastoDoDiaADia
            gasto={gasto}
            fluxo={fluxo}
            indisponivel={semGasto}
            ajustado={ajuste !== null && ajuste !== undefined}
            rascunho={rascunho}
            setRascunho={setRascunho}
            aplicar={aplicarAjuste}
          />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Saldo hoje</CardDescription>
                <CardTitle className="text-xl text-foreground">
                  {formatarBRL(fluxo.saldoInicial)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Contas onde o dinheiro está disponível. Investimento e cartão
                  ficam de fora.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <TrendingUp className="h-3 w-3 text-success" />A receber
                </CardDescription>
                <CardTitle className="text-xl text-success">
                  {formatarBRL(fluxo.totalEntra)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Receitas previstas no período.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1">
                  <TrendingDown className="h-3 w-3 text-destructive" />A pagar
                </CardDescription>
                <CardTitle className="text-xl text-destructive">
                  {formatarBRL(fluxo.totalSai)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Contas previstas e assinaturas, somadas uma única vez.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>
                  Saldo em {formatarDiaMes(fluxo.ate)}
                </CardDescription>
                <CardTitle
                  className={
                    fluxo.saldoFinal < 0
                      ? "text-xl text-destructive"
                      : "text-xl text-foreground"
                  }
                >
                  {formatarBRL(fluxo.saldoFinal)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Saldo de hoje mais tudo que está previsto até lá.
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Sem isto o usuario procura a Netflix na lista, nao acha, e conclui
              que a previsao esqueceu dela -- quando na verdade ela esta ali,
              como conta prevista. */}
          {fluxo.absorvidasPelaAgenda.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {fluxo.absorvidasPelaAgenda.join(", ")}{" "}
              {fluxo.absorvidasPelaAgenda.length === 1
                ? "já está na lista como conta prevista e por isso não aparece duas vezes."
                : "já estão na lista como contas previstas e por isso não aparecem duas vezes."}
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base text-foreground">
                O que vem por aí
              </CardTitle>
              <CardDescription>
                Cada linha mostra o saldo que sobra depois dela.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {eventos.length === 0 ? (
                <div className="space-y-2 py-4 text-center">
                  <p className="text-sm text-foreground">
                    Nenhum compromisso previsto para os próximos {fluxo.dias}{" "}
                    dias.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Cadastre suas contas em{" "}
                    <Link href="/dashboard/bills" className="underline">
                      Contas Previstas
                    </Link>{" "}
                    ou importe um extrato para o app encontrar suas assinaturas.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {eventos.map((e, i) => (
                    <div
                      key={`${e.id}-${e.data}-${i}`}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {e.descricao}
                          </span>
                          {e.origem === "recorrencia" && (
                            <Badge variant="secondary" className="gap-1">
                              <Repeat className="h-3 w-3" />
                              Assinatura
                            </Badge>
                          )}
                          {e.vencida && (
                            <Badge variant="outline" className="text-destructive">
                              Vencida
                            </Badge>
                          )}
                        </div>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarClock className="h-3 w-3" />
                          {formatarData(e.data)}
                        </span>
                      </div>
                      <div className="text-right">
                        <div
                          className={
                            e.valor >= 0
                              ? "text-sm font-semibold text-success"
                              : "text-sm font-semibold text-destructive"
                          }
                        >
                          {e.valor >= 0 ? "+" : "−"}
                          {formatarBRL(Math.abs(e.valor))}
                        </div>
                        <div
                          className={
                            e.saldoDepois < 0
                              ? "text-xs text-destructive"
                              : "text-xs text-muted-foreground"
                          }
                        >
                          saldo {formatarBRL(e.saldoDepois)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* O limite da conta, escrito onde o usuario le -- e nao so no
              comentario do codigo. Ver o cabecalho do lib. O texto MUDA com a
              faixa: repetir "gasto do dia a dia nao entra" agora que ele entra
              seria a tela desmentindo a propria manchete. */}
          <p className="text-xs text-muted-foreground">
            {comFaixa ? (
              <>
                A linha otimista tem datas: contas previstas e assinaturas
                detectadas. A provável soma a ela uma{" "}
                <strong>média</strong> de gasto do dia a dia — uma média não
                sabe em que dia você vai ao mercado, então trate a data dela
                como uma semana, não como um dia exato. Compras no cartão
                aparecem quando a fatura fecha e vira conta prevista.
              </>
            ) : (
              <>
                A previsão considera apenas o que já está comprometido: contas
                previstas e assinaturas detectadas. Gasto do dia a dia (mercado,
                restaurante, combustível) <strong>não entra</strong> — na prática
                o saldo tende a ser menor do que a linha mostra. Compras no
                cartão aparecem quando a fatura fecha e vira conta prevista.
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}
