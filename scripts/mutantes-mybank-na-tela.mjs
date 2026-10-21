#!/usr/bin/env node
// Prova de mutacao da TELA do MyBank -- HMO-371 (F3 da HMO-368).
//
//   node scripts/mutantes-mybank-na-tela.mjs
//
// Cada entrada estraga UMA decisao; `npm run test:mybank-na-tela` tem de ficar
// VERMELHA em todas. Mutante que sobrevive e um trecho que nenhuma assercao
// distingue.
//
// OS DOIS QUE A ISSUE NOMEIA SAO OS DOIS PRIMEIROS DA LISTA
// ---------------------------------------------------------
// `O SELETOR LISTA CONTA CORRENTE` e `A LINHA PERDE O "QUEM DEVE PAGAR"` sao os
// mutantes que a HMO-371 pede por nome, e se qualquer um dos dois sobrevive
// nenhum outro compensa -- a sonda nao estaria medindo a feature.
//
// POR QUE ESTES DOIS, E POR QUE ELES NAO DAO ERRO EM LUGAR NENHUM
// ---------------------------------------------------------------
// O primeiro: a rota recusa conta corrente (`conta_credora_nao_e_investimento`)
// e a trigger da 053 recusa depois dela. O defeito, portanto, nao e dinheiro
// errado -- e um formulario que OFERECE uma opcao que sempre falha. Nada
// compila errado, nada responde 500: a pessoa escolhe a conta corrente, aperta
// e leva uma recusa que nao sabia que ia levar. So contar as `<option>` do DOM
// mede isso.
//
// O segundo: a issue nomeia TRES campos na linha de "A receber" (valor, `n de
// m`, quem deve pagar) e os tres existem no corpo que a rota devolve. Uma linha
// que imprime dois deles fica com APARENCIA PERFEITA -- e um emprestimo para a
// Lais e um auto-emprestimo ficam indistinguiveis na mesma lista. E por isso
// que a assercao e sobre a ancora `data-quem-deve`, e nao sobre o texto da
// linha: "Você mesmo" e o nome da conexao aparecem em outros lugares da tela.
//
// A FORMA DA LISTA E A DA FAMILIA TUPLA DE ARIDADE 4
// -------------------------------------------------
// `scripts/mede-ancora-ambigua.mjs` -- a guarda que reprova ancora morta,
// ambigua ou de arquivo inexistente em TODO runner do repo -- le a lista de
// verdade em vez de a copiar, e so sabe ler duas formas. Dai a ordem
// `[alvo, rotulo, de, para]` e o `original` montado DEPOIS da lista. As ancoras
// sao strings de uma linha com `\n` escapado, nunca template literal.
//
// NENHUM MUTANTE AQUI MORRE NO `tsc`
// ----------------------------------
// A suite compila a arvore mutada antes de rodar, entao um mutante que nao
// compile aparece como MORTO sem ter medido assercao nenhuma -- o
// `mutante-de-retrocesso-morre-no-tsc`. Por isso as mutacoes de JSX trocam o
// CONTEUDO (`{linha.quemDevePagar}` -> `{""}`) em vez de apagar o elemento, e
// as de predicado trocam o operador em vez de remover o parametro.
import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const LIB = "lib/mybank-na-tela.ts";
const PAINEL = "components/mybank/PainelDoMyBank.tsx";
const DEVEDOR = "components/mybank/ParcelasDoMyBankQueEuDevo.tsx";

