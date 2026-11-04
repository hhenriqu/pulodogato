// -----------------------------------------------------------------------------
// O MAPA DE CALOR DOS GASTOS (widget da tela inicial)
// -----------------------------------------------------------------------------
// Um calendario do periodo do painel em que cada dia e pintado pela intensidade
// do que saiu naquele dia. A pergunta que ele responde nao e "quanto gastei" --
// essa e dos quatro numeros -- e sim "EM QUE DIAS eu gasto": o fim de semana
// que pesa, a semana do mercado, o dia que destoa.
//
// A REGRA DO CARTAO AQUI E A DA COMPRA, E ISSO E DE PROPOSITO
// ------------------------------------------------------------
// O Realizado do painel conta o cartao pela fatura paga, no mes do vencimento
// (lib/realizado-do-caixa.ts). Para ESTE bloco essa regra apagaria a resposta:
// toda compra no cartao do mes viraria um unico quadrado vermelho no dia do
// vencimento, e o resto do calendario ficaria frio. Por isso o mapa le cada
// despesa no dia em que ela aconteceu -- a compra no cartao inclusive -- e a
// tela diz isso na legenda. A consequencia esperada: o total do mapa nao bate
// com «Saídas» do resumo, e nao tem de bater. Um conta caixa, o outro conta
// comportamento.
//
// O QUE FICA DE FORA
// ------------------
//   * transferencias (inclusive o pagamento da fatura, que e `transfer`): nao e
//     gasto, e contar o pagamento da fatura somaria o cartao duas vezes;
//   * o que esta marcado "fora dos totais" (a rota filtra com `apenasNosTotais`);
//   * outra moeda que nao a oficial: somar real com dolar no mesmo quadrado e o
//     defeito que a 022 tirou das views;
//   * o FUTURO. A materializacao de recorrencia cria lancamento com data
//     futura dentro do mes; pinta-lo seria mostrar como gasto o que ainda nao
//     aconteceu. O dia futuro aparece, mas apagado, e nao zerado.
//
// Tudo aqui e funcao pura sobre strings 'AAAA-MM-DD'. Nenhum `new Date(iso)`
// local: em America/Sao_Paulo ele nasce no dia anterior (HMO-353). O dia da
// semana sai de `Date.UTC`, que nao tem fuso.
// -----------------------------------------------------------------------------

/** O periodo mais longo que o mapa desenha. Um ano e um pouco. */
export const MAXIMO_DE_DIAS_DO_MAPA = 400;

/** Uma despesa ja filtrada pela rota: o dia e o valor, positivo. */
export interface GastoDoDia {
  data: string;
  valor: number;
}

/** 0 = nada gasto; 1 a 4 = do mais frio ao mais quente. */
export type NivelDoMapa = 0 | 1 | 2 | 3 | 4;

export interface CelulaDoMapa {
  /** O dia, ou `null` para o enchimento antes do inicio e depois do fim. */
  data: string | null;
  /** O dia do mes, para escrever dentro do quadrado. 0 no enchimento. */
  dia: number;
  valor: number;
  nivel: NivelDoMapa;
  /** Depois de hoje: ainda nao aconteceu, e nao e "zero". */
  futuro: boolean;
}

export interface MapaDeCalor {
  /** Linhas de sete celulas, de domingo a sabado. */
  semanas: CelulaDoMapa[][];
  /** Soma do que foi pintado (ate hoje). */
  total: number;
  /** Dias ja vividos do periodo -- a base da media. */
  diasPassados: number;
  diasComGasto: number;
  /** Total dividido pelos dias passados, nao pelos dias com gasto. */
  mediaPorDia: number;
  /** O dia mais caro, ou null se nada foi gasto. */
  maiorDia: { data: string; valor: number } | null;
  /**
   * Onde comeca cada nivel: `limites[0]` e o piso do nivel 2, `[1]` do 3 e
   * `[2]` do 4. Vai na resposta para a legenda dizer o que cada cor significa.
   */
  limites: [number, number, number];
}

const DIA_EM_MS = 86_400_000;

function paraUtc(iso: string): number {
  return Date.UTC(
    Number(iso.slice(0, 4)),
    Number(iso.slice(5, 7)) - 1,
    Number(iso.slice(8, 10)),
  );
}

