#!/usr/bin/env node
// =====================================================
// PULODOGATO - O ROTULO DE FATURA LE FATURA, E NAO `current_balance` (HMO-290)
//              O "POSSO GASTAR" DESCONTA A MINHA PARTE DO GRUPO (HMO-306)
//              E A DIRECAO DELE SAI DA VIEW, NAO DO TIPO DA REGRA (HMO-308)
// =====================================================
//   npm run check-fatura-escolhida
//
// TRES ISSUES NO MESMO ARQUIVO, E E DE PROPOSITO: as tres sao fiacao da MESMA
// rota (`app/api/safe-to-spend/route.ts`) e do mesmo modulo
// (`lib/safe-to-spend.ts`), e as tres falham do mesmo jeito -- com um numero
// menor e plausivel, sem erro de tipo e sem log. Um guard novo so para a
// HMO-306 seria um segundo lugar para esquecer de rodar; a secao 5 abaixo e a
// parte dela, e a secao 6 e a da HMO-308.
//
// AS SECOES 5 E 6 COBRAM A MESMA CONSULTA, por duas metades diferentes: a 5
// cobra QUANTO da linha e meu (a parte do grupo) e a 6 cobra PARA QUE LADO ela
// vai (a direcao). As duas tem de apontar para a mesma `.from(...)`, e por isso
// o nome da fonte e a constante `AGENDA_DO_POSSO_GASTAR` -- ver o comentario
// dela, que registra como a secao 5 quase ficou vacua quando a 6 trocou a
// tabela pela view.
//
// POR QUE ESTA VERIFICACAO EXISTE
// -------------------------------
// O defeito que a HMO-290 consertou nao era um calculo: era um ROTULO sobre a
// coluna errada. `CartaoDaLista` imprimia `Math.abs(current_balance)` -- a
// divida INTEIRA do cartao -- embaixo de "Fatura atual", e a lista somava
// `totalDoEscopo(ativas, "cartao")` embaixo de "Faturas em aberto". Uma compra
// de R$ 3.000 em 10x aparecia como "Fatura atual: R$ 3.000" no mes da compra,
// quando aquele mes cobra R$ 300.
//
// NADA DISSO APARECE NO `tsc`. `current_balance` e `number | string | null` e a
// fatura e `number`: as duas atribuicoes compilam. A fronteira da rota e pior --
// `await res.json()` e `any`, e uma URL e uma string. Trocar
// `/api/card-invoices` por outra rota, ou deixar de passar `month=`, nao produz
// nenhum erro de tipo e nenhum erro em tela: o numero continua plausivel.
//
// E o tipo de regressao que volta por boa intencao: alguem "simplifica" a tela
// tirando a segunda leitura (duas chamadas onde havia uma parecem desperdicio)
// e o rotulo volta a mentir, com os testes de `lib/fatura-do-periodo.ts` todos
// verdes -- a aritmetica exata, e a tela ignorando ela.
//
// POR QUE OS COMENTARIOS SAO REMOVIDOS ANTES DE QUALQUER BUSCA
// ------------------------------------------------------------
// Porque TODO arquivo aqui explica, por escrito e em detalhe, justamente o que
// esta verificacao procura -- e o estrago e diferente nas duas direcoes:
//
//   - nas buscas PROIBIDAS, o texto cru reprovaria sempre. Os cabecalhos de
//     `CartaoDaLista` e da tela de cartoes citam `current_balance` uma duzia de
//     vezes, para contar o que o numero era antes. A verificacao ficaria
//     vermelha sobre arquivos corretos, e o conserto obvio -- apagar a
//     explicacao -- jogaria fora o unico registro do defeito.
//
//   - nas buscas EXIGIDAS, o texto cru APROVARIA por comentario. O cabecalho da
//     rota do "posso gastar" cita `card_invoice_lines`, e o do
//     `lib/safe-to-spend.ts` cita `ehFatura` varias vezes: tirar as duas
//     chamadas de verdade e deixar a prosa passaria verde. Essa e a metade
//     perigosa -- ela nao avisa, so para de verificar.
//
// Uma assercao que le o comentario em vez do codigo e pior que assercao
// nenhuma: ela ocupa o lugar dela.
//
// Textual de proposito: nao interpreta TypeScript, nao precisa de dependencia
// nova e roda em milissegundos, entao cabe no job sem filtro de path. E um
// piso, nao uma garantia.
// =====================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

