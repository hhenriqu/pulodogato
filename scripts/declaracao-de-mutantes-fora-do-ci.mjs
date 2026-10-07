// Os runners de mutante que NENHUM workflow invoca, cada um com o porque.
//
// Por que este arquivo existe (HMO-322): havia 62 runners `scripts/mutantes-*`
// na arvore e 19 invocados por algum step. Os outros 43 nao rodavam em lugar
// nenhum -- e nada nessa situacao da sintoma. O arquivo esta no repositorio, tem
// o nome certo, aparece no `ls`, e ler a arvore da a impressao de que aquela
// afirmacao esta protegida por controle negativo. E a familia de "tabela sem
// leitor parece feature pronta".
//
// A saida NAO e ligar os 43: cada job do Actions custa a partida mais o
// arredondamento para o minuto cheio (HMO-261), e a franquia e de 2.000 min/mes.
// A saida e que "fora do CI" deixe de ser um ACIDENTE SILENCIOSO e passe a ser
// uma DECLARACAO -- com motivo escrito, conferida pelo `check-mutantes-in-ci`.
//
// O VOCABULARIO DE MOTIVOS e fechado de proposito (`MOTIVOS` abaixo). Campo de
// texto livre viraria "porque sim" em tres meses; com vocabulario fechado, o
// censo por motivo e uma medida, e `nao-triado` e uma divida que se ve.
//
// O `nao-triado` tem TETO, e o teto so desce (ver `TETO_NAO_TRIADO` no guard).
// Sem o teto este arquivo seria o jeito educado de arquivar o problema: bastaria
// declarar o runner novo como `nao-triado` e o numero voltaria a crescer calado,
// que e exactamente o que a HMO-322 foi aberta para impedir.

/**
 * Os motivos aceitos, e o que cada um promete.
 *
 * - `ferramenta-de-autor`: o runner e a prova completa (dezenas de mutantes),
 *   caro demais para todo PR, e o CI tem um SUBCONJUNTO dele num bloco proprio.
 *   Quem mexe na suite roda o runner a mao. O workflow cita o runner num
 *   comentario -- e por isso que o guard tira os comentarios antes de procurar
 *   invocacao: senao a mencao em comentario contaria como step e o runner
 *   pareceria vigiado. Exige `coberto_por`.
 * - `coberto-por-outro`: outro runner, este sim no CI, mede a mesma afirmacao.
 *   Exige `coberto_por`.
 * - `biblioteca-de-runner`: NAO e um runner. E codigo compartilhado que caiu no
 *   espaco de nomes `mutantes-*` e por isso o padrao do nome o conta como
 *   runner. Nao tem mutante para rodar e nao faz afirmacao propria; quem o
 *   exercita sao os runners que o importam. Exige `coberto_por` nomeando um
 *   runner que (a) o importa e (b) e invocado por algum step -- entao "a
 *   biblioteca e exercitada" e falsificavel, e nao uma promessa.
 * - `nao-triado`: herdado da HMO-322 e ainda nao medido. NAO e uma decisao --
 *   e a divida que o teto obriga a baixar. O Helio decidiu em 2026-10-07 que
 *   para estes o DEFAULT e APAGAR: um runner so sobrevive se alguem defender
 *   a afirmacao que ele mede. Ganhar step e a excecao que precisa justificar.
 *
 * `precisa-de-banco` ERA um motivo e NAO E MAIS.
 * ----------------------------------------------
 * Ele dizia "so roda com Postgres de verdade, e o lugar dele e o
 * db-verify.yml". O problema e que ele descrevia o lugar certo e deixava o
 * runner fora dele -- ou seja, era um motivo que se auto-refutava. Os quatro
 * que o usavam foram medidos e ligados no db-verify.yml (HMO-322, 2026-10-07):
 * 57 mutantes, 57 mortos, 62s, nenhum job novo, porque aquele job ja tem
 * Postgres de pe e a cadeia ja subiu.
 *
 * Por isso o motivo saiu do vocabulario em vez de ficar vazio: enquanto ele
 * existisse, "precisa de banco" seguiria disponivel como desculpa para o
 * runner seguinte -- e a desculpa agora e falsa, porque o endereco existe e
 * esta provado. Runner novo que precise de Postgres ganha step no
 * db-verify.yml; se nao vale o step, nao vale o arquivo.
 */
