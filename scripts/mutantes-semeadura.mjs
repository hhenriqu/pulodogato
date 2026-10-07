#!/usr/bin/env node
// Prova de mutacao da semeadura da divisao pela renda (HMO-245 fase 6 /
// HMO-272).
//
//   node scripts/mutantes-semeadura.mjs
//
// Cada entrada abaixo estraga uma decisao; a suite correspondente tem que ficar
// VERMELHA. Mutante que sobrevive e um trecho que nenhum teste distingue -- ou
// codigo morto.
//
// OS MUTANTES QUE SAO O CONTROLE NEGATIVO DA ENTREGA
// --------------------------------------------------
// Dois, e os dois de privacidade: `RECORTE DA PRIVACIDADE SOLTO` e
// `RECORTE POR member_id`. Esta fase promete "o R$
// da renda so para o proprio dono", e a maneira classica de "provar" isso e uma
// assercao de tela -- que passa verde com o salario no JSON. Se esses tres
// sobreviverem, a suite nao mede a promessa, e nenhum outro mutante compensa.
//
// TRES ARQUIVOS, DUAS SUITES
// ---------------------------
// As regras e a rota sao `test:semeadura`; o componente e `test:divisao-ui-dom`,
// que precisa de navegador. Cada mutante diz a sua, e o controle positivo roda
// uma vez por suite usada -- uma suite que nao esteja verde ANTES faz todo
// mutante dela "morrer", e o relatorio sai cheio sem ter medido nada.
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-335)
// --------------------------------------------------------
// Este runner MUTAVA A ARVORE RASTREADA: escrevia o mutante num dos tres
// arquivos de producao, chamava `npm run` ali mesmo e restaurava num `finally`
// (mais uma varredura final, cinto e suspensorio). Dois defeitos, e o segundo e
// o que doia:
//
//   1. cada volta recompilava o programa INTEIRO para trocar UM arquivo, e as
//      voltas da TELA subiam um CHROMIUM novo cada -- 23 voltas, 124s medidos, o
//      runner mais caro dos cinco deste lote;
//   2. nem o `finally` nem a varredura final rodam em SIGTERM, que e o sinal que
//      um timeout manda, e `execSync` BLOQUEIA a thread do JS -- entao nem um
//      handler de sinal resolveria. Ja aconteceu nesta arvore com este MESMO
//      `components/grupos/DivisaoDoGrupo.tsx`: a HMO-263 herdou um worktree com
//      ele mutado por um runner deste desenho.
//
// Agora as voltas dividem um processo e um cache de AST
// (`criarBlocoDeMutantes`, HMO-319): so o arquivo mutado e reparseado, e a
// mutacao vai para uma SOMBRA em diretorio temporario. A arvore rastreada e o
// `.tmp-*` do repositorio nao sao tocados em momento nenhum, entao o pior caso
// de um processo morto e um diretorio orfao em /tmp -- e por isso o `finally` e
// a varredura final sairam: nao ha mais escrita na arvore para desfazer.
//
// As etapas de cada suite saem do proprio `scripts[...]` do package.json -- o
// comando que o CI roda --, e nao de uma receita repetida a mao aqui. Por isso
// `SUITE_REGRAS` e `SUITE_TELA` passaram a guardar o NOME do alvo
// (`test:semeadura`) e nao a linha de comando (`npm run test:semeadura`): e o
// nome que `criarBlocoDeMutantes` resolve no package.json. A lista abaixo nao
// mudou -- ela sempre passou estas duas constantes adiante como token opaco.
//
// A lista de mutantes abaixo NAO foi reescrita nem movida: o diff desta
// conversao nao toca uma linha dela.
import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const REGRAS = "lib/semear-pela-renda.ts";
const ROTA = "app/api/expense-groups/[groupId]/semear-divisao/route.ts";
const TELA = "components/grupos/DivisaoDoGrupo.tsx";

const SUITE_REGRAS = "test:semeadura";
const SUITE_TELA = "test:divisao-ui-dom";

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela.
const original = new Map(
  [REGRAS, ROTA, TELA].map((a) => [a, readFileSync(a, "utf8")])
);

