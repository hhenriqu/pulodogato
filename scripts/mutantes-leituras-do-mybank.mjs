#!/usr/bin/env node
// Prova de mutacao das SETE LEITURAS DE DINHEIRO do MyBank (HMO-372, F4 da
// HMO-368).
//
//   node scripts/mutantes-leituras-do-mybank.mjs
//
// Cada entrada estraga UMA decisao; `npm run test:leituras-do-mybank` tem de
// ficar VERMELHA em todas. Mutante que sobrevive e um trecho que nenhuma
// assercao distingue.
//
// UM MUTANTE POR LEITURA, COM ANCORA NOMEADA -- e e isso que a issue pede.
// -----------------------------------------------------------------------
// As ancoras sao TRECHOS DE CODIGO, nunca frases dos comentarios, e aqui esse
// cuidado nao e teorico: os quatro arquivos mutados agora CITAM nos comentarios
// as proprias decisoes que as ancoras alcancam (`lerDividaDoMyBank`,
// `mybank_due_entries`, `de: null`, `transfer`). Uma ancora curta demais mutaria
// a EXPLICACAO e deixaria o codigo intacto -- com o placar dizendo "sobreviveu"
// e a conclusao errada sendo "a suite nao mede isso". A trava de ocorrencia
// unica no laco abaixo e o que pega esse caso.
//
// O CONTROLE NEGATIVO NAO TEM MUTANTE PROPRIO, E NAO PODE TER
// -----------------------------------------------------------
// "A conta sem MyBank le os mesmos numeros de hoje" e uma afirmacao de
// AUSENCIA: o mutante que a quebraria e justamente cada um dos mutantes
// abaixo que faz uma leitura somar o que nao devia. Os quatro casos de controle
// negativo da suite sao o que os mata -- por exemplo, o mutante do
// `a_receber_do_mybank: { total: 0 }` NAO muda numero nenhum e e morto so pelo
// controle 3/4, que afirma a FORMA da resposta.
//
// A FORMA DA LISTA E A DA FAMILIA TUPLA DE ARIDADE 4
// -------------------------------------------------
// `scripts/mede-ancora-ambigua.mjs` -- a guarda que reprova ancora morta,
// ambigua ou de arquivo inexistente em TODO runner do repo -- le a lista de
// verdade em vez de a copiar, e so sabe ler duas formas. Dai a ordem
// `[alvo, rotulo, de, para]` e o `original` montado DEPOIS da lista. As ancoras
// sao strings de uma linha com `\n` escapado, nunca template literal.
import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const LEITURAS = "lib/leituras-do-mybank.ts";
const TELAS = "lib/telas-de-movimentacao.ts";
const LISTA = "app/api/scheduled-transactions/route.ts";
const CABECALHO = "app/api/scheduled-transactions/summary/route.ts";
const POSSO_GASTAR = "app/api/safe-to-spend/route.ts";
const MOVIMENTACAO = "app/api/movimentacoes/resumo/route.ts";

