// ---------------------------------------------------------------------------
// MyBank -- a calculadora dos TRES CAMPOS do emprestimo (HMO-446, F2 da HMO-444)
// ---------------------------------------------------------------------------
// A issue pede o campo de juros nos DOIS SENTIDOS: ou eu digito o valor
// emprestado e a taxa e vejo o total a receber, ou digito o valor emprestado e o
// total e vejo quanto de juro estou cobrando. Os tres campos sao
// `principal`, `taxa` e `total`, e dois deles determinam o terceiro.
//
// A CONVENCAO: JURO TOTAL SIMPLES SOBRE O EMPRESTIMO (decisao D1 do plano)
// -----------------------------------------------------------------------
//   total = principal x (1 + taxa)
//
// com `taxa` como FRACAO do emprestimo inteiro: 0.20 e 20% no emprestimo todo,
// NAO ao mes. Um emprestimo de R$ 1.000 a 20% em 12x devolve R$ 1.200 -- nao
// R$ 1.268 (que e o que 20% ao mes capitalizado daria).
//
// POR QUE NAO TABELA PRICE / JURO COMPOSTO
// ----------------------------------------
// Porque a issue pede os dois sentidos, e o juro simples total e o unico que
// INVERTE EXATO, com uma divisao: `taxa = total / principal - 1`. Price nao tem
// inversa fechada -- precisaria de bisseccao, e o ida-e-volta nao fecharia com
// arredondamento de centavo: a pessoa digita 20%, le R$ 1.200, troca para o
// campo do total e ve "19,98%". Isso e uma tela discordando de si mesma sobre
// dinheiro, que e a familia `fontes-consistentes-que-discordam`.
//
// A capitalizacao nao foi jogada fora: ela vive em `taxaMensalEquivalente`, que
// e LINHA INFORMATIVA da previa ("equivale a ~1,53% ao mes") e nao o que se
// grava. A `interest_kind = 'total_simples'` da F1 grava a convencao NA LINHA
// (decisao D2) justamente para que, no dia em que entrar juro composto, os
// emprestimos velhos nao sejam reinterpretados pela aritmetica nova.
//
// ATE ONDE O IDA-E-VOLTA E EXATO, E POR QUE ISSO E UM NUMERO E NAO UMA ESPERANCA
// ------------------------------------------------------------------------------
// `taxa -> total -> taxa` so pode fechar exato se a taxa recuperada for
// arredondada, porque o total e arredondado ao centavo e esse arredondamento
// PERDE informacao: varias taxas diferentes produzem o mesmo total. O erro da
// taxa recuperada e no maximo meio centavo dividido pelo principal -- 0.005/P.
//
// Entao a casa decimal da taxa nao e gosto: ela e o que decide se o ida-e-volta
// fecha. Medido por varredura (todo principal de R$ 0,01 a R$ 300, taxas de
// 0 a 50%):
//
//   CASAS_DA_TAXA = 6  ->  falha em R$ 1.000,33 a 20% (volta 0.200004)
//   CASAS_DA_TAXA = 4  ->  o MAIOR principal que falha e R$ 99,94
//
// Com 4 casas a condicao analitica e `0.005/P < 0.00005`, ou seja `P > 100`, e a
// varredura confirma o numero exato. Por isso `CASAS_DA_TAXA = 4` e por isso
// `PRINCIPAL_DO_IDA_E_VOLTA_EXATO = 100` esta escrito aqui: acima de R$ 100 o
// ida-e-volta fecha SEMPRE, e abaixo ele pode mexer na 4a casa da fracao (a 2a
// casa do percento na tela: "30,00%" virando "29,99%"). Um emprestimo de R$ 50
// continua sendo legitimo -- a imprecisao esta medida, nao recusada.
//
// 4 casas de fracao sao 2 casas de percento, que e exatamente o que a tela
// mostra, e cabem de sobra em `interest_rate numeric(9,6)`.
//
// O DINHEIRO NAO DEPENDE DESSE ARREDONDAMENTO, E E ISSO QUE O TORNA ACEITAVEL
// ---------------------------------------------------------------------------
// A serie e montada sobre o TOTAL (plano, F3), e `SUM(mybank_installments.
// amount) - principal` e o juro (plano, secao 2). Quem digitou o total ve o
// total que digitou nas parcelas, qualquer que seja a taxa gravada. A taxa e
// para LER e para o sentido direto; ela nunca e o caminho pelo qual um centavo
// se move.
//
// A ARITMETICA E EM CENTAVOS INTEIROS, pela mesma razao de `serieDeParcelas`
// -------------------------------------------------------------------------
// `1000 / 3` em ponto flutuante da 333.33333333333331. Em centavos inteiros a
// soma e exata, e quem absorve a sobra da divisao e a ULTIMA parcela -- a mesma
// escolha que `serieDeParcelas` (lib/lancamento.ts) e a RPC `create_installments`
// (001) ja fazem, para que o total gravado seja sempre o total digitado.
//
// NAO HA IMPORT NENHUM NESTE ARQUIVO, DE PROPOSITO
// ------------------------------------------------
// `test:juros-do-emprestimo` compila este arquivo SOZINHO (`compila.mjs
// lib/juros-do-emprestimo.ts`), sem o passo que reescreve o alias `@/`, e um
// import aqui derrubaria a suite com ERR_MODULE_NOT_FOUND -- o mesmo motivo pelo
// qual `lib/lancamento.ts` tambem nao importa nada.
// ---------------------------------------------------------------------------

