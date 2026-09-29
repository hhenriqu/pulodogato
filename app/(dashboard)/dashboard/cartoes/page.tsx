"use client";

// ---------------------------------------------------------------------------
// CARTOES (HMO-166)
// ---------------------------------------------------------------------------
// A outra metade da tela que era "Contas e Cartões". Aqui esta o que tem
// FATURA: cartao de credito, e so ele. Limite, dia de fechamento e dia de
// vencimento sao campos desta tela e de mais nenhuma.
//
// Cartao de debito nao esta aqui -- ele nao tem fatura, nem limite, nem
// fechamento: o dinheiro sai da conta na hora. Ele se comporta como conta e
// mora em `/dashboard/contas`. A decisao esta em `lib/contas.ts`, numa palavra
// so, e nao repetida por nenhuma tela.
//
// O AVISO QUE ESTA TELA EXISTE PARA DAR
// -------------------------------------
// Um cartao sem fechamento e vencimento nao fecha fatura. O
// `card_invoice_month()` (migration 006) trata toda compra como do proprio mes,
// entao a compra do dia 28 aparece no mes errado e o `/api/card-invoices/close`
// nao tem em que dia se apoiar. Nada nisso da erro: o cadastro salva, a compra
// entra, e o mes fecha torto. Por isso o aviso e uma tarja no cartao, e nao uma
// validacao que bloqueia -- da para cadastrar o cartao antes de saber os dias,
// mas nao da para esquecer que faltam.
//
// ESTA TELA ABRE SEM REDE, com o mesmo pedagio da de Contas: todo total passa
// por `podeMostrarNumero()` e a frase de vazio por `podeAfirmarVazio()`.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Archive, CreditCard, Loader2, Pencil, Plus, Wallet } from "lucide-react";
import type { FinancialAccount } from "@/types/financial";
import {
  faltaFatura,
  totalDoEscopo,
  valoresDaConta,
  valoresIniciais,
  type ValoresDaConta,
} from "@/lib/contas";
import { CamposDaConta } from "@/components/contas/CamposDaConta";
import { ContasArquivadas } from "@/components/contas/ContasArquivadas";
import { useContas } from "@/lib/hooks/useContas";
import { formatarValor } from "@/lib/dinheiro";
import { podeAfirmarVazio, podeMostrarNumero } from "@/lib/offline-leitura";
import {
  FaixaDadoDoAparelho,
  NumeroIndisponivel,
  PainelErroDoServidor,
  PainelSemRede,
} from "@/components/SemRede";
import { useEstaOnline } from "@/lib/hooks/useEstaOnline";
import { usePreferenciaDeMoeda } from "@/lib/hooks/usePreferenciaDeMoeda";

