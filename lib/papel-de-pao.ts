/**
 * OS NUMEROS DO MODO "PAPEL DE PAO" -- HMO-286 (3/3 do plano da HMO-279), com o
 * cartao "Quanto Sobra ou Quanto Falta" da HMO-296 (6/6).
 *
 * "Salario Previsto", "Total de contas" e, desde a HMO-296, a diferenca entre
 * RECEITAS e DESPESAS do mes. Nenhuma dessas frases existia no app antes deste
 * modulo, e e justamente isso que torna este arquivo o lugar mais perigoso dele:
 * ROTULO NOVO EM CIMA DE NUMERO VELHO e como este repositorio ja errou antes --
 * "Fatura atual" mostrando a divida inteira do cartao (HMO-290), "a vencer"
 * somando o salario junto com as contas (HMO-187). Nos dois casos o numero era
 * plausivel, a tela nao dava erro, e so quem somasse na mao descobria.
 *
 * Por isso as contas moram aqui, como funcoes PURAS sobre linhas, e nao dentro
 * da rota: e isto que `npm run test:papel-de-pao` mede. A rota
 * (`app/api/papel-de-pao/painel/route.ts`) autentica, le e delega.
 *
 * ===========================================================================
 * O QUE CADA NUMERO E -- E O QUE ELE NAO E (significados aprovados na HMO-279)
 * ===========================================================================
 *
 * "Salario Previsto" = a soma das linhas PREVISTAS do mes corrente NA CATEGORIA
 * SALARIO.
 *
 *   * NAO e o `expected_income` de `/api/scheduled-transactions/summary`. Aquele
 *     campo vem AGREGADO -- toda receita prevista do mes somada num numero so --,
 *     e usa-lo aqui rotularia aluguel recebido e reembolso de grupo como
 *     salario. O caso 3 da suite existe para isso: ha uma receita prevista FORA
 *     da categoria no fixture, e sem ela a suite ficaria verde mesmo com o
 *     codigo lendo o agregado.
 *   * NAO e o liquido do ultimo contracheque (`payroll_entry_totals`). Aquele e
 *     REALIZADO, nao previsto, e quem nao usa o modulo de Contracheque veria o
 *     cartao vazio para sempre.
 *
 * "Total de contas" = o total A PAGAR do mes, as contas previstas.
 *
 *   * NAO e a soma de `financial_accounts.current_balance`. Aquilo e o saldo de
 *     hoje -- quanto a pessoa TEM, nao quanto ela DEVE. Faz par com o salario:
 *     entra isso, sai aquilo.
 *
 * "Quanto Sobra ou Quanto Falta" (HMO-296) = `receitas - total_de_contas`, com
 * as DUAS parcelas saindo da MESMA leitura e da MESMA peneira que os numeros
 * acima.
 *
 *   * NAO e `Salario - Total de contas`, e a diferenca fica VISIVEL na tela de
 *     quem recebe aluguel ou reembolso. A leitura aprovada e literal --
 *     "(Receitas e Despesas)" --, e usar o salario fecharia a aritmetica na tela
 *     mentindo no rotulo: quem recebe por fora veria uma sobra MENOR que a real,
 *     que e o erro na direcao caríssima (a pessoa se acha mais apertada do que
 *     esta, e o painel esta "certo").
 *   * NAO e uma terceira consulta. Uma segunda soma de despesa feita em
 *     qualquer outro lugar erraria nos quatro elos da rota ao mesmo tempo
 *     (`agendaSemCompraNoCartao`, `faturasPrevistasDaJanela`, `parteConfiguradaDoMembro`,
 *     `skipped`/`cancelled`) e pareceria certa na tela. `receitas` e uma perna
 *     de `somarPerna` -- um `aceita` novo, e nada mais.
 *
 * ===========================================================================
 * POR QUE "PREVISTO" INCLUI A CONTA JA PAGA
 * ===========================================================================
 * `STATUS_FORA_DO_PREVISTO` (de lib/previsto-x-realizado.ts) tira 'skipped' e
 * 'cancelled' e deixa 'paid' DENTRO. E a definicao que o resto do app ja usa, e
 * a alternativa erra de um jeito invisivel: no dia 30 toda conta do mes ja foi
 * paga, e um "Total de contas" que so contasse pendentes mostraria R$ 0,00
 * debaixo do rotulo errado. O par tambem deixaria de fazer sentido -- o salario
 * previsto do mes nao encolhe por ter caido na conta.
 *
 * ===========================================================================
 * O SINAL
 * ===========================================================================
 * Despesa e gravada NEGATIVA em `financial_transactions`. Em
 * `scheduled_transactions` ela e positiva (`CHECK amount > 0`) e quem diz a
 * direcao e a coluna `direction` da view do 027. As duas convencoes convivem no
 * mesmo app, entao somar `amount` cru aqui erra nos dois sentidos: com linha
 * negativa o "Total de contas" fica negativo, e sem olhar `direction` o salario
 * CANCELA as contas em vez de ficar ao lado delas. A conta e sempre
 * `Math.abs()` + `direction`, nunca o sinal do numero.
 */
import {
  STATUS_FORA_DO_PREVISTO,
  classeDaAgenda,
  direcaoDaAgenda,
} from "@/lib/previsto-x-realizado";
import {
  parteConfiguradaDoMembro,
  type ParticipantesPorGrupo,
} from "@/lib/parte-do-grupo";
import { ehDataIso, periodoCorrente, periodoDoMes } from "@/lib/periodo-do-painel";