/**
 * As casas decimais da taxa como FRACAO. Ver "ATE ONDE O IDA-E-VOLTA E EXATO".
 *
 * 4 casas de fracao = 2 casas de percento = o que a tela mostra. Nao e a
 * precisao da coluna (`numeric(9,6)` guarda 6): e a precisao em que a inversa
 * esta DEFINIDA. Gravar 6 casas nao acrescentaria informacao -- acrescentaria
 * duas casas de ruido de arredondamento, e o ida-e-volta deixaria de fechar.
 */
export const CASAS_DA_TAXA = 4;

/**
 * Acima deste principal o ida-e-volta `taxa -> total -> taxa` fecha SEMPRE.
 *
 * R$ 99,94 e o maior principal que falha, medido por varredura. O numero esta
 * exportado para a suite poder afirmar sobre ele: um `CASAS_DA_TAXA` que subisse
 * para 6 faria o ida-e-volta falhar em emprestimos de R$ 1.000, e e esse o
 * controle que precisa existir em algum lugar.
 */
export const PRINCIPAL_DO_IDA_E_VOLTA_EXATO = 100;

/**
 * O teto de sanidade da taxa: 10 = 1000% no emprestimo todo.
 *
 * Espelha o `CHECK (interest_rate >= 0 AND interest_rate <= 10)` que a migration
 * 060 (F1) acrescenta. As duas camadas NAO sao redundancia -- e a mesma divisao
 * de `problemaDoEmprestimo`: o banco e a rede de seguranca para quem chega pelo
 * PostgREST direto, e esta funcao e a UX, porque um CHECK responde 23514 com um
 * texto que nenhuma tela quer mostrar.
 */
export const TAXA_MAXIMA = 10;

/** A convencao de juro que esta aritmetica implementa. `interest_kind`, 060. */
export const CONVENCAO_DO_JURO = "total_simples";

/** Por que estes tres campos nao formam um emprestimo. */
export type ProblemaDoJuro =
  | "principal_nao_positivo"
  | "valor_ilegivel"
  | "taxa_negativa"
  | "taxa_absurda"
  | "total_menor_que_o_principal"
  | "sem_taxa_nem_total";

/**
 * A frase que a tela mostra para cada recusa -- uma propria para cada, como a
 * issue pede.
 *
 * O texto vive aqui, e nao no componente, para ter teste: escrito no JSX ele
 * passaria por qualquer suite intacto (e e o que `avisoDoCancelamento` ja faz
 * neste modulo irmao).
 */
