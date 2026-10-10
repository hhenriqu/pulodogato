/**
 * A REGRA DO PAGADOR no lado PREVISTO -- HMO-363, fase F1 da HMO-360.
 *
 * `previstasComAMinhaParte` (lib/parte-do-grupo.ts) aplica a minha parte a TODA
 * linha de grupo e nunca olha `user_id`. Para a tela de Despesas isso responde a
 * pergunta errada quando sou EU que fronto a conta: o cartao cobra R$ 1.000 do
 * meu cartao neste mes, e a tela diz R$ 300.
 *
 * A convencao desta leitura e **bruto + reembolso**, a mesma que o Helio aprovou
 * na HMO-275 para o lado realizado:
 *
 *   | caso                      | o que esta funcao devolve                    |
 *   |---------------------------|----------------------------------------------|
 *   | `group_id` nulo           | a linha INTACTA                              |
 *   | eu lancei (`user_id` = eu)| a linha INTACTA -- valor cheio, eu fronto    |
 *   | outro membro lancou       | a MINHA parte + `pagar_para` do pagador      |
 *
 * E a soma fecha: Despesas(bruto) - Receitas(reembolso previsto) = a minha parte
 * de tudo. A metade de Receitas e a F3 (`creditoAReceber`, ja calculado e ligado
 * em UMA tela), e o plano registra que **F1 e F3 vao juntas ou nao vao** -- F1
 * sozinha infla o Previsto de Despesas sem a contrapartida.
 *
 * ESTA FASE NAO LIGA NADA. Nenhuma leitura chama esta funcao ainda; a fiacao e a
 * filha seguinte. O que esta aqui e a regra e a medicao dela.
 *
 * AS OUTRAS QUATRO LEITURAS NAO MUDAM, E ISSO FOI DECIDIDO
 * -------------------------------------------------------
 * `papel-de-pao/painel`, `safe-to-spend`, `scheduled-transactions/summary` e
 * `dashboard/previsao` continuam em `previstasComAMinhaParte`. A secao 4 do plano
 * da HMO-360 pergunta isso em voz alta e responde NAO REVERTER a HMO-306/308: o
 * safe-to-spend responde *"posso gastar isso?"* e e conservador de proposito --
 * o reembolso da contraparte e promessa, nao dinheiro. As duas leituras vao
 * discordar na mesma navegacao, e e por isso que a F5 do plano e o ROTULO de cada
 * uma. Sem legenda isto e o quinto numero sem rotulo da familia
 * `despesa-de-grupo-tem-tres-convencoes`, que este app ja pagou quatro vezes.
 *
 * O DADO JA ESTAVA NA MAO -- nenhuma consulta nova
 * -----------------------------------------------
 * `app/api/movimentacoes/resumo/route.ts` ja seleciona `user_id` e `group_id` da
 * `scheduled_transactions_effective`, desde a HMO-303 (o `OR` do filtro, com o
 * comentario das linhas ~281-296 explicando por que a linha do outro membro
 * aparece na minha tela). Distinguir "eu fronto" de "ela fronta" e um `===`
 * sobre campo que a rota ja tem.
 *
 * TUDO DELEGADO: ESTA FUNCAO NAO TEM ARITMETICA DE DIVISAO
 * -------------------------------------------------------
 * Quem divide continua sendo `parteConfiguradaDoMembro`, inalterada, sobre
 * `ratearPorPeso`. Mesmo argumento do cabecalho da 033 e de parte-do-grupo.ts:
 * uma segunda implementacao de divisao empata na maioria dos casos e diverge
 * exatamente nos que doem (o centavo do empate de restos). O que esta funcao
 * acrescenta e QUAL das duas respostas a linha recebe.
 */

import {
  parteConfiguradaDoMembro,
  type ParticipantesPorGrupo,
} from "@/lib/parte-do-grupo";

/**
 * O minimo que esta regra le de uma previsao.
 *
 * `amount` e `number | string | null` porque o PostgREST entrega `numeric(15,2)`
 * como string (nao cabe em double sem perda, entao o driver nao converte), e a
 * coluna e NOT NULL na tabela mas opcional no tipo generico de quem chama.
 */
