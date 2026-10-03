"use client";

/**
 * O FECHAMENTO DO MES DO GRUPO (HMO-245).
 *
 * "as contas do grupo nao precisa ter diferenca entre prevista e realizado,
 * precisamos e do fechamento do mes, exemplo, mes 10 temos/teremos 2 mil reais
 * em contas, cada um vai pagar um x de valor."
 *
 * POR QUE ESTE CARTAO FICA NO TOPO DA ABA DE DESPESAS
 * ---------------------------------------------------
 * E onde a pergunta nasce. A internet de R$ 159,90 vencendo 15/10 aparece ali
 * embaixo, na secao "Previstas", e some de todo total: o cartao "Mes Atual"
 * soma apenas o realizado. Quem olha a tela ve a conta existir e nao ver no
 * total -- entao a resposta tem de estar no mesmo lugar onde a duvida aparece,
 * e acima dela.
 *
 * Nao virou uma quinta aba de proposito: com "Despesas | Fechamento | Painel |
 * Balancos | Membros" os rotulos nao cabem em 375px, e esta tela ja teve
 * estouro horizontal no celular.
 *
 * O QUE ESTE CARTAO NAO E
 * -----------------------
 * Nao substitui a aba de Balancos. Lá o saldo e de TODA a vida do grupo e sai
 * de `group_member_balances`, que conta rateio gravado e acerto registrado --
 * a verdade contabil. Aqui o recorte e UM mes e previsto conta igual a
 * realizado, o que e util para combinar o Pix do fim do mes e **nao** e um
 * saldo devido: metade das contas ainda nao aconteceu. A legenda diz isso em
 * texto, porque dois numeros diferentes para o mesmo grupo em duas abas, sem
 * explicacao, e pior do que um numero so.
 */

import { useCallback, useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatarValor } from "@/lib/dinheiro";
import { today } from "@/lib/recurrence";
import { mesDaData } from "@/lib/fechamento-do-grupo";
import { ArrowRight, CalendarCheck, Clock, Wallet } from "lucide-react";

interface PosicaoNoMes {
  user_id: string;
  full_name?: string | null;
  avatar_url?: string | null;
  pago: number;
  devido: number;
  saldo: number;
}

interface Transferencia {
  from_user_id: string;
  to_user_id: string;
  amount: number;
  from_name?: string | null;
  to_name?: string | null;
}

interface RespostaDoFechamento {
  mes: string;
  total: number;
  total_realizado: number;
  total_previsto: number;
  por_membro: PosicaoNoMes[];
  transferencias: Transferencia[];
  pago_por_nao_membro: number;
  fecha: boolean;
  meses: string[];
  active_members: number;
  viewer_user_id: string;
}

const MESES_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/**
 * `2026-10` -> `outubro de 2026`.
 *
 * Formatado a partir da STRING, e nao de `new Date("2026-10")`: a data sem dia
 * e interpretada como meia-noite UTC, que em America/Sao_Paulo e o mes
 * anterior, e o rotulo diria "setembro" sobre o fechamento de outubro.
 */
export function rotuloDoMes(mes: string): string {
  const [ano, m] = mes.split("-");
  const nome = MESES_PT[Number(m) - 1];
  return nome ? `${nome} de ${ano}` : mes;
}

const inicial = (nome?: string | null) =>
  (nome ?? "?").trim().charAt(0).toUpperCase() || "?";

