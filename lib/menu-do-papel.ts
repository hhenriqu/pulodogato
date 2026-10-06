/**
 * O MENU REDUZIDO DO MODO "PAPEL DE PAO" -- HMO-284, ampliado pela HMO-294 e
 * pela HMO-299 (plano da HMO-279).
 *
 * Com o modo ligado o menu encolhe de 27 itens para 8. Este arquivo e a lista
 * daquelas 8 ROTAS e o filtro que as seleciona -- nada mais.
 *
 * POR QUE E UM FILTRO POR `href`, E NAO UMA SEGUNDA LISTA DE NAVEGACAO
 * --------------------------------------------------------------------
 * A tentacao e declarar aqui os 8 itens completos (nome, icone, rota) e o
 * `Sidebar` escolher entre duas listas. As duas divergiriam na primeira vez que
 * alguem renomeasse "Cartoes" ou mexesse num icone: o menu normal mudaria e o
 * do papel nao, sem nada falhar. Entao aqui so moram as ROTAS, e o item
 * renderizado continua sendo o MESMO objeto de `components/navegacao-do-menu`.
 *
 * O preco dessa escolha e conhecido e e o certo: se alguem mudar o `href` de
 * uma das oito telas sem mexer aqui, o item desaparece do menu reduzido em vez
 * de aparecer duplicado ou desatualizado. E `npm run test:menu-papel` reprova,
 * porque ele exige que a lista filtrada tenha EXATAMENTE estas oito rotas.
 *
 * O MODO NAO BLOQUEIA ROTA NENHUMA
 * --------------------------------
 * Esconder do menu e simplificar. Quem tiver `/dashboard/investments` nos
 * favoritos continua chegando la, com a pele de papel. Nao ha guarda de rota,
 * redirect nem `notFound()` em lugar nenhum -- devolver 404 na tela que mostra
 * o dinheiro do proprio usuario seria outra coisa, e nao e esta.
 *
 * O limite conhecido e aceito dessa regra: nenhuma das telas do modo foi
 * redesenhada, elas herdam a pele pelos tokens. A mais densa e
 * `/dashboard/expense-groups/[groupId]`, que a promessa de "bem simples" nao
 * alcanca -- e ainda assim e melhor que esconde-la de quem divide conta.
 *
 * O arquivo e puro de proposito -- sem React e sem icone -- para a suite
 * (`npm run test:menu-papel`) rodar sem navegador.
 */

/**
 * As oito telas do modo. Todas ja existiam antes da HMO-284; o modo nao
 * inventa tela nenhuma.
 *
 * AS CINCO PRIMEIRAS sao as telas de dinheiro. Sao 5 e nao 3: a frase da
 * issue-mae ("Dashboard, Receitas e Despesas e Contas e Cartoes") se lia
 * tambem como tres itens agrupados, mas as cinco telas ja existem separadas e
 * agrupar exigiria inventar duas telas novas.
 *
 * `/dashboard/profile` e `/dashboard/settings` entraram na HMO-294, e
 * `/dashboard/settings` conserta um defeito de navegacao: o espelho do
 * interruptor do modo vive em Configuracoes, e com o modo ligado aquela tela
 * era INALCANCAVEL pelo menu -- a unica saida do modo era o papelzinho do
 * cabecalho. "E tambem em configuracoes", que e o que a issue-mae pede, so e
 * verdade se der para chegar la de dentro do proprio modo.
 * `/dashboard/profile` vem junto porque e a outra tela de conta: quem usa o
 * modo simples precisa dos proprios dados tanto quanto qualquer outra pessoa, e
 * perfil nao e "tela avancada".
 *
 * `/dashboard/expense-groups` entrou na HMO-299 -- dividir conta com outra
 * pessoa e assunto de quem conta trocado, nao de quem gosta de planilha.
 *
 * NENHUMA DAS OITO TEM `requiredPlans`, entao o OUTRO filtro do `Sidebar` (o
 * `podeVerItem`, que e o do plano) nao toca em nenhuma delas: o menu reduzido e
 * identico para `admin`, `free`, `trader` e para quem ainda nao carregou a
 * assinatura. "Grupos" DECLARA `requiredFeature: "expense_groups"`, e isso nao
 * e filtro de visibilidade nenhum -- `requiredFeature` alimenta o selo premium
 * que o `Sidebar` pinta, e `podeVerItem` so esconde item cujo `requiredPlans`
 * contenha `admin`. Quem ligar o modo ve as oito, com ou sem a feature.
 *
 * A ORDEM aqui nao e a ordem do menu -- quem ordena e o array de navegacao, que
 * continua sendo percorrido na ordem dele. Esta lista e um conjunto; esta
 * escrita na ordem de exibicao so para quem le conferir de olho. (No array,
 * "Grupos" vem antes de "Perfil", que vem antes de "Configuracoes".)
 */
export const ROTAS_DO_MENU_DE_PAPEL: readonly string[] = [
  "/dashboard",
  "/dashboard/receitas",
  "/dashboard/despesas",
  "/dashboard/contas",
  "/dashboard/cartoes",
  "/dashboard/expense-groups",
  "/dashboard/profile",
  "/dashboard/settings",
] as const;

/** Esta rota sobrevive ao modo papel? */
export function noMenuDoPapel(href: string): boolean {
  return ROTAS_DO_MENU_DE_PAPEL.includes(href);
}

/**
 * O SEGUNDO filtro do menu, sobre o mesmo array do primeiro.
 *
 * Com o modo desligado devolve a lista intacta -- o mesmo array, nao uma copia:
 * o modo desligado e o caminho de todo mundo e nao deve custar nada.
 *
 * Generico em `T` para nao conhecer o `NavigationItem`: o unico campo que
 * interessa aqui e o `href`. Isso tambem e o que permite ao arquivo nao
 * importar React nem lucide-react.
 */
export function filtrarMenuDoPapel<T extends { href: string }>(
  itens: readonly T[],
  papel: boolean
): readonly T[] {
  if (!papel) return itens;
  return itens.filter((item) => noMenuDoPapel(item.href));
}
