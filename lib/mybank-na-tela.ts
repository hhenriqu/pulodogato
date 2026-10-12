// ---------------------------------------------------------------------------
// MyBank na tela -- os recortes que /dashboard/mybank mostra (HMO-371, F3 da
// HMO-368)
// ---------------------------------------------------------------------------
// A F2 (`lib/emprestimo-do-mybank.ts`) decidiu a ARITMETICA e quais pernas cada
// caso gera. Aqui mora o que a TELA pergunta ao dado que as rotas devolvem:
// quais contas podem emprestar, quanto cada uma emprestou e tem a receber, e
// quais sao as linhas de "A receber".
//
// POR QUE ISSO NAO MORA DENTRO DO COMPONENTE
// ------------------------------------------
// Dois dos defeitos que esta fase pode ter sao invisiveis em qualquer
// verificacao que nao seja uma assercao direta sobre eles:
//
//   1. O SELETOR OFERECER CONTA CORRENTE. A rota recusa (`problemaDoEmprestimo`
//      devolve `conta_credora_nao_e_investimento`) e a trigger da 053 recusa
//      depois dela -- entao o sintoma nao e dinheiro errado, e um formulario que
//      oferece uma opcao que sempre falha. Nada compila errado, nada responde
//      500: a pessoa escolhe a conta corrente, aperta e leva uma recusa que nao
//      sabia que ia levar.
//   2. A LINHA DE "A RECEBER" PERDER O "QUEM DEVE PAGAR". A issue nomeia TRES
//      campos (valor, `n de m`, quem deve pagar) e os tres existem no corpo que
//      `GET /api/mybank/loans` devolve. Uma linha que imprime dois deles fica
//      com aparencia perfeita -- e com um emprestimo para a Lais e um
//      auto-emprestimo na mesma lista, indistinguiveis.
//
// Com as duas perguntas em funcao pura, cada uma e uma assercao de uma linha, e
// o mutante que as estraga morre na suite em vez de so na sonda de navegador.
//
// O QUE NAO SE DECIDE AQUI
// ------------------------
// "Quem deve pagar" NAO e recalculado: ele vem pronto de `quemDevePagar`
// (F2), ja resolvido pela rota, que e quem tem o perfil do devedor em maos. Uma
// segunda derivacao aqui divergiria dela no dia em que o nome passasse a sair de
// outro lugar -- e o sintoma seria a lista do MyBank e a resposta da rota
// discordando sobre quem deve.
// ---------------------------------------------------------------------------

import { porTipo } from "@/lib/contas";
import {
  parcelaFoiAntecipada,
  parcelasDaAntecipacao,
  SELO_DO_MYBANK,
  ultimoVencimentoEmAberto,
  valorDaAntecipacao,
  type ParcelaParaAntecipar,
} from "@/lib/emprestimo-do-mybank";

/** O tipo de conta que o MyBank aceita como credora -- a trava 1 da 053. */
export const TIPO_DA_CONTA_CREDORA = "investment";

/** O que a tela precisa saber de uma conta para oferece-la (ou nao). */
export interface ContaNaTelaDoMyBank {
  id: string;
  name: string;
  account_type: string;
  is_active?: boolean | null;
  current_balance?: number | null;
}

/**
 * AS CONTAS QUE PODEM EMPRESTAR.
 *
 * `account_type === 'investment'` e a trava 1 da migration 053, dita em
 * TypeScript. O MyBank e uma conta de investimento minha virando banco: oferecer
 * conta corrente aqui seria oferecer uma opcao que a trigger recusa.
 *
 * `is_active !== false` E NAO `is_active === true`
 * -----------------------------------------------
 * A coluna e anulavel (001) e a tela de contas arquiva por `is_active = false`.
 * Com `=== true`, toda conta cuja coluna esteja NULL desapareceria do seletor --
 * e uma conta de investimento invisivel no MyBank nao tem sintoma nenhum: a
 * lista simplesmente vem mais curta, e quem olha conclui que nao tem a conta
 * cadastrada. E a familia do `coluna-booleana-anulavel-not-is-false`.
 */
export function contasQueEmprestam<T extends ContaNaTelaDoMyBank>(
  contas: T[]
): T[] {
  return contas.filter(
    (conta) =>
      conta.account_type === TIPO_DA_CONTA_CREDORA && conta.is_active !== false
  );
}

