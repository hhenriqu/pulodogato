#!/usr/bin/env node
// Mutantes da HMO-290 -- a fatura do periodo, e o que este mes cobra.
//
// POR QUE ISTO EXISTE
// -------------------
// As duas decisoes desta issue trocam a FONTE de um numero de dinheiro, e
// nenhuma delas levanta excecao quando esta errada: todas produzem um total
// plausivel na tela. O defeito original era exatamente isso -- "Fatura atual:
// R$ 3.000" num cartao onde o mes cobra R$ 300, sem erro nenhum, porque
// R$ 3.000 num cartao e um numero perfeitamente crivel.
//
// Cada mutante abaixo desfaz UMA decisao; a suite dele tem de ficar vermelha.
//
// COMO RODAR
//   npm run mutantes:fatura-do-periodo
//
// DOIS ALVOS, DUAS SUITES
// -----------------------
// `lib/safe-to-spend.ts` responde "quanto este mes cobra" (a armadilha 10) e
// `lib/fatura-do-periodo.ts` responde "qual e a fatura deste mes na tela". Os
// dois builds tem forma diferente -- um emite plano a partir de `lib/`, o outro
// espelha a raiz porque puxa `types/financial.ts` por import de tipo -- e por
// isso cada alvo traz o seu descritor de build em vez de haver um build so
// chutado para os dois.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao vive em memoria e e compilada de uma ARVORE TEMPORARIA, igual ao
// runner da HMO-265. Mutar, rodar e restaurar no `finally` deixa a fonte mutada
// no disco quando o processo morre no meio -- e um `trap` que restaura por cima
// apaga trabalho nao salvo.
//
// O QUE ESTA LISTA NAO COBRE, DE PROPOSITO
// ----------------------------------------
// O dia escolhido no recuo de `cobrancaDaFatura` (ultimo dia do mes da fatura).
// Nenhum teste distingue aquele dia do primeiro, e a razao e estrutural: quem
// le o resultado compara com o FIM do mes corrente, e qualquer dia dentro do
// mes da fatura responde igual. Um mutante ali sobreviveria -- e sobreviveria
// com razao. A escolha esta documentada na funcao como o que ela e: arbitraria
// dentro do mes, e nao uma regra que alguem possa quebrar.

import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, basename, dirname } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// OS DOIS ALVOS
// ---------------------------------------------------------------------------
// `arvore: "plana"` copia as dependencias direto em <tmp>/lib e emite com
// `rootDir` nele -- o JS sai em .tmp-x/<arquivo>.js, que e o caminho que o
// teste importa. `arvore: "espelhada"` preserva `lib/` e `types/` sob o tmp e
// emite com `rootDir` na raiz do tmp, saindo em .tmp-x/lib/<arquivo>.js.
//
// Se um destes descritores divergir do tsconfig de verdade, o CONTROLE
// POSITIVO aborta antes de qualquer mutante rodar -- e e para isso que ele
// existe.
const ALVOS = {
  "posso-gastar": {
    fonte: "lib/safe-to-spend.ts",
    dependencias: [
      "lib/net-worth.ts",
      "lib/card-invoice.ts",
      "lib/recurrence.ts",
      "lib/transferencia.ts",
      "lib/lancamento.ts",
    ],
    saida: ".tmp-safe-to-spend",
    teste: "scripts/test-safe-to-spend.mjs",
    arvore: "plana",
  },
  "fatura-na-tela": {
    fonte: "lib/fatura-do-periodo.ts",
    dependencias: [
      "lib/fatura-do-cartao.ts",
      "lib/offline-leitura.ts",
      "types/financial.ts",
    ],
    saida: ".tmp-fatura-do-periodo",
    teste: "scripts/test-tela-do-cartao.mjs",
    arvore: "espelhada",
  },
};