export interface PrevistaComDono {
  amount: number | string | null;
  group_id?: string | null;
  /** `scheduled_transactions.user_id` -- quem LANCOU, ou seja quem fronta. */
  user_id?: string | null;
}

/**
 * O campo que a linha de grupo de OUTRO membro ganha: para quem eu pago.
 *
 * Opcional e `string | null` nos dois sentidos de proposito. `undefined` e "esta
 * linha nao e desse tipo" (pessoal, ou frontada por mim) e `null` e "e desse
 * tipo e eu NAO SEI para quem" -- a linha de grupo sem `user_id`, que existe
 * porque o campo e opcional no select de quem chama. Os dois estados precisam
 * ser distinguiveis: a F2 escreve o nome do pagador ao lado do valor, e um
 * rotulo ausente faz a conta do outro se ler como conta propria.
 */
export type ComPagarPara<T> = T & { pagar_para?: string | null };

/**
 * EU fronto esta conta?
 *
 * Os mesmos tres guardas do `ehMinha` privado de lib/telas-de-movimentacao.ts
 * (que decide `posso_editar` desde a HMO-301), e a repeticao e deliberada: aquele
 * arquivo nao exporta a funcao, e importa-lo aqui traria `movimentacoes` +
 * `chave-da-fatura` para o grafo que o tsconfig desta suite compila -- a mesma
 * razao pela qual `previstasComAMinhaParte` e generica em vez de importar
 * `PrevistaCrua`. Unificar as duas e trabalho da fiacao (F1b), onde o grafo ja
 * tem os dois lados; faze-lo aqui trocaria um criterio duplicado e medido por um
 * import que arrasta meia tela.
 *
 * UM GUARDA, E NAO OS DOIS DO `ehMinha` -- MEDIDO
 * -----------------------------------------------
 * O `ehMinha` tem um guarda para cada lado. Aqui o do CAMPO DA LINHA foi
 * **apagado**, porque ele nao muda resposta nenhuma: com `meuUserId` garantido
 * string nao-vazia pelo guarda que sobrou, `daLinha === meuUserId` ja e falso
 * para `undefined`, `null` e `""`. Medido sobre os 25 pares de
 * `{undefined, null, "", "u1", "u2"}`: **zero** diferem. E ele continua morto se
 * alguem trocar o `===` por `==`, porque nenhum desses tres valores e `==` a uma
 * string nao-vazia -- o que quer dizer que o mutante `igualdade_frouxa` tambem e
 * EQUIVALENTE, e por isso ele nao esta na lista do runner.
 *
 * O criterio e o do repositorio: guarda que nenhum mutante distingue apodrece
 * sem ninguem notar, e a saida de `mutantes-e-controle-negativo` para esse caso e
 * apagar, nao escrever teste para codigo morto. O `ehMinha` fica como esta: a
 * justificativa dele argumenta contra EXPRESSOES escritas a mao (`==` solto,
 * `!!meuUserId` sem comparar), que sao outras linhas, e nao e este PR que decide
 * aquele arquivo.
 *
 * O GUARDA QUE SOBROU E LOAD-BEARING: sem ele, `undefined === undefined` e
 * VERDADE, e esse e exatamente o estado de uma rota que esqueceu `user_id` no
 * select ou de uma sessao sem id. TODA linha de grupo passaria a contar bruto, e
 * o Previsto de Despesas dobraria em silencio. Erra para MAIS, que e a direcao
 * cara: a tela promete uma divida que nao e minha.
 */
export function euFrontoAConta(
  daLinha: string | null | undefined,
  meuUserId: string | null | undefined
): boolean {
  if (typeof meuUserId !== "string" || meuUserId === "") return false;
  return daLinha === meuUserId;
}