export function FechamentoDoMes({
  groupId,
  /** Hoje em America/Sao_Paulo -- ver PainelDoGrupo para o porque. */
  hoje = today(),
}: {
  groupId: string;
  hoje?: string;
}) {
  const [mes, setMes] = useState(() => mesDaData(hoje));
  const [dados, setDados] = useState<RespostaDoFechamento | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await fetch(
        `/api/expense-groups/${groupId}/fechamento?mes=${mes}`
      );
      const json = await resposta.json();
      if (!resposta.ok || !json.success) {
        setErro(json.error ?? "Não foi possível carregar o fechamento");
        setDados(null);
        return;
      }
      setDados(json);
    } catch {
      setErro("Não foi possível carregar o fechamento");
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [groupId, mes]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  if (erro) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5" />
            Fechamento do mês
          </CardTitle>
          <CardDescription className="text-destructive">{erro}</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (carregando && !dados) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5" />
            Fechamento do mês
          </CardTitle>
          <CardDescription>Somando as contas do mês…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!dados) return null;

  // Os meses que o seletor oferece: os que tem conta, mais o mes corrente, mais
  // o mes escolhido (que pode ter ficado sem conta depois de um apagamento --
  // sem ele na lista o Select abriria em branco sobre um fechamento visivel).
  const mesesDoSeletor = Array.from(
    new Set([...(dados.meses ?? []), dados.mes, mes].filter(Boolean))
  ).sort((a, b) => b.localeCompare(a));

  const euPago = dados.transferencias.filter(
    (t) => t.from_user_id === dados.viewer_user_id
  );
  const euRecebo = dados.transferencias.filter(
    (t) => t.to_user_id === dados.viewer_user_id
  );
  const nomeDe = (id: string, nome?: string | null) =>
    id === dados.viewer_user_id ? "você" : nome ?? "alguém do grupo";

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarCheck className="h-5 w-5" />
              Fechamento de {rotuloDoMes(dados.mes)}
            </CardTitle>
            <CardDescription>
              Tudo que o grupo paga no mês, previsto e realizado juntos.
            </CardDescription>
          </div>
          <Select value={mes} onValueChange={setMes}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {mesesDoSeletor.map((m) => (
                <SelectItem key={m} value={m}>
                  {rotuloDoMes(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* O total do mes, e de onde ele vem */}
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Total do mês</p>
          <p className="text-3xl font-bold">{formatarValor(dados.total)}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className="gap-1">
              <Wallet className="h-3 w-3" />
              já pago {formatarValor(dados.total_realizado)}
            </Badge>
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              a vencer {formatarValor(dados.total_previsto)}
            </Badge>
          </div>
        </div>

        {/* Cada um paga quanto */}
        <div>
          <h4 className="mb-2 text-sm font-semibold">
            Cada um paga{" "}
            {dados.por_membro.length > 0 && (
              <span className="font-normal text-muted-foreground">
                ({dados.active_members}{" "}
                {dados.active_members === 1 ? "pessoa" : "pessoas"})
              </span>
            )}
          </h4>
          <div className="space-y-2">
            {dados.por_membro.map((p) => (
              <div
                key={p.user_id}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={p.avatar_url ?? undefined} />
                    <AvatarFallback>{inicial(p.full_name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {p.user_id === dados.viewer_user_id
                        ? "Você"
                        : p.full_name ?? "Membro do grupo"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      já colocou {formatarValor(p.pago)}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatarValor(p.devido)}</p>
                  {/* O saldo do MES: positivo = pagou mais que a parte dele. */}
                  <p
                    className={`text-xs ${
                      p.saldo > 0
                        ? "text-success"
                        : p.saldo < 0
                          ? "text-warning"
                          : "text-muted-foreground"
                    }`}
                  >
                    {p.saldo > 0
                      ? `recebe ${formatarValor(p.saldo)}`
                      : p.saldo < 0
                        ? `ainda deve ${formatarValor(Math.abs(p.saldo))}`
                        : "em dia"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* O acerto: quem paga para quem */}
        {dados.transferencias.length > 0 && (
          <div>
            <h4 className="mb-2 text-sm font-semibold">
              Para fechar o mês
            </h4>
            {(euPago.length > 0 || euRecebo.length > 0) && (
              <div className="mb-2 space-y-1">
                {euPago.map((t, i) => (
                  <p key={`p${i}`} className="text-sm font-medium">
                    Você paga{" "}
                    <span className="text-warning">
                      {formatarValor(t.amount)}
                    </span>{" "}
                    para {t.to_name ?? "alguém do grupo"}
                  </p>
                ))}
                {euRecebo.map((t, i) => (
                  <p key={`r${i}`} className="text-sm font-medium">
                    {t.from_name ?? "Alguém do grupo"} paga{" "}
                    <span className="text-success">
                      {formatarValor(t.amount)}
                    </span>{" "}
                    para você
                  </p>
                ))}
              </div>
            )}
            <div className="space-y-1">
              {dados.transferencias.map((t, i) => (
                <div
                  key={`t${i}`}
                  className="flex items-center gap-2 text-xs text-muted-foreground"
                >
                  <span>{nomeDe(t.from_user_id, t.from_name)}</span>
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  <span>{nomeDe(t.to_user_id, t.to_name)}</span>
                  <span className="ml-auto font-medium">
                    {formatarValor(t.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {dados.total > 0 && dados.transferencias.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ninguém deve nada a ninguém neste mês.
          </p>
        )}

        {dados.total === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma conta do grupo em {rotuloDoMes(dados.mes)}.
          </p>
        )}

        {/*
          O aviso tem de dizer o VALOR e o motivo. "As contas nao fecham" sem
          numero manda a pessoa conferir tudo a mao; com o numero ela reconhece
          a despesa de quem saiu do grupo.
        */}
        {!dados.fecha && (
          <p className="text-xs text-warning">
            {formatarValor(dados.pago_por_nao_membro)} deste mês foi pago por
            quem não está mais no grupo, então o acerto acima não fecha sozinho.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Este é o rateio do mês, com o previsto contando igual ao realizado —
          serve para combinar o acerto. O saldo de toda a vida do grupo, só com
          o que já aconteceu, está na aba Balanços.
        </p>
      </CardContent>
    </Card>
  );
}