// A suite da tela renderiza o componente, e o build dela e OUTRO (jsx, os
// componentes de ui). Mutar `lib/fatura-do-periodo.ts` e rodar
// `test:tela-do-cartao` exigiria reproduzir aquele build inteiro aqui. Em vez
// disso o alvo da tela roda a suite PURA do modulo, e a suite da tela fica
// coberta pelo guard de fiacao (`check-fatura-escolhida`), que afirma que o
// componente chama estas funcoes.
ALVOS["fatura-na-tela"].teste = "scripts/test-fatura-do-periodo.mjs";

const MUTANTES = [
  // -------------------------------------------------------------------------
  // ALVO 1: "quanto este mes cobra" (lib/safe-to-spend.ts, armadilha 10)
  // -------------------------------------------------------------------------
  {
    alvo: "posso-gastar",
    nome: "divida_inteira_de_volta",
    porque:
      "O DEFEITO DESTA ISSUE, INTACTO: a divida do cartao volta a ser " +
      "descontada por inteiro, e uma compra de R$ 3.000 em 10x derruba o " +
      '"posso gastar" em R$ 3.000 no mes da compra',
    de: "        divida: dividaTotal - diferida,",
    para: "        divida: dividaTotal,",
  },
  {
    alvo: "posso-gastar",
    nome: "desconto_duplo_da_fatura_fechada",
    porque:
      "O MUTANTE QUE A ISSUE PEDE POR NOME. A conta prevista da fatura " +
      "fechada volta para `compromissos`, por cima da mesma fatura que ja esta " +
      "no saldo do cartao: a armadilha 1 de volta, descontando a fatura duas " +
      'vezes e dizendo que a pessoa pode gastar metade do que pode',
    de: "    if (ehFatura(p.notes)) continue;",
    para: "    if (false) continue;",
  },
  {
    alvo: "posso-gastar",
    nome: "horizonte_exclui_o_ultimo_dia",
    porque:
      "a fatura que vence no dia 30 de um mes de 30 dias passa a ser " +
      '"futura": o mes deixa de descontar a propria fatura, e o numero vira ' +
      "otimista justamente na semana em que ela vence",
    de: "    if (cobranca <= ate) continue;",
    para: "    if (cobranca < ate) continue;",
  },
  {
    alvo: "posso-gastar",
    nome: "estorno_futuro_abate_o_diferido",
    porque:
      "uma fatura futura NEGATIVA passa a reduzir o diferido, e o credito que " +
      "so chega em novembro vira desconto de hoje -- fatura futura so pode " +
      "adiar dinheiro, nunca traze-lo para ca",
    de: "    if (total <= 0) continue;",
    para: "    if (total < 0 && false) continue;",
  },
  {
    alvo: "posso-gastar",
    nome: "diferido_sem_o_teto_da_divida",
    porque:
      "quem pagou parcelas adiantado tem a divida menor que as faturas da " +
      'view, e sem o teto `divida - futuras` fica NEGATIVO: o "posso gastar" ' +
      "SOBE de degrau por causa de um pagamento ja feito",
    de: "      Math.max(0, futurasPorCartao.get(conta.id) ?? 0),\n        dividaTotal\n      );",
    para: "      Math.max(0, futurasPorCartao.get(conta.id) ?? 0),\n        Infinity\n      );",
  },
  {
    alvo: "posso-gastar",
    nome: "vencimento_ilegivel_vira_futuro",
    porque:
      "a comparacao e de string: um `due_date` que nao da para ler sai MAIOR " +
      "que qualquer data ISO e a fatura vira futura -- deixa de ser descontada " +
      "por causa de um campo quebrado",
    de: "  if (fatura.due_date && /^\\d{4}-\\d{2}-\\d{2}$/.test(fatura.due_date)) {",
    para: "  if (fatura.due_date) {",
  },
  {
    alvo: "posso-gastar",
    nome: "diferido_somado_no_livre",
    porque:
      'o jeito mais facil de estragar isto: somar o diferido de volta "para ' +
      'nao perder o numero". O livre e disponivel menos o que ESTE mes cobra',
    de: "    dividaDeCartao -\n    reservaDeMetas;",
    para: "    dividaDeCartao -\n    dividaDiferida -\n    reservaDeMetas;",
  },

  // -------------------------------------------------------------------------
  // ALVO 2: "qual e a fatura deste mes na tela" (lib/fatura-do-periodo.ts)
  // -------------------------------------------------------------------------
  {
    alvo: "fatura-na-tela",
    nome: "cartao_ausente_vira_zero",
    porque:
      "o cartao que a resposta nao trouxe passa a valer R$ 0,00 -- o zero " +
      "confiante, embaixo do nome do cartao certo, indistinguivel de um mes " +
      "sem compra nenhuma",
    de: "  if (!fatura) return null;\n  return numeroOuNulo(fatura.total);",
    para: "  if (!fatura) return 0;\n  return numeroOuNulo(fatura.total);",
  },
  {
    alvo: "fatura-na-tela",
    nome: "soma_parcial_passa",
    porque:
      'o cartao sem fatura e PULADO em vez de zerar o total: "Faturas em ' +
      'aberto" mostra a soma dos outros -- um numero menor que o certo, ' +
      "plausivel, e sem nada na tela dizendo que falta uma parcela dele",
    de: "    if (parcial === null) return null;\n    soma += parcial;",
    para: "    if (parcial === null) continue;\n    soma += parcial;",
  },
  {
    alvo: "fatura-na-tela",
    nome: "fatura_em_modulo",
    porque:
      "o mes que produziu mais estorno que compra tem fatura negativa de " +
      "verdade (o cartao deve a voce). `Math.abs` ali faz um credito de R$ 50 " +
      "aparecer como R$ 50 a pagar",
    de: "  return numeroOuNulo(fatura.total);",
    para: "  const v = numeroOuNulo(fatura.total);\n  return v === null ? null : Math.abs(v);",
  },
  {
    alvo: "fatura-na-tela",
    nome: "parcelas_contadas_pelo_total",
    porque:
      "as parcelas que faltam passam a ser o TOTAL da serie: a parcela 10 de " +
      "10 ainda anuncia nove por vir, e a 1 de 10 anuncia dez",
    de: "    const faltam = total - numero;",
    para: "    const faltam = total;",
  },
  {
    alvo: "fatura-na-tela",
    nome: "parcela_torta_vira_negativa",
    porque:
      'dado torto ("parcela 12 de 10") produz -2 parcelas, e o negativo ABATE ' +
      "o aviso das outras compras do mesmo cartao",
    de: "    if (faltam <= 0) continue;",
    para: "    if (faltam <= 0 && false) continue;",
  },
  {
    alvo: "fatura-na-tela",
    nome: "estorno_parcelado_vira_credito_futuro",
    porque:
      "uma linha negativa multiplicada pelas parcelas que faltam vira um " +
      "comprometimento NEGATIVO, que abate o das outras compras",
    de: "    if (valor === null || valor <= 0) continue;",
    para: "    if (valor === null) continue;",
  },
  {
    alvo: "fatura-na-tela",
    nome: "parcela_de_outro_cartao_entra",
    porque:
      "a RLS de `financial_transactions` tem um OR para membro de grupo (002), " +
      "entao a view PODE devolver a compra de outro cartao: sem o filtro, a " +
      "sobra dela e anunciada embaixo do nome deste cartao",
    de: "    if (linha.account_id !== accountId) continue;",
    para: "    if (false) continue;",
  },
  {
    alvo: "fatura-na-tela",
    nome: "parcela_fracionaria_passa",
    porque:
      "`numeric` do PostgREST chega como texto, e um 2.5 em `installment_number` " +
      'produz "8,5 parcelas que faltam" -- um comprometimento com centavos ' +
      "inventados, derivado de um par que o banco nunca deveria ter aceito",
    de: "    if (!Number.isInteger(numero) || !Number.isInteger(total)) continue;",
    para: "    if (false) continue;",
  },

  // NAO EXISTE MUTANTE PARA `if (!numero || !total) continue;`, E ISSO E
  // DELIBERADO. Ele existiu e morreu por BUILD, nao por regra: as duas colunas
  // sao `number | null | undefined`, e qualquer mutacao que afrouxe a guarda
  // deixa `total` possivelmente nulo na linha seguinte -- o `tsc` estrito para
  // ali (TS18049). A guarda e cobrada pelo TIPO, nao pela suite, e um mutante
  // que morre por nao compilar faria o placar mentir a favor. Ela fica no
  // codigo porque e a declaracao da intencao (e porque o par meio preenchido
  // tem CHECK no banco, `financial_transactions_installment_coerente`), mas nao
  // da para medir por remocao. Ha teste para o comportamento dela
  // ("linha com so UMA das duas colunas de parcela nao vira NaN") -- o que nao
  // ha e um mutante valido.
];

