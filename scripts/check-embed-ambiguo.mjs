#!/usr/bin/env node
// =====================================================
// PULODOGATO - EMBED DO POSTGREST SEM FK QUALIFICADA (HMO-236)
// =====================================================
//   npm run check-embed-ambiguo
//
// O DEFEITO QUE ISTO EXISTE PARA PEGAR
// ------------------------------------
// Quando uma tabela tem DUAS chaves estrangeiras para a mesma tabela, um embed
// curto do PostgREST (`account:financial_accounts(...)`) deixa de ter resposta
// unica: ele responde PGRST201 ("more than one relationship was found") e a
// rota inteira vira 500.
//
// O jeito como isso aconteceu e o motivo de ser um guard de CI, e nao um
// comentario: o codigo que quebrou NAO foi alterado. A migration 038 deu a
// `recurring_rules` e a `scheduled_transactions` uma segunda FK para
// `financial_accounts` (`destination_account_id`), e no instante em que ela foi
// colada em producao TRES rotas que ninguem tocou passaram a falhar --
// `GET /api/recurring-rules` (a tela de gastos fixos nao listava nada), o POST
// da conta prevista e o PATCH/baixa da agenda. Os dois ultimos gravavam a linha
// e SO DEPOIS falhavam no `.select()` do retorno: a tela dizia que nao deu e o
// dado estava la no F5 seguinte.
//
// Nenhum teste puro pega isso, porque em teste nao ha PostgREST; `tsc` nao pega,
// porque a string do select e so uma string; e o CI nao pega, porque o CI nao
// fala com producao. O unico sinal barato e comparar o CODIGO com o SCHEMA
// DECLARADO -- que e o que este script faz.
//
// COMO FUNCIONA
// -------------
//   1. le `database/migrations/*.sql` e monta o mapa (tabela -> alvo) que tem
//      MAIS DE UMA FK, nas duas formas em que o repo declara: dentro do
//      `CREATE TABLE` e por `ALTER TABLE ... ADD CONSTRAINT` (inclusive dentro
//      de bloco DO, onde o ALTER nomeia a tabela).
//   2. varre `.ts`/`.tsx` procurando `.from("<tabela>")` e, no bloco de query
//      que segue, embeds do alvo SEM o `!<fk>`.
//
// Os comentarios do fonte sao removidos ANTES da varredura, de proposito: esta
// propria rodada acusaria os comentarios que EXPLICAM o defeito (eles citam
// `financial_accounts(...)` em prosa) e o guard passaria a reprovar o arquivo
// corrigido -- o avesso do que ele mede.
//
// VIEW nao aparece no mapa porque view nao tem FK, e e por isso que
// `scheduled_transactions_effective` segue com o embed curto: medido em
// producao, ele responde 200. Nao e excecao escrita a mao aqui, e consequencia
// de ler as FKs do schema.
// =====================================================

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = "database/migrations";
const RAIZES = ["app", "lib", "components", "utils", "hooks"];

// ---------------------------------------------------------------------------
// 1. o mapa de ambiguidade, lido do schema declarado
// ---------------------------------------------------------------------------
function mapaDeFksAmbiguas() {
  const sql = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n");

  // A tabela-fonte de uma FK e a ultima tabela nomeada ANTES dela: o
  // `CREATE TABLE` que a contem, ou o `ALTER TABLE` que a acrescenta.
  const declaracoes = [
    ...sql.matchAll(
      /(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE(?:\s+ONLY)?)\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi
    ),
  ].map((m) => ({ pos: m.index, tabela: m[1].toLowerCase() }));

  const porPar = new Map();
  for (const m of sql.matchAll(
    /FOREIGN\s+KEY\s*\(\s*([a-z_][a-z0-9_]*)\s*\)\s*REFERENCES\s+(?:public\.)?([a-z_][a-z0-9_]*)/gi
  )) {
    let fonte = null;
    for (const d of declaracoes) {
      if (d.pos < m.index) fonte = d.tabela;
      else break;
    }
    if (!fonte) continue;
    const chave = `${fonte}->${m[2].toLowerCase()}`;
    if (!porPar.has(chave)) porPar.set(chave, new Set());
    porPar.get(chave).add(m[1].toLowerCase());
  }

  const ambiguas = new Map();
  for (const [chave, colunas] of porPar) {
    if (colunas.size < 2) continue;
    const [fonte, alvo] = chave.split("->");
    if (!ambiguas.has(fonte)) ambiguas.set(fonte, new Map());
    ambiguas.get(fonte).set(alvo, [...colunas].sort());
  }
  return { ambiguas, paresLidos: porPar.size };
}