export function mensagemDoProblemaDoJuro(problema: ProblemaDoJuro): string {
  switch (problema) {
    case "principal_nao_positivo":
      return "Diga quanto você está emprestando — tem que ser mais que zero.";
    case "valor_ilegivel":
      return "Não consegui ler os valores: confira o valor emprestado, a taxa e o total.";
    case "taxa_negativa":
      return "A taxa não pode ser negativa. Para emprestar sem juros, deixe a taxa em zero.";
    case "taxa_absurda":
      return `Taxa alta demais: o máximo é ${TAXA_MAXIMA * 100}% no empréstimo todo.`;
    case "total_menor_que_o_principal":
      // A FRASE DIZ A CONSEQUENCIA EM DINHEIRO, e nao so "valor invalido".
      // "Total menor que o principal" e um pedido que parece razoavel digitado
      // por engano (trocar os dois campos de lugar faz exatamente isso), e sem
      // os numeros na frase a pessoa nao tem como ver qual dos dois errou.
      return "O total a receber não pode ser menor que o valor emprestado — você estaria emprestando para receber menos de volta.";
    case "sem_taxa_nem_total":
      return "Diga a taxa de juros ou o total a receber.";
  }
}

/**
 * O valor em centavos inteiros, ou `null` quando nao da para ler.
 *
 * `Math.round` e nao `Math.trunc`: R$ 0,10 digitado chega como 0.1, que vezes
 * 100 da 10.000000000000002 -- `trunc` devolveria 10 por sorte aqui e 9 no
 * primeiro valor em que o float caisse para baixo. A escolha e a mesma de
 * `serieDeParcelas`.
 */
function centavos(valor: number): number | null {
  if (typeof valor !== "number" || !Number.isFinite(valor)) return null;
  return Math.round(valor * 100);
}

/** De centavos inteiros de volta para reais com 2 casas exatas. */
function reais(emCentavos: number): number {
  return emCentavos / 100;
}

/**
 * Os tres campos servem? `null` quando servem, ou o motivo.
 *
 * Exatamente UM de `taxa` e `total` precisa vir -- e e o que distingue os dois
 * sentidos da issue. Os dois juntos nao sao aceitos aqui de proposito: eles
 * podem DISCORDAR (principal 1000, taxa 0.2, total 1500), e escolher
 * silenciosamente um dos dois e como a tela passa a mostrar um numero que a
 * pessoa nao digitou. Quem resolve os dois sentidos e `tresCamposDoEmprestimo`,
 * e ele recebe um ou o outro.
 */
export function problemaDoJuro(params: {
  principal: number;
  taxa?: number | null;
  total?: number | null;
}): ProblemaDoJuro | null {
  const principalEmCentavos = centavos(params.principal);
  if (principalEmCentavos === null) return "valor_ilegivel";

  // O PRINCIPAL VEM PRIMEIRO, e a ordem e a resposta: com principal zero a
  // divisao de `taxaDoEmprestimo` seria 1/0 = Infinity, e a recusa certa e
  // "diga quanto esta emprestando" e nao "a taxa esta estranha".
  if (principalEmCentavos <= 0) return "principal_nao_positivo";

  const temTaxa = typeof params.taxa === "number";
  const temTotal = typeof params.total === "number";
  if (!temTaxa && !temTotal) return "sem_taxa_nem_total";

  if (temTaxa) {
    const taxa = params.taxa as number;
    if (!Number.isFinite(taxa)) return "valor_ilegivel";
    // TAXA NEGATIVA E RECUSA, E O MOTIVO NAO E ESTETICO
    //
    // Juro negativo e um pedido que tem leitura ("emprestei 1000 e aceito 900
    // de volta"), mas na fase 1 ele quebra a perna de `income` da F5: a
    // parte-juros viraria RECEITA NEGATIVA em `financial_transactions`, e uma
    // receita negativa nao e nada que o app saiba somar -- ela desconta do
    // Realizado de Receitas sem que nenhuma linha explique por que. Quem quer
    // perdoar parte da divida tem o ajuste da F4 (baixar o total), que mexe nas
    // parcelas e nao inventa receita de sinal trocado.
    if (taxa < 0) return "taxa_negativa";
    if (taxa > TAXA_MAXIMA) return "taxa_absurda";
  }

  if (temTotal) {
    const totalEmCentavos = centavos(params.total as number);
    if (totalEmCentavos === null) return "valor_ilegivel";
    // MENOR, E NAO "MENOR OU IGUAL": total == principal e o emprestimo a juro
    // zero, que e o unico que o MyBank sabia fazer antes desta issue e continua
    // valendo.
    if (totalEmCentavos < principalEmCentavos) {
      return "total_menor_que_o_principal";
    }
    // O teto tambem se alcanca pelo total: 1000 emprestados para receber
    // 50.000 e a mesma taxa absurda escrita do outro lado, e sem esta pergunta
    // a recusa mudaria de lugar conforme o campo que a pessoa escolheu usar.
    if (totalEmCentavos > principalEmCentavos * (1 + TAXA_MAXIMA)) {
      return "taxa_absurda";
    }
  }

  return null;
}

