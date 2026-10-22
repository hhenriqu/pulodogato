#!/usr/bin/env node
// =====================================================
// CONTROLE NEGATIVO DA GUARDA DO TETO DE BYTES DOS WORKFLOWS (HMO-473/HMO-491)
// =====================================================
// Roda com:  npm run test:tamanho-dos-workflows
//
// Uma guarda que mede TAMANHO tem um jeito particular de morrer calada: ela
// soma bytes de uma lista, e se a lista chegar vazia -- pasta errada, filtro de
// extensao que deixou de casar, `readdir` apontando para o lugar que nao e --
// ela imprime "nenhum workflow perto do teto" e sai 0. Esse verde e identico ao
// verde de verdade. Por isso o caso da PASTA VAZIA esta aqui, e e o primeiro.
//
// Os outros casos cercam a fronteira, porque e nela que uma guarda de limiar
// erra: 1 byte abaixo do teto tem de PASSAR, o teto exato tem de REPROVAR
// (`>=`, nao `>`), e acima dos 512.000 do GitHub a mensagem tem de dizer a
// coisa que ninguem adivinhou por 12 dias -- que o workflow nao esta vermelho,
// esta DESLIGADO.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TETO_DO_GITHUB,
  TETO_PROPRIO,
  FAIXA_DE_AVISO,
} from "./check-tamanho-dos-workflows.mjs";

const GUARDA = join(dirname(fileURLToPath(import.meta.url)), "check-tamanho-dos-workflows.mjs");
let casos = 0;
let falhas = 0;

function ok(nome, condicao, detalhe = "") {
  casos++;
  if (condicao) {
    console.log(`  ok   ${nome}`);
  } else {
    falhas++;
    console.log(`  FALHA ${nome}${detalhe ? `\n        ${detalhe}` : ""}`);
  }
}

/** Pasta sintetica de workflows: `{ "x.yml": <bytes> }` ou `{ "x.yml": "<texto>" }`. */
function pastaDeWorkflows(arquivos) {
  const raiz = mkdtempSync(join(tmpdir(), "hmo473-"));
  mkdirSync(raiz, { recursive: true });
  for (const [nome, v] of Object.entries(arquivos)) {
    const conteudo = typeof v === "number" ? "#".repeat(v) : v;
    writeFileSync(join(raiz, nome), conteudo);
  }
  return raiz;
}

