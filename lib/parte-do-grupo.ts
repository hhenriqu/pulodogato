/**
 * A MINHA parte de uma despesa de grupo (HMO-177).
 *
 * O aluguel de R$ 3.000 do grupo Casa, com duas pessoas, aparecia como
 * R$ 3.000 de custo fixo mensal -- para as DUAS. A parte do outro virava sua.
 *
 * POR QUE O NUMERO ESTAVA ERRADO PARA TODO MUNDO, E POR DOIS MOTIVOS
 * ------------------------------------------------------------------
 * `/api/scheduled-transactions/summary` faz duas consultas e nenhuma delas
 * filtra por `user_id` -- de proposito, porque a RLS e quem filtra. Mas as
 * policies do 005 nao sao `user_id = auth.uid()` e mais nada:
 *
 *   recurring_rules_select / scheduled_transactions_select
 *     USING (user_id = auth.uid()
 *            OR (group_id IS NOT NULL AND public.is_group_member(group_id)))
 *
 * O `OR` existe para a tela do grupo funcionar, e o efeito colateral e que a
 * consulta SEM filtro devolve, alem das minhas linhas, as linhas de grupo de
 * todos os outros membros. Medido num Postgres local com as migrations reais
 * (001 -> 025), uma regra de aluguel de R$ 3.000 do Helio no grupo Casa:
 *
 *   quem                      regras   soma      previstas   soma
 *   Helio (dono da regra)          1   3000.00           1   3000.00
 *   Lais  (nao tem regra nenhuma)  1   3000.00           1   3000.00
 *   alguem de fora (controle)      0         0           0         0
 *
 * Entao o Helio via o dobro da parte dele, e a Lais -- que nao cadastrou nada
 * -- via um custo fixo de R$ 3.000 saido de uma regra que nao e dela, e uma
 * conta a pagar no nome do Helio. O controle negativo (quem nao e do grupo ve
 * zero) e o que prova que isso e a RLS falando, e nao superusuario furando ela.
 *
 * A CORRECAO E A MESMA NOS DOIS CASOS
 * -----------------------------------
 * Contar, da linha de grupo, so a parte de um membro. Para o Helio isso da
 * R$ 1.500 e para a Lais tambem R$ 1.500 -- e a soma das duas continua sendo
 * o aluguel inteiro. Nao e coincidencia: e por isso que "a minha parte" e a
 * unica leitura que fecha para os dois lados ao mesmo tempo.
 *
 * O TRIGGER PASSOU A HONRAR O PERCENTUAL, E AGORA OS DOIS LADOS CONCORDAM
 * ----------------------------------------------------------------------
 * `expense_groups.default_split_type` aceita equal/percentage/custom/
 * proportional, mas quem cria a divisao de verdade e o trigger
 * `auto_create_group_transaction`, e desde a 042 (HMO-304) ele honra
 * `group_members.percentage`: a ligacao nasce `split_type = 'percentage'` e
 * cada parte sai pelo PESO do membro, dividido pela SOMA dos pesos, em centavos
 * inteiros pelo maior resto.
 *
 * E ESTE ARQUIVO ERA A METADE QUE FALTAVA. A 042 fechou o lado REALIZADO e
 * registrou, com estas palavras, o que sobrava: *"trocar a contagem pelos pesos
 * AQUI e o conserto do previsto nas telas (...) enquanto isso nao entrar, o
 * grupo 70/30 ve 50/50 nestas leituras e 70/30 na baixa"*. E o que a HMO-303
 * fez: `parteConfiguradaDoMembro`, abaixo, recebe os PESOS e delega para
 * `ratearPorPeso` -- a mesma aritmetica que a 042 reproduziu em plpgsql. Num
 * grupo 70/30 a conta prevista de R$ 1.000 vale R$ 300,00 na tela e R$ 300,00 na
 * baixa; antes ela valia R$ 500,00 na tela e R$ 300,00 na baixa, e a mesma conta
 * mudava de valor ao ser paga.
 *
 * O DESVIO QUE SOBRA E DE UM CENTAVO, E SO NO EMPATE DE RESTOS
 * -----------------------------------------------------------
 * A 042 desempata o centavo da sobra pelo menor `group_members.id` -- a ordem do
 * `calculate_equal_split` (007:476) --, e `ratearPorPeso` desempata pelo menor
 * INDICE da lista que o chamador entregou. Por isso
 * `montarParticipantesPorGrupo` ordena por `id`: e o que faz os dois desempates
 * coincidirem, e fecha o unico desvio que a 042 deixou anotado ("quando dois
 * restos empatam, previsto e realizado podem portanto diferir UM CENTAVO de
 * lugar"). Sem empate de restos -- o caso de todo grupo 70/30 -- a ordem nao muda
 * numero nenhum.
 *
 * O GRUPO SEM DIVISAO CONFIGURADA NAO MUDOU DE NUMERO, nem aqui nem na baixa.
 * `percentage` e `numeric(5,2) DEFAULT 0.00` e NULLABLE, e grupo que nunca
 * passou pela tela de divisao (HMO-271) tem soma de pesos ZERO: a 042 manda esse
 * caso para o `calculate_equal_split` e `ratearPorPeso` cai no degrau do 0/0.
 * Os dois dividem IGUAL -- que e a divisao de `parteDoMembro`, e e por isso que
 * ela continua neste arquivo.
 *
 * TUDO EM CENTAVOS INTEIROS
 * -------------------------
 * Mesma razao de `lib/settlement.ts`, `lib/grupos.ts` e
 * `lib/orcamento-de-grupo.ts`: dividir em ponto flutuante deixa residuo, e o
 * proprio banco arredonda a parte para `numeric(15,2)`. `toCents` vem de
 * settlement.ts porque ela e a UNICA conversao reais -> centavos do projeto.
 */

