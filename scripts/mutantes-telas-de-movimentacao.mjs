#!/usr/bin/env node
// Mutantes de lib/telas-de-movimentacao.ts -- HMO-246.
//
// POR QUE ISTO EXISTE
// -------------------
// `npm run test:telas-de-movimentacao` passa com 40 blocos verdes. Num modulo
// que soma errado, varias dessas assercoes continuam verdes por acaso: o
// exemplo da issue tem UMA conta no mes, e contas erradas devolvem o numero
// certo para uma linha so. Cada mutante abaixo desfaz UMA decisao do modulo; o
// teste tem que ficar vermelho em todos.
//
// OS MUTANTES QUE IMPORTAM (um por armadilha do cabecalho da lib)
// ---------------------------------------------------------------
//   `sem_abs`             -- previsto (+159,90) e realizado (-159,90) se
//                            CANCELAM e a tela de Despesas fecha o mes em
//                            R$ 0,00 com as duas despesas na lista ao lado.
//   `paga_entra`          -- a conta prevista com baixa conta junto com a
//                            transacao que ela gerou: R$ 319,80 de R$ 159,90.
//   `perna_de_entrada_entra` -- as duas pernas do Pix contam, e R$ 1.000 viram
//                            R$ 2.000 numa lista que mostra as duas.
//   `tipo_pelo_sinal`     -- a perna de saida da transferencia entra na tela de
//                            Despesas: todo Pix entre contas proprias passa a
//                            ser gasto do mes.
//   `previsto_sem_direction` -- receita prevista vira conta a pagar (a familia
//                            da 027).
//   `cartao_entra_no_realizado` -- a compra no cartao conta no Realizado E
//                            dentro da fatura que o Previsto soma: R$ 800 de
//                            uma compra de R$ 400 (HMO-260).
//   `fatura_paga_nao_entra` -- a fatura PAGA sai do Previsto e nao entra no
//                            Realizado: o mes em que se pagou R$ 1.290 de
//                            cartao fecha R$ 1.290 mais barato, nos tres
//                            numeros (HMO-264).
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao vive em memoria e e compilada de uma ARVORE TEMPORARIA. Mutar,
// rodar e restaurar no `finally` deixa a fonte mutada no disco quando o
// processo morre no meio -- e um `trap` que restaura por cima apaga trabalho
// nao salvo.
//
// OS IMPORTS DE @/ SAO O QUE COMPLICA O BUILD
// -------------------------------------------
// Este modulo importa `@/lib/movimentacoes` e `@/lib/destino-do-lancamento`.
// Compilar so o arquivo mutado com `tsc arquivo.ts` nao resolve `@/` e morre em
// erro de compilacao -- e um mutante que nao COMPILA "morre" por motivo errado,
// o que faz o placar mentir a favor. Por isso o runner monta a arvore
// temporaria com as copias das duas dependencias ao lado, escreve um tsconfig
// com `baseUrl`/`paths` e roda o mesmo resolve-aliases.mjs do npm script.
//
// COMO RODAR
//   npm run mutantes:telas-de-movimentacao

import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";

