/**
 * A configuracao de divisao do grupo: o rebalanceamento dos sliders (HMO-245,
 * fase 1).
 *
 * O pedido do Helio: "lembrando que o total deve ser 100% entao se eu mexer em
 * um, automaticamente o outro se ajustar". Com dois membros isso e subtracao.
 * Com tres ou mais e AMBIGUO -- e a ambiguidade precisa estar resolvida por
 * escrito antes de existir slider, porque ela decide dinheiro: a porcentagem
 * daqui e o peso com que o fechamento do mes rateia a conta da casa.
 *
 * A REGRA
 * -------
 * Mexer no membro *i* para `p`:
 *
 *   * a sobra `100 - p` vai para os OUTROS, proporcionalmente ao que eles
 *     tinham. Quem estava com o dobro do outro continua com o dobro -- so a
 *     escala muda. Essa e a unica leitura de "o outro se ajusta" que nao
 *     inventa uma preferencia que ninguem expressou;
 *   * se os outros somam ZERO, nao ha proporcao para respeitar: a sobra e
 *     dividida IGUAL entre eles. Sem esse degrau a conta e `sobra * 0 / 0`, que
 *     em JavaScript e `NaN` -- e `NaN` nao estoura: ele atravessa a aritmetica
 *     calado e chega na tela como "NaN%". O estado "todos em zero" nao e
 *     hipotetico: `group_members.percentage` nasce `DEFAULT 0.00` (001_baseline
 *     :1216) e NINGUEM nunca escreveu nessa coluna, entao TODO grupo que existe
 *     hoje esta exatamente assim;
 *   * arrastar um membro para 100% zera os outros, e isso e LEGITIMO -- uma
 *     pessoa banca o mes. Nao e um estado a ser impedido aqui.
 *
 * POR QUE CENTESIMOS DE PONTO INTEIROS, E NAO FLOAT
 * -------------------------------------------------
 * A unidade deste modulo e o centesimo de ponto percentual: 0..10000, onde
 * 10000 e 100%. Dois motivos, e nenhum deles e preciosismo:
 *
 *   1. `70/3` nao tem duas casas decimais. Tres membros dividindo igual dao
 *      33,333... cada um, e `numeric(5,2)` guarda duas casas. Em float, somar os
 *      tres arredondados da 99,99 -- e a divisao do mes passa a fechar 99,99%
 *      da conta, deixando um residual que pagamento nenhum zera (a mesma
 *      familia de defeito que a SECAO 3b da 007 tirou do caminho).
 *   2. A soma tem que dar 10000 CRAVADO, e isso e uma invariante de CONJUNTO.
 *      O `group_members_percentage_check` (001_baseline:1219) confere
 *      `percentage >= 0 AND <= 100` em cada LINHA, uma por vez -- um CHECK nao
 *      ve as outras linhas, entao nao existe trava no banco que garanta a soma.
 *      Ela e garantida aqui, por construcao: toda funcao deste arquivo devolve
 *      uma lista que soma 10000, e `divisaoDaDespesa` RECUSA uma que nao some.
 *
 * Por isso a distribuicao e por MAIOR RESTO, em inteiros, como o
 * `calculate_equal_split` da 007 e o `divisaoPorPorcentagem` da HMO-190: o piso
 * de cada parte, e o centesimo que sobra vai para quem tem o maior resto.
 * Arredondar cada parte sozinha e o que NAO fecha.
 *
 * O DEGRAU QUE VIRA DINHEIRO: 0% NAO E UMA PARTE DE ZERO
 * ------------------------------------------------------
 * As duas colunas de porcentagem do schema nao concordam sobre o zero:
 *
 *     group_members.percentage    CHECK (>= 0 AND <= 100)   -- 0 e valido
 *     expense_splits.percentage   CHECK (>  0 AND <= 100)   -- 0 e 23514
 *
 * Isso nao e inconsistencia: e a diferenca entre "este membro nao paga nada" e
 * "este membro tem uma parte desta despesa, e ela vale zero". A configuracao
 * aceita o primeiro; a despesa nao aceita o segundo. Entao membro em 0% SAI da
 * divisao da despesa -- `divisaoDaDespesa` nao o inclui. Incluir com 0,00
 * derrubaria o INSERT inteiro no CHECK, com uma mensagem sobre `percentage` que
 * nao diz nada a quem lancou a despesa.
 *
 * E POR QUE A SOMA E CONFERIDA DE NOVO NA LEITURA
 * -----------------------------------------------
 * `divisaoDaDespesa` recusa uma configuracao que nao soma 10000 mesmo que todo
 * `rebalancear` deste arquivo garanta que ela soma. Nao e redundancia: o que
 * chega nessa funcao vem do BANCO, uma linha por membro, e a RLS
 * `group_members_update` (002_rls_lockdown.sql:526) permite
 * `user_id = auth.uid()` -- policy nao compara OLD com NEW e nao restringe
 * coluna, entao qualquer membro pode escrever a PROPRIA `percentage` direto no
 * PostgREST. Uma linha alterada por fora deixa o conjunto somando 97, e ai a
 * divisao da despesa fecharia 97% do valor em silencio. A trava de linha e uma
 * migration (fase 5 do plano); a invariante de conjunto e esta conferencia.
 *
 * O QUE ESTE ARQUIVO NAO FAZ
 * --------------------------
 * Nao calcula VALOR em reais. Quanto cada um deve sai de uma aritmetica que ja
 * existe e ja esta em producao -- `ratearPorPeso` de `lib/fechamento-do-grupo.ts`
 * para o fechamento do mes, `divisaoParaGravar` de `lib/divisao-do-grupo.ts`
 * para a despesa avulsa. Duplicar a conversao reais -> centavos aqui e como as
 * duas telas passam a discordar sobre dinheiro. `divisaoDoPeriodo`, no fim deste
 * arquivo, para exatamente na fronteira: ela entrega o PESO, em centesimo de
 * ponto, e quem o transforma em real e o fechamento.
 */

