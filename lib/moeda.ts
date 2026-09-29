// ---------------------------------------------------------------------------
// A MOEDA OFICIAL, O SELETOR POR LANCAMENTO, E O TOTAL QUE NAO PODE SOMAR
// TUDO (HMO-171, partes 2 e 3)
// ---------------------------------------------------------------------------
// lib/dinheiro.ts responde "como escrevo este numero". Este modulo responde as
// outras tres perguntas da issue:
//
//   qual e a moeda oficial desta pessoa?
//   o seletor de moeda por lancamento esta ligado?
//   este periodo tem mais de uma moeda -- e, se tem, como mostro separado?
//
// As duas decisoes do Helio (interaction respondida em 2026-09-29) moram aqui:
//
//   "os-dois"    a CONTA sugere, o LANCAMENTO decide. `moedaSugerida` e a unica
//                funcao que implementa essa precedencia, para que as telas nao
//                cada uma invente a sua.
//   "ficam-brl"  a moeda oficial vale para o que for criado a partir de agora.
//                Ela NAO entra em `moedaSugerida` como ultimo recurso por
//                acidente -- entra porque e o padrao de conta nova; lancamento
//                sem moeda no banco e BRL pelo DEFAULT da coluna (022), nunca
//                por esta funcao.
//
// ===========================================================================
// POR QUE A PARTE 3 E UM MODULO, E NAO UM `if` NA TELA
// ===========================================================================
// "Mostrar separado por moeda quando houver mais de uma" parece um `if` de uma
// linha. O que o torna perigoso e a pergunta que vem antes: QUANTAS moedas tem
// este periodo?
//
// A resposta ingenua -- contar as moedas distintas que voltaram do banco -- erra
// no caso mais comum de todos. `monthly_cash_flow` (022) tem uma linha por
// moeda, e uma linha pode ser toda de zeros: um mes em que a pessoa so recebeu
// em dolar ainda produz linha de BRL se houver qualquer lancamento em real
// naquele mes, inclusive um de valor que se anula. Contar linhas diria "duas
// moedas" e a tela quebraria o resultado em dois blocos, um deles inteiramente
// zerado -- "voce gastou R$ 0,00 e US$ 300,00", que faz o leitor procurar o erro
// no lugar errado.
//
// Pior: contar linhas tambem esconde o oposto. Um periodo com UMA moeda que nao
// e a oficial (a pessoa passou o mes no exterior) tem uma linha so, cai no
// caminho "nao ha mistura", e a tela mostraria o total sem dizer em que moeda
// ele esta -- um numero em dolar com R$ na frente, que e exatamente o erro que
// esta issue existe para impedir.
//
// Por isso `resumirPorMoeda` decide por MOVIMENTO, nao por linha, e sempre
// devolve a moeda de cada bloco -- mesmo quando ha so um.
// ---------------------------------------------------------------------------

import {
  MOEDAS,
  MOEDA_PADRAO,
  moedaConhecida,
  moedaPorCodigo,
} from "@/lib/dinheiro";

/** O que a tela de configuracoes guarda em `profiles.preferences.moeda`. */
export interface PreferenciaDeMoeda {
  /**
   * A moeda oficial da pessoa. E o padrao de conta nova e o bloco que aparece
   * primeiro quando o periodo tem varias moedas.
   */
  oficial: string;
  /**
   * O seletor de moeda aparece no formulario de lancamento?
   *
   * A issue e explicita: a checkbox do lancamento "deve aparecer quando
   * configurado para aparecer através das configuracoes". Desligado e o padrao,
   * e desligado o app se comporta exatamente como antes desta issue -- o que
   * importa porque a maioria das pessoas nunca vai ter um lancamento em outra
   * moeda e nao deveria ganhar um campo por causa disso.
   */
  porLancamento: boolean;
}

export const PREFERENCIA_DE_MOEDA_PADRAO: PreferenciaDeMoeda = {
  oficial: MOEDA_PADRAO,
  porLancamento: false,
};

/** A chave dentro de `profiles.preferences`. O catalogo no codigo manda. */
export const CHAVE_DE_MOEDA = "moeda";

function objeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

/**
 * Le a preferencia de moeda de dentro do jsonb do perfil.
 *
 * Tolerante de proposito, e no mesmo espirito de `moedaPorCodigo`: qualquer
 * coisa estranha no caminho (chave ausente numa conta antiga, mao humana no
 * jsonb, versao anterior do app) cai no padrao em vez de explodir. Uma
 * preferencia ilegivel nao pode deixar a tela de lancamento branca.
 *
 * O codigo passa por `moedaConhecida`, e nao e aceito como veio: um
 * `oficial: "CZK"` gravado a mao faria toda conta nova nascer numa moeda que o
 * CHECK do banco recusa, e o erro apareceria so na hora de salvar a conta, longe
 * da causa.
 */
