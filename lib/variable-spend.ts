// =====================================================
// GASTO VARIAVEL DO DIA A DIA (HMO-145)
// =====================================================
// O buraco que a previsao de fluxo de caixa deixou aberto de proposito.
//
// O lib/cash-flow-forecast.ts projeta so o que esta COMPROMETIDO -- conta
// prevista e assinatura detectada -- e o rodape da tela diz, em voz alta, que
// mercado, restaurante e posto nao entram. Isso torna a linha honesta e
// OTIMISTA ao mesmo tempo: a data de mergulho que ela anuncia e sempre mais
// tarde que a real, e para quem vive perto do zero a diferenca e o mes inteiro.
//
// Este arquivo calcula a peca que faltava: quanto sai por dia, em media, sem
// que exista uma conta pedindo. Ele NAO decide nada sozinho -- devolve um
// numero com a procedencia junto (quantos meses o sustentam, quais meses sao,
// o que foi descartado), porque a razao original para nao inventar essa media
// continua valendo: uma DATA que nasce de um numero invisivel e uma data que o
// usuario nao tem como conferir nem corrigir. A media so pode entrar na conta
// se ela aparecer na tela e puder ser mudada la.
//
// Tudo aqui e funcao pura: nao le banco, nao pede login, nao grava. Mesmo
// desenho do lib/anomalies.ts e do lib/cash-flow-forecast.ts, e pela mesma
// razao -- e o que permite a prova caber em teste unitario, sem Postgres.
//
// -----------------------------------------------------------------------
// A ARMADILHA CENTRAL: CONTAR A NETFLIX DUAS VEZES
// -----------------------------------------------------------------------
// A media ingenua -- somar toda despesa do mes e dividir por 30 -- inclui a
// Netflix, o aluguel e a academia. Mas essas TRES ja entram na previsao como
// evento datado. Somar as duas coisas cobra a assinatura duas vezes e a linha
// provavel mergulha num dia que nao vai acontecer.
//
// E a mesma familia da armadilha 1 do lib/cash-flow-forecast.ts (a cobranca que
// existe como conta prevista E como recorrencia detectada), com uma diferenca
// que muda o remedio: la as duas fontes tem DATA e da para casar cobranca a
// cobranca; aqui um lado e um agregado mensal, e nao ha cobranca para casar.
// Por isso a exclusao e por CHAVE de estabelecimento, com o mesmo
// `normalizeMerchant` que o detector usa -- e nao por valor ou por data.
//
// -----------------------------------------------------------------------
// E A ARMADILHA DE DENTRO DELA: EXCLUIR DE MAIS
// -----------------------------------------------------------------------
// Excluir uma chave que a previsao NAO projeta e pior que nao excluir nada: o
// gasto some das DUAS metades -- nao esta na media, nao vira evento -- e a
// linha "provavel" fica mais otimista que a "otimista". O erro e invisivel,
// porque o numero continua plausivel.
//
// Dai a regra: `chavesComprometidas` tem que ser exatamente o conjunto que
// vira evento recorrente na previsao. Duas fontes, e so duas:
//
//   * assinaturas detectadas em `DETECTED` ou `CONFIRMED`. `IGNORED` e o
//     usuario dizendo "isto NAO e assinatura" -- aquele gasto e variavel e
//     TEM que continuar na media. `CANCELLED` idem: nao projeta evento, entao
//     nao pode ser descontado da media (o historico dele so sai da janela com
//     o tempo, e ate la e gasto que de fato aconteceu).
//
//   * regras recorrentes ativas (`recurring_rules`), que geram conta prevista
//     todo periodo.
//
// Conta prevista AVULSA fica FORA da exclusao, e essa e a parte contraintuitiva:
// ela tambem vira evento na previsao. Mas ela acontece UMA vez, enquanto a
// media fala de todo mes. Uma conta avulsa "Mercado Extra" cadastrada para o
// dia 20 excluiria todo o historico de supermercado da media -- a maior
// categoria variavel de quase todo mundo -- para compensar um evento unico.
// O erro de nao excluir e cobrar uma vez a mais um valor que o usuario
// digitou; o de excluir e apagar a maior parcela do gasto variavel. Nao sao
// comparaveis.
//
// -----------------------------------------------------------------------
// AS OUTRAS TRES, E ONDE CADA UMA E FECHADA
// -----------------------------------------------------------------------
//
//   1. O SINAL. Despesa e gravada NEGATIVA neste banco, e um `SUM` cru devolve
//      -1.800 para quem gastou 1.800. Aqui ninguem le `amount` direto: quem le
//      e o `gastoDaTransacao` do lib/anomalies.ts, que filtra por
//      `transaction_type` e usa ABS. Importar a funcao em vez de repetir a
//      regra e o ponto -- duas copias dessa decisao e como a segunda erra.
//      O filtro por `transaction_type` tambem e o que descarta as duas pernas
//      `transfer` do pagamento de fatura (HMO-149): o mesmo dinheiro mudando
//      de lugar nao e gasto novo.
//
//   2. O MES CORRENTE. Ele esta pela metade. Entrar na base puxaria a mediana
//      para baixo todo dia 3 e a linha provavel ficaria otimista exatamente no
//      comeco do mes, que e quando ela tem mais dias pela frente para errar.
//      So mes FECHADO entra. (O lib/anomalies.ts resolve o mesmo problema de
//      outro jeito -- corta o historico no mesmo dia do mes -- porque la o mes
//      corrente E o objeto da pergunta. Aqui ele nao e.)
//
//   3. MES SEM MOVIMENTO. Quem importou extrato de marco e de setembro tem
//      cinco meses vazios no meio. Contar zero neles derrubaria a mediana para
//      perto de zero e a "linha provavel" voltaria a ser a otimista com outro
//      nome. Mes vazio e ausencia de DADO, nao um mes barato: sai da base.
//      Mesma decisao do `compararComHistorico`, pela mesma razao.
//
//   4. USUARIO NOVO. Sem meses fechados suficientes nao existe "normal", e o
//      honesto e nao desenhar a segunda linha -- nao desenha-la em zero, que
//      e indistinguivel de "voce nao gasta nada". `temBase` carrega essa
//      diferenca para a tela, e `porDia` fica em zero para quem ignorar a flag
//      errar para o lado de nao mudar nada.
//
// -----------------------------------------------------------------------
// A ABERTURA POR CATEGORIA, E POR QUE ELA PRECISA DE UM RESIDUO
// -----------------------------------------------------------------------
// Um numero so ("R$ 62 por dia") nao da para conferir nem para corrigir: o
// usuario nao sabe se ele esta alto por causa do mercado ou do restaurante, e
// sem saber disso nao tem o que mexer. A abertura por categoria existe para
// isso -- e assim que o usuario pode mexer em cada linha, a soma das partes
// PRECISA fechar com o total. Senao mudar o mercado em -200 move a linha em
// outra coisa qualquer, e a tela perde o unico atributo que a torna util.
//
// E aqui mora um fato desconfortavel: A MEDIANA NAO E ADITIVA. A mediana dos
// totais mensais nao e a soma das medianas por categoria, porque os picos de
// cada categoria caem em MESES DIFERENTES e cada mediana descarta o pico da
// sua propria categoria -- descartando, no total, mais do que a mediana do
// total descartou. Com 3 meses de (mercado 800/900/1000, restaurante
// 500/300/400) a mediana do total e 1.300 e a soma das medianas e 900+400 =
// 1.300 por acaso; basta um mes em que os dois sobem juntos para os dois
// numeros se separarem.
//
// Ha tres saidas, e duas sao ruins:
//
//   * trocar o total pela soma das medianas por categoria. Mudaria o numero
//     que ja esta em producao e o deixaria MENOS robusto: quanto mais fina a
//     categoria, mais pico cada mediana joga fora, e o total encolhe -- ou
//     seja, a linha provavel ficaria mais otimista so porque o usuario
//     categorizou melhor. Errado no sentido perigoso.
//
//   * ratear o total entre as categorias proporcionalmente ao gasto. Fecha a
//     conta, mas o numero de cada linha deixa de ser a mediana daquela
//     categoria e passa a ser um numero que nao existe em lugar nenhum do
//     extrato. Confere e nao e verdade.
//
//   * publicar a diferenca como uma linha propria, que e o que este arquivo
//     faz. Cada categoria mostra a SUA mediana -- conferivel contra o extrato
//     -- e `residuoPorMes` carrega o que falta para fechar com o total. Por
//     construcao: soma das categorias + residuo == `porMes`, exatamente. Ha
//     teste so para esse invariante, e ele e o que segura a edicao por
//     categoria.
//
// O residuo pode ser NEGATIVO (quando as categorias sobem juntas, a soma das
// medianas passa a mediana do total) e isso nao e bug. Quem escreve a tela
// precisa saber disso: um rotulo do tipo "outros gastos" mentiria na metade
// dos casos.
//
// A base de cada categoria sao os MESMOS meses fechados do total, contando
// ZERO no mes em que aquela categoria nao teve movimento -- e essa e a
// diferenca em relacao ao `compararComHistorico` do lib/anomalies.ts, que
// descarta o mes vazio. La a pergunta e "este mes foi atipico PARA esta
// categoria", e diluir a farmacia pelos meses sem farmacia faria a primeira
// compra do ano virar anomalia. Aqui a pergunta e "quanto sai por mes, no
// total", e quem compra farmacia em 1 de 6 meses gasta mesmo pouco por mes
// com farmacia. Descartar o zero aqui somaria seis medianas de meses cheios e
// estouraria o total.
// =====================================================