/**
 * 100% em centesimos de ponto.
 *
 * Nao e constante de gosto: e o teto do
 * `group_members_percentage_check`, na unidade deste modulo.
 */
export const CENTESIMOS_TOTAIS = 10000;

/** Um membro e o peso dele na configuracao, em centesimos de ponto. */
export interface PesoDoMembro {
  member_id: string;
  centesimos: number;
}

/** Uma parte gravavel em `expense_splits`: a porcentagem como `numeric(5,2)`. */
export interface ParteConfigurada {
  member_id: string;
  percentage: number;
}

export type DivisaoDaDespesa =
  | { ok: true; partes: ParteConfigurada[] }
  | { ok: false; erro: string };

/**
 * O peso que chega de fora, normalizado para um numero finito >= 0.
 *
 * Peso negativo e peso nao finito nao vem de slider -- vem de leitura de banco
 * e de `Number("")`, que da `0`, e de `Number("abc")`, que da `NaN`. Os dois
 * atravessariam a proporcao calados: `NaN` contamina a soma inteira e todo
 * mundo sai `NaN`; negativo encolhe a soma e inverte a proporcao de quem
 * sobrou. Virar 0 joga o caso no degrau da divisao igual, que e definido.
 *
 * NAO arredonda, e isso e deliberado. O peso aqui so e usado como RAZAO dentro
 * de `distribuir`, onde o piso de cada parte e um `Math.floor` e a sobra e
 * `total - soma(pisos)` -- as duas coisas saem inteiras qualquer que seja o
 * peso. Um `Math.round` aqui nao mudaria nem a integralidade nem a soma da
 * saida: seria um arredondamento que nenhum teste consegue distinguir de nada
 * (e foi um mutante sobrevivente, medido).
 */
