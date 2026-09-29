"use client";

// ---------------------------------------------------------------------------
// CONTAS (HMO-166)
// ---------------------------------------------------------------------------
// Metade da tela que era "Contas e Cartões". Aqui esta o que tem SALDO: conta
// corrente, poupanca, dinheiro, carteira digital, conta de investimento, cartao
// de debito e "outra". Cartao de credito esta em `/dashboard/cartoes`, porque
// ele nao tem saldo -- tem fatura, limite e uma divida que cresce.
//
// O que sumiu daqui, e e o ponto da issue: limite, dia de fechamento e dia de
// vencimento. Eles nao estao escondidos atras de uma condicao nesta tela; eles
// nao existem nela. Quem cadastra uma conta corrente nao ve mais tres campos de
// cartao aparecerem e sumirem conforme troca o tipo.
//
// ESTA TELA ABRE SEM REDE (herdado da HMO-145). O pedagio esta pago: todo total
// passa por `podeMostrarNumero()`, a frase de vazio exige `podeAfirmarVazio()`
// e o botao que precisa de rede fica apagado sem ela. Sem isso a tela imprimiria
// "Saldo somado das contas R$ 0,00" para quem tem seis contas -- o zero
// confiante, que e pior que numero nenhum. Ver `lib/offline-leitura.ts`.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
  porTipo,
  totalDoEscopo,
  valoresDaConta,
  valoresIniciais,
  type ValoresDaConta,
} from "@/lib/contas";
import { CamposDaConta } from "@/components/contas/CamposDaConta";
import { ContasArquivadas } from "@/components/contas/ContasArquivadas";
import { iconeDoTipo } from "@/components/contas/icone-da-conta";
import { useContas } from "@/lib/hooks/useContas";
import { formatarValor } from "@/lib/dinheiro";
import {
  podeAfirmarVazio,
  podeMostrarNumero,
} from "@/lib/offline-leitura";
import {
  FaixaDadoDoAparelho,
  NumeroIndisponivel,
  PainelErroDoServidor,
  PainelSemRede,
} from "@/components/SemRede";
import { useEstaOnline } from "@/lib/hooks/useEstaOnline";

export default function ContasPage() {
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
  } = useContas("conta");

  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<ValoresDaConta>(() =>
    valoresIniciais("conta")
  );
  const online = useEstaOnline();

  // Saldo com SINAL: uma conta no vermelho tem que puxar o total para baixo.
  const saldo = useMemo(() => totalDoEscopo(ativas, "conta"), [ativas]);

  function abrirNovo() {
    setForm(valoresIniciais("conta"));
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
      setForm(valoresIniciais("conta"));
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
          <h1 className="text-2xl font-bold text-foreground">Contas</h1>
          <p className="text-sm text-muted-foreground">
            Onde seu dinheiro fica.{" "}
            <Link
              href="/dashboard/cartoes"
              className="underline underline-offset-2 hover:text-foreground"
            >
              Cartões de crédito ficam em outra tela
            </Link>
            .
          </p>
        </div>
        {/*
          Sem rede o envio falharia no fim. Deixar a pessoa preencher nome e
          banco para perder tudo no botao Salvar e pior que dizer antes.
        */}
        <Button onClick={abrirNovo} disabled={!online}>
          <Plus className="mr-2 h-4 w-4" />
          {online ? "Nova conta" : "Nova conta (precisa de rede)"}
        </Button>
      </div>

      {estado === "do-aparelho" && (
        <FaixaDadoDoAparelho
          guardadoEm={guardadoEm}
          soLeitura
          aoTentarDeNovo={carregar}
        />
      )}

      {/*
        Sem dado, o painel SUBSTITUI o total e a lista -- nao acompanha. Um
        "R$ 0,00" ao lado de um aviso de sem conexao continua sendo um numero na
        tela, e numero na tela e lido.
      */}
      {estado === "sem-rede" ? (
        <PainelSemRede oQue="suas contas" aoTentarDeNovo={carregar} />
      ) : estado === "erro-do-servidor" ? (
        <PainelErroDoServidor oQue="suas contas" aoTentarDeNovo={carregar} />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Saldo somado das contas</CardDescription>
              <CardTitle
                className={`text-2xl ${
                  podeMostrarNumero(estado) && saldo < 0
                    ? "text-destructive"
                    : ""
                }`}
              >
                {podeMostrarNumero(estado) ? (
                  formatarValor(saldo)
                ) : (
                  <NumeroIndisponivel />
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                Cartão de crédito fica de fora: ele guarda o que foi gasto, não
                o que você tem.
              </p>
            </CardContent>
          </Card>

          {ativas.length === 0 && podeAfirmarVazio(estado) ? (
            <Card>
              <CardContent className="py-10 text-center">
                <Wallet className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="font-medium text-foreground">
                  Você ainda não tem contas
                </p>
                <p className="mb-4 text-sm text-muted-foreground">
                  Cadastre sua conta corrente para começar a lançar.
                </p>
                <Button onClick={abrirNovo} disabled={!online}>
                  <Plus className="mr-2 h-4 w-4" />
                  Cadastrar a primeira
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {ativas.map((conta) => {
                const Icone = iconeDoTipo(conta.account_type);
                const valor = Number(conta.current_balance ?? 0);

                return (
                  <Card key={conta.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className="flex h-9 w-9 items-center justify-center rounded-md"
                          style={{ backgroundColor: `${conta.color_hex}20` }}
                        >
                          <Icone
                            className="h-4 w-4"
                            style={{ color: conta.color_hex }}
                          />
                        </span>
                        <div>
                          <CardTitle className="text-base">
                            {conta.name}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            {porTipo(conta.account_type).rotulo}
                            {conta.bank_name ? ` · ${conta.bank_name}` : ""}
                            {conta.last_four_digits
                              ? ` · ••${conta.last_four_digits}`
                              : ""}
                          </CardDescription>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Saldo</p>
                        <p
                          className={`text-lg font-semibold ${
                            valor < 0 ? "text-destructive" : ""
                          }`}
                        >
                          {formatarValor(valor)}
                        </p>
                      </div>

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

          {/*
            A porta para a outra metade. Sem isto, quem cadastrou as contas e
            procura onde cadastrar o cartao so tem o menu -- e a tela que ele
            acabou de usar chamava-se "Contas e Cartões".
          */}
          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Cartão de crédito tem fatura, limite e vencimento: ele se
                  cadastra na tela de Cartões.
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard/cartoes">Ir para Cartões</Link>
              </Button>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{form.id ? "Editar conta" : "Nova conta"}</DialogTitle>
          </DialogHeader>

          <form onSubmit={enviar} className="space-y-4">
            <CamposDaConta
              escopo="conta"
              valores={form}
              aoMudar={setForm}
              editando={Boolean(form.id)}
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
                {form.id ? "Salvar" : "Criar conta"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