/** [alvo, rotulo, de, para] */
const mutantes = [
  // =========================================================================
  // LEITURA 1 -- Contas a Pagar: a lista e o cabecalho
  // =========================================================================
  // As duas sao mutadas em separado de proposito. Um conserto so na lista
  // deixaria o «A vencer» do cabecalho da MESMA TELA ignorando a parcela, e o
  // numero menor e o que parece certo a quem nao somou na mao -- a familia
  // `fontes-consistentes-que-discordam`, que este repositorio ja pagou na
  // HMO-227.
  [
    LISTA,
    "A LISTA DE CONTAS A PAGAR PERDE A PARCELA DO DEVEDOR (a divida existe no banco, a RLS a entrega, e nenhuma tela pergunta)",
    "          ...comODonoDaLeitura(divida.ok ? divida.linhas : [], user.id),",
    "          ...comODonoDaLeitura([], user.id),",
  ],
  [
    CABECALHO,
    "O «A VENCER» PERDE A PARCELA DO DEVEDOR (o cabecalho diz R$ 200 sobre uma lista que soma R$ 1.200)",
    "      [...semCompraDeCartao, ...(divida.ok ? divida.linhas : [])],",
    "      [...semCompraDeCartao],",
  ],
  [
    LISTA,
    "a lista FILTRADA POR GRUPO ganha a parcela do MyBank (a divida sem grupo passa a contar em TODO grupo)",
    "      incluiPendente && !groupId",
    "      incluiPendente",
  ],
  [
    LISTA,
    "`?status=paid` devolve a parcela PENDENTE (uma linha em aberto numa lista de pagas)",
    "      incluiPendente && !groupId",
    "      !groupId",
  ],
  [
    LEITURAS,
    "a parcela do devedor vai como `transfer` (ela sai do «Total de contas» DELA: R$ 1.000 por mes que nenhuma tela soma)",
    '      direction: "expense" as const,',
    '      direction: "transfer" as unknown as "expense",',
  ],
  [
    LEITURAS,
    "a parcela VENCIDA nunca e `overdue` (o atraso deixa de ser destacado, e o `CASE` da 027 tem uma segunda resposta)",
    '      effective_status: vencimento < hoje ? ("overdue" as const) : ("pending" as const),',
    '      effective_status: "pending" as const,',
  ],
  [
    LEITURAS,
    "a linha nasce SEM O DONO DA LEITURA (`posso_editar` cai para false e o botao de avisar que pagou desaparece -- a licao da HMO-311)",
    "  return linhas.map((linha) => ({ ...linha, user_id: meuUserId }));",
    "  return linhas;",
  ],
  [
    LEITURAS,
    "o `numeric(15,2)` do PostgREST vira valor NEGATIVO (a divida DIMINUI o «a pagar», e o total desce sem nenhuma linha errada)",
    "  return Number.isFinite(n) ? Math.abs(n) : 0;",
    "  return Number.isFinite(n) ? -Math.abs(n) : 0;",
  ],

  // =========================================================================
  // O RECORTE DE DATA -- `leitura-sem-recorte-de-data-soma-o-horizonte`
  // =========================================================================
  // A view e a divida INTEIRA (24 parcelas por emprestimo), de proposito. Sem o
  // recorte, o «A vencer» de marco soma os R$ 24.000 do emprestimo todo.
  [
    LEITURAS,
    "O RECORTE PERDE O TETO: a janela de marco soma as 24 parcelas do emprestimo inteiro",
    "    return vencimento <= janela.ate;",
    "    return true;",
  ],
  [
    LEITURAS,
    "o recorte perde o PISO: a janela explicita passa a trazer o mes anterior",
    "    if (janela.de !== null && vencimento < janela.de) return false;",
    "    if (false) return false;",
  ],

  // =========================================================================
  // LEITURA 2 -- as abas Despesas e Receitas
  // =========================================================================
  // O AUTO-EMPRESTIMO SAIU DE DESPESAS NA FASE 5 (RN021.4): a aba e a metade
  // de Despesas do Resultado do mes, e o emprestimo a si mesmo e
  // transferencia. O primeiro mutante poe a excecao da HMO-372 de volta.
  [
    TELAS,
    "O AUTO-EMPRESTIMO VOLTA PARA DESPESAS (o Resultado do mes desce por dinheiro que so mudou de conta)",
    '      if (linha.tipo === tipo) linhas.push({ ...linha, natureza: "mybank" });',
    '      if (tipo === "expense" || linha.tipo === tipo) linhas.push({ ...linha, tipo, natureza: "mybank" });',
  ],
  [
    TELAS,
    "a parcela SAI da aba Transferencias (uma transferencia de verdade deixa de ser listada onde ela mora)",
    '      if (linha.tipo === tipo) linhas.push({ ...linha, natureza: "mybank" });',
    '      if (false) linhas.push({ ...linha, natureza: "mybank" });',
  ],
  [
    TELAS,
    "o SELO desaparece: a parcela se le como uma transferencia comum, e nao como a do MyBank",
    '      if (linha.tipo === tipo) linhas.push({ ...linha, natureza: "mybank" });',
    '      if (linha.tipo === tipo) linhas.push({ ...linha, natureza: "despesa" });',
  ],
  [
    TELAS,
    "o criterio do elo perde o `transaction_type`: uma previsao de RECEITA anotada com a palavra entra na aba Despesas",
    '  if (String(crua.direction ?? "") !== TIPO_DA_PARCELA_DO_MYBANK) return false;',
    "  if (false) return false;",
  ],
  [
    TELAS,
    // A ANCORA MUDOU DE ENDERECO NA HMO-380, e a linha mutada e a MESMA: o
    // `startsWith` saiu do corpo de `ehParcelaDoAutoEmprestimo` para
    // `temOEloDaParcelaDoMyBank`, porque o lado REALIZADO passou a fazer a mesma
    // pergunta (`ehEntradaSoltaDoMyBank`). Agora o mutante cega os DOIS
    // consultores de uma vez -- quem o mata continua sendo esta suite.
    "o criterio do elo vira `includes`: uma nota que CITA `mybank:` no meio da frase passa a ser o elo",
    "  String(notas ?? \"\").startsWith(PREFIXO_DA_PARCELA_DO_MYBANK);",
    "  String(notas ?? \"\").includes(PREFIXO_DA_PARCELA_DO_MYBANK);",
  ],
  [
    TELAS,
    "O «PREVISTO» DE RECEITAS NAO SOMA O «A RECEBER» (a decisao 2 da HMO-368 some, e a aba Despesas fica inflada sem contrapartida)",
    "    previsto: centavos(resumo.previsto + aReceber.total),\n    total: centavos(resumo.total + aReceber.total),\n    a_receber_do_mybank: aReceber,",
    "    a_receber_do_mybank: aReceber,",
  ],
  [
    TELAS,
    "o «a receber» vai para a aba ERRADA (Despesas ganha um abatimento de promessa, que e o criterio de OUTRA tela)",
    '  if (tipo !== "income") return { ...resumo, a_receber_do_mybank: null };\n\n  if (!aReceber || aReceber.total <= 0) {',
    '  if (tipo !== "expense") return { ...resumo, a_receber_do_mybank: null };\n\n  if (!aReceber || aReceber.total <= 0) {',
  ],
  [
    TELAS,
    "o campo aparece ZERADO na conta sem MyBank (a FORMA da resposta muda para todo mundo, sem mudar numero nenhum)",
    "  if (!aReceber || aReceber.total <= 0) {\n    return { ...resumo, a_receber_do_mybank: null };\n  }",
    "  if (!aReceber || aReceber.total <= 0) {\n    return { ...resumo, a_receber_do_mybank: { total: 0 } };\n  }",
  ],
  [
    LEITURAS,
    "O AUTO-EMPRESTIMO VIRA «A RECEBER» DE MIM MESMO (o juro que eu pago a mim mesmo entra como receita)",
    "    if (parcela.borrower_user_id === meuUserId) return false;",
    "    if (false) return false;",
  ],
  // O JURO E NAO A PARCELA (fase 5, RN021.3). Os dois lados do mesmo emprestimo.
  [
    LEITURAS,
    "O «A RECEBER» SOMA A PARCELA CHEIA (o principal que volta vira receita do mes)",
    "    emAberto.reduce((soma, parcela) => soma + juroDaParcela(parcela), 0)",
    "    emAberto.reduce((soma, parcela) => soma + valorDaParcela(parcela), 0)",
  ],
  [
    LEITURAS,
    "a parcela SEM juro conta no «a receber» (a frase diz 2 parcelas e 2 emprestimos onde so 1 tem juro)",
    "    return juroDaParcela(parcela) > 0;",
    "    return true;",
  ],
  [
    LEITURAS,
    "O JURO DEVIDO VIRA A PARCELA CHEIA (a aba Despesas de quem pegou volta a somar o principal)",
    "      amount: juro,",
    "      amount: parcela.amount,",
  ],
  [
    LEITURAS,
    "o juro devido inclui o AUTO-EMPRESTIMO (o juro que eu pago a mim mesmo vira despesa)",
    "    if (parcela.lender_user_id === meuUserId) continue;",
    "    if (false) continue;",
  ],
  [
    LEITURAS,
    "o juro devido de quem EMPRESTOU entra nas Despesas dele (a mesma linha dos dois lados do emprestimo)",
    "    if (parcela.borrower_user_id !== meuUserId) continue;",
    "    if (false) continue;",
  ],
  [
    LEITURAS,
    "o juro devido de emprestimo QUITADO continua na aba (a divida que acabou volta a ser prevista)",
    '    if (parcela.loan_status !== "active") continue;',
    "    if (false) continue;",
  ],
  [
    LEITURAS,
    "o juro devido perde a descricao (a linha prevista e a paga mudam de nome no dia da baixa)",
    "      description: descricaoDoJuro(parcela),",
    "      description: parcela.description,",
  ],
  [
    LEITURAS,
    "O JURO PAGO ENTRA POSITIVO (a despesa de quem pegou vira receita no Realizado)",
    "      amount: -valor,",
    "      amount: valor,",
  ],
  [
    LEITURAS,
    "o juro pago perde a chave (`ehJuroPagoDoMyBank` nao o reconhece e o selo some)",
    "      notes: chaveDaParcelaDoMyBank(juro.id),",
    '      notes: "",',
  ],
  [
    MOVIMENTACAO,
    "O JURO PAGO FICA FORA DO REALIZADO (quem pegou paga o juro e o mes dele nao muda)",
    "        ...contasDoFechamento,\n        ...jurosPagos,\n",
    "        ...contasDoFechamento,\n",
  ],
  [
    MOVIMENTACAO,
    "O JURO DEVIDO SOME DA ABA DESPESAS (a leitura e feita e descartada)",
    "        parcelasDevidas = comODonoDaLeitura(leitura.linhas, user.id);",
    "        parcelasDevidas = comODonoDaLeitura([], user.id);",
  ],
  [
    LEITURAS,
    "a parcela `reported` deixa de contar como a receber (o «Previsto» desce no clique do devedor, antes de o dinheiro chegar)",
    '    if (parcela.status !== "pending" && parcela.status !== "reported") return false;',
    '    if (parcela.status !== "pending") return false;',
  ],
  [
    LEITURAS,
    "a parcela `paid` CONTINUA contando como a receber (o dinheiro que ja entrou e prometido de novo)",
    '    if (parcela.status !== "pending" && parcela.status !== "reported") return false;',
    '    if (false) return false;',
  ],

  // =========================================================================
  // LEITURA 3 -- posso gastar?
  // =========================================================================
  // A direcao do erro aqui e OPOSTA a das outras duas: um numero esquecido faz o
  // app PROMETER dinheiro que nao sobra, que e a unica direcao que esta tela nao
  // pode ter.
  [
    POSSO_GASTAR,
    "O «POSSO GASTAR» DO DEVEDOR IGNORA A PARCELA (o app promete R$ 1.000 que vao sair da conta no dia 10)",
    "    for (const parcela of divida.ok ? divida.linhas : []) {",
    "    for (const parcela of []) {",
  ],
  [
    POSSO_GASTAR,
    "o «posso gastar» ganha PISO DE DATA (a parcela desaparece do calculo no dia seguinte ao vencimento, e o disponivel SOBE por ela estar atrasada)",
    "      de: null,\n      ate,\n      hoje,",
    "      de: hoje,\n      ate,\n      hoje,",
  ],
  [
    POSSO_GASTAR,
    "a direcao da parcela e escrita a mao em vez de importada (a segunda copia da pergunta de caixa, e ela ja nasce divergindo)",
    "        tipo: direcaoDaAgenda(parcela.direction),",
    '        tipo: "income" as unknown as "expense",',
  ],
];

