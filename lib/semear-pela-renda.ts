/**
 * SEMEAR A DIVISAO DO GRUPO PELA RENDA DO MES (HMO-245, fase 6).
 *
 * O pedido: um botao que leva os sliders da divisao para os percentuais da
 * receita de cada membro. Clica, os numeros vao para lá, e da para ajustar antes
 * de salvar.
 *
 * AS TRES DECISOES DO HELIO (04/10/2026), E ONDE CADA UMA MORA
 * ------------------------------------------------------------
 *   1. **Semear, nao viver.** A configuracao fica PARADA depois do clique. Nao ha
 *      nada neste modulo que releia renda no fechamento, e e deliberado: "divisao
 *      de casa que muda sozinha porque alguem recebeu um bonus gera discussao,
 *      nao acordo". O fechamento continua lendo `group_members.percentage` por
 *      `divisaoDoPeriodo`, sem saber que esta funcao existe.
 *   2. **Recebida + prevista.** A mesma regua dos dois lados: se a conta que vence
 *      dia 15 ja conta como despesa do mes (e e o que `fecharMes` faz), o salario
 *      que entra dia 20 conta como receita do mes.
 *   3. **So a porcentagem.** O percentual e de todos; o R$ da renda e so do
 *      proprio dono. Quem recorta e `semearPelaRenda` -- ver abaixo.
 *
 * POR QUE `calculate_member_proportions` (001_baseline:234) FICOU DE FORA
 * ----------------------------------------------------------------------
 * A funcao SQL existe, e `SECURITY DEFINER`, e grava em
 * `group_member_proportions`. Ela nao serve, por tres motivos que sao dinheiro:
 *
 *   1. ela soma **so** `financial_transactions` com `transaction_type = 'income'`.
 *      Nao le `scheduled_transactions` -- nao ha previsto nenhum. A legenda do
 *      modal antigo diz "realizadas + previstas"; o rotulo ja mentia;
 *   2. linha com `transaction_type` **NULO** desaparece da conta. Elas existem
 *      (ver [[transaction-type-nulo-esconde-o-pago]]);
 *   3. quando um membro nao tem receita no mes ela **inventa R$ 1.000**
 *      (`COALESCE(..., 1000)`, tres vezes). O membro nao sai com 0%: sai com uma
 *      fracao calculada sobre mil reais que nao existem -- e os outros perdem
 *      percentual para esse dinheiro imaginario.
 *
 * Os tres se consertam de graca aqui porque este modulo NAO tem leitura propria
 * de linha: ele reaproveita `linhaDoRealizado` e `linhaDoPrevisto` de
 * lib/fechamento-do-grupo.ts, que ja classificam tipo por `transaction_type` com
 * queda para o SINAL, ja leem `direction` da view no previsto, e ja descartam a
 * prevista com baixa (`status === 'paid'`) para a mesma conta nao contar duas
 * vezes. A funcao SQL fica onde esta, sem novos chamadores.
 *
 * E O ZERO SAI DA ARITMETICA, NAO DE UM `if`
 * ------------------------------------------
 * `proporcional` (lib/divisao-configurada.ts) da 0 centesimo para peso 0 por
 * construcao do maior-resto. Nao ha COALESCE nenhum neste arquivo -- a ausencia
 * de renda e zero, e zero e o que o membro recebe.
 *
 * O RECORTE DA PRIVACIDADE E AQUI, E NAO NA TELA
 * ----------------------------------------------
 * `renda_centavos` so existe na linha de quem esta pedindo. Nao e `null` nos
 * outros: a chave e **ausente**. Isso importa porque esconder o R$ no componente
 * deixaria o salario de todo mundo no JSON que o navegador baixa -- uma
 * verificacao feita so na tela passa verde com o salario na resposta. A rota nao
 * monta esse recorte por conta propria: ela chama esta funcao, que e a unica que
 * decide.
 *
 * O MES E RECORTADO POR PREFIXO DE STRING
 * ---------------------------------------
 * Por `mesDaData`, a mesma do fechamento. `new Date("2026-10-01")` e meia-noite
 * UTC, que em America/Sao_Paulo e 21:00 de 30/09 -- o salario do dia 1 cairia no
 * mes anterior, e so em maquina com fuso negativo. O teste roda nos dois fusos.
 */