// ---------------------------------------------------------------------------
// O HARNESS
// ---------------------------------------------------------------------------

/** Monta a arvore temporaria de um alvo e devolve como compilar e rodar. */
function prepara(nomeDoAlvo) {
  const alvo = ALVOS[nomeDoAlvo];
  const dir = mkdtempSync(join(tmpdir(), `mut290-${nomeDoAlvo}-`));

  const plana = alvo.arvore === "plana";
  const destinoDe = (caminho) =>
    plana ? join(dir, "lib", basename(caminho)) : join(dir, caminho);

  for (const arquivo of [alvo.fonte, ...alvo.dependencias]) {
    const destino = destinoDe(arquivo);
    mkdirSync(dirname(destino), { recursive: true });
    copyFileSync(arquivo, destino);
  }

  // `baseUrl` no dir temporario e o que faz `@/lib/net-worth` achar a COPIA, e
  // nao o arquivo do repo -- sem isso o mutante compilaria contra a fonte
  // intacta e sobreviveria sempre, com o placar mentindo a favor.
  const tsconfig = join(dir, "tsconfig.json");
  writeFileSync(
    tsconfig,
    JSON.stringify({
      compilerOptions: {
        outDir: resolve(alvo.saida),
        rootDir: plana ? join(dir, "lib") : dir,
        module: "es2020",
        target: "es2020",
        moduleResolution: "node",
        esModuleInterop: true,
        skipLibCheck: true,
        strict: true,
        baseUrl: dir,
        paths: { "@/*": ["./*"] },
      },
      // A arvore INTEIRA, e nao so o arquivo mutado: o teste importa os irmaos
      // do mesmo diretorio de saida, e um `include` com um arquivo so nao os
      // emitiria -- o node morreria em ERR_MODULE_NOT_FOUND e TODO mutante
      // "morreria" por import, nao por regra.
      include: [join(dir, "**/*.ts")],
    })
  );

  return {
    alvo,
    destinoDaFonte: destinoDe(alvo.fonte),
    tsconfig,
    espelhaRaiz: !plana,
  };
}