/**
 * AS CONTAS DE ONDE AS PARCELAS DO AUTO-EMPRESTIMO SAEM.
 *
 * Toda conta ativa MENOS a credora: `scheduled_transactions_destino_check` (038)
 * exige `destination_account_id <> account_id`, e `problemaDoEmprestimo` recusa
 * com `conta_de_pagamento_e_a_credora`. Oferecer a credora aqui seria repetir no
 * seletor a opcao que a rota recusa -- o mesmo defeito do seletor de credora,
 * no outro campo.
 *
 * Outra conta de investimento CONTINUA na lista: emprestar da carteira A e pagar
 * pela carteira B e esquisito, mas e dinheiro saindo de uma conta e entrando em
 * outra, e nao cabe a esta funcao proibir.
 */
export function contasQuePagamAParcela<T extends ContaNaTelaDoMyBank>(
  contas: T[],
  contaCredoraId: string | null
): T[] {
  return contas.filter(
    (conta) => conta.is_active !== false && conta.id !== contaCredoraId
  );
}

/** O rotulo do seletor: o nome da conta e o tipo dela, pelo catalogo de `lib/contas`. */
export function rotuloDaContaCredora(conta: ContaNaTelaDoMyBank): string {
  // `porTipo` cai em "Outra" para tipo desconhecido, e isso e proposital la: o
  // `account_type` chega de uma consulta e uma linha gravada por um caminho que
  // nao passou pelo app nao pode derrubar a tela.
  return `${conta.name} · ${porTipo(conta.account_type as never).rotulo}`;
}

// ---------------------------------------------------------------------------
// O que a rota devolve
// ---------------------------------------------------------------------------
// A forma e a de `GET /api/mybank/loans` (F2), e os nomes sao os dela: um
// segundo vocabulario aqui faria a tela e a rota discordarem na primeira
// mudanca de campo -- que e como `nome-de-campo-errado-esconde-bug-de-dinheiro`
// aconteceu neste repositorio.

export interface ParcelaDoMyBank {
  id: string;
  valor: number;
  numero: number;
  total: number;
  /** `3 de 24`, montado pela ROTA. Ver `rotuloDaParcela` abaixo. */
  rotulo: string;
  vencimento: string;
  status: string;
  a_confirmar: boolean;
  reported_at?: string | null;
  paid_date?: string | null;
}

export interface EmprestimoDoMyBank {
  id: string;
  descricao: string;
  conta_credora_id: string;
  caso: "auto" | "conexao";
  status: string;
  principal: number;
  total_de_parcelas: number;
  primeiro_vencimento: string;
  /** Um dos tres campos da issue, resolvido pela rota (`quemDevePagar`). */
  quem_deve_pagar: string;
  devedor_id: string;
  parcelas: ParcelaDoMyBank[];
}

/** As parcelas que ainda nao foram pagas -- as que "A receber" lista. */
export const STATUS_EM_ABERTO = ["pending", "reported"];

export function parcelaEmAberto(parcela: { status: string }): boolean {
  return STATUS_EM_ABERTO.includes(parcela.status);
}

/**
 * `3 de 24`, e com um fallback que nao e defensividade.
 *
 * A rota ja manda `rotulo` pronto, e e ele que vale: ele e o mesmo texto que a
 * resposta da API tem, entao a tela nao pode dizer "3 de 24" onde a rota disse
 * outra coisa. O fallback existe para a tela nao imprimir `undefined` se um dia
 * alguem tirar o campo da rota -- e ele e EXPLICITO, montado dos dois numeros
 * que sempre vem, em vez de uma string vazia que passaria por rotulo valido.
 */
export function rotuloDaParcela(parcela: ParcelaDoMyBank): string {
  return parcela.rotulo || `${parcela.numero} de ${parcela.total}`;
}

/** Uma linha do painel "A receber": os tres campos da issue, e nada implicito. */
export interface LinhaAReceber {
  id: string;
  emprestimoId: string;
  descricao: string;
  /** Campo 1 da issue. */
  valor: number;
  /** Campo 2 da issue, `3 de 24`. */
  rotulo: string;
  /** Campo 3 da issue. Vem da rota, nao e recalculado aqui. */
  quemDevePagar: string;
  vencimento: string;
  status: string;
  aConfirmar: boolean;
  caso: "auto" | "conexao";
}

