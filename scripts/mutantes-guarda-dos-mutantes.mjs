#!/usr/bin/env node
// Os mutantes do `check-mutantes-in-ci.mjs`: a guarda sabe falhar?
//
// POR QUE (HMO-322)
// -----------------
// A guarda nova passou verde na primeira execucao. Verde de primeira nao prova
// nada -- uma guarda que nunca reprovou pode estar medindo o conjunto vazio, e
// este repositorio ja teve `10/10 mutantes mortos` ficticio sobrevivendo a um
// run inteiro. Cada peneira do `check-mutantes-in-ci` ganha aqui um mutante que
// ela TEM de pegar.
//
// O mutante mais importante e o 3: a guarda e textual, e os workflows citam
// runners DENTRO DE COMENTARIOS ("A prova de mutacao completa e `npm run
// mutantes:retorno-lancamento`"). Uma versao que lesse comentario absolveria
// cinco runners que nao tem step nenhum -- exatamente o buraco que a HMO-322
// abriu para fechar, reaberto por dentro da propria guarda.
//
// A ARVORE DE PRODUCAO NUNCA E TOCADA
// -----------------------------------
// O jeito usual deste repositorio (mutar a fonte, rodar, restaurar no finally)
// deixa o mutante GRAVADO quando o processo morre no meio -- `process.on("exit")`
// nao roda em SIGTERM, que e o sinal que `timeout` e cancelamento de job mandam,
// e dali em diante tudo mede o arquivo errado. Ja aconteceu aqui mais de uma vez.
//
// Esta guarda nao precisa desse risco: ela nao tem dependencia externa nenhuma
// (so `node:*` e um import relativo), entao roda inteira dentro de uma COPIA em
// diretorio temporario. Muta-se a copia. O pior caso de uma interrupcao e um
// diretorio orfao em /tmp -- nao um mutante no repositorio. Por isso tambem nao
// existe `trap` nem `git checkout --` aqui: nao ha nada para restaurar.

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const GUARDA = "scripts/check-mutantes-in-ci.mjs";
const DECLARACAO = "scripts/declaracao-de-mutantes-fora-do-ci.mjs";
const WORKFLOW = ".github/workflows/verificacao.yml";

let sandbox = null;
const limpar = () => {
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
  sandbox = null;
};
process.on("exit", limpar);
process.on("SIGINT", () => process.exit(130));
// SIGTERM e o sinal do `timeout` e do cancelamento de job. Sem isto o gancho de
// `exit` nao roda e o diretorio fica -- inofensivo, mas o placar nao sai.
process.on("SIGTERM", () => process.exit(143));

/** Uma copia limpa do que a guarda le: scripts/, workflows e package.json. */
function novoSandbox() {
  limpar();
  sandbox = mkdtempSync(join(tmpdir(), "mutantes-guarda-"));
  cpSync(join(RAIZ, "scripts"), join(sandbox, "scripts"), { recursive: true });
  cpSync(join(RAIZ, ".github/workflows"), join(sandbox, ".github/workflows"), { recursive: true });
  cpSync(join(RAIZ, "package.json"), join(sandbox, "package.json"));
  return sandbox;
}

