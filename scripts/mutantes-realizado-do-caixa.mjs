#!/usr/bin/env node
// Mutantes de lib/realizado-do-caixa.ts -- HMO-265.
//
// POR QUE ISTO EXISTE
// -------------------
// O modulo tem quatro decisoes e nenhuma delas levanta excecao quando esta
// errada: todas produzem um TOTAL plausivel. Pior: o fixture obvio -- uma compra
// de R$ 400 e uma fatura de R$ 1.290 -- deixa varios erros com o numero certo
// por acaso, porque 1.290 sozinho tambem e "o total do cartao". Cada mutante
// abaixo desfaz UMA decisao; `npm run test:realizado-do-caixa` tem de ficar
// vermelho em todos.
//
// COMO RODAR
//   npm run mutantes:realizado-do-caixa
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao vive em memoria e e compilada de uma ARVORE TEMPORARIA, igual ao
// runner da HMO-246. Mutar, rodar e restaurar no `finally` deixa a fonte mutada
// no disco quando o processo morre no meio -- e um `trap` que restaura por cima
// apaga trabalho nao salvo.
//
// O BUILD E O QUE COMPLICA, E E POR ISSO QUE A ARVORE E COPIADA INTEIRA
// ---------------------------------------------------------------------
// Este modulo importa `@/lib/telas-de-movimentacao`, e o teste importa
// `@/lib/periodo-do-painel` por cima. Compilar so o arquivo mutado com
// `tsc arquivo.ts` nao resolve `@/` e morre em erro de compilacao, e um mutante
// que nao COMPILA "morre" por motivo errado: o placar mentiria a favor. A lista
// de DEPENDENCIAS abaixo e a do scripts/tsconfig.realizado-do-caixa-test.json
// menos o arquivo mutado; se ela divergir, o controle positivo aborta antes de
// qualquer mutante rodar.
//
// TRES MUTANTES MUTAM lib/telas-de-movimentacao.ts, E NAO A FONTE -- HMO-317
// --------------------------------------------------------------------------
// O criterio "esta linha e a perna de saida do pagamento da fatura" era uma
// COPIA aqui dentro e passou a ser `ehPagamentoDaFatura`, de
// lib/telas-de-movimentacao.ts. Se os mutantes dele saissem desta lista junto
// com a copia, o caminho de dinheiro do PAINEL ficaria sem medida nenhuma: quem
// mede aquela funcao do outro lado e scripts/mutantes-telas-de-movimentacao.mjs,
// que roda a suite da TELA -- e a suite da tela nao soma um centavo pelo painel.
//
// Entao cada mutante declara em `alvo` QUAL arquivo da arvore ele muta (a FONTE,
// por omissao), e a mutacao do dono e verificada contra ESTA suite, que agrega
// pelo `agregarTransacoes` da rota. Mutar o dono aqui nao custa arvore nova: ele
// JA e copiado como dependencia.
//
// `compilaERoda` reescreve TODOS os arquivos mutaveis a partir do original antes
// de aplicar a mutacao. Sem isso o mutante do dono ficaria na arvore e o
// seguinte -- que muta a FONTE -- rodaria contra um dono ja mutado, morrendo com
// o rotulo mentindo sobre o que foi medido.

import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";

const FONTE = "lib/realizado-do-caixa.ts";
/**
 * O DONO do criterio da fatura paga -- HMO-317. Ele e dependencia E alvo de
 * mutante (ver o cabecalho), e e por isso que ele tem nome proprio aqui.
 */
