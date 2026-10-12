#!/usr/bin/env node
// Controle negativo da fiacao de app/api/cash-flow/route.ts (HMO-400). Cada
// entrada abaixo estraga UMA decisao da consulta que alimenta o fluxo de caixa;
// a suite `test:receita-no-fluxo` tem que ficar VERMELHA em todas.
//
//   node scripts/mutantes-receita-no-fluxo.mjs
//
// POR QUE ESTE RUNNER EXISTE, E O QUE SO ELE MEDE
// ----------------------------------------------
// O controle positivo obvio -- rodar a suite contra o codigo de ANTES do
// conserto -- fica vermelho, mas pelo motivo ERRADO: o codigo antigo lia a
// TABELA `scheduled_transactions`, o fixture da suite enche a VIEW, e entao
// nenhuma previsao chega ao calculo. "Tudo zero" reprova os casos de receita e
// tambem os de despesa, e uma suite que fica vermelha por falta de dado nao
// prova que ela distingue o SINAL de uma linha que chegou.
//
// O primeiro mutante daqui e exatamente essa prova: mantem a leitura da view e
// troca so a direcao por `"expense"` -- o defeito da issue, isolado. Ele e o
// unico jeito de afirmar que a suite mede a direcao e nao a origem do dado.
//
// A MUTACAO VAI PARA UMA SOMBRA EM /tmp, NUNCA PARA A ARVORE: ver o cabecalho
// de scripts/mutantes-projecao.mjs, que explica por que
// `writeFileSync` na fonte rastreada ja plantou mutante neste repositorio.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const FONTE = "app/api/cash-flow/route.ts";
const ALVO = fileURLToPath(new URL("../app/api/cash-flow/route.ts", import.meta.url));
const SUITE = "test:receita-no-fluxo";

const MUTANTES = [
  // --- a direcao: o defeito da issue, isolado da troca de relacao ---
  {
    nome: "toda previsao volta a ser despesa (o defeito medido em producao)",
    de: "      tipo: direcaoDaAgenda(p.direction),",
    para: '      tipo: "expense",',
  },
  {
    nome: "toda previsao vira receita (o mesmo erro para o outro lado)",
    de: "      tipo: direcaoDaAgenda(p.direction),",
    para: '      tipo: "income",',
  },
  {
    nome: "a direcao sai do campo errado da view (transaction_type cru)",
    // `transaction_type` existe na view e e NULL na ocorrencia gerada por regra
    // fixa: a receita fixa voltaria a ser conta a pagar, e a avulsa continuaria
    // certa. E a meia-correcao plausivel.
    de: "      tipo: direcaoDaAgenda(p.direction),",
    para:
      "      tipo: direcaoDaAgenda(\n" +
      "        (p as unknown as { transaction_type?: string | null }).transaction_type\n" +
      "      ),",
  },
  {
    nome: "a peneira da direcao e reescrita a mao, sem a precedencia do lib",
    // Equivalente de verdade para `income`/`expense`, mas NAO para `transfer`:
    // o comparador `!== "expense"` leria a transferencia prevista como entrada.
    de: "      tipo: direcaoDaAgenda(p.direction),",
    para: '      tipo: p.direction !== "expense" ? "income" : "expense",',
  },

  // --- a relacao de onde a previsao sai ---
  {
    nome: "volta a ler a tabela crua (a view era a unica fonte de `direction`)",
    de: '      .from("scheduled_transactions_effective")',
    para: '      .from("scheduled_transactions")',
  },

  // --- os recortes da consulta ---
  {
    nome: "o filtro de usuario sai (a linha de grupo do outro membro entra)",
    de: '      .eq("user_id", user.id)\n      .eq("status", "pending")',
    para: '      .eq("status", "pending")',
  },
  {
    nome: "o recorte de status sai (a receita apagada volta a aparecer)",
    de: '      .eq("status", "pending")\n',
    para: "",
  },
  {
    nome: "o status passa a aceitar tudo que nao foi pago (skipped volta)",
    de: '.eq("status", "pending")',
    para: '.neq("status", "paid")',
  },
  {
    nome: "o status e lido do campo derivado (a vencida sai da projecao)",
    // `effective_status` e 'overdue' quando a linha venceu, e ela TEM de
    // continuar na projecao: conta vencida e dinheiro que ainda vai sair.
    de: '.eq("status", "pending")',
    para: '.eq("effective_status", "pending")',
  },
];

// O MUTANTE QUE NAO ESTA NESTA LISTA, E POR QUE
// ---------------------------------------------
// `.lte("due_date", ate)` foi mutado para um teto de 2099 e SOBREVIVEU -- e ele
// esta certo em sobreviver. `projetarFluxoDeCaixa` descarta a previsao fora da
// janela por conta propria (`if (!isIsoDate(p.due_date) || p.due_date > ate)
// continue`), com caso proprio na suite do lib. O teto na consulta e um recorte
// de BANCO: ele diminui a linha que atravessa a rede e nao muda numero nenhum
// da resposta. Mutante de trecho equivalente nao se mata inventando assercao --
// forcar um caso aqui mediria a regra do lib duas vezes e o segundo medidor
// seria o que envelhece. Ver `mutante-sobrevivente-pode-estar-certo`.

const original = readFileSync(ALVO, "utf8");

const bloco = criarBlocoDeMutantes({ rotulo: "receita-no-fluxo", suites: [SUITE] });

process.on("exit", () => bloco.fechar());

const controle = bloco.rodar("controle", {}, SUITE);
if (!controle.verde) {
  console.error(`CONTROLE FALHOU: ${FONTE} intacto reprova na suite (${controle.como})`);
  console.error(`  ${controle.saida}`);
  process.exit(1);
}
console.log(`CTRL  ${FONTE} intacto passa na suite\n`);

let mortos = 0;
const sobreviventes = [];

for (const mutante of MUTANTES) {
  if (!original.includes(mutante.de)) {
    console.log(`SKIP  ${mutante.nome}`);
    console.log("      o trecho nao existe mais no arquivo -- atualize o mutante");
    sobreviventes.push(`${mutante.nome} (trecho ausente)`);
    continue;
  }

  const r = bloco.rodar(
    mutante.nome,
    { [FONTE]: original.replace(mutante.de, mutante.para) },
    SUITE
  );

  if (!r.verde) {
    mortos++;
    console.log(`MORTO ${mutante.nome}  (${r.como === "tsc" ? "tsc" : "asercao"})`);
  } else {
    console.log(
      `VIVO  ${mutante.nome}` +
        (r.mudouASaida === false
          ? "  (saida compilada identica a da arvore limpa: EQUIVALENTE)"
          : "")
    );
    sobreviventes.push(mutante.nome);
  }
}

console.log(`\n${mortos}/${MUTANTES.length} mortos.`);

if (sobreviventes.length > 0) {
  console.log("\nSOBREVIVENTES:");
  for (const nome of sobreviventes) console.log(`  - ${nome}`);
  process.exit(1);
}
