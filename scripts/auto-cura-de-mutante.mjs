// =====================================================
// PULODOGATO - auto-cura na PARTIDA para runner que muta a arvore rastreada
// =====================================================
// Usado pelos runners de controle negativo que ainda escrevem no arquivo de
// producao (os que passaram para `criarBlocoDeMutantes` nao precisam disto --
// aquele desenho muta uma sombra em /tmp e nunca a arvore):
//
//   import { protegerArvore } from "./auto-cura-de-mutante.mjs";
//   const { originais, encerrar } = protegerArvore({
//     runner: "transferencia",
//     arquivos: ["lib/transferencia.ts"],
//   });
//   const original = originais["lib/transferencia.ts"];
//   ...
//   encerrar();
//
// POR QUE ISTO EXISTE (HMO-326)
// -----------------------------
// Os runners restauram o arquivo por `process.on("exit", restaurar)`, e alguns
// tratam `SIGINT`/`SIGTERM`. **Nenhum desses caminhos e confiavel**, por duas
// razoes medidas na HMO-321:
//
//   1. O `execSync` da suite BLOQUEIA a thread do JS. Node so entrega sinal
//      quando o loop ganha a vez, e o laco e `aplicar(mutante)` ->
//      `execSync(suite)` -> `restaurar()` -> proximo, sem folga. Um `SIGTERM`
//      mandado a `mutantes-painel-na-tela.mjs` -- que TEM o handler -- foi
//      ignorado por 2 minutos: o processo terminou a suite corrente e **aplicou
//      o mutante seguinte**. O `SigCgt` de `/proc/<pid>/status` confirmava o
//      sinal armado; o handler existe, so nao ganha a vez.
//   2. `SIGKILL` nao roda gancho nenhum, e um `timeout` real manda `SIGTERM` e
//      logo `SIGKILL`.
//
// Ou seja: handler de sinal cobre a janela estreita entre dois mutantes e nada
// mais. **Restauracao que depende do proprio processo nao fecha o buraco.** O
// unico ponto que sobrevive a `SIGKILL` e a PARTIDA da invocacao seguinte --
// e e onde este modulo age.
//
// A ORDEM E O CONTRATO, NAO UMA CONVENCAO
// ---------------------------------------
// `protegerArvore` DEVOLVE o texto original de cada arquivo, e e por isso que
// ele existe como funcao em vez de um par `curar()` / `travar()` que o runner
// chamaria antes de ler a fonte.
//
// Se o runner lesse a fonte ele mesmo, a ordem errada seria invisivel:
//
//   const original = readFileSync(ALVO, "utf8");   // <- le o MUTANTE que
//   protegerArvore({ ... });                       //    o run morto deixou
//
// Nesse caminho o runner adota o mutante como "original", mede todos os
// mutantes contra ele, e no fim "restaura" o mutante -- com o placar cheio e a
// arvore suja em silencio. Devolvendo os originais daqui, a leitura acontece
// depois da cura por construcao, e a ordem errada nao se escreve.
//
// O QUE A CURA NAO PODE FAZER: APAGAR TRABALHO LEGITIMO
// -----------------------------------------------------
// O sentinel guarda o conteudo que o arquivo tinha quando a medicao comecou --
// que pode incluir trabalho de feature nao commitado, e e isso mesmo que
// restaurar deve devolver. Mas um sentinel velho (de um run morto) mais edicoes
// legitimas feitas depois seria um `git checkout --` em cima do trabalho de
// alguem, e caladamente.
//
// Dai a copia de seguranca: antes de sobrescrever, o texto descartado vai para
// `.tmp-mutantes/<runner>.descartado/<caminho>`, e o stdout diz onde. Nada se
// perde, e a causa nao fica calada -- que era metade do problema original.
// =====================================================

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CASA = path.join(RAIZ, ".tmp-mutantes");

