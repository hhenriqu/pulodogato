/**
 * As sugestoes de divisao de uma despesa de grupo (HMO-245, fase 7).
 *
 * `GET /api/expense-groups/{groupId}/split-suggestions` oferece quatro
 * sugestoes. Este arquivo e a aritmetica das quatro: cada uma e um conjunto de
 * PESOS, e daqui saem o % que vai no corpo do POST e o R$ que a tela mostra.
 *
 * O DEFEITO QUE A FASE 7 FECHA: A SUGESTAO CONFIGURADA NUNCA APARECIA
 * -------------------------------------------------------------------
 * A rota montava a sugestao "Divisao Proporcional" so quando
 * `expense_groups.default_split_type === 'proportional'`, lendo
 * `group_members.percentage` -- e so quando algum membro tinha `percentage > 0`.
 * As duas condicoes eram inalcancaveis juntas:
 *
 *   * a coluna era o `DEFAULT 0.00` de sempre em todo grupo que existe, porque
 *     NINGUEM escrevia nela. O primeiro escritor do app e o
 *     `PUT /split-config` da fase 3;
 *   * e esse PUT grava `percentage`, NUNCA `proportional`. A palavra
 *     `proportional` e o SEGUNDO armazem de porcentagem do schema
 *     (`group_member_proportions`, alimentado por `calculate_member_proportions`
 *     a partir das receitas do mes) -- o caminho que esta fase aposenta. Um
 *     grupo gravado como `proportional` fecha IGUAL, porque `divisaoDoPeriodo`
 *     (fase 4) nao sabe aplicar aquele armazem.
 *
 * Entao a sugestao ficava presa entre um armazem que nada escrevia e um modo que
 * nada gravava: codigo morto que parece feature. Aqui ela le a MESMA
 * `divisaoDoPeriodo` do fechamento do mes e da tela da fase 5 -- um armazem, uma
 * funcao, tres leitores.
 *
 * O R$ DA SUGESTAO NAO E `total * % / 100`
 * ----------------------------------------
 * Era, nas quatro sugestoes, e e assim que uma previa fica treze centavos
 * distante do extrato (o mesmo defeito que a sonda da fase 5 achou na tela, em
 * codigo intacto). Tres membros e R$ 10,00 em divisao igual davam 3,333 cada,
 * que a tela mostra como R$ 3,33 tres vezes: R$ 9,99 sob o rotulo de uma despesa
 * de R$ 10,00. O centavo nao sobra em lugar nenhum -- ele vira saldo que
 * pagamento nenhum zera.
 *
 * O R$ sai de `ratearPorPeso` (lib/fechamento-do-grupo.ts), a MESMA funcao do
 * fechamento, por maior resto, somando o total exato por construcao.
 *
 * E UM PESO ESPECIAL PARA A DIVISAO IGUAL NAO E NECESSARIO
 * --------------------------------------------------------
 * Esta funcao teve, por um tempo, um parametro `rateio` que ratearia a previa da
 * divisao igual com peso 1 em vez dos centesimos de `igualitario`. O argumento
 * parecia bom: quem grava a despesa igual e o trigger `calculate_equal_split`
 * (001, corrigido na 007), que divide por N, e nao pelos percentuais.
 *
 * O parametro foi TIRADO porque nenhuma entrada o observava. Uma busca exaustiva
 * -- 2 a 9 membros, R$ 0,01 a R$ 30,00, nas duas ordens de `member_id` -- nao
 * achou um unico caso em que os dois pesos mandem o centavo para pessoas
 * diferentes. E nao e coincidencia: `igualitario` distribui 10000 por maior
 * resto a partir de pesos iguais, e `ratearPorPeso` sobre o resultado preserva a
 * mesma ordem de restos. Com peso 1 ou com 3334/3333/3333, o centavo que sobra
 * vai para o mesmo membro.
 *
 * Um parametro que nenhum teste consegue distinguir e exatamente a familia de
 * defeito que esta fase foi consertar: codigo que parece decidir dinheiro e nao
 * decide nada. Ver [[mutante-sobrevivente-pode-estar-certo]] -- o mutante que
 * trocava os dois pesos sobreviveu, e o sobrevivente estava certo.
 *
 * O que CONTINUA verdade e a consequencia na tela, a mesma da fase 5: em `equal`
 * com tres membros a sugestao mostra 33,34% ao lado de R$ 666,67 numa despesa de
 * R$ 2.000. O numero da esquerda e o que caberia na coluna `numeric(5,2)`; o da
 * direita e o dinheiro que vai ser cobrado. Entre os dois, quem tem de estar
 * certo e o dinheiro.
 *
 * POR QUE O RATEIO E FEITO EM ORDEM DE `member_id`
 * -----------------------------------------------
 * `ratearPorPeso` desempata resto igual pelo INDICE do array; quem grava a
 * despesa desempata pelo `member_id` -- `divisaoPorPorcentagem`
 * (lib/divisao-do-grupo.ts) compara `a.membro < b.membro`, e o trigger do caso
 * igual usa `ORDER BY gm.id`. Com dois membros e R$ 10,01 os dois restos sao
 * IDENTICOS: o centavo extra vai para o primeiro da lista aqui e para o menor id
 * la, e a previa mostra R$ 5,01 no nome de uma pessoa enquanto a despesa cobra
 * de OUTRA. Rateando em ordem de `member_id`, os dois desempates sao o mesmo
 * desempate. A ordem de SAIDA continua sendo a recebida -- ela e a ordem em que
 * a tela lista os membros.
 */

