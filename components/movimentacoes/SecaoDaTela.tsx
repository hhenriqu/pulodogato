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
import {
  AlertCircle,
  Check,
  CreditCard,
  Loader2,
  Pencil,
  Repeat,
  Trash2,
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
  motivoSemEditar,
  podeConfirmar,
  podeEditar,
  podeExcluir,
  rotuloDeConfirmar,
} from "@/lib/acoes-da-linha";
import { caminhoDoCartaoNoMes } from "@/lib/fatura-do-cartao";
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
  /** O id da linha cuja acao esta em curso, ou `null`. */
  agindo: string | null;
  /** Sem rede nenhuma acao sai: as tres sao escrita. */
  online: boolean;
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

  const editar = podeEditar(linha);
  const excluir = podeExcluir(linha);
  const confirmar = podeConfirmar(linha);
  const motivo = motivoSemEditar(linha);

  // Sem nenhum dos tres nao sai `<div>` nenhum: uma caixa de 0px com gap muda o
  // espacamento da linha, e a linha sem acao tem de desenhar IGUAL a de antes
  // desta issue.
  if (!editar && !excluir && !confirmar && !motivo) return null;

  const rotuloConfirmar = rotuloDeConfirmar(linha.tipo);

  return (
    <div className="flex shrink-0 items-center gap-1">
      {confirmar && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0"
          disabled={travado}
          onClick={() => acoes.aoConfirmar(linha)}
          aria-label={rotuloConfirmar}
          title={rotuloConfirmar}
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
            {/* `as any`: `experimental.typedRoutes` tipa o destino como uma
                uniao literal, e este caminho e montado por `caminhoDeEdicao`
                numa lib pura -- a mesma concessao de `irPara` em
                TelaDeMovimentacao.tsx, pelo mesmo motivo. */}
            <Link href={acoes.hrefDeEdicao(linha) as any}>
              <Pencil className="h-4 w-4" />
            </Link>
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-8 w-8 p-0"
            disabled={travado}
            onClick={() => acoes.aoEditar(linha)}
            aria-label={ROTULO_DE_EDITAR}
            title={ROTULO_DE_EDITAR}
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
            aria-label={ROTULO_DE_EDITAR}
            title={motivo}
          >
            <Pencil className="h-4 w-4" />
          </Button>
        )
      )}

      {excluir && (
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={travado}
          onClick={() => acoes.aoExcluir(linha)}
          aria-label={ROTULO_DE_EXCLUIR}
          title={ROTULO_DE_EXCLUIR}
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
 * A FATURA E A UNICA QUE VIRA `<a>`. Linha que PARECE clicavel e nao e custa
 * mais que linha que nao parece: a pessoa toca, nada acontece, e a conclusao
 * natural e que o app travou. As outras naturezas nao tem destino decidido --
 * uma despesa comum nao tem tela propria para abrir -- entao elas continuam
 * `<div>`.
 *
 * E E POR ISSO QUE A FATURA NAO GANHA BOTAO (HMO-301), alem da razao de
 * produto que esta em `podeAgirNaLinha`: botao dentro de ancora e aninhamento
 * interativo invalido, e o clique navegaria junto com a acao.
 */
function LinhaDaSecao({
  linha,
  aparencia,
  acoes,
}: {
  linha: LinhaDaTela;
  aparencia: AparenciaDaTela;
  acoes: AcoesDaLinha;
}) {
  const { Icone, rotulo, descricao } = marcaDaLinha(linha, aparencia);

  const conteudo = (
    <>
      <div className="min-w-0 space-y-0.5">
        <p className="truncate font-medium text-foreground">
          {linha.descricao ?? "Sem descrição"}
        </p>
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
        </p>
      </div>
      <p className="shrink-0 font-semibold">{moeda(linha.valor)}</p>
    </>
  );

  const classe =
    "flex items-start justify-between gap-3 border-b border-border py-2 last:border-0";

  if (linha.fatura) {
    return (
      <Link
        href={caminhoDoCartaoNoMes(linha.fatura.accountId, linha.fatura.mes)}
        className={`${classe} transition-colors hover:bg-muted/50`}
      >
        {conteudo}
      </Link>
    );
  }

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
}) {
  const subtotal = linhas.reduce((soma, l) => soma + l.valor, 0);

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
            {linhas.map((linha) => (
              <LinhaDaSecao
                key={linha.id}
                linha={linha}
                aparencia={aparencia}
                acoes={acoes}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