/**
 * O SENTIDO DIRETO: emprestado + taxa -> total a receber.
 *
 * `null` quando os campos nao servem (`problemaDoJuro` diz por que).
 *
 * `Math.round(principalEmCentavos * (1 + taxa))` e a linha inteira da feature, e
 * o `(1 + taxa)` e o mutante que a issue nomeia: trocado por `(1 - taxa)` ele
 * transforma "emprestei R$ 1.000 a 20%" em "vou receber R$ 800" -- um emprestimo
 * que PERDE dinheiro, com total menor que o principal, exatamente o estado que
 * `total_menor_que_o_principal` existe para recusar quando digitado a mao.
 */
export function totalDoEmprestimo(params: {
  principal: number;
  taxa: number;
}): number | null {
  if (problemaDoJuro({ principal: params.principal, taxa: params.taxa })) {
    return null;
  }

  const principalEmCentavos = centavos(params.principal) as number;
  return reais(Math.round(principalEmCentavos * (1 + params.taxa)));
}

/**
 * O SENTIDO INVERSO: emprestado + total -> a taxa que estou cobrando.
 *
 * `null` quando `principal <= 0` (a issue nomeia este caso) e nas outras
 * recusas.
 *
 * A DIVISAO E ENTRE CENTAVOS INTEIROS, nao entre os reais recebidos: `1200.4 /
 * 1000.33` e `120040 / 100033` nao sao o mesmo numero em ponto flutuante, e o
 * segundo e o que corresponde ao que a serie vai gravar. O arredondamento para
 * `CASAS_DA_TAXA` e o que fecha o ida-e-volta -- ver o cabecalho.
 */
export function taxaDoEmprestimo(params: {
  principal: number;
  total: number;
}): number | null {
  if (problemaDoJuro({ principal: params.principal, total: params.total })) {
    return null;
  }

  const principalEmCentavos = centavos(params.principal) as number;
  const totalEmCentavos = centavos(params.total) as number;

  const bruta = totalEmCentavos / principalEmCentavos - 1;
  const fator = Math.pow(10, CASAS_DA_TAXA);
  return Math.round(bruta * fator) / fator;
}

/**
 * O juro em REAIS -- o que a tela chama de "juros" na previa de quatro
 * grandezas.
 *
 * Sai de `total - principal`, e NAO de `principal x taxa`, e a diferenca nao e
 * cosmetica: `SUM(mybank_installments.amount) - principal` e a definicao do juro
 * depois desta issue (plano, secao 2). Calcular por `principal x taxa` daria,
 * para quem digitou o total, um juro que discorda em um centavo do que as
 * parcelas somam -- a tela afirmando um ganho que o extrato nao confirma.
 */
export function jurosDoEmprestimo(params: {
  principal: number;
  total: number;
}): number | null {
  if (problemaDoJuro({ principal: params.principal, total: params.total })) {
    return null;
  }

  const principalEmCentavos = centavos(params.principal) as number;
  const totalEmCentavos = centavos(params.total) as number;
  return reais(totalEmCentavos - principalEmCentavos);
}

