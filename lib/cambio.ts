// ---------------------------------------------------------------------------
// O CAMBIO DO DIA DA COMPRA (HMO-182, metade de app do item 3 da HMO-138)
// ---------------------------------------------------------------------------
// A migration 026 gravou a decisao do Helio no schema. Este modulo e a metade
// que roda antes do banco, e existe por um motivo concreto: a 026 pos um CHECK
// que CRUZA duas colunas, e uma delas o app ja escrevia.
//
//     CHECK ((currency = 'BRL') = (exchange_rate = 1))
//
// Leia essa linha como as duas afirmacoes que ela realmente faz:
//
//   1. lancamento em BRL tem de ter cotacao exatamente 1;
//   2. lancamento em QUALQUER outra moeda NAO pode ter cotacao 1.
//
// A segunda e a que morde. `exchange_rate` nasceu com `DEFAULT 1`, entao todo
// INSERT que manda `currency: 'USD'` e nao manda cotacao nenhuma monta uma
// linha (USD, 1) -- e o banco a recusa com 23514. Nao e um caso de borda: e
// TODO lancamento em moeda estrangeira, porque o default acerta exatamente o
// valor proibido.
//
// Por isso `cotacaoCoerente` nao e uma validacao de formulario a mais. Ela e a
// MESMA regra do CHECK escrita em TypeScript, para a tela poder dizer o que
// falta em vez de deixar o Postgres devolver um erro que a pessoa nao pode
// consertar. Se as duas versoes discordarem, quem ganha e o banco -- e o
// sintoma sera "Erro ao gravar o lancamento" sem mais nada.
//
// ===========================================================================
// POR QUE A COTACAO E OBRIGATORIA MAS A BUSCA DELA NAO
// ===========================================================================
// A decisao foi `ptax_editavel`: a cotacao vem do Banco Central e a pessoa pode
// corrigir. O que a palavra "editavel" garante nao e conveniencia, e que o
// formulario continue salvavel quando a busca falha -- e ela falha de tres
// jeitos previsiveis, mais um quarto que so aparece quando se le a API:
//
//   fim de semana    sabado e domingo nao tem boletim. Nenhum.
//   feriado          idem, e o calendario nao e o civil (bancario).
//   API fora do ar   acontece, e nao pode virar 500 na cara de quem lanca.
//   moeda sem PTAX   (o quarto) a PTAX NAO cobre todas as moedas do app.
//
// O quarto caso foi medido, nao suposto: o endpoint /Moedas do Olinda lista
// DEZ moedas, e o catalogo do app (lib/dinheiro.ts) tem treze. Cinco moedas do
// app -- ARS, CLP, UYU, PYG e CNY -- nao tem PTAX nenhuma, nunca, e por acaso
// sao as dos vizinhos de carro (Argentina, Chile, Uruguai, Paraguai). Para elas
// "nao consegui buscar" seria uma mentira: nao ha o que buscar. A tela precisa
// separar SEM_COBERTURA de INDISPONIVEL, porque a primeira nunca vai melhorar
// tentando de novo e a segunda vai.
//
// ===========================================================================
// O BOLETIM QUE VALE E O DE FECHAMENTO, E O ULTIMO DA LISTA NAO E ELE
// ===========================================================================
// Um dia util devolve cinco boletins: Abertura, tres Intermediarios e
// "Fechamento PTAX". A leitura preguicosa -- pegar `value[value.length - 1]` --
// acerta num dia que ja terminou e erra exatamente onde importa: num lancamento
// feito HOJE, no meio da tarde, o ultimo boletim e um Intermediario. Ele seria
// congelado no lancamento com o nome de PTAX do dia, e nunca mais conferiria
// com a PTAX de verdade daquela data.
//
// Por isso `escolherBoletim` so aceita `tipoBoletim === 'Fechamento PTAX'`. Dia
// sem fechamento e tratado igual a fim de semana: anda para tras. A consequencia
// e desejada -- uma compra de hoje pega o fechamento de ontem e a tela DIZ de
// que dia e a cotacao, em vez de fingir precisao que nao existe.
// ---------------------------------------------------------------------------

import { MOEDA_PADRAO, moedaConhecida } from "@/lib/dinheiro";

/**
 * As moedas que a PTAX cobre.
 *
 * Nao e uma escolha nossa: e o que o endpoint
 * `/olinda/servico/PTAX/versao/v1/odata/Moedas` devolve. Conferido em
 * 2026-09-29 -- dez moedas. DKK, NOK e SEK estao aqui e nao no catalogo do app;
 * ficam na lista porque esta constante descreve a API do Banco Central, nao o
 * seletor da tela. Quem cruza as duas listas e `ptaxCobre`.
 */