/**
 * AS LINHAS DE "A RECEBER" -- uma por parcela em aberto, dos emprestimos ativos.
 *
 * O AUTO-EMPRESTIMO TAMBEM ENTRA, e isso e deliberado
 * ---------------------------------------------------
 * A parcela que eu pago para mim mesmo tambem e dinheiro que a conta de
 * investimento vai receber, e `quemDevePagar` (F2) ja tem a frase dela ("Você
 * mesmo"). Esconde-la aqui faria o total do cabecalho ("a receber daquela
 * conta") nao fechar com a soma das linhas logo abaixo -- duas leituras do mesmo
 * fato discordando na mesma tela, que e o defeito que este app passou meses
 * consertando em outras telas.
 *
 * ORDENADO POR VENCIMENTO, e com o numero da parcela como desempate: sem o
 * segundo critério, duas parcelas de emprestimos diferentes no mesmo dia sairiam
 * na ordem em que a rota as devolveu, e a lista mudaria de ordem entre dois
 * carregamentos sem nada ter mudado.
 */
export function linhasAReceber(
  emprestimos: EmprestimoDoMyBank[]
): LinhaAReceber[] {
  const linhas: LinhaAReceber[] = [];

  for (const emprestimo of emprestimos) {
    if (emprestimo.status !== "active") continue;

    for (const parcela of emprestimo.parcelas) {
      if (!parcelaEmAberto(parcela)) continue;

      linhas.push({
        id: parcela.id,
        emprestimoId: emprestimo.id,
        descricao: emprestimo.descricao,
        valor: parcela.valor,
        rotulo: rotuloDaParcela(parcela),
        quemDevePagar: emprestimo.quem_deve_pagar,
        vencimento: parcela.vencimento,
        status: parcela.status,
        aConfirmar: parcela.a_confirmar,
        caso: emprestimo.caso,
      });
    }
  }

  return linhas.sort((a, b) =>
    a.vencimento === b.vencimento
      ? a.rotulo.localeCompare(b.rotulo)
      : a.vencimento < b.vencimento
      ? -1
      : 1
  );
}

/** Os dois numeros do cabecalho, para UMA conta de investimento. */
export interface TotaisDaContaCredora {
  /** A soma do `principal` dos emprestimos ativos daquela conta. */
  emprestado: number;
  /** A soma das parcelas em aberto daquela conta. */
  aReceber: number;
  quantosEmprestimos: number;
  quantasParcelasEmAberto: number;
}

/**
 * O TOTAL EMPRESTADO E O TOTAL A RECEBER DA CONTA ESCOLHIDA.
 *
 * SAO DOIS NUMEROS DIFERENTES, E OS DOIS ESTAO CERTOS
 * ---------------------------------------------------
 * "Emprestado" e quanto saiu da conta; "a receber" e quanto ainda falta voltar.
 * Depois da primeira parcela paga de um emprestimo de R$ 24.000, o emprestado
 * continua R$ 24.000 e o a receber e R$ 23.000 -- e e por isso que a tela mostra
 * os dois com rotulo proprio. Um numero so faria quem olha concluir que o outro
 * esta errado, que e exatamente o que `fontes-consistentes-que-discordam`
 * descreve.
 *
 * `status !== 'active'` FICA FORA DOS DOIS: emprestimo quitado ou cancelado nao
 * tem nada a receber, e contar o principal dele no "emprestado" diria que a
 * conta emprestou um dinheiro que ja voltou.
 */
export function totaisDaContaCredora(
  emprestimos: EmprestimoDoMyBank[],
  contaId: string | null
): TotaisDaContaCredora {
  const minhas = emprestimos.filter(
    (e) => e.status === "active" && (contaId === null || e.conta_credora_id === contaId)
  );

  let emprestado = 0;
  let aReceber = 0;
  let quantasParcelasEmAberto = 0;

  for (const emprestimo of minhas) {
    emprestado += emprestimo.principal;
    for (const parcela of emprestimo.parcelas) {
      if (!parcelaEmAberto(parcela)) continue;
      aReceber += parcela.valor;
      quantasParcelasEmAberto += 1;
    }
  }

  return {
    emprestado,
    aReceber,
    quantosEmprestimos: minhas.length,
    quantasParcelasEmAberto,
  };
}

/** O progresso `3/24` da lista de emprestimos -- quantas parcelas ja foram pagas. */
export function progressoDoEmprestimo(emprestimo: EmprestimoDoMyBank): string {
  const pagas = emprestimo.parcelas.filter((p) => p.status === "paid").length;
  return `${pagas}/${emprestimo.total_de_parcelas}`;
}

/**
 * O PROXIMO VENCIMENTO: a parcela em aberto mais antiga.
 *
 * `null` quando nao ha nenhuma -- e a tela diz "quitado" em vez de imprimir uma
 * data vazia. `reduce` em lista vazia com valor inicial `null` e o que evita o
 * `TypeError` que um `[0]` daria.
 */