/**
 * O nome da categoria reservada de salario -- 'Salário', descrita como "Renda do
 * trabalho" no seed do `001_baseline.sql`.
 *
 * E o NOME e nao o UUID de proposito. A rota resolve os ids por este nome
 * contra `transaction_categories`, e a RLS do 036 ja limita o que ela ve ao
 * catalogo (`user_id IS NULL`) mais as categorias da propria pessoa. Isso faz
 * duas coisas que um UUID digitado aqui nao faria: quem criou a PROPRIA
 * categoria "Salário" (a 036 permite) e contado, e um id errado digitado aqui
 * nao viraria um cartao vazio para sempre sem nada falhar -- o modo de falha de
 * [[sonda-de-coluna-inventada]], onde a constante inventada confirma a si mesma.
 *
 * O limite conhecido e aceito: quem guarda o salario em "Freelance" nao aparece
 * neste numero. O rotulo diz "Salário Previsto", e a categoria e a unica coisa
 * no banco que responde essa pergunta.
 */
export const NOME_DA_CATEGORIA_DE_SALARIO = "Salário";

/** A janela fechada de datas ISO em que as linhas contam. */
export interface JanelaDoMes {
  de: string;
  ate: string;
}

/**
 * Uma linha prevista, como a view `scheduled_transactions_effective` a entrega.
 *
 * Tudo menos `due_date` e `amount` e opcional porque a FATURA SINTETIZADA do
 * cartao (`FaturaPrevista`, de lib/agenda-do-cartao.ts) entra na mesma lista e
 * nao tem `category_id`: ela e calculada, nao gravada. Fatura sem categoria e
 * `direction: "expense"`, entao ela nunca poderia cair no salario -- mas o tipo
 * precisa aceita-la para a rota poder passar as duas origens pela MESMA funcao.
 */
export interface LinhaPrevistaDoPapel {
  due_date: string;
  /** Positivo na view. O `Math.abs` abaixo nao confia nisso. */
  amount: number | string;
  /** O status GRAVADO, nao o `effective_status` derivado. */
  status?: string | null;
  /** 'income' | 'expense', da coluna `direction` do 027. */
  direction?: string | null;
  category_id?: string | null;
  group_id?: string | null;

  // -------------------------------------------------------------------------
  // OS CAMPOS QUE SO O DETALHE USA -- HMO-300 (9/10 do plano da HMO-279)
  // -------------------------------------------------------------------------
  // Nenhum deles entra na SOMA. Eles existem para a lista que o chevron abre
  // poder dizer o nome, a data e de quem e cada linha que ja foi aceita. Todos
  // OPCIONAIS, e isso nao e frouxura: a fatura sintetizada nao tem `id` nem
  // `user_id`, e uma leitura que esqueca uma coluna tem de produzir um detalhe
  // mais POBRE -- nunca um total diferente.
  /**
   * `scheduled_transactions.id`. `null`/ausente e a fatura ABERTA sintetizada,
   * que nao existe em tabela nenhuma -- e e por isso que ela e tambem o
   * criterio de `gravada` abaixo.
   */
  id?: string | null;
  description?: string | null;
  /** O dono da linha. A policy do 005 traz tambem as de grupo dos OUTROS. */
  user_id?: string | null;
  /** Da fatura sintetizada: o cartao. Para o caminho de volta na lista. */
  account_id?: string | null;
  /** Da fatura sintetizada: 'AAAA-MM-01'. Nenhuma linha gravada tem esta. */
  invoice_month?: string | null;
}

/**
 * UMA LINHA DA LISTA QUE O CHEVRON ABRE -- HMO-300 (9/10 do plano da HMO-279).
 *
 * A REGRA QUE DECIDE ESTE TIPO INTEIRO: a soma dos `valor` desta lista tem de
 * ser EXATAMENTE o `total` do numero que a contem. Um chevron que abre uma
 * lista que nao fecha com o numero de cima e pior que cartao nenhum -- ele
 * transforma um numero conferivel num numero desmentido pela propria tela.
 *
 * Daqui sai a unica decisao nao obvia do tipo: `valor` e a MINHA PARTE, ja
 * dividida, e nao o valor cheio do grupo. Mostrar tres linhas de R$ 3.000
 * debaixo de um total de R$ 1.500 e a mesma mentira com mais passos. E e por
 * isso que `de_grupo` existe: sem o rotulo, o aluguel pela metade se le como
 * erro de digitacao.
 */
export interface LinhaDoDetalhe {
  /**
   * O id de banco, ou `null` na fatura sintetizada.
   *
   * `null` e load-bearing pela mesma razao de `FaturaPrevista.id`
   * (lib/agenda-do-cartao.ts): toda URL de acao e montada com ele, e um id
   * inventado produziria um 404 que, para quem clicou, se le como "o app nao
   * conseguiu".
   */
  id: string | null;
  /** `false` quando a linha nao existe em tabela nenhuma. */
  gravada: boolean;
  descricao: string | null;
  /** A MINHA parte, JA DIVIDIDA, sempre positiva, em reais. */
  valor: number;
  /** O `due_date` da linha. */
  data: string;
  /** Linha de grupo: o `valor` acima e uma fracao do que o grupo cobra. */
  de_grupo: boolean;
  /**
   * Quem pode editar/excluir/dar baixa nesta linha -- HMO-300, consumido pela
   * 10/10.
   *
   * Ele nasce aqui porque a lista do chevron pode conter linha de OUTRO membro
   * do grupo (a policy do 005 libera `group_id IS NOT NULL AND
   * is_group_member(group_id)`), e um Excluir ali e recusado pela RLS. O modo
   * de falha pior ja esta medido neste repositorio: `UPDATE` filtrado pela RLS
   * volta 200 sem alterar nada -- o app diz "pronto" e a linha fica.
   *
   * FALHA FECHADO: sem `user_id` na leitura, ou sem `meuUserId` no contexto,
   * ele e `false` e nenhum botao aparece. Botao ausente e ruim; botao que
   * aparece e nao funciona e pior.
   */
  posso_editar: boolean;
  /**
   * O cartao e o mes, SO na fatura aberta sintetizada -- o caminho de volta
   * que `caminhoDoCartaoNoMes` monta. `null` em toda linha gravada.
   *
   * UM OBJETO E NAO DOIS CAMPOS SOLTOS, pela mesma razao de `LinhaDaTela`:
   * `accountId` sem `mes` monta um link para o mes errado da fatura certa.
   */
  fatura: { accountId: string; mes: string } | null;
}