export const MOEDAS_COM_PTAX: readonly string[] = [
  "AUD",
  "CAD",
  "CHF",
  "DKK",
  "EUR",
  "GBP",
  "JPY",
  "NOK",
  "SEK",
  "USD",
];

/**
 * Quantos dias andar para tras procurando um fechamento.
 *
 * Dez cobre o pior caso real do calendario brasileiro: um Carnaval colado num
 * fim de semana, ou o Natal/Ano Novo com feriado no meio da semana. Existe um
 * teto porque sem ele uma moeda recem-incluida na PTAX faria a rota varrer o
 * historico inteiro a cada digitacao.
 */
export const MAX_DIAS_PARA_TRAS = 10;

/** De onde saiu a cotacao que a tela esta mostrando. */
export type OrigemDaCotacao =
  /** Fechamento PTAX da propria data da compra. O caso bom. */
  | "ptax"
  /** Fechamento PTAX de um dia anterior (fim de semana, feriado, dia em aberto). */
  | "ptax_anterior"
  /** A PTAX nao cobre esta moeda. Tentar de novo nao muda nada. */
  | "sem_cobertura"
  /** A API nao respondeu, ou respondeu o que nao se esperava. Tentar de novo pode resolver. */
  | "indisponivel";

export interface Cotacao {
  /**
   * Quantos reais vale UMA unidade da moeda, ou `null` quando nao houve
   * cotacao.
   *
   * O `null` e obrigatorio no tipo, e e a parte que importa. A alternativa
   * tentadora -- devolver 1 quando a busca falha, "para o campo nao ficar
   * vazio" -- e a pior falha que este modulo pode ter: 1 e justamente o valor
   * que o CHECK da 026 proibe para moeda estrangeira, e se algum dia o CHECK
   * saisse, o banco aceitaria a linha e a despesa de 180 dolares entraria no
   * acerto da viagem valendo 180 reais. `null` obriga quem chama a decidir.
   */
  taxa: number | null;
  /** A data do boletim que produziu a taxa, em ISO. Nulo quando nao houve boletim. */
  dataDoBoletim: string | null;
  origem: OrigemDaCotacao;
}

/** Um boletim da PTAX, como o Olinda devolve. */
export interface BoletimPtax {
  cotacaoCompra: number;
  cotacaoVenda: number;
  dataHoraCotacao: string;
  tipoBoletim: string;
}

/** O rotulo exato do boletim que fecha o dia. Qualquer outro e parcial. */
export const BOLETIM_DE_FECHAMENTO = "Fechamento PTAX";

/**
 * A PTAX cobre esta moeda?
 *
 * Cruza o catalogo do app com a lista do Banco Central. Uma moeda que o app nao
 * conhece responde `false` pelo mesmo caminho de uma que a PTAX nao cobre --
 * as duas terminam em digitacao manual, que e o comportamento certo para as
 * duas.
 */
export function ptaxCobre(moeda: string | null | undefined): boolean {
  if (!moeda) return false;
  const codigo = String(moeda).trim().toUpperCase();
  if (!moedaConhecida(codigo)) return false;
  return MOEDAS_COM_PTAX.includes(codigo);
}

/**
 * Este lancamento precisa que alguem informe uma cotacao?
 *
 * So BRL dispensa. E dispensa porque a cotacao dele e 1 por definicao, nao
 * porque o campo e opcional -- `taxaParaGravar` grava o 1 explicitamente.
 */
export function precisaDeCotacao(moeda: string | null | undefined): boolean {
  const codigo = String(moeda ?? MOEDA_PADRAO)
    .trim()
    .toUpperCase();
  return codigo !== MOEDA_PADRAO;
}

/**
 * A regra do CHECK `financial_transactions_rate_matches_currency`, em TypeScript.
 *
 * Mesma forma que o SQL de proposito -- `(moeda === BRL) === (taxa === 1)` --
 * para que ler as duas lado a lado seja suficiente para ver que concordam. Um
 * `if` encadeado equivalente ja teria divergido na primeira manutencao.
 *
 * A taxa tem de ser finita e positiva antes disso, que e o outro CHECK
 * (`exchange_rate > 0`). `NaN` chega aqui com facilidade: e o que
 * `Number.parseFloat("")` devolve.
 */