import {
  paraPercentual,
  proporcional,
  type PesoDoMembro,
} from "@/lib/divisao-configurada";
import { mesDaData, type LinhaCrua } from "@/lib/fechamento-do-grupo";
import { toCents } from "@/lib/settlement";

/** Um membro ativo do grupo, como a semeadura precisa dele. */
export interface MembroParaSemear {
  /**
   * `group_members.id` -- a chave que o PUT /split-config exige no corpo, e
   * portanto a que a tela usa nos sliders.
   */
  member_id: string;
  /**
   * `group_members.user_id` -- a chave da RENDA, porque receita mora em
   * `financial_transactions.user_id`.
   *
   * As duas vem juntas de proposito: traduzir uma na outra em dois lugares e
   * como a parte de um aparece no nome do outro. E e `user_id` que decide a
   * privacidade, nunca `member_id` -- quem pede a semeadura prova quem e pelo
   * `auth.uid()`, nao pelo id de uma linha que ele pode nomear.
   */
  user_id: string;
}

/** A renda de um membro no mes, e o peso que ela virou. */
export interface LinhaSemeada {
  member_id: string;
  user_id: string;
  /** Centesimos de ponto percentual. A soma da lista e 10000, cravado. */
  centesimos: number;
  /** O mesmo numero como `numeric(5,2)`, pronto para o corpo do PUT. */
  percentage: number;
  /**
   * `false` = este membro nao tem receita lancada no mes, e por isso saiu em 0%.
   *
   * Vem na resposta porque 0% TIRA o membro da divisao da despesa
   * (`divisaoDaDespesa` omite quem esta em zero, que `expense_splits.percentage`
   * exige `> 0`). Sem este campo a tela nao tem como distinguir "concordamos que
   * ele nao paga" de "a semeadura nao achou a renda dele" -- e sumido da tela e
   * indistinguivel de zerado.
   */
  tem_renda: boolean;
  /**
   * A renda do mes em CENTAVOS -- presente **so** na linha de quem pediu.
   *
   * Chave ausente nos outros, nao `null`: `'renda_centavos' in linha` e a
   * pergunta que a sonda faz, e `null` responderia "sim".
   */
  renda_centavos?: number;
}

export interface Semeadura {
  /** `YYYY-MM`, o mes que foi lido. */
  mes: string;
  /** Um por membro ativo, na ordem recebida. */
  membros: LinhaSemeada[];
  /** A soma dos percentuais semeados, em centesimos. 10000 num grupo com membro. */
  soma_centesimos: number;
  /**
   * `true` = NINGUEM lancou receita no mes, e a semeadura caiu na divisao IGUAL.
   *
   * O degrau do `0/0` de `proporcional`. A tela tem de dizer isso: sem o aviso,
   * um grupo onde ninguem lancou receita ve a semeadura devolver 50/50 e le isso
   * como "lemos a renda de voces, e ela e igual".
   */
  sem_renda_nenhuma: boolean;
  /** Quantos membros sairam em 0% por nao ter receita lancada no mes. */
  membros_sem_renda: number;
}

/**
 * A renda de cada membro no mes, em CENTAVOS, por `user_id`.
 *
 * O que entra e `LinhaCrua` -- o mesmo tipo que `fecharMes` consome --, e e por
 * isso que esta funcao nao tem regra propria sobre tipo, sinal, moeda ou
 * duplicata: `linhaDoRealizado` e `linhaDoPrevisto` ja resolveram os quatro, com
 * teste e mutante. Aqui o filtro e `tipo === 'income'`, e so.
 *
 * A QUEDA PARA `expense` NO `??` E DELIBERADA, E E O LADO SEGURO
 * -------------------------------------------------------------
 * Linha sem tipo nenhum NAO entra como renda. Em `fecharMes` o mesmo `??` tem o
 * efeito oposto (linha sem tipo CONTA como despesa) porque lá o erro caro e
 * perder uma conta do mes; aqui o erro caro e inventar renda, que empurra
 * percentual para quem nao ganhou. Os dois lados do `??` existem para o mesmo
 * campo ausente, e cada um cai para o lado em que o engano custa menos.
 *
 * Nao e o caso comum: `linhaDoRealizado` ja classifica a linha sem
 * `transaction_type` pelo SINAL do valor, entao o salario antigo sem tipo chega
 * aqui como `income` -- o que conserta o defeito 2 da funcao SQL.
 */