import { toCents, toReais } from "@/lib/settlement";
import { ratearPorPeso, type ParticipanteComPeso } from "@/lib/fechamento-do-grupo";
import { monthlyCost } from "@/lib/recurrence";
import type { RecurrenceFrequency } from "@/types/financial";

/**
 * Quantos membros ATIVOS cada grupo tem, indexado por `group_id`.
 *
 * Grupo ausente do mapa nao e o mesmo que grupo de um membro: ver
 * `parteDoMembro`.
 *
 * NAO E MAIS O INSUMO DAS ROTAS (HMO-303) -- elas passam
 * `ParticipantesPorGrupo`. Ver `parteDoMembro` para por que esta contagem
 * continua existindo.
 */
export type MembrosAtivosPorGrupo = ReadonlyMap<string, number>;

/**
 * QUEM participa de cada grupo, e com que peso -- o insumo da HMO-303.
 *
 * Substituiu a contagem (`MembrosAtivosPorGrupo`) como insumo das cinco
 * leituras, e a troca nao e cosmetica: `ratearPorPeso` precisa de TODOS os
 * participantes porque a soma dos pesos e o denominador. Uma contagem nao sabe
 * dizer qual fracao e a minha quando o grupo e 70/30.
 *
 * Grupo AUSENTE do mapa, ou com lista vazia, nao e "grupo de um membro": e
 * "nao sei", e a resposta e o valor cheio. Ver `parteConfiguradaDoMembro`.
 */
export type ParticipantesPorGrupo = ReadonlyMap<
  string,
  readonly ParticipanteComPeso[]
>;

/** Uma linha de `group_members` como as cinco leituras a consultam. */
export interface MembroCru {
  group_id: string;
  user_id?: string | null;
  /**
   * `group_members.id` -- a CHAVE DE ORDENACAO, e nao um campo de exibicao.
   *
   * Ela esta aqui por um motivo so: e por `id` que a 042 desempata o centavo que
   * sobra no rateio (a ordem do `calculate_equal_split`, 007:476). Ordenar por ela
   * faz o previsto e o realizado entregarem a MESMA parte para a mesma pessoa,
   * inclusive no empate -- ver o cabecalho deste arquivo.
   *
   * OPCIONAL, e a ausencia cai em `user_id`: ver `montarParticipantesPorGrupo`.
   */
  id?: string | null;
  /**
   * `group_members.percentage`, o `numeric(5,2)` cru do banco.
   *
   * NULLABLE (001:1215) e e o estado da maioria dos grupos que existem: quem
   * nunca abriu a tela de divisao nao tem nada gravado aqui. Com TODOS os pesos
   * nulos `ratearPorPeso` cai no degrau do 0/0 e divide IGUAL -- exatamente o
   * que `parteDoMembro` fazia. Grupo sem divisao configurada nao muda de numero
   * com a HMO-303, e e isso que torna a troca segura para a base instalada.
   */
  percentage?: number | string | null;
  status?: string | null;
}

