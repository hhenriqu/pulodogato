"use client";

/**
 * O FECHAMENTO DO GRUPO POR PERIODO (RN018, fase 2 do modelo novo).
 *
 * "Adicionar dia do fechamento do grupo, isso vai facilitar pra fechar o total
 * e lancar as receitas e despesas."
 *
 * O cartao tem tres partes, de cima para baixo:
 *
 *   1. o dia de fechamento: o admin escolhe, os outros membros veem;
 *   2. a PREVIA do periodo aberto: o que cada um pagaria ou receberia se o
 *      periodo fechasse com o que ja foi lancado. E a mesma conta que o
 *      fechamento grava (a rota usa `fecharPeriodo`, igual ao cron), entao a
 *      previa e o fechamento nao tem como discordar;
 *   3. os fechamentos ja feitos, com o que cada um ficou devendo ou tendo a
 *      receber.
 *
 * Fica na aba de Membros, logo abaixo da divisao da conta: o % de cada um e o
 * dia de fechamento sao as duas configuracoes que o fechamento usa, e a pessoa
 * que mexe numa precisa ver a outra.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatarValor } from "@/lib/dinheiro";
import { dataNaTela } from "@/lib/data-na-tela";
import { DIA_MAXIMO, DIA_MINIMO } from "@/lib/fechamento-por-periodo";
import { toast } from "sonner";

interface PosicaoNoPeriodo {
  user_id: string;
  percentual: number;
  pago: number;
  acertos: number;
  responsabilidade: number;
  saldo: number;
}

interface FechamentoGravado {
  id: string;
  period_start: string;
  period_end: string;
  total: number;
  members: PosicaoNoPeriodo[];
}

interface RespostaDoPeriodo {
  closing_day: number | null;
  periodo: { inicio: string; fim: string } | null;
  previa: { total: number; membros: PosicaoNoPeriodo[]; fecha: boolean } | null;
  fechamentos: FechamentoGravado[];
  nomes: Record<string, string | null>;
  viewer_user_id: string;
}

/** O valor do Select para "o grupo nao fecha". `""` nao e valor valido no Radix. */
const SEM_FECHAMENTO = "nenhum";

const DIAS = Array.from(
  { length: DIA_MAXIMO - DIA_MINIMO + 1 },
  (_, i) => String(DIA_MINIMO + i)
);