const FONTE = "lib/telas-de-movimentacao.ts";
// TODA dependencia `@/` da FONTE tem de estar aqui. A que falta nao produz um
// mutante sobrevivente: ela faz o CONTROLE POSITIVO abortar com erro de
// compilacao -- e se o controle positivo nao existisse, faria TODOS os mutantes
// "morrerem" e o placar sair 100% sem medir nada.
//
// `lib/chave-da-fatura.ts` entrou na HMO-285. Ele e um arquivo-FOLHA (nenhum
// import), e e exatamente por isso que a fonte pode importa-lo: `card-invoice`,
// onde aquela chave morava, arrastaria `transferencia` -> `lancamento` para
// dentro desta arvore.
const DEPENDENCIAS = [
  "lib/movimentacoes.ts",
  "lib/destino-do-lancamento.ts",
  "lib/chave-da-fatura.ts",
  // HMO-305: o elo da fatura. Ele importa SO o chave-da-fatura, que ja esta
  // acima -- se um dia ele deixar de ser folha, esta lista cresce junto ou
  // TODO mutante deixa de compilar e o placar vira 100% sem medir nada.
  "lib/elo-da-fatura.ts",
];
const SAIDA = ".tmp-telas-de-movimentacao";
const TESTE = "scripts/test-telas-de-movimentacao.mjs";

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  // --- armadilha 1: os dois lados tem sinal oposto -------------------------
  {
    nome: "sem_abs",
    porque:
      "previsto (+159,90) e realizado (-159,90) se cancelam e a tela de " +
      "Despesas fecha o mes em ZERO, com as duas despesas visiveis na lista",
    de: "  const quantia = Number.isFinite(bruto) ? Math.abs(bruto) : 0;",
    para: "  const quantia = Number.isFinite(bruto) ? bruto : 0;",
  },
  {
    nome: "cotacao_zero_apaga",
    porque:
      "exchange_rate = 0 multiplica a linha por zero: um boleto de R$ 1.200 " +
      "vale R$ 0,00 no total e continua aparecendo na lista",
    de: "  const cotacao = Number.isFinite(taxa) && taxa > 0 ? taxa : 1;",
    para: "  const cotacao = Number.isFinite(taxa) ? taxa : 1;",
  },

  // --- armadilha 2: a mesma conta contada duas vezes -----------------------
  {
    nome: "paga_entra",
    porque:
      "a conta prevista com baixa entra junto com a transacao que ela gerou -- " +
      "a internet de R$ 159,90 vira R$ 319,80 no mes em que foi paga",
    de: "  if (STATUS_QUE_SAI_DO_PREVISTO.has(String(crua.status))) return null;",
    para: "  if (false) return null;",
  },
  {
    nome: "paga_entra_por_allowlist",
    porque:
      "a lista de status trocada pela de lib/previsto-x-realizado.ts, que " +
      "mantem `paid` DENTRO -- certa para 'o que o periodo prometia', e o " +
      "dobro aqui, onde previsto e realizado somam no mesmo total",
    de: '  "paid",\n  "skipped",\n  "cancelled",',
    para: '  "skipped",\n  "cancelled",',
  },

  // --- armadilha 3: a transferencia tem duas pernas ------------------------
  {
    nome: "perna_de_entrada_entra",
    porque:
      "as duas pernas do Pix contam: R$ 1.000 viram R$ 2.000, e a lista mostra " +
      "as duas linhas com a mesma descricao e a mesma data",
    de: '    if (tipo === "transfer" && ehPernaDeEntrada(crua)) continue;',
    para: "    if (false) continue;",
  },
  {
    nome: "entrada_so_pelo_elo",
    porque:
      "transferencia de antes do 015 (ou cujo par perdeu o elo por " +
      "ON DELETE SET NULL) volta a ser contada duas vezes -- e o valor dobrado " +
      "e plausivel",
    de: "  return Number(crua.amount) > 0;",
    para: "  return false;",
  },
  {
    nome: "entrada_so_pelo_sinal",
    porque:
      "o elo deixa de valer e sobra o sinal: num CAMBIO a perna de saida " +
      "(-1.000 BRL) e a de entrada (+180 USD) nao se anulam, e a tela passa a " +
      "somar as duas",
    de: "  if (texto(crua.counterpart_transaction_id)) return true;",
    para: "  if (false) return true;",
  },
  {
    nome: "entrada_pelo_elo_sem_texto",
    porque:
      'counterpart_transaction_id: "" tratado como elo tira a perna de SAIDA, ' +
      "e a transferencia desaparece da tela que existe para mostra-la",
    de: "  if (texto(crua.counterpart_transaction_id)) return true;",
    para: "  if (crua.counterpart_transaction_id !== undefined) return true;",
  },
  {
    nome: "de_duplica_todo_tipo",
    porque:
      "a regra da transferencia aplicada a TODAS as telas: toda receita " +
      "(amount positivo) desaparece da tela de Receitas",
    de: '    if (tipo === "transfer" && ehPernaDeEntrada(crua)) continue;',
    para: "    if (ehPernaDeEntrada(crua)) continue;",
  },

  // --- armadilha 5: o gasto no cartao ja esta na fatura (HMO-260) ----------
  {
    nome: "cartao_entra_no_realizado",
    porque:
      "o defeito da HMO-260 inteiro de volta: a compra de R$ 400 no cartao " +
      "conta no Realizado E dentro da fatura que o Previsto soma, e o mes " +
      "fecha em R$ 800 com as duas linhas visiveis na lista ao lado",
    de: '    if (tipo === "expense" && ehGastoNoCartao(crua)) continue;',
    para: "    if (false) continue;",
  },
  {
    nome: "cartao_sai_de_toda_tela",
    porque:
      "a regra aplicada as tres telas: o estorno no cartao desaparece de " +
      "Receitas e a perna que quita a fatura desaparece de Transferencias -- " +
      "o cartao sai do app, e nao so da tela de Despesas",
    de: '    if (tipo === "expense" && ehGastoNoCartao(crua)) continue;',
    para: "    if (ehGastoNoCartao(crua)) continue;",
  },
  {
    nome: "sem_conta_e_cartao",
    porque:
      "a linha SEM conta passa a contar como cartao: a despesa de grupo (que " +
      "e gravada sem account_id) e toda linha cujo embed a RLS nao devolveu " +
      "saem do total, e um mes mais barato nao parece um erro",
    de: "  if (contaDaRealizada(crua)?.account_type !== TIPO_CARTAO) return false;",
    para: '  if (contaDaRealizada(crua)?.account_type === "checking") return false;',
  },
  {
    nome: "cartao_ignora_o_tipo_gravado",
    porque:
      "a compra no cartao com `transaction_type` NULO (que existe em producao) " +
      "sai da tela de Despesas sem estar na fatura, porque a view " +
      "`card_invoice_lines` filtra IN ('expense','income') pela coluna crua: o " +
      "valor sai do app, que e pior que conta-lo duas vezes",
    de: "  return TIPOS_QUE_ENTRAM_NA_FATURA.has(String(crua.transaction_type));",
    para: "  return true;",
  },
  {
    nome: "cartao_so_embed_objeto",
    porque:
      "o embed em ARRAY deixa de ser lido: `account_type` chega undefined em " +
      "TODA linha, nada casa com credit_card, o filtro para de filtrar e a " +
      "tela volta ao defeito desta issue -- sem erro, sem log, tsc verde",
    de: "  if (Array.isArray(bruto)) return bruto[0] ?? null;",
    para: "  if (false) return bruto[0] ?? null;",
  },
  {
    nome: "cartao_por_nome_do_tipo",
    porque:
      "`debit_card` passa a contar como cartao de credito: o gasto no debito " +
      "sai do Realizado sem ter fatura nenhuma que o contenha",
    de: 'export const TIPO_CARTAO = "credit_card";',
    para: 'export const TIPO_CARTAO = "debit_card";',
  },

  // --- armadilha 4: o sinal nao pode ser o criterio de tipo ----------------
  {
    nome: "tipo_pelo_sinal",
    porque:
      "a perna de saida da transferencia (-200, categoria de despesa) entra na " +
      "tela de Despesas: todo Pix entre contas proprias vira gasto do mes",
    de: "    if (classificarMovimentacao(crua) !== tipo) continue;",
    para:
      '    if ((Number(crua.amount) < 0 ? "expense" : "income") !== tipo) continue;',
  },
  {
    nome: "tipo_nao_filtra",
    porque:
      "'o sinal ja foi normalizado, o tipo nao importa' -- as tres telas " +
      "passam a mostrar as mesmas linhas e cada total soma o mes inteiro",
    de: "    if (classificarMovimentacao(crua) !== tipo) continue;",
    para: "    if (false) continue;",
  },
  {
    nome: "previsto_nao_filtra",
    porque:
      "a conta prevista entra em qualquer tela: o salario previsto de R$ 7.000 " +
      "aparece como despesa prevista do mes",
    de: "    if (linha && linha.tipo === tipo) linhas.push(linha);",
    para: "    if (linha) linhas.push(linha);",
  },
  {
    nome: "previsto_sem_direction",
    porque:
      "toda conta prevista vira despesa: confirmar o recebimento de uma " +
      "receita prevista cobraria R$ 7.000 do mes (a familia da 027)",
    de: "  const tela = telaDoTipo(crua.direction);\n  if (!tela) return null;",
    para: '  const tela = telaDoTipo(crua.direction) ?? telaDoTipo("expense");\n  if (!tela) return null;',
  },

  // --- o vencido ------------------------------------------------------------
  {
    nome: "vencido_por_todo_previsto",
    porque:
      "o cartao Previsto passa a anunciar o periodo INTEIRO como atrasado: " +
      "R$ 500 'ja venceram' num mes em que venceram R$ 400",
    de: '    if (linha.situacao !== "overdue") continue;',
    para: "    if (false) continue;",
  },
  // --- o total e as contagens ---------------------------------------------
  {
    nome: "total_e_so_realizado",
    porque:
      "o 'Total' volta a ser o cartao de Financas Pessoais: a conta que vence " +
      "dia 15 nao entra em total nenhum do mes, que e o defeito da HMO-245",
    de: "    total: centavos(previsto + realizado),",
    para: "    total: centavos(realizado),",
  },
  {
    nome: "total_e_so_previsto",
    porque:
      "o 'Total' ignora o que ja aconteceu: no dia 30 do mes, com tudo pago, a " +
      "tela mostra Total R$ 0,00 e Realizado R$ 3.000",
    de: "    total: centavos(previsto + realizado),",
    para: "    total: centavos(previsto),",
  },
  {
    nome: "contagem_so_do_realizado",
    porque:
      "a contagem embaixo do Total ignora as previstas: 'Total R$ 3.090 · 2 " +
      "lançamento(s)' sobre uma lista de tres",
    de: "    quantidade: quantidadePrevista + quantidadeRealizada,",
    para: "    quantidade: quantidadeRealizada,",
  },

  // --- as duas secoes e a ordem -------------------------------------------
  {
    nome: "previstas_ao_contrario",
    porque:
      "a conta que vence dia 28 aparece acima da que vence dia 5 -- 'o que vem " +
      "agora' passa a mostrar o que vem por ultimo",
    de: "    previstas: previstas.sort((a, b) => a.data.localeCompare(b.data)),",
    para: "    previstas: previstas.sort((a, b) => b.data.localeCompare(a.data)),",
  },
  {
    nome: "realizadas_ao_contrario",
    porque:
      "o lancamento mais antigo do periodo aparece primeiro: quem acabou de " +
      "lancar nao encontra a propria linha",
    de: "    realizadas: realizadas.sort((a, b) => b.data.localeCompare(a.data)),",
    para: "    realizadas: realizadas.sort((a, b) => a.data.localeCompare(b.data)),",
  },
  {
    nome: "secoes_compartilham_array",
    porque:
      "as duas secoes passam a ordenar O MESMO array, em sentidos opostos: a " +
      "segunda desfaz a primeira e uma das duas listas sai ao contrario",
    de: "  const realizadas = linhas.filter((l) => l.origem === \"realizado\");",
    para: "  const realizadas = previstas;",
  },
  {
    nome: "ordem_por_date",
    porque:
      "`new Date('')` e NaN e um NaN no comparador EMBARALHA a lista inteira: " +
      "com uma linha sem data no meio, a de 20/10 cai abaixo da de 05/10",
    de: "  return linhas.sort((a, b) => b.data.localeCompare(a.data));",
    para:
      "  return linhas.sort(\n" +
      "    (a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()\n" +
      "  );",
  },

  // --- o embed do PostgREST sobre a view ----------------------------------
  {
    nome: "embed_so_objeto",
    porque:
      "o embed sobre VIEW chega como ARRAY e a leitura da `undefined` em TODA " +
      "linha: a categoria e a conta somem da lista inteira, sem erro nenhum",
    de: "  if (Array.isArray(valor)) return valor[0] ?? null;",
    para: "  if (false) return valor[0] ?? null;",
  },

  // --- a chave da linha ---------------------------------------------------
  {
    nome: "chave_sem_fatura",
    porque:
      "a fatura aberta do cartao (id: null) perde a chave e sai do previsto -- " +
      "em muitos meses ela e a MAIOR despesa prevista do periodo",
    de: "  const chave = idGravado ?? texto(crua.notes);",
    para: "  const chave = idGravado;",
  },
  {
    nome: "gravada_sempre",
    porque:
      "a fatura sintetizada se declara gravada: a tela oferece acao sobre ela " +
      "e o id vira `/api/scheduled-transactions/fatura:.../pay`",
    de: "    gravada: idGravado !== null,",
    para: "    gravada: true,",
  },

  // --- a natureza da linha: fatura, fixa ou comum (HMO-285) ---------------
  //
  // ESTES MUTANTES SAO OS MAIS FACEIS DE SOBREVIVER DE TODO O ARQUIVO, e a
  // razao e que `natureza` e `fatura` NAO ENTRAM EM SOMA NENHUMA. Os 40 blocos
  // de aritmetica da suite continuam verdes com a classificacao inteira
  // invertida: Total, Previsto e Realizado fecham no centavo, a lista tem as
  // mesmas linhas na mesma ordem, e so o rotulo de cada uma esta errado. Um
  // rotulo errado e pior que um rotulo ausente -- "Despesa" embaixo da fatura
  // tira dela o clique que leva ao cartao, e quem ve isso conclui que a fatura
  // nao esta na tela.
  {
    nome: "ordem_fixa_antes_de_fatura",
    porque:
      "a fatura que tambem tiver `recurring_rule_id` vira 'Fixa' e PERDE o " +
      "campo `fatura` -- o unico que leva de volta ao cartao e ao mes, que e o " +
      "ponto da issue. Nenhum total se mexe",
    de:
      "    natureza: daFatura\n" +
      '      ? "fatura"\n' +
      "      : texto(crua.recurring_rule_id)\n" +
      '        ? "fixa"\n' +
      '        : "despesa",',
    para:
      "    natureza: texto(crua.recurring_rule_id)\n" +
      '      ? "fixa"\n' +
      "      : daFatura\n" +
      '        ? "fatura"\n' +
      '        : "despesa",',
  },
  {
    nome: "previsto_sempre_comum",
    porque:
      "a fatura e a conta fixa deixam de ser reconhecidas: a tela volta a " +
      "chamar tudo de linha comum, que e o estado de antes da issue -- e o " +
      "Total continua fechando no centavo",
    de:
      "    natureza: daFatura\n" +
      '      ? "fatura"\n' +
      "      : texto(crua.recurring_rule_id)\n" +
      '        ? "fixa"\n' +
      '        : "despesa",',
    para: '    natureza: "despesa",',
  },
  {
    nome: "fatura_so_a_sintetizada",
    porque:
      "so a fatura ABERTA e reconhecida: a FECHADA (que e uma " +
      "scheduled_transaction com a mesma chave em `notes`) perde o rotulo e o " +
      "link justamente no mes em que ela e a linha que a pessoa vai pagar",
    de: "  const daFatura = faturaDaChave(crua.notes);",
    para: "  const daFatura = idGravado ? null : faturaDaChave(crua.notes);",
  },
  {
    nome: "fixa_por_presenca_do_campo",
    porque:
      "`recurring_rule_id` NULO lido como elo: o PostgREST devolve a coluna " +
      "como `null` em vez de omiti-la, entao TODA linha da view vira 'Fixa' -- " +
      "inclusive a previsao avulsa, que e a maioria",
    de: "      : texto(crua.recurring_rule_id)",
    para: "      : crua.recurring_rule_id !== undefined",
  },
  {
    nome: "fatura_sem_mes",
    porque:
      "o cartao certo e o mes vazio: o link da fatura passa a apontar para o " +
      "mes errado do cartao certo, que e um destino PLAUSIVEL -- o tipo " +
      "`{ accountId, mes }` existe para que esse estado nao seja alcancavel",
    de:
      "    fatura: daFatura\n" +
      "      ? { accountId: daFatura.accountId, mes: daFatura.mes }\n" +
      "      : null,",
    para:
      '    fatura: daFatura ? { accountId: daFatura.accountId, mes: "" } : null,',
  },
  // O `natureza` da realizada ganhou o galho da fatura na HMO-264, entao a
  // ancora destes dois mudou junto. Eles continuam medindo a MESMA decisao -- o
  // conjunto da terceira consulta e lido? ele distingue algo? --, e o que mudou
  // e so o texto. Deixa-los com a ancora velha nao os faria passar verde: o
  // runner reprova `ocorrencias === 0` como mutante invalido.
  {
    nome: "realizada_nunca_e_fixa",
    porque:
      "o conjunto da terceira consulta deixa de ser lido: a conta fixa que ja " +
      "foi paga aparece como lancamento comum, e a consulta extra fica paga " +
      "sem ninguem usar",
    de:
      "    natureza: faturaPaga\n" +
      '      ? "fatura"\n' +
      "      : idsDeFixa.has(crua.id)\n" +
      '        ? "fixa"\n' +
      '        : "despesa",',
    para: '    natureza: faturaPaga ? "fatura" : "despesa",',
  },
  {
    nome: "realizada_sempre_fixa",
    porque:
      "TODA linha realizada vira 'Fixa', inclusive o mercado lancado a mao -- " +
      "um rotulo que nao distingue nada se le como 'o app acha que tudo e fixo'",
    de:
      "    natureza: faturaPaga\n" +
      '      ? "fatura"\n' +
      "      : idsDeFixa.has(crua.id)\n" +
      '        ? "fixa"\n' +
      '        : "despesa",',
    para: '    natureza: "fixa",',
  },

  // --- armadilha 6: a fatura PAGA nao estava em lado nenhum (HMO-264) ------
  //
  // `realizada_virou_fatura` MORAVA AQUI, e foi substituido por
  // `fatura_paga_sem_peneira`. A ancora dele era `fatura: null,` literal em
  // `linhaRealizada` e o porque dele era "o pagamento da fatura e transferencia
  // de duas pernas e nao chega nesta tela" -- as duas coisas que esta issue
  // desfez. Mantido pelo texto ele viraria mutante invalido; reescrito com a
  // ancora nova e o porque velho, mediria uma afirmacao que o modulo nao faz
  // mais.
  {
    nome: "fatura_paga_nao_entra",
    porque:
      "o defeito da issue, inteiro: a fatura paga sai do Previsto por " +
      "`status: 'paid'` e nao entra no Realizado -- o mes em que se pagou " +
      "R$ 1.290 de cartao fecha R$ 1.290 mais barato, e um total MENOR nao " +
      "parece erro, parece um mes barato",
    de: '    if (tipo === "expense" && ehPagamentoDaFatura(crua)) {',
    para: "    if (false) {",
  },
  {
    nome: "fatura_paga_em_toda_tela",
    porque:
      "a excecao deixa de ser so da tela de Despesas: a chave canonica poe o " +
      "pagamento da fatura no total de RECEITAS do mes",
    de: '    if (tipo === "expense" && ehPagamentoDaFatura(crua)) {',
    para: "    if (ehPagamentoDaFatura(crua)) {",
  },
  {
    nome: "fatura_paga_sem_peneira",
    porque:
      "`linhaRealizada` passa a chamar de fatura TODA linha que carrega a " +
      "chave -- a perna de ENTRADA e a despesa comum nascida do elo da HMO-305 " +
      "incluidas. As duas perdem o Editar e o Excluir (`podeAgirNaLinha` recusa " +
      "toda linha de fatura) e ganham link para um cartao que nao e onde a " +
      "despesa aconteceu",
    de: "  const faturaPaga = ehPagamentoDaFatura(crua) ? faturaDaChave(crua.notes) : null;",
    para: "  const faturaPaga = faturaDaChave(crua.notes);",
  },
  {
    nome: "fatura_paga_sem_chave",
    porque:
      "a chave canonica deixa de ser o criterio: TODA perna de saida de " +
      "transferencia entra na tela de Despesas, e todo Pix entre contas " +
      "proprias volta a ser gasto do mes (a armadilha 4, por outro caminho)",
    de: "  if (!faturaDaChave(crua.notes)) return false;",
    para: "  if (false) return false;",
  },
  {
    nome: "fatura_paga_ignora_o_tipo_gravado",
    porque:
      "a despesa comum que nasceu do elo da fatura (HMO-305) passa a entrar " +
      "pelo ramo da fatura: ela NAO conta duas vezes (o ramo faz `continue`), " +
      "mas perde o Editar e o Excluir e se apresenta como fatura de um cartao. " +
      "E o ramo passa POR CIMA de `ehGastoNoCartao`, o que devolve o defeito da " +
      "HMO-260 para a linha de cartao que carregue a chave",
    de: "  if (String(crua.transaction_type) !== TIPO_DA_PERNA_DE_PAGAMENTO) return false;",
    para: "  if (false) return false;",
  },
  {
    nome: "fatura_paga_pega_as_duas_pernas",
    porque:
      "as duas pernas do pagamento entram: elas tem a MESMA chave, a mesma " +
      "data e o mesmo valor com sinais opostos, e `valorEmReais` passa " +
      "`Math.abs` -- entao nao da zero, da o DOBRO. R$ 2.580 de uma fatura de " +
      "R$ 1.290",
    // A ANCORA SAO AS DUAS LINHAS, e nao uma -- HMO-317. Com o sinal estrito ao
    // lado, `ehPernaDeEntrada` sozinho so decide um estado que o app nao
    // alcanca (chave + transfer + valor NEGATIVO + elo preenchido), entao um
    // mutante que apagasse SO ele sobreviveria, com razao. O cabecalho da funcao
    // diz isso; o que esta lista mede e o par removido junto.
    de:
      "  if (ehPernaDeEntrada(crua)) return false;\n" +
      "  return Number(crua.amount) < 0;",
    para: "  return true;",
  },
  {
    nome: "fatura_paga_de_valor_zero_entra",
    porque:
      "o sinal deixa de ser ESTRITO (HMO-317) e as DUAS pernas de um pagamento " +
      "de valor ZERO passam a ser a fatura paga: a tela de Despesas mostra duas " +
      "linhas «Fatura» de R$ 0,00, sem Editar e sem Excluir (`podeAgirNaLinha` " +
      "recusa toda linha de fatura), para um par que ja tem casa na tela de " +
      "Transferencias -- e e la que ele continua inteiro",
    de: "  return Number(crua.amount) < 0;",
    para: "  return true;",
  },
  {
    nome: "fatura_paga_e_transfer_em_despesas",
    porque:
      "a linha fica com `tipo: 'transfer'` na lista de Despesas. Nenhum total " +
      "muda HOJE -- e e por isso que ele importa: `tipo` e o campo que diz a " +
      "que tela a linha pertence, e o lado previsto ja peneira por ele " +
      "(`linha.tipo === tipo`). A fatura paga desapareceria de Despesas no dia " +
      "em que alguem repetisse aquela peneira do lado realizado",
    de:
      "    tipo:\n" +
      '      faturaPaga && tela === "expense"\n' +
      '        ? "expense"\n' +
      "        : classificarMovimentacao(crua),",
    para: "    tipo: classificarMovimentacao(crua),",
  },
  {
    nome: "fatura_paga_sempre_expense",
    porque:
      "o OUTRO lado da mesma igualdade: a perna passa a ser `expense` tambem " +
      "na tela de Transferencias, onde ela e um movimento entre duas contas " +
      "minhas. Variar so um dos dois lados deixaria a decisao por tela sem " +
      "medida",
    de:
      "    tipo:\n" +
      '      faturaPaga && tela === "expense"\n' +
      '        ? "expense"\n' +
      "        : classificarMovimentacao(crua),",
    para: '    tipo: faturaPaga ? "expense" : classificarMovimentacao(crua),',
  },
  {
    nome: "fatura_paga_nao_se_apresenta_como_fatura",
    porque:
      "a fatura paga entra no numero certo e sem o rotulo: ela perde o " +
      "«Fatura» e o caminho de volta para o cartao e o mes, e fica na lista de " +
      "Despesas como uma linha qualquer com a descricao da fatura -- que e " +
      "exatamente 'a transferencia reclassificada' que a issue recusa",
    de:
      "    natureza: faturaPaga\n" +
      '      ? "fatura"\n' +
      "      : idsDeFixa.has(crua.id)\n" +
      '        ? "fixa"\n' +
      '        : "despesa",',
    para: '    natureza: idsDeFixa.has(crua.id) ? "fixa" : "despesa",',
  },
  {
    nome: "fatura_paga_ordem_fixa_primeiro",
    porque:
      "FIXA antes de FATURA no realizado: a fatura paga cujo id caiu no " +
      "conjunto da terceira consulta se chama 'fixa' e perde o cartao e o mes " +
      "-- a unica coisa que `fatura` existe para dar",
    de:
      "    natureza: faturaPaga\n" +
      '      ? "fatura"\n' +
      "      : idsDeFixa.has(crua.id)\n" +
      '        ? "fixa"\n' +
      '        : "despesa",',
    para:
      "    natureza: idsDeFixa.has(crua.id)\n" +
      '      ? "fixa"\n' +
      "      : faturaPaga\n" +
      '        ? "fatura"\n' +
      '        : "despesa",',
  },
  {
    nome: "fatura_paga_sem_mes",
    porque:
      "o cartao certo e o mes vazio na linha REALIZADA: o link da fatura paga " +
      "aponta para o mes errado do cartao certo. O irmao deste mutante " +
      "(`fatura_sem_mes`) mede o mesmo em `linhaPrevista` -- sao dois " +
      "construtores, e o tipo `{ accountId, mes }` nao impede nenhum dos dois " +
      "de montar a string vazia",
    de:
      "    fatura: faturaPaga\n" +
      "      ? { accountId: faturaPaga.accountId, mes: faturaPaga.mes }\n" +
      "      : null,",
    para:
      '    fatura: faturaPaga ? { accountId: faturaPaga.accountId, mes: "" } : null,',
  },

  // --- rotulos que mudam o significado do numero --------------------------
  {
    nome: "moeda_sempre_rotulada",
    porque:
      "'R$ 1.000,00 · BRL' em toda linha: o rotulo que distingue a quantia " +
      "estrangeira deixa de distinguir nada",
    de: '  return nome && nome.toUpperCase() !== "BRL" ? nome.toUpperCase() : null;',
    para: "  return nome ? nome.toUpperCase() : null;",
  },
  {
    nome: "conta_inventada",
    porque:
      '"Sem conta" escrito igual a "Itaú" e um nome de conta inventado na ' +
      "linha de quem nunca escolheu conta nenhuma",
    de: "    conta: destino.faltaConta ? null : destino.texto,",
    para: "    conta: destino.texto,",
  },
];