/**
 * O minimo que este modulo le de uma regra recorrente.
 *
 * Os numericos chegam do PostgREST como string (`numeric(15,2)` nao cabe em
 * double sem perda, entao o driver nao converte); por isso `number | string`.
 */
export interface RegraParaCusto {
  amount: number | string;
  /**
   * O enum de verdade, e nao `string`: `monthlyCost` trata frequencia
   * desconhecida como SEMANAL (o `?? 7` de DAYS_PER_PERIOD em lib/recurrence),
   * entao um 'yearly' digitado no lugar de 'annual' nao da erro -- transforma
   * R$ 1.200 por ano em R$ 1.738 por mes.
   */
  frequency: RecurrenceFrequency;
  interval_count?: number | null;
  transaction_type?: string | null;
  group_id?: string | null;
}

/**
 * A MINHA parte de uma despesa de grupo, PELO PERCENTUAL CONFIGURADO -- HMO-303.
 *
 * Esta e a funcao que as cinco leituras do app chamam. `parteDoMembro`, abaixo,
 * e a divisao igual que ela substituiu.
 *
 * ELA NAO TEM ARITMETICA PROPRIA, E ISSO E A ENTREGA
 * --------------------------------------------------
 * Quem divide e `ratearPorPeso` (lib/fechamento-do-grupo.ts) -- a MESMA funcao
 * que o fechamento do grupo cobra. Tres razoes, nessa ordem:
 *
 *   1. "as tres leituras concordam" deixa de ser uma coincidencia que um teste
 *      confere e passa a ser a mesma linha de codigo rodando tres vezes;
 *   2. o cabecalho da migration 033 ja decidiu isso para o lado REALIZADO, com o
 *      argumento certo: recalcular cria a segunda implementacao de divisao, que
 *      empata na maioria dos casos e diverge exatamente nos que doem;
 *   3. `ratearPorPeso` soma EXATAMENTE o total em centavos inteiros.
 *      `parteDoMembro` arredonda cada linha por conta propria
 *      (`Math.round(cents / membros)`), entao N partes podem nao fechar o valor
 *      cheio. O residuo sai de graca.
 *
 * O DESCONHECIDO CONTINUA DEVOLVENDO O VALOR CHEIO
 * ------------------------------------------------
 * Grupo ausente do mapa, ou lista vazia, ou lista que nao me inclui: a resposta
 * e o valor inteiro, e nao uma fracao palpitada. A RLS de `group_members` pode
 * nao me deixar ler os membros de um grupo cuja LINHA de despesa eu enxergo, e
 * ai a lista chega incompleta. A escolha e entre errar para cima e errar para
 * baixo, e errar para baixo e pior pela razao de sempre neste arquivo: custo
 * fixo subestimado alimenta o safe-to-spend e faz o app prometer dinheiro que
 * nao existe.
 *
 * `meuUserId` AUSENTE CAI NO MESMO LUGAR -- valor cheio. Sem saber quem esta
 * olhando nao ha "minha parte" a devolver, e inventar uma (a primeira do mapa, a
 * media) seria o numero de outra pessoa com cara de certo.
 *
 * A ORDEM DA LISTA NAO E RESPONSABILIDADE DE QUEM CHAMA, e isso e requisito e
 * nao estilo: `ratearPorPeso` manda o centavo que sobra para o maior resto e, no
 * empate, para o MENOR INDICE. Duas leituras que montassem a lista em ordens
 * diferentes discordariam em R$ 0,01 -- e a tolerancia do controle da HMO-298 e
 * R$ 0,004, ou seja ele REPROVA. Quem fixa a ordem e
 * `montarParticipantesPorGrupo`, uma vez, onde a suite a alcanca; cinco
 * `ORDER BY user_id` espalhados pelas consultas seriam cinco lugares para
 * esquecer, e o esquecido nao da erro nenhum -- da um centavo.
 */
