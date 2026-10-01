/**
 * As opcoes de divisao de uma despesa de grupo (HMO-190).
 *
 * A tela oferece "Divisao Igual", "Por Percentual", "Customizada" e as
 * sugestoes ("Divisao Proporcional", historica). Nenhuma delas funcionava:
 * toda despesa de grupo era gravada em partes IGUAIS, sem erro na tela. Quem
 * combinou 70/30 com a outra pessoa da casa via 50/50 gravado -- o mesmo
 * sintoma que a 007 ja tinha consertado no banco e que voltou pela camada do
 * app, por dois motivos independentes:
 *
 *   1. NOME DE CAMPO. A tela monta `custom_splits` no corpo do POST
 *      (expense-groups/[groupId]/page.tsx) e a rota lia `body.splits`. Como
 *      `body.splits` era sempre `undefined`, `temSplitsCustomizados` era
 *      sempre falso e o bloco que aplica a divisao combinada nunca executava.
 *      O rateio igualitario do trigger ficava, e a resposta era 200.
 *
 *   2. VOCABULARIO. `split-suggestions` devolve
 *      `type: 'equal' | 'proportional' | 'historical'`, e o CHECK de
 *      `group_transactions.split_type` aceita so `equal | percentage |
 *      custom`. Esse valor ia cru para o UPDATE, que tomava 23514 -- e a rota
 *      nao conferia o erro. Mesmo com o nome do campo corrigido, "Divisao
 *      Proporcional" continuaria caindo em partes iguais.
 *
 * POR QUE O TIPO TEM QUE SER TRADUZIDO, E NAO O CHECK AMPLIADO
 * -----------------------------------------------------------
 * `proportional` e `historical` nao sao uma terceira aritmetica: as duas
 * produzem uma lista de PORCENTAGENS (uma vem da configuracao do grupo, a
 * outra do historico de gastos). Para o banco, as duas sao `percentage` -- e e
 * a porcentagem gravada que `recalcular_partes_pendentes` (024) usa para
 * reescalar as partes quando o valor da despesa muda depois. Ampliar o CHECK
 * exigiria uma migration, e deixaria duas palavras novas que nenhum SQL do
 * projeto sabe interpretar, para descrever uma conta que ja tem nome.
 *
 * POR QUE `equal` NAO REESCREVE NADA
 * ----------------------------------
 * Para divisao igual, esta funcao devolve `partes: null`: o trigger
 * `calculate_equal_split` (001, corrigido no 007) ja dividiu em centavos
 * inteiros pelo metodo do maior resto, e a soma fecha o valor exato da
 * despesa. A sugestao "Divisao Igual" da tela calcula
 * `amount = total * percentage / 100` em ponto flutuante -- com tres membros,
 * R$ 100 viram 33,33 / 33,33 / 33,33 e somem R$ 0,01. Gravar os numeros da
 * tela em cima do que o banco fez seria TROCAR uma divisao exata por uma com
 * residuo, e e exatamente o residuo que a SECAO 3b da 007 tirou do caminho.
 *
 * ONDE O DINHEIRO TEM QUE FECHAR
 * ------------------------------
 * A soma das partes e o valor da despesa, sempre, em centavos inteiros. Uma
 * divisao que nao fecha deixa saldo residual que pagamento nenhum zera, e o
 * acerto de contas de `lib/settlement.ts` depende de a soma dos saldos do
 * grupo ser zero. Por isso:
 *
 *   * `custom` (valores digitados) e recusado se a soma nao der o total -- o
 *     usuario precisa saber que faltam R$ 10, nao descobrir pelo saldo torto
 *     tres semanas depois;
 *   * `percentage` NAO e recusado por centavo: a porcentagem e que manda, os
 *     valores sao derivados aqui pelo maior resto, e a soma fecha por
 *     construcao. Recusar seria impossivel de satisfazer -- 100/3 nao tem
 *     duas casas decimais.
 *
 * `toCents`/`toReais` vem de settlement.ts porque ela e a UNICA conversao
 * reais -> centavos do projeto.
 */

import { toCents, toReais } from "@/lib/settlement";

/**
 * Os tres valores que `group_transactions.split_type` aceita.
 *
 * Nao e uma escolha deste modulo: e o
 * `group_transactions_split_type_check` do 001. Gravar qualquer outra palavra
 * e 23514.
 */
export type TipoGravavel = "equal" | "percentage" | "custom";

/**
 * O que a tela pode pedir -- incluindo as duas palavras que so existem no
 * vocabulario das sugestoes.
 */
export type TipoPedido = TipoGravavel | "proportional" | "historical";

/**
 * Uma parte como ela chega do cliente: tudo opcional e tudo possivelmente
 * string, porque vem de `JSON.parse` de um corpo que esta funcao nao controla.
 */
export interface ParteRecebida {
  member_id?: unknown;
  percentage?: unknown;
  amount?: unknown;
}