/**
 * Um dos dois numeros do painel.
 *
 * `total: null` e INDISPONIVEL, e nao zero -- ver `semLinha` abaixo.
 * `quantidade` e quantas linhas entraram na conta; e o que a tela usa para
 * saber que nao ha nada a dizer.
 */
export interface NumeroDoPapel {
  total: number | null;
  quantidade: number;
  /**
   * AS LINHAS QUE ENTRARAM NESTE TOTAL -- HMO-300 (9/10).
   *
   * Nao e uma segunda leitura: e a MESMA peneira de `somarPerna` devolvendo o
   * que ela aceitou. Uma segunda consulta erraria nos quatro elos da rota ao
   * mesmo tempo (`agendaSemCompraNoCartao`, `faturasPrevistasDaJanela`,
   * `parteConfiguradaDoMembro`, `skipped`/`cancelled`) e pareceria certa na tela.
   *
   * A invariante, e ela e a entrega inteira: `soma(detalhe) === total`, e
   * `detalhe.length === quantidade`. Lista VAZIA quando `total` e `null`.
   */
  detalhe: LinhaDoDetalhe[];
}

/**
 * O CARTAO "Quanto Sobra ou Quanto Falta" -- HMO-296 (6/6).
 *
 * O TITULO E UM SO, MAS TEM DUAS CARAS. "Sobra ou Falta" nao e o nome do
 * cartao: e a pergunta que o proprio sinal responde. Por isso o titulo e campo
 * CALCULADO aqui, e nao um `boolean` que a tela traduziria -- duas fontes para o
 * mesmo sinal discordariam, e o mutante de uma delas sobreviveria a suite da
 * outra.
 *
 * `valor` sai sempre EM MODULO: "Quanto Falta: R$ 300,00", nunca "Quanto Falta:
 * -R$ 300,00", que diz a mesma coisa duas vezes e com dois sinais. E e por isso
 * que o titulo e a unica coisa que distingue +300 de -300 -- uma suite que
 * medisse so `valor` deixaria o mutante do sinal passar por dezenas de
 * assercoes verdes com o rotulo INVERTIDO.
 *
 * `receitas` e `despesas` sao as DUAS PARCELAS, e vao para a tela em corpo
 * pequeno debaixo do resultado. Nao e enfeite: sao elas que tornam o terceiro
 * numero conferivel sem abrir o banco, e que explicam, na propria tela, por que
 * ele difere do "Salario" logo acima. `null` nas duas e no `valor` e
 * INDISPONIVEL -- ver `sobraOuFalta`.
 */
export interface SobraOuFalta {
  titulo: string;
  /** EM MODULO. `null` e indisponivel, e nao zero. */
  valor: number | null;
  receitas: number | null;
  despesas: number | null;
}

/**
 * O que a peneira do «Total de contas» recusou POR SER TRANSFERENCIA -- HMO-303.
 *
 * NAO E UM TERCEIRO TOTAL, e nao entra em soma nenhuma: e a contagem lateral que
 * paga o preco de (a). Guardar R$ 500 na poupanca deixou de ser conta a pagar, e
 * um valor que SOME da tela sem rotulo e indistinguivel de um bug -- quem for
 * conferir na mao vai achar R$ 500 faltando e concluir que o app perdeu uma
 * conta.
 *
 * Sao as linhas que passaram pela janela E pelo status E foram recusadas por
 * `classeDaAgenda(...) === "transfer"`. Nao as recusadas por data, nem por
 * 'skipped'/'cancelled': essas nao sao o preco de nada, e contar junto faria a
 * frase da tela falar de um numero que ela nao explica.
 */
export interface TransferenciasFora {
  total: number;
  quantidade: number;
}

/**
 * O «Total de contas» -- `NumeroDoPapel` mais a contagem lateral de (a).
 *
 * O CAMPO E OBRIGATORIO NO TIPO, e isso e a fiacao: a frase da tela se perde
 * numa refatoracao com uma facilidade que nenhum teste de unidade pega, e aqui o
 * `tsc` cobra. Na TRAVESSIA pela rota (JSON) ele volta a ser opcional, e o
 * componente falha FECHADO -- ausente significa sem frase, nunca frase com
 * R$ 0,00. Ver `PainelDePapel`.
 */
export interface NumeroDeContas extends NumeroDoPapel {
  transferencias_fora: TransferenciasFora;
}

export interface PainelDoModoPapel {
  salario_previsto: NumeroDoPapel;
  /**
   * TODA receita prevista do mes, e nao so o salario -- a parcela de cima do
   * cartao da HMO-296. O salario e um SUBCONJUNTO deste numero.
   */
  receitas: NumeroDoPapel;
  total_de_contas: NumeroDeContas;
  sobra_ou_falta: SobraOuFalta;
}