// ---------------------------------------------------------------------------
// DOIS MUTANTES QUE FORAM REMOVIDOS, E O QUE ELES ENSINARAM
// ---------------------------------------------------------------------------
// Os dois SOBREVIVERAM na primeira rodada, e os dois sobreviveram com razao: o
// que eles apagavam era defesa morta. A conclusao foi apagar a defesa do
// modulo, nao escrever um teste capaz de "provar" codigo que nao faz nada.
//
//   `vencido_pega_realizado` apagava `if (linha.origem !== "previsto")` de
//   `previstoVencido`. `linhaRealizada` grava `situacao: null` em TODA linha
//   realizada, entao a linha realizada nunca passava do filtro de 'overdue' e a
//   primeira guarda nao decidia nada. O unico teste que a mataria teria de
//   FORJAR uma linha realizada com `situacao: "overdue"` -- um estado que o
//   modulo nao produz, e uma trava provada so por estado forjado por fora nao
//   prova nada. O invariante ("o realizado nasce sem situacao") passou a ter
//   assercao propria, que e onde a regra de fato se segura.
//
//   `secoes_ordenam_no_lugar` apagava o `[...previstas]` de `secoesDaTela`.
//   `filter` ja devolve array novo, entao a copia era copia de copia. O que
//   restou para medir e OUTRA coisa, e essa importa: `secoes_compartilham_array`
//   faz as duas secoes ordenarem o MESMO array em sentidos opostos.

