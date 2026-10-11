#!/usr/bin/env node
// =====================================================
// Controle negativo da LINHA UNICA do MyBank em Contas a Pagar (HMO-386)
// =====================================================
//   node scripts/mutantes-linha-do-mybank.mjs
//
// Cada entrada estraga UMA decisao da saida 2 da HMO-386. O oraculo de cada
// mutante esta na propria entrada (`alvo`), e os tres existem por razoes
// diferentes:
//
//   test:mybank-na-tela        a secao J monta a LINHA num Chromium e mede o
//                              gesto (qual rota, qual corpo, qual estado)
//   test:leituras-do-mybank    a funcao pura que separa `status` (dinheiro) de
//                              `mybank_status` (tela)
//   check-linha-do-mybank      a COMPOSICAO da pagina, que nenhuma das duas
//                              alcanca: uma tela de 1.500 linhas nao se monta
//                              numa sonda, e o fato e textual
//
// POR QUE A COMPOSICAO PRECISA DE MUTANTE PROPRIO
// -----------------------------------------------
// O defeito que esta issue consertou nao estava DENTRO de componente nenhum: as
// duas metades -- a linha fundida na agenda (HMO-372) e o bloco do devedor
// (HMO-371) -- estavam certas medidas separadas, e juntas desenhavam a mesma
// parcela duas vezes na mesma tela. Nenhum total discordava (a parcela entra em
// «Total a pagar» uma vez, pela agenda), entao nada ficava vermelho: o defeito
// viveu cinco issues.
//
// O guard textual e o unico oraculo que alcanca isso em CI, e guard cuja
// assercao nunca foi vista reprovar e guard que pode estar casando com outra
// linha do arquivo (ou com o COMENTARIO que explica a decisao -- os tres
// arquivos citam os nomes que ele procura, e e por isso que ele le o fonte sem
// comentario). Os quatro mutantes de `alvo: GUARD` sao o que mede se ele mede.
//
// NENHUM MUTANTE AQUI MORRE NO `tsc`, E OS DO GUARD NEM COMPILAM
// --------------------------------------------------------------
// Os de suite trocam CONTEUDO (um campo por outro do mesmo tipo, um literal de
// string por outro), nunca apagam elemento de JSX: mutante que nao compila
// aparece como morto sem ter medido assercao nenhuma
// (`mutante-de-retrocesso-morre-no-tsc`). Os do guard rodam por `oraculos`, que
// e a forma do bloco para oraculo que LE A FONTE e nao compila nada -- entao
// neles nem ha `tsc` para mentir.
// =====================================================

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const LINHA = "components/mybank/LinhaDaParcelaDoMyBank.tsx";
const LEITURA = "lib/leituras-do-mybank.ts";
const CONTAS_A_PAGAR = "app/(dashboard)/dashboard/bills/page.tsx";
const TELA_DO_MYBANK = "app/(dashboard)/dashboard/mybank/page.tsx";

const SUITE_TELA = "test:mybank-na-tela";
const SUITE_LEITURAS = "test:leituras-do-mybank";
const GUARD = "check-linha-do-mybank";

