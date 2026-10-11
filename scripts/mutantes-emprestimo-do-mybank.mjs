#!/usr/bin/env node
// Prova de mutacao do MyBank -- a serie do emprestimo, as rotas e o ciclo do
// Caso A (HMO-370 e HMO-382).
//
//   node scripts/mutantes-emprestimo-do-mybank.mjs
//
// Cada entrada estraga UMA decisao; `npm run test:emprestimo-do-mybank` tem de
// ficar VERMELHA em todas. Mutante que sobrevive e um trecho que nenhuma
// assercao distingue.
//
// OS DOIS QUE A ISSUE NOMEIA SAO OS DOIS PRIMEIROS DA LISTA
// ---------------------------------------------------------
// `O CASO A GRAVA expense EM VEZ DE transfer` e `O CASO B GRAVA LINHA MINHA`
// sao os mutantes que a HMO-370 pede por nome, e se qualquer um dos dois
// sobrevive nenhum outro compensa -- a suite nao estaria medindo a feature.
//
// POR QUE OS DOIS SAO DINHEIRO ERRADO E NAO UM ERRO
// -------------------------------------------------
// O primeiro: com `expense` no lugar de `transfer`, a baixa da previsao cria UMA
// perna negativa na conta corrente e a conta de investimento nunca recebe nada.
// R$ 1.000 por mes saem do patrimonio e nao chegam a lugar nenhum. O CHECK do
// destino (`scheduled_transactions_destino_check`, 038) e o que torna isso
// detectavel NO BANCO -- mas o banco so e consultado se a linha chegar la, e e
// a rota que decide o tipo.
//
// O segundo: com a guarda do caso apagada, emprestar R$ 24.000 para a Lais cria
// 24 contas a pagar NO MEU NOME. O safe-to-spend desconta R$ 1.000 por mes de
// um dinheiro que ELA paga, Despesas infla, e nenhuma tela diz por que. Nada no
// caminho reclama: as linhas sao minhas, a RLS as aceita.
//
// A GUARDA DO CASO B TEM DUAS LINHAS, E ELAS SAO MUTADAS JUNTAS
// ------------------------------------------------------------
// `previsoesDoEmprestimo` tem `if (caso !== "auto") return []` E
// `if (!contaDePagamentoId) return []`. Apagar so a primeira nao muda o que a
// ROTA faz no Caso B normal: lá o `contaDePagamentoId` ja chega `null`, e a
// segunda guarda devolve `[]` de qualquer jeito. Por isso a entrega tem DOIS
// mutantes -- um que apaga as duas (o estado "a feature nunca existiu") e um
// que apaga so a do caso (que o teste do corpo com `conta_de_pagamento_id`
// mata, e so ele). Ver `duas-guardas-redundantes-fazem-os-dois-mutantes-
// sobreviverem`.
//
// O QUE A HMO-382 PEDE POR NOME: `A PARCELA FICA EM pending`
// ----------------------------------------------------------
// E o primeiro da secao do ciclo, e e o estado em que a main ficou depois da
// F4: a baixa da previsao move o dinheiro certo (corrente `-X`, investimento
// `+X`) e `mybank_installments.status` nao mexe. Eu pago a moto para mim mesmo
// nas 24 vezes e o painel do MyBank segue dizendo que eu devo tudo. O oposto da
// familia HMO-149 -- lá o numero fecha e o fato nao aconteceu; aqui o fato
// aconteceu e o numero nao mexe --, e por isso ele e mais dificil de achar
// depois: nenhum saldo esta errado.
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

const LIB = "lib/emprestimo-do-mybank.ts";
const LOANS = "app/api/mybank/loans/route.ts";
const CANCELA = "app/api/mybank/loans/[id]/route.ts";
const PARCELA = "app/api/mybank/installments/[id]/route.ts";
const BAIXA = "app/api/scheduled-transactions/[id]/pay/route.ts";
const ANTECIPA = "app/api/mybank/loans/[id]/antecipacao/route.ts";

