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
import {
  RefreshCw,
  Repeat,
  TrendingUp,
  AlertTriangle,
  Check,
  EyeOff,
  Ban,
  CalendarClock,
  CalendarCheck,
  ScrollText,
  Undo2,
} from "lucide-react";
import {
  AVISO_ATUALIZAR_FALHOU,
  buscarLeitura,
  comSemCopia,
  ID_DO_AVISO_ATUALIZAR,
  podeAfirmarVazio,
  podeMostrarNumero,
  type EstadoDaLeitura,
} from "@/lib/offline-leitura";
import {
  FaixaDadoDoAparelho,
  NumeroIndisponivel,
  PainelErroDoServidor,
  PainelSemRede,
} from "@/components/SemRede";
import { useEstaOnline } from "@/lib/hooks/useEstaOnline";
import { toast } from "sonner";

import { Dica } from "@/components/ui/dica";
import {
  rotuloDaFrequenciaDaRegra,
  type AssinaturaDaContaFixa,
} from "@/lib/assinaturas-das-contas-fixas";
import {
  LIMITE_ATENCAO,
  LIMITE_LEVE,
  montarPainelDeAssinaturas,
  type FaixaDoPeso,
  type ItemDoPainel,
  type MotivoForaDaConta,
  type RecorrenciaDetectada,
} from "@/lib/painel-de-assinaturas";
// =====================================================
// Assinaturas e cobrancas recorrentes (HMO-145)
// =====================================================
// A tela existe para uma decisao: o que cancelar. Por isso o numero grande no
// topo e o TOTAL MENSAL, e a lista vem da assinatura mais cara para a mais
// barata -- e nao em ordem alfabetica nem por data, que sao as ordens que nao
// ajudam a decidir nada.
//
// Toda cor sai de token (bg-card, text-muted-foreground, bg-warning/10...).
// Uma classe de paleta fixa do Tailwind passa no build e vira um bloco claro
// no modo noturno -- o `npm run check-color-tokens` reprova, ver HMO-144.
//
// (O proprio guard nao mascara comentario: citar aqui o nome de uma dessas
// classes, ainda que para explicar por que nao usa-la, reprova o commit.)
// =====================================================

type Recurrence = RecorrenciaDetectada;

interface Alerta {
  tipo: "PRICE_INCREASE" | "CHARGED_AFTER_CANCEL";
  merchantKey: string;
  displayName: string;
  mensagem: string;
}

const ROTULO_FREQUENCIA: Record<Recurrence["frequency"], string> = {
  WEEKLY: "Semanal",
  MONTHLY: "Mensal",
  YEARLY: "Anual",
};


