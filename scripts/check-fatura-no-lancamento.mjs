#!/usr/bin/env node
// =====================================================
// A FATURA ESCOLHIDA ESTA LIGADA DE PONTA A PONTA? (HMO-281 / HMO-289)
// =====================================================
//   node scripts/check-fatura-no-lancamento.mjs
//
// O NOME TERMINA EM `-no-lancamento`, E NAO EM `-escolhida`, DE PROPOSITO.
// `scripts/check-fatura-escolhida.mjs` JA EXISTE e e de outra feature: a HMO-290
// pos lá o guard do ROTULO "Fatura atual" (que ele leia a fatura do periodo e
// nao o `current_balance`), e ele esta registrado como
// `npm run check-fatura-escolhida`. As duas PRs nasceram em paralelo e
// escolheram o mesmo nome de arquivo; isto aqui verifica a fiacao da fatura
// escolhida NO LANCAMENTO, que e outro assunto. Nao renomeie de volta: os dois
// guards medem coisas diferentes e os dois precisam rodar.
//
// POR QUE ISTO EXISTE, SE A REGRA JA TEM SUITE E MUTANTES
// -------------------------------------------------------
// Porque `test:lancamento` e `test:fatura-do-cartao` provam as REGRAS, e as
// regras podem estar perfeitas e nao estarem LIGADAS. O que sobra e fiacao, e a
// fiacao desta feature e muda nos quatro pontos:
//
//   * o formulario para de mandar `invoice_month_override` no insert -> o
//     lancamento grava, o toast diz sucesso, e a escolha nao existe no banco;
//   * ele manda no insert e nao no update -> a escolha grava na criacao e e
//     impossivel de corrigir, que e metade do pedido da issue;
//   * a fila offline nao carrega o campo -> o lancamento sem rede SINCRONIZA,
//     e ACEITO, e cai na fatura da data. Este nao tem sintoma nenhum;
//   * a rota de parcelas ignora o override na ancora -> a parcela 1 vai para a
//     fatura escolhida e as outras nove saem de outra, duas na mesma fatura e a
//     serie terminando um mes antes;
//   * o seletor sai da tela -> nao ha como escolher, e tudo acima continua
//     verde.
//
// NENHUM DESSES APARECE NO `tsc`. `invoice_month_override` entra num objeto
// literal que vai para `.insert()` / `.update()` do supabase-js (tipagem
// permissiva na fronteira), `mesDaFatura` no corpo de um `fetch` e `any` do
// outro lado, e um campo de JSX que deixa de ser renderizado nao e erro de tipo.
//
// DUAS COISAS SAO REMOVIDAS ANTES DA VARREDURA, E AS DUAS SAO LOAD-BEARING
// ------------------------------------------------------------------------
//   1. OS COMENTARIOS. Os arquivos desta feature EXPLICAM a regra em prosa, e a
//      prosa cita `invoice_month_override`, `mesDaFatura` e `mes_da_fatura` por
//      nome -- varias vezes. Varrendo o fonte cru, este guard passaria verde
//      lendo os proprios comentarios que descrevem o defeito, e continuaria
//      verde depois de alguem apagar o codigo e deixar o comentario.
//
//   2. AS DECLARACOES DE `import`. Um guard que aceita o nome em qualquer lugar
//      mede se a dependencia foi DECLARADA, nao se ela e USADA: trocar
//      `janelaDeFaturas(padrao, escolhido)` por `[]` deixa a chamada morta e o
//      `import` intacto, e o nome continua "aparecendo".
//
// E por isso que cada nome de funcao na lista abaixo vem com o `(`: o alvo e a
// chamada, nao a mencao. Os dois recortes sao os mesmos de
// scripts/check-cartao-pela-fatura.mjs, pela mesma razao.
// =====================================================

import { readFileSync } from "node:fs";
import { semComentarios } from "./varredura-de-fonte.mjs";

/** O fonte sem comentario e sem a lista de imports. Ver o cabecalho. */
function semComentariosNemImports(fonte) {
  return semComentarios(fonte).replace(
    /^\s*import\s[\s\S]*?from\s*["'][^"']*["'];?\s*$/gm,
    ""
  );
}