import { mediana, normalizeMerchant } from "@/lib/recurrence-detector";
import { gastoDaTransacao, mesDe, mesAnterior, type TransacaoParaAnomalia } from "@/lib/anomalies";

/** Quantos meses FECHADOS a janela olha para tras, por padrao. */
export const MESES_JANELA_PADRAO = 6;

/** Teto da janela. Alem disso o "normal" vira arqueologia. */
export const MESES_JANELA_MAX = 24;

/**
 * Meses fechados COM MOVIMENTO exigidos antes de existir uma media.
 *
 * Tres, o mesmo `MIN_MESES_BASE` do lib/anomalies.ts e pelo mesmo motivo: com
 * dois, a mediana e a media dos dois e um unico mes atipico manda na regua.
 */
export const MIN_MESES_JANELA = 3;

/**
 * Dias por mes usados para converter o mensal em diario.
 *
 * 30.44 = 365.25 / 12, e nao 30. Com 30 o valor diario sai 1,5% alto e, num
 * horizonte de 90 dias, isso e mais de um dia de gasto inventado do nada --
 * pequeno, mas e erro em cima do numero pelo qual a tela existe (uma data).
 */
export const DIAS_MEDIOS_DO_MES = 30.44;

/** A transacao que este calculo le -- a mesma forma que o lib/anomalies.ts usa. */
export type TransacaoParaGastoVariavel = TransacaoParaAnomalia;