/**
 * A taxa mensal equivalente, para a LINHA INFORMATIVA da previa.
 *
 * `(1 + taxa) ^ (1/parcelas) - 1`: 20% em 12x equivalem a ~1,53% ao mes. E
 * capitalizada (a raiz, e nao `taxa / parcelas`) porque e isso que a pessoa
 * compara com a taxa que o banco dela anuncia -- `taxa / parcelas` daria 1,67%
 * e faria o emprestimo parecer mais caro do que e.
 *
 * ESTE NUMERO NAO E GRAVADO, E O COMENTARIO E A GUARDA
 * ---------------------------------------------------
 * `interest_rate` guarda a taxa DO EMPRESTIMO TODO (D1/D2). Gravar a mensal
 * seria mudar a convencao sem mudar a coluna, e todo emprestimo velho passaria a
 * ser relido com outro significado -- o defeito que a `interest_kind` existe
 * para impedir. Esta funcao e so para ler.
 *
 * `null` com `parcelas < 1` ou nao-inteiro: nao ha mes nenhum em que diluir.
 *
 * O ARREDONDAMENTO NAO E COSMETICO: `Math.pow(1.2, 1/1) - 1` em ponto flutuante
 * da 0.19999999999999996, e uma linha informativa que mostrasse "equivale a
 * 19,999999999999996% ao mes" para um emprestimo de 20% em 1x seria uma tela
 * desmentindo o campo que a pessoa acabou de preencher. `CASAS_DA_TAXA_MENSAL`
 * e mais folgada que `CASAS_DA_TAXA` (6 contra 4) porque aqui nao ha inversa a
 * fechar -- o numero so e lido -- e 6 casas mantem a 2a casa do percento
 * estavel na composicao de volta.
 */
export const CASAS_DA_TAXA_MENSAL = 6;

export function taxaMensalEquivalente(params: {
  taxa: number;
  parcelas: number;
}): number | null {
  if (typeof params.taxa !== "number" || !Number.isFinite(params.taxa)) {
    return null;
  }
  if (params.taxa < 0 || params.taxa > TAXA_MAXIMA) return null;
  if (!Number.isInteger(params.parcelas) || params.parcelas < 1) return null;

  const bruta = Math.pow(1 + params.taxa, 1 / params.parcelas) - 1;
  const fator = Math.pow(10, CASAS_DA_TAXA_MENSAL);
  return Math.round(bruta * fator) / fator;
}

/** Quanto de UMA parcela e principal voltando, e quanto e juro ganho. */
export interface RateioDaParcela {
  parteDoPrincipal: number;
  parteDosJuros: number;
}

/**
 * O rateio de UMA parcela, proporcional: `parteDoPrincipal = amount x
 * principal / total`.
 *
 * E a decisao D3 do plano em aritmetica. No Caso B (emprestei para uma conexao)
 * a parcela passa a ter DUAS pernas -- `transfer` da parte-principal e `income`
 * SO da parte-juros. Sem o rateio ha dois defeitos possiveis e os dois sao
 * plausiveis: ou cobrar juros nunca aparece em Receitas (o ganho simplesmente
 * nao existe no app), ou a perna inteira vira `income` e o mesmo principal conta
 * como salario 12 vezes.
 *
 * ESTA FUNCAO NAO ABSORVE O CENTAVO, E NAO PODE: A SOBRA NAO E DELA
 * ----------------------------------------------------------------
 * A sobra da divisao e uma propriedade da SERIE INTEIRA -- ela e o que falta
 * para as N partes somarem o principal, e isso nao se sabe olhando uma parcela.
 * Uma funcao de uma parcela que tentasse absorver teria de adivinhar a posicao
 * dela, e adivinharia errado na parcela unica de uma serie de 12.
 *
 * Quem fecha a soma e `rateioDaSerie`, e e LA que a invariante tem assercao. A
 * separacao e a mesma de `serieDeParcelas`, onde `valorDaParcela` e o valor
 * comum e a ultima parcela da lista e que carrega a diferenca. **Quem grava
 * pernas chama `rateioDaSerie`, nunca esta funcao parcela por parcela** -- 12
 * chamadas daqui somam o principal com erro de ate 6 centavos, e um erro de 6
 * centavos espalhado em 12 linhas e exatamente o tipo de defeito que ninguem
 * acha depois.
 */
