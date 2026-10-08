#!/usr/bin/env node
// =====================================================
// PULODOGATO - o placar e o cronometro dos controles negativos
// =====================================================
//   node scripts/medir-controles-negativos.mjs --listar
//   node scripts/medir-controles-negativos.mjs --rodar --json placar.json
//   node scripts/medir-controles-negativos.mjs --rodar --filtro=parcela
//   node scripts/medir-controles-negativos.mjs --comparar antes.json depois.json
//   node scripts/medir-controles-negativos.mjs --autoteste
//
// POR QUE ISTO EXISTE (HMO-319)
// -----------------------------
// A HMO-263 mediu os blocos de controle negativo em 556s -- o maior item
// isolado de um push -- e registrou o veredito de cada um lado a lado contra
// `origin/main`. Essas duas medidas foram feitas a mao, e o criterio de aceite
// da HMO-319 ("menos da metade do tempo, com os MESMOS vereditos") depende de
// poder refaze-las em qualquer arvore.
//
// A LISTA DE BLOCOS NAO E ESCRITA A MAO, de proposito. Ela sai dos workflows:
// todo step cujo `run` invoca um runner de mutante e um bloco. Uma lista a mao
// envelheceria calada -- runner novo entraria no CI sem entrar na medida, e o
// numero publicado passaria a cobrir menos do que diz cobrir. O custo real e o
// tempo de step do Actions, e e exatamente esse conjunto que este arquivo
// enumera.
//
// O QUE ELE CONFERE ALEM DO TEMPO
// -------------------------------
// Depois de cada bloco ele compara a arvore com a fotografia tirada no inicio.
// Runner de mutante morto antes de restaurar deixa o mutante GRAVADO na fonte,
// e nesse estado o bloco SEGUINTE mede o arquivo errado. Aqui isso vira uma
// linha "deixou a arvore suja" no placar em vez de contaminacao silenciosa --
// e a arvore e restaurada antes do bloco seguinte.
//
// "REPROVA" NAO PODE QUERER DIZER "NAO MEDI" (HMO-341)
// ----------------------------------------------------
// Medido ao fechar a HMO-319: 7 dos 44 blocos terminavam em 0,1s-1,1s com
// `reprova` sem medir mutante nenhum, e no placar isso se lia igual a um bloco
// que reprovou de verdade. Duas causas, as duas de contexto e nenhuma do alvo:
//
// 1. O `env:` do job nao chegava ao comando. Os dois blocos escritos
//    `BANCO_BASE=$PGDATABASE bash scripts/mutantes-x.sh` rodavam com a
//    variavel VAZIA, caiam no banco default do proprio runner, e mediam outro
//    banco -- um deles chegou a imprimir "todos os mutantes morreram" contra um
//    banco esquecido na maquina, que e pior que o `reprova`.
// 2. Os cinco blocos de `PG_TEMPLATE=hmo3NN_preNNN` dependem de um
//    `CREATE DATABASE ... TEMPLATE` tirado por um step ANTERIOR do mesmo job.
//    Rodados isolados, morriam em
//    `template database "hmo322_pre040" does not exist` -- e o motivo que o
//    placar imprimia era `Node.js v24.19.0`, a ultima linha do stack.
//
// A SAIDA ESCOLHIDA, das duas que a issue propunha, foi a SEGUNDA: declarar o
// bloco e separa-lo do placar, em vez de ensinar a medicao a montar a cadeia de
// migrations inteira. Pior em cobertura e honesta -- e o numero publicado passa
// a dizer o que cobre. Mas a declaracao NAO e uma lista a mao de blocos (ela
// envelheceria calada, como a lista de blocos envelheceria): ela sai do proprio
// job, cruzando os bancos que os steps anteriores montam com os que o comando
// do bloco nomeia. Retrato novo no workflow entra sozinho.
//
// E o `so-no-CI` nao e um beco: montar o banco-modelo a mao faz o bloco medir
// aqui. `hmo330_pre032` semeado pela cadeia de `$PSQL -f` ate o step do retrato
// leva o `chave-pix` de `so-no-CI` a `6/6 mutantes mortos` em 6,6s.
//
// O LIMITE QUE SOBRA, e que o positivo cobre: "o banco existe" nao e "o banco
// esta no estado certo". Um `pulodogato_ci` velho na maquina passa pela conta de
// pre-requisito. Quem pega isso e o CONTROLE POSITIVO do proprio runner, e por
// isso o veredito dele tambem e `nao-mediu` e nao `reprova`: foi exatamente
// assim que um `hmo330_pre032` vazio foi barrado em vez de produzir placar.
// =====================================================

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import YAML from "yaml";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIR_DE_WORKFLOWS = path.join(RAIZ, ".github", "workflows");