export function proximoVencimento(
  emprestimo: EmprestimoDoMyBank
): string | null {
  return emprestimo.parcelas
    .filter(parcelaEmAberto)
    .reduce<string | null>(
      (menor, p) => (menor === null || p.vencimento < menor ? p.vencimento : menor),
      null
    );
}

/** O valor da parcela do emprestimo, para a lista. A primeira em aberto, ou a 1. */
export function valorDaParcelaNaLista(
  emprestimo: EmprestimoDoMyBank
): number | null {
  if (emprestimo.parcelas.length === 0) return null;
  const emAberto = emprestimo.parcelas.filter(parcelaEmAberto);
  return (emAberto[0] ?? emprestimo.parcelas[0]).valor;
}

// ---------------------------------------------------------------------------
// O GESTO DE ANTECIPAR, NA TELA (F4 da HMO-393, issue HMO-397)
// ---------------------------------------------------------------------------
// A ARITMETICA JA EXISTE, E ESTA SECAO NAO A REESCREVE: quem escolhe a cauda e
// `parcelasDaAntecipacao` (F2), quem soma e `valorDaAntecipacao` (em CENTAVOS
// inteiros, porque 24 x 416,67 em float da 9999,999999999998) e quem monta o
// `MM/AAAA` e `ultimoVencimentoEmAberto`. As tres sao as MESMAS funcoes que a
// rota chama -- e e isso que faz a previa do dialogo e a frase da resposta
// concordarem sobre quanto sai da conta e sobre onde a serie passa a acabar.
//
// UMA SEGUNDA COPIA AQUI SERIA A TERCEIRA ARITMETICA DE PARCELA DO APP, e as
// tres discordariam no primeiro centavo -- `fontes-consistentes-que-discordam`,
// desta vez com o numero que a pessoa le ANTES de apertar.
//
// O PRECO E UMA TRADUCAO DE VOCABULARIO, E ELA E EXPLICITA
// -------------------------------------------------------
// `ParcelaDoMyBank` e o que a ROTA devolve (`valor`, `numero`, `vencimento`), e
// `ParcelaParaAntecipar` e o que o BANCO tem (`amount`, `installment_number`,
// `due_date`). `parcelaParaAntecipar` faz a ponte num lugar so. Deixar o
// componente montar esse objeto na chamada esconderia a traducao dentro do JSX,
// onde nenhum mutante a alcanca -- e trocar `valor` por `total` ali sairia com
// aparencia perfeita e um valor errado no dialogo.
// ---------------------------------------------------------------------------

/**
 * A parcela da TELA na forma que a aritmetica da antecipacao le.
 *
 * `installment_total` vai de `total` porque e o que a rota manda; nenhuma das
 * tres funcoes da antecipacao o le (`installment_total` nao e tocado por esta
 * feature, e e isso que a faz caber sem migration), e ele esta aqui so porque o
 * tipo o exige.
 */
export function parcelaParaAntecipar(
  parcela: ParcelaDoMyBank
): ParcelaParaAntecipar {
  return {
    id: parcela.id,
    installment_number: parcela.numero,
    installment_total: parcela.total,
    amount: parcela.valor,
    due_date: parcela.vencimento,
    status: parcela.status,
  };
}

/** Quantas parcelas deste emprestimo ainda sao divida. */
export function quantasEmAbertoNoEmprestimo(
  emprestimo: EmprestimoDoMyBank
): number {
  return emprestimo.parcelas.filter(parcelaEmAberto).length;
}

/**
 * O GESTO DE ANTECIPAR APARECE? -- `active` **E** com parcela em aberto.
 *
 * A CONDICAO E DIFERENTE DA DO CANCELAR, E A DIFERENCA E DE PROPOSITO
 * ------------------------------------------------------------------
 * Cancelar e so pelo status: um emprestimo `active` sem nada em aberto AINDA
 * precisa de saida (e o caso que abriu a HMO-383), entao o botao fica. Antecipar
 * sem nada em aberto nao tem o que fazer -- `parcelasDaAntecipacao` devolveria
 * `[]`, o dialogo nao teria opcao nenhuma para oferecer e a rota recusaria com
 * `mais_do_que_em_aberto`. Oferecer o gesto ali e oferecer um clique cujo unico
 * resultado possivel e um toast de erro.
 *
 * E essa diferenca e ALCANCAVEL, nao teorica: os emprestimos que quitaram ANTES
 * da HMO-394 seguem `active` com a serie inteira paga, e e exatamente por eles
 * que o Cancelar continua condicionado so ao status.
 */
export function podeAntecipar(emprestimo: EmprestimoDoMyBank): boolean {
  return (
    emprestimo.status === "active" && quantasEmAbertoNoEmprestimo(emprestimo) > 0
  );
}

