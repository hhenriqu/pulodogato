// Os crivos de fundamento: uma LISTA DE CRITERIOS, nao uma nota (HMO-195).
//
// Este arquivo e puro -- nao importa Supabase, nao le `process.env` e nao conhece
// rota nem JSX. Ele recebe as linhas de `public.cvm_indicadores` (migration 028)
// mais o limite que o usuario escolheu, e devolve, criterio por criterio, se
// bateu, se nao bateu, ou se nao ha dado.
//
// ===========================================================================
// A FRONTEIRA QUE DECIDE O DESENHO INTEIRO
// ===========================================================================
// O app NAO afirma que 15% de ROE e bom. Ele mostra se o CRITERIO DO USUARIO
// bateu. Limite fixado no codigo e opiniao nossa sobre investimento, e por isso
// `limitePadrao` e sugestao inicial editavel -- nao regra.
//
// Pela mesma razao nao existe, em lugar nenhum desta entrega:
//
//   * nota unica, score, pontuacao, ranking ou "x de 3 criterios" -- somar
//     criterios de naturezas diferentes num numero so e exatamente a opiniao que
//     nao nos cabe dar, com a aparencia de medida;
//   * as palavras "comprar", "vender", "recomendado" ou equivalentes no
//     vocabulario da interface.
//
// `VOCABULARIO_PROIBIDO`, no fim do arquivo, existe para que isso seja uma
// verificacao e nao um pedido: a suite varre o HTML renderizado com ela.
//
// ===========================================================================
// ARMADILHA 1 -- A VIEW DEVOLVE RAZAO, A TELA FALA EM PORCENTAGEM
// ===========================================================================
// `cvm_indicadores.roe` da PETR4 vem `0.2648669`, nao `26.49`. Um crivo "acima
// de 15%" que compare a razao crua contra `15` APROVA ZERO empresa (0,26 nunca
// passa de 15) e um que compare contra `0.15` aprova as mesmas que a conta certa
// -- as duas expressoes compilam, nenhuma levanta erro, e a errada desenha uma
// carteira em que nada bate criterio nenhum.
//
// A defesa e estrutural: a conversao acontece em UM lugar
// (`daViewParaUnidade`), toda comparacao acontece DEPOIS dela, e a suite fixa a
// PETR4 no ROE conferido no arquivo da CVM (26,49%) -- o unico valor em que a
// versao sem conversao responde diferente da certa.
//
// ===========================================================================
// ARMADILHA 2 -- "ULTIMO BALANCO FECHADO" E POR EMPRESA
// ===========================================================================
// Empresa entrega DFP em data propria: em qualquer dia do ano uma pode ter 2025
// e a vizinha so 2024. Fixar o ano no codigo faz a segunda DESAPARECER da lista
// em vez de aparecer com o dado que tem, e agrupar errado faz o mesmo ticker
// aparecer uma vez por exercicio importado. Por isso
// `ultimoExercicioPorTicker`, e nao um filtro por ano.
//
// ===========================================================================
// ARMADILHA 3 -- `NULL` NAO E REPROVADO
// ===========================================================================
// A view devolve `NULL` de proposito onde a conta nao tem leitura correta: `roe`
// quando o patrimonio e negativo, `divida_liquida_sobre_patrimonio` quando a
// empresa nao publicou divida. Em SQL `NULL > 0.15` nao e falso e
// `NOT (NULL > 0.15)` tambem nao e verdadeiro; em JavaScript
// `null > 15` e `false`, o que e PIOR -- a linguagem entrega em silencio
// exatamente a mentira que o SQL se recusa a entregar.
//
// Dai o terceiro estado. "Sem dado" nao e "nao atingido": num crivo de divida,
// tratar ausencia como zero APROVA a empresa que nao publicou divida nenhuma.

/** O que um criterio respondeu. Tres estados, nunca dois. */
export type EstadoDoCrivo = "atingido" | "nao_atingido" | "sem_dado";

/** O lado bom do limite: rentabilidade quer acima, alavancagem quer abaixo. */
export type DirecaoDoCrivo = "acima" | "abaixo";

