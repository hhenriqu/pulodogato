// =====================================================
// PULODOGATO - E2E: de onde a suite le o ambiente
// =====================================================
// Tudo por variavel de ambiente, para a MESMA suite rodar contra producao, um
// preview da Vercel ou um `npm run dev` local:
//
//   E2E_BASE_URL       endereco do app (padrao: producao).
//   E2E_EMAIL          login da conta de teste.
//   E2E_PASSWORD       senha da conta de teste.
//   E2E_VERCEL_BYPASS  opcional: o "Protection Bypass for Automation" da Vercel,
//                      para entrar em preview protegido.
//   E2E_MASCARAR       "nao" desliga a mascara de valores nas evidencias. O
//                      padrao e mascarar: o repositorio e PUBLICO e os prints
//                      viram artefato do Actions.
//
// SEM LOGIN A SUITE FALHA, E NAO PULA. Suite que se desliga sozinha e
// indistinguivel de suite que passou. Quem quiser so a parte publica roda
// `npm run e2e -- --project=publico`.
// =====================================================

import { join } from "node:path";

export const BASE_URL = (
  process.env.E2E_BASE_URL || "https://pulodogato.hmoraes.com.br"
).replace(/\/+$/, "");

export const EMAIL = process.env.E2E_EMAIL ?? "";
export const SENHA = process.env.E2E_PASSWORD ?? "";

export const MASCARAR = process.env.E2E_MASCARAR !== "nao";

/** A sessao logada. Fica em e2e/.auth/, fora do git e do artefato. */
export const SESSAO = join(__dirname, ".auth", "sessao.json");

/** Onde os prints de cada rodada ficam (o CI sobe esta pasta). */
export const EVIDENCIAS = join(__dirname, "evidencias");

/** Cabecalhos extras de toda requisicao (o bypass do preview protegido). */
export function cabecalhosExtras(): Record<string, string> {
  const bypass = process.env.E2E_VERCEL_BYPASS;
  return bypass
    ? { "x-vercel-protection-bypass": bypass, "x-vercel-set-bypass-cookie": "true" }
    : {};
}
