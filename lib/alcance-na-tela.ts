// ---------------------------------------------------------------------------
// O QUE A PERGUNTA DO ALCANCE DIZ NA TELA (HMO-228)
// ---------------------------------------------------------------------------
// As duas series -- a conta fixa e a parcela de cartao -- fazem a MESMA pergunta
// a pessoa, e e por isso que as palavras dela moram num lugar so. Duas copias
// divergiriam na primeira correcao de texto, e a pessoa aprenderia duas regras
// onde havia uma.
//
// POR QUE ISTO E UM MODULO PURO, E NAO TEXTO DENTRO DO JSX
// -------------------------------------------------------
// O `Select` do Radix nao renderiza o valor escolhido no servidor (o
// `SelectValue` depende de efeito de cliente), entao um teste que renderize o
// dialogo com `react-dom/server` ve o gatilho VAZIO -- e passaria a afirmar
// qualquer coisa sobre o rotulo da opcao selecionada. Com a regra aqui, a
// escolha do texto e verificavel sem navegador e sem harness de React.
//
// E a consequencia declarada e o conteudo que mais importa desta tela: o
// alcance "desta em diante" muda o TOTAL da compra, e uma tela que nao diz isso
// passa a afirmar um total que o banco nao tem.
// ---------------------------------------------------------------------------

import type { AlcanceDaEdicao } from "@/lib/recorrencia-edicao";
import type { AlcanceDaParcela } from "@/lib/parcelas-edicao";

/**
 * Os dois tipos de serie sao o MESMO conjunto de strings, de proposito (ver o
 * cabecalho de parcelas-edicao.ts). Este alias existe para que este modulo
 * possa falar das duas sem escolher uma.
 */
export type Alcance = AlcanceDaEdicao & AlcanceDaParcela;

/** Qual serie, para a pergunta usar o substantivo certo. */
export type TipoDeSerie = "conta_fixa" | "parcela";

/** Apagar ou alterar: a consequencia de cada alcance e diferente nos dois. */
export type Acao = "alterar" | "apagar";

export interface OpcaoDeAlcance {
  valor: Alcance;
  /** O texto do item. Curto: ele tem de caber no gatilho do Select no celular. */
  rotulo: string;
  /**
   * A frase abaixo do Select, que explica o que ESTE alcance faz. Ela muda com
   * a opcao escolhida, e nao e a mesma para apagar e para alterar: "muda este
   * mes" e "tira este mes da agenda" sao consequencias diferentes.
   */
  consequencia: string;
}

/**
 * As tres opcoes, com as palavras de cada caso.
 *
 * `ancora` e o rotulo da ocorrencia clicada -- a data, numa conta fixa; o
 * numero, numa parcela. Ele entra no rotulo de "apenas esta" porque e o unico
 * lugar da tela que diz QUAL linha vai mudar: sem ele, "apenas esta" num
 * dialogo aberto por um menu de contexto nao identifica nada.
 */