export function parteConfiguradaDoMembro(
  valorCheio: number | string,
  groupId: string | null | undefined,
  pesosPorGrupo: ParticipantesPorGrupo,
  meuUserId: string | null | undefined
): number {
  const cheio = Number(valorCheio) || 0;
  if (!groupId) return cheio;
  if (typeof meuUserId !== "string" || meuUserId === "") return cheio;

  const participantes = pesosPorGrupo.get(groupId);
  if (participantes === undefined || participantes.length === 0) return cheio;

  // Eu nao estar na lista e o mesmo "nao sei" de lista vazia: pode ser a RLS, e
  // pode ser um grupo de que eu sai e cuja despesa antiga ainda enxergo.
  // `ratearPorPeso(...).get(eu)` devolveria `undefined`, e o `?? 0` dele seria
  // uma conta de grupo valendo R$ 0,00 na minha tela.
  if (!participantes.some((p) => p.user_id === meuUserId)) return cheio;

  const partes = ratearPorPeso(toCents(cheio), participantes);
  return toReais(partes.get(meuUserId) ?? 0);
}

/**
 * A lista de previstas com o `amount` de cada linha de grupo trocado pela MINHA
 * parte -- HMO-303.
 *
 * E UM `map`, E AINDA ASSIM MORA NUMA FUNCAO, pela razao de
 * lib/parte-do-grupo-realizada.ts: o jeito errado de escrever este `map` nao da
 * erro. Esquecer o `group_id` no objeto de saida, ou dividir a linha PESSOAL
 * junto, ou devolver a lista sem tocar em nada -- os tres compilam, nenhum
 * levanta excecao, e o sintoma e um total plausivel e errado na tela de Despesas.
 * Aqui `npm run test:parte-do-grupo` alcanca os tres.
 *
 * O TIPO E GENERICO DE PROPOSITO: a rota passa `PrevistaCrua`, que vive em
 * lib/telas-de-movimentacao.ts. Importar aquele arquivo aqui so para tipar um
 * `map` traria `movimentacoes` + `chave-da-fatura` para dentro do grafo que o
 * tsconfig desta suite compila; e importar ESTE arquivo LA traria
 * `fechamento-do-grupo` + `recurrence` para o grafo da suite das telas. O
 * generico resolve as duas sem nenhum `as`.
 *
 * `group_id` SOBREVIVE no objeto de saida, e nao e descuido: e dele que
 * `LinhaDaTela.de_grupo` sai, e esse e o ROTULO. Uma conta de R$ 900 que a
 * pessoa nao lancou e indistinguivel de um bug sem ele.
 */
export function previstasComAMinhaParte<
  T extends { amount: number | string | null; group_id?: string | null },
>(
  previstas: readonly T[],
  pesosPorGrupo: ParticipantesPorGrupo,
  meuUserId: string | null | undefined
): T[] {
  return previstas.map((p) => {
    // Linha fora de grupo passa INTACTA -- nem o objeto e recriado. Nao e
    // otimizacao: `parteConfiguradaDoMembro` devolve `Number(amount) || 0` para
    // ela, e isso converteria a `string` do PostgREST (`numeric(15,2)` chega
    // como texto) num `number`, trocando o tipo de toda linha pessoal da tela
    // por um caminho que nada neste arquivo testa.
    if (!p.group_id) return p;
    return {
      ...p,
      amount: parteConfiguradaDoMembro(
        p.amount ?? 0,
        p.group_id,
        pesosPorGrupo,
        meuUserId
      ),
    };
  });
}