export interface ContextoDoPapel {
  janela: JanelaDoMes;
  /**
   * QUEM participa de cada grupo que aparece nas linhas, e com que peso.
   *
   * NAO e refinamento: as policies do 005 liberam `group_id IS NOT NULL AND
   * is_group_member(group_id)`, entao a leitura traz tambem as previstas de
   * GRUPO dos outros membros. Sem dividir, um aluguel de R$ 3.000 do grupo Casa
   * entra inteiro no "Total de contas" das duas pessoas. Mapa vazio mantem o
   * valor cheio, que erra para cima -- ver lib/parte-do-grupo.ts.
   *
   * DEIXOU DE SER UMA CONTAGEM NA HMO-303. `ratearPorPeso` precisa de todos os
   * participantes porque a soma dos pesos e o denominador: uma contagem nao sabe
   * dizer qual fracao e a minha num grupo 70/30. Era por isso que quem tem 30%
   * via 50%.
   */
  pesosPorGrupo: ParticipantesPorGrupo;
  /**
   * QUEM ESTA OLHANDO -- o `user.id` que a rota autenticou (HMO-300).
   *
   * Entra no contexto, e nao num calculo solto dentro da rota, pelo motivo de
   * sempre neste arquivo: a regra ("a linha e minha?") fica onde a suite a
   * alcanca. A rota continua sendo quem SABE a resposta -- ela e quem
   * autentica --, e so passa o valor adiante.
   *
   * Ausente derruba `posso_editar` para `false` em TODA linha. E a direcao
   * barata: nenhum botao aparece. Ver `LinhaDoDetalhe.posso_editar`.
   */
  meuUserId?: string | null;
}

/** Centavos, sem o ruido de ponto flutuante acumulado na soma. */
const centavos = (valor: number) => Number(valor.toFixed(2));

/**
 * O estado "nao ha o que dizer": nenhuma linha, nenhum numero.
 *
 * ZERO NAO SERVE AQUI, e esta e a decisao de produto da issue: "R$ 0,00" e uma
 * afirmacao sobre o dinheiro da pessoa, e numa conta que simplesmente nao
 * cadastrou o salario do mes essa afirmacao e FALSA. A tela escreve "nenhum
 * salario previsto para este mes". Mesma escolha que `somarPrevistas` ja tomou
 * em lib/periodo-do-painel.ts quando a resposta nao traz as pernas separadas.
 *
 * E UMA FUNCAO, e nao uma constante, desde a HMO-300: o `detalhe` e um array,
 * e uma constante compartilhada daria a MESMA lista para os tres numeros do
 * painel. Hoje ninguem escreve nela; no dia em que alguem o fizesse, um `push`
 * num cartao apareceria nos outros dois, e o sintoma seria uma lista que nao
 * fecha com nenhum dos totais.
 */
const semLinha = (): NumeroDoPapel => ({
  total: null,
  quantidade: 0,
  detalhe: [],
});

/** A linha cai dentro da janela? Comparacao de string ISO, que ordena sozinha. */
function dentroDaJanela(due_date: unknown, janela: JanelaDoMes): boolean {
  const dia = String(due_date ?? "");
  return dia >= janela.de && dia <= janela.ate;
}

/**
 * A janela do mes corrente -- a MESMA que o painel completo usa.
 *
 * DELEGA para `periodoCorrente` em vez de recortar o mes aqui. Nao e preguica:
 * "o mes corrente" e uma definicao com historia neste app, e a segunda copia
 * dela e o defeito. `new Date().toISOString()` e UTC, e em America/Sao_Paulo
 * das 21:00 as 23:59 do ultimo dia do mes esse valor ja aponta para o mes
 * SEGUINTE -- foi assim que o painel mostrou as contas de outubro no dia 30 de
 * setembro (HMO-173).
 *
 * `hoje` fica como PARAMETRO por cima disso (o default de `periodoCorrente` e
 * `today()`, o fuso de Sao Paulo) porque data lida do relogio nao se congela, e
 * teste de data aqui passa em UTC sem ver o bug: a sandbox e Sao Paulo e o CI e
 * UTC.
 *
 * O `modo` do `Periodo` e descartado de proposito: aqui nao ha seletor de
 * periodo para ele alimentar, e a janela e sempre um mes inteiro.
 */
export function janelaDoMesCorrente(hoje?: string): JanelaDoMes {
  const { de, ate } = periodoCorrente(hoje);
  return { de, ate };
}