const DONO_DO_CRITERIO = "lib/telas-de-movimentacao.ts";
const DEPENDENCIAS = [
  DONO_DO_CRITERIO,
  // AS DUAS ENTRARAM NA HMO-264, E SEM ELAS ESTE GUARD ESTAVA MORTO.
  //
  // `chave-da-fatura` nasceu na HMO-285 (a chave canonica saiu de `card-invoice`
  // para um arquivo-FOLHA) e `elo-da-fatura` na HMO-305. As duas sao importadas
  // por `telas-de-movimentacao.ts`, e `card-invoice.ts` RE-EXPORTAVA a primeira
  // -- e nenhuma das duas entrou nesta lista nem no `include` do tsconfig da
  // suite.
  //
  // A SUITE NAO ACUSOU, e nao podia: ela compila DENTRO do repo, onde o `paths`
  // resolve `@/lib/chave-da-fatura` para o arquivo de verdade e o tsc o puxa
  // transitivamente, listado ou nao. O MUTADOR monta uma arvore ISOLADA com so
  // estas copias, e ali o import nao resolve -- entao
  // `npm run mutantes:realizado-do-caixa` abortava no controle positivo com tres
  // TS2307 desde que a HMO-285 mergeou, e nenhum mutante deste modulo rodou mais.
  //
  // ABORTAR E O COMPORTAMENTO CERTO do runner, e e por isso que o estrago parou
  // aqui: sem o controle positivo, os tres erros de compilacao fariam TODO
  // mutante "morrer" por motivo errado e o placar diria 100% sem medir nada. O
  // que faltava era alguem rodar o guard.
  "lib/chave-da-fatura.ts",
  "lib/elo-da-fatura.ts",
  "lib/movimentacoes.ts",
  "lib/destino-do-lancamento.ts",
  "lib/periodo-do-painel.ts",
  "lib/recurrence.ts",
  "lib/dinheiro.ts",
  "lib/moeda.ts",
];
const SAIDA = ".tmp-realizado-do-caixa";
const TESTE = "scripts/test-realizado-do-caixa.mjs";

/**
 * O conteudo de cada arquivo que algum mutante muta, lido UMA vez do disco.
 *
 * E a partir deste mapa que `compilaERoda` reescreve a arvore inteira antes de
 * cada rodada, e e nele que a contagem de ocorrencias da ancora e feita: contar
 * no arquivo errado deixaria passar ancora ambigua (ver o laco).
 */
const ORIGINAIS = new Map(
  [FONTE, DONO_DO_CRITERIO].map((arquivo) => [
    arquivo,
    readFileSync(arquivo, "utf8"),
  ])
);

