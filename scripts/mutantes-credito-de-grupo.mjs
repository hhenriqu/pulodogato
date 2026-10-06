#!/usr/bin/env node
// Mutantes de lib/credito-de-grupo.ts -- HMO-245, fase 10.
//
// POR QUE ISTO EXISTE
// -------------------
// `npm run test:credito-de-grupo` passa com 17 blocos verdes nos dois fusos, e
// o bloco principal afirma que o Helio tem R$ 106,60 a receber da Lais e da
// Bia. Esse numero sai certo por caminhos errados: o mes do exemplo tem UMA
// conta e DOIS devedores com a mesma parte, entao somar o saldo em vez das
// linhas, ou trocar o lado da transferencia, devolve 106,60 do mesmo jeito.
// Cada mutante abaixo desfaz UMA decisao; o teste tem que ficar vermelho em
// todos.
//
// O MUTANTE QUE MAIS IMPORTA E O `total_do_saldo`
// ----------------------------------------------
// Havia duas maneiras de produzir o numero grande do cartao -- somar
// `por_membro[].saldo` positivo, ou somar as linhas por devedor -- e elas
// CONCORDAM em todo mes que fecha. E por isso que escolher a errada e barato e
// invisivel: o defeito so aparece no mes em que `simplifySettlements` descarta
// o centavo de tolerancia, e a unica forma de notar na tela seria somar a lista
// a mao. O mutante poe o residuo de volta no total; se o teste nao reclamar, a
// assercao do total nao esta medindo de onde ele vem.
//
// O SEGUNDO E O `credito_por_valor`
// ---------------------------------
// `SuggestedTransfer.amount` e sempre POSITIVO nos dois sentidos -- a
// transferencia em que eu pago a Ana tem o mesmo sinal da em que ela me paga.
// Filtrar por valor em vez de por `to_user_id` devolve as duas, e o mes em que
// eu DEVO R$ 300 aparece como R$ 300 a receber: o numero certo, com o sinal
// invertido, na tela de receita.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// Mesma escolha do mutantes-fechamento-do-grupo.mjs: a mutacao e compilada de
// uma arvore TEMPORARIA. Mutar, rodar e restaurar no `finally` deixa a fonte
// mutada no disco quando o processo morre no meio.
//
// A ARVORE TEMPORARIA E O lib/ INTEIRO, DE PROPOSITO
// --------------------------------------------------
// O teste importa TRES modulos compilados (o credito, o fechamento que o
// alimenta e `parte-de-grupo-na-lista`, de onde sai o numero de verdade do
// cartao "Receitas"), e esses tres arrastam `settlement` e `movimentacoes`.
// Copiar so as dependencias de hoje deixa o runner quebrado no dia em que
// alguem adiciona um import -- e um mutante que nao COMPILA "morre" por motivo
// errado, o que faz o placar mentir A FAVOR. Copiar lib/ inteiro custa 1,4 MB e
// nao tem esse modo de falha.
//
// COMO RODAR
//   npm run mutantes:credito-de-grupo