export function lerPreferenciaDeMoeda(preferences: unknown): PreferenciaDeMoeda {
  const raiz = objeto(preferences);
  const bloco = raiz ? objeto(raiz[CHAVE_DE_MOEDA]) : null;
  if (!bloco) return { ...PREFERENCIA_DE_MOEDA_PADRAO };

  return {
    oficial: moedaConhecida(bloco.oficial)
      ? String(bloco.oficial).trim().toUpperCase()
      : PREFERENCIA_DE_MOEDA_PADRAO.oficial,
    // `=== true` e nao um truthy: um `"false"` (string) vindo de um formulario
    // mal serializado e truthy em JavaScript, e ligaria o campo para alguem que
    // pediu o contrario.
    porLancamento: bloco.porLancamento === true,
  };
}

/**
 * O `preferences` inteiro, com o bloco de moeda trocado.
 *
 * Devolve o objeto COMPLETO porque e isso que a rota grava na coluna.
 * `preferences` nao e "as configuracoes de moeda": e o jsonb inteiro do perfil
 * -- painel, notificacoes, privacidade. Um PUT que escrevesse `{ moeda: ... }`
 * direto apagaria o resto, e apagaria em silencio: a moeda passaria a funcionar
 * exatamente como o usuario pediu enquanto o layout do painel voltava ao padrao
 * sem nenhuma mensagem.
 */
export function mesclarPreferenciaDeMoeda(
  preferencesAtuais: unknown,
  nova: PreferenciaDeMoeda
): Record<string, unknown> {
  const raiz = objeto(preferencesAtuais) ?? {};
  const bloco = objeto(raiz[CHAVE_DE_MOEDA]) ?? {};
  return {
    ...raiz,
    [CHAVE_DE_MOEDA]: { ...bloco, oficial: nova.oficial, porLancamento: nova.porLancamento },
  };
}

/**
 * Valida o corpo do PUT de configuracoes.
 *
 * Recusa em vez de corrigir. `lerPreferenciaDeMoeda` e tolerante porque le dado
 * que JA existe e nao pode derrubar a tela; a ESCRITA e o oposto -- aceitar
 * "CZK" silenciosamente trocado por "BRL" mostraria "salvo" com outra moeda
 * gravada, e a pessoa descobre no proximo lancamento.
 */
export function validarPreferenciaDeMoeda(
  corpo: unknown
): { ok: true; valor: PreferenciaDeMoeda } | { ok: false; erro: string } {
  const bloco = objeto(corpo);
  if (!bloco) return { ok: false, erro: "Corpo inválido" };

  if (!moedaConhecida(bloco.oficial)) {
    return { ok: false, erro: "Escolha uma moeda da lista" };
  }

  // `porLancamento` ausente NAO vira `false`: a tela de configuracoes manda os
  // dois campos juntos, e um corpo sem a chave e bug de cliente. Assumir
  // `false` desligaria o seletor de moeda de quem so quis trocar a moeda
  // oficial -- e as contas em dolar dessa pessoa perderiam o campo que as
  // explica.
  if (typeof bloco.porLancamento !== "boolean") {
    return { ok: false, erro: "Envie `porLancamento` como booleano" };
  }

  return {
    ok: true,
    valor: {
      oficial: String(bloco.oficial).trim().toUpperCase(),
      porLancamento: bloco.porLancamento,
    },
  };
}

/**
 * A moeda que o formulario de lancamento deve sugerir.
 *
 * E a precedencia da resposta "os-dois", num lugar so:
 *
 *   1. a moeda do proprio lancamento, quando ele ja existe (edicao). Ela ganha
 *      de tudo -- reabrir um lancamento em dolar nao pode mostrar reais;
 *   2. a moeda da CONTA escolhida;
 *   3. a moeda oficial da pessoa, para quando nao ha conta escolhida ainda.
 *
 * A ordem entre 1 e 2 e a parte que erra facil. Trocar uma pela outra faz a
 * edicao de um lancamento antigo herdar a moeda ATUAL da conta: quem mudou a
 * conta de BRL para USD veria todo lancamento passado dela reaberto em dolar e,
 * ao salvar sem mexer em nada, gravaria a moeda nova -- o historico convertido
 * sem ninguem pedir, na razao de 1 para 1.
 */
export function moedaSugerida(entrada: {
  doLancamento?: string | null;
  daConta?: string | null;
  oficial?: string | null;
}): string {
  if (moedaConhecida(entrada.doLancamento)) {
    return String(entrada.doLancamento).trim().toUpperCase();
  }
  if (moedaConhecida(entrada.daConta)) {
    return String(entrada.daConta).trim().toUpperCase();
  }
  if (moedaConhecida(entrada.oficial)) {
    return String(entrada.oficial).trim().toUpperCase();
  }
  return MOEDA_PADRAO;
}

/** Uma linha de `monthly_cash_flow` (022), como a rota devolve. */
export interface LinhaDePeriodo {
  currency?: string | null;
  income?: number | string | null;
  expense?: number | string | null;
  net?: number | string | null;
  transaction_count?: number | string | null;
}

