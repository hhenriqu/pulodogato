"use client";

// -----------------------------------------------------------------------------
// UMA SECAO DA LISTA, E A LINHA DENTRO DELA (HMO-287)
// -----------------------------------------------------------------------------
// Fase 3 da HMO-280. Esta marcacao morava dentro de `TelaDeMovimentacao.tsx`.
//
// ARQUIVO PROPRIO, E ISSO NAO E ORGANIZACAO
// -----------------------------------------
// E o que torna a linha TESTAVEL -- exatamente a jogada de
// `components/movimentacoes/CartoesDaTela.tsx`, e pelo mesmo motivo.
// `TelaDeMovimentacao.tsx` importa `next/navigation` no topo, e
// `next/navigation` NAO roda no node (ver o cabecalho de
// scripts/resolve-next-subpaths.mjs): um teste que renderizasse esta marcacao
// de la morreria no import, antes da primeira assercao. Aqui nao ha hook
// nenhum. Props entram, marcacao sai, e scripts/test-secao-da-tela.mjs le o
// HTML.
//
// A UNICA RESSALVA, DESDE A HMO-305: o `EloDaFatura` -- o rotulo e a acao da
// fatura em dois lugares -- tem estado proprio (o cartao de confirmacao abre e
// fecha) e fala com a rota ele mesmo. Ele continua renderizavel por
// `react-dom/server`, entao a suite desta secao segue valendo; o que ela nao
// alcanca sao os CLIQUES dele, e por isso eles sao medidos no caso J da sonda
// de navegador do painel do modo papel de pao. Ele so e MONTADO quando o
// container passa `acoes.aoConcluirElo`: sem recarga, o clique mudaria o banco e
// a tela continuaria mostrando o numero antigo.
//
// O ICONE NAO VEM SOZINHO, E ISSO E A FEATURE
// -------------------------------------------
// "Nas despesas, deveria ter um icone ou algo do genero mostrando a categoria
// da despesa." Tres icones cinzentos de 12px numa linha de 320px de celular sao
// indistinguiveis entre si -- quem olha de relance ve que ha um icone, nao QUAL
// icone. Entao vai icone + ROTULO de texto, e o rotulo e tambem a unica coisa
// que o teste consegue afirmar sem navegador (a forma do `<path>` do lucide
// nao e uma assercao que sobreviva a um upgrade do pacote).
//
// O VOCABULARIO E O DE Contas a Pagar, DE PROPOSITO
// -------------------------------------------------
// `app/(dashboard)/dashboard/bills/page.tsx` ja rotula as mesmas duas coisas na
// lista dela, com " · fatura de cartão" e " · fixo". As duas telas mostram
// linhas que vem da MESMA tabela; dois nomes para a mesma coisa fazem a pessoa
// procurar a diferenca que nao existe.
//
// O "Despesa" FICA OMITIDO, E ISSO TAMBEM E DELIBERADO
// ----------------------------------------------------
// Ele e o caso comum da tela de Despesas: repetido em toda linha, ele vira
// ruido, e as duas naturezas que IMPORTAM somem no meio dele. O icone da tela
// continua ali (com `aria-label`, que e o que leitor de tela le), e o rotulo
// escrito fica reservado ao que e excecao.
// -----------------------------------------------------------------------------

import Link from "next/link";
import type { Route } from "next";
import {
  AlertCircle,
  Check,
  CreditCard,
  Loader2,
  Pencil,
  Repeat,
  // O SIGMA E A SOMA, e e o unico icone desta linha que diz "total" -- HMO-452.
  //
  // `EyeOff` seria o erro facil aqui: ele promete ESCONDER, e a decisao da secao
  // 6c do plano e justamente a oposta -- a linha CONTINUA na lista, com selo. Um
  // olho cortado diria que o clique a faz desaparecer, e quem clicasse acharia
  // que a acao falhou.
  Sigma,
  Trash2,
  Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ROTULO_DE_EDITAR,
  ROTULO_DE_EXCLUIR,
  ROTULO_DE_PAGAR,
  motivoDoBotaoTravado,
  motivoSemAcoes,
  motivoSemEditar,
  podeConfirmar,
  podeEditar,
  podeExcluir,
  podeMudarOsTotais,
  podePagarAFatura,
  rotuloDeConfirmar,
  rotuloDeMudarOsTotais,
  seloDaLinha,
  tituloDoBotao,
} from "@/lib/acoes-da-linha";
import { caminhoDoCartaoNoMes } from "@/lib/fatura-do-cartao";
import { EloDaFatura } from "@/components/fatura/EloDaFatura";
import { LinhaDoGrupo } from "@/components/movimentacoes/LinhaDoGrupo";
import type { PixParaCopiar } from "@/components/movimentacoes/CopiarPix";
import type { GrupoNaLista } from "@/lib/despesas-do-grupo";
import type { LinhaDaTela } from "@/lib/telas-de-movimentacao";