import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  cpSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const FONTE = "lib/credito-de-grupo.ts";
const SAIDA = ".tmp-credito-de-grupo";
const TESTE = "scripts/test-credito-de-grupo.mjs";

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  {
    nome: "total_do_saldo",
    porque:
      "o total do cartao passa a ser o meu SALDO (linhas + residuo) em vez da " +
      "soma das linhas: o numero grande fica acima da soma dos nomes listados, " +
      "e a unica forma de achar a diferenca seria somar a lista a mao",
    de: "    (soma, l) => soma + l.cents,\n    0\n  );",
    para: "    (soma, l) => soma + l.cents,\n    semDevedorCents\n  );",
  },
  {
    nome: "credito_por_valor",
    porque:
      "filtra por valor positivo em vez de por `to_user_id` -- e `amount` e " +
      "positivo nos DOIS sentidos, entao o mes em que eu devo R$ 300 aparece " +
      "como R$ 300 a receber na tela de receita",
    de:
      "    .filter((t) => t.to_user_id === viewerUserId)\n" +
      "    .map((t) => ({",
    para:
      "    .filter((t) => (Number(t.amount) || 0) > 0)\n" +
      "    .map((t) => ({",
  },
  {
    nome: "lado_invertido",
    porque:
      "lista como devedor justamente quem eu tenho de PAGAR: a tela de receita " +
      "exibe a minha divida como credito meu",
    de:
      "    .filter((t) => t.to_user_id === viewerUserId)\n" +
      "    .map((t) => ({",
    para:
      "    .filter((t) => t.from_user_id === viewerUserId)\n" +
      "    .map((t) => ({",
  },
  {
    nome: "residuo_sem_piso",
    porque:
      "o mes em que eu DEVO produz residuo negativo, e num periodo misto ele " +
      "subtrai do residuo do mes em que eu recebo -- uma conta que nao " +
      "significa nada, escrita na tela como 'sem devedor identificado'",
    // OS DOIS `Math.max` DE UMA VEZ, E NAO UM DE CADA VEZ.
    //
    // Eles sao redundantes ENTRE SI: no mes em que eu devo, `nomeadoCents` e
    // zero (nao ha transferencia para mim), entao prender o saldo em zero antes
    // da subtracao e prender a diferenca depois chegam ao mesmo zero. Remover
    // so um sobrevive -- e sobrevive COM RAZAO, porque o outro ainda faz o
    // trabalho. Foi o que dois mutantes separados mostraram.
    //
    // A decisao que o modulo toma e uma so ("o residuo tem piso zero"), e e ela
    // que este mutante desfaz.
    de:
      "  const saldoCents = Math.max(0, toCents(saldo?.saldo ?? 0));",
    para: "  const saldoCents = toCents(saldo?.saldo ?? 0);",
    tambem: {
      de: "  return Math.max(0, saldoCents - nomeadoCents);",
      para: "  return saldoCents - nomeadoCents;",
    },
  },
  {
    nome: "nome_apagado",
    porque:
      "o nome que veio num mes e sumiu no outro (perfil que deixou de ser " +
      "legivel) APAGA o que a tela ja tinha, e a linha cai no rotulo de " +
      "fallback com o nome disponivel",
    de: "        atual.devedor = atual.devedor ?? linha.devedor;",
    para: "        atual.devedor = linha.devedor;",
  },
  {
    nome: "chave_sem_grupo",
    porque:
      "agrega so por devedor: a Lais me devendo na Casa e na Viagem vira UMA " +
      "linha, com o nome de um grupo so e o valor dos dois",
    de: "      const chave = `${linha.group_id}\\0${linha.devedor_user_id}`;",
    para: "      const chave = `${linha.devedor_user_id}`;",
  },
  {
    nome: "chave_sem_devedor",
    porque:
      "agrega so por grupo: a Lais e a Bia viram UMA linha de R$ 106,60 com o " +
      "nome de uma das duas -- a issue pede por grupo E por devedor",
    de: "      const chave = `${linha.group_id}\\0${linha.devedor_user_id}`;",
    para: "      const chave = `${linha.group_id}`;",
  },
  {
    nome: "soma_em_reais",
    porque:
      "acumula REAIS em ponto flutuante no lugar de centavos inteiros: doze " +
      "meses e tres grupos deixam residuo de fracao de centavo e o total chega " +
      "na tela diferente da soma visivel das linhas",
    de: "        porDevedor.set(chave, { ...linha, cents: toCents(linha.valor) });",
    para: "        porDevedor.set(chave, { ...linha, cents: linha.valor });",
  },
  {
    nome: "ordem_sem_desempate",
    porque:
      "dois devedores com o MESMO valor trocam de lugar entre dois " +
      "carregamentos da mesma tela, sem nada ter mudado",
    de:
      "    .sort(\n" +
      "      (a, b) =>\n" +
      "        b.cents - a.cents ||\n" +
      "        a.grupo.localeCompare(b.grupo) ||\n" +
      "        a.devedor_user_id.localeCompare(b.devedor_user_id)\n" +
      "    )",
    para: "    .sort((a, b) => b.cents - a.cents)",
  },
  {
    nome: "rotulo_em_branco",
    porque:
      "`full_name` com so espaco em branco -- que existe no banco -- passa o " +
      "teste de vazio e a linha sai com o rotulo EM BRANCO, que e exatamente o " +
      "defeito que o fallback existe para nao ter",
    de: '  const limpo = (linha.devedor ?? "").trim();',
    para: '  const limpo = linha.devedor ?? "";',
  },
  {
    nome: "nota_sem_grupos_distintos",
    porque:
      "a frase do cartao de Receitas conta LINHAS no lugar de grupos: a Lais e " +
      "a Bia na mesma Casa se leem como 'em 2 grupos'",
    de: "    grupos: new Set(credito.linhas.map((l) => l.group_id)).size,",
    para: "    grupos: credito.linhas.length,",
  },
  {
    nome: "nota_sempre_existe",
    porque:
      "quem nao participa de grupo nenhum passa a ler '+ R$ 0,00 a receber de " +
      "0 pessoas em 0 grupos' embaixo de Receitas -- ruido que parece recurso " +
      "quebrado",
    de: "  if (credito.linhas.length === 0) return null;",
    para: "  if (false) return null;",
  },
];
//
// NOTA SOBRE DOIS MUTANTES QUE NAO ENTRARAM SEPARADOS
// ---------------------------------------------------
// Os dois `Math.max(0, ...)` de `creditoSemDevedorCents` comecaram como dois
// mutantes, um por guarda. Os dois SOBREVIVERAM, e sobreviveram com razao: no
// mes em que eu devo, `nomeadoCents` e zero, entao prender o saldo em zero
// antes da subtracao e prender a diferenca depois chegam ao mesmo resultado --
// cada guarda cobre a outra, e nenhum teste consegue distinguir a remocao de
// uma so ([[mutante-sobrevivente-pode-estar-certo]]).
//
// Trocar os dois por um mutante unico (`residuo_sem_piso`) e o que mede a
// decisao de verdade, que e uma: o residuo tem piso zero. As duas guardas ficam
// no modulo -- redundancia barata em codigo de dinheiro --, mas o placar nao
// finge que ha duas decisoes onde ha uma.

