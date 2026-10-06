// =====================================================
// PULODOGATO - um processo por BLOCO de mutantes, nao por mutante
// =====================================================
// Importado pelos runners de controle negativo:
//
//   import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";
//   const bloco = criarBlocoDeMutantes({ suites: ["test:parcelamento"] });
//   const r = bloco.rodar("nome_do_mutante", { "lib/x.ts": fonteMutada }, "test:parcelamento");
//   bloco.fechar();
//
// POR QUE ISTO EXISTE (HMO-319)
// -----------------------------
// A HMO-263 fez os 98 alvos `test:*` compilarem num processo so (209s -> 28s) e
// mediu o que sobrou: os blocos de controle negativo, 556s, o maior item isolado
// de um push. Eles nao ganhavam nada com aquele desenho, por um motivo
// estrutural -- cada bloco montava uma COPIA da arvore em diretorio temporario e
// rodava `npm run <suite>` ali, UMA VEZ POR MUTANTE. Um alvo, um processo, nada
// a compartilhar.
//
// O que havia de desperdicio nessa volta, por mutante:
//
//   1. copiar components/ + lib/ + scripts/ (ou uma lista de "arquivos que
//      acompanham") -- centenas de arquivos, para trocar UM;
//   2. a partida do `npm` e do `tsc`;
//   3. o reparse do programa INTEIRO, quando entre dois mutantes muda um arquivo.
//
// Aqui o bloco e um processo so. A copia e feita UMA vez (e so do que a assercao
// precisa ler do disco). A compilacao e em processo, pelo `compilarComSobrescritas`
// do `compila.mjs`, que troca a fonte do arquivo mutado EM MEMORIA e reaproveita
// o AST ja parseado de todo o resto -- o unico arquivo reparseado por volta e o
// mutado.
//
// AS QUATRO COISAS QUE ISTO NAO PODE PERDER
// -----------------------------------------
// 1. **A FONTE DO REPOSITORIO NUNCA E MUTADA.** O texto mutado e escrito dentro
//    da sombra, em diretorio temporario -- nunca no arquivo que o git rastreia.
//    Um processo morto no meio (SIGTERM do timeout, cancelamento de job) deixa
//    no pior caso uma sombra orfa em /tmp, e nao um mutante na arvore. Era o modo
//    de falhar que ja plantou mutante neste repositorio duas vezes.
//
//    (A primeira versao disto nao escrevia a mutacao em disco nenhum, so em
//    memoria. Nao deu: ha suites que afirmam fiacao lendo o TEXTO da fonte, e
//    para elas um arquivo nao mutado no disco e um mutante que sobrevive sem
//    motivo visivel. Hoje a mutacao vai para os dois lugares, da mesma string.)
//
// 2. **O MUTANTE NAO PODE MORRER VERDE.** Duas travas independentes:
//    - o `outDir` de cada volta e APAGADO e reemitido (`compilarComSobrescritas`),
//      e nenhum manifesto e gravado ali, entao nao existe a decisao "esta saida
//      ainda vale?" para errar;
//    - a fonte mutada NAO entra no cache de AST (ver o comentario de
//      `compilarComSobrescritas`), entao a volta seguinte nunca le o texto da
//      anterior.
//
// 3. **O CONTROLE POSITIVO.** `rodar` com `{}` de sobrescritas compila e roda a
//    arvore intacta. E a unica coisa que pega erro no proprio aparelho: um
//    `rodar` quebrado reprova TODO mutante e o placar sai cheio, com o texto
//    "N/N mortos" sobre zero assercoes executadas. Os runners chamam o controle
//    antes dos mutantes e saem na hora se ele reprovar.
//
// 4. **O PLACAR TEM DE SIGNIFICAR O MESMO.** `rodar` devolve o mesmo
//    `{ verde, como, saida }` que os `rodar` locais dos runners devolviam, com a
//    mesma distincao entre morrer no `tsc` e morrer por assercao -- um mutante
//    que nem compila e informacao valida, mas nao prova nada sobre as assercoes.
//
// O QUE ELE PASSOU A MEDIR QUE OS `rodar` LOCAIS NAO MEDIAM
// ---------------------------------------------------------
// `mudouASaida`: se a mutacao mudou o JavaScript emitido em relacao ao controle.
// Mutante que SOBREVIVE emitindo byte identico nao e furo de assercao -- e
// mutante equivalente, e nenhuma assercao do mundo o mataria. A distincao vale
// porque a resposta certa para os dois casos e oposta (escrever assercao x tirar
// o mutante da lista), e sem ela um sobrevivente equivalente fica no placar para
// sempre, ensinando a nao ler o placar.
//
// O PIPELINE VEM DO package.json, NAO DO RUNNER
// ---------------------------------------------
// Os `rodar` locais repetiam a mao o que o alvo `test:X` faz (`tsc -p ...` e
// depois `resolve-aliases` e `node --test`). Duas copias da mesma receita
// divergem: mexer no alvo em package.json deixava o runner medindo um pipeline
// que nao e mais o da suite, e nada reclamava. Aqui as etapas sao lidas do
// proprio `scripts[suite]`, que e o que o CI roda.
// =====================================================