function pesoLimpo(valor: unknown): number {
  if (typeof valor !== "number" || !Number.isFinite(valor) || valor <= 0) {
    return 0;
  }
  return valor;
}

/**
 * O que o slider pediu, em centesimos inteiros dentro de 0..10000 -- ou `null`
 * se nao foi pedido numero nenhum.
 *
 * O teto nao e decorativo: `percentage > 100` e 23514 nas DUAS tabelas, e a
 * tela nao tem como mostrar esse erro de um jeito que explique.
 */
function centesimosPedidos(valor: unknown): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  const arredondado = Math.round(valor);
  if (arredondado <= 0) return 0;
  if (arredondado >= CENTESIMOS_TOTAIS) return CENTESIMOS_TOTAIS;
  return arredondado;
}

/**
 * Reparte `total` centesimos entre `ids`, proporcionalmente a `pesos`, por
 * maior resto. A soma do resultado e `total`, sempre, exatamente.
 *
 * A SAIDA E INTEIRA SEJA QUAL FOR O PESO
 * --------------------------------------
 * O piso de cada parte e `floor(total * peso / somaPesos)` e a sobra e
 * `total - soma(pisos)`. Nenhum dos dois depende de o peso ser inteiro, e e por
 * isso que `pesoLimpo` nao arredonda: o que garante centesimo inteiro na saida e
 * o `floor` aqui, nao a forma do peso que entrou.
 *
 * O resto que decide a ordem e `total * peso - piso * somaPesos`, e nao
 * `(total * peso / somaPesos) - piso`. As duas ordenam igual (diferem por um
 * fator `somaPesos` positivo e constante dentro de uma chamada -- o mutante que
 * troca uma pela outra SOBREVIVE, e foi medido); a primeira esta aqui porque com
 * pesos inteiros, que e o caso de todo chamador deste modulo, ela e exata por
 * construcao, sem precisar de argumento sobre precisao de double.
 */
function distribuir(ids: string[], pesos: number[], total: number): PesoDoMembro[] {
  // Nao ha `if (ids.length === 0) return []` aqui, de proposito: a lista vazia
  // ja sai vazia por este caminho (todo `map` devolve `[]`, e o `reduce` da soma
  // tem valor inicial), entao a guarda seria uma trava sobre estado que ela nao
  // muda -- um mutante que a apagasse sobreviveria, e nenhum teste conseguiria
  // distinguir as duas versoes.
  const somaPesos = pesos.reduce((acc, p) => acc + p, 0);

  // O degrau do `0/0`. Sem proporcao a respeitar, a divisao e igual -- pesos
  // uniformes dizem isso na mesma aritmetica, sem um segundo caminho de codigo
  // que possa divergir do primeiro.
  const efetivos = somaPesos > 0 ? pesos : pesos.map(() => 1);
  const soma = somaPesos > 0 ? somaPesos : pesos.length;

  const base = efetivos.map((p) => Math.floor((total * p) / soma));
  const restos = efetivos.map((p, i) => total * p - base[i] * soma);

  let sobra = total - base.reduce((acc, b) => acc + b, 0);

  // O centesimo que sobra vai para quem tem o maior resto. Empate decide pelo
  // `member_id`, que e arbitrario mas ESTAVEL -- a mesma escolha que a 007 fez
  // com `ORDER BY gm.id`, pelo mesmo motivo: com tres membros em divisao igual
  // o empate e a REGRA (os tres restos sao identicos), e sem desempate fixo a
  // mesma configuracao gravaria numeros diferentes a cada render, conforme a
  // ordem em que a tela montou a lista.
  const ordem = ids
    .map((member_id, i) => ({ i, resto: restos[i], member_id }))
    .sort((a, b) =>
      b.resto !== a.resto
        ? b.resto - a.resto
        : a.member_id < b.member_id
          ? -1
          : a.member_id > b.member_id
            ? 1
            : 0
    );

  const centesimos = [...base];
  for (const { i } of ordem) {
    if (sobra <= 0) break;
    centesimos[i] += 1;
    sobra -= 1;
  }

  return ids.map((member_id, i) => ({ member_id, centesimos: centesimos[i] }));
}

