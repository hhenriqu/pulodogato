#!/usr/bin/env node
// =============================================================================
// HMO-298/303/305/306 -- AS QUATRO LEITURAS DO "TOTAL DE CONTAS", E A PROVA DE
// QUE ELAS CONCORDAM
// =============================================================================
//   node scripts/medicao-hmo298.mjs
//
// A QUARTA LEITURA ENTROU NA HMO-306, E ELA ERA O CONTROLE NEGATIVO DA HMO-303.
// /api/safe-to-spend nao chamava `parteConfiguradaDoMembro` e nem trazia
// `group_id` no `select`: enquanto isso valia, o numero dela tinha de ficar
// PARADO, e era essa imobilidade que provava que o conserto das cinco rotas nao
// havia escapado do escopo. A HMO-306 e a issue que o move -- a MINHA conta de
// grupo deixou de ser descontada cheia (R$ 1.000,00) e passou a entrar pela
// parte configurada (R$ 300,00), o mesmo numero das outras tres leituras.
//
// Ela tem coluna de ESPERADO PROPRIA (`safeEsperado`), e isso e requisito e nao
// estilo: ela responde "quanto posso gastar", filtra por `user_id` e nao chama
// `classeDaAgenda`. Entao em duas das quatro faces ela DIVERGE do «Total de
// contas» de proposito, e cobrar dela o mesmo `esperado` reprovaria o
// comportamento certo. Ver o comentario de `LINHAS`.
//
// O NOME DO ARQUIVO FICA, E O CONTROLE INVERTEU DE SINAL.
// Na HMO-298 (7/10 do plano da HMO-279) este script media os tres numeros lado a
// lado e SAIA COM ERRO quando alguma linha concordava: tabela toda verde era
// defeito de fixture, porque o fixture existia para acender os quatro
// mecanismos. A HMO-303 consertou tres deles, e desde ela este script e o
// contrario -- ele SAI COM ERRO quando alguma linha discorda.
//
// Isso nao e o teste se adaptando ao codigo. Os valores que ele cobra sao
// ABSOLUTOS, escritos a mao abaixo (R$ 0,00 / R$ 900,00 / R$ 300,00 /
// R$ 1.200,00, e R$ 2.800,00 nos dois totais), e vieram da tabela aprovada na
// HMO-302 -- nao de uma rodada do codigo novo. Igualdade sozinha nao serviria de
// controle: um bug que ZERASSE as tres leituras passaria verde, que e a sonda
// que se mede a si mesma. Por isso cada linha cobra DUAS coisas: que o par
// concorde, e que os dois batam com o numero digitado.
//

// E O MECANISMO (b) DEIXOU DE SER DISCORDANCIA ANOTADA -- HMO-305.
// Ate a HMO-303 a fatura em dois lugares ficava FORA da tabela, anotada em voz
// alta (painel R$ 1.600 x divida R$ 800) justamente para que o controle nao
// ficasse verde por engano no dia em que ela fosse consertada. Este e o dia: a
// HMO-305 nao adivinha nada -- ela da a ACAO ("esta previsao e a fatura do
// Nubank de marco"), que grava a chave canonica em `notes`, e a de-duplicacao
// acontece pelo mecanismo que ja existia (`chavesPersistidas` em
// `sintetizarFaturasAbertas`).
//
// Agora (b) e medido nos TRES estados do mesmo banco -- sem elo, com o elo,
// desfeito --, e esta e a UNICA parte desta medicao que ESCREVE: um `UPDATE`
// como `authenticated`, pela RLS, com a chave que a funcao de producao monta. O
// banco volta ao estado do fixture no fim.
// O nome do `.sh` tambem fica: `bash scripts/medicao-hmo298.sh` e a reproducao
// citada na HMO-298 e no documento dela, e renomear quebraria a referencia.
//
// AS TRES LEITURAS, E POR QUE SAO ESTAS TRES
// ------------------------------------------
//   1. `painelDePapel` (lib/papel-de-pao.ts) -- o "Total de contas" que o
//      Dashboard do modo Papel de Pao mostra. Le a agenda SEM filtro de
//      `user_id` (so a RLS filtra) e toma a minha parte das linhas de grupo.
//   2. `/api/movimentacoes/resumo?tipo=expense` -- o "Previsto" da tela de
//      Despesas, pela mesma aritmetica pura que a rota usa
//      (`linhasDaTela` + `resumoDaTela`, lib/telas-de-movimentacao.ts).
//   3. `ratearPorPeso` (lib/fechamento-do-grupo.ts) -- o numero que o
//      fechamento do grupo vai COBRAR de verdade, pelo `percentage` gravado
//      desde a HMO-269/270/271, e que a migration 042 (HMO-304) tornou tambem o
//      numero da BAIXA.
//   4. `/api/safe-to-spend` -- "quanto ainda posso gastar este mes" (HMO-306),
//      a quarta e a mais perigosa de errar: subestimar custo fixo aqui e o app
//      PROMETENDO dinheiro que nao existe.
//
// Depois da HMO-303/306 as quatro sao a MESMA funcao rodando quatro vezes: as
// leituras 1, 2 e 4 chamam `parteConfiguradaDoMembro`, que delega para o
// `ratearPorPeso` da leitura 3. "As quatro concordam" deixou de ser uma
// coincidencia que esta tabela confere e passou a ser uma propriedade do grafo
// de chamadas -- o que esta tabela ainda confere e que a FIACAO nao se desfez.
//
// AS FUNCOES SAO IMPORTADAS, NAO REESCRITAS
// -----------------------------------------
// Tudo abaixo chama o codigo compilado de lib/. Uma tabela construida sobre uma
// reimplementacao da conta mediria a reimplementacao: ela sairia bonita e nao
// diria nada sobre o que esta no ar. O que este arquivo faz de proprio e so
// montar os INSUMOS de cada leitura do jeito que a rota correspondente monta --
// e essa montagem esta anotada linha a linha, porque e ali que uma medicao
// desonesta se esconderia.
//
// A contribuicao de CADA LINHA ao painel sai de `total_de_contas.detalhe`
// (HMO-300), e nao de uma soma refeita aqui: o detalhe nasce dentro do mesmo
// laco do total e obedece `soma(detalhe) === total`. Ate a HMO-303 esta medicao
// reconstruia a contribuicao a mao (`Math.abs(amount) / membros`), que era a
// segunda implementacao da divisao justamente dentro do arquivo que existe para
// provar que nao ha duas.
//
// O BANCO E REAL, A CONTA DE NINGUEM E
// ------------------------------------
// Postgres local, migrations reais (001 -> 042), RLS ligada e `auth.uid()` do
// shim. Producao e somente-leitura aqui e nenhum dado de usuario e tocado.
// Quem viu cada linha foi a RLS de verdade, e nao um `.filter()` deste script:
// e isso que torna o mecanismo (d) uma medicao e nao uma alegacao.
//
// O RELOGIO E CONGELADO
// ---------------------
// `HOJE` e uma constante. A janela do painel e mensal e este repositorio ja
// perdeu um dia para isso: a sandbox roda em America/Sao_Paulo e o CI em UTC, e
// um `today()` lido do relogio muda quais linhas caem dentro da janela
// dependendo de onde a suite rodou.
// =============================================================================

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const COMPILADO = join(RAIZ, ".tmp-medicao-hmo298", "lib");

if (!existsSync(COMPILADO)) {
  console.error(
    "Falta compilar. Rode:\n" +
      "  npx tsc -p scripts/tsconfig.medicao-hmo298-test.json\n" +
      "  node scripts/resolve-aliases.mjs .tmp-medicao-hmo298 lib --espelha-raiz"
  );
  process.exit(1);
}

const { painelDePapel } = await import(join(COMPILADO, "papel-de-pao.js"));
const {
  montarParticipantesPorGrupo,
  previstasComAMinhaParte,
  parteConfiguradaDoMembro,
  custoFixoMensalDaMinhaParte,
} = await import(join(COMPILADO, "parte-do-grupo.js"));
const { agendaSemCompraNoCartao, sintetizarFaturasAbertas } = await import(
  join(COMPILADO, "agenda-do-cartao.js")
);
const { linhasDaTela, resumoDaTela } = await import(
  join(COMPILADO, "telas-de-movimentacao.js")
);
const { ratearPorPeso } = await import(join(COMPILADO, "fechamento-do-grupo.js"));
// `direcaoDaAgenda` E IMPORTADA, e nao reescrita como um `=== "income"` aqui
// (HMO-308). Ela e a UNICA copia da pergunta de caixa do app -- e e ela que
// manda `transfer` para o lado de SAIDA, que e o que faz a face (a) desta
// medicao valer R$ 500,00 no safe-to-spend e R$ 0,00 nas duas telas. Um ternario
// escrito a mao neste arquivo mediria o ternario.
const { somarAgenda, direcaoDaAgenda } = await import(
  join(COMPILADO, "previsto-x-realizado.js")
);
// O ELO DA FATURA -- HMO-305. A chave canonica vem da FUNCAO de producao, e nao
// de uma string montada aqui: montar a chave a mao nesta medicao faria o UPDATE
// abaixo gravar a chave que ESTA MEDICAO considera certa, e nao a que o app
// grava. As duas poderiam divergir e a tabela sairia verde sobre uma
// de-duplicacao que nao acontece em producao.
const { notesDoElo } = await import(join(COMPILADO, "elo-da-fatura.js"));