export function opcoesDeAlcance(entrada: {
  tipo: TipoDeSerie;
  acao: Acao;
  ancora: string;
  /** M, so na parcela. Entra no rotulo de "todas" ("todas as 10"). */
  totalDeParcelas?: number | null;
  /**
   * O pedido MOVE a parcela de fatura (HMO-357)?
   *
   * As consequencias de alterar o VALOR e de MOVER sao frases diferentes, e as
   * do valor estariam erradas aqui: "as anteriores ficam com o valor antigo,
   * então o total da compra deixa de ser..." nao descreve nada do que acontece
   * quando a pessoa troca a parcela de fatura -- o total da compra nao muda ao
   * mover. O que muda e a colocacao, e o que a pessoa precisa saber e que a
   * CADENCIA e preservada (cada parcela anda a partir da fatura dela) e que
   * "apenas esta" deixa duas parcelas na mesma fatura.
   *
   * So tem efeito na parcela e na acao de alterar: nao ha "mover" numa conta
   * fixa (mudar a data de uma ocorrencia nao desloca a regra) nem em apagar.
   */
  movendo?: boolean;
}): OpcaoDeAlcance[] {
  const { tipo, acao, ancora, totalDeParcelas, movendo = false } = entrada;
  const ehParcela = tipo === "parcela";

  const todasRotulo =
    ehParcela && totalDeParcelas
      ? `Todas as ${totalDeParcelas} parcelas`
      : ehParcela
        ? "Todas as parcelas"
        : "Todas as ocorrências";

  if (acao === "apagar") {
    return [
      {
        valor: "apenas_esta",
        rotulo: `Apenas esta (${ancora})`,
        consequencia: ehParcela
          ? "Só esta parcela é apagada. As outras continuam nas faturas delas, e o total da compra diminui."
          : "Só este mês sai da agenda. O gasto fixo continua ativo e os outros meses continuam vindo.",
      },
      {
        valor: "esta_e_proximas",
        rotulo: "Esta e as próximas",
        consequencia: ehParcela
          ? "Esta e as parcelas seguintes são apagadas. As anteriores ficam, e o total da compra passa a ser só o que sobrou."
          : "Esta e os meses seguintes saem da agenda, E o gasto fixo é encerrado nesta data — sem isso ele voltaria a gerar contas alguns meses depois. Meses anteriores e já pagos não são tocados.",
      },
      {
        valor: "todas",
        rotulo: todasRotulo,
        consequencia: ehParcela
          ? "A compra inteira é apagada, com todas as parcelas. Parcelas em fatura já paga não são apagadas."
          : "O gasto fixo é encerrado e as ocorrências em aberto saem da agenda. O que já foi pago permanece no histórico.",
      },
    ];
  }

  // MOVER TEM AS PROPRIAS CONSEQUENCIAS (HMO-357)
  //
  // Elas vem antes das de valor porque sao outro conjunto de fatos, e nao uma
  // variacao de texto: ao mover, o total da compra NAO muda, a cadencia de um
  // mes e o que esta em jogo, e "apenas esta" produz o estado que a issue
  // existe para evitar -- duas parcelas na mesma fatura.
  if (ehParcela && movendo) {
    return [
      {
        valor: "apenas_esta",
        rotulo: `Apenas esta (${ancora})`,
        consequencia:
          "Só esta parcela muda de fatura. As outras ficam onde estão — duas parcelas podem acabar na mesma fatura e um mês pode ficar sem nenhuma.",
      },
      {
        valor: "esta_e_proximas",
        rotulo: "Esta e as próximas",
        consequencia:
          "Esta e as seguintes andam juntas, cada uma a partir da fatura dela, mantendo um mês entre as parcelas. As anteriores ficam onde estão.",
      },
      {
        valor: "todas",
        rotulo: todasRotulo,
        consequencia:
          "A compra inteira anda junto, mantendo um mês entre as parcelas. Parcelas em fatura já paga não são movidas.",
      },
    ];
  }

  return [
    {
      valor: "apenas_esta",
      rotulo: `Apenas esta (${ancora})`,
      consequencia: ehParcela
        ? "Só esta parcela muda. As outras ficam como estão."
        : "Só este mês muda. O gasto fixo continua com o valor de hoje.",
    },
    {
      valor: "esta_e_proximas",
      rotulo: "Esta e as próximas",
      consequencia: ehParcela
        ? "Muda desta parcela em diante. As anteriores ficam com o valor antigo, então o total da compra deixa de ser o valor da parcela vezes o número de parcelas."
        : "Muda este mês, os seguintes ainda em aberto e o próprio gasto fixo. Meses anteriores e já pagos não são alterados.",
    },
    {
      valor: "todas",
      rotulo: todasRotulo,
      consequencia: ehParcela
        ? "Muda todas as parcelas da compra. Parcelas em fatura já paga não são alteradas."
        : "Muda todas as ocorrências em aberto, inclusive as de meses anteriores que ainda não foram pagas, e o próprio gasto fixo. O que já foi pago não é alterado.",
    },
  ];
}

/**
 * A consequencia da opcao escolhida.
 *
 * Funcao separada de `opcoesDeAlcance` porque e ela que o teste de servidor
 * consegue cobrar: o `SelectValue` do Radix sai vazio no render de servidor,
 * mas esta frase e texto comum e aparece.
 *
 * Devolve string vazia -- e nao `undefined` -- para um alcance desconhecido:
 * um `undefined` renderizado no JSX desaparece em silencio, e a tela ficaria
 * sem a declaracao exatamente no caso em que algo esta errado.
 */
export function consequenciaNaTela(
  alcance: string,
  opcoes: OpcaoDeAlcance[]
): string {
  return opcoes.find((o) => o.valor === alcance)?.consequencia ?? "";
}

/**
 * A pergunta "o valor digitado e de cada parcela ou o total da compra?" tem de
 * ser feita?
 *
 * So na serie de cartao, so quando o valor muda e so quando o alcance pega mais
 * de uma parcela. Em "apenas esta" nao ha ambiguidade -- uma parcela so, o
 * numero e ela --, e fazer a pergunta ali ensinaria a pessoa a ignora-la.
 */
export function precisaPerguntarBase(entrada: {
  tipo: TipoDeSerie;
  alcance: string;
  mudaValor: boolean;
}): boolean {
  return (
    entrada.tipo === "parcela" &&
    entrada.mudaValor &&
    entrada.alcance !== "apenas_esta"
  );
}

/**
 * Quantas ficaram de fora, em frase, para o toast depois de salvar.
 *
 * A issue exige que a contagem apareca na resposta da rota E na tela. Os dois
 * numeros vem separados porque sao duas coisas: `preservadas` e consequencia do
 * alcance escolhido; `porFaturaPaga` (ou o pago, na conta fixa) e uma RECUSA que
 * a pessoa nao pediu, e e ela que explica um total diferente do esperado.
 *
 * `null` quando nao ha nada a dizer -- um toast que sempre termina com
 * "0 ficaram de fora" treina a pessoa a nao ler o fim da frase.
 */
export function frasePreservadas(entrada: {
  preservadas: number;
  porFaturaPaga?: number;
}): string | null {
  const { preservadas, porFaturaPaga = 0 } = entrada;
  if (preservadas <= 0) return null;

  const fora = `${preservadas} ficaram como estavam`;

  if (porFaturaPaga > 0) {
    return `${fora} — ${porFaturaPaga} em fatura já paga.`;
  }
  return `${fora}.`;
}
