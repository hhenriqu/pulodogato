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
import {
  AlertCircle,
  Check,
  CreditCard,
  Loader2,
  Pencil,
  Repeat,
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
  motivoSemEditar,
  podeConfirmar,
  podeEditar,
  podeExcluir,
  podePagarAFatura,
  rotuloDeConfirmar,
} from "@/lib/acoes-da-linha";
import { caminhoDoCartaoNoMes } from "@/lib/fatura-do-cartao";
import { EloDaFatura } from "@/components/fatura/EloDaFatura";
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

  const editar = podeEditar(linha);
  const excluir = podeExcluir(linha);
  const confirmar = podeConfirmar(linha);
  const pagar = podePagarAFatura(linha);
  const motivo = motivoSemEditar(linha);

  // Sem nenhum dos tres nao sai `<div>` nenhum: uma caixa de 0px com gap muda o
  // espacamento da linha, e a linha sem acao tem de desenhar IGUAL a de antes
  // desta issue.
  if (!editar && !excluir && !confirmar && !pagar && !motivo) return null;

  const rotuloConfirmar = rotuloDeConfirmar(linha.tipo);

  return (
    <div className="flex shrink-0 items-center gap-1">
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
          onClick={() => acoes.aoPagarFatura(linha)}
          aria-label={ROTULO_DE_PAGAR}
          title={ROTULO_DE_PAGAR}
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
            {linhas.map((linha) => (
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
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