// Um `run:` invoca um runner de mutante de duas formas neste repositorio:
// direto (`node scripts/mutantes-x.mjs`) ou pelo npm (`npm run mutantes:x`).
// As duas contam, e o nome do bloco e o nome do runner nas duas.
const INVOCACAO_DIRETA = /(?:^|\s)(?:node|bash)\s+scripts\/mutantes-([a-z0-9-]+)\.(?:mjs|sh)/;
const INVOCACAO_POR_NPM = /(?:^|\s)npm\s+run\s+mutantes:([a-z0-9-]+)/;

// Um step que tira um retrato da cadeia de migrations para um bloco de mutacao
// usar depois. O nome do banco e o que o bloco recebe em `PG_TEMPLATE`.
const RETRATO_DA_CADEIA = /CREATE DATABASE\s+([a-z0-9_]+)\s+TEMPLATE/gi;

/**
 * Os blocos de controle negativo, lidos dos workflows.
 *
 * Com parser YAML de verdade, e nao por regex de linha: um `run:` de bloco
 * literal (`run: |`) tem o comando em outra linha que o `name:`, e e o `name:`
 * que o Actions cobra como step.
 *
 * Cada bloco sai daqui com DUAS coisas que o `run:` sozinho nao tem, e sem as
 * quais rodar o comando fora do Actions nao reproduz o step (HMO-341):
 *
 * - `ambiente`: o `env:` do job. O Actions o injeta em todo step, e e dele que
 *   saem `PGDATABASE` e `PSQL`. Sem isso, `BANCO_BASE=$PGDATABASE bash ...`
 *   roda com a variavel VAZIA e o runner cai no banco default do proprio
 *   script -- outro banco, nao o do job.
 * - `bancosDoJob`: os bancos que os steps ANTERIORES do mesmo job montam, e
 *   que portanto nao existem numa arvore qualquer: o `PGDATABASE` (que a
 *   cadeia de `$PSQL -f` constroi do zero) e todo retrato
 *   `CREATE DATABASE <nome> TEMPLATE ...`. Ficam com o nome do step que os
 *   monta, para o placar poder dizer o que falta e quem faria.
 */
function blocosDosWorkflows() {
  const blocos = [];
  for (const arquivo of readdirSync(DIR_DE_WORKFLOWS).sort()) {
    if (!/\.ya?ml$/.test(arquivo)) continue;
    const doc = YAML.parse(readFileSync(path.join(DIR_DE_WORKFLOWS, arquivo), "utf8"));
    for (const [idDoJob, job] of Object.entries(doc?.jobs ?? {})) {
      const ambiente = Object.fromEntries(
        Object.entries(job?.env ?? {}).map(([k, v]) => [k, String(v)]),
      );
      // Os bancos que o job monta, na ordem dos steps. Acumula enquanto desce:
      // um bloco so pode depender do que foi montado ANTES dele.
      const bancosDoJob = new Map();
      if (ambiente.PGDATABASE) {
        bancosDoJob.set(ambiente.PGDATABASE, "a cadeia de migrations do job");
      }
      for (const step of job?.steps ?? []) {
        const comando = typeof step?.run === "string" ? step.run : null;
        if (!comando) continue;
        const nome =
          comando.match(INVOCACAO_DIRETA)?.[1] ?? comando.match(INVOCACAO_POR_NPM)?.[1] ?? null;
        if (nome) {
          blocos.push({
            runner: nome,
            workflow: arquivo,
            job: idDoJob,
            step: step.name ?? comando.split("\n")[0],
            comando: comando.trim(),
            ambiente,
            prerequisitos: prerequisitosDoBloco(comando, ambiente, bancosDoJob),
          });
        }
        for (const m of comando.matchAll(RETRATO_DA_CADEIA)) {
          bancosDoJob.set(m[1], step.name ?? comando.split("\n")[0]);
        }
      }
    }
  }
  return blocos;
}

/**
 * Os bancos montados pelo job que ESTE bloco nomeia -- nem mais, nem menos.
 *
 * Nem mais: a lista inteira de `bancosDoJob` cresce com cada retrato novo, e
 * cobrar de todo bloco todos os retratos faria os blocos que nao usam banco
 * nenhum (os de TypeScript, que sao a maioria) deixarem de ser medidos.
 * Nem menos: a referencia pode vir literal (`PG_TEMPLATE=hmo330_pre032`) ou
 * pela variavel do job (`BANCO_BASE=$PGDATABASE`), e as duas contam.
 */