// -----------------------------------------------------------------------------
// As constantes do fixture. Mudaram la, mudam aqui.
// -----------------------------------------------------------------------------
const DB = process.env.HMO298_DB ?? "hmo298";
const EU = "e0000000-0000-0000-0000-0000000000e1";
const GRUPO = "a0000000-0000-0000-0000-00000000ca5a";
/** A previsao "Pagar fatura Nubank", digitada a mao na CONTA CORRENTE. */
const PREVISAO_DA_FATURA = "5c000000-0000-0000-0000-0000000000fa";
/** O cartao Nubank do fixture. */
const CARTAO_DA_FATURA = "c0000000-0000-0000-0000-0000000000ca";
/**
 * O MES DA FATURA -- FEVEREIRO, e nao marco. Este valor e uma ARMADILHA MEDIDA.
 *
 * A fatura vence em 2026-03-10 e cai no mes medido por isso, mas o
 * `invoice_month` dela e 2026-02-01: com `closing_day = 28`, as compras de
 * fevereiro fecham na fatura de FEVEREIRO, que vence em marco. Conferido no
 * banco desta medicao:
 *
 *   SELECT invoice_month, invoice_due_date FROM card_invoice_lines;
 *   -> 2026-02-01 | 2026-03-10
 *
 * A chave canonica leva o mes da FATURA (`fatura:2026-02-01:<cartao>`), e nao o
 * do vencimento. Com "2026-03-01" aqui o UPDATE grava uma chave que
 * `chavesPersistidas` nao casa com nada: a escrita acontece, a de-duplicacao nao,
 * e a tela diria "pronto" com o mes ainda somando a divida duas vezes. Foi
 * exatamente esse o primeiro resultado desta medicao, e e por isso que
 * `suspeitasDeFaturaRepetida` carrega o `invoice_month` da fatura em vez de
 * derivar o mes do vencimento da previsao (ver `SuspeitaDeFatura.mes`).
 */
const MES_DA_FATURA = "2026-02-01";

/** Relogio congelado -- ver o cabecalho. */
const HOJE = "2026-03-10";
/** A janela do mes medido, fechada nas duas pontas. */
const JANELA = { de: "2026-03-01", ate: "2026-03-31" };

// -----------------------------------------------------------------------------
// OS NUMEROS DA QUARTA LEITURA (HMO-306, REVISTOS NA HMO-308)
// -----------------------------------------------------------------------------
// Eles moram AQUI, e nao junto do controle la embaixo, porque a secao "ITEM 7"
// imprime o "antes" e `const` em TDZ nao se le antes da declaracao -- o valor
// repetido a mao na linha do console seria uma segunda fonte de verdade para um
// numero de dinheiro, que e exatamente o que este arquivo existe para evitar.
//
// SAO DOIS CONSERTOS EM SEQUENCIA, E A CADEIA DAS DUAS SUBTRACOES ESTA ESCRITA.
// A HMO-306 foi deliberadamente a primeira metade: consertar a direcao no mesmo
// PR faria DOIS numeros se moverem ao mesmo tempo na mesma linha da medicao, e
// nenhum dos dois ficaria conferivel.
//
//   R$ 8.500,00   o numero do controle negativo da HMO-303, MEDIDO: a MINHA
//                 conta de grupo entrava cheia (R$ 1.000,00) porque a rota nao
//                 trazia `group_id` no `select`
//   - R$   700,00 HMO-306: a parte configurada do grupo (1.000,00 - 300,00)
//   = R$ 7.800,00 o numero que a HMO-306 entregou
//   - R$ 6.200,00 HMO-308: a receita prevista AVULSA que entrava como conta a
//                 pagar (Salario 5.000,00 + Aluguel recebido 1.200,00)
//   = R$ 1.600,00 as despesas de verdade: 300,00 (minha parte da internet)
//                 + 800,00 (a previsao da fatura) + 500,00 (a transferencia)
//
// AS SUBTRACOES ESTAO ESCRITAS, e nao so o resultado, porque sao elas que tornam
// estes numeros conferiveis: "1.600" sozinho seria indistinguivel de um valor
// copiado da saida do codigo novo -- o que o cabecalho deste arquivo proibe. A
// cadeia inteira e COBRADA no bloco do controle, para que mexer num dos numeros
// sem mexer nos outros reprove.
//
// O DEFEITO DA HMO-308 ERA DUPLO, E E POR ISSO QUE HA UM QUARTO NUMERO AQUI.
// `tipo` decide as DUAS somas de `calcularQuantoPossoGastar`: a receita que caia
// em `expense` SOMAVA em `compromissos` E DEIXAVA de somar em
// `receitasPrevistas`. Entao os R$ 6.200,00 nao so saem de um lado -- eles
// APARECEM no outro, e `RECEITAS_PREVISTAS_ESPERADAS` e a metade que a
// subtracao sozinha nao prova. Sem ela, um conserto que simplesmente DESCARTASSE
// a linha de receita (em vez de contar como receita) daria o mesmo R$ 1.600,00 e
// passaria verde escondendo R$ 6.200,00 que a pessoa vai receber.
//
// AS DUAS METADES ERRAVAM PARA O MESMO LADO, e o conserto move o numero na
// direcao incomoda: menos compromisso descontado e MAIS receita somada, ou seja
// MUITO mais dinheiro livre do que a tela dizia. A rota antiga errava para o
// lado seguro, mas por acidente nos dois casos -- ela nao sabia que havia o que
// dividir, e nao sabia de onde vinha a direcao.
const SAFE_TO_SPEND_ANTES_DA_306 = 8500;
const DIFERENCA_DA_PARTE_DO_GRUPO = 700;
const SAFE_TO_SPEND_DEPOIS_DA_306 = 7800;
const RECEITA_CONTADA_COMO_CONTA = 6200;
const SAFE_TO_SPEND_ESPERADO = 1600;
const RECEITAS_PREVISTAS_ESPERADAS = 6200;

// -----------------------------------------------------------------------------
// A ponte com o banco
// -----------------------------------------------------------------------------
// `psql` em vez de um driver: o repositorio nao tem cliente Postgres entre as
// dependencias e acrescentar um so para esta medicao seria uma dependencia nova
// numa filha que nao entrega codigo de producao. O `SET ROLE authenticated` +
// o claim `sub` sao exatamente o que o shim do Supabase le em auth.uid(), e e o
// que faz a RLS valer aqui.
function consultar(sql, comoUsuario = EU) {
  // UM SENTINEL, E NAO UMA CONTAGEM DE LINHAS. A saida do psql antes da
  // consulta tem um numero de linhas que depende de coisas que nao sao desta
  // medicao (o `SET` do SET ROLE, o retorno do set_config), e `json_agg` ainda
  // QUEBRA LINHA entre os elementos do array -- entao nem "a primeira linha"
  // nem "a ultima" identificam o JSON. Depois do sentinel, tudo o que vem e a
  // resposta, e ela se junta de volta numa string so.
  const script = `
    \\pset format unaligned
    \\pset tuples_only on
    SET ROLE authenticated;
    SELECT set_config('request.jwt.claims',
      '{"sub":"${comoUsuario}","role":"authenticated"}', false);
    \\echo __RESPOSTA__
    ${sql}
  `;
  const saida = execFileSync(
    "psql",
    ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-d", DB],
    {
      input: script,
      encoding: "utf8",
      env: {
        ...process.env,
        PGUSER: process.env.PGUSER ?? "postgres",
        PGPASSWORD: process.env.PGPASSWORD ?? "postgres",
        PGHOST: process.env.PGHOST ?? "localhost",
      },
    }
  );
  const corte = saida.indexOf("__RESPOSTA__");
  if (corte < 0) throw new Error(`psql nao devolveu o sentinel:\n${saida}`);
  const json = saida
    .slice(corte + "__RESPOSTA__".length)
    .split("\n")
    .join("")
    .trim();
  return json ? JSON.parse(json) : [];
}