import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

import { compilarComSobrescritas, resolverInvocacao } from "./compila.mjs";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// ---------------------------------------------------------------------------
// A SOMBRA: a arvore inteira por symlink, so o arquivo mutado de verdade
// ---------------------------------------------------------------------------
// O bloco precisa de uma arvore onde a assercao possa rodar, e precisa dela
// barata -- ela e montada uma vez e reusada por todos os mutantes.
//
// Copiar nao serve (era o desenho de antes: centenas de arquivos por mutante).
// Symlinkar tudo tambem nao basta sozinho, porque algumas suites deste
// repositorio NAO leem apenas o JavaScript compilado: elas leem o TEXTO DA
// FONTE, para afirmar fiacao ("a lista e o resumo usam a mesma leitura"). Numa
// arvore de symlinks essas assercoes leriam o arquivo ORIGINAL, e o mutante
// sobreviveria sem que nada no placar explicasse por que.
//
// Dai a sombra: todo diretorio e symlink, menos os que ficam no caminho de um
// arquivo mutado. Esses viram diretorios de verdade cheios de symlinks para os
// filhos, com UMA excecao -- o arquivo mutado, que e escrito ali com o texto
// mutado. O custo e proporcional ao numero de irmaos do arquivo mutado, nao ao
// tamanho da arvore.
//
// A arvore de verdade nao e tocada em nenhum momento. E o `.tmp-*` do repo nao
// entra na sombra: a saida de cada volta e emitida dentro dela, e herdar a do
// repositorio deixaria a assercao lendo artefato que nao e desta volta.
const FORA_DA_SOMBRA = /^(\.git|\.next|\.tmp-|node_modules$)/;

/** Symlink de `destino` para o mesmo caminho na arvore de verdade. */
function espelhar(relativo, destino) {
  symlinkSync(path.join(RAIZ, relativo), destino);
}

/**
 * Faz de `relativo` um diretorio DE VERDADE na sombra, com os filhos
 * espelhados. Idempotente: um diretorio ja materializado nao e refeito.
 */
function materializarDiretorio(dir, relativo) {
  const naSombra = path.join(dir, relativo);
  let estado;
  try {
    estado = lstatSync(naSombra);
  } catch {
    estado = null;
  }
  if (estado?.isDirectory()) return;
  if (estado) unlinkSync(naSombra);
  mkdirSync(naSombra, { recursive: true });
  for (const filho of readdirSync(path.join(RAIZ, relativo))) {
    espelhar(path.join(relativo, filho), path.join(naSombra, filho));
  }
}

