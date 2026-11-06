"use client";

// ---------------------------------------------------------------------------
// MOVER E PARCELAR A FATURA (comparacao com o Minhas Financas)
// ---------------------------------------------------------------------------
// Duas acoes sobre a fatura do mes na tela do cartao:
//   - "Mover para o próximo vencimento": toda compra desta fatura passa para a
//     seguinte (POST /api/card-invoices/mover);
//   - "Parcelar fatura": o total entra em N faturas seguintes, com juros
//     opcionais (POST /api/card-invoices/parcelar; DELETE desfaz).
// As regras e recusas estao em lib/mover-e-parcelar-fatura.ts. A tela so pede
// confirmacao, chama a rota e recarrega.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { CalendarClock, Layers, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAXIMO_DE_PARCELAS } from "@/lib/mover-e-parcelar-fatura";
import { valorDigitado } from "@/lib/pagamento-parcial-da-fatura";

type Acao = "mover" | "parcelar" | "desfazer" | null;

export function AcoesDaFatura({
  contaId,
  mes,
  rotuloDoMes,
  parcelada,
  aoMudar,
}: {
  contaId: string;
  /** 'AAAA-MM'. */
  mes: string;
  /** "novembro de 2026". */
  rotuloDoMes: string;
  /** A fatura ja tem um parcelamento (para oferecer desfazer). */
  parcelada: boolean;
  aoMudar: () => void;
}) {
  const [acao, setAcao] = useState<Acao>(null);
  const [parcelas, setParcelas] = useState("3");
  const [juros, setJuros] = useState("");
  const [enviando, setEnviando] = useState(false);

  const numeroDeParcelas = Number(parcelas);
  const parcelasValidas =
    Number.isInteger(numeroDeParcelas) &&
    numeroDeParcelas >= 2 &&
    numeroDeParcelas <= MAXIMO_DE_PARCELAS;
  const jurosValor = valorDigitado(juros);
  const jurosInvalido = juros.trim() !== "" && jurosValor === null;

  const enviar = async () => {
    setEnviando(true);
    try {
      const url =
        acao === "mover" ? "/api/card-invoices/mover" : "/api/card-invoices/parcelar";
      const corpo: Record<string, unknown> = { account_id: contaId, month: mes };
      if (acao === "parcelar") {
        corpo.parcelas = numeroDeParcelas;
        if (jurosValor) corpo.juros = jurosValor;
      }
      const resposta = await fetch(url, {
        method: acao === "desfazer" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) {
        toast.error(dados.error ?? "Não foi possível mudar a fatura");
        return;
      }
      toast.success(dados.message ?? "Fatura atualizada");
      setAcao(null);
      aoMudar();
    } catch (erro) {
      console.error(erro);
      toast.error("Não foi possível mudar a fatura");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setAcao("mover")}>
          <CalendarClock className="mr-2 h-4 w-4" />
          Mover para o próximo vencimento
        </Button>
        {parcelada ? (
          <Button variant="outline" size="sm" onClick={() => setAcao("desfazer")}>
            <Undo2 className="mr-2 h-4 w-4" />
            Desfazer parcelamento
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAcao("parcelar")}>
            <Layers className="mr-2 h-4 w-4" />
            Parcelar fatura
          </Button>
        )}
      </div>

      <Dialog
        open={acao !== null}
        onOpenChange={(aberto) => {
          if (!aberto) setAcao(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {acao === "mover"
                ? "Mover fatura para o próximo vencimento?"
                : acao === "parcelar"
                  ? "Parcelar a fatura"
                  : "Desfazer o parcelamento?"}
            </DialogTitle>
          </DialogHeader>

          {acao === "mover" && (
            <p className="text-sm text-muted-foreground">
              Todas as compras da fatura de {rotuloDoMes} passam para a fatura
              seguinte. O que você deve no cartão não muda. Se a fatura já
              estava fechada em Contas a Pagar, ela sai de lá.
            </p>
          )}

          {acao === "parcelar" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                A fatura de {rotuloDoMes} fecha em zero e o total entra nas
                próximas faturas, uma parcela por mês. Os juros entram como
                despesa, divididos entre as parcelas.
              </p>
              <div>
                <Label htmlFor="parcelas-da-fatura">Parcelas</Label>
                <Input
                  id="parcelas-da-fatura"
                  type="number"
                  min={2}
                  max={MAXIMO_DE_PARCELAS}
                  value={parcelas}
                  onChange={(e) => setParcelas(e.target.value)}
                />
                {!parcelasValidas && (
                  <p className="mt-1 text-xs text-destructive">
                    De 2 a {MAXIMO_DE_PARCELAS} parcelas.
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="juros-da-fatura">Juros totais (opcional)</Label>
                <Input
                  id="juros-da-fatura"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={juros}
                  onChange={(e) => setJuros(e.target.value)}
                />
                {jurosInvalido && (
                  <p className="mt-1 text-xs text-destructive">
                    Digite os juros como 45 ou 45,90.
                  </p>
                )}
              </div>
            </div>
          )}

          {acao === "desfazer" && (
            <p className="text-sm text-muted-foreground">
              As parcelas e os juros saem das próximas faturas, e a fatura de{" "}
              {rotuloDoMes} volta ao total.
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAcao(null)}>
              Cancelar
            </Button>
            <Button
              disabled={
                enviando ||
                (acao === "parcelar" && (!parcelasValidas || jurosInvalido))
              }
              onClick={() => void enviar()}
            >
              {enviando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {acao === "mover" ? "Mover" : acao === "parcelar" ? "Parcelar" : "Desfazer"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
