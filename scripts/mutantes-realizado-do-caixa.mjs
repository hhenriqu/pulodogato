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
// ALGUNS MUTANTES MUTAM lib/fatura-paga-no-resultado.ts, E NAO A FONTE
// --------------------------------------------------------------------
// Da HMO-317 ate a fase 5 tres mutantes daqui mutavam `ehPagamentoDaFatura`,
// em lib/telas-de-movimentacao.ts: o painel promovia a perna de saida do
// pagamento por aquele criterio. Desde a fase 6 (RN017.4, 072) o painel nao le
// mais a perna -- a fatura entra pelas linhas de `card_invoice_paid_entries`,
// somadas por `faturasPagasComoTransacoes` --, e aqueles tres mediriam uma
// dependencia que nao existe. Quem mede `ehPagamentoDaFatura` agora e so
// scripts/mutantes-telas-de-movimentacao.mjs, onde ela decide o selo.
//
// No lugar deles entram os mutantes da SOMA da fatura, que mora em
// lib/fatura-paga-no-resultado.ts. Cada mutante declara em `alvo` QUAL arquivo
// da arvore ele muta (a FONTE, por omissao), e a mutacao e verificada contra
// ESTA suite, que agrega pelo `agregarTransacoes` da rota. Mutar a soma aqui nao
// custa arvore nova: ela JA e copiada como dependencia.
//
// `compilaERoda` reescreve TODOS os arquivos mutaveis a partir do original antes
// de aplicar a mutacao. Sem isso o mutante da soma ficaria na arvore e o
// seguinte -- que muta a FONTE -- rodaria contra uma soma ja mutada, morrendo
// com o rotulo mentindo sobre o que foi medido.

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
 * A SOMA da fatura paga -- fase 6. Ela e dependencia E alvo de mutante (ver o
 * cabecalho), e e por isso que ela tem nome proprio aqui.
 */