/**
 * Mexer no slider de `memberId` para `centesimos`: devolve a configuracao
 * inteira, na MESMA ordem recebida, somando 10000.
 *
 * Devolve a lista inteira (e nao so os outros) porque o valor do proprio membro
 * tambem pode mudar: pedir 120% vira 100%, e num grupo de um membro so o pedido
 * e ignorado -- ver abaixo.
 *
 * A configuracao que ENTRA nao precisa somar 10000. Isso e deliberado: hoje
 * todo grupo tem os quatro zeros do `DEFAULT 0.00`, e um grupo pode perder um
 * membro entre o render e o arrasto. A funcao normaliza o que recebe em vez de
 * recusar, porque recusar deixaria a tela sem numero para mostrar.
 */
export function rebalancear(
  membros: PesoDoMembro[],
  memberId: string,
  centesimos: unknown
): PesoDoMembro[] {
  const ids = membros.map((m) => m.member_id);
  const pesos = membros.map((m) => pesoLimpo(m.centesimos));

  const alvo = ids.indexOf(memberId);
  const pedido = centesimosPedidos(centesimos);

  // Nenhum pedido concreto: ou o membro arrastado nao esta mais na lista, ou o
  // campo veio vazio. Nao ha o que rebalancear EM TORNO DE, mas a tela ainda
  // precisa de uma lista que some 100% -- entao so normaliza o que tem.
  if (alvo < 0 || pedido === null) {
    return distribuir(ids, pesos, CENTESIMOS_TOTAIS);
  }

  // Grupo de um membro: a sobra nao tem para onde ir. Ele paga 100%, e o que o
  // slider pediu nao muda esse fato -- a alternativa seria devolver uma lista
  // que soma menos de 100%, que e justamente o que nao pode existir.
  if (ids.length === 1) {
    return [{ member_id: ids[0], centesimos: CENTESIMOS_TOTAIS }];
  }

  const outrosIds = ids.filter((_, i) => i !== alvo);
  const outrosPesos = pesos.filter((_, i) => i !== alvo);
  const outros = distribuir(outrosIds, outrosPesos, CENTESIMOS_TOTAIS - pedido);

  // Recomposicao por POSICAO, e nao por um mapa de `member_id`: `distribuir`
  // devolve na ordem que recebeu, e um mapa colapsaria silenciosamente duas
  // linhas com o mesmo id -- fazendo uma delas sumir da tela.
  const resultado: PesoDoMembro[] = [];
  let k = 0;
  for (let i = 0; i < ids.length; i++) {
    resultado.push(
      i === alvo ? { member_id: ids[i], centesimos: pedido } : outros[k++]
    );
  }
  return resultado;
}

/**
 * A configuracao de divisao igual entre `ids`, somando 10000.
 *
 * E o estado inicial da tela, nao um extra: a coluna nasce `0.00` para todo
 * mundo e nunca foi escrita, entao um grupo que ninguem configurou nao tem
 * configuracao nenhuma para carregar. Mostrar os zeros do banco seria uma tela
 * dizendo que o grupo divide 0% da conta.
 */
export function igualitario(ids: string[]): PesoDoMembro[] {
  return distribuir(
    ids,
    ids.map(() => 1),
    CENTESIMOS_TOTAIS
  );
}