const dir = mkdtempSync(join(tmpdir(), "mut246-"));
const dirLib = join(dir, "lib");
mkdirSync(dirLib, { recursive: true });
for (const dep of DEPENDENCIAS) copyFileSync(dep, join(dirLib, basename(dep)));

// O tsconfig temporario e a copia do scripts/tsconfig.telas-de-movimentacao-
// test.json apontada para a arvore mutada. `baseUrl` no dir temporario e o que
// faz `@/lib/movimentacoes` achar a COPIA, e nao o arquivo do repo.
const tsconfig = join(dir, "tsconfig.json");
writeFileSync(
  tsconfig,
  JSON.stringify({
    compilerOptions: {
      outDir: resolve(SAIDA),
      rootDir: dirLib,
      module: "es2020",
      target: "es2020",
      moduleResolution: "node",
      skipLibCheck: true,
      baseUrl: dir,
      paths: { "@/*": ["./*"] },
    },
    include: [join(dirLib, "telas-de-movimentacao.ts")],
  })
);

let falhas = 0;

function compilaERoda(fonteTs) {
  writeFileSync(join(dirLib, "telas-de-movimentacao.ts"), fonteTs);
  rmSync(SAIDA, { recursive: true, force: true });
  execFileSync("npx", ["tsc", "-p", tsconfig], { stdio: "pipe" });
  // O tsc resolve `@/` mas nao o reescreve no JS emitido -- o mesmo passo do
  // npm script, sem o qual o node morre em ERR_MODULE_NOT_FOUND e TODO mutante
  // "morre" por erro de import.
  execFileSync("node", ["scripts/resolve-aliases.mjs", SAIDA, "lib"], {
    stdio: "pipe",
  });
  // O fuso e o mesmo do npm script: o controle do dia 1 (o mutante
  // `ordem_por_date`) so e capaz de falhar em fuso negativo.
  execFileSync("node", ["--test", TESTE], {
    stdio: "pipe",
    env: { ...process.env, TZ: "America/Sao_Paulo" },
  });
}