const SOMA_DA_FATURA = "lib/fatura-paga-no-resultado.ts";
const DEPENDENCIAS = [
  "lib/telas-de-movimentacao.ts",
  SOMA_DA_FATURA,
  // `fatura-paga-no-resultado` importa o tipo e a constante de categoria daqui.
  "lib/categorias-do-periodo.ts",
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
  // A TERCEIRA, PELO MESMO MOTIVO E PELA MESMA ROTA -- HMO-487.
  //
  // `fora-dos-totais` nasceu na HMO-452/453 e passou a ser importada por DOIS
  // arquivos desta arvore: `realizado-do-caixa.ts` (o tipo `LinhaComTotais`) e
  // `movimentacoes.ts`. Nos dois casos e `import type`, e e por isso que a
  // ausencia dela nao deixa rastro no JS emitido -- mas o tsc precisa do
  // arquivo para RESOLVER o tipo, entao a arvore isolada nao compila e o
  // controle positivo abortou com dois TS2307 desde que a HMO-453 mergeou.
  //
  // O ESTRAGO AQUI NAO FOI PLACAR INFLADO, FOI PLACAR NENHUM: o controle
  // positivo abortou antes de qualquer mutante, exatamente como o bloco acima
  // descreve, e os 12 mutantes deste modulo ficaram sem rodar. `import type`
  // conta como import para este guard justamente porque o tsc nao distingue na
  // hora de resolver.
  //
  // E O QUE O ABORTO ESCONDIA, alem dos 12: DOIS deles (`select_sem_notes` e
  // `select_sem_o_embed_da_conta`) tinham a ancora velha, porque a MESMA
  // HMO-452 que trouxe este import tambem pos `include_in_total` no
  // `COLUNAS_DO_REALIZADO_DE_CAIXA`. Re-ancorados na HMO-487.
  "lib/fora-dos-totais.ts",
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
  [FONTE, SOMA_DA_FATURA].map((arquivo) => [
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
      "o mes em que a fatura vence perde o valor dela: R$ 1.290 a menos no " +
      "Realizado, e um total MENOR nao parece erro, parece um mes barato (HMO-264)",
    de: "    saida.push(fatura);",
    para: "    void fatura;",
  },
  {
    nome: "muta_a_lista_de_entrada",
    porque:
      "a regra tira e acrescenta linha no PROPRIO array: a rota le a MESMA " +
      "lista uma vez por moeda, e o efeito a distancia nao aparece em nenhuma " +
      "das duas funcoes",
    de: "  const saida: LinhaDoRealizado[] = [];",
    para: "  const saida = linhas as unknown as LinhaDoRealizado[];",
  },

  // OS MUTANTES DO CRITERIO DA PERNA DE SAIDA SAIRAM NA FASE 6, junto com a
  // promocao dela (`promove_como_receita`, `as_duas_pernas_entram`,
  // `par_de_valor_zero_e_promovido`, `fatura_sem_a_chave`). Ver o cabecalho.

  // --- a soma da fatura, que mora em lib/fatura-paga-no-resultado.ts --------
  //
  // Os tres abaixo mutam a SOMA dentro da arvore isolada, e nao a FONTE. O que
  // eles provam e que o caminho de dinheiro do PAINEL depende de cada decisao
  // de la -- e as tres dao um total plausivel.
  {
    nome: "estorno_soma_na_fatura",
    alvo: SOMA_DA_FATURA,
    porque:
      "o estorno no cartao passa a SOMAR na fatura em vez de abater: a fatura " +
      "de R$ 300 com um estorno de R$ 40 sai R$ 340, e nao R$ 260",
    de: "    fatura.total += valorDaLinha(linha);",
    para: "    fatura.total += Math.abs(valorDaLinha(linha));",
  },
  {
    nome: "fatura_negativa_vira_despesa",
    alvo: SOMA_DA_FATURA,
    porque:
      "a fatura de total negativo (estorno maior que as compras) sai `expense`: " +
      "os agregadores somam `Math.abs` pelo tipo, e ela SOBE a despesa do mes em " +
      "vez de baixa-la -- o Resultado deixa de ser o do banco",
    de: '      transaction_type: fatura.total > 0 ? "expense" : "income",',
    para: '      transaction_type: "expense",',
  },
  {
    nome: "fatura_soma_a_linha_fora_dos_totais",
    alvo: SOMA_DA_FATURA,
    porque:
      "a linha da fatura que a pessoa tirou dos totais (060) volta a somar no " +
      "Realizado: a fatura do banco a contem, e o Resultado nao",
    // A LINHA DE CIMA ESTA NA ANCORA pela trava de ambiguidade: o `for` sobre
    // `apenasNosTotais(linhas)` existe tambem em `faturasPagasPorCategoria`, no
    // mesmo arquivo. O `Map<string, FaturaPaga>` diz que a funcao cegada e
    // `faturasPagas`, que e a que o painel le.
    de:
      "  const porFatura = new Map<string, FaturaPaga>();\n\n" +
      "  for (const linha of apenasNosTotais(linhas)) {",
    para:
      "  const porFatura = new Map<string, FaturaPaga>();\n\n" +
      "  for (const linha of linhas) {",
  },

  // --- o contrato da consulta ---------------------------------------------
  {
    nome: "select_sem_o_embed_da_conta",
    porque:
      "a consulta para de pedir `account_type` -- a regra recebe `undefined` em " +
      "toda linha, nenhuma casa com credit_card, e o painel volta a contar o " +
      "cartao duas vezes. Foi exatamente este o modo de falha da HMO-260",
    de: '  "amount, transaction_type, currency, include_in_total, account:financial_accounts(account_type)";',
    para: '  "amount, transaction_type, currency, include_in_total";',
  },
  {
    nome: "select_sem_include_in_total",
    porque:
      "a consulta para de pedir `include_in_total`: o campo chega `undefined`, " +
      "o `!== false` deixa tudo passar, e a linha que a pessoa tirou dos " +
      "relatorios volta a contar no painel (HMO-453)",
    de: '  "amount, transaction_type, currency, include_in_total, account:financial_accounts(account_type)";',
    para: '  "amount, transaction_type, currency, account:financial_accounts(account_type)";',
  },
];

// `select_sem_o_embed_da_conta` e `select_sem_include_in_total` mutam a MESMA
// string, e os dois estao aqui de proposito: o teste do `select` afirma coluna
// por coluna, e um unico mutante provaria apenas que ALGUMA coluna e cobrada.

const dir = mkdtempSync(join(tmpdir(), "mut265-"));
const dirLib = join(dir, "lib");
mkdirSync(dirLib, { recursive: true });
for (const dep of DEPENDENCIAS) copyFileSync(dep, join(dirLib, basename(dep)));

// O tsconfig temporario e a copia do scripts/tsconfig.realizado-do-caixa-
// test.json apontada para a arvore mutada. `baseUrl` no dir temporario e o que
// faz `@/lib/fatura-paga-no-resultado` achar a COPIA, e nao o arquivo do
// repo -- que e exatamente o que permite mutar a soma da fatura aqui.
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
 * alvo: sem isso o mutante da SOMA ficaria na arvore e o mutante seguinte --
 * que muta a FONTE -- rodaria contra uma soma ja mutada, morrendo com o rotulo
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
