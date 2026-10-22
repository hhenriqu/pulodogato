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

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
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
import {
  Archive,
  CreditCard,
  Loader2,
  Pencil,
  Plus,
  Scale,
  Wallet,
} from "lucide-react";
import type { FinancialAccount } from "@/types/financial";
import {
  contasDoRecorte,
  porTipo,
  tipoDoRecorte,
  totalDoEscopo,
  valoresDaConta,
  valoresIniciais,
  type ValoresDaConta,
} from "@/lib/contas";
import { CamposDaConta } from "@/components/contas/CamposDaConta";
import { ContasArquivadas } from "@/components/contas/ContasArquivadas";
import { AjusteDeSaldoDaConta } from "@/components/contas/AjusteDeSaldoDaConta";
import { CarteiraDaContaDeInvestimento } from "@/components/contas/CarteiraDaContaDeInvestimento";
import { iconeDoTipo } from "@/components/contas/icone-da-conta";
import { useContas } from "@/lib/hooks/useContas";
import { useCarteiraPorConta } from "@/lib/hooks/useCarteiraPorConta";
import { carteiraDaConta } from "@/lib/carteira-na-tela";
import { formatarValor } from "@/lib/dinheiro";
import { diaLocalDe } from "@/lib/ajuste-de-saldo-da-conta";
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
import { usePreferenciaDeMoeda } from "@/lib/hooks/usePreferenciaDeMoeda";

/**
 * A tela le `?tipo=` com `useSearchParams` (HMO-423), e o `<Suspense>` e a
 * fronteira que o Next pede para o hook em rota estatica.
 *
 * ELE NAO E EXIGIDO HOJE -- medido: `next build` passa sem ele, porque o layout
 * do painel devolve um spinner enquanto `useAuth` carrega e nao renderiza o
 * `{children}`, entao o hook nunca roda na prerenderizacao. Fica pelo mesmo
 * motivo do `<Suspense>` que envolve o `Sidebar` naquele layout, que tem a
 * explicacao inteira: se um dia a casca do painel for pintada durante a carga,
 * esta fronteira e o que mantem a bailada para o cliente local a esta tela.
 *
 * O `fallback` e o MESMO spinner do estado "carregando" da tela, e nao um
 * esqueleto diferente: quem abre a tela ve um giro so, nao dois seguidos.
 */
export default function ContasPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-info" />
        </div>
      }
    >
      <TelaDeContas />
    </Suspense>
  );
}

