#!/usr/bin/env node
// =====================================================
// TODO `INSERT INTO public.profiles` QUE PERSISTE TEM DE NOMEAR `is_public`
// =====================================================
// Roda com:  npm run check-profiles-is-public
//
// POR QUE ISTO EXISTE (HMO-484, derivada da HMO-458)
// --------------------------------------------------
// `public.profiles.is_public` tem **DEFAULT TRUE** (`001_baseline.sql`), e a
// policy `profiles_select_own_or_public` (002) e
// `USING (id = auth.uid() OR is_public = TRUE)`. Logo: um `INSERT INTO
// public.profiles` que NAO nomeia a coluna nasce visivel para todo usuario
// logado do banco -- e isso esta CORRETO pela policy, nao e furo de RLS.
//
// No `db-verify.yml` isso importa porque o job inteiro roda contra UM banco
// compartilhado (`pulodogato_ci`) e varios passos COMITAM -- precisam: a
// fixture de "antes da migration NNN" tem de sobreviver a transacao para o
// backfill ter o que morder. Uma linha a mais em `profiles`, comitada no meio
// do job, fica visivel para TODO passo dali para baixo.
//
// O custo medido na HMO-458: o seed do passo *Drill de backup e restauracao*
// era o unico que nao escrevia `is_public`. Quem reprovava era o
// `view_security_invoker_test.sql` **17 passos depois**, acusando a RLS de
// devolver 2 linhas onde esperava 1. O job `schema do zero + isolamento de
// RLS` ficou vermelho na `main` por **~60 commits**, e durante todo esse tempo
// a guarda de RLS das views esteve efetivamente desligada em todo PR.
//
// O `f6aa720` consertou A INSTANCIA (aquele seed passou a escrever
// `is_public = FALSE`). Esta guarda fecha A CLASSE: ela reprova no PR que
// planta o proximo, em vez de 17 passos e 60 commits depois.
//
// O QUE ELA AFIRMA, E SAO DUAS COISAS
// -----------------------------------
// 1. SQL INLINE: todo `INSERT INTO [public.]profiles` escrito dentro do
//    `.github/workflows/db-verify.yml` nomeia `is_public`.
// 2. FAN-OUT: todo arquivo `.sql` que o workflow INVOCA (`-f database/...`) e
//    que PERSISTE o que insere tambem nomeia `is_public`.
//
// A (2) e o que faz a guarda valer a pena. A (1) sozinha leria duas linhas do
// YAML e protegeria exatamente um bug passado -- as fixtures que comitam moram
// em `database/tests/*.sql`, e e la que o proximo seed vai nascer. Os
// comentarios do proprio `db-verify.yml` (nos passos das fixtures 058, 059,
// 060 e 062) dizem, nas suas palavras, que o `is_public = FALSE` daquelas
// fixtures e load-bearing -- esta guarda e o que cobra isso.
//
// "PERSISTE" E O RECORTE, E ELE E O MECANISMO
// -------------------------------------------
// Nao e todo `INSERT` em `profiles` que planta linha: a maioria das suites
// roda dentro de `BEGIN ... ROLLBACK`, e o que elas inserem desaparece no fim
// do arquivo. Essas sao inofensivas por construcao, e exigir `is_public` delas
// seria pedir 13 edicoes que nao compram nada.
//
// A classificacao, na ordem (o default e EXIGIR, nao dispensar):
//
//   tem `COMMIT;`                      -> PERSISTE
//   senao, tem `ROLLBACK;`             -> nao persiste
//   senao (nem um nem outro)           -> PERSISTE (autocommit do psql)
//
// O terceiro ramo e o que importa ser nessa direcao: um arquivo sem transacao
// nenhuma autocomita statement por statement, e e justamente a forma do seed
// que quebrou a HMO-458. Se a duvida pendesse para "nao persiste", a guarda
// dispensaria exatamente o caso que ela existe para pegar.
//
// Medido ao escrever isto, na `main` `b23595f`: dos 144 `.sql` que o workflow
// invoca, 67 inserem em `profiles`. Os que PERSISTEM sao 7 (`027_historico_
// antes_da_027`, `039_historico_antes_da_039`, `056_contas_antes_da_056`,
// `058_contas_antes_da_058`, `059_ativos_antes_da_059`, `060_lancamentos_
// antes_da_060`, `062_emprestimo_antes_da_062`) e **todos os 7 ja nomeiam
// `is_public`**. Os 13 que nao nomeiam estao **todos** sob `ROLLBACK`. Entao a
// divida e ZERO e a exigencia nao precisa de lista de excecao.
//
// POR QUE ELA NAO TEM LISTA DE EXCECAO
// ------------------------------------
// Porque nao precisou de nenhuma. Uma lista de divida numa guarda nova vence
// pelo cansaco: ela nasce com N nomes, ninguem tira nome de lista, e o N+1
// entra "junto dos outros". Como o conjunto ja estava limpo, a regra e
// categorica -- e o unico caso que ela cobrou foi o seed de banco DESCARTAVEL
// do passo do preflight da 052, que ganhou um `is_public` que ele nao precisa.
// Pagar um literal de 13 caracteres ali e mais barato do que abrir a porta de
// uma excecao "mas este e banco proprio", que o proximo seed usaria errado.
//
// COMENTARIO NAO EXECUTA, ENTAO COMENTARIO NAO CONTA
// --------------------------------------------------
// As linhas de comentario (`#` do YAML/bash, `--` e `/* */` do SQL) sao
// MASCARADAS antes da busca -- com os `\n` preservados, para o numero de linha
// do relatorio continuar certo. Isso nao e uma porta de fuga: um `INSERT`
// dentro de comentario nao roda, logo nao planta linha. E e necessario nos dois
// sentidos -- o proprio `db-verify.yml` tem, nas linhas ~5436-5451, um bloco de
// comentario que EXPLICA a regra citando `INSERT INTO public.profiles`, e uma
// guarda que lesse comentario reprovaria a documentacao da propria regra.
//
// SEM LISTA DE COLUNAS TAMBEM REPROVA
// -----------------------------------
// `INSERT INTO public.profiles VALUES (...)` nao nomeia coluna nenhuma, entao
// nao pode nomear `is_public`: reprova com frase propria. Vale a pena separar
// do caso "lista existe e nao traz a coluna" porque o conserto e outro.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WORKFLOW = ".github/workflows/db-verify.yml";

