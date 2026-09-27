#!/usr/bin/env node
// Quebra o build quando o codigo pede uma COLUNA que a relacao nao tem.
//
// Por que isto existe (HMO-145, 2026-09-27): `GET /api/anomalies` respondia
// 500 em producao para todo usuario, desde o dia em que subiu.
// `lib/services/monthly-summary.ts` fazia
//
//     .from("transaction_categories").select("id, name, user_id")
//                                    .or("user_id.eq.<id>,user_id.is.null")
//
// e `transaction_categories` NUNCA teve coluna `user_id` -- ela e catalogo
// global, com chave `service_id`. O PostgREST devolve `42703`, o `throw` da
// funcao virava 500, e a tela de relatorios perdia a secao de anomalias.
//
// O `check-table-drift.mjs` nao pega este caso e nunca pegaria: o nome da
// TABELA estava certo. E o `tsc` tambem nao, porque `.select()` recebe uma
// string -- qualquer string. O mesmo defeito estava em dois outros lugares
// silenciosos: `/api/cash-flow` engolia a falha num `.catch()` (o grafico caia
// para UUID em vez de nome de categoria, sem erro nenhum) e o cron
// `monthly-summary` teria falhado na PRIMEIRA vez que rodasse, dia 1o.
//
// O QUE E VERIFICADO
// ------------------
//   1. a lista de colunas de `.select("a, b, c")`;
//   2. a coluna dos filtros -- `.eq/.neq/.gt/.gte/.lt/.lte/.like/.ilike/.is/
//      .in/.contains/.order/...`;
//   3. as colunas dentro de `.or("a.eq.1,b.is.null")`, que e onde a forma
//      `coluna.operador.valor` esconde o nome do resto do mundo.
//
// A relacao de cada uma sai do `.from()` que abre a cadeia.
//
// O QUE NAO E VERIFICADO, de proposito
// ------------------------------------
//   - as colunas DENTRO de um embed (`categoria:transaction_categories(id,
//     nome)`). Elas pertencem a outra relacao, e resolver isso exigiria
//     interpretar a FK que o PostgREST escolhe. O NOME da tabela embutida ja e
//     coberto pelo check-table-drift.
//   - `.select()` cujo argumento nao e literal nem constante de string do
//     proprio arquivo (identificador importado, template com `${}`, variavel).
//     Estes contam em `--stats` como "nao resolvidos": e o piso da cobertura,
//     e prefiro nao adivinhar a produzir falso positivo.
//   - SQL cru em `.rpc()`.
//
// O schema vem de `database/schema-columns.json`, gerado por
// `scripts/gen-schema-columns.mjs` a partir de um banco de verdade construido
// pelas migrations; o db-verify roda `--check` nele depois da cadeia, entao a
// copia nao pode envelhecer sem deixar o CI vermelho.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

const SCHEMA = join(RAIZ, "database/schema-columns.json");
const DIRS_CODIGO = ["app", "components", "lib", "utils", "worker"];
const EXTENSOES = [".ts", ".tsx"];

// Colunas que o codigo pede de proposito e que a relacao nao tem.
//
// Mesma disciplina do PENDENTES do check-table-drift: cada entrada e divida
// aberta, e a verificacao tambem falha quando uma entrada fica OBSOLETA (a
// coluna passou a existir, ou o codigo parou de pedi-la). Sem isso a lista so
// cresce e o guard vira decoracao. Chave: `relacao.coluna`.
//
// As tres entradas de hoje sao a MESMA divida: a feature "grupos arquivados"
// foi escrita contra um schema que nunca foi criado. Nenhuma migration
// acrescenta `archived_at`/`archived_by`, e as FKs que a rota embute
// (`expense_groups_archived_by_fkey`) tambem nao existem. Entram como pendencia,
// e nao como correcao, porque `GET /api/expense-groups/archived` e a UNICA
// consumidora e **nenhuma tela chama essa rota** -- decidir entre criar a
// migration e apagar a feature e escopo proprio, e esta na HMO-167. O lado da
// ESCRITA daquele fluxo nao quebra: ele testa `"archived_at" in existingGroup`
// antes de gravar, entao degrada para `is_active = false`.
const PENDENTES = new Map([
  ["expense_groups.archived_at", "HMO-167: feature de grupo arquivado sem migration"],
  ["expense_groups.archived_by", "HMO-167: feature de grupo arquivado sem migration"],
  ["group_members.archived_at", "HMO-167: feature de grupo arquivado sem migration"],
]);