const EXIGENCIAS = [
  {
    arquivo: "components/movimentacoes/CamposDeLancamento.tsx",
    trechos: [
      "campos.faturaDoLancamento",
      "janelaDeFaturas(",
      "rotuloDaFatura(",
      "mesDaFatura: e.target.value",
    ],
    porque:
      "o seletor precisa EXISTIR, aparecer pelo oraculo (`campos.faturaDoLancamento`), " +
      "listar a janela e DEVOLVER a escolha. Sem o `onChange` ele e um seletor " +
      "que nao muda nada -- a pessoa clica, o rotulo troca e o estado fica igual.",
  },
  {
    arquivo: "components/movimentacoes/FormularioDeLancamento.tsx",
    trechos: [
      "faturaPadraoDoLancamento(",
      // COM OS DOIS PONTOS, e isso nao e detalhe de estilo -- foi um mutante.
      //
      // `invoice_month_override` sozinho casa com a LEITURA
      // (`mesDaFatura: linha.invoice_month_override`, o caminho que carrega uma
      // compra para edicao), que fica no arquivo mesmo depois de alguem apagar
      // a ESCRITA. Medido: o mutante `insert_sem_o_campo` apaga o campo do
      // objeto `linha` -- a escolha para de gravar -- e o guard ficava verde,
      // porque o nome continuava "aparecendo" trinta linhas acima.
      //
      // Os dois pontos so aparecem onde o nome e CHAVE de um objeto que vai
      // para o banco. E a mesma regra do `(` nos nomes de funcao: o alvo e o
      // uso, nao a mencao.
      "invoice_month_override:",
      "mes_da_fatura:",
      "mesDaFatura: valores.mesDaFatura",
      "mesPadraoDaFatura=",
    ],
    porque:
      "os TRES escritores da tela: o insert/update (`invoice_month_override`), a " +
      "rota de parcelas (`mes_da_fatura`) e a fila offline (`mesDaFatura`). E o " +
      "padrao tem de ser CALCULADO e PASSADO -- sem `mesPadraoDaFatura` a janela " +
      "do seletor nasce vazia.",
  },
  {
    arquivo: "lib/offline-queue.ts",
    trechos: ["invoice_month_override: faturaDaEntrada(", "entrada.mesDaFatura"],
    porque:
      "O ESCRITOR MUDO. Sem o campo na linha, o lancamento sem rede sincroniza, " +
      "e aceito, e cai na fatura da data -- sem erro, sem item `falhou` e sem " +
      "nada na tela. A exigencia e a ATRIBUICAO inteira: `invoice_month_override: " +
      "null` tambem compila e tambem perde a escolha.",
  },
  {
    arquivo: "app/api/financial-installments/route.ts",
    trechos: [
      "mesDaFaturaDoPedido(",
      "mesAncora = faturaEscolhida",
      "invoice_month_override: i === 0 ? faturaEscolhida : null",
    ],
    porque:
      "a rota tem de LER a escolha e usa-la como ANCORA. Carimbando o override " +
      "so na parcela 1 sem mover a ancora, as outras nove sao contadas da fatura " +
      "da data: a 2a cai junto da 1a e a serie termina um mes antes.",
  },
];

let falhas = 0;

for (const { arquivo, trechos, porque } of EXIGENCIAS) {
  const fonte = semComentariosNemImports(readFileSync(arquivo, "utf8"));

  for (const trecho of trechos) {
    if (fonte.includes(trecho)) continue;
    console.error(`FALTA  ${arquivo}`);
    console.error(`       não cita \`${trecho}\` fora de comentário`);
    console.error(`       ${porque}`);
    falhas++;
  }
}

// -------------------------------------------------------------------------
// CONTRAPESO 1: O CAMPO TEM DE IR NO UPDATE, E NAO SO NO INSERT
// -------------------------------------------------------------------------
// A exigencia acima e satisfeita por um `invoice_month_override` posto DENTRO do
// ramo do insert -- e e esse o esquecimento mais provavel, porque o insert e o
// caminho que a pessoa testa. O que faz o campo valer nos dois e ele estar no
// objeto `linha`, que `update(linha)` reusa.
//
// Medido pela POSICAO: o campo tem de aparecer antes do `let transacao`, que e
// onde `linha` termina e os dois ramos comecam.
const formulario = semComentariosNemImports(
  readFileSync("components/movimentacoes/FormularioDeLancamento.tsx", "utf8")
);

// `invoice_month_override:` e nao `invoice_month_override`: ver a exigencia la
// em cima. Sem os dois pontos, esta posicao e a da LEITURA (linha ~566), que
// fica antes de `let transacao` de qualquer jeito -- o contrapeso media o
// caminho errado e passava sempre.
const posicaoDoCampo = formulario.indexOf("invoice_month_override:");
const posicaoDosRamos = formulario.indexOf("let transacao");

if (posicaoDoCampo === -1 || posicaoDosRamos === -1) {
  console.error("FALTA  components/movimentacoes/FormularioDeLancamento.tsx");
  console.error(
    "       não achei `invoice_month_override` ou a âncora `let transacao`: este contrapeso não tem como medir"
  );
  falhas++;
} else if (posicaoDoCampo > posicaoDosRamos) {
  console.error("FALTA  components/movimentacoes/FormularioDeLancamento.tsx");
  console.error(
    "       `invoice_month_override` está DEPOIS de `let transacao`: ele saiu do objeto `linha`"
  );
  console.error(
    "       Só dentro de `linha` o campo vale nos dois ramos. Fora dele, a escolha grava na criação e a edição não consegue corrigi-la — que é metade do pedido da HMO-281."
  );
  falhas++;
}

