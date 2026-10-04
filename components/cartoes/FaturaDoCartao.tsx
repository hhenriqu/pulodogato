"use client";

// ---------------------------------------------------------------------------
// OS GASTOS DE UM CARTAO, NUM MES (HMO-210)
// ---------------------------------------------------------------------------
// Componente sem `fetch` e sem hook de dados, pelo mesmo motivo que
// `CamposDeLancamento`: so assim o teste renderiza a tela de verdade com
// `react-dom/server` e afirma sobre o HTML que sai. E o defeito que esta tela
// pode ter e de marcacao, nao de calculo -- uma lista que mostra os gastos do
// cartao certo, com os valores certos, embaixo do nome do cartao errado passa
// verde em qualquer teste de funcao pura.
//
// DUAS COISAS QUE A TELA NAO PODE FAZER
// -------------------------------------
//   1. Imprimir total sem ter conseguido ler. Todo numero passa por
//      `podeMostrarNumero()`, e o estado vem de `estadoDaTela()` -- a mais
//      pessimista das DUAS leituras da pagina.
//   2. Dizer "nenhum gasto neste cartao" sem ter conseguido ler. A frase de
//      vazio passa por `podeAfirmarVazio()`, que exige resposta do servidor
//      agora. Com dado do aparelho a lista pode estar vazia por ser copia de
//      antes da compra.
//
// E O ROTULO DO MES ANDA JUNTO DO TOTAL, de proposito. "R$ 1.240,00" sozinho
// num cartao nao diz de que mes ele e, e o seletor fica a um bloco de
// distancia: o numero certo respondendo uma pergunta que o leitor nao sabe
// qual e. Quando o rotulo nao da para montar, o total tambem nao aparece.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArrowLeft, CreditCard, Plus, Receipt, Trash2 } from "lucide-react";
import type { FinancialAccount } from "@/types/financial";
import type { CardInvoice } from "@/types/financial";
import { formatarValor } from "@/lib/dinheiro";
import {
  podeAfirmarVazio,
  podeMostrarNumero,
  type EstadoDaLeitura,
} from "@/lib/offline-leitura";
import {
  caminhoDeNovoGasto,
  caminhoDoCartao,
  gastosDaFatura,
  previsoesDoCartao,
  rotuloDaFatura,
  rotuloDoCiclo,
} from "@/lib/fatura-do-cartao";
import { comOrigem } from "@/lib/retorno-do-lancamento";
import { rotuloDaParcela } from "@/lib/lancamento";
import {
  ehLinhaDeAjuste,
  type CategoriaDeAjuste,
} from "@/lib/ajuste-de-fatura";
import { NumeroIndisponivel } from "@/components/SemRede";

interface FaturaDoCartaoProps {
  conta: FinancialAccount;
  /** `null` = a rota nao trouxe fatura para este cartao neste mes. */
  fatura: CardInvoice | null;
  /** 'AAAA-MM' -- o que esta no seletor. */
  mes: string;
  /** A mais pessimista das leituras da pagina. `null` = ainda carregando. */
  estado: EstadoDaLeitura | null;
  aoMudarMes: (mes: string) => void;
  /**
   * Pedir para apagar uma parcela (HMO-228).
   *
   * OPCIONAL, e por isso este componente continua sem rede: a pagina passa o
   * handler, abre a pergunta do alcance e fala com
   * `/api/financial-installments/serie/{id}`. Sem ele, o botao nao aparece --
   * entao o teste de render de servidor continua montando a tela inteira sem
   * precisar de nada que mexa em dinheiro.
   */
  aoApagarParcela?: (gasto: LinhaDaFatura) => void;
  /**
   * A categoria reservada do ajuste de saldo (HMO-253), como
   * `GET /api/card-invoices` a devolve em `adjustment_category_id`.
   *
   * `undefined` = nao deu para conferir. A linha do ajuste fica sem o rotulo
   * "Ajuste" nesse caso, que e o melhor que a tela pode fazer sem saber qual
   * linha e -- carimbar o rotulo por adivinhacao chamaria de ajuste a compra de
   * alguem.
   */
  categoriaDeAjuste?: CategoriaDeAjuste;
  /**
   * O bloco de ajuste de saldo, como SLOT.
   *
   * Nao sao props de formulario repassadas uma a uma de proposito: o ajuste tem
   * oito pedacos de estado (aberto, valor, direcao, descricao, salvando...) e
   * atravessa-los por aqui faria desta tela um intermediario que nao usa nada do
   * que recebe -- e cada campo novo mexeria em tres arquivos. Quem monta o bloco
   * e a pagina, que e quem tem a rede; este componente so o posiciona, logo
   * abaixo do total que o ajuste explica.
   */
  blocoDeAjuste?: ReactNode;
}

