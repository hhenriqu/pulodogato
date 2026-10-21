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
// O MESMO ARQUIVO QUE `CANCELA`, com nome proprio: desde a HMO-447 aquele
// `PATCH` tem DOIS verbos, e um rotulo de mutante que diz "CANCELA" sobre uma
// ancora do ajuste manda quem for consertar ler o passo errado.
const AJUSTA = CANCELA;
// A HMO-396 MOVEU os passos 2/2.5/3 da baixa para ca, e a antecipacao do Caso A
// passou a CHAMA-LOS em vez de reescrever as quarenta linhas de movimentacao de
// dinheiro. QUATRO ancoras desta lista mudaram de arquivo e NAO de texto -- o
// codigo foi movido com a indentacao intacta, de proposito, para que a prova da
// refatoracao fosse o placar e nao a releitura de cada mutante
// (`igualdade-de-placar-prova-refatoracao-mesmo-vermelha`). As outras quatro
// ficaram em `BAIXA`: duas no estorno (que nao foi movido), uma na resposta e
// uma no passo 4.
const SERVICO = "lib/services/baixa-da-transferencia-prevista.ts";

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
    "    parcelaAtual: 1,\n    totalDeParcelas: entrada.parcelas,",
    "    parcelaAtual: 2,\n    totalDeParcelas: entrada.parcelas,",
  ],
  [
    LOANS,
    "`principal` grava o valor DIGITADO: R$ 1.000 num emprestimo de R$ 24.000",
    // A ANCORA MUDOU NA HMO-448, E O MUTANTE CONTINUA SENDO O MESMO DEFEITO.
    // A linha deixou de ser `principal: serieFechada.valorTotal` porque com
    // juro aquele numero e o TOTAL e nao o emprestado -- quem escolhe agora e
    // `principalQueVaiParaAColuna`. O que este mutante mede nao mudou: gravar o
    // DIGITADO em vez do resolvido poe R$ 1.000 num emprestimo de R$ 24.000 no
    // caminho de `base: "parcela"`.
    //
    // A ANCORA LEVA A LINHA DE CIMA porque a MESMA chamada aparece duas vezes
    // na rota -- no insert e na resposta --, e o runner recusa ancora ambigua
    // (ele mutaria so a primeira). `description:` prende esta no insert.
    "        description: String(descricao).trim(),\n        principal: principalQueVaiParaAColuna({ juro, serie: serieFechada }),",
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
    SERVICO,
    "A PARCELA FICA EM `pending` (o dinheiro anda 24 vezes e o MyBank segue cobrando tudo)",
    "  if (fechaOCicloDoMyBank && parcelaDoMyBank) {\n    const { data: parcelasBaixadas, error: erroDaParcela } = await supabase",
    "  if (false && parcelaDoMyBank) {\n    const { data: parcelasBaixadas, error: erroDaParcela } = await supabase",
  ],
  [
    SERVICO,
    "o elo da parcela aponta para a perna de SAIDA (a parcela diz ter entrado na conta corrente, negativa)",
    "          pernaDeEntradaId: txEntrada.id,",
    "          pernaDeEntradaId: txSaida.id,",
  ],
  [
    SERVICO,
    "a baixa da parcela filtrada pela RLS responde SUCESSO (zero linha alcancada, parcela pendente e previsao paga)",
    "    if (erroDaParcela || !parcelasBaixadas || parcelasBaixadas.length === 0) {",
    "    if (erroDaParcela) {",
  ],
  [
    SERVICO,
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
    // A ANCORA LEVA A TERCEIRA LINHA DESDE A HMO-396, e nao por capricho:
    // `patchDaBaixaDaPrevisao` nasceu com as DUAS primeiras linhas identicas a
    // estas (`status: "paid"` + `paid_date: params.paidDate`), e a ancora de
    // duas linhas passou a casar nas duas funcoes -- `funcao-nova-que-copia-
    // criterio-torna-ancora-alheia-ambigua`. O que distingue as duas e a coluna
    // do elo: `paid_transaction_id` aqui (onde o dinheiro ENTROU),
    // `transaction_id` lá (de onde ele SAIU).
    '    status: "paid",\n    paid_date: params.paidDate,\n    paid_transaction_id:',
    '    status: "reported" as "paid",\n    paid_date: params.paidDate,\n    paid_transaction_id:',
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

  // AS DUAS ANCORAS ABAIXO FORAM REESCRITAS NA HMO-448, E NAO SO RENOMEADAS
  // ------------------------------------------------------------------------
  // `JUROS_DA_FASE_1` virou `JURO_QUE_A_ANTECIPACAO_SABE_DESCONTAR` (o numero e
  // o mesmo; o que mudou foi o que ele significa -- ver a constante). Uma ancora
  // que ficasse com o nome velho simplesmente NAO CASARIA, e o runner reportaria
  // o mutante como sobrevivente sem nunca ter mudado uma linha:
  // `ancora-de-mutante-casa-no-comentario-e-o-cmp-nao-ve`.
  //
  // E o primeiro rotulo mudou de verdade junto: a recusa que ele muta deixou de
  // ser hipotetica. Antes desta issue NENHUM emprestimo podia ter juro (a trava
  // da 053 cravava `interest_rate = 0`), entao aquele `if` era inalcancavel por
  // construcao e o mutante media uma guarda contra um estado impossivel. Com a
  // 062 colada e esta rota gravando taxa, ele passa a ser a unica coisa que
  // impede a antecipacao de somar `amount` de parcelas cujo juro NAO correu.

  [
    LIB,
    "o emprestimo COM JURO aceita antecipacao (somar `amount` cobra juro de um tempo que nao existiu -- e agora e ALCANCAVEL)",
    "    Number(params.emprestimo.interest_rate ?? 0) !==\n    JURO_QUE_A_ANTECIPACAO_SABE_DESCONTAR",
    "    false",
  ],

  [
    LIB,
    "o juro chega como STRING e a recusa dispara em TODO emprestimo a juro zero (a antecipacao fica inalcancavel)",
    "    Number(params.emprestimo.interest_rate ?? 0) !==\n    JURO_QUE_A_ANTECIPACAO_SABE_DESCONTAR",
    "    (params.emprestimo.interest_rate ?? 0) !==\n    JURO_QUE_A_ANTECIPACAO_SABE_DESCONTAR",
  ],

  // -------------------------------------------------------------------------
  // OS JUROS (HMO-448, F3 da HMO-444) -- onde o dinheiro muda de valor
  // -------------------------------------------------------------------------

  [
    LIB,
    "A SERIE E MONTADA SOBRE O PRINCIPAL em vez do total (quem cobrou 20% recebe exatamente o que emprestou)",
    "  return params.juro.total.toFixed(2);",
    "  return params.juro.principal.toFixed(2);",
  ],

  [
    LIB,
    "`principal` grava a SOMA DA SERIE em vez do emprestado (a soma fecha, a taxa diz 20%, e o juro vira ZERO)",
    "  return params.juro ? params.juro.principal : params.serie.valorTotal;",
    "  return params.serie.valorTotal;",
  ],

  [
    LIB,
    "a base com juro vem DA TELA (base `parcela` multiplica o total por N: R$ 1.000 a 20% em 12x vira R$ 14.400)",
    '  return modoCobraJuro(params.modo) ? "total" : params.daTela;',
    "  return params.daTela;",
  ],

  [
    LIB,
    "a taxa digitada NAO e dividida por 100 (20% vira 2000%, recusado pelo teto da 062 com um 23514 que a tela mostra como 500)",
    "  return percento / 100;",
    "  return percento;",
  ],

  [
    LIB,
    "o campo de taxa em branco vira JURO ZERO calado (no modo em que a pessoa escolheu cobrar juro)",
    "  if (!Number.isFinite(percento)) return NaN;",
    "  if (!Number.isFinite(percento)) return 0;",
  ],

  [
    LIB,
    "a recusa do juro some de `problemaDoEmprestimo` (taxa negativa e total menor que o principal passam direto)",
    "  if (params.problemaDoJuro) return params.problemaDoJuro;",
    "  if (false) return params.problemaDoJuro;",
  ],

  [
    LIB,
    "a PREVIA le o total CALCULADO em vez da SERIE (a tela promete um total que as parcelas nao somam)",
    "  const total = params.serie.valorTotal;",
    "  const total = params.juro ? params.juro.total : params.serie.valorTotal;",
  ],

  [
    LOANS,
    "a rota grava `interest_rate: 0` sempre (a taxa da previa nunca chega na linha)",
    "        interest_rate: juro ? juro.taxa : 0,",
    "        interest_rate: 0,",
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

  // O MUTANTE DO CASO A RECUSADO SAIU DAQUI NA F3 (HMO-396), E O PORQUE IMPORTA
  // ---------------------------------------------------------------------------
  // Ele era `o CASO A entra aqui (a serie do auto-emprestimo encurta sem nada ter
  // saido da conta)`, e mutava a recusa `caso_a_nao_entra_aqui` de
  // `problemaDaAntecipacao`. A F3 APAGOU AQUELA RECUSA -- o Caso A antecipa, e
  // move o dinheiro --, entao a ancora dele deixou de existir
  // (`mutante-cuja-ancora-a-feature-apagou`).
  //
  // Mante-lo com uma ancora nova seria pior do que apaga-lo: o ROTULO afirma que
  // a serie encurtaria "sem nada ter saido da conta", e isso deixou de ser
  // verdade -- a rota agora move o dinheiro e baixa as previsoes. Um mutante que
  // morre com um porque mentindo e
  // `reverter-decisao-de-produto-deixa-o-porque-do-mutante-mentindo`.
  //
  // O QUE FICOU NO LUGAR DA MEDICAO QUE ELE FAZIA: a secao DO CASO A, abaixo. Em
  // particular `o CASO A NAO LE AS PREVISOES`, que e o mesmo defeito escrito na
  // direcao de hoje -- a serie encurtando sem o dinheiro se mover.

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

  // =========================================================================
  // A ANTECIPACAO NO CASO A (HMO-396, F3 da HMO-393)
  // =========================================================================
  // O PRIMEIRO E O QUE A ISSUE PEDE POR NOME, E E O ESPELHO DO MUTANTE DO
  // CANCELAMENTO.
  //
  // `A PREVISAO E APAGADA EM VEZ DE BAIXADA`: a parcela fica paga, o dinheiro
  // saiu da conta corrente e entrou na de investimento -- e a linha que comprova
  // isso desaparece de Contas a Pagar. Sobram duas pernas em
  // `financial_transactions` que nenhuma conta a pagar explica, e o historico da
  // pessoa passa a ter um debito de R$ 50 sem origem.
  //
  // Ele precisa de ancora PROPRIA porque o cancelamento tem o mutante OPOSTO (`A
  // PREVISAO JA PAGA E APAGADA`, que mede o filtro de `pending` do DELETE), e os
  // dois acham as mesmas linhas pelo mesmo elo. Um mutante no outro arquivo nao
  // diz nada sobre este: `mesmo-alvo-nao-prova-coberto-compare-as-ancoras`.
  //
  // O SEGUNDO NAO PERDE DINHEIRO NENHUM, e e o que torna o par visivel: com o
  // `if (caso === "auto")` cego, a antecipacao do Caso A cai no caminho do Caso B
  // -- `pernaDeEntradaDoPagamento` devolve `null` lá, e a rota para. O defeito
  // nao e a resposta 500; e que a unica forma de antecipar um auto-emprestimo
  // deixa de existir, e a recusa que a F2 tinha (com a frase que apontava o
  // caminho) tambem ja nao esta lá.

  [
    SERVICO,
    "A PREVISAO E APAGADA EM VEZ DE BAIXADA (a parcela fica paga, o dinheiro saiu, e o registro que o comprova desaparece)",
    "    .update(patchDaBaixaDaPrevisao({ paidDate: paid_date, pernaDeSaidaId: txSaida.id }))",
    "    .delete()",
  ],

  [
    SERVICO,
    "o elo da PREVISAO aponta para a perna de ENTRADA (o estorno deixa de achar a contraparte e apaga meia transferencia)",
    "    .update(patchDaBaixaDaPrevisao({ paidDate: paid_date, pernaDeSaidaId: txSaida.id }))",
    "    .update(patchDaBaixaDaPrevisao({ paidDate: paid_date, pernaDeSaidaId: txEntrada.id }))",
  ],

  [
    LIB,
    "`patchDaBaixaDaPrevisao` NAO carimba a data (a conta a pagar aparece como paga sem dia, e o CHECK do `paid` da parcela nao cobre esta tabela)",
    "    status: \"paid\",\n    paid_date: params.paidDate,\n    transaction_id: params.pernaDeSaidaId,",
    "    status: \"paid\",\n    paid_date: undefined as unknown as string,\n    transaction_id: params.pernaDeSaidaId,",
  ],

  [
    ANTECIPA,
    "o CASO A NAO LE AS PREVISOES e cai no caminho do Caso B (a unica forma de antecipar auto-emprestimo deixa de existir)",
    "      if (caso === \"auto\") {\n        const previsao = previsaoDaParcela.get(parcela.id);",
    "      if (false) {\n        const previsao = previsaoDaParcela.get(parcela.id);",
  ],

  [
    ANTECIPA,
    "a guarda do `.length` das chaves cai: o Caso B passa a exigir previsao de parcela que nunca teve uma (`.in` vazio no PostgREST alcanca a agenda INTEIRA)",
    "    if (chaves.length > 0) {",
    "    if (true) {",
  ],

  [
    ANTECIPA,
    "a previsao ja BAIXADA e re-baixada (o `transaction_id` repontado deixa a perna antiga orfa no extrato)",
    "        .eq(\"status\", \"pending\")\n        .in(\"notes\", chaves);",
    "        .in(\"notes\", chaves);",
  ],

  [
    ANTECIPA,
    "a previsao de OUTRA conta com o mesmo `notes` serve (a camada que nao depende da RLS cai)",
    "        .eq(\"user_id\", user.id)\n        // `pending` SO.",
    "        // `pending` SO.",
  ],

  [
    ANTECIPA,
    "a parcela sem conta a pagar deixa de ser recusada ANTES da escrita (descobre no meio, com parcelas ja antecipadas)",
    "      if (parcelasSemPrevisao.length > 0) {",
    "      if (false) {",
  ],

  [
    ANTECIPA,
    "o valor que se move sai da PREVISAO editada a mao (o extrato e a resposta discordam, e a invariante do principal quebra calada)",
    "          valorPago: Number(parcela.amount),",
    "          valorPago: null,",
  ],

  [
    LIB,
    "o elo do par casa por `includes` (a conta a pagar de OUTRA parcela e baixada: o dinheiro sai pela parcela errada)",
    "    const previsao = params.previsoes.find((p) => p.notes === chave);\n\n    if (previsao) {",
    "    const previsao = params.previsoes.find((p) =>\n      String(p.notes ?? \"\").includes(chave)\n    );\n\n    if (previsao) {",
  ],

  [
    LIB,
    "a ORDEM dos pares deixa de ser a da cauda (`parei na segunda parcela` passa a querer dizer uma parcela diferente a cada chamada)",
    "  return { pares, parcelasSemPrevisao };",
    "  return { pares: pares.slice().reverse(), parcelasSemPrevisao };",
  ],

  [
    LIB,
    "`chavesDasPrevisoesDaAntecipacao` monta chave no CASO B (a antecipacao de conexao passa a exigir previsao que nunca existiu)",
    '  if (params.caso !== "auto") return [];\n  return params.parcelasAntecipadas.map((p) => chaveDaParcelaDoMyBank(p.id));',
    "  return params.parcelasAntecipadas.map((p) => chaveDaParcelaDoMyBank(p.id));",
  ],

  [
    LIB,
    "a frase da previsao ausente volta a dizer `de a parcela 2` (o defeito que a medicao em producao achou, e que todo `match` de `a parcela` deixa passar)",
    "  const quem =\n    numeros.length === 1 ? `da parcela ${quais}` : `das parcelas ${quais}`;\n\n  return (\n    `Não encontrei em Contas a Pagar a transferência agendada ${quem} ` +",
    "  const quem =\n    numeros.length === 1 ? `a parcela ${quais}` : `as parcelas ${quais}`;\n\n  return (\n    `Não encontrei em Contas a Pagar a transferência agendada de ${quem} ` +",
  ],

  [
    LIB,
    "a frase do CASO A nao diz que as contas a pagar foram BAIXADAS (quem for conferir acha duas linhas pagas sem explicacao, ou conclui que foram apagadas)",
    "  const abertura =\n    params.caso === \"auto\"",
    "  const abertura =\n    false",
  ],

  [
    ANTECIPA,
    "`previsoes_baixadas` conta as PEDIDAS e nao as baixadas (a antecipacao parcial afirma ter baixado conta a pagar que ficou pendente)",
    "      previsoes_baixadas: previsoesBaixadas,",
    "      previsoes_baixadas: escolhidas.length,",
  ],

  // =========================================================================
  // A PREVIA DO DIALOGO E A PARCELA ANTECIPADA (F4 da HMO-393, issue HMO-397)
  // =========================================================================
  // O PRIMEIRO E O MUTANTE NOMEADO DA HMO-397, e ele e o unico desta lista cujo
  // sintoma e so uma frase -- e e por isso que ele importa: a tela fica
  // PLAUSIVEL, nenhum numero muda, e a pessoa le "baixaram minha parcela". Essa
  // e a variante de produto que Helio REJEITOU no cartao `ae436b4a` (manter o
  // numero de parcelas e baixar o valor de cada uma), e ela nao existe no
  // codigo: a frase e o unico lugar da tela onde se le qual das duas features
  // foi construida.
  //
  // A issue aponta `scripts/mutantes-leituras-do-mybank.mjs` para ele. Ele esta
  // AQUI porque a suite daquele runner (`test:leituras-do-mybank`) nao tem
  // assercao nenhuma sobre esta frase -- plantado lá ele sobreviveria, e o
  // placar diria "a suite nao mede isso" sobre uma frase que ESTA medida. O
  // mutante vive onde a assercao que o mata vive
  // (`mesmo-alvo-nao-prova-coberto-compare-as-ancoras`).
  [
    LIB,
    "A PREVIA OMITE QUE O VALOR DAS QUE SOBRAM NAO MUDA (a tela fica plausivel e a pessoa le `baixaram minha parcela` -- a variante REJEITADA no cartao ae436b4a)",
    "    `${params.ultimoVencimentoDepois}. As parcelas que sobram continuam com o valor de sempre: ` +\n    \"antecipar encurta a série e não baixa a prestação.\"",
    "    `${params.ultimoVencimentoDepois}.`",
  ],

  [
    LIB,
    "a previa perde o ULTIMO VENCIMENTO e fica so com a promessa (a serie `encurtar` deixa de ter numero na tela, e o gesto se le como `pagar adiantado`)",
    "    `${comecoDaPrevia} O último vencimento é ${params.ultimoVencimentoAntes} e passa a ser ` +\n    `${params.ultimoVencimentoDepois}. As parcelas que sobram continuam",
    "    `${comecoDaPrevia} As parcelas que sobram continuam",
  ],

  [
    LIB,
    "a previa que QUITA mantem a promessa sobre as que sobram (quem acabou de quitar le uma garantia de cobranca futura que nao existe)",
    "  if (params.ultimoVencimentoDepois === null) {\n    return (\n      `${comecoDaPrevia} Não sobra nenhuma parcela em aberto: o empréstimo fica quitado ` +\n      \"e sai da lista A receber.\"\n    );\n  }",
    "  if (false) {\n    return \"\";\n  }",
  ],

  [
    LIB,
    "`parcelaFoiAntecipada` aceita o pagamento NO DIA (`<` vira `<=`: toda parcela paga pontualmente se rotula como antecipada, e o rotulo perde o sentido onde ele serve)",
    "  return pago < vence;",
    "  return pago <= vence;",
  ],

  [
    LIB,
    "`parcelaFoiAntecipada` perde a guarda do vazio (a parcela PENDENTE vira antecipada: `\"\"` e menor que qualquer data)",
    '  if (pago === "" || vence === "") return false;',
    "  if (false) return false;",
  ],

  [
    LIB,
    "`parcelaFoiAntecipada` compara as datas pela ORDEM INVERSA (a parcela paga EM ATRASO vira antecipada, e a antecipada perde o rotulo -- os dois sentidos errados de uma vez)",
    "  return pago < vence;",
    "  return pago > vence;",
  ],

  // =========================================================================
  // O STATUS NA RESPOSTA DO GET -- HMO-398
  // =========================================================================
  // Esta rota e a UNICA das quatro leituras do MyBank que nao filtra `active`, e
  // e por isso que ela e a unica que pode mostrar o registro de uma divida
  // honrada. O mutante e o conserto que PARECE certo -- "deixar igual as outras
  // tres" --, e ele esvaziaria a secao dos encerrados do painel SEM MUDAR NUMERO
  // NENHUM: os totais e o "A receber" ja ignoravam o quitado.

  [
    LOANS,
    "O GET DA LISTA PASSA A FILTRAR `active` (a secao dos encerrados do painel esvazia, e nenhum numero da tela muda)",
    '      .eq("lender_user_id", user.id)',
    '      .eq("lender_user_id", user.id)\n      .eq("status", "active")',
  ],

  [
    LOANS,
    "o `status` sai do `select` do GET (a tela perde o campo que separa os em andamento dos encerrados)",
    '        "id, lender_account_id, borrower_user_id, description, principal, installment_count, first_due_date, status, created_at"',
    '        "id, lender_account_id, borrower_user_id, description, principal, installment_count, first_due_date, created_at"',
  ],

  // =========================================================================
  // O AJUSTE DO EMPRESTIMO ATIVO -- a F4 da HMO-444 (issue HMO-447)
  // =========================================================================
  // OS DOIS QUE A ISSUE NOMEIA SAO OS DOIS PRIMEIROS DESTE BLOCO.
  //
  // O primeiro -- `O AJUSTE REESCREVE TODAS AS PARCELAS` -- e a classe de
  // defeito que esta filha existe para impedir, e ele nao da erro em lugar
  // nenhum: a RLS aceita (o credor manda na parcela dele), a trigger do devedor
  // devolve NEW sem perguntar nada, e `CHECK (amount > 0)` passa. O que
  // acontece e que a parcela JA PAGA de R$ 1.000 passa a dizer R$ 1.200 e a
  // perna de R$ 1.000 que a pagou continua no extrato -- a divida discordando
  // de um lancamento REALIZADO, sem sintoma nenhum. Ele morre na assercao sobre
  // a linha `paid` NA TABELA, que e o controle negativo da PARTE 8.
  //
  // O segundo -- `A PREVISAO JA BAIXADA DEIXA DE PARAR O AJUSTE` -- e o risco
  // de dinheiro que a issue descreve: a parcela `pending` cuja conta a pagar ja
  // foi baixada. O estado da PARCELA nao avisa nada, e o filtro
  // `.eq("status","pending")` -- que o cancelamento e a antecipacao usam, e com
  // razao -- esconde exatamente a linha que tem de recusar o pedido.
  [
    LIB,
    "O AJUSTE REESCREVE TODAS AS PARCELAS (a `paid` de R$ 1.000 passa a dizer R$ 1.200 e a perna dela fica no extrato)",
    "  const porId = new Map(\n    pendentesDaSerie(parcelas).map((p) => [p.id, p])\n  );",
    "  const porId = new Map(\n    parcelas.map((p) => [p.id, p])\n  );",
  ],
  [
    AJUSTA,
    "A PREVISAO JA BAIXADA DEIXA DE PARAR O AJUSTE (o filtro de status esconde o lancamento ja realizado)",
    "        .eq(\"user_id\", user.id)\n        .in(\"notes\", chavesDoAjuste);",
    "        .eq(\"user_id\", user.id)\n        .eq(\"status\", \"pending\")\n        .in(\"notes\", chavesDoAjuste);",
  ],
  [
    AJUSTA,
    "a previsao baixada e LIDA e a recusa nao acontece (o 409 cai e o ajuste segue por cima do realizado)",
    "      if (comPrevisaoBaixada.length > 0) {",
    "      if (false) {",
  ],
  [
    LIB,
    "a pergunta da previsao vira `=== paid` (a previsao `skipped` volta a agenda com valor novo)",
    "    if (previsao.status !== STATUS_PENDENTE_DA_PARCELA) {",
    "    if (previsao.status === \"paid\") {",
  ],

  // -------------------------------------------------------------------------
  // A RECUSA DO AVISO PENDENTE
  // -------------------------------------------------------------------------
  [
    LIB,
    "a parcela `reported` deixa de barrar o ajuste (o valor muda embaixo de quem acabou de avisar que pagou)",
    "  if (avisadasDaSerie(parcelas).length > 0) return \"tem_parcela_reportada\";",
    "  if (false) return \"tem_parcela_reportada\";",
  ],
  [
    LIB,
    "`reported` passa a contar como recebido (o aviso vira pagamento e a cauda e repartida errado)",
    "    .filter((p) => p.status === STATUS_PAGO_DA_PARCELA)",
    "    .filter((p) => p.status !== STATUS_PENDENTE_DA_PARCELA)",
  ],

  // -------------------------------------------------------------------------
  // A ARITMETICA DA CAUDA
  // -------------------------------------------------------------------------
  [
    AJUSTA,
    "a cauda e repartida pelo TOTAL e nao pelo que FALTA (quem ja pagou 1 de 4 passa a dever o emprestimo inteiro)",
    "            faltaReceber: mexeNoTotal\n              ? Number(pedido.total) - jaRecebido",
    "            faltaReceber: mexeNoTotal\n              ? Number(pedido.total)",
  ],
  [
    LIB,
    "a cauda e numerada pela SERIE e nao pela POSICAO (a divida encolhe para uma fracao do que era)",
    "    parcelaAtual: 1,\n    totalDeParcelas: pendentes.length,",
    "    parcelaAtual: pendentes[0].installment_number,\n    totalDeParcelas: pendentes.length,",
  ],
  [
    LIB,
    "a sobra nao-positiva da ultima parcela deixa de ser conferida (duas gravadas, a terceira em 23514)",
    "  if (cauda.some((p) => !(p.amount > 0))) return null;",
    "  if (false) return null;",
  ],
  [
    LIB,
    "o vencimento vem da serie mesmo sem ter sido pedido (as contas a pagar da cauda mudam de mes sem pedido)",
    "    due_date:\n      primeiroVencimentoDaCauda === null\n        ? String(parcela.due_date)\n        : serie.parcelas[posicao].vencimento,",
    "    due_date: serie.parcelas[posicao].vencimento,",
  ],
  [
    LIB,
    "o total que IGUALA o ja recebido passa (sobra R$ 0,00 para a cauda e `amount > 0` recusa cada uma)",
    "    if (total <= jaRecebido) return \"total_menor_que_o_pago\";",
    "    if (total < jaRecebido) return \"total_menor_que_o_pago\";",
  ],
  [
    LIB,
    "o `installment_total` do rotulo vira o tamanho da cauda (a cobranca diz `1/3` de uma parcela `2/4`)",
    "          atual.installment_total\n        ),",
    "          pendentesDaSerie(parcelas).length\n        ),",
  ],

  // -------------------------------------------------------------------------
  // O QUE A ROTA NAO PODE ESCREVER, E A ORDEM
  // -------------------------------------------------------------------------
  [
    AJUSTA,
    "o patch da previsao BAIXA a conta a pagar (a cobranca sai da tela sem perna nenhuma ter sido gravada)",
    "            .update(linha.cobranca)",
    "            .update({ ...linha.cobranca, status: \"paid\" })",
  ],
  [
    AJUSTA,
    "o `status = pending` sai do UPDATE da previsao (a baixa feita em outra aba e reescrita)",
    "            .eq(\"status\", \"pending\")\n            .select(\"id\");",
    "            .select(\"id\");",
  ],
  [
    AJUSTA,
    "a guarda do `.length` das chaves cai: o `.in` vazio alcanca a agenda INTEIRA de Contas a Pagar",
    "    if (chavesDoAjuste.length > 0) {",
    "    if (true) {",
  ],
  [
    AJUSTA,
    "o EMPRESTIMO e gravado numa passagem que PAROU (a linha afirma um total que nenhuma parcela sustenta)",
    "    if (!parouPor && ajuste.patchDoEmprestimo) {",
    "    if (ajuste.patchDoEmprestimo) {",
  ],
  [
    AJUSTA,
    "o UPDATE da parcela filtrado pela RLS responde SUCESSO (zero linha, e a resposta diz `ajustei`)",
    "        if (erroDaParcela || !escritas || escritas.length === 0) {",
    "        if (erroDaParcela) {",
  ],
  [
    AJUSTA,
    "a parcela e contada DEPOIS da cobranca (a resposta diz `nada ajustado` sobre uma divida ja reescrita)",
    "        ajustadas.push({ id: linha.id, numero: linha.numero });\n      }\n",
    "      }\n",
  ],
  [
    AJUSTA,
    "a linha devolvida pelo UPDATE do emprestimo nao e conferida (`ajustei` sobre linha de outro credor)",
    "        atualizados.every((l) => l.lender_user_id === user.id);",
    "        atualizados.length > 0;",
  ],
  [
    AJUSTA,
    "`settled` passa a ser declaravel pela rota (emprestimo com parcelas em aberto sai das duas telas)",
    "  if (status !== undefined && status !== STATUS_CANCELADO) {",
    "  if (false) {",
  ],
  // O DESPACHO TEM UM MUTANTE E NAO DOIS, E O QUE SAIU DAQUI ERA EQUIVALENTE
  // ------------------------------------------------------------------------
  // `if (status !== undefined)` no lugar do `===` parece o mutante obvio desta
  // linha -- "qualquer corpo com `status` cancela" --, e ele e IMATAVEL: a
  // peneira de cima (o mutante anterior) ja devolveu 400 para todo `status` que
  // nao e `cancelled`, entao quando a execucao chega aqui `status` so pode ser
  // `undefined` ou `cancelled` -- e nesses dois os dois testes dao a MESMA
  // resposta. Ele sobrevivia a suite inteira sem apontar lacuna nenhuma
  // (`exemplo-canonico-do-criterio-e-barrado-por-outra-guarda`), e sobrevivente
  // permanente no placar e pior do que mutante nenhum: ele ensina quem le
  // "sobreviventes: 1" a nao ir ver.
  //
  // O QUE FICA NO LUGAR mede a MESMA linha pelo lado que a peneira nao barra:
  // com `!==`, o pedido de AJUSTE (que chega sem `status`) cai em `cancelar` --
  // corrigir um typo na descricao cancelaria o emprestimo e a cauda inteira,
  // que e o defeito mais caro que este `if` pode ter.
  [
    AJUSTA,
    "o despacho manda o AJUSTE para o cancelamento (corrigir a descricao cancela a divida)",
    "  if (status === STATUS_CANCELADO) {",
    "  if (status !== STATUS_CANCELADO) {",
  ],

  // -------------------------------------------------------------------------
  // AS RECUSAS DE CORPO, E A PENDENTE QUE NAO PODE SAIR DA LISTA
  // -------------------------------------------------------------------------
  [
    LIB,
    "o corpo vazio passa a ser um ajuste de sucesso (a tela diz `ajustado` sem ter ajustado nada)",
    "    return \"nada_a_ajustar\";",
    "    return null;",
  ],
  [
    LIB,
    "a descricao em branco passa a manter a antiga (o campo apagado na tela volta preenchido)",
    "      return \"descricao_vazia\";",
    "      return null;",
  ],
  [
    LIB,
    "a trava de juro zero da 053 deixa de ser perguntada (23514 DEPOIS de a cauda ja ter sido reescrita)",
    "  if (mexeNaTaxa && Number(pedido.taxa) !== JUROS_DA_FASE_1) {",
    "  if (false) {",
  ],
  [
    LIB,
    "o elo do ajuste casa por `includes` (a cobranca de OUTRA parcela recebe o valor desta)",
    "    const previsao = params.previsoes.find((p) => p.notes === chave);\n\n    if (!previsao) {",
    "    const previsao = params.previsoes.find((p) =>\n      String(p.notes ?? \"\").includes(chave)\n    );\n\n    if (!previsao) {",
  ],
  [
    LIB,
    "a pendente de patch vazio sai da lista (a passagem que parou no meio deixa a cobranca errada para sempre)",
    "    linhas.push({\n      id: nova.id,",
    "    if (Object.keys(patch).length === 0) continue;\n\n    linhas.push({\n      id: nova.id,",
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