/** [rotulo, arquivo, suite, de, para] */
const mutantes = [
  // =========================================================================
  // O RECORTE DA PRIVACIDADE -- os tres controles negativos da entrega
  // =========================================================================
  [
    "RECORTE DA PRIVACIDADE SOLTO: renda_centavos em TODA linha",
    REGRAS,
    SUITE_REGRAS,
    `      ...(viewerUserId !== null && m.user_id === viewerUserId
        ? { renda_centavos: rendaCentavos }
        : {}),`,
    "      renda_centavos: rendaCentavos,",
  ],
  [
    "RECORTE POR member_id em vez de user_id: quem nomeia um id ve a renda dele",
    REGRAS,
    SUITE_REGRAS,
    "viewerUserId !== null && m.user_id === viewerUserId",
    "viewerUserId !== null && m.member_id === viewerUserId",
  ],
  // As TRES mutacoes de /api/expense-groups/proportions sairam na fase 7
  // (HMO-273), com o arquivo: `/proportions VOLTA A VAZAR`, `volta a recortar
  // por PAPEL` e `troca a chave por null`. Nao foram reescritas em outro lugar
  // porque nao ha onde: rota que nao existe nao vaza, e a mutacao precisa de uma
  // ancora de codigo. O que ficou no lugar e um guard, na secao 3 de
  // scripts/test-sugestao-de-divisao.mjs -- e o controle negativo DELE esta na
  // propria suite (o caso de `semComentarios`, nos dois sentidos).
  [
    "a rota passa um id qualquer como viewer em vez do auth.uid()",
    ROTA,
    SUITE_REGRAS,
    "const semeadura = semearPelaRenda(membros, linhas, mes, user.id);",
    "const semeadura = semearPelaRenda(membros, linhas, mes, membership.id);",
  ],

  // =========================================================================
  // A RENDA: o que conta, e de quem
  // =========================================================================
  [
    "linha sem tipo passa a contar como RENDA (o defeito oposto do fechamento)",
    REGRAS,
    SUITE_REGRAS,
    'if ((l.tipo ?? "expense") !== "income") continue;',
    'if ((l.tipo ?? "income") !== "income") continue;',
  ],
  [
    "a despesa entra na renda: o filtro de tipo cai",
    REGRAS,
    SUITE_REGRAS,
    'if ((l.tipo ?? "expense") !== "income") continue;',
    'if ((l.tipo ?? "expense") === "transfer") continue;',
  ],
  [
    "o recorte do MES cai: a renda do horizonte inteiro vira a do mes",
    REGRAS,
    SUITE_REGRAS,
    "if (mesDaData(l.data) !== mes) continue;",
    "if (false) continue;",
  ],
  [
    "linha sem pagador vira um membro fantasma com peso",
    REGRAS,
    SUITE_REGRAS,
    "if (!l.pagador_user_id) continue;",
    "if (false) continue;",
  ],
  [
    "`Math.abs` sai: valor negativo ENCOLHE a renda do membro",
    REGRAS,
    SUITE_REGRAS,
    "const centavos = Math.abs(toCents(Number(l.valor) || 0));",
    "const centavos = toCents(Number(l.valor) || 0);",
  ],
  [
    "`tem_renda` fica sempre verdadeiro: o rotulo do 0% nunca acende",
    REGRAS,
    SUITE_REGRAS,
    "tem_renda: rendaCentavos > 0,",
    "tem_renda: rendaCentavos >= 0,",
  ],
  [
    "grupo VAZIO passa a dizer 'ninguem lancou receita' (vacuidade do `every`)",
    REGRAS,
    SUITE_REGRAS,
    "      membros.length > 0 && membros.every((m) => centavosDe(m) <= 0),",
    "      membros.every((m) => centavosDe(m) <= 0),",
  ],
  [
    "a semeadura casa membro com peso por MAPA, nao por posicao",
    REGRAS,
    SUITE_REGRAS,
    "    const centesimos = pesos[i]?.centesimos ?? 0;",
    "    const centesimos =\n      pesos.find((p) => p.member_id === m.member_id)?.centesimos ?? 0;",
  ],

  // =========================================================================
  // A ROTA: o que ela le, e com que privilegio
  // =========================================================================
  [
    "a rota para de ler o PREVISTO: 'recebida + prevista' passa a ser so recebida",
    ROTA,
    SUITE_REGRAS,
    `      ...(previstas ?? [])
        .map(linhaDoPrevisto)
        .filter((l): l is LinhaCrua => l !== null),`,
    "",
  ],
  [
    "a prevista com BAIXA volta a contar: a receita paga conta duas vezes",
    ROTA,
    SUITE_REGRAS,
    `      ...(previstas ?? [])
        .map(linhaDoPrevisto)
        .filter((l): l is LinhaCrua => l !== null),`,
    `      ...(previstas ?? []).map((p) =>
        linhaDoPrevisto({ ...p, status: "pending" })
      ),`,
  ],
  [
    "a leitura privilegiada perde o `.in(user_id)`: a service role le o app inteiro",
    ROTA,
    SUITE_REGRAS,
    `      .in("user_id", userIds)
      .gte("transaction_date", primeiroDia)`,
    '      .gte("transaction_date", primeiroDia)',
  ],
  [
    "o portao de pertencimento cai: quem nao e do grupo recebe a divisao dele",
    ROTA,
    SUITE_REGRAS,
    "    if (!membership) {\n      return NextResponse.json({ error: \"Access denied\" }, { status: 403 });\n    }",
    "    if (!membership && false) {\n      return NextResponse.json({ error: \"Access denied\" }, { status: 403 });\n    }",
  ],
  [
    "membro INATIVO entra na divisao: o filtro de status da lista cai",
    ROTA,
    SUITE_REGRAS,
    `      .eq("group_id", groupId)
      .eq("status", "active")
      .order("joined_at", { ascending: true })`,
    `      .eq("group_id", groupId)
      .order("joined_at", { ascending: true })`,
  ],
  [
    "service role ausente vira 500 em vez de 503 com o nome da variavel",
    ROTA,
    SUITE_REGRAS,
    "        { status: 503 }",
    "        { status: 500 }",
  ],

  // =========================================================================
  // A TELA: a fiacao do botao e os dois rotulos do zero
  // =========================================================================
  [
    "o botao semeia e NAO sai do modo Igual: os sliders mostram 70/30 e o mes fecha metade a metade",
    TELA,
    SUITE_TELA,
    '      setModo("percentage");\n      setPesos(novos);',
    "      setPesos(novos);",
  ],
  [
    "o rotulo 'sem receita lancada' nunca acende",
    TELA,
    SUITE_TELA,
    "semRenda: membros\n          .map((m) => m.member_id)\n          .filter((id) => porMembro.get(id)?.tem_renda === false),",
    "semRenda: [],",
  ],
  [
    "o rotulo 'em 0% fica fora da divisao' nunca acende",
    TELA,
    SUITE_TELA,
    "              {p.centesimos === 0 && (",
    "              {p.centesimos < 0 && (",
  ],
  [
    "o botao chama a rota com o mes ERRADO (mes corrente em vez do exibido)",
    TELA,
    SUITE_TELA,
    "        `/api/expense-groups/${groupId}/semear-divisao?mes=${mes}`",
    "        `/api/expense-groups/${groupId}/semear-divisao`",
  ],
  [
    "a tela aceita a ORDEM do servidor em vez da dela: o percentual de um vai para o slider do outro",
    TELA,
    SUITE_TELA,
    `      const novos: PesoDoMembro[] = membros.map((m) => ({
        member_id: m.member_id,
        centesimos: Number(porMembro.get(m.member_id)?.centesimos),
      }));`,
    `      const novos: PesoDoMembro[] = membros.map((m, i) => ({
        member_id: m.member_id,
        centesimos: Number(linhas[linhas.length - 1 - i]?.centesimos),
      }));`,
  ],
  [
    "o botao de semear aparece para quem NAO e admin",
    TELA,
    SUITE_TELA,
    "      {ehAdmin && (\n        <div className=\"space-y-2 rounded-md border p-3\">",
    "      {true && (\n        <div className=\"space-y-2 rounded-md border p-3\">",
  ],
];