try {
  // CONTROLE POSITIVO: com a fonte intacta o teste tem de PASSAR. Sem isto, um
  // "todos morreram" poderia significar apenas que o build esta quebrado e o
  // teste reprova sempre.
  try {
    compilaERoda(original);
    console.log("controle positivo: o teste passa com a fonte intacta\n");
  } catch (e) {
    console.error("ABORTADO: o teste reprova com a fonte INTACTA.");
    console.error((e.stdout ?? e.stderr ?? "").toString().slice(-1500));
    process.exit(1);
  }

  for (const m of MUTANTES) {
    // `String.replace` troca a PRIMEIRA ocorrencia. Um trecho que aparece duas
    // vezes produz um mutante que muta o lugar errado e morre verde com o
    // rotulo mentindo sobre o que foi medido -- por isso o trecho tem de ser
    // UNICO, e nao apenas existir.
    const ocorrencias = original.split(m.de).length - 1;
    if (ocorrencias === 0) {
      console.log(
        `  !! ${m.nome}: o trecho a mutar NAO EXISTE MAIS -- mutante invalido`
      );
      falhas++;
      continue;
    }
    if (ocorrencias > 1) {
      console.log(
        `  !! ${m.nome}: o trecho aparece ${ocorrencias}x -- mutante ambiguo, invalido`
      );
      falhas++;
      continue;
    }

    const mutado = original.replace(m.de, m.para);

    let sobreviveu = false;
    try {
      compilaERoda(mutado);
      sobreviveu = true;
    } catch {
      // reprovou (ou nem compilou): e o esperado.
    }

    if (sobreviveu) {
      console.log(`  SOBREVIVEU  ${m.nome}  <-- nenhuma assercao protege isto`);
      console.log(`              (${m.porque})`);
      falhas++;
    } else {
      console.log(`  morreu      ${m.nome}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
  // Deixa o build em dia com a fonte de verdade, para o proximo
  // `npm run test:telas-de-movimentacao` nao rodar contra um artefato mutado.
  try {
    rmSync(SAIDA, { recursive: true, force: true });
    execFileSync("npm", ["run", "test:telas-de-movimentacao"], { stdio: "pipe" });
  } catch {
    /* o controle positivo acima ja teria falhado */
  }
}

console.log();
if (falhas === 0) {
  console.log(`todos os ${MUTANTES.length} mutantes morreram`);
} else {
  console.log(`${falhas} mutante(s) sobreviveu/sobreviveram ou sao invalidos`);
  process.exit(1);
}
