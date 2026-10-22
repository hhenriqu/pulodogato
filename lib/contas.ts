// ---------------------------------------------------------------------------
// CONTA TEM SALDO, CARTAO TEM FATURA (HMO-166)
// ---------------------------------------------------------------------------
// A tela de cadastro era UM formulario para os oito valores do ENUM
// `account_type`, com limite, dia de fechamento e dia de vencimento aparecendo
// e desaparecendo conforme a pessoa trocava o tipo. Quem cadastrava uma conta
// corrente via tres campos de cartao piscarem e sumirem.
//
// A propria tela ja sabia que as duas coisas nao sao a mesma na hora de somar:
//
//     if (conta.account_type === "credit_card") fatura += Math.abs(valor);
//     else saldo += valor;
//
// Cartao de credito guarda o que foi GASTO -- uma divida que cresce. Conta
// guarda o que se TEM. Somar os dois daria um "total" que nao e dinheiro
// nenhum. Este arquivo e o unico lugar que decide qual tipo e qual, para que as
// duas telas separadas nao cheguem a respostas diferentes para a mesma conta.
//
// POR QUE O ESCOPO E UM CAMPO DO CATALOGO, E NAO UM `if`
// ------------------------------------------------------
// `debit_card` e o caso que nao se resolve sozinho: o usuario chama aquilo de
// "cartao", mas ele nao tem fatura, nem limite, nem fechamento, nem vencimento
// -- o dinheiro sai da conta na hora. Ele se comporta como conta e esta em
// Contas. Se essa escolha for revista, o que muda e a palavra `escopo` de UMA
// linha da tabela abaixo: nenhuma tela, nenhum total e nenhum formulario
// repetem a decisao.
//
// O QUE NAO PODE SE PERDER, E ESTA AQUI PORQUE SE PERDE CALADO
// ------------------------------------------------------------
// Os campos de fatura sao gravados `null` fora do escopo de cartao. Sem isso
// sobra dia de fechamento numa conta corrente -- ela nao tem fatura para
// fechar, entao o valor fica no banco sem nada que o leia e sem nada que o
// denuncie.
// ---------------------------------------------------------------------------

import type { AccountType, FinancialAccount } from "@/types/financial";
import { MOEDA_PADRAO } from "@/lib/dinheiro";
import { moedaSugerida } from "@/lib/moeda";

/** As duas telas. */
export type EscopoDeConta = "conta" | "cartao";

export interface TipoDeConta {
  valor: AccountType;
  rotulo: string;
  /** Em qual das duas telas este tipo se cadastra e se lista. */
  escopo: EscopoDeConta;
}

/**
 * Os oito valores do ENUM `account_type`, cada um com a tela onde mora.
 *
 * A ordem e a que a tela antiga usava, menos o cartao de credito, que saiu do
 * meio da lista de contas para a tela dele.
 */
export const TIPOS_DE_CONTA: TipoDeConta[] = [
  { valor: "checking", rotulo: "Conta corrente", escopo: "conta" },
  { valor: "savings", rotulo: "Poupança", escopo: "conta" },
  { valor: "credit_card", rotulo: "Cartão de crédito", escopo: "cartao" },
  // Ver o cabecalho: ele se comporta como conta. Trocar esta palavra move o
  // tipo de tela, de cadastro e de total, sem mais nenhuma edicao.
  { valor: "debit_card", rotulo: "Cartão de débito", escopo: "conta" },
  { valor: "cash", rotulo: "Dinheiro", escopo: "conta" },
  { valor: "digital", rotulo: "Carteira digital", escopo: "conta" },
  { valor: "investment", rotulo: "Investimento", escopo: "conta" },
  { valor: "other", rotulo: "Outra", escopo: "conta" },
];

/**
 * O tipo desconhecido cai em "Outra", como na tela antiga.
 *
 * Nao e defensivo a toa: `account_type` chega de uma consulta, e uma linha
 * gravada por um caminho que nao passou por aqui nao pode derrubar a tela.
 */
export const porTipo = (tipo: AccountType): TipoDeConta =>
  TIPOS_DE_CONTA.find((t) => t.valor === tipo) ??
  TIPOS_DE_CONTA[TIPOS_DE_CONTA.length - 1];

export const escopoDoTipo = (tipo: AccountType): EscopoDeConta =>
  porTipo(tipo).escopo;