/** Um mes fechado da base, do jeito que a tela mostra a procedencia. */
export interface MesDaBase {
  /** 'YYYY-MM'. */
  mes: string;
  /** Gasto variavel daquele mes, sempre >= 0. */
  total: number;
}

/**
 * A chave da linha "sem categoria".
 *
 * String vazia e nao `null` porque ela e chave de Map, de objeto JSON e de
 * `key` de React -- e `null` vira `"null"` em dois desses tres lugares, sem
 * erro e sem sintoma. O nome fica com quem desenha a tela.
 */
export const SEM_CATEGORIA = "";

/** Uma categoria dentro do gasto do dia a dia. */
export interface CategoriaDoGasto {
  /** `category_id`, ou `SEM_CATEGORIA` para o que veio sem categoria. */
  categoriaId: string;
  /** O que a tela mostra. Cai para o proprio id quando nao ha nome. */
  rotulo: string;
  /** A mediana mensal desta categoria, sobre os MESMOS meses da base. */
  porMes: number;
  /** O mesmo valor em reais por dia. */
  porDia: number;
  /** Em quantos dos meses da base esta categoria teve movimento. */
  mesesComMovimento: number;
  /** Quanto esta categoria somou na janela inteira. Para conferir com o extrato. */
  total: number;
}

