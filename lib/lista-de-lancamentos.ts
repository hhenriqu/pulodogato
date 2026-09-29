// -----------------------------------------------------------------------------
// QUE PERIODO A LISTA MOSTRA, E QUANDO ELA ESTA CORTADA
// -----------------------------------------------------------------------------
// Ate a HMO-118 a unica lista de lancamentos do app -- `/dashboard/transactions`
// redireciona para ela desde a HMO-124 -- consultava assim:
//
//     .order("transaction_date", { ascending: false }).limit(50)
//
// Sem recorte de data e sem paginacao. Duas consequencias, e nenhuma das duas
// aparece como erro para quem esta olhando a tela:
//
// 1. O LANCAMENTO NUMERO 51 ERA INALCANCAVEL. Nao havia "carregar mais", nao
//    havia periodo para navegar, e nao havia nada na tela dizendo que a lista
//    terminava ali. Quem usa o app por dois meses perde o primeiro mes, e o
//    sintoma e uma lista que simplesmente comeca mais tarde do que a vida dele.
//
// 2. OS CARTOES DO TOPO somavam exatamente essas 50 linhas, debaixo de uma tela
//    cujo subtitulo e "Seus lancamentos e o resumo do mes". Para quem lanca 20
//    vezes por mes, o "resumo do mes" somava dois meses e meio; para quem lanca
//    80, somava parte do mes. O numero nunca ficava vazio e nunca dava erro --
//    era um total correto de um periodo que ninguem escolheu. E o mesmo defeito
//    que a HMO-173 corrigiu no painel inicial (ver `rotuloDoSaldo` em
//    lib/periodo-do-painel.ts) e que nunca foi corrigido aqui.
//
// O periodo em si nao mora neste arquivo: ele vem de lib/periodo-do-painel.ts,
// que ja e a unica definicao de periodo do projeto e ja resolve o fuso de Sao
// Paulo. Duplicar aqui a aritmetica de mes reintroduziria o bug da HMO-173.
//
// O que mora aqui e a outra metade: a paginacao dentro do periodo escolhido, e
// A FRASE que a lista diz sobre si mesma. A frase e codigo testado, e nao texto
// no JSX, porque e ela que separa "nao ha lancamento neste mes" de "ha, e voce
// nao esta vendo". Essa distincao no JSX e uma coisa que so um par de olhos
// conferindo a tela distingue; aqui, o teste distingue.
// -----------------------------------------------------------------------------

import type { FiltroDeLancamento } from "@/lib/movimentacoes";
import { FILTROS_DE_LANCAMENTO } from "@/lib/movimentacoes";

/**
 * Quantas linhas cada pagina traz.
 *
 * E o mesmo 50 do `limit` antigo, de proposito: o problema nunca foi o tamanho
 * da pagina, foi nao haver a segunda.
 */
export const TAMANHO_DA_PAGINA = 50;

/**
 * A faixa que o `.range()` do PostgREST espera para a pagina N (a primeira e 0).
 *
 * `.range()` e INCLUSIVO nos dois extremos -- `range(0, 50)` traz 51 linhas, nao
 * 50. Errar isso nao quebra nada visivel: a pagina viria com uma linha extra e
 * a linha repetiria no topo da pagina seguinte, e uma duplicata na lista de
 * lancamentos e indistinguivel de uma despesa lancada duas vezes. Por isso o
 * `- 1` esta aqui, com teste, e nao escrito na mao na chamada.
 */
export function faixaDaPagina(
  pagina: number,
  tamanho: number = TAMANHO_DA_PAGINA
): { de: number; ate: number } {
  const de = pagina * tamanho;
  return { de, ate: de + tamanho - 1 };
}

/**
 * A ultima pagina veio cheia -- entao pode haver mais.
 *
 * "Pode" e o melhor que se sabe sem uma segunda consulta: um periodo com
 * exatamente 50 lancamentos devolve a pagina cheia, o botao "Carregar mais"
 * aparece, a pessoa clica, a pagina seguinte vem vazia e o botao desaparece.
 * Esse clique a mais e o preco de nao pedir `count: "exact"` em toda carga --
 * e ele e sincero, ao contrario do contrario: esconder o botao quando ainda ha
 * linha e voltar ao lancamento inalcancavel.
 *
 * Pagina vazia nao e pagina cheia nem quando o tamanho e zero: sem o teste de
 * `recebidos > 0`, um periodo sem nenhum lancamento ofereceria "Carregar mais".
 */
export function temMaisParaCarregar(
  recebidos: number,
  tamanho: number = TAMANHO_DA_PAGINA
): boolean {
  return recebidos > 0 && recebidos >= tamanho;
}

/**
 * A linha debaixo dos totais do periodo -- os cartoes "Receitas", "Despesas" e
 * "Saldo".
 *
 * DUAS COISAS ERRADAS DE UMA VEZ, E NENHUMA DAVA ERRO
 * ---------------------------------------------------
 * Essa linha era a string `"Este mês"`, escrita no JSX. Ela mentia duas vezes:
 *
 *   * NAO ERA ESTE MES. Os cartoes somavam as 50 linhas mais recentes de toda a
 *     historia, sem recorte de data. Para quem lança vinte vezes por mês, "Este
 *     mês" cobria dois meses e meio.
 *
 *   * E COM O SELETOR DE PERIODO ELA FICARIA PIOR. Navegar para agosto e ler
 *     "Este mês" embaixo do total de agosto e o defeito que a HMO-173 corrigiu
 *     no painel inicial: um numero certo debaixo do nome errado.
 *
 * O segundo caso -- `temMais` -- e o que sobra depois de o periodo existir: uma
 * SOMA PARCIAL debaixo do nome de um periodo inteiro. Nao ha como somar um mes
 * de 300 lançamentos com 50 linhas na mao, e um total parcial que se apresenta
 * como total do mês e o pior dos resultados: ele erra PARA MENOS e parece certo.
 * Entao ele se declara parcial, com todas as letras.
 */
