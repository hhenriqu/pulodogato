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
import { SELO_DO_MYBANK } from "@/lib/emprestimo-do-mybank";

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