/**
 * UMA ESCRITA, pela MESMA ponte da leitura -- HMO-305.
 *
 * `SET ROLE authenticated` + o claim `sub`, igual a `consultar`: o UPDATE do elo
 * passa pela RLS de verdade, como o da rota. Escrever como `postgres` aqui seria
 * furar a RLS (o SQL Editor do Supabase faz isso, e este repositorio ja pagou por
 * confundir as duas coisas) e a medicao provaria um caminho que o app nao tem.
 *
 * Ela CONFERE que uma linha mudou. `UPDATE` filtrado que a RLS recusa volta
 * SUCESSO com zero linhas -- sem esta contagem, a medicao seguiria medindo o
 * estado ANTERIOR e atribuindo a ele o nome do estado novo.
 */
function escrever(sql, quantasLinhas = 1) {
  // CTE e nao subconsulta: Postgres nao aceita DML num `FROM (...)`, e aceita
  // num `WITH`. E o `json_agg` por cima e o que faz a resposta voltar pela
  // mesma ponte com sentinel que as leituras usam.
  const linhas = consultar(
    `WITH mexidas AS (${sql} RETURNING id)
     SELECT COALESCE(json_agg(id::text), '[]') FROM mexidas;`
  );
  if (linhas.length !== quantasLinhas) {
    throw new Error(
      `a escrita mexeu em ${linhas.length} linha(s), esperado ${quantasLinhas}: ${sql}`
    );
  }
  return linhas;
}

const brl = (valor) =>
  valor === null || valor === undefined
    ? "--"
    : `R$ ${Number(valor).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

/**
 * A TOLERANCIA, E POR QUE ELA E MENOR QUE UM CENTAVO.
 *
 * R$ 0,004 e meio centavo. Ela existe para o ruido de ponto flutuante da soma em
 * reais e NAO para absorver divergencia de arredondamento: uma leitura que
 * mandasse o centavo da sobra para a pessoa errada discordaria em R$ 0,01 e
 * REPROVARIA aqui, que e exatamente o que se quer (ver a ordem da lista em
 * `montarParticipantesPorGrupo`).
 */
const TOLERANCIA = 0.004;
const bate = (a, b) => Math.abs(a - b) <= TOLERANCIA;

// -----------------------------------------------------------------------------
// OS PESOS DO GRUPO -- o insumo comum das tres leituras
// -----------------------------------------------------------------------------
// `id` vem na consulta porque e por ele que `montarParticipantesPorGrupo`
// ordena, e e a ordem que decide o centavo da sobra. `ORDER BY` NAO aparece
// aqui: quem fixa a ordem e a funcao pura, uma vez, e nao cada consulta -- a
// mesma razao pela qual as cinco rotas tambem nao ordenam.
function pesosDoBanco() {
  const membros = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (SELECT id::text, group_id::text, user_id::text, percentage, status
              FROM group_members WHERE status = 'active') t;
  `);
  return montarParticipantesPorGrupo(membros);
}

// =============================================================================
// LEITURA 1 -- `painelDePapel`, o Dashboard do modo Papel de Pao
// =============================================================================
// Monta os insumos como app/api/papel-de-pao/painel/route.ts monta, na MESMA
// ordem (a ordem importa: a compra de cartao sai ANTES de a fatura entrar).
//
// A consulta e a da rota, campo por campo, e o que ela NAO tem e o ponto:
// nenhum `user_id = ...`. So a RLS filtra, e a RLS do 005 libera
// `group_id IS NOT NULL AND is_group_member(group_id)`.
function leituraDoPainel(pesos) {
  const linhasBrutas = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (
        SELECT s.id::text, s.description, s.user_id::text,
               s.due_date::text, s.amount, s.status, s.direction,
               s.category_id, s.group_id, s.notes,
               json_build_object('account_type', a.account_type) AS account
          FROM scheduled_transactions_effective s
          LEFT JOIN financial_accounts a ON a.id = s.account_id
         WHERE s.due_date >= '${JANELA.de}' AND s.due_date <= '${JANELA.ate}'
      ) t;
  `);

  // A compra de cartao sai (ela esta DENTRO da fatura); a fatura fechada FICA.
  const semCompraDeCartao = agendaSemCompraNoCartao(linhasBrutas);

  const { previstas } = faturaSintetizada();
  const linhas = [...semCompraDeCartao, ...previstas];

  const categoriasDeSalario = consultar(`
    SELECT COALESCE(json_agg(id), '[]') FROM transaction_categories
     WHERE name = 'Salário';
  `);

  const painel = painelDePapel(linhas, {
    janela: JANELA,
    pesosPorGrupo: pesos,
    categoriasDeSalario,
    // QUEM ESTA OLHANDO. Sem ele `parteConfiguradaDoMembro` devolve o valor
    // CHEIO -- o comportamento documentado do desconhecido --, e a medicao
    // inteira sairia igual a de antes da HMO-303 sem nada falhar.
    meuUserId: EU,
  });

  // `previstas` FICA NO RETORNO, e quem o le e `faturaNasDuasTelas` pelo
  // `.length` -- a contagem de faturas ABERTAS sintetizadas, que e a medida
  // direta da de-duplicacao do elo (HMO-305). O que saiu daqui foi so o
  // `faturaAberta` do bloco antigo; o campo tem leitor.
  return { painel, previstas };
}

/**
 * A fatura ABERTA, sintetizada -- a segunda metade do mecanismo (b).
 *
 * `faturasPrevistasDaJanela` faz estas duas consultas e chama esta mesma funcao
 * pura; aqui elas estao abertas para a de-duplicacao ficar visivel. As duas
 * leituras usam a MESMA fatura, e e por isso que (b) aparece igual nas duas
 * telas.
 */
function faturaSintetizada() {
  const linhasDeFatura = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (
        SELECT account_id, account_name, invoice_month::text,
               invoice_due_date::text, invoice_amount
          FROM card_invoice_lines WHERE user_id = '${EU}'
      ) t;
  `);
  // As `notes` das previsoes JA gravadas. So a chave canonica
  // `fatura:AAAA-MM-01:<uuid>` de-duplica -- texto digitado a mao nao.
  const chavesPersistidas = consultar(`
    SELECT COALESCE(json_agg(notes), '[]')
      FROM scheduled_transactions
     WHERE user_id = '${EU}' AND notes IS NOT NULL;
  `);
  return sintetizarFaturasAbertas({
    linhas: linhasDeFatura,
    chavesPersistidas,
    de: JANELA.de,
    ate: JANELA.ate,
    hoje: HOJE,
  });
}

// =============================================================================
// LEITURA 2 -- `/api/movimentacoes/resumo?tipo=expense`, a tela de Despesas
// =============================================================================
// A consulta e a da rota, e as TRES mudancas da HMO-303 estao nela:
//
//   * o filtro deixou de ser `user_id = EU` e passou a ser
//     `user_id = EU OR group_id IS NOT NULL` -- e por isso a linha de grupo do
//     OUTRO membro passa a chegar. A RLS continua recusando grupo de que eu nao
//     sou membro: o `OR` pede exatamente o ramo que a policy do 005 ja libera;
//   * o `select` passou a trazer `group_id`, sem o qual nada depois dele sabe
//     que havia o que dividir;
//   * cada linha de grupo entra por `previstasComAMinhaParte`.
function leituraDaTelaDeDespesas(pesos) {
  const previstasCruas = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (
        SELECT s.id::text, s.user_id::text, s.description, s.amount,
               s.due_date::text, s.status::text,
               s.effective_status::text, s.currency, s.direction, s.notes,
               s.recurring_rule_id::text, s.group_id::text,
               json_build_object('name', c.name) AS category,
               json_build_object('id', a.id::text, 'name', a.name,
                                 'account_type', a.account_type) AS account
          FROM scheduled_transactions_effective s
          LEFT JOIN transaction_categories c ON c.id = s.category_id
          LEFT JOIN financial_accounts a ON a.id = s.account_id
         WHERE (s.user_id = '${EU}' OR s.group_id IS NOT NULL)
           AND s.due_date >= '${JANELA.de}' AND s.due_date <= '${JANELA.ate}'
      ) t;
  `);

  const semCompraDeCartao = agendaSemCompraNoCartao(previstasCruas);
  const comAMinhaParte = previstasComAMinhaParte(semCompraDeCartao, pesos, EU);

  // A MESMA fatura sintetizada da leitura 1: as duas telas a somam. Ela nao
  // passa por `previstasComAMinhaParte` porque nasce sem `group_id`.
  const { previstas } = faturaSintetizada();

  // O realizado nao entra nesta medicao: a pergunta e sobre o PREVISTO, que e
  // o "Total de contas". `linhasDaTela` recebe a lista vazia de realizadas.
  const linhas = linhasDaTela(
    [],
    [...comAMinhaParte, ...previstas],
    "expense",
    new Set(),
    // QUEM ESTA OLHANDO (HMO-301). Aqui ele nao e `null` como era antes da
    // HMO-303: `posso_editar` passou a ser uma AFIRMACAO que esta medicao
    // confere (a linha do outro membro entra na lista e tem de sair sem botao),
    // e com `null` toda linha sairia `false` e a assercao seria vacua.
    EU
  );

  return { resumo: resumoDaTela(linhas), linhas };
}

// =============================================================================
// LEITURA 3 -- `ratearPorPeso`, o que o fechamento COBRA
// =============================================================================
// O peso e o `percentage` gravado em `group_members` -- a divisao configurada
// da HMO-269/270/271. Desde a migration 042 (HMO-304) este e tambem o numero da
// BAIXA: o trigger passou a ratear pelo mesmo criterio.
function leituraDoFechamento(pesos) {
  const participantes = pesos.get(GRUPO) ?? [];

  // As despesas do grupo no mes, pelo valor CHEIO -- e isso que o fechamento
  // rateia.
  const despesas = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (
        SELECT description, amount FROM scheduled_transactions_effective
         WHERE group_id = '${GRUPO}' AND direction = 'expense'
           AND due_date >= '${JANELA.de}' AND due_date <= '${JANELA.ate}'
         ORDER BY description
      ) t;
  `);

  let meusCentavos = 0;
  const porDespesa = [];
  for (const d of despesas) {
    const totalCents = Math.round(Number(d.amount) * 100);
    const partes = ratearPorPeso(totalCents, participantes);
    const minha = partes.get(EU) ?? 0;
    meusCentavos += minha;
    porDespesa.push({ descricao: d.description, cheio: Number(d.amount), minha });
  }

  return { meusCentavos, porDespesa, participantes };
}