/** [alvo, rotulo, de, para] */
const mutantes = [
  // =========================================================================
  // OS DOIS QUE A ISSUE NOMEIA
  // =========================================================================

  [
    LIB,
    "O SELETOR LISTA CONTA CORRENTE (o filtro de investimento cai)",
    "      conta.account_type === TIPO_DA_CONTA_CREDORA && conta.is_active !== false",
    "      conta.is_active !== false",
  ],

  [
    PAINEL,
    'A LINHA DE "A RECEBER" PERDE O "QUEM DEVE PAGAR"',
    "<span data-quem-deve>{linha.quemDevePagar}</span>",
    '<span data-quem-deve>{""}</span>',
  ],

  // =========================================================================
  // O CABECALHO
  // =========================================================================

  [
    LIB,
    "a conta com is_active NULL desaparece do seletor (=== true)",
    "      conta.account_type === TIPO_DA_CONTA_CREDORA && conta.is_active !== false",
    "      conta.account_type === TIPO_DA_CONTA_CREDORA && conta.is_active === true",
  ],

  [
    LIB,
    "o rotulo da opcao perde o TIPO da conta",
    "  return `${conta.name} · ${porTipo(conta.account_type as never).rotulo}`;",
    "  return `${conta.name}`;",
  ],

  [
    LIB,
    "os totais somam TODAS as contas, nao a escolhida",
    "    (e) => e.status === \"active\" && (contaId === null || e.conta_credora_id === contaId)",
    "    (e) => e.status === \"active\"",
  ],

  [
    LIB,
    "o total a receber conta a parcela JA PAGA",
    "      if (!parcelaEmAberto(parcela)) continue;\n      aReceber += parcela.valor;",
    "      aReceber += parcela.valor;",
  ],

  [
    LIB,
    "o emprestimo QUITADO volta a contar no emprestado",
    "    (e) => e.status === \"active\" && (contaId === null || e.conta_credora_id === contaId)",
    "    (e) => (contaId === null || e.conta_credora_id === contaId)",
  ],

  [
    LIB,
    "o progresso n/m conta a parcela EM ABERTO como paga",
    "  const pagas = emprestimo.parcelas.filter((p) => p.status === \"paid\").length;",
    "  const pagas = emprestimo.parcelas.filter((p) => p.status === \"pending\").length;",
  ],

  // =========================================================================
  // "A RECEBER"
  // =========================================================================

  [
    LIB,
    'a parcela PAGA entra na lista de "A receber"',
    "      if (!parcelaEmAberto(parcela)) continue;\n\n      linhas.push({",
    "      linhas.push({",
  ],

  [
    LIB,
    "a ordem de A receber inverte (o vencimento mais longe primeiro)",
    "      : a.vencimento < b.vencimento",
    "      : a.vencimento > b.vencimento",
  ],

  [
    LIB,
    "o emprestimo CANCELADO aparece em A receber",
    '    if (emprestimo.status !== "active") continue;',
    "    if (false) continue;",
  ],

  // =========================================================================
  // A RECUSA DA CONEXAO NAO ACEITA
  // =========================================================================

  [
    LIB,
    "o seletor de devedor oferece a conexao PENDENTE",
    '    if (conexao.status !== "accepted") continue;',
    "    if (false) continue;",
  ],

  [
    LIB,
    "o lado da conexao sai do EMBED, e nao de requester_id",
    "    const souOPedinte = conexao.requester_id === meuId;",
    "    const souOPedinte = conexao.requester?.id === meuId;",
  ],

  [
    LIB,
    "devedor nao escolhido passa por conexao aceita",
    "  if (!devedorId) return false;",
    "  if (!devedorId) return true;",
  ],

  [
    PAINEL,
    'marcar "uma conexao" sem escolher a pessoa vira AUTO-emprestimo',
    '    devedorDoPedido === null\n      ? "conexao"',
    '    devedorDoPedido === null\n      ? "auto"',
  ],

  [
    PAINEL,
    "o Caso B manda a conta de pagamento (24 contas a pagar no meu nome)",
    '          conta_de_pagamento_id: quemPaga === "eu" ? contaDePagamentoId : null,',
    "          conta_de_pagamento_id: contaDePagamentoId,",
  ],

  [
    PAINEL,
    "o botao Emprestar ignora o problema e chama a rota de qualquer jeito",
    // A INDENTACAO E DE SEIS ESPACOS DESDE A HMO-390: o bloco passou para
    // DENTRO do `try` de `emprestar()`, para o `finally` liberar o latch
    // tambem no caminho do pedido incompleto. A ancora antiga (quatro espacos)
    // morreu com a mudanca -- familia `mutante-cuja-ancora-a-feature-apagou`.
    "      if (problema) {\n        setErro(mensagemDoProblema(problema));\n        return;\n      }",
    "      if (problema) {\n        setErro(mensagemDoProblema(problema));\n      }",
  ],

  [
    PAINEL,
    "o valor vai MULTIPLICADO pelo cliente, em vez de cru com a base",
    "          valor,\n          base,",
    '          valor: String(Number(valor) * numeroDeParcelas),\n          base: "total" as typeof base,',
  ],

  // =========================================================================
  // O LADO DO DEVEDOR
  // =========================================================================

  [
    LIB,
    "o selo imprime 'MyBank — null' quando o perfil do credor nao e legivel",
    "  if (!quemEmprestou) return SELO_DO_MYBANK;",
    "  if (false) return SELO_DO_MYBANK;",
  ],

  [
    LIB,
    "quem JA AVISOU ganha o botao de avisar de novo",
    '  return parcela.status === "pending";',
    "  return true;",
  ],

  [
    DEVEDOR,
    "o devedor marca a parcela como PAGA (quitada sem nada ter se movido)",
    '        body: JSON.stringify({ status: "reported" }),',
    '        body: JSON.stringify({ status: "paid" }),',
  ],

  [
    DEVEDOR,
    "o bloco do devedor le a rota de QUEM ME DEVE, e nao a view do devedor",
    '      const resposta = await fetch("/api/mybank/due");',
    '      const resposta = await fetch("/api/mybank/loans");',
  ],

  // =========================================================================
  // O ESCOPO DO BLOCO E O COLAPSO -- HMO-381
  // =========================================================================
  // A issue mediu dois escopos na mesma tela sem rotulo nenhum, e a escolha foi
  // a saida (2): o bloco fica FORA da janela da pagina e DIZ que fica. Os
  // mutantes abaixo cobrem as duas metades que a escolha obriga a entregar --
  // o escopo dito na tela e o colapso -- e o controle de cada uma.
  //
  // NENHUM DELES MOVE DINHEIRO, e e por isso que eles existem: estragar o
  // subtitulo ou o colapso deixa a tela com os mesmos numeros de antes. Nao ha
  // total para discordar, nao ha 500, nao ha tipo errado -- so os 3.000 pixels
  // de volta, ou uma frase que fala de um periodo que nao e o da lista logo
  // abaixo dela.

  [
    LIB,
    "o subtitulo nega a janela mas NAO diz de que periodo o bloco fala",
    "  return `Toda a dívida em aberto, ${quando}. ${FRASE_FORA_DA_JANELA}`;",
    "  return FRASE_FORA_DA_JANELA;",
  ],

  [
    LIB,
    "o periodo do subtitulo confia na ORDEM da rota, e nao ordena",
    "  const isos = parcelas.map((parcela) => String(parcela.vencimento)).sort();",
    "  const isos = parcelas.map((parcela) => String(parcela.vencimento));",
  ],

  [
    DEVEDOR,
    "a frase de escopo chega VAZIA a tela",
    "          {escopoDoBlocoDoDevedor(parcelas)}",
    '          {""}',
  ],

  [
    LIB,
    "fechado, o bloco devolve a lista INTEIRA (o colapso nao corta nada)",
    "    visiveis: parcelas.slice(0, PARCELAS_VISIVEIS_FECHADO),",
    "    visiveis: parcelas,",
  ],

  [
    DEVEDOR,
    "a lista imprime TODAS as parcelas, e nao as visiveis do bloco",
    "        {bloco.visiveis.map((parcela) => (",
    "        {parcelas.map((parcela) => (",
  ],

  [
    DEVEDOR,
    "o bloco nasce ABERTO (o conserto vale so para quem toca no botao)",
    "  const [aberto, setAberto] = useState(false);",
    "  const [aberto, setAberto] = useState(true);",
  ],

  [
    LIB,
    "o botao do colapso nao diz QUANTAS parcelas ficaram escondidas",
    "    rotuloDoBotao: `Mostrar as outras ${escondidas} ${palavra}`,",
    "    rotuloDoBotao: `Mostrar as outras ${palavra}`,",
  ],

  [
    LIB,
    "o numero do botao conta a lista toda, e nao o que ficou escondido",
    "  const escondidas = parcelas.length - PARCELAS_VISIVEIS_FECHADO;",
    "  const escondidas = parcelas.length;",
  ],

  [
    LIB,
    "aberto, o botao DESAPARECE e nao ha caminho de volta",
    '      rotuloDoBotao: "Mostrar menos",',
    "      rotuloDoBotao: null,",
  ],

  [
    LIB,
    "a lista que CABE inteira tambem ganha botao de colapso",
    "  const cabe = parcelas.length <= PARCELAS_VISIVEIS_FECHADO;",
    "  const cabe = false;",
  ],

  // =========================================================================
  // A TRAVA DO SEGUNDO CLIQUE (HMO-390, F1 da HMO-383)
  // =========================================================================
  // O `disabled={salvando}` do botao JA EXISTIA antes desta issue, e e por isso
  // que estes mutantes importam: com o latch estragado a tela fica com a MESMA
  // aparencia -- o botao escurece, o texto vira "Emprestando...", nada reclama
  // --, e o que muda e que o toque duplo cria DUAS dividas de 24 meses.
  //
  // O primeiro e o que a issue nomeia: o latch volta a depender de render.

  [
    PAINEL,
    "O LATCH VOLTA A DEPENDER DE RENDER (le o useState em vez do useRef, e o toque duplo cria DUAS dividas)",
    "    if (emprestandoRef.current) return;",
    "    if (salvando) return;",
  ],

  [
    PAINEL,
    "o latch nao e ARMADO (o ref e lido e nunca gravado)",
    "    emprestandoRef.current = true;\n",
    "",
  ],

  [
    PAINEL,
    "o pedido NAO e esquecido no sucesso (o proximo emprestimo igual volta 200 sem gravar)",
    // A ANCORA LEVA O `try {` DA LINHA DE CIMA, e isso e obrigatorio.
    //
    // Ha DOIS `removeItem(CHAVE_DO_PEDIDO)` no arquivo: este (sucesso, oito
    // espacos) e o do ramo do 409 (doze). A indentacao nao os separa -- o
    // trecho de oito espacos e SUBSTRING da linha de doze, porque doze espacos
    // comecam com oito. A ancora curta casava nos dois e
    // `check-ancora-de-mutante` reprovava com "ancora AMBIGUA (2x)". Familia
    // `guard-de-includes-casa-dentro-de-identificador-maior`.
    "      try {\n        sessionStorage.removeItem(CHAVE_DO_PEDIDO);",
    "      try {\n        void CHAVE_DO_PEDIDO;",
  ],

  [
    PAINEL,
    "o 409 NAO esquece o pedido (o `tente de novo` manda o mesmo id e colide para sempre)",
    "        if (resposta.status === 409) {",
    "        if (resposta.status === 410) {",
  ],

  [
    PAINEL,
    "o POST sai SEM a chave do pedido (o reenvio depois do F5 cria a segunda divida)",
    "          id: pedido.id,\n",
    "",
  ],

  [
    PAINEL,
    "A TRAVA DA PARCELA VIRA BOOLEANO GLOBAL (confirmar a 3 impede de confirmar a 4)",
    "    if (parcelasEmVooRef.current.has(parcelaId)) return;",
    "    if (parcelasEmVooRef.current.size > 0) return;",
  ],

  [
    PAINEL,
    "a parcela nunca SAI do conjunto (a baixa que falhou nao tem segunda tentativa)",
    "      parcelasEmVooRef.current.delete(parcelaId);",
    "      void parcelaId;",
  ],

  [
    PAINEL,
    "a confirmacao perde a trava por completo (dois toques dao duas baixas na MESMA parcela)",
    "    if (parcelasEmVooRef.current.has(parcelaId)) return;\n    parcelasEmVooRef.current.add(parcelaId);",
    "    parcelasEmVooRef.current.add(parcelaId);",
  ],

  // =========================================================================
  // O BOTAO «Cancelar» (HMO-391, F3 da HMO-383)
  // =========================================================================
  // Os tres sao sobre uma acao DESTRUTIVA que muda a tela de outra pessoa, e
  // nenhum deles da erro em lugar nenhum quando acontece.

  [
    PAINEL,
    "O BOTAO CANCELAR APARECE EM EMPRESTIMO JA ENCERRADO (clique cujo unico resultado possivel e um erro)",
    '                        {emprestimo.status === "active" && (',
    '                        {emprestimo.status !== "nunca-este-status" && (',
  ],

  [
    PAINEL,
    "A PERGUNTA DEIXA DE DECIDIR (o `confirm()` acontece e a resposta e ignorada: cancelar nao cancela)",
    "    if (\n      !confirm(",
    "    if (\n      !!confirm(",
  ],

  [
    PAINEL,
    "o cancelamento perde a trava (dois toques dao duas perguntas e dois PATCH na MESMA divida)",
    "    if (cancelandoRef.current.has(emprestimo.id)) return;",
    "    if (false) return;",
  ],

  [
    PAINEL,
    "a trava do cancelamento vira BOOLEANO GLOBAL (cancelar uma divida errada tranca a outra)",
    "    if (cancelandoRef.current.has(emprestimo.id)) return;",
    "    if (cancelandoRef.current.size > 0) return;",
  ],

  [
    PAINEL,
    "o emprestimo nunca SAI do conjunto (o cancelamento que falhou nao tem segunda tentativa)",
    "      cancelandoRef.current.delete(emprestimo.id);",
    "      void emprestimo.id;",
  ],

  // =========================================================================
  // O GESTO DE ANTECIPAR (F4 da HMO-393, issue HMO-397)
  // =========================================================================
  // O PRIMEIRO E O MAIS CARO DOS DOZE DESTE ARQUIVO, e vale dizer por que: ele
  // nao muda numero nenhum na tela. `podeAntecipar` copiada do Cancelar oferece
  // o gesto num emprestimo `active` sem nada em aberto -- e a rota so pode
  // responder `mais_do_que_em_aberto` ali. Nada compila errado, nada responde
  // 500: a pessoa aperta e leva uma recusa que nao sabia que ia levar, no mesmo
  // lugar onde o gesto irmao funciona. Os emprestimos que quitaram ANTES da
  // HMO-394 seguem `active` com a serie paga, entao esse estado existe de
  // verdade na base.
  [
    LIB,
    "O GESTO DE ANTECIPAR APARECE ONDE O CANCELAR APARECE (`podeAntecipar` perde a exigencia de parcela em aberto: o emprestimo `active` com a serie toda paga oferece um clique que a rota so pode recusar)",
    "    emprestimo.status === \"active\" && quantasEmAbertoNoEmprestimo(emprestimo) > 0",
    '    emprestimo.status === "active"',
  ],

  [
    LIB,
    "o gesto aparece em emprestimo QUITADO (`podeAntecipar` perde o status: a rota recusa com `emprestimo_nao_esta_ativo`, e a tela oferece de todo jeito)",
    "    emprestimo.status === \"active\" && quantasEmAbertoNoEmprestimo(emprestimo) > 0",
    "    quantasEmAbertoNoEmprestimo(emprestimo) > 0",
  ],

  [
    LIB,
    "a previa calcula o ultimo vencimento sobre a serie INTEIRA (o dialogo diz que a serie acaba no mesmo mes de antes: `encurtar a serie` deixa de ser o que a tela promete)",
    "    ultimoVencimentoDepois: ultimoVencimentoEmAberto(\n      todas.filter((p) => !ids.has(p.id))\n    ),",
    "    ultimoVencimentoDepois: ultimoVencimentoEmAberto(todas),",
  ],

  [
    LIB,
    "a previa soma a serie INTEIRA e nao a cauda escolhida (o dialogo diz R$ 500,00 de uma antecipacao de R$ 100,00 -- o numero que a pessoa confere contra a conta)",
    "    valor: valorDaAntecipacao({ parcelasEscolhidas: escolhidas }),",
    "    valor: valorDaAntecipacao({ parcelasEscolhidas: todas }),",
  ],

  [
    LIB,
    "os numeros da previa saem na ordem da CAUDA (o dialogo diz `as 6 e 5`, e quem procura na lista le a serie de tras para frente)",
    "    numeros: escolhidas.map((p) => p.installment_number).sort((a, b) => a - b),",
    "    numeros: escolhidas.map((p) => p.installment_number),",
  ],

  [
    LIB,
    "o rotulo da parcela antecipada DESAPARECE (o `2/4` ao lado de `vence <parcela 3>` fica sem explicacao, e a leitura disponivel e `a contagem esta errada`)",
    "  if (numeros.length === 0) return null;",
    "  if (numeros.length >= 0) return null;",
  ],

  [
    LIB,
    "o rotulo de antecipada conta TODA parcela paga (a paga em dia entra, e o rotulo perde o sentido justamente onde ele serve)",
    "      parcelaFoiAntecipada({ paid_date: p.paid_date, due_date: p.vencimento })",
    '      p.status === "paid"',
  ],

  [
    LIB,
    "a traducao de vocabulario troca o VALOR pelo numero da parcela (a soma da previa sai de `numero` em vez de `valor`: R$ 6,00 numa antecipacao de R$ 600)",
    "    amount: parcela.valor,",
    "    amount: parcela.numero,",
  ],

  [
    LIB,
    "a traducao de vocabulario perde o `due_date` (a cauda passa a ser escolhida sobre uma data vazia, e `encurtar a serie` escolhe parcela pelo desempate)",
    "    due_date: parcela.vencimento,",
    '    due_date: "",',
  ],

  // O LATCH, E ELE E O MAIS CARO EM DINHEIRO: a rota de antecipacao NAO tem
  // idempotencia por id (a de emprestimo tem, desde a HMO-390), entao o segundo
  // POST paga a cauda outra vez -- duas pernas de entrada por parcela, o dobro
  // no extrato, e as parcelas seguintes da serie pagas sem ninguem ter pedido.
  [
    PAINEL,
    "A ANTECIPACAO PERDE A TRAVA (dois toques pagam a cauda DUAS vezes: a rota nao tem idempotencia por id, e sai o dobro no extrato)",
    "    if (antecipandoRef.current.has(emprestimo.id)) return;",
    "    if (false) return;",
  ],

  [
    PAINEL,
    "a trava da antecipacao vira BOOLEANO GLOBAL (antecipar numa divida tranca a outra, calada)",
    "    if (antecipandoRef.current.has(emprestimo.id)) return;",
    "    if (antecipandoRef.current.size > 0) return;",
  ],

  // A TROCA DO `useRef` PELO ESTADO, que e o mutante que so o caso lido DENTRO
  // de `unstable_batchedUpdates` mata: com o latch no estado, o `disabled` so
  // chega ao DOM depois do re-render e o toque duplo de celular passa os dois
  // cliques. Fora do `batchedUpdates` a tela teria exatamente a mesma aparencia
  // (`latch-de-dois-cliques-so-mede-dentro-de-batchedupdates`).
  [
    PAINEL,
    "a trava da antecipacao passa a ser o ESTADO (o `disabled` so chega ao DOM depois do re-render: o toque duplo de celular paga a cauda duas vezes)",
    "    if (antecipandoRef.current.has(emprestimo.id)) return;\n    antecipandoRef.current.add(emprestimo.id);",
    "    if (antecipacoesEmVoo.includes(emprestimo.id)) return;",
  ],

  [
    PAINEL,
    "o emprestimo nunca sai do conjunto da antecipacao (a antecipacao que falhou nao tem segunda tentativa, e o botao fica preso em `Antecipando…`)",
    "      antecipandoRef.current.delete(emprestimo.id);",
    "      void emprestimo.id;",
  ],

  [
    PAINEL,
    "o seletor oferece a serie INTEIRA e nao as em aberto (o dialogo deixa pedir 6 de uma serie com 5 em aberto, e a rota recusa com `mais_do_que_em_aberto`)",
    "                            {Array.from({ length: emAberto }, (_, i) => (",
    "                            {Array.from({ length: emprestimo.total_de_parcelas }, (_, i) => (",
  ],

  [
    PAINEL,
    "a previa fica presa em UMA parcela (trocar a quantidade muda o `<select>` e nao muda o valor nem o vencimento: a pessoa confirma 5 lendo o numero de 1)",
    "                        Number(quantasParaAntecipar)",
    "                        1",
  ],

  [
    PAINEL,
    "o dialogo FICA ABERTO depois do sucesso (o clique seguinte antecipa de novo sobre a serie que a tela acabou de recarregar)",
    "      setAntecipando(null);\n      await carregar();",
    "      await carregar();",
  ],

  [
    PAINEL,
    "o POST da antecipacao leva um VALOR em reais (o campo que a decisao (a) da secao 4 do plano tirou do contrato volta pela tela)",
    "        body: JSON.stringify({ parcelas: quantas }),",
    "        body: JSON.stringify({ parcelas: quantas, valor: 0 }),",
  ],

  // =========================================================================
  // O RECORTE DA LISTA -- HMO-398
  // =========================================================================
  // O PRIMEIRO E O QUE A ISSUE NOMEIA: "o recorte da lista passa a aceitar
  // qualquer status". Com ele a tela volta EXATAMENTE ao estado de producao que
  // abriu a issue -- o emprestimo quitado listado junto com os em andamento --
  // e NENHUM NUMERO MUDA: `totaisDaContaCredora`, `linhasAReceber` e
  // `mybank_due_entries` ja filtravam `active`, e foi essa concordancia dos
  // numeros que deixou o defeito passar pela HMO-394.
  //
  // O SEGUNDO E O MAIS IMPORTANTE: o recorte lendo as PARCELAS em vez do status.
  // E a implementacao que parece certa -- "encerrado e quem nao tem nada a
  // receber" -- e ela coincide com a certa em todo fixture onde `settled` e
  // "tudo pago" andam juntos. So o par do fixture da secao K a separa:
  // `l-k-pago` e `active` com 2/2 pagas (o emprestimo LEGADO, que quitou antes
  // da HMO-394 e por isso ainda precisa do botao Cancelar) e `l-k-quitado` e
  // `settled` com 1/1. Este mutante esconde o legado e o deixa sem saida.

  [
    LIB,
    "O RECORTE DA LISTA ACEITA QUALQUER STATUS (o emprestimo quitado volta para a lista, e nenhum numero muda)",
    "  return emprestimo.status !== STATUS_EM_ANDAMENTO;",
    "  return false;",
  ],

  [
    LIB,
    "O RECORTE LE AS PARCELAS EM VEZ DO STATUS (o emprestimo `active` com a serie toda paga e escondido, e perde o botao Cancelar)",
    "  return emprestimo.status !== STATUS_EM_ANDAMENTO;",
    "  return !emprestimo.parcelas.some(parcelaEmAberto);",
  ],

  [
    LIB,
    "o recorte manda TODO emprestimo para os encerrados (o outro lado da comparacao: a secao em andamento fica vazia)",
    "  return emprestimo.status !== STATUS_EM_ANDAMENTO;",
    "  return true;",
  ],

  [
    LIB,
    "o resumo do card para de contar os ENCERRADOS (a secao fechada volta a ser indistinguivel de `nao tem mais nada`)",
    "  const resumo = `${emAndamento.length} em andamento · ${encerrados.length} ${palavra}`;",
    "  const resumo = `${emAndamento.length} em andamento`;",
  ],

  [
    LIB,
    'o rotulo do botao perde o NUMERO (vira um "Ver mais" que nao se distingue de "o resto nao existe")',
    "      : `Mostrar ${artigo} ${encerrados.length} ${palavra}`,",
    '      : "Mostrar os encerrados",',
  ],

  // O ARTIGO E O SUBSTANTIVO, cada um com o seu mutante: o fixture de producao
  // tem UM encerrado so, e foi ele que publicou "Mostrar os 1 encerrado".
  [
    LIB,
    'o artigo do rotulo nao concorda com o numero ("Mostrar os 1 encerrado", que foi o que a primeira versao publicou)',
    '  const artigo = umSo ? "o" : "os";',
    '  const artigo = "os";',
  ],

  [
    LIB,
    'o substantivo nao concorda com o numero ("1 encerrados" no resumo e no botao)',
    '  const palavra = umSo ? "encerrado" : "encerrados";',
    '  const palavra = "encerrados";',
  ],

  [
    LIB,
    "o rotulo de FECHAR deixa de concordar (o outro estado do botao, que o rotulo de abrir nao cobre)",
    "      ? `Esconder ${artigo} ${palavra}`",
    '      ? "Esconder os encerrados"',
  ],

  [
    LIB,
    "o botao aparece na conta SEM nenhum encerrado (um clique que revela uma lista vazia, dizendo que ha o que revelar)",
    "  if (encerrados.length === 0) {",
    "  if (false) {",
  ],

  [
    LIB,
    "a secao fechada ja mostra os encerrados (`visiveis` ignora o estado do botao)",
    "    visiveis: encerradosAbertos ? [...emAndamento, ...encerrados] : emAndamento,",
    "    visiveis: [...emAndamento, ...encerrados],",
  ],

  [
    PAINEL,
    "A LISTA VOLTA A IMPRIMIR `doEscolhido` (o recorte existe em `lib/` e a tela nao o usa -- o defeito exato da HMO-398)",
    "              {recorteDaLista.visiveis.map((emprestimo) => {",
    "              {doEscolhido.map((emprestimo) => {",
  ],

  [
    PAINEL,
    "a secao dos encerrados ABRE por padrao (a lista volta a acumular uma linha por divida encerrada, para sempre)",
    "  const [encerradosAbertos, setEncerradosAbertos] = useState(false);",
    "  const [encerradosAbertos, setEncerradosAbertos] = useState(true);",
  ],

  [
    PAINEL,
    "o botao dos encerrados so ABRE (quem toca uma vez fica sem caminho de volta)",
    "              onClick={() => setEncerradosAbertos((antes) => !antes)}",
    "              onClick={() => setEncerradosAbertos(true)}",
  ],

  [
    PAINEL,
    "a linha encerrada perde o MARCADOR (o quitado fica indistinguivel do em andamento dentro da lista aberta)",
    '                    data-encerrado={encerrado ? "sim" : undefined}',
    "                    data-encerrado={undefined}",
  ],

  [
    PAINEL,
    "o status da linha volta CRU do banco (a tela em portugues imprime `settled` e `cancelled`)",
    "                        {rotuloDoStatusDoEmprestimo(emprestimo)}",
    "                        {emprestimo.status}",
  ],

  // =========================================================================
  // O TERCEIRO NUMERO DO CABECALHO -- o juro a receber (HMO-450)
  // =========================================================================
  // O PRIMEIRO E O QUE A ISSUE NOMEIA, e ele e o unico desta secao que calcula
  // um numero PLAUSIVEL: `a receber - emprestado` e a conta que qualquer um
  // escreveria, ela tem a unidade certa, e ela so erra quando alguma parcela ja
  // foi paga. Num fixture com a serie toda em aberto os dois valores COINCIDEM
  // -- por isso o controle dele e a conta Tesouro, onde a parcela 1 esta `paid`
  // e a subtracao da -R$ 450 (juro negativo) contra os R$ 50 certos.
  //
  // Os outros erram para ZERO ou para o juro da serie INTEIRA, que sao os dois
  // jeitos de o terceiro numero existir na tela sem medir nada.

  [
    LIB,
    "O JURO A RECEBER VIRA `a receber - emprestado` (a conta que parece certa: coincide com a certa ate a primeira parcela paga, e depois dela da juro NEGATIVO)",
    "    jurosAReceber: jurosAReceber / 100,",
    "    jurosAReceber: aReceber - emprestado,",
  ],

  [
    LIB,
    "o juro conta a SERIE INTEIRA e nao so as parcelas em aberto (o cabecalho promete de novo o juro que ja foi recebido)",
    "    if (!parcelaEmAberto(serie[i])) continue;\n    juros += emCentavos(rateio[i].parteDosJuros);",
    "    juros += emCentavos(rateio[i].parteDosJuros);",
  ],

  [
    LIB,
    "o rateio recebe o TOTAL no lugar do principal (todo emprestimo vira juro zero, e a tela fica com um terceiro numero que nunca sai de R$ 0,00)",
    "    principal: emprestimo.principal,",
    "    principal: total,",
  ],

  [
    LIB,
    "o total da serie vira o PRINCIPAL (o juro some pelo outro lado: a serie deixa de ser o que volta)",
    "  const total = serie.reduce((soma, p) => soma + emCentavos(p.valor), 0) / 100;",
    "  const total = emprestimo.principal;",
  ],

  [
    PAINEL,
    "o terceiro numero mostra o A RECEBER (tres caixas, duas dizendo a mesma coisa -- e a de juros mentindo alto)",
    "                {formatCurrency(totais.jurosAReceber)}",
    "                {formatCurrency(totais.aReceber)}",
  ],

  [
    PAINEL,
    'o rotulo do terceiro numero repete "Total a receber" (o numero esta certo e o leitor nao tem como saber o que ele e -- que e o defeito que a issue existe para nao criar)',
    '              <p className="text-xs text-muted-foreground">Juros a receber</p>',
    '              <p className="text-xs text-muted-foreground">Total a receber</p>',
  ],
];