const CARD_DA_LISTA = "components/cartoes/CartaoDaLista.tsx";
const TELA_DE_CARTOES = "app/(dashboard)/dashboard/cartoes/page.tsx";
const LIB_DO_PERIODO = "lib/fatura-do-periodo.ts";
const LIB_DO_POSSO_GASTAR = "lib/safe-to-spend.ts";
const ROTA_DO_POSSO_GASTAR = "app/api/safe-to-spend/route.ts";

/**
 * A VIEW, e nao a tabela -- a fonte da agenda no "posso gastar" (HMO-308).
 *
 * Ela e uma CONSTANTE e nao uma string repetida porque as cinco assercoes da
 * secao 6 e as tres da secao 5 tem de apontar para a MESMA consulta. Com o nome
 * digitado oito vezes, trocar a fonte num lugar so faria `consultaDe` devolver
 * "" para as outras -- e `proibidoNaConsulta` com trecho vazio passa VERDE, sem
 * nada para procurar. Foi assim que a secao 5 quase ficou vacua nesta issue: o
 * `.from("scheduled_transactions")` dela deixou de existir quando a rota passou
 * a ler a view, e o `proibidoNaConsulta` do `.or(` parou de medir em silencio.
 */
const AGENDA_DO_POSSO_GASTAR = "scheduled_transactions_effective";

/**
 * O arquivo sem comentario nenhum.
 *
 * `//` precedido de `:` fica -- e o `https://` de uma URL, e cortar ali
 * truncaria a linha e produziria uma reprovacao inventada. Nenhuma das buscas
 * abaixo depende de o que sobra ser TypeScript valido: o que se quer e o texto
 * que o compilador ve, sem a prosa que o explica.
 */