/**
 * O MES PEDIDO, de `?month=AAAA-MM` -- HMO-295 (5/6 do plano da HMO-279).
 *
 * `null` e "ninguem pediu mes nenhum, ou pediu errado", e quem chama cai no mes
 * corrente. As duas respostas ficam juntas de proposito: para esta rota elas
 * TERMINAM no mesmo lugar, e separa-las convidaria um `400` a aparecer ali.
 *
 * POR QUE NAO 400, QUE E O QUE `periodoDaQuery` FAZ NA OUTRA ROTA
 * ---------------------------------------------------------------
 * A distincao de `lib/periodo-do-painel.ts` entre ausente e invalido existe
 * porque aquela rota e chamada por varias telas e responder setembro a quem
 * pediu julho seria um numero errado silencioso. Aqui a rota tem UMA tela, e a
 * tela ja descarta resposta cujo `month` nao e o que ela pediu -- entao o
 * silencio nao chega a virar numero errado. O que um `400` viraria e o modulo
 * INTEIRO em branco por causa de uma querystring estragada (link antigo,
 * parametro cortado no meio pelo aplicativo de mensagem), e o modo simples e
 * justamente o que menos pode mostrar tela de erro.
 *
 * SAO DUAS GUARDAS, E CADA UMA PEGA UMA COISA QUE A OUTRA NAO PEGA
 * ----------------------------------------------------------------
 * 1. `typeof month !== "string"`. A querystring entrega string, mas esta funcao
 *    e exportada e tipada com `unknown`, e o caso que importa e o ARRAY:
 *    `["2026-11"]` virou `"2026-11"` na interpolacao abaixo e passaria pela
 *    segunda guarda inteirinho. (`?month=a&month=b` e exatamente como um
 *    cliente produz isso.)
 *
 * 2. `ehDataIso` sobre o DIA 1 -- e nao uma regra de formato nova. Repare que
 *    ela cobre o formato TAMBEM, e e por isso que nao ha um
 *    `/^\d{4}-\d{2}$/` aqui: `${month}-01` casa com `AAAA-MM-DD` se e somente
 *    se `month` casa com `AAAA-MM`, entao a expressao regular a mais seria uma
 *    guarda REDUNDANTE -- e duas guardas redundantes fazem os DOIS mutantes
 *    delas sobreviverem, com o placar fechando 100% sem medir nenhuma das duas.
 *
 * O que so `ehDataIso` pega e o mes que NAO EXISTE: `2026-13` tem o formato
 * certo, e `2026-13-01` atravessaria `primeiroDiaDoMes`/`ultimoDiaDoMes` sem
 * reclamar, porque `Date.UTC(2026, 13, 0)` e um janeiro de 2027 perfeitamente
 * valido. A janela sairia de um mes inexistente, e o rotulo de `MESES_PT[12]`,
 * que e `undefined`.
 */
export function mesPedido(month: unknown): string | null {
  if (typeof month !== "string") return null;
  // O dia 1 e o representante do mes: se ele e data valida, o mes existe.
  return ehDataIso(`${month}-01`) ? month : null;
}

/**
 * A janela do mes pedido, com o mes corrente como rede.
 *
 * DELEGA para `periodoDoMes` -- a mesma funcao que o painel completo usa para
 * andar de mes. "O mes de novembro" tem uma definicao neste app e a segunda
 * copia dela e o defeito: `new Date("2026-11-01")` e meia-noite UTC e em
 * America/Sao_Paulo ja e 31 de OUTUBRO, que foi o que custou a HMO-173. Aqui
 * nao ha `new Date` nenhum -- a janela nasce dos componentes da string.
 */
export function janelaDoMes(month: unknown, hoje?: string): JanelaDoMes {
  const mes = mesPedido(month);
  if (mes === null) return janelaDoMesCorrente(hoje);
  const { de, ate } = periodoDoMes(`${mes}-01`);
  return { de, ate };
}

/**
 * Soma uma perna do painel -- E DEVOLVE A LISTA DO QUE ELA ACEITOU.
 *
 * `aceita` escolhe a perna; o resto -- a janela, o status, o sinal e a parte do
 * grupo -- e identico nas duas, e e por isso que esta funcao e uma so. Duas
 * copias desta peneira divergiriam no primeiro ajuste, e a copia esquecida
 * seria exatamente o defeito.
 *
 * O DETALHE NASCE DENTRO DO MESMO LACO (HMO-300), E NAO DE UM SEGUNDO FILTRO.
 * A invariante que a issue cobra -- `soma(detalhe) === total` -- nao e uma
 * afirmacao sobre duas coisas que por acaso batem: e a mesma variavel somada
 * uma vez. Um segundo `linhas.filter(aceita)` fora daqui teria de repetir a
 * janela, o status, o `Math.abs` e `parteConfiguradaDoMembro`, e a copia esquecida seria
 * o defeito -- com o agravante de que ela ficaria DEBAIXO do numero certo,
 * explicando-o linha a linha com os valores errados.
 *
 * E a linha do detalhe leva o `valor` DEPOIS de `parteConfiguradaDoMembro`, pela mesma
 * razao: tres linhas de R$ 3.000 debaixo de um total de R$ 1.500 e a mesma
 * mentira com mais passos. Este e o mutante que a suite tem de matar, e so a
 * SOMA o mata -- qualquer assercao que apenas conte linhas passa por ele.
 */
