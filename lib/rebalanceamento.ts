// Rebalanceamento da carteira, na conta da planilha "Rebalanceamento de
// Carteira" (aba Controle e aba Setores).
//
// Puro de proposito, como lib/investments.ts: recebe a posicao que aquele
// arquivo ja calculou e o peso que o usuario deu a cada ativo, e devolve as
// colunas da tabela. Nenhum erro desta conta levanta excecao -- ele desenha um
// "aportar" no ativo errado -- e por isso ela tem suite propria
// (`npm run test:rebalanceamento`).
//
// A CONTA, COLUNA POR COLUNA DA PLANILHA
// --------------------------------------
//   Nota           -> `peso` (investment_assets.target_weight, migration 073)
//   % Carteira Ideal  = peso / soma dos pesos
//   % Carteira Tenho  = tenho / valor da carteira
//   Quero (R$)        = % ideal * base
//   Quanto Falta (R$) = Quero - Tenho
//   Compra ou Aguarda = Falta > 0 ? aportar : aguardar
//   Qto Falta (cotas) = Falta / preco atual
//   Resultado R$ e Variacao vem prontos da posicao (lib/investments.ts).
//
// A BASE NAO E UM NUMERO DIGITADO
// -------------------------------
// Na planilha, "Quero" multiplica o % ideal pelo "Valor na Corretora" (M3),
// digitado a mao. Na planilha do Helio M3 estava em R$ 1.649,11 com R$ 3.100,26
// em ativos -- e por isso 12 dos 21 ativos apareciam "Aguardar": a soma do
// "Quero" era METADE do que ele ja tinha. Aqui a base e o valor dos ativos que
// participam MAIS o aporte que a pessoa digita na tela, e nao ha como as duas
// pontas se desencontrarem.
//
// QUEM PARTICIPA
// --------------
// Ativo com peso NULL fica FORA: nem entra na base, nem ganha linha. E a renda
// fixa de reserva, o papel so acompanhado. Peso 0 e outra coisa: participa, e
// "quero" R$ 0 -- e o OIBR3 da planilha.
//
// O APORTE DIVIDIDO
// -----------------
// "Falta" diz quanto cada ativo esta abaixo do alvo, mas a soma das faltas
// positivas passa do aporte sempre que algum ativo esta ACIMA do alvo (porque
// ninguem vende o excesso para cobrir). A coluna `doAporte` responde a pergunta
// do mes -- "onde ponho os R$ X que tenho agora" -- dividindo o aporte entre os
// ativos abaixo do alvo na proporcao da falta de cada um, e `cotasDoAporte` e
// isso em cotas INTEIRAS, arredondado para baixo: nao se compra 13,57 BPAN4.

export type SituacaoDoRebalanceamento = "aportar" | "aguardar";

/**
 * Os rotulos que a tela imprime. Ficam aqui, e nao no componente, para a suite
 * conferir que nenhum deles e vocabulario de recomendacao (lib/crivos.ts,
 * VOCABULARIO_PROIBIDO): o peso e do usuario, e a tela so faz a conta dele.
 */
export const ROTULO_DA_SITUACAO: Record<SituacaoDoRebalanceamento, string> = {
  aportar: "Aportar",
  aguardar: "Aguardar",
};

export const ROTULO_DO_PESO = "Peso";

/** O setor de quem nao informou setor, na tabela e no grafico. */
export const SEM_SETOR = "Sem setor";

export interface AtivoParaRebalancear {
  asset_id: string;
  symbol: string;
  /** NULL = fora do rebalanceamento. 0 = quero zerar. */
  peso: number | null;
  setor: string | null;
  /** Preco atual informado pelo usuario. NULL = nunca informou. */
  preco: number | null;
  /** Quantidade em carteira. Renda fixa: reais aplicados (ver lib/investments.ts). */
  quantidade: number;
  /** O "Tenho (R$)" -- `current_value` da posicao. */
  valorAtual: number;
  resultado: number;
  variacao: number;
  /** Renda fixa nao tem cota: a falta fica so em reais. */
  semCota: boolean;
}