const preparados = new Map();
for (const nome of Object.keys(ALVOS)) preparados.set(nome, prepara(nome));

const originais = new Map();
for (const nome of Object.keys(ALVOS)) {
  originais.set(nome, readFileSync(ALVOS[nome].fonte, "utf8"));
}

function compilaERoda(nomeDoAlvo, fonteTs) {
  const { alvo, destinoDaFonte, tsconfig, espelhaRaiz } =
    preparados.get(nomeDoAlvo);

  writeFileSync(destinoDaFonte, fonteTs);
  rmSync(alvo.saida, { recursive: true, force: true });
  execFileSync("npx", ["tsc", "-p", tsconfig], { stdio: "pipe" });

  // O tsc resolve `@/` mas nao o reescreve no JS emitido -- o mesmo passo do
  // npm script, sem o qual o node morre em ERR_MODULE_NOT_FOUND e TODO mutante
  // "morre" por erro de import.
  const args = ["scripts/resolve-aliases.mjs", alvo.saida, "lib"];
  if (espelhaRaiz) args.push("--espelha-raiz");
  execFileSync("node", args, { stdio: "pipe" });

  execFileSync("node", ["--test", alvo.teste], {
    stdio: "pipe",
    env: { ...process.env, TZ: "America/Sao_Paulo" },
  });
}