function somarPerna(
  linhas: readonly LinhaPrevistaDoPapel[],
  ctx: ContextoDoPapel,
  aceita: (linha: LinhaPrevistaDoPapel) => boolean,
  /**
   * A CONTAGEM LATERAL -- HMO-303. As linhas que passaram pela janela e pelo
   * status, foram RECUSADAS por `aceita`, e casam com este predicado.
   *
   * Ela nasce no MESMO laco pela razao de `detalhe`: a frase da tela diz "o
   * «Total de contas» deixou isto de fora", e so e verdade se o "isto" sair da
   * mesma peneira que produziu o total. Um segundo `linhas.filter(...)` fora
   * daqui repetiria a janela e o status, e a copia esquecida diria "deixou de
   * fora R$ 500" sobre uma linha que a janela ja tinha descartado.
   *
   * Ela NAO entra em `total` nem em `detalhe`: a invariante
   * `soma(detalhe) === total` e a entrega da HMO-300, e uma linha na lista que
   * nao esta no total a quebraria na primeira conferencia.
   */
  contaDeFora?: (linha: LinhaPrevistaDoPapel) => boolean
): { numero: NumeroDoPapel; fora: TransferenciasFora } {
  let total = 0;
  let quantidade = 0;
  const detalhe: LinhaDoDetalhe[] = [];
  const fora: TransferenciasFora = { total: 0, quantidade: 0 };

  for (const linha of linhas) {
    // A JANELA PRIMEIRO. Leitura sem recorte de data soma o horizonte inteiro,
    // e este app ja mostrou numero assim: a rota pode trazer meses vizinhos (a
    // consulta de fatura do cartao olha um mes antes de proposito), e um
    // "Total de contas" que somasse tres meses de boletos debaixo do rotulo
    // "deste mes" seria plausivel e errado.
    if (!dentroDaJanela(linha.due_date, ctx.janela)) continue;

    // 'skipped' e 'cancelled' deixaram de fazer parte da promessa do mes.
    if (STATUS_FORA_DO_PREVISTO.has(String(linha.status ?? "pending"))) continue;

    if (!aceita(linha)) {
      // A LINHA RECUSADA QUE AINDA TEM DE SER DITA. O valor e a MINHA parte,
      // como no total: a frase da tela fala em reais e tem de falar nos mesmos
      // reais que o numero ao lado dela.
      if (contaDeFora?.(linha)) {
        fora.total += Math.abs(
          Number(
            parteConfiguradaDoMembro(
              linha.amount,
              linha.group_id,
              ctx.pesosPorGrupo,
              ctx.meuUserId
            )
          ) || 0
        );
        fora.quantidade += 1;
      }
      continue;
    }

    // A MINHA parte da linha de grupo, nao o valor cheio do grupo -- e pelo
    // PERCENTUAL CONFIGURADO desde a HMO-303, que e o que o fechamento cobra.
    const minhaParte = parteConfiguradaDoMembro(
      linha.amount,
      linha.group_id,
      ctx.pesosPorGrupo,
      ctx.meuUserId
    );

    // `Math.abs` porque as duas convencoes de sinal do app convivem (ver o
    // cabecalho): uma despesa negativa escapando aqui viraria uma conta que
    // DIMINUI o total de contas.
    const valor = Math.abs(Number(minhaParte) || 0);
    total += valor;
    quantidade += 1;
    detalhe.push(linhaDoDetalhe(linha, valor, ctx.meuUserId));
  }

  // A CONTAGEM LATERAL SOBREVIVE A PERNA VAZIA, e esse e o caso que importa: um
  // mes cuja UNICA linha e a transferencia tem «Total de contas» indisponivel E
  // R$ 500,00 de transferencia deixada de fora. Devolver `semLinha()` sem ela
  // apagaria a frase exatamente no mes em que ela e a unica explicacao na tela.
  if (quantidade === 0) return { numero: semLinha(), fora };

  // A ORDEM E CRONOLOGICA, e a lista chega aqui na ordem em que o banco
  // devolveu com as faturas sintetizadas GRUDADAS NO FIM (`agendaComFaturasAbertas`
  // concatena). Sem ordenar, a maior conta de muita gente apareceria depois da
  // conta de luz do dia 5 por acidente de montagem. Ordenar nao mexe no total.
  detalhe.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));

  return {
    numero: { total: centavos(total), quantidade, detalhe },
    fora: { total: centavos(fora.total), quantidade: fora.quantidade },
  };
}

/**
 * A linha da lista, montada a partir da linha que a peneira JA aceitou.
 *
 * `valor` chega pronto de proposito: ele e a MESMA variavel que entrou na
 * soma, e nao um segundo `parteConfiguradaDoMembro(...)` escrito aqui. E isso que faz
 * `soma(detalhe) === total` ser verdadeiro por construcao em vez de por
 * coincidencia.
 *
 * COMO A FATURA SINTETIZADA E RECONHECIDA, E POR QUE NAO PELO `fatura_prevista`
 * ----------------------------------------------------------------------------
 * Por dois campos que so ela tem, e nao pelo discriminante de
 * `lib/agenda-do-cartao.ts`. Nao e preferencia de estilo: importar
 * `ehFaturaPrevista` traria `agenda-do-cartao` -> `card-invoice` ->
 * `transferencia` para dentro do grafo que o tsconfig desta suite compila, por
 * uma unica comparacao de booleano.
 *
 * Os dois criterios falham FECHADO, que e o que torna a troca aceitavel:
 *
 *   * `gravada` sai de `id`, que e exatamente como `LinhaDaTela.gravada` ja o
 *     define ("quem precisa saber se a linha existe no banco le `gravada`, nao
 *     o formato do id"). Se a rota esquecer `id` no `select`, TODA linha vira
 *     nao-gravada: a lista continua somando certo e nenhum botao aparece;
 *   * `fatura` exige `invoice_month`, que nenhuma linha de
 *     `scheduled_transactions_effective` tem -- so a `FaturaPrevista`. Sem ele
 *     nao se monta link nenhum, que e melhor do que montar um para o mes
 *     errado da fatura certa.
 */
function linhaDoDetalhe(
  linha: LinhaPrevistaDoPapel,
  valor: number,
  meuUserId: string | null | undefined
): LinhaDoDetalhe {
  const id = typeof linha.id === "string" && linha.id !== "" ? linha.id : null;
  const gravada = id !== null;

  const mesDaFatura = linha.invoice_month ?? null;
  const contaDaFatura = linha.account_id ?? null;

  return {
    id,
    gravada,
    descricao: linha.description ?? null,
    valor,
    data: String(linha.due_date),
    de_grupo: linha.group_id != null,
    // A linha de OUTRO membro do grupo entra na lista (ela entra no total), e
    // sai sem acao: a RLS recusaria, e `UPDATE` recusado pela RLS volta 200
    // sem alterar nada.
    posso_editar:
      gravada && meuUserId != null && linha.user_id === meuUserId,
    fatura:
      !gravada && contaDaFatura != null && mesDaFatura != null
        ? { accountId: contaDaFatura, mes: mesDaFatura }
        : null,
  };
}