export const MOTIVOS = [
  "ferramenta-de-autor",
  "coberto-por-outro",
  "biblioteca-de-runner",
  "nao-triado",
];

/**
 * arquivo -> { motivo, porque, coberto_por? }
 *
 * O `coberto_por` nomeia o STEP do workflow (ou o runner) que cobre a mesma
 * afirmacao. Ele existe para que "outro cobre isso" seja falsificavel: o guard
 * confere que o alvo citado realmente e invocado por algum step.
 */
export const FORA_DO_CI = {
  // ---------------------------------------------------------------------
  // ferramenta-de-autor: o proprio workflow declara isto, em comentario.
  // ---------------------------------------------------------------------
  "scripts/mutantes-fatura-do-periodo.mjs": {
    motivo: "ferramenta-de-autor",
    porque:
      "15 mutantes. O verificacao.yml roda os tres que mais custam no bloco " +
      "'A verificacao sabe falhar (fatura do periodo)' e diz isso no comentario.",
    coberto_por: "A verificacao sabe falhar (fatura do periodo)",
  },
  "scripts/mutantes-lancamentos-completos.mjs": {
    motivo: "ferramenta-de-autor",
    porque:
      "26 mutantes. O CI roda os quatro mais caros no bloco " +
      "'A verificacao sabe falhar (lancamentos-completos)'.",
    coberto_por: "A verificacao sabe falhar (lancamentos-completos)",
  },
  "scripts/mutantes-retorno-do-lancamento.mjs": {
    motivo: "ferramenta-de-autor",
    porque:
      "21 mutantes. O CI roda os quatro mais caros no bloco " +
      "'A verificacao sabe falhar (retorno-do-lancamento)'.",
    coberto_por: "A verificacao sabe falhar (retorno-do-lancamento)",
  },
  "scripts/mutantes-telas-de-movimentacao.mjs": {
    motivo: "ferramenta-de-autor",
    porque:
      "32 mutantes. O CI roda os cinco mais caros no bloco " +
      "'A verificacao sabe falhar (telas-de-movimentacao)'.",
    coberto_por: "A verificacao sabe falhar (telas-de-movimentacao)",
  },
  "scripts/mutantes-realizado-do-caixa.mjs": {
    motivo: "ferramenta-de-autor",
    porque:
      "12 mutantes. O CI roda os quatro mais caros no bloco " +
      "'A verificacao sabe falhar (realizado-do-caixa)'.",
    coberto_por: "A verificacao sabe falhar (realizado-do-caixa)",
  },

  // Triados na HMO-329 (lote 1/4: divisao, parte e orcamento de grupo). Estes
  // dois NAO precisaram de step novo: o CI ja rodava, inline, o subconjunto que
  // o proprio runner nomeia como "os que viram dinheiro". O que faltava era a
  // declaracao dizer isso -- enquanto eles estavam `nao-triado`, a divida contava
  // como ausencia de cobertura uma cobertura que existia.
  "scripts/mutantes-divisao-configurada.mjs": {
    motivo: "ferramenta-de-autor",
    porque:
      "49 mutantes (os 8 ultimos sao de `divisaoDoPeriodo`). O verificacao.yml " +
      "roda os QUATRO que viram dinheiro no bloco 'A verificacao sabe falhar " +
      "(divisao configurada do grupo)', com a trava do `cmp` em cada `sed`, e o " +
      "comentario do bloco cita este runner como a origem deles. Entre eles esta " +
      "o `MAIOR RESTO -> ARREDONDAMENTO` que a HMO-267 pede por nome, o degrau do " +
      "0/0 (sem ele todo grupo nao configurado mostra 'NaN%') e o membro em 0% " +
      "voltando a entrar na despesa com parte zerada, que derruba o INSERT " +
      "inteiro em 23514. Rodar os 49 em todo PR pagaria 45 suites a mais pelos " +
      "mesmos quatro vereditos de dinheiro.",
    coberto_por: "A verificacao sabe falhar (divisao configurada do grupo)",
  },
  "scripts/mutantes-pagador-da-parte.mjs": {
    motivo: "ferramenta-de-autor",
    porque:
      "O verificacao.yml roda os TRES que o cabecalho do proprio runner chama de " +
      "'os que mais importam, porque sao os que nao dao sintoma', no bloco 'A " +
      "verificacao sabe falhar (pagador-da-parte)': o nome de quem pagou nunca " +
      "chegando na linha, o rotulo de fallback saindo em branco, e o selo " +
      "desaparecendo quando o perfil nao e legivel -- este ultimo devolve a linha " +
      "a 'R$ 200,00 · Minha parte · Praia', que se le como despesa propria. Cada " +
      "`sed` tem a trava do `cmp`, entao ancora reescrita reprova em vez de medir " +
      "a arvore intacta.",
    coberto_por: "A verificacao sabe falhar (pagador-da-parte)",
  },

  // ---------------------------------------------------------------------
  // biblioteca-de-runner: nao e runner, e o motor que os runners importam.
  // ---------------------------------------------------------------------
  "scripts/mutantes-em-bloco.mjs": {
    motivo: "biblioteca-de-runner",
    porque:
      "Nao e runner: e o motor de bloco da HMO-319 (`criarBlocoDeMutantes`), " +
      "importado por 21 runners, 16 deles com step em CI. Nao tem mutante " +
      "proprio para rodar e nao faz afirmacao propria -- cair nesta lista e " +
      "efeito do padrao de nome `mutantes-*`, nao divida de triagem. Estava " +
      "`nao-triado`, o que inflava a divida com uma linha que nunca teria " +
      "veredito: nao ha o que ligar no CI nem o que apagar.",
    coberto_por: "scripts/mutantes-parcelamento.mjs",
  },

  // Os quatro `precisa-de-banco` SAIRAM desta lista: eles agora tem step no
  // db-verify.yml ("A categoria do usuario sabe falhar", "O convite sem conta
  // sabe falhar", "A minha parte no realizado sabe falhar", "A trava de membro
  // sabe falhar"). 57 mutantes, 57 mortos, 62s, sem job novo. Ver a nota do
  // motivo `precisa-de-banco` acima, que deixou de existir junto com eles.

  // O LOTE 3/4 DA TRIAGEM (HMO-331) SAIU TODO DESTA LISTA, DE DUAS MANEIRAS.
  // ------------------------------------------------------------------------
  // Nove runners, e o critario que separou os dois desfechos foi: o runner
  // guarda o que o banco GRAVA, ou o que a tela MOSTRA?
  //
  // Quatro guardam a gravacao e ganharam step no db-verify.yml -- as duas
  // pernas da transferencia (`lib/transferencia.ts`) e as migrations 034, 035
  // e 038. 39 mutantes, 39 mortos, 46s de step, nenhum job novo.
  //
  // Cinco guardavam leitura de painel e foram APAGADOS: cash-flow,
  // previsto-bloco, realizado-e-previsao, periodo-painel e cron-ledger. A
  // suite `test:*` de cada um continua no CI; o que se perdeu e a prova de que
  // ela mede -- e o Helio decidiu em 2026-10-07 que esse preco so se paga onde
  // errar move dinheiro. Nenhum deles grava linha nenhuma, e juntos custavam
  // 135 recompilacoes do programa inteiro (uma por mutante, sem o motor de
  // bloco da HMO-319). Ver o PR da HMO-331 para o veredito de cada um.

  // Os OITO do lote 2/4 (HMO-330, 2026-10-07) tambem sairam: quatro ganharam
  // step no db-verify.yml e quatro foram apagados. O criterio foi o do Helio
  // ("apagar e o default; ganhar step e a excecao que justifica"), aplicado
  // sobre CUSTO MEDIDO por mutante e sobre o que o erro custa:
  //
  //   step  chave-pix             6/6,   7s  policy_larga = CPF de todos vaza
  //   step  periodo-do-grupo     14/14, 27s  R$ 5.400 onde o mes tem R$ 1.800
  //   step  fechamento-do-grupo  21/21, 38s  previsto e realizado se cancelam
  //   step  edicao-de-grupo      17/17, 96s  rateio + SECURITY DEFINER da 024
  //   rm    convite-de-grupo      9/9,  57s  texto de notificacao, nao dinheiro
  //   rm    grupos               21/21,178s  8,5s por mutante -- o pior custo
  //   rm    previsto-x-realizado 31/34,189s  3 ancoras que a feature apagou
  //   rm    tres-numeros         12/12,420s  35s por mutante, e so de ROTULO
  //
  // SOBRE OS TEMPOS: esta maquina tem 2 nucleos e havia runner de outro run
  // no ar, entao carga falsifica a medida -- os numeros por runner acima foram
  // colhidos sob carga 6-11 e sao PESSIMISTAS. Os quatro steps rodados em
  // bloco e verbatim do YAML deram 58/58 em tres medicoes: 152s (carga 3-5),
  // 136s (carga 2-4) e 91s (carga 2,5-3,2). O chao de ~91s e o mais proximo do
  // que o job paga; a dispersao e carga, nao variacao do runner.
  //
  // Tres dos quatro apagados PASSAVAM. Apagar runner que passa parece
  // desperdicio e nao e: os 58 mutantes que ficaram custam 152s, e os 76 que
  // sairam custavam 844s pelo mesmo tipo de afirmacao. O `previsto-x-realizado`
  // ainda e a prova viva da tese da HMO-322 -- 3 dos 34 mutantes dele miravam
  // trecho que a feature ja havia apagado, porque runner que ninguem roda
  // apodrece calado.
  //
  // O `tres-numeros` media so a MARCACAO -- qual numero sai debaixo de qual
  // rotulo --, e a 35s por mutante era 10x o pior custo que ficou. Nota de
  // honestidade: o `scripts/mutantes-realizado-e-previsao.mjs`, que provava a
  // ARITMETICA ao lado dele, foi apagado pela HMO-331 no mesmo dia. Entao a
  // aritmetica segue coberta pela suite `test:realizado-e-previsao` (com step
  // no verificacao.yml) e NAO mais por controle negativo. O motivo de apagar o
  // tres-numeros continua sendo o custo, nao "a prova esta em outro runner".
  //
  // O `convite-de-grupo` era o candidato obvio a RECLASSIFICAR (o db-verify.yml
  // o citava em comentario, "9 mutantes, 9 mortos" -- e a medida se confirmou
  // hoje). Foi recusado de proposito: `ferramenta-de-autor` promete que o CI
  // roda um SUBCONJUNTO dos mutantes num bloco proprio, e aqui nao ha bloco
  // nenhum -- so a suite. O guard teria aceitado a linha, porque o step citado
  // existe e o nome casa exato; a peneira e mecanica e a promessa e semantica,
  // e e a promessa que o proximo leitor vai acreditar.

  // ---------------------------------------------------------------------
  // nao-triado: a divida da HMO-322. Cada linha daqui tem de virar um dos
  // motivos acima, um step de workflow, ou um `git rm` -- e o TETO cai junto.
  // ---------------------------------------------------------------------
  "scripts/mutantes-cartao-orcamento-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-divisao-do-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-divisao-ui-dom.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-orcamento-de-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-parte-do-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-semeadura.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-sugestao-de-divisao.mjs": { motivo: "nao-triado", porque: "HMO-322" },
};