// Metodos do postgrest-js cujo PRIMEIRO argumento e um nome de coluna.
const FILTROS = [
  "eq", "neq", "gt", "gte", "lt", "lte",
  "like", "ilike", "likeAllOf", "likeAnyOf", "ilikeAllOf", "ilikeAnyOf",
  "is", "in", "contains", "containedBy",
  "rangeGt", "rangeGte", "rangeLt", "rangeLte", "rangeAdjacent",
  "overlaps", "order",
];

// `.select("*", { count: "exact" })` e afins: o `*` nao nomeia coluna.
const NAO_SAO_COLUNA = new Set(["*", "count", "sum", "avg", "min", "max"]);

// ---------------------------------------------------------------------------
// Leitura de arquivo (mesmo desenho do check-table-drift: comentario vira
// espaco, para o numero de linha do achado continuar valendo e a mensagem ser
// clicavel)
// ---------------------------------------------------------------------------

function mascararComentarios(texto) {
  let saida = "";
  let i = 0;
  while (i < texto.length) {
    const dois = texto.slice(i, i + 2);
    if (dois === "//") {
      while (i < texto.length && texto[i] !== "\n") {
        saida += " ";
        i++;
      }
      continue;
    }
    if (dois === "/*") {
      while (i < texto.length && texto.slice(i, i + 2) !== "*/") {
        saida += texto[i] === "\n" ? "\n" : " ";
        i++;
      }
      saida += "  ";
      i += 2;
      continue;
    }
    saida += texto[i];
    i++;
  }
  return saida;
}

function arquivosDe(dir, acc = []) {
  let entradas;
  try {
    entradas = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entrada of entradas) {
    if (entrada === "node_modules" || entrada.startsWith(".")) continue;
    const caminho = join(dir, entrada);
    if (statSync(caminho).isDirectory()) arquivosDe(caminho, acc);
    else if (EXTENSOES.some((e) => entrada.endsWith(e))) acc.push(caminho);
  }
  return acc;
}

function linhaDe(texto, indice) {
  let linha = 1;
  for (let i = 0; i < indice; i++) if (texto[i] === "\n") linha++;
  return linha;
}

// Le o literal de string que comeca em `inicio`. Template com `${}` devolve
// null: interpolar dentro da lista de colunas e justamente o caso em que eu
// nao sei o que vai sair.
function lerLiteral(texto, inicio) {
  const aspas = texto[inicio];
  if (aspas !== '"' && aspas !== "'" && aspas !== "`") return null;
  let i = inicio + 1;
  let conteudo = "";
  while (i < texto.length) {
    if (texto[i] === "\\") {
      conteudo += texto[i + 1] ?? "";
      i += 2;
      continue;
    }
    if (texto[i] === aspas) {
      if (aspas === "`" && conteudo.includes("${")) return null;
      return { conteudo, deslocamento: inicio + 1 };
    }
    conteudo += texto[i];
    i++;
  }
  return null;
}