/**
 * Os dois numeros do painel, de uma leitura so.
 *
 * `categoriasDeSalario` sao os ids que a rota resolveu pelo
 * `NOME_DA_CATEGORIA_DE_SALARIO`. Lista VAZIA nao e erro: e uma conta cujo
 * catalogo nao tem a categoria, e o salario sai *indisponivel* -- nao zero.
 *
 * DIRECAO AUSENTE CALA OS DOIS NUMEROS, e isso nao e higiene. A coluna
 * `direction` vem `NOT NULL` na pratica (o COALESCE da view do 027 termina em
 * 'expense'), entao isto so dispara se a view for trocada por uma que nao a
 * entregue. O modo de falha evitado e o caro: sem direcao, `direcaoDaAgenda`
 * classificaria TODA linha como despesa, o salario entraria no "Total de
 * contas" e o painel mostraria duas afirmacoes falsas -- uma conta inflada e um
 * salario ausente -- com cara de mes apertado. E a mesma escolha do
 * `previsto_indisponivel` em /api/scheduled-transactions/summary e do
 * `reserva_indisponivel` em /api/safe-to-spend: a tela escreve "indisponivel"
 * em vez de mostrar isso.
 */
export function painelDePapel(
  linhas: readonly LinhaPrevistaDoPapel[],
  ctx: ContextoDoPapel & { categoriasDeSalario: readonly string[] }
): PainelDoModoPapel {
  const naJanela = linhas.filter((l) => dentroDaJanela(l.due_date, ctx.janela));

  if (naJanela.some((l) => l.direction == null)) {
    // E o detalhe fica VAZIO junto, e nao com as linhas que a leitura trouxe:
    // o chevron abre o que o total explica, e aqui nao ha total. Uma lista
    // debaixo de "indisponivel" seria a explicacao de um numero que a tela
    // acabou de dizer que nao sabe.
    return {
      salario_previsto: semLinha(),
      receitas: semLinha(),
      total_de_contas: {
        ...semLinha(),
        // ZERO E NAO "INDISPONIVEL" aqui, e e o unico lugar deste arquivo em que
        // isso esta certo: `quantidade: 0` cala a frase na tela, e uma frase
        // calada nao afirma nada. O `null` dos totais existe porque "R$ 0,00" e
        // uma afirmacao sobre o dinheiro da pessoa; a contagem lateral nao e um
        // numero que a tela mostra sozinho.
        transferencias_fora: { total: 0, quantidade: 0 },
      },
      sobra_ou_falta: sobraOuFalta(semLinha(), semLinha()),
    };
  }

  const deSalario = new Set(ctx.categoriasDeSalario);

  const salario_previsto = somarPerna(
    linhas,
    ctx,
    (linha) =>
      direcaoDaAgenda(linha.direction) === "income" &&
      linha.category_id != null &&
      deSalario.has(linha.category_id)
  ).numero;

  // TODA receita prevista do mes, e nao so a da categoria Salario -- a perna
  // nova da HMO-296. `direcaoDaAgenda` so responde 'income' ou 'expense', e
  // `salario_previsto` e um recorte DENTRO desta.
  const receitas = somarPerna(
    linhas,
    ctx,
    (linha) => direcaoDaAgenda(linha.direction) === "income"
  ).numero;

  // TUDO que sai, e nao so o que nao e salario: uma conta a pagar lancada na
  // categoria Salário (um desconto, uma devolucao) continua sendo uma conta.
  //
  // A PENEIRA E `classeDaAgenda`, E NAO `direcaoDaAgenda` -- HMO-303, E AS DUAS
  // LEITURAS DISCORDAM DE PROPOSITO.
  // Antes desta issue a transferencia caia aqui, "pela mesma leitura do bloco «A
  // vencer»". Deixou de ser a mesma leitura, porque as duas perguntas nao sao a
  // mesma:
  //
  //   * «A vencer» e a tela de Contas perguntam CAIXA -- quanto ainda vai sair
  //     da conta corrente. A perna agendada de uma transferencia e uma saida
  //     datada de verdade, entao ela CONTINUA la (`direcaoDaAgenda`, e o
  //     comentario dela argumenta o caso);
  //   * «Total de contas» pergunta quais sao as CONTAS A PAGAR do mes. Guardar
  //     R$ 500 na poupanca nao e conta a pagar.
  //
  // O preco esta medido e e aceito: no fixture da HMO-298 o painel do modo e o
  // bloco «A vencer» passam a discordar em R$ 500,00. O que torna isso conserto
  // e nao defeito novo e a CONTAGEM LATERAL abaixo -- dois numeros que diferem
  // sem rotulo sao exatamente o defeito que esta issue consertou, e repeti-lo do
  // outro lado da tela nao seria conserto.
  const contas = somarPerna(
    linhas,
    ctx,
    (linha) => classeDaAgenda(linha.direction) === "expense",
    // O PREDICADO E `=== "transfer"`, E NAO `!aceita(...)`. Ele diz POR QUE a
    // linha ficou de fora, e a frase da tela nomeia a razao. Com a negacao do
    // `aceita` a receita cairia na contagem junto, e a tela diria que o «Total
    // de contas» deixou o salario de fora.
    (linha) => classeDaAgenda(linha.direction) === "transfer"
  );

  const total_de_contas: NumeroDeContas = {
    ...contas.numero,
    transferencias_fora: contas.fora,
  };

  return {
    salario_previsto,
    receitas,
    total_de_contas,
    // O TERCEIRO NUMERO SAI DOS DOIS QUE A TELA JA MOSTRA, e nao de uma soma
    // nova: e isso que impede o cartao de discordar do cartao colado nele. A
    // transferencia esta fora dos dois lados, que e a leitura de
    // `direcaoNoPainel` -- mover dinheiro entre contas proprias nao gasta nada
    // nem ganha nada.
    sobra_ou_falta: sobraOuFalta(receitas, total_de_contas),
  };
}