let falhas = 0;

// CONTROLE POSITIVO, por alvo: com a fonte intacta a suite tem de PASSAR. Sem
// isto, um "todos morreram" poderia significar apenas que o build esta
// quebrado -- por uma dependencia que falta na lista acima, por exemplo -- e
// que a suite reprova sempre.
for (const nome of Object.keys(ALVOS)) {
  try {
    compilaERoda(nome, originais.get(nome));
    console.log(`controle positivo (${nome}): a suite passa com a fonte intacta`);
  } catch (e) {
    console.error(`ABORTADO: a suite de ${nome} reprova com a fonte INTACTA.`);
    console.error((e.stdout ?? e.stderr ?? "").toString().slice(-2000));
    process.exit(1);
  }
}
console.log("");

for (const m of MUTANTES) {
  const original = originais.get(m.alvo);

  // `String.replace` troca a PRIMEIRA ocorrencia. Um trecho que aparece duas
  // vezes produz um mutante que muta o lugar errado e morre verde com o rotulo
  // mentindo sobre o que foi medido -- por isso o trecho tem de ser UNICO, e
  // nao apenas existir.
  const ocorrencias = original.split(m.de).length - 1;
  if (ocorrencias === 0) {
    console.log(
      `  !! ${m.nome}: o trecho a mutar NAO EXISTE MAIS -- mutante invalido`
    );
    falhas++;
    continue;
  }
  if (ocorrencias > 1) {
    console.log(
      `  !! ${m.nome}: o trecho aparece ${ocorrencias}x -- mutante ambiguo, invalido`
    );
    falhas++;
    continue;
  }

  const mutado = original.replace(m.de, m.para);
  // A mutacao tem de ter MUDADO algo: `de` identico a `para` passaria por
  // mutante e mediria a fonte intacta.
  if (mutado === original) {
    console.log(`  !! ${m.nome}: a troca nao mudou o arquivo -- mutante vazio`);
    falhas++;
    continue;
  }

  let morreu = false;
  let porImporte = false;

  try {
    compilaERoda(m.alvo, mutado);
  } catch (e) {
    morreu = true;
    const saida = (e.stdout ?? "").toString() + (e.stderr ?? "").toString();
    // Um mutante que nao COMPILA, ou que morre em ERR_MODULE_NOT_FOUND, "morre"
    // pelo motivo errado: o placar mentiria a favor.
    porImporte =
      saida.includes("ERR_MODULE_NOT_FOUND") || saida.includes("error TS");
    if (porImporte) {
      console.log(
        `  !! ${m.nome}: morreu por BUILD, nao por regra -- mutante invalido`
      );
      console.log(`     ${saida.split("\n").find((l) => l.trim()) ?? ""}`);
      falhas++;
      continue;
    }
  }

  if (morreu) {
    console.log(`  ok ${m.nome} [${m.alvo}]: morreu`);
  } else {
    console.log(`  SOBREVIVEU ${m.nome} [${m.alvo}]`);
    console.log(`     ${m.porque}`);
    falhas++;
  }
}

// A fonte do disco nunca foi tocada -- a mutacao viveu na arvore temporaria.
// Ainda assim, o ultimo build deixou a saida compilada A PARTIR DO MUTANTE em
// `.tmp-*`: um `node --test` rodado na mao depois disto mediria o mutante, nao
// o codigo. Por isso a saida e refeita da fonte intacta no fim.
for (const nome of Object.keys(ALVOS)) {
  try {
    compilaERoda(nome, originais.get(nome));
  } catch {
    console.error(
      `AVISO: nao deu para refazer ${ALVOS[nome].saida} a partir da fonte intacta.`
    );
  }
}

console.log("");
if (falhas > 0) {
  console.error(
    `${falhas} mutante(s) sobreviveram ou sao invalidos -- a suite nao esta ` +
      `provando o que diz provar.`
  );
  process.exit(1);
}
console.log(`todos os ${MUTANTES.length} mutantes morreram.`);