function formatarBRL(valor: number | string): string {
  // O supabase-js entrega `numeric` como string. Sem o Number aqui o
  // toLocaleString recebe string e devolve o texto cru, sem separador.
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

export default function RecurrencesPage() {
  const [recorrencias, setRecorrencias] = useState<Recurrence[]>([]);
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  // As contas fixas marcadas como assinatura (migration 084). `null` = a
  // leitura delas falhou (a coluna nao existe antes da migration), e a tela nao
  // afirma "nenhuma" sobre o que nao leu.
  const [fixas, setFixas] = useState<AssinaturaDaContaFixa[] | null>([]);
  // A renda mensal fixa, para o peso das assinaturas no orcamento. `null` =
  // nao deu para ler (ou resposta de antes desta versao, vinda da copia do
  // aparelho): a tela nao mostra porcentagem nenhuma.
  const [rendaMensal, setRendaMensal] = useState<number | null>(null);
  const [soParaRevisar, setSoParaRevisar] = useState(false);
  const [chavesDuplicadas, setChavesDuplicadas] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [varrendo, setVarrendo] = useState(false);
  const [mostrarIgnoradas, setMostrarIgnoradas] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // De onde veio o que esta na tela (HMO-145). Antes disto, sem rede o
  // `catch` escrevia "Failed to fetch" numa tarja e a tela seguia mostrando
  // "Total por mes R$ 0,00" com a frase "Nenhuma cobranca recorrente
  // encontrada ainda" embaixo -- a mensagem do navegador ao lado de uma
  // afirmacao nossa sobre o dinheiro da pessoa.
  const [estado, setEstado] = useState<EstadoDaLeitura | null>(null);
  const [guardadoEm, setGuardadoEm] = useState<Date | null>(null);
  const online = useEstaOnline();

  const carregar = useCallback(
    async (semCopia = false) => {
      // `carregando` troca a lista por "Carregando...". No gesto do botao a
      // releitura vai POR CIMA do que esta na tela: piscar para o texto de
      // carregamento e voltar seria a tela se mexendo sem o dado ter mudado, e
      // se a leitura falhasse o dado do aparelho nao voltaria (HMO-477).
      if (!semCopia) setCarregando(true);
      setErro(null);

      const leitura = await buscarLeitura<{
        recurrences?: Recurrence[];
        alerts?: Alerta[];
        monthlyTotal?: number;
        fixedSubscriptions?: AssinaturaDaContaFixa[] | null;
        fixedMonthlyTotal?: number | null;
        fixedMonthlyIncome?: number | null;
        duplicatedMerchantKeys?: string[];
      }>(
        // ESTA e a tela em que o separador nao da para cravar na mao: a URL tem
        // `?` so quando a pessoa pediu para ver as ignoradas. `comSemCopia`
        // escolhe `?` ou `&` olhando a URL -- um `&` colado em
        // `/api/recurrences` viraria outro CAMINHO (404), nao um parametro.
        //
        // `semCopia` so no botao "Atualizar" da faixa, e a rota le `status` com
        // `params.get` e mais nada: o parametro extra passa ignorado (condicao 1
        // de `PARAM_SEM_COPIA`).
        comSemCopia(
          `/api/recurrences${mostrarIgnoradas ? "?status=all" : ""}`,
          semCopia
        )
      );

      // UM "ATUALIZAR" QUE NAO TROUXE NADA NAO APAGA O QUE ESTA NA TELA.
      //
      // As tres listas acima ja sobrevivem a uma leitura sem corpo, mas o
      // `estado` nao: com `sem-rede` o painel SUBSTITUI a lista e o total vira
      // travessao. Escrever o estado novo aqui apagaria da tela as assinaturas
      // que a pessoa ainda podia consultar -- e elas nao voltam sem recarregar
      // a pagina. `semCopia` garante que nao havia copia para cair, entao isto
      // quer dizer so que a rede nao respondeu AGORA.
      if (semCopia && !leitura.dados) {
        toast.error(AVISO_ATUALIZAR_FALHOU, { id: ID_DO_AVISO_ATUALIZAR });
        setCarregando(false);
        return;
      }

      setEstado(leitura.estado);
      setGuardadoEm(leitura.guardadoEm);

      // Sem corpo, o que ja estava na tela fica. Zerar aqui faria as
      // assinaturas sumirem ao perder o sinal, que e o oposto do que a copia
      // guardada no aparelho existe para permitir.
      if (leitura.dados) {
        setRecorrencias(leitura.dados.recurrences || []);
        setAlertas(leitura.dados.alerts || []);
        // `undefined` (resposta de antes desta versao, vinda da copia do
        // aparelho) vira lista vazia; `null` (falhou no servidor) fica `null`.
        setFixas(
          leitura.dados.fixedSubscriptions === undefined
            ? []
            : leitura.dados.fixedSubscriptions
        );
        setRendaMensal(leitura.dados.fixedMonthlyIncome ?? null);
        setChavesDuplicadas(leitura.dados.duplicatedMerchantKeys || []);
      }

      setCarregando(false);
    },
    [mostrarIgnoradas]
  );

  useEffect(() => {
    // SEM argumento: a primeira carga tem de poder cair na copia do aparelho --
    // ela e a razao de a leitura offline existir.
    carregar();
  }, [carregar]);

  const varrer = async () => {
    setVarrendo(true);
    setErro(null);
    try {
      const resp = await fetch("/api/recurrences/scan", { method: "POST" });
      if (!resp.ok) throw new Error("A varredura falhou.");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setVarrendo(false);
    }
  };

  const decidir = async (id: string, status: Recurrence["status"]) => {
    // Atualizacao otimista: a lista responde na hora e a chamada confirma
    // depois. Se falhar, `carregar()` no catch devolve o estado do servidor --
    // sem isso a tela ficaria mostrando uma decisao que nao foi gravada.
    const anterior = recorrencias;
    setRecorrencias((atual) =>
      atual.map((r) => (r.id === id ? { ...r, status } : r))
    );
    try {
      const resp = await fetch(`/api/recurrences/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!resp.ok) throw new Error("Nao foi possivel salvar a decisao.");
      // Recarrega porque o total mensal e os alertas mudam com o status, e os
      // dois sao calculados no servidor.
      await carregar();
    } catch (e) {
      setRecorrencias(anterior);
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    }
  };

  /** Tira a marca de assinatura de uma conta fixa (ela continua sendo conta fixa). */
  const desmarcarFixa = async (fixa: AssinaturaDaContaFixa) => {
    try {
      const resp = await fetch(`/api/recurring-rules/${fixa.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_subscription: false,
          aplicar_em_pendentes: false,
        }),
      });
      if (!resp.ok) throw new Error("Nao foi possivel desmarcar a assinatura.");
      toast.success(`${fixa.descricao} saiu de Assinaturas.`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    }
  };

  // A lista unica, os totais e o peso na renda saem de uma funcao pura com
  // teste (lib/painel-de-assinaturas.ts). Ela aplica a MESMA regra de soma da
  // rota; a tela so desenha.
  const painel = montarPainelDeAssinaturas({
    fixas: fixas ?? [],
    detectadas: recorrencias,
    chavesDasFixas: chavesDuplicadas,
    rendaMensal,
  });

  const itensVisiveis = soParaRevisar
    ? painel.itens.filter((i) => i.paraRevisar)
    : painel.itens;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <Repeat className="h-6 w-6 text-primary" />
            Assinaturas
          </h1>
          <p className="text-sm text-muted-foreground">
            Quanto você gasta com assinaturas, quanto isso pesa na sua renda e
            o detalhe de cada uma.
          </p>
        </div>
        {/* A varredura le meses de extrato no servidor: sem rede ela nao tem
            como acontecer, e o botao habilitado so entregaria um erro. */}
        <Button
          onClick={varrer}
          disabled={varrendo || !online}
          className="gap-2"
          variant="outline"
        >
          <RefreshCw className={`h-4 w-4 ${varrendo ? "animate-spin" : ""}`} />
          {!online
            ? "Procurar (precisa de rede)"
            : varrendo
              ? "Procurando..."
              : "Procurar no extrato"}
        </Button>
      </div>

      {estado === "do-aparelho" && (
        <FaixaDadoDoAparelho
          guardadoEm={guardadoEm}
          soLeitura
          // `() => carregar(true)` -- O BOTAO QUE FURA O CACHE (HMO-477).
          //
          // Sem o `true` a releitura volta da MESMA copia do NetworkFirst
          // (sete dias), com a mesma faixa e o mesmo momento: um botao que nao
          // muda nada. E a seta nao e estilo -- a faixa liga a prop direto no
          // `onClick`, e `aoTentarDeNovo={carregar}` passaria o `MouseEvent`
          // como `semCopia`, que e truthy: a releitura de DEPOIS da varredura e
          // a de cada "ignorar/confirmar" passariam a furar o cache, apagando a
          // leitura offline da tela sem ninguem ter pedido.
          aoTentarDeNovo={() => carregar(true)}
        />
      )}

      {erro && (
        <Card className="border-destructive">
          <CardContent className="flex items-center gap-2 pt-6 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm">{erro}</span>
          </CardContent>
        </Card>
      )}

      {/* O RESUMO: quanto custa e quanto pesa. Os dois numeros pelos quais a
          tela existe, lado a lado. */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              Total por mês
              <Dica rotulo="O que entra na soma">
                Soma das contas fixas que você marcou como assinatura e do que
                foi encontrado no seu extrato (confirmado ou ainda para
                revisar). O que você ignorou ou cancelou não entra na conta, e
                uma cobrança do extrato que repete uma conta fixa marcada só
                conta uma vez.
              </Dica>
            </CardDescription>
            <CardTitle className="text-3xl text-foreground">
              {podeMostrarNumero(estado) ? (
                formatarBRL(painel.totalMensal)
              ) : (
                <NumeroIndisponivel />
              )}
            </CardTitle>
          </CardHeader>
          {podeMostrarNumero(estado) && (
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <p>
                <span className="font-medium text-foreground">
                  {formatarBRL(painel.totalAnual)}
                </span>{" "}
                por ano
              </p>
              <p>
                {painel.quantidade === 1
                  ? "1 assinatura"
                  : `${painel.quantidade} assinaturas`}
                {painel.paraRevisar > 0
                  ? ` · ${painel.paraRevisar} para revisar`
                  : ""}
              </p>
            </CardContent>
          )}
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              Peso na sua renda
              <Dica rotulo="Como o peso é calculado">
                O total por mês das assinaturas dividido pela sua renda fixa
                por mês (as receitas fixas ativas que você cadastrou). Como
                referência: até {LIMITE_LEVE}% é leve, até {LIMITE_ATENCAO}%
                pede atenção e acima disso as assinaturas já pesam no
                orçamento.
              </Dica>
            </CardDescription>
            <CardTitle className="text-3xl text-foreground">
              {!podeMostrarNumero(estado) ||
              painel.rendaMensal === null ? (
                <NumeroIndisponivel />
              ) : painel.percentualDaRenda === null ? (
                "—"
              ) : (
                formatarPorcentagem(painel.percentualDaRenda)
              )}
            </CardTitle>
          </CardHeader>
          {podeMostrarNumero(estado) && (
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              {painel.rendaMensal === null ? (
                <p>Não foi possível ler a sua renda fixa agora.</p>
              ) : painel.percentualDaRenda === null || !painel.faixa ? (
                <p>
                  Cadastre sua renda fixa (salário, por exemplo) para ver quanto
                  as assinaturas pesam no orçamento.{" "}
                  <Link
                    href="/dashboard/receitas"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    Ir para Receitas
                  </Link>
                </p>
              ) : (
                <>
                  <BarraDoPeso
                    percentual={painel.percentualDaRenda}
                    faixa={painel.faixa}
                  />
                  <p>
                    <Badge
                      variant="outline"
                      className={CLASSE_DA_FAIXA[painel.faixa].selo}
                    >
                      {ROTULO_DA_FAIXA[painel.faixa]}
                    </Badge>{" "}
                    de uma renda fixa de{" "}
                    <span className="font-medium text-foreground">
                      {formatarBRL(painel.rendaMensal)}
                    </span>{" "}
                    por mês
                  </p>
                </>
              )}
            </CardContent>
          )}
        </Card>
      </div>

      {podeMostrarNumero(estado) && fixas === null && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Não foi possível ler as contas fixas marcadas como assinatura agora.
          </CardContent>
        </Card>
      )}

      {alertas.length > 0 && (
        <div className="space-y-2">
          {alertas.map((a, i) => (
            <div
              key={`${a.merchantKey}-${a.tipo}-${i}`}
              className="flex items-start gap-2 rounded-md border border-warning bg-warning/10 p-3"
            >
              {a.tipo === "PRICE_INCREASE" ? (
                <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              )}
              <span className="text-sm text-foreground">{a.mensagem}</span>
            </div>
          ))}
        </div>
      )}

      {/* A LISTA UNICA. Contas fixas e cobrancas do extrato juntas, da mais
          cara para a mais barata. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">
          Suas assinaturas
        </h2>
        {podeMostrarNumero(estado) && painel.paraRevisar > 0 && (
          <div className="flex gap-1" role="group" aria-label="Filtrar a lista">
            <Button
              variant={soParaRevisar ? "ghost" : "secondary"}
              size="sm"
              aria-pressed={!soParaRevisar}
              onClick={() => setSoParaRevisar(false)}
            >
              Todas ({painel.quantidade})
            </Button>
            <Button
              variant={soParaRevisar ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={soParaRevisar}
              onClick={() => setSoParaRevisar(true)}
            >
              Para revisar ({painel.paraRevisar})
            </Button>
          </div>
        )}
      </div>

      {carregando ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Carregando...
          </CardContent>
        </Card>
      ) : estado === "sem-rede" ? (
        // SEM `true`, ao contrario da faixa: `sem-rede` significa que nao ha
        // copia no aparelho, entao nao ha cache para furar e a tentativa normal
        // ja vai na rede. A seta continua obrigatoria, pelo `MouseEvent`.
        <PainelSemRede
          oQue="suas assinaturas"
          aoTentarDeNovo={() => carregar()}
        />
      ) : estado === "erro-do-servidor" ? (
        // SEM `true` pelo motivo de cima: o servidor RESPONDEU (500), e
        // resposta de erro nao vira copia no cache.
        <PainelErroDoServidor
          oQue="suas assinaturas"
          aoTentarDeNovo={() => carregar()}
        />
      ) : itensVisiveis.length === 0 && podeAfirmarVazio(estado) ? (
        <Card>
          <CardContent className="space-y-2 pt-6 text-center">
            <p className="text-sm text-foreground">
              Nenhuma assinatura por aqui ainda.
            </p>
            <p className="text-xs text-muted-foreground">
              Marque uma conta fixa como assinatura no cartão (interruptor
              &quot;Assinatura&quot; na conta prevista) ou importe seu extrato
              e clique em &quot;Procurar no extrato&quot;: o app encontra o que
              se repete pelo menos 3 vezes, em intervalo regular e com valor
              parecido.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {itensVisiveis.map((item) => (
              <LinhaDaAssinatura
                key={item.chave}
                item={item}
                online={online}
                aoDesmarcar={desmarcarFixa}
                aoDecidir={decidir}
              />
            ))}
          </CardContent>
        </Card>
      )}

      {/* FORA DA CONTA: o que existe, mas nao soma -- com o motivo, para a
          diferenca entre a lista e o total ter explicacao, e com o botao para
          voltar atras. */}
      {podeMostrarNumero(estado) && !carregando && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-1.5 text-base font-semibold text-foreground">
              Fora da conta
              <Dica rotulo="Por que estas não somam">
                Cobranças do extrato que você cancelou ou disse que não são
                assinatura, e as que repetem uma conta fixa já marcada (essas
                contam uma vez só, pela conta fixa).
              </Dica>
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMostrarIgnoradas((v) => !v)}
            >
              {mostrarIgnoradas ? "Esconder ignoradas" : "Mostrar ignoradas"}
            </Button>
          </div>
          {painel.foraDaConta.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {mostrarIgnoradas
                ? "Nada fora da conta."
                : "Nada fora da conta (as ignoradas ficam escondidas)."}
            </p>
          ) : (
            <Card>
              <CardContent className="divide-y divide-border p-0">
                {painel.foraDaConta.map((f) => (
                  <div
                    key={f.chave}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-6"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-muted-foreground">
                          {f.nome}
                        </span>
                        <Badge variant="outline">
                          {ROTULO_DO_MOTIVO[f.motivo]}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatarBRL(f.custoMensal)}/mês ·{" "}
                        {formatarBRL(f.custoMensal * 12)}/ano
                      </p>
                    </div>
                    {f.motivo !== "ja-e-conta-fixa" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1 self-start sm:self-auto"
                        title="Voltar a contar como assinatura"
                        disabled={!online}
                        onClick={() => decidir(f.detectada.id, "CONFIRMED")}
                      >
                        <Undo2 className="h-4 w-4" />
                        É assinatura
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================
// Pecas da tela
// =====================================================

const ROTULO_DA_FAIXA: Record<FaixaDoPeso, string> = {
  leve: "Leve",
  atencao: "Atenção",
  pesado: "Pesado",
};

const CLASSE_DA_FAIXA: Record<FaixaDoPeso, { barra: string; selo: string }> = {
  leve: { barra: "bg-success", selo: "border-success text-success" },
  atencao: { barra: "bg-warning", selo: "border-warning text-warning" },
  pesado: {
    barra: "bg-destructive",
    selo: "border-destructive text-destructive",
  },
};

const ROTULO_DO_MOTIVO: Record<MotivoForaDaConta, string> = {
  ignorada: "Ignorada",
  cancelada: "Cancelada",
  "ja-e-conta-fixa": "Já é conta fixa",
};

function formatarPorcentagem(valor: number): string {
  return `${valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  })}%`;
}

/**
 * A barra do peso na renda. A escala vai ate 20% (e nao 100%): numa escala
 * cheia, 4% e 12% virariam dois tracinhos iguais, e a diferenca entre "leve" e
 * "pesado" e o que a barra existe para mostrar. As marcas de 5% e 10% ficam
 * desenhadas.
 */
function BarraDoPeso({
  percentual,
  faixa,
}: {
  percentual: number;
  faixa: FaixaDoPeso;
}) {
  const ESCALA = 20;
  const largura = Math.min(100, (percentual / ESCALA) * 100);
  return (
    <div
      className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={ESCALA}
      aria-valuenow={Math.min(percentual, ESCALA)}
      aria-label={`${formatarPorcentagem(percentual)} da renda`}
    >
      <div
        className={`h-full rounded-full ${CLASSE_DA_FAIXA[faixa].barra}`}
        style={{ width: `${largura}%` }}
      />
      {[LIMITE_LEVE, LIMITE_ATENCAO].map((marca) => (
        <div
          key={marca}
          className="absolute top-0 h-full w-px bg-border"
          style={{ left: `${(marca / ESCALA) * 100}%` }}
          aria-hidden
        />
      ))}
    </div>
  );
}

function rotuloDaFrequencia(item: ItemDoPainel): string {
  if (item.fixa) {
    return rotuloDaFrequenciaDaRegra(item.fixa.frequencia, item.fixa.intervalo);
  }
  return item.detectada ? ROTULO_FREQUENCIA[item.detectada.frequency] : "";
}

function LinhaDaAssinatura({
  item,
  online,
  aoDesmarcar,
  aoDecidir,
}: {
  item: ItemDoPainel;
  online: boolean;
  aoDesmarcar: (fixa: AssinaturaDaContaFixa) => Promise<void>;
  aoDecidir: (id: string, status: Recurrence["status"]) => Promise<void>;
}) {
  const mensal =
    item.fixa
      ? item.fixa.frequencia === "monthly" && item.fixa.intervalo === 1
      : item.detectada?.frequency === "MONTHLY";

  return (
    <div className="space-y-2 px-4 py-3 md:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-foreground">
              {item.nome}
            </span>
            <Badge variant="secondary">{rotuloDaFrequencia(item)}</Badge>
            <Badge variant="outline" className="gap-1">
              {item.origem === "conta-fixa" ? (
                <>
                  <CalendarCheck className="h-3 w-3" />
                  Conta fixa
                </>
              ) : (
                <>
                  <ScrollText className="h-3 w-3" />
                  Do extrato
                </>
              )}
            </Badge>
            {item.paraRevisar && (
              <Badge
                variant="outline"
                className="border-warning text-warning"
              >
                Para revisar
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {item.diaDoVencimento ? (
              <span className="flex items-center gap-1">
                <CalendarClock className="h-3 w-3" />
                Vence todo dia {item.diaDoVencimento}
              </span>
            ) : null}
            {item.proximaCobranca ? (
              <span className="flex items-center gap-1">
                <CalendarClock className="h-3 w-3" />
                Próxima: {formatarData(item.proximaCobranca)}
              </span>
            ) : null}
            {item.ultimaCobranca ? (
              <span>Última: {formatarData(item.ultimaCobranca)}</span>
            ) : null}
            {!mensal ? (
              <span>Cobrança de {formatarBRL(item.valorDaCobranca)}</span>
            ) : null}
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 sm:justify-end">
          <div className="text-left sm:text-right">
            <div className="font-semibold text-foreground">
              {formatarBRL(item.custoMensal)}
              <span className="text-xs font-normal text-muted-foreground">
                /mês
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {formatarBRL(item.custoAnual)}/ano
            </div>
          </div>

          {/*
            Sem rede as decisoes nao tem para onde ir. A atualizacao otimista
            mostraria a escolha aplicada por um instante e a desfaria em
            seguida -- pior que o botao apagado, porque a pessoa acreditaria ter
            decidido.
          */}
          {item.fixa ? (
            <Button
              variant="ghost"
              size="sm"
              title="Não é uma assinatura, tirar da lista"
              aria-label={`Tirar ${item.nome} de Assinaturas`}
              disabled={!online}
              onClick={() => item.fixa && void aoDesmarcar(item.fixa)}
            >
              <EyeOff className="h-4 w-4" />
            </Button>
          ) : item.detectada ? (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                title="Confirmar que é uma assinatura"
                aria-label={`Confirmar ${item.nome} como assinatura`}
                disabled={item.detectada.status === "CONFIRMED" || !online}
                onClick={() =>
                  item.detectada &&
                  void aoDecidir(item.detectada.id, "CONFIRMED")
                }
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title="Não é uma assinatura, ignorar"
                aria-label={`Ignorar ${item.nome}`}
                disabled={!online}
                onClick={() =>
                  item.detectada && void aoDecidir(item.detectada.id, "IGNORED")
                }
              >
                <EyeOff className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title="Já cancelei esta assinatura"
                aria-label={`Já cancelei ${item.nome}`}
                disabled={!online}
                onClick={() =>
                  item.detectada &&
                  void aoDecidir(item.detectada.id, "CANCELLED")
                }
              >
                <Ban className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </div>
      </div>

      {/* A fatia desta assinatura no total do mes. */}
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.min(100, item.participacao)}%` }}
          />
        </div>
        <span className="w-24 shrink-0 text-right text-xs text-muted-foreground">
          {formatarPorcentagem(item.participacao)} do total
        </span>
      </div>
    </div>
  );
}