export function cotacaoCoerente(
  moeda: string | null | undefined,
  taxa: number | null | undefined
): boolean {
  if (taxa === null || taxa === undefined) return false;
  if (!Number.isFinite(taxa) || taxa <= 0) return false;

  const codigo = String(moeda ?? MOEDA_PADRAO)
    .trim()
    .toUpperCase();

  return (codigo === MOEDA_PADRAO) === (taxa === 1);
}

/**
 * A cotacao que vai para a coluna, ou `null` quando ainda nao da para gravar.
 *
 * `null` e um resultado de verdade, nao um erro esquecido: e o que segura o
 * INSERT de sair para o banco em moeda estrangeira sem cotacao. Quem chama tem
 * de tratar -- e por isso o tipo obriga.
 *
 * BRL ignora o que foi digitado e devolve 1. Parece rude e e proposital: a unica
 * alternativa e deixar passar uma linha (BRL, 1.05) que o banco recusa, com um
 * erro que a pessoa nao tem como associar ao campo de cotacao que ela nem ve.
 */
export function taxaParaGravar(
  moeda: string | null | undefined,
  taxaDigitada: number | null | undefined
): number | null {
  if (!precisaDeCotacao(moeda)) return 1;
  if (!cotacaoCoerente(moeda, taxaDigitada)) return null;
  return taxaDigitada as number;
}

/**
 * O que a pessoa digitou no campo de cotacao, como numero -- ou `null`.
 *
 * Aceita virgula E ponto como separador decimal. A virgula porque o teclado
 * brasileiro produz virgula: quem digita "5,42" num campo que so entende ponto
 * veria `NaN`, e o formulario recusaria uma cotacao escrita corretamente para o
 * idioma da tela. O ponto porque metade das pessoas digita "5.42" de qualquer
 * forma.
 *
 * O CASO AMBIGUO, E PARA QUE LADO ELE CAI
 * ---------------------------------------
 * "1.234" nao tem leitura unica: em pt-BR o ponto e separador de MILHAR, entao
 * pode ser 1234; como decimal, e 1,234. Nao ha como saber qual a pessoa quis.
 *
 * Esta funcao le como 1,234 -- decimal -- e a escolha e pelo lado que FALHA
 * VISIVEL. Se alguem digitou um valor no campo errado (querendo R$ 1.234,00),
 * ler como 1,234 faz o rodape do campo mostrar "US$ 180 = R$ 222,12", um numero
 * pequeno e obviamente errado na tela, antes de salvar. Ler como 1234 mostraria
 * R$ 222.120,00 -- igualmente errado e muito mais facil de nao notar, porque
 * numero grande em tela de financas nao chama atencao.
 *
 * O teto de tres digitos inteiros (`\d{1,3}`) e o que sobra de guarda: nenhuma
 * moeda do catalogo vale mil reais por unidade, entao "5421,00" ou "1.234,56" --
 * as formas em que um VALOR realmente aparece -- sao recusadas e a validacao
 * pede de novo.
 */
