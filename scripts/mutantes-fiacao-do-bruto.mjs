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

/**
 * A suite que CHAMA OS DOIS HANDLERS do par do realizado (HMO-413, secao 8).
 *
 * Declarada como SUITE e nao como oraculo porque ela COMPILA (`compila.mjs` ->
 * `.tmp-criterio-do-painel`): o bloco redireciona a etapa de compilacao para a
 * sombra, e sem isso o `node --test` leria o artefato de outra volta.
 *
 * Ela entra aqui por uma razao que as outras duas nao cobrem: as duas legendas
 * da HMO-413 afirmam uma SUBTRACAO entre duas rotas ("a aba Despesas mostra
 * menos"). `CONTRATO` ve que a frase esta escrita, `MARCACAO` ve que ela
 * aparece -- nenhuma das duas ve se ela e VERDADE. E o lado da aba Despesas e
 * justamente o que nada no repo media antes desta issue.
 */
const CRITERIO = "test:criterio-do-painel";

const ROTA = "app/api/movimentacoes/resumo/route.ts";
const CARTOES = "components/movimentacoes/CartoesDaTela.tsx";
const SAFE = "app/api/safe-to-spend/route.ts";
const PAINEL = "app/(dashboard)/dashboard/page.tsx";
const TELA = "components/movimentacoes/TelaDeMovimentacao.tsx";
const LEGENDAS = "lib/legenda-do-bruto-e-do-liquido.ts";
/**
 * A LISTA das duas abas -- alvo novo na HMO-422.
 *
 * Ela entra aqui porque o elo que a issue fechou tem DOIS lados: a rota passou
 * a emitir `quem_me_paga` e a lista passou a ler o campo. Mutar so a rota
 * deixaria o segundo lado sem controle negativo -- e foi exatamente o lado que
 * falhou na HMO-379, quando `a_receber_do_mybank` chegava no corpo e o tipo da
 * tela o escondia.
 */