/**
 * A lista de previstas pela REGRA DO PAGADOR: cheia quando eu fronto, a minha
 * parte (com `pagar_para`) quando outro fronta.
 *
 * E UM `map`, E AINDA ASSIM MORA NUMA FUNCAO, pela razao de
 * `previstasComAMinhaParte`: os jeitos errados de escrever este `map` nao dao
 * erro. Esquecer o `group_id` na saida, dividir a linha pessoal junto, devolver a
 * lista intacta, dividir a MINHA linha de grupo tambem -- os quatro compilam,
 * nenhum levanta excecao, e o sintoma e um total plausivel e errado na tela.
 *
 * O TIPO E GENERICO pelo mesmo motivo da irma: a rota passa `PrevistaCrua`
 * (lib/telas-de-movimentacao.ts), e importar aquele arquivo aqui so para tipar um
 * `map` traria o grafo inteiro das telas para dentro desta suite.
 *
 * `meuUserId` AUSENTE DEVOLVE A LISTA INTACTA, e nao a lista rateada. Sem saber
 * quem esta olhando nao ha nem "a minha parte" nem "eu fronto" a responder, e
 * `pagar_para` apontaria para o dono da linha num contexto em que esse dono pode
 * ser eu mesmo -- a tela diria "pagar para voce". E o mesmo "nao sei devolve o
 * valor cheio" de `parteConfiguradaDoMembro`, um passo antes.
 *
 * A LINHA FRONTADA POR MIM NAO E RECRIADA -- nem o `amount` e tocado. Ela ja vem
 * com o valor cheio da view, entao nao ha nada a calcular, e converter a `string`
 * do PostgREST num `number` aqui trocaria o tipo de metade das linhas da tela por
 * um caminho que nada mede. O mesmo cuidado que a funcao de hoje tem com a linha
 * sem grupo, pelo mesmo motivo.
 */
export function previstasPelaRegraDoPagador<T extends PrevistaComDono>(
  previstas: readonly T[],
  pesosPorGrupo: ParticipantesPorGrupo,
  meuUserId: string | null | undefined
): ComPagarPara<T>[] {
  return previstas.map((p) => {
    // Linha fora de grupo: INTACTA. Ver o cabecalho de
    // `previstasComAMinhaParte` -- `Number(amount) || 0` converteria a string do
    // PostgREST em number em toda linha pessoal da tela.
    if (!p.group_id) return p;

    // Sem saber quem sou eu, nada a decidir: a lista passa inteira.
    if (typeof meuUserId !== "string" || meuUserId === "") return p;

    // EU FRONTO: valor cheio, e a linha nao e nem recriada. A contrapartida (o
    // que os outros me devem) e receita prevista, e sai na F3.
    if (euFrontoAConta(p.user_id, meuUserId)) return p;

    return {
      ...p,
      // `Math.abs` E GUARDA DE CONVENCAO, e nao aritmetica.
      //
      // `parteConfiguradaDoMembro` PRESERVA O SINAL da entrada (o `sinal` de
      // `ratearPorPeso`), e as duas fontes deste app tem sinais OPOSTOS:
      // `scheduled_transactions.amount` tem `CHECK (amount > 0)` (005:206) e
      // `financial_transactions.amount` e NEGATIVO
      // (`pulodogato-amount-sign-convention`). Com a CHECK de pe nenhum chamador
      // de producao chega aqui com valor negativo HOJE -- a entrada negativa e
      // out-of-contract, e o teste dela e sintetico por construcao.
      //
      // A guarda existe porque o defeito e MUDO e esta arvore ja o pagou: a
      // lista pinta pelo SINAL e formata com `Math.abs`, entao um valor negativo
      // aqui sai com o numero CERTO e a cor de RECEITA
      // (`group-share-entries-e-a-minha-parte`, pegadinha 1). E e exatamente o
      // risco "sinal oposto" que a secao 5 do plano da HMO-360 nomeia: misturar
      // as duas fontes cruas faz o previsto CANCELAR o realizado e o total dar
      // zero, com as duas linhas visiveis e corretas ao lado.
      //
      // So este ramo leva a guarda, porque so ele calcula: os dois ramos de cima
      // devolvem a linha sem tocar no `amount`, e aplicar `abs` la seria o
      // `Number()` que eles existem para nao fazer.
      amount: Math.abs(
        parteConfiguradaDoMembro(p.amount ?? 0, p.group_id, pesosPorGrupo, meuUserId)
      ),
      // `null` HONESTO quando a linha nao tem dono legivel. Ver `ComPagarPara`:
      // `undefined` significaria "nao e linha de outro membro", que e falso.
      pagar_para:
        typeof p.user_id === "string" && p.user_id !== "" ? p.user_id : null,
    };
  });
}