/** O que o dialogo mostra ANTES do clique -- os numeros, nao a frase. */
export interface PreviaDaAntecipacaoNaTela {
  /** Quantas parcelas de verdade seriam pagas (nunca mais do que as em aberto). */
  quantas: number;
  /** Os numeros delas, na ordem da serie -- e e nesta ordem que a frase os diz. */
  numeros: number[];
  /** A soma, em reais. Quem formata e quem mostra. */
  valor: number;
  ultimoVencimentoAntes: string | null;
  /** `null` quando nao sobra parcela em aberto: a antecipacao QUITA o emprestimo. */
  ultimoVencimentoDepois: string | null;
}

/**
 * A PREVIA, montada das MESMAS funcoes que a rota usa.
 *
 * OS NUMEROS SAEM ORDENADOS PELA SERIE, E NAO PELA CAUDA
 * -----------------------------------------------------
 * `parcelasDaAntecipacao` devolve da cauda para cima (`due_date DESC`), que e a
 * ordem em que ela ESCOLHE. A frase diz "as 23 e 24", nao "as 24 e 23" -- e o
 * `sort` aqui e sobre uma copia (`map` ja copiou), entao ele nao reordena a
 * lista que a funcao de escolha devolveu.
 *
 * O `ultimoVencimentoDepois` E CALCULADO POR EXCLUSAO DE id, E NAO POR CONTAGEM
 * ---------------------------------------------------------------------------
 * "as em aberto menos as N ultimas" daria o mesmo resultado quase sempre e
 * erraria no empate: duas parcelas vencendo no mesmo dia (uma serie que comeca
 * em 31/01 grampeia em fevereiro) sairiam da contagem na ordem da lista, e nao
 * na ordem que `parcelasDaAntecipacao` escolheu. Excluir pelos ids escolhidos e
 * o que mantem a previa e a escrita falando das MESMAS parcelas.
 */
export function previaDaAntecipacaoNaTela(
  emprestimo: EmprestimoDoMyBank,
  quantas: number
): PreviaDaAntecipacaoNaTela {
  const todas = emprestimo.parcelas.map(parcelaParaAntecipar);
  const escolhidas = parcelasDaAntecipacao({ parcelas: todas, quantas });
  const ids = new Set(escolhidas.map((p) => p.id));

  return {
    quantas: escolhidas.length,
    numeros: escolhidas.map((p) => p.installment_number).sort((a, b) => a - b),
    valor: valorDaAntecipacao({ parcelasEscolhidas: escolhidas }),
    ultimoVencimentoAntes: ultimoVencimentoEmAberto(todas),
    ultimoVencimentoDepois: ultimoVencimentoEmAberto(
      todas.filter((p) => !ids.has(p.id))
    ),
  };
}

/**
 * O ROTULO DA PARCELA ANTECIPADA na lista do credor -- `null` quando nao ha.
 *
 * ELE EXPLICA O `4/24` AO LADO DE "vence <parcela 3>", e e so por isso que ele
 * existe. `progressoDoEmprestimo` continua `pagas/installment_count` e continua
 * CERTO (as oito leituras da secao 0 do plano foram medidas, e nenhuma mente) --
 * mas quatro pagas com a terceira ainda pendente e uma tela que pede explicacao,
 * e sem ela a unica conclusao disponivel e "a contagem esta errada".
 *
 * OS NUMEROS VAO NO ROTULO, e nao so a contagem: "2 antecipadas" deixa quem olha
 * procurando QUAIS na lista de 24. E a ordem e a da serie, pela mesma razao da
 * previa.
 */
export function rotuloDasParcelasAntecipadas(
  emprestimo: EmprestimoDoMyBank
): string | null {
  const numeros = emprestimo.parcelas
    .filter((p) =>
      parcelaFoiAntecipada({ paid_date: p.paid_date, due_date: p.vencimento })
    )
    .map((p) => p.numero)
    .sort((a, b) => a - b);

  if (numeros.length === 0) return null;

  return numeros.length === 1
    ? `1 antecipada (${numeros[0]})`
    : `${numeros.length} antecipadas (${numeros.join(" e ")})`;
}

// ---------------------------------------------------------------------------
// O LADO DO DEVEDOR -- o selo em Contas a Pagar
// ---------------------------------------------------------------------------

/** Uma linha da view `mybank_due_entries` (053), como a rota do devedor a devolve. */
export interface ParcelaQueEuDevo {
  id: string;
  loan_id: string;
  descricao: string;
  valor: number;
  vencimento: string;
  status: string;
  numero: number;
  total: number;
  rotulo: string;
  /** O nome de quem emprestou. `null` quando o perfil nao esta legivel. */
  quem_emprestou: string | null;
}