// Os dois lados do recorte, e nenhum dos dois e um `\b` no INICIO:
//   PREFIXO: o `\s+` (ou o `public\s*\.\s*`) obriga `profiles` a comecar
//     imediatamente depois, entao `INSERT INTO group_profiles` nao casa -- o
//     que vem depois do espaco e `g`, e o regex nao pode pular `group_`.
//   SUFIXO: o `\b` do fim barra `profiles_backup`, porque `_` e caractere de
//     palavra e portanto nao ha fronteira entre `s` e `_`.
// Os dois estao sob controle negativo no `test-profiles-is-public.mjs`, que
// afirma tambem que essas tabelas nao entram na CONTA de exigidos.
const RE_INSERT = /INSERT\s+INTO\s+(?:public\s*\.\s*)?profiles\b/gi;

/**
 * Troca todo comentario por espacos, PRESERVANDO os `\n`, para que os offsets
 * e os numeros de linha do arquivo original continuem valendo.
 */
function mascararComentarios(texto) {
  // Blocos /* ... */ primeiro (podem atravessar linha).
  let t = texto.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  // Depois linha a linha: `#` (YAML/bash) e `--` (SQL) no primeiro
  // nao-espaco. So a linha INTEIRA de comentario -- comentario de fim de linha
  // nao e removido de proposito: `INSERT ... -- nota` tem SQL antes do `--`,
  // e mascarar o resto da linha poderia cortar a lista de colunas no meio.
  t = t
    .split("\n")
    .map((linha) => (/^\s*(#|--)/.test(linha) ? linha.replace(/[^\n]/g, " ") : linha))
    .join("\n");
  return t;
}

function linhaDoOffset(texto, offset) {
  return texto.slice(0, offset).split("\n").length;
}

/**
 * A partir do fim do `INSERT INTO profiles`, devolve a lista de colunas.
 *   { tipo: "lista", colunas: "id, full_name" }  ou  { tipo: "sem-lista" }
 */
function lerListaDeColunas(texto, depoisDoNome) {
  const resto = texto.slice(depoisDoNome);
  const abre = resto.match(/^\s*\(/);
  if (!abre) return { tipo: "sem-lista" };

  let i = depoisDoNome + abre[0].length; // primeiro char depois do `(`
  let nivel = 1;
  const inicio = i;
  while (i < texto.length && nivel > 0) {
    if (texto[i] === "(") nivel++;
    else if (texto[i] === ")") nivel--;
    if (nivel === 0) break;
    i++;
  }
  if (nivel !== 0) return { tipo: "sem-lista" };
  return { tipo: "lista", colunas: texto.slice(inicio, i).replace(/\s+/g, " ").trim() };
}

function acharInserts(textoCru, arquivo) {
  const texto = mascararComentarios(textoCru);
  const achados = [];
  for (const m of texto.matchAll(RE_INSERT)) {
    const lista = lerListaDeColunas(texto, m.index + m[0].length);
    achados.push({
      arquivo,
      linha: linhaDoOffset(texto, m.index),
      ...lista,
      nomeiaIsPublic: lista.tipo === "lista" && /\bis_public\b/i.test(lista.colunas),
    });
  }
  return achados;
}

/**
 * PERSISTE? Ver o bloco "PERSISTE E O RECORTE" no cabecalho. O default e
 * PERSISTE, e isso e deliberado.
 */
function persiste(textoCru) {
  const texto = mascararComentarios(textoCru);
  if (/^[ \t]*COMMIT[ \t]*;/im.test(texto)) return { persiste: true, por: "COMMIT" };
  if (/^[ \t]*ROLLBACK[ \t]*;/im.test(texto)) return { persiste: false, por: "ROLLBACK" };
  return { persiste: true, por: "autocommit (sem COMMIT nem ROLLBACK)" };
}

/** Os `.sql` que o workflow invoca com `-f`. */
function sqlInvocadoPeloWorkflow(yml) {
  const vistos = new Set();
  for (const m of yml.matchAll(/-f\s+(database\/[A-Za-z0-9_./-]+\.sql)/g)) vistos.add(m[1]);
  return [...vistos].sort();
}

function principal() {
  const raiz = process.cwd();
  if (!fs.existsSync(path.join(raiz, WORKFLOW))) {
    console.error(`::error::check-profiles-is-public nao achou ${WORKFLOW} -- rode na raiz do repositorio.`);
    process.exit(1);
  }

  const yml = fs.readFileSync(path.join(raiz, WORKFLOW), "utf8");

  // (1) SQL inline no proprio workflow.
  const inline = acharInserts(yml, WORKFLOW).map((a) => ({ ...a, origem: "inline", por: "SQL inline no workflow" }));

  // (2) Fan-out: os `.sql` que ele invoca.
  const arquivosSql = sqlInvocadoPeloWorkflow(yml);
  const doFanOut = [];
  const ausentes = [];
  let comProfiles = 0;
  let quePersistem = 0;

  for (const rel of arquivosSql) {
    const abs = path.join(raiz, rel);
    if (!fs.existsSync(abs)) {
      ausentes.push(rel);
      continue;
    }
    const texto = fs.readFileSync(abs, "utf8");
    const achados = acharInserts(texto, rel);
    if (!achados.length) continue;
    comProfiles++;
    const p = persiste(texto);
    if (!p.persiste) continue; // ROLLBACK: nao planta nada no banco compartilhado
    quePersistem++;
    for (const a of achados) doFanOut.push({ ...a, origem: "fan-out", por: p.por });
  }

  // ANTI-VACUIDADE, em tres frentes. Uma guarda que mede o conjunto vazio
  // reporta verde para sempre: basta o `-f` mudar de forma, o workflow ser
  // renomeado ou o regex do `INSERT` apodrecer.
  if (!arquivosSql.length) {
    console.error("::error::check-profiles-is-public nao achou NENHUM `-f database/....sql` no workflow -- a guarda mediu o conjunto vazio.");
    process.exit(1);
  }
  if (!inline.length) {
    console.error("::error::check-profiles-is-public nao achou NENHUM `INSERT INTO public.profiles` inline no workflow -- a guarda mediu o conjunto vazio.");
    process.exit(1);
  }
  if (!comProfiles) {
    console.error("::error::check-profiles-is-public nao achou NENHUM `.sql` do fan-out que insira em `profiles` -- a guarda mediu o conjunto vazio.");
    process.exit(1);
  }
  if (ausentes.length) {
    console.error(`::error::check-profiles-is-public: o workflow invoca ${ausentes.length} arquivo(s) que nao existem: ${ausentes.join(", ")}`);
    process.exit(1);
  }

  const todos = [...inline, ...doFanOut];
  const fora = todos.filter((a) => !a.nomeiaIsPublic);

  console.log(`check-profiles-is-public: ${arquivosSql.length} \`.sql\` invocados por ${WORKFLOW}`);
  console.log(`  inline no workflow:               ${inline.length} \`INSERT INTO profiles\``);
  console.log(`  \`.sql\` que inserem em profiles:   ${comProfiles}`);
  console.log(`  ...e que PERSISTEM (exigidos):    ${quePersistem}`);
  console.log(`  INSERT sob exigencia, no total:   ${todos.length}`);

  if (fora.length) {
    console.error("");
    for (const a of fora) {
      const frase =
        a.tipo === "sem-lista"
          ? "`INSERT INTO public.profiles` SEM LISTA DE COLUNAS: nomeie as colunas e inclua `is_public` (FALSE), senao o DEFAULT TRUE do 001_baseline torna o perfil visivel para todo usuario logado."
          : "`INSERT INTO public.profiles` que NAO nomeia `is_public`: a coluna tem DEFAULT TRUE no 001_baseline, e a `profiles_select_own_or_public` mostra perfil publico para QUALQUER logado -- escreva `is_public` e `FALSE`.";
      console.error(`::error file=${a.arquivo},line=${a.linha}::${frase}`);
      console.error(`  origem:  ${a.origem} (${a.por})`);
      if (a.tipo === "lista") console.error(`  colunas: (${a.colunas})`);
      console.error("");
    }
    console.error(`${fora.length} \`INSERT INTO public.profiles\` que persiste(m) sem nomear \`is_public\`.`);
    console.error("Por que isto reprova, em uma frase: a linha fica visivel para todo passo abaixo dela no banco compartilhado `pulodogato_ci`, e quem acusa e uma suite de RLS muitos passos depois (HMO-458: ~60 commits de main vermelha).");
    process.exit(1);
  }

  console.log("Todo `INSERT INTO public.profiles` que persiste no db-verify nomeia `is_public`.");
}

// Programa so quando E o programa: importado como modulo (pelo controle
// negativo) ele nao pode rodar nem ler `process.argv`.
if (process.argv[1] && fileURLToPath(new URL(`file://${process.argv[1]}`)).endsWith("check-profiles-is-public.mjs")) {
  principal();
}

export { acharInserts, persiste, mascararComentarios, sqlInvocadoPeloWorkflow };