/** Um bloco de resultado, todo numa unica moeda. */
export interface ResumoDeMoeda {
  moeda: string;
  simbolo: string;
  income: number;
  expense: number;
  net: number;
  transacoes: number;
}

function numero(valor: unknown): number {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === "string") {
    const n = Number.parseFloat(valor);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/**
 * Agrupa as linhas de um periodo por moeda, e devolve um bloco por moeda que
 * teve MOVIMENTO.
 *
 * "Movimento" e o critério, e nao "a linha existe" -- ver o cabecalho deste
 * arquivo. Uma linha de moeda toda zerada (que o banco produz sempre que o mes
 * tem qualquer lancamento naquela moeda, inclusive um par que se anula) nao
 * vira bloco: a tela nao mostra "voce gastou R$ 0,00 e US$ 300,00".
 *
 * `transacoes > 0` conta como movimento mesmo com valores zerados: houve
 * lancamento, e esconder o bloco faria a contagem da tela nao fechar com a
 * lista. O que nao vira bloco e a moeda sem lancamento NENHUM.
 *
 * A ORDEM: a moeda oficial primeiro, o resto por volume de movimento decrescente
 * e o empate pelo codigo. Ordenar por soma de entrada e saida, e nao por
 * `net`, e deliberado: `net` de um mes caro e muito negativo e ordenar por ele
 * jogaria a moeda mais movimentada para o fim.
 *
 * Nao existe total geral de proposito, e e a razao desta funcao devolver uma
 * LISTA em vez de um objeto com `total`: nao ha cotacao neste app, e qualquer
 * campo chamado `total` aqui seria somado por alguem um dia.
 */
export function resumirPorMoeda(
  linhas: LinhaDePeriodo[] | null | undefined,
  moedaOficial: string = MOEDA_PADRAO
): ResumoDeMoeda[] {
  const oficial = moedaSugerida({ oficial: moedaOficial });
  const porMoeda = new Map<string, ResumoDeMoeda>();

  for (const linha of linhas ?? []) {
    // Linha sem moeda e linha de antes da 022 (ou de uma view que esqueceu a
    // coluna). Ela e BRL pelo DEFAULT, e tratar como BRL e o que mantem o
    // numero visivel: descartar faria dinheiro desaparecer da tela.
    const codigo = moedaSugerida({ doLancamento: linha.currency });
    const atual =
      porMoeda.get(codigo) ??
      {
        moeda: codigo,
        simbolo: moedaPorCodigo(codigo).simbolo,
        income: 0,
        expense: 0,
        net: 0,
        transacoes: 0,
      };

    atual.income += numero(linha.income);
    atual.expense += numero(linha.expense);
    atual.net += numero(linha.net);
    atual.transacoes += numero(linha.transaction_count);
    porMoeda.set(codigo, atual);
  }

  // `Array.from` e nao spread: o tsconfig do app tem target abaixo de es2015 e
  // `[...map.values()]` nao compila lá (TS2802). O tsconfig da suite usa es2020 e
  // aceita os dois -- entao o spread passava no `npm run test:moeda` e reprovava
  // no `tsc --noEmit` do projeto, que e o que o CI roda.
  const blocos = Array.from(porMoeda.values()).filter(
    (b) => b.transacoes > 0 || b.income !== 0 || b.expense !== 0
  );

  blocos.sort((a, b) => {
    if (a.moeda === oficial && b.moeda !== oficial) return -1;
    if (b.moeda === oficial && a.moeda !== oficial) return 1;
    const volume = b.income + b.expense - (a.income + a.expense);
    if (volume !== 0) return volume;
    return a.moeda.localeCompare(b.moeda);
  });

  return blocos;
}

/**
 * O periodo tem mais de uma moeda com movimento?
 *
 * E a pergunta que a issue faz ("caso tenham lançamentos em moedas diferentes,
 * para aquele periodo"). Sai de `resumirPorMoeda` -- e nao de um `Set` sobre as
 * linhas -- para que as duas respostas nao possam discordar: uma tela que
 * decidisse mostrar separado por um criterio e montasse os blocos por outro
 * poderia anunciar "varias moedas" e renderizar um bloco so.
 */
export function periodoTemVariasMoedas(
  linhas: LinhaDePeriodo[] | null | undefined,
  moedaOficial: string = MOEDA_PADRAO
): boolean {
  return resumirPorMoeda(linhas, moedaOficial).length > 1;
}

/** As moedas que o `<select>` oferece, na ordem do catalogo. */
export function opcoesDeMoeda(): { codigo: string; rotulo: string }[] {
  return MOEDAS.map((m) => ({
    codigo: m.codigo,
    // Codigo + nome + simbolo: "USD - Dólar americano (US$)". So o simbolo nao
    // basta -- ha quatro dolares no catalogo, e tres deles usam variacao de "$".
    rotulo: `${m.codigo} - ${m.nome} (${m.simbolo})`,
  }));
}