import {
  CENTESIMOS_TOTAIS,
  divisaoDoPeriodo,
  igualitario,
  paraPercentual,
  proporcional,
  rebalancear,
  type PesoDoMembro,
} from "@/lib/divisao-configurada";
import { ratearPorPeso } from "@/lib/fechamento-do-grupo";
import { toCents, toReais } from "@/lib/settlement";

/**
 * Os tres tipos que `split-suggestions` devolve, e que a tela usa para escolher
 * icone e cor.
 *
 * Nao sao tipos de banco: `group_transactions.split_type` aceita
 * `equal | percentage | custom`, e `tipoGravavel` (lib/divisao-do-grupo.ts)
 * traduz `proportional` e `historical` para `percentage`. A traducao e a razao
 * de este vocabulario poder continuar existindo.
 */
export type TipoDeSugestao = "equal" | "proportional" | "historical";

/** Uma parte da sugestao, como a rota a devolve. */
export interface ParteDaSugestao {
  member_id: string;
  /** `numeric(5,2)`: o que vai em `custom_splits[].percentage` no POST. */
  percentage: number;
  /**
   * A previa em reais. `undefined` quando a tela ainda nao tem valor digitado --
   * e nao 0, que se leria como "esta pessoa nao paga nada".
   */
  amount?: number;
}

/**
 * Pesos -> as partes da sugestao, com o % e o R$ que FECHAM.
 *
 * Duas invariantes, e as duas sao sobre a soma:
 *
 *   * a soma dos `percentage` e 100,00 quando os pesos somam 10000, porque
 *     `paraPercentual` e divisao exata por 100 e o inteiro ja vem fechado de
 *     `igualitario` / `proporcional` / `rebalancear` / `divisaoDoPeriodo`;
 *   * a soma dos `amount` e o total exato, por construcao de `ratearPorPeso`.
 *
 * Membro em 0% FICA na lista, com 0,00: esconder aqui faria a tela listar menos
 * gente do que o grupo tem, sem dizer por que -- e sumido da tela e
 * indistinguivel de zerado. Quem o tira e `partesParaGravar`, logo abaixo, no
 * caminho do POST.
 */
export function partesDaSugestao(
  pesos: readonly PesoDoMembro[],
  total: number | null | undefined
): ParteDaSugestao[] {
  const centavos =
    typeof total === "number" && Number.isFinite(total) && total > 0
      ? ratearPorPeso(
          toCents(total),
          // Em ordem de `member_id`, para o desempate de resto igual deste
          // rateio ser o MESMO de quem grava a despesa -- ver o cabecalho.
          // `ratearPorPeso` devolve um Map pela chave recebida, entao a ordem de
          // entrada nao vaza para a saida.
          [...pesos]
            .sort((a, b) =>
              a.member_id < b.member_id ? -1 : a.member_id > b.member_id ? 1 : 0
            )
            .map((p) => ({ user_id: p.member_id, peso: p.centesimos }))
        )
      : null;

  return pesos.map((p) => {
    const parte: ParteDaSugestao = {
      member_id: p.member_id,
      percentage: paraPercentual(p.centesimos),
    };
    if (centavos) {
      parte.amount = toReais(centavos.get(p.member_id) ?? 0);
    }
    return parte;
  });
}