// =============================================================================
// A QUARTA E A QUINTA LEITURAS -- o item 7 do recorte da HMO-303
// =============================================================================
// Elas nao entram na tabela dos mecanismos: nenhuma delas e o "Total de contas".
// Elas estao aqui porque o «Pronto quando» da HMO-302 exige tres numeros
// conferidos antes e depois, e a terceira e a mais valiosa das tres -- se o
// safe-to-spend se mover, o conserto escapou do escopo.
function leituraDoSummary(pesos) {
  // As regras ativas, como /api/scheduled-transactions/summary as le: SEM
  // filtro de `user_id`, porque a RLS e quem filtra -- e a policy do 005
  // entrega tambem a regra de GRUPO do outro membro. E essa linha que
  // `custoFixoMensalDaMinhaParte` tem de recortar.
  const regras = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (
        SELECT amount, frequency::text, interval_count,
               transaction_type::text, group_id::text
          FROM recurring_rules WHERE is_active
      ) t;
  `);

  const linhas = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (
        SELECT amount, status::text, direction, group_id::text
          FROM scheduled_transactions_effective
         WHERE due_date >= '${JANELA.de}' AND due_date <= '${JANELA.ate}'
      ) t;
  `);

  // A MESMA sequencia da rota: a parte do membro e depois `somarAgenda`. A
  // transferencia CONTINUA entrando como despesa aqui -- `direcaoDaAgenda` nao
  // foi tocada, e e isso que faz o «A vencer» discordar do painel de proposito.
  const comAMinhaParte = previstasComAMinhaParte(linhas, pesos, EU);
  const previsto = somarAgenda(
    comAMinhaParte.map((l) => ({
      amount: l.amount,
      status: String(l.status),
      direcao: l.direction === "income" ? "income" : "expense",
    }))
  );

  return {
    custoFixoMensal: custoFixoMensalDaMinhaParte(regras, pesos, EU, HOJE),
    previstoDespesas: previsto.despesas,
  };
}

/**
 * LEITURA 4 -- /api/safe-to-spend, o "quanto ainda posso gastar" (HMO-306).
 *
 * ELA ERA O CONTROLE NEGATIVO DA HMO-303, E DEIXOU DE SER.
 * Ate a HMO-306 esta rota nao chamava `parteConfiguradaDoMembro` e nem trazia
 * `group_id` no `select`: a MINHA conta de grupo era descontada CHEIA
 * (R$ 1.000,00 de um grupo que me cobra R$ 300,00). Enquanto isso valia, o
 * numero dela tinha de ficar PARADO -- era a prova de que o conserto das cinco
 * rotas nao tinha escapado do escopo. A HMO-306 e justamente a issue que o faz
 * se mover, e o quanto ele se move esta digitado em `SAFE_TO_SPEND_ESPERADO`.
 *
 * O QUE CONTINUA DIFERENTE DAS OUTRAS TRES, E DE PROPOSITO
 * -------------------------------------------------------
 *   1. O FILTRO DE `user_id` FICA. A tela de Despesas passou a listar a linha
 *      do outro membro (o `OR` da HMO-303) porque LISTAR era informacao que
 *      faltava. Aqui a pergunta e "quanto EU posso gastar", e a parte do outro
 *      ja e contada pela carteira DELE: trazer a linha dele para dentro desta
 *      soma descontaria o mesmo dinheiro duas vezes. E isso que faz
 *      `safeEsperado` da face (d) do outro membro ser R$ 0,00 -- e nao uma
 *      omissao da medicao.
 *   2. `classeDaAgenda` CONTINUA FORA, E A HMO-308 NAO MEXEU NISSO. A
 *      transferencia de (a) segue sendo descontada aqui, pela mesma razao do
 *      bloco «A vencer»: a pergunta e caixa, e R$ 500,00 que vao para a
 *      poupanca saem da conta de verdade. Por isso a face (a) tem `esperado`
 *      R$ 0,00 e `safeEsperado` R$ 500,00 -- e e `direcaoDaAgenda`, e nao
 *      `classeDaAgenda`, que produz esse R$ 500,00.
 *
 * A CONSULTA LE A VIEW, E NAO A TABELA (HMO-308). E a troca que a issue pede na
 * rota, e ela tem de acontecer aqui pelo mesmo motivo: a tabela nao tem
 * `direction` (ela nasceu na 027, na view), entao quem le a tabela precisa
 * deduzir a direcao -- e a deducao pelo tipo da REGRA e o defeito, porque
 * previsao AVULSA nao tem regra. O recorte e o da rota: `user_id`,
 * `status = 'pending'` (a coluna GRAVADA, nao `effective_status`) e
 * `due_date <= ate`.
 *
 * `transaction_type` NAO E LIDO AQUI, de proposito. A coluna existe na tabela
 * desde a 022, mas e NULA em parte da base instalada -- o COALESCE que termina
 * em 'expense' mora na view, e refaze-lo neste arquivo seria a segunda copia da
 * precedencia. Exatamente a copia esquecida que a HMO-187 ja pagou uma vez.
 *
 * `parteConfiguradaDoMembro` E `direcaoDaAgenda` SAO IMPORTADOS, como o resto
 * deste arquivo: uma divisao ou uma direcao reescrita aqui mediria a reescrita.
 * E o que prova que a ROTA chama as funcoes e `npm run check-fatura-escolhida`,
 * que exige as chamadas no fonte dela -- esta medicao prova a conta, nao a
 * fiacao.
 */
function leituraDoSafeToSpend(pesos) {
  const previstas = consultar(`
    SELECT COALESCE(json_agg(t), '[]')
      FROM (
        SELECT s.description, s.amount, s.group_id::text,
               s.direction::text AS direction
          FROM scheduled_transactions_effective s
         WHERE s.user_id = '${EU}' AND s.status = 'pending'
           AND s.due_date <= '${JANELA.ate}'
      ) t;
  `);

  let total = 0;
  let receitas = 0;
  const porDescricao = new Map();

  for (const p of previstas) {
    // A MESMA sequencia da rota: a parte do membro primeiro, a direcao depois.
    const minha = parteConfiguradaDoMembro(p.amount, p.group_id, pesos, EU);

    // AS DUAS SOMAS, E NAO SO A DE COMPROMISSOS (HMO-308). O defeito era duplo
    // -- `tipo` decide os dois lados --, entao medir so o total deixaria passar
    // um conserto que DESCARTASSE a receita em vez de contar como receita.
    if (direcaoDaAgenda(p.direction) === "income") {
      receitas += minha;
      continue;
    }

    // `porDescricao` leva a contribuicao para COMPROMISSOS, e e por isso que ela
    // e escrita DEPOIS da peneira da direcao: ela alimenta `safeEsperado`, que e
    // a coluna de "quanto esta descricao tirou do posso gastar". Antes da
    // HMO-308 a escrita vinha antes, e a de uma receita era a propria afirmacao
    // errada -- "o salario tirou R$ 5.000,00" -- com cara de medicao.
    porDescricao.set(p.description, (porDescricao.get(p.description) ?? 0) + minha);
    total += minha;
  }

  return {
    total: Number(total.toFixed(2)),
    receitas: Number(receitas.toFixed(2)),
    quantidade: previstas.length,
    porDescricao,
  };
}

