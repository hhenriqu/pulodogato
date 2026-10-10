/**
 * OS DOIS NUMEROS QUE VAO DISCORDAR NA MESMA NAVEGACAO -- HMO-364, fase F5 da
 * HMO-360.
 *
 * Depois da F1b a aba Despesas conta a conta de grupo que EU fronto pelo valor
 * CHEIO (`previstasPelaRegraDoPagador`), e o `safe-to-spend` continua contando
 * so a MINHA PARTE (`parteConfiguradaDoMembro`, decisao da HMO-306/308, que a
 * secao 4 do plano resolveu NAO reverter). Num grupo 70/30 com uma conta de
 * R$ 1.000 que eu pago, a aba Despesas diz R$ 1.000 e o painel diz R$ 700 --
 * lado a lado, no mesmo mes, com dois numeros certos.
 *
 * POR QUE ISTO E ENTREGA, E NAO ENFEITE
 * -------------------------------------
 * Este app ja pagou QUATRO vezes pela familia
 * `despesa-de-grupo-tem-tres-convencoes`: quatro telas respondendo 990 / 950 /
 * 900 / 990 para a mesma despesa do mes, nenhuma delas errada sozinha, e
 * NENHUMA com rotulo na tela. A HMO-275 acrescentou a quinta resposta. Um
 * numero novo sem legenda nao se distingue de bug -- e o caminho dessa
 * estranheza termina em alguem "consertando" a conta por fora.
 *
 * Entao cada um dos dois numeros leva UMA LINHA dizendo qual pergunta ele
 * responde, e apontando para onde a outra pergunta e respondida. As duas frases
 * moram no MESMO arquivo porque elas sao uma so explicacao dita de dois lados:
 * editar uma e esquecer a outra produz duas legendas que se contradizem, que e
 * pior do que nenhuma.
 *
 * O LINK NAO ESTA AQUI, E DE PROPOSITO: este modulo e puro e as duas telas
 * embrulham a frase com `<Link>` (o destino e tipado por `typedRoutes`, que uma
 * lib pura nao pode importar sem quebrar o build standalone que as suites e o
 * mutador usam). O que mora aqui e o TEXTO, que e o que a pessoa le e o que as
 * sondas medem.
 */

/**
 * A pergunta da aba Despesas -- o BRUTO.
 *
 * "Sai da sua conta" e nao "é seu": o valor cheio da conta de grupo SAI mesmo
 * da minha conta no dia do vencimento, e e isso que a aba Despesas passou a
 * responder. Dizer "é seu" seria falso -- 30% dela e da Leticia, e e justamente
 * o que o reembolso previsto de Receitas registra.
 */
export const PERGUNTA_DO_BRUTO = "quanto sai da sua conta";

/**
 * A pergunta do painel -- o LIQUIDO.
 *
 * O `safe-to-spend` e conservador de proposito (HMO-306): o reembolso da
 * contraparte e promessa, nao dinheiro, e um "posso gastar" que conta com
 * promessa e o pior erro possivel naquele cartao.
 */
export const PERGUNTA_DO_LIQUIDO = "quanto você pode gastar";

/**
 * A legenda do «Previsto» da aba Despesas.
 *
 * A SEGUNDA ORACAO NAO E REPETICAO DA PRIMEIRA. Sem ela a frase explica o
 * numero desta tela e deixa o do painel sem explicacao -- e e o painel que
 * mostra o numero MENOR, que e o que se le como "o app perdeu uma conta".
 */
export const LEGENDA_DO_BRUTO =
  `Este número responde ${PERGUNTA_DO_BRUTO}: a conta de grupo que você paga ` +
  `entra inteira, e a parte dos outros volta como reembolso previsto em ` +
  `Receitas. Para ${PERGUNTA_DO_LIQUIDO} depois de descontar a parte deles, ` +
  `veja «Quanto ainda posso gastar» no painel.`;

/**
 * A legenda do cartao «Quanto ainda posso gastar», no painel.
 *
 * Ela diz o numero MAIOR em voz alta ("a aba Despesas mostra mais") porque a
 * surpresa esta nessa direcao: quem ve R$ 700 aqui e R$ 1.000 la precisa saber
 * que os R$ 300 nao foram esquecidos -- eles sao a parte de outra pessoa.
 */
export const LEGENDA_DO_LIQUIDO =
  `Este número responde ${PERGUNTA_DO_LIQUIDO}: a conta de grupo entra só ` +
  `pela sua parte, porque o reembolso dos outros é promessa e não dinheiro. ` +
  `A aba Despesas mostra mais, e está certa: ela responde ` +
  `${PERGUNTA_DO_BRUTO}.`;