function prerequisitosDoBloco(comando, ambiente, bancosDoJob) {
  const prerequisitos = [];
  for (const [banco, quemMonta] of bancosDoJob) {
    const porNome = new RegExp(`\\b${banco}\\b`).test(comando);
    const porVariavel = Object.entries(ambiente).some(
      ([variavel, valor]) =>
        valor === banco && new RegExp(`\\$\\{?${variavel}\\b`).test(comando),
    );
    if (porNome || porVariavel) prerequisitos.push({ banco, quemMonta });
  }
  return prerequisitos;
}

/**
 * Os bancos que faltam no Postgres local, entre os que o bloco precisa.
 *
 * `psql` com a lista inteira numa consulta so: a medicao roda 44 blocos e nao
 * vale abrir uma conexao por nome. Se o `psql` nao responde (sem servidor,
 * sem cliente), a resposta e "faltam todos" -- que e a verdade: nenhum deles
 * esta alcancavel daqui.
 */
function bancosQueFaltam(prerequisitos, ambiente) {
  if (prerequisitos.length === 0) return [];
  const lista = prerequisitos.map((p) => `'${p.banco}'`).join(",");
  const r = spawnSync(
    "psql",
    [
      "-tAq",
      "--no-psqlrc",
      "-d",
      "postgres",
      "-c",
      `select datname from pg_database where datname in (${lista})`,
    ],
    { cwd: RAIZ, encoding: "utf8", env: { ...ambiente, ...process.env, PGDATABASE: "postgres" } },
  );
  const presentes = new Set(
    r.status === 0 ? String(r.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean) : [],
  );
  return prerequisitos.filter((p) => !presentes.has(p.banco));
}

function fotografarArvore() {
  const r = spawnSync("git", ["status", "--porcelain"], { cwd: RAIZ, encoding: "utf8" });
  return r.stdout ?? "";
}

/**
 * Restaura o que o bloco deixou modificado -- SO com `--restaurar`, e por isso.
 *
 * A primeira versao disto restaurava sempre, e apagou uma edicao minha no meio
 * da propria medicao: `scripts/compila.mjs` passou a aparecer como modificado
 * entre a fotografia e o fim de um bloco de 186s, e o restore nao tem como
 * saber que aquilo era trabalho e nao mutante largado. E a mesma faca que ja
 * cortou neste repositorio tres vezes (o `trap ... EXIT` dos controles
 * negativos, o `git checkout -- app` de um laco de mutacao, o
 * `git checkout <ref> -- .`), agora com um nome novo.
 *
 * Por padrao, portanto, a medicao NAO escreve no worktree: ela PARA e nomeia
 * os arquivos. Parar e o comportamento certo mesmo em CI -- um bloco que deixou
 * mutante na arvore faz o bloco seguinte medir o arquivo errado, e seguir
 * adiante produziria um placar que parece completo e nao vale.
 *
 * `--restaurar` existe para quem roda a medicao numa arvore propria e
 * descartavel, onde o unico conteudo nao commitado possivel e o mutante.
 */
function restaurar(sujos) {
  if (sujos.length === 0) return;
  spawnSync("git", ["checkout", "--", ...sujos], { cwd: RAIZ, encoding: "utf8" });
}

function sujeira(antes, depois) {
  const deAntes = new Set(antes.split("\n"));
  return depois
    .split("\n")
    .filter((linha) => linha.trim() && !deAntes.has(linha))
    .map((linha) => ({ estado: linha.slice(0, 2), caminho: linha.slice(3).trim() }));
}

/**
 * O veredito e a frase curta que o explica, para o placar caber numa tela.
 *
 * TRES VEREDITOS, E NAO DOIS (HMO-341)
 * ------------------------------------
 * `reprova` significa "mediu, e algo sobreviveu". Nao servia para o bloco que
 * NAO MEDIU NADA -- e sete dos 44 estavam nesse estado fora do CI, cada um
 * aparecendo no placar com a mesma palavra de quem reprovou de verdade. Ler
 * `reprova` em um bloco que nem chegou a mutar e pior do que nao ter o numero:
 * manda consertar o alvo quando o que falta e o aparelho.
 *
 * Entao: `nao-mediu`, que nao entra em nenhuma das duas contas e aparece com o
 * motivo ao lado. A classificacao NAO e uma lista a mao de blocos -- ela sai do
 * que o proprio runner imprime. Esta familia de runners ja grita quando desiste
 * (`ABORTADO:`, `NAO FOI MEDIDO`, `CONTROLE POSITIVO FALHOU`, `NAO APLICOU`),
 * e essas frases ja eram justamente as que esta funcao procurava primeiro. O
 * que faltava era o veredito acompanhar o motivo em vez de colapsar em
 * `reprova`.
 *
 * A ordem das tentativas e a ordem em que elas sao informativas: um controle
 * reprovado invalida o placar inteiro daquele bloco e tem de aparecer no lugar
 * do numero (foi assim que um `10/10 mutantes mortos` ficticio sobreviveu a um
 * run inteiro neste repositorio).
 */
