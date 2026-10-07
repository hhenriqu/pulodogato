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

  // ---------------------------------------------------------------------
  // nao-triado: a divida da HMO-322. Cada linha daqui tem de virar um dos
  // motivos acima, um step de workflow, ou um `git rm` -- e o TETO cai junto.
  // ---------------------------------------------------------------------
  "scripts/mutantes-cartao-orcamento-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-cash-flow.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-chave-pix.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-convite-de-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-cron-ledger.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-divisao-configurada.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-divisao-do-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-divisao-ui-dom.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-edicao-de-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-fechamento-do-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-grupos.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-moeda-da-conta-prevista.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-orcamento-de-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-pagador-da-parte.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-parcela-n-de-m.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-parte-do-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-periodo-do-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-periodo-painel.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-previsto-bloco.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-previsto-x-realizado.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-realizado-e-previsao.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-semeadura.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-sugestao-de-divisao.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-transferencia-recorrente.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-transferencia.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-tres-numeros.mjs": { motivo: "nao-triado", porque: "HMO-322" },
};