export function rateioDaParcela(params: {
  amount: number;
  principal: number;
  total: number;
}): RateioDaParcela | null {
  if (problemaDoJuro({ principal: params.principal, total: params.total })) {
    return null;
  }

  const amountEmCentavos = centavos(params.amount);
  if (amountEmCentavos === null || amountEmCentavos <= 0) return null;

  const principalEmCentavos = centavos(params.principal) as number;
  const totalEmCentavos = centavos(params.total) as number;

  const parteDoPrincipal = Math.round(
    (amountEmCentavos * principalEmCentavos) / totalEmCentavos
  );

  return {
    parteDoPrincipal: reais(parteDoPrincipal),
    parteDosJuros: reais(amountEmCentavos - parteDoPrincipal),
  };
}

/**
 * O rateio da SERIE INTEIRA, com a ULTIMA parcela absorvendo o centavo.
 *
 * Esta e a funcao que fecha as duas somas, e as duas sao exatas por construcao:
 *
 *   soma de `parteDoPrincipal` == principal
 *   soma de `parteDosJuros`    == total - principal  (o juro)
 *
 * A segunda sai de graca da primeira: cada `parteDosJuros` e `amount -
 * parteDoPrincipal`, entao a soma dos juros e `soma(amount) - principal`, e
 * `soma(amount)` e o total (conferido abaixo). Nenhuma das duas somas depende de
 * sorte de arredondamento.
 *
 * A SOMA DAS PARCELAS TEM DE FECHAR COM O TOTAL, E DISCORDAR E `null`
 * -------------------------------------------------------------------
 * Uma serie que nao soma o total nao tem rateio certo: qualquer divisao que
 * saisse daqui faria o juro da tela discordar do juro do extrato. Devolver
 * `null` e o que transforma isso em erro visivel em vez de um centavo perdido --
 * e a serie SEMPRE fecha quando vem de `serieDeParcelas` (ela e construida para
 * isso), entao o `null` e sinal de chamador errado, nao de entrada comum.
 *
 * `null` TAMBEM QUANDO A ABSORCAO NAO CABE NA ULTIMA PARCELA
 * ---------------------------------------------------------
 * A sobra acumulada e no maximo meio centavo por parcela, ou 29,5 centavos numa
 * serie de 60. Se a ultima parcela valer menos que isso (uma cauda de centavos),
 * a absorcao estouraria -- a parte-principal dela ficaria negativa, e uma perna
 * `transfer` negativa inverteria o sentido do dinheiro. Nao e hipotese
 * defensiva: `mybank_installments_amount_check` aceita `amount > 0`, ou seja um
 * centavo, e 60x e o teto de `serieDeParcelas`. O estado e alcancavel, e a
 * resposta certa e recusar em vez de gravar perna de sinal trocado.
 */
