#!/usr/bin/env node
// =====================================================
// A FIACAO DA LINHA UNICA DO MYBANK EM CONTAS A PAGAR (HMO-386)
// =====================================================
//   npm run check-linha-do-mybank
//
// POR QUE UM GUARD TEXTUAL, E NAO MAIS UMA ASSERCAO DE COMPONENTE
// --------------------------------------------------------------
// O defeito da HMO-386 nao esta dentro de nenhum componente: ele e a
// COMPOSICAO da pagina. `/dashboard/bills` mostrava a mesma parcela de MyBank
// em duas linhas -- uma na agenda (a HMO-372 fundiu a divida na rota, leitura 1
// de 7) e uma no bloco do devedor (HMO-371) -- e as duas metades, medidas
// separadas, estavam CERTAS. Nenhum total discordava (a parcela entra em «Total
// a pagar» uma vez, pela agenda), entao nada ficava vermelho.
//
// `scripts/test-mybank-na-tela.mjs` (secao J) monta a LINHA e mede o gesto;
// `scripts/probe-linha-dobrada-do-mybank.mjs` conta as linhas na tela
// deployada, em producao. O que falta entre as duas e o que esta aqui: a tela
// montar a linha, e o bloco NAO estar mais nela. Uma pagina de 1.500 linhas nao
// se monta numa sonda de navegador, e o fato e textual.
//
// TUDO AQUI RODA SOBRE O FONTE SEM COMENTARIO E SEM IMPORT, e isso nao e
// detalhe: os tres arquivos EXPLICAM esta decisao em comentario e CITAM os
// nomes que o guard procura. Com os comentarios dentro, apagar o render
// deixaria o guard verde pela prosa que explica o render -- a familia
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
const TELA_DO_MYBANK = "app/(dashboard)/dashboard/mybank/page.tsx";
const LINHA = "components/mybank/LinhaDaParcelaDoMyBank.tsx";

const EXIGE = [
  {
    arquivo: CONTAS_A_PAGAR,
    trechos: [
      // O GALHO, e nao o nome solto: `ehParcelaDoMyBank` importado e nao
      // chamado deixaria a parcela caindo no desenho comum da agenda.
      "ehParcelaDoMyBank(conta) ? (",
      "<LinhaDaParcelaDoMyBank",
      // A RECARGA. A linha muda de rotulo quando o `reported` grava, e quem
      // sabe reler a agenda e a tela.
      "aoAvisar={carregar}",
      // A CHAVE. Esta linha vem com `id: null`: duas delas na mesma secao dao a
      // MESMA key e o React reusa uma no lugar da outra.
      "ehParcelaDoMyBank(conta)\n      ? conta.mybank_installment_id",
    ],
    porque:
      "Contas a Pagar tem de desenhar a parcela do MyBank pela linha propria. Sem o galho ela cai no desenho comum da agenda, com as quatro acoes montando a URL com o `id: null` que ela tem por construcao -- e a baixa some no `if (conta.id === null) return`, ou seja um botao de pagar que nao faz nada.",
  },
  {
    arquivo: TELA_DO_MYBANK,
    trechos: ["<ParcelasDoMyBankQueEuDevo />"],
    porque:
      "o bloco da divida INTEIRA saiu de Contas a Pagar e mora aqui. Sem este render a saida 2 da HMO-386 vira so 'apagar o bloco': o devedor perde a resposta de 'quanto eu ainda devo ao todo', que nenhuma outra tela da.",
  },
  {
    arquivo: LINHA,
    trechos: [
      // O GESTO: `reported`, na rota do MyBank, com o id que nao e o da agenda.
      '"reported"',
      "/api/mybank/installments/${parcela.mybank_installment_id}",
      // O ESTADO sai do campo da TELA, e nao do de dinheiro. Ver o campo em
      // lib/leituras-do-mybank.ts: `status` e sempre 'pending' de proposito.
      "podeAvisarQuePagou({ status: parcela.mybank_status })",
      // O ID NO DOM: e a ancora que a sonda de producao conta.
      "data-parcela-do-mybank={parcela.mybank_installment_id}",
    ],
    porque:
      "a linha e a dona do gesto desde a HMO-386. Ela tem de mandar `reported` (nunca `paid` -- quem paga a parcela e quem RECEBE), na rota do MyBank com o `mybank_installment_id`, e tem de ler `mybank_status` e nao `status`.",
  },
];

