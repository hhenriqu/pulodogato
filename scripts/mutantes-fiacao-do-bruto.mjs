#!/usr/bin/env node
// =====================================================
// MUTANTES DA FIACAO DO BRUTO E DO REEMBOLSO (HMO-364)
// =====================================================
//   node scripts/mutantes-fiacao-do-bruto.mjs
//
// As fases F1b/F3/F5 da HMO-360 nao sao aritmetica nova: a aritmetica esta em
// `previstasPelaRegraDoPagador` (14 mutantes, HMO-363), em `creditoAReceber`
// (12 mutantes) e em `resumoComReembolsoPrevisto` (8 mutantes novos em
// `mutantes:telas-de-movimentacao`). O que ESTA fase acrescenta e a FIACAO: qual
// funcao a rota chama, onde o reembolso entra, e se a tela escreve o rotulo.
//
// E FIACAO E EXATAMENTE O QUE NENHUM MUTANTE DE lib/ ALCANCA
// ----------------------------------------------------------
// `previstasComAMinhaParte` e `previstasPelaRegraDoPagador` tem assinatura
// compativel: trocar uma pela outra na rota COMPILA, nao lanca, nao esvazia
// nada e devolve numeros plausiveis -- um «Previsto» de Despesas R$ 300 menor
// num grupo 70/30. Nenhuma suite de funcao pura ve essa troca, porque ela nao
// acontece dentro de nenhuma delas.
//
// `test:bruto-e-reembolso` tambem nao: ela mede a RECONCILIACAO chamando as
// funcoes puras direto, e nao le a rota. Ela e o par de controle negativo das
// duas fases (com a regra antiga o mes da R$ 900 em vez de R$ 1.200; sem o
// reembolso Receitas fica em R$ 5.000 em vez de R$ 5.300), e a fiacao e o outro
// lado da prova.
//
// Quem pega a fiacao e a sonda textual de
// test-contrato-das-telas-de-movimentacao.mjs, e e por isso que este runner
// existe: verde depois de uma sonda textual nao distingue "a fiacao esta certa"
// de "a sonda achou o arquivo e nao afirma nada".
//
// AS DUAS MEDIDAS, E POR QUE SAO DUAS
// -----------------------------------
//   `CONTRATO` -- a sonda textual, declarada como ORACULO porque ela nao compila
//                 nada: ela le o TEXTO da rota e dos componentes. E a unica que
//                 ve a troca de funcao.
//   `MARCACAO` -- `test:cartoes-da-tela`, que renderiza o componente em
//                 `react-dom/server`. E a unica que ve "nao aparece".
//
// MEDIDO, e e a razao de a segunda existir: os TRES mutantes de rotulo
// SOBREVIVERAM a sonda textual na primeira volta deste runner. A sonda casava
// com o NOME da constante -- inclusive na linha de `import` --, entao embrulhar
// a frase num `{false && ...}` deixava o campo lido, o nome no arquivo e a sonda
// verde. Dois mutantes foram repontados para a suite que renderiza, e a terceira
// assercao passou a exigir a interpolacao `{LEGENDA_DO_LIQUIDO}` em vez do nome
// solto.
//
// A MUTACAO VAI PARA UMA SOMBRA EM /tmp, e nao para a arvore
// ----------------------------------------------------------
// A primeira versao deste runner escrevia o texto mutado nos arquivos
// rastreados e os restaurava num `finally`. `npm run check-mutacao-no-lugar`
// reprovou, com razao: morto por timeout ou cancelamento, um runner desses
// deixa o mutante GRAVADO na arvore, e dali em diante toda medicao le o arquivo
// errado sem nada no placar dizendo isso. Aqui os alvos sao uma ROTA e duas
// TELAS de producao. `criarBlocoDeMutantes` escreve na sombra; no pior caso
// sobra um diretorio orfao em /tmp.
//
// A GUARDA DE ANCORA NAO LE ESTE RUNNER, e e por isso que ele confere sozinho
// --------------------------------------------------------------------------
// `npm run check-ancora-de-mutante` varre os runners de duas familias
// conhecidas (`painel` e `tupla`), e as duas pressupoem UM alvo por runner
// (`const ALVO`). Aqui cada mutante tem o `alvo` dele -- a fiacao vive em
// quatro arquivos, e e isso que esta sendo medido --, entao a varredura nao o
// reconhece e o PULA em silencio. Ele nao fica sem a trava: o laco abaixo exige
// que cada ancora case EXATAMENTE 1x antes de rodar, que e a mesma coisa que a
// guarda cobraria. Nao conte com ela aqui.
// =====================================================

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/** A sonda textual, pelo nome do alvo npm -- e o que o CI roda. */
const CONTRATO = "npm run test:contrato-das-telas-de-movimentacao";
/** A suite que renderiza os cartoes. */
const MARCACAO = "test:cartoes-da-tela";