const MUTANTES = [
  // --- metade 1: a compra no cartao sai ------------------------------------
  {
    nome: "compra_no_cartao_fica",
    porque:
      "o defeito desta issue, intacto: a compra no cartao conta no dia da " +
      "COMPRA e a fatura conta de novo no dia do pagamento -- o cartao duas vezes",
    de: "    if (ehCompraNoCartao(linha)) continue;",
    para: "    if (false) continue;",
  },
  {
    nome: "cartao_sem_o_filtro_de_tipo",
    porque:
      "a compra no cartao com `transaction_type` NULO sai do realizado sem que " +
      "a fatura a contenha (a view `card_invoice_lines` filtra income/expense), " +
      "e o valor sai do app -- pior que conta-lo duas vezes",
    de: "  return TIPOS_QUE_ENTRAM_NA_FATURA.has(String(linha.transaction_type));",
    para: "  return true;",
  },
  {
    nome: "sem_conta_vira_cartao",
    porque:
      "embed `null` por RLS passa a significar 'e cartao': a despesa de grupo, " +
      "que e gravada SEM account_id, desaparece do realizado do painel",
    de: "  if (contaDaLinha(linha)?.account_type !== TIPO_CARTAO) return false;",
    para: "  if (contaDaLinha(linha)?.account_type === undefined) return true;",
  },
  {
    nome: "embed_so_objeto",
    porque:
      "o embed vindo ARRAY passa a dar `undefined` em toda linha, nenhuma casa " +
      "com credit_card, o filtro para de filtrar e o painel volta ao defeito " +
      "desta issue -- sem erro, sem log e com o tsc verde (HMO-209)",
    de: "  if (Array.isArray(bruto)) return bruto[0] ?? null;",
    para: "  if (Array.isArray(bruto)) return null;",
  },

  // --- metade 2: a fatura paga entra --------------------------------------
  {
    nome: "fatura_paga_nao_entra",
    porque:
      "o mes em que a fatura foi paga perde o valor dela: R$ 1.290 a menos no " +
      "Realizado, e um total MENOR nao parece erro, parece um mes barato (HMO-264)",
    de: "    if (ehPagamentoDaFatura(linha)) {",
    para: "    if (false) {",
  },

  // --- o criterio da fatura paga, que mora no DONO (HMO-317) ---------------
  //
  // Os tres abaixo mutam `lib/telas-de-movimentacao.ts` dentro da arvore
  // isolada, e nao a FONTE: o criterio deixou de ser copia daqui. O que eles
  // provam e que o caminho de dinheiro do PAINEL depende de cada criterio do
  // dono -- a suite da tela, que o outro mutador roda, nao soma nada por aqui.
  {
    nome: "as_duas_pernas_entram",
    alvo: DONO_DO_CRITERIO,
    porque:
      "a perna de entrada e promovida junto: `agregarTransacoes` aplica " +
      "Math.abs, entao as duas NAO se anulam -- a fatura conta em DOBRO",
    de: "  if (ehPernaDeEntrada(crua)) return false;\n  return Number(crua.amount) < 0;",
    para: "  return true;",
  },
  {
    nome: "par_de_valor_zero_e_promovido",
    alvo: DONO_DO_CRITERIO,
    porque:
      "o sinal deixa de ser ESTRITO e as duas pernas de um pagamento de valor " +
      "ZERO sao promovidas: o total nao muda um centavo e o " +
      "`transaction_count` sobe DOIS -- o tile «Lancamentos» discordando do " +
      "total ao lado dele, que e a forma de erro mais barata de nao notar " +
      "(HMO-317)",
    de: "  return Number(crua.amount) < 0;",
    para: "  return true;",
  },
  {
    nome: "fatura_sem_a_chave",
    alvo: DONO_DO_CRITERIO,
    porque:
      "toda transferencia entre contas proprias vira despesa do mes: um Pix da " +
      "corrente para a poupanca passa a ser gasto",
    de: "  if (!faturaDaChave(crua.notes)) return false;",
    para: "  if (false) return false;",
  },
  // NAO EXISTE MUTANTE PARA O CRITERIO DO `transaction_type`, E ISSO E
  // DELIBERADO. Ele existiu, sobreviveu, e a investigacao mostrou que a guarda
  // e invisivel DESTE lado: nenhum caminho de escrita do app produz linha com a
  // chave `fatura:` e tipo diferente de 'transfer', e a unica linha que ela
  // separa (a despesa nascida do elo da HMO-305) ja e `expense` -- promove-la
  // para `expense` nao mudaria um centavo. Matar aquele mutante aqui exigiria
  // forjar, no teste, um estado que o app nao alcanca, e uma trava provada so
  // por estado forjado por fora nao prova nada.
  //
  // DESDE A HMO-317 ELE TEM TESTE DO OUTRO LADO, e e isso que mudou: na tela de
  // Despesas o mesmo criterio decide `natureza`, e o mutante
  // `fatura_paga_ignora_o_tipo_gravado` de
  // scripts/mutantes-telas-de-movimentacao.mjs MORRE. A guarda continua
  // invariante aqui; a lista daqui nao finge cobri-la.
  //
  // E `perna_sem_elo_pelo_sinal` MORAVA AQUI, com o `porque` "a perna de
  // entrada cujo par perdeu o elo (o FK e ON DELETE SET NULL) passa por perna
  // de saida". Ele saiu porque o modulo nao faz mais essa afirmacao em uma
  // linha propria: no dono, a perna sem elo e pega pelo SINAL dentro de
  // `ehPernaDeEntrada`, e a linha que sobrou no lugar dele decide outra coisa --
  // o zero (`par_de_valor_zero_e_promovido` acima). Reescrever a ancora
  // mantendo aquele `porque` daria um mutante medindo uma afirmacao que nao
  // existe mais; quem mede o sinal de `ehPernaDeEntrada` e
  // `entrada_so_pelo_elo`, no mutador do dono.
  {
    nome: "promove_como_receita",
    porque:
      "a fatura paga entra como RECEITA: o mes em que se pagou R$ 1.290 de " +
      "cartao passa a mostrar R$ 1.290 que ninguem recebeu",
    de: '      saida.push({ ...linha, transaction_type: "expense" });',
    para: '      saida.push({ ...linha, transaction_type: "income" });',
  },
  {
    nome: "muta_a_lista_de_entrada",
    porque:
      "a linha de origem e reescrita no lugar: a rota le a MESMA lista uma vez " +
      "por moeda, e o efeito a distancia nao aparece em nenhuma das duas funcoes",
    de: '      saida.push({ ...linha, transaction_type: "expense" });',
    para: '      linha.transaction_type = "expense";\n      saida.push(linha);',
  },

  // --- o contrato da consulta ---------------------------------------------
  {
    nome: "select_sem_o_embed_da_conta",
    porque:
      "a consulta para de pedir `account_type` -- a regra recebe `undefined` em " +
      "toda linha, nenhuma casa com credit_card, e o painel volta ao defeito " +
      "desta issue. Foi exatamente este o modo de falha da HMO-260",
    de: '  "amount, transaction_type, currency, notes, counterpart_transaction_id, account:financial_accounts(account_type)";',
    para: '  "amount, transaction_type, currency, notes, counterpart_transaction_id";',
  },
  {
    nome: "select_sem_notes",
    porque:
      "a consulta para de pedir `notes`: nenhuma perna de pagamento e " +
      "reconhecida como fatura, e o cartao desaparece do Realizado",
    de: '  "amount, transaction_type, currency, notes, counterpart_transaction_id, account:financial_accounts(account_type)";',
    para: '  "amount, transaction_type, currency, counterpart_transaction_id, account:financial_accounts(account_type)";',
  },
];