/** Os tipos que o seletor de UMA tela oferece. */
export const tiposDoEscopo = (escopo: EscopoDeConta): TipoDeConta[] =>
  TIPOS_DE_CONTA.filter((t) => t.escopo === escopo);

/** O tipo que uma tela cria quando o seletor nao existe (Cartoes). */
export const tipoPadraoDoEscopo = (escopo: EscopoDeConta): AccountType =>
  tiposDoEscopo(escopo)[0].valor;

/** O recorte da lista que cada tela mostra. */
export function contasDoEscopo<T extends { account_type: AccountType }>(
  contas: T[],
  escopo: EscopoDeConta
): T[] {
  return contas.filter((c) => escopoDoTipo(c.account_type) === escopo);
}

// ---------------------------------------------------------------------------
// OS CAMPOS DE CADA TELA
// ---------------------------------------------------------------------------

export interface CamposDaConta {
  /** O seletor de tipo. Em Cartoes ha um tipo so, entao nao ha o que escolher. */
  tipo: boolean;
  /** Limite, dia de fechamento e dia de vencimento: so onde ha fatura. */
  fatura: boolean;
  /** O que o botao e o titulo do dialogo chamam a coisa. */
  substantivo: string;
}

/**
 * O que vai para a tela, a partir do escopo e so dele.
 *
 * E funcao de uma entrada, e e ela que o teste de renderizacao usa como oraculo
 * do que devia estar em tela. `camposDoEscopo("conta").fatura === false` e a
 * issue inteira em uma linha.
 */
export function camposDoEscopo(escopo: EscopoDeConta): CamposDaConta {
  if (escopo === "cartao") {
    return { tipo: false, fatura: true, substantivo: "cartão" };
  }
  return { tipo: true, fatura: false, substantivo: "conta" };
}

// ---------------------------------------------------------------------------
// OS TOTAIS
// ---------------------------------------------------------------------------

/**
 * A CONTA ENTRA NAS SOMAS? (HMO-431)
 *
 * Esta e a UNICA definicao de "esta conta conta" no app. Ela existe como funcao
 * propria, e nao como um `if` dentro de `totalDoEscopo`, porque quem precisa da
 * resposta nao e so a tela de Contas: o patrimonio, o "posso gastar" e a
 * projecao fazem a mesma pergunta, cada um em cima da propria lista de contas.
 * Tres copias de `conta.include_in_total !== false` divergiriam no dia em que a
 * regra ganhasse um segundo criterio -- e o sintoma seria o total da tela de
 * Contas discordando do patrimonio, que e o defeito mais caro de diagnosticar
 * nesta base: duas leituras, as duas plausiveis, e nenhum total que as confronte.
 *
 * `!== false`, E NAO `=== true`. A coluna e `NOT NULL DEFAULT true` no banco
 * (migration 058), entao do Postgres so vem `true` ou `false`. A diferenca
 * aparece com a resposta que NAO vem do Postgres agora: o cache offline guarda
 * contas de ANTES da 058, sem o campo, e `undefined === true` e falso -- toda
 * conta do cache sairia dos totais, e a tela mostraria "R$ 0,00" para quem
 * abrisse o app sem rede. `!== false` trata "nao sei" como "soma", que e o
 * default da coluna e o comportamento de antes da feature.
 *
 * Generica no item (so o campo interessa) para servir as listas tipadas de cada
 * leitura sem que nenhuma delas precise importar `FinancialAccount`.
 */
export function contasQueSomam<T extends { include_in_total?: boolean | null }>(
  contas: T[]
): T[] {
  return contas.filter((conta) => conta.include_in_total !== false);
}