const ROTA = "app/api/movimentacoes/resumo/route.ts";
const CARTOES = "components/movimentacoes/CartoesDaTela.tsx";
const SAFE = "app/api/safe-to-spend/route.ts";
const PAINEL = "app/(dashboard)/dashboard/page.tsx";

const MUTANTES = [
  // --- F1b: a regra do pagador ligada SO nesta leitura ---------------------
  {
    nome: "f1b_desligada",
    alvo: ROTA,
    porque:
      "a rota volta a dividir TODA linha de grupo pela minha parte: a conta de " +
      "R$ 1.000 que eu fronto num grupo 70/30 volta a aparecer como R$ 700 na " +
      "aba Despesas, enquanto R$ 1.000 saem da conta no dia 10. Compila, nao " +
      "lanca, e o numero e plausivel",
    de: "previstasPelaRegraDoPagador(",
    para: "previstasComAMinhaParte(",
    caso: "a rota de Despesas chama a REGRA DO PAGADOR",
  },
  {
    nome: "f1b_sem_o_dono_no_select",
    alvo: ROTA,
    porque:
      "`user_id` sai do select da agenda e `euFrontoAConta` recebe `undefined` " +
      "em toda linha: NENHUMA conta de grupo conta bruto, e o efeito e o mesmo " +
      "de desligar a F1b -- sem erro, sem log, com o tsc verde (o campo e " +
      "opcional em `PrevistaCrua`, porque a fatura sintetizada nao o tem)",
    de: "id, user_id, description, amount, due_date, status, effective_status, currency,",
    para: "id, description, amount, due_date, status, effective_status, currency,",
    caso: "a rota de Despesas chama a REGRA DO PAGADOR",
  },
  {
    nome: "f1b_ligada_no_safe_to_spend",
    alvo: SAFE,
    porque:
      "a HMO-306/308 revertida por refatoracao: o «Quanto ainda posso gastar» " +
      "passaria a descontar a conta de grupo INTEIRA e a prometer que o " +
      "reembolso dos outros ja e dinheiro. A secao 4 do plano decidiu o " +
      "contrario, em voz alta, e o pior erro possivel naquele cartao e para cima",
    de: 'import { direcaoDaAgenda } from "@/lib/previsto-x-realizado";',
    para:
      'import { direcaoDaAgenda } from "@/lib/previsto-x-realizado";\n' +
      'import { previstasPelaRegraDoPagador } from "@/lib/regra-do-pagador";',
    caso: "as outras QUATRO leituras do previsto NAO foram ligadas na regra nova",
  },

  // --- F3: o reembolso no «Previsto» de Receitas ---------------------------
  {
    nome: "f3_desligada",
    alvo: ROTA,
    porque:
      "o estado que o plano da HMO-360 PROIBE de ir sozinho para producao: a " +
      "aba Despesas conta bruto e o reembolso nunca chega ao cartao. O " +
      "«Previsto» de Despesas sobe R$ 300 sem contrapartida e a tela mostra uma " +
      "divida que nao e do usuario",
    de: "        reembolso = notaDoCreditoAReceber(leitura.credito);",
    para: "        reembolso = null;",
    caso: "o reembolso vai para o «Previsto» por `resumoComReembolsoPrevisto`",
  },
  {
    nome: "f3_sem_a_funcao_do_balde",
    alvo: ROTA,
    porque:
      "a rota passa a devolver o resumo CRU e o reembolso vira campo solto: a " +
      "tela le `resumo.reembolso_previsto` como `undefined`, a frase desaparece " +
      "e o «Previsto» de Receitas volta a ignorar o credito -- sem erro nenhum, " +
      "porque `res.json()` e `any` e o tsc nao liga os dois lados",
    de: "    const resumo = resumoComReembolsoPrevisto(\n      resumoDaTela(linhas),",
    para: "    const resumo = resumoDaTela(\n      (linhas),",
    caso: "o reembolso vai para o «Previsto» por `resumoComReembolsoPrevisto`",
  },
  {
    nome: "f3_em_todas_as_telas",
    alvo: ROTA,
    porque:
      "as seis consultas do credito passam a rodar nas TRES telas. Nenhum " +
      "numero muda (a funcao do balde recusa o que nao e `income`), e por isso " +
      "ele e o mutante de uma decisao que so a fiacao guarda: o ramo existe para " +
      "a aba Despesas e a de Transferencias nao gastarem seis consultas para " +
      "descartar tudo depois",
    de: '    if (tela.tipo === "income") {',
    para: "    if (true) {",
    caso: "o reembolso do grupo entra pelo modulo compartilhado, e so em Receitas",
  },
  {
    nome: "f3_com_consulta_propria",
    alvo: ROTA,
    porque:
      "a rota deixa de ler pelo modulo compartilhado. O caminho que isso abre e " +
      "a SEGUNDA implementacao das mesmas seis consultas -- dois numeros " +
      "plausiveis para o mesmo credito, divergindo na primeira mudanca " +
      "(`fontes-consistentes-que-discordam`)",
    de: "      const leitura = await lerCreditoDosGrupos(",
    para: "      const leitura = await naoExisteMaisOModuloCompartilhado(",
    caso: "o reembolso do grupo entra pelo modulo compartilhado, e so em Receitas",
  },

  // --- F5: os rotulos, que sao entrega e nao enfeite -----------------------
  {
    nome: "f5_reembolso_sem_rotulo",
    alvo: CARTOES,
    porque:
      "o «Previsto» de Receitas sobe R$ 300 e NADA na tela diz de onde vieram: " +
      "o quinto numero sem rotulo da familia " +
      "`despesa-de-grupo-tem-tres-convencoes`, que este app ja pagou quatro " +
      "vezes. A aritmetica fica exata e o valor, indistinguivel de bug",
    // A GUARDA FICA CEGA, E NENHUM `false` ENTRA NA CADEIA -- medido duas vezes.
    //
    // `{false && ...}` e `{false && podeMostrarNumero(estado) && ...}` morrem os
    // DOIS em TS18047, e nao na assercao: com o literal `false` na cadeia o tsc
    // trata o resto como inalcancavel e descarta o ESTREITAMENTO de
    // `resumo?.reembolso_previsto &&`, que e o que prova que o objeto nao e nulo
    // dentro do JSX. E a familia de
    // `mutante-de-retrocesso-morre-no-tsc-nao-na-assercao`: morte no compilador
    // tambem e morte, mas ela prova que o defeito nao e escrivivel DAQUELE
    // jeito -- nao que a suite o pegaria escrito de outro.
    //
    // `podeMostrarNumero(null)` e o mesmo defeito sem o literal: a guarda
    // continua estreitando o tipo, o arquivo compila, e a nota simplesmente
    // nunca aparece. E ele e um defeito REAL e nao sintetico -- passar o estado
    // errado para a guarda e o que faz o numero (ou a frase) calar para sempre,
    // e este componente tem uma guarda dessas em cada bloco.
    de: "{podeMostrarNumero(estado) && resumo?.reembolso_previsto && (",
    para: "{podeMostrarNumero(null) && resumo?.reembolso_previsto && (",
    medida: MARCACAO,
    caso: "o reembolso previsto aparece como nota do «Previsto»",
  },
  {
    nome: "f5_despesas_sem_a_pergunta",
    alvo: CARTOES,
    porque:
      "a aba Despesas passa a mostrar o bruto sem dizer que pergunta ele " +
      "responde. Ao lado, no painel, o «Quanto ainda posso gastar» mostra o " +
      "liquido -- R$ 300 MENOR, e sem legenda isso se le como conta perdida",
    de: '          {tela.tipo === "expense" && (',
    para: "          {false && (",
    medida: MARCACAO,
    caso: "a legenda do bruto sai na aba Despesas, e SO nela",
  },
  {
    nome: "f5_painel_sem_a_pergunta",
    alvo: PAINEL,
    porque:
      "o outro lado da mesma legenda. Ele e o numero MENOR dos dois, que e a " +
      "direcao em que a surpresa doi: quem ve R$ 700 no painel e R$ 1.000 na " +
      "aba precisa saber que os R$ 300 nao foram esquecidos",
    de: '            {LEGENDA_DO_LIQUIDO}{" "}',
    para: '            {""}{" "}',
    caso: "os DOIS numeros que vao discordar levam a legenda de cada um",
  },
];