/**
 * "MyBank — Lais": o selo que a parcela leva em Contas a Pagar.
 *
 * O NOME FALTANDO NAO ESCONDE A DIVIDA
 * ------------------------------------
 * O perfil do credor e alcancado pela `profiles_select_connected` (010), e
 * desfazer a conexao depois do emprestimo deixa a divida de pe com o perfil
 * ilegivel. O selo entao diz so "MyBank", e a parcela continua na lista -- a
 * mesma escolha de `quemDevePagar` (F2) no outro lado: a divida nao deixou de
 * existir porque o contato saiu.
 *
 * O travessao e o do portugues (—) e nao um hifen: ele e o mesmo separador que
 * o resto do app usa nos rotulos de duas partes.
 */
export function seloDoMyBank(quemEmprestou: string | null): string {
  if (!quemEmprestou) return SELO_DO_MYBANK;
  return `${SELO_DO_MYBANK} — ${quemEmprestou}`;
}

/** Quem ja avisou nao avisa de novo -- o botao vira a frase de espera. */
export function podeAvisarQuePagou(parcela: { status: string }): boolean {
  return parcela.status === "pending";
}

export const ROTULO_DE_AVISAR = "Avisei que paguei";
export const ROTULO_PARA_AVISAR = "Avisar que paguei";

/**
 * O que o bloco do devedor explica.
 *
 * A segunda oracao e a CONSEQUENCIA, e nao enfeite: sem ela a linha se le como
 * aviso informativo e quem avisou fica esperando sem saber o que falta. E a
 * mesma razao de `SUBTITULO_A_CONFIRMAR_NO_MYBANK` do outro lado.
 */
export const SUBTITULO_DO_DEVEDOR =
  "Parcelas de empréstimo que alguém te fez pelo MyBank. Avise que pagou e quem emprestou confirma quando o dinheiro entrar.";

/** O titulo do bloco do devedor em Contas a Pagar. */
export const TITULO_DO_DEVEDOR = "Parcelas do MyBank";

// ---------------------------------------------------------------------------
// DE QUE PERIODO O BLOCO DO DEVEDOR FALA -- HMO-381
// ---------------------------------------------------------------------------
// O bloco mostra a divida INTEIRA, e nao a janela de `/dashboard/bills`. A
// escolha e a saida (2) da HMO-381 e o porque esta no cabecalho de
// `ParcelasDoMyBankQueEuDevo.tsx` -- aqui mora so a frase que a diz na tela.
//
// POR QUE A FRASE NAO E UMA CONSTANTE
// -----------------------------------
// "Nao segue o periodo da pagina" sozinha e verdadeira e inutil: ela nega um
// recorte sem dizer qual e o do bloco, e quem le continua sem saber se as 25
// linhas vao ate o ano que vem ou ate 2028. O periodo MEDIDO nas parcelas
// carregadas e o unico numero que responde isso, e ele nao se escreve a mao --
// muda a cada parcela paga.
//
// E e por isso que o `painel-sem-eixo-de-tempo-mente-no-rotulo` nao se resolve
// com texto fixo: o rotulo tem de sair do MESMO dado que a lista imprime, senao
// as duas metades do bloco podem discordar sem que nada falhe.

/**
 * `AAAA-MM-DD` -> `MM/AAAA`, por fatia de string.
 *
 * NUNCA `new Date(iso).getMonth()`: o construtor le `AAAA-MM-DD` como meia-noite
 * UTC, e no fuso de Sao Paulo o dia 1 de um mes volta para o mes anterior. O
 * rotulo diria "09/2026" para uma parcela de outubro -- um erro que passa verde
 * em CI que roda em UTC (`teste-de-data-passa-em-utc-e-nao-ve-o-bug`).
 */
function mesDoVencimento(iso: string): string {
  const [ano, mes] = String(iso).split("-");
  return `${mes}/${ano}`;
}

/** A segunda metade da frase: o que o bloco NAO e. */
export const FRASE_FORA_DA_JANELA =
  "Este bloco não segue o período da página.";