/**
 * A chave de desligamento, e ela existe para o CONTROLE NEGATIVO.
 *
 * Uma auto-cura que nunca foi vista reprovando pode nao estar fazendo nada --
 * e este repositorio ja teve placar ficticio sobrevivendo a um run inteiro.
 * `scripts/test-auto-cura-de-mutante.mjs` roda os dois casos de aceite com a
 * cura ligada e desligada, e exige que eles REPROVEM desligada.
 */
const DESLIGADA = process.env.MUTANTES_SEM_AUTO_CURA === "1";

const sentinelDe = (runner) => path.join(CASA, `${runner}.json`);
const lockDe = (runner) => path.join(CASA, `${runner}.lock`);

/**
 * O processo `pid` esta vivo E e do mesmo worktree?
 *
 * `kill -0` sozinho nao basta: o PID e reciclado, e um lock velho casaria com
 * um processo sem relacao nenhuma -- a segunda copia se recusaria a medir para
 * sempre. A confirmacao e o `cwd`, que e tambem o jeito certo de achar orfao
 * neste container (ha runner de mutante vivo em outros worktrees ao mesmo
 * tempo, e e por `cwd` que se distingue, nunca por nome de processo).
 */
function vivoNesteWorktree(pid, cwd) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return readlinkSync(`/proc/${pid}/cwd`) === cwd;
  } catch {
    // Sem `/proc` legivel (processo de outro usuario, ou plataforma sem procfs)
    // a resposta honesta e "pode ser": recusar e o lado seguro, porque medir
    // com outra copia escrevendo no mesmo arquivo nao vale de nada.
    return true;
  }
}

/**
 * Restaura o que um run morto deixou, trava o runner contra uma segunda copia,
 * e devolve o texto original dos arquivos que a medicao vai mutar.
 *
 * @param {object} opcoes
 * @param {string} opcoes.runner  nome curto, usado no sentinel e no lock
 * @param {string[]} opcoes.arquivos  caminhos relativos a raiz do repositorio
 * @returns {{ originais: Record<string,string>, restaurar: () => void, encerrar: () => void }}
 */
export function protegerArvore({ runner, arquivos }) {
  if (!runner || typeof runner !== "string") {
    throw new Error("protegerArvore: passe um `runner` (nome curto, para o sentinel)");
  }
  if (!Array.isArray(arquivos) || arquivos.length === 0) {
    throw new Error("protegerArvore: passe `arquivos`, a lista do que a medicao vai mutar");
  }

  if (!DESLIGADA) {
    mkdirSync(CASA, { recursive: true });
    curar(runner);
    travar(runner);
  }

  // A leitura acontece DEPOIS da cura, por construcao -- ver o contrato de
  // ordem no cabecalho.
  const originais = {};
  for (const relativo of arquivos) {
    originais[relativo] = readFileSync(path.join(RAIZ, relativo), "utf8");
  }

  const restaurar = () => {
    for (const [relativo, texto] of Object.entries(originais)) {
      writeFileSync(path.join(RAIZ, relativo), texto);
    }
  };

  if (!DESLIGADA) {
    writeFileSync(sentinelDe(runner), JSON.stringify({ runner, pid: process.pid, originais }));
  }

  const encerrar = () => {
    restaurar();
    if (DESLIGADA) return;
    rmSync(sentinelDe(runner), { force: true });
    rmSync(lockDe(runner), { force: true });
  };

  // O gancho de `exit` FICA. Ele nao e errado, e so insuficiente: cobre a saida
  // normal e o `process.exit` de um erro, que sao a maioria das saidas. O que
  // ele nao cobre -- `SIGKILL`, e `SIGTERM` durante o `execSync` -- e o que a
  // cura da partida cobre.
  process.on("exit", restaurar);

  return { originais, restaurar, encerrar };
}

