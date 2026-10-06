/**
 * O QUE OS OUTROS ME DEVEM NO GRUPO, DO LADO DA RECEITA (HMO-245, fase 10).
 *
 * A HMO-275 fechou o lado da despesa: o cartao "Despesas" passou a significar
 * *o que me custou* -- inteiro quando eu paguei, minha parte quando outro pagou.
 * O lado de la daquela mesma decisao -- "bruto + reembolso" -- simplesmente NAO
 * EXISTIA na tela: zero ocorrencias de credito de grupo em qualquer cartao ou
 * lista de receita. No mes da internet do C6 o Helio tem R$ 106,60 a receber da
 * Lais e da Bia, e nada na tela dele dizia isso.
 *
 * ESTE CREDITO NAO E RECEITA REALIZADA, E O MODULO INTEIRO EXISTE POR ISSO
 * -----------------------------------------------------------------------
 * `fecharMes` (lib/fechamento-do-grupo.ts) soma PREVISTO JUNTO COM REALIZADO,
 * de proposito -- e o pedido original da HMO-245, porque para dividir o mes "ja
 * aconteceu" e "vence dia 15" saem do mesmo bolso dentro do mesmo mes. O saldo
 * que sai de la carrega essa mistura dentro.
 *
 * Entao o R$ 106,60 do exemplo e credito sobre uma conta de internet que
 * NINGUEM PAGOU AINDA. Somar isso em "Receitas" publicaria receita inexistente,
 * e o defeito nao apareceria no saldo: a mesma familia de
 * [[a-vencer-soma-receita-prevista-como-conta-a-pagar]], que este app ja pagou
 * uma vez. Por isso:
 *
 *   - este modulo NAO exporta nada que some em `receitas`, e nao importa
 *     `resumoDoPeriodo` -- o caminho que misturaria os dois nao compila;
 *   - a saida e um bloco PROPRIO, rotulado A RECEBER / previsto, ao lado do
 *     recebido e nunca dentro dele;
 *   - a receita realizada do grupo e a QUITACAO, e so ela: HMO-276 (a perna de
 *     quem registra) e a fase 12 (a perna da contraparte). Quem paga vira
 *     lancamento; quem deve fica aqui.
 *
 * E a mesma regua que o Helio fixou na HMO-265 -- *conta quando a fatura e paga,
 * nao na compra*. A Lais pode nao pagar.
 *
 * DUAS FONTES, E CADA UMA RESPONDE UMA PERGUNTA DIFERENTE
 * ------------------------------------------------------
 * `fecharMes` devolve as duas coisas de que esta leitura precisa, e elas nao sao
 * a mesma:
 *
 *   - `por_membro[].saldo` responde QUANTO eu tenho a receber no mes. E um
 *     numero so, e nao diz de quem.
 *   - `transferencias[]` responde DE QUEM, e com `from_name` ja preenchido --
 *     e a saida de `simplifySettlements`, o acerto com o menor numero de Pix que
 *     a tela do grupo ja mostra em producao.
 *
 * O pedido da issue e "por grupo e por devedor, com nome, grupo e valor", ou
 * seja a segunda. A primeira entra como CONFERENCIA: ver `sem_devedor`.
 *
 * O TOTAL DO CARTAO E A SOMA DAS LINHAS, E NAO O SALDO
 * ---------------------------------------------------
 * Havia duas maneiras de produzir o numero grande: somar `por_membro[].saldo`
 * positivo, ou somar as linhas por devedor. Elas concordam em todo mes que
 * fecha, e justamente por isso escolher a errada e barato e invisivel.
 *
 * O total e a SOMA DAS LINHAS. O criterio e o que a HMO-275 fixou no cartao de
 * Despesas: o numero grande tem de bater com a soma das linhas que a pessoa
 * consegue apontar na tela. Um total vindo do saldo poderia ficar acima da soma
 * dos nomes listados, e a unica forma de descobrir a diferenca seria somar a
 * lista a mao.
 *
 * O resto do saldo -- quando ha -- nao desaparece: vira `sem_devedor`, que a
 * tela escreve. Ele nao e hipotetico, mas e pequeno: `simplifySettlements`
 * descarta saldo de ate um centavo (`Math.abs(cents) > 1`), entao um devedor de
 * R$ 0,01 sai do acerto e aquele centavo do meu credito fica sem a quem cobrar.
 *
 * O MES E A UNIDADE; O PERIODO E A SOMA DOS MESES
 * ----------------------------------------------
 * `fecharMes` fecha UM mes -- e o grao da pergunta "quanto este mes custou e
 * quem paga quem". A tela de Financas Pessoais, porem, tem periodo livre. Entao
 * o chamador fecha cada mes do periodo, de cada grupo, e `creditoAReceber` soma
 * por (grupo, devedor).
 *
 * Somar meses JA FECHADOS, e nao fechar o periodo inteiro de uma vez, e
 * deliberado: o acerto e netado DENTRO do mes, que e como a tela do grupo o
 * mostra. Os dois caminhos dao numeros diferentes quando eu devo num mes e
 * recebo no outro, e o que esta em producao e o por mes.
 *
 * O limite disso tem de estar na tela, e nao escondido aqui: num periodo de
 * varios meses este bloco responde "a receber nos meses deste periodo", e ele
 * NAO neta contra o que eu devo nos outros. Quem responde o acumulado liquido e
 * o cartao da HMO-175 (`/api/expense-groups/my-balance`), que e outra pergunta e
 * outra fonte -- aquele le `group_member_balances`, so o realizado, sem recorte
 * de mes.
 */