// ---------------------------------------------------------------------------
// O MESMO CRITERIO, NAS DUAS FORMAS QUE A TELA DE CARTOES PEDE (HMO-434)
// ---------------------------------------------------------------------------
// "Faturas em aberto" nao soma `current_balance` e por isso nao passa por
// `totalDoEscopo` -- ele e a soma das FATURAS do mes, lida de
// `GET /api/card-invoices` e totalizada por `somaDasFaturas`, que recebe uma
// lista de IDS de cartao. Entao a tela de Cartoes precisa do criterio em duas
// formas que a de Contas nunca precisou: a lista de ids que entram na soma, e a
// CONTAGEM dos que ficaram de fora, que e o pedagio da frase na tela.
//
// AS DUAS DERIVAM DE `contasQueSomam`, E ISSO E O PONTO. A tentacao obvia era
// escrever `ativas.filter((c) => c.include_in_total !== false).map(...)` na
// pagina e `ativas.filter((c) => c.include_in_total === false).length` ao lado,
// e as duas estariam certas hoje -- mas seriam a segunda e a terceira copia do
// predicado, nenhuma delas no arquivo onde o comentario de `contasQueSomam`
// explica por que ele e `!== false`. No dia em que a regra ganhar um segundo
// criterio (uma conta de grupo que nao soma para quem nao e dono, por exemplo),
// a tela de Cartoes seria a que ficaria para tras -- e o sintoma seria o total
// dela discordando do de Contas sem nada na tela confrontando os dois, que e
// exatamente o defeito que `contasQueSomam` existe para nao deixar nascer.
//
// Por isso tambem a contagem e uma SUBTRACAO e nao um filtro proprio: o
// complemento de "soma" nao pode ser escrito a mao sem reabrir a pergunta do
// `!== false` versus `=== false`. `length - length` nao tem como discordar.
// ---------------------------------------------------------------------------

/**
 * Os ids dos cartoes que entram em "Faturas em aberto".
 *
 * Existe aqui, e nao na pagina, por uma razao de PROVA: `cartoes/page.tsx` e um
 * componente de cliente cheio de hooks (`useContas`, `useEstaOnline`,
 * `usePreferenciaDeMoeda`) e nao da para renderizar em `react-dom/server` --
 * logica escrita la escapa da suite inteira, que e a armadilha de
 * `formulario-de-lancamento-grava-direto-e-escapa-da-suite-de-rota`. Funcao
 * pura aqui, uma linha de fiacao la, e `test-contas.mjs` cobre o criterio.
 *
 * `id` ENTROU NO GENERICO, e e a unica diferenca em relacao a
 * `contasQueSomam`: quem consome isto e `somaDasFaturas`, que casa fatura com
 * cartao por `account_id`.
 */
export function idsDasContasQueSomam<
  T extends { id: string; include_in_total?: boolean | null }
>(contas: T[]): string[] {
  return contasQueSomam(contas).map((conta) => conta.id);
}

/**
 * Quantas contas da lista estao FORA dos totais.
 *
 * E a subtracao de proposito -- ver o bloco acima. Serve de pedagio para a
 * frase da tela: sem ela o aviso apareceria em toda carteira, inclusive nas que
 * nao usam o recurso, e aviso permanente que nao se aplica e o tipo de texto
 * que se aprende a nao ler justamente antes do mes em que ele passa a importar
 * (mesma razao de `faturaTemLinhaForaDosTotais` em lib/acoes-da-fatura.ts).
 */
export function quantasForaDosTotais<
  T extends { include_in_total?: boolean | null }
>(contas: T[]): number {
  return contas.length - contasQueSomam(contas).length;
}

/**
 * A FRASE DA TELA DE CARTOES, e ela e REQUISITO desta issue -- nao enfeite.
 *
 * Sem ela o fluxo inteiro se le como defeito, e de um jeito pior que na tela de
 * Contas. Lá o selo "· fora dos totais" fica ao lado do saldo que saiu, e o
 * "Saldo total" em cima e a soma visivel das linhas abaixo: quem soma a mao
 * acha a diferenca e o selo a explica. Aqui o numero de cima responde por um
 * MES escolhido num seletor, e a fatura do cartao desligado continua impressa
 * inteira no card dele -- entao a pessoa ve "Faturas de outubro: R$ 800,00" com
 * dois cards de R$ 400 embaixo e nenhum selo ao lado do TOTAL dizendo de onde
 * vem a falta. A conclusao disponivel e "o total esta errado", e o proximo
 * passo e lancar um ajuste para "consertar" um numero que esta certo.
 *
 * "NAO ENTRA NESTA SOMA" VEM PRIMEIRO, e a fatura inteira depois, na ordem das
 * duas perguntas: a primeira e "por que o total nao fecha", a segunda e "eu
 * mexi na fatura que vou pagar?". A segunda metade e a mesma promessa de
 * `AVISO_DA_FATURA_INTEIRA` (HMO-461) e da decisao da HMO-455 -- o flag nunca
 * mexe no que o cartao cobra, so em quem o soma.
 *
 * `null` e nao `""` quando nenhum cartao esta fora: quem desenha nao pode
 * renderizar um `<p>` vazio, que muda o espacamento do bloco sem dizer nada.
 */