/**
 * Em que unidade o limite e digitado e o valor exibido.
 *
 * `percentual`: a tela fala em 15%, a view guarda 0,15.
 * `multiplicador`: a tela fala em 1,0x e a view guarda 1,0 -- razao entre dois
 * valores monetarios nao tem porcentagem natural, e escrever "100%" para uma
 * divida igual ao patrimonio e como o mercado NAO le esse indicador.
 */
export type UnidadeDoCrivo = "percentual" | "multiplicador";

/** As colunas de `public.cvm_indicadores` que esta tela le. */
export interface LinhaDeIndicadores {
  ticker: string;
  denominacao?: string | null;
  ano_exercicio: number | string;
  data_base: string;
  roe?: number | string | null;
  margem_liquida?: number | string | null;
  divida_liquida_sobre_patrimonio?: number | string | null;
}

export interface DefinicaoDeCrivo {
  /**
   * O id e GRAVADO no jsonb de cada usuario (`profiles.preferences.crivos`).
   * Renomear aqui nao renomeia um rotulo: apaga o limite de quem ja editou,
   * porque `lerLimites` descarta id desconhecido e cai no padrao. Se um dia for
   * preciso, o caminho e traduzir o id antigo na leitura.
   */
  id: string;
  rotulo: string;
  /** A coluna da view. UMA fonte por indicador -- ver `FONTE_DECLARADA`. */
  campo: "roe" | "margem_liquida" | "divida_liquida_sobre_patrimonio";
  direcao: DirecaoDoCrivo;
  unidade: UnidadeDoCrivo;
  /** Sugestao inicial, na unidade da TELA (15 = 15%, nao 0,15). */
  limitePadrao: number;
  /** Faixa aceita na edicao. Fora dela a rota recusa em vez de corrigir. */
  limiteMinimo: number;
  limiteMaximo: number;
  /** O que o indicador significa, em uma linha, sem dizer se e bom. */
  explicacao: string;
}

/**
 * De onde cada indicador sai -- a conta, nao o arquivo.
 *
 * A regra herdada da entrega 4: a mesma PETR4 tinha tres P/L defensaveis no
 * mesmo dia (4,79 / 5,77 / 6,00 -- 25% de distancia), e um crivo "P/L abaixo de
 * 6" aprova ou reprova conforme quem calculou. "Vem da DRE" nao desempata entre
 * lucro do periodo e lucro atribuido aos controladores, que sao contas
 * diferentes de nome parecido; o codigo da conta desempata.
 *
 * A derivacao mora na VIEW, nao aqui. Este mapa e o que a tela IMPRIME para que
 * o numero seja auditavel por quem o le -- se ele virasse uma segunda
 * implementacao da conta, seria a origem do proximo desacordo.
 */
export const FONTE_DECLARADA: Record<DefinicaoDeCrivo["campo"], string> = {
  roe: "DFP anual da CVM — lucro líquido (DRE 3.11) ÷ patrimônio líquido (BPP 2.03)",
  margem_liquida:
    "DFP anual da CVM — lucro líquido (DRE 3.11) ÷ receita líquida (DRE 3.01)",
  divida_liquida_sobre_patrimonio:
    "DFP anual da CVM — dívida bruta menos caixa e aplicações ÷ patrimônio líquido (BPP 2.03)",
};

/**
 * Os crivos desta entrega, na ordem em que a tela os mostra.
 *
 * Os limites iniciais vieram da decisao do Helio em 30/09: ROE acima de 15%,
 * divida liquida sobre patrimonio abaixo de 1,0x, margem liquida acima de 10%.
 */