/**
 * "Toda a dívida em aberto, de 09/2026 a 10/2028. Este bloco não segue o
 * período da página."
 *
 * ORDENA AS DATAS AQUI, e nao confia na ordem da rota. `GET /api/mybank/due` ja
 * devolve por `due_date` crescente, e ler `parcelas[0]` e `parcelas[n-1]`
 * funcionaria hoje -- e viraria uma frase errada no dia em que alguem tirasse o
 * `.order()` da rota, ou em que a tela passasse a ordenar por valor. O rotulo
 * ficaria mentindo sobre a lista que esta logo abaixo dele, sem erro nenhum.
 *
 * SEM PARCELA NENHUMA devolve so a frase de escopo: o bloco inteiro desaparece
 * nesse caso (e o controle negativo do componente), entao esta metade nunca
 * chega a tela -- mas uma funcao que estourasse em lista vazia derrubaria a
 * pagina no primeiro `[]` que a rota devolvesse.
 */
export function escopoDoBlocoDoDevedor(
  parcelas: { vencimento: string }[]
): string {
  if (parcelas.length === 0) return FRASE_FORA_DA_JANELA;

  // `AAAA-MM-DD` ordena lexicograficamente, mas `MM/AAAA` NAO -- "01/2028" vem
  // antes de "09/2026". A ordenacao e sobre o ISO cru, e o rotulo sai depois.
  // `.sort()` e sobre a copia que o `.map()` acabou de fazer: ordenar
  // `parcelas` em si reordenaria a LISTA DA TELA como efeito colateral de
  // montar um subtitulo.
  const isos = parcelas.map((parcela) => String(parcela.vencimento)).sort();
  const primeiro = mesDoVencimento(isos[0]);
  const ultimo = mesDoVencimento(isos[isos.length - 1]);

  // UMA PARCELA SO (ou todas no mesmo mes) diz "em 10/2026": "de 10/2026 a
  // 10/2026" se le como um intervalo quebrado.
  const quando =
    primeiro === ultimo ? `em ${primeiro}` : `de ${primeiro} a ${ultimo}`;

  return `Toda a dívida em aberto, ${quando}. ${FRASE_FORA_DA_JANELA}`;
}

// ---------------------------------------------------------------------------
// O COLAPSO -- o bloco deixa de empurrar a pagina 3.000 pixels para baixo
// ---------------------------------------------------------------------------
// Dois emprestimos de 12 e 13 parcelas dao 25 linhas, e elas vinham TODAS
// abertas: o bloco ficava mais comprido que o resto da tela de Contas a Pagar
// somado. Ver `scroll-horizontal-no-celular` para o lado do eixo X; este e o do
// eixo Y, e o sintoma dele e a pessoa nao achar o formulario de cadastro.

/**
 * Quantas linhas o bloco mostra fechado.
 *
 * CINCO, e nao tres nem dez: a divida tipica deste app e mensal, e cinco cobrem
 * o proximo semestre -- o horizonte que a tela de Contas a Pagar ja usa. Com
 * tres, um emprestimo de quatro parcelas (que cabe inteiro na tela) ganharia um
 * botao para esconder UMA linha.
 */
export const PARCELAS_VISIVEIS_FECHADO = 5;

/** O que o bloco do devedor mostra agora, aberto ou fechado. */
export interface BlocoDoDevedor<T> {
  /** As linhas a imprimir. */
  visiveis: T[];
  /** Quantas ficaram de fora. `0` quando aberto, ou quando tudo cabe. */
  escondidas: number;
  /**
   * O rotulo do botao, ou `null` quando nao ha botao nenhum.
   *
   * `null` E NAO `""`: uma string vazia renderiza um botao clicavel de zero
   * caracteres no fim do bloco, e nada falharia por causa dele.
   */
  rotuloDoBotao: string | null;
}

/**
 * AS LINHAS QUE O BLOCO IMPRIME, e o rotulo do botao que revela o resto.
 *
 * O ROTULO DIZ QUANTAS FALTAM, e nao "Ver mais".
 * ----------------------------------------------
 * "Ver mais" esconde justamente o que a pessoa precisa decidir se vale o toque:
 * cinco de 25 e um bloco que esconde 80% da divida, e cinco de seis nao. Com o
 * numero no botao, o colapso para de ser indistinguivel de "o resto nao
 * existe" -- a familia `sumido-da-tela-pode-ser-so-indistinguivel`, e a mesma
 * razao de `recortarPrevistas` contar o que deixa de fora.
 *
 * ABERTO, O BOTAO FICA (dizendo "Mostrar menos") em vez de desaparecer: um
 * botao que some depois do toque deixa a pessoa sem caminho de volta, e o bloco
 * aberto e exatamente o que esta issue veio encurtar.
 */