export interface LinhaDoRebalanceamento {
  asset_id: string;
  symbol: string;
  setor: string;
  peso: number;
  /** Fracao (0,0629 = 6,29%). NULL quando a soma dos pesos e zero. */
  percentualIdeal: number | null;
  /** Fracao do valor atual da carteira que participa. */
  percentualAtual: number;
  valorAtual: number;
  valorAlvo: number;
  falta: number;
  situacao: SituacaoDoRebalanceamento;
  /** Falta / preco, fracionado como na planilha. NULL sem preco ou sem cota. */
  cotasQueFaltam: number | null;
  /** A parte do aporte que vai para este ativo. */
  doAporte: number;
  /** `doAporte` em cotas inteiras. NULL sem preco ou sem cota. */
  cotasDoAporte: number | null;
  resultado: number;
  variacao: number;
}

export interface FatiaDoSetor {
  setor: string;
  /** O que a pessoa tem no setor hoje. */
  valorAtual: number;
  percentualAtual: number;
  /** O que ela quer no setor, pela soma dos % ideais dos ativos dele. */
  percentualIdeal: number;
}

export interface Rebalanceamento {
  linhas: LinhaDoRebalanceamento[];
  /** Ativos com peso NULL: fora da base e da tabela. */
  fora: string[];
  somaDosPesos: number;
  valorDaCarteira: number;
  aporte: number;
  /** valorDaCarteira + aporte -- o "Valor na Corretora" da planilha. */
  base: number;
  /** Soma das faltas positivas. Maior que o aporte quando ha ativo acima do alvo. */
  faltaTotal: number;
  /** Soma de `doAporte`. Igual ao aporte, salvo quando nada esta abaixo do alvo. */
  aporteDividido: number;
  /** O que sobra do aporte depois de arredondar cada compra para cota inteira. */
  sobraDoArredondamento: number;
  setores: FatiaDoSetor[];
}

const CENTAVO = 0.005;