/** As etapas de um alvo `test:*`, na ordem, separando compilacao de assercao. */
function etapasDaSuite(comando, suite) {
  const etapas = [];
  for (const parte of comando.split("&&").map((s) => s.trim())) {
    if (!parte) continue;
    // O corte e pelo numero de palavras do PREFIXO: 2 para
    // `node scripts/compila.mjs`, 1 para `tsc`. Cortar uma palavra a mais nao da
    // erro -- com `-p x.json` sobra `x.json` sozinho, que o parseCommandLine
    // aceita como ARQUIVO-FONTE; o alvo "compila" um JSON, emite nada e sai com
    // sucesso. (O `resolverInvocacao` recusa raiz que nao e .ts/.tsx por causa
    // disso, mas o corte certo aqui e o que evita o problema.)
    if (/^node\s+scripts\/compila\.mjs\s/.test(parte)) {
      etapas.push({ tipo: "compila", argumentos: parte.split(/\s+/).slice(2) });
    } else if (/^tsc\s/.test(parte)) {
      etapas.push({ tipo: "compila", argumentos: parte.split(/\s+/).slice(1) });
    } else {
      etapas.push({ tipo: "comando", linha: parte });
    }
  }

  // Suite sem etapa de compilacao nao tem o que compartilhar, e rodar os
  // mutantes dela por aqui seria um placar sobre codigo que ninguem compilou:
  // a sobrescrita em memoria nunca chegaria a um artefato. Para alto.
  if (!etapas.some((e) => e.tipo === "compila")) {
    throw new Error(
      `${suite}: o comando nao tem etapa de compilacao (\`${comando}\`) -- este bloco nao serve para ela`,
    );
  }
  return etapas;
}

