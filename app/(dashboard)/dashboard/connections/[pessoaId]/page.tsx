"use client";

// A CONEXAO COMO UM GRUPO DE DUAS PESSOAS (075, RN020.11)
//
// O que esta registrado entre mim e a conexao, mes a mes: quanto eu ainda pago
// a ela, quanto ela ainda me paga, e as contas de cada mes. As linhas sao as
// contas que o banco gera para cada lado de uma despesa dividida -- do
// lancamento avulso (070) e da conta fixa, prevista e parcelada (075). Quitar
// e na agenda, pela baixa de sempre (RN020.6); esta tela so junta.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ArrowLeft, Plus, CalendarClock } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { dataCurtaNaTela } from "@/lib/data-na-tela";
import { comOrigem } from "@/lib/retorno-do-lancamento";
import { PARAM_DA_CONEXAO, type MesDaConexao } from "@/lib/conta-da-conexao";
import { hojeISO } from "@/lib/lancamento";

interface Pessoa {
  id: string;
  full_name: string | null;
  nickname: string | null;
  avatar_url: string | null;
}

const NOMES_DOS_MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function nomeDoMes(mes: string): string {
  const [ano, numero] = mes.split("-").map(Number);
  return `${NOMES_DOS_MESES[numero - 1]} de ${ano}`;
}

function rotuloDoStatus(status: string, vencimento: string, hoje: string) {
  if (status === "paid") return { texto: "Paga", variante: "secondary" as const };
  if (vencimento < hoje) return { texto: "Vencida", variante: "destructive" as const };
  return { texto: "Em aberto", variante: "outline" as const };
}

export default function ConexaoPage() {
  const { pessoaId } = useParams<{ pessoaId: string }>();
  const [pessoa, setPessoa] = useState<Pessoa | null>(null);
  const [meses, setMeses] = useState<MesDaConexao[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const resposta = await fetch(
        `/api/connections/contas?pessoa=${encodeURIComponent(pessoaId)}`
      );
      const dados = await resposta.json();
      if (!resposta.ok) {
        setErro(dados.error || "Não foi possível carregar a conexão.");
        return;
      }
      setErro(null);
      setPessoa(dados.pessoa);
      setMeses(dados.meses || []);
    } catch {
      setErro("Sem conexão com o servidor.");
    } finally {
      setCarregando(false);
    }
  }, [pessoaId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const hoje = hojeISO();
  const mesAtual = hoje.slice(0, 7);
  const nome = pessoa?.full_name || pessoa?.nickname || "sua conexão";
  // Os meses que ainda pedem dinheiro: do atual em diante, e os anteriores com
  // conta em aberto (o atraso). Os anteriores quitados ficam no historico.
  const emAberto = meses.filter(
    (m) => m.mes >= mesAtual || m.aPagar > 0 || m.aReceber > 0
  );
  const historico = meses.filter((m) => !emAberto.includes(m)).reverse();
  const lancarConta = comOrigem(
    `/dashboard/movimentacoes/despesa?${PARAM_DA_CONEXAO}=${encodeURIComponent(pessoaId)}`,
    `/dashboard/connections/${pessoaId}`
  );

  if (carregando && !pessoa) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/dashboard/connections">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Conexões
        </Link>
      </Button>

      {erro ? (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">{erro}</CardContent>
        </Card>
      ) : (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Avatar className="h-12 w-12">
                <AvatarImage src={pessoa?.avatar_url ?? undefined} />
                <AvatarFallback>{nome.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div>
                <h1 className="text-2xl font-bold">{nome}</h1>
                <p className="text-sm text-muted-foreground">
                  O que vocês dividem, mês a mês
                </p>
              </div>
            </div>
            <Button asChild>
              <Link href={lancarConta}>
                <Plus className="h-4 w-4 mr-2" />
                Lançar conta com {nome}
              </Link>
            </Button>
          </div>

          {emAberto.length === 0 && historico.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                <CalendarClock className="h-10 w-10 text-muted-foreground" />
                <p className="font-medium">Nada dividido com {nome} ainda</p>
                <p className="text-sm text-muted-foreground max-w-md">
                  Lance uma despesa (avulsa, fixa, prevista ou parcelada) e marque
                  &quot;Dividir esta despesa&quot; com {nome}. Quem pagou vê o valor
                  a receber, e quem deve vê o pagamento previsto no mês.
                </p>
              </CardContent>
            </Card>
          )}

          {emAberto.map((mes) => (
            <MesDaConexaoCard key={mes.mes} mes={mes} nome={nome} hoje={hoje} />
          ))}

          {historico.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Meses quitados</h2>
              {historico.map((mes) => (
                <MesDaConexaoCard key={mes.mes} mes={mes} nome={nome} hoje={hoje} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MesDaConexaoCard({
  mes,
  nome,
  hoje,
}: {
  mes: MesDaConexao;
  nome: string;
  hoje: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="capitalize">{nomeDoMes(mes.mes)}</CardTitle>
        <CardDescription>
          {mes.saldo > 0
            ? `${nome} ainda te paga ${formatCurrency(mes.saldo)} neste mês`
            : mes.saldo < 0
              ? `Você ainda paga ${formatCurrency(-mes.saldo)} a ${nome} neste mês`
              : mes.aPagar > 0
                ? `Vocês se pagam o mesmo valor neste mês`
                : "Tudo quitado neste mês"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground">Você paga</p>
            <p className="text-lg font-semibold text-destructive">
              {formatCurrency(mes.aPagar)}
            </p>
            {mes.pago > 0 && (
              <p className="text-xs text-muted-foreground">
                já pagou {formatCurrency(mes.pago)}
              </p>
            )}
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-muted-foreground">Você recebe</p>
            <p className="text-lg font-semibold text-success">
              {formatCurrency(mes.aReceber)}
            </p>
            {mes.recebido > 0 && (
              <p className="text-xs text-muted-foreground">
                já recebeu {formatCurrency(mes.recebido)}
              </p>
            )}
          </div>
        </div>

        <ul className="divide-y">
          {mes.contas.map((conta) => {
            const status = rotuloDoStatus(conta.status, conta.due_date, hoje);
            const receber = conta.transaction_type === "income";
            return (
              <li
                key={conta.id}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate">{conta.description}</p>
                  <p className="text-xs text-muted-foreground">
                    vence {dataCurtaNaTela(conta.due_date)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={status.variante}>{status.texto}</Badge>
                  <span
                    className={
                      receber ? "font-medium text-success" : "font-medium text-destructive"
                    }
                  >
                    {receber ? "+" : "−"}
                    {formatCurrency(Math.abs(Number(conta.amount)))}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>

        {(mes.aPagar > 0 || mes.aReceber > 0) && (
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/bills">Pagar ou receber na agenda</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