const LISTA = "components/movimentacoes/ListaDeMovimentacao.tsx";

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
    de: "id, user_id, description, amount, due_date, my_status, my_effective_status, currency,",
    para: "id, description, amount, due_date, my_status, my_effective_status, currency,",
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
    // ANCORA REPONTADA NA HMO-379, e ela estava MORTA (0 ocorrencias): a F4
    // (HMO-372) EMBRULHOU esta chamada em `resumoComAReceberDoMyBank(...)`, e
    // com isso `const resumo = resumoComReembolsoPrevisto(` deixou de existir
    // no arquivo. O runner acusava `RUIM ANCORA MORTA` -- ou seja este defeito
    // ficou sem medida nenhuma desde a F4, e o step de CI vermelho na main.
    // E a familia `mutante-cuja-ancora-a-feature-apagou`.
    //
    // O ALVO CONTINUA SENDO O MESMO DEFEITO: tirar a funcao do balde do
    // reembolso, deixando o embrulho do MyBank em pe. O resumo sai cru de
    // `resumoDaTela` e `resumo.reembolso_previsto` chega `undefined` na tela.
    de: "      resumoComReembolsoPrevisto(resumoDaTela(linhas), tela.tipo, reembolso),",
    para: "      resumoDaTela(linhas),",
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
    // ANCORA REPONTADA NA HMO-379, e ela estava AMBIGUA (3 ocorrencias): a F4
    // (HMO-372) acrescentou o ramo do MyBank e a HMO-366 o dos acertos, os
    // tres com o MESMO `if (tela.tipo === "income") {`. `String.replace` troca
    // a PRIMEIRA -- aqui, por sorte, ainda era a do reembolso, mas o runner
    // recusa ancora ambigua de proposito: na proxima insercao acima dela o
    // mutante passaria a medir outro ramo com o rotulo deste.
    //
    // A DECLARACAO DO `let` E O QUE DESAMBIGUA, e ela e unica por construcao --
    // cada um dos tres ramos preenche uma variavel com nome proprio.
    de: '    let reembolso: ReembolsoPrevisto | null = null;\n\n    if (tela.tipo === "income") {',
    para: '    let reembolso: ReembolsoPrevisto | null = null;\n\n    if (true) {',
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
  // --- F7: o «a receber» do MyBank, que ficou SEM ROTULO (HMO-379) ---------
  // A fiacao que faltou de verdade, e nao uma hipotese: a F4 (HMO-372) somou o
  // valor no «Previsto» de Receitas e `a_receber_do_mybank` ficou sem UM
  // consumidor na UI. Producao mostrou «Previsto» R$ 30,00 em cima de "Nada
  // previsto neste período", com o contador ao lado dizendo (0).
  {
    nome: "f7_mybank_sem_rotulo",
    alvo: CARTOES,
    porque:
      "o estado EXATO que a HMO-379 conserta: o «Previsto» de Receitas sobe " +
      "R$ 30,00 e nada na tela diz de onde vieram. A aritmetica fica exata, as " +
      "cinco suites ficam verdes (nenhuma ve rotulo -- a familia " +
      "`campo-de-rotulo-passa-pela-suite-de-aritmetica-inteira`) e o valor fica " +
      "indistinguivel de bug: foi assim que ele chegou a producao",
    // A GUARDA FICA CEGA, E NENHUM `false` ENTRA NA CADEIA -- pela MESMA razao
    // escrita em `f5_reembolso_sem_rotulo` logo acima: com o literal `false` o
    // tsc descarta o estreitamento de `resumo?.a_receber_do_mybank &&` e o
    // mutante morre em TS18047, no compilador e nao na assercao.
    de: "{podeMostrarNumero(estado) && resumo?.a_receber_do_mybank && (",
    para: "{podeMostrarNumero(null) && resumo?.a_receber_do_mybank && (",
    medida: MARCACAO,
    caso: "o «a receber» do MyBank aparece como nota do «Previsto»",
  },
  {
    nome: "f7_mybank_conta_parcelas_em_vez_de_pessoas",
    alvo: CARTOES,
    porque:
      "a frase passa a dizer '4 pessoas' para QUATRO PARCELAS de UMA pessoa. " +
      "Numero plausivel, frase gramatical, soma intacta -- e o rotulo mentindo " +
      "sobre quantas conexoes devem. Nenhuma assercao de aritmetica o alcanca",
    // A ANCORA LEVA A LINHA DE CIMA porque `.devedores` sozinho casa DUAS vezes
    // (o valor e a concordancia de plural), e o runner exige 1x -- ancora
    // ambigua muta o lugar errado e o rotulo mente sobre o que foi medido.
    de:
      'a receber de{" "}\n              {resumo.a_receber_do_mybank.devedores}{" "}',
    para:
      'a receber de{" "}\n              {resumo.a_receber_do_mybank.parcelas}{" "}',
    medida: MARCACAO,
    caso: "o «a receber» do MyBank aparece como nota do «Previsto»",
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

  // --- F8: o par do REALIZADO, e a direcao INVERTIDA (HMO-413) -------------
  //
  // O eixo que a F5 nao cobre. A F5 e o PREVISTO (aba 1.000 vs painel 700); esta
  // e o REALIZADO (painel 1.010 vs aba 990), e os papeis se trocam: aqui o
  // painel mostra MAIS. As duas vivem na MESMA tela, e e dai que vem o
  // `f8_direcao_trocada` logo abaixo.
  //
  // POR QUE ELES EXISTEM DEPOIS DA HMO-418 ter posto o numero certo: a HMO-418
  // consertou a ponta de cima e o comentario do painel passou a afirmar que as
  // duas pontas tinham rotulo. Uma delas nao tinha -- e o tile e um LINK para a
  // outra desde a HMO-408. Nada no repo media essa afirmacao.
  {
    nome: "f8_painel_realizado_sem_a_pergunta",
    alvo: PAINEL,
    porque:
      "o estado que a HMO-413 conserta: o tile mostra 1.010,00, leva num " +
      "clique para 990,00 e nada diz que os 20,00 de diferenca sao a parte " +
      "que eu devo. E o numero MAIOR levando ao menor -- a direcao em que se " +
      "le 'o app perdeu uma despesa no caminho'",
    de: '          {LEGENDA_DO_CUSTO_REALIZADO}{" "}',
    para: '          {""}{" "}',
    caso: "o par do REALIZADO tambem leva legenda dos dois lados",
  },
  {
    nome: "f8_aba_sem_a_volta",
    alvo: TELA,
    porque:
      "a metade de LA. A aba Despesas volta a explicar o proprio numero " +
      "apontando para Financas Pessoais, e quem chegou clicando no tile do " +
      "painel continua sem ligar um numero ao outro -- era o estado de antes " +
      "da HMO-413, e ele parece completo porque a frase existe",
    de: '                  {LEGENDA_DO_CAIXA_REALIZADO}{" "}',
    para: '                  {""}{" "}',
    caso: "o par do REALIZADO tambem leva legenda dos dois lados",
  },
  {
    nome: "f8_direcao_trocada",
    alvo: LEGENDAS,
    porque:
      "O MUTANTE QUE NENHUMA ASSERCAO DE FIACAO PEGA. A frase continua " +
      "escrita, continua aparecendo na tela, continua citando as duas " +
      "perguntas -- e manda a pessoa procurar os 20,00 no lado errado. No " +
      "eixo do previsto 'a aba Despesas mostra mais' e VERDADE, e as duas " +
      "frases vivem na mesma tela: e uma troca que se le como copia-e-cola " +
      "correto",
    // A ANCORA NAO LEVA A CRASE DE ABERTURA: a oracao comeca no MEIO de um
    // pedaco do template (`junto. A aba Despesas mostra menos...`), e um
    // backtick colado na frente a deixa com 0 ocorrencia -- medido ao escrever
    // isto, e o runner acusou ANCORA MORTA antes de contar o mutante.
    de: "A aba Despesas mostra menos, e está certa",
    para: "A aba Despesas mostra mais, e está certa",
    caso: "o par do REALIZADO tambem leva legenda dos dois lados",
  },
  {
    nome: "f8_link_nu_no_painel",
    alvo: PAINEL,
    porque:
      "a legenda fala do periodo que esta na tela e o link abre o mes " +
      "corrente (`lerPeriodo` cai nele sem `?de=&ate=`). A frase apresenta " +
      "como par dois numeros de MESES DIFERENTES, que de fato nao se comparam " +
      "-- uma legenda que monta uma comparacao falsa e pior que legenda " +
      "nenhuma. E o defeito que a HMO-415 consertou no tile ao lado",
    // A ANCORA LEVA A LINHA DA LEGENDA porque `rotaDaTelaDoLado(\"despesa\",
    // periodo)` casa TRES vezes neste arquivo (o tile, esta legenda e o cartao
    // «posso gastar»), e o runner exige 1x -- ancora ambigua muta o lugar
    // errado e o rotulo mente sobre o que foi medido.
    de:
      '          {LEGENDA_DO_CUSTO_REALIZADO}{" "}\n          <Link\n' +
      "            href={rotaDaTelaDoLado(\"despesa\", periodo) as Route}",
    para:
      '          {LEGENDA_DO_CUSTO_REALIZADO}{" "}\n          <Link\n' +
      '            href={"/dashboard/despesas" as Route}',
    caso: "o par do REALIZADO tambem leva legenda dos dois lados",
  },
  {
    nome: "f8_link_nu_na_volta",
    alvo: TELA,
    porque:
      "o mesmo defeito na volta, e ele e mais facil de escrever: `/dashboard` " +
      "e uma rota estatica, o `typedRoutes` aceita o literal sem reclamar e o " +
      "tsc fica verde. Quem olha maio na aba Despesas vai para o painel de " +
      "outubro",
    de: "href={rotaDoPainel(periodo) as Route}",
    para: 'href={"/dashboard" as Route}',
    caso: "o par do REALIZADO tambem leva legenda dos dois lados",
  },
  {
    nome: "f8_a_aba_passa_a_somar_o_grupo_dos_outros",
    alvo: ROTA,
    porque:
      "O CONTROLE DO LADO QUE NINGUEM MEDIA. Sem o `eq(\"user_id\")` o " +
      "realizado da aba passa a somar a despesa de grupo que OUTRO membro " +
      "lancou (a policy do 002 a torna visivel), e o numero do destino sai " +
      "1.050,00 em vez de 990,00. As duas legendas continuam escritas, " +
      "aparecendo e bem redigidas -- e a subtracao que elas afirmam deixa de " +
      "ser a minha parte do que outro pagou",
    // A ANCORA LEVA A LINHA DE BAIXO: `eq(\"user_id\", user.id)` casa QUATRO
    // vezes nesta rota, e so esta e a consulta do realizado.
    de:
      '      .eq("user_id", user.id)\n      .eq("service_id", servico.id)',
    para: '      .eq("service_id", servico.id)',
    medida: CRITERIO,
    caso: "secao 8: a diferenca entre o painel e a aba Despesas e UMA perna",
  },

  // --- HMO-422: o reembolso do «Previsto» com NOME e GRUPO -----------------
  //
  // Os tres mutantes sao os tres elos da mesma entrega, e cada um sozinho
  // devolve a tela da issue: um numero no cartao sem nada que diga de quem ele
  // e. Nenhum deles muda um unico valor -- sao mutantes de FIACAO, a familia
  // que `campo-de-rotulo-passa-pela-suite-de-aritmetica-inteira` descreve.
  {
    nome: "hmo422_rota_nao_emite",
    alvo: ROTA,
    porque:
      "a rota volta a jogar fora as linhas do credito. `notaDoCreditoAReceber` " +
      "colapsa `CreditoAReceber` em tres numeros, e sem este campo o painel da " +
      "aba Receitas nao tem de onde tirar QUEM deve -- a tela da HMO-422, byte " +
      "a byte",
    de: "      quem_me_paga: creditoDosGrupos,",
    para: "      quem_me_paga: null,",
    caso: "a aba Receitas NOMEIA quem deve o reembolso que esta no «Previsto»",
  },
  {
    nome: "hmo422_lista_nao_le",
    alvo: LISTA,
    porque:
      "o campo chega no corpo e a tela nao o le. E o defeito da HMO-379 " +
      "repetido com outro nome: `git grep` acharia `quem_me_paga` na rota, o " +
      "numero do cartao continuaria certo, e o painel nunca apareceria",
    de: "      setQuemMePaga(leitura.dados.quem_me_paga ?? null);",
    para: "      setQuemMePaga(null);",
    caso: "a aba Receitas NOMEIA quem deve o reembolso que esta no «Previsto»",
  },
  {
    nome: "hmo422_painel_na_aba_errada",
    alvo: LISTA,
    porque:
      "o painel sai na aba DESPESAS. Nenhum numero muda (a rota devolve `null` " +
      "fora de Receitas, entao o painel renderiza nada nas duas), e por isso " +
      "ele e o mutante de uma decisao que so a fiacao guarda -- o dia em que a " +
      "rota passar a emitir o campo nas tres telas, o credito a receber " +
      "apareceria embaixo dos cartoes de Despesas",
    de: '          {tipo === "income" && podeMostrarNumero(estado) && (',
    para: '          {tipo === "expense" && podeMostrarNumero(estado) && (',
    caso: "a aba Receitas NOMEIA quem deve o reembolso que esta no «Previsto»",
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
  suites: [MARCACAO, CRITERIO],
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
for (const medida of [CONTRATO, MARCACAO, CRITERIO]) {
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
/**
 * Os nomes dos casos que REPROVARAM, nas duas saidas do `node --test`: TAP
 * (`not ok N - nome`, o que o CI imprime sem TTY) e spec (`✖ nome (12ms)`).
 * Procurar o `caso` na saida inteira casaria tambem com o `ok N - nome` de
 * quem PASSOU.
 */
function casosQueCairam(saida) {
  return [
    ...[...saida.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((x) => x[1]),
    ...[...saida.matchAll(/✖ (.+?) \(/g)].map((x) => x[1]),
  ];
}

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
  const matouOCaso = !r.verde && casosQueCairam(r.crua ?? r.saida).some((c) => c.includes(m.caso));

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