/** Uma parte pronta para o INSERT: os tres campos obrigatorios da tabela. */
export interface ParteParaGravar {
  member_id: string;
  /** `numeric(5,2)`, com CHECK `> 0 AND <= 100`. */
  percentage: number;
  /** `numeric(15,2)`, na moeda da despesa. */
  amount: number;
}

export type Divisao =
  | {
      ok: true;
      splitType: "equal";
      /** `null` quer dizer "nao toque no rateio do trigger". */
      partes: null;
    }
  | { ok: true; splitType: "percentage" | "custom"; partes: ParteParaGravar[] }
  | { ok: false; erro: string };

/**
 * Traduz o tipo pedido pela tela para o que cabe na coluna.
 *
 * Tipo desconhecido devolve `null`, e NAO `'equal'`: cair em divisao igual por
 * nao entender a palavra e precisamente o defeito desta issue -- o silencio e
 * que fez R$ 300 virarem 150/150 sem ninguem notar.
 */
export function tipoGravavel(tipo: unknown): TipoGravavel | null {
  const normalizado = String(tipo ?? "")
    .trim()
    .toLowerCase();

  switch (normalizado) {
    case "":
    case "equal":
      return "equal";
    case "custom":
      return "custom";
    // As tres viram `percentage`: todas sao uma lista de porcentagens, e e a
    // porcentagem que o recalculo da 024 reescala depois.
    case "percentage":
    case "proportional":
    case "historical":
      return "percentage";
    default:
      return null;
  }
}

/** Numero utilizavel a partir de `number | string | null | undefined`. */
function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(String(valor).trim());
  return Number.isFinite(n) ? n : null;
}