// A EXIGENCIA NEGATIVA: o bloco NAO pode voltar para Contas a Pagar.
//
// E ela que trava o defeito. Qualquer render do bloco naquela tela recria a
// duplicacao de linha -- e sem nenhum sintoma de dinheiro: o bloco nao soma
// nada, entao «Total a pagar» continua certo e nada fica vermelho. Foi assim
// que o defeito viveu da HMO-371 a HMO-386.
const PROIBIDO_EM_CONTAS_A_PAGAR = [
  {
    padrao: /<ParcelasDoMyBankQueEuDevo/,
    como: "<ParcelasDoMyBankQueEuDevo",
    porque:
      "o bloco da divida voltou para Contas a Pagar, e com ele a parcela em janela volta a ser desenhada DUAS vezes na mesma tela (a agenda ja a mostra). O lugar dele e /dashboard/mybank.",
  },
  {
    padrao: /\/api\/mybank\/due/,
    como: "/api/mybank/due",
    porque:
      "Contas a Pagar voltou a ler a divida por fora da agenda. A divida daquela tela vem de `GET /api/scheduled-transactions`, que ja a funde recortada pela janela -- uma segunda leitura e a segunda fonte do mesmo numero.",
  },
];

let falhas = 0;

for (const { arquivo, trechos, porque } of EXIGE) {
  const fonte = semComentariosNemImports(readFileSync(arquivo, "utf8"));
  for (const trecho of trechos) {
    if (fonte.includes(trecho)) continue;
    console.error(`FALTA  ${arquivo}`);
    console.error(`       não cita \`${trecho}\` fora de comentário e de import`);
    console.error(`       ${porque}`);
    falhas++;
  }
}

{
  const fonte = semComentariosNemImports(readFileSync(CONTAS_A_PAGAR, "utf8"));
  for (const { padrao, como, porque } of PROIBIDO_EM_CONTAS_A_PAGAR) {
    if (!padrao.test(fonte)) continue;
    console.error(`SOBRA  ${CONTAS_A_PAGAR}`);
    console.error(`       cita ${como} fora de comentário`);
    console.error(`       ${porque}`);
    falhas++;
  }
}

// CONTRAPESO: o gesto nao pode ter nascido uma SEGUNDA vez.
//
// `ROTULO_PARA_AVISAR` e `podeAvisarQuePagou` moram em lib/mybank-na-tela.ts, e
// o bloco e a linha agora os dividem. Uma copia local do rotulo (ou do
// criterio) faria as duas telas divergirem na primeira revisao de copy -- e a
// que ficaria errada e a que ninguem le, porque as duas parecem certas
// isoladas.
for (const arquivo of [LINHA]) {
  const fonte = semComentarios(readFileSync(arquivo, "utf8"));
  for (const nome of ["ROTULO_PARA_AVISAR", "ROTULO_DE_AVISAR", "podeAvisarQuePagou"]) {
    if (!new RegExp(`(const|function)\\s+${nome}\\b`).test(fonte)) continue;
    console.error(`SOBRA  ${arquivo}`);
    console.error(`       declara o próprio \`${nome}\``);
    console.error(
      "       O rótulo e o critério do gesto moram em lib/mybank-na-tela.ts, e o bloco do devedor usa os mesmos. Duas cópias divergem na primeira revisão de copy."
    );
    falhas++;
  }
}

if (falhas > 0) {
  console.error(
    `\n${falhas} ponto(s) da fiação da linha única do MyBank está desligado (HMO-386).`
  );
  process.exit(1);
}

console.log(
  "OK: Contas a Pagar desenha a parcela do MyBank por UMA linha própria (com o gesto de `reported` e o id no DOM), o bloco da dívida inteira está em /dashboard/mybank e não voltou para Contas a Pagar."
);