export const CRIVOS: DefinicaoDeCrivo[] = [
  {
    id: "roe",
    rotulo: "Retorno sobre o patrimônio (ROE)",
    campo: "roe",
    direcao: "acima",
    unidade: "percentual",
    limitePadrao: 15,
    limiteMinimo: -100,
    limiteMaximo: 200,
    explicacao:
      "Quanto a empresa lucrou no ano para cada real de patrimônio dos sócios.",
  },
  {
    id: "divida-liquida-sobre-patrimonio",
    rotulo: "Dívida líquida sobre patrimônio",
    campo: "divida_liquida_sobre_patrimonio",
    direcao: "abaixo",
    unidade: "multiplicador",
    limitePadrao: 1,
    limiteMinimo: -10,
    limiteMaximo: 20,
    explicacao:
      "Quantas vezes o patrimônio a empresa deve, já descontado o caixa que ela tem.",
  },
  {
    id: "margem-liquida",
    rotulo: "Margem líquida",
    campo: "margem_liquida",
    direcao: "acima",
    unidade: "percentual",
    limitePadrao: 10,
    limiteMinimo: -100,
    limiteMaximo: 100,
    explicacao: "Quanto sobrou de lucro em cada real de receita do ano.",
  },
];

/**
 * O quarto crivo da issue, e por que ele NAO esta na lista acima.
 *
 * Dividend yield = dividendo distribuido / valor de mercado, e valor de mercado
 * = preco atual x quantidade de acoes. A view entrega o numerador
 * (`dividendos_distribuidos`) e nao entrega o denominador: preco nao e CVM.
 * Hoje `investment_assets.current_price` e DIGITADO A MAO, e e justamente o que
 * a HMO-191 automatiza.
 *
 * Exibir o yield agora obrigaria uma de duas coisas: ou dizer de quando e o
 * preco em cada card (dividendo de 2025 sobre preco de marco produz um numero
 * que nenhuma das duas datas justifica), ou nao dizer -- e nao dizer e o que a
 * issue proibiu. A escolha aqui e a recomendada por ela: entregar os tres
 * crivos que fecham sozinhos e declarar a ausencia na tela, em vez de segurar a
 * entrega ou publicar um numero com duas datas.
 *
 * Isto e conteudo de tela, nao comentario: a tela imprime `motivo`. Um quarto
 * criterio que simplesmente nao aparece se le como bug ou como esquecimento.
 */
export const CRIVOS_PENDENTES = [
  {
    id: "dividend-yield",
    rotulo: "Dividend yield",
    motivo:
      "Fica para depois da cotação automática: o yield precisa do valor de mercado, e o preço atual ainda é o que você digita. Calcular agora misturaria o dividendo do balanço com um preço de outra data.",
  },
] as const;

// ---------------------------------------------------------------------------
// Leitura de numero
// ---------------------------------------------------------------------------

/**
 * O que o PostgREST manda em coluna `numeric` e STRING, nao number.
 *
 * `Number("")` e `0` e `Number(null)` e `0`: os dois atalhos transformariam
 * ausencia em zero, e zero num crivo de divida APROVA. Por isso a funcao e
 * explicita nos dois casos, e `NaN` tambem sai como `null`.
 */