export interface GastoVariavel {
  /** O que sai por dia, sem que exista uma conta pedindo. Zero quando nao ha base. */
  porDia: number;
  /** A mediana mensal que originou o `porDia`. Zero quando nao ha base. */
  porMes: number;
  /** Quantos meses fechados com movimento sustentam a mediana. */
  mesesBase: number;
  /** Ha base suficiente para desenhar a segunda linha. */
  temBase: boolean;
  /** Os meses usados, do mais antigo para o mais novo. */
  meses: MesDaBase[];
  /**
   * Quanto foi descartado por ja estar comprometido, somado na janela inteira.
   *
   * Vai para a tela junto com o numero: sem isso o usuario compara a media com
   * o proprio extrato, acha a diferenca e conclui que a conta esta errada --
   * quando ela esta certa exatamente por causa dessa diferenca.
   */
  totalComprometidoDescartado: number;
  /** Quantas chaves distintas foram descartadas. */
  chavesDescartadas: number;
  /**
   * De onde vem o `porMes`, categoria a categoria, da maior para a menor.
   *
   * Vazio quando nao ha base -- sem "normal" nao ha de onde abrir nada.
   */
  categorias: CategoriaDoGasto[];
  /**
   * O que falta para as categorias fecharem com o `porMes`. Pode ser negativo.
   *
   * Invariante: `soma(categorias.porMes) + residuoPorMes === porMes`. Ver o
   * cabecalho -- e a diferenca entre a mediana do total e a soma das medianas.
   */
  residuoPorMes: number;
}

/**
 * Um valor por mes que o usuario digitou no lugar da mediana de uma categoria.
 *
 * `categoriaId` vazio e a linha "sem categoria", nao "todas": ver
 * `SEM_CATEGORIA`.
 */
export interface AjusteDeCategoria {
  categoriaId: string;
  /** Reais por mes. Negativo e ignorado -- gasto nao volta para a conta. */
  porMes: number;
}

export interface EntradaDoGastoVariavel {
  /** Transacoes da janela. Receita e `transfer` sao descartadas aqui dentro. */
  transacoes: TransacaoParaGastoVariavel[];
  /**
   * Chaves canonicas (`normalizeMerchant`) que a previsao ja projeta como
   * evento recorrente. Ver a armadilha de "excluir de mais" no cabecalho:
   * assinaturas `DETECTED`/`CONFIRMED` e regras recorrentes ativas, mais nada.
   *
   * OBRIGATORIO, mesmo que vazio: se fosse opcional, uma rota nova que
   * esquecesse de passa-lo devolveria uma media inflada pelas assinaturas --
   * sem erro de compilacao e sem sintoma na tela.
   */
  chavesComprometidas: string[];
  /** 'YYYY-MM-DD'. Injetado para o teste nao depender do calendario. */
  hoje: string;
  /** Meses fechados olhados para tras. Fora de faixa e corrigido, nao rejeitado. */
  meses?: number;
  /** `category_id` -> nome, para a tela nao mostrar UUID. Mesma forma do lib/anomalies.ts. */
  nomesDeCategoria?: Record<string, string>;
}

