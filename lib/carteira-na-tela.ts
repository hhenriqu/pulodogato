// =====================================================
// A CARTEIRA POR CONTA, COMPOSTA NA TELA (HMO-438, fase 4 de 6 da HMO-432)
// =====================================================
// A Fase 2 proibiu `GET /api/investments` de falar com o Banco Central, e a
// Fase 3 pos o rendimento no valor da conta. A consequencia das duas juntas e
// que ninguem no SERVIDOR compoe o numero que a tela de investimentos e a tela
// de contas precisam mostrar: a posicao vem de uma rota e o rendimento de
// outra. Este arquivo e a juncao, e ele e PURO -- nao busca nada.
//
// POR QUE A COMPOSICAO E AQUI E NAO NUMA ROTA NOVA
// -----------------------------------------------
// Uma rota que juntasse as duas teria de falar com o SGS, e ai ela herdaria o
// defeito que a Fase 2 removeu: um timeout do Banco Central derrubando a
// carteira de quem nao tem um centavo em renda fixa. Compondo no cliente, as
// duas idas sao independentes -- a segunda falha e a tela mostra a carteira
// pelo CUSTO com um aviso, que e exatamente o que a issue pede. O preco e este
// arquivo, e e um preco que se paga uma vez.
//
// E NENHUMA ARITMETICA DE DINHEIRO MORA AQUI
// ------------------------------------------
// A soma por conta e `valorDaCarteiraPorConta` (lib/investments.ts) e o valor
// de cada papel de renda fixa e `valorProjetadoPorAtivo` (lib/renda-fixa.ts) --
// as duas com suite propria e prova de mutacao. Este modulo so ENCAMINHA: ele
// monta o `contaPorAtivo` a partir do `account_id` que as rotas trazem e passa
// adiante. Uma terceira implementacao da soma aqui e literalmente como nascem
// duas telas que discordam -- e o par delas ja existe no servidor
// (`lib/services/carteira-da-conta.ts`, que faz a MESMA composicao para o
// patrimonio). Os dois caminhos chamam as mesmas duas funcoes de proposito:
// e isso que mantem `/dashboard/contas` e `/dashboard/net-worth` dizendo o
// mesmo numero.
//
// O ESTADO "O RENDIMENTO NAO VEIO" E UM CAMPO, E NAO A AUSENCIA DE UM
// ------------------------------------------------------------------
// `rendimentoIndisponivel` existe porque os dois estados abaixo produzem
// numeros IDENTICOS e pedem frases diferentes na tela:
//
//   - a carteira nao tem renda fixa nenhuma: nada a avisar;
//   - a carteira tem renda fixa e a rota do rendimento falhou: os papeis estao
//     avaliados PELO CUSTO, e a tela tem de dizer isso.
//
// Sem o campo, a tela so veria `rendimento: 0` nos dois casos e teria de
// escolher entre avisar sempre (e ensinar a pessoa a nao ler aviso) ou nunca
// avisar (e deixar um valor defasado passando por valor de hoje). Ver
// `canal-opcional-fica-desligado-sem-sintoma`.
// =====================================================

import {
  posicoesAbertas,
  valorDaCarteiraPorConta,
  type CarteiraDaConta,
  type Posicao,
} from "@/lib/investments";
import { valorProjetadoPorAtivo, type Projecao } from "@/lib/renda-fixa";

/**
 * O ativo como as duas rotas o devolvem, reduzido ao que a composicao usa.
 *
 * `account_id` e OPCIONAL no tipo, e isso nao e frouxidao: a resposta guardada
 * no cache offline de antes da 059 nao tem o campo, e um tipo que o exigisse
 * faria a tela nao compilar com o dado que ela de fato recebe. Ausente e
 * tratado como `null` -- ativo solto --, que e o mesmo default da coluna.
 */
export interface AtivoComConta {
  id: string;
  type?: string | null;
  account_id?: string | null;
}

/** O que `GET /api/investments` devolve, reduzido ao que a composicao usa. */
export interface CarteiraDaRota {
  assets: AtivoComConta[];
  positions: Posicao[];
}

/**
 * O que `GET /api/investments/renda-fixa` devolve, reduzido.
 *
 * As projecoes vem com `account_id` desde a HMO-436, e ele e IGNORADO aqui de
 * proposito: o elo que manda e o de `assets`, que e a lista completa (inclusive
 * acao e fundo). Ler a conta das projecoes faria a conta com uma PETR4 atrelada
 * e nenhum CDB desaparecer do agrupamento.
 */
export interface RendaFixaDaRota {
  projections: Projecao[];
}