/** O fonte de cada alvo, lido UMA vez -- a arvore nunca e escrita. */
const ORIGINAIS = new Map(
  Array.from(new Set(MUTANTES.map((m) => m.alvo))).map((alvo) => [
    alvo,
    readFileSync(path.join(RAIZ, alvo), "utf8"),
  ])
);

const bloco = criarBlocoDeMutantes({
  rotulo: "fiacao-do-bruto",
  suites: [MARCACAO],
  oraculos: { [CONTRATO]: CONTRATO },
});

// A sombra vive em diretorio temporario e sai junto com o processo. No pior caso
// (SIGTERM) sobra um diretorio orfao em /tmp -- e nao uma rota de producao
// mutada na arvore rastreada.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// AS DUAS MEDIDAS ENTRAM NO CONTROLE POSITIVO, e nao so a primeira: um mutante
// medido por uma suite que JA estava vermelha "morre" sem ter sido medido, e o
// placar sai perfeito sobre zero assercoes
// (`suite-vermelha-faz-todo-controle-negativo-passar-vacuo`).
console.log("CONTROLE POSITIVO (arvore intacta)");
for (const medida of [CONTRATO, MARCACAO]) {
  const controle = bloco.rodar("controle", {}, medida);
  if (!controle.verde) {
    console.log(`RUIM  a arvore INTACTA ja esta vermelha em ${medida}`);
    console.log(`      ${controle.saida}`);
    console.log(
      "\nconserte a suite antes de medir mutante -- com ela vermelha, todo"
    );
    console.log("mutante morre por motivo errado e este placar nao vale nada.");
    process.exit(1);
  }
  console.log(`OK    ${medida} passa inteira`);
}
console.log("");

