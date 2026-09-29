/**
 * Orcamento de grupo: "quanto ja gastamos da viagem" (HMO-138).
 *
 * A migration 006 ja entregou `budgets.group_id`, e `budget_consumption` ja
 * soma o gasto de TODOS os membros quando o teto e de grupo (SECAO 5 do 006).
 * O que faltava era a tela -- e a tela nao e "mais uma linha na lista".
 *
 * POR QUE OS DOIS TETOS NAO PODEM DIVIDIR A MESMA SOMA
 * ---------------------------------------------------
 * `/api/budgets` devolve, numa lista so, o teto pessoal e o teto de cada grupo
 * de que a pessoa participa -- e a RLS do 006 faz isso de proposito. Somar a
 * lista inteira num "Ja gasto" produz um numero que nao responde pergunta
 * nenhuma:
 *
 *   - nao e o que EU gastei, porque inclui o que os outros membros gastaram
 *     na viagem (o teto de grupo soma o grupo todo);
 *   - nao e o que a VIAGEM gastou, porque inclui o meu mercado de casa;
 *   - e piora com gente: cada membro novo do grupo aumenta o numero que a tela
 *     chama de "quanto voce pode gastar".
 *
 * E o erro nao aparece. Os dois tetos tem exatamente as mesmas colunas, o
 * valor sai formatado em reais, a barra enche, e o unico sintoma e um total
 * alto demais que a pessoa atribui a ter gastado mesmo. Por isso a separacao
 * mora aqui, em funcao pura com teste, e nao num `.filter()` dentro do JSX.
 *
 * TUDO EM CENTAVOS INTEIROS
 * -------------------------
 * Mesma razao de `lib/settlement.ts` e `lib/grupos.ts`: somar seis tetos em
 * ponto flutuante deixa residuo, e "restam R$ 0,00" num orcamento fechado e um
 * estado que gasto nenhum resolve. `toCents` vem de settlement.ts porque ela e
 * a UNICA conversao reais -> centavos do projeto.
 */

import { toCents, toReais } from "@/lib/settlement";

/** Os tres estados que `budget_consumption.consumption_status` devolve. */
export type StatusDeConsumo = "ok" | "alert" | "exceeded";

/**
 * O minimo que este modulo le de cada linha de `/api/budgets`.
 *
 * Os numericos chegam do PostgREST como string (`numeric(15,2)` nao cabe em
 * double sem perda, entao o driver nao converte); por isso `number | string`
 * em vez de `number`, e `Number(...)` em toda leitura.
 */
export interface OrcamentoLido {
  id: string;
  /**
   * Ausente ou NULL = teto pessoal; preenchido = teto da casa/viagem.
   *
   * Opcional porque a coluna e nullable no banco e o `types/financial.ts` a
   * declara como `group_id?: string`. Aceitar as duas formas aqui evita o
   * `as unknown as` no ponto de chamada -- que e onde um dia entraria uma
   * conversao errada sem ninguem notar.
   */
  group_id?: string | null;
  amount_limit: number | string;
  spent: number | string;
  consumption_status: StatusDeConsumo;
  category?: { name?: string | null } | null;
  /** Preenchido pela rota, no mesmo formato do join de categoria. */
  group?: { id: string; name?: string | null } | null;
}

/** Um teto agregado: serve tanto para a soma pessoal quanto para a de um grupo. */
export interface TotalOrcado {
  /** Soma dos tetos, em reais. */
  limite: number;
  /** Soma do consumido, em reais. */
  gasto: number;
  /** limite - gasto. Negativo quando estourou. */
  restante: number;
  /** gasto / limite, com 4 casas, igual a view. Zero quando nao ha teto. */
  ratio: number;
  status: StatusDeConsumo;
}

/**
 * Uma viagem (ou a casa) com os tetos dela somados.
 *
 * Generico em `T` para a tela nao perder o tipo dela: a lista chega como
 * `BudgetWithConsumption[]` e volta de `separarOrcamentos` do mesmo jeito, sem
 * um cast no meio do caminho.
 */
export interface GrupoOrcado<T extends OrcamentoLido = OrcamentoLido>
  extends TotalOrcado {
  group_id: string;
  /** Nome do grupo, ou o rotulo de fallback quando a rota nao resolveu o nome. */
  group_name: string;
  orcamentos: T[];
}

/**
 * Rotulo de quando o nome do grupo nao veio junto.
 *
 * Ele existe para que a linha continue SEPARADA mesmo sem nome. A alternativa
 * obvia -- descartar o teto cujo nome nao resolveu -- some com a barra da
 * viagem sem dizer nada; a outra -- cair no balde pessoal -- e o bug que este
 * arquivo inteiro existe para impedir.
 */