import { toCents, toReais } from "@/lib/settlement";
import type { SuggestedTransfer } from "@/lib/settlement";

/** O grupo a que um credito pertence. O nome e para a linha da tela. */
export interface GrupoDoCredito {
  id: string;
  nome: string;
}

/**
 * Uma linha do credito: "a Lais te deve R$ 53,30 na Casa".
 *
 * `devedor` e `null` quando o perfil nao e legivel, e esse caminho e NORMAL --
 * nenhuma policy de SELECT de `profiles` olha `group_members`, entao dividir a
 * conta com alguem nao da acesso ao perfil dele
 * ([[ser-do-mesmo-grupo-nao-da-acesso-ao-perfil]]). A tela tem de escrever um
 * rotulo no lugar, como a linha da parte de grupo faz desde a HMO-274: uma linha
 * de credito sem nenhuma mencao a outra pessoa se le como receita propria.
 */
export interface CreditoDeGrupo {
  group_id: string;
  /** O nome do grupo, para a linha poder dizer "na Casa". */
  grupo: string;
  devedor_user_id: string;
  /** `full_name` do devedor, ou `null` quando o perfil nao e legivel. */
  devedor: string | null;
  /** BRL, positivo. */
  valor: number;
}

/**
 * O que este modulo precisa de um fechamento. `Pick` do tipo real seria
 * acoplamento desnecessario -- aqui estao so os dois campos lidos, com os
 * mesmos nomes de `FechamentoDoMes`, para o chamador poder passar o objeto
 * inteiro sem adaptar nada.
 */
export interface FechamentoParaCredito {
  por_membro: readonly {
    user_id: string;
    /** `pago - devido`. Positivo = tem a receber. BRL. */
    saldo: number;
  }[];
  transferencias: readonly SuggestedTransfer[];
}

/** Um mes de um grupo, como o chamador o entrega. */
export interface FechamentoDeGrupo {
  grupo: GrupoDoCredito;
  fechamento: FechamentoParaCredito;
}

export interface CreditoAReceber {
  /**
   * Uma linha por (grupo, devedor), do maior valor para o menor.
   *
   * Agregada: o mesmo devedor no mesmo grupo em dois meses do periodo e UMA
   * linha com a soma. Duas linhas com o mesmo nome e o mesmo grupo, uma embaixo
   * da outra, se leem como duplicata na tela.
   */
  linhas: CreditoDeGrupo[];
  /** A soma de `linhas`. BRL, positivo. E o numero do cartao. */
  total: number;
  /**
   * Quanto do meu saldo positivo NAO tem devedor nomeado. Zero em todo mes que
   * fecha.
   *
   * Existe para o `total` poder ser a soma das linhas sem que a diferenca
   * desapareca em silencio -- ver o cabecalho. O caso real e a tolerancia de um
   * centavo de `simplifySettlements`.
   */
  sem_devedor: number;
}