// `export const COLUNAS_X = "a, b, c";` -- o codigo usa isso para compartilhar a
// lista entre a rota e o cron, e foi exatamente a forma do caso que originou
// este guard (`COLUNAS_DA_TRANSACAO`). Sem resolver, a leitura mais importante
// do arquivo ficaria fora da verificacao.
function constantesDe(texto) {
  const mapa = new Map();
  const re = /\bconst\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?=\s*(?=["'`])/g;
  for (const m of texto.matchAll(re)) {
    const literal = lerLiteral(texto, m.index + m[0].length);
    if (literal) mapa.set(m[1], literal.conteudo);
  }
  return mapa;
}

// ---------------------------------------------------------------------------
// A cadeia que sai de um `.from()`
// ---------------------------------------------------------------------------

// Devolve o trecho de texto da cadeia iniciada em `.from(`.
//
// A VIRGULA de profundidade zero e o terminador que importa, e errar nela nao
// da falso negativo: da falso positivo em massa. Metade das leituras do app
// mora dentro de um `Promise.all([...])`, onde as cadeias irmas sao separadas
// por `,` e nao por `;` -- na primeira versao deste guard a cadeia de
// `.from("financial_accounts")` engolia as tres seguintes e o relatorio acusou
// `transaction_categories.amount`, `financial_services.transaction_date` e mais
// seis colunas que o codigo nunca pediu daquelas relacoes.
//
// Dentro de uma cadeia toda virgula esta em argumento (`.eq("a", b)`,
// `.order("x", { ascending: true })`), logo em profundidade >= 1. Uma virgula em
// profundidade 0 e sempre separador de item de array ou de argumento.
//
// O teto de caracteres existe para que um arquivo sem nenhum dos terminadores
// (JSX, por exemplo) nao faca a cadeia engolir o resto do modulo.
const TETO_DA_CADEIA = 3000;

function fimDaCadeia(texto, inicio) {
  let profundidade = 0;
  const limite = Math.min(texto.length, inicio + TETO_DA_CADEIA);
  for (let i = inicio; i < limite; i++) {
    const c = texto[i];
    if (c === "(" || c === "[" || c === "{") profundidade++;
    else if (c === ")" || c === "]" || c === "}") {
      profundidade--;
      // A cadeia acabou junto com a expressao que a continha --
      // `Promise.all([ ... .from(x).select(y) ])` fecha aqui, sem `;`.
      if (profundidade < 0) return i;
    } else if (profundidade === 0 && (c === ";" || c === ",")) return i;
    // Uma cadeia nova comeca: o que vem depois e de outra relacao.
    else if (profundidade === 0 && texto.startsWith(".from(", i)) return i;
  }
  return limite;
}

// Parte a lista de colunas de um `.select()` respeitando o aninhamento: o que
// esta dentro de `(` pertence a um embed e fica de fora.
function colunasDoSelect(lista) {
  const topo = [];
  let atual = "";
  let profundidade = 0;
  for (const c of lista) {
    if (c === "(") profundidade++;
    else if (c === ")") profundidade--;
    if (c === "," && profundidade === 0) {
      topo.push(atual);
      atual = "";
      continue;
    }
    atual += c;
  }
  topo.push(atual);

  const colunas = [];
  for (const bruto of topo) {
    const token = bruto.trim();
    if (!token) continue;
    // Embed (`alias:tabela(colunas)`): outra relacao, ver o cabecalho.
    if (token.includes("(")) continue;
    const nome = normalizarColuna(token);
    if (nome) colunas.push({ nome, offset: bruto.indexOf(token.slice(0, 1)) });
  }
  return colunas;
}

// De `apelido:coluna->>chave::text` para `coluna`. Devolve null quando o que
// sobra nao e um identificador simples -- preferir nao saber a adivinhar.
function normalizarColuna(token) {
  let t = token.trim();
  if (t.includes(":") && !t.includes("::")) t = t.slice(t.lastIndexOf(":") + 1);
  else if (t.includes(":") && t.includes("::")) t = t.split("::")[0].includes(":")
    ? t.split("::")[0].slice(t.split("::")[0].lastIndexOf(":") + 1)
    : t.split("::")[0];
  t = t.split("::")[0];
  t = t.split("->")[0];
  t = t.split("!")[0];
  t = t.trim();
  if (NAO_SAO_COLUNA.has(t)) return null;
  return /^[a-z_][a-z0-9_]*$/i.test(t) ? t : null;
}

// `.or("a.eq.1,b.is.null")` -- a forma `coluna.operador.valor`. O `and(...)` e
// `or(...)` aninhados aparecem como `and(x.eq.1,y.eq.2)`; a regex abaixo pega a
// coluna nos dois casos porque ancora no inicio do token.
function colunasDoOr(expressao) {
  const colunas = [];
  for (const parte of expressao.split(",")) {
    const token = parte.trim().replace(/^(?:and|or|not)\s*\(/, "");
    const m = token.match(/^([a-z_][a-z0-9_]*)\./i);
    if (m) colunas.push(m[1]);
  }
  return colunas;
}

function pedidosDe(texto, constantes) {
  const pedidos = [];
  let naoResolvidos = 0;

  for (const abre of texto.matchAll(/\.from\(\s*(["'`])([a-zA-Z0-9_]+)\1\s*\)/g)) {
    const relacao = abre[2].toLowerCase();
    const inicio = abre.index + abre[0].length;
    const cadeia = texto.slice(inicio, fimDaCadeia(texto, inicio));

    // .select(...)
    for (const m of cadeia.matchAll(/\.select\(\s*/g)) {
      const pos = m.index + m[0].length;
      let lista = null;
      const literal = lerLiteral(cadeia, pos);
      if (literal) {
        lista = literal.conteudo;
      } else {
        const ident = cadeia.slice(pos).match(/^([A-Za-z_$][\w$]*)/);
        if (ident && constantes.has(ident[1])) lista = constantes.get(ident[1]);
      }
      if (lista === null) {
        // `.select()` sem argumento e valido e nao pede coluna nenhuma.
        if (!/^\s*\)/.test(cadeia.slice(pos))) naoResolvidos++;
        continue;
      }
      for (const col of colunasDoSelect(lista)) {
        pedidos.push({ relacao, coluna: col.nome, indice: inicio + pos, via: ".select()" });
      }
    }

    // .eq("col", ...) e familia
    const filtros = new RegExp(`\\.(${FILTROS.join("|")})\\(\\s*(["'\`])([a-zA-Z0-9_]+)\\2`, "g");
    for (const m of cadeia.matchAll(filtros)) {
      pedidos.push({
        relacao,
        coluna: m[3],
        indice: inicio + m.index,
        via: `.${m[1]}()`,
      });
    }

    // .or("a.eq.1,b.is.null")
    for (const m of cadeia.matchAll(/\.(?:or|and)\(\s*/g)) {
      const literal = lerLiteral(cadeia, m.index + m[0].length);
      if (!literal) {
        naoResolvidos++;
        continue;
      }
      for (const coluna of colunasDoOr(literal.conteudo)) {
        pedidos.push({ relacao, coluna, indice: inicio + m.index, via: ".or()" });
      }
    }
  }

  return { pedidos, naoResolvidos };
}

// ---------------------------------------------------------------------------

function main() {
  let schema;
  try {
    schema = JSON.parse(readFileSync(SCHEMA, "utf8"));
  } catch (e) {
    console.error(`Nao consegui ler ${relative(RAIZ, SCHEMA)}: ${e.message}`);
    console.error("Gere com: node scripts/gen-schema-columns.mjs");
    process.exit(1);
  }

  const colunasDe = new Map();
  for (const [relacao, colunas] of Object.entries(schema)) {
    colunasDe.set(relacao.toLowerCase(), new Set(colunas.map((c) => c.toLowerCase())));
  }

  if (colunasDe.size === 0) {
    console.error("O schema esta vazio. A verificacao passaria sobre nada.");
    process.exit(1);
  }

  const ausentes = new Map();
  const pendentesVistas = new Set();
  let verificados = 0;
  let naoResolvidos = 0;
  let relacoesDesconhecidas = 0;

  for (const dir of DIRS_CODIGO) {
    for (const arquivo of arquivosDe(join(RAIZ, dir))) {
      const texto = mascararComentarios(readFileSync(arquivo, "utf8"));
      const constantes = constantesDe(texto);
      const resultado = pedidosDe(texto, constantes);
      naoResolvidos += resultado.naoResolvidos;

      for (const pedido of resultado.pedidos) {
        const colunas = colunasDe.get(pedido.relacao);
        // Relacao fora do schema: e achado do check-table-drift, nao deste
        // guard. Reclamar aqui duplicaria a mesma falha em dois jobs.
        if (!colunas) {
          relacoesDesconhecidas++;
          continue;
        }
        verificados++;
        if (colunas.has(pedido.coluna.toLowerCase())) continue;

        const chave = `${pedido.relacao}.${pedido.coluna}`;
        if (PENDENTES.has(chave)) {
          pendentesVistas.add(chave);
          continue;
        }
        if (!ausentes.has(chave)) ausentes.set(chave, []);
        ausentes.get(chave).push({
          arquivo: relative(RAIZ, arquivo),
          linha: linhaDe(texto, pedido.indice),
          via: pedido.via,
        });
      }
    }
  }

  if (process.argv.includes("--stats")) {
    console.log(`colunas verificadas: ${verificados}`);
    console.log(`argumentos nao resolvidos (piso da cobertura): ${naoResolvidos}`);
    console.log(`pedidos em relacao fora do schema (sao do check-table-drift): ${relacoesDesconhecidas}`);
  }

  const obsoletas = [...PENDENTES.keys()].filter((c) => !pendentesVistas.has(c));
  if (obsoletas.length) {
    console.error("Entradas obsoletas em PENDENTES de scripts/check-column-drift.mjs:");
    for (const chave of obsoletas) console.error(`  - ${chave}`);
    console.error("A coluna passou a existir, ou o codigo parou de pedi-la. Remova a entrada.");
    process.exit(1);
  }

  if (ausentes.size === 0) {
    console.log(
      `Nenhuma deriva de coluna: ${verificados} pedidos conferidos contra ${colunasDe.size} relacoes.`
    );
    return;
  }

  console.error("O codigo pede coluna que a relacao nao tem:\n");
  for (const [chave, ocorrencias] of [...ausentes].sort()) {
    const [relacao, coluna] = chave.split(/\.(.*)/);
    const existentes = [...colunasDe.get(relacao)].sort().join(", ");
    console.error(`  ${chave}`);
    for (const o of ocorrencias) console.error(`      ${o.arquivo}:${o.linha}  (${o.via})`);
    console.error(`      ${relacao} tem: ${existentes}\n`);
  }
  console.error(
    "O PostgREST responde 42703 e a rota devolve 500 -- ou pior, um catch engole e a tela mente."
  );
  process.exit(1);
}

main();
