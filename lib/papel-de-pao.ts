/**
 * OS DOIS NUMEROS DO MODO "PAPEL DE PAO" -- HMO-286 (3/3 do plano da HMO-279).
 *
 * "Salario Previsto" e "Total de contas". Nenhuma das duas frases existia no
 * app antes desta issue, e e justamente isso que torna este arquivo o lugar
 * mais perigoso dos tres PRs do modulo: ROTULO NOVO EM CIMA DE NUMERO VELHO e
 * como este repositorio ja errou antes -- "Fatura atual" mostrando a divida
 * inteira do cartao (HMO-290), "a vencer" somando o salario junto com as contas
 * (HMO-187). Nos dois casos o numero era plausivel, a tela nao dava erro, e so
 * quem somasse na mao descobria.
 *
 * Por isso as duas contas moram aqui, como funcoes PURAS sobre linhas, e nao
 * dentro da rota: e isto que `npm run test:papel-de-pao` mede. A rota
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
  direcaoDaAgenda,
} from "@/lib/previsto-x-realizado";
import { parteDoMembro, type MembrosAtivosPorGrupo } from "@/lib/parte-do-grupo";
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
}

export interface PainelDeDoisNumeros {
  salario_previsto: NumeroDoPapel;
  total_de_contas: NumeroDoPapel;
}

export interface ContextoDoPapel {
  janela: JanelaDoMes;
  /**
   * Quantos membros ativos tem cada grupo que aparece nas linhas.
   *
   * NAO e refinamento: as policies do 005 liberam `group_id IS NOT NULL AND
   * is_group_member(group_id)`, entao a leitura traz tambem as previstas de
   * GRUPO dos outros membros. Sem dividir, um aluguel de R$ 3.000 do grupo Casa
   * entra inteiro no "Total de contas" das duas pessoas. Mapa vazio mantem o
   * valor cheio, que erra para cima -- ver lib/parte-do-grupo.ts.
   */
  membrosAtivosPorGrupo: MembrosAtivosPorGrupo;
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
 */
const semLinha: NumeroDoPapel = { total: null, quantidade: 0 };

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
 * Soma uma perna do painel.
 *
 * `aceita` escolhe a perna; o resto -- a janela, o status, o sinal e a parte do
 * grupo -- e identico nas duas, e e por isso que esta funcao e uma so. Duas
 * copias desta peneira divergiriam no primeiro ajuste, e a copia esquecida
 * seria exatamente o defeito.
 */
function somarPerna(
  linhas: readonly LinhaPrevistaDoPapel[],
  ctx: ContextoDoPapel,
  aceita: (linha: LinhaPrevistaDoPapel) => boolean
): NumeroDoPapel {
  let total = 0;
  let quantidade = 0;

  for (const linha of linhas) {
    // A JANELA PRIMEIRO. Leitura sem recorte de data soma o horizonte inteiro,
    // e este app ja mostrou numero assim: a rota pode trazer meses vizinhos (a
    // consulta de fatura do cartao olha um mes antes de proposito), e um
    // "Total de contas" que somasse tres meses de boletos debaixo do rotulo
    // "deste mes" seria plausivel e errado.
    if (!dentroDaJanela(linha.due_date, ctx.janela)) continue;

    // 'skipped' e 'cancelled' deixaram de fazer parte da promessa do mes.
    if (STATUS_FORA_DO_PREVISTO.has(String(linha.status ?? "pending"))) continue;

    if (!aceita(linha)) continue;

    // A MINHA parte da linha de grupo, nao o valor cheio do grupo.
    const minhaParte = parteDoMembro(
      linha.amount,
      linha.group_id,
      ctx.membrosAtivosPorGrupo
    );

    // `Math.abs` porque as duas convencoes de sinal do app convivem (ver o
    // cabecalho): uma despesa negativa escapando aqui viraria uma conta que
    // DIMINUI o total de contas.
    const valor = Math.abs(Number(minhaParte) || 0);
    total += valor;
    quantidade += 1;
  }

  return quantidade === 0 ? semLinha : { total: centavos(total), quantidade };
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
): PainelDeDoisNumeros {
  const naJanela = linhas.filter((l) => dentroDaJanela(l.due_date, ctx.janela));

  if (naJanela.some((l) => l.direction == null)) {
    return { salario_previsto: semLinha, total_de_contas: semLinha };
  }

  const deSalario = new Set(ctx.categoriasDeSalario);

  return {
    salario_previsto: somarPerna(
      linhas,
      ctx,
      (linha) =>
        direcaoDaAgenda(linha.direction) === "income" &&
        linha.category_id != null &&
        deSalario.has(linha.category_id)
    ),
    // TUDO que sai, e nao so o que nao e salario: uma conta a pagar lancada na
    // categoria Salário (um desconto, uma devolucao) continua sendo uma conta.
    // A peneira do salario e sobre RECEITA; esta e sobre DESPESA, e as duas
    // juntas nao precisam cobrir a lista inteira -- transferencia, por exemplo,
    // cai aqui porque `direcaoDaAgenda` so tira 'income' do lado de "a pagar",
    // que e a mesma leitura do bloco "A vencer".
    total_de_contas: somarPerna(
      linhas,
      ctx,
      (linha) => direcaoDaAgenda(linha.direction) === "expense"
    ),
  };
}

/** A frase de cada numero quando nao ha linha nenhuma. A tela nao escreve R$ 0,00. */
export const FRASE_SEM_SALARIO = "nenhum salário previsto para este mês";
export const FRASE_SEM_CONTAS = "nenhuma conta prevista para este mês";