const SUITE = "test:leituras-do-mybank";

const bloco = criarBlocoDeMutantes({
  suites: [SUITE],
  rotulo: "leituras-do-mybank",
});

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela. Montado DEPOIS da lista -- ver A FORMA DA LISTA, no cabecalho.
const original = new Map();
for (const arquivo of new Set(mutantes.map(([alvo]) => alvo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO: a arvore limpa tem de passar. Sem ele, uma suite ja
// vermelha -- ou um erro de script -- deixaria TODO mutante aparecendo como
// morto e o placar sairia cheio sem medir nada.
const limpo = bloco.rodar("<arvore limpa>", {}, SUITE);
if (!limpo.verde) {
  console.error(
    "controle positivo REPROVOU: a suite ja esta vermelha sem mutante nenhum. " +
      "Todo mutante abaixo apareceria como MORTO sem medir nada."
  );
  bloco.fechar();
  process.exit(1);
}
console.log("controle positivo: arvore limpa VERDE.\n");

let mortos = 0;
const sobreviventes = [];

for (const [arquivo, rotulo, de, para] of mutantes) {
  const fonte = original.get(arquivo);
  const ocorrencias = fonte.split(de).length - 1;

  if (ocorrencias === 0) {
    console.error(
      `ANCORA MORTA  ${rotulo}\n  ${arquivo} nao contem o trecho procurado. ` +
        "Isto e erro do runner, nao mutante morto -- conserte a ancora."
    );
    bloco.fechar();
    process.exit(1);
  }

  // A TRAVA DE OCORRENCIA UNICA. `String.replace` troca a PRIMEIRA ocorrencia:
  // um `de` que aparece duas vezes muta um lugar que o rotulo nao descreve. O
  // risco e concreto aqui -- os comentarios destes arquivos CITAM as proprias
  // ancoras --, e uma ancora curta demais mutaria a explicacao e deixaria o
  // codigo intacto, com o placar dizendo "sobreviveu".
  if (ocorrencias > 1) {
    console.error(
      `ANCORA AMBIGUA  ${rotulo}\n  o trecho aparece ${ocorrencias}x em ${arquivo} ` +
        "-- o replace muta so a 1a. Isto e erro do runner; estreite a ancora."
    );
    bloco.fechar();
    process.exit(1);
  }

  const mutado = fonte.replace(de, para);

  if (mutado === fonte) {
    console.error(
      `MUTACAO NO-OP  ${rotulo}\n  o replace nao mudou o texto de ${arquivo}.`
    );
    bloco.fechar();
    process.exit(1);
  }

  const r = bloco.rodar(rotulo, { [arquivo]: mutado }, SUITE);

  if (!r.verde) {
    mortos += 1;
    console.log(`MORTO      ${rotulo}`);
  } else {
    sobreviventes.push(rotulo);
    console.log(`SOBREVIVEU ${rotulo}`);
    if (r.mudouASaida === false) {
      console.log(
        "           (saida compilada identica a da arvore limpa: EQUIVALENTE)"
      );
    }
  }
}

bloco.fechar();

console.log(`\n${mortos}/${mutantes.length} mortos.`);
if (sobreviventes.length > 0) {
  console.log("\nsobreviventes:");
  for (const s of sobreviventes) console.log(`  - ${s}`);
}

// Sai 1 com sobrevivente: um runner que saisse 0 deixaria o step de CI verde
// para sempre e provaria o mesmo que step nenhum.
process.exit(sobreviventes.length === 0 ? 0 : 1);
