/**
 * O MENU REDUZIDO DO MODO "PAPEL DE PAO" -- HMO-284, ampliado pela HMO-294 e
 * pela HMO-299, e ENCOLHIDO de 8 para 3 pela HMO-466 (fase 5 do plano da
 * HMO-462).
 *
 * Com o modo ligado o menu encolhe de 29 telas para 3. Este arquivo e a lista
 * daquelas 3 ROTAS e o filtro que as seleciona -- nada mais.
 *
 * POR QUE E UM FILTRO POR `href`, E NAO UMA SEGUNDA LISTA DE NAVEGACAO
 * --------------------------------------------------------------------
 * A tentacao e declarar aqui os itens completos (nome, icone, rota) e o
 * `Sidebar` escolher entre duas listas. As duas divergiriam na primeira vez que
 * alguem renomeasse "Configuracoes" ou mexesse num icone: o menu normal mudaria
 * e o do papel nao, sem nada falhar. Entao aqui so moram as ROTAS, e o item
 * renderizado continua sendo o MESMO objeto de `components/navegacao-do-menu`.
 *
 * O preco dessa escolha e conhecido e e o certo: se alguem mudar o `href` de
 * uma das tres telas sem mexer aqui, o item desaparece do menu reduzido em vez
 * de aparecer duplicado ou desatualizado. E `npm run test:menu-papel` reprova,
 * porque ele exige que a lista filtrada tenha EXATAMENTE estas tres rotas.
 *
 * O MODO NAO BLOQUEIA ROTA NENHUMA
 * --------------------------------
 * Esconder do menu e simplificar. Quem tiver `/dashboard/investments` nos
 * favoritos continua chegando la, com a pele de papel. Nao ha guarda de rota,
 * redirect nem `notFound()` em lugar nenhum -- devolver 404 na tela que mostra
 * o dinheiro do proprio usuario seria outra coisa, e nao e esta. Isso vale
 * AGORA MAIS QUE ANTES: com 3 rotas no menu, 26 telas ficam fora dele, e
 * nenhuma delas fica fora do app.
 *
 * O arquivo e puro de proposito -- sem React e sem icone -- para a suite
 * (`npm run test:menu-papel`) rodar sem navegador.
 */

/**
 * As tres telas do modo. Todas ja existiam antes da HMO-284; o modo nao
 * inventa tela nenhuma.
 *
 * POR QUE 3, E POR QUE NAO 1
 * --------------------------
 * A issue-mae (HMO-462) quer o modo como uma CONVERSA: uma saudacao, tres
 * botoes, e o caminho andando dali. Um chat nao tem menu de relatorio ao lado,
 * entao a leitura natural seria deixar so `/dashboard`. As outras duas ficam
 * por motivo de navegacao, nao de feature:
 *
 * - `/dashboard/settings` e por onde a pessoa SAI do modo -- o espelho do
 *   interruptor vive la (`components/papel-de-pao/ConfiguracaoDePapel.tsx`).
 * - `/dashboard/profile` e de onde sai o nome da saudacao.
 *
 * Esconder os dois trancaria a pessoa dentro do modo, com o papelzinho do
 * cabecalho como unica saida. Esse e o mesmo defeito que a HMO-294 consertou
 * quando o menu tinha 5 itens, e ele volta inteiro se a lista virar 1.
 *
 * O QUE SAIU AQUI, E QUE E DE PROPOSITO
 * -------------------------------------
 * Sairam QUATRO das cinco telas de dinheiro -- `/dashboard/receitas`,
 * `/dashboard/despesas`, `/dashboard/contas` e `/dashboard/cartoes`. A quinta,
 * `/dashboard`, e justamente a que fica: e nela que a conversa mora, e e ela
 * que passa a responder "gastei", "ganhei" e "saldo". Um menu com as quatro
 * telas de relatorio ao lado da conversa seria as duas coisas ao mesmo tempo.
 *
 * E saiu `/dashboard/expense-groups`, o que REVERTE A HMO-299 DE PROPOSITO.
 * A HMO-299 pos Grupos no modo com o argumento de que "dividir conta com outra
 * pessoa e assunto de quem conta trocado, nao de quem gosta de planilha" -- e o
 * argumento era bom para o modo que existia entao. A issue-mae pede o oposto,
 * com estas palavras: "nada de grupos, nada de contas divididas". Entao isto
 * aqui nao e regressao nem descuido: e a decisao nova, e ela ganha da antiga
 * porque veio depois e de quem usa o app.
 *
 * ESCONDER DO MENU NAO E O FILTRO DO DINHEIRO. Grupo que sai da navegacao
 * continua somando no painel e continua aceitando lancamento -- isso e assunto
 * das fases F2 e F3 da HMO-462, nao desta. Quem ler "nada de grupos" aqui e
 * concluir que o rateio parou de contar vai errar o lugar.
 *
 * NENHUMA DAS TRES DECLARA `requiredPlans` NEM `requiredFeature`, entao o OUTRO
 * filtro do `Sidebar` (o `podeVerItem`, que e o do plano) nao toca em nenhuma
 * delas: o menu reduzido e identico para `admin`, `free`, `invest`, `trader` e
 * para quem ainda nao carregou a assinatura. Nao ha mais selo premium nenhum
 * para pintar no menu do modo -- quem declarava `requiredFeature` era "Grupos",
 * e ele saiu.
 *
 * A ORDEM aqui nao e a ordem do menu -- quem ordena e o array de navegacao, que
 * continua sendo percorrido na ordem dele. Esta lista e um conjunto; esta
 * escrita na ordem de exibicao so para quem le conferir de olho. (No array,
 * "Perfil" e "Configuracoes" moram no grupo "Conta e Ajustes", nesta ordem, com
 * "Conexoes" entre os dois.)
 */
export const ROTAS_DO_MENU_DE_PAPEL: readonly string[] = [
  "/dashboard",
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