function medir(arquivos) {
  const raiz = pastaDeWorkflows(arquivos);
  try {
    const r = spawnSync(process.execPath, [GUARDA, "--dir", raiz], { encoding: "utf8" });
    return { status: r.status, saida: (r.stdout || "") + (r.stderr || "") };
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
}

console.log("A guarda do teto de bytes dos workflows:\n");

// ---------------------------------------------------------------------------
// O verde que nao e verde: pasta sem workflow nenhum
// ---------------------------------------------------------------------------
// Este e o caso que existe por causa do modo de falha da propria guarda, nao
// por causa de um estado do repositorio. Se ela aceitasse a lista vazia, bastava
// alguem renomear a pasta -- ou trocar `.yml` por `.yaml` no repositorio todo --
// para a guarda passar a medir o conjunto vazio e aprovar qualquer coisa.
{
  const r = medir({});
  ok("pasta sem workflow REPROVA (nao mede o conjunto vazio em silencio)", r.status === 1, `status=${r.status}`);
  ok("  e diz que perdeu o alvo", /perdeu o alvo/.test(r.saida), r.saida.trim().slice(0, 160));
}

// ---------------------------------------------------------------------------
// A fronteira do teto proprio
// ---------------------------------------------------------------------------
{
  const r = medir({ "a.yml": TETO_PROPRIO - 1 });
  ok(`${(TETO_PROPRIO - 1).toLocaleString("pt-BR")} bytes (1 abaixo do teto proprio) PASSA`, r.status === 0, `status=${r.status}\n${r.saida.trim().slice(0, 200)}`);
}
{
  const r = medir({ "a.yml": TETO_PROPRIO });
  ok(`${TETO_PROPRIO.toLocaleString("pt-BR")} bytes (o teto proprio exato) REPROVA`, r.status === 1, `status=${r.status}`);
  ok("  e nomeia o arquivo", /a\.yml/.test(r.saida), r.saida.trim().slice(0, 160));
  ok("  e diz como encolher sem partir o workflow", /Tire PROSA, nao step/.test(r.saida), r.saida.trim().slice(0, 200));
}

// ---------------------------------------------------------------------------
// Acima dos 512.000: a mensagem tem de dizer DESLIGADO, nao vermelho
// ---------------------------------------------------------------------------
// Esta e a assercao que paga o preco dos 12 dias da HMO-473. Quem le o vermelho
// precisa entender, na primeira linha, que nao ha step para consertar -- o
// workflow nao abriu job nenhum.
{
  const r = medir({ "verificacao.yml": TETO_DO_GITHUB });
  ok(`${TETO_DO_GITHUB.toLocaleString("pt-BR")} bytes REPROVA`, r.status === 1, `status=${r.status}`);
  ok("  e diz que NAO ESTA DANDO PARTIDA", /NAO ESTA DANDO PARTIDA/.test(r.saida), r.saida.trim().slice(0, 200));
  ok("  e diz `jobs: 0`", /jobs: 0/.test(r.saida), r.saida.trim().slice(0, 200));
  ok("  e manda a prosa do verificacao.yml para o .md de notas", /verificacao-notas\.md/.test(r.saida), r.saida.trim().slice(0, 240));
}

// A distincao entre os dois recados importa: entre o teto proprio e o do GitHub
// o workflow AINDA RODA, e dizer "nao esta dando partida" ali seria mentira.
{
  const r = medir({ "a.yml": TETO_PROPRIO + 10 });
  ok("entre os dois tetos, NAO diz que esta desligado", !/NAO ESTA DANDO PARTIDA/.test(r.saida), r.saida.trim().slice(0, 200));
  ok("  e diz que a margem acabou", /a margem acabou/.test(r.saida), r.saida.trim().slice(0, 200));
}

// ---------------------------------------------------------------------------
// A faixa de aviso passa, mas fala
// ---------------------------------------------------------------------------
{
  const r = medir({ "db-verify.yml": FAIXA_DE_AVISO + 1 });
  ok("na faixa de aviso PASSA", r.status === 0, `status=${r.status}\n${r.saida.trim().slice(0, 200)}`);
  ok("  e avisa", /AVISO: db-verify\.yml/.test(r.saida), r.saida.trim().slice(0, 200));
  ok("  com o conserto do db-verify (os dois gatilhos de paths:)", /DUAS vezes/.test(r.saida), r.saida.trim().slice(0, 240));
}
{
  const r = medir({ "a.yml": FAIXA_DE_AVISO - 1 });
  ok("abaixo da faixa de aviso nao avisa nada", r.status === 0 && !/AVISO/.test(r.saida), `status=${r.status}\n${r.saida.trim().slice(0, 200)}`);
}

// ---------------------------------------------------------------------------
// Mede TODO arquivo, nao o primeiro
// ---------------------------------------------------------------------------
// `readdir` devolve em ordem de sistema de arquivos, e uma guarda que sai no
// primeiro arquivo bom deixaria o segundo passar. O caso poe o grande DEPOIS do
// pequeno em ordem alfabetica.
{
  const r = medir({ "a-pequeno.yml": 100, "z-grande.yml": TETO_DO_GITHUB + 1 });
  ok("o arquivo grande reprova mesmo vindo depois de um pequeno", r.status === 1, `status=${r.status}`);
  ok("  e e ele que aparece no recado", /z-grande\.yml/.test(r.saida), r.saida.trim().slice(0, 200));
}

// `.yaml` conta igual: o filtro de extensao que esquece uma das duas grafias e
// outro jeito de a guarda medir menos do que existe.
{
  const r = medir({ "a.yaml": TETO_DO_GITHUB + 1 });
  ok(".yaml conta igual a .yml", r.status === 1, `status=${r.status}`);
}

// Arquivo que nao e workflow nao entra na conta.
{
  const r = medir({ "a.yml": 100, "notas.md": TETO_DO_GITHUB + 1 });
  ok(".md ao lado nao entra na conta (e o destino da prosa)", r.status === 0, `status=${r.status}\n${r.saida.trim().slice(0, 200)}`);
}

// ---------------------------------------------------------------------------
// Controle positivo: a arvore de verdade deste repositorio passa
// ---------------------------------------------------------------------------
// Sem este caso, todas as assercoes acima poderiam estar passando num mundo em
// que a guarda reprova tudo.
{
  const r = spawnSync(process.execPath, [GUARDA], { encoding: "utf8" });
  const saida = (r.stdout || "") + (r.stderr || "");
  ok("os workflows deste repositorio passam", r.status === 0, `status=${r.status}\n${saida.trim().slice(0, 400)}`);
  ok("  e o boletim mostra o tamanho de cada um", /verificacao\.yml\s+\d+ bytes/.test(saida), saida.trim().slice(0, 300));
}

console.log(`\n${casos - falhas}/${casos} casos ok`);
if (falhas) {
  console.error(`::error::${falhas} caso(s) do controle negativo da guarda de tamanho falharam.`);
  process.exit(1);
}
console.log("A guarda do teto de bytes sabe reprovar, e sabe nao reprovar.");