export function blocoDoDevedor<T>(
  parcelas: T[],
  aberto: boolean
): BlocoDoDevedor<T> {
  const cabe = parcelas.length <= PARCELAS_VISIVEIS_FECHADO;

  // CABE INTEIRO: nenhum botao, nem aberto nem fechado. O estado de abertura
  // nao pode produzir duas telas diferentes para a mesma lista curta.
  if (cabe) return { visiveis: parcelas, escondidas: 0, rotuloDoBotao: null };

  if (aberto) {
    return {
      visiveis: parcelas,
      escondidas: 0,
      rotuloDoBotao: "Mostrar menos",
    };
  }

  const escondidas = parcelas.length - PARCELAS_VISIVEIS_FECHADO;
  const palavra = escondidas === 1 ? "parcela" : "parcelas";

  return {
    visiveis: parcelas.slice(0, PARCELAS_VISIVEIS_FECHADO),
    escondidas,
    rotuloDoBotao: `Mostrar as outras ${escondidas} ${palavra}`,
  };
}

// ---------------------------------------------------------------------------
// AS CONEXOES QUE PODEM TOMAR EMPRESTADO
// ---------------------------------------------------------------------------

/** Um perfil como `/api/connections` o devolve nos dois embeds. */
export interface PerfilDaConexao {
  id: string;
  full_name?: string | null;
  nickname?: string | null;
}

/** Uma linha de `user_connections` como `GET /api/connections` a devolve. */
export interface ConexaoCrua {
  id: string;
  requester_id: string;
  requested_id: string;
  status: string;
  requester?: PerfilDaConexao | null;
  requested?: PerfilDaConexao | null;
}

/** Quem pode tomar emprestado: id e nome, prontos para o seletor. */
export interface DevedorPossivel {
  id: string;
  nome: string;
}

/**
 * AS CONEXOES ACEITAS, do ponto de vista de quem olha.
 *
 * `status === 'accepted'` E A TRAVA 2 DA 053, DITA NO SELETOR
 * ----------------------------------------------------------
 * A trigger `mybank_loans_trava` exige conexao `accepted`, e
 * `problemaDoEmprestimo` recusa com `devedor_sem_conexao` antes dela. Sem o
 * filtro aqui, o seletor ofereceria quem pediu conexao e ainda nao foi aceito --
 * e a pessoa escolheria um nome que a rota recusa, sem ter como saber por que.
 * `GET /api/connections` hoje ja filtra `accepted` no servidor; o filtro
 * continua aqui porque e o CLIENTE que oferece a opcao, e uma rota que um dia
 * passe a devolver os pedidos pendentes (para a tela de Conexoes mostra-los) nao
 * pode mudar quem o MyBank aceita.
 *
 * O LADO ESCOLHIDO SAI DE `requester_id`, E NAO DO EMBED
 * ------------------------------------------------------
 * Os dois embeds sao many-to-one e podem vir NULOS (a RLS de `profiles`). Decidir
 * por `conexao.requester?.id === meuId` escolheria justamente o lado nulo quando
 * ele e o meu, e a pessoa sumiria da lista em silencio -- o defeito que
 * `/api/personal-finance/connections` tem comentado no proprio corpo.
 *
 * SEM NOME A CONEXAO CONTINUA NA LISTA, com o id curto no rotulo: ela existe, e
 * esconder quem o banco aceita faria o seletor discordar da trava.
 */
export function conexoesParaEmprestar(
  conexoes: ConexaoCrua[],
  meuId: string
): DevedorPossivel[] {
  const achadas: DevedorPossivel[] = [];

  for (const conexao of conexoes) {
    if (conexao.status !== "accepted") continue;

    const souOPedinte = conexao.requester_id === meuId;
    const outroId = souOPedinte ? conexao.requested_id : conexao.requester_id;
    const outro = souOPedinte ? conexao.requested : conexao.requester;

    if (!outroId || outroId === meuId) continue;
    if (achadas.some((d) => d.id === outroId)) continue;

    achadas.push({
      id: outroId,
      nome:
        outro?.nickname ||
        outro?.full_name ||
        `Conexão ${outroId.slice(0, 8)}`,
    });
  }

  return achadas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/**
 * O devedor escolhido tem conexao aceita? E a resposta que
 * `problemaDoEmprestimo` espera em `conexaoAceita`.
 *
 * Perguntar a LISTA JA FILTRADA, e nao a `conexoes` crua, e o que faz esta
 * funcao e o seletor nunca discordarem: se o nome nao esta entre as opcoes, ele
 * nao e aceito, por construcao.
 */
export function devedorTemConexaoAceita(
  devedores: DevedorPossivel[],
  devedorId: string | null
): boolean {
  if (!devedorId) return false;
  return devedores.some((d) => d.id === devedorId);
}
