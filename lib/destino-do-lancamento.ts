// -----------------------------------------------------------------------------
// PARA ONDE O DINHEIRO FOI (HMO-215)
// -----------------------------------------------------------------------------
// A lista de Financas Pessoais mostrava o tipo, o valor, a categoria e a data de
// cada lancamento. Nao mostrava A CONTA -- e `account_id` esta na linha desde o
// 001_baseline, selecionado pelo `*` da consulta, sem nenhum leitor.
//
// O que isso custava, em tres casos que a tela produzia todo dia:
//
// 1. UMA TRANSFERENCIA NAO DIZIA ENTRE QUAIS CONTAS. As duas pernas aparecem
//    como duas linhas com a MESMA descricao e o mesmo valor, uma verde e uma
//    vermelha, com o selo "Transferência" nas duas. Qual delas saiu da corrente
//    e qual entrou na poupanca? A tela nao tinha a informacao na tela. Quem
//    confere o extrato de uma conta contra o app nao tinha como casar as linhas.
//
// 2. DUAS DESPESAS IGUAIS EM CONTAS DIFERENTES ERAM A MESMA LINHA, DUAS VEZES.
//    "Mercado / R$ 180,00 / Alimentação / 12/09" no cartao e "Mercado /
//    R$ 180,00 / Alimentação / 12/09" no debito tem exatamente a mesma cara --
//    e a conclusao natural de quem le e que a despesa foi lancada em duplicata.
//    O caminho dessa conclusao termina em alguem apagando uma despesa real.
//
// 3. A FATURA DO CARTAO. Um gasto no cartao e um gasto no debito entram no mes
//    de formas diferentes: um vira divida que vence depois, o outro sai do saldo
//    hoje. Sem a conta na linha, a lista nao distingue os dois.
//
// A REGRA NAO MORA NO JSX, E O MOTIVO E O SENTIDO
// -----------------------------------------------
// "O destino" nao e um campo: e uma leitura que depende do tipo da linha. Em uma
// receita a conta e PARA ONDE o dinheiro foi; em uma despesa, DE ONDE ele saiu;
// em uma transferencia as duas pontas existem e estao em DUAS LINHAS
// DIFERENTES do banco, ligadas por `counterpart_transaction_id` (015).
//
// Escrito no JSX, isso seria um ternario sobre o sinal do valor -- e o sinal e
// exatamente a fonte que a HMO-162 ja provou insuficiente: a perna de saida de
// uma transferencia e negativa igual a uma despesa. Um ternario sobre o sinal
// rotularia "de Nubank" uma linha que de fato e "Itaú → Nubank", e ninguem
// olhando a tela saberia que esta errado.
//
// O QUE ESTE ARQUIVO NUNCA FAZ: INVENTAR A PONTA QUE FALTA
// -------------------------------------------------------
// A contraparte de uma transferencia pode nao estar carregada -- a paginacao
// corta em 50 linhas e as duas pernas podem cair em paginas diferentes. Nesse
// caso a frase fala SO da ponta conhecida ("saiu de Itaú") em vez de desenhar
// uma seta com um lado em branco. Uma seta pela metade convida a completar com
// o palpite errado; "saiu de Itaú" e menos informacao, nao informacao falsa.
// -----------------------------------------------------------------------------

import { classificarMovimentacao } from "@/lib/movimentacoes";
import type { MovimentacaoBruta } from "@/lib/movimentacoes";

/** O que a frase precisa saber da conta. `name` e o que aparece na tela. */
export interface ContaDoLancamento {
  id: string;
  name: string;
  account_type?: string | null;
}

/**
 * Uma linha de `financial_transactions` com o embed da conta.
 *
 * `account` e opcional e pode vir `null`: `account_id` e nullable no 001, e
 * linhas antigas (e as de grupo, que a tela de grupo grava sem conta) nao tem
 * conta nenhuma. Tratar isso como erro esconderia a linha; aqui ele vira uma
 * frase que admite a falta.
 */
export interface LancamentoComConta extends MovimentacaoBruta {
  id: string;
  account_id?: string | null;
  counterpart_transaction_id?: string | null;
  account?: ContaDoLancamento | null;
}

/** A frase da linha, e o que ela sabe. */
export interface DestinoDoLancamento {
  /** De onde o dinheiro saiu, quando essa ponta e conhecida. */
  origem: string | null;
  /** Para onde o dinheiro foi, quando essa ponta e conhecida. */
  destino: string | null;
  /** O que a linha mostra. Nunca vazio. */
  texto: string;
  /**
   * A linha nao tem conta registrada (ou a RLS nao devolveu o nome dela).
   *
   * A tela usa isto para apagar a frase em vez de afirmar: "Sem conta" dito em
   * cinza e uma informacao, "Sem conta" dito igual a "Itaú" e um nome de conta
   * inventado.
   */
  faltaConta: boolean;
}

/**
 * As duas pernas de cada transferencia, achaveis pelas duas pontas.
 *
 * SAO DOIS MAPAS, E OS DOIS PRECISAM EXISTIR. O elo do 015 e de uma via so:
 * quem grava `counterpart_transaction_id` e a perna de ENTRADA, apontando para a
 * de saida (ver app/api/movimentacoes/transferencia/route.ts). A perna de saida
 * fica com a coluna NULL.
 *
 * Com um mapa so -- `porId`, do jeito obvio -- metade das transferencias da tela
 * perderia a contraparte: toda linha vermelha de transferencia cairia no ramo
 * "nao sei a outra ponta". E e justamente a vermelha que a pessoa esta olhando
 * quando pergunta para onde o dinheiro foi.
 */