/** Os nomes dos testes que reprovaram, do formato do `node --test`. */
function testesQueReprovaram(saida) {
  const quais = [...saida.matchAll(/✖ (.+?) \(/g)]
    .map((m) => m[1])
    .filter((n) => n !== "failing tests:");
  return [...new Set(quais)].slice(0, 3).join("; ") || "reprovou";
}

/**
 * Monta o bloco: um diretorio, um processo, N voltas dentro.
 *
 * Nao recebe lista de arquivos a copiar, e isso e a diferenca que importa: a
 * sombra espelha a arvore INTEIRA, entao nao existe mais um recorte a mao para
 * envelhecer em silencio. Cinco blocos deste repositorio reprovavam na main
 * porque o codigo passou a importar `@/types/financial` e a lista de copia de
 * cada um nao acompanhou. Quem delimita o que um bloco prova e o tsconfig da
 * suite, que e o mesmo que o CI usa.
 */
export function criarBlocoDeMutantes({ suites, rotulo = "bloco" }) {
  if (!Array.isArray(suites) || suites.length === 0) {
    throw new Error("criarBlocoDeMutantes: passe ao menos uma suite");
  }

  const pkg = JSON.parse(readFileSync(path.join(RAIZ, "package.json"), "utf8"));
  const porSuite = new Map();
  for (const suite of suites) {
    const comando = pkg.scripts?.[suite];
    if (!comando) throw new Error(`${suite}: nao existe em package.json`);
    porSuite.set(suite, etapasDaSuite(comando, suite));
  }

  const dir = mkdtempSync(path.join(tmpdir(), `bloco-${rotulo}-`));

  for (const entrada of readdirSync(RAIZ)) {
    if (FORA_DA_SOMBRA.test(entrada)) {
      // `node_modules` tambem entra por symlink -- e o unico da lista de fora que
      // precisa existir na sombra, para o `node --test` achar as dependencias.
      if (entrada === "node_modules") espelhar(entrada, path.join(dir, entrada));
      continue;
    }
    espelhar(entrada, path.join(dir, entrada));
  }

  // `scripts/` E O UNICO DIRETORIO COPIADO DE VERDADE, e o motivo e o resolvedor
  // de modulos do node, nao a mutacao.
  //
  // As suites rodam como `node --test scripts/test-x.mjs` e importam a saida
  // compilada por caminho RELATIVO (`../.tmp-x/...`). O node resolve symlink por
  // realpath: com `scripts/test-x.mjs` sendo um link para a arvore de verdade, o
  // `../.tmp-x` do import cai no `.tmp-x` DO REPOSITORIO, e a suite mede o
  // artefato do lote em vez do que esta volta acabou de emitir. Foi o que
  // aconteceu ao escrever isto -- e o sintoma foi um `ERR_MODULE_NOT_FOUND` em
  // `@/lib`, nao algo que se leia como "medi a arvore errada".
  //
  // Copiado, `scripts/` fica dentro da sombra e o caminho relativo aponta para a
  // saida desta volta. Sao ~300 arquivos pequenos, uma vez por bloco.
  rmSync(path.join(dir, "scripts"), { force: true });
  cpSync(path.join(RAIZ, "scripts"), path.join(dir, "scripts"), { recursive: true });

  // Os arquivos que alguma volta ja materializou na sombra, com o texto
  // ORIGINAL de cada um. Sem isto, o arquivo mutado da volta N continuaria no
  // disco na volta N+1, e a assercao que le a fonte mediria o mutante anterior
  // -- o mesmo "morrer verde" por artefato velho, com o disco no lugar do cache.
  const materializados = new Map();

  // A saida emitida pelo controle, para responder "esta mutacao mudou o
  // artefato?". Preenchida na primeira volta sem sobrescritas.
  const saidaDoControle = new Map();

  function rodar(nome, sobrescritas = {}, suite = suites[0]) {
    const etapas = porSuite.get(suite);
    if (!etapas) throw new Error(`${suite}: nao foi declarada neste bloco`);

    // A MUTACAO VAI PARA DOIS LUGARES, DE PROPOSITO, e vem da mesma string:
    //   - a compilacao recebe o texto em memoria (`sobrescritas`), porque o AST
    //     compartilhado nao pode guardar fonte mutada;
    //   - a sombra recebe o arquivo no disco, porque algumas suites afirmam
    //     fiacao lendo o TEXTO da fonte, e na sombra elas leriam o original.
    // Os dois saem do mesmo argumento, entao nao ha como divergirem.
    for (const [caminho, texto] of Object.entries(sobrescritas)) {
      if (!materializados.has(caminho)) {
        const partes = caminho.split("/");
        for (let i = 1; i < partes.length; i++) {
          materializarDiretorio(dir, partes.slice(0, i).join("/"));
        }
        materializados.set(caminho, readFileSync(path.join(RAIZ, caminho), "utf8"));
        rmSync(path.join(dir, caminho), { force: true });
      }
      writeFileSync(path.join(dir, caminho), texto);
    }
    // Todo arquivo ja materializado que NAO esta mutado nesta volta volta ao
    // original. Rodar isto sempre, e nao "limpar depois", e o que sobrevive a um
    // `return` antecipado no meio das etapas.
    for (const [caminho, original] of materializados) {
      if (!(caminho in sobrescritas)) writeFileSync(path.join(dir, caminho), original);
    }

    const emitidoAgora = new Map();
    for (const etapa of etapas) {
      if (etapa.tipo !== "compila") continue;
      const { opcoes } = resolverInvocacao(etapa.argumentos);
      if (!opcoes.outDir) throw new Error(`${suite}: etapa de compilacao sem outDir`);
      const relativo = path.relative(RAIZ, path.resolve(RAIZ, opcoes.outDir));
      const r = compilarComSobrescritas({
        argumentos: etapa.argumentos,
        outDir: path.join(dir, relativo),
        sobrescritas,
      });
      if (r.erros > 0) {
        return {
          verde: false,
          como: "tsc",
          saida: r.mensagens.slice(0, 2).join(" | ").slice(0, 200),
          mudouASaida: true,
        };
      }
      for (const [arquivo, hash] of r.emitidos) emitidoAgora.set(`${relativo}/${arquivo}`, hash);
    }

    const semSobrescritas = Object.keys(sobrescritas).length === 0;
    if (semSobrescritas && saidaDoControle.size === 0) {
      for (const [k, v] of emitidoAgora) saidaDoControle.set(k, v);
    }
    const mudouASaida =
      semSobrescritas ||
      saidaDoControle.size === 0 ||
      emitidoAgora.size !== saidaDoControle.size ||
      [...emitidoAgora].some(([k, v]) => saidaDoControle.get(k) !== v);

    for (const etapa of etapas) {
      if (etapa.tipo !== "comando") continue;
      const r = spawnSync("bash", ["-lc", etapa.linha], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 32 * 1024 * 1024,
      });
      if (r.status !== 0) {
        const saida = String(r.stdout ?? "") + String(r.stderr ?? "");
        return { verde: false, como: "teste", saida: testesQueReprovaram(saida), mudouASaida };
      }
    }

    return { verde: true, mudouASaida };
  }

  return {
    dir,
    rodar,
    fechar: () => rmSync(dir, { recursive: true, force: true }),
  };
}