export default function CartoesPage() {
  const {
    ativas,
    arquivadas,
    carregando,
    salvando,
    estado,
    guardadoEm,
    carregar,
    salvar,
    arquivar,
    reativar,
  } = useContas("cartao");

  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<ValoresDaConta>(() =>
    valoresIniciais("cartao")
  );
  const online = useEstaOnline();
  // Decide se o seletor de moeda aparece nesta tela, e qual moeda uma conta
  // nova ganha por padrao. Ver lib/hooks/usePreferenciaDeMoeda.
  const { moeda: preferenciaDeMoeda } = usePreferenciaDeMoeda();

  // A fatura e apresentada como divida, entao soma em modulo: o valor gravado e
  // negativo (as compras rebaixaram o saldo do cartao) e "Faturas em aberto:
  // -R$ 1.200" seria um sinal a mais na leitura.
  const fatura = useMemo(() => totalDoEscopo(ativas, "cartao"), [ativas]);
  const semDiasDeFatura = useMemo(
    () => ativas.filter((c) => faltaFatura(c)).length,
    [ativas]
  );

  function abrirNovo() {
    setForm(valoresIniciais("cartao", preferenciaDeMoeda.oficial));
    setAberto(true);
  }

  function abrirEdicao(conta: FinancialAccount) {
    setForm(valoresDaConta(conta));
    setAberto(true);
  }

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    if (await salvar(form)) {
      setAberto(false);
      setForm(valoresIniciais("cartao"));
    }
  }

  if (carregando) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-info" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cartões</h1>
          <p className="text-sm text-muted-foreground">
            O que tem fatura.{" "}
            <Link
              href="/dashboard/contas"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Contas e cartão de débito ficam em outra tela
            </Link>
            .
          </p>
        </div>
        <Button onClick={abrirNovo} disabled={!online}>
          <Plus className="mr-2 h-4 w-4" />
          {online ? "Novo cartão" : "Novo cartão (precisa de rede)"}
        </Button>
      </div>

      {estado === "do-aparelho" && (
        <FaixaDadoDoAparelho
          guardadoEm={guardadoEm}
          soLeitura
          aoTentarDeNovo={carregar}
        />
      )}

      {estado === "sem-rede" ? (
        <PainelSemRede oQue="seus cartões" aoTentarDeNovo={carregar} />
      ) : estado === "erro-do-servidor" ? (
        <PainelErroDoServidor oQue="seus cartões" aoTentarDeNovo={carregar} />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Faturas em aberto</CardDescription>
              <CardTitle className="text-2xl text-warning">
                {podeMostrarNumero(estado) ? (
                  formatarValor(fatura)
                ) : (
                  <NumeroIndisponivel />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Soma do que já foi gasto nos cartões ativos. Não entra no saldo:
                é dívida, não dinheiro que você tem.
              </p>
              {/*
                O contador so aparece quando ha numero para mostrar. Sem dado
                confiavel, "1 cartão sem fechamento" seria uma afirmacao sobre
                uma lista que a tela nao conseguiu ler.
              */}
              {podeMostrarNumero(estado) && semDiasDeFatura > 0 && (
                <p className="text-xs text-warning">
                  {semDiasDeFatura === 1
                    ? "1 cartão ainda não fecha fatura: falta o fechamento ou o vencimento."
                    : `${semDiasDeFatura} cartões ainda não fecham fatura: falta o fechamento ou o vencimento.`}
                </p>
              )}
            </CardContent>
          </Card>

          {ativas.length === 0 && podeAfirmarVazio(estado) ? (
            <Card>
              <CardContent className="py-10 text-center">
                <CreditCard className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="font-medium text-foreground">
                  Você ainda não tem cartões de crédito
                </p>
                <p className="mb-4 text-sm text-muted-foreground">
                  Cadastre o cartão com o dia do fechamento e o do vencimento
                  para a fatura fechar no mês certo.
                </p>
                <Button onClick={abrirNovo} disabled={!online}>
                  <Plus className="mr-2 h-4 w-4" />
                  Cadastrar o primeiro
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {ativas.map((conta) => {
                const semDias = faltaFatura(conta);

                return (
                  <Card key={conta.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="flex h-9 w-9 items-center justify-center rounded-md"
                          style={{ backgroundColor: `${conta.color_hex}20` }}
                        >
                          <CreditCard
                            className="h-4 w-4"
                            style={{ color: conta.color_hex }}
                          />
                        </span>
                        <div>
                          <CardTitle className="text-base">
                            {conta.name}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            {conta.bank_name || "Cartão de crédito"}
                            {conta.last_four_digits
                              ? ` · ••${conta.last_four_digits}`
                              : ""}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <p className="text-xs text-muted-foreground">
                          Fatura atual
                        </p>
                        <p className="text-lg font-semibold">
                          {formatarValor(
                            Math.abs(Number(conta.current_balance ?? 0))
                          )}
                        </p>
                      </div>

                      {conta.credit_limit != null && (
                        <p className="text-xs text-muted-foreground">
                          Limite {formatarValor(Number(conta.credit_limit))}
                        </p>
                      )}

                      {semDias ? (
                        <Badge
                          variant="outline"
                          className="border-warning/30 text-warning"
                        >
                          Falta fechamento e vencimento
                        </Badge>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Fecha dia {conta.closing_day} · vence dia{" "}
                          {conta.due_day}
                        </p>
                      )}

                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => abrirEdicao(conta)}
                        >
                          <Pencil className="mr-1 h-3 w-3" />
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => arquivar(conta)}
                        >
                          <Archive className="mr-1 h-3 w-3" />
                          Arquivar
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <ContasArquivadas contas={arquivadas} aoReativar={reativar} />

          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Conta corrente, poupança, dinheiro e cartão de débito ficam na
                  tela de Contas.
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard/contas">Ir para Contas</Link>
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Editar cartão" : "Novo cartão"}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={enviar} className="space-y-4">
            <CamposDaConta
              escopo="cartao"
              valores={form}
              aoMudar={setForm}
              editando={Boolean(form.id)}
              mostrarMoeda={preferenciaDeMoeda.porLancamento}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setAberto(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={salvando}>
                {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {form.id ? "Salvar" : "Criar cartão"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