/**
 * Monta `ParticipantesPorGrupo` a partir das linhas cruas de `group_members`.
 *
 * Existe como funcao pura pelo motivo de `contarMembrosAtivos`, e com uma razao
 * a mais: ela e o UNICO lugar que fixa a ordem da lista, e a ordem vale um
 * centavo (ver `parteConfiguradaDoMembro`). Um `reduce` dentro de cada uma das
 * cinco rotas passaria verde com a ordem do banco, que e a ordem fisica das
 * linhas -- estavel ate o primeiro `UPDATE` em `percentage`.
 *
 * `status` NAO-'active' sai, como em `contarMembrosAtivos`: quem saiu do grupo
 * nao divide a conta. Linha sem `user_id` sai tambem -- sem dono ela nao e
 * participante de nada, e `ratearPorPeso` indexa o resultado por `user_id`.
 *
 * `percentage` NULO VIRA PESO 0, e nao 1. Isto parece o detalhe errado e e o
 * certo: com TODOS os pesos em zero `ratearPorPeso` cai no degrau do 0/0 e
 * divide IGUAL -- o comportamento de `parteDoMembro`, que e o que a base
 * instalada tem hoje. Com `?? 1` o grupo em que SO UMA pessoa configurou 70%
 * rateria 70/1 em vez de 70/0, e a parte de quem nao configurou sairia de 30%
 * para 1,4%. `fecharMes` toma a mesma decisao, com o mesmo comentario.
 */
export function montarParticipantesPorGrupo(
  linhas: readonly MembroCru[]
): Map<string, ParticipanteComPeso[]> {
  const comChave = new Map<
    string,
    { chave: string; user_id: string; peso: number }[]
  >();

  for (const linha of linhas) {
    if (linha.status && linha.status !== "active") continue;
    if (typeof linha.user_id !== "string" || linha.user_id === "") continue;

    const lista = comChave.get(linha.group_id) ?? [];
    lista.push({
      // A CHAVE DE ORDENACAO: `group_members.id` quando a consulta o trouxe,
      // `user_id` quando nao. Os dois sao uuid e nenhum dos dois muda; o que o
      // `id` da a mais e desempatar IGUAL a 042 (ver o cabecalho). O fallback
      // existe porque a linha sintetizada de um teste nao tem `id`, e cair em
      // "sem ordem" ali seria trocar uma ordem imperfeita por nenhuma.
      chave:
        typeof linha.id === "string" && linha.id !== ""
          ? linha.id
          : linha.user_id,
      user_id: linha.user_id,
      // `Number(null)` e 0 e `Number("")` e 0; `Number(undefined)` e NaN, e
      // `ratearPorPeso` ja normaliza NaN para 0. As tres ausencias terminam no
      // mesmo peso 0, que e o degrau da divisao igual.
      peso: Number(linha.percentage ?? 0),
    });
    comChave.set(linha.group_id, lista);
  }

  // A ORDEM, FIXADA AQUI E SO AQUI -- e e ela que vale um centavo. Ver
  // `parteConfiguradaDoMembro` (duas leituras em ordens diferentes discordam em
  // R$ 0,01, e a tolerancia do controle da HMO-298 e R$ 0,004) e o cabecalho
  // deste arquivo (a 042 desempata pelo mesmo `id`).
  //
  // `forEach` e nao `for...of` sobre `.values()`: o tsconfig do projeto compila
  // para ES5, onde iterar um `MapIterator` exige `--downlevelIteration`.
  const porGrupo = new Map<string, ParticipanteComPeso[]>();
  comChave.forEach((lista, groupId) => {
    lista.sort((a, b) => (a.chave < b.chave ? -1 : a.chave > b.chave ? 1 : 0));
    // A CHAVE NAO ATRAVESSA. `ParticipanteComPeso` e o que `ratearPorPeso`
    // recebe, e ela ja fez o trabalho dela: um campo a mais chegando la dentro
    // convidaria um segundo `sort` a existir no outro lado da fronteira.
    porGrupo.set(
      groupId,
      lista.map((p) => ({ user_id: p.user_id, peso: p.peso }))
    );
  });

  return porGrupo;
}