// ---------------------------------------------------------------------------
// CONTROLE POSITIVO: cada suite usada tem que estar VERDE antes do 1o mutante.
// ---------------------------------------------------------------------------
const suitesUsadas = [...new Set(mutantes.map(([, , suite]) => suite))];

// As suites DECLARADAS ao bloco saem da propria lista de mutantes, e nao de uma
// segunda lista escrita a mao aqui: declarar `[SUITE_REGRAS, SUITE_TELA]` fixo
// deixaria o bloco compilando um alvo que nenhum mutante usa (ou, pior, faltando
// o alvo de um mutante novo) sem nada reclamar.
const bloco = criarBlocoDeMutantes({ rotulo: "semeadura", suites: suitesUsadas });

// A sombra vive em diretorio temporario, e a arvore rastreada nunca e mutada --
// era esse o modo de falha deste runner. O handler de sinal existe so para que
// nem o diretorio orfao sobre: `finally` nao roda em SIGTERM, mas
// `process.exit` dispara o `exit` abaixo.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

for (const suite of suitesUsadas) {
  console.log(`controle positivo: \`${suite}\` esta verde sem mutante?`);
  const controle = bloco.rodar("controle", {}, suite);
  if (!controle.verde) {
    console.error(
      `\nA suite ja esta VERMELHA sem mutante nenhum (${controle.como}). Nada aqui\n` +
        `mediria nada -- todo mutante dela apareceria como morto. Conserte\n` +
        `\`${suite}\` primeiro.\n  ${controle.saida}`
    );
    process.exit(1);
  }
  console.log("   verde.");
}
console.log("\nmedindo os mutantes.\n");