/** Janela efetiva: inteiro dentro de [MIN_MESES_JANELA, MESES_JANELA_MAX]. */
export function janelaValida(meses: number | undefined): number {
  const bruto = Math.floor(Number(meses ?? MESES_JANELA_PADRAO));
  if (!Number.isFinite(bruto) || bruto < MIN_MESES_JANELA) return MESES_JANELA_PADRAO;
  return Math.min(bruto, MESES_JANELA_MAX);
}

/**
 * Os meses FECHADOS da janela, do mais novo para o mais antigo.
 *
 * Comeca no mes anterior ao de `hoje` -- nunca no corrente (armadilha 2).
 * Aritmetica de string via `mesAnterior`, que e o que faz a virada de ano
 * funcionar sem `new Date` e sem fuso no meio.
 */
export function mesesFechados(hoje: string, meses: number): string[] {
  const out: string[] = [];
  let mes = mesAnterior(hoje);
  for (let i = 0; i < meses; i++) {
    out.push(mes);
    mes = mesAnterior(mes);
  }
  return out;
}

/**
 * A primeira data que a janela alcanca, 'YYYY-MM-DD'.
 *
 * E o que a rota manda para o banco como piso do filtro: sem ele a consulta
 * traria a vida inteira de transacoes do usuario para calcular seis meses.
 */
export function inicioDaJanela(hoje: string, meses?: number): string {
  const lista = mesesFechados(hoje, janelaValida(meses));
  return `${lista[lista.length - 1]}-01`;
}

/**
 * Quanto sai por dia sem que exista uma conta pedindo.
 *
 * A mediana, e nao a media, pelo mesmo motivo do lib/anomalies.ts: o mes de
 * ferias nao pode virar o novo normal. Com cinco meses em 1.500 e um em 6.000,
 * a media e 2.250 e a linha provavel passaria a mentir para baixo em todo mes
 * comum; a mediana e 1.500 e nao se move.
 */
