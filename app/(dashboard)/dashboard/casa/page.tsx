"use client";

// =============================================================================
// A CASA (migration 078): o mes da familia somado, onde o dinheiro dela esta,
// as contas conjuntas e quem mora junto -- inclusive o dependente sem login.
// =============================================================================
// A casa e o grupo com `group_kind = 'casa'` (076). Esta tela nao substitui a
// do grupo (despesas, divisao, fechamento, acerto); ela responde a pergunta que
// a do grupo nao responde: "como a familia fechou o mes?".
//
// Cada membro escolhe mostrar o proprio mes (`compartilha_com_a_casa`). Quem
// nao mostra aparece na lista de pessoas, sem numero, e a tela diz que a soma
// esta incompleta. A conta da soma (tirar o que um membro deve ao outro) esta
// em lib/resultado-da-casa.ts.
// =============================================================================

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ChevronLeft, ChevronRight, Home, Users, Wallet, Plus } from "lucide-react";
import { formatarValor } from "@/lib/dinheiro";
import { tipoDoGrupo } from "@/lib/tipo-do-grupo";
import type {
  MembroDaCasa,
  ResumoDaCasa,
  SaldosResumidos,
} from "@/lib/resultado-da-casa";
import { ContasConjuntasDaCasa, ExtratoDaConjunta } from "@/components/casa/ContaConjunta";

interface GrupoCasa {
  id: string;
  name: string;
}

interface DadosDaCasa {
  grupo: { id: string; name: string; closing_day: number | null } | null;
  periodo: { mes: string; desde: string; ate: string };
  moeda: string;
  membros: MembroDaCasa[];
  resultado: ResumoDaCasa;
  saldos: SaldosResumidos;
}

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

function nomeDoMes(mes: string): string {
  const [ano, numero] = mes.split("-").map(Number);
  return `${MESES[numero - 1]} de ${ano}`;
}