// =============================================================================
// A TABELA
// =============================================================================
const pesos = pesosDoBanco();
const { painel } = leituraDoPainel(pesos);
const { resumo, linhas: linhasDaDespesa } = leituraDaTelaDeDespesas(pesos);
const fechamento = leituraDoFechamento(pesos);
const summary = leituraDoSummary(pesos);
const safeToSpend = leituraDoSafeToSpend(pesos);

/**
 * O que uma descricao contribuiu para o painel -- LIDO DO DETALHE.
 *
 * `total_de_contas.detalhe` e a lista que o chevron abre (HMO-300), e ela nasce
 * dentro do MESMO laco que produziu o total: `soma(detalhe) === total` por
 * construcao. Entao somar as linhas dele por descricao e ler a contribuicao de
 * verdade, e nao refazer a peneira do painel aqui -- que era o que esta medicao
 * fazia ate a HMO-303, com uma divisao escrita a mao dentro do arquivo que
 * existe para provar que nao ha duas.
 *
 * Uma descricao que a peneira recusou nao aparece no detalhe, e a soma sai 0 --
 * que e exatamente a resposta certa para a transferencia de (a).
 */
const noPainel = (descricao) =>
  painel.total_de_contas.detalhe
    .filter((l) => l.descricao === descricao)
    .reduce((s, l) => s + Math.abs(l.valor), 0);

const naTelaDeDespesas = (descricao) =>
  linhasDaDespesa
    .filter((l) => l.descricao === descricao)
    .reduce((s, l) => s + Math.abs(l.valor), 0);

/**
 * O que uma descricao vale DENTRO do safe-to-spend (HMO-306).
 *
 * Descricao ausente vale R$ 0,00, e esse zero e uma AFIRMACAO e nao um buraco:
 * ele e como a medicao cobra que a conta de grupo do OUTRO membro continue fora
 * desta leitura. O filtro de `user_id` da rota e o que o produz.
 */
const noSafeToSpend = (descricao) => safeToSpend.porDescricao.get(descricao) ?? 0;

// `faturaAberta` MORREU AQUI, e nao e desta issue: ela somava a fatura
// sintetizada para o bloco `DISCORDANCIA_CONHECIDA`, que a HMO-305 substituiu
// pela tabela dos tres estados do elo. Ficou declarada e sem leitor, e o eslint
// acusa. Removida de passagem porque este arquivo ja esta aberto -- uma
// variavel morta num arquivo cuja funcao e ser lido com desconfianca convida a
// pergunta errada ("onde isto entra na conta?").

// -----------------------------------------------------------------------------
// OS VALORES ESPERADOS, DIGITADOS -- a tabela aprovada na HMO-302, §1
// -----------------------------------------------------------------------------
// Eles nao sao derivados de nada. Se alguem mexer no fixture e os numeros
// mudarem, este arquivo REPROVA e o conserto e decidir qual dos dois esta certo
// -- nunca copiar o que o codigo imprimiu.
//
// `safe` E `safeEsperado` SAO A QUARTA LEITURA (HMO-306), E ELA NAO ENTRA NO
// `par`. O `par` compara as duas leituras do «Total de contas», e o
// safe-to-spend nao e uma delas: ele responde "quanto posso gastar", filtra por
// `user_id` e nao chama `classeDaAgenda`. Entao ele tem uma coluna de esperado
// PROPRIA, e e justamente onde os dois numeros DIVERGEM do «Total de contas»
// que a divergencia fica anotada em vez de ser escondida numa media:
//
//   (a) R$ 500,00 de transferencia -- o safe-to-spend desconta, as duas telas
//       nao. A pergunta dele e caixa;
//   (d) do outro membro: R$ 0,00 -- o filtro de `user_id` fica, e a parte dele
//       e contada pela carteira dele;
//   (d) a minha: R$ 300,00 -- o numero do «Pronto quando» desta issue, e o
//       MESMO que as outras tres leituras dao.
const LINHAS = [
  {
    mecanismo: "(a)",
    par: ["painel", "tela"],
    caso: "Transferência prevista — «Reserva na poupança» R$ 500,00",
    painel: noPainel("Reserva na poupanca"),
    tela: naTelaDeDespesas("Reserva na poupanca"),
    cobrado: null,
    esperado: 0,
    safe: noSafeToSpend("Reserva na poupanca"),
    safeEsperado: 500,
    nota:
      "guardar na poupança não é conta a pagar, e saiu do «Total de contas» " +
      "(`classeDaAgenda`). O bloco «A vencer» CONTINUA somando, porque a " +
      "pergunta dele é caixa -- e as duas telas dizem que discordam",
  },
  {
    mecanismo: "(c)",
    par: ["painel", "cobrado"],
    caso: "Parte do grupo Casa (70/30) — R$ 4.000,00 de contas no mês",
    painel: noPainel("Aluguel da casa") + noPainel("Internet da casa"),
    tela: naTelaDeDespesas("Aluguel da casa") + naTelaDeDespesas("Internet da casa"),
    cobrado: fechamento.meusCentavos / 100,
    esperado: 1200,
    // O safe-to-spend ve SO a minha metade de (c): a linha do outro membro nao
    // passa pelo filtro de `user_id`, que esta issue manteve de proposito.
    safe:
      noSafeToSpend("Aluguel da casa") + noSafeToSpend("Internet da casa"),
    safeEsperado: 300,
    nota:
      "30% de R$ 4.000,00. As três leituras chamam `ratearPorPeso`, então o " +
      "número é o mesmo por construção -- e (c) = (d) + (d): 900 + 300 = 1.200. " +
      "O safe-to-spend desconta só a minha metade (R$ 300,00): a conta do outro " +
      "membro já sai da carteira dele",
  },
  {
    mecanismo: "(d)",
    par: ["painel", "tela"],
    caso: "Conta de grupo do OUTRO membro — «Aluguel da casa» R$ 3.000,00",
    painel: noPainel("Aluguel da casa"),
    tela: naTelaDeDespesas("Aluguel da casa"),
    cobrado:
      (fechamento.porDespesa.find((d) => d.descricao === "Aluguel da casa")
        ?.minha ?? 0) / 100,
    esperado: 900,
    // R$ 0,00 E A AFIRMACAO desta issue: a linha do outro membro continua FORA
    // do safe-to-spend. Se o filtro de `user_id` da rota caisse, este numero
    // viraria R$ 900,00 e a medicao REPROVA.
    safe: noSafeToSpend("Aluguel da casa"),
    safeEsperado: 0,
    nota:
      "a tela de Despesas passou a LISTAR a linha do outro membro (o `OR` da " +
      "consulta, que é o ramo que a policy do 005 já liberava), com rótulo e " +
      "sem botão. No safe-to-spend ela continua FORA: a pergunta é quanto EU " +
      "posso gastar, e os R$ 900,00 dele já saem da carteira dele",
  },
  {
    mecanismo: "(d)",
    par: ["painel", "tela"],
    caso: "MINHA conta de grupo — «Internet da casa» R$ 1.000,00",
    painel: noPainel("Internet da casa"),
    tela: naTelaDeDespesas("Internet da casa"),
    cobrado:
      (fechamento.porDespesa.find((d) => d.descricao === "Internet da casa")
        ?.minha ?? 0) / 100,
    esperado: 300,
    // O NUMERO DO «PRONTO QUANDO» DA HMO-306. Era R$ 1.000,00 (valor cheio) e
    // passou a ser R$ 300,00 -- o mesmo que as outras tres leituras.
    safe: noSafeToSpend("Internet da casa"),
    safeEsperado: 300,
    nota:
      "a tela de Despesas somava CHEIO porque o `select` nem trazia `group_id`. " +
      "Agora as duas telas tomam 30% -- e o safe-to-spend também (HMO-306): " +
      "era R$ 1.000,00 cheios ali, e a quarta leitura passou a dar o mesmo " +
      "R$ 300,00 que as três primeiras",
  },
];