/**
 * A parte de UM membro num valor, DIVIDINDO IGUAL.
 *
 * NAO E MAIS A LEITURA DO APP (HMO-303): as cinco rotas chamam
 * `parteConfiguradaDoMembro`, que honra `group_members.percentage`. Esta
 * continua aqui porque ela e a divisao igual que esta em producao desde a
 * HMO-177 e tem teste e mutante proprios -- e o degrau do 0/0 de
 * `ratearPorPeso`, que e o caminho por onde o grupo SEM divisao configurada
 * passa, so tem uma segunda prova independente enquanto esta funcao e as
 * assercoes dela existirem. Mesmo argumento de `ratearCentavos` em
 * lib/fechamento-do-grupo.ts.
 *
 * Fora de grupo (`group_id` nulo) a parte e o valor inteiro -- despesa pessoal
 * nao se divide com ninguem.
 *
 * QUANDO A CONTAGEM NAO E CONHECIDA, DEVOLVE O VALOR CHEIO
 * -------------------------------------------------------
 * Um grupo pode faltar no mapa por motivo legitimo: a RLS de `group_members`
 * pode nao me deixar contar os membros de um grupo cuja LINHA de despesa eu
 * enxergo. Nesse caso a escolha e entre errar para cima (valor cheio, que e o
 * que a tela mostrava antes desta correcao) e errar para baixo (dividir por um
 * palpite). Errar para baixo e pior: um custo fixo subestimado alimenta o
 * safe-to-spend e faz o app dizer que sobra dinheiro que nao sobra. Entao aqui
 * o desconhecido mantem o valor cheio, e nao ha divisao por zero possivel.
 */
export function parteDoMembro(
  valorCheio: number | string,
  groupId: string | null | undefined,
  membrosAtivosPorGrupo: MembrosAtivosPorGrupo
): number {
  const cheio = Number(valorCheio) || 0;
  if (!groupId) return cheio;

  const membros = membrosAtivosPorGrupo.get(groupId);
  if (membros === undefined || !Number.isFinite(membros) || membros < 1) {
    return cheio;
  }
  if (membros === 1) return cheio;

  return toReais(Math.round(toCents(cheio) / membros));
}

/**
 * O custo fixo mensal que e MEU: a soma das regras ativas de despesa, cada
 * linha de grupo contando so a minha parte.
 *
 * Receita fica de fora (`transaction_type === "income"`) porque a pergunta que
 * o painel faz e "quanto sai todo mes", e era assim antes desta correcao.
 *
 * A normalizacao para "por mes" continua sendo `monthlyCost` (anual/12,
 * semanal*52/12). Tomar a parte antes ou depois de normalizar da o mesmo
 * numero -- divisao comuta --, e tomar antes deixa explicito que a parte e do
 * valor que o grupo cobra.
 */
export function custoFixoMensalDaMinhaParte(
  regras: readonly RegraParaCusto[],
  pesosPorGrupo: ParticipantesPorGrupo,
  meuUserId: string | null | undefined,
  hoje: string
): number {
  const total = regras
    .filter((r) => r.transaction_type !== "income")
    .reduce((soma, r) => {
      const minha = parteConfiguradaDoMembro(
        r.amount,
        r.group_id,
        pesosPorGrupo,
        meuUserId
      );
      return (
        soma +
        monthlyCost(
          {
            frequency: r.frequency,
            interval_count: r.interval_count ?? 1,
            start_date: hoje,
          },
          minha
        )
      );
    }, 0);

  return Number(total.toFixed(2));
}

/**
 * Conta os membros ativos por grupo a partir das linhas cruas de
 * `group_members`.
 *
 * Existe como funcao pura para o teste poder provar a contagem sem banco: um
 * `reduce` dentro da rota passaria verde com `status` errado.
 */
export function contarMembrosAtivos(
  linhas: readonly { group_id: string; status?: string | null }[]
): Map<string, number> {
  const contagem = new Map<string, number>();
  for (const linha of linhas) {
    if (linha.status && linha.status !== "active") continue;
    contagem.set(linha.group_id, (contagem.get(linha.group_id) ?? 0) + 1);
  }
  return contagem;
}