function dinheiroBR(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Quanto a porcentagem pode faltar para 100 antes de a divisao ser recusada.
 *
 * Meio ponto percentual cobre o arredondamento de duas casas de uma lista
 * grande (dez membros a 9,99% somam 99,90) sem chegar perto de aceitar uma
 * divisao realmente incompleta -- 70/20 erra por DEZ pontos e e recusado.
 */
const TOLERANCIA_PERCENTUAL = 0.5;

/**
 * A divisao que vai ser gravada, ou o motivo de nao dar.
 *
 * `total` e o valor da despesa na moeda dela (sinal nao importa: a parte e
 * sempre positiva, a convencao de despesa negativa vale para
 * `financial_transactions.amount`).
 */
export function divisaoParaGravar(entrada: {
  tipo: unknown;
  partes: unknown;
  total: unknown;
}): Divisao {
  const splitType = tipoGravavel(entrada.tipo);

  if (splitType === null) {
    return {
      ok: false,
      erro: `Tipo de divisão desconhecido: "${String(entrada.tipo)}".`,
    };
  }

  // Divisao igual nao reescreve o rateio do trigger -- ver o cabecalho. Sai
  // antes de validar `partes` de proposito: a sugestao "Divisao Igual" manda
  // valores, e eles sao legitimamente ignorados.
  if (splitType === "equal") {
    return { ok: true, splitType: "equal", partes: null };
  }

  const totalCents = Math.abs(toCents(numero(entrada.total) ?? 0));
  if (totalCents <= 0) {
    return {
      ok: false,
      erro: "Informe o valor da despesa antes de escolher a divisão.",
    };
  }

  if (!Array.isArray(entrada.partes) || entrada.partes.length === 0) {
    // O caso de escolher "Por Percentual" no seletor e nao escolher uma
    // sugestao: antes disto, a despesa era gravada em partes iguais e a tela
    // dizia "Despesa adicionada com sucesso!".
    return {
      ok: false,
      erro: "Escolha quanto cada membro paga para usar esta divisão.",
    };
  }

  const recebidas = entrada.partes as ParteRecebida[];
  const membros: string[] = [];

  for (const parte of recebidas) {
    const memberId =
      typeof parte?.member_id === "string" ? parte.member_id.trim() : "";

    if (!memberId) {
      return { ok: false, erro: "Divisão com membro não identificado." };
    }
    if (membros.includes(memberId)) {
      // Duas linhas para o mesmo membro passariam no INSERT (nao ha indice
      // unico) e cobrariam dele duas vezes.
      return { ok: false, erro: "A divisão repete o mesmo membro." };
    }
    membros.push(memberId);
  }

  if (splitType === "custom") {
    return divisaoPorValor(recebidas, membros, totalCents);
  }
  return divisaoPorPorcentagem(recebidas, membros, totalCents);
}

/**
 * `custom`: quem manda sao os VALORES digitados, e eles tem que somar a
 * despesa. A porcentagem e derivada para o recalculo da 024 ter o que
 * reescalar.
 */
function divisaoPorValor(
  recebidas: ParteRecebida[],
  membros: string[],
  totalCents: number
): Divisao {
  const centsPorParte: number[] = [];

  for (const parte of recebidas) {
    const valor = numero(parte?.amount);
    if (valor === null) {
      return { ok: false, erro: "Informe o valor de cada parte da divisão." };
    }

    const cents = Math.abs(toCents(valor));
    if (cents <= 0) {
      // `percentage` tem CHECK `> 0`, entao parte de R$ 0 nao entra no banco de
      // jeito nenhum -- e a mensagem do CHECK nao diz a quem lanca o que fazer.
      return {
        ok: false,
        erro: "Parte de R$ 0,00 na divisão: remova o membro ou informe o valor.",
      };
    }
    centsPorParte.push(cents);
  }

  const soma = centsPorParte.reduce((acc, c) => acc + c, 0);
  if (soma !== totalCents) {
    const diferenca = toReais(Math.abs(soma - totalCents));
    const palavra = soma < totalCents ? "faltam" : "sobram";
    return {
      ok: false,
      erro: `As partes somam ${dinheiroBR(
        toReais(soma)
      )} e a despesa é de ${dinheiroBR(
        toReais(totalCents)
      )} — ${palavra} ${dinheiroBR(diferenca)}.`,
    };
  }

  return {
    ok: true,
    splitType: "custom",
    partes: membros.map((member_id, i) => ({
      member_id,
      percentage: percentagemGravavel((centsPorParte[i] * 100) / totalCents),
      amount: toReais(centsPorParte[i]),
    })),
  };
}

/**
 * `percentage` (e as sugestoes proporcional e historica): quem manda sao as
 * PORCENTAGENS, e os valores sao derivados aqui em centavos inteiros pelo
 * metodo do maior resto -- o mesmo do `calculate_equal_split` da 007, pela
 * mesma razao: a soma tem que fechar o total exato.
 */
function divisaoPorPorcentagem(
  recebidas: ParteRecebida[],
  membros: string[],
  totalCents: number
): Divisao {
  const percentuais: number[] = [];

  for (const parte of recebidas) {
    const pct = numero(parte?.percentage);
    if (pct === null) {
      return {
        ok: false,
        erro: "Informe o percentual de cada membro na divisão.",
      };
    }
    if (pct <= 0 || pct > 100) {
      return {
        ok: false,
        erro: `Percentual inválido na divisão: ${dinheiroBR(pct)}%.`,
      };
    }
    percentuais.push(pct);
  }

  const soma = percentuais.reduce((acc, p) => acc + p, 0);
  if (Math.abs(soma - 100) > TOLERANCIA_PERCENTUAL) {
    return {
      ok: false,
      erro: `Os percentuais somam ${dinheiroBR(soma)}% e precisam somar 100%.`,
    };
  }

  // Maior resto sobre a soma REAL, e nao sobre 100: com percentuais que somam
  // 99,90 por arredondamento, dividir por 100 jogaria um centavo a mais no
  // resto e o ultimo membro absorveria a diferenca inteira. Normalizar pela
  // soma mantem a proporcao pedida e deixa para o resto so o centavo.
  const brutos = percentuais.map((p) => (totalCents * p) / soma);
  const base = brutos.map((b) => Math.floor(b));
  let sobra = totalCents - base.reduce((acc, b) => acc + b, 0);

  // O centavo extra vai para quem tem o maior resto; empate decide pela ordem
  // do `member_id`, que e arbitraria mas ESTAVEL -- a mesma escolha que a 007
  // fez com `ORDER BY gm.id`, para o resultado nao depender da ordem em que o
  // cliente montou a lista.
  const ordem = brutos
    .map((b, i) => ({ i, resto: b - Math.floor(b), membro: membros[i] }))
    .sort((a, b) =>
      b.resto !== a.resto
        ? b.resto - a.resto
        : a.membro < b.membro
          ? -1
          : a.membro > b.membro
            ? 1
            : 0
    );

  const cents = [...base];
  for (const { i } of ordem) {
    if (sobra <= 0) break;
    cents[i] += 1;
    sobra -= 1;
  }

  return {
    ok: true,
    splitType: "percentage",
    partes: membros.map((member_id, i) => ({
      member_id,
      percentage: percentagemGravavel(percentuais[i]),
      amount: toReais(cents[i]),
    })),
  };
}

/**
 * A porcentagem como `numeric(5,2)` com CHECK `> 0 AND <= 100`.
 *
 * O piso de 0,01 cobre a parte minuscula: R$ 0,01 de uma despesa de R$ 500 da
 * 0,002%, que arredondaria para 0,00 e derrubaria o INSERT inteiro com uma
 * mensagem sobre `percentage` que nao diz nada a quem lancou a despesa.
 *
 * NAO HA TETO AQUI, DE PROPOSITO
 * ------------------------------
 * Passar de 100 e inalcancavel: `divisaoPorPorcentagem` recusa `pct > 100`
 * antes de chegar aqui, e no caminho `custom` a parte de um membro so ultrapassa
 * o total se a soma nao fechar -- que tambem e recusado antes. Um
 * `Math.min(100, ...)` aqui seria uma trava sobre estado impossivel: nenhum
 * teste conseguiria distinguir ela de nada (foi um mutante sobrevivente), e ela
 * esconderia o dia em que uma validacao acima parar de valer.
 */
function percentagemGravavel(pct: number): number {
  const duasCasas = Math.round(pct * 100) / 100;
  return Math.max(0.01, duasCasas);
}
