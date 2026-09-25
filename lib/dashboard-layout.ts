// -----------------------------------------------------------------------------
// O QUE APARECE NO PAINEL, E EM QUE ORDEM
// -----------------------------------------------------------------------------
// A tela inicial tinha sete blocos numa ordem fixa, escrita no JSX. Quem nao
// usa grupo via "Metas" antes de "Suas contas" e nao podia fazer nada a
// respeito; quem so quer saber quanto pode gastar rolava a tela ate achar o
// bloco. A HMO-159 deixa essa escolha com o usuario -- o que ver e em que
// ordem.
//
// ONDE ISSO MORA, E POR QUE NAO HA MIGRATION AQUI
// -----------------------------------------------
// A preferencia e gravada em `profiles.preferences.dashboard.layout`, dentro
// da coluna jsonb que existe desde a 001_baseline e ja esta aplicada em
// producao. Uma tabela nova exigiria migration, e neste projeto migration nao
// tem runner: quem aplica e uma pessoa colando o arquivo no SQL Editor. A 019
// esta na main desde 25/09 e ainda nao foi aplicada. Uma aba de configuracao
// que so funciona depois que alguem colar SQL num painel nasce quebrada para
// todo usuario que entrar antes disso -- e quebrada do jeito pior, com erro
// 500 numa tela cujo unico proposito e mexer em preferencia.
//
// O PRECO DE GUARDAR PREFERENCIA DE TELA NUM JSONB
// ------------------------------------------------
// O banco nao valida nada aqui dentro. O que volta do jsonb e literalmente
// `unknown`: pode ser null (usuario novo), pode ser um objeto de uma versao
// anterior do app, pode ser lixo. Por isso NADA neste modulo confia no que leu
// -- `normalizarLayout` e a unica porta de entrada, e ela sempre devolve uma
// lista completa e valida, inclusive quando recebe `undefined`.
//
// O MODO DE FALHA QUE `normalizarLayout` EXISTE PARA IMPEDIR
// ---------------------------------------------------------
// E o silencioso, e ele so aparece meses depois: no dia em que o painel ganhar
// um bloco novo, TODO usuario que ja salvou um layout tem no banco uma lista
// que nao menciona esse bloco. Se a tela renderizasse apenas o que esta salvo,
// o bloco novo ficaria invisivel para exatamente as pessoas que mais usam o
// app -- as que configuraram o painel -- enquanto aparece normalmente para
// quem nunca abriu as configuracoes. Ninguem abre chamado para uma feature que
// nao sabe que existe: o bug seria descoberto, se fosse, por acaso.
//
// Dai a regra: o CATALOGO manda em quais secoes existem, o layout salvo manda
// so na ORDEM e na VISIBILIDADE. Secao que o catalogo nao conhece e descartada
// (foi removida do app), secao que o catalogo conhece e o layout nao menciona
// entra no fim, VISIVEL.
// -----------------------------------------------------------------------------

/** Uma secao do painel, do ponto de vista de quem configura. */
export interface SecaoDoPainel {
  id: string;
  /** Como a secao se chama na tela de configuracoes. */
  titulo: string;
  /** O que ela mostra, em uma linha. */
  descricao: string;
}

/** A preferencia de uma secao: onde ela entra na ordem, e se aparece. */
export interface ItemDeLayout {
  id: string;
  visivel: boolean;
}

