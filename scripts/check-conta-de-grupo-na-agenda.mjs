#!/usr/bin/env node
// =====================================================
// O DESPACHO DA CONTA DE GRUPO EM CONTAS A PAGAR (HMO-411)
// =====================================================
//   npm run check-conta-de-grupo-na-agenda
//
// POR QUE UM GUARD TEXTUAL, E NAO MAIS UMA ASSERCAO DE COMPONENTE
// --------------------------------------------------------------
// O que esta issue conserta nao esta dentro de nenhum componente: e a
// COMPOSICAO da pagina. A conta de grupo que OUTRO membro criou aparece em
// `/dashboard/bills` com os quatro botoes da agenda, e os quatro falham
// calados nela -- «dar baixa» responde 404 "Conta prevista nao encontrada"
// (a rota `../pay` filtra `user_id`), «alterar» e «pular» voltam 200 SEM
// ALTERAR NADA (UPDATE recusado pela RLS nao e erro: a policy some a linha),
// e o comprovante se penduraria na conta prevista de outra pessoa.
//
// `scripts/test-conta-de-grupo-na-tela.mjs` monta a LINHA nova e mede o gesto;
// o que falta entre as duas e a tela ESCOLHER aquela linha. Uma pagina de
// 1.600 linhas nao se monta numa sonda de navegador, e o fato e textual. E a
// mesma divisao de trabalho que a HMO-386 fez nesta mesma tela, pelo mesmo
// motivo -- ver scripts/check-linha-do-mybank-na-agenda.mjs.
//
// TUDO AQUI RODA SOBRE O FONTE SEM COMENTARIO E SEM IMPORT, e isso nao e
// detalhe: os arquivos EXPLICAM esta decisao em comentario e CITAM os nomes
// que o guard procura. Com os comentarios dentro, apagar o galho deixaria o
// guard verde pela prosa que explica o galho -- a familia
// `assercao-sobre-codigo-fonte-le-o-comentario`. E o import sozinho tambem nao
// prova nada: `guard-de-fiacao-casa-com-o-import` -- o `tsc` nao reclama de
// componente importado e nao usado em arquivo de app.
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

const CONTAS_A_PAGAR = "app/(dashboard)/dashboard/bills/page.tsx";
const TELA_DO_GRUPO = "app/(dashboard)/dashboard/expense-groups/[groupId]/page.tsx";
const ROTA_DA_AGENDA = "app/api/scheduled-transactions/route.ts";

const EXIGE = [
  {
    arquivo: CONTAS_A_PAGAR,
    trechos: [
      // O GALHO, e nao o nome solto: `ehContaDeGrupoDeOutro` importado e nao
      // chamado deixa a conta do grupo caindo no desenho comum da agenda --
      // que e exatamente o defeito desta issue.
      "ehContaDeGrupoDeOutro(conta, meuUserId) ? (",
      "<LinhaDaContaDoGrupo",
      // A RECARGA. A linha muda de rotulo quando o `reported` grava, e quem
      // sabe reler a agenda e a tela.
      "aoAvisar={carregar}",
      // QUEM ESTA OLHANDO. Sem este estado a regra nao tem com o que comparar
      // o dono da linha, e `ehContaDeGrupoDeOutro` devolve `false` para tudo:
      // a tela inteira volta a ser a de antes, sem erro nenhum.
      "setMeuUserId(agenda.dados.meu_user_id ?? null)",
      // A TARJA DE ATRASO. `effective_status` sozinho e o do DONO: a conta de
      // grupo que ele ja pagou apareceria "em dia" para quem ainda deve.
      "conta.my_effective_status ?? conta.effective_status",
    ],
    porque:
      "Contas a Pagar tem de desenhar a conta de grupo de outro dono pela linha propria. Sem o galho ela cai no desenho comum da agenda, e os quatro botoes de la falham calados: a baixa responde 404 (a rota filtra `user_id`), alterar e pular voltam 200 sem alterar nada (UPDATE recusado pela RLS nao e erro), e o comprovante se pendura na conta prevista de outra pessoa.",
  },
  {
    arquivo: ROTA_DA_AGENDA,
    trechos: [
      // SEM ISTO A TELA NAO SABE DE QUEM E CADA LINHA. O campo e o unico
      // caminho: a pagina e client component e nao tem sessao.
      "meu_user_id: user.id",
    ],
    porque:
      "a tela precisa saber quem esta olhando para escolher o desenho da linha. Sem o campo, `ehContaDeGrupoDeOutro` recebe `null` e devolve `false` para toda linha -- a conta de grupo volta a receber os quatro botoes, e nada fica vermelho.",
  },
  {
    arquivo: TELA_DO_GRUPO,
    trechos: [
      // O LEITOR DO `reported`. Sem ele o estado que o membro grava e dado sem
      // leitor, que nesta base e o mesmo que nao existir.
      "item.estado_por_membro.map(",
      "FRASE_DO_ESTADO[membro.estado]",
      // A HONESTIDADE DA LISTA CURTA. Quem nao criou a conta so enxerga a
      // propria linha de pagamento (policy de SELECT da 055), e sem esta
      // frase "so nos dois no grupo" e "nao posso ver os outros" sao a mesma
      // lista.
      "{SO_O_DONO_VE_O_QUADRO}",
    ],
    porque:
      "o `reported` precisa de leitor. Sem o quadro por membro, o gesto do membro grava um estado que nenhuma tela mostra -- a feature passa verde com ninguem vendo nada.",
  },
];

