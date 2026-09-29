#!/usr/bin/env node
// =====================================================
// PULODOGATO - MUTACOES DA TRANSFERENCIA (HMO-164)
// =====================================================
//   node scripts/mutantes-transferencia.mjs
//
// Estraga `lib/transferencia.ts` de um jeito por vez e exige que a suite fique
// VERMELHA. Uma mutacao que sobrevive nao diz que o codigo esta certo: diz que
// o teste nao olha para aquela linha, e e assim que uma suite de 31 casos passa
// a cobrir 20.
//
// Nao entra no CI: ele roda a suite, nao o mutador. Isto e a conferencia de
// quem escreve o teste, antes de confiar nele.
// =====================================================

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const ALVO = "lib/transferencia.ts";
const original = readFileSync(ALVO, "utf8");

const MUTACOES = [
  {
    nome: "as duas pernas com o MESMO sinal (saida positiva)",
    de: "      amount: -total,",
    para: "      amount: total,",
  },
  {
    nome: "Math.abs removido do valor",
    de: "  const total = Math.abs(params.valor);",
    para: "  const total = params.valor;",
  },
  {
    nome: "origem e destino trocados nas pernas",
    de: "      account_id: params.origemId,",
    para: "      account_id: params.destinoId,",
  },
  {
    nome: "mesma conta deixa de ser recusada",
    de: '  if (origem.id === destino.id) return "mesma_conta";',
    para: "",
  },
  {
    nome: "cartao passa a servir de origem",
    de: '  if (origem.account_type === "credit_card") return "origem_e_cartao";',
    para: "",
  },
  {
    nome: "cartao passa a ser recusado tambem como DESTINO",
    de: '  if (origem.account_type === "credit_card") return "origem_e_cartao";',
    para: '  if (origem.account_type === "credit_card" || destino.account_type === "credit_card") return "origem_e_cartao";',
  },
  {
    nome: "ausente e nao-encontrada viram o mesmo motivo",
    de: '    return origem === null ? "origem_nao_encontrada" : "origem_ausente";',
    para: '    return "origem_ausente";',
  },
  {
    nome: "destino conferido antes da origem",
    de: `  if (!origem?.id) {
    return origem === null ? "origem_nao_encontrada" : "origem_ausente";
  }
  if (!destino?.id) {
    return destino === null ? "destino_nao_encontrado" : "destino_ausente";
  }`,
    para: `  if (!destino?.id) {
    return destino === null ? "destino_nao_encontrado" : "destino_ausente";
  }
  if (!origem?.id) {
    return origem === null ? "origem_nao_encontrada" : "origem_ausente";
  }`,
  },
  {
    nome: "valor zero passa a ser aceito",
    de: "  if (!Number.isFinite(valor) || valor <= 0) {",
    para: "  if (!Number.isFinite(valor) || valor < 0) {",
  },
  {
    nome: "contasDeOrigem deixa de filtrar o cartao",
    de: '  return contas.filter((c) => c.account_type !== "credit_card");',
    para: "  return contas;",
  },
  {
    nome: "a entrada herda o rotulo da saida no pagamento de fatura",
    de: "      description: params.descricaoDaEntrada ?? params.descricao,",
    para: "      description: params.descricao,",
  },
  {
    nome: "a tela para de checar as contas",
    de: "  if (problema) {\n    return { ok: false, mensagem: mensagemDaTransferencia(problema) };\n  }",
    para: "",
  },
];

let sobreviventes = 0;

for (const m of MUTACOES) {
  if (!original.includes(m.de)) {
    console.log(`?? NAO APLICADA (trecho mudou): ${m.nome}`);
    sobreviventes++;
    continue;
  }

  writeFileSync(ALVO, original.replace(m.de, m.para));

  let vermelho = false;
  try {
    execSync("npm run test:transferencia", { stdio: "pipe" });
  } catch {
    vermelho = true;
  }

  console.log(`${vermelho ? "OK  morreu  " : "XX  SOBREVIVEU"}  ${m.nome}`);
  if (!vermelho) sobreviventes++;
}

writeFileSync(ALVO, original);

// Controle positivo: com o arquivo restaurado a suite tem que voltar ao verde.
// Sem ele, um erro que deixasse a suite vermelha para SEMPRE mataria todas as
// mutacoes e o relatorio sairia perfeito.
try {
  execSync("npm run test:transferencia", { stdio: "pipe" });
  console.log("\ncontrole positivo: suite verde com o arquivo restaurado");
} catch {
  console.log("\nXX CONTROLE POSITIVO FALHOU -- o arquivo nao voltou ao normal");
  process.exit(1);
}

console.log(
  sobreviventes === 0
    ? `\n${MUTACOES.length} de ${MUTACOES.length} mutacoes mortas.`
    : `\n${sobreviventes} SOBREVIVENTE(S) de ${MUTACOES.length}.`
);
process.exit(sobreviventes === 0 ? 0 : 1);
