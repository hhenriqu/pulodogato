#!/usr/bin/env node
// =====================================================
// PULODOGATO - O ROTULO DE FATURA LE FATURA, E NAO `current_balance` (HMO-290)
// =====================================================
//   npm run check-fatura-escolhida
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
if (problemas.length > 0) {
  console.error(
    "O rotulo de fatura voltou a ler a coluna errada (HMO-290):\n"
  );
  for (const p of problemas) console.error(`  - ${p}\n`);
  console.error(
    "Ver o cabecalho de lib/fatura-do-periodo.ts e a armadilha 10 de\n" +
      "lib/safe-to-spend.ts. Se a mudanca for deliberada, a verificacao e que\n" +
      "tem que mudar -- junto com o rotulo que a tela mostra."
  );
  process.exit(1);
}

console.log(
  "ok: o rotulo de fatura le fatura, as duas telas fazem a segunda leitura e o " +
    '"posso gastar" separa o que este mes cobra.'
);