/**
 * A configuracao que distribui 100% entre `ids` na PROPORCAO de `pesos`
 * (HMO-245, fase 6).
 *
 * E `igualitario` com peso livre em vez de peso 1 -- as duas chamam o mesmo
 * `distribuir`, de proposito. Existe para a semeadura pela renda
 * (lib/semear-pela-renda.ts) nao escrever uma segunda distribuicao por maior
 * resto: ratear 100% entre tres rendas tem exatamente a mesma sobra de centesimo
 * que ratear entre tres membros iguais, e e a aritmetica que ja tem teste e
 * mutante aqui.
 *
 * O peso e RAZAO, nao porcentagem: renda em centavos, em reais ou normalizada
 * dao a mesma divisao. E dois comportamentos vem de graca do `distribuir`, os
 * dois necessarios para a semeadura:
 *
 *   * peso ZERO recebe ZERO -- o piso e 0, o resto e 0 (o MENOR possivel), e a
 *     sobra nunca alcanca os restos zerados. Membro sem renda lancada no mes sai
 *     em 0%, que e o numero certo, e NAO uma fracao de uma renda inventada (que e
 *     o que a `calculate_member_proportions` do banco faz, com
 *     `COALESCE(..., 1000)` tres vezes);
 *   * TODOS em zero cai no degrau do `0/0` e divide IGUAL. "Ninguem no grupo
 *     lancou receita neste mes" e um estado real, e dividir igual e a unica saida
 *     definida -- mas quem chama tem de DIZER na tela que foi isso que aconteceu,
 *     ou a semeadura parece ter lido uma renda que nao existe.
 *
 * `pesos` e indexado por POSICAO contra `ids`, e nao casado por chave: a mesma
 * escolha de `rebalancear` logo acima, e pelo mesmo motivo -- um mapa colapsaria
 * duas entradas com o mesmo id e faria uma linha sumir da tela. Posicao sem peso
 * (`undefined`) vira 0 por `pesoLimpo`, que e o membro sem renda.
 */
export function proporcional(
  ids: string[],
  pesos: readonly number[]
): PesoDoMembro[] {
  return distribuir(
    ids,
    ids.map((_, i) => pesoLimpo(pesos[i])),
    CENTESIMOS_TOTAIS
  );
}

/**
 * Centesimos de ponto -> o `numeric(5,2)` que as duas colunas guardam.
 *
 * Sem `Math.round` na entrada, e isso e deliberado: centesimo de ponto e a
 * unidade INTEIRA deste modulo, e todas as funcoes que produzem um ja garantem
 * isso (`pesoLimpo`, `centesimosPedidos` e `distribuir` arredondam na origem).
 * Um arredondamento aqui seria um segundo lugar consertando o que o primeiro ja
 * consertou -- e o dia em que a origem parasse de arredondar, este lugar
 * esconderia o fato.
 */
export function paraPercentual(centesimos: number): number {
  return centesimos / 100;
}

/**
 * `numeric(5,2)` lido do banco -> centesimos de ponto.
 *
 * O `Math.round` nao e paranoia com o Postgres: `33.33` nao existe em binario,
 * e `33.33 * 100` da `3332.9999999999995`. Sem arredondar, um membro perderia
 * um centesimo a cada ida e volta pelo banco, e a soma deixaria de fechar
 * 10000 depois de um numero de recargas que ninguem conseguiria reproduzir.
 */
export function dePercentual(percentual: unknown): number {
  if (typeof percentual !== "number" || !Number.isFinite(percentual)) return 0;
  const centesimos = Math.round(percentual * 100);
  if (centesimos <= 0) return 0;
  if (centesimos >= CENTESIMOS_TOTAIS) return CENTESIMOS_TOTAIS;
  return centesimos;
}

/** Por que uma configuracao recebida de fora foi recusada. */
export type RecusaDaConfiguracao =
  | { motivo: "repetido" }
  | { motivo: "conjunto"; faltando: string[]; sobrando: string[] }
  | { motivo: "soma"; centesimos: number };

export type ConferenciaDaConfiguracao =
  | { ok: true; porMembro: ParteConfigurada[] }
  | { ok: false; recusa: RecusaDaConfiguracao };