export function rateioDaSerie(params: {
  /** Os valores das parcelas, em reais, na ordem -- a ultima e a que absorve. */
  parcelas: number[];
  principal: number;
  total: number;
}): RateioDaParcela[] | null {
  if (problemaDoJuro({ principal: params.principal, total: params.total })) {
    return null;
  }
  if (!Array.isArray(params.parcelas) || params.parcelas.length === 0) {
    return null;
  }

  const principalEmCentavos = centavos(params.principal) as number;
  const totalEmCentavos = centavos(params.total) as number;

  const parcelasEmCentavos: number[] = [];
  for (const valor of params.parcelas) {
    const c = centavos(valor);
    if (c === null || c <= 0) return null;
    parcelasEmCentavos.push(c);
  }

  const somaDasParcelas = parcelasEmCentavos.reduce((a, b) => a + b, 0);
  if (somaDasParcelas !== totalEmCentavos) return null;

  const ultima = parcelasEmCentavos.length - 1;
  const rateio: RateioDaParcela[] = [];
  let principalJaRateado = 0;

  for (let i = 0; i < parcelasEmCentavos.length; i++) {
    const amountEmCentavos = parcelasEmCentavos[i];

    // A ULTIMA FECHA A SOMA. `principal - o que ja foi rateado` e a definicao
    // de "o que falta", e e por isso que ela e exata sem depender do
    // arredondamento das anteriores.
    const parteDoPrincipal =
      i === ultima
        ? principalEmCentavos - principalJaRateado
        : Math.round(
            (amountEmCentavos * principalEmCentavos) / totalEmCentavos
          );

    if (parteDoPrincipal < 0 || parteDoPrincipal > amountEmCentavos) {
      return null;
    }

    principalJaRateado += parteDoPrincipal;
    rateio.push({
      parteDoPrincipal: reais(parteDoPrincipal),
      parteDosJuros: reais(amountEmCentavos - parteDoPrincipal),
    });
  }

  return rateio;
}

/** As quatro grandezas que a previa da tela mostra antes do clique. */
export interface TresCamposDoEmprestimo {
  /** O que sai da conta de investimento. `mybank_loans.principal`. */
  principal: number;
  /** A fracao, com `CASAS_DA_TAXA` casas. `mybank_loans.interest_rate`. */
  taxa: number;
  /** O que volta, as N parcelas somadas. */
  total: number;
  /** `total - principal`, em reais. */
  juros: number;
}

/**
 * OS DOIS SENTIDOS NUM LUGAR SO -- o que o formulario da F3 chama.
 *
 * Recebe `principal` e UM de `taxa` ou `total`, e devolve as quatro grandezas
 * resolvidas. E a funcao que a issue descreve em prosa ("ou se eu colocar valor
 * total vejo quanto de juros estou cobrando"), e ela existe para que os dois
 * sentidos NAO sejam dois `if` dentro do componente: ali eles divergiriam na
 * primeira mudanca, e o sintoma seria a previa mostrando um total que a rota nao
 * grava.
 *
 * `taxa` E `total` JUNTOS SAO RECUSADOS (`sem_taxa_nem_total` nao cobre isso --
 * `problemaDoJuro` aceita os dois, e e aqui que a escolha e exigida). Com os
 * dois preenchidos eles podem discordar, e nao ha resposta certa: escolher um
 * calado faz a tela apagar um numero que a pessoa digitou.
 */
export function tresCamposDoEmprestimo(params: {
  principal: number;
  taxa?: number | null;
  total?: number | null;
}): TresCamposDoEmprestimo | null {
  const temTaxa = typeof params.taxa === "number";
  const temTotal = typeof params.total === "number";

  if (temTaxa && temTotal) return null;
  if (problemaDoJuro(params)) return null;

  const total = temTaxa
    ? totalDoEmprestimo({ principal: params.principal, taxa: params.taxa as number })
    : (params.total as number);
  if (total === null) return null;

  // A TAXA SAI DO TOTAL NOS DOIS SENTIDOS, e isso e deliberado: no sentido
  // direto ela poderia ser devolvida como veio, mas entao a previa mostraria
  // uma taxa que o banco nao vai guardar (o `numeric(9,6)` e as
  // `CASAS_DA_TAXA`). Passando pela inversa, o que a tela mostra e o que a
  // linha vai dizer -- e o ida-e-volta ser exato acima de R$ 100 e o que faz
  // isso nao mexer no numero de quem digitou a taxa.
  const taxa = taxaDoEmprestimo({ principal: params.principal, total });
  if (taxa === null) return null;

  const juros = jurosDoEmprestimo({ principal: params.principal, total });
  if (juros === null) return null;

  const principalEmCentavos = centavos(params.principal) as number;

  return { principal: reais(principalEmCentavos), taxa, total, juros };
}