/**
 * (b) A FATURA EM DOIS LUGARES -- MEDIDA NOS TRES ESTADOS (HMO-305).
 *
 * Ate a HMO-303 este bloco era uma DISCORDANCIA ANOTADA: as duas telas somavam
 * R$ 1.600,00 de uma divida de R$ 800,00, de proposito, porque os dois caminhos
 * automaticos foram recusados no plano (os dois erram para BAIXO, que e esconder
 * uma conta real). A anotacao existia para que o controle nao ficasse verde por
 * engano no dia em que (b) fosse consertado.
 *
 * Este e o dia. A HMO-305 nao adivinha nada: ela da a ACAO ("esta previsao e a
 * fatura do Nubank de marco"), que grava a chave canonica em `notes`, e a
 * de-duplicacao acontece pelo mecanismo que ja existia -- `chavesPersistidas` em
 * `sintetizarFaturasAbertas`. Entao o que esta medicao cobra agora sao TRES
 * estados do MESMO banco, nesta ordem:
 *
 *   1. ANTES: nenhum elo. As duas telas somam R$ 1.600,00 -- e e isso que torna
 *      o conserto mensuravel. Sem este estado, "a tela mostra R$ 800" nao
 *      distinguiria o elo funcionando de um fixture que nunca teve a previsao;
 *   2. COM O ELO: R$ 800,00 nas duas. A fatura sintetizada sai da lista (ela ja
 *      esta na agenda, pela chave), e o «Total de contas» cai exatamente o valor
 *      dela;
 *   3. DESFEITO: R$ 1.600,00 de volta. O caminho de volta nao e cortesia -- um
 *      elo errado esconde uma divida verdadeira, e sem ele a unica saida seria
 *      editar a mao uma string que ninguem explicou.
 *
 * A ESCRITA E A DA PESSOA, E NAO UMA SIMULACAO: o `UPDATE` abaixo grava o que a
 * rota grava (`notesDoElo`, importado de lib/), passando pela RLS como
 * `authenticated`. O que esta medicao NAO cobre e o clique -- isso e o caso J de
 * `npm run test:papel-na-tela`, que roda os componentes num Chromium.
 */
const eloDaFatura = (notes) =>
  escrever(
    `UPDATE scheduled_transactions
        SET notes = ${notes === null ? "NULL" : `'${notes}'`}
      WHERE id = '${PREVISAO_DA_FATURA}'`
  );

/** As duas telas, relidas do banco no estado em que ele esta agora. */
function faturaNasDuasTelas() {
  const doPainel = leituraDoPainel(pesos);
  const daTela = leituraDaTelaDeDespesas(pesos);

  const soma = (linhas) =>
    linhas
      .filter(
        (l) =>
          l.descricao === "Pagar fatura Nubank" ||
          String(l.descricao ?? "").startsWith("Fatura Nubank")
      )
      .reduce((t, l) => t + Math.abs(l.valor), 0);

  return {
    painel: soma(doPainel.painel.total_de_contas.detalhe),
    tela: soma(daTela.linhas),
    totalDoPainel: doPainel.painel.total_de_contas.total,
    previstoDaTela: daTela.resumo.previsto,
    // Quantas linhas de fatura ABERTA a leitura sintetizou. E a medida direta
    // da de-duplicacao: 1 antes, 0 com o elo, 1 de novo depois. O valor em
    // reais sozinho nao distinguiria "a fatura saiu" de "a fatura virou zero".
    faturasSintetizadas: doPainel.previstas.length,
  };
}

/**
 * A DIVIDA DE VERDADE: as compras do mes no Nubank, no fixture (R$ 500 de
 * mercado + R$ 300 de farmacia).
 *
 * DIGITADA, e e ela o oraculo deste mecanismo: as duas telas somavam o DOBRO
 * disto, e o conserto e as duas passarem a somar ISTO. Deriva-la da leitura
 * faria a medicao comparar o codigo consigo mesmo.
 */
const DIVIDA_REAL_DA_FATURA = 800;

const B_ANTES = faturaNasDuasTelas();

eloDaFatura(notesDoElo(MES_DA_FATURA, CARTAO_DA_FATURA));
const B_COM_ELO = faturaNasDuasTelas();

eloDaFatura(null);
const B_DESFEITO = faturaNasDuasTelas();

// E O BANCO VOLTA AO ESTADO DO FIXTURE, que e onde ele comecou: uma medicao que
// deixa o banco diferente do arquivo faz a execucao seguinte medir outra coisa.
// (O `.sh` recria o banco, mas quem roda a medicao a mao duas vezes nao.)

const LARGURA = 136;

console.log("");
console.log("=".repeat(LARGURA));
console.log('HMO-298/303/306 -- AS QUATRO LEITURAS DO "TOTAL DE CONTAS", MEDIDAS');
console.log(
  `Postgres local, migrations 001->042, RLS ligada. Mês ${JANELA.de} a ${JANELA.ate}, hoje congelado em ${HOJE}.`
);
console.log("=".repeat(LARGURA));
console.log("");

const col = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(
  col("mec", 5) +
    col("caso", 58) +
    col("painel", 14) +
    col("tela Despesas", 15) +
    col("cobrado", 14) +
    col("esperado", 14) +
    col("safe-to-spend", 15) +
    "esp. s2s"
);
console.log("-".repeat(LARGURA));

const divergentes = [];
for (const l of LINHAS) {
  const [a, b] = l.par;
  const parConcorda = bate(l[a], l[b]);
  // AS DUAS COBRANCAS, E CADA UMA PEGA O QUE A OUTRA NAO PEGA. So a igualdade
  // do par deixaria passar um bug que zerasse as tres leituras; so o valor
  // absoluto deixaria passar uma leitura certa ao lado de uma errada que a
  // tabela nao olha.
  const bateOEsperado = bate(l[a], l.esperado) && bate(l[b], l.esperado);
  // A QUARTA LEITURA tem esperado PROPRIO (ver o comentario de `LINHAS`): ela
  // nao responde a mesma pergunta das outras tres, e exigir que ela batesse com
  // `esperado` reprovaria o comportamento CERTO de (a) e de (d)-do-outro.
  const bateOSafe = bate(l.safe, l.safeEsperado);
  if (!parConcorda || !bateOEsperado || !bateOSafe) {
    divergentes.push({ ...l, parConcorda, bateOEsperado, bateOSafe });
  }
  console.log(
    col(l.mecanismo, 5) +
      col(l.caso, 58) +
      col(brl(l.painel), 14) +
      col(brl(l.tela), 15) +
      col(brl(l.cobrado), 14) +
      col(brl(l.esperado), 14) +
      col(brl(l.safe), 15) +
      `${brl(l.safeEsperado)}  ${
        parConcorda && bateOEsperado && bateOSafe ? "ok" : "REPROVA"
      }`
  );
}

console.log("-".repeat(LARGURA));
console.log("");
for (const l of LINHAS) console.log(`  ${l.mecanismo} ${l.caso}\n      ${l.nota}\n`);

console.log("=".repeat(LARGURA));
console.log("(b) A FATURA EM DOIS LUGARES -- O ELO, LIGADO E DESFEITO (HMO-305)");
console.log("=".repeat(LARGURA));
console.log(
  "  " + col("estado", 24) + col("painel", 16) + col("tela Despesas", 16) +
    col("sintetizada?", 24) + "o total do mes"
);
console.log("  " + "-".repeat(110));
console.log(
  "  " +
    col("1. sem elo", 24) +
    col(brl(B_ANTES.painel), 16) +
    col(brl(B_ANTES.tela), 16) +
    col(B_ANTES.faturasSintetizadas + " fatura(s) aberta(s)", 24) +
    "«Total de contas» " + brl(B_ANTES.totalDoPainel)
);
console.log(
  "  " +
    col("2. com o elo", 24) +
    col(brl(B_COM_ELO.painel), 16) +
    col(brl(B_COM_ELO.tela), 16) +
    col(B_COM_ELO.faturasSintetizadas + " fatura(s) aberta(s)", 24) +
    "«Total de contas» " + brl(B_COM_ELO.totalDoPainel)
);
console.log(
  "  " +
    col("3. desfeito", 24) +
    col(brl(B_DESFEITO.painel), 16) +
    col(brl(B_DESFEITO.tela), 16) +
    col(B_DESFEITO.faturasSintetizadas + " fatura(s) aberta(s)", 24) +
    "«Total de contas» " + brl(B_DESFEITO.totalDoPainel)
);
console.log("");
console.log(
  "  A divida REAL do cartao e " + brl(DIVIDA_REAL_DA_FATURA) + " -- as compras do mes no Nubank."
);
console.log(
  "  Ligar o elo grava a chave canonica em `notes`; quem de-duplica e `chavesPersistidas`,"
);
console.log(
  "  em `sintetizarFaturasAbertas` -- nenhuma aritmetica nova, e nada acontece sem a pessoa."
);
console.log("");

