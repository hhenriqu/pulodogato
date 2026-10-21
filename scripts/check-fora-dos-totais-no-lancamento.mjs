#!/usr/bin/env node
// =====================================================
// O FLAG "FORA DOS TOTAIS" ESTA LIGADO DE PONTA A PONTA? (HMO-452 / HMO-443)
// =====================================================
//   node scripts/check-fora-dos-totais-no-lancamento.mjs
//
// A coluna e `financial_transactions.include_in_total` (migration 060), e o
// pedido da issue-mae e literal: "escolher uma despesa e uma receita pra nao
// aparecer nos totais".
//
// POR QUE ISTO EXISTE, SE A FEATURE JA TEM SUITE E 12 MUTANTES
// ------------------------------------------------------------
// Porque `test:fora-dos-totais-no-lancamento` prova as DUAS ROTAS e
// `test:campos-lancamento` prova a CHECKBOX, e o formulario grava sem passar por
// nenhuma das duas: `gravarTransacao` escreve DIRETO pelo supabase-js
// (`.insert()` / `.update()` em `financial_transactions`). Entao a feature pode
// estar inteira -- rota estrita, checkbox desenhada, selo na lista, mutantes
// todos mortos -- e o Salvar do formulario descartar a escolha.
//
// Foi exatamente o estado em que esta branch estava quando este guard nasceu: a
// checkbox existia, `somaNosTotais` existia em `ValoresDeLancamento`, o JSDoc de
// `somaNosTotaisEstaNaTela` AFIRMAVA que "`gravarTransacao` chama esta mesma
// funcao antes de montar a linha" -- e o campo nao estava no objeto `linha`. A
// pessoa marcaria a checkbox, o toast diria sucesso, e o total do mes
// continuaria incluindo o ajuste.
//
// OS TRES MODOS DE FALHA, E NENHUM DELES APARECE NO `tsc`
// -------------------------------------------------------
//   * o campo sai do objeto `linha` -> o Salvar grava a linha, o toast diz
//     sucesso, e a coluna fica no DEFAULT (`true`): a escolha nao existe no
//     banco. O objeto vai para `.insert()` / `.update()` do supabase-js, cuja
//     tipagem na fronteira aceita o objeto sem a chave;
//
//   * o campo fica so no ramo do INSERT -> marcar funciona na criacao e e
//     impossivel de desfazer pelo formulario, que e metade do pedido. Este e o
//     esquecimento MAIS PROVAVEL, porque o insert e o caminho que a pessoa
//     testa a mao;
//
//   * a EDICAO nao recarrega o flag gravado -> `valoresIniciais()` da
//     `somaNosTotais: true`, entao editar o ajuste que a pessoa tirou dos totais
//     (para corrigir a descricao, a conta, qualquer coisa) o DEVOLVE aos
//     relatorios. Perda de dado em cada edicao, sem erro nenhum, num TOTAL. E a
//     mesma familia do `subcategoriaId` da HMO-216, que ja custou uma issue.
//
// COMENTARIOS E `import` SAO REMOVIDOS ANTES DA VARREDURA, E AQUI ISSO E
// LOAD-BEARING DE VERDADE
// ---------------------------------------------------------------------
// Os arquivos desta feature explicam a regra em prosa, e a prosa cita
// `include_in_total`, `somaNosTotais` e `somaNosTotaisEstaNaTela` por nome --
// dezenas de vezes, em paragrafos inteiros. Varrendo o fonte cru, este guard
// passaria verde lendo os PROPRIOS COMENTARIOS que descrevem o defeito, e
// continuaria verde depois de alguem apagar o codigo e deixar o comentario.
// Mesma razao e mesmo recorte de scripts/check-fatura-no-lancamento.mjs.
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

const FORMULARIO = "components/movimentacoes/FormularioDeLancamento.tsx";