/** Desfaz o que um run morto deixou gravado, e diz que desfez. */
function curar(runner) {
  const sentinel = sentinelDe(runner);
  if (!existsSync(sentinel)) return;

  let gravado;
  try {
    gravado = JSON.parse(readFileSync(sentinel, "utf8"));
  } catch {
    // Sentinel truncado (o run morreu no meio da propria gravacao) nao tem
    // original para devolver. Apagar e o certo: manter um JSON ilegivel ali so
    // faria toda invocacao seguinte parar no mesmo lugar.
    console.log(`auto-cura: sentinel de ${runner} ilegivel, descartado`);
    unlinkSync(sentinel);
    return;
  }

  const restaurados = [];
  for (const [relativo, original] of Object.entries(gravado.originais ?? {})) {
    const arquivo = path.join(RAIZ, relativo);
    let agora = null;
    try {
      agora = readFileSync(arquivo, "utf8");
    } catch {
      // Arquivo sumiu: devolver o original e exatamente o conserto.
    }
    if (agora === original) continue;

    if (agora !== null) {
      const guardado = path.join(CASA, `${runner}.descartado`, relativo);
      mkdirSync(path.dirname(guardado), { recursive: true });
      writeFileSync(guardado, agora);
    }
    writeFileSync(arquivo, original);
    restaurados.push(relativo);
  }

  unlinkSync(sentinel);

  // A causa nao pode ficar calada: sem isto, a cura seria indistinguivel de
  // "a arvore estava limpa", e o run morto que plantou o mutante nunca
  // apareceria em lugar nenhum.
  if (restaurados.length === 0) {
    console.log(`auto-cura: sentinel de ${runner} sem nada a desfazer, apagado`);
  } else {
    console.log(
      `auto-cura: um run morto deixou ${restaurados.length} arquivo(s) mutado(s) -- RESTAURADO: ${restaurados.join(", ")}`,
    );
    console.log(`auto-cura: o texto descartado ficou em .tmp-mutantes/${runner}.descartado/`);
  }
}

/**
 * Recusa a medicao se outra copia do mesmo runner estiver viva neste worktree.
 *
 * Isto e independente da cura, e e o ponto que evita a medicao INVALIDADA: duas
 * copias restaurando "o original" a partir de duas copias em memoria deixam o
 * arquivo mutado no fim, e a ultima a restaurar ganha. Na HMO-321 foi o que
 * jogou fora ~15 min de parede com o placar travado.
 */
function travar(runner) {
  const lock = lockDe(runner);
  if (existsSync(lock)) {
    let dono = null;
    try {
      dono = JSON.parse(readFileSync(lock, "utf8"));
    } catch {
      dono = null;
    }
    if (dono?.pid && vivoNesteWorktree(dono.pid, dono.cwd)) {
      console.error(
        `RECUSADO: ${runner} ja esta rodando neste worktree (pid ${dono.pid}, desde ${dono.iniciado}).`,
      );
      console.error(
        "Duas copias do mesmo runner no mesmo worktree restauram o original a partir de duas copias em memoria: a ultima ganha, e o arquivo fica mutado. A medicao nao valeria.",
      );
      console.error(`Se o pid ${dono.pid} for orfao de um run morto, mate-o por PID exato e tente de novo.`);
      process.exit(9);
    }
    console.log(`auto-cura: lock de ${runner} era de um pid morto (${dono?.pid ?? "?"}), assumido`);
  }
  // O `cwd` gravado e o REAL do processo, nao a RAIZ: ele serve para conferir a
  // identidade do pid no `/proc` (contra reciclagem de PID), e um runner
  // disparado de um subdiretorio tem cwd diferente da raiz. Gravar RAIZ aqui
  // faria a conferencia falhar e o lock de uma copia VIVA ser assumido -- o
  // lado errado de errar.
  writeFileSync(
    lock,
    JSON.stringify({ pid: process.pid, cwd: process.cwd(), iniciado: new Date().toISOString() }),
  );
}