function rodarGuarda(dir) {
  const r = spawnSync("node", [join(dir, GUARDA)], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return { codigo: r.status, saida: String(r.stdout ?? "") + String(r.stderr ?? "") };
}

const ler = (dir, rel) => readFileSync(join(dir, rel), "utf8");
const escrever = (dir, rel, txt) => writeFileSync(join(dir, rel), txt);

// ---------------------------------------------------------------------------
// Controle positivo: a copia INTACTA passa.
// ---------------------------------------------------------------------------
// Isto nao e cerimonia. E o unico mutante que pega erro no proprio runner: se o
// sandbox estiver incompleto (um arquivo que a guarda le e que eu esqueci de
// copiar), a guarda reprova por motivo ERRADO e todos os mutantes abaixo
// "morreriam" sem medir nada. Vacuidade e o modo de falha a vencer aqui.
{
  const dir = novoSandbox();
  const { codigo, saida } = rodarGuarda(dir);
  if (codigo !== 0) {
    console.error("CONTROLE POSITIVO FALHOU: a arvore intacta devia passar.\n" + saida);
    process.exit(1);
  }
  // O censo tem de FECHAR: invocados + declarados = total. Conferir a
  // aritmetica, e nao um numero escrito aqui, por duas razoes. A primeira e que
  // numero congelado envelhece -- a primeira versao disto exigia "19
  // invocados" e quebrou no mesmo dia, quando este runner virou o vigesimo. A
  // segunda e que a aritmetica e justamente o que pega sandbox incompleto: se
  // faltar copiar algo que a guarda le, o total despenca e a conta nao fecha,
  // em vez de os mutantes abaixo morrerem todos por vacuidade.
  const censo = saida.match(
    /(\d+) runners de mutante na arvore: (\d+) invocados por algum workflow, (\d+) declarados/,
  );
  if (!censo) {
    console.error("CONTROLE POSITIVO FALHOU: a guarda passou sem relatar o censo.\n" + saida);
    process.exit(1);
  }
  const [total, invocados, declarados] = censo.slice(1).map(Number);
  if (invocados + declarados !== total) {
    console.error(
      `CONTROLE POSITIVO FALHOU: o censo nao fecha ` +
        `(${invocados} + ${declarados} != ${total}).\n` + saida,
    );
    process.exit(1);
  }
  if (total < 50 || invocados < 10) {
    console.error(
      `CONTROLE POSITIVO FALHOU: so ${total} runners e ${invocados} invocados -- ` +
        `o sandbox esta incompleto e os mutantes abaixo mediriam nada.\n` + saida,
    );
    process.exit(1);
  }
  console.log(
    `controle positivo: arvore intacta -> passa, e o censo fecha ` +
      `(${invocados} invocados + ${declarados} declarados = ${total}).`,
  );
}

/**
 * Os mutantes. Cada um: muta o sandbox, e a guarda TEM de reprovar citando
 * `espera`.
 *
 * `espera` existe porque "reprovou" nao basta: uma guarda que estoura por outro
 * motivo (arquivo faltando, JSON invalido) reprovaria igual, e o mutante
 * passaria por morto sem que a peneira de interesse tivesse opinado.
 */
const MUTANTES = [
  {
    nome: "runner novo, sem step e sem declaracao",
    peneira: "a peneira principal",
    espera: /nenhum workflow roda e ninguem declarou[\s\S]*mutantes-inventado-pela-hmo322/,
    mutar(dir) {
      escrever(dir, "scripts/mutantes-inventado-pela-hmo322.mjs", "// runner novo\n");
    },
  },
  {
    nome: "runner citado SO em comentario de workflow conta como vigiado",
    peneira: "o recorte de comentarios",
    espera: /nenhum workflow roda e ninguem declarou[\s\S]*mutantes-crivos\.mjs/,
    // Tira o `crivos` da declaracao e poe o comando dele num COMENTARIO do
    // workflow. Uma guarda que le comentario o daria por coberto; a certa
    // continua acusando, porque comentario nao executa.
    mutar(dir) {
      const d = ler(dir, DECLARACAO).replace(
        /\s*"scripts\/mutantes-crivos\.mjs": \{ motivo: "nao-triado", porque: "HMO-322" \},/,
        "",
      );
      if (d === ler(dir, DECLARACAO)) throw new Error("ancora do crivos nao casou");
      escrever(dir, DECLARACAO, d);
      const w = ler(dir, WORKFLOW).replace(
        /^(jobs:)/m,
        "# roda node scripts/mutantes-crivos.mjs e npm run mutantes:crivos\n$1",
      );
      escrever(dir, WORKFLOW, w);
      // O teto cai junto, senao a reprovacao poderia vir da catraca.
      escrever(dir, GUARDA, ler(dir, GUARDA).replace("TETO_NAO_TRIADO = 34", "TETO_NAO_TRIADO = 33"));
    },
  },
  {
    nome: "declaracao que sobreviveu ao step (runner entrou no CI e a linha ficou)",
    peneira: "declaracao obsoleta",
    espera: /declarado fora do CI, mas[\s\S]*A declaracao ficou para tras/,
    // `mutantes-dinheiro.mjs` TEM step. Declara-lo fora do CI e a contradicao.
    mutar(dir) {
      const d = ler(dir, DECLARACAO).replace(
        /^};$/m,
        '  "scripts/mutantes-dinheiro.mjs": { motivo: "nao-triado", porque: "HMO-322" },\n};',
      );
      escrever(dir, DECLARACAO, d);
      escrever(dir, GUARDA, ler(dir, GUARDA).replace("TETO_NAO_TRIADO = 34", "TETO_NAO_TRIADO = 35"));
    },
  },
  {
    nome: "coberto_por apontando para step que nao existe mais",
    peneira: "cobertura falsificavel",
    espera: /diz ser coberto por[\s\S]*nao e nenhum step ativo/,
    mutar(dir) {
      const d = ler(dir, DECLARACAO).replace(
        'coberto_por: "A verificacao sabe falhar (fatura do periodo)"',
        'coberto_por: "Um bloco que foi renomeado e ninguem percebeu"',
      );
      if (d === ler(dir, DECLARACAO)) throw new Error("ancora do coberto_por nao casou");
      escrever(dir, DECLARACAO, d);
    },
  },
  {
    nome: "coberto_por citado apenas em COMENTARIO do workflow",
    peneira: "cobertura falsificavel (comentario)",
    espera: /diz ser coberto por[\s\S]*nao e nenhum step ativo/,
    // O step e apagado e o nome dele sobra num comentario. Se a busca de
    // cobertura lesse comentario, a cobertura morta passaria por viva.
    mutar(dir) {
      const alvo = "A verificacao sabe falhar (lancamentos-completos)";
      const w = ler(dir, WORKFLOW).split("\n");
      const i = w.findIndex((l) => l.includes(alvo) && /^\s*- name:/.test(l));
      if (i < 0) throw new Error("step do lancamentos-completos nao encontrado");
      w[i] = `      # - name: '${alvo}'`;
      escrever(dir, WORKFLOW, w.join("\n"));
    },
  },
  {
    nome: "motivo fora do vocabulario",
    peneira: "vocabulario fechado",
    espera: /nao esta no vocabulario/,
    mutar(dir) {
      const d = ler(dir, DECLARACAO).replace('motivo: "precisa-de-banco"', 'motivo: "por-enquanto"');
      if (d === ler(dir, DECLARACAO)) throw new Error("ancora do motivo nao casou");
      escrever(dir, DECLARACAO, d);
    },
  },
  {
    nome: "declaracao sem explicar por que",
    peneira: "porque obrigatorio",
    espera: /sem explicar por que/,
    mutar(dir) {
      const d = ler(dir, DECLARACAO).replace(
        '{ motivo: "nao-triado", porque: "HMO-322" }',
        '{ motivo: "nao-triado", porque: "" }',
      );
      if (d === ler(dir, DECLARACAO)) throw new Error("ancora do porque nao casou");
      escrever(dir, DECLARACAO, d);
    },
  },
  {
    nome: "nao-triado acima do teto (a catraca andando para tras)",
    peneira: "o teto da divida",
    espera: /estao `nao-triado`, e o teto e/,
    mutar(dir) {
      escrever(dir, GUARDA, ler(dir, GUARDA).replace("TETO_NAO_TRIADO = 34", "TETO_NAO_TRIADO = 20"));
    },
  },
  {
    nome: "triagem feita e teto nao acompanhou (a catraca parada)",
    peneira: "o teto da divida, para baixo",
    espera: /baixe TETO_NAO_TRIADO para/,
    mutar(dir) {
      const d = ler(dir, DECLARACAO).replace(
        /\s*"scripts\/mutantes-cash-flow\.mjs": \{ motivo: "nao-triado", porque: "HMO-322" \},/,
        "",
      );
      if (d === ler(dir, DECLARACAO)) throw new Error("ancora do cash-flow nao casou");
      // Apagar o runner junto, senao a reprovacao vem da peneira principal.
      escrever(dir, DECLARACAO, d);
      rmSync(join(dir, "scripts/mutantes-cash-flow.mjs"));
    },
  },
  {
    nome: "step invocando runner que nao existe na arvore",
    peneira: "step morto",
    espera: /que nao existe na arvore/,
    mutar(dir) {
      rmSync(join(dir, "scripts/mutantes-dinheiro.mjs"));
    },
  },
  {
    nome: "declaracao citando runner que nao existe na arvore",
    peneira: "entrada obsoleta",
    espera: /declara[\s\S]*que nao existe na arvore/,
    mutar(dir) {
      rmSync(join(dir, "scripts/mutantes-crivos.mjs"));
    },
  },
  {
    nome: "alvo npm apontando para runner inexistente",
    peneira: "alvo npm quebrado",
    espera: /aponta para[\s\S]*que nao existe na arvore/,
    mutar(dir) {
      const p = JSON.parse(ler(dir, "package.json"));
      p.scripts["mutantes:fantasma"] = "node scripts/mutantes-fantasma.mjs";
      escrever(dir, "package.json", JSON.stringify(p, null, 2));
    },
  },
  {
    nome: "a declaracao renomeada para DENTRO do espaco de nomes que ela descreve",
    peneira: "sonda que se mede a si mesma",
    espera: /esta sendo contado como RUNNER|nenhum workflow roda e ninguem declarou/,
    // Foi o nome que este arquivo teve por um instante. Nele a declaracao se
    // conta como runner e passa a precisar declarar a si mesma.
    mutar(dir) {
      const novo = "scripts/mutantes-fora-do-ci.mjs";
      escrever(dir, novo, ler(dir, DECLARACAO));
      escrever(
        dir,
        GUARDA,
        ler(dir, GUARDA).replace(/declaracao-de-mutantes-fora-do-ci\.mjs/g, "mutantes-fora-do-ci.mjs"),
      );
      rmSync(join(dir, DECLARACAO));
    },
  },
];