function classificar(saida, codigo) {
  const linhas = saida.split("\n").map((l) => l.trim()).filter(Boolean);
  const corte = (l) => l.slice(0, 160);

  // Desistencia explicita do runner: ele mesmo diz que nao mediu.
  const desistiu = linhas.find((l) => /^ABORTADO\b|NAO FOI MEDIDO|nao consegui clonar/.test(l));
  if (desistiu) return { veredito: "nao-mediu", porque: corte(desistiu) };

  // Controle positivo reprovado: a arvore/banco INTACTO ja nao passa, e nesse
  // estado nenhum mutante abaixo quer dizer nada.
  const controle = linhas.find((l) => /^CONTROLE( POSITIVO)? (FALHOU|NAO)/i.test(l));
  if (controle) return { veredito: "nao-mediu", porque: corte(controle) };

  // Ancora que nao casou: aquele mutante nao foi aplicado, logo nao foi medido.
  const naoAplicou = linhas.find((l) => /^(NAO APLICOU|AMBIGUO|ANCORA AUSENTE)/.test(l));
  if (naoAplicou) return { veredito: "nao-mediu", porque: corte(naoAplicou) };

  const sobreviveu = linhas.filter((l) => /^SOBREVIVEU/.test(l));
  if (sobreviveu.length > 0) {
    return {
      veredito: "reprova",
      porque: corte(
        `${sobreviveu.length} sobreviveu(ram): ${sobreviveu
          .map((l) => l.replace(/^SOBREVIVEU:?\s*/, ""))
          .slice(0, 3)
          .join("; ")}`,
      ),
    };
  }

  const placar = [...saida.matchAll(/(\d+)\/(\d+) mutantes mortos[^\n]*/g)].pop();
  if (placar) {
    return { veredito: codigo === 0 ? "ok" : "reprova", porque: corte(placar[0]) };
  }

  if (codigo === 0) return { veredito: "ok", porque: corte(linhas[linhas.length - 1] ?? "sem saida") };

  // Estourou sem placar e sem frase de desistencia. A ULTIMA linha nao serve de
  // motivo: numa excecao de Node ela e o banner da versao (`Node.js v24.19.0`),
  // que foi literalmente o que o placar imprimiu para os cinco blocos de
  // `PG_TEMPLATE` ausente -- a causa real (`template database "hmo322_pre040"
  // does not exist`) estava 15 linhas acima. Procura a linha de erro primeiro.
  const erro = linhas.find((l) => /^(ERROR|FATAL|error|Error):/.test(l) || /\bERROR:\s/.test(l));
  if (erro) return { veredito: "reprova", porque: corte(erro) };
  const ultima = linhas.filter((l) => !/^Node\.js v/.test(l)).pop();
  return { veredito: "reprova", porque: corte(ultima ?? "sem saida") };
}

// As quatro familias de frase com que um runner desta arvore anuncia que
// DESISTIU. Nao sao invencao desta medicao: cada uma e escrita por um runner, e
// o `--autoteste` abaixo exige que continuem sendo -- vocabulario que nenhum
// runner mais emite e classificador cego para o que o runner passou a dizer.
const VOCABULARIO_DE_DESISTENCIA = [
  { familia: "ABORTADO", marcador: /ABORTADO:/, exemplo: "ABORTADO: o teste reprova no banco INTACTO." },
  { familia: "NAO FOI MEDIDO", marcador: /NAO FOI MEDIDO/, exemplo: "  !! nao consegui clonar pdg197 (conexao aberta?) -- mutante x NAO FOI MEDIDO" },
  { familia: "CONTROLE FALHOU", marcador: /CONTROLE( POSITIVO)? (FALHOU|NAO)/, exemplo: "CONTROLE FALHOU: a fonte intacta nao passa na suite (tsc) -> erro" },
  { familia: "NAO APLICOU", marcador: /NAO APLICOU/, exemplo: "NAO APLICOU: sem_gate -- o trecho procurado nao esta em 039" },
];

/**
 * O autoteste da classificacao -- sem banco, sem runner, sem CI.
 *
 * Existe porque a classificacao e a feature: se ela voltar a colapsar
 * "nao medi" em `reprova`, nada reclama. E o controle negativo que importa e o
 * de nao ter ido LONGE DEMAIS -- uma classificacao que mande toda reprovacao
 * para `nao-mediu` tambem apaga o buraco da HMO-341, pelo outro lado.
 *
 * As frases nao sao digitadas aqui e conferidas aqui: cada familia e procurada
 * NAS FONTES DOS RUNNERS, e familia que nenhum runner emite mais reprova. Sem
 * isso o teste passaria para sempre enquanto o runner trocasse de vocabulario.
 */