export function numeroOuNulo(valor: unknown): number | null {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string") {
    const limpo = valor.trim();
    if (limpo === "") return null;
    const n = Number(limpo);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * O UNICO lugar em que razao vira unidade de tela. Ver a armadilha 1.
 *
 * `percentual` multiplica por 100 porque a view divide dois valores monetarios;
 * `multiplicador` nao mexe, porque 0,80 na view ja e "0,80x" na tela.
 */
export function daViewParaUnidade(
  razao: number,
  unidade: UnidadeDoCrivo
): number {
  return unidade === "percentual" ? razao * 100 : razao;
}

// ---------------------------------------------------------------------------
// O limite do usuario, dentro de profiles.preferences
// ---------------------------------------------------------------------------
// Sem migration, de proposito. `profiles.preferences` e jsonb e esta em
// producao desde a 001_baseline; neste projeto migration nao tem runner, e uma
// tela que so funciona depois que alguem colar SQL num painel nasce quebrada
// para todo mundo que entrar antes disso. Mesmo desenho de lib/moeda.ts e
// lib/dashboard-layout.ts.

/** A chave dentro de `profiles.preferences`. */
export const CHAVE_DE_CRIVOS = "crivos";

/** Limite por id de crivo, na unidade da tela. */
export type LimitesDosCrivos = Record<string, number>;

function objeto(valor: unknown): Record<string, unknown> | null {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : null;
}

export function limitesPadrao(): LimitesDosCrivos {
  const saida: LimitesDosCrivos = {};
  for (const crivo of CRIVOS) saida[crivo.id] = crivo.limitePadrao;
  return saida;
}

function limiteAceitavel(crivo: DefinicaoDeCrivo, valor: unknown): boolean {
  const n = numeroOuNulo(valor);
  return n !== null && n >= crivo.limiteMinimo && n <= crivo.limiteMaximo;
}

/**
 * Le os limites de dentro do jsonb. Sempre devolve um limite por crivo do
 * CATALOGO -- nem um a mais, nem um a menos.
 *
 * Tolerante de proposito, como `lerPreferenciaDeMoeda`: qualquer coisa estranha
 * no caminho (chave ausente numa conta antiga, mao humana no jsonb, versao
 * anterior do app) cai no padrao em vez de explodir. Um limite ilegivel nao
 * pode deixar a lista de criterios branca.
 *
 * E a razao de o CATALOGO mandar, e nao o que esta salvo, e a mesma de
 * `normalizarLayout`: no dia em que um crivo novo entrar, todo usuario que ja
 * salvou limite tem no banco um objeto que nao o menciona. Se a tela mostrasse
 * apenas o que esta salvo, o criterio novo ficaria invisivel justamente para
 * quem mais usa o app.
 */
export function lerLimites(preferences: unknown): LimitesDosCrivos {
  const raiz = objeto(preferences);
  const bloco = raiz ? objeto(raiz[CHAVE_DE_CRIVOS]) : null;
  const salvos = bloco ? objeto(bloco.limites) : null;

  const saida = limitesPadrao();
  if (!salvos) return saida;

  for (const crivo of CRIVOS) {
    if (limiteAceitavel(crivo, salvos[crivo.id])) {
      saida[crivo.id] = numeroOuNulo(salvos[crivo.id]) as number;
    }
  }
  return saida;
}

/**
 * O `preferences` INTEIRO, com o bloco de crivos trocado.
 *
 * Devolve o objeto completo porque e isso que a rota grava na coluna.
 * `preferences` nao e "as configuracoes de crivo": e o jsonb inteiro do perfil
 * -- painel, moeda, notificacoes, privacidade. Um PUT que escrevesse
 * `{ crivos: ... }` direto apagaria o resto, e apagaria em silencio.
 */
export function mesclarLimites(
  preferencesAtuais: unknown,
  limites: LimitesDosCrivos
): Record<string, unknown> {
  const raiz = objeto(preferencesAtuais) ?? {};
  const bloco = objeto(raiz[CHAVE_DE_CRIVOS]) ?? {};
  return {
    ...raiz,
    [CHAVE_DE_CRIVOS]: { ...bloco, limites: { ...limites } },
  };
}

/**
 * Valida o corpo do PUT.
 *
 * Recusa em vez de corrigir, ao contrario de `lerLimites`. A leitura e tolerante
 * porque le dado que JA existe e nao pode derrubar a tela; a ESCRITA e o oposto
 * -- salvar "abc" silenciosamente trocado por 15 mostraria "salvo" com outro
 * criterio gravado, e a pessoa descobre depois, olhando uma lista de criterios
 * que nao e a dela.
 */
export function validarLimites(
  corpo: unknown
): { ok: true; valor: LimitesDosCrivos } | { ok: false; erro: string } {
  const bloco = objeto(corpo);
  if (!bloco) return { ok: false, erro: "Corpo inválido" };

  const limites = objeto(bloco.limites);
  if (!limites) return { ok: false, erro: "Informe os limites dos critérios" };

  const saida: LimitesDosCrivos = {};
  for (const crivo of CRIVOS) {
    // Chave ausente NAO vira padrao: a tela manda os tres juntos, e um corpo
    // incompleto e bug de cliente. Completar em silencio gravaria um criterio
    // que ninguem escolheu.
    if (!(crivo.id in limites)) {
      return { ok: false, erro: `Falta o limite de ${crivo.rotulo}` };
    }
    if (!limiteAceitavel(crivo, limites[crivo.id])) {
      return {
        ok: false,
        erro: `O limite de ${crivo.rotulo} tem que ser um número entre ${crivo.limiteMinimo} e ${crivo.limiteMaximo}`,
      };
    }
    saida[crivo.id] = numeroOuNulo(limites[crivo.id]) as number;
  }
  return { ok: true, valor: saida };
}

// ---------------------------------------------------------------------------
// O ultimo balanco fechado, empresa por empresa
// ---------------------------------------------------------------------------

/**
 * A linha de maior `ano_exercicio` de cada ticker. Ver a armadilha 2.
 *
 * Empate de ano no mesmo ticker nao deveria existir (a PK de `cvm_fundamentos` e
 * `codigo_cvm` + `ano_exercicio` e `ticker` e PK da ponte), mas se existir vale
 * a de `data_base` mais recente -- determinismo aqui importa mais do que qual
 * das duas vence, porque "o card muda de valor a cada recarga" e um bug que
 * ninguem consegue reproduzir.
 *
 * Ticker e comparado em maiuscula: `investment_assets.symbol` e digitado pelo
 * usuario e a ponte guarda o ticker normalizado.
 */
export function ultimoExercicioPorTicker(
  linhas: LinhaDeIndicadores[]
): Map<string, LinhaDeIndicadores> {
  const porTicker = new Map<string, LinhaDeIndicadores>();

  for (const linha of linhas) {
    if (typeof linha?.ticker !== "string") continue;
    const chave = linha.ticker.trim().toUpperCase();
    if (chave === "") continue;

    const atual = porTicker.get(chave);
    if (atual === undefined) {
      porTicker.set(chave, linha);
      continue;
    }

    const anoNovo = numeroOuNulo(linha.ano_exercicio) ?? -Infinity;
    const anoAtual = numeroOuNulo(atual.ano_exercicio) ?? -Infinity;
    if (anoNovo > anoAtual) {
      porTicker.set(chave, linha);
    } else if (anoNovo === anoAtual && String(linha.data_base) > String(atual.data_base)) {
      porTicker.set(chave, linha);
    }
  }

  return porTicker;
}

// ---------------------------------------------------------------------------
// A avaliacao de um criterio
// ---------------------------------------------------------------------------

export interface AvaliacaoDeCrivo {
  id: string;
  rotulo: string;
  explicacao: string;
  fonte: string;
  direcao: DirecaoDoCrivo;
  unidade: UnidadeDoCrivo;
  /** O limite do usuario, na unidade da tela. */
  limite: number;
  /** O valor da empresa, JA na unidade da tela. `null` = sem dado. */
  valor: number | null;
  estado: EstadoDoCrivo;
  /** O criterio em palavras, como a tela o imprime: "acima de 15%". */
  criterio: string;
}

/**
 * Compara um indicador com o limite do usuario.
 *
 * A comparacao e ESTRITA, e isso e uma escolha: "acima de 15%" nao inclui 15%.
 * Um crivo que aprovasse o valor exatamente igual ao limite estaria dizendo
 * "acima ou igual", que e outro criterio -- e o rotulo na tela e o contrato.
 */
export function avaliarCrivo(
  linha: LinhaDeIndicadores | null | undefined,
  crivo: DefinicaoDeCrivo,
  limite: number
): AvaliacaoDeCrivo {
  const base: Omit<AvaliacaoDeCrivo, "valor" | "estado"> = {
    id: crivo.id,
    rotulo: crivo.rotulo,
    explicacao: crivo.explicacao,
    fonte: FONTE_DECLARADA[crivo.campo],
    direcao: crivo.direcao,
    unidade: crivo.unidade,
    limite,
    criterio: `${crivo.direcao} de ${formatarLimite(limite, crivo.unidade)}`,
  };

  const razao = linha ? numeroOuNulo(linha[crivo.campo]) : null;
  if (razao === null) {
    // Ver a armadilha 3. Nao ha comparacao a fazer aqui: qualquer numero que
    // saisse deste caminho seria inventado, e um deles aprovaria a empresa.
    return { ...base, valor: null, estado: "sem_dado" };
  }

  const valor = daViewParaUnidade(razao, crivo.unidade);
  const atingido =
    crivo.direcao === "acima" ? valor > limite : valor < limite;

  return { ...base, valor, estado: atingido ? "atingido" : "nao_atingido" };
}

// ---------------------------------------------------------------------------
// O ativo: dentro ou fora dos crivos, e por que
// ---------------------------------------------------------------------------

/**
 * Por que um ativo nao tem criterios avaliados.
 *
 * Cada motivo tem texto proprio porque eles pedem acoes OPOSTAS: `fii` nunca vai
 * ter esse dado, `sem_fundamento` pode ter amanha, `fonte_indisponivel` e
 * problema nosso. Um "—" servindo para os tres se le como "ainda carregando" ou
 * como zero, e zero num crivo de divida APROVA.
 */
export type MotivoForaDosCrivos =
  | "fii"
  | "renda_fixa"
  | "internacional"
  | "sem_fundamento"
  | "fonte_indisponivel";

/**
 * O estado explicito do FII, que e decisao de produto e nao limitacao de codigo.
 *
 * HGLG11, MXRF11 e KNRI11 voltam ZERO resultado na base da CVM: fundo
 * imobiliario nao e companhia listada e nao entrega DFP. Nao serve deixar quatro
 * campos vazios -- vazio se le como "ainda nao carregou" ou como zero.
 */
export const EXPLICACAO_FORA_DOS_CRIVOS: Record<MotivoForaDosCrivos, string> = {
  fii: "Fundo imobiliário não publica balanço de companhia na CVM, então ROE, dívida e margem não existem para este ativo. A cotação e o patrimônio dele continuam normais na carteira.",
  renda_fixa:
    "Renda fixa não tem balanço de companhia: estes critérios são de resultado de empresa e não se aplicam a este ativo.",
  internacional:
    "Ativo internacional fica fora destes critérios. A fonte é a DFP anual da CVM, que cobre companhia brasileira listada.",
  sem_fundamento:
    "O balanço deste ativo ainda não foi importado da CVM. Nenhum critério foi avaliado — isto não é reprovação.",
  fonte_indisponivel:
    "A base de fundamento da CVM não respondeu agora. Nenhum critério foi avaliado — isto não é reprovação.",
};

/** O ativo como a rota o le de `investment_assets`. */
export interface AtivoParaCrivos {
  id: string;
  symbol: string;
  name: string;
  type: "stock" | "fii" | "fixed_income" | "international";
}

export interface AtivoComCrivos {
  assetId: string;
  symbol: string;
  name: string;
  /** `null` quando os criterios se aplicam e foram avaliados. */
  foraDosCrivos: MotivoForaDosCrivos | null;
  /** O texto que a tela imprime no lugar dos criterios. */
  explicacao: string | null;
  /** A razao social da CVM -- o que prova que a ponte casou a empresa certa. */
  denominacao: string | null;
  anoExercicio: number | null;
  /** `data_base` do balanco usado, em "YYYY-MM-DD". */
  dataBase: string | null;
  avaliacoes: AvaliacaoDeCrivo[];
}

/** O tipo de ativo que a DFP da CVM cobre. */
const TIPO_FORA_DOS_CRIVOS: Partial<
  Record<AtivoParaCrivos["type"], MotivoForaDosCrivos>
> = {
  fii: "fii",
  fixed_income: "renda_fixa",
  international: "internacional",
};

/**
 * Monta o bloco de um ativo: os criterios, ou a explicacao de por que nao ha.
 *
 * `fonteIndisponivel` existe porque a migration 028 pode nao estar aplicada no
 * banco em que o app roda -- neste projeto migration nao tem runner. Nesse caso
 * a leitura da view falha, e a resposta certa e uma frase na tela, nao uma faixa
 * vermelha de erro na pagina inteira de investimentos nem tres campos vazios.
 */
export function montarCrivosDoAtivo(
  ativo: AtivoParaCrivos,
  linha: LinhaDeIndicadores | null | undefined,
  limites: LimitesDosCrivos,
  fonteIndisponivel = false
): AtivoComCrivos {
  const semCriterios = (motivo: MotivoForaDosCrivos): AtivoComCrivos => ({
    assetId: ativo.id,
    symbol: ativo.symbol,
    name: ativo.name,
    foraDosCrivos: motivo,
    explicacao: EXPLICACAO_FORA_DOS_CRIVOS[motivo],
    denominacao: null,
    anoExercicio: null,
    dataBase: null,
    avaliacoes: [],
  });

  // A ordem importa. O tipo do ativo vem ANTES da fonte indisponivel: dizer a um
  // FII que "a base nao respondeu" sugere que um dia ela responde, e ela nao vai.
  const porTipo = TIPO_FORA_DOS_CRIVOS[ativo.type];
  if (porTipo) return semCriterios(porTipo);
  if (fonteIndisponivel) return semCriterios("fonte_indisponivel");
  if (!linha) return semCriterios("sem_fundamento");

  const efetivos = lerLimites({ [CHAVE_DE_CRIVOS]: { limites } });

  return {
    assetId: ativo.id,
    symbol: ativo.symbol,
    name: ativo.name,
    foraDosCrivos: null,
    explicacao: null,
    denominacao: linha.denominacao ?? null,
    anoExercicio: numeroOuNulo(linha.ano_exercicio),
    dataBase: linha.data_base ?? null,
    avaliacoes: CRIVOS.map((crivo) =>
      avaliarCrivo(linha, crivo, efetivos[crivo.id])
    ),
  };
}

/** Os blocos de toda a carteira, na ordem em que os ativos chegaram. */
export function montarCrivosDaCarteira(
  ativos: AtivoParaCrivos[],
  linhas: LinhaDeIndicadores[],
  limites: LimitesDosCrivos,
  fonteIndisponivel = false
): AtivoComCrivos[] {
  const porTicker = ultimoExercicioPorTicker(linhas);
  return ativos.map((ativo) =>
    montarCrivosDoAtivo(
      ativo,
      porTicker.get(String(ativo.symbol ?? "").trim().toUpperCase()),
      limites,
      fonteIndisponivel
    )
  );
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/**
 * O rotulo de cada estado.
 *
 * "Sem dado no balanço" nao e uma forma polida de reprovar, e o texto precisa
 * deixar isso obvio a quem le a tela sem ler esta issue: os tres rotulos sao
 * frases diferentes, nao tres cores da mesma frase.
 */
export const ROTULO_DO_ESTADO: Record<EstadoDoCrivo, string> = {
  atingido: "Atingido",
  nao_atingido: "Não atingido",
  sem_dado: "Sem dado no balanço",
};

/** Duas casas em pt-BR, com o sufixo da unidade. */
export function formatarValorDoCrivo(
  valor: number | null,
  unidade: UnidadeDoCrivo
): string {
  if (valor === null) return "—";
  const n = valor.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return unidade === "percentual" ? `${n}%` : `${n}x`;
}

/**
 * O limite em prosa. Percentual sai sem casa decimal quando e inteiro ("15%",
 * nao "15,00%"); multiplicador sempre com uma ("1,0x"), porque "abaixo de 1x"
 * se le como numero redondo de gente e "1,0x" se le como limite medido.
 */
export function formatarLimite(
  limite: number,
  unidade: UnidadeDoCrivo
): string {
  if (unidade === "multiplicador") {
    return `${limite.toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    })}x`;
  }
  return `${limite.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

/**
 * O limite como o campo `<input type="number">` precisa dele.
 *
 * Ponto decimal, nao virgula: um `value="1,0"` num input numerico e valor
 * invalido e o navegador o apaga -- o campo abre VAZIO, e o usuario conclui que
 * perdeu a configuracao. `formatarLimite` e para prosa; este e para o campo.
 */
export function formatarLimiteParaCampo(limite: number): string {
  return String(limite);
}

/**
 * Le o que foi digitado num campo de limite.
 *
 * Aceita virgula alem de ponto porque o teclado numerico do celular em pt-BR
 * manda virgula, e recusar isso deixaria o campo inutil justamente no aparelho
 * em que o app e um PWA instalado.
 *
 * Devolve `null` para o que nao da para ler -- inclusive campo vazio, que e
 * estado normal de quem apagou para digitar outro numero. Quem chama decide o
 * que fazer com `null`; ver `limitesEfetivos`.
 */
export function lerLimiteDigitado(texto: string): number | null {
  if (typeof texto !== "string") return null;
  const limpo = texto.trim().replace(",", ".");
  if (limpo === "") return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/**
 * Os limites que a tela deve USAR agora, a partir do que esta nos campos.
 *
 * Campo ilegivel ou vazio cai no limite SALVO, nao no padrao de fabrica: quem
 * apagou o campo para redigitar nao pediu para voltar ao 15%, e ver o criterio
 * saltar para o padrao no meio da digitacao parece perda de configuracao.
 *
 * Limite fora da faixa tambem cai no salvo -- a tela nao avalia contra um
 * criterio que a rota vai recusar na hora de salvar.
 */
export function limitesEfetivos(
  textos: Record<string, string>,
  salvos: LimitesDosCrivos
): LimitesDosCrivos {
  const base = lerLimites({ [CHAVE_DE_CRIVOS]: { limites: salvos } });
  const saida: LimitesDosCrivos = { ...base };

  for (const crivo of CRIVOS) {
    const digitado = lerLimiteDigitado(textos[crivo.id] ?? "");
    if (digitado !== null && limiteAceitavel(crivo, digitado)) {
      saida[crivo.id] = digitado;
    }
  }
  return saida;
}

/** Os campos como eles abrem, a partir dos limites salvos. */
export function textosIniciais(salvos: LimitesDosCrivos): Record<string, string> {
  const saida: Record<string, string> = {};
  const base = lerLimites({ [CHAVE_DE_CRIVOS]: { limites: salvos } });
  for (const crivo of CRIVOS) {
    saida[crivo.id] = formatarLimiteParaCampo(base[crivo.id]);
  }
  return saida;
}

/**
 * A data-base em dd/mm/aaaa, cortando a string.
 *
 * `new Date("2025-12-31")` e meia-noite UTC, e em Sao Paulo (UTC-3) isso e
 * 21:00 de 30/12 -- um `toLocaleDateString` imprimiria a data-base um dia
 * antes do que a CVM publicou. Nao ha hora nenhuma nesta data para converter.
 */
export function formatarDataBase(iso: string | null): string {
  if (typeof iso !== "string") return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return "—";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// ---------------------------------------------------------------------------
// A trava de vocabulario
// ---------------------------------------------------------------------------

/**
 * Palavras que nao podem aparecer na interface desta feature.
 *
 * A decisao de produto -- lista de criterios, sem nota -- nao sobrevive a uma
 * unica frase de conveniencia acrescentada seis meses depois ("3 de 3: bom para
 * comprar"). Ela nao quebra teste nenhum, nao muda numero nenhum, e transforma
 * a ferramenta em recomendacao de investimento.
 *
 * Por isso isto e uma lista executavel, varrida contra o HTML renderizado pela
 * suite, e nao um pedido em comentario. Os radicais sao curtos de proposito:
 * "recomend" pega recomendado, recomendamos e recomendacao.
 */
export const VOCABULARIO_PROIBIDO = [
  "comprar",
  "compre",
  "vender",
  "venda",
  "recomend",
  "score",
  "nota final",
  "pontuacao",
  "pontuação",
  "ranking",
  "melhor ação",
  "boa ação",
  "vale a pena",
  "oportunidade",
  "barata",
  "caro para",
] as const;

/**
 * Os termos proibidos encontrados num texto, em minuscula e sem acento.
 *
 * Devolve a LISTA e nao um booleano para que a mensagem de falha diga qual
 * palavra apareceu -- "o HTML tem vocabulario de recomendacao" manda quem
 * conserta procurar no escuro.
 */
export function vocabularioDeRecomendacao(texto: string): string[] {
  const semAcento = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      // A faixa dos diacriticos combinantes, escrita com escape: um caractere
      // combinante colado no fonte e invisivel no editor e sobrevive a um
      // `replace` de outra pessoa sem que ninguem veja o que mudou.
      .replace(/[\u0300-\u036f]/g, "");

  const alvo = semAcento(String(texto));
  return VOCABULARIO_PROIBIDO.filter((termo) => alvo.includes(semAcento(termo)));
}