// `select_sem_o_embed_da_conta` e `select_sem_notes` mutam a MESMA string, e os
// dois estao aqui de proposito: o teste do `select` afirma coluna por coluna, e
// um unico mutante provaria apenas que ALGUMA coluna e cobrada.

const dir = mkdtempSync(join(tmpdir(), "mut265-"));
const dirLib = join(dir, "lib");
mkdirSync(dirLib, { recursive: true });
for (const dep of DEPENDENCIAS) copyFileSync(dep, join(dirLib, basename(dep)));

// O tsconfig temporario e a copia do scripts/tsconfig.realizado-do-caixa-
// test.json apontada para a arvore mutada. `baseUrl` no dir temporario e o que
// faz `@/lib/telas-de-movimentacao` achar a COPIA, e nao o arquivo do repo --
// que e exatamente o que permite mutar o DONO do criterio aqui (HMO-317).
const tsconfig = join(dir, "tsconfig.json");
writeFileSync(
  tsconfig,
  JSON.stringify({
    compilerOptions: {
      outDir: resolve(SAIDA),
      rootDir: dirLib,
      module: "es2020",
      target: "es2020",
      moduleResolution: "node",
      skipLibCheck: true,
      baseUrl: dir,
      paths: { "@/*": ["./*"] },
    },
    // A arvore INTEIRA, e nao so o arquivo mutado: o teste importa
    // `periodo-do-painel.js` do mesmo diretorio de saida, e um `include` com um
    // arquivo so nao o emitiria -- o node morreria em ERR_MODULE_NOT_FOUND e
    // TODO mutante "morreria" por import, nao por regra.
    include: [join(dirLib, "*.ts")],
  })
);

let falhas = 0;

/**
 * Compila a arvore e roda a suite, com UM arquivo mutado (ou nenhum).
 *
 * TODO arquivo mutavel e reescrito do original antes da mutacao, e nao so o
 * alvo: sem isso o mutante do DONO ficaria na arvore e o mutante seguinte --
 * que muta a FONTE -- rodaria contra um dono ja mutado, morrendo com o rotulo
 * mentindo sobre o que foi medido (HMO-317).
 */