function TelaDeContas() {
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

  // O RECORTE DA TELA (HMO-423): `null` e a tela inteira, e e onde cai tudo que
  // nao e tipo de conta valido -- ver `tipoDoRecorte`.
  const recorte = tipoDoRecorte(useSearchParams().get("tipo"));
  // O tipo que uma conta NOVA ganha nesta tela. No recorte e o tipo do recorte:
  // quem entrou por "Contas de Investimento" e clicou em "Nova conta" nao quer
  // que o formulario abra em "Conta corrente", cadastre a conta errada e ela
  // desapareca da lista que ele estava olhando.
  const tipoPadrao = (moeda?: string) => {
    const valores = valoresIniciais("conta", moeda);
    return recorte ? { ...valores, account_type: recorte } : valores;
  };

  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<ValoresDaConta>(() =>
    valoresIniciais("conta")
  );
  const online = useEstaOnline();
  // Decide se o seletor de moeda aparece nesta tela, e qual moeda uma conta
  // nova ganha por padrao. Ver lib/hooks/usePreferenciaDeMoeda.
  const { moeda: preferenciaDeMoeda } = usePreferenciaDeMoeda();

  // A LISTA DA TELA e o recorte das ativas -- sem recorte, as ativas inteiras.
  // As arquivadas passam pelo MESMO recorte: a gaveta de baixo mostrando contas
  // de outro tipo contradiria o titulo da tela.
  const contasDaTela = useMemo(
    () => contasDoRecorte(ativas, recorte),
    [ativas, recorte]
  );
  const arquivadasDaTela = useMemo(
    () => contasDoRecorte(arquivadas, recorte),
    [arquivadas, recorte]
  );

  // Saldo com SINAL: uma conta no vermelho tem que puxar o total para baixo.
  //
  // E O TOTAL DO QUE ESTA EM TELA, nao o das contas todas: no recorte o titulo
  // diz "Contas de Investimento" e o numero tem de ser o daquelas contas.
  // Somar as oito debaixo de um titulo que promete seis e o numero plausivel e
  // errado, que nenhuma inspecao visual pega.
  const saldo = useMemo(() => totalDoEscopo(contasDaTela, "conta"), [
    contasDaTela,
  ]);

  // -----------------------------------------------------------------------
  // A CARTEIRA ATRELADA A CADA CONTA DE INVESTIMENTO (HMO-438)
  // -----------------------------------------------------------------------
  // Desligado sem rede: a lista acima vem do catalogo do aparelho nesse estado,
  // e o catalogo nao guarda carteira. Ver o cabecalho do hook.
  const { carteira: carteiraPorConta } = useCarteiraPorConta(
    online && estado !== "sem-rede"
  );

  // O TOTAL DO TOPO CONTINUA SENDO A SOMA DOS SALDOS INFORMADOS, e isso e uma
  // escolha -- nao um esquecimento.
  //
  // `totalDoEscopo` e pura e tem suite que afirma um invariante entre TELAS
  // ("somar os dois escopos separados tem que dar o mesmo que a tela unica
  // somava junta"). Trocar o saldo pela carteira ali move esse invariante e a
  // soma de `/dashboard/cartoes` junto com ele, o que e trabalho de outra fase.
  //
  // O que NAO se pode fazer e deixar os dois numeros discordarem calados: o
  // cartao passa a mostrar a carteira e o total continua no saldo informado,
  // entao quem somar os cartoes a mao acha outro numero. A frase abaixo do total
  // e o que torna a diferenca legivel, e ela so aparece quando ha substituicao
  // de fato -- um aviso permanente ali e como se aprende a nao ler aviso nenhum.
  // Ver `duas-metades-certas-dobram-a-linha-sem-total-para-discordar`.
  const contasComCarteira = useMemo(
    () =>
      carteiraPorConta
        ? contasDaTela.filter((c) => carteiraDaConta(carteiraPorConta, c.id))
            .length
        : 0,
    [contasDaTela, carteiraPorConta]
  );

  // -----------------------------------------------------------------------
  // O AJUSTE DE SALDO DA CONTA: A FIACAO (HMO-409)
  // -----------------------------------------------------------------------
  // Mora aqui porque `AjusteDeSaldoDaConta` nao tem rede -- ele so chama
  // handlers. Ver o cabecalho dele.
  const [contaEmAjuste, setContaEmAjuste] = useState<FinancialAccount | null>(
    null
  );
  const [diaDoAjuste, setDiaDoAjuste] = useState("");
  const [conferindoAjuste, setConferindoAjuste] = useState(false);
  /** O GET respondeu? Enquanto for `false`, o bloco nao afirma nem oferece nada. */
  const [podeConferirAjuste, setPodeConferirAjuste] = useState(false);
  const [valorDoAjuste, setValorDoAjuste] = useState<number | null>(null);
  const [saldoSemAjuste, setSaldoSemAjuste] = useState<number | null>(null);
  const [saldoRealDaConta, setSaldoRealDaConta] = useState("");
  const [descricaoDoAjuste, setDescricaoDoAjuste] = useState("");
  const [salvandoAjuste, setSalvandoAjuste] = useState(false);

  /**
   * Abre o dialogo e pergunta ao servidor o que ja existe NAQUELE DIA.
   *
   * O CAMPO DE SALDO NASCE VAZIO. Preenche-lo com `current_balance` seria o
   * default obvio e colapsaria a feature: o campo ja viria com o numero que faz
   * a diferenca ser zero, e quem clicasse Salvar sem digitar REMOVERIA o ajuste
   * que estava valendo. O saldo real e o unico dado que so a pessoa tem.
   *
   * A DESCRICAO, sim, reabre com a que esta gravada: ela e texto do usuario, e
   * perde-la a cada alteracao obrigaria a redigitar o motivo do ajuste.
   */
  async function abrirAjuste(conta: FinancialAccount) {
    // O DIA SAI DO RELOGIO DO APARELHO. A chave canonica e a data do lancamento
    // sao "o dia em que a pessoa conferiu o saldo", e esse e o dia dela.
    // `diaLocalDe` le getFullYear/getMonth/getDate; `hojeISO()` de
    // lib/lancamento.ts corta a ISO, que e UTC, e das 21h em diante em Sao Paulo
    // dataria o ajuste em AMANHA -- uma chave de um dia que nao chegou, e um
    // ajuste a mais quando a pessoa conferisse de novo pela manha.
    const dia = diaLocalDe(new Date());

    setContaEmAjuste(conta);
    setDiaDoAjuste(dia);
    setSaldoRealDaConta("");
    setDescricaoDoAjuste("");
    setValorDoAjuste(null);
    setSaldoSemAjuste(null);
    setPodeConferirAjuste(false);
    setConferindoAjuste(true);

    try {
      const resposta = await fetch(
        `/api/financial-accounts/ajuste?account_id=${encodeURIComponent(
          conta.id
        )}&data=${dia}`
      );
      const dados = await resposta.json().catch(() => ({}));

      if (!resposta.ok) {
        toast.error(
          dados.error ||
            `Não foi possível conferir o ajuste (HTTP ${resposta.status}).`
        );
        return;
      }

      setValorDoAjuste(dados.ajuste ? Number(dados.ajuste.amount) : null);
      setSaldoSemAjuste(Number(dados.saldo_sem_ajuste));
      setDescricaoDoAjuste(dados.ajuste?.description ?? "");
      // POR ULTIMO, e so no caminho de sucesso: e este `true` que autoriza o
      // bloco a dizer "esta conta não tem ajuste" e a oferecer o formulario.
      setPodeConferirAjuste(true);
    } catch (erro) {
      console.error("Erro ao conferir o ajuste de saldo:", erro);
      toast.error("Não foi possível conferir o ajuste desta conta");
    } finally {
      setConferindoAjuste(false);
    }
  }

  async function salvarAjuste() {
    if (!contaEmAjuste) return;
    setSalvandoAjuste(true);
    try {
      const resposta = await fetch("/api/financial-accounts/ajuste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: contaEmAjuste.id,
          data: diaDoAjuste,
          // O UNICO DADO QUE A TELA MANDA: quanto a conta mostra hoje. A
          // diferenca e a direcao saem do servidor, sobre o saldo lido na hora
          // -- mandar a diferenca daqui a calcularia sobre o saldo que esta na
          // tela, que pode ter ficado velho (ver o cabecalho da rota).
          saldo_real: saldoRealDaConta,
          descricao: descricaoDoAjuste,
        }),
      });
      const dados = await resposta.json().catch(() => ({}));

      if (!resposta.ok) {
        toast.error(
          dados.error || `O ajuste foi recusado (HTTP ${resposta.status}).`
        );
        return;
      }

      // TRES DESFECHOS, TRES FRASES. A rota distingue "lancou a diferenca", "o
      // saldo ja batia e o ajuste saiu" e "o saldo ja batia e nao havia
      // ajuste"; um unico "Ajuste gravado" diria que gravou dinheiro nos dois
      // casos em que ela nao gravou nada -- inclusive no que ela APAGOU uma
      // linha.
      if (dados.fecha) {
        toast.success(
          dados.removido
            ? "O saldo já é esse — o ajuste anterior foi removido"
            : "O saldo já é esse — nada a ajustar"
        );
      } else {
        const diferenca = Number(dados.diferenca);
        toast.success(
          Number.isFinite(diferenca)
            ? `Ajuste de ${formatarValor(
                Math.abs(diferenca),
                contaEmAjuste.currency ?? undefined
              )} ${diferenca > 0 ? "lançado como entrada" : "lançado como saída"}`
            : "Ajuste de saldo gravado"
        );
      }

      setContaEmAjuste(null);
      // Recarrega a lista em vez de remendar o saldo na memoria: `current_balance`
      // e mantido por trigger, e um remendo aqui seria uma segunda conta do
      // mesmo numero -- livre para divergir do banco sem nada ficar vermelho.
      carregar();
    } catch (erro) {
      console.error("Erro ao gravar o ajuste de saldo:", erro);
      toast.error("Erro ao gravar o ajuste de saldo");
    } finally {
      setSalvandoAjuste(false);
    }
  }

  async function removerAjuste() {
    if (!contaEmAjuste) return;
    setSalvandoAjuste(true);
    try {
      const resposta = await fetch(
        `/api/financial-accounts/ajuste?account_id=${encodeURIComponent(
          contaEmAjuste.id
        )}&data=${diaDoAjuste}`,
        { method: "DELETE" }
      );
      const dados = await resposta.json().catch(() => ({}));

      if (!resposta.ok) {
        toast.error(
          dados.error || `Não foi possível remover (HTTP ${resposta.status}).`
        );
        return;
      }

      toast.success("Ajuste de saldo removido");
      setContaEmAjuste(null);
      carregar();
    } catch (erro) {
      console.error("Erro ao remover o ajuste de saldo:", erro);
      toast.error("Erro ao remover o ajuste de saldo");
    } finally {
      setSalvandoAjuste(false);
    }
  }

  function abrirNovo() {
    setForm(tipoPadrao(preferenciaDeMoeda.oficial));
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
      setForm(tipoPadrao());
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
          {/* O TITULO DIZ O RECORTE (HMO-423). Sem isto a tela de
              "Contas de Investimento" se chamaria "Contas" e mostraria seis de
              oito contas sem nada na tela explicando o que sumiu -- a lista
              recortada e indistinguivel de uma lista incompleta. */}
          <h1 className="text-2xl font-bold text-foreground">
            {recorte ? `Contas de ${porTipo(recorte).rotulo}` : "Contas"}
          </h1>
          {recorte ? (
            <p className="text-sm text-muted-foreground">
              Só as contas de {porTipo(recorte).rotulo.toLowerCase()}.{" "}
              <Link
                href="/dashboard/contas"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Ver todas as contas
              </Link>
              .
            </p>
          ) : (
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
          )}
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
          // `() => carregar(true)` -- O BOTAO QUE FURA O CACHE (HMO-477).
          //
          // `true` e o que faz dele um botao de verdade: a releitura sem o
          // parametro volta do MESMO cache (NetworkFirst, copia de sete dias),
          // com a mesma faixa e o mesmo momento -- a pessoa aperta "Atualizar"
          // e nada muda. Era o defeito da HMO-457, medido tambem aqui.
          //
          // E a seta nao e estilo: a faixa liga a prop direto no `onClick`,
          // entao `aoTentarDeNovo={carregar}` chamaria o handler COM o
          // `MouseEvent`. Um evento e verdadeiro, logo `semCopia` chegaria
          // truthy e TODA releitura (salvar, arquivar, reativar, que passam
          // pelo mesmo `carregar`) furaria o cache -- apagando a leitura
          // offline da tela sem ninguem ter pedido, e com a tela parecendo
          // certa.
          aoTentarDeNovo={() => carregar(true)}
        />
      )}

      {/*
        Sem dado, o painel SUBSTITUI o total e a lista -- nao acompanha. Um
        "R$ 0,00" ao lado de um aviso de sem conexao continua sendo um numero na
        tela, e numero na tela e lido.
      */}
      {estado === "sem-rede" ? (
        // SEM `true`, ao contrario da faixa: aqui nao ha copia no aparelho -- e
        // e justamente o que `sem-rede` significa -- entao nao ha cache para
        // furar, e a tentativa normal ja vai na rede. A seta continua sendo
        // obrigatoria, pelo `MouseEvent` do `onClick`.
        <PainelSemRede oQue="suas contas" aoTentarDeNovo={() => carregar()} />
      ) : estado === "erro-do-servidor" ? (
        // SEM `true` pelo motivo da linha de cima: o servidor RESPONDEU (500),
        // e resposta de erro nao vira copia no cache. Furar nao mudaria nada.
        <PainelErroDoServidor
          oQue="suas contas"
          aoTentarDeNovo={() => carregar()}
        />
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>
                {recorte
                  ? `Saldo somado das contas de ${porTipo(
                      recorte
                    ).rotulo.toLowerCase()}`
                  : "Saldo somado das contas"}
              </CardDescription>
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
            <CardContent className="space-y-1">
              <p className="text-xs text-muted-foreground">
                Cartão de crédito fica de fora: ele guarda o que foi gasto, não
                o que você tem.
              </p>
              {/* Ver o comentario de `contasComCarteira`, acima. */}
              {podeMostrarNumero(estado) && contasComCarteira > 0 && (
                <p
                  data-aviso="total-pelo-saldo-informado"
                  className="text-xs text-muted-foreground"
                >
                  Este total soma o <strong>saldo informado</strong> de cada
                  conta.{" "}
                  {contasComCarteira === 1
                    ? "Uma conta de investimento tem carteira atrelada e vale o que está no cartão dela"
                    : `${contasComCarteira} contas de investimento têm carteira atrelada e valem o que está no cartão delas`}{" "}
                  —{" "}
                  <Link
                    href="/dashboard/net-worth"
                    className="underline underline-offset-2 hover:text-foreground"
                  >
                    é esse valor que entra no patrimônio
                  </Link>
                  .
                </p>
              )}
            </CardContent>
          </Card>

          {contasDaTela.length === 0 && podeAfirmarVazio(estado) ? (
            <Card>
              <CardContent className="py-10 text-center">
                <Wallet className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
                <p className="font-medium text-foreground">
                  {recorte
                    ? `Você ainda não tem conta de ${porTipo(
                        recorte
                      ).rotulo.toLowerCase()}`
                    : "Você ainda não tem contas"}
                </p>
                <p className="mb-4 text-sm text-muted-foreground">
                  {recorte
                    ? "Cadastre uma para acompanhar o que você tem aplicado."
                    : "Cadastre sua conta corrente para começar a lançar."}
                </p>
                <Button onClick={abrirNovo} disabled={!online}>
                  <Plus className="mr-2 h-4 w-4" />
                  Cadastrar a primeira
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {contasDaTela.map((conta) => {
                const Icone = iconeDoTipo(conta.account_type);
                const saldoInformado = Number(conta.current_balance ?? 0);

                // A CARTEIRA DESTA CONTA, OU `null` (HMO-438).
                //
                // `null` nas duas situacoes que tem de ficar IDENTICAS ao
                // cartao de antes desta fase: conta que nao e de investimento,
                // e Conta Investimento sem nenhum ativo atrelado. Ver
                // `carteiraDaConta`.
                const daCarteira = carteiraPorConta
                  ? carteiraDaConta(carteiraPorConta, conta.id)
                  : null;

                // O NUMERO GRANDE: a carteira quando ela substitui o saldo
                // (Decisao 1A da Fase 3), o saldo informado quando nao.
                //
                // Trocar o headline NAO e enfeite -- e o que impede o cartao de
                // anunciar como "Saldo" um numero que nao conta mais em lugar
                // nenhum. O rotulo muda junto, senao os dois estados ficam
                // indistinguiveis (`sumido-da-tela-pode-ser-so-indistinguivel`).
                const valor = daCarteira ? daCarteira.valor : saldoInformado;

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
                        {/* "FORA DOS TOTAIS" AO LADO DO ROTULO (HMO-431).
                            Sem este aviso, a conta desligada aparece na lista
                            com o saldo dela e NAO aparece no "Saldo total" do
                            topo -- quem somasse as contas a mao acharia outro
                            numero e concluiria que o total esta errado. O
                            marcador e o que torna a diferenca legivel em vez de
                            parecer defeito.

                            `=== false` E NAO `!...`: conta vinda do cache
                            offline de antes da 058 nao tem o campo, e um
                            `!conta.include_in_total` marcaria TODAS elas como
                            fora dos totais -- justamente quando a tela nao tem
                            rede para conferir. */}
                        <p className="text-xs text-muted-foreground">
                          {/* O ROTULO DIZ DE ONDE O NUMERO VEIO (HMO-438).
                              "Saldo" para o saldo informado, "Saldo · pela
                              carteira" quando a carteira atrelada substituiu
                              ele. Sem a distincao, duas contas de investimento
                              com o mesmo numero na tela -- uma pela carteira e
                              outra pelo digitado -- ficam identicas, e o
                              `data-origem` abaixo e o que a sonda le para
                              provar que nao ficaram. */}
                          Saldo
                          {daCarteira ? (
                            <span className="ml-1">· pela carteira</span>
                          ) : null}
                          {conta.include_in_total === false ? (
                            <span className="ml-1 text-warning">
                              · fora dos totais
                            </span>
                          ) : null}
                        </p>
                        <p
                          data-origem={
                            daCarteira ? "carteira" : "saldo_informado"
                          }
                          className={`text-lg font-semibold ${
                            valor < 0 ? "text-destructive" : ""
                          }`}
                        >
                          {formatarValor(valor)}
                        </p>
                      </div>

                      {/* AS TRES LINHAS (HMO-438). Devolve `null` para toda
                          conta sem carteira atrelada -- ver o componente. */}
                      <CarteiraDaContaDeInvestimento
                        carteira={daCarteira}
                        saldoInformado={saldoInformado}
                        atualizadaEm={conta.updated_at}
                        moeda={conta.currency ?? undefined}
                        rendimentoIndisponivel={
                          carteiraPorConta?.rendimentoIndisponivel
                        }
                      />

                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => abrirEdicao(conta)}
                        >
                          <Pencil className="mr-1 h-3 w-3" />
                          Editar
                        </Button>
                        {/* O AJUSTE E ACAO DE LINHA, e nao campo do dialogo de
                            edicao: a lista de Contas nao tem pagina de detalhe,
                            e o formulario de edicao grava cadastro (nome, tipo,
                            banco) -- um campo de saldo no meio dele pareceria
                            cadastro tambem, e "corrigir o saldo" nao e editar a
                            conta: e lancar um movimento datado. Precisa de rede
                            na abertura (o GET do ajuste do dia), entao fica
                            apagado sem ela, como o botao de nova conta. */}
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => abrirAjuste(conta)}
                          disabled={!online}
                        >
                          <Scale className="mr-1 h-3 w-3" />
                          Ajustar saldo
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

          <ContasArquivadas contas={arquivadasDaTela} aoReativar={reativar} />

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

      {/* O DIALOGO DO AJUSTE. O `<Dialog>` fica aqui e nao dentro do
          componente, para o teste poder renderizar o formulario de verdade com
          `react-dom/server` -- o `DialogContent` do Radix vive atras de um
          portal e nao sai no HTML do servidor. */}
      <Dialog
        open={contaEmAjuste !== null}
        onOpenChange={(aberta) => {
          if (!aberta) setContaEmAjuste(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Ajustar saldo{contaEmAjuste ? ` · ${contaEmAjuste.name}` : ""}
            </DialogTitle>
          </DialogHeader>

          {contaEmAjuste &&
            (conferindoAjuste ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-info" />
              </div>
            ) : (
              <AjusteDeSaldoDaConta
                nomeDaConta={contaEmAjuste.name}
                data={diaDoAjuste}
                moeda={contaEmAjuste.currency ?? undefined}
                estado={estado}
                podeConferir={podeConferirAjuste}
                valorAtual={valorDoAjuste}
                saldoSemAjuste={saldoSemAjuste}
                saldoReal={saldoRealDaConta}
                descricao={descricaoDoAjuste}
                salvando={salvandoAjuste}
                aoMudarSaldoReal={setSaldoRealDaConta}
                aoMudarDescricao={setDescricaoDoAjuste}
                aoSalvar={salvarAjuste}
                aoRemover={removerAjuste}
                aoFechar={() => setContaEmAjuste(null)}
              />
            ))}
        </DialogContent>
      </Dialog>

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
                {form.id ? "Salvar" : "Criar conta"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