export function avisoDosCartoesForaDosTotais<
  T extends { include_in_total?: boolean | null }
>(contas: T[]): string | null {
  const quantos = quantasForaDosTotais(contas);
  if (quantos <= 0) return null;

  return quantos === 1
    ? "1 cartão está fora dos totais e não entra nesta soma — a fatura dele " +
        "continua sendo cobrada por inteiro."
    : `${quantos} cartões estão fora dos totais e não entram nesta soma — as ` +
        "faturas deles continuam sendo cobradas por inteiro.";
}

/**
 * O total de UMA tela.
 *
 * Contas somam saldo com sinal: uma conta no vermelho tem que puxar o total
 * para baixo. Cartoes somam `Math.abs` porque a fatura e apresentada como
 * divida -- o valor gravado e negativo (as compras rebaixaram o saldo do
 * cartao) e "Faturas em aberto: -R$ 1.200" seria um sinal a mais na leitura.
 *
 * Somar os dois escopos separados tem que dar o mesmo que a tela unica somava
 * junta: isto e o que o teste afirma, porque a separacao nao pode mover um
 * centavo de lugar.
 *
 * A CONTA DESLIGADA SAI DAQUI (HMO-431), e o recorte vale para os DOIS escopos
 * -- mas so UM deles tem chamador hoje, e vale dizer qual para ninguem concluir
 * coisa errada a partir desta funcao:
 *
 *   - escopo `conta`: chamado pela tela de Contas (o "Saldo total"). E o
 *     caminho que esta feature usa de verdade.
 *   - escopo `cartao`: SEM CHAMADOR em producao. A tela de Cartoes somava
 *     `totalDoEscopo(ativas, "cartao")` e deixou de somar na HMO-290 -- hoje
 *     "Faturas em aberto" e a soma das FATURAS do mes, lida de
 *     `GET /api/card-invoices`, que nao passa por aqui. Ver o cabecalho de
 *     app/(dashboard)/dashboard/cartoes/page.tsx.
 *
 * O recorte fica nos dois de qualquer forma, e nao so no `conta`: deixar o
 * ramo `cartao` sem ele seria plantar um defeito para o proximo chamador, que
 * leria a assinatura ("o total do escopo") e nao teria por que suspeitar que o
 * criterio vale em metade dos casos. O teste cobre os dois ramos.
 *
 * E O QUE ISSO IMPLICA PARA A FEATURE -- JA RESOLVIDO, E NAO AQUI (HMO-434):
 * desligar um CARTAO tira a fatura dele de "Faturas em aberto", mas o recorte
 * nao passa por esta funcao e nem podia. Aquele total nasce de outra fonte (a
 * view de faturas do mes, por `GET /api/card-invoices`) e de outra grandeza
 * (`invoice_amount` de um mes, nao `current_balance`), entao quem o recorta e
 * `idsDasContasQueSomam` logo acima, consumida por `somaDasFaturas` em
 * lib/fatura-do-periodo.ts. O criterio e o MESMO (`contasQueSomam`); o que
 * muda e a forma -- lista de ids em vez de lista de contas.
 *
 * O ramo `cartao` daqui segue sem chamador, e o teste dele segue valendo pela
 * razao escrita no proprio teste: ele fixa que o criterio nao vale em metade
 * dos casos, para o dia em que alguem voltar a somar cartao por aqui.
 */
export function totalDoEscopo(
  contas: Array<
    Pick<FinancialAccount, "account_type" | "current_balance"> & {
      include_in_total?: boolean | null;
    }
  >,
  escopo: EscopoDeConta
): number {
  return contasQueSomam(contasDoEscopo(contas, escopo)).reduce(
    (soma, conta) => {
      const valor = Number(conta.current_balance ?? 0);
      return soma + (escopo === "cartao" ? Math.abs(valor) : valor);
    },
    0
  );
}

/**
 * O cartao que nao fecha fatura.
 *
 * Sem os dois dias o `card_invoice_month()` (migration 006) trata toda compra
 * como do proprio mes: a fatura nao fecha e a compra do dia 28 aparece no mes
 * errado. O aviso na tela existe por isso, e nao por capricho de cadastro.
 */