export function FechamentoDoPeriodo({
  groupId,
  ehAdmin,
}: {
  groupId: string;
  ehAdmin: boolean;
}) {
  const [dados, setDados] = useState<RespostaDoPeriodo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [dia, setDia] = useState<string>(SEM_FECHAMENTO);
  const [gravando, setGravando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const resposta = await fetch(`/api/expense-groups/${groupId}/fechamento-do-periodo`);
      const json = await resposta.json();
      if (!resposta.ok || !json.success) {
        setErro(json.error ?? "Não foi possível carregar o fechamento do grupo");
        setDados(null);
        return;
      }
      setDados(json);
      setDia(json.closing_day ? String(json.closing_day) : SEM_FECHAMENTO);
    } catch {
      setErro("Não foi possível carregar o fechamento do grupo");
      setDados(null);
    } finally {
      setCarregando(false);
    }
  }, [groupId]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const gravar = async () => {
    setGravando(true);
    try {
      const resposta = await fetch(`/api/expense-groups/${groupId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          closing_day: dia === SEM_FECHAMENTO ? null : Number(dia),
        }),
      });
      const json = await resposta.json();
      if (!resposta.ok) {
        toast.error(json.error ?? "Não foi possível gravar o dia de fechamento");
        return;
      }
      toast.success(
        dia === SEM_FECHAMENTO
          ? "O grupo não fecha mais por período"
          : `O grupo fecha todo dia ${dia}`
      );
      await carregar();
    } catch {
      toast.error("Não foi possível gravar o dia de fechamento");
    } finally {
      setGravando(false);
    }
  };

  if (erro) {
    return <p className="text-sm text-destructive">{erro}</p>;
  }

  if (carregando && !dados) {
    return <p className="text-sm text-muted-foreground">Carregando o fechamento…</p>;
  }

  if (!dados) return null;

  const nomeDe = (id: string) =>
    id === dados.viewer_user_id ? "Você" : dados.nomes[id] ?? "Membro do grupo";

  const mudou = dia !== (dados.closing_day ? String(dados.closing_day) : SEM_FECHAMENTO);

  return (
    <div className="space-y-5">
      {/* 1. O dia */}
      <div className="space-y-2">
        <Label htmlFor="dia-de-fechamento">Dia de fechamento</Label>
        {ehAdmin ? (
          <div className="flex flex-wrap items-center gap-2">
            <Select value={dia} onValueChange={setDia}>
              <SelectTrigger id="dia-de-fechamento" className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SEM_FECHAMENTO}>Não fecha</SelectItem>
                {DIAS.map((d) => (
                  <SelectItem key={d} value={d}>
                    Todo dia {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={gravar} disabled={!mudou || gravando}>
              {gravando ? "Gravando…" : "Gravar"}
            </Button>
          </div>
        ) : (
          <p id="dia-de-fechamento" className="text-sm">
            {dados.closing_day ? `Todo dia ${dados.closing_day}` : "O grupo não fecha por período"}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          No dia do fechamento, o saldo de cada um no período vira uma conta: Pagamento
          ao grupo para quem pagou menos que a parte dele, A receber do grupo para quem
          pagou mais. Vai de 1 a 28 porque todo mês tem dia 28.
        </p>
      </div>

      {/* 2. A previa do periodo aberto */}
      {dados.periodo && dados.previa && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold">
            Período aberto: {dataNaTela(dados.periodo.inicio)} a {dataNaTela(dados.periodo.fim)}
          </h4>
          <p className="text-xs text-muted-foreground">
            Prévia com o que já foi pago até agora: {formatarValor(dados.previa.total)} em
            contas do grupo. Muda até o dia do fechamento.
          </p>
          <div className="space-y-2">
            {dados.previa.membros.map((m) => (
              <LinhaDoMembro key={m.user_id} nome={nomeDe(m.user_id)} posicao={m} />
            ))}
          </div>
          {!dados.previa.fecha && (
            <p className="text-xs text-warning">
              O grupo não tem membro ativo para dividir estas contas, então o período não
              fecha.
            </p>
          )}
        </div>
      )}

      {/* 3. Os fechamentos feitos */}
      {dados.fechamentos.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Fechamentos</h4>
          {dados.fechamentos.map((f) => (
            <div key={f.id} className="space-y-2 rounded-lg border p-3">
              <p className="text-sm font-medium">
                {dataNaTela(f.period_start)} a {dataNaTela(f.period_end)} ·{" "}
                {formatarValor(Number(f.total))}
              </p>
              {(f.members ?? []).map((m) => (
                <LinhaDoMembro key={m.user_id} nome={nomeDe(m.user_id)} posicao={m} />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Uma pessoa no fechamento: a parte dela e o que o saldo vira. */
function LinhaDoMembro({ nome, posicao }: { nome: string; posicao: PosicaoNoPeriodo }) {
  const saldo = Number(posicao.saldo);
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div className="min-w-0">
        <p className="truncate font-medium">{nome}</p>
        <p className="text-xs text-muted-foreground">
          {Number(posicao.percentual)}% · parte {formatarValor(Number(posicao.responsabilidade))} ·
          pagou {formatarValor(Number(posicao.pago))}
        </p>
      </div>
      <p
        className={`shrink-0 text-right text-xs font-medium ${
          saldo > 0 ? "text-success" : saldo < 0 ? "text-warning" : "text-muted-foreground"
        }`}
      >
        {saldo > 0
          ? `A receber ${formatarValor(saldo)}`
          : saldo < 0
            ? `Pagamento ${formatarValor(Math.abs(saldo))}`
            : "Em dia"}
      </p>
    </div>
  );
}