// ---------------------------------------------------------------------------
// 2. tirar comentarios sem estragar string nenhuma
// ---------------------------------------------------------------------------
// Troca cada comentario por espacos do MESMO tamanho, para o numero de linha e
// a coluna continuarem valendo no relatorio.
function semComentarios(fonte) {
  let fora = "";
  let i = 0;
  let estado = "codigo"; // codigo | "  | '  | `  | //  | /*
  while (i < fonte.length) {
    const c = fonte[i];
    const d = fonte[i + 1];
    if (estado === "codigo") {
      if (c === "/" && d === "/") {
        estado = "//";
        fora += "  ";
        i += 2;
        continue;
      }
      if (c === "/" && d === "*") {
        estado = "/*";
        fora += "  ";
        i += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") estado = c;
      fora += c;
      i++;
      continue;
    }
    if (estado === "//") {
      if (c === "\n") {
        estado = "codigo";
        fora += c;
      } else fora += " ";
      i++;
      continue;
    }
    if (estado === "/*") {
      if (c === "*" && d === "/") {
        estado = "codigo";
        fora += "  ";
        i += 2;
        continue;
      }
      fora += c === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    // dentro de string: so a saida interessa, e `\` escapa o proximo
    if (c === "\\") {
      fora += c + (d ?? "");
      i += 2;
      continue;
    }
    if (c === estado) estado = "codigo";
    fora += c;
    i++;
  }
  return fora;
}

// ---------------------------------------------------------------------------
// 3. a varredura
// ---------------------------------------------------------------------------
function arquivosDeFonte(raiz) {
  const achados = [];
  const andar = (dir) => {
    let entradas;
    try {
      entradas = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entradas) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      const caminho = join(dir, e);
      if (statSync(caminho).isDirectory()) andar(caminho);
      else if (/\.(ts|tsx)$/.test(e)) achados.push(caminho);
    }
  };
  andar(raiz);
  return achados;
}

const { ambiguas, paresLidos } = mapaDeFksAmbiguas();

// Controle de nao-vacuidade: se a leitura das migrations der em nada, o guard
// passaria verde sem ter medido coisa alguma -- que e o modo de falha mais
// perigoso de um check de CI.
if (paresLidos < 20 || ambiguas.size === 0) {
  console.error(
    `XX o mapa de FKs saiu vazio demais (pares=${paresLidos}, ambiguos=${ambiguas.size}).\n` +
      "   O parser de migration quebrou; sem ele este guard nao mede nada."
  );
  process.exit(1);
}

const achados = [];
let blocosVistos = 0;

for (const raiz of RAIZES) {
  for (const arquivo of arquivosDeFonte(raiz)) {
    const limpo = semComentarios(readFileSync(arquivo, "utf8"));
    const froms = [
      ...limpo.matchAll(/\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/gi),
    ];

    for (let k = 0; k < froms.length; k++) {
      const tabela = froms[k][1].toLowerCase();
      const alvos = ambiguas.get(tabela);
      if (!alvos) continue;

      // O bloco da query vai do `.from(...)` ate o proximo `.from(` -- em
      // encadeamento do supabase-js e ali que uma query acaba e outra comeca.
      const inicio = froms[k].index;
      const fim = k + 1 < froms.length ? froms[k + 1].index : limpo.length;
      const bloco = limpo.slice(inicio, fim);
      blocosVistos++;

      for (const [alvo, colunas] of alvos) {
        // `alvo(` sem `!<fk>` antes do parentese. O `[^!\w]` no fim e o que
        // separa o embed curto do qualificado.
        const re = new RegExp(`\\b${alvo}\\s*(!\\s*[a-z_][a-z0-9_]*)?\\s*\\(`, "gi");
        for (const emb of bloco.matchAll(re)) {
          if (emb[1]) continue; // qualificado: ok
          const linha = limpo.slice(0, inicio + emb.index).split("\n").length;
          achados.push({ arquivo, linha, tabela, alvo, colunas });
        }
      }
    }
  }
}

if (blocosVistos === 0) {
  console.error(
    "XX nenhuma query sobre tabela ambigua foi encontrada no fonte.\n" +
      "   Ou as raizes varridas estao erradas, ou o padrao `.from(\"...\")` mudou."
  );
  process.exit(1);
}

console.log(
  `pares de FK lidos: ${paresLidos} | tabelas ambiguas: ${ambiguas.size} | blocos de query conferidos: ${blocosVistos}`
);
for (const [fonte, alvos] of ambiguas) {
  for (const [alvo, colunas] of alvos) {
    console.log(`  ambiguo: ${fonte} -> ${alvo} por ${colunas.join(" e ")}`);
  }
}

if (achados.length === 0) {
  console.log("\nOK: todo embed de tabela ambigua esta com a FK qualificada.");
  process.exit(0);
}

console.error(`\nXX ${achados.length} embed(s) sem FK qualificada:\n`);
for (const a of achados) {
  console.error(`  ${a.arquivo}:${a.linha}`);
  console.error(
    `    \`${a.alvo}(...)\` a partir de \`${a.tabela}\`, que tem ${a.colunas.length} FKs para ela (${a.colunas.join(", ")}).`
  );
  console.error(
    `    O PostgREST responde PGRST201 e a rota vira 500. Escreva ` +
      `\`${a.alvo}!${a.tabela}_${a.colunas[0]}_fkey(...)\` (ou a FK que esta query quer).\n`
  );
}
process.exit(1);