/**
 * O meu credito num fechamento, por devedor.
 *
 * SO O MEU SALDO POSITIVO, E O FILTRO E `to_user_id` -- NAO O SINAL DO VALOR.
 * `SuggestedTransfer.amount` e sempre positivo, nos dois sentidos: a
 * transferencia em que eu PAGO a Ana tem o mesmo sinal da em que ela me paga.
 * Filtrar por valor positivo devolveria as duas, e o mes em que eu devo R$ 300
 * apareceria como R$ 300 a receber -- o numero certo, com o sinal invertido, na
 * tela de receita.
 *
 * Nao ha guarda de `saldo > 0` aqui, e nao e esquecimento: `simplifySettlements`
 * so monta credor com saldo acima de um centavo, entao `to_user_id === eu`
 * implica saldo positivo. Uma guarda seria codigo que nenhum teste consegue
 * distinguir de nada ([[trava-pode-proteger-estado-inalcancavel]]). O saldo
 * entra neste modulo por outro caminho, e com outra funcao: `creditoSemDevedor`.
 */
export function creditoDoFechamento(
  { grupo, fechamento }: FechamentoDeGrupo,
  viewerUserId: string
): CreditoDeGrupo[] {
  return fechamento.transferencias
    .filter((t) => t.to_user_id === viewerUserId)
    .map((t) => ({
      group_id: grupo.id,
      grupo: grupo.nome,
      devedor_user_id: t.from_user_id,
      devedor: t.from_name ?? null,
      valor: Math.abs(Number(t.amount) || 0),
    }));
}

/**
 * Quanto do meu saldo positivo sobrou sem devedor nomeado, em CENTAVOS.
 *
 * Saldo negativo (o mes em que eu devo) devolve 0, e nao um numero negativo:
 * "credito sem devedor" nao e uma divida, e deixar o negativo passar faria a
 * soma de um periodo misto reduzir o residuo de um mes com o debito do outro,
 * que e uma conta que nao significa nada.
 *
 * O `Math.max` do fim cobre o outro lado: se a soma das transferencias para mim
 * passasse do meu saldo, o resultado seria negativo e viraria desconto. Isso nao
 * acontece com a aritmetica de hoje -- `simplifySettlements` nunca credita mais
 * do que o saldo --, e e justamente por isso que a conta fica presa ao zero em
 * vez de confiar nela.
 */
function creditoSemDevedorCents(
  { fechamento }: FechamentoDeGrupo,
  viewerUserId: string
): number {
  const saldo = fechamento.por_membro.find((p) => p.user_id === viewerUserId);
  const saldoCents = Math.max(0, toCents(saldo?.saldo ?? 0));

  const nomeadoCents = fechamento.transferencias
    .filter((t) => t.to_user_id === viewerUserId)
    .reduce((soma, t) => soma + toCents(Math.abs(Number(t.amount) || 0)), 0);

  return Math.max(0, saldoCents - nomeadoCents);
}

/**
 * O credito a receber de todos os grupos e de todos os meses pedidos.
 *
 * TUDO EM CENTAVOS INTEIROS ATE O FIM. Somar reais em ponto flutuante por doze
 * meses e tres grupos deixa residuos de fracao de centavo que chegam na tela
 * como um total que nao e a soma visivel das linhas -- o mesmo motivo pelo qual
 * lib/settlement.ts converte na primeira linha.
 *
 * Lista vazia devolve total zero e `linhas` vazio, e e o que a tela usa para NAO
 * desenhar o bloco: "R$ 0,00 a receber de grupos" na tela de quem nao participa
 * de grupo nenhum e ruido que parece recurso quebrado. Mesma escolha de
 * `notaDasPartesDeTerceiros` (lib/parte-de-grupo-na-lista.ts).
 */
