#!/usr/bin/env node
// Prova de mutacao do lib/services/cron-ledger.ts. NAO roda em CI: e uma
// ferramenta de quem esta escrevendo o teste. Cada entrada abaixo estraga uma
// decisao do arquivo; a suite tem que ficar VERMELHA em todas. Mutante que
// sobrevive e um trecho que nenhum teste distingue -- ou codigo morto.
//
//   node scripts/mutantes-cron-ledger.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVO = "lib/services/cron-ledger.ts";
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  // O caso que da nome ao arquivo: a execucao ociosa tem que ficar registrada
  // como sucesso. Se isto sobreviver, o projeto volta ao estado da HMO-152.
  ["execucao ociosa vira erro", 'status: ok ? "ok" : "error",', 'status: (ok && JSON.stringify(corpo).includes("0")) ? "error" : "ok",'],
  ["tudo vira sucesso", 'status: ok ? "ok" : "error",', 'status: "ok",'],
  ["tudo vira erro", 'status: ok ? "ok" : "error",', 'status: "error",'],

  // A faixa de status.
  ["200 deixa de ser sucesso", "httpStatus >= 200 && httpStatus < 300", "httpStatus > 200 && httpStatus < 300"],
  ["3xx passa a ser sucesso", "httpStatus >= 200 && httpStatus < 300", "httpStatus >= 200 && httpStatus < 400"],
  ["5xx passa a ser sucesso", "httpStatus >= 200 && httpStatus < 300", "httpStatus >= 200"],

  // O http_status guardado alem do status.
  ["http_status some da linha", "http_status: httpStatus,", "http_status: ok ? 200 : 500,"],

  // A mensagem de erro.
  ["corpo generico ganha da excecao", 'if (erro instanceof Error && erro.message) return erro.message;', ""],
  ["erro que nao e Error e descartado", 'if (erro !== undefined && erro !== null && `${erro}`.trim()) return `${erro}`;', ""],
  ["falha sem mensagem vira string vazia", 'return "falha sem mensagem";', 'return "";'],
  ["sucesso passa a carregar mensagem de erro", 'error: ok ? null : mensagemDeErro(erro, corpo),', "error: mensagemDeErro(erro, corpo),"],

  // O piso do relogio -- e o CHECK da 019.
  ["relogio para tras volta a furar o CHECK", "const fimCorrigido = Math.max(inicio, fim);", "const fimCorrigido = fim;"],
  ["duracao deixa de ser arredondada", "duration_ms: Math.round(fimCorrigido - inicio),", "duration_ms: fimCorrigido - inicio,"],
  ["started_at e finished_at trocam de lugar", "started_at: new Date(inicio).toISOString(),", "started_at: new Date(fimCorrigido).toISOString(),"],
  ["horario deixa de ser ISO", "new Date(fimCorrigido).toISOString()", "String(fimCorrigido)"],

  // O teto do corpo.
  ["teto do corpo some", "if (serializado.length <= MAX_RESULT_BYTES) return corpo;", "return corpo;"],
  ["corte deixa de ser marcado", "truncado: true,\n    motivo: `corpo de", "truncado: false,\n    motivo: `corpo de"],
  ["corpo circular derruba o registro", 'return { truncado: true, motivo: "corpo nao serializavel" };', "throw new Error('circular');"],
  ["corpo undefined some da linha", "if (corpo === undefined) return null;", ""],

  // A gravacao nunca pode derrubar a rota.
  // NAO usar `throw new Error(...)` aqui: o `return` mutado fica DENTRO do
  // proprio try, entao o catch logo abaixo devolve um objeto identico e o
  // mutante e equivalente -- sobrevive sem que exista buraco de teste nenhum.
  // A mutacao util e mentir sobre o desfecho.
  ["erro do banco passa a ser reportado como sucesso", "return { gravou: false, erro: erro.message };", "return { gravou: true };"],
  ["excecao na gravacao passa a derrubar a rota", "return { gravou: false, erro: msg };", "throw e;"],

  // O envelope.
  ["excecao no corpo deixa de virar 500", "let status = 500;", "let status = 200;"],
  ["envelope passa a engolir o status da rota", "status = r.status;", ""],
  ["envelope passa a engolir o corpo da rota", "body = r.body;", ""],
  ["cliente inalcancavel derruba a rota", "console.error(`cron_runs: nao foi possivel abrir o cliente para ${job}:`, e);", "throw e;"],
];

let sobreviventes = 0;
try {
  for (const [nome, de, para] of mutantes) {
    if (!original.includes(de)) {
      console.log(`?? NAO APLICADO  ${nome} -- o trecho nao existe mais no arquivo`);
      sobreviventes++;
      continue;
    }
    writeFileSync(ALVO, original.replace(de, para));
    try {
      execSync("npm run test:cron-ledger", { stdio: "pipe" });
      console.log(`SOBREVIVEU   ${nome}`);
      sobreviventes++;
    } catch {
      console.log(`morreu       ${nome}`);
    }
  }
} finally {
  writeFileSync(ALVO, original);
}

console.log(
  sobreviventes === 0
    ? `\nTUDO OK -- os ${mutantes.length} mutantes morreram.`
    : `\n${sobreviventes} de ${mutantes.length} sobreviveram.`
);
process.exit(sobreviventes > 0 ? 1 : 0);