const SUITE = "test:mybank-na-tela";

const bloco = criarBlocoDeMutantes({
  suites: [SUITE],
  rotulo: "mybank-na-tela",
});

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela. Montado DEPOIS da lista -- ver A FORMA DA LISTA, no cabecalho.
const original = new Map();
for (const arquivo of new Set(mutantes.map(([alvo]) => alvo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO: a arvore limpa tem de passar. Sem ele, uma suite ja
// vermelha -- ou um Chromium que nao existe -- deixaria TODO mutante aparecendo
// como morto e o placar sairia cheio sem medir nada. Em sonda de navegador isso
// nao e hipotese: as quatro sondas irmas ficaram 100% vermelhas numa arvore
// intocada quando o Playwright da maquina subiu de versao.
const limpo = bloco.rodar("<arvore limpa>", {}, SUITE);
if (!limpo.verde) {
  console.error(
    "controle positivo REPROVOU: a suite ja esta vermelha sem mutante nenhum. " +
      "Todo mutante abaixo apareceria como MORTO sem medir nada.\n" +
      "Se for navegador, exporte CHROMIUM_BIN."
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
  // risco e concreto nestes tres arquivos -- os comentarios CITAM as proprias
  // ancoras (`is_active !== false` aparece na prosa que explica por que nao e
  // `=== true`), e uma ancora curta demais mutaria a explicacao e deixaria o
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