export interface CarteiraPorConta {
  /** Uma linha por conta de investimento com ativo atrelado. Ordem determinista. */
  porConta: CarteiraDaConta[];
  /** A carteira que nao esta atrelada a conta nenhuma. `null` quando nao ha. */
  solta: CarteiraDaConta | null;
  /**
   * Ha renda fixa na carteira e o rendimento NAO veio: os papeis estao
   * avaliados pelo custo. Ver o cabecalho.
   */
  rendimentoIndisponivel: boolean;
  /** Posicoes de renda fixa que entraram sem rendimento, somadas. */
  semRendimento: number;
  /** Posicoes de outro tipo avaliadas pelo custo por falta de preco. */
  semPreco: number;
}

/** O vazio, com a mesma FORMA do caso cheio -- ver `comporCarteiraPorConta`. */
function vazia(): CarteiraPorConta {
  return {
    porConta: [],
    solta: null,
    rendimentoIndisponivel: false,
    semRendimento: 0,
    semPreco: 0,
  };
}

/**
 * Junta as duas respostas das rotas no valor da carteira de cada conta.
 *
 * `carteira` nulo e "a primeira ida ainda nao voltou (ou falhou)", e devolve o
 * vazio -- a tela nao tem posicao nenhuma para mostrar de todo jeito.
 *
 * `rendaFixa` nulo e o caso que a issue nomeia: o SGS demorou ou caiu. A
 * resposta NAO e vazia; ela sai com os mesmos ativos avaliados pelo custo
 * (`valorDaCarteiraPorConta` sem o terceiro argumento ja faz exatamente isso) e
 * com `rendimentoIndisponivel` ligado quando havia renda fixa para projetar.
 */
export function comporCarteiraPorConta(
  carteira: CarteiraDaRota | null | undefined,
  rendaFixa: RendaFixaDaRota | null | undefined
): CarteiraPorConta {
  if (!carteira) return vazia();

  const posicoes = carteira.positions || [];
  const ativos = carteira.assets || [];

  const contaPorAtivo: Record<string, string | null> = {};
  for (const a of ativos) contaPorAtivo[a.id] = a.account_id ?? null;

  // `projetado` e `null` -- e nao `{}` -- quando o rendimento nao veio.
  //
  // A diferenca e load-bearing: `valorDaCarteiraPorConta` consulta
  // `projetado[asset_id]` e cai no ramo de "outros tipos" quando nao acha. Um
  // objeto vazio produz o MESMO resultado, mas passar `null` e o que declara a
  // intencao no ponto da chamada -- e e o que o terceiro parametro opcional
  // daquela funcao foi desenhado para receber.
  const projetado = rendaFixa
    ? valorProjetadoPorAtivo(rendaFixa.projections || [])
    : null;

  const linhas = valorDaCarteiraPorConta(posicoes, contaPorAtivo, projetado);

  // As posicoes ABERTAS de renda fixa, pela mesma funcao que
  // `valorDaCarteiraPorConta` usa por dentro.
  //
  // Contar sobre `posicoes` cru daria um numero maior: uma posicao ENCERRADA de
  // renda fixa (resgatada) continua na lista e nao entra em conta nenhuma -- a
  // tela avisaria "ha papel avaliado pelo custo" sobre um papel que a pessoa
  // nao tem mais. E o tipo sai da POSICAO e nao de `assets` porque e a posicao
  // que diz o que sobrou; o par `assets`/`positions` discorda de proposito
  // (ver `posicoesAbertas`).
  const rendaFixaAberta = posicoesAbertas(posicoes).filter(
    (p) => p.type === "fixed_income"
  ).length;

  const somar = (campo: "semRendimento" | "semPreco") =>
    linhas.reduce((s, l) => s + l[campo], 0);

  return {
    porConta: linhas.filter((l) => l.account_id !== null),
    solta: linhas.filter((l) => l.account_id === null)[0] ?? null,
    rendimentoIndisponivel: !rendaFixa && rendaFixaAberta > 0,
    semRendimento: somar("semRendimento"),
    semPreco: somar("semPreco"),
  };
}

/**
 * A linha de UMA conta, ou `null` quando aquela conta nao tem ativo atrelado.
 *
 * `null` e o sinal de "esta conta nao muda", e e por ele que o cartao da conta
 * SEM ativo atrelado fica identico ao de hoje -- a exigencia que a issue
 * escreveu. Devolver uma linha zerada aqui faria toda conta corrente ganhar
 * tres linhas de carteira dizendo R$ 0,00.
 */
export function carteiraDaConta(
  composta: CarteiraPorConta,
  accountId: string
): CarteiraDaConta | null {
  if (!accountId) return null;
  return composta.porConta.filter((l) => l.account_id === accountId)[0] ?? null;
}