/** O titulo quando o mes fechou no azul -- ou cravado em zero. */
export const TITULO_SOBRA = "Quanto Sobra";
/** O titulo quando as contas passaram das receitas. */
export const TITULO_FALTA = "Quanto Falta";
/**
 * O titulo quando NAO HA RESPOSTA -- e o nome inteiro do cartao, que e a
 * pergunta ainda em aberto. Sem ele o cartao ficaria sem cabeca na tela, ou
 * (pior) afirmaria "Quanto Sobra" sobre um mes que nao foi lido.
 */
export const TITULO_SEM_RESPOSTA = "Quanto Sobra ou Quanto Falta";

/** Os rotulos das duas parcelas. Sao os nomes dos dois itens do menu do modo. */
export const ROTULO_DAS_RECEITAS = "Receitas";
export const ROTULO_DAS_DESPESAS = "Despesas";

/**
 * `Receitas - Despesas`, com o titulo que o sinal escolhe.
 *
 * A ORDEM E `receitas - despesas`, E ELA DECIDE O CARTAO. Invertida, o mes que
 * sobra passa a faltar e o que falta passa a sobrar -- e como o valor sai em
 * MODULO, os dois imprimem o mesmo numero. Um fixture simetrico (receitas 1.000,
 * despesas 1.000) nao distingue as duas ordens: so um mes com as magnitudes
 * DIFERENTES o faz, e a assercao tem de ler o TITULO.
 *
 * ZERO CRAVADO E SOBRA (`>= 0`): o mes fechou, nao faltou nada. E a fronteira
 * onde o mutante do sinal (`<= 0`) ainda produziria o mesmo numero.
 *
 * INDISPONIVEL NAO E ZERO, E AQUI ELE CONTAMINA. Se qualquer uma das duas
 * parcelas vier `total: null` -- mes sem linha, direcao ausente, leitura que
 * falhou --, o cartao NAO CALCULA. Tratar `null` como `0` imprimiria "Quanto
 * Sobra: R$ 8.000,00" num mes em que as contas simplesmente nao foram lidas, que
 * e a afirmacao mais cara que esta tela consegue fazer. Mes sem receita E sem
 * conta tambem e indisponivel, e nao "sobra R$ 0,00".
 */
export function sobraOuFalta(
  receitas: NumeroDoPapel,
  despesas: NumeroDoPapel
): SobraOuFalta {
  const entra = receitas.total;
  const sai = despesas.total;

  if (entra === null || sai === null) {
    return {
      titulo: TITULO_SEM_RESPOSTA,
      valor: null,
      receitas: entra,
      despesas: sai,
    };
  }

  const saldo = centavos(entra - sai);

  return {
    titulo: saldo >= 0 ? TITULO_SOBRA : TITULO_FALTA,
    // O MODULO. O sinal ja foi dito pelo titulo, e repeti-lo no numero diria a
    // mesma coisa duas vezes -- "Quanto Falta: -R$ 300,00".
    valor: Math.abs(saldo),
    receitas: entra,
    despesas: sai,
  };
}

/** A frase de cada numero quando nao ha linha nenhuma. A tela nao escreve R$ 0,00. */
export const FRASE_SEM_SALARIO = "nenhum salário previsto para este mês";
export const FRASE_SEM_CONTAS = "nenhuma conta prevista para este mês";

/**
 * A frase que diz o que o «Total de contas» deixou de fora -- HMO-303.
 *
 * MORA AQUI E NAO NO COMPONENTE por duas razoes, e a segunda e a que importa:
 *
 *   1. a decisao de CALAR e uma regra, nao formatacao. Linha nova em todo mes sem
 *      transferencia e ruido, e ruido num painel treina a pessoa a nao ler o
 *      painel;
 *   2. `null` e o estado que o `tsx` consegue renderizar por acidente. Com a
 *      regra aqui, "frase com R$ 0,00" nao e um estado que exista -- e um teste
 *      de unidade a alcanca sem navegador.
 *
 * FALHA FECHADO: `undefined` (o campo que a rota deixou de mandar numa
 * refatoracao) e `quantidade: 0` terminam no mesmo `null`. A direcao e a barata:
 * sem a frase a pessoa ve um total que nao bate com o «A vencer» e nao sabe por
 * que; com uma frase de R$ 0,00 ela ve o app afirmando que deixou nada de fora,
 * que e uma afirmacao falsa.
 *
 * O PLURAL E CALCULADO, e nao e enfeite: "1 transferências" num painel que
 * existe para ser simples e o tipo de detalhe que faz a pessoa desconfiar do
 * numero ao lado.
 */
export function fraseDasTransferenciasFora(
  fora: TransferenciasFora | null | undefined
): string | null {
  if (!fora || fora.quantidade <= 0) return null;

  const valor = fora.total.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return fora.quantidade === 1
    ? `fora: R$ ${valor} de transferência entre suas contas`
    : `fora: R$ ${valor} em ${fora.quantidade} transferências entre suas contas`;
}