const dir = mkdtempSync(join(tmpdir(), "mut277-"));
const dirLib = join(dir, "lib");
mkdirSync(dirLib, { recursive: true });
// lib/ inteiro: ver o cabecalho. `.ts` apenas -- nao ha outro tipo de arquivo
// em lib/, e copiar so o que o tsc le mantem a arvore pequena.
cpSync("lib", dirLib, { recursive: true });

// O tsconfig temporario e a copia do scripts/tsconfig.credito-de-grupo-test
// .json apontada para a arvore mutada. `baseUrl` no dir temporario e o que faz
// `@/lib/...` achar a COPIA, e nao o arquivo do repo.
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
    include: [
      join(dirLib, "credito-de-grupo.ts"),
      join(dirLib, "fechamento-do-grupo.ts"),
      join(dirLib, "parte-de-grupo-na-lista.ts"),
    ],
  })
);

let falhas = 0;

function compilaERoda(fonteTs) {
  writeFileSync(join(dirLib, "credito-de-grupo.ts"), fonteTs);
  rmSync(SAIDA, { recursive: true, force: true });
  execFileSync("npx", ["tsc", "-p", tsconfig], { stdio: "pipe" });
  // O tsc resolve `@/` mas nao o reescreve no JS emitido -- o mesmo passo do
  // npm script, sem o qual o node morre em ERR_MODULE_NOT_FOUND e TODO mutante
  // "morre" por erro de import.
  execFileSync("node", ["scripts/resolve-aliases.mjs", SAIDA, "lib"], {
    stdio: "pipe",
  });
  // Um fuso basta para matar mutante: o que o segundo fuso prova e que o
  // recorte do mes nao passa por `Date`, e isso e assercao do npm script, que
  // roda os dois. America/Sao_Paulo e o fuso negativo -- o que e capaz de
  // falhar.
  execFileSync("node", ["--test", TESTE], {
    stdio: "pipe",
    env: { ...process.env, TZ: "America/Sao_Paulo" },
  });
}

try {
  // CONTROLE POSITIVO: com a fonte intacta o teste tem de PASSAR. Sem isto, um
  // "todos morreram" poderia significar apenas que o build esta quebrado e o
  // teste reprova sempre.
  try {
    compilaERoda(original);
    console.log("controle positivo: o teste passa com a fonte intacta\n");
  } catch (e) {
    console.error("ABORTADO: o teste reprova com a fonte INTACTA.");
    console.error((e.stdout ?? e.stderr ?? "").toString().slice(-1500));
    process.exit(1);
  }

  for (const m of MUTANTES) {
    // `String.replace` troca a PRIMEIRA ocorrencia. Um trecho que aparece duas
    // vezes produz um mutante que muta o lugar errado e morre verde com o
    // rotulo mentindo sobre o que foi medido -- por isso o trecho tem de ser
    // unico, e nao apenas existir.
    //
    // `credito_por_valor` e `lado_invertido` mutam o MESMO filtro, e o `.map(`
    // da linha de baixo e o que torna o trecho unico: o outro
    // `to_user_id === viewerUserId` do modulo e seguido de `.reduce(`.
    // `tambem` existe para o mutante que desfaz UMA decisao escrita em DOIS
    // lugares (ver `residuo_sem_piso`). Os dois trechos passam pela mesma
    // conferencia de unicidade -- um deles ficar sem casar transformaria o
    // mutante num mutante diferente do que o rotulo diz.
    const trechos = [
      { de: m.de, para: m.para },
      ...(m.tambem ? [m.tambem] : []),
    ];

    let mutado = original;
    let invalido = null;

    for (const t of trechos) {
      const ocorrencias = mutado.split(t.de).length - 1;
      if (ocorrencias === 0) {
        invalido = `o trecho a mutar NAO EXISTE MAIS (${t.de.trim().slice(0, 50)})`;
        break;
      }
      if (ocorrencias > 1) {
        invalido = `o trecho aparece ${ocorrencias}x -- ambiguo (${t.de
          .trim()
          .slice(0, 50)})`;
        break;
      }
      mutado = mutado.replace(t.de, t.para);
    }

    if (invalido) {
      console.log(`  !! ${m.nome}: ${invalido} -- mutante invalido`);
      falhas++;
      continue;
    }
    // A mutacao tem de MUDAR o arquivo. `de === para` por descuido numa
    // refatoracao produz um "mutante" identico a fonte, que sobrevive sempre e
    // se le como furo de cobertura.
    if (mutado === original) {
      console.log(`  !! ${m.nome}: a mutacao nao alterou nada -- invalido`);
      falhas++;
      continue;
    }

    let sobreviveu = false;
    try {
      compilaERoda(mutado);
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
  // `npm run test:credito-de-grupo` nao rodar contra um artefato mutado.
  rmSync(SAIDA, { recursive: true, force: true });
}

console.log();
if (falhas === 0) {
  console.log(`todos os ${MUTANTES.length} mutantes morreram`);
} else {
  console.log(`${falhas} mutante(s) sobreviveu/sobreviveram ou sao invalidos`);
  process.exit(1);
}