export interface IndiceDeContraparte {
  /** id -> linha. */
  porId: Map<string, LancamentoComConta>;
  /** id da perna de SAIDA -> a perna de entrada que aponta para ela. */
  porContraparte: Map<string, LancamentoComConta>;
}

export function indiceDeContraparte(
  lancamentos: LancamentoComConta[]
): IndiceDeContraparte {
  const porId = new Map<string, LancamentoComConta>();
  const porContraparte = new Map<string, LancamentoComConta>();

  for (const mov of lancamentos) {
    porId.set(mov.id, mov);
    if (mov.counterpart_transaction_id) {
      porContraparte.set(mov.counterpart_transaction_id, mov);
    }
  }

  return { porId, porContraparte };
}

/** Um indice vazio, para quem chama com uma linha solta (um teste, um detalhe). */
export function indiceVazio(): IndiceDeContraparte {
  return { porId: new Map(), porContraparte: new Map() };
}

/**
 * A outra perna desta transferencia, ou `null` se ela nao esta carregada.
 *
 * As duas direcoes sao tentadas porque o elo e de uma via (ver
 * `IndiceDeContraparte`). O `?? null` no fim e explicito: `Map.get` devolve
 * `undefined`, e `undefined` em um campo opcional de `DestinoDoLancamento` se
 * confundiria com "a chave nao existe".
 */
export function contraparteDe(
  mov: LancamentoComConta,
  indice: IndiceDeContraparte
): LancamentoComConta | null {
  if (mov.counterpart_transaction_id) {
    const apontada = indice.porId.get(mov.counterpart_transaction_id);
    if (apontada) return apontada;
  }
  return indice.porContraparte.get(mov.id) ?? null;
}

/** O nome da conta de uma linha, ou `null` quando ele nao veio. */
function nomeDaConta(mov: LancamentoComConta | null): string | null {
  const nome = mov?.account?.name;
  return typeof nome === "string" && nome.trim() ? nome.trim() : null;
}

const SEM_CONTA = "Sem conta";

/**
 * A frase de destino de uma linha da lista.
 *
 * Receita: a conta e o DESTINO -- o dinheiro entrou nela.
 * Despesa: a conta e a ORIGEM -- o dinheiro saiu dela (ou a divida nasceu nela,
 *   no caso do cartao; a frase e a mesma porque o fato que a pessoa procura e o
 *   mesmo: por onde passou).
 * Transferencia: as duas pontas, quando as duas linhas estao carregadas.
 *
 * O SENTIDO DA TRANSFERENCIA SAI DO SINAL, E NAO DO ELO. `counterpart_...` so
 * diz que duas linhas sao par; nao diz qual pagou. O sinal diz, e e a convencao
 * do banco (`pernasDaTransferencia`: `-total` na origem, `+total` no destino).
 *
 * `amount === 0` e o unico caso em que o sinal nao responde, e ele nao recebe
 * palpite: a frase lista as duas contas SEM a seta. Uma seta para o lado errado
 * em uma transferencia e a classe de erro que este projeto ja pagou duas vezes
 * -- ela se le como fato e nao tem sintoma nenhum.
 */
export function destinoDoLancamento(
  mov: LancamentoComConta,
  indice: IndiceDeContraparte = indiceVazio()
): DestinoDoLancamento {
  const minha = nomeDaConta(mov);
  const tipo = classificarMovimentacao(mov);

  if (tipo !== "transfer") {
    if (!minha) {
      return { origem: null, destino: null, texto: SEM_CONTA, faltaConta: true };
    }

    return tipo === "income"
      ? { origem: null, destino: minha, texto: `para ${minha}`, faltaConta: false }
      : { origem: minha, destino: null, texto: `de ${minha}`, faltaConta: false };
  }

  const outra = nomeDaConta(contraparteDe(mov, indice));

  // Nem a propria conta: nao ha nada de verdadeiro a dizer sobre o caminho.
  if (!minha && !outra) {
    return { origem: null, destino: null, texto: SEM_CONTA, faltaConta: true };
  }

  // Valor zero: o par existe e nada se moveu. Sem direcao para afirmar.
  if (mov.amount === 0) {
    return {
      origem: null,
      destino: null,
      texto: outra ? `entre ${minha ?? SEM_CONTA} e ${outra}` : `em ${minha}`,
      faltaConta: false,
    };
  }

  const souASaida = mov.amount < 0;
  const origem = souASaida ? minha : outra;
  const destino = souASaida ? outra : minha;

  // As duas pontas: a seta e a frase mais curta que conta a historia inteira.
  if (origem && destino) {
    return { origem, destino, texto: `${origem} → ${destino}`, faltaConta: false };
  }

  // Uma ponta so. A frase sai de QUAL ponta e conhecida, e nao de qual perna
  // esta sendo desenhada -- as duas coisas se separam quando a perna da tela e
  // a que esta sem conta: uma saida sem conta cuja contraparte entrou no Nubank
  // tem "Nubank" como destino, e dizer "saiu de Nubank" ali seria o caminho ao
  // contrario. A frase nomeia o sentido em palavras em vez de desenhar meia
  // seta -- ver o cabecalho deste arquivo.
  if (origem) {
    return { origem, destino: null, texto: `saiu de ${origem}`, faltaConta: false };
  }
  if (destino) {
    return { origem: null, destino, texto: `entrou em ${destino}`, faltaConta: false };
  }

  // Inalcancavel pela guarda de `!minha && !outra` la acima, e escrito assim
  // para o tipo fechar sem um `!`: um `${destino!}` imprimiria a string "null"
  // na tela no dia em que aquela guarda mudasse.
  return { origem: null, destino: null, texto: SEM_CONTA, faltaConta: true };
}
