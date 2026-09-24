#!/usr/bin/env node
// Prova de mutacao do lib/cash-flow-forecast.ts. NAO roda em CI: e uma
// ferramenta de quem esta escrevendo o teste. Cada entrada abaixo estraga uma
// decisao do arquivo; a suite tem que ficar VERMELHA em todas. Mutante que
// sobrevive e um trecho que nenhum teste distingue -- ou codigo morto.
//
//   node scripts/mutantes-cash-flow.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVO = "lib/cash-flow-forecast.ts";
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  ["conta arquivada volta a contar", 'if (conta.is_active === false) continue;', ""],
  ["cartao entra no saldo inicial", 'classificarConta(String(conta.account_type)) !== "liquido"', 'classificarConta(String(conta.account_type)) === "investimento"'],
  ["vencido nao e trazido para hoje", "const data = vencida ? hoje : p.due_date;", "const data = p.due_date;"],
  ["horizonte deixa de cortar a prevista", "if (!isIsoDate(p.due_date) || p.due_date > ate) continue;", "if (!isIsoDate(p.due_date)) continue;"],
  ["tolerancia de duplicata encolhe", "export const TOLERANCIA_DUPLICATA_DIAS = 7;", "export const TOLERANCIA_DUPLICATA_DIAS = 3;"],
  ["borda da tolerancia vira exclusiva", "<= TOLERANCIA_DUPLICATA_DIAS", "< TOLERANCIA_DUPLICATA_DIAS"],
  ["conta prevista absorve a assinatura inteira", "gemea.usada = true;", ""],
  ["receita passa a absorver assinatura", "if (ehReceita) continue;\n\n    const chave", "const chave"],
  ["conta sem descricao absorve", "if (chave) agendadas.push", "agendadas.push"],
  ["IGNORED e CANCELLED voltam a projetar", 'if (r.status !== "DETECTED" && r.status !== "CONFIRMED") continue;', ""],
  ["quem ja esta negativo ganha data de mergulho", "if (!comecaNegativo && primeiroDiaNegativo === null && saldo < 0)", "if (primeiroDiaNegativo === null && saldo < 0)"],
  ["empate do menor saldo fica com o dia mais tarde", "if (saldo < menorSaldo) {", "if (saldo <= menorSaldo) {"],
  ["ordem dentro do dia inverte", "doDia.sort((a, b) => a.valor - b.valor);", "doDia.sort((a, b) => b.valor - a.valor);"],
  ["cobranca anterior a janela volta a ser devolvida", "if (data >= de) datas.push(data);", "datas.push(data);"],
  ["recorrencia com data velha nao rola mais", "for (let i = 0; i < MAX_PASSOS && data <= ate; i++) {", "for (let i = 0; i < MAX_PASSOS && data <= ate; i++) {\n    if (data < de) break;"],
  ["horizonte perde o teto", "return Math.min(bruto, DIAS_MAX);", "return bruto;"],
  ["valor da prevista deixa de ser modulo", "const valor = Math.abs(numero(p.amount));", "const valor = numero(p.amount);"],
];

let sobreviventes = 0;

for (const [nome, de, para] of mutantes) {
  if (!original.includes(de)) {
    console.log(`?? ${nome}: o trecho nao existe mais -- mutante desatualizado`);
    sobreviventes++;
    continue;
  }
  writeFileSync(ALVO, original.replace(de, para));
  let vermelho = false;
  try {
    execSync("npm run test:cash-flow", { stdio: "pipe" });
  } catch {
    vermelho = true;
  }
  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) sobreviventes++;
}

writeFileSync(ALVO, original);
console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`);
process.exit(sobreviventes === 0 ? 0 : 1);