export function creditoAReceber(
  fechamentos: readonly FechamentoDeGrupo[],
  viewerUserId: string
): CreditoAReceber {
  /** Chave `group_id\0devedor_user_id`: o par e o que identifica a linha. */
  const porDevedor = new Map<string, CreditoDeGrupo & { cents: number }>();
  let semDevedorCents = 0;

  for (const entrada of fechamentos) {
    semDevedorCents += creditoSemDevedorCents(entrada, viewerUserId);

    for (const linha of creditoDoFechamento(entrada, viewerUserId)) {
      // `\0` e nao `:` ou `-`: uuid nao contem o byte nulo, e um separador que
      // possa aparecer dentro de um id junta duas linhas diferentes numa.
      //
      // O ESCAPE, nunca o byte literal no fonte: um NUL cru faz o git tratar o
      // arquivo como BINARIO -- o diff do PR vira "Binary files differ" e o
      // grep para de achar qualquer coisa aqui dentro.
      const chave = `${linha.group_id}\0${linha.devedor_user_id}`;
      const atual = porDevedor.get(chave);

      if (atual) {
        atual.cents += toCents(linha.valor);
        // O nome pode vir num mes e faltar no outro (perfil que deixou de ser
        // legivel, ou leitura parcial). O primeiro nome que chega fica: trocar
        // por `null` apagaria informacao que a tela ja tinha.
        atual.devedor = atual.devedor ?? linha.devedor;
      } else {
        porDevedor.set(chave, { ...linha, cents: toCents(linha.valor) });
      }
    }
  }

  const linhas = Array.from(porDevedor.values())
    // Maior primeiro. Os desempates existem para a ordem nao mudar entre dois
    // carregamentos da mesma tela: nome do grupo, e depois o id do devedor, que
    // e o unico criterio que nao empata nunca.
    .sort(
      (a, b) =>
        b.cents - a.cents ||
        a.grupo.localeCompare(b.grupo) ||
        a.devedor_user_id.localeCompare(b.devedor_user_id)
    )
    .map(({ cents, ...linha }) => ({ ...linha, valor: toReais(cents) }));

  const totalCents = Array.from(porDevedor.values()).reduce(
    (soma, l) => soma + l.cents,
    0
  );

  return {
    linhas,
    total: toReais(totalCents),
    sem_devedor: toReais(semDevedorCents),
  };
}

/**
 * A frase de A RECEBER que vai embaixo do cartao "Receitas", ou `null` quando
 * nao ha credito nenhum.
 *
 * Ela NAO abre o total do cartao -- ao contrario da frase que a HMO-275 pos no
 * cartao de Despesas. Aqui ela diz o oposto: existe um valor que esta FORA
 * daquele numero, e esta fora de proposito. Sem a frase, o credito existiria so
 * num bloco mais abaixo e a leitura natural do cartao de Receitas seria que o
 * mes nao tem nada a receber.
 *
 * `quantos` e `grupos` saem daqui, e nao de um `.length` no JSX, porque a frase
 * concorda em numero com eles -- e concordancia calculada no meio do JSX e
 * exatamente o que divergiu da conta no cartao de Despesas antes da HMO-275.
 */
export function notaDoCreditoAReceber(
  credito: CreditoAReceber
): { total: number; quantos: number; grupos: number } | null {
  if (credito.linhas.length === 0) return null;

  return {
    total: credito.total,
    quantos: credito.linhas.length,
    grupos: new Set(credito.linhas.map((l) => l.group_id)).size,
  };
}

/**
 * O rotulo do devedor numa linha, com o fallback escrito.
 *
 * O fallback nao e enfeite: ver `CreditoDeGrupo.devedor`. Uma linha
 * "R$ 53,30 · Casa" sem nenhuma mencao a outra pessoa se le como receita
 * propria -- e, pior, como receita JA RECEBIDA. O mesmo desenho de
 * `pagadorNaLinha` (lib/parte-de-grupo-na-lista.ts), e pelo mesmo motivo.
 *
 * `trim()` antes do teste porque `full_name` com espaco em branco existe no
 * banco e `"   " || fallback` devolveria os espacos -- um rotulo em branco, que
 * e o defeito que o fallback existe para nao ter.
 */
export const DEVEDOR_SEM_NOME = "alguém do grupo";

export function devedorNaLinha(linha: CreditoDeGrupo): {
  texto: string;
  temNome: boolean;
} {
  const limpo = (linha.devedor ?? "").trim();
  return {
    texto: limpo || DEVEDOR_SEM_NOME,
    temNome: Boolean(limpo),
  };
}