function mesVizinho(mes: string, passo: number): string {
  const [ano, numero] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(ano, numero - 1 + passo, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function mesDeHoje(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function Carregando() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
    </div>
  );
}

export default function CasaPage() {
  return (
    <Suspense fallback={<Carregando />}>
      <TelaDaCasa />
    </Suspense>
  );
}

function TelaDaCasa() {
  const router = useRouter();
  const busca = useSearchParams();
  const [casas, setCasas] = useState<GrupoCasa[] | null>(null);
  const [erroDasCasas, setErroDasCasas] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const resposta = await fetch("/api/expense-groups");
        const dados = await resposta.json();
        if (!resposta.ok) {
          setErroDasCasas(dados.error || "Não foi possível carregar os grupos.");
          return;
        }
        setCasas(
          (dados.groups || [])
            .filter((g: { group_kind?: unknown }) => tipoDoGrupo(g.group_kind) === "casa")
            .map((g: GrupoCasa) => ({ id: g.id, name: g.name }))
        );
      } catch {
        setErroDasCasas("Sem conexão com o servidor.");
      }
    })();
  }, []);

  const grupoId = busca.get("grupo") || casas?.[0]?.id || null;
  const mes = busca.get("mes") || mesDeHoje();

  const irPara = useCallback(
    (mudanca: { grupo?: string; mes?: string }) => {
      const p = new URLSearchParams(busca.toString());
      if (mudanca.grupo) p.set("grupo", mudanca.grupo);
      if (mudanca.mes) p.set("mes", mudanca.mes);
      router.replace(`/dashboard/casa?${p.toString()}`);
    },
    [busca, router]
  );

  if (erroDasCasas) {
    return <p className="p-6 text-destructive">{erroDasCasas}</p>;
  }
  if (casas === null) return <Carregando />;

  if (casas.length === 0) {
    return (
      <div className="max-w-2xl mx-auto p-4 sm:p-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Home className="h-5 w-5" /> Casa
            </CardTitle>
            <CardDescription>
              Aqui aparece o mês da família somado, as contas conjuntas e quem
              mora junto. Para começar, crie um grupo do tipo Casa (ou mude o
              tipo de um grupo que você já tem) e convide quem mora com você.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/dashboard/expense-groups">Ir para Grupos</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Home className="h-6 w-6" />
          {casas.length > 1 ? (
            <select
              aria-label="Escolher a casa"
              className="text-2xl font-bold bg-transparent border-b"
              value={grupoId ?? ""}
              onChange={(e) => irPara({ grupo: e.target.value })}
            >
              {casas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : (
            <h1 className="text-2xl font-bold">{casas[0].name}</h1>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Mês anterior" onClick={() => irPara({ mes: mesVizinho(mes, -1) })}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[10rem] text-center font-medium capitalize">{nomeDoMes(mes)}</span>
          <Button variant="ghost" size="icon" aria-label="Próximo mês" onClick={() => irPara({ mes: mesVizinho(mes, 1) })}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {grupoId && <VisaoDaCasa grupoId={grupoId} mes={mes} />}
    </div>
  );
}

function VisaoDaCasa({ grupoId, mes }: { grupoId: string; mes: string }) {
  const [dados, setDados] = useState<DadosDaCasa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [extratoAberto, setExtratoAberto] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const resposta = await fetch(`/api/casa/${grupoId}?mes=${encodeURIComponent(mes)}`);
      const corpo = await resposta.json();
      if (!resposta.ok) {
        setErro(corpo.error || "Não foi possível carregar a casa.");
        return;
      }
      setErro(null);
      setDados(corpo);
    } catch {
      setErro("Sem conexão com o servidor.");
    }
  }, [grupoId, mes]);

  useEffect(() => {
    setDados(null);
    carregar();
  }, [carregar]);

  const eu = useMemo(() => dados?.membros.find((m) => m.sou_eu) ?? null, [dados]);
  const souAdmin = eu?.role === "admin";

  async function mudarCompartilhamento(compartilha: boolean) {
    setSalvando(true);
    try {
      const resposta = await fetch(`/api/casa/${grupoId}/compartilhar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ compartilha }),
      });
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        setErro(corpo.error || "Não foi possível mudar o compartilhamento.");
        return;
      }
      await carregar();
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <p className="text-destructive">{erro}</p>;
  if (!dados) return <Carregando />;

  const { resultado, saldos, moeda } = dados;
  const totais = resultado.totais.length
    ? resultado.totais
    : [{ currency: moeda, entrou: 0, saiu: 0, resultado: 0, interno: 0 }];

  return (
    <>
      <Card className={eu?.compartilha ? undefined : "border-primary"}>
        <CardContent className="flex items-center justify-between gap-4 pt-6">
          <div>
            <p className="font-medium">Mostrar o meu mês para a casa</p>
            <p className="text-sm text-muted-foreground">
              A casa vê só os seus totais (entrou, saiu, resultado) e o total
              do saldo das suas contas. Nenhum lançamento seu aparece.
            </p>
          </div>
          <Switch
            checked={!!eu?.compartilha}
            disabled={salvando || !eu}
            onCheckedChange={mudarCompartilhamento}
            aria-label="Mostrar o meu mês para a casa"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>O mês da casa</CardTitle>
          <CardDescription>
            A soma do Resultado de quem mostra o mês, sem contar duas vezes o
            que um membro deve ao outro.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {totais.map((t) => (
            <div key={t.currency} className="grid grid-cols-3 gap-3">
              <Numero rotulo="Entrou" valor={t.entrou} moeda={t.currency} classe="text-green-600" />
              <Numero rotulo="Saiu" valor={t.saiu} moeda={t.currency} classe="text-red-600" />
              <Numero
                rotulo="Resultado"
                valor={t.resultado}
                moeda={t.currency}
                classe={t.resultado < 0 ? "text-red-600" : "text-green-600"}
              />
            </div>
          ))}
          {totais.some((t) => t.interno > 0) && (
            <p className="text-xs text-muted-foreground">
              {totais
                .filter((t) => t.interno > 0)
                .map((t) => formatarValor(t.interno, t.currency))
                .join(" + ")}{" "}
              de parte de despesa que um membro pagou por outro ficou fora do
              Saiu: é dívida dentro da casa, não dinheiro que saiu dela.
            </p>
          )}
          {resultado.naoCompartilham > 0 && (
            <p className="text-sm text-amber-700">
              {resultado.naoCompartilham === 1
                ? "1 pessoa da casa não mostra o mês, e a soma não inclui ela."
                : `${resultado.naoCompartilham} pessoas da casa não mostram o mês, e a soma não inclui elas.`}
            </p>
          )}

          {resultado.porMembro.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="py-1 pr-2 font-normal">Quem</th>
                    <th className="py-1 px-2 font-normal text-right">Entrou</th>
                    <th className="py-1 px-2 font-normal text-right">Saiu</th>
                    <th className="py-1 pl-2 font-normal text-right">Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.porMembro.map((m) => (
                    <tr key={`${m.user_id}-${m.currency}`} className="border-t">
                      <td className="py-1 pr-2">{m.nome}</td>
                      <td className="py-1 px-2 text-right">{formatarValor(m.entrou, m.currency)}</td>
                      <td className="py-1 px-2 text-right">{formatarValor(m.saiu, m.currency)}</td>
                      <td className="py-1 pl-2 text-right">
                        {formatarValor(m.resultado, m.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-1 text-xs text-muted-foreground">
                Cada linha é o mesmo número que a pessoa vê no painel dela.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" /> Onde o dinheiro da casa está
          </CardTitle>
          <CardDescription>Saldo de hoje, sem cartão de crédito.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {saldos.conjuntas.length === 0 && saldos.porMembro.length === 0 && (
            <p className="text-muted-foreground">
              Nenhuma conta conjunta e ninguém mostrando o saldo ainda.
            </p>
          )}
          {saldos.conjuntas.map((c) => (
            <div key={c.account_id} className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{c.nome}</span>{" "}
                  <Badge variant="secondary">Conjunta</Badge>
                  <span className="block text-xs text-muted-foreground">de {c.dono}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {formatarValor(c.saldo, c.currency)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExtratoAberto(extratoAberto === c.account_id ? null : c.account_id)}
                  >
                    {extratoAberto === c.account_id ? "Fechar" : "Extrato"}
                  </Button>
                </div>
              </div>
              {extratoAberto === c.account_id && (
                <ExtratoDaConjunta grupoId={grupoId} contaId={c.account_id} mes={mes} moeda={c.currency} />
              )}
            </div>
          ))}
          {saldos.porMembro.map((m) => (
            <div key={`${m.user_id}-${m.currency}`} className="flex items-center justify-between">
              <span>Contas de {m.nome}</span>
              <span>
                {formatarValor(m.saldo, m.currency)}
              </span>
            </div>
          ))}
          {saldos.totais.map((t) => (
            <div key={t.currency} className="flex items-center justify-between border-t pt-2 font-semibold">
              <span>Total{saldos.totais.length > 1 ? ` (${t.currency})` : ""}</span>
              <span>
                {formatarValor(t.saldo, t.currency)}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>

      <ContasConjuntasDaCasa grupoId={grupoId} aoMudar={carregar} />

      <PessoasDaCasa
        grupoId={grupoId}
        membros={dados.membros}
        souAdmin={souAdmin}
        aoMudar={carregar}
      />
    </>
  );
}

function Numero({
  rotulo,
  valor,
  moeda,
  classe,
}: {
  rotulo: string;
  valor: number;
  moeda: string;
  classe?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className={`text-lg sm:text-xl font-semibold ${classe ?? ""}`}>
        {formatarValor(valor, moeda)}
      </p>
    </div>
  );
}

function PessoasDaCasa({
  grupoId,
  membros,
  souAdmin,
  aoMudar,
}: {
  grupoId: string;
  membros: MembroDaCasa[];
  souAdmin: boolean;
  aoMudar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function adicionarDependente(e: React.FormEvent) {
    e.preventDefault();
    const limpo = nome.trim();
    if (!limpo) return;
    setSalvando(true);
    setErro(null);
    try {
      // A rota do membro sem conta (077) e a mesma do convidado do churrasco:
      // o dependente e um membro sem conta num grupo do tipo casa.
      const resposta = await fetch(`/api/expense-groups/${grupoId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: limpo }),
      });
      if (!resposta.ok) {
        const corpo = await resposta.json().catch(() => ({}));
        setErro(
          resposta.status === 404 || resposta.status === 405
            ? "Adicionar dependente ainda não está disponível neste app."
            : corpo.error || "Não foi possível adicionar o dependente."
        );
        return;
      }
      setNome("");
      aoMudar();
    } catch {
      setErro("Sem conexão com o servidor.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" /> Quem mora na casa
        </CardTitle>
        <CardDescription>
          Dependente é quem faz parte da casa sem ter login no app, como um
          filho. Ele aparece aqui, mas não tem mês próprio para mostrar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y">
          {membros.map((m) => (
            <li key={m.member_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {m.nome}
                {m.sou_eu && <span className="text-muted-foreground"> (você)</span>}
              </span>
              <span className="flex flex-wrap gap-1">
                {m.role === "admin" && <Badge variant="outline">Admin</Badge>}
                {m.dependente ? (
                  <Badge variant="secondary">Dependente</Badge>
                ) : m.compartilha ? (
                  <Badge variant="outline">Mostra o mês</Badge>
                ) : (
                  <Badge variant="outline" className="text-muted-foreground">
                    Não mostra o mês
                  </Badge>
                )}
              </span>
            </li>
          ))}
        </ul>

        {souAdmin && (
          <form onSubmit={adicionarDependente} className="flex gap-2">
            <Input
              placeholder="Nome do dependente"
              value={nome}
              maxLength={80}
              onChange={(e) => setNome(e.target.value)}
              aria-label="Nome do dependente"
            />
            <Button type="submit" disabled={salvando || !nome.trim()}>
              <Plus className="h-4 w-4 mr-1" /> Dependente
            </Button>
          </form>
        )}
        {erro && <p className="text-sm text-destructive">{erro}</p>}

        <p className="text-xs text-muted-foreground">
          Despesas, divisão e fechamento continuam na{" "}
          <Link className="underline" href={`/dashboard/expense-groups/${grupoId}`}>
            tela do grupo
          </Link>
          .
        </p>
      </CardContent>
    </Card>
  );
}