// -----------------------------------------------------------------------------
// O catalogo
// -----------------------------------------------------------------------------
// A ordem desta lista e a ordem de fabrica do painel, e ela nao e alfabetica
// nem arbitraria: e a ordem em que as perguntas aparecem na cabeca de quem
// abre o app. Quanto eu tenho -> quanto posso gastar -> o que esta atrasado ->
// o que vence -> para onde estou indo -> onde o dinheiro esta -> o que faco
// agora.
//
// Os `id` sao gravados no banco de cada usuario. Renomear um id aqui NAO e
// renomear um rotulo: e apagar a preferencia de todo mundo que ja configurou
// aquela secao, porque `normalizarLayout` vai descartar o id antigo como
// desconhecido e reinserir o novo no fim, visivel. Se um dia for preciso
// mesmo, o caminho e traduzir o id antigo na normalizacao, nao trocar a
// string aqui.
export const SECOES_DO_PAINEL: SecaoDoPainel[] = [
  {
    id: "resumo",
    titulo: "Os quatro números",
    descricao:
      "Saldo das contas, o que entrou e saiu no mês e o custo fixo mensal",
  },
  {
    id: "posso-gastar",
    titulo: "Quanto ainda posso gastar",
    descricao: "O que sobra até o fim do mês depois de tudo já comprometido",
  },
  {
    id: "vencidas",
    titulo: "Aviso de contas vencidas",
    descricao: "A faixa de alerta com o total em atraso",
  },
  {
    id: "a-vencer",
    titulo: "A vencer neste mês",
    descricao: "Quanto e quantas contas ainda vencem",
  },
  {
    id: "metas",
    titulo: "Metas",
    descricao: "O progresso das suas metas ativas",
  },
  {
    id: "contas",
    titulo: "Suas contas",
    descricao: "O saldo de cada conta, uma a uma",
  },
  {
    id: "atalhos",
    titulo: "Atalhos",
    descricao: "Os quatro botões de acesso rápido no rodapé do painel",
  },
];

/** O layout de fabrica: tudo visivel, na ordem do catalogo. */
export function layoutPadrao(): ItemDeLayout[] {
  return SECOES_DO_PAINEL.map((secao) => ({ id: secao.id, visivel: true }));
}

/**
 * Transforma o que veio do banco numa lista completa e confiavel.
 *
 * Sempre devolve uma entrada por secao do catalogo -- nem uma a mais, nem uma
 * a menos. Ver o cabecalho do arquivo para o porque de cada regra:
 *
 *   * entrada que nao e objeto, ou sem `id` string  -> ignorada
 *   * id repetido                                   -> vale a primeira
 *   * id fora do catalogo                           -> descartado
 *   * secao do catalogo ausente do salvo            -> vai para o fim, VISIVEL
 *   * `visivel` que nao e boolean                   -> tratado como true
 *
 * A ultima regra tem a mesma logica das outras: na duvida, MOSTRAR. Um bloco
 * que aparece sem o usuario ter pedido e um incomodo que ele conserta em dois
 * cliques; um bloco que some sozinho e dinheiro que ele deixa de ver sem
 * saber que deixou.
 */
export function normalizarLayout(bruto: unknown): ItemDeLayout[] {
  const conhecidos = new Set(SECOES_DO_PAINEL.map((s) => s.id));
  const salvo = Array.isArray(bruto) ? bruto : [];

  const resultado: ItemDeLayout[] = [];
  const jaVistos = new Set<string>();

  for (const entrada of salvo) {
    if (typeof entrada !== "object" || entrada === null) continue;
    const { id, visivel } = entrada as { id?: unknown; visivel?: unknown };
    if (typeof id !== "string") continue;
    if (!conhecidos.has(id)) continue;
    if (jaVistos.has(id)) continue;

    jaVistos.add(id);
    resultado.push({ id, visivel: visivel !== false });
  }

  for (const secao of SECOES_DO_PAINEL) {
    if (!jaVistos.has(secao.id)) {
      resultado.push({ id: secao.id, visivel: true });
    }
  }

  return resultado;
}

/**
 * Move uma secao uma posicao para cima (-1) ou para baixo (+1).
 *
 * Existe porque arrastar nao e um gesto universal: o HTML5 drag-and-drop nao
 * dispara em tela de toque, e este app e um PWA que as pessoas instalam no
 * celular. Sem estes botoes, reordenar o painel funcionaria so no desktop --
 * e falharia sem mensagem nenhuma no celular, onde o dedo apenas rola a
 * pagina. Os botoes tambem sao o caminho de quem navega por teclado.
 *
 * Devolve uma lista NOVA. Nos limites (topo e fundo) devolve a lista original
 * inalterada, em vez de dar a volta: quem clica "subir" no primeiro item
 * espera que nada aconteca, nao que o item apareca no rodape.
 */