/**
 * A configuracao que chegou de FORA (o corpo do PUT /split-config, HMO-269),
 * conferida contra os membros ativos e convertida no que vai para a coluna.
 *
 * Mora aqui, e nao dentro da rota, pelo mesmo motivo que a aritmetica do
 * fechamento mora em `lib/fechamento-do-grupo.ts`: quem decide dinheiro precisa
 * ser chamavel por um teste sem subir servidor nem forjar sessao. Uma rota que
 * tivesse estas tres regras no corpo do handler so poderia ser verificada por
 * um 200 -- e todo defeito aqui produz exatamente um 200.
 *
 * AS TRES RECUSAS, E POR QUE CADA UMA EXISTE
 * -------------------------------------------
 *   * `repetido` -- o mesmo `member_id` duas vezes. Sem esta guarda o corpo
 *     `[A: 100, A: 0]` num grupo de dois membros passaria: o Map colapsa as
 *     duas entradas numa so, a ultima vence, e o conjunto pareceria completo
 *     com B nunca tendo sido mencionado;
 *   * `conjunto` -- falta alguem ativo, ou sobra alguem que nao e. A invariante
 *     e a SOMA DO CONJUNTO, entao gravar 70/30 entre dois de tres membros
 *     deixaria o terceiro no valor velho e a soma GRAVADA em 70+30+x. Recusar e
 *     a unica saida que nao envolve adivinhar o que o cliente quis dizer sobre
 *     o membro ausente;
 *   * `soma` -- o total nao fecha 10000. A conferencia e sobre o INTEIRO em
 *     centesimos, depois da conversao, e nunca sobre o float do corpo: `33.333`
 *     tres vezes soma 99,999 (que qualquer tolerancia de float aceita como 100)
 *     e grava 99,99, porque `numeric(5,2)` arredonda calado.
 *
 * MEMBRO EM 0% FICA, AO CONTRARIO DE `divisaoDaDespesa`
 * -----------------------------------------------------
 * Ali o membro em zero e OMITIDO, porque `expense_splits.percentage` exige
 * `> 0`. Aqui ele FICA, com 0,00, porque `group_members.percentage` aceita zero
 * e a linha dele existe de qualquer jeito -- omiti-la deixaria na coluna o
 * valor ANTIGO daquele membro, que e precisamente o estado "a soma gravada nao
 * e a soma conferida". As duas funcoes tratam o zero de forma oposta de
 * proposito: uma descreve uma despesa, a outra descreve o grupo.
 *
 * A saida vem na ordem de `idsAtivos` -- a ordem do banco, nao a do corpo --
 * para o chamador poder casar posicao a posicao com as linhas que ele leu.
 */
export function conferirConfiguracao(
  idsAtivos: string[],
  pedidos: { member_id: string; percentage: number }[]
): ConferenciaDaConfiguracao {
  const pedidoPorId = new Map<string, number>();
  for (const p of pedidos) {
    if (pedidoPorId.has(p.member_id)) {
      return { ok: false, recusa: { motivo: "repetido" } };
    }
    pedidoPorId.set(p.member_id, p.percentage);
  }

  const faltando = idsAtivos.filter((id) => !pedidoPorId.has(id));
  const sobrando = pedidos
    .map((p) => p.member_id)
    .filter((id) => !idsAtivos.includes(id));

  if (faltando.length > 0 || sobrando.length > 0) {
    return { ok: false, recusa: { motivo: "conjunto", faltando, sobrando } };
  }

  // Grupo sem membro ativo nenhum cai na recusa de SOMA logo abaixo (0 nao e
  // 10000), e nao numa guarda propria: a mensagem "somam 0,00%" ja descreve o
  // estado, e uma segunda trava aqui seria um caminho que nenhum teste
  // conseguiria distinguir do primeiro.
  const centesimos = idsAtivos.map((id) => dePercentual(pedidoPorId.get(id)));
  const soma = centesimos.reduce((acc, c) => acc + c, 0);

  if (soma !== CENTESIMOS_TOTAIS) {
    return { ok: false, recusa: { motivo: "soma", centesimos: soma } };
  }

  return {
    ok: true,
    porMembro: idsAtivos.map((member_id, i) => ({
      member_id,
      percentage: paraPercentual(centesimos[i]),
    })),
  };
}

