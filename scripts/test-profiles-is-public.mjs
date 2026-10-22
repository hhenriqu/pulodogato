#!/usr/bin/env node
// =====================================================
// O CONTROLE NEGATIVO DA GUARDA DO `is_public` (HMO-484)
// =====================================================
// Roda com:  npm run test:profiles-is-public
//
// POR QUE ISTO EXISTE
// -------------------
// `check-profiles-is-public.mjs` nasceu VERDE na `main` -- o unico violador
// real (o seed do drill da HMO-458) ja estava consertado pelo `f6aa720`. Uma
// guarda que nasce verde e indistinguivel, pela cor, de uma guarda que nao
// mede nada: as duas imprimem "tudo em ordem". Entao a cor dela nao e prova, e
// o que prova e esta suite -- ela planta cada classe de violacao e exige
// VERMELHO, e planta os casos inofensivos e exige VERDE.
//
// AS DUAS METADES, E A SEGUNDA E A QUE COSTUMA FALTAR
// --------------------------------------------------
// Secao 1 (REPROVA): sete defeitos, um por decisao da guarda.
// Secao 2 (NAO REPROVA): quatro casos legitimos que uma guarda frouxa
//   reprovaria -- o `ROLLBACK`, o comentario, a coluna de nome parecido e a
//   arvore intacta. Sem a secao 2, "reprova tudo" passaria por guarda boa, e
//   uma guarda que reprova a arvore de hoje nao chega na `main`.
//
// TUDO NUMA SOMBRA, E NADA DE `trap`
// ----------------------------------
// Os dois arquivos que a guarda le (`.github/workflows/db-verify.yml` e
// `database/`) sao copiados para um `mkdtempSync`, e a mutacao acontece LA. A
// arvore rastreada nao e tocada em momento nenhum -- a regra que o
// `check-mutacao-no-lugar.mjs` cobra de todo runner, e a razao e que morrer no
// meio (SIGKILL, timeout) nao pode deixar defeito gravado em `database/`.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RAIZ = process.cwd();
const GUARDA = path.join(RAIZ, "scripts", "check-profiles-is-public.mjs");
const WORKFLOW = ".github/workflows/db-verify.yml";

let passou = 0;
let falhou = 0;

function ok(nome) {
  passou++;
  console.log(`  ok   ${nome}`);
}
function nok(nome, detalhe) {
  falhou++;
  console.error(`  FALHOU ${nome}`);
  console.error(`         ${detalhe}`);
}