export function rendaPorMembro(
  linhas: readonly LinhaCrua[],
  mes: string
): Map<string, number> {
  const porMembro = new Map<string, number>();

  for (const l of linhas) {
    if (mesDaData(l.data) !== mes) continue;
    if ((l.tipo ?? "expense") !== "income") continue;
    // Linha sem pagador identificado nao tem a quem somar. Nao e renda de
    // ninguem, e somar num `""` criaria um membro fantasma com peso.
    if (!l.pagador_user_id) continue;

    // `Math.abs` porque receita prevista e receita realizada chegam com sinais
    // que a convencao do app nao garante iguais, e `valorDoFechamento` -- que ja
    // rodou em `linhaDoRealizado`/`linhaDoPrevisto` -- entrega positivo. O abs
    // aqui e cinto: uma linha montada a mao com valor negativo encolheria a
    // renda do membro em vez de somar.
    const centavos = Math.abs(toCents(Number(l.valor) || 0));
    porMembro.set(
      l.pagador_user_id,
      (porMembro.get(l.pagador_user_id) ?? 0) + centavos
    );
  }

  return porMembro;
}

/**
 * Os pesos que a semeadura propoe, e o recorte de quem ve o R$.
 *
 * `viewerUserId` e o `auth.uid()` de quem pediu. `null` (ou um usuario que nao
 * esta na lista) devolve a lista SEM `renda_centavos` em linha nenhuma -- que e
 * o lado seguro de um parametro esquecido: a resposta fica pobre, nunca
 * indiscreta.
 */
export function semearPelaRenda(
  membros: readonly MembroParaSemear[],
  linhas: readonly LinhaCrua[],
  mes: string,
  viewerUserId: string | null
): Semeadura {
  const renda = rendaPorMembro(linhas, mes);
  const centavosDe = (m: MembroParaSemear) => renda.get(m.user_id) ?? 0;

  // Por POSICAO, como em `rebalancear`: `proporcional` devolve na ordem que
  // recebeu, e casar por mapa colapsaria dois membros com o mesmo id.
  const pesos: PesoDoMembro[] = proporcional(
    membros.map((m) => m.member_id),
    membros.map(centavosDe)
  );

  const linhasSemeadas: LinhaSemeada[] = membros.map((m, i) => {
    const centesimos = pesos[i]?.centesimos ?? 0;
    const rendaCentavos = centavosDe(m);

    return {
      member_id: m.member_id,
      user_id: m.user_id,
      centesimos,
      percentage: paraPercentual(centesimos),
      tem_renda: rendaCentavos > 0,
      // O recorte. Espalhamento condicional para a chave ficar AUSENTE, e nao
      // `null`: a sonda pergunta `'renda_centavos' in linha`, e `null` responde
      // "sim". A comparacao e por `user_id`, nunca por `member_id`.
      ...(viewerUserId !== null && m.user_id === viewerUserId
        ? { renda_centavos: rendaCentavos }
        : {}),
    };
  });

  return {
    mes,
    membros: linhasSemeadas,
    soma_centesimos: linhasSemeadas.reduce((acc, l) => acc + l.centesimos, 0),
    // `membros.length > 0 &&` nao e decoracao: num grupo sem membro ativo o
    // `every` passa por vacuidade e a resposta diria "ninguem lancou receita"
    // sobre uma lista vazia, onde o que houve foi nao haver ninguem.
    sem_renda_nenhuma:
      membros.length > 0 && membros.every((m) => centavosDe(m) <= 0),
    membros_sem_renda: linhasSemeadas.filter((l) => !l.tem_renda).length,
  };
}