/** [alvo, rotulo, de, para] */
const mutantes = [
  // =========================================================================
  // OS DOIS QUE A ISSUE NOMEIA
  // =========================================================================
  [
    LIB,
    "O CASO A GRAVA expense EM VEZ DE transfer (o dinheiro sai da corrente e nao chega ao investimento)",
    '    transaction_type: "transfer" as const,',
    '    transaction_type: "expense" as unknown as "transfer",',
  ],
  [
    LIB,
    "O CASO B GRAVA LINHA MINHA (as duas guardas somem: 24 contas a pagar por um dinheiro que ela paga)",
    '  if (params.caso !== "auto") return [];\n  if (!params.contaDePagamentoId) return [];',
    '  const forcado = params.contaDePagamentoId ?? params.contaCredoraId;\n  if (!forcado) return [];',
  ],
  [
    LIB,
    "O CASO B GRAVA LINHA MINHA so quando o corpo manda conta de pagamento (a guarda do CASO sozinha)",
    '  if (params.caso !== "auto") return [];\n  if (!params.contaDePagamentoId) return [];',
    "  if (!params.contaDePagamentoId) return [];",
  ],

  // =========================================================================
  // A OUTRA METADE DO MESMO PAR: o recebimento do Caso B
  // =========================================================================
  [
    LIB,
    "a perna de entrada nasce no CASO ERRADO (o auto-emprestimo ganha uma 3a perna e conta o dinheiro duas vezes)",
    '  if (params.caso !== "conexao") return null;',
    '  if (params.caso !== "auto") return null;',
  ],
  [
    PARCELA,
    "o recebimento vira `income`: principal voltando conta como receita 24 vezes",
    "        ...perna,",
    '        ...perna,\n        transaction_type: "income" as unknown as "transfer",',
  ],
  [
    PARCELA,
    "o CASO A aceita `paid` aqui: emprestimo quitado sem nada ter saido da conta",
    '    if (caso === "auto") {\n      return NextResponse.json(',
    '    if (false) {\n      return NextResponse.json(',
  ],

  // =========================================================================
  // A ARITMETICA, que e importada e pode deixar de ser usada
  // =========================================================================
  [
    LIB,
    "a parcela vai NEGATIVA para o banco (23514 na serie inteira, por `expense`)",
    '    amount: valorGravado("income", p.valor),',
    '    amount: valorGravado("expense", p.valor),',
  ],
  [
    LIB,
    "a serie comeca na parcela 2: a soma das parcelas deixa de fechar com o principal",
    "    parcelaAtual: 1,",
    "    parcelaAtual: 2,",
  ],
  [
    LOANS,
    "`principal` grava o valor DIGITADO: R$ 1.000 num emprestimo de R$ 24.000",
    "        description: String(descricao).trim(),\n        principal: serieFechada.valorTotal,",
    "        description: String(descricao).trim(),\n        principal: Number(valor),",
  ],

  // =========================================================================
  // AS DUAS TRAVAS DA 053, em forma de pergunta da rota
  // =========================================================================
  [
    LIB,
    "a trava da conta de investimento cai: o MyBank empresta da conta corrente",
    '  if (params.contaCredora.account_type !== "investment") {',
    "  if (false) {",
  ],
  [
    LIB,
    "a trava da conexao cai: da para criar divida no nome de um estranho",
    '  if (params.caso === "conexao" && !params.conexaoAceita) {',
    "  if (false) {",
  ],
  [
    LOANS,
    "a conexao PENDENTE serve: quem so recebeu o convite ja pode ser devedor",
    '        .eq("status", "accepted")',
    '        .neq("status", "nunca-este-valor")',
  ],

  // =========================================================================
  // O LADO DO DEVEDOR -- o que a policy nao consegue fazer
  // =========================================================================
  [
    PARCELA,
    "o devedor passa a mexer no `amount` pelo corpo do pedido (a divida encolhe)",
    '        .update({ status: "reported", reported_at: new Date().toISOString() })',
    '        .update({ status: "reported", reported_at: new Date().toISOString(), amount: body.amount })',
  ],
  [
    PARCELA,
    "o devedor leva a parcela a `paid`: quem nao ve o dinheiro chegar confirma",
    "    if (!souOCredor) {",
    "    if (false) {",
  ],
  [
    PARCELA,
    "o aviso aceita qualquer estado de partida (parcela paga volta a `reported`)",
    '      if (parcela.status !== "pending") {',
    "      if (false) {",
  ],
  [
    PARCELA,
    "o UPDATE filtrado pela RLS responde SUCESSO (zero linha alcancada, 200 na tela)",
    "      if (erroDoAviso || !atualizadas || atualizadas.length === 0) {",
    "      if (erroDoAviso) {",
  ],

  // =========================================================================
  // AS LEITURAS
  // =========================================================================
  [
    LOANS,
    'o GET perde o `.eq("lender_user_id")`: o que EU devo entra na lista "A receber"',
    '      .eq("lender_user_id", user.id)',
    '      .neq("lender_user_id", "nunca-este-id")',
  ],
  [
    LIB,
    "`parcelaAConfirmar` le o estado errado: quem avisou nao ganha a acao Confirmar",
    '  return parcela.status === "reported";',
    '  return parcela.status === "paid";',
  ],

  // =========================================================================
  // O DESFAZER do passo 3
  // =========================================================================
  [
    LOANS,
    "previsao que falha deixa o emprestimo gravado: divida que a pessoa nunca ve para pagar",
    '        await supabase.from("mybank_loans").delete().eq("id", emprestimo.id);\n        return NextResponse.json(\n          {\n            error:\n              "Não foi possível agendar as parcelas em Contas a Pagar. Nada foi gravado.",',
    '        return NextResponse.json(\n          {\n            error:\n              "Não foi possível agendar as parcelas em Contas a Pagar. Nada foi gravado.",',
  ],

  // =========================================================================
  // O CICLO DO CASO A (HMO-382) -- a baixa da previsao e o estorno
  // =========================================================================
  [
    BAIXA,
    "A PARCELA FICA EM `pending` (o dinheiro anda 24 vezes e o MyBank segue cobrando tudo)",
    "  if (fechaOCicloDoMyBank && parcelaDoMyBank) {\n    const { data: parcelasBaixadas, error: erroDaParcela } = await supabase",
    "  if (false && parcelaDoMyBank) {\n    const { data: parcelasBaixadas, error: erroDaParcela } = await supabase",
  ],
  [
    BAIXA,
    "o elo da parcela aponta para a perna de SAIDA (a parcela diz ter entrado na conta corrente, negativa)",
    "          pernaDeEntradaId: txEntrada.id,",
    "          pernaDeEntradaId: txSaida.id,",
  ],
  [
    BAIXA,
    "a baixa da parcela filtrada pela RLS responde SUCESSO (zero linha alcancada, parcela pendente e previsao paga)",
    "    if (erroDaParcela || !parcelasBaixadas || parcelasBaixadas.length === 0) {",
    "    if (erroDaParcela) {",
  ],
  [
    BAIXA,
    "a parcela que nao baixou NAO desfaz as pernas (dinheiro movido sem baixa e sem parcela)",
    '      await supabase.from("financial_transactions").delete().eq("id", txEntrada.id);\n      await supabase.from("financial_transactions").delete().eq("id", txSaida.id);\n      console.error(\n        "Baixa desfeita: a parcela do MyBank não pôde ser marcada como paga",',
    '      console.error(\n        "Baixa desfeita: a parcela do MyBank não pôde ser marcada como paga",',
  ],
  [
    BAIXA,
    "a resposta nao diz qual parcela foi baixada (a tela nao tem como saber que o MyBank mudou)",
    "    mybank_installment_id: fechaOCicloDoMyBank ? parcelaDoMyBank?.id ?? null : null,",
    "    mybank_installment_id: null as string | null,",
  ],
  [
    BAIXA,
    "o ESTORNO nao devolve a parcela (parcela paga sem dinheiro: emprestimo quitado de graca)",
    "      if (parcelaSegueAoEstornoDaPrevisao(parcela ?? null)) {",
    "      if (false) {",
  ],
  [
    BAIXA,
    "o estorno recusado pela RLS segue apagando o dinheiro (parcela fica paga e as pernas somem)",
    "        if (erroDaParcela || !devolvidas || devolvidas.length === 0) {",
    "        if (erroDaParcela) {",
  ],
  [
    LIB,
    "a chave casa em QUALQUER posicao de `notes` (uma anotacao digitada vira elo para um id inventado)",
    "  if (!notes.startsWith(PREFIXO_DA_CHAVE_DO_MYBANK)) return null;",
    "  if (!notes.includes(PREFIXO_DA_CHAVE_DO_MYBANK)) return null;",
  ],
  [
    LIB,
    "o id do elo aceita espaco (texto livre depois do prefixo passa por id de parcela)",
    "  if (!id || /\\s/.test(id)) return null;",
    "  if (!id) return null;",
  ],
  [
    LIB,
    "a baixa alcanca parcela em QUALQUER estado (a cancelada volta a `paid` por efeito colateral)",
    '  return parcela.status === "pending" || parcela.status === "reported";',
    "  return true;",
  ],
  [
    LIB,
    "o estorno le o estado errado da parcela (a parcela paga nao volta a pendente)",
    '  return parcela.status === "paid";',
    '  return parcela.status === "pending";',
  ],
  [
    LIB,
    "o estorno aceita a parcela AUSENTE (elo pendurado faz o desfazer recusar para sempre)",
    "export function parcelaSegueAoEstornoDaPrevisao(\n  parcela: { status: string } | null | undefined\n): boolean {\n  if (!parcela) return false;",
    "export function parcelaSegueAoEstornoDaPrevisao(\n  parcela: { status: string } | null | undefined\n): boolean {\n  if (!parcela) return true;",
  ],
  [
    LIB,
    "o estorno mexe so no `status` (23514 no `mybank_installments_paid_check`, e a parcela fica presa em paid)",
    '  return { status: "pending", paid_date: null, paid_transaction_id: null };',
    '  return { status: "pending" } as EstornoDaParcela;',
  ],
  [
    LIB,
    "a baixa grava `reported` em vez de `paid` (a parcela do auto-emprestimo espera uma confirmacao que nao existe)",
    '    status: "paid",\n    paid_date: params.paidDate,',
    '    status: "reported" as "paid",\n    paid_date: params.paidDate,',
  ],

  // =========================================================================
  // A CHAVE DO PEDIDO (HMO-390, F1 da HMO-383)
  // =========================================================================
  // Nenhum destes tres da erro em lugar nenhum quando acontece: a rota continua
  // respondendo 201, o emprestimo continua nascendo, e o que se perde e so a
  // recusa do REENVIO -- que ninguem ve ate a segunda divida de 24 meses
  // aparecer na tela.

  [
    LOANS,
    "O id DO PEDIDO NAO CHEGA AO INSERT (a coluna usa o DEFAULT e o reenvio cria a SEGUNDA divida)",
    "        ...(pedidoId ? { id: pedidoId } : {}),\n",
    "",
  ],

  [
    LOANS,
    "O 23505 DEVOLVE A LINHA SEM CONFERIR O CREDOR (vaza emprestimo em que eu sou DEVEDOR)",
    "      if (!jaExistia || jaExistia.lender_user_id !== user.id) {",
    "      if (!jaExistia) {",
  ],

  [
    LOANS,
    "o 23505 volta a ser erro (500 em vez de 200 com o emprestimo que ja existe)",
    '    if (erroDoEmprestimo?.code === "23505" && pedidoId) {',
    '    if (false && erroDoEmprestimo?.code === "23505" && pedidoId) {',
  ],

  [
    LOANS,
    "a contagem do caminho idempotente sai do PEDIDO e nao do banco",
    "        total_de_parcelas: quantasParcelas ?? 0,",
    "        total_de_parcelas: numeroDeParcelas,",
  ],

  [
    LOANS,
    "o id malformado deixa de ser peneirado (22P02 vira 500 em vez de 400)",
    "    if (pedidoId !== null && !ehUuid(pedidoId)) {",
    "    if (false && pedidoId !== null && !ehUuid(pedidoId)) {",
  ],

  // =========================================================================
  // O CANCELAMENTO (HMO-391, F3 da HMO-383)
  // =========================================================================
  // Os dois primeiros desta secao sao os que a issue nomeia, e os dois apagam
  // historico de dinheiro SEM erro nenhum no caminho:
  //
  //   * a parcela `paid` reescrita para `cancelled` perde o unico registro que
  //     explica o saldo da conta de investimento. `mybank_installments_paid_
  //     check` nao reclama: ele compara `status = 'paid'` com `paid_date IS NOT
  //     NULL`, e o UPDATE que mexe nos dois passa;
  //   * a previsao JA BAIXADA apagada deixa as duas pernas da transferencia
  //     orfas no extrato -- o dinheiro andou e nenhuma linha diz por que.
  //
  // E o terceiro e a ORDEM, que e a direcao da falha parcial desta feature.

  [
    LIB,
    "O CANCELAMENTO ALCANCA A PARCELA `paid` (apaga o registro do dinheiro que ja se moveu)",
    "  return STATUS_EM_ABERTO_DA_PARCELA.includes(parcela.status);",
    "  return true;",
  ],

  [
    CANCELA,
    "A PREVISAO JA PAGA E APAGADA (o filtro de `pending` cai e o historico do que ja foi pago vai embora)",
    '        .eq("status", "pending")\n        .in("notes", chaves)',
    '        .in("notes", chaves)',
  ],

  [
    CANCELA,
    "A ORDEM INVERTIDA 4<->2: as previsoes saem ANTES de a divida ser encerrada (divida viva sem contas a pagar)",
    "    const todas = parcelas ?? [];",
    '    const todas = parcelas ?? [];\n    await supabase\n      .from("scheduled_transactions")\n      .delete()\n      .eq("user_id", user.id)\n      .eq("status", "pending")\n      .in(\n        "notes",\n        todas.filter(parcelaSegueOCancelamento).map((p) => "mybank:" + p.id)\n      )\n      .select("id");',
  ],

  [
    CANCELA,
    "a guarda do `.length` das previsoes cai: `.in` vazio no PostgREST apaga a agenda INTEIRA de Contas a Pagar",
    "    if (chaves.length > 0) {",
    "    if (chaves.length >= 0) {",
  ],

  [
    CANCELA,
    "a guarda do `.length` das parcelas cai: `.in(\"id\", [])` alcanca parcela paga de OUTRO emprestimo meu",
    "    if (aCancelar.length > 0) {",
    "    if (aCancelar.length >= 0) {",
  ],

  [
    LIB,
    "o DEVEDOR cancela a divida dele (a pergunta de credor cai, e a RLS nao recusa: ela FILTRA)",
    // A ASSINATURA DA FUNCAO ENTRA NA ANCORA, E NAO E ZELO: desde a HMO-395
    // `problemaDaAntecipacao` tem esta MESMA linha, palavra por palavra, porque
    // e a mesma decisao (a RLS filtra em vez de recusar, entao a rota pergunta
    // antes). A ancora, escrita quando a linha era unica, passou a casar duas
    // vezes e o runner a reprovaria como ambigua -- e o `replace` mutaria a
    // primeira, que nao e a que o rotulo descreve.
    // Ver `funcao-nova-que-copia-criterio-torna-ancora-alheia-ambigua`.
    "}): ProblemaDoCancelamento | null {\n  if (params.emprestimo.lender_user_id !== params.meuId) {",
    "}): ProblemaDoCancelamento | null {\n  if (false) {",
  ],

  [
    CANCELA,
    "A LINHA DEVOLVIDA PELO UPDATE NAO E CONFERIDA (cancelei, e a linha escrita e de outro credor)",
    "    if (cancelados.some((l) => l.lender_user_id !== user.id)) {",
    "    if (false) {",
  ],

  [
    CANCELA,
    "o UPDATE do cancelamento filtrado pela RLS responde SUCESSO (zero linha, 200 e a divida de pe)",
    "    if (erroDoCancelamento || !cancelados || cancelados.length === 0) {",
    "    if (erroDoCancelamento) {",
  ],

  [
    LIB,
    "o emprestimo JA CANCELADO e cancelado de novo (as parcelas canceladas sao reescritas)",
    "  if (params.emprestimo.status === STATUS_CANCELADO) {",
    "  if (false) {",
  ],

  [
    LIB,
    "o emprestimo QUITADO aceita cancelamento (quem recebeu a ultima parcela ve a divida virar cancelada)",
    '  if (params.emprestimo.status === "settled") {',
    "  if (false) {",
  ],

  [
    CANCELA,
    "o corpo deixa de ser peneirado: qualquer `status` no pedido cancela o emprestimo",
    "    if (status !== STATUS_CANCELADO) {",
    "    if (false) {",
  ],

  [
    CANCELA,
    "a recusa ao devedor vira 409 (o codigo deixa de distinguir `nao e seu` de `ja encerrado`)",
    '          status: problema === "nao_sou_o_credor" ? 403 : 409,',
    "          status: 409,",
  ],

  // =========================================================================
  // `settled`: A QUITACAO (HMO-394, F1 da HMO-393)
  // =========================================================================
  // O PRIMEIRO E O QUE A ISSUE NOMEIA, e ele e o INVERSO do defeito que a fase
  // conserta: nao "o emprestimo pago nao se declara quitado", e sim "o
  // emprestimo que ninguem pagou se declara quitado".
  //
  // Com a exigencia de uma `paid` apagada, o emprestimo gravado pela metade --
  // zero parcelas, estado que o ramo idempotente de `loans/route.ts:392`
  // reconhece por extenso ("morreu entre o passo 1 e o passo 2") -- passa a
  // satisfazer "nada em aberto" e vira `settled`. As duas telas filtram
  // `active`, entao ele SAI DAS DUAS como divida cumprida: uma divida real
  // desaparece sem nunca ter sido cobrada. E nenhum saldo denuncia, porque
  // nenhum dinheiro foi lancado errado -- ele so deixou de ser pedido.

  [
    LIB,
    "`emprestimoFicouQuitado` IGNORA A EXIGENCIA DE UMA `paid` (o emprestimo gravado pela metade se declara quitado)",
    '  return params.parcelas.some((p) => p.status === "paid");',
    "  return true;",
  ],

  [
    LIB,
    "`emprestimoFicouQuitado` ignora as parcelas EM ABERTO (a 3/24 paga quita a divida inteira)",
    "  if (aindaEmAberto) return false;",
    "",
  ],

  [
    PARCELA,
    "a quitacao nao confere a CONTAGEM (a resposta diz `quitado` sobre UPDATE que a RLS filtrou)",
    "        emprestimoQuitado =\n          !erroDaQuitacao && !!quitados && quitados.length > 0;",
    "        emprestimoQuitado = !erroDaQuitacao;",
  ],

  [
    PARCELA,
    "a releitura da serie perde o filtro do emprestimo (parcela de OUTRA divida impede a quitacao)",
    '      .eq("loan_id", emprestimo.id);',
    "      ;",
  ],

  [
    BAIXA,
    "o UPDATE da quitacao perde o filtro do id (TODO emprestimo que a RLS entrega vira `settled`)",
    '        .eq("id", parcelaDoMyBank.loan_id)',
    "",
  ],

  // =========================================================================
  // A ANTECIPACAO DE PARCELAS (HMO-395, F2 da HMO-393)
  // =========================================================================
  // O PRIMEIRO E O CONTROLE DA CORRECAO QUE VEM ANTES DESTA FEATURE.
  //
  // A HMO-393 propunha, no item 2, que as parcelas antecipadas saissem do fim da
  // serie para `cancelled` E que o dinheiro pagasse as proximas em aberto. Isso
  // EXTINGUE O DOBRO DO QUE FOI PAGO: quatro parcelas saem do caminho e duas
  // foram pagas. Este mutante e aquele desenho escrito inteiro -- a cauda
  // cancelada e a cabeca paga.
  //
  // Ele tem de morrer no teste "O CONTROLE DA ISSUE", que tem UMA assercao e ela
  // e de SOMATORIO. Num teste que tambem afirmasse `status` ele morreria na
  // primeira assercao de status, e a prova ficaria amarrada a qual status cada
  // desenho escreve em vez do fato de um deles perder R$ 200 -- e nenhum CHECK
  // deste banco reclama disso.
  //
  // O SEGUNDO NAO ERRA NUMERO NENHUM. Com `ASC` no lugar de `DESC` o total
  // recebido e o mesmo e as duas telas ficam consistentes; o que se perde e a
  // decisao de produto ("ENCURTA a serie"), e ela so se mede por QUAIS parcelas
  // baixaram e por qual passou a ser o ultimo vencimento em aberto.

  [
    ANTECIPA,
    "A ANTECIPACAO CANCELA A CAUDA E PAGA A CABECA (o desenho do item 2: extingue o DOBRO do que foi pago)",
    "    const escolhidas = parcelasDaAntecipacao({ parcelas, quantas });",
    '    const aCancelar = parcelasDaAntecipacao({ parcelas, quantas });\n' +
      "    await supabase\n" +
      '      .from("mybank_installments")\n' +
      '      .update({ status: "cancelled" })\n' +
      '      .in(\n' +
      '        "id",\n' +
      "        aCancelar.map((p) => p.id)\n" +
      "      )\n" +
      '      .select("id");\n' +
      "    const escolhidas = parcelas\n" +
      '      .filter((p) => p.status === "pending" || p.status === "reported")\n' +
      "      .filter((p) => !aCancelar.some((c) => c.id === p.id))\n" +
      "      .sort((a, b) => a.installment_number - b.installment_number)\n" +
      "      .slice(0, quantas);",
  ],

  [
    LIB,
    "A ESCOLHA PEGA A CABECA DA SERIE (DESC -> ASC: o total e o mesmo e a serie NAO encurta)",
    "      return String(a.due_date) < String(b.due_date) ? 1 : -1;",
    "      return String(a.due_date) < String(b.due_date) ? -1 : 1;",
  ],

  [
    LIB,
    "o desempate de vencimento igual cai (duas parcelas do mesmo dia saem na ordem que o banco devolveu)",
    "    return b.installment_number - a.installment_number;",
    "    return 0;",
  ],

  [
    LIB,
    "a escolha alcanca parcela PAGA e CANCELADA (antecipar paga duas vezes a mesma parcela)",
    "  const emAberto = params.parcelas.filter((p) =>\n    STATUS_EM_ABERTO_DA_PARCELA.includes(p.status)\n  );\n\n  const daCaudaParaCima",
    "  const emAberto = params.parcelas.filter(() => true);\n\n  const daCaudaParaCima",
  ],

  [
    LIB,
    "a escolha REORDENA a lista de quem chamou (o rotulo de vencimento e a contagem da rota leem outra ordem)",
    "  const emAberto = params.parcelas.filter((p) =>\n    STATUS_EM_ABERTO_DA_PARCELA.includes(p.status)\n  );\n\n  const daCaudaParaCima",
    "  params.parcelas.sort((a, b) => b.installment_number - a.installment_number);\n  const emAberto = params.parcelas.filter((p) =>\n    STATUS_EM_ABERTO_DA_PARCELA.includes(p.status)\n  );\n\n  const daCaudaParaCima",
  ],

  // -------------------------------------------------------------------------
  // A PERNA -- e ela precisa da PROPRIA ancora
  // -------------------------------------------------------------------------
  // `mesmo-alvo-nao-prova-coberto-compare-as-ancoras`: a parcela avulsa ja tem
  // mutante de `income` no PATCH da parcela, e ele nao diz nada sobre esta rota.
  // E aqui o defeito e MAIOR -- a antecipacao lanca N pernas num unico pedido,
  // entao o mesmo principal entraria como renda N vezes de uma vez.

  [
    ANTECIPA,
    "a perna da antecipacao vira `income` (o mesmo principal conta como receita N vezes num clique)",
    "          ...perna,",
    '          ...perna,\n          transaction_type: "income" as unknown as "transfer",',
  ],

  [
    ANTECIPA,
    "O ROLLBACK DA PERNA NAO RODA quando a baixa falha (perna orfa: dinheiro no extrato que nenhuma divida explica)",
    '        await supabase\n          .from("financial_transactions")\n          .delete()\n          .eq("id", lancamento.id);\n\n        console.error(\n          "Antecipacao desfeita nesta parcela: a baixa nao alcancou a linha",',
    '        console.error(\n          "Antecipacao desfeita nesta parcela: a baixa nao alcancou a linha",',
  ],

  [
    ANTECIPA,
    "a baixa filtrada pela RLS responde SUCESSO (zero linha alcancada, e a perna fica no extrato)",
    "      if (erroDaBaixa || !baixadas || baixadas.length === 0) {",
    "      if (erroDaBaixa) {",
  ],

  // -------------------------------------------------------------------------
  // O CREDOR, e as duas leituras filtradas pelo emprestimo
  // -------------------------------------------------------------------------

  [
    LIB,
    "O CREDOR DEIXA DE SER CONFERIDO (a devedora recebe sucesso de um UPDATE que a RLS filtrou)",
    "}): ProblemaDaAntecipacao | null {\n  if (params.emprestimo.lender_user_id !== params.meuId) {",
    "}): ProblemaDaAntecipacao | null {\n  if (false) {",
  ],

  [
    ANTECIPA,
    "a leitura da serie perde o filtro do emprestimo (antecipar esta divida paga a parcela de OUTRA)",
    '        "id, installment_number, installment_total, amount, due_date, status"\n      )\n      .eq("loan_id", emprestimo.id);',
    '        "id, installment_number, installment_total, amount, due_date, status"\n      )\n      ;',
  ],

  [
    ANTECIPA,
    "a RELEITURA perde o filtro do emprestimo (parcela de outra divida impede a quitacao)",
    '      .select("id, status, due_date")\n      .eq("loan_id", emprestimo.id);',
    '      .select("id, status, due_date")\n      ;',
  ],

  [
    ANTECIPA,
    "a quitacao da antecipacao nao confere a CONTAGEM (a resposta diz quitado sobre UPDATE que a RLS filtrou)",
    "        emprestimoQuitado =\n          !erroDaQuitacao && !!quitados && quitados.length > 0;",
    "        emprestimoQuitado = !erroDaQuitacao;",
  ],

  // -------------------------------------------------------------------------
  // AS RECUSAS -- cada uma e dinheiro saindo da conta sem ter sido pedido
  // -------------------------------------------------------------------------

  [
    LIB,
    "o emprestimo COM JURO passa (somar `amount` cobra juro de um tempo que nao existiu)",
    "  if (Number(params.emprestimo.interest_rate ?? 0) !== JUROS_DA_FASE_1) {",
    "  if (false) {",
  ],

  [
    LIB,
    "o juro chega como STRING e a recusa dispara em TODO emprestimo da fase 1 (a feature fica inalcancavel)",
    "  if (Number(params.emprestimo.interest_rate ?? 0) !== JUROS_DA_FASE_1) {",
    "  if ((params.emprestimo.interest_rate ?? 0) !== JUROS_DA_FASE_1) {",
  ],

  [
    LIB,
    "o emprestimo CANCELADO ou QUITADO aceita antecipacao (dinheiro sai da conta por uma divida que acabou)",
    "  if (params.emprestimo.status !== STATUS_ATIVO) {",
    "  if (false) {",
  ],

  [
    LIB,
    "`quantas` fracionario ou zero passa (o pedido de R$ 150 deixa de ter recusa com frase)",
    "  if (!Number.isInteger(params.quantas) || params.quantas < 1) {",
    "  if (false) {",
  ],

  [
    LIB,
    "da para antecipar MAIS do que esta em aberto (a rota decide um valor diferente do que a pessoa confirmou)",
    "  if (params.quantas > quantasEmAberto(params.parcelas)) {",
    "  if (false) {",
  ],

  [
    LIB,
    "o CASO A entra aqui (a serie do auto-emprestimo encurta sem nada ter saido da conta)",
    '    }) === "auto"\n  ) {\n    return "caso_a_nao_entra_aqui";',
    '    }) !== "auto"\n  ) {\n    return "caso_a_nao_entra_aqui";',
  ],

  // -------------------------------------------------------------------------
  // A ARITMETICA E AS FRASES
  // -------------------------------------------------------------------------

  [
    LIB,
    "`valorDaAntecipacao` soma REAIS em vez de centavos (o valor da resposta sai com dizima)",
    "    (total, p) => total + Math.round(Number(p.amount) * 100),\n    0\n  );\n\n  return centavos / 100;",
    "    (total, p) => total + Number(p.amount),\n    0\n  );\n\n  return centavos;",
  ],

  [
    LIB,
    "`ultimoVencimentoEmAberto` ordena o ROTULO e nao o ISO (01/2028 vem antes de 09/2026)",
    '    .map((p) => String(p.due_date))\n    .sort();\n\n  if (isos.length === 0) return null;\n\n  return mesDoVencimentoDaParcela(isos[isos.length - 1]);',
    '    .map((p) => mesDoVencimentoDaParcela(String(p.due_date)))\n    .sort();\n\n  if (isos.length === 0) return null;\n\n  return isos[isos.length - 1];',
  ],

  [
    LIB,
    "a mensagem perde a TERCEIRA frase (duas parcelas menos se le como `baixaram minha prestacao`)",
    '    `${params.ultimoVencimentoDepois}. As parcelas que sobram mantêm o valor de sempre — ` +\n    "antecipar encurta a série, não baixa a prestação."',
    "    `${params.ultimoVencimentoDepois}.`",
  ],

  [
    LIB,
    "a mensagem DEDUZ a quitacao de `nao sobrou vencimento` (anuncia quitado de um emprestimo ainda `active`)",
    "  if (params.quitado) {",
    "  if (params.ultimoVencimentoDepois === null) {",
  ],

  [
    LIB,
    "a releitura que FALHOU passa por `nao sobrou nada` (a frase anuncia o fim de uma divida que a rota nao conseguiu ler)",
    "  if (!params.serieRelida) {",
    "  if (false) {",
  ],

  [
    ANTECIPA,
    "a releitura que falhou devolve `parcelas_em_aberto: 0` (zero diz `nada a pagar` onde a rota nao sabe)",
    "    let aindaEmAberto: number | null = null;",
    "    let aindaEmAberto: number | null = 0;",
  ],

  [
    ANTECIPA,
    "a resposta conta as parcelas PEDIDAS e nao as que entraram (2 antecipadas quando so uma baixou)",
    "      numerosAntecipados: antecipadas.map((p) => p.numero),",
    "      numerosAntecipados: escolhidas.map((p) => p.installment_number),",
  ],
];

const SUITE = "test:emprestimo-do-mybank";

const bloco = criarBlocoDeMutantes({
  suites: [SUITE],
  rotulo: "emprestimo-do-mybank",
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
  // ancoras (`principal: serieFechada.valorTotal` aparece na prosa que explica
  // por que ele nao e o valor digitado), e uma ancora curta demais mutaria a
  // explicacao e deixaria o codigo intacto, com o placar dizendo "sobreviveu".
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