/** Roda a guarda com `cwd` na sombra. Devolve { rc, saida }. */
function rodarGuarda(cwd) {
  try {
    const saida = execFileSync(process.execPath, [GUARDA], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { rc: 0, saida };
  } catch (e) {
    return { rc: e.status ?? 1, saida: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/**
 * Monta uma sombra com SO o que a guarda le: o workflow e `database/`. E a
 * arvore de verdade, nao um esboco -- um esboco provaria que a guarda sabe ler
 * o esboco.
 */
function sombra() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hmo484-"));
  fs.mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
  fs.copyFileSync(path.join(RAIZ, WORKFLOW), path.join(dir, WORKFLOW));
  fs.cpSync(path.join(RAIZ, "database"), path.join(dir, "database"), { recursive: true });
  return dir;
}

function lerWorkflow(dir) {
  return fs.readFileSync(path.join(dir, WORKFLOW), "utf8");
}
function gravarWorkflow(dir, texto) {
  fs.writeFileSync(path.join(dir, WORKFLOW), texto);
}

/**
 * Troca `de` por `para` exigindo que `de` apareca EXATAMENTE UMA vez. Ancora
 * morta (zero) ou ambigua (duas) faria o caso medir a arvore intacta e o
 * veredito seria sobre nada -- a armadilha que esta suite existe para nao
 * repetir um nivel acima.
 */
function trocarUmaVez(texto, de, para, nome) {
  const n = texto.split(de).length - 1;
  if (n !== 1) throw new Error(`[${nome}] a ancora aparece ${n}x, nao 1x: ${JSON.stringify(de.slice(0, 80))}`);
  return texto.replace(de, para);
}

/** Caso que DEVE reprovar, e com a frase certa. */
function exigeVermelho(nome, mutar, frase) {
  const dir = sombra();
  try {
    mutar(dir);
    const { rc, saida } = rodarGuarda(dir);
    if (rc === 0) return nok(nome, "a guarda saiu 0 (VERDE) sobre a arvore com o defeito plantado.");
    if (frase && !saida.includes(frase)) {
      return nok(nome, `saiu ${rc} mas sem a frase esperada ${JSON.stringify(frase)}.\n${saida.slice(0, 600)}`);
    }
    ok(nome);
  } catch (e) {
    nok(nome, e.message);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Caso que NAO deve reprovar. */
function exigeVerde(nome, mutar) {
  const dir = sombra();
  try {
    if (mutar) mutar(dir);
    const { rc, saida } = rodarGuarda(dir);
    if (rc !== 0) return nok(nome, `a guarda saiu ${rc} (VERMELHO) sobre uma arvore legitima.\n${saida.slice(0, 600)}`);
    ok(nome);
  } catch (e) {
    nok(nome, e.message);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Quantos `INSERT` a guarda diz ter posto sob exigencia, lido da saida dela. */
function insertsSobExigencia(saida) {
  const m = saida.match(/INSERT sob exigencia, no total:\s*(\d+)/);
  if (!m) throw new Error(`a saida da guarda nao traz a linha "INSERT sob exigencia, no total:".\n${saida.slice(0, 600)}`);
  return Number(m[1]);
}

/**
 * Caso que nao deve reprovar E no qual a guarda nao pode ter CONTADO a linha
 * plantada. Verde sozinho nao distingue "a guarda viu e dispensou com razao"
 * de "a guarda viu e exigiu, mas a linha ja trazia a coluna" -- entao os casos
 * de nome parecido afirmam tambem que o total sob exigencia NAO mudou.
 */
function exigeVerdeSemContar(nome, mutar) {
  const base = sombra();
  let esperado;
  try {
    const { rc, saida } = rodarGuarda(base);
    if (rc !== 0) throw new Error(`a arvore intacta ja estava vermelha; o caso nao mede nada.\n${saida.slice(0, 600)}`);
    esperado = insertsSobExigencia(saida);
  } catch (e) {
    fs.rmSync(base, { recursive: true, force: true });
    return nok(nome, e.message);
  }
  fs.rmSync(base, { recursive: true, force: true });

  const dir = sombra();
  try {
    mutar(dir);
    const { rc, saida } = rodarGuarda(dir);
    if (rc !== 0) return nok(nome, `a guarda saiu ${rc} (VERMELHO) sobre uma tabela de nome PARECIDO, que ela nao deveria olhar.\n${saida.slice(0, 600)}`);
    const visto = insertsSobExigencia(saida);
    if (visto !== esperado) {
      return nok(nome, `a guarda passou de ${esperado} para ${visto} INSERT sob exigencia -- ela CONTOU a tabela de nome parecido, e sairia verde so porque a linha plantada ja trazia a coluna.`);
    }
    ok(nome);
  } catch (e) {
    nok(nome, e.message);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// O arquivo de fixture que COMITA e que a guarda exige. Escolhido por ser o
// caso do mecanismo: as linhas dele sobrevivem a transacao e ficam visiveis
// para todo passo abaixo no `pulodogato_ci`.
const FIXTURE_QUE_COMITA = "database/tests/060_lancamentos_antes_da_060.sql";
// Um que roda sob ROLLBACK e NAO nomeia `is_public` hoje -- e esta certo assim.
const FIXTURE_COM_ROLLBACK = "database/tests/021_investments_test.sql";

console.log("test-profiles-is-public: o controle negativo da guarda do is_public\n");

console.log("SECAO 1 -- a guarda REPROVA (7 casos)");

// 1. O caso literal da issue: INSERT inline no workflow sem a coluna. E a
//    reintroducao exata do defeito que o `f6aa720` consertou.
exigeVermelho(
  "INSERT inline no db-verify.yml sem `is_public` reprova",
  (dir) => {
    const t = lerWorkflow(dir);
    gravarWorkflow(
      dir,
      trocarUmaVez(
        t,
        "INSERT INTO public.profiles (id, full_name, is_public)\n            VALUES ('33333333-3333-3333-3333-333333333333', 'HMO-359', FALSE);",
        "INSERT INTO public.profiles (id, full_name)\n            VALUES ('33333333-3333-3333-3333-333333333333', 'HMO-359');",
        "inline sem is_public",
      ),
    );
  },
  "NAO nomeia `is_public`",
);

// 2. O seed do drill da HMO-458 em si, no formato em que ele quebrou a main.
exigeVermelho(
  "o seed do drill de backup, sem `is_public`, reprova (o defeito da HMO-458)",
  (dir) => {
    const t = lerWorkflow(dir);
    gravarWorkflow(
      dir,
      trocarUmaVez(
        t,
        "INSERT INTO public.profiles (id, full_name, is_public)\n            VALUES ('11111111-1111-1111-1111-111111111111', 'Drill CI', FALSE);",
        "INSERT INTO public.profiles (id, full_name)\n            VALUES ('11111111-1111-1111-1111-111111111111', 'Drill CI');",
        "seed do drill",
      ),
    );
  },
  "NAO nomeia `is_public`",
);

// 3. A outra metade da guarda, e a que a issue nao pedia: fixture `.sql` que
//    COMITA. E onde o proximo seed vai nascer.
exigeVermelho(
  `fixture que COMITA (${path.basename(FIXTURE_QUE_COMITA)}) sem \`is_public\` reprova`,
  (dir) => {
    const p = path.join(dir, FIXTURE_QUE_COMITA);
    const t = fs.readFileSync(p, "utf8");
    fs.writeFileSync(p, trocarUmaVez(t, "INSERT INTO public.profiles (id, email, full_name, is_public) VALUES", "INSERT INTO public.profiles (id, email, full_name) VALUES", "fixture que comita"));
  },
  "NAO nomeia `is_public`",
);

// 4. Autocommit: o arquivo perde o COMMIT e nao ganha ROLLBACK. Pelo terceiro
//    ramo da classificacao ele continua PERSISTINDO, e a exigencia continua.
//    Se o default da guarda fosse "nao persiste", este caso sairia verde --
//    e e exatamente a forma do seed que quebrou a HMO-458.
exigeVermelho(
  "fixture sem COMMIT e sem ROLLBACK (autocommit) sem `is_public` reprova",
  (dir) => {
    const p = path.join(dir, FIXTURE_QUE_COMITA);
    let t = fs.readFileSync(p, "utf8");
    t = trocarUmaVez(t, "INSERT INTO public.profiles (id, email, full_name, is_public) VALUES", "INSERT INTO public.profiles (id, email, full_name) VALUES", "autocommit/insert");
    t = t.replace(/^[ \t]*COMMIT[ \t]*;/gim, "-- COMMIT retirado pelo controle negativo");
    fs.writeFileSync(p, t);
  },
  "autocommit",
);

// 5. Sem lista de colunas nao pode nomear a coluna, e tem frase propria porque
//    o conserto e outro (nomear as colunas, nao acrescentar uma).
exigeVermelho(
  "`INSERT INTO public.profiles VALUES (...)` sem lista de colunas reprova",
  (dir) => {
    const t = lerWorkflow(dir);
    gravarWorkflow(
      dir,
      trocarUmaVez(
        t,
        "INSERT INTO public.profiles (id, full_name, is_public)\n            VALUES ('33333333-3333-3333-3333-333333333333', 'HMO-359', FALSE);",
        "INSERT INTO public.profiles\n            VALUES ('33333333-3333-3333-3333-333333333333', 'HMO-359');",
        "sem lista de colunas",
      ),
    );
  },
  "SEM LISTA DE COLUNAS",
);

// 6/7. ANTI-VACUIDADE. Uma guarda que perde o alvo reporta verde para sempre,
//      e os dois jeitos de perder o alvo aqui sao o `-f` mudar de forma e o
//      `INSERT` inline sumir. Os dois tem de reprovar, nao passar vazio.
exigeVermelho(
  "workflow sem nenhum `-f database/....sql` reprova (conjunto vazio)",
  (dir) => gravarWorkflow(dir, lerWorkflow(dir).replace(/-f\s+database\//g, "-f DATABASE_RENOMEADO/")),
  "conjunto vazio",
);

exigeVermelho(
  "workflow sem nenhum INSERT inline em profiles reprova (conjunto vazio)",
  (dir) => gravarWorkflow(dir, lerWorkflow(dir).replace(/INSERT\s+INTO\s+public\.profiles/gi, "INSERT INTO public.perfis_renomeados")),
  "conjunto vazio",
);

console.log("\nSECAO 2 -- a guarda NAO reprova (4 casos)");

// 8. O caso que faz a guarda ser aceitavel: a arvore de hoje, intacta.
exigeVerde("a arvore de hoje, intacta, passa", null);

// 9. Os 13 arquivos sob ROLLBACK que nao nomeiam `is_public` estao CERTOS: o
//    que eles inserem desaparece no fim do arquivo. Exigir deles seria pedir
//    13 edicoes que nao compram nada -- e e o que uma guarda frouxa faria.
exigeVerde(`fixture sob ROLLBACK (${path.basename(FIXTURE_COM_ROLLBACK)}) sem \`is_public\` continua passando`, (dir) => {
  const p = path.join(dir, FIXTURE_COM_ROLLBACK);
  const t = fs.readFileSync(p, "utf8");
  if (/INSERT\s+INTO\s+(?:public\.)?profiles\s*\([^)]*is_public/i.test(t)) {
    throw new Error(`${FIXTURE_COM_ROLLBACK} passou a nomear is_public -- escolha outro arquivo sob ROLLBACK para este caso.`);
  }
  if (!/^[ \t]*ROLLBACK[ \t]*;/im.test(t)) {
    throw new Error(`${FIXTURE_COM_ROLLBACK} nao tem mais ROLLBACK -- o caso deixou de medir o que diz.`);
  }
});

// 10. Comentario nao executa, logo nao planta linha. E necessario nos DOIS
//     sentidos: o proprio db-verify.yml tem um bloco de comentario que explica
//     a regra citando o INSERT, e uma guarda que lesse comentario reprovaria a
//     documentacao da propria regra.
exigeVerde("um `INSERT INTO public.profiles (id)` dentro de COMENTARIO nao reprova", (dir) => {
  const t = lerWorkflow(dir);
  gravarWorkflow(dir, t.replace("jobs:\n", "# INSERT INTO public.profiles (id, full_name) VALUES ('x', 'y');\njobs:\n"));
});

// 11. TABELA DE NOME PARECIDO. `group_profiles` e `profiles_backup` nao sao
//     `profiles`: nenhuma das duas tem a policy `profiles_select_own_or_public`
//     nem o DEFAULT TRUE, entao inserir nelas sem `is_public` nao planta nada
//     visivel -- e exigir a coluna seria pedir uma coluna que nao existe.
//     Este caso defende os dois lados do recorte do regex, que sao sutis e
//     NENHUM dos dois e um `\b` no inicio: o prefixo e barrado porque o
//     `\s+`/`public\.` obriga o nome a comecar imediatamente depois (em
//     `group_profiles` o que vem depois do espaco e `g`), e o sufixo e barrado
//     pelo `\b` do fim (em `profiles_backup` o `_` e caractere de palavra,
//     logo nao ha fronteira).
exigeVerdeSemContar("`group_profiles` e `profiles_backup` sem `is_public` nao reprovam nem entram na conta", (dir) => {
  const p = path.join(dir, FIXTURE_QUE_COMITA);
  const t = fs.readFileSync(p, "utf8");
  fs.writeFileSync(
    p,
    `${t}\nINSERT INTO public.group_profiles (id, full_name) VALUES ('44444444-4444-4444-4444-444444444444', 'parecida 1');\nINSERT INTO profiles_backup (id, full_name) VALUES ('55555555-5555-5555-5555-555555555555', 'parecida 2');\n`,
  );
});

console.log("");
console.log(`test-profiles-is-public: ${passou}/${passou + falhou} casos`);
if (falhou) {
  console.error(`${falhou} caso(s) do controle negativo falharam.`);
  process.exit(1);
}
console.log("A guarda reprova as 7 classes de violacao e passa nos 4 casos legitimos.");