const sobreviventes = [];

for (const [nome, arquivo, suite, de, para] of mutantes) {
  const fonte = original.get(arquivo);

  // Ancora que nao casa mais: a suite ficaria intacta e VERDE, e o mutante
  // seria dado por morto sem nunca ter existido.
  const ocorrencias = fonte.split(de).length - 1;
  if (ocorrencias === 0) {
    console.log(`??  ${nome}\n    a ancora nao existe em ${arquivo} -- mutante desatualizado`);
    sobreviventes.push(nome);
    continue;
  }
  // Ancora ambigua: `replace` troca a PRIMEIRA ocorrencia, que pode nao ser a
  // que o rotulo descreve. Vermelho aqui provaria outra coisa.
  if (ocorrencias > 1) {
    console.log(
      `??  ${nome}\n    a ancora casa ${ocorrencias}x em ${arquivo} -- replace mutaria o lugar errado`
    );
    sobreviventes.push(nome);
    continue;
  }

  const mutado = fonte.replace(de, para);
  if (mutado === fonte) {
    console.log(`??  ${nome}\n    a troca nao mudou nada -- mutante vacuo`);
    sobreviventes.push(nome);
    continue;
  }

  // A NOTA DE MUTANTE EQUIVALENTE NAO E IMPRIMIDA AQUI, e isto e deliberado.
  // `criarBlocoDeMutantes` guarda UMA saida de controle por BLOCO, preenchida na
  // primeira volta sem sobrescritas -- nao uma por suite. Com duas suites, o
  // `mudouASaida` deste mutante compararia o que ESTA suite emitiu com a linha de
  // base da OUTRA, e as duas emitem conjuntos diferentes de arquivos: a resposta
  // seria "mudou" sempre, inclusive para um mutante de fato equivalente.
  // Imprimi-la seria um rotulo que nao mede o que diz.
  const morreu = !bloco.rodar(nome, { [arquivo]: mutado }, suite).verde;
  console.log(`${morreu ? "OK  " : "VIVO"} ${nome}`);
  if (!morreu) sobreviventes.push(nome);
}

console.log(
  `\n${mutantes.length - sobreviventes.length}/${mutantes.length} mutantes mortos`
);
if (sobreviventes.length > 0) {
  console.log("\nsobreviventes:");
  for (const n of sobreviventes) console.log(`  - ${n}`);
}
process.exit(sobreviventes.length === 0 ? 0 : 1);
