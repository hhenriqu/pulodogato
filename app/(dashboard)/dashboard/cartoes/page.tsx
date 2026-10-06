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
//
// DUAS LEITURAS, UM ESTADO (HMO-290)
// ----------------------------------
// "Faturas em aberto" somava `totalDoEscopo(ativas, "cartao")`, que e
// `Σ abs(current_balance)` -- a divida INTEIRA de cada cartao. Uma compra de
// R$ 3.000 em 10x inflava este total em R$ 2.700 no mes da compra. O total
// agora e a soma das FATURAS do mes escolhido, e isso custou duas coisas:
//
//   1. a tela passou a fazer DUAS chamadas (o cadastro, por `useContas`, e as
//      faturas, por `GET /api/card-invoices?month=`). `estadoDaTela` reduz as
//      duas a mais pessimista ANTES de qualquer numero aparecer -- senao o
//      cadastro fresco libera o total de faturas que nao carregaram, e a tela
//      imprime "R$ 0,00" embaixo do nome de cada cartao certo;
//   2. a tela ganhou um SELETOR DE MES. "A fatura do periodo" exige dizer qual
//      periodo, e aqui nao havia periodo nenhum. E o mesmo `<input type=month>`
//      da tela de um cartao, de proposito: duas telas que respondem sobre a
//      mesma fatura escolhem o mes do mesmo jeito.
//
// `lib/contas.ts:totalDoEscopo` NAO foi tocada, e isso e deliberado: quem
// mudou foi o chamador. O teste dela afirma que separar as telas de Contas e
// Cartoes nao move um centavo, e aquela afirmacao continua valendo -- a tela de
// Contas segue somando saldo com sinal, que e o que o rotulo DELA promete.
// Saldo e saldo; so o rotulo que promete fatura trocou de fonte.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { CreditCard, Loader2, Plus, Wallet } from "lucide-react";
import type { CardInvoice, FinancialAccount } from "@/types/financial";
import {
  faltaFatura,
  valoresDaConta,
  valoresIniciais,
  type ValoresDaConta,
} from "@/lib/contas";
import { CamposDaConta } from "@/components/contas/CamposDaConta";
import { CartaoDaLista } from "@/components/cartoes/CartaoDaLista";
import { ContasArquivadas } from "@/components/contas/ContasArquivadas";
import { useContas } from "@/lib/hooks/useContas";
import { formatarValor } from "@/lib/dinheiro";
import { Label } from "@/components/ui/label";
import {
  estadoDaTela,
  faturaDoCartao,
  mesCorrenteDaFatura,
  rotuloDaFatura,
} from "@/lib/fatura-do-cartao";
import {
  somaDasFaturas,
  somaDasParcelasFuturas,
} from "@/lib/fatura-do-periodo";
import {
  buscarLeitura,
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
import { usePreferenciaDeMoeda } from "@/lib/hooks/usePreferenciaDeMoeda";

export default function CartoesPage() {
  const {
    ativas,
    arquivadas,
    carregando,
    salvando,
    estado: estadoDasContas,
    guardadoEm,
    carregar: recarregarContas,
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

  // ---------------------------------------------------------------------
  // A SEGUNDA LEITURA: AS FATURAS DO MES (HMO-290)
  // ---------------------------------------------------------------------
  const [mes, setMes] = useState(() => mesCorrenteDaFatura());
  const [faturas, setFaturas] = useState<CardInvoice[] | null>(null);
  const [estadoDasFaturas, setEstadoDasFaturas] =
    useState<EstadoDaLeitura | null>(null);

  const carregarFaturas = useCallback(async () => {
    setEstadoDasFaturas(null);

    // SEM `account_id`: aqui se quer a fatura de TODOS os cartoes do mes. A
    // rota devolve uma entrada por cartao ativo, zerada quando o mes nao teve
    // compra -- e por isso um cartao AUSENTE da resposta nao e zero, e um
    // numero que esta tela nao obteve. Ver `lib/fatura-do-periodo`.
    const leitura = await buscarLeitura<{ invoices?: CardInvoice[] }>(
      `/api/card-invoices?month=${mes}`
    );

    setEstadoDasFaturas(leitura.estado);
    // So sobrescreve quando houve corpo: zerar no caminho de falha apagaria da
    // tela a fatura que uma busca anterior ja trouxe -- mesma regra do
    // `useContas` e da tela de um cartao.
    if (leitura.dados) setFaturas(leitura.dados.invoices ?? []);
  }, [mes]);

  useEffect(() => {
    carregarFaturas();
  }, [carregarFaturas]);

  // A mais PESSIMISTA das duas. Sem isto o cadastro fresco libera o total de
  // uma leitura de faturas que falhou.
  const estado = estadoDaTela([estadoDasContas, estadoDasFaturas]);

  const recarregar = useCallback(() => {
    recarregarContas();
    carregarFaturas();
  }, [recarregarContas, carregarFaturas]);

  const rotuloDoMes = rotuloDaFatura(mes);
  const idsAtivos = useMemo(() => ativas.map((c) => c.id), [ativas]);

  // `null` quando falta a fatura de qualquer cartao da lista: uma soma parcial
  // sob o rotulo "Faturas em aberto" e um numero menor que o certo, plausivel,
  // e sem nada na tela dizendo que falta uma parcela dela.
  const fatura = useMemo(
    () => somaDasFaturas(faturas, idsAtivos),
    [faturas, idsAtivos]
  );
  const parcelasFuturas = useMemo(
    () => somaDasParcelasFuturas(faturas, idsAtivos),
    [faturas, idsAtivos]
  );

  const semDiasDeFatura = useMemo(
    () => ativas.filter((c) => faltaFatura(c)).length,
    [ativas]
  );

  // As TRES condicoes do numero -- ver o mesmo trio em `CartaoDaLista`.
  const mostraTotal =
    podeMostrarNumero(estado) && rotuloDoMes !== null && fatura !== null;

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

      {/* OS PAINEIS DE FALHA OLHAM O CADASTRO, E NAO AS DUAS LEITURAS.
          A distincao e o que mantem a promessa do cabecalho ("esta tela abre
          sem rede"): a LISTA de cartoes vem do cadastro, que o service worker
          guarda. Trocar isto pelo estado combinado derruba a tela inteira para
          "sem conexao" quando so a fatura faltou -- e a fatura de um mes que a
          pessoa nunca abriu online nao esta guardada em lugar nenhum, entao
          mexer no seletor offline apagaria a lista de cartoes da tela.

          Os NUMEROS, esses sim, passam pelo estado combinado (`mostraTotal`):
          quem nao pode afirmar o total e quem nao leu a fatura. */}
      {estadoDasContas === "do-aparelho" && (
        <FaixaDadoDoAparelho
          guardadoEm={guardadoEm}
          soLeitura
          aoTentarDeNovo={recarregar}
        />
      )}

      {estadoDasContas === "sem-rede" ? (
        <PainelSemRede oQue="seus cartões" aoTentarDeNovo={recarregar} />
      ) : estadoDasContas === "erro-do-servidor" ? (
        <PainelErroDoServidor oQue="seus cartões" aoTentarDeNovo={recarregar} />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              {/* O SELETOR E O TOTAL NO MESMO BLOCO: e o seletor que diz a que
                  mes o total responde. Mesma disposicao de `FaturaDoCartao`. */}
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <CardDescription>
                    {rotuloDoMes
                      ? `Faturas de ${rotuloDoMes}`
                      : "Faturas do mês"}
                  </CardDescription>
                  <CardTitle className="text-2xl text-warning">
                    {mostraTotal ? (
                      formatarValor(fatura)
                    ) : (
                      <NumeroIndisponivel />
                    )}
                  </CardTitle>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="mes-das-faturas" className="text-xs">
                    Mês da fatura
                  </Label>
                  {/* `type="month"` e nao o campo de data nativo: o que se
                      escolhe aqui e o MES da fatura, e ele e o mesmo controle
                      que a tela de um cartao usa. */}
                  <input
                    id="mes-das-faturas"
                    type="month"
                    value={mes}
                    onChange={(evento) => setMes(evento.target.value)}
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                O que os cartões ativos cobram no mês escolhido. Não entra no
                saldo: é dívida, não dinheiro que você tem.
              </p>

              {/* O QUE AS PARCELAS AINDA VAO COBRAR (HMO-290).
                  Antes desta troca o total exagerava a fatura somando a divida
                  inteira; sem esta linha ele passaria a esconder o que ja esta
                  comprometido. Ela e secundaria e NAO soma com o total acima. */}
              {mostraTotal &&
                parcelasFuturas !== null &&
                parcelasFuturas > 0 && (
                  <p className="text-xs text-muted-foreground">
                    + {formatarValor(parcelasFuturas)} em parcelas que vencem
                    nos meses seguintes.
                  </p>
                )}
              {/*
                O contador so aparece quando ha numero para mostrar. Sem dado
                confiavel, "1 cartão sem fechamento" seria uma afirmacao sobre
                uma lista que a tela nao conseguiu ler.
              */}
              {/* O contador fala da LISTA de cartoes, nao da fatura: quem o
                  libera e o cadastro. Amarra-lo ao estado combinado esconderia
                  "1 cartão ainda não fecha fatura" -- um aviso de CADASTRO --
                  porque a fatura de outro mes nao carregou. */}
              {podeMostrarNumero(estadoDasContas) && semDiasDeFatura > 0 && (
                <p className="text-xs text-warning">
                  {semDiasDeFatura === 1
                    ? "1 cartão ainda não fecha fatura: falta o fechamento ou o vencimento."
                    : `${semDiasDeFatura} cartões ainda não fecham fatura: falta o fechamento ou o vencimento.`}
                </p>
              )}
            </CardContent>
          </Card>

          {/* "Voce ainda nao tem cartoes" e uma afirmacao sobre o CADASTRO.
              Pedi-la ao estado combinado faria a tela esconder o convite de
              cadastrar porque a leitura de faturas falhou -- e quem nao tem
              cartao nenhum tambem nao tem fatura para ler. */}
          {ativas.length === 0 && podeAfirmarVazio(estadoDasContas) ? (
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
              {/* O card inteiro e link para os gastos do cartao. Editar e
                  Arquivar ficam FORA da area clicavel -- ver o cabecalho de
                  CartaoDaLista: dentro dela, arquivar um cartao tambem
                  navegava. */}
              {ativas.map((conta) => (
                <CartaoDaLista
                  key={conta.id}
                  conta={conta}
                  // `faturaDoCartao` casa por `account_id`, nunca `[0]`: ver a
                  // decisao 1 de `lib/fatura-do-cartao.ts`. Com `[0]` a lista
                  // mostraria o total do primeiro cartao embaixo do nome de
                  // todos eles -- valores plausiveis, sem erro nenhum.
                  fatura={faturaDoCartao(faturas, conta.id)}
                  estado={estado}
                  rotuloDoMes={rotuloDoMes}
                  aoEditar={abrirEdicao}
                  aoArquivar={arquivar}
                />
              ))}
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