/**
 * As partes de uma sugestao virando o `custom_splits` do POST da despesa.
 *
 * SO TIRA O 0% -- E ISSO E OBRIGATORIO, NAO COSMETICO
 * ---------------------------------------------------
 * `divisaoPorPorcentagem` (lib/divisao-do-grupo.ts) RECUSA parte com
 * `percentage <= 0`, com a mensagem "Percentual inválido na divisão: 0,00%". Ela
 * recusa, e nao descarta, porque `expense_splits.percentage` tem CHECK `> 0` e
 * um 0 que chegasse ao INSERT derrubaria a linha inteira com um erro sobre uma
 * coluna que nao diz nada a quem lancou a despesa.
 *
 * Antes desta fase isso nao era alcancavel: a sugestao configurada nunca
 * aparecia, entao nenhum `custom_splits` vindo de sugestao jamais tinha um zero.
 * Ligar a sugestao TORNA o caso alcancavel -- um grupo 100/0 (uma pessoa banca o
 * mes, que a fase 1 trata como estado legitimo) passaria a oferecer uma sugestao
 * que a tela mostra certa e o POST recusa SEMPRE. Por isso o filtro mora no
 * caminho do POST, e nao em `partesDaSugestao`: a tela continua listando o
 * grupo inteiro, e o corpo leva so o que o banco aceita.
 *
 * A soma NAO muda ao tirar o zero -- 0 nao contribui --, entao a conferencia de
 * 100% do outro lado continua passando pelo mesmo caminho.
 */
export function partesParaGravar(
  partes: readonly ParteDaSugestao[]
): ParteDaSugestao[] {
  return partes.filter((p) => p.percentage > 0);
}

/**
 * A divisao IGUAL: sempre disponivel, porque ela nao depende de configuracao
 * nenhuma.
 *
 * Os pesos vem de `igualitario` -- 10000 por maior resto -- e nao de `100 / n`:
 * `100 / 3` nao tem duas casas decimais, e tres `33.333...` arredondados por
 * `percentagemGravavel` somam 99,99 na coluna.
 */
export function pesosIguais(ids: readonly string[]): PesoDoMembro[] {
  return igualitario([...ids]);
}

/** Uma linha de `group_members` como as sugestoes a leem. */
export interface MembroDaSugestao {
  member_id: string;
  /** `group_members.percentage`, o `numeric(5,2)` cru do banco. */
  percentage?: unknown;
}

/**
 * A divisao CONFIGURADA do grupo (fase 3), ou `null` quando o fechamento do mes
 * nao a aplica.
 *
 * `null` nos tres casos em que `divisaoDoPeriodo` cai em `equal`, e isso e a
 * feature e nao uma falha:
 *
 *   * modo que nao e `percentage` (incluindo `proportional`, o armazem
 *     aposentado, e `custom`, que e por despesa);
 *   * soma gravada != 100% -- os quatro zeros do `DEFAULT 0.00` de um grupo que
 *     ninguem configurou, ou uma linha alterada por fora pela RLS
 *     `group_members_update`. Sugerir 70/27 rateado como 72,2/27,8 seria pior
 *     que nao sugerir nada, porque o total fecha e nada na tela denuncia;
 *   * grupo sem membro ativo.
 *
 * Em todos eles a sugestao "Divisao Igual" continua la, que e exatamente o que o
 * mes vai fechar. Uma segunda sugestao dizendo "igual" com outro nome nao
 * acrescenta escolha.
 */
export function pesosConfigurados(
  modo: unknown,
  membros: readonly MembroDaSugestao[]
): PesoDoMembro[] | null {
  const aplicada = divisaoDoPeriodo(
    modo,
    // `user_id` recebe o `member_id`: `divisaoDoPeriodo` nao interpreta a chave,
    // so a devolve ao lado do peso. E o `member_id` que o corpo do POST exige.
    membros.map((m) => ({ user_id: m.member_id, percentage: m.percentage }))
  );

  if (aplicada.aplicado !== "percentage") return null;

  return aplicada.pesos.map((p) => ({
    member_id: p.user_id,
    centesimos: p.peso,
  }));
}

/** Quanto um membro participou do historico recente do grupo. */
export interface ParticipacaoDoMembro {
  member_id: string;
  /** Soma das `group_expense_splits.percentage` dele nas despesas da amostra. */
  somaPercentual: number;
  /** Em quantas despesas da amostra ele tem parte. */
  participacoes: number;
}