export function calcularGastoVariavel(entrada: EntradaDoGastoVariavel): GastoVariavel {
  const { transacoes, hoje } = entrada;
  // `?? []` apesar de o campo ser obrigatorio no tipo: o teste roda o JS
  // emitido, onde o tipo nao existe mais, e um `undefined` aqui viraria
  // TypeError em vez de um numero errado.
  const comprometidas = new Set(entrada.chavesComprometidas ?? []);
  const meses = janelaValida(entrada.meses);

  const naJanela = new Set(mesesFechados(hoje, meses));

  const porMes = new Map<string, number>();
  // (categoriaId -> (mes -> total)). So os meses COM movimento da categoria
  // entram aqui; os zeros sao preenchidos depois, contra a base ja fechada --
  // preencher agora exigiria saber a base, que ainda nao existe.
  const porCategoria = new Map<string, Map<string, number>>();
  const descartadas = new Set<string>();
  let totalComprometidoDescartado = 0;

  for (const t of transacoes) {
    // Unico lugar que toca `amount`: filtra `expense` e devolve ABS. Receita,
    // `transfer` e qualquer coisa que nao seja despesa saem com zero aqui.
    const valor = gastoDaTransacao(t);
    if (valor <= 0) continue;

    const mes = mesDe(t.transaction_date);
    // Mes corrente e mes anterior a janela caem fora pelo mesmo teste: a janela
    // so contem mes fechado, por construcao de `mesesFechados`.
    if (!naJanela.has(mes)) continue;

    const chave = normalizeMerchant(t.description ?? "");
    // Chave vazia (descricao sem nada aproveitavel) NAO e descartada: ela nao
    // pode casar com nada comprometido, e aquilo foi dinheiro que saiu. Some-la
    // e o lado certo do erro -- o contrario esconderia gasto de verdade so
    // porque a descricao do extrato veio ruim.
    if (chave && comprometidas.has(chave)) {
      descartadas.add(chave);
      totalComprometidoDescartado += valor;
      continue;
    }

    porMes.set(mes, (porMes.get(mes) ?? 0) + valor);

    // A abertura sai do MESMO laco, depois dos mesmos filtros. Um segundo laco
    // sobre `transacoes` compilaria e seria a forma de as duas metades
    // divergirem no dia em que alguem mexesse num filtro so -- e o sintoma
    // seria a soma das categorias nao fechar com o total, que e exatamente o
    // que a abertura promete.
    const categoria = t.category_id ?? SEM_CATEGORIA;
    let meses = porCategoria.get(categoria);
    if (!meses) {
      meses = new Map<string, number>();
      porCategoria.set(categoria, meses);
    }
    meses.set(mes, (meses.get(mes) ?? 0) + valor);
  }

  // Ordem crescente para a tela ler a procedencia da esquerda para a direita.
  //
  // Nao ha filtro de total zero aqui, e a ausencia e o mecanismo da armadilha 3:
  // um mes so entra no Map quando alguma despesa dele passou pelo `valor <= 0`
  // la em cima, entao mes sem movimento nao esta no Map -- nao ha zero a
  // filtrar. Um `.filter(total > 0)` aqui seria codigo que nenhum teste
  // consegue derrubar, e o proximo leitor acharia que e ELE quem fecha a
  // armadilha.
  const base: MesDaBase[] = Array.from(porMes.entries())
    .map(([mes, total]) => ({ mes, total }))
    .sort((a, b) => a.mes.localeCompare(b.mes));

  const mesesBase = base.length;
  const temBase = mesesBase >= MIN_MESES_JANELA;
  // UM lugar decide que sem base nao ha numero, e o diario deriva do mensal.
  // Repetir o `temBase ?` no `porDia` parecia prudente e nao era: os dois
  // ramos davam o mesmo resultado, entao nenhum teste conseguia derrubar a
  // segunda copia -- e uma guarda que nao pode falhar e uma guarda que o
  // proximo leitor confia a toa.
  const porMesTipico = temBase ? mediana(base.map((m) => m.total)) : 0;

  // Sem base nao ha "normal" e nao ha o que abrir: devolver as categorias
  // mesmo assim daria a tela um detalhamento de um numero que ela nao vai
  // mostrar, e a soma das partes contradiria o zero da manchete.
  const categorias = temBase
    ? abrirPorCategoria(porCategoria, base.map((m) => m.mes), entrada.nomesDeCategoria ?? {})
    : [];

  const somaDasCategorias = categorias.reduce((s, c) => s + c.porMes, 0);

  return {
    porDia: porMesTipico / DIAS_MEDIOS_DO_MES,
    porMes: porMesTipico,
    mesesBase,
    temBase,
    meses: base,
    totalComprometidoDescartado,
    chavesDescartadas: descartadas.size,
    categorias,
    // Por subtracao, e nao por uma segunda formula: assim o invariante
    // (soma + residuo == porMes) vale por construcao, inclusive quando a
    // mediana de alguma categoria mudar de definicao.
    residuoPorMes: porMesTipico - somaDasCategorias,
  };
}

/**
 * A mediana mensal de cada categoria, sobre os meses da base.
 *
 * `mesesDaBase` sao os mesmos meses do total, e o zero do mes sem movimento
 * ENTRA na mediana -- ver o cabecalho: e o que impede a soma das categorias de
 * estourar o total quando alguem gasta com farmacia uma vez por semestre.
 */