export function faltaFatura(
  conta: Pick<FinancialAccount, "account_type" | "closing_day" | "due_day">
): boolean {
  if (escopoDoTipo(conta.account_type) !== "cartao") return false;
  return !conta.closing_day || !conta.due_day;
}

// ---------------------------------------------------------------------------
// O RECORTE DA TELA (HMO-423)
// ---------------------------------------------------------------------------

/**
 * O RECORTE DA TELA DE CONTAS, lido do `?tipo=` da barra de endereco.
 *
 * Existe para o menu poder dar um caminho PARALELO as contas de investimento
 * ("Investimentos > Contas de Investimento" aponta para
 * `/dashboard/contas?tipo=investment`) sem duplicar a tela de cadastro. Uma
 * segunda tela de contas divergiria da primeira no campo seguinte -- foi o que
 * a HMO-166 desfez quando separou conta de cartao.
 *
 * `null` QUER DIZER "TODAS", e e para onde cai tudo que nao e um tipo de conta
 * valido: `?tipo=` vazio, `?tipo=banana`, e tambem `?tipo=credit_card`. O
 * ultimo e o que importa: cartao de credito nao mora nesta tela (escopo
 * `cartao`), e aceitar o recorte dele pintaria o titulo "Contas de Cartão de
 * crédito" sobre uma lista sempre vazia. Query invalida volta para a tela
 * inteira, que e o que a pessoa esperava do item "Contas".
 */
export function tipoDoRecorte(valor: string | null | undefined): AccountType | null {
  if (!valor) return null;

  const tipo = TIPOS_DE_CONTA.find(
    (t) => t.valor === valor && t.escopo === "conta"
  );

  return tipo ? tipo.valor : null;
}

/**
 * A lista da tela: todas, ou so as de um tipo.
 *
 * Generica no item (so o `account_type` interessa) para servir as ativas e as
 * arquivadas pela mesma regra -- duas regras fariam o recorte valer na lista de
 * cima e nao na gaveta de baixo.
 */
export function contasDoRecorte<T extends { account_type: AccountType }>(
  contas: T[],
  tipo: AccountType | null
): T[] {
  if (!tipo) return contas;
  return contas.filter((conta) => conta.account_type === tipo);
}

// ---------------------------------------------------------------------------
// O FORMULARIO
// ---------------------------------------------------------------------------

/**
 * O estado do formulario. Quase tudo string: e o que sai de um `<input>`.
 *
 * `include_in_total` E BOOLEANO, e e a unica excecao a regra do "tudo string"
 * acima. Ele nao vem de um `<input type="text">`, e sim de um checkbox, cujo
 * estado nativo ja e booleano -- guardar `"true"`/`"false"` aqui obrigaria cada
 * leitura a comparar com a string certa, e `"false"` e um valor VERDADEIRO em
 * JavaScript. O defeito seria o checkbox desmarcado continuar somando.
 */
export interface ValoresDaConta {
  id?: string;
  name: string;
  account_type: AccountType;
  bank_name: string;
  last_four_digits: string;
  credit_limit: string;
  closing_day: string;
  due_day: string;
  currency: string;
  /** A conta entra nos totais consolidados? (HMO-431, migration 058) */
  include_in_total: boolean;
}

/**
 * Conta nova nasce na moeda principal da pessoa, e nao em BRL fixo: quem
 * configurou dolar como moeda oficial nao quer digitar "dolar" em cada conta
 * que cria.
 *
 * O parametro e opcional porque a preferencia chega de uma leitura e demora um
 * tique; ate ela chegar o formulario nasce em `MOEDA_PADRAO`, e a tela
 * reinicializa quando abre o dialogo.
 */
export function valoresIniciais(
  escopo: EscopoDeConta,
  moedaOficial: string = MOEDA_PADRAO
): ValoresDaConta {
  return {
    name: "",
    account_type: tipoPadraoDoEscopo(escopo),
    bank_name: "",
    last_four_digits: "",
    credit_limit: "",
    closing_day: "",
    due_day: "",
    currency: moedaOficial,
    // Conta nova nasce SOMANDO, igual ao `DEFAULT true` da coluna. Nascer
    // desligada faria o cadastro criar uma conta que nao aparece em total
    // nenhum, e quem acabou de cadastrar leria isso como "o app nao salvou".
    include_in_total: true,
  };
}