export function moverSecao(
  layout: ItemDeLayout[],
  id: string,
  direcao: -1 | 1
): ItemDeLayout[] {
  const de = layout.findIndex((item) => item.id === id);
  if (de === -1) return layout;

  const para = de + direcao;
  if (para < 0 || para >= layout.length) return layout;

  const copia = [...layout];
  const [item] = copia.splice(de, 1);
  copia.splice(para, 0, item);
  return copia;
}

/**
 * Reordena colocando `idArrastado` na posicao que `idAlvo` ocupa hoje.
 *
 * O detalhe que engana -- e que a primeira versao desta funcao errou: os dois
 * indices tem que ser lidos na lista ORIGINAL, antes de remover o item
 * arrastado. Procurar o alvo DEPOIS do `splice` devolve o indice dele na lista
 * ja encurtada, e arrastar para baixo deixa o item sempre uma posicao antes do
 * lugar onde o cursor soltou.
 *
 * E um erro que nao quebra nada: a lista continua valida, salva sem reclamar,
 * e a tela nao mostra erro nenhum. O usuario so sente que "o arrastar nao pega
 * direito" -- e isso nao vira chamado, vira desistencia.
 *
 * Inserir no indice original funciona nas duas direcoes. Para baixo, a remocao
 * ja puxou tudo que vinha depois uma casa para tras, entao aquele indice passa
 * a ser exatamente o lugar do alvo; para cima, nada antes do alvo se moveu.
 */
export function reordenarPorArrasto(
  layout: ItemDeLayout[],
  idArrastado: string,
  idAlvo: string
): ItemDeLayout[] {
  if (idArrastado === idAlvo) return layout;

  const de = layout.findIndex((item) => item.id === idArrastado);
  const para = layout.findIndex((item) => item.id === idAlvo);
  if (de === -1 || para === -1) return layout;

  const copia = [...layout];
  const [item] = copia.splice(de, 1);
  copia.splice(para, 0, item);
  return copia;
}

/** Liga ou desliga uma secao, preservando a ordem. */
export function alternarVisibilidade(
  layout: ItemDeLayout[],
  id: string
): ItemDeLayout[] {
  return layout.map((item) =>
    item.id === id ? { ...item, visivel: !item.visivel } : item
  );
}

/**
 * Os ids visiveis, na ordem -- o que a tela inicial de fato consome.
 */
export function secoesVisiveis(layout: ItemDeLayout[]): string[] {
  return layout.filter((item) => item.visivel).map((item) => item.id);
}

/**
 * As secoes que ocupam meia largura no desktop.
 *
 * "A vencer neste mes" e "Metas" sempre dividiram uma linha na tela inicial, e
 * as duas sao cartoes baixos -- cada uma sozinha numa linha inteira deixaria
 * um vazio largo do lado.
 */
export const SECOES_DE_MEIA_LARGURA = new Set(["a-vencer", "metas"]);

/**
 * Agrupa a ordem visivel em linhas, juntando meias-larguras VIZINHAS.
 *
 * Sem isto, a alternativa seria uma grade de duas colunas com os blocos
 * grandes ocupando as duas. Parece equivalente e nao e: bastaria o usuario
 * colocar um bloco largo entre "A vencer" e "Metas" para a grade deixar meia
 * linha vazia -- um buraco que ninguem pediu e que parece defeito de
 * renderizacao, nao consequencia da ordem escolhida.
 *
 * Juntando so quem esta lado a lado, a ordem de fabrica continua identica ao
 * que a tela sempre foi, e qualquer outra ordem produz linhas cheias.
 */
export function agruparEmLinhas(ordem: string[]): string[][] {
  const linhas: string[][] = [];

  for (let i = 0; i < ordem.length; i++) {
    const atual = ordem[i];
    const proximo = ordem[i + 1];

    if (
      SECOES_DE_MEIA_LARGURA.has(atual) &&
      proximo !== undefined &&
      SECOES_DE_MEIA_LARGURA.has(proximo)
    ) {
      linhas.push([atual, proximo]);
      i++;
    } else {
      linhas.push([atual]);
    }
  }

  return linhas;
}

/** O rotulo de uma secao, para quem so tem o id em maos. */
export function tituloDaSecao(id: string): string {
  return SECOES_DO_PAINEL.find((s) => s.id === id)?.titulo ?? id;
}