/**
 * A configuracao virando as partes gravaveis de UMA despesa.
 *
 * Duas coisas acontecem aqui, e as duas sao sobre o zero:
 *
 *   * a soma e conferida contra 10000 ANTES de qualquer coisa. Ver o cabecalho:
 *     o que chega aqui vem do banco, linha por linha, e nao ha CHECK que garanta
 *     a soma;
 *   * membro em 0% e OMITIDO, porque `expense_splits.percentage` exige `> 0`.
 *
 * Nao ha guarda separada para "ninguem tem parte positiva": ela seria
 * inalcancavel. Uma lista que soma 10000 tem, por aritmetica, pelo menos um
 * membro acima de zero -- e a lista que soma 0 ja saiu pela conferencia da soma,
 * com uma mensagem melhor ("somam 0,00%") do que qualquer segunda trava diria.
 */
export function divisaoDaDespesa(membros: PesoDoMembro[]): DivisaoDaDespesa {
  const pesos = membros.map((m) => pesoLimpo(m.centesimos));
  const soma = pesos.reduce((acc, p) => acc + p, 0);

  if (soma !== CENTESIMOS_TOTAIS) {
    return {
      ok: false,
      erro:
        `A divisão configurada do grupo soma ${paraPercentual(soma)
          .toFixed(2)
          .replace(".", ",")}% e precisa somar 100%. ` +
        `Ajuste a divisão do grupo antes de lançar a despesa.`,
    };
  }

  return {
    ok: true,
    partes: membros
      .map((m, i) => ({ member_id: m.member_id, peso: pesos[i] }))
      .filter((m) => m.peso > 0)
      .map(({ member_id, peso }) => ({
        member_id,
        percentage: paraPercentual(peso),
      })),
  };
}

/** O modo de divisao que o fechamento do mes sabe aplicar. */
export type ModoAplicado = "equal" | "percentage";

/** Uma linha de `group_members` como o fechamento a le. */
export interface MembroComPercentual {
  user_id: string;
  /** `group_members.percentage`, o `numeric(5,2)` cru do banco. */
  percentage?: unknown;
}

export interface DivisaoDoPeriodo {
  /** O `default_split_type` do grupo, como veio. */
  configurado: string;
  /**
   * O modo que o fechamento REALMENTE usou. Diferente de `configurado` quando a
   * configuracao gravada nao da para aplicar -- ver abaixo.
   */
  aplicado: ModoAplicado;
  /** A soma dos percentuais GRAVADOS, em centesimos de ponto. */
  soma_centesimos: number;
  /**
   * O peso de cada membro, na ordem recebida, pronto para
   * `MembroDoFechamento.peso`. Em `equal` todos vem 1.
   */
  pesos: { user_id: string; peso: number }[];
}