/** Preenche o formulario a partir de uma conta que ja existe. */
export function valoresDaConta(conta: FinancialAccount): ValoresDaConta {
  return {
    id: conta.id,
    name: conta.name,
    account_type: conta.account_type,
    bank_name: conta.bank_name ?? "",
    last_four_digits: conta.last_four_digits ?? "",
    credit_limit: conta.credit_limit != null ? String(conta.credit_limit) : "",
    closing_day: conta.closing_day != null ? String(conta.closing_day) : "",
    due_day: conta.due_day != null ? String(conta.due_day) : "",
    // A moeda da PROPRIA conta, nunca a oficial: reabrir uma conta em dolar tem
    // que mostrar dolar. Cair na oficial aqui faria a edicao de qualquer campo
    // (trocar o nome, corrigir o dia de vencimento) gravar a moeda principal em
    // cima da moeda da conta, sem ninguem tocar nesse campo.
    currency: moedaSugerida({ daConta: conta.currency }),
    // `!== false` pelo mesmo motivo de `contasQueSomam`: uma conta vinda do
    // cache offline de antes da 058 nao tem o campo, e abrir a edicao dela
    // apresentaria o checkbox DESMARCADO -- salvar o nome tiraria a conta dos
    // totais sem ninguem ter tocado no checkbox.
    include_in_total: conta.include_in_total !== false,
  };
}

/**
 * O que impede o envio, em uma frase para quem esta preenchendo.
 *
 * Os dois dias tem CHECK de 1 a 31 no banco. Barrar aqui evita um 500 com
 * codigo 23514, que nao diz nada para quem digitou 32.
 */
export function validarConta(
  valores: ValoresDaConta,
  escopo: EscopoDeConta
): string | null {
  const campos = camposDoEscopo(escopo);

  if (!valores.name.trim()) {
    return `Dê um nome para ${escopo === "cartao" ? "o cartão" : "a conta"}`;
  }

  if (!campos.fatura) return null;

  for (const [rotulo, valor] of [
    ["fechamento", valores.closing_day],
    ["vencimento", valores.due_day],
  ] as const) {
    if (!valor) continue;
    const dia = Number(valor);
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
      return `O dia de ${rotulo} deve estar entre 1 e 31`;
    }
  }

  return null;
}

/**
 * O corpo do POST/PATCH de `/api/financial-accounts`.
 *
 * OS TRES `null` SAO O PONTO. Fora do escopo de cartao nao existe limite, nem
 * fechamento, nem vencimento -- e o que foi digitado antes de trocar de tela
 * nao pode viajar junto. A tela antiga ja zerava os dois dias, mas mandava
 * `credit_limit` sempre: dava para gravar limite numa conta corrente digitando
 * o valor com o tipo em "Cartao de credito" e trocando o tipo depois. Ninguem
 * ve, porque nenhuma tela le limite de conta -- e por isso que precisa ser
 * decidido aqui, e nao no JSX.
 */
export function corpoDaConta(
  valores: ValoresDaConta,
  escopo: EscopoDeConta
): Record<string, unknown> {
  const temFatura = camposDoEscopo(escopo).fatura;

  return {
    name: valores.name.trim(),
    account_type: valores.account_type,
    bank_name: valores.bank_name.trim(),
    last_four_digits: valores.last_four_digits.trim(),
    credit_limit: temFatura ? valores.credit_limit || null : null,
    closing_day: temFatura ? valores.closing_day || null : null,
    due_day: temFatura ? valores.due_day || null : null,
    // Sempre mandada, inclusive com o seletor escondido. Note que ela NAO segue
    // a regra dos tres `null` acima: limite e os dois dias sao de cartao, a
    // moeda e de toda conta. Mandar so quando o campo esta visivel faria a conta
    // perder a moeda que tinha no dia em que a pessoa desligasse o recurso nas
    // configuracoes e editasse o nome -- a conta em dolar voltaria a BRL calada,
    // e o relatorio dela mudaria de balde.
    currency: valores.currency,
    // Sempre mandado, nos dois escopos, pela mesma razao da moeda: o checkbox
    // e de TODA conta, e nao de cartao. Mandar so quando visivel faria a conta
    // voltar a somar no dia em que alguem editasse o nome dela por uma tela que
    // esconde o campo.
    include_in_total: valores.include_in_total,
  };
}