export function cotacaoDigitada(texto: string | null | undefined): number | null {
  const cru = String(texto ?? "").trim();
  if (cru === "") return null;
  if (!/^\d{1,3}([.,]\d{1,8})?$/.test(cru)) return null;
  const n = Number(cru.replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * A data no formato que o Olinda exige: MM-DD-YYYY.
 *
 * Mes e dia na ordem americana mesmo -- e a unica ordem que aquele endpoint
 * aceita. Trocar por DD-MM nao da erro: devolve lista vazia, que este modulo
 * leria como feriado. Um 09-13 viraria "13 de setembro" num mes e "sem boletim"
 * no outro, e o unico sintoma seria a cotacao vindo do dia errado.
 */
export function dataParaPtax(dataISO: string): string {
  const [ano, mes, dia] = dataISO.slice(0, 10).split("-");
  return `${mes}-${dia}-${ano}`;
}

/**
 * As datas a tentar, da compra para tras.
 *
 * Sempre para TRAS. Andar para frente resolveria o fim de semana com duas linhas
 * menos de codigo e quebraria a razao de existir desta issue: a cotacao de
 * depois da compra faz o valor do passado mudar. Uma compra de sabado vale pela
 * sexta, nunca pela segunda.
 *
 * A aritmetica e toda em UTC -- construcao (`T00:00:00Z`), subtracao
 * (`setUTCDate`) e formatacao (`toISOString`) -- e o que importa e que sejam as
 * TRES. Trocar `setUTCDate` por `setDate` aqui nao muda nada, porque somar dias
 * a um instante fixo da no mesmo em fuso sem horario de verao (o Brasil nao tem
 * desde 2019); medido, o mutante sobrevive.
 *
 * O que quebra e MISTURAR: construir em UTC e formatar com os componentes locais
 * (`getFullYear`/`getMonth`/`getDate`). Em America/Sao_Paulo a meia-noite UTC do
 * dia 26 e 21h do dia 25, entao a lista inteira sairia um dia antes da compra --
 * a cotacao viria sempre do dia anterior, e nada na tela apontaria isso. Esse
 * mutante morre em sete asercoes, e e o que o caso "a primeira data e a da
 * compra" existe para prender.
 */
export function datasParaTentar(
  dataISO: string,
  maxDias: number = MAX_DIAS_PARA_TRAS
): string[] {
  const base = dataISO.slice(0, 10);
  const inicio = new Date(`${base}T00:00:00Z`);
  if (Number.isNaN(inicio.getTime())) return [];

  const datas: string[] = [];
  for (let i = 0; i <= maxDias; i += 1) {
    const d = new Date(inicio.getTime());
    d.setUTCDate(d.getUTCDate() - i);
    datas.push(d.toISOString().slice(0, 10));
  }
  return datas;
}

/**
 * O boletim de fechamento de uma resposta do Olinda, ou `null`.
 *
 * So fechamento. Ver o cabecalho: o ultimo item da lista e um Intermediario
 * enquanto o dia nao terminou, e congelar um Intermediario grava um numero que
 * nunca mais vai conferir com a PTAX daquela data.
 */
export function escolherBoletim(
  boletins: readonly BoletimPtax[] | null | undefined
): BoletimPtax | null {
  if (!Array.isArray(boletins) || boletins.length === 0) return null;
  const fechamento = boletins.filter(
    (b) => b && b.tipoBoletim === BOLETIM_DE_FECHAMENTO
  );
  if (fechamento.length === 0) return null;
  // Se um dia vierem dois fechamentos, o ultimo e o que vale (retificacao).
  return fechamento[fechamento.length - 1];
}

/**
 * A taxa de um boletim.
 *
 * `cotacaoVenda` porque uma despesa no exterior e uma COMPRA de moeda: quem
 * gastou 180 dolares precisou comprar 180 dolares, e o lado de venda do boletim
 * e o preco de quem compra. Usar `cotacaoCompra` subestimaria todo gasto de
 * viagem de forma consistente -- pouco, sempre para o mesmo lado, e sem nada na
 * tela que denuncie.
 */
export function taxaDoBoletim(boletim: BoletimPtax): number | null {
  const taxa = Number(boletim?.cotacaoVenda);
  if (!Number.isFinite(taxa) || taxa <= 0) return null;
  return taxa;
}

/**
 * A taxa que a propria transferencia revela.
 *
 * Numa transferencia entre uma conta em real e uma em moeda estrangeira, a
 * cotacao nao precisa de API nenhuma: ela esta nos dois valores. R$ 1.000 que
 * viraram US$ 180 foram cambiados a 5,5556 -- a taxa REAL da operacao, com
 * spread e IOF embutidos, que e melhor que a PTAX daquele dia justamente por
 * incluir o que a pessoa de fato pagou.
 *
 * Recebe os dois valores em modulo; sinal aqui nao significa nada (uma perna e
 * negativa por construcao, ver lib/dinheiro.ts).
 */
export function taxaImplicita(
  valorEmReais: number,
  valorNaMoeda: number
): number | null {
  const reais = Math.abs(Number(valorEmReais));
  const moeda = Math.abs(Number(valorNaMoeda));
  if (!Number.isFinite(reais) || !Number.isFinite(moeda)) return null;
  if (reais === 0 || moeda === 0) return null;
  const taxa = reais / moeda;
  if (!Number.isFinite(taxa) || taxa <= 0) return null;
  return taxa;
}

/**
 * O valor em reais de um lancamento, pela cotacao que ele carrega.
 *
 * O arredondamento e para centavo de real, e e aqui porque as views da 026
 * fazem a mesma conta no banco (`t.amount * t.exchange_rate`). Uma tela que
 * arredonde diferente do banco mostra um total que nao fecha com o extrato, e
 * a diferenca de um centavo e o tipo de coisa que ninguem consegue explicar
 * depois.
 */
export function valorEmReais(valor: number, taxa: number): number {
  return Math.round(Number(valor) * Number(taxa) * 100) / 100;
}