let falhas = 0;

console.log("MUTANTES");
for (const m of MUTANTES) {
  const original = ORIGINAIS.get(m.alvo);

  // `String.replace` troca a PRIMEIRA ocorrencia. Uma ancora que casa duas
  // vezes produz um mutante que muta o lugar errado e morre verde com o rotulo
  // mentindo sobre o que foi medido -- por isso ela tem de casar exatamente 1x,
  // e nao apenas existir.
  const ocorrencias = original.split(m.de).length - 1;
  if (ocorrencias !== 1) {
    console.log(
      `RUIM  ANCORA ${ocorrencias === 0 ? "MORTA" : "AMBIGUA"}  ${m.nome}`
    );
    console.log(
      `      \`${m.de.slice(0, 60)}\` casa ${ocorrencias}x em ${m.alvo}`
    );
    falhas++;
    continue;
  }

  const medida = m.medida ?? CONTRATO;
  const r = bloco.rodar(m.nome, { [m.alvo]: original.replace(m.de, m.para) }, medida);

  // NAO BASTA FICAR VERMELHO: tem de ficar vermelho NO CASO que este mutante
  // deveria quebrar. Um mutante que derruba outro caso qualquer mediria a
  // suite, e nao a afirmacao -- e e assim que um runner fica com placar cheio
  // medindo outra coisa.
  const matouOCaso = !r.verde && r.saida.includes(m.caso);

  if (matouOCaso) {
    console.log(`OK    morre          ${m.nome}  ->  "${m.caso}" [${medida}]`);
  } else {
    falhas++;
    console.log(
      `RUIM  SOBREVIVE      ${m.nome}  (esperava derrubar "${m.caso}")` +
        (r.verde ? " -- a suite ficou toda verde" : ` -- ${r.como}: ${r.saida}`)
    );
  }
}

console.log(
  falhas === 0
    ? `\n${MUTANTES.length}/${MUTANTES.length} mutantes mortos.`
    : `\n${falhas} mutante(s) SOBREVIVERAM -- a assercao nao mede o que diz medir.`
);
process.exit(falhas === 0 ? 0 : 1);
