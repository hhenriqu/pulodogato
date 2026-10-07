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
const WORKFLOW_DB = ".github/workflows/db-verify.yml";

/**
 * Os arquivos que a guarda LE, e de que esta medicao tira fotografia antes e
 * depois de mutar (ver "NAO APLICOU" la embaixo).
 *
 * Tem de incluir TODO arquivo que algum mutante toca. Um mutante que muda um
 * arquivo fora desta lista cai em "NAO APLICOU" -- a fotografia nao muda, a
 * medicao conclui que a mutacao nao entrou, e o mutante some do placar. Foi o
 * que quase aconteceu com o db-verify.yml quando a HMO-322 passou a mutar os
 * steps de banco.
 */
const LIDOS_PELA_GUARDA = [GUARDA, DECLARACAO, WORKFLOW, WORKFLOW_DB, "package.json"];

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
    espera: /nenhum workflow roda e ninguem declarou[\s\S]*mutantes-so-em-comentario\.mjs/,
    // RUNNER DE VERDADE NAO SERVE DE ANCORA: a triagem apaga runners.
    //
    // Isto apontava para o `mutantes-crivos.mjs` -- o exemplo que abriu a
    // HMO-322 -- e a HMO-332 apagou aquele arquivo. A ancora na declaracao
    // parou de casar, o mutante caiu em ANCORA AUSENTE e levou o placar com
    // ele. E a mesma licao dos mutantes do teto mais abaixo, por outro caminho:
    // o que a triagem mexe nao se usa como ancora.
    //
    // Um runner INVENTADO aqui dentro nao envelhece e mede o mesmo: nasce sem
    // step e sem declaracao, e sua unica mencao no workflow esta num COMENTARIO.
    // Uma guarda que lesse comentario o daria por vigiado e nao diria nada; a
    // certa continua acusando, porque comentario nao executa. O mutante 1, logo
    // acima, nao cita o runner em lugar nenhum e morreria com ou sem o recorte;
    // este e o que fala sobre o recorte.
    //
    // MEDIDO ao reescrever isto (HMO-332): tirar o `semComentarios` da guarda
    // NAO deixa este mutante sobreviver -- derruba o CONTROLE POSITIVO antes,
    // com 7 erros reais ("declarado fora do CI, mas db-verify.yml o invoca"),
    // porque os `ferramenta-de-autor` sao citados em comentario de workflow e
    // sem o recorte passam a contar como invocados. Ou seja: o recorte esta
    // preso pelo controle positivo, com folga, e este mutante e o que NOMEIA a
    // regra. Vale saber, para ninguem o ler como a unica rede embaixo dela.
    //
    // Nao mexe no teto, porque nao cria entrada `nao-triado` nenhuma.
    mutar(dir) {
      escrever(dir, "scripts/mutantes-so-em-comentario.mjs", "// runner novo\n");
      const w = ler(dir, WORKFLOW).replace(
        /^(jobs:)/m,
        "# roda node scripts/mutantes-so-em-comentario.mjs e npm run mutantes:so-em-comentario\n$1",
      );
      if (w === ler(dir, WORKFLOW)) throw new Error("ancora `jobs:` do workflow nao casou");
      escrever(dir, WORKFLOW, w);
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
      // O teto SOBE um, senao a entrada nova tambem estoura a catraca e a
      // reprovacao passa a ter duas causas -- o `espera` casaria do mesmo jeito
      // e o mutante morreria sem que esta peneira fosse a responsavel.
      //
      // Dinamico pela mesma razao dos mutantes do teto mais abaixo: isto era
      // `.replace("TETO_NAO_TRIADO = 34", ...)` e virou no-op silencioso quando
      // a primeira triagem baixou o teto para 33 -- um `String.replace` que nao
      // casa nao reclama. Achado ao baixar o teto para 26 (HMO-332).
      escrever(
        dir,
        GUARDA,
        ler(dir, GUARDA).replace(
          /TETO_NAO_TRIADO = (\d+)/,
          (_, n) => `TETO_NAO_TRIADO = ${Number(n) + 1}`,
        ),
      );
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
    nome: "step de banco apagado do db-verify.yml (os 4 ligados pela HMO-322)",
    peneira: "a peneira principal, pelo segundo workflow",
    espera: /nenhum workflow roda e ninguem declarou[\s\S]*mutantes-categorias\.sh/,
    // POR QUE ESTE MUTANTE EXISTE
    // ---------------------------
    // A HMO-322 tirou quatro runners da declaracao e deu step a cada um no
    // db-verify.yml. Dali em diante, "estes quatro estao vigiados" passou a
    // ser uma afirmacao sobre UM SEGUNDO workflow -- e os outros doze mutantes
    // aqui so mexem no verificacao.yml.
    //
    // Sem este, apagar o step do `mutantes-categorias.sh` devolveria o runner
    // a condicao de orfao em silencio: ele sairia da declaracao (ja saiu) e
    // nao teria step nenhum, que e exatamente o estado que a HMO-322 foi
    // aberta para tornar impossivel. E o buraco se reabriria pelo lado que
    // nenhuma medicao estava olhando.
    mutar(dir) {
      const alvo = "scripts/mutantes-categorias.sh";
      const w = ler(dir, WORKFLOW_DB).split("\n");
      const i = w.findIndex((l) => l.includes(alvo) && /^\s*run:/.test(l));
      if (i < 0) throw new Error("step do mutantes-categorias.sh nao encontrado no db-verify");
      // Vira comentario, e nao linha apagada: assim o nome do arquivo CONTINUA
      // no texto do workflow. Uma guarda que procurasse o nome sem recortar
      // comentario daria o runner por vigiado, e este mutante sobreviveria --
      // o mesmo defeito que o mutante do `coberto_por` em comentario mede do
      // outro lado.
      w[i] = `        # ${w[i].trim()}`;
      escrever(dir, WORKFLOW_DB, w.join("\n"));
    },
  },
  {
    nome: "motivo fora do vocabulario",
    peneira: "vocabulario fechado",
    espera: /nao esta no vocabulario/,
    mutar(dir) {
      // A ANCORA E A FORMA, NAO UM MOTIVO ESPECIFICO.
      //
      // Isto era `.replace('motivo: "precisa-de-banco"', ...)`. Quando a
      // HMO-322 ligou os quatro runners de banco no db-verify.yml, o motivo
      // `precisa-de-banco` saiu do vocabulario -- e este mutante ficou SEM
      // ancora. O runner se portou bem (acusou ANCORA AUSENTE e recusou o
      // placar em vez de contar o mutante como morto), mas o controle havia
      // parado de medir.
      //
      // Casar com `motivo: "<qualquer coisa>"` nao envelhece: ele depende
      // apenas de a declaracao ter pelo menos uma entrada, que e a premissa
      // do arquivo. Nao serve ancorar em `nao-triado`: trocar o motivo DELE
      // mexeria tambem na contagem do teto, e o mutante morreria pela peneira
      // errada com a mensagem certa.
      const alvo = /motivo: "(?!nao-triado)[a-z-]+"/;
      const texto = ler(dir, DECLARACAO);
      if (!alvo.test(texto)) throw new Error("ancora do motivo nao casou");
      escrever(dir, DECLARACAO, texto.replace(alvo, 'motivo: "por-enquanto"'));
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
    nome: "biblioteca-de-runner que NINGUEM importa",
    peneira: "a biblioteca tem de ser importada",
    espera: /se declara `biblioteca-de-runner` e NENHUM runner a importa/,
    // `biblioteca-de-runner` e, de longe, o motivo mais facil de abusar: ele
    // dispensa o step dizendo "nao sou runner, sou codigo que os runners
    // importam". Se a guarda aceitasse isso pela palavra, qualquer orfao sairia
    // da divida com uma linha de texto -- e a HMO-322 teria entregue uma
    // desculpa nova em vez de uma medida.
    //
    // Aqui o `em-bloco` e renomeado (junto com quem o importa, para a arvore
    // ficar consistente): a declaracao continua dizendo `biblioteca-de-runner`
    // sobre um arquivo que ninguem mais importa, e a guarda tem de acusar.
    mutar(dir) {
      const alvo = "scripts/mutantes-em-bloco.mjs";
      const texto = ler(dir, DECLARACAO);
      if (!texto.includes(`"${alvo}"`)) throw new Error("ancora do em-bloco nao casou");
      // Apaga o arquivo da biblioteca e poe no lugar um com nome que ninguem
      // importa. A entrada da declaracao passa a apontar para ele.
      escrever(dir, "scripts/mutantes-em-bloco-renomeado.mjs", ler(dir, alvo));
      rmSync(join(dir, alvo));
      escrever(
        dir,
        DECLARACAO,
        texto.replace(`"${alvo}"`, '"scripts/mutantes-em-bloco-renomeado.mjs"'),
      );
    },
  },
  {
    nome: "nao-triado acima do teto (a catraca andando para tras)",
    peneira: "o teto da divida",
    espera: /estao `nao-triado`, e o teto e/,
    // O TETO E UM NUMERO QUE MUDA A CADA TRIAGEM -- nao se ancora nele.
    //
    // Isto era `.replace("TETO_NAO_TRIADO = 34", ...)`. O teto e uma catraca
    // que desce a cada runner triado, entao a ancora literal morre na PRIMEIRA
    // triagem -- e morreu: baixar o teto para 33 fez este mutante cair em "NAO
    // APLICOU" e sair do placar. O mutante seguinte a descobrir isso seria o
    // proximo a baixar o teto, e assim por diante.
    //
    // Zero serve para qualquer teto: se ha pelo menos um `nao-triado`, a
    // contagem fica acima de zero e a peneira opina. Quando a divida chegar a
    // zero, esta peneira nao tem mais nada para medir -- e o `throw` abaixo diz
    // isso com essas palavras, em vez de deixar um "NAO APLICOU" que se le como
    // defeito do runner.
    mutar(dir) {
      const atual = ler(dir, GUARDA).match(/TETO_NAO_TRIADO = (\d+)/);
      if (!atual) throw new Error("TETO_NAO_TRIADO nao encontrado na guarda");
      if (atual[1] === "0") {
        throw new Error(
          "o teto ja e 0: a divida `nao-triado` acabou e esta peneira nao tem mais o que medir -- retire este mutante",
        );
      }
      escrever(dir, GUARDA, ler(dir, GUARDA).replace(/TETO_NAO_TRIADO = \d+/, "TETO_NAO_TRIADO = 0"));
    },
  },
  {
    nome: "triagem feita e teto nao acompanhou (a catraca parada)",
    peneira: "o teto da divida, para baixo",
    espera: /baixe TETO_NAO_TRIADO para/,
    // Tira UM `nao-triado` qualquer, e nao o `cash-flow` pelo nome.
    //
    // A ancora literal era `mutantes-cash-flow.mjs`. Ela sobrevive enquanto
    // ninguem triar o cash-flow -- e triar os `nao-triado` um a um e exatamente
    // o trabalho que esta por vir (decisao do Helio em 2026-10-07: apagar e o
    // default). A ancora morreria no dia em que a triagem chegasse nele, e
    // morreria em silencio, porque "NAO APLICOU" nao se le como ancora morta.
    //
    // Pegar o PRIMEIRO da lista nao envelhece: a premissa e so que exista ao
    // menos um `nao-triado`, que e a premissa da peneira inteira.
    mutar(dir) {
      const texto = ler(dir, DECLARACAO);
      const alvo = texto.match(
        /\s*"(scripts\/mutantes-[a-z0-9-]+\.(?:mjs|sh))": \{ motivo: "nao-triado"[^}]*\},/,
      );
      if (!alvo) {
        throw new Error(
          "nenhuma entrada `nao-triado` na declaracao -- a divida acabou e esta peneira nao tem mais o que medir",
        );
      }
      escrever(dir, DECLARACAO, texto.replace(alvo[0], ""));
      // Apagar o runner junto, senao a reprovacao vem da peneira principal
      // ("ninguem roda e ninguem declarou") e o mutante morre pelo motivo
      // errado com a mensagem de outra peneira.
      rmSync(join(dir, alvo[1]));
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
    // Apaga o ARQUIVO e deixa a LINHA da declaracao -- e isso que a peneira pega.
    //
    // O alvo sai da propria declaracao, e nao de um nome escrito aqui: isto era
    // `mutantes-crivos.mjs` e a HMO-332 apagou aquele runner, o que derrubou
    // este mutante com ENOENT. Pegar o PRIMEIRO `nao-triado` nao envelhece --
    // a premissa e so que exista algum, que e a premissa da peneira.
    mutar(dir) {
      const alvo = ler(dir, DECLARACAO).match(
        /"(scripts\/mutantes-[a-z0-9-]+\.(?:mjs|sh))": \{ motivo: "nao-triado"/,
      );
      if (!alvo) {
        throw new Error(
          "nenhuma entrada `nao-triado` na declaracao -- esta peneira precisa de uma linha declarada para apagar o arquivo por baixo dela",
        );
      }
      rmSync(join(dir, alvo[1]));
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
  const conteudoAntes = LIDOS_PELA_GUARDA
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
  const conteudoDepois = LIDOS_PELA_GUARDA
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