function semComentarios(fonte) {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const arquivos = new Map();

function codigo(caminho) {
  if (!arquivos.has(caminho)) {
    arquivos.set(
      caminho,
      semComentarios(readFileSync(join(RAIZ, caminho), "utf8"))
    );
  }
  return arquivos.get(caminho);
}

const problemas = [];

/** O arquivo NAO pode conter o trecho (fora de comentario). */
function proibido(caminho, trecho, porque) {
  if (codigo(caminho).includes(trecho)) {
    problemas.push(`${caminho}: ${porque}\n    encontrado: ${trecho}`);
  }
}

/** O arquivo PRECISA conter o trecho (fora de comentario). */
function exigido(caminho, trecho, porque) {
  if (!codigo(caminho).includes(trecho)) {
    problemas.push(`${caminho}: ${porque}\n    faltando: ${trecho}`);
  }
}

/**
 * UMA consulta do arquivo, do `.from("tabela")` ate o `;` que fecha a cadeia.
 *
 * ELA EXISTE PORQUE UMA ASSERCAO DE ARQUIVO INTEIRO ESCORREGA PARA OUTRA
 * CONSULTA, e isso foi MEDIDO ao escrever a secao 5: `exigido(ROTA,
 * '.eq("user_id", user.id)')` passou VERDE depois de trocar justamente aquele
 * filtro por um `.or(...)`, porque a rota tem mais tres consultas e duas delas
 * filtram por dono. A assercao parecia cobrar o recorte das previstas e cobrava
 * o das contas -- vacua, e do jeito que nao avisa.
 *
 * O recorte pelo `;` e simples de proposito: nenhuma das cadeias do PostgREST
 * neste arquivo tem `;` no meio. Se alguma vier a ter, o trecho sai curto e a
 * assercao REPROVA -- o lado seguro, que pede uma olhada em vez de aprovar
 * calado.
 */
function consultaDe(caminho, tabela) {
  const fonte = codigo(caminho);
  const inicio = fonte.indexOf(`.from("${tabela}")`);
  if (inicio < 0) return "";
  const fim = fonte.indexOf(";", inicio);
  return fim < 0 ? fonte.slice(inicio) : fonte.slice(inicio, fim);
}

/** O trecho PRECISA aparecer dentro daquela consulta -- nao em qualquer lugar. */
function exigidoNaConsulta(caminho, tabela, trecho, porque) {
  if (!consultaDe(caminho, tabela).includes(trecho)) {
    problemas.push(
      `${caminho}: ${porque}\n    faltando na consulta a \`${tabela}\`: ${trecho}`
    );
  }
}

/** O trecho NAO pode aparecer dentro daquela consulta. */
function proibidoNaConsulta(caminho, tabela, trecho, porque) {
  if (consultaDe(caminho, tabela).includes(trecho)) {
    problemas.push(
      `${caminho}: ${porque}\n    encontrado na consulta a \`${tabela}\`: ${trecho}`
    );
  }
}

// ---------------------------------------------------------------------------
// 1. O card da lista le a FATURA, nao o saldo do cartao
// ---------------------------------------------------------------------------
proibido(
  CARD_DA_LISTA,
  "current_balance",
  'o card imprime o rotulo "Fatura" -- `current_balance` ali e a divida ' +
    "INTEIRA do cartao, com as parcelas futuras que o trigger somou no INSERT"
);
exigido(
  CARD_DA_LISTA,
  "totalDaFatura(fatura)",
  "o numero do card tem que sair da fatura (lib/fatura-do-periodo)"
);
exigido(
  CARD_DA_LISTA,
  "parcelasFuturasDaFatura(fatura, conta.id)",
  "sem a linha das parcelas futuras a troca vira um numero menor, e os " +
    "R$ 2.700 das parcelas seguintes nao aparecem em tela de cartao nenhuma"
);
exigido(
  CARD_DA_LISTA,
  "podeMostrarNumero(estado)",
  "este card abre sem rede: todo numero passa pelo pedagio do zero confiante"
);
exigido(
  CARD_DA_LISTA,
  "rotuloDoMes",
  "um numero de fatura exige dizer de QUAL fatura ele e -- painel sem eixo " +
    "de tempo mente no rotulo"
);

// ---------------------------------------------------------------------------
// 2. A tela de cartoes soma FATURAS, e faz a segunda leitura
// ---------------------------------------------------------------------------
proibido(
  TELA_DE_CARTOES,
  "totalDoEscopo",
  'o total da tela tem o rotulo "Faturas" -- `totalDoEscopo(.., "cartao")` e ' +
    "`Σ abs(current_balance)`, a divida inteira de cada cartao. A funcao em si " +
    "esta certa e NAO deve ser mexida: quem muda e o chamador"
);
proibido(
  TELA_DE_CARTOES,
  "current_balance",
  "mesma razao: o rotulo desta tela promete fatura"
);
exigido(
  TELA_DE_CARTOES,
  "/api/card-invoices?month=",
  "em que fatura cada compra cai e decidido pela view `card_invoice_lines` " +
    "(migration 006) e agregado por esta rota. Uma segunda copia daquela regra " +
    "em TypeScript faria a tela e o relatorio discordarem sobre o mesmo cartao"
);
exigido(
  TELA_DE_CARTOES,
  "somaDasFaturas(faturas,",
  "o total da tela tem que ser a soma das faturas, e ela recusa soma parcial"
);
exigido(
  TELA_DE_CARTOES,
  "estadoDaTela([",
  "a tela faz DUAS leituras (cadastro e faturas): sem reduzir as duas a mais " +
    'pessimista, o cadastro fresco libera "R$ 0,00" de uma fatura que nao ' +
    "carregou, embaixo do nome do cartao certo"
);
exigido(
  TELA_DE_CARTOES,
  "faturaDoCartao(faturas,",
  "a fatura de cada card casa por `account_id`, nunca pela posicao na lista: " +
    "com `[0]` a lista mostra o total do primeiro cartao embaixo do nome de todos"
);

// ---------------------------------------------------------------------------
// 3. Ninguem reescreve a aritmetica da fatura em TypeScript
// ---------------------------------------------------------------------------
// `card_invoice_month` e a regra de "em que fatura esta compra cai", e ela mora
// na migration 006. Uma funcao com esse nome do lado do app seria a segunda
// copia -- e as duas discordariam na primeira mudanca de dia de fechamento.
for (const caminho of [CARD_DA_LISTA, TELA_DE_CARTOES, LIB_DO_PERIODO]) {
  proibido(
    caminho,
    "closing_day",
    "decidir o mes da fatura a partir do dia de fechamento e recalcular, no " +
      "app, a regra que a migration 006 ja publica em `card_invoice_month`"
  );
}

// ---------------------------------------------------------------------------
// 4. O "posso gastar" separa o que este mes cobra (armadilha 10)
// ---------------------------------------------------------------------------
exigido(
  LIB_DO_POSSO_GASTAR,
  "entrada.faturas",
  "sem consumir as faturas, o calculo volta a descontar a divida INTEIRA do " +
    "cartao: R$ 3.000 de uma compra em 10x no mes da compra"
);
exigido(
  LIB_DO_POSSO_GASTAR,
  "ehFatura(p.notes)",
  "a conta prevista da fatura fechada continua FORA de `compromissos`: ela ja " +
    "esta dentro do saldo do cartao, que segue sendo a ancora do desconto. " +
    "Reintroduzi-la aqui e o desconto duplo da armadilha 1 de volta"
);
exigido(
  ROTA_DO_POSSO_GASTAR,
  '.from("card_invoice_lines")',
  "a parte diferida da divida sai da view, e nao de uma conta nova no app"
);
exigido(
  ROTA_DO_POSSO_GASTAR,
  "faturas:",
  "a rota tem que PASSAR as faturas para o calculo -- o campo e obrigatorio " +
    "no tipo, mas `?? []` no calculo faz a omissao virar um numero menor e " +
    "plausivel em vez de um erro"
);
exigido(
  ROTA_DO_POSSO_GASTAR,
  "diferido_indisponivel",
  "quando a leitura das faturas falha a divida inteira volta a ser " +
    'descontada, e a tela nao pode escrever "R$ 0,00 depois" por cima de um ' +
    "desconto que nao separou nada"
);

// ---------------------------------------------------------------------------
// 5. O "posso gastar" desconta a MINHA PARTE da conta de grupo (HMO-306)
// ---------------------------------------------------------------------------
// A quarta leitura do «Total de contas», e a ultima a ser ligada. A medicao de
// scripts/medicao-hmo298.mjs prova a CONTA -- ela importa
// `parteConfiguradaDoMembro` de lib/ e monta os insumos como a rota monta. O que
// ela nao alcanca e a FIACAO: se esta rota parar de chamar a funcao, a medicao
// continua verde, porque quem chamou foi o script.
//
// E a fiacao aqui tem TRES pecas, e cada uma falha em silencio:
//
//   * sem `group_id` no `select`, `p.group_id` e `undefined` e
//     `parteConfiguradaDoMembro` devolve o valor CHEIO -- a chamada fica no
//     lugar, sem erro de tipo (o campo e opcional na assinatura) e sem log;
//   * sem a consulta a `group_members` o mapa de pesos sai vazio, e o
//     "desconhecido" da funcao devolve o valor CHEIO pela mesma porta;
//   * sem a CHAMADA, nada divide.
//
// As tres reintroduzem o defeito da HMO-306 com o numero menor e plausivel --
// R$ 1.000,00 descontados de um grupo que cobra R$ 300,00 -- e nenhuma delas
// aparece no `tsc`.
//
// `percentage` ESTA NA EXIGENCIA DO `select` de proposito: sem a coluna, o grupo
// 70/30 volta a dividir IGUAL (`montarParticipantesPorGrupo` le `?? 0`, e com
// todos os pesos em zero `ratearPorPeso` cai no degrau da divisao igual). Esse e
// o caso que NAO da valor cheio e por isso nao salta aos olhos: ele da
// R$ 500,00 onde o grupo cobra R$ 300,00.
exigido(
  ROTA_DO_POSSO_GASTAR,
  "parteConfiguradaDoMembro(",
  "a conta de grupo tem que entrar pela MINHA parte. Sem a chamada, a linha " +
    "de R$ 1.000,00 de um grupo que me cobra R$ 300,00 e descontada cheia e o " +
    "app subestima em R$ 700,00 quanto se pode gastar (HMO-306)"
);
exigidoNaConsulta(
  ROTA_DO_POSSO_GASTAR,
  AGENDA_DO_POSSO_GASTAR,
  "group_id",
  "o `select` das previstas tem que trazer `group_id`. Sem ele a chamada acima " +
    "recebe `undefined` e devolve o valor CHEIO -- a fiacao parece intacta e " +
    "nao divide nada"
);
exigidoNaConsulta(
  ROTA_DO_POSSO_GASTAR,
  "group_members",
  "percentage",
  "sem a coluna, `montarParticipantesPorGrupo` le peso 0 para todo mundo e " +
    "`ratearPorPeso` divide IGUAL: R$ 500,00 onde o grupo 70/30 cobra " +
    "R$ 300,00 -- errado sem parecer errado. E sem a consulta inteira o mapa " +
    "sai vazio e o `desconhecido` devolve o valor cheio pela mesma porta"
);
// AS DUAS METADES DO RECORTE POR DONO, e as duas sao necessarias: exigir o
// `.eq` sem proibir o `.or` deixaria passar uma consulta que filtra por dono E
// traz a linha de grupo de todo mundo, que e a forma da tela de Despesas.
exigidoNaConsulta(
  ROTA_DO_POSSO_GASTAR,
  AGENDA_DO_POSSO_GASTAR,
  '.eq("user_id", user.id)',
  "o recorte por dono e o que mantem a conta do outro membro fora desta " +
    "leitura -- a face (d) do outro membro vale R$ 0,00 aqui, e isso e " +
    "afirmacao e nao omissao"
);
proibidoNaConsulta(
  ROTA_DO_POSSO_GASTAR,
  AGENDA_DO_POSSO_GASTAR,
  ".or(",
  "o filtro de `user_id` NAO muda aqui, e esta e a diferenca deliberada para a " +
    "tela de Despesas (HMO-303): a pergunta e quanto EU posso gastar, e a parte " +
    "do outro membro ja e descontada da carteira DELE. Um `.or(...)` que " +
    "trouxesse `group_id.not.is.null` descontaria o mesmo dinheiro duas vezes, " +
    "uma em cada carteira"
);

// ---------------------------------------------------------------------------
// 6. A DIRECAO SAI DA VIEW, E NAO DO TIPO DA REGRA (HMO-308)
// ---------------------------------------------------------------------------
// O defeito: a rota lia a TABELA `scheduled_transactions`, que nao tem
// `direction` (a coluna nasceu na migration 027, na view), e deduzia a direcao
// do `transaction_type` da REGRA recorrente. Previsao AVULSA nao tem regra --
// entao TODA previsao avulsa caia em `expense`, inclusive a de receita, que
// /api/scheduled-transactions aceita desde a HMO-188.
//
// E O ERRO ERA DUPLO, porque `tipo` decide AS DUAS somas de
// `calcularQuantoPossoGastar`: a receita marcada como despesa SOMAVA em
// `compromissos` E DEIXAVA de somar em `receitasPrevistas`. No fixture da
// medicao, R$ 6.200,00 de salario e aluguel recebido contados como contas a
// pagar: «A pagar» R$ 7.800,00 onde as despesas de verdade sao R$ 1.600,00, e
// «A receber» R$ 0,00.
//
// NADA DISSO APARECE NO `tsc`. `.from("scheduled_transactions")` e
// `.from("scheduled_transactions_effective")` sao as duas strings, e o retorno
// do PostgREST e tipado pelo `select` em `any` na pratica. A rota compila, nao
// loga, e devolve um numero MENOR -- o lado que parece conservador e por isso
// nao e conferido.
exigido(
  ROTA_DO_POSSO_GASTAR,
  `.from("${AGENDA_DO_POSSO_GASTAR}")`,
  "a agenda tem que vir da VIEW: ela e o unico lugar com a direcao resolvida " +
    "(migration 027, `COALESCE(ocorrencia, regra, 'expense')`)"
);
// AS DUAS METADES, e as duas sao necessarias: exigir a view sem PROIBIR a
// tabela deixaria passar uma rota que acrescentasse uma segunda consulta a
// tabela e voltasse a deduzir a direcao dali -- e `consultaDe` casa com a
// PRIMEIRA `.from(...)`, entao qual das duas ele mediria dependeria da ordem em
// que elas aparecem no arquivo.
proibido(
  ROTA_DO_POSSO_GASTAR,
  '.from("scheduled_transactions")',
  "a TABELA nao tem `direction`, e quem a le precisa deduzir a direcao. A " +
    "deducao pelo tipo da REGRA e o defeito da HMO-308: previsao avulsa nao " +
    "tem regra, e R$ 6.200,00 de receita viram conta a pagar"
);
exigidoNaConsulta(
  ROTA_DO_POSSO_GASTAR,
  AGENDA_DO_POSSO_GASTAR,
  "direction",
  "o `select` das previstas tem que trazer `direction`. Sem a coluna, " +
    "`p.direction` e `undefined`, `direcaoDaAgenda` manda TODA linha para " +
    "despesa, e o defeito volta inteiro -- com a rota lendo a view certa"
);
// A CHAMADA, e nao o nome. `direcaoDaAgenda` sozinho casaria com a linha do
// `import`, e a verificacao aprovaria um arquivo que importa a funcao e escreve
// o ternario a mao logo abaixo -- que e a segunda copia da precedencia, e a
// copia esquecida e este defeito (ja pago uma vez na HMO-187).
exigido(
  ROTA_DO_POSSO_GASTAR,
  "direcaoDaAgenda(p.direction)",
  "a direcao de cada linha tem que passar pela funcao de lib/, que e a UNICA " +
    "copia da pergunta de caixa -- e e ela que manda `transfer` para o lado de " +
    "SAIDA, porque R$ 500,00 que vao para a poupanca saem da conta de verdade"
);
proibido(
  ROTA_DO_POSSO_GASTAR,
  "transaction_type",
  "esta rota nao le `transaction_type`, nem da ocorrencia nem da regra. A " +
    "coluna e NULA em parte da base instalada, e o `COALESCE` que termina em " +
    "'expense' mora na view: refaze-lo aqui e a segunda copia da precedencia"
);
// A TRANSFERENCIA E UMA DECISAO A PARTE, E NAO MUDA JUNTO. `classeDaAgenda`
// responde "isto e conta a pagar?" -- a pergunta do «Total de contas» do modo
// Papel de Pao, que tira a transferencia. A pergunta DESTA rota e caixa, e
// R$ 500,00 guardados na poupanca saem da conta. Trocar uma pela outra nao da
// erro de tipo (as duas recebem `string | null`) e nao da sintoma: o "posso
// gastar" simplesmente sobe R$ 500,00.
proibido(
  ROTA_DO_POSSO_GASTAR,
  "classeDaAgenda",
  "a pergunta desta rota e CAIXA, e por isso ela chama `direcaoDaAgenda`. " +
    "`classeDaAgenda` tiraria a transferencia do desconto, e o `safeEsperado` " +
    "da face (a) da medicao (R$ 500,00) existe para cobrar isso"
);
exigido(
  ROTA_DO_POSSO_GASTAR,
  "direcao_indisponivel",
  "sem `direction` o numero continua sendo o conservador (tudo como despesa), " +
    'e por isso a tela nao pode escrever "+ R$ 0,00 · Receitas previstas" ' +
    "embaixo de um «A pagar» que somou justamente o salario"
);

// ---------------------------------------------------------------------------
if (problemas.length > 0) {
  console.error(
    "A fiacao do numero de cartao, da parte do grupo ou da DIRECAO esta " +
      "desligada (HMO-290 / HMO-306 / HMO-308):\n"
  );
  for (const p of problemas) console.error(`  - ${p}\n`);
  console.error(
    "Ver o cabecalho de lib/fatura-do-periodo.ts, a armadilha 10 de\n" +
      "lib/safe-to-spend.ts, `parteConfiguradaDoMembro` em\n" +
      "lib/parte-do-grupo.ts e `direcaoDaAgenda` em\n" +
      "lib/previsto-x-realizado.ts. Se a mudanca for deliberada, a verificacao\n" +
      "e que tem que mudar -- junto com o rotulo que a tela mostra e com os\n" +
      "numeros digitados em scripts/medicao-hmo298.mjs."
  );
  process.exit(1);
}

console.log(
  "ok: o rotulo de fatura le fatura, as duas telas fazem a segunda leitura, o " +
    '"posso gastar" separa o que este mes cobra, desconta a MINHA parte da ' +
    "conta de grupo e tira a direcao da view -- nao do tipo da regra."
);