function abrirPorCategoria(
  porCategoria: Map<string, Map<string, number>>,
  mesesDaBase: string[],
  nomes: Record<string, string>
): CategoriaDoGasto[] {
  const saida: CategoriaDoGasto[] = [];

  for (const [categoriaId, porMesDaCategoria] of Array.from(porCategoria.entries())) {
    const valores = mesesDaBase.map((mes) => porMesDaCategoria.get(mes) ?? 0);
    const tipico = mediana(valores);

    saida.push({
      categoriaId,
      rotulo: nomes[categoriaId] ?? categoriaId,
      porMes: tipico,
      porDia: tipico / DIAS_MEDIOS_DO_MES,
      // Hoje isto e sempre igual a `porMesDaCategoria.size`, e a rodada de
      // mutacao provou: nenhum teste separa os dois. E consequencia de a base
      // ser definida pelos meses com movimento -- todo mes de uma categoria e,
      // por construcao, um mes da base. Sai de `valores` mesmo assim porque
      // `valores` E a base: no dia em que a base deixar de ser "todo mes com
      // movimento" (um piso de valor, por exemplo), esta contagem acompanha e
      // o `.size` passaria a dizer "apareceu em 4 de 6" quando so 3 contaram.
      mesesComMovimento: valores.filter((v) => v > 0).length,
      total: valores.reduce((s, v) => s + v, 0),
    });
  }

  // Maior primeiro, que e a ordem em que a tela quer ler. O desempate e pelo
  // total da janela, e ele importa: categoria esporadica tem mediana ZERO, e
  // sem o desempate a ordem entre elas seria a de insercao do Map -- ou seja,
  // a ordem em que o banco devolveu as linhas, que muda sozinha entre duas
  // chamadas iguais e faz a lista pular na tela.
  saida.sort((a, b) => b.porMes - a.porMes || b.total - a.total || a.categoriaId.localeCompare(b.categoriaId));
  return saida;
}

/**
 * O gasto diario depois dos valores que o usuario digitou por categoria.
 *
 * Recompoe a partir das PARTES -- categorias (com o ajuste no lugar da
 * mediana, quando houver) mais o residuo. Como `soma + residuo == porMes`, uma
 * categoria mexida em -200 move o total em exatamente -200: o ajuste vale o que
 * o usuario ve, que e a unica razao de a abertura existir.
 *
 * A regra mora aqui, e nao na tela, porque o `?gastoDiario=` que a tela envia e
 * saneado por `gastoDiarioValido` no servidor -- duas aritmeticas diferentes
 * dos dois lados dariam uma tela que mostra um numero e um grafico que usa
 * outro.
 */
export function gastoDiarioComAjustes(
  gasto: GastoVariavel,
  ajustes: AjusteDeCategoria[]
): number {
  // NAO ha `if (!temBase) return 0` aqui, e a ausencia e deliberada: sem base o
  // `calcularGastoVariavel` devolve `categorias: []` e `residuoPorMes: 0`, entao
  // a recomposicao ja da zero sozinha -- nenhum ajuste tem categoria em que
  // pegar. A guarda foi escrita, a rodada de mutacao mostrou que remove-la nao
  // quebra teste nenhum, e o motivo e que ela e inalcancavel. Mesma decisao do
  // `porDia` la em cima: guarda que nao pode falhar e guarda que o proximo
  // leitor confia a toa.
  const porId = new Map<string, number>();
  for (const a of ajustes) {
    const valor = Number(a.porMes);
    // Nao-numero e negativo sao DESCARTADOS, nao zerados: zerar seria obedecer
    // a um campo mal digitado tirando uma categoria inteira da conta, e a linha
    // provavel ficaria otimista sem nada na tela dizendo por que.
    if (!Number.isFinite(valor) || valor < 0) continue;
    porId.set(a.categoriaId, valor);
  }

  const soma = gasto.categorias.reduce(
    (s, c) => s + (porId.get(c.categoriaId) ?? c.porMes),
    0
  );

  // O residuo NAO e ajustavel e segue inteiro: ele nao e uma categoria, e a
  // diferenca entre a mediana do total e a soma das medianas. Deixa-lo de fora
  // faria o total cair sozinho assim que o usuario mexesse em qualquer linha.
  // O piso em zero e o unico lugar onde o residuo negativo pode morder: com
  // ajustes pequenos a recomposicao daria um gasto negativo, que viraria
  // RECEITA diaria na previsao.
  return Math.max(0, soma + gasto.residuoPorMes) / DIAS_MEDIOS_DO_MES;
}