/**
 * O QUE NAO PODE ESTAR LA.
 *
 * A conta de grupo de outro dono NAO pode cair no `pedirBaixa`, que monta
 * `POST /api/scheduled-transactions/{id}/pay` -- a rota que responde 404 para
 * quem nao e o dono, e o sintoma que abriu esta issue.
 */
const PROIBE = [
  {
    arquivo: "components/grupos/LinhaDaContaDoGrupo.tsx",
    trechos: ["/pay", "pedirBaixa", "pedirEdicao", "pedirExclusao"],
    porque:
      "a linha da conta de grupo tem UM gesto, e ele e `minha-baixa`. Qualquer um dos quatro da agenda aqui e o defeito desta issue de volta -- e nenhum deles da erro visivel: a baixa responde 404 e as outras duas respondem 200 sem fazer nada.",
  },
];

let falhas = 0;

for (const { arquivo, trechos, porque } of EXIGE) {
  const fonte = semComentariosNemImports(readFileSync(arquivo, "utf8"));
  for (const trecho of trechos) {
    if (!fonte.includes(trecho)) {
      falhas += 1;
      console.error(`\n✖ ${arquivo}\n  falta: ${trecho}\n  porque: ${porque}`);
    }
  }
}

for (const { arquivo, trechos, porque } of PROIBE) {
  const fonte = semComentariosNemImports(readFileSync(arquivo, "utf8"));
  for (const trecho of trechos) {
    if (fonte.includes(trecho)) {
      falhas += 1;
      console.error(`\n✖ ${arquivo}\n  nao pode ter: ${trecho}\n  porque: ${porque}`);
    }
  }
}

// O CONTROLE DO PROPRIO GUARD. Um `semComentariosNemImports` que apagasse
// demais deixaria TODA exigencia falhando -- e um que apagasse de menos
// deixaria todas passando pela prosa. A contagem minima prova que sobrou
// codigo para medir.
const corpoDaTela = semComentariosNemImports(readFileSync(CONTAS_A_PAGAR, "utf8"));
if (corpoDaTela.length < 5000) {
  falhas += 1;
  console.error(
    `\n✖ ${CONTAS_A_PAGAR}\n  sobraram so ${corpoDaTela.length} chars depois de tirar ` +
      "comentario e import: o filtro do guard comeu o codigo, e toda exigencia " +
      "acima estaria medindo o vazio."
  );
}

if (falhas) {
  console.error(`\n${falhas} verificacao(oes) falharam.`);
  process.exit(1);
}

console.log(
  "✔ o despacho da conta de grupo esta na tela, a rota diz quem esta olhando, " +
    "e o quadro por membro tem leitor."
);