// -------------------------------------------------------------------------
// CONTRAPESO 2: `null` E NAO `undefined` NO QUE VAI PARA A COLUNA
// -------------------------------------------------------------------------
// O supabase-js OMITE a chave `undefined` do corpo, e coluna omitida num UPDATE
// fica como esta. Com `undefined`, quem tirasse a escolha de uma compra
// (voltando o seletor para "pela data da compra") veria o toast de sucesso e a
// compra continuaria na fatura antiga. Este e um defeito de UMA PALAVRA, e ele
// nao aparece em nenhum teste de funcao pura.
// A REGRA PRECISA LER O VALOR INTEIRO, E UMA REGEX NAO LE.
//
// A primeira versao deste contrapeso era `/invoice_month_override:[^,;}]*undefined/`
// e nao media nada: o valor e um ternario de quatro linhas que contem
// `${valores.mesDaFatura}` -- a classe negada para no `}` da interpolacao,
// muito antes de chegar no `: undefined`. Medido pelo mutante
// `campo_sai_undefined`, que trocava `null` por `undefined` e passava verde.
//
// `valorDaChave` anda ate a virgula que fecha a propriedade, contando os
// delimitadores no caminho, e devolve o valor de verdade. E vinte linhas para
// uma pergunta de uma palavra -- e a pergunta vale: `undefined` aqui faz o
// supabase-js OMITIR a chave, e coluna omitida num UPDATE fica como esta.
/**
 * O valor de `chave:` num objeto literal: tudo ate a virgula que fecha a
 * propriedade, pulando o que estiver dentro de (), [], {} ou de uma string.
 */
function valorDaChave(fonte, chave) {
  const inicio = fonte.indexOf(chave);
  if (inicio === -1) return null;

  let i = inicio + chave.length;
  let profundidade = 0;
  let aspas = null;

  for (; i < fonte.length; i++) {
    const c = fonte[i];

    if (aspas) {
      if (c === "\\") i++;
      else if (c === aspas) aspas = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      aspas = c;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") profundidade++;
    else if (c === ")" || c === "]") profundidade--;
    else if (c === "}") {
      // O `}` que fecha o objeto que CONTEM a propriedade: a propriedade acabou
      // (ultima do objeto, sem virgula depois).
      if (profundidade === 0) break;
      profundidade--;
    } else if (c === "," && profundidade === 0) break;
  }

  return fonte.slice(inicio + chave.length, i);
}

const valorDoOverride = valorDaChave(formulario, "invoice_month_override:");

if (valorDoOverride === null) {
  // Ja reportado pela exigencia la em cima; aqui so nao da para medir.
} else if (/\bundefined\b/.test(valorDoOverride)) {
  console.error("FALTA  components/movimentacoes/FormularioDeLancamento.tsx");
  console.error(
    "       `invoice_month_override` pode sair `undefined`: o supabase-js omite a chave, e no UPDATE a coluna fica como está"
  );
  console.error(
    "       `null` é o que APAGA o override. Com `undefined`, desfazer uma escolha errada é impossível e a tela diz que deu certo."
  );
  falhas++;
}

// -------------------------------------------------------------------------
// CONTRAPESO 3: A DATA DA COMPRA NAO PODE VIRAR O MES DA FATURA
// -------------------------------------------------------------------------
// E a decisao central da issue ("indiferente da data que estou lancando") e o
// caminho que o plano RECUSOU: gravar dia 1 do mes escolhido em
// `transaction_date`. Ele resolveria a fatura e apagaria um fato -- quebraria
// `expected_date`/"pagou atrasado?" (027), moveria a despesa de mes em todo
// relatorio que agrupa por data, e mostraria a compra num dia em que ela nao
// aconteceu.
//
// A sonda e por FORMA porque o defeito tem uma forma reconhecivel: a data saindo
// do mes da fatura em vez de `valores.data`.
if (/transaction_date:\s*[^,\n]*mesDaFatura/.test(formulario)) {
  console.error("FALTA  components/movimentacoes/FormularioDeLancamento.tsx");
  console.error(
    "       `transaction_date` está sendo montado a partir de `mesDaFatura`"
  );
  console.error(
    "       A data da compra é um FATO e não muda. Mover a despesa de mês apaga o “pagou atrasado?” da 027 e muda o mês dela em todo relatório que agrupa por `transaction_date`."
  );
  falhas++;
}

if (!/transaction_date:\s*valores\.data/.test(formulario)) {
  console.error("FALTA  components/movimentacoes/FormularioDeLancamento.tsx");
  console.error(
    "       `transaction_date: valores.data` não está mais lá: a data da compra deixou de sair do campo de data"
  );
  falhas++;
}

if (falhas > 0) {
  console.error(
    `\n${falhas} ponto(s) da fiação da fatura escolhida está desligado (HMO-281 / HMO-289).`
  );
  process.exit(1);
}

console.log(
  "OK: a fatura escolhida está ligada nos quatro escritores e no seletor; o campo vale no update, sai `null` quando vazio, e `transaction_date` segue sendo a data da compra."
);