/**
 * A divisao baseada no HISTORICO: a media de participacao de cada um,
 * normalizada para 100%.
 *
 * `null` quando ALGUEM nao participou de nada, e nao um peso 0 para essa pessoa.
 * Media de zero despesas nao e "ela paga 0%": e "nao sei". Um membro que entrou
 * no grupo ontem iria para 0% numa sugestao que parece ter sido calculada, e a
 * conta do mes inteiro cairia nos outros. E o mesmo criterio que a rota tinha
 * (`Object.keys(historicalPercentages).length === activeMembers.length`), agora
 * num lugar que um teste alcanca.
 *
 * `null` tambem quando as medias somam zero: ai nao ha proporcao para respeitar,
 * e `proporcional` cairia no degrau da divisao igual -- devolvendo, sob o rotulo
 * "Baseado no Historico", uma copia da sugestao que ja esta acima dela na lista.
 *
 * A normalizacao e `proporcional` (lib/divisao-configurada.ts), a MESMA funcao
 * que a semeadura pela renda da fase 6 usa, e nao uma segunda distribuicao por
 * maior resto escrita aqui: ratear 100% entre tres medias de participacao tem
 * exatamente a mesma sobra de centesimo que ratear entre tres rendas.
 */
export function pesosDoHistorico(
  participacoes: readonly ParticipacaoDoMembro[]
): PesoDoMembro[] | null {
  if (participacoes.length === 0) return null;
  if (participacoes.some((p) => !(p.participacoes > 0))) return null;

  // A media fica em centesimo de ponto (`* 100`), que e a unidade do modulo. A
  // escala nao muda o resultado -- `proporcional` trata peso como RAZAO e divide
  // pela soma --, mas um numero chamado "centesimo" guardando ponto percentual e
  // a classe de defeito que um dia o proximo leitor aplica duas vezes.
  const medias = participacoes.map(
    (p) => (p.somaPercentual / p.participacoes) * 100
  );

  const soma = medias.reduce((acc, m) => acc + Math.max(0, m), 0);
  if (!(soma > 0)) return null;

  return proporcional(
    participacoes.map((p) => p.member_id),
    medias
  );
}

/**
 * Quanto a mais, em centesimos de ponto, o pagador principal assume.
 *
 * Cinco pontos percentuais, o mesmo numero que a rota usava. Nao e calculado: e
 * um empurrao simbolico sobre a divisao igual, para quem ja adianta a maioria
 * das despesas.
 */
export const PONTOS_DO_PAGADOR_PRINCIPAL = 500;

/**
 * A divisao IGUAL com o pagador principal assumindo cinco pontos a mais.
 *
 * ESTA SUGESTAO NAO ERA GRAVAVEL, E O MOTIVO NAO ERA SUTIL
 * -------------------------------------------------------
 * A rota montava `base + 5` para o pagador e `95 / (n - 1)` para cada um dos
 * outros. Com DOIS membros isso e 55 e 95 -- soma 150%. Com tres, 38,33 e 47,5 e
 * 47,5, soma 133,33. Nenhuma delas passava por `divisaoParaGravar`, que recusa
 * soma fora de 100 por meio ponto: escolher esta sugestao e salvar devolvia erro,
 * sempre, para qualquer grupo. O `95` era a sobra depois de UM `+5`, repartida
 * como se fosse o total.
 *
 * Aqui o empurrao e `rebalancear` (fase 1), a mesma funcao do slider da tela: a
 * sobra `10000 - pedido` vai para os outros proporcionalmente ao que eles tinham,
 * e a soma e 10000 cravado por construcao. Com dois membros da 55/45.
 *
 * `null` com menos de dois membros, ou quando o pagador nao esta na lista. Num
 * grupo de um a sugestao nao significa nada -- e era ela que dividia por zero em
 * `95 / (n - 1)`.
 */
export function pesosDoPagadorPrincipal(
  ids: readonly string[],
  pagadorId: string
): PesoDoMembro[] | null {
  if (ids.length < 2) return null;

  const base = pesosIguais(ids);
  const dele = base.find((p) => p.member_id === pagadorId);
  if (!dele) return null;

  return rebalancear(
    base,
    pagadorId,
    Math.min(
      CENTESIMOS_TOTAIS,
      dele.centesimos + PONTOS_DO_PAGADOR_PRINCIPAL
    )
  );
}