const moeda = (valor: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(valor);

/** 'AAAA-MM-DD' -> 'DD/MM'. Fatiado, nao `new Date`: ver `linhasDaTela`. */
const dataCurta = (iso: string) =>
  iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—";

/**
 * O icone, a cor e as palavras de UMA das tres telas.
 *
 * Mora em `TelaDeMovimentacao.tsx` (`APARENCIA`) e chega aqui por prop. O tipo
 * esta deste lado porque e este arquivo que consome os campos -- e porque o
 * container nao pode ser importado por um teste.
 */
export interface AparenciaDaTela {
  /** O icone da tela: `TrendingDown` em Despesas, `TrendingUp` em Receitas. */
  Icone: React.ComponentType<{ className?: string; "aria-label"?: string }>;
  /** A classe de cor do subtotal, em token (check-color-tokens). */
  cor: string;
  rotaDeLancar: string;
  textoDeLancar: string;
  /**
   * O nome, no singular, do que a linha comum e NESTA tela.
   *
   * So vai para o `aria-label` do icone -- ele nunca e escrito na linha. E por
   * tela e nao por `natureza` porque `natureza: "despesa"` e o nome do caso
   * COMUM nas TRES telas (ver `NaturezaDaLinha`): "Despesa" embaixo de um
   * salario previsto seria um rotulo errado sobre um numero certo.
   */
  palavraDaLinha: string;
}

/**
 * O icone e o rotulo de uma linha, por natureza (HMO-287).
 *
 * Devolve `rotulo: null` no caso comum -- quem desenha nao escreve nada, so o
 * icone com `aria-label`.
 */
function marcaDaLinha(
  linha: LinhaDaTela,
  aparencia: AparenciaDaTela
): { Icone: AparenciaDaTela["Icone"]; rotulo: string | null; descricao: string } {
  if (linha.natureza === "fatura") {
    return {
      Icone: CreditCard,
      rotulo: "fatura de cartão",
      descricao: "fatura de cartão",
    };
  }
  // O SELO DO MYBANK -- HMO-377, e ele chegou a tela NESTA issue.
  //
  // `natureza: "mybank"` existe desde a HMO-372 (a parcela prevista do
  // auto-emprestimo) e ganhou o lado realizado na HMO-380 (a perna solta que a
  // conexao pagou), mas NENHUM componente o lia: `git grep 'natureza ===
  // "mybank"'` em components/ e app/ nao devolvia uma linha. O campo viajava na
  // resposta da rota e morria aqui, caindo no `return` comum logo abaixo --
  // a familia `coluna-declarada-e-nunca-lida-faz-conserto-de-view-virar-no-op`,
  // e o mesmo defeito que a HMO-379 achou em `a_receber_do_mybank`.
  //
  // E E O SELO QUE ESTA ISSUE PRECISA, porque a linha que ela acrescenta e a
  // parcela que a pessoa DEVE a outra pessoa: sem o rotulo ela e uma despesa de
  // R$ 1.000 que nao esta no extrato de ninguem e que a lista mostra sem botao
  // nenhum (`gravada: false`). "Uma despesa que eu nao lancei e nao consigo
  // editar" e indistinguivel de bug; "MyBank" diz onde ela e operada.
  //
  // O TEXTO E O MESMO DE Contas a Pagar (`SELO_DO_MYBANK` = "MyBank", que
  // `ParcelaDevidaNaAgenda.selo` carrega naquela tela), pela razao do cabecalho
  // deste arquivo: as duas telas mostram a MESMA divida, e dois nomes para ela
  // fazem a pessoa procurar a diferenca que nao existe. A string esta escrita
  // aqui e nao importada para este componente nao arrastar
  // `lib/emprestimo-do-mybank` -> `@/lib/lancamento` para dentro da arvore que a
  // sonda de navegador compila; quem tranca a igualdade e
  // scripts/test-contrato-das-telas-de-movimentacao.mjs.
  //
  // `Wallet` E NAO `Repeat`: a parcela do MyBank E uma serie (3/24), entao o
  // icone de repeticao seria plausivel -- e e exatamente por isso que ele esta
  // recusado. `Repeat` ja significa "gasto fixo" nesta lista, e dizer com o
  // mesmo desenho duas coisas diferentes apaga a distincao que o rotulo tenta
  // fazer. `Wallet` ja e o vocabulario de conta/carteira neste arquivo.
  if (linha.natureza === "mybank") {
    return { Icone: Wallet, rotulo: "MyBank", descricao: "MyBank" };
  }
  if (linha.natureza === "fixa") {
    return { Icone: Repeat, rotulo: "fixo", descricao: "fixo" };
  }
  return {
    Icone: aparencia.Icone,
    rotulo: null,
    descricao: aparencia.palavraDaLinha,
  };
}

/**
 * Os tres gestos da linha -- HMO-301.
 *
 * O COMPONENTE NAO SABE DE REDE, de proposito: ele chama de volta e quem fala
 * com a rota e `ListaDeMovimentacao`, que e tambem quem relê a lista depois.
 * Isso e o que mantem este arquivo renderizavel por `react-dom/server` (sem
 * `next/navigation`, sem `fetch`) e o que faz a sonda de navegador poder medir
 * a coisa que importa: a linha MUDANDO DE SECAO depois da releitura.
 *
 * `agindo` e o id da linha cuja acao esta em curso. Ele desabilita os tres
 * botoes DAQUELA linha e troca o icone por um giro -- dois cliques em
 * "Confirmar" seriam duas baixas, e a segunda volta 409 depois de a primeira ter
 * dado certo: a tela mostraria um erro em cima de uma operacao que funcionou.
 */
export interface AcoesDaLinha {
  /**
   * O caminho de edicao, quando a edicao e uma NAVEGACAO (linha realizada).
   * `null` quando nao e -- e aí o Editar e um botao que chama `aoEditar`.
   *
   * DUAS FORMAS PARA O MESMO BOTAO porque sao duas edicoes diferentes: a linha
   * realizada abre o formulario completo da tela do tipo (que sabe ler `?id=`
   * de `financial_transactions`), e a conta prevista nao tem tela assim -- ela
   * se edita no formulario em linha desta lista.
   */
  hrefDeEdicao: (linha: LinhaDaTela) => string | null;
  aoEditar: (linha: LinhaDaTela) => void;
  aoExcluir: (linha: LinhaDaTela) => void;
  aoConfirmar: (linha: LinhaDaTela) => void;
  /**
   * PAGAR A FATURA -- HMO-311 (fase 14).
   *
   * Ela nao passa por `aoConfirmar` e nao e opcional, e as duas coisas sao
   * deliberadas.
   *
   * NAO E `aoConfirmar` porque a baixa da fatura PERGUNTA ANTES: de qual conta o
   * dinheiro saiu. O `POST /api/scheduled-transactions/{id}/pay` sem
   * `payment_account_id` volta 400, entao um "Confirmar" reaproveitado seria um
   * botao que erra em todo clique. Quem abre o dialogo e trata as duas escritas
   * (o `close` da fatura aberta e o `/pay`) e `ListaDeMovimentacao`, pelo
   * `DialogoDePagamentoDaFatura` e por `pagarAFatura` -- os dois da HMO-310.
   *
   * OBRIGATORIA, ao contrario de `aoConcluirElo`, pelo motivo que a HMO-301 ja
   * escreveu no `acoes` desta secao: opcional, a fatura voltaria a ser linha sem
   * botao no dia em que o container parasse de passar a funcao -- sem erro, sem
   * log e com o `tsc` verde, que e exatamente o estado de antes desta fase.
   */
  aoPagarFatura: (linha: LinhaDaTela) => void;
  /**
   * TIRAR (OU DEVOLVER) A LINHA DOS TOTAIS -- HMO-452.
   *
   * E o caminho que o pedido da HMO-443 descreve: "preciso poder remover dos
   * totais" a partir da linha que ja esta na tela.
   *
   * OBRIGATORIA, e nao opcional como `aoConcluirElo`, pela razao que a HMO-301
   * ja escreveu para `aoPagarFatura`: opcional, a acao desapareceria da linha
   * no dia em que um container novo parasse de passar a funcao -- sem erro, sem
   * log e com o `tsc` verde, que e exatamente o estado de antes desta issue. E
   * ha DOIS containers hoje (a lista completa e o modo Papel de Pao), que e o
   * cenario em que esse esquecimento acontece.
   *
   * Quem monta o pedido e `pedidoDeMudarOsTotais` (lib/acoes-da-linha.ts), nao
   * o container: a URL e a de `financial_transactions`, e uma linha PREVISTA
   * montaria `/api/scheduled-transactions/{id}`, onde o campo e descartado em
   * silencio com 200.
   */
  aoMudarOsTotais: (linha: LinhaDaTela) => void;
  /** O id da linha cuja acao esta em curso, ou `null`. */
  agindo: string | null;
  /** Sem rede nenhuma acao sai: as tres sao escrita. */
  online: boolean;
  /**
   * RECARREGAR A TELA DEPOIS DO ELO DA FATURA -- HMO-305.
   *
   * O elo nao passa por `aoEditar`/`aoExcluir`: ele e uma escrita propria
   * (`POST .../elo-de-fatura`) que o `EloDaFatura` faz, e o que esta tela
   * precisa saber e so que o numero mudou -- a de-duplicacao acontece na
   * proxima LEITURA, em `sintetizarFaturasAbertas`.
   *
   * OPCIONAL, e ausente DESLIGA a acao: sem recarga, o clique mudaria o banco e
   * a tela continuaria mostrando o «Previsto» antigo. "Funcionou e a tela nao
   * mudou" se le como "nao funcionou", e a pessoa clica de novo num botao que
   * mexe em dinheiro.
   */
  aoConcluirElo?: () => void;
}

/**
 * Os botoes de UMA linha, ou nada.
 *
 * `aparencia` NAO ENTRA: o verbo da baixa sai de `linha.tipo`, e nao da tela.
 * Os dois concordam (a lista e filtrada por tipo em `linhasDaTela`), e a escolha
 * e a mesma de `palavraDaLinha` ao contrario -- ali o rotulo e da TELA porque
 * `natureza: "despesa"` e o nome do caso comum nas tres; aqui o verbo e da
 * LINHA porque "Confirmar pagamento" sobre uma receita prevista seria um verbo
 * errado sobre um numero certo.
 *
 * Quem decide QUAIS botoes e `lib/acoes-da-linha.ts`, e nao um `&&` escrito
 * aqui. Ver o cabecalho dele: as cinco regras falham de forma plausivel (404,
 * 409, e o caro -- `UPDATE` recusado pela RLS voltando 200 sem alterar nada), e
 * dentro do JSX elas nao teriam assercao nenhuma por cima.
 */
function BotoesDaLinha({
  linha,
  acoes,
}: {
  linha: LinhaDaTela;
  acoes: AcoesDaLinha;
}) {
  const emCurso = acoes.agindo === linha.id;
  const travado = acoes.agindo !== null || !acoes.online;

  // POR QUE ESTE BOTAO ESTA CINZA -- HMO-475.
  //
  // `travado` continua decidindo o `disabled` exatamente como antes; o que
  // muda e que agora ele vem com a frase. A regra mora em `acoes-da-linha.ts`
  // e nao num ternario escrito aqui pelo motivo do cabecalho deste arquivo: o
  // `agindo` tem DOIS motivos (esta linha, ou outra), e dentro do JSX a
  // diferenca entre eles nao teria assercao nenhuma por cima.
  //
  // A redundancia com `travado` e deliberada: se um dia o `disabled` de um
  // destes botoes deixar de ser `travado`, o motivo ficaria MENTINDO em
  // silencio -- e um `motivoTravado` que nao olhasse o mesmo estado seria
  // justamente isso. Os dois leem `acoes.agindo`/`acoes.online`, e
  // `test:secao-da-tela` afirma os dois juntos (cinza E com motivo).
  const motivoTravado = motivoDoBotaoTravado({
    online: acoes.online,
    agindo: acoes.agindo,
    idDaLinha: linha.id,
  });

  const editar = podeEditar(linha);
  const excluir = podeExcluir(linha);
  const confirmar = podeConfirmar(linha);
  const pagar = podePagarAFatura(linha);
  const motivo = motivoSemEditar(linha);
  const mudarTotais = podeMudarOsTotais(linha);

  // SEM NENHUMA ACAO, A LINHA DIZ POR QUE -- HMO-457.
  //
  // Aqui era `return null`, e o `null` e indistinguivel de defeito: desde a
  // HMO-303 a lista de Despesas traz a linha de OUTRO MEMBRO do grupo, e numa
  // conta com grupo elas aparecem no meio das minhas sem botao e sem uma
  // palavra. "A linha alheia nao se edita" e "a tela quebrou" desenhavam igual.
  //
  // Quem decide a frase e `motivoSemAcoes` (lib/acoes-da-linha.ts), e nao um
  // `&&` escrito aqui -- mesma razao de todas as outras peneiras desta linha.
  // Ele devolve `null` de proposito onde a ausencia ja e esperada (a parcela do
  // MyBank, a fatura ja paga), e nesses casos continua nao saindo `<div>`
  // nenhum: uma caixa de 0px com gap muda o espacamento da linha.
  const semAcoes = motivoSemAcoes(linha);

  // `mudarTotais` NAO ENTRA NESTA CONDICAO, e a ausencia e medida -- HMO-452.
  //
  // `podeMudarOsTotais` e `podeAgirNaLinha(linha) && origem === "realizado"`, e
  // `podeExcluir` e `podeAgirNaLinha` NU: o primeiro IMPLICA o segundo, que ja
  // esta aqui. Acrescenta-lo nao poderia mudar resposta nenhuma -- seria um
  // porteiro inobservavel, e o mutante que o escreve sobrevive com razao.
  //
  // `pagar` esta aqui porque com ele e DIFERENTE: `podePagarAFatura` aceita
  // `gravada: false` e exige `natureza === "fatura"`, que `podeAgirNaLinha`
  // RECUSA. Ele alcanca linha que nenhum dos outros alcanca, e sem o termo a
  // fatura aberta cairia no `return` de baixo com botao Pagar por desenhar.
  if (!editar && !excluir && !confirmar && !pagar && !motivo) {
    if (!semAcoes) return null;

    // TEXTO, e nao botao apagado: no iPhone nao ha hover, entao `title` nunca
    // aparece -- e um cinza clicavel convidaria a tentar o que a RLS recusa
    // com 200 sem alterar nada. `shrink-0` como no `<div>` dos botoes, para a
    // linha com e sem acao alinharem o lado direito igual.
    return (
      <span className="shrink-0 text-xs text-muted-foreground">{semAcoes}</span>
    );
  }

  const rotuloConfirmar = rotuloDeConfirmar(linha.tipo);

  return (
    // O MESMO MOTIVO NA CAIXA, e ele NAO e redundante com o `title` dos botoes
    // -- HMO-475.
    //
    // `Button` carrega `disabled:pointer-events-none`, e botao com
    // `pointer-events: none` nao recebe evento de mouse: o navegador NAO mostra
    // o `title` dele ao passar o mouse. O `title` do botao continua valendo (ele
    // e a descricao acessivel, e e o que leitor de tela anuncia depois do nome),
    // mas sozinho ele seria uma explicacao que ninguem de mouse alcanca -- a
    // familia de "o canal existe e fica desligado sem sintoma".
    //
    // Com o motivo AQUI, o ponteiro atravessa o botao travado e para nesta
    // caixa, que tem `pointer-events` normal, e a dica aparece sobre a area
    // inteira das acoes. A sonda `probe-acoes-da-linha-no-iphone.mjs` mede
    // exatamente isso com o CSS de producao (`elementFromPoint` no centro de
    // cada botao), em vez de supor.
    //
    // NENHUM NO NOVO: o `title` entra na caixa que ja existia. Um `<span>` de
    // embrulho por botao mudaria o `gap-1` da linha de 320px, que e o recorte
    // que a HMO-457 estava medindo.
    <div
      className="flex shrink-0 items-center gap-1"
      title={motivoTravado ?? undefined}
    >
      {/*
        PAGAR A FATURA -- HMO-311, e ele e o UNICO botao desta linha com TEXTO.
        Os outros tres sao de icone so porque sao tres numa linha de 320px; aqui
        ha um, e o verbo e o que diz que o clique ABRE UMA PERGUNTA em vez de ja
        resolver. Um cartao de credito desenhado sozinho a direita nao se
        distingue do icone de natureza que a MESMA linha ja tem a esquerda.

        `ROTULO_DE_PAGAR` e nao a palavra escrita aqui: ela e tambem o
        `aria-label`, e e por ele que a sonda de navegador acha o botao.
      */}
      {pagar && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 px-2"
          disabled={travado}
          aria-disabled={travado || undefined}
          onClick={() => acoes.aoPagarFatura(linha)}
          aria-label={ROTULO_DE_PAGAR}
          title={tituloDoBotao(ROTULO_DE_PAGAR, motivoTravado)}
        >
          {emCurso ? (
            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
          ) : (
            <Wallet className="mr-1 h-4 w-4" />
          )}
          {ROTULO_DE_PAGAR}
        </Button>
      )}

      {confirmar && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0"
          disabled={travado}
          aria-disabled={travado || undefined}
          onClick={() => acoes.aoConfirmar(linha)}
          aria-label={rotuloConfirmar}
          title={tituloDoBotao(rotuloConfirmar, motivoTravado)}
        >
          {emCurso ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Check className="h-4 w-4" />
          )}
        </Button>
      )}

      {/*
        EDITAR TEM DUAS FORMAS E UMA TERCEIRA APAGADA, e as tres sao
        deliberadas. O `href` leva para o formulario da tela do tipo (realizada);
        o botao abre o formulario em linha (prevista); e o apagado e a perna de
        transferencia ja gravada, que NAO se edita por aqui -- abrir uma perna na
        tela de despesa deixaria a outra orfa, e o saldo passaria a somar sozinho
        pelo valor inteiro. O `title` carrega o motivo: botao cinza sem
        explicacao e indistinguivel de tela quebrada, e a pessoa tenta de novo.
      */}
      {editar ? (
        acoes.hrefDeEdicao(linha) ? (
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            asChild
            aria-label={ROTULO_DE_EDITAR}
            title={ROTULO_DE_EDITAR}
          >
            {/* `as Route`: `experimental.typedRoutes` tipa o destino como uma
                uniao literal, e este caminho e montado por `caminhoDeEdicao`
                numa lib pura -- a mesma concessao de `irPara` em
                TelaDeMovimentacao.tsx, pelo mesmo motivo. */}
            <Link href={acoes.hrefDeEdicao(linha) as Route}>
              <Pencil className="h-4 w-4" />
            </Link>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            disabled={travado}
            aria-disabled={travado || undefined}
            onClick={() => acoes.aoEditar(linha)}
            aria-label={ROTULO_DE_EDITAR}
            title={tituloDoBotao(ROTULO_DE_EDITAR, motivoTravado)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )
      ) : (
        motivo && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            disabled
            aria-disabled
            aria-label={ROTULO_DE_EDITAR}
            // O MOTIVO ESTRUTURAL GANHA DO `motivoTravado`, e nao por ordem de
            // escrita: este Editar nunca vai abrir, com rede ou sem ela. "Sem
            // rede" aqui prometeria que voltar a ter sinal resolve.
            title={tituloDoBotao(ROTULO_DE_EDITAR, motivo)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )
      )}

      {/*
        NAO SOMAR NOS TOTAIS -- HMO-452, F2 da HMO-443.

        "preciso poder remover dos totais." Este e o caminho que o pedido
        descreve: a partir da linha que ja esta na tela.

        O ROTULO VEM DE `rotuloDeMudarOsTotais` E MUDA COM O ESTADO, e isso nao
        e enfeite: a acao e um interruptor, e um nome fixo mentiria em metade dos
        cliques -- em cima da linha JA desmarcada, "Não somar nos totais"
        prometeria desmarcar de novo, e quem clicasse por engano nao saberia que
        acabou de RELIGAR a linha nos relatorios. O `aria-label` carrega o mesmo
        rotulo, e e por ele que a sonda de navegador acha o botao.

        ENTRE O EDITAR E O EXCLUIR, de proposito: a ordem da linha vai do menos
        destrutivo para o mais, e o Excluir e o unico que nao volta. Posto
        DEPOIS dele, o botao novo ficaria ao lado do vermelho -- o alvo errado
        num toque de celular custa um lancamento apagado.

        `disabled={travado}` como os outros tres, pelo mesmo motivo: escrita sem
        rede neste caminho nao fica pendente, ela FALHA; e dois cliques na mesma
        linha sao duas escritas, que aqui se cancelariam (o corpo leva o
        booleano INVERTIDO do que a tela esta mostrando -- ver
        `pedidoDeMudarOsTotais`).
      */}
      {mudarTotais && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0"
          disabled={travado}
          aria-disabled={travado || undefined}
          onClick={() => acoes.aoMudarOsTotais(linha)}
          aria-label={rotuloDeMudarOsTotais(linha)}
          title={tituloDoBotao(rotuloDeMudarOsTotais(linha), motivoTravado)}
        >
          {emCurso ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            // RISCADO QUANDO A LINHA JA ESTA FORA, e e a unica forma de os dois
            // estados se distinguirem SEM texto: o botao e de icone so, e um
            // sigma identico nos dois casos deixaria a linha desmarcada
            // indistinguivel da que soma -- com o selo sendo a unica pista, a
            // seis palavras de distancia. `line-through` num `<span>` em volta
            // nao funciona em SVG; a cor e o que o CSS de producao carrega.
            <Sigma
              className={`h-4 w-4 ${
                linha.soma_nos_totais ? "" : "text-warning"
              }`}
            />
          )}
        </Button>
      )}

      {excluir && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={travado}
          aria-disabled={travado || undefined}
          onClick={() => acoes.aoExcluir(linha)}
          aria-label={ROTULO_DE_EXCLUIR}
          title={tituloDoBotao(ROTULO_DE_EXCLUIR, motivoTravado)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

/**
 * Uma linha da lista.
 *
 * NENHUMA LINHA E `<a>` -- e ate a HMO-311 a fatura era. Linha que PARECE
 * clicavel e nao e custa mais que linha que nao parece: a pessoa toca, nada
 * acontece, e a conclusao natural e que o app travou. As naturezas comuns nao
 * tem destino decidido (uma despesa comum nao tem tela propria para abrir), e a
 * fatura, que TEM, passou a levar o destino no NOME DO CARTAO em vez de na
 * linha inteira -- para que o botao Pagar possa existir a direita sem ficar
 * aninhado numa ancora. Ver o comentario antes do `return`.
 */
function LinhaDaSecao({
  linha,
  aparencia,
  acoes,
  valorDaFatura = null,
}: {
  linha: LinhaDaTela;
  aparencia: AparenciaDaTela;
  acoes: AcoesDaLinha;
  /**
   * O valor da FATURA ABERTA do cartao desta suspeita -- HMO-305, so para a
   * frase do cartao de confirmacao. Ele sai da propria lista desta secao, e nao
   * de uma conta feita aqui; `null` quando a lista nao a tem, e a frase sai sem
   * numero em vez de sair com um numero inventado.
   */
  valorDaFatura?: number | null;
}) {
  const { Icone, rotulo, descricao } = marcaDaLinha(linha, aparencia);

  // O NOME DO CARTAO COMO LINK -- HMO-311, e e o MESMO criterio que decidia a
  // ancora da linha inteira (`linha.fatura && !linha.elo_da_fatura`), movido
  // para dentro dela. Um segundo criterio aqui poria o link na linha errada.
  //
  // A previsao DIGITADA ligada ao elo continua FORA, e a razao e a da HMO-305:
  // ela e uma previsao na conta corrente, nao a fatura em si. O link mora na
  // linha DA fatura, que esta na mesma lista.
  const destinoDoCartao =
    linha.fatura && !linha.elo_da_fatura
      ? caminhoDoCartaoNoMes(linha.fatura.accountId, linha.fatura.mes)
      : null;

  const nome = linha.descricao ?? "Sem descrição";

  const conteudo = (
    <>
      <div className="min-w-0 space-y-0.5">
        {destinoDoCartao ? (
          <p className="truncate font-medium">
            <Link
              href={destinoDoCartao}
              className="text-foreground hover:underline"
            >
              {nome}
            </Link>
          </p>
        ) : (
          <p className="truncate font-medium text-foreground">{nome}</p>
        )}
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Icone className="h-3 w-3" aria-label={descricao} />
            {rotulo && <span>{rotulo}</span>}
          </span>
          {/*
            O `·` so entra quando ha rotulo ANTES dele. Na linha comum o icone
            e o unico vizinho a esquerda, e "↘ · 14/08" deixa um separador
            pendurado que se le como um campo que faltou carregar.
          */}
          <span>
            {rotulo ? "· " : ""}
            {dataCurta(linha.data)}
          </span>
          {linha.categoria && <span>· {linha.categoria}</span>}
          {linha.conta && <span>· {linha.conta}</span>}
          {linha.moeda && <span>· {linha.moeda}</span>}
          {/*
            "Vencida" sai de `effective_status`, que a view calcula na hora --
            nunca de uma comparacao de data feita aqui. Duas implementacoes da
            mesma regra divergem, e esta divergiria no fuso do servidor (UTC na
            Vercel).
          */}
          {linha.situacao === "overdue" && (
            <span className="inline-flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3 w-3" />
              vencida
            </span>
          )}
          {/*
            A FATURA ABERTA CONTINUA SE DISTINGUINDO DA FECHADA, em uma palavra
            e nao em duas. Ate a HMO-287 esta linha dizia "· fatura aberta do
            cartão"; o rotulo novo ja diz "fatura", e repetir a palavra na mesma
            linha e o que esta issue proibiu. O que NAO pode cair e a diferenca
            que sobra: a fatura aberta continua recebendo compras ate o
            fechamento, entao o numero de hoje nao e o numero final. E a mesma
            frase que Contas a Pagar usa (bills/page.tsx), pelo mesmo motivo.
          */}
          {!linha.gravada && <span>· ainda em aberto</span>}
          {/*
            O ROTULO QUE IMPEDE O VALOR PELA METADE DE PARECER ERRO -- HMO-303.

            Desde esta issue a tela de Despesas lista a conta de grupo que OUTRO
            membro lancou (a RLS do 005 ja a liberava; o que faltava era o filtro
            da consulta), e `valor` e a MINHA fracao dela -- R$ 900,00 de um
            aluguel de R$ 3.000. Sem este rotulo a pessoa ve uma conta que nunca
            cadastrou, com um valor que nao bate com nada, e isso e
            indistinguivel de um bug.

            A frase e a MESMA do painel do modo (`ROTULO_DE_GRUPO` em
            PainelDePapel.tsx): as duas listas respondem a mesma pergunta, e dois
            textos para ela divergiriam na primeira revisao de copy.
          */}
          {linha.de_grupo && <span>· minha parte do grupo</span>}
          {/*
            O SELO DA LINHA QUE NAO SOMA -- HMO-452, e sem ele a linha se le
            como bug.

            A linha desmarcada CONTINUA aqui, com o valor dela, e NAO entra no
            cartao de «Realizado» em cima (o filtro mora em
            `category_monthly_totals`, migration 060). Quem somasse as linhas a
            mao acharia outro numero e concluiria que o total esta errado -- e e
            a mesma razao pela qual a tela de Contas poe este marcador na conta
            fora dos totais (058). O selo torna a diferenca LEGIVEL em vez de
            parecer defeito.

            E A LINHA FICA NA LISTA DE PROPOSITO. O pedido original dizia "ela
            nao precisaria nem aparecer", e a secao 6c do plano decidiu manter:
            esconder a linha deixa o dinheiro sem lugar NENHUM no app e o total
            sem explicacao. Lista limpa, se ele quiser depois, e FILTRO da tela.

            `seloDaLinha` e nao um `=== false` escrito aqui: a decisao e a mesma
            que decide o rotulo do botao, e duas copias dela divergiriam -- o
            sintoma seria o selo dizendo uma coisa e o botao oferecendo a outra
            na MESMA linha. `text-warning` e o token do marcador da 058, para os
            dois se lerem como a mesma informacao.
          */}
          {seloDaLinha(linha) && (
            <span className="text-warning">· {seloDaLinha(linha)}</span>
          )}
          {/*
            O ELO DA FATURA -- HMO-305, o rotulo e a acao.

            Ele e o unico elemento desta linha que ESCREVE, e por isso vive num
            componente proprio (components/fatura/EloDaFatura.tsx) com o cartao
            de confirmacao dentro: a mesma marcacao serve o painel do modo Papel
            de Pao, e as duas telas tem de dizer a mesma coisa sobre a mesma
            linha.

            `null` em quase toda linha -- sem suspeita e sem elo ele nao desenha
            nada, e a linha fica como era.
          */}
          {linha.id && acoes.aoConcluirElo && (
            <EloDaFatura
              previsaoId={linha.id}
              suspeita={linha.fatura_suspeita}
              elo={linha.elo_da_fatura}
              valorDaFaturaFormatado={
                valorDaFatura !== null ? moeda(valorDaFatura) : null
              }
              valorDaPrevisaoFormatado={moeda(linha.valor)}
              aoConcluir={acoes.aoConcluirElo}
            />
          )}
        </p>
      </div>
      <p className="shrink-0 font-semibold">{moeda(linha.valor)}</p>
    </>
  );

  const classe =
    "flex items-start justify-between gap-3 border-b border-border py-2 last:border-0";

  // NENHUMA LINHA E `<a>` DESDE A HMO-311 -- e o que mudou foi a fatura.
  //
  // Ate aqui a linha de fatura era uma ancora inteira para a tela do cartao, e
  // era ESSA ancora uma das duas razoes pelas quais a fatura nao ganhava botao
  // (regra 5 de lib/acoes-da-linha.ts): botao dentro de `<a>` e aninhamento
  // interativo invalido, e o clique faria as duas coisas -- abriria o dialogo E
  // navegaria para o cartao. Com as duas acontecendo, "funcionou" e
  // indistinguivel do defeito.
  //
  // A troca e por DOIS ALVOS EXPLICITOS, no lugar de um implicito: o NOME DO
  // CARTAO e o link (ver `destinoDoCartao`, acima) e o botao **Pagar** fica a
  // direita, no mesmo lugar onde as outras linhas tem Editar/Excluir.
  //
  // O PRECO ESTA NOMEADO E ACEITO: a linha da fatura perde o atalho implicito --
  // tocar em qualquer lugar dela nao abre mais o cartao. Em troca, o que a
  // pessoa pediu ("o botao de pagar tbm na fatura do cartao em despesas")
  // existe, e os dois destinos ficam visiveis em vez de um deles ser adivinhado.
  return (
    <div className={classe}>
      {conteudo}
      <BotoesDaLinha linha={linha} acoes={acoes} />
    </div>
  );
}

/**
 * Uma secao da lista, com o subtotal que o cartao de cima prometeu.
 *
 * O subtotal e recalculado AQUI a partir das linhas que a secao desenha, e nao
 * recebido do resumo. E a unica forma de a tela denunciar uma divergencia entre
 * o numero e a lista: iguais, confirmam-se; diferentes, aparecem diferentes na
 * mesma tela. Receber o numero de cima esconderia exatamente o defeito que
 * importa.
 */
export function SecaoDaTela({
  titulo,
  subtitulo,
  icone,
  linhas,
  carregando,
  vazio,
  aparencia,
  acoes,
  grupos = [],
  chavesPix = {},
}: {
  titulo: string;
  subtitulo: string;
  icone: React.ReactNode;
  linhas: LinhaDaTela[];
  carregando: boolean;
  vazio: string;
  aparencia: AparenciaDaTela;
  /**
   * OBRIGATORIO de proposito (HMO-301).
   *
   * Opcional, a secao renderizaria sem botao nenhum no dia em que o container
   * parasse de passar o objeto -- e isso e precisamente o estado de antes desta
   * issue: a lista inteira volta a ser so leitura, sem erro, sem log e com o
   * `tsc` verde. Obrigatorio, o compilador cobra a fiacao.
   */
  acoes: AcoesDaLinha;
  /**
   * AS LINHAS DE GRUPO -- "Despesas do Grupo {nome}" (24/10/2026).
   *
   * Cada uma agrega linhas desta lista pelo id: a linha do grupo e desenhada no
   * lugar da PRIMEIRA delas, com a soma delas, e as outras saem. O subtotal e o
   * contador continuam sobre `linhas`, entao o numero da secao nao muda -- so
   * a forma. Opcional: sem ele a lista e a de antes.
   */
  grupos?: readonly GrupoNaLista[];
  /** A chave Pix de quem recebe, para o copia e cola das transferencias. */
  chavesPix?: Readonly<Record<string, PixParaCopiar>>;
}) {
  const subtotal = linhas.reduce((soma, l) => soma + l.valor, 0);

  // Qual linha de grupo cobre cada linha, a soma de cada uma e onde ela entra.
  const grupoDaLinha = new Map<string, GrupoNaLista>();
  for (const g of grupos) for (const id of g.linhas) grupoDaLinha.set(id, g);
  const somaDoGrupo = new Map<string, number>();
  const linhasDoGrupo = new Map<string, LinhaDaTela[]>();
  for (const l of linhas) {
    const g = grupoDaLinha.get(l.id);
    if (!g) continue;
    // Em centavos: dez partes de R$ 0,10 somadas em ponto flutuante nao dao
    // R$ 1,00, e a linha do grupo mostraria um centavo a menos que o detalhe.
    somaDoGrupo.set(g.chave, (somaDoGrupo.get(g.chave) ?? 0) + Math.round(l.valor * 100));
    linhasDoGrupo.set(g.chave, [...(linhasDoGrupo.get(g.chave) ?? []), l]);
  }

  /**
   * O VALOR DA FATURA ABERTA DE CADA CARTAO/MES, LIDO DA PROPRIA LISTA -- HMO-305.
   *
   * O cartao de confirmacao do elo diz quanto o «Previsto» vai cair, e este mapa
   * e de onde o numero sai: a linha da fatura sintetizada esta NESTA lista (ela
   * entra no subtotal), e `linha.fatura` da o cartao e o mes dela. Nenhuma conta
   * nova -- e o `valor` que a secao ja soma.
   */
  const faturaPorChave = new Map<string, number>();
  for (const l of linhas) {
    if (l.fatura) faturaPorChave.set(`${l.fatura.accountId}:${l.fatura.mes}`, l.valor);
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            {icone}
            {titulo}
            <span className="text-sm font-normal text-muted-foreground">
              ({linhas.length})
            </span>
          </span>
          {linhas.length > 0 && (
            <span className={`text-base font-semibold ${aparencia.cor}`}>
              {moeda(subtotal)}
            </span>
          )}
        </CardTitle>
        <CardDescription>{subtitulo}</CardDescription>
      </CardHeader>
      <CardContent>
        {/*
          Enquanto a consulta corre, a lista sai da tela e da lugar a um
          indicador. Sem isto o vazio pisca como "Nenhum lançamento em outubro
          de 2026" -- um zero confiante em cima de um periodo que ainda nao foi
          lido.
        */}
        {carregando ? (
          <div className="flex items-center justify-center py-6" aria-live="polite">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
            <span className="sr-only">Carregando {titulo.toLowerCase()}</span>
          </div>
        ) : linhas.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">{vazio}</p>
        ) : (
          <div className="space-y-1">
            {linhas.map((linha) => {
              const grupo = grupoDaLinha.get(linha.id);
              if (grupo) {
                const dele = linhasDoGrupo.get(grupo.chave) ?? [];
                if (dele[0]?.id !== linha.id) return null;
                return (
                  <LinhaDoGrupo
                    key={grupo.chave}
                    grupo={grupo}
                    valor={(somaDoGrupo.get(grupo.chave) ?? 0) / 100}
                    descricao={dele.length === 1 ? linha.descricao : null}
                    vencida={dele.some((l) => l.situacao === "overdue")}
                    chavesPix={chavesPix}
                  />
                );
              }
              return (
                <LinhaDaSecao
                  key={linha.id}
                  linha={linha}
                  aparencia={aparencia}
                  acoes={acoes}
                  valorDaFatura={(() => {
                    const alvo = linha.fatura_suspeita ?? linha.elo_da_fatura;
                    if (!alvo) return null;
                    return faturaPorChave.get(`${alvo.accountId}:${alvo.mes}`) ?? null;
                  })()}
                />
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