console.log("=".repeat(LARGURA));
console.log("OS TOTAIS DO MÊS");
console.log("=".repeat(LARGURA));
console.log(
  `  Salário Previsto (painel)        ${brl(painel.salario_previsto.total)}  (${painel.salario_previsto.quantidade} linha(s))`
);
console.log(
  `  Receitas (painel)                ${brl(painel.receitas.total)}  (${painel.receitas.quantidade} linha(s))`
);
console.log(
  `  TOTAL DE CONTAS (painel)         ${brl(painel.total_de_contas.total)}  (${painel.total_de_contas.quantidade} linha(s))`
);
console.log(
  `  Previsto da tela de Despesas     ${brl(resumo.previsto)}`
);
console.log(
  `  O que o grupo vai COBRAR de mim  ${brl(fechamento.meusCentavos / 100)}`
);
console.log(`  «${painel.sobra_ou_falta.titulo}»  ${brl(painel.sobra_ou_falta.valor)}`);
console.log("");
console.log(
  `  Diferença entre o painel e a tela de Despesas: ${brl(
    Math.abs(painel.total_de_contas.total - resumo.previsto)
  )}`
);
console.log(
  `  FORA do «Total de contas», por serem transferência: ${brl(
    painel.total_de_contas.transferencias_fora.total
  )} em ${painel.total_de_contas.transferencias_fora.quantidade} linha(s)`
);
console.log("");

console.log("=".repeat(LARGURA));
console.log("O ITEM 7 -- O QUE MUDA FORA DO PAINEL, E O QUE NAO PODE MUDAR");
console.log("=".repeat(LARGURA));
console.log(
  `  /api/scheduled-transactions/summary  previsto de despesa  ${brl(summary.previstoDespesas)}`
);
console.log(
  `                                       custo fixo mensal    ${brl(summary.custoFixoMensal)}`
);
console.log(
  `  /api/safe-to-spend (QUARTA LEITURA)  compromissos         ${brl(safeToSpend.total)}  (${safeToSpend.quantidade} linha(s) lidas)`
);
console.log(
  `                                       receitas previstas   ${brl(safeToSpend.receitas)}`
);
console.log(
  `                                       antes da HMO-306     ${brl(
    SAFE_TO_SPEND_ANTES_DA_306
  )}  (a MINHA conta de grupo entrava CHEIA)`
);
console.log(
  `                                       antes da HMO-308     ${brl(
    SAFE_TO_SPEND_DEPOIS_DA_306
  )}  (a receita prevista avulsa entrava como conta a pagar)`
);
console.log("");

// -----------------------------------------------------------------------------
// O CONTROLE
// -----------------------------------------------------------------------------
// Ver o cabecalho: ate a HMO-303 ele exigia DISCORDANCIA; desde ela exige
// CONCORDANCIA, nos valores digitados acima.
//
// A CONTA DE CADA MECANISMO, E NAO SO O TOTAL. Exigir apenas os dois totais em
// R$ 2.800,00 seria fraco demais: o mecanismo (d) tem DUAS faces (a linha do
// outro membro e a minha) e um erro de R$ 600 numa compensaria um de R$ 600 na
// outra, com o total fechando. Cobrar linha por linha e o que faz cada peca
// responder por si -- e e por isso que (c) = (d) + (d) importa.

/** O previsto da tela de Despesas e o Total de contas do painel, em reais. */
const TOTAL_ESPERADO = 2800;
/**
 * O que a transferencia de (a) tira do «Total de contas» -- e o preco aprovado.
 *
 * Ele e cobrado porque "o numero caiu R$ 500" e "a tela DIZ que caiu R$ 500" sao
 * duas coisas diferentes, e so a segunda e o conserto. Sem esta assercao, uma
 * refatoracao que perdesse `transferencias_fora` no caminho deixaria o painel
 * certo e a frase ausente, e o controle ficaria verde sobre um valor que some
 * sem rotulo.
 */
const TRANSFERENCIA_FORA_ESPERADA = { total: 500, quantidade: 1 };

const falhas = [];

for (const d of divergentes) {
  const [a, b] = d.par;
  falhas.push(
    `  ${d.mecanismo} ${d.caso}\n` +
      `      ${a} ${brl(d[a])} × ${b} ${brl(d[b])}, esperado ${brl(d.esperado)}` +
      (d.parConcorda ? "" : "  [o PAR discorda]") +
      (d.bateOEsperado ? "" : "  [nao bate com o valor digitado]") +
      (d.bateOSafe
        ? ""
        : `\n      safe-to-spend ${brl(d.safe)}, esperado ${brl(
            d.safeEsperado
          )}  [a QUARTA leitura nao bate -- HMO-306]`)
  );
}

if (!bate(painel.total_de_contas.total, TOTAL_ESPERADO)) {
  falhas.push(
    `  TOTAL DE CONTAS (painel): ${brl(painel.total_de_contas.total)}, esperado ${brl(TOTAL_ESPERADO)}`
  );
}
if (!bate(resumo.previsto, TOTAL_ESPERADO)) {
  falhas.push(
    `  Previsto (tela de Despesas): ${brl(resumo.previsto)}, esperado ${brl(TOTAL_ESPERADO)}`
  );
}

const fora = painel.total_de_contas.transferencias_fora;
if (
  !fora ||
  !bate(fora.total, TRANSFERENCIA_FORA_ESPERADA.total) ||
  fora.quantidade !== TRANSFERENCIA_FORA_ESPERADA.quantidade
) {
  falhas.push(
    `  transferencias_fora: ${JSON.stringify(fora)}, esperado ${JSON.stringify(
      TRANSFERENCIA_FORA_ESPERADA
    )}\n` +
      `      Sem este campo o painel esconde R$ 500,00 sem dizer que escondeu.`
  );
}

// (b) O ELO DA FATURA -- OS TRES ESTADOS, COBRADOS UM A UM (HMO-305)
//
// Ate a HMO-303 este bloco exigia que (b) CONTINUASSE discordando, com um aviso
// explicito: "se (b) foi consertado, ATUALIZE esta medicao em vez de relaxar o
// numero". E o que esta sendo feito aqui -- e os numeros novos continuam
// DIGITADOS, nao derivados de uma rodada do codigo.
//
// SAO QUATRO COBRANCAS POR ESTADO, e cada uma pega o que as outras nao pegam:
//
//   * as duas telas CONCORDAM entre si (o par);
//   * e batem com o valor absoluto digitado (R$ 1.600 / R$ 800 / R$ 1.600);
//   * a CONTAGEM de faturas sintetizadas (1 / 0 / 1) -- sem ela, "o valor caiu"
//     nao distinguiria a fatura SAINDO da lista de a fatura virando zero;
//   * e o «Total de contas» do mes inteiro (R$ 2.800 / R$ 2.000 / R$ 2.800), que
//     e o numero que a pessoa le. Um conserto que tirasse a fatura da lista e
//     esquecesse de mexer no total passaria pelas tres primeiras.
const ESTADOS_DE_B = [
  {
    nome: "antes do elo",
    medido: B_ANTES,
     esperadoNasTelas: 1600,
    esperadoSintetizadas: 1,
    esperadoTotal: 2800,
  },
  {
    nome: "com o elo",
    medido: B_COM_ELO,
    esperadoNasTelas: 800,
    esperadoSintetizadas: 0,
    esperadoTotal: 2000,
  },
  {
    nome: "depois de desfazer",
    medido: B_DESFEITO,
    esperadoNasTelas: 1600,
    esperadoSintetizadas: 1,
    esperadoTotal: 2800,
  },
];

for (const e of ESTADOS_DE_B) {
  const m = e.medido;
  if (
    !bate(m.painel, m.tela) ||
    !bate(m.painel, e.esperadoNasTelas) ||
    !bate(m.tela, e.esperadoNasTelas)
  ) {
    falhas.push(
      `  (b) ${e.nome}: painel ${brl(m.painel)} × tela ${brl(m.tela)}, esperado ` +
        `${brl(e.esperadoNasTelas)} nas duas.`
    );
  }
  if (m.faturasSintetizadas !== e.esperadoSintetizadas) {
    falhas.push(
      `  (b) ${e.nome}: ${m.faturasSintetizadas} fatura(s) sintetizada(s), esperado ` +
        `${e.esperadoSintetizadas}.\n` +
        `      A de-duplicacao e a fatura SAIR da lista (chavesPersistidas), e nao ela valer zero.`
    );
  }
  if (!bate(m.totalDoPainel, e.esperadoTotal) || !bate(m.previstoDaTela, e.esperadoTotal)) {
    falhas.push(
      `  (b) ${e.nome}: «Total de contas» ${brl(m.totalDoPainel)} / «Previsto» ` +
        `${brl(m.previstoDaTela)}, esperado ${brl(e.esperadoTotal)} nos dois.`
    );
  }
}