/**
 * A configuracao de divisao do grupo virando o PESO com que o fechamento do mes
 * rateia a conta (HMO-245, fase 4).
 *
 * Esta e a unica funcao que le `expense_groups.default_split_type` junto com
 * `group_members.percentage` e decide o que vale. Mora aqui, e nao na rota do
 * fechamento, pelo mesmo motivo que `conferirConfiguracao` nao mora na rota do
 * PUT: todo defeito aqui sai da rota como um 200 com o numero errado, e um
 * handler so e verificavel por um 200.
 *
 * O QUE A CONFIGURACAO *NAO* ALCANCA
 * ----------------------------------
 * O peso daqui vale para o FECHAMENTO DO PERIODO e para despesa NOVA. Ele nao
 * reescreve a divisao de despesa ja lancada, e muito menos parte ja aprovada:
 * a 025 trancou repontamento de divisao justamente por isso. Mudar de 50/50
 * para 70/30 muda o fechamento do mes; nao muda uma linha de
 * `group_expense_splits` que o trigger ja gravou. A tela (fase 5) tem de dizer
 * isso em uma linha, ou o primeiro uso real vai ser "mudei para 70/30 e a
 * conta do mes passado nao mudou".
 *
 * SO `percentage` TEM PESO -- OS OUTROS TRES MODOS CAEM EM `equal`
 * ---------------------------------------------------------------
 * `default_split_type` aceita quatro valores (001_baseline:1069). `equal` e
 * divisao igual por definicao. `custom` e por despesa, nao por grupo: nao
 * existe numero de grupo para ler. `proportional` le `group_member_proportions`,
 * o SEGUNDO armazem de porcentagem do schema, que a fase 7 aposenta -- ler os
 * dois aqui e exatamente como se chega a duas telas discordando sobre dinheiro,
 * com nenhuma das duas sabendo qual esta certa. Os tres viram `equal`, e a
 * resposta devolve `configurado` ao lado de `aplicado` para a tela poder dizer
 * qual e qual em vez de mostrar "igual" sobre um grupo configurado de outro
 * jeito.
 *
 * E SOMA != 100% TAMBEM CAI EM `equal`, EM VEZ DE RATEAR A PROPORCAO ERRADA
 * -------------------------------------------------------------------------
 * `ratearPorPeso` divide pela SOMA dos pesos, entao uma configuracao gravada
 * somando 97% nao divide 97% da conta: ela divide 100% numa proporcao que
 * ninguem configurou (70 e 27 viram 72,2% e 27,8%). Isso e PIOR que um residual
 * visivel, porque o total fecha e nada na tela denuncia o numero errado.
 *
 * Esse estado nao e hipotetico, e e por isso que a conferencia existe na
 * LEITURA: a RLS `group_members_update` (002_rls_lockdown.sql:526) permite
 * `user_id = auth.uid()`, policy nao compara OLD com NEW nem restringe coluna,
 * entao qualquer membro pode escrever a PROPRIA `percentage` direto no
 * PostgREST (a trava de linha e a migration da fase 2). E todo grupo que existe
 * hoje tem os quatro zeros do `DEFAULT 0.00`, que somam 0.
 *
 * `equal` e a saida certa aqui, e nao um erro: ela e o comportamento que o
 * fechamento tinha antes desta fase, e e legivel na tela. Um 500 deixaria o
 * grupo sem fechamento nenhum por causa de uma coluna, e um rateio na proporcao
 * errada mentiria. `soma_centesimos` vai na resposta para a tela poder cobrar o
 * ajuste pelo numero.
 */
export function divisaoDoPeriodo(
  modo: unknown,
  membros: readonly MembroComPercentual[]
): DivisaoDoPeriodo {
  const configurado = typeof modo === "string" ? modo : "equal";

  // `numeric(5,2)` chega como number pelo PostgREST, mas a conversao de string
  // esta aqui porque a falha dela e MUDA: `dePercentual("70.00")` e 0, e quatro
  // zeros somam 0, que cai em `equal` -- ou seja a divisao configurada
  // simplesmente nunca valeria, sem erro, sem log e com um fechamento que
  // parece certo. Um `Number` custa nada e tira essa classe de falha do
  // caminho. Ver [[nome-de-campo-errado-esconde-bug-de-dinheiro]].
  const centesimos = membros.map((m) =>
    dePercentual(
      typeof m.percentage === "string" ? Number(m.percentage) : m.percentage
    )
  );
  const soma = centesimos.reduce((acc, c) => acc + c, 0);

  const aplicado: ModoAplicado =
    configurado === "percentage" && soma === CENTESIMOS_TOTAIS
      ? "percentage"
      : "equal";

  return {
    configurado,
    aplicado,
    soma_centesimos: soma,
    pesos: membros.map((m, i) => ({
      user_id: m.user_id,
      peso: aplicado === "percentage" ? centesimos[i] : 1,
    })),
  };
}