function redondo(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function numeroValido(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * Le o peso como a rota o devolve (numeric do Postgres chega como string).
 * Negativo e lixo viram NULL -- fora do rebalanceamento -- em vez de entrar na
 * soma e encolher o % ideal de todos os outros.
 */
export function lerPeso(valor: unknown): number | null {
  const n = numeroValido(valor);
  if (n === null || n < 0) return null;
  return n;
}

/**
 * Le o aporte digitado ("1.500,50", "1500.5", "") em reais. Vazio, negativo ou
 * ilegivel vira 0: um aporte negativo seria um resgate, e resgate nao e o que
 * esta tela calcula.
 */
export function lerAporte(texto: string): number {
  const limpo = String(texto ?? "")
    .trim()
    .replace(/\s|R\$/g, "");
  if (limpo === "") return 0;
  // Com virgula, o ponto e separador de milhar ("1.500,50"); sem virgula, o
  // ponto e o decimal ("1500.5").
  const normalizado = limpo.includes(",")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo;
  const n = Number(normalizado);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function calcularRebalanceamento(
  ativos: AtivoParaRebalancear[],
  aporteInformado: number
): Rebalanceamento {
  const aporte =
    Number.isFinite(aporteInformado) && aporteInformado > 0 ? aporteInformado : 0;

  const participantes = ativos.filter((a) => a.peso !== null && a.peso >= 0);
  const fora = ativos
    .filter((a) => !(a.peso !== null && a.peso >= 0))
    .map((a) => a.symbol);

  const somaDosPesos = participantes.reduce((s, a) => s + (a.peso ?? 0), 0);
  const valorDaCarteira = participantes.reduce((s, a) => s + a.valorAtual, 0);
  const base = valorDaCarteira + aporte;

  const parciais = participantes.map((a) => {
    const peso = a.peso ?? 0;
    const percentualIdeal = somaDosPesos > 0 ? peso / somaDosPesos : null;
    const valorAlvo = percentualIdeal === null ? 0 : percentualIdeal * base;
    const falta = valorAlvo - a.valorAtual;
    const temCota = !a.semCota && a.preco !== null && a.preco > 0;
    return {
      a,
      peso,
      percentualIdeal,
      valorAlvo,
      falta,
      temCota,
    };
  });

  const faltaTotal = parciais.reduce(
    (s, p) => s + (p.falta > CENTAVO ? p.falta : 0),
    0
  );
  // Com mais falta que aporte, divide o aporte na proporcao da falta; com menos,
  // cada ativo recebe a falta inteira e o resto do aporte nao tem para onde ir
  // (so acontece quando os pesos somam zero).
  const fator = faltaTotal > aporte && faltaTotal > 0 ? aporte / faltaTotal : 1;

  let aporteDividido = 0;
  let gastoEmCotas = 0;

  const linhas: LinhaDoRebalanceamento[] = parciais.map((p) => {
    const { a } = p;
    const situacao: SituacaoDoRebalanceamento =
      p.falta > CENTAVO ? "aportar" : "aguardar";
    const doAporte = situacao === "aportar" ? p.falta * fator : 0;
    aporteDividido += doAporte;

    let cotasDoAporte: number | null = null;
    if (p.temCota) {
      // O epsilon segura 9,999999 -> 9 quando a conta deu 10 exato.
      cotasDoAporte = Math.max(0, Math.floor(doAporte / (a.preco as number) + 1e-9));
      gastoEmCotas += cotasDoAporte * (a.preco as number);
    } else {
      gastoEmCotas += doAporte;
    }

    return {
      asset_id: a.asset_id,
      symbol: a.symbol,
      setor: a.setor && a.setor.trim() !== "" ? a.setor.trim() : SEM_SETOR,
      peso: p.peso,
      percentualIdeal: p.percentualIdeal,
      percentualAtual: valorDaCarteira > 0 ? a.valorAtual / valorDaCarteira : 0,
      valorAtual: redondo(a.valorAtual),
      valorAlvo: redondo(p.valorAlvo),
      falta: redondo(p.falta),
      situacao,
      cotasQueFaltam: p.temCota ? p.falta / (a.preco as number) : null,
      doAporte: redondo(doAporte),
      cotasDoAporte,
      resultado: a.resultado,
      variacao: a.variacao,
    };
  });

  // A ordem da planilha: quem mais precisa de aporte primeiro, quem esta mais
  // acima do alvo por ultimo.
  linhas.sort((x, y) => y.falta - x.falta || x.symbol.localeCompare(y.symbol));

  return {
    linhas,
    fora,
    somaDosPesos,
    valorDaCarteira: redondo(valorDaCarteira),
    aporte: redondo(aporte),
    base: redondo(base),
    faltaTotal: redondo(faltaTotal),
    aporteDividido: redondo(aporteDividido),
    sobraDoArredondamento: redondo(Math.max(0, aporte - gastoEmCotas)),
    setores: alocacaoPorSetor(linhas),
  };
}

/**
 * A aba Setores: quanto de cada setor a pessoa tem e quanto ela quer. O "quer"
 * e a soma dos % ideais dos ativos do setor, e nao um numero digitado por
 * setor -- assim ele fecha com a tabela em cima.
 */
export function alocacaoPorSetor(linhas: LinhaDoRebalanceamento[]): FatiaDoSetor[] {
  const total = linhas.reduce((s, l) => s + l.valorAtual, 0);
  const porSetor = new Map<string, FatiaDoSetor>();

  for (const l of linhas) {
    const chave = l.setor.toLocaleLowerCase("pt-BR");
    const atual = porSetor.get(chave) ?? {
      setor: l.setor,
      valorAtual: 0,
      percentualAtual: 0,
      percentualIdeal: 0,
    };
    atual.valorAtual += l.valorAtual;
    atual.percentualIdeal += l.percentualIdeal ?? 0;
    porSetor.set(chave, atual);
  }

  return Array.from(porSetor.values())
    .map((f) => ({
      ...f,
      valorAtual: redondo(f.valorAtual),
      percentualAtual: total > 0 ? f.valorAtual / total : 0,
    }))
    .sort((x, y) => y.valorAtual - x.valorAtual || x.setor.localeCompare(y.setor));
}

// ---------------------------------------------------------------------------
// A CALCULADORA DE PESO (abas "Nota Empresa" e "Nota FII" da planilha)
// ---------------------------------------------------------------------------
// Cada criterio tem uma importancia (o peso do criterio) e recebe do usuario
// um valor de 0 a 10. O resultado e a media ponderada:
//
//   resultado = soma(importancia_i * valor_i) / soma(importancia_i)
//
// que e exatamente o "E5*F5 + E6*F6 + ..." da planilha, com E = D / soma(D).
// O resultado vai para o peso do ativo, se a pessoa quiser. Os criterios, as
// importancias e os pontos de atencao sao os da planilha.

export interface CriterioDaCalculadora {
  id: string;
  rotulo: string;
  importancia: number;
  dica: string;
}

export type ModeloDaCalculadora = "empresa" | "fii";

export const CRITERIOS_DA_CALCULADORA: Record<ModeloDaCalculadora, CriterioDaCalculadora[]> = {
  empresa: [
    {
      id: "setor",
      rotulo: "Setor e qualidade",
      importancia: 10,
      dica: "Se a maior parte das empresas do setor é lucrativa, se o setor é perene e se há diferenciação nos produtos.",
    },
    {
      id: "lucro",
      rotulo: "Lucro nos últimos 5 anos",
      importancia: 7,
      dica: "Se a empresa teve lucro líquido positivo em todos os trimestres e se o lucro cresceu.",
    },
    {
      id: "margem",
      rotulo: "Margem líquida",
      importancia: 7,
      dica: "Se a margem líquida é maior que 15%.",
    },
    {
      id: "roe",
      rotulo: "ROE",
      importancia: 6,
      dica: "Ideal que o ROE seja historicamente maior que 15%.",
    },
    {
      id: "dividendo",
      rotulo: "Dividendo (DY)",
      importancia: 7,
      dica: "Ideal que seja maior que a renda fixa; acima de 3% já está ok.",
    },
    {
      id: "endividamento",
      rotulo: "Endividamento (Dív. Líq./EBITDA)",
      importancia: 3,
      dica: "Ideal menor que 1,5; até 3 passa se a empresa estiver em expansão.",
    },
    {
      id: "pl",
      rotulo: "P/L",
      importancia: 6,
      dica: "Ideal entre 3 e 20.",
    },
    {
      id: "subjetiva",
      rotulo: "Análise subjetiva",
      importancia: 5,
      dica: "Governança e gestão.",
    },
  ],
  fii: [
    {
      id: "localizacao",
      rotulo: "Localização",
      importancia: 10,
      dica: "Shopping perto de centros urbanos, galpão com acesso a grandes estradas, laje corporativa perto de centros financeiros.",
    },
    {
      id: "dy",
      rotulo: "Dividend yield médio",
      importancia: 10,
      dica: "Ideal que seja maior que a renda fixa (acima de 6%).",
    },
    {
      id: "ocupacao",
      rotulo: "Ocupação",
      importancia: 10,
      dica: "Vacância baixa.",
    },
    {
      id: "padrao",
      rotulo: "Padrão construtivo",
      importancia: 10,
      dica: "Olhe o portfólio de imóveis e veja se são fáceis de alugar.",
    },
    {
      id: "diversificacao",
      rotulo: "Diversificação",
      importancia: 10,
      dica: "Ideal que seja multiativo, multi-inquilino e multirregião.",
    },
  ],
};

/** O modelo que a calculadora abre para cada tipo de ativo. */
export function modeloDoTipo(tipo: string): ModeloDaCalculadora {
  return tipo === "fii" ? "fii" : "empresa";
}

/**
 * A media ponderada. Criterio sem valor fica fora da conta (e da soma das
 * importancias), em vez de contar como zero: zero e "pessimo", e nao
 * "nao avaliei". Valor fora de 0 a 10 e preso na faixa -- na planilha do Helio
 * dois criterios estavam com 11 e 12, e o resultado passava do teto.
 * Devolve NULL quando nada foi avaliado.
 */
export function calcularPesoPelosCriterios(
  criterios: CriterioDaCalculadora[],
  valores: Record<string, number | null | undefined>
): number | null {
  let somaPonderada = 0;
  let somaDasImportancias = 0;

  for (const c of criterios) {
    const v = valores[c.id];
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    const preso = Math.min(10, Math.max(0, v));
    somaPonderada += c.importancia * preso;
    somaDasImportancias += c.importancia;
  }

  if (somaDasImportancias === 0) return null;
  return redondo(somaPonderada / somaDasImportancias);
}

// ---------------------------------------------------------------------------
// O QUE A ROTA ACEITA GRAVAR
// ---------------------------------------------------------------------------
// Mesmas faixas das constraints da migration 073, conferidas aqui para a tela
// receber uma frase em vez de um 500 com `23514` dentro.

export const PESO_MAXIMO = 1000;
export const SETOR_TAMANHO_MAXIMO = 60;

export interface PesoParaGravar {
  asset_id: string;
  target_weight: number | null;
  sector: string | null;
}

export type LeituraDosPesos =
  | { ok: true; itens: PesoParaGravar[] }
  | { ok: false; erro: string };

/** Le `{ itens: [{ asset_id, peso, setor }] }`. Peso e setor vazios viram NULL. */
export function lerPesosParaGravar(corpo: unknown): LeituraDosPesos {
  const itens = (corpo as { itens?: unknown } | null)?.itens;
  if (!Array.isArray(itens) || itens.length === 0) {
    return { ok: false, erro: "Nada para gravar" };
  }
  if (itens.length > 500) {
    return { ok: false, erro: "Itens demais numa gravação" };
  }

  const lidos: PesoParaGravar[] = [];
  const vistos = new Set<string>();

  for (const bruto of itens) {
    const item = (bruto ?? {}) as { asset_id?: unknown; peso?: unknown; setor?: unknown };
    const assetId = typeof item.asset_id === "string" ? item.asset_id.trim() : "";
    if (assetId === "") return { ok: false, erro: "Ativo sem identificador" };
    if (vistos.has(assetId)) return { ok: false, erro: "Ativo repetido na gravação" };
    vistos.add(assetId);

    let peso: number | null = null;
    if (item.peso !== null && item.peso !== undefined && item.peso !== "") {
      const n =
        typeof item.peso === "number"
          ? item.peso
          : Number(String(item.peso).trim().replace(",", "."));
      if (!Number.isFinite(n) || n < 0 || n > PESO_MAXIMO) {
        return { ok: false, erro: `O peso tem de ser um número de 0 a ${PESO_MAXIMO}` };
      }
      peso = Math.round(n * 100) / 100;
    }

    let setor: string | null = null;
    if (item.setor !== null && item.setor !== undefined) {
      if (typeof item.setor !== "string") return { ok: false, erro: "Setor inválido" };
      const limpo = item.setor.trim().replace(/\s+/g, " ");
      if (limpo.length > SETOR_TAMANHO_MAXIMO) {
        return { ok: false, erro: `O setor pode ter até ${SETOR_TAMANHO_MAXIMO} letras` };
      }
      setor = limpo === "" ? null : limpo;
    }

    lidos.push({ asset_id: assetId, target_weight: peso, sector: setor });
  }

  return { ok: true, itens: lidos };
}