/**
 * A linha da fatura que o botao de apagar precisa identificar.
 *
 * Declarada aqui e nao importada de `CardInvoice` porque o que interessa e o
 * subconjunto: o id para a rota e o par da 035 para saber se a linha e parcela.
 */
type LinhaDaFatura = {
  transaction_id: string;
  description: string;
  installment_number?: number | null;
  installment_total?: number | null;
};

/** '2026-10-14' -> '14/10'. Sem `new Date()`: a ISO seria lida como UTC e, no
 *  Brasil, voltaria um dia. */
const diaEMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function FaturaDoCartao({
  conta,
  fatura,
  mes,
  estado,
  aoMudarMes,
  aoApagarParcela,
  categoriaDeAjuste,
  blocoDeAjuste,
}: FaturaDoCartaoProps) {
  /**
   * A tela do cartao, para o modal de lancamento voltar para a fatura (HMO-249).
   *
   * Montada por `caminhoDoCartao`, e NAO por `useOrigemDaTela`: esta rota nao
   * tem query que importe (o mes da fatura vive em estado, nao na URL), e
   * `useSearchParams` dentro dela exigiria um `<Suspense>` novo em
   * `cartoes/[id]` -- um limite de suspensao a mais para carregar uma query
   * vazia. O mes NAO entra de proposito: quem lanca um gasto quer ver a fatura
   * em que ele caiu, que `card_invoice_month()` decide, e nao necessariamente o
   * mes que estava na tela.
   */
  const origem = caminhoDoCartao(conta.id);
  const gastos = gastosDaFatura(fatura, conta.id);
  // `null` = a leitura daquele bloco falhou. Diferente de `[]`, que e "nenhuma".
  const previsoes = previsoesDoCartao(fatura, conta.id);
  const rotuloDoMes = rotuloDaFatura(mes);
  const ciclo = rotuloDoCiclo(conta);
  // O total so aparece com dado atras dele E com mes para nomear: o rotulo e o
  // eixo de tempo do numero.
  const mostraTotal = podeMostrarNumero(estado) && rotuloDoMes !== null;

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
          <Link href="/dashboard/cartoes">
            <ArrowLeft className="mr-1 h-4 w-4" />
            Cartões
          </Link>
        </Button>

        <div className="flex flex-wrap items-center gap-3">
          <span
            className="flex h-10 w-10 items-center justify-center rounded-md"
            style={{ backgroundColor: `${conta.color_hex}20` }}
          >
            <CreditCard
              className="h-5 w-5"
              style={{ color: conta.color_hex }}
            />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{conta.name}</h1>
            <p className="text-sm text-muted-foreground">
              {conta.bank_name || "Cartão de crédito"}
              {conta.last_four_digits ? ` · ••${conta.last_four_digits}` : ""}
            </p>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------
          O cabecalho: limite e ciclo. Os dois vem do CADASTRO do cartao, nao
          da fatura -- por isso aparecem mesmo quando a fatura nao carregou.
          ------------------------------------------------------------------ */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-3 py-4">
          <div>
            <p className="text-xs text-muted-foreground">Limite</p>
            <p className="font-semibold">
              {conta.credit_limit != null
                ? formatarValor(Number(conta.credit_limit), conta.currency)
                : "não informado"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fatura</p>
            {ciclo ? (
              <p className="font-semibold">{ciclo}</p>
            ) : (
              <Badge
                variant="outline"
                className="border-warning/30 text-warning"
              >
                Falta fechamento e vencimento
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------
          O seletor do mes e o total, no MESMO bloco: e o rotulo que diz a que
          mes o total responde.
          ------------------------------------------------------------------ */}
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>
            {rotuloDoMes
              ? `Gastos de ${rotuloDoMes}`
              : "Gastos da fatura"}
          </CardDescription>
          <CardTitle className="text-2xl text-warning">
            {mostraTotal ? (
              formatarValor(Number(fatura?.total ?? 0), conta.currency)
            ) : (
              <NumeroIndisponivel />
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="space-y-1">
              <Label htmlFor="mes-da-fatura" className="text-xs">
                Mês da fatura
              </Label>
              <Input
                id="mes-da-fatura"
                type="month"
                value={mes}
                onChange={(evento) => aoMudarMes(evento.target.value)}
                className="w-44"
              />
            </div>
            {/* So no cartao ATIVO. `disabled` num `asChild` viraria atributo de
                `<a>`, que o navegador ignora: o botao ficaria cinza e
                continuaria navegando. */}
            {conta.is_active && (
              <Button asChild>
                <Link href={comOrigem(caminhoDeNovoGasto(conta.id), origem)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Lançar gasto neste cartão
                </Link>
              </Button>
            )}
          </div>

          {/* A data de vencimento sai da PROPRIA fatura (invoice_due_date), e
              nao de uma conta em cima do due_day: quem sabe em que dia a fatura
              daquele mes vence e card_invoice_due_date(), no banco. */}
          {podeMostrarNumero(estado) && fatura?.due_date && (
            <p className="text-xs text-muted-foreground">
              Vence em {diaEMes(fatura.due_date)}.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------
          O AJUSTE DE SALDO (HMO-253), logo abaixo do total.

          Aqui e nao no fim da tela porque e o total acima que ele explica: "a
          fatura do app fecha em R$ 1.240 e a do banco diz R$ 1.290" e uma
          pergunta que se faz olhando o numero, e a resposta tem de estar ao
          lado dele.
          ------------------------------------------------------------------ */}
      {blocoDeAjuste}

      {/* ------------------------------------------------------------------
          A lista.
          ------------------------------------------------------------------ */}
      {gastos.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {gastos.length === 1
                ? "1 gasto nesta fatura"
                : `${gastos.length} gastos nesta fatura`}
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {gastos.map((gasto) => (
              <div
                key={gasto.transaction_id}
                className="flex items-center justify-between gap-3 px-6 py-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate font-medium text-foreground">
                    {gasto.description}
                    {/* O ROTULO DO AJUSTE (HMO-253). A linha fica na lista para
                        a soma das linhas fechar com o total impresso em cima
                        delas -- tira-la deixaria as compras somando R$ 1.240
                        embaixo de um total de R$ 1.290, as duas corretas, e
                        nada explicando a diferenca.

                        Mas sem rotulo ela e indistinguivel de uma compra: um
                        "Ajuste de saldo da fatura" de R$ 50 que o usuario pode
                        reescrever (a descricao e editavel) vira, tres meses
                        depois, uma compra de R$ 50 que ninguem reconhece. O
                        rotulo sai da CATEGORIA reservada, nao da descricao --
                        mesma razao de `rotuloDaParcela` sair das colunas. */}
                    {ehLinhaDeAjuste(gasto, categoriaDeAjuste) ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-info/30 text-info"
                      >
                        Ajuste
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {/* "parcela 3 de 10" (HMO-211, migration 035)

                        E AQUI QUE O PARCELAMENTO PASSA A EXISTIR NA TELA. Antes
                        da 035 as parcelas iam para `transaction_installments`,
                        que nao tem leitor nenhum: a compra em 10x era gravada e
                        desaparecia de Lancamentos, de Contas a Pagar e da
                        fatura. Agora cada parcela e uma compra no cartao, no mes
                        da fatura dela, e esta linha e o rotulo que diz qual.

                        O rotulo sai das COLUNAS, nao da descricao. A descricao
                        gravada e "Notebook (3/10)" e o usuario pode reescreve-la
                        -- e o sintoma de depender dela seria o rotulo sumir de
                        uma parcela e continuar na vizinha, na mesma fatura.

                        O rotulo SUBSTITUI a data em vez de acompanha-la, e isso
                        e deliberado: a `transaction_date` das parcelas futuras e
                        o primeiro dia do mes da fatura, nao um dia que a pessoa
                        digitou (ver `datasDasParcelasNoCartao` na rota).
                        Imprimir "01/04" ao lado de "parcela 4 de 10" afirmaria
                        uma data de compra que nao existe. O mes, que e a
                        informacao real, ja esta no cabecalho da fatura.

                        `rotuloDaParcela` devolve null quando o par nao serve
                        (uma coluna sem a outra, N > M), e nesse caso a linha
                        mostra so a data: um "parcela 3 de" sem numero depois do
                        "de" e pior que rotulo nenhum. */}
                    {rotuloDaParcela(
                      gasto.installment_number,
                      gasto.installment_total
                    ) ?? diaEMes(gasto.transaction_date)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* `invoice_amount` ja vem com o sinal invertido pela view: a
                      compra soma e o estorno abate. Imprimir `amount` cru
                      mostraria a fatura inteira negativa. */}
                  <p className="font-semibold">
                    {formatarValor(Number(gasto.invoice_amount), conta.currency)}
                  </p>

                  {/* APAGAR A PARCELA, PERGUNTANDO O ALCANCE (HMO-228)
                      So aparece quando a linha E uma parcela e quando a pagina
                      passou o handler. O botao CHAMA UM PROP e nao faz fetch:
                      este componente nao tem rede nem hook de dados de
                      proposito -- e isso que permite ao teste renderizar a tela
                      de verdade com `react-dom/server`. Quem abre o dialogo e
                      fala com a rota e `cartoes/[id]/page.tsx`. */}
                  {aoApagarParcela && gasto.installment_number ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                      title="Apagar parcela (só esta, desta em diante, ou todas)"
                      onClick={() => aoApagarParcela(gasto)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-10 text-center">
            <Receipt className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            {/* `podeAfirmarVazio` e o pedagio: sem ele esta frase afirma que o
                mes nao teve compra quando a tela nao conseguiu ler a fatura. */}
            {podeAfirmarVazio(estado) && rotuloDoMes ? (
              <>
                <p className="font-medium text-foreground">
                  Nenhum gasto neste cartão em {rotuloDoMes}
                </p>
                <p className="mb-4 text-sm text-muted-foreground">
                  As compras aparecem aqui no mês da fatura em que caem, pelo
                  dia do fechamento.
                </p>
                {conta.is_active && (
                  <Button asChild>
                    <Link href={comOrigem(caminhoDeNovoGasto(conta.id), origem)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Lançar gasto neste cartão
                    </Link>
                  </Button>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Não foi possível ler os gastos deste cartão agora.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------
          AS PREVISOES PENDENTES DESTE CARTAO (HMO-227)

          Bloco SEPARADO das compras, e nunca somado ao total da fatura. Elas
          nao sao compras: sao contas a pagar que alguem cadastrou com o cartao
          como conta (a assinatura mensal e o caso tipico). A HMO-209 as tirou
          de Contas a Pagar -- corretamente, senao a mesma despesa apareceria
          solta ao lado da fatura que ja a contem -- prometendo que elas
          apareceriam AQUI. Ate esta issue elas nao apareciam em lugar nenhum:
          `card_invoice_lines` so ve lancamento e a tela de contas as filtrava.

          Elas tambem nao tem mes de fatura: o que elas tem e `due_date`.
          Encaixa-las no ciclo do cartao seria aplicar a uma conta a pagar a
          regra de uma compra -- por isso cada uma mostra o proprio vencimento,
          e o bloco nao depende do mes escolhido no seletor acima.
          ------------------------------------------------------------------ */}
      {/* `null` NAO VIRA SILENCIO. O campo vem ausente quando aquela consulta
          falhou, e omitir o bloco seria esta tela afirmando por omissao que o
          cartao nao tem conta prevista nenhuma -- o mesmo erro do "Nada em
          atraso." sem rede, que e o modo de falha que a HMO-145 cobra em toda
          tela deste app.

          Lista VAZIA (`[]`), sim, nao mostra nada: o normal e o cartao nao ter
          previsao apontada para ele, e um bloco escrito "nenhuma" em todo
          cartao seria ruido permanente. */}
      {previsoes === null && (
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-muted-foreground">
              Não foi possível conferir as contas previstas deste cartão agora.
            </p>
          </CardContent>
        </Card>
      )}

      {previsoes !== null && previsoes.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {previsoes.length === 1
                ? "1 conta prevista neste cartão"
                : `${previsoes.length} contas previstas neste cartão`}
            </CardTitle>
            <CardDescription>
              Cobranças cadastradas com este cartão como conta. Elas não entram
              no total da fatura acima — nem em Contas a Pagar, para a mesma
              despesa não ser cobrada duas vezes.
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border p-0">
            {previsoes.map((previsao) => (
              <div
                key={previsao.id}
                className="flex items-center justify-between gap-3 px-6 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {previsao.description}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    vence em {diaEMes(previsao.due_date)}
                    {previsao.category ? ` · ${previsao.category.name}` : ""}
                  </p>
                </div>
                {/* O mesmo pedagio do total: valor impresso a partir de uma
                    leitura que falhou mente com a cara de numero certo. */}
                <p className="shrink-0 font-semibold">
                  {podeMostrarNumero(estado) ? (
                    formatarValor(Number(previsao.amount), conta.currency)
                  ) : (
                    <NumeroIndisponivel />
                  )}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