function compilaERoda(alvo, fonteTs) {
  for (const [arquivo, conteudo] of ORIGINAIS) {
    writeFileSync(
      join(dirLib, basename(arquivo)),
      arquivo === alvo ? fonteTs : conteudo
    );
  }
  rmSync(SAIDA, { recursive: true, force: true });
  execFileSync("npx", ["tsc", "-p", tsconfig], { stdio: "pipe" });
  // O tsc resolve `@/` mas nao o reescreve no JS emitido -- o mesmo passo do
  // npm script, sem o qual o node morre em ERR_MODULE_NOT_FOUND e TODO mutante
  // "morre" por erro de import.
  execFileSync("node", ["scripts/resolve-aliases.mjs", SAIDA, "lib"], {
    stdio: "pipe",
  });
  execFileSync("node", ["--test", TESTE], {
    stdio: "pipe",
    env: { ...process.env, TZ: "America/Sao_Paulo" },
  });
}

try {
  // CONTROLE POSITIVO: com a arvore intacta o teste tem de PASSAR. Sem isto, um
  // "todos morreram" poderia significar apenas que o build esta quebrado -- por
  // uma dependencia que falta na lista acima, por exemplo -- e que o teste
  // reprova sempre.
  try {
    compilaERoda(null, null);
    console.log("controle positivo: o teste passa com a fonte intacta\n");
  } catch (e) {
    console.error("ABORTADO: o teste reprova com a fonte INTACTA.");
    console.error((e.stdout ?? e.stderr ?? "").toString().slice(-1500));
    process.exit(1);
  }

  for (const m of MUTANTES) {
    // O ALVO E DECLARADO, e a ancora e contada no arquivo DELE. Contar no
    // arquivo errado deixaria passar ancora ambigua -- e um `de` que nao existe
    // no alvo mas existe na FONTE sairia "valido" e mutaria nada (HMO-317).
    const alvo = m.alvo ?? FONTE;
    const original = ORIGINAIS.get(alvo);
    if (!original) {
      console.log(
        `  !! ${m.nome}: o alvo ${alvo} nao esta em ORIGINAIS -- mutante invalido`
      );
      falhas++;
      continue;
    }

    // `String.replace` troca a PRIMEIRA ocorrencia. Um trecho que aparece duas
    // vezes produz um mutante que muta o lugar errado e morre verde com o
    // rotulo mentindo sobre o que foi medido -- por isso o trecho tem de ser
    // UNICO, e nao apenas existir.
    const ocorrencias = original.split(m.de).length - 1;
    if (ocorrencias === 0) {
      console.log(
        `  !! ${m.nome}: o trecho a mutar NAO EXISTE MAIS em ${alvo} -- mutante invalido`
      );
      falhas++;
      continue;
    }
    if (ocorrencias > 1) {
      console.log(
        `  !! ${m.nome}: o trecho aparece ${ocorrencias}x em ${alvo} -- mutante ambiguo, invalido`
      );
      falhas++;
      continue;
    }

    const mutado = original.replace(m.de, m.para);

    let sobreviveu = false;
    try {
      compilaERoda(alvo, mutado);
      sobreviveu = true;
    } catch {
      // reprovou (ou nem compilou): e o esperado.
    }

    if (sobreviveu) {
      console.log(`  SOBREVIVEU  ${m.nome}  <-- nenhuma assercao protege isto`);
      console.log(`              (${m.porque})`);
      falhas++;
    } else {
      console.log(`  morreu      ${m.nome}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
  // Deixa o build em dia com a fonte de verdade, para o proximo
  // `npm run test:realizado-do-caixa` nao rodar contra um artefato mutado --
  // o .tmp-* compilado guarda o mutante mesmo depois de a fonte voltar.
  try {
    rmSync(SAIDA, { recursive: true, force: true });
    execFileSync("npm", ["run", "test:realizado-do-caixa"], { stdio: "pipe" });
  } catch {
    /* o controle positivo acima ja teria falhado */
  }
}

console.log();
if (falhas === 0) {
  console.log(`todos os ${MUTANTES.length} mutantes morreram`);
} else {
  console.log(`${falhas} mutante(s) sobreviveu/sobreviveram ou sao invalidos`);
  process.exit(1);
}