// ---------------------------------------------------------------------------
// O laco
// ---------------------------------------------------------------------------
const sobreviventes = [];
const invalidos = [];

for (const [i, m] of MUTANTES.entries()) {
  const dir = novoSandbox();

  // Fotografia do que a guarda le, para exigir que a mutacao ENTROU. `exit 0`
  // nao distingue "mutei e a guarda nao viu" de "nao mutei nada", e as duas se
  // leem como buraco na guarda.
  const antes = ["scripts", ".github/workflows"]
    .flatMap((d) => readdirSync(join(dir, d)).map((f) => `${d}/${f}`))
    .sort()
    .join("\n");
  const conteudoAntes = [GUARDA, DECLARACAO, WORKFLOW, "package.json"]
    .map((f) => {
      try {
        return ler(dir, f);
      } catch {
        return "";
      }
    })
    .join(" ");

  try {
    m.mutar(dir);
  } catch (e) {
    invalidos.push(`${m.nome}: ANCORA AUSENTE (${e.message})`);
    continue;
  }

  const depois = ["scripts", ".github/workflows"]
    .flatMap((d) => readdirSync(join(dir, d)).map((f) => `${d}/${f}`))
    .sort()
    .join("\n");
  const conteudoDepois = [GUARDA, DECLARACAO, WORKFLOW, "package.json"]
    .map((f) => {
      try {
        return ler(dir, f);
      } catch {
        return "";
      }
    })
    .join(" ");

  if (antes === depois && conteudoAntes === conteudoDepois) {
    invalidos.push(`${m.nome}: NAO APLICOU (a arvore do sandbox nao mudou)`);
    continue;
  }

  const { codigo, saida } = rodarGuarda(dir);

  if (codigo === 0) {
    sobreviventes.push(`SOBREVIVEU: ${m.nome} (${m.peneira}) -- a guarda passou verde`);
    console.log(`  ${i + 1}/${MUTANTES.length} SOBREVIVEU  ${m.nome}`);
    continue;
  }
  if (!m.espera.test(saida)) {
    sobreviventes.push(
      `SOBREVIVEU: ${m.nome} (${m.peneira}) -- reprovou por OUTRO motivo:\n` +
        saida.split("\n").slice(0, 12).join("\n"),
    );
    console.log(`  ${i + 1}/${MUTANTES.length} MOTIVO ERRADO  ${m.nome}`);
    continue;
  }
  console.log(`  ${i + 1}/${MUTANTES.length} morreu       ${m.nome}  [${m.peneira}]`);
}

limpar();

if (invalidos.length > 0) {
  console.error(`\n${invalidos.length} mutante(s) invalido(s) -- o placar nao vale:\n`);
  for (const s of invalidos) console.error(`  ${s}`);
  process.exit(1);
}

if (sobreviventes.length > 0) {
  console.error(`\n${sobreviventes.length} de ${MUTANTES.length} sobreviveram:\n`);
  for (const s of sobreviventes) console.error(`  ${s}\n`);
  process.exit(1);
}

console.log(
  `\n${MUTANTES.length}/${MUTANTES.length} mutantes mortos: cada peneira do ` +
    `check-mutantes-in-ci sabe reprovar, e a arvore de producao nao foi tocada.`,
);
process.exit(0);