export function notaDoTotal(opts: {
  rotuloDoPeriodo: string;
  temMais: boolean;
}): string {
  return opts.temMais
    ? `${opts.rotuloDoPeriodo} — parcial: há lançamentos não carregados`
    : opts.rotuloDoPeriodo;
}

/** O que o cabecalho da lista diz, e se ela esta admitindo estar cortada. */
export interface DescricaoDaLista {
  titulo: string;
  descricao: string;
  /** Ha lancamento no periodo que nao esta na tela? */
  cortada: boolean;
}

function rotuloDoFiltro(filtro: FiltroDeLancamento): string {
  return (
    FILTROS_DE_LANCAMENTO.find((f) => f.id === filtro)?.rotulo ?? "Lançamentos"
  );
}

function plural(n: number, um: string, muitos: string): string {
  return n === 1 ? um : muitos;
}

/**
 * A frase da lista: quantas linhas, de que periodo, e se falta alguma.
 *
 * TRES REGRAS, E TODAS AS TRES JA FORAM VIOLADAS NESTA TELA
 * ---------------------------------------------------------
 * 1. O PERIODO E SEMPRE NOMEADO. Um "Transações Recentes" sem data e um numero
 *    certo respondendo uma pergunta desconhecida -- ver o cabecalho deste
 *    arquivo.
 *
 * 2. UM ZERO TEM QUE DIZER ZERO DE QUE. "Nenhum lançamento" sozinho manda a
 *    pessoa concluir que o app perdeu os dados dela; "Nenhum lançamento em
 *    agosto de 2026" manda ela clicar na seta. Este projeto ja entregou o
 *    primeiro em `/dashboard/transactions`, que dizia "Nenhuma transacao
 *    encontrada" para quem tinha duzentas.
 *
 * 3. QUANDO A LISTA ESTA CORTADA, O TOTAL CARREGADO NAO PODE SE APRESENTAR
 *    COMO O TOTAL DO PERIODO. "Mostrando 4 de 50 lançamentos" com mais 30 no
 *    banco nao esta errado em nenhuma palavra e mente na leitura: quem le
 *    entende que o periodo tem 50. Por isso o texto cortado fala de
 *    "carregados" e termina dizendo que ha mais.
 */
export function descreverLista(opts: {
  /** Ja formatado por `rotuloDoPeriodo` -- "setembro de 2026", "ano de 2026". */
  rotuloDoPeriodo: string;
  filtro: FiltroDeLancamento;
  /** Linhas que o filtro deixou passar. */
  visiveis: number;
  /** Linhas carregadas no periodo, antes do filtro. */
  carregados: number;
  /** Veio de `temMaisParaCarregar`. */
  temMais: boolean;
}): DescricaoDaLista {
  const { rotuloDoPeriodo: periodo, filtro, visiveis, carregados } = opts;
  const titulo = rotuloDoFiltro(filtro);
  // `temMais` so importa quando o que a pessoa esta vendo pode estar
  // incompleto. Numa lista vazia ele nunca e verdade (ver
  // `temMaisParaCarregar`), mas a defesa fica aqui tambem: um "e ha mais
  // lançamentos" embaixo de "Nenhum lançamento" seria uma contradicao na
  // mesma frase.
  const cortada = opts.temMais && carregados > 0;

  if (carregados === 0) {
    return {
      titulo,
      descricao: `Nenhum lançamento em ${periodo}`,
      cortada: false,
    };
  }

  if (filtro === "todos") {
    if (cortada) {
      return {
        titulo,
        descricao: `${carregados} lançamentos carregados de ${periodo} — há mais neste período`,
        cortada,
      };
    }

    return {
      titulo,
      descricao: `${carregados} ${plural(
        carregados,
        "lançamento",
        "lançamentos"
      )} em ${periodo} — receitas, despesas e transferências`,
      cortada,
    };
  }

  // Com filtro por tipo, o zero do tipo e diferente do zero do periodo: o
  // periodo tem lancamentos, este tipo nao tem nenhum. A frase tem que
  // distinguir os dois, senao "Nenhuma despesa" parece lista quebrada numa tela
  // que acabou de listar dez receitas.
  if (visiveis === 0) {
    return {
      titulo,
      descricao: cortada
        ? `Nenhum lançamento deste tipo entre os ${carregados} carregados de ${periodo} — há mais neste período`
        : `Nenhum lançamento deste tipo em ${periodo}`,
      cortada,
    };
  }

  if (cortada) {
    return {
      titulo,
      descricao: `${visiveis} de ${carregados} lançamentos carregados de ${periodo} — há mais neste período`,
      cortada,
    };
  }

  return {
    titulo,
    descricao: `${visiveis} de ${carregados} ${plural(
      carregados,
      "lançamento",
      "lançamentos"
    )} em ${periodo}`,
    cortada,
  };
}