function deUtc(ms: number): string {
  const d = new Date(ms);
  const ano = d.getUTCFullYear();
  const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dia = String(d.getUTCDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}

/** Quantos dias o periodo tem, contando as duas pontas. */
export function diasDoPeriodo(de: string, ate: string): number {
  return Math.round((paraUtc(ate) - paraUtc(de)) / DIA_EM_MS) + 1;
}

/** 0 = domingo ... 6 = sabado. */
export function diaDaSemana(iso: string): number {
  return new Date(paraUtc(iso)).getUTCDay();
}

/** Arredonda em centavos: a soma de float acumula lixo na terceira casa. */
const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * Soma as despesas por dia. Valor negativo (despesa e gravada negativa no
 * banco) entra pelo modulo; valor nao numerico e ignorado em vez de virar NaN
 * e contaminar o dia inteiro.
 */
export function somarPorDia(
  gastos: readonly GastoDoDia[],
): Map<string, number> {
  const porDia = new Map<string, number>();
  for (const g of gastos) {
    const valor = Math.abs(Number(g.valor));
    if (!Number.isFinite(valor) || valor === 0) continue;
    porDia.set(g.data, (porDia.get(g.data) ?? 0) + valor);
  }
  porDia.forEach((v, k) => porDia.set(k, centavos(v)));
  return porDia;
}

/**
 * Os tres cortes entre os quatro niveis: os quartis dos dias COM gasto.
 *
 * Quartil e nao fracao do maior dia, porque o maior dia e quase sempre um
 * outlier (o aluguel, a fatura do condominio). Escalando pelo maximo, o dia do
 * aluguel seria o unico quadrado quente e o resto do mes ficaria todo no nivel
 * 1 -- o mapa deixaria de distinguir a terca do mercado da terca sem nada.
 */
export function limitesDosNiveis(
  valores: readonly number[],
): [number, number, number] {
  const ordenados = valores.filter((v) => v > 0).sort((a, b) => a - b);
  if (ordenados.length === 0) return [0, 0, 0];
  const quantil = (q: number) => {
    const pos = (ordenados.length - 1) * q;
    const baixo = Math.floor(pos);
    const alto = Math.ceil(pos);
    return centavos(
      ordenados[baixo] + (ordenados[alto] - ordenados[baixo]) * (pos - baixo),
    );
  };
  return [quantil(0.25), quantil(0.5), quantil(0.75)];
}

/** O nivel de um dia dado os cortes. Zero e so para "nada gasto". */
export function nivelDoValor(
  valor: number,
  limites: readonly [number, number, number],
): NivelDoMapa {
  if (!(valor > 0)) return 0;
  if (valor >= limites[2] && limites[2] > 0) return 4;
  if (valor >= limites[1] && limites[1] > 0) return 3;
  if (valor >= limites[0] && limites[0] > 0) return 2;
  return 1;
}

/**
 * Monta o calendario do periodo.
 *
 * `hoje` decide o que ja aconteceu: gasto com data depois de hoje e ignorado
 * mesmo que venha na lista -- a rota ja corta em hoje, e este corte aqui e o
 * que garante isso para qualquer outro chamador.
 */
export function montarMapaDeCalor(entrada: {
  de: string;
  ate: string;
  hoje: string;
  gastos: readonly GastoDoDia[];
}): MapaDeCalor {
  const { de, ate, hoje } = entrada;
  const porDia = somarPorDia(
    entrada.gastos.filter(
      (g) => g.data >= de && g.data <= ate && g.data <= hoje,
    ),
  );
  const limites = limitesDosNiveis(Array.from(porDia.values()));

  const celulas: CelulaDoMapa[] = [];
  const vazia = (): CelulaDoMapa => ({
    data: null,
    dia: 0,
    valor: 0,
    nivel: 0,
    futuro: false,
  });

  for (let i = 0; i < diaDaSemana(de); i++) celulas.push(vazia());

  let total = 0;
  let diasPassados = 0;
  let diasComGasto = 0;
  let maiorDia: MapaDeCalor["maiorDia"] = null;

  const fim = paraUtc(ate);
  for (let ms = paraUtc(de); ms <= fim; ms += DIA_EM_MS) {
    const data = deUtc(ms);
    const futuro = data > hoje;
    const valor = futuro ? 0 : (porDia.get(data) ?? 0);
    if (!futuro) {
      diasPassados += 1;
      total += valor;
      if (valor > 0) {
        diasComGasto += 1;
        if (!maiorDia || valor > maiorDia.valor) maiorDia = { data, valor };
      }
    }
    celulas.push({
      data,
      dia: Number(data.slice(8, 10)),
      valor,
      nivel: futuro ? 0 : nivelDoValor(valor, limites),
      futuro,
    });
  }

  while (celulas.length % 7 !== 0) celulas.push(vazia());

  const semanas: CelulaDoMapa[][] = [];
  for (let i = 0; i < celulas.length; i += 7) {
    semanas.push(celulas.slice(i, i + 7));
  }

  total = centavos(total);
  return {
    semanas,
    total,
    diasPassados,
    diasComGasto,
    mediaPorDia: diasPassados > 0 ? centavos(total / diasPassados) : 0,
    maiorDia,
    limites,
  };
}

/** 'AAAA-MM-DD' -> 'DD/MM', fatiando a string. */
export function diaEMesDoMapa(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const NOMES_DOS_MESES = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

/**
 * O rotulo de mes de uma semana, quando ela contem o dia 1 de algum mes (ou e
 * a primeira semana do periodo). Periodo de varios meses vira uma coluna so de
 * semanas, e sem este rotulo ninguem sabe onde agosto termina.
 */
export function rotuloDaSemana(
  semana: readonly CelulaDoMapa[],
  primeira: boolean,
): string | null {
  const dias = semana.filter((c) => c.data !== null);
  const virada = dias.find((c) => c.dia === 1);
  const alvo = virada ?? (primeira ? dias[0] : undefined);
  if (!alvo || !alvo.data) return null;
  return NOMES_DOS_MESES[Number(alvo.data.slice(5, 7)) - 1];
}