const mutantes = [
  // =========================================================================
  // O GESTO (medido pela secao J, num Chromium)
  // =========================================================================
  {
    nome: "a linha le o status de DINHEIRO e oferece o botao a quem ja avisou",
    arquivo: LINHA,
    alvo: SUITE_TELA,
    porque:
      "O MUTANTE QUE JUSTIFICA O CAMPO NOVO. `status` e `'pending'` tambem na " +
      "parcela `reported`, de proposito -- `reported` ainda e divida, e mapea-lo " +
      "para outra coisa faria o «A vencer» descer no clique do devedor. Lendo " +
      "aquele campo, a linha oferece 'Avisar que paguei' a quem JA avisou, e o " +
      "segundo PATCH responde 200 sem mudar nada: um botao que parece funcionar " +
      "e nao faz diferenca nenhuma",
    de: "podeAvisarQuePagou({ status: parcela.mybank_status })",
    para: "podeAvisarQuePagou({ status: parcela.status })",
  },
  {
    nome: "o gesto vira `paid` -- o devedor quita a divida sozinho",
    arquivo: LINHA,
    alvo: SUITE_TELA,
    porque:
      "quem leva a parcela a paga e quem RECEBE o dinheiro, porque so ele sabe " +
      "se recebeu. A rota recusa `paid` do devedor com 403, entao o sintoma " +
      "visivel e um botao que sempre falha -- e se a rota um dia aceitar, e " +
      "divida quitada sem nada ter se movido",
    de: 'body: JSON.stringify({ status: "reported" })',
    para: 'body: JSON.stringify({ status: "paid" })',
  },
  {
    nome: "o PATCH vai no `id` da agenda, que nesta linha e null",
    arquivo: LINHA,
    alvo: SUITE_TELA,
    porque:
      "esta linha NAO esta em `scheduled_transactions`: o `id` dela e `null` por " +
      "construcao e o id de verdade mora em `mybank_installment_id`. A URL sai " +
      "`/api/mybank/installments/null`, que responde 404 -- e o toast diz " +
      "'nao foi possivel avisar', que se le como problema de rede",
    de: "/api/mybank/installments/${parcela.mybank_installment_id}",
    para: "/api/mybank/installments/${parcela.id}",
  },
  {
    nome: "a linha nao recarrega a agenda depois de avisar",
    arquivo: LINHA,
    alvo: SUITE_TELA,
    porque:
      "o rotulo desta linha sai de `mybank_status`, que acabou de mudar no " +
      "servidor. Sem a recarga o PATCH sai, o toast diz que avisou, e a linha " +
      "continua com o botao 'Avisar que paguei' -- a pessoa avisa de novo",
    de: "      await aoAvisar();\n",
    para: "",
  },
  {
    nome: "o botao ignora a rede e tenta avisar offline",
    arquivo: LINHA,
    alvo: SUITE_TELA,
    porque:
      "sem `!online` o toque offline vai para o `catch` e o toast diz 'nao foi " +
      "possivel' DEPOIS do gesto, em vez de o botao dizer antes. As outras " +
      "linhas desta tela usam o mesmo `online`",
    de: "disabled={avisando || !online}",
    para: "disabled={avisando}",
  },

  // =========================================================================
  // AS DUAS ANCORAS QUE A SONDA DE PRODUCAO CONTA
  // =========================================================================
  {
    nome: "a linha perde o id no DOM -- a sonda de producao fica cega",
    arquivo: LINHA,
    alvo: SUITE_TELA,
    porque:
      "a contagem de 'quantas vezes esta parcela esta desenhada na pagina' se " +
      "apoia neste atributo. Pelo TEXTO ela nao daria: a descricao e do " +
      "EMPRESTIMO, e as parcelas dele a repetem. Com `parcela.id` o React omite " +
      "o atributo (ele e null) e a sonda conta zero",
    de: "data-parcela-do-mybank={parcela.mybank_installment_id}",
    para: "data-parcela-do-mybank={parcela.id}",
  },
  {
    nome: "o selo fica vazio -- a parcela parece conta de luz",
    arquivo: LINHA,
    alvo: SUITE_TELA,
    porque:
      "sem o selo esta linha e INDISTINGUIVEL de uma conta comum na mesma " +
      "lista: mesmo formato, mesmo vencimento, mesmo valor. E as duas se pagam " +
      "de formas diferentes -- uma tem botao de baixa, esta tem 'avisar que " +
      "paguei', e quem emprestou e outra pessoa",
    de: "{parcela.selo}",
    para: '{""}',
  },

  // =========================================================================
  // OS DOIS STATUS (medido pela funcao pura)
  // =========================================================================
  {
    nome: "`mybank_status` nasce fixo em pending",
    arquivo: LEITURA,
    alvo: SUITE_LEITURAS,
    porque:
      "o campo novo vira decoracao: ele existe exatamente para distinguir a " +
      "parcela avisada da pendente, e fixo em `pending` ele faz a linha da " +
      "agenda oferecer o botao a quem ja avisou. Nenhuma assercao ANTERIOR a " +
      "esta issue falha -- as outras todas leem `status`, que continua certo",
    de: '      mybank_status:\n        String(parcela.status) === "reported"\n          ? ("reported" as const)\n          : ("pending" as const),',
    para: '      mybank_status: "pending" as const,',
  },

  // =========================================================================
  // A COMPOSICAO DA PAGINA (medido pelo guard textual)
  // =========================================================================
  {
    nome: "O BLOCO VOLTA PARA CONTAS A PAGAR -- a duplicacao de volta",
    arquivo: CONTAS_A_PAGAR,
    alvo: GUARD,
    porque:
      "ESTE E O DEFEITO DA ISSUE, remontado. O bloco nao soma nada, entao " +
      "«Total a pagar» continua certo e nada fica vermelho: a unica diferenca " +
      "e a mesma parcela desenhada duas vezes. Foi assim que ele viveu da " +
      "HMO-371 a HMO-386",
    de: "      {semVencimento !== null && semVencimento.length > 0 && (",
    para:
      "      <ParcelasDoMyBankQueEuDevo />\n" +
      "      {semVencimento !== null && semVencimento.length > 0 && (",
  },
  {
    nome: "a tela perde o galho e a parcela volta ao desenho comum da agenda",
    arquivo: CONTAS_A_PAGAR,
    alvo: GUARD,
    porque:
      "a parcela volta a herdar as quatro acoes da agenda, e as quatro montam a " +
      "URL com o `id: null` que ela tem por construcao: a baixa morre no " +
      "`if (conta.id === null) return` -- um botao de pagar que nao faz nada --, " +
      "e alterar/pular/comprovante vao para um uuid que aquela tabela nao tem",
    de: "            ehParcelaDoMyBank(conta) ? (",
    para: "            false ? (",
  },
  {
    nome: "a chave da linha volta a ser null",
    arquivo: CONTAS_A_PAGAR,
    alvo: GUARD,
    porque:
      "duas parcelas de MyBank na mesma secao passam a ter a MESMA `key` " +
      "(`null`) e o React reusa uma linha no lugar da outra -- o estado de " +
      "'avisando' aparece na parcela errada. E o mesmo defeito que a fatura " +
      "sintetizada teve na HMO-227",
    de: "      ? conta.mybank_installment_id\n      : conta.id;",
    para: "      ? conta.id\n      : conta.id;",
  },
  {
    nome: "O BLOCO SOME DAS DUAS TELAS -- a saida 2 vira 'apagar o bloco'",
    arquivo: TELA_DO_MYBANK,
    alvo: GUARD,
    porque:
      "O MUTANTE QUE GUARDA A METADE CARA DESTA ISSUE. Tirar o bloco de Contas " +
      "a Pagar sem ele reaparecer em /dashboard/mybank nao conserta a " +
      "duplicacao: APAGA a resposta de 'quanto eu ainda devo ao todo', que " +
      "nenhuma outra tela da -- e que a HMO-381 acabou de rotular. E o " +
      "`tsc` fica verde, porque so sobra um import nao usado em arquivo de app",
    de: "      <ParcelasDoMyBankQueEuDevo />\n",
    para: "",
  },
];

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela.
const original = new Map();
for (const arquivo of new Set(mutantes.map((m) => m.arquivo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

const bloco = criarBlocoDeMutantes({
  rotulo: "linha-do-mybank",
  suites: [SUITE_TELA, SUITE_LEITURAS],
  oraculos: { [GUARD]: "node scripts/check-linha-do-mybank-na-agenda.mjs" },
});

// A sombra vive em diretorio temporario e sai junto com o processo. No pior
// caso (SIGTERM) sobra um diretorio orfao em /tmp -- e nao um componente mutado
// na arvore rastreada.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// CONTROLE POSITIVO, UM POR ORACULO. Sem ele, um oraculo ja vermelho -- ou um
// Chromium que nao existe, que e o modo de falhar conhecido das sondas de
// navegador deste repositorio -- faria TODO mutante "morrer" e o placar sairia
// cheio sobre zero assercoes executadas.
for (const alvo of [SUITE_TELA, SUITE_LEITURAS, GUARD]) {
  const controle = bloco.rodar(`<arvore limpa: ${alvo}>`, {}, alvo);
  if (!controle.verde) {
    console.error(`RUIM  controle positivo de ${alvo}: a arvore INTACTA ja esta vermelha`);
    console.error(controle.saida);
    console.error(
      "\nconserte o oraculo antes de medir mutante -- com ele vermelho, todo\n" +
        "mutante morre por motivo errado e este placar nao vale nada."
    );
    process.exit(1);
  }
  console.log(`OK    controle positivo: ${alvo} verde na arvore intacta`);
}
console.log("");

let falhas = 0;

for (const { nome, arquivo, alvo, de, para } of mutantes) {
  const fonte = original.get(arquivo);
  const ocorrencias = fonte.split(de).length - 1;

  if (ocorrencias === 0) {
    console.error(`RUIM  ANCORA MORTA    ${nome}`);
    console.error(`      ${arquivo} nao contem o trecho procurado -- conserte a ancora.`);
    falhas++;
    continue;
  }

  // A TRAVA DE OCORRENCIA UNICA. `String.replace` troca a PRIMEIRA ocorrencia, e
  // o risco e concreto nestes quatro arquivos: os comentarios CITAM as proprias
  // ancoras (eles explicam por que o campo e `mybank_status` e nao `status`), e
  // uma ancora curta demais mutaria a explicacao, deixaria o codigo intacto, e o
  // placar diria "sobreviveu".
  if (ocorrencias > 1) {
    console.error(`RUIM  ANCORA AMBIGUA  ${nome}`);
    console.error(`      o trecho aparece ${ocorrencias}x em ${arquivo} -- estreite a ancora.`);
    falhas++;
    continue;
  }

  const mutado = fonte.replace(de, para);
  if (mutado === fonte) {
    console.error(`RUIM  REPLACE NO-OP   ${nome}`);
    falhas++;
    continue;
  }

  const r = bloco.rodar(nome, { [arquivo]: mutado }, alvo);

  if (!r.verde) {
    console.log(`OK    morre (${alvo})  ${nome}`);
  } else {
    console.log(`RUIM  SOBREVIVE       ${nome}`);
    if (r.mudouASaida === false) {
      console.log("      (saida compilada identica a da arvore limpa: EQUIVALENTE)");
    }
    falhas++;
  }
}

console.log(
  falhas === 0
    ? `\n${mutantes.length}/${mutantes.length} mutantes mortos.`
    : `\n${falhas} mutante(s) SOBREVIVERAM -- a assercao nao mede o que diz medir.`
);

// Sai 1 com sobrevivente: um runner que saisse 0 deixaria o step de CI verde
// para sempre e provaria o mesmo que step nenhum.
process.exit(falhas === 0 ? 0 : 1);
