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
 *
 * ===========================================================================
 * O SEGUNDO EIXO: O REALIZADO -- E A DIRECAO SE INVERTE (HMO-413)
 * ===========================================================================
 * As duas frases de cima falam do PREVISTO. Depois da HMO-418 existe um segundo
 * par, no REALIZADO, entre as MESMAS DUAS TELAS -- e ele aponta para o outro
 * lado. Medido nos dois route handlers com a fixture de maio da HMO-255
 * (`npm run test:criterio-do-painel`, secao 8):
 *
 *   eixo        tela                       numero    quem responde
 *   ----------  -------------------------  --------  --------------------------
 *   PREVISTO    aba Despesas (bruto)       1.000,00  MAIOR
 *   PREVISTO    painel «posso gastar»        700,00  menor
 *   REALIZADO   painel «Realizado»         1.010,00  MAIOR
 *   REALIZADO   aba Despesas «Realizado»     990,00  menor
 *
 * O PAINEL MOSTRA MENOS NO PREVISTO E MAIS NO REALIZADO. E por isso que nenhuma
 * das quatro frases pode dizer "o painel mostra menos" sem nomear de qual dos
 * dois numeros ela fala: as duas primeiras vivem na MESMA TELA que as duas
 * ultimas, e uma frase sem eixo contradiz a vizinha dela -- que e exatamente o
 * defeito que o paragrafo acima diz ser pior do que nao ter legenda.
 *
 * DE ONDE VEM O 20,00 DO REALIZADO
 * --------------------------------
 * Os dois lados concordam sobre a despesa de grupo que EU paguei (ela entra
 * INTEIRA nos dois desde a HMO-418). Eles divergem em UMA perna so: a minha
 * parte do que OUTRO pagou. O painel a soma -- e o criterio "bruto + reembolso"
 * que o Helio escolheu em 08/10/2026 na interaction
 * `hmo258:criterio-do-relatorio:v1` --, e a aba Despesas nao, porque o realizado
 * dela soma o valor CHEIO do que saiu da minha conta e aquela parte nao saiu
 * dela (o cabecalho de app/api/movimentacoes/resumo/route.ts tem o racional).
 *
 * POR QUE ISTO PRECISOU DE LEGENDA, E A HMO-418 NAO BASTOU
 * -------------------------------------------------------
 * A HMO-418 pos o numero certo no painel e com isso deixou o par num estado
 * pior de LER do que o anterior: antes da HMO-407 os dois numeros estavam em
 * telas distantes; depois dela o tile «Realizado» de Despesas e um LINK para a
 * aba Despesas. Agora clica-se em 1.010,00 e chega-se em 990,00 -- a um clique,
 * sem nada em nenhum dos dois lados ligando um ao outro. A aba Despesas ja
 * dizia que a parte de quem pagou por mim nao entra nos totais dela, mas
 * apontava para Financas Pessoais, nao para o numero de onde a pessoa veio.
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
 *
 * "NO «PREVISTO»" FOI ACRESCENTADO NA HMO-413, e nao e redundancia: no eixo do
 * REALIZADO a comparacao se inverte (o painel mostra 1.010,00 e a aba Despesas
 * 990,00), e as duas frases vivem na MESMA tela. Sem o recorte esta aqui diria
 * "a aba Despesas mostra mais" a dois centimetros de uma legenda dizendo que
 * ela mostra menos -- ver o segundo eixo no cabecalho.
 */
export const LEGENDA_DO_LIQUIDO =
  `Este número responde ${PERGUNTA_DO_LIQUIDO}: a conta de grupo entra só ` +
  `pela sua parte, porque o reembolso dos outros é promessa e não dinheiro. ` +
  `A aba Despesas mostra mais no «Previsto», e está certa: ela responde ` +
  `${PERGUNTA_DO_BRUTO}.`;

/**
 * A pergunta do «Realizado» do painel -- o CUSTO (HMO-413).
 *
 * "Custou para você" e nao "saiu da sua conta", e a diferenca e a perna inteira
 * que separa os dois numeros: a minha parte do mercado que a B pagou me CUSTOU
 * 20,00 e nao SAIU da minha conta -- ela sai no dia em que eu pagar a B. E a
 * mesma distincao que a `PERGUNTA_DO_BRUTO` faz do outro lado ("sai da sua
 * conta" e nao "é seu"), aplicada a outra perna.
 */
export const PERGUNTA_DO_CUSTO = "quanto custou para você";

/**
 * A legenda dos tiles «Realizado» do painel -- o lado de ONDE A PESSOA CLICA.
 *
 * Ela nomeia o numero do DESTINO ("a aba Despesas mostra menos") porque a
 * surpresa esta nessa direcao: quem clica em 1.010,00 e chega em 990,00 precisa
 * saber que os 20,00 nao foram perdidos no caminho. E o espelho exato da
 * `LEGENDA_DO_LIQUIDO`, com os papeis trocados -- ver o segundo eixo no
 * cabecalho.
 */
export const LEGENDA_DO_CUSTO_REALIZADO =
  `Este «Realizado» responde ${PERGUNTA_DO_CUSTO}: a despesa de grupo que ` +
  `você pagou entra inteira, e a sua parte da que outra pessoa pagou entra ` +
  `junto. A aba Despesas mostra menos, e está certa: ela responde ` +
  `${PERGUNTA_DO_BRUTO}, e essa parte ainda não saiu dela.`;

/**
 * A legenda do «Realizado» da aba Despesas -- o lado de ONDE A PESSOA CHEGA.
 *
 * Ela existe porque a frase que a aba Despesas ja tinha aponta para Financas
 * Pessoais, e nao para o painel: ate a HMO-413 quem chegava aqui vindo do tile
 * lia que a parte de quem pagou por ela "nao entra nestes totais" e nao tinha
 * como ligar isso ao numero MAIOR que acabara de clicar.
 */
export const LEGENDA_DO_CAIXA_REALIZADO =
  `No painel, o «Realizado» mostra mais, e está certo: ele responde ` +
  `${PERGUNTA_DO_CUSTO} e soma essa parte; aqui a pergunta é ` +
  `${PERGUNTA_DO_BRUTO}.`;