export const GRUPO_SEM_NOME = "Grupo";

/** Soma um conjunto de tetos em centavos e devolve o agregado em reais. */
function somar(orcamentos: OrcamentoLido[]): TotalOrcado {
  let limiteCents = 0;
  let gastoCents = 0;
  for (const o of orcamentos) {
    limiteCents += toCents(Number(o.amount_limit));
    gastoCents += toCents(Number(o.spent));
  }

  // Sem teto nenhum nao ha percentual: 0/0 e NaN, e NaN em `Progress` rende
  // uma barra que some da tela sem erro no console.
  const ratio =
    limiteCents > 0 ? Math.round((gastoCents / limiteCents) * 10000) / 10000 : 0;

  return {
    limite: toReais(limiteCents),
    gasto: toReais(gastoCents),
    restante: toReais(limiteCents - gastoCents),
    ratio,
    status: statusDoTotal(orcamentos, limiteCents, gastoCents),
  };
}

/**
 * O status de uma soma de tetos.
 *
 * `exceeded` quando o total estourou -- essa parte e obvia. A que nao e: um
 * teto estourado DENTRO do grupo levanta o alerta mesmo com o total folgado.
 * Sem essa regra, gastar o dobro do previsto em restaurante e nada em hotel
 * mostra uma barra verde, porque o hotel que sobrou cobre o restaurante que
 * estourou -- e o teto por categoria deixaria de significar qualquer coisa.
 *
 * O limiar de alerta do total nao e recalculado aqui de proposito: cada teto
 * tem o seu (`alert_threshold`), a view ja aplicou o limiar certo em cada um,
 * e uma media desses limiares seria um quarto numero que ninguem configurou.
 */
function statusDoTotal(
  orcamentos: OrcamentoLido[],
  limiteCents: number,
  gastoCents: number,
): StatusDeConsumo {
  if (limiteCents > 0 && gastoCents >= limiteCents) return "exceeded";
  if (orcamentos.some((o) => o.consumption_status !== "ok")) return "alert";
  return "ok";
}

/**
 * Separa a lista de `/api/budgets` em teto pessoal e teto por grupo.
 *
 * `group_id` e a unica fonte da separacao. Nao se usa o nome nem o objeto
 * `group` para decidir: o nome pode nao ter sido resolvido, e nesse caso o
 * teto continua sendo de grupo.
 *
 * A ordem dos grupos e por consumo (o mais apertado primeiro) e desempata por
 * `group_id`. O desempate existe para a lista nao trocar de posicao a cada
 * refresh quando duas viagens estao no mesmo percentual -- a ordem de chegada
 * do banco nao e estavel e a tela pareceria estar se mexendo sozinha.
 */
export function separarOrcamentos<T extends OrcamentoLido>(
  orcamentos: T[],
): {
  pessoais: T[];
  pessoal: TotalOrcado;
  grupos: GrupoOrcado<T>[];
} {
  const pessoais: T[] = [];
  const porGrupo = new Map<string, T[]>();

  for (const o of orcamentos) {
    if (o.group_id) {
      const atual = porGrupo.get(o.group_id);
      if (atual) atual.push(o);
      else porGrupo.set(o.group_id, [o]);
    } else {
      pessoais.push(o);
    }
  }

  const grupos: GrupoOrcado<T>[] = [];
  porGrupo.forEach((lista, groupId) => {
    // O nome vem de qualquer linha do grupo que o tenha: a rota resolve todas
    // de uma vez, mas uma linha sem nome nao pode apagar o nome das outras.
    const comNome = lista.find((o) => o.group?.name);
    grupos.push({
      group_id: groupId,
      group_name: comNome?.group?.name ?? GRUPO_SEM_NOME,
      orcamentos: lista,
      ...somar(lista),
    });
  });

  grupos.sort((a, b) => b.ratio - a.ratio || a.group_id.localeCompare(b.group_id));

  return { pessoais, pessoal: somar(pessoais), grupos };
}

/**
 * Frase da barra da viagem.
 *
 * Fica junto da conta, e nao no JSX, porque a frase e a unica coisa que a
 * pessoa le: "restam R$ 300" e "estourou R$ 300" sao o mesmo numero com
 * sentidos opostos, e o sinal de `restante` e quem decide qual das duas sai.
 */
export function fraseDoRestante(total: TotalOrcado): string {
  const valor = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Math.abs(total.restante));

  return total.restante < 0 ? `Estourou ${valor}` : `Restam ${valor}`;
}