function autoteste() {
  const falhas = [];
  const confere = (o, q, e) => {
    if (o !== e) falhas.push(`${q}: esperava \`${e}\`, deu \`${o}\``);
  };

  const fontes = readdirSync(path.join(RAIZ, "scripts"))
    .filter((f) => /^mutantes-.*\.(mjs|sh)$/.test(f))
    .map((f) => readFileSync(path.join(RAIZ, "scripts", f), "utf8"))
    .join("\n");

  for (const { familia, marcador, exemplo } of VOCABULARIO_DE_DESISTENCIA) {
    if (!marcador.test(fontes)) {
      falhas.push(`vocabulario morto: nenhum runner emite \`${familia}\` -- o classificador cegou`);
    }
    if (!marcador.test(exemplo)) {
      falhas.push(`o exemplo de \`${familia}\` nao casa com o proprio marcador`);
    }
    confere(classificar(exemplo, 1).veredito, `desistencia \`${familia}\``, "nao-mediu");
  }

  // Positivo: placar completo com saida 0 e `ok`, e com saida != 0 e `reprova`.
  confere(classificar("6/6 mutantes mortos", 0).veredito, "placar cheio, saida 0", "ok");
  confere(classificar("5/6 mutantes mortos", 1).veredito, "placar incompleto", "reprova");
  confere(classificar("SOBREVIVEU: sem_revoke", 1).veredito, "sobrevivente", "reprova");

  // CONTROLE NEGATIVO, e o unico que pega o erro oposto: reprovacao SEM frase
  // de desistencia tem de continuar `reprova`. Se este passar a `nao-mediu`, a
  // medicao parou de reprovar qualquer coisa e o placar vale zero.
  confere(classificar("alguma coisa quebrou\nERROR:  relation x does not exist", 1).veredito, "reprova sem frase", "reprova");
  confere(classificar("sem nada reconhecivel", 1).veredito, "reprova muda", "reprova");

  // E o motivo nao pode ser o banner do Node: foi o que o placar imprimiu para
  // os cinco blocos de `PG_TEMPLATE` ausente, no lugar da causa.
  const comBanner = classificar(
    'ERROR:  template database "hmo322_pre040" does not exist\n    at psql (file:///x.mjs:81:3)\nNode.js v24.19.0',
    1,
  );
  confere(comBanner.veredito, "template ausente, rodado mesmo assim", "reprova");
  if (/^Node\.js v/.test(comBanner.porque)) {
    falhas.push(`o motivo virou o banner do Node: \`${comBanner.porque}\``);
  }

  // A derivacao dos pre-requisitos, contra os workflows de verdade. Ela tem de
  // achar ALGUM bloco -- derivacao que nao acha nada passaria vacua, e era
  // exactamente o estado anterior (zero blocos com pre-requisito declarado).
  const comBanco = blocosDosWorkflows().filter((b) => b.prerequisitos.length > 0);
  if (comBanco.length === 0) {
    falhas.push("nenhum bloco com pre-requisito de banco: a derivacao ficou vacua");
  }
  // E nao pode achar TODOS: os blocos de TypeScript nao tocam banco, e cobrar
  // banco deles os tiraria da medida.
  const todos = blocosDosWorkflows();
  if (comBanco.length === todos.length) {
    falhas.push(`a derivacao cobrou banco de todos os ${todos.length} blocos`);
  }

  console.log(`autoteste: ${comBanco.length}/${todos.length} blocos com pre-requisito de banco`);
  if (falhas.length > 0) {
    console.error(`\nAUTOTESTE REPROVOU (${falhas.length}):`);
    for (const f of falhas) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("autoteste: a classificacao e a derivacao passam");
  process.exit(0);
}

function rodarBloco(bloco, { tempoLimite, podeRestaurar }) {
  // PRIMEIRO o que falta, e so depois rodar (HMO-341). Um bloco cujo
  // banco-modelo nao existe aqui nao e um bloco que reprova: e um bloco que
  // esta fora do alcance desta medicao. Rodar para descobrir isso gasta o
  // tempo e, pior, produz um `reprova` indistinguivel do de verdade.
  const faltam = bancosQueFaltam(bloco.prerequisitos ?? [], bloco.ambiente ?? {});
  if (faltam.length > 0) {
    return {
      ...bloco,
      segundos: 0,
      saida: "so-no-CI",
      codigo: null,
      sinal: null,
      // Cada banco com o SEU step: com dois faltando, nomear um so manda
      // montar a metade errada.
      porque: `falta ${faltam
        .map((f) => `\`${f.banco}\` (monta em "${f.quemMonta}")`)
        .join("; ")}`.slice(0, 160),
      faltam: faltam.map((f) => f.banco),
      sujou: [],
      cauda: "",
    };
  }

  const antes = fotografarArvore();
  const inicio = Date.now();
  const r = spawnSync("bash", ["-lc", bloco.comando], {
    cwd: RAIZ,
    encoding: "utf8",
    timeout: tempoLimite,
    maxBuffer: 64 * 1024 * 1024,
    // O `env:` do job entra aqui porque o Actions o entrega a todo step: sem
    // ele, `BANCO_BASE=$PGDATABASE` vira `BANCO_BASE=` e o runner mede o banco
    // default do proprio script. `process.env` vem DEPOIS para que quem roda a
    // medicao a mao possa apontar outro Postgres sem editar o workflow.
    env: { ...bloco.ambiente, ...process.env, CI: process.env.CI ?? "1", FORCE_COLOR: "0" },
  });
  const segundos = (Date.now() - inicio) / 1000;
  const saida = String(r.stdout ?? "") + String(r.stderr ?? "");
  const suja = sujeira(antes, fotografarArvore());
  if (podeRestaurar) restaurar(suja.filter((s) => s.estado.includes("M")).map((s) => s.caminho));
  const { veredito, porque } = classificar(saida, r.status);

  // Bloco que desistiu E usa banco: dizer QUAL banco ele usou. Sem isso o
  // motivo e a frase do runner ("o teste reprova no banco INTACTO") sem o nome
  // do banco intacto -- e o banco e justamente o que esta errado, porque um
  // `pulodogato_ci` velho na maquina passa pela conta de pre-requisito.
  const comBanco =
    veredito === "nao-mediu" && (bloco.prerequisitos ?? []).length > 0
      ? `${porque} [banco: ${bloco.prerequisitos.map((p) => p.banco).join(", ")}]`.slice(0, 200)
      : porque;

  return {
    ...bloco,
    segundos: Number(segundos.toFixed(1)),
    saida: veredito,
    codigo: r.status,
    sinal: r.signal ?? null,
    porque: comBanco,
    sujou: suja.map((s) => `${s.estado} ${s.caminho}`),
    cauda: saida.split("\n").slice(-25).join("\n"),
  };
}

// Os dois vereditos que significam "nada foi medido aqui". Ficam juntos num
// conjunto, e nao espalhados em comparacoes, porque toda conta do placar tem de
// os excluir junto: somar meio bloco e o que produziu o numero errado.
const NAO_MEDIU = new Set(["so-no-CI", "nao-mediu"]);

const MARCA = {
  ok: "OK      ",
  reprova: "REPROVA ",
  "so-no-CI": "SO-NO-CI",
  "nao-mediu": "NAO MEDIU",
};

function imprimirPlacar(resultados) {
  const largura = Math.max(...resultados.map((r) => r.runner.length), 7);
  console.log("");
  console.log(`${"runner".padEnd(largura)}  ${"tempo".padStart(7)}  veredito  porque`);
  console.log("-".repeat(largura + 2 + 7 + 2 + 8 + 2 + 40));
  for (const r of resultados) {
    const marca = MARCA[r.saida] ?? String(r.saida).toUpperCase().padEnd(8);
    console.log(
      `${r.runner.padEnd(largura)}  ${`${r.segundos.toFixed(1)}s`.padStart(7)}  ${marca}  ${r.porque}`,
    );
    if (r.sujou.length > 0) {
      console.log(`${" ".repeat(largura)}  ${" ".repeat(7)}  !! deixou a arvore suja: ${r.sujou.join(", ")}`);
    }
  }
  const total = resultados.reduce((s, r) => s + r.segundos, 0);
  const medidos = resultados.filter((r) => !NAO_MEDIU.has(r.saida));
  const ok = medidos.filter((r) => r.saida === "ok").length;
  const reprova = medidos.length - ok;
  const cegos = resultados.filter((r) => NAO_MEDIU.has(r.saida));
  const tempoMedido = medidos.reduce((s, r) => s + r.segundos, 0);
  console.log("-".repeat(largura + 2 + 7 + 2 + 8 + 2 + 40));
  console.log(
    `${resultados.length} blocos  ${total.toFixed(1)}s (${(total / 60).toFixed(1)} min)  ${ok} OK  ${
      reprova
    } REPROVA  ${cegos.length} NAO MEDIU`,
  );

  // O numero publicado tem de dizer o que cobre. `44 blocos, 43 OK` com sete
  // deles cegos nao e uma medida de 44 blocos -- e uma medida de 37 com sete
  // buracos, e quem le merece as duas frases separadas.
  if (cegos.length > 0) {
    console.log(
      `\nMEDIDO DE VERDADE: ${medidos.length}/${resultados.length} blocos em ${tempoMedido.toFixed(
        1,
      )}s. Os outros ${cegos.length} nao mediram mutante nenhum:`,
    );
    for (const r of cegos) {
      console.log(`  ${r.runner.padEnd(largura)}  ${MARCA[r.saida]?.trim() ?? r.saida}  ${r.porque}`);
    }
    console.log(
      "\n`so-no-CI` = o banco-modelo que o bloco usa e montado por um step ANTERIOR do job,\n" +
        "e nao existe nesta maquina. Monte-o (a cadeia de `$PSQL -f` do db-verify ate o step do\n" +
        "retrato) e o bloco passa a medir aqui. `nao-mediu` = o runner rodou e desistiu.",
    );
  }
}

function comparar(caminhoA, caminhoB) {
  const a = JSON.parse(readFileSync(caminhoA, "utf8"));
  const b = JSON.parse(readFileSync(caminhoB, "utf8"));
  const porRunner = (lista) => new Map(lista.resultados.map((r) => [r.runner, r]));
  const mapaA = porRunner(a);
  const mapaB = porRunner(b);
  const runners = [...new Set([...mapaA.keys(), ...mapaB.keys()])].sort();
  const largura = Math.max(...runners.map((r) => r.length), 7);

  console.log(`\nA = ${a.rotulo ?? caminhoA}\nB = ${b.rotulo ?? caminhoB}\n`);
  console.log(
    `${"runner".padEnd(largura)}  ${"A".padStart(8)}  ${"B".padStart(8)}  ${"A".padStart(8)}  ${"B".padStart(8)}  veredito`,
  );
  let divergentes = 0;
  let somaA = 0;
  let somaB = 0;
  // O total inteiro mistura dois tipos de bloco e por isso nao responde ao
  // criterio sozinho. Bloco que REPROVAVA de um lado nao estava fazendo o
  // trabalho: o de `fatura-prevista` abortava em 1,1s no controle, e quando a
  // HMO-325 consertou a lista de copia ele passou a medir 16 mutantes em 13,8s.
  // Somar esse +12,7s junto com a economia dos outros esconde as duas coisas.
  // Entao: alem do total, o total restrito aos blocos que ficaram `ok` nos DOIS
  // lados -- os unicos onde "o mesmo trabalho, em menos tempo" quer dizer algo.
  let verdesA = 0;
  let verdesB = 0;
  let verdes = 0;
  // Bloco que nao mediu de nenhum dos dois lados nao prova nada sobre tempo --
  // ele nao gastou tempo nenhum, e somar os seus 0,0s nos dois totais faz a
  // economia parecer maior do que foi (HMO-341).
  let cegosNosDois = 0;
  for (const nome of runners) {
    const ra = mapaA.get(nome);
    const rb = mapaB.get(nome);
    somaA += ra?.segundos ?? 0;
    somaB += rb?.segundos ?? 0;
    if (ra?.saida === "ok" && rb?.saida === "ok") {
      verdes++;
      verdesA += ra.segundos;
      verdesB += rb.segundos;
    }
    if (NAO_MEDIU.has(ra?.saida) && NAO_MEDIU.has(rb?.saida)) cegosNosDois++;
    // Passa/reprova NAO e o veredito inteiro. Um bloco que ia 13/13 e passa a
    // 11/11 continua `ok` nos dois lados -- dois mutantes sumiram da lista e o
    // placar nao reclamaria. O criterio de aceite da HMO-319 fala em "os MESMOS
    // vereditos", e o veredito e o placar: as duas coisas tem que casar.
    const mesmoDesfecho = (ra?.saida ?? "ausente") === (rb?.saida ?? "ausente");
    const mesmoPlacar = (ra?.porque ?? "ausente") === (rb?.porque ?? "ausente");
    const igual = mesmoDesfecho && mesmoPlacar;
    if (!igual) divergentes++;
    console.log(
      `${nome.padEnd(largura)}  ${`${(ra?.segundos ?? 0).toFixed(1)}s`.padStart(8)}  ${`${(
        rb?.segundos ?? 0
      ).toFixed(1)}s`.padStart(8)}  ${(ra?.saida ?? "ausente").padStart(8)}  ${(
        rb?.saida ?? "ausente"
      ).padStart(8)}  ${
        igual ? "igual" : mesmoDesfecho ? "** PLACAR DIVERGIU **" : "** DIVERGIU **"
      }`,
    );
    if (!mesmoPlacar) {
      console.log(`${" ".repeat(largura)}  A: ${ra?.porque ?? "ausente"}`);
      console.log(`${" ".repeat(largura)}  B: ${rb?.porque ?? "ausente"}`);
    }
  }
  const porcento = (de, para) => (de > 0 ? (((de - para) / de) * 100).toFixed(0) : "0");
  console.log(`\ntotal: ${somaA.toFixed(1)}s -> ${somaB.toFixed(1)}s  (${porcento(somaA, somaB)}% menos)`);
  console.log(
    `so os ${verdes} blocos ok nos dois lados: ${verdesA.toFixed(1)}s -> ${verdesB.toFixed(1)}s  (${porcento(
      verdesA,
      verdesB,
    )}% menos)`,
  );
  if (cegosNosDois > 0) {
    console.log(
      `${cegosNosDois} bloco(s) nao mediram de NENHUM dos dois lados -- nao entram em "igual" como prova de nada`,
    );
  }
  console.log(`vereditos divergentes: ${divergentes}`);

  // Divergir e o unico resultado inaceitavel: tempo a mais e so tempo a mais,
  // mas um veredito diferente significa que a medida deixou de ser a mesma.
  process.exit(divergentes === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);

if (argv[0] === "--comparar") {
  if (argv.length !== 3) {
    console.error("uso: --comparar <antes.json> <depois.json>");
    process.exit(1);
  }
  comparar(argv[1], argv[2]);
}

if (argv[0] === "--autoteste") autoteste();

const blocos = blocosDosWorkflows();
const filtro = argv.find((a) => a.startsWith("--filtro="))?.slice("--filtro=".length);
const selecionados = filtro ? blocos.filter((b) => new RegExp(filtro).test(b.runner)) : blocos;

if (argv.includes("--listar") || argv.length === 0) {
  console.log(`${selecionados.length} blocos de controle negativo nos workflows:\n`);
  for (const b of selecionados) {
    console.log(`  ${b.runner.padEnd(26)} ${b.workflow}  ${b.step}`);
    // O pre-requisito aparece no --listar porque e o que explica, ANTES de
    // rodar, por que aquele bloco pode sair `so-no-CI` nesta maquina.
    if (b.prerequisitos.length > 0) {
      const faltam = new Set(bancosQueFaltam(b.prerequisitos, b.ambiente).map((f) => f.banco));
      console.log(
        `  ${" ".repeat(26)} precisa de ${b.prerequisitos
          .map((p) => `${p.banco}${faltam.has(p.banco) ? " (FALTA AQUI)" : ""}`)
          .join(", ")}`,
      );
    }
  }
  process.exit(0);
}

if (!argv.includes("--rodar")) {
  console.error(
    "uso: --listar | --rodar [--filtro=re] [--json <arquivo>] | --comparar a.json b.json | --autoteste",
  );
  process.exit(1);
}

const rotulo =
  argv.find((a) => a.startsWith("--rotulo="))?.slice("--rotulo=".length) ??
  spawnSync("git", ["rev-parse", "--short", "HEAD"], { cwd: RAIZ, encoding: "utf8" }).stdout?.trim();
const tempoLimite = Number(argv.find((a) => a.startsWith("--limite="))?.slice("--limite=".length) ?? 600) * 1000;

const podeRestaurar = argv.includes("--restaurar");

const resultados = [];
for (const [i, bloco] of selecionados.entries()) {
  process.stderr.write(`[${i + 1}/${selecionados.length}] ${bloco.runner} ... `);
  const r = rodarBloco(bloco, { tempoLimite, podeRestaurar });
  process.stderr.write(`${r.segundos.toFixed(1)}s ${r.saida}\n`);
  resultados.push(r);

  // Parar aqui, e nao no fim: do bloco seguinte em diante o placar mediria uma
  // arvore que nao e a desta medicao, e um placar assim se le como completo.
  if (r.sujou.length > 0 && !podeRestaurar) {
    imprimirPlacar(resultados);
    console.error(
      `\nO bloco \`${bloco.runner}\` deixou a arvore suja e a medicao parou:\n  ${r.sujou.join(
        "\n  ",
      )}\n\nRestaure a mao (ou rode com --restaurar numa arvore descartavel) antes de seguir.`,
    );
    process.exit(2);
  }
}

imprimirPlacar(resultados);

const destino = argv[argv.indexOf("--json") + 1];
if (argv.includes("--json") && destino) {
  writeFileSync(destino, JSON.stringify({ rotulo, gerado: new Date().toISOString(), resultados }, null, 2));
  console.log(`\nplacar em ${destino}`);
}