// A IDENTIDADE DO CONSERTO: o que o elo tira do mes e EXATAMENTE a divida real do
// cartao, nem um centavo mais. Ela e o que impede os tres numeros digitados acima
// de passarem verdes sendo arbitrarios -- e o que denunciaria um elo que
// escondesse a previsao da pessoa em vez da fatura sintetizada.
if (
  !bate(B_ANTES.totalDoPainel - B_COM_ELO.totalDoPainel, DIVIDA_REAL_DA_FATURA)
) {
  falhas.push(
    `  (b) o elo mudou o total em ${brl(
      B_ANTES.totalDoPainel - B_COM_ELO.totalDoPainel
    )}, e a divida real e ${brl(DIVIDA_REAL_DA_FATURA)}.`
  );
}

// E DESFAZER DEVOLVE O MESMO TANTO. Sem esta, um desfazer que esquecesse de
// apagar a chave deixaria a conta escondida para sempre -- o erro na direcao
// cara, e invisivel: a tela mostraria um mes mais folgado do que ele e.
if (!bate(B_DESFEITO.totalDoPainel, B_ANTES.totalDoPainel)) {
  falhas.push(
    `  (b) desfazer nao devolveu o total: ${brl(B_DESFEITO.totalDoPainel)} × ` +
      `${brl(B_ANTES.totalDoPainel)} de antes.`
  );
}

// A IDENTIDADE QUE TORNA A TABELA MAIS DO QUE UM TESTE DE IGUALDADE.
const somaDasDuasFaces =
  LINHAS.filter((l) => l.mecanismo === "(d)").reduce(
    (s, l) => s + l.esperado,
    0
  );
const deC = LINHAS.find((l) => l.mecanismo === "(c)").esperado;
if (!bate(somaDasDuasFaces, deC)) {
  falhas.push(
    `  (c) deveria ser a soma das duas faces de (d): ${brl(somaDasDuasFaces)} ≠ ${brl(deC)}.\n` +
      `      Esta identidade e o que impede a tabela de passar com tres numeros iguais e errados.`
  );
}

// A QUARTA LEITURA, NO TOTAL (HMO-306, REVISTA NA HMO-308). Os numeros estao
// declarados no topo do arquivo, com a aritmetica deles escrita; aqui eles sao
// COBRADOS.
//
// A CADEIA primeiro: os numeros valem mais juntos do que separados. Sem ela,
// alguem que mudasse o fixture e ajustasse `SAFE_TO_SPEND_ESPERADO` para o que
// o codigo imprimiu deixaria o "antes" e as diferencas contando outra historia,
// e o controle ficaria verde sobre uma conta que nao fecha. Os DOIS degraus sao
// cobrados um a um de proposito: o da HMO-306 continua tendo de fechar depois
// que a HMO-308 passou por cima dele -- se os dois fossem reduzidos a uma
// subtracao so, desfazer a parte do grupo e inflar a receita na mesma medida
// passaria verde.
if (
  SAFE_TO_SPEND_ANTES_DA_306 - DIFERENCA_DA_PARTE_DO_GRUPO !==
  SAFE_TO_SPEND_DEPOIS_DA_306
) {
  falhas.push(
    `  O degrau da HMO-306 nao fecha: ${brl(
      SAFE_TO_SPEND_ANTES_DA_306
    )} - ${brl(DIFERENCA_DA_PARTE_DO_GRUPO)} ≠ ${brl(
      SAFE_TO_SPEND_DEPOIS_DA_306
    )}.`
  );
}

if (
  SAFE_TO_SPEND_DEPOIS_DA_306 - RECEITA_CONTADA_COMO_CONTA !==
  SAFE_TO_SPEND_ESPERADO
) {
  falhas.push(
    `  O degrau da HMO-308 nao fecha: ${brl(
      SAFE_TO_SPEND_DEPOIS_DA_306
    )} - ${brl(RECEITA_CONTADA_COMO_CONTA)} ≠ ${brl(SAFE_TO_SPEND_ESPERADO)}.`
  );
}

// E A RECEITA QUE SAIU DE «A PAGAR» TEM DE APARECER EM «A RECEBER», pelo MESMO
// valor. Esta e a metade que a subtracao acima nao prova, e e a que separa o
// conserto de um descarte: uma rota que simplesmente PULASSE a linha de receita
// daria o mesmo R$ 1.600,00 de compromissos e esconderia R$ 6.200,00 que a
// pessoa vai receber -- com o "posso gastar" R$ 6.200,00 menor e nada vermelho.
if (RECEITAS_PREVISTAS_ESPERADAS !== RECEITA_CONTADA_COMO_CONTA) {
  falhas.push(
    `  A receita que saiu de «A pagar» (${brl(
      RECEITA_CONTADA_COMO_CONTA
    )}) nao e a que se espera em «A receber» (${brl(
      RECEITAS_PREVISTAS_ESPERADAS
    )}).\n` +
      `      O defeito da HMO-308 e DUPLO: o mesmo valor sai de um lado e entra no outro.`
  );
}

if (!bate(safeToSpend.total, SAFE_TO_SPEND_ESPERADO)) {
  falhas.push(
    `  QUARTA LEITURA, compromissos: /api/safe-to-spend saiu ${brl(
      safeToSpend.total
    )}, esperado ${brl(SAFE_TO_SPEND_ESPERADO)}.\n` +
      `      Em ${brl(SAFE_TO_SPEND_DEPOIS_DA_306)} a rota voltou a ler a TABELA \`scheduled_transactions\` e a\n` +
      `      deduzir a direcao do tipo da REGRA -- previsao avulsa nao tem regra, e ${brl(
        RECEITA_CONTADA_COMO_CONTA
      )} de\n` +
      `      receita voltaram a ser contados como conta a pagar (HMO-308).\n` +
      `      Em ${brl(SAFE_TO_SPEND_ANTES_DA_306)} ela perdeu TAMBEM a parte do grupo: parou de chamar\n` +
      `      \`parteConfiguradaDoMembro\` ou perdeu o \`group_id\` do \`select\` (HMO-306).\n` +
      `      Em ${brl(1100)} a transferencia de ${brl(500)} saiu desta leitura -- e ela NAO devia\n` +
      `      sair: a pergunta aqui e caixa, e trocar \`direcaoDaAgenda\` por \`classeDaAgenda\`\n` +
      `      e o jeito de fazer isso sem erro nenhum.`
  );
}

if (!bate(safeToSpend.receitas, RECEITAS_PREVISTAS_ESPERADAS)) {
  falhas.push(
    `  QUARTA LEITURA, receitas previstas: saiu ${brl(
      safeToSpend.receitas
    )}, esperado ${brl(RECEITAS_PREVISTAS_ESPERADAS)}.\n` +
      `      Em ${brl(0)} a direcao nao chegou: ou a leitura voltou para a tabela (que nao tem\n` +
      `      \`direction\`), ou o \`select\` perdeu a coluna -- e nos dois casos TODA linha cai em\n` +
      `      despesa, que e o defeito da HMO-308 inteiro.`
  );
}

if (falhas.length > 0) {
  console.error(
    "FALHA DE CONTROLE -- as leituras deveriam concordar nos valores digitados:\n\n" +
      falhas.join("\n") +
      "\n\nEstes numeros vem da tabela aprovada na HMO-302 (§1) e foram DIGITADOS,\n" +
      "nao derivados. Nao os ajuste para o que o codigo imprimiu: decida primeiro\n" +
      "qual dos dois esta certo."
  );
  process.exit(1);
}

console.log(
  `Controle: as ${LINHAS.length} linhas concordaram no par que cada uma mede E bateram com o valor\n` +
    `digitado; os dois totais sairam ${brl(TOTAL_ESPERADO)}; a transferencia de ${brl(
      TRANSFERENCIA_FORA_ESPERADA.total
    )} saiu do\n` +
    `«Total de contas» COM rotulo; o elo da fatura (HMO-305) levou (b) de ${brl(
    1600
  )} para ${brl(800)} e o desfazer devolveu;\n` +
    `e a QUARTA leitura (/api/safe-to-spend) bateu em ${brl(SAFE_TO_SPEND_ESPERADO)} de compromissos\n` +
    `com ${brl(RECEITAS_PREVISTAS_ESPERADAS)} em receitas previstas -- a MINHA conta de grupo entrou por ${brl(
      300
    )} e nao\n` +
    `pelos ${brl(1000)} cheios, a do outro membro ficou FORA, a transferencia de ${brl(
      500
    )} CONTINUA\n` +
    `descontada (a pergunta e caixa), e a cadeia fecha: ${brl(
      SAFE_TO_SPEND_ANTES_DA_306
    )} - ${brl(DIFERENCA_DA_PARTE_DO_GRUPO)} (HMO-306)\n` +
    `- ${brl(RECEITA_CONTADA_COMO_CONTA)} (HMO-308) = ${brl(
      SAFE_TO_SPEND_ESPERADO
    )}, e os ${brl(RECEITA_CONTADA_COMO_CONTA)} reapareceram do outro lado.`
);
console.log("");
