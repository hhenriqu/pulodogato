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
 * - `precisa-de-banco`: so roda com Postgres de verdade; o lugar dele e o
 *   `db-verify.yml`, nao o `verificacao.yml`. Exige `coberto_por` vazio.
 * - `nao-triado`: herdado da HMO-322 e ainda nao medido. NAO e uma decisao --
 *   e a divida que o teto obriga a baixar.
 */
export const MOTIVOS = [
  "ferramenta-de-autor",
  "coberto-por-outro",
  "precisa-de-banco",
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
  // precisa-de-banco: Postgres de verdade, nao cabe no verificacao.yml.
  // ---------------------------------------------------------------------
  "scripts/mutantes-categorias.sh": {
    motivo: "precisa-de-banco",
    porque:
      "Clona o banco com CREATE DATABASE ... TEMPLATE e muta a funcao por " +
      "CREATE OR REPLACE. Sem Postgres nao roda; o lugar dele e o db-verify.yml.",
  },
  "scripts/mutantes-convite-sem-conta.sh": {
    motivo: "precisa-de-banco",
    porque:
      "Mesma familia do mutantes-categorias.sh: clone de banco e impressao " +
      "digital de prosrc/prosecdef por mutante.",
  },
  "scripts/mutantes-minha-parte-no-realizado.mjs": {
    motivo: "precisa-de-banco",
    porque: "Muta a funcao no Postgres e roda o teste SQL contra ela.",
  },
  "scripts/mutantes-trava-de-membro.mjs": {
    motivo: "precisa-de-banco",
    porque: "Muta a trava no Postgres; depende da migration aplicada.",
  },

  // ---------------------------------------------------------------------
  // nao-triado: a divida da HMO-322. Cada linha daqui tem de virar um dos
  // motivos acima, um step de workflow, ou um `git rm` -- e o TETO cai junto.
  // ---------------------------------------------------------------------
  "scripts/mutantes-cartao-orcamento-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-cash-flow.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-chave-pix.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-convite-de-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-crivos.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-cron-ledger.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-divisao-configurada.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-divisao-do-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-divisao-ui-dom.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-edicao-de-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-em-bloco.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-fechamento-do-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-fundamento-cvm.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-grupos.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-investments.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-moeda-da-conta-prevista.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-orcamento-de-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-pagador-da-parte.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-parcela-n-de-m.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-parte-do-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-periodo-do-grupo.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-periodo-painel.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-previsto-bloco.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-previsto-x-realizado.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-puxar-no-menu-dom.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-puxar-para-atualizar.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-realizado-e-previsao.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-renda-fixa.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-semeadura.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-sugestao-de-divisao.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-transferencia-recorrente-app.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-transferencia-recorrente.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-transferencia.mjs": { motivo: "nao-triado", porque: "HMO-322" },
  "scripts/mutantes-tres-numeros.mjs": { motivo: "nao-triado", porque: "HMO-322" },
};