const EXIGENCIAS = [
  {
    arquivo: "components/movimentacoes/CamposDeLancamento.tsx",
    trechos: [
      // O PORTAO, COM O `(`: o alvo e a CHAMADA, nao a mencao. Sem ele a
      // checkbox apareceria na previsao, na fixa e na serie de parcelas -- tres
      // destinos que nao escrevem nesta coluna --, e marcar la seria uma
      // promessa descartada em silencio, com toast de sucesso.
      "somaNosTotaisEstaNaTela(",
      // A INVERSAO DO RENDER. O estado e POSITIVO (como a coluna) e o rotulo e
      // NEGATIVO (o pedido literal da issue-mae). Sem o `!`, quem tirou a linha
      // dos totais reabre o formulario com a checkbox DESMARCADA, lendo que a
      // linha soma quando ela nao soma.
      "checked={!valores.somaNosTotais}",
      // A INVERSAO DA ESCRITA, que e a metade que mexe em dinheiro. Um
      // `somaNosTotais: e.target.checked` compila igual e grava o OPOSTO do que
      // a pessoa marcou -- visivel so no total do mes seguinte.
      "somaNosTotais: !e.target.checked",
      // A FRASE QUE DIZ O QUE O FLAG **NAO** FAZ, pela CONSTANTE e nao por uma
      // copia: a linha desmarcada continua no saldo da conta e no patrimonio de
      // proposito, e sem a frase isso e indistinguivel de um bug (a pessoa ve o
      // saldo incluindo o ajuste ao lado de um total que nao o inclui, as duas
      // leituras certas e nenhum numero explicando a diferenca).
      "AVISO_DO_FLAG_DOS_TOTAIS",
    ],
    porque:
      "a checkbox precisa aparecer SO onde a coluna existe (`somaNosTotaisEstaNaTela`), " +
      "inverter nos DOIS sentidos (o `checked` e o `onChange`) e dizer o que o flag " +
      "nao faz. Falta a inversao de um lado e o formulario grava o oposto do que " +
      "a pessoa marcou; falta a frase e a feature se le como bug.",
  },
  {
    arquivo: FORMULARIO,
    trechos: [
      // COM OS DOIS PONTOS, e isto nao e estilo -- e a licao medida da
      // HMO-289 no guard irmao. `include_in_total` sozinho casa com a LEITURA
      // (`linha.include_in_total`, o caminho que carrega a transacao para
      // edicao), que fica no arquivo mesmo depois de alguem apagar a ESCRITA.
      // Os dois pontos so aparecem onde o nome e CHAVE de um objeto que vai
      // para o banco.
      "include_in_total:",
      // O MESMO PORTAO DA TELA, chamado de novo na hora de montar o corpo.
      // Esconder a checkbox NAO e trava: o estado do formulario e um objeto so,
      // e `somaNosTotais: false` SOBREVIVE a troca de natureza. Quem desmarcasse
      // numa despesa e depois a mudasse para "Fixa" levaria o `false` para uma
      // tabela que nao tem a coluna.
      "somaNosTotaisEstaNaTela(",
      // A EDICAO RECARREGA O FLAG GRAVADO -- o terceiro modo de falha do
      // cabecalho. `!== false` e nao `Boolean(...)`: a coluna e anulavel e a
      // linha pode chegar sem a chave (cache offline, linhas antigas da 060).
      // NULL e ausente querem dizer "soma", e e para isso que a polaridade da
      // coluna e POSITIVA (`coluna-booleana-anulavel-not-is-false`).
      "somaNosTotais: linha.include_in_total !== false",
    ],
    porque:
      "o formulario grava DIRETO pelo supabase-js, sem passar pelas rotas que a " +
      "suite cobre. O campo tem de estar no objeto que vai para o banco, com o " +
      "portao na frente, e a EDICAO tem de recarregar o que esta gravado -- senao " +
      "corrigir a descricao de um ajuste o devolve aos totais.",
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
// CONTRAPESO: O CAMPO TEM DE IR NO UPDATE, E NAO SO NO INSERT
// -------------------------------------------------------------------------
// A exigencia `include_in_total:` acima e satisfeita por um campo posto DENTRO
// do ramo do insert -- e e esse o esquecimento mais provavel, porque o insert e
// o caminho que a pessoa testa a mao. O que faz o campo valer nos DOIS e ele
// estar no objeto `linha`, que o ramo da edicao reusa (via `linhaParaEditar`).
//
// Sem os dois, marcar funciona na criacao e e impossivel de desfazer pelo
// formulario: quem tirou a linha dos totais por engano nao a traz de volta.
//
// Medido pela POSICAO, como no guard irmao: o campo tem de aparecer antes do
// `let transacao`, que e onde o objeto `linha` termina e os dois ramos comecam.
const formulario = semComentariosNemImports(readFileSync(FORMULARIO, "utf8"));

const posicaoDoCampo = formulario.indexOf("include_in_total:");
const posicaoDosRamos = formulario.indexOf("let transacao");

if (posicaoDoCampo === -1 || posicaoDosRamos === -1) {
  // As DUAS ancoras medidas, e nao so a do campo. `let transacao` e codigo de
  // outra pessoa: o dia em que ele for renomeado, `indexOf` devolve -1 e a
  // comparacao `-1 < posicao` ficaria VERDE por acidente -- o contrapeso
  // morreria calado, que e o pior jeito de um guard terminar
  // (`migration-aditiva-mata-sonda-de-guard`).
  console.error(`FALTA  ${FORMULARIO}`);
  console.error(
    "       as âncoras do contrapeso não estão no arquivo " +
      `(include_in_total: ${posicaoDoCampo}, let transacao: ${posicaoDosRamos})`
  );
  console.error(
    "       sem as duas não há como medir se o campo vale na EDIÇÃO; " +
      "conserte o guard em vez de deixá-lo passar vazio"
  );
  falhas++;
} else if (posicaoDoCampo > posicaoDosRamos) {
  console.error(`FALTA  ${FORMULARIO}`);
  console.error(
    "       `include_in_total:` aparece DEPOIS de `let transacao` -- " +
      "ele está dentro de um dos ramos, não no objeto `linha`"
  );
  console.error(
    "       marcar funcionaria na criação e seria impossível desfazer pelo " +
      "formulário: quem tirou a linha dos totais por engano não a traz de volta"
  );
  falhas++;
}

if (falhas > 0) {
  console.error(`\n${falhas} exigência(s) não atendida(s).`);
  process.exit(1);
}

console.log(
  "o flag «fora dos totais» está ligado: checkbox com as duas inversões, " +
    "portão no corpo, campo no objeto `linha` (vale na edição) e o flag " +
    "gravado volta para a tela."
);
