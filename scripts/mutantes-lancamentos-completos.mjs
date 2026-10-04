#!/usr/bin/env node
// Prova de mutacao dos dois modulos da HMO-215. NAO roda em CI -- e ferramenta
// de quem esta escrevendo o teste. Cada entrada estraga uma decisao do fonte; a
// suite tem que ficar VERMELHA em todas. Mutante que sobrevive e um trecho que
// nenhum teste distingue, ou codigo morto.
//
//   node scripts/mutantes-lancamentos-completos.mjs
//
// Os dois mutantes que mais importam, porque sao os que erram DINHEIRO sem
// quebrar nada:
//
//   * `-Math.abs(parte.amount)` virando `parte.amount`. A view do 033 devolve a
//     parte POSITIVA; a lista pinta pelo sinal. O mutante mostra a minha parte
//     do jantar em VERDE, como receita, e o numero exibido continua certo.
//   * a guarda de `paguei_eu` caindo. A despesa que eu paguei aparece duas
//     vezes -- os R$ 400 cheios mais os R$ 200 da minha parte --, somando R$ 600
//     de um gasto de R$ 400.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const DESTINO = "lib/destino-do-lancamento.ts";
const PARTE = "lib/parte-de-grupo-na-lista.ts";

const fontes = new Map([
  [DESTINO, readFileSync(DESTINO, "utf8")],
  [PARTE, readFileSync(PARTE, "utf8")],
]);

const mutantes = [
  // --- o sentido do destino ---
  [
    DESTINO,
    "receita e despesa trocam de preposicao (gasto no cartao vira entrada)",
    '      ? { origem: null, destino: minha, texto: `para ${minha}`, faltaConta: false }\n      : { origem: minha, destino: null, texto: `de ${minha}`, faltaConta: false };',
    '      ? { origem: minha, destino: null, texto: `de ${minha}`, faltaConta: false }\n      : { origem: null, destino: minha, texto: `para ${minha}`, faltaConta: false };',
  ],
  [
    DESTINO,
    "a seta da transferencia aponta para o lado errado",
    "  const souASaida = mov.amount < 0;",
    "  const souASaida = mov.amount > 0;",
  ],
  [
    DESTINO,
    "o tipo passa a sair do sinal, e nao de classificarMovimentacao",
    "  const tipo = classificarMovimentacao(mov);",
    '  const tipo = mov.transaction_type === "transfer" ? "transfer" : mov.amount < 0 ? "expense" : "income";',
  ],

  // --- o elo de uma via (015) ---
  [
    DESTINO,
    "o indice reverso some (toda perna de SAIDA perde a contraparte)",
    "    if (mov.counterpart_transaction_id) {\n      porContraparte.set(mov.counterpart_transaction_id, mov);\n    }",
    "    if (false) {\n      porContraparte.set(mov.counterpart_transaction_id!, mov);\n    }",
  ],
  [
    DESTINO,
    "a busca da contraparte deixa de tentar as duas direcoes",
    "  return indice.porContraparte.get(mov.id) ?? null;",
    "  return null;",
  ],

  // --- o que nao se inventa ---
  [
    DESTINO,
    "a conta ausente passa a virar meia seta em vez de frase",
    "  if (origem) {\n    return { origem, destino: null, texto: `saiu de ${origem}`, faltaConta: false };\n  }",
    "  if (origem) {\n    return { origem, destino: null, texto: `${origem} → `, faltaConta: false };\n  }",
  ],
  [
    DESTINO,
    "nome de conta em branco deixa de contar como ausente",
    '  return typeof nome === "string" && nome.trim() ? nome.trim() : null;',
    '  return typeof nome === "string" ? nome : null;',
  ],
  [
    DESTINO,
    "a transferencia de valor zero passa a receber direcao",
    "  if (mov.amount === 0) {",
    "  if (false) {",
  ],

  // --- o sinal da parte de grupo ---
  [
    PARTE,
    "a parte entra POSITIVA (a minha parte do jantar aparece como receita)",
    "      amount: -Math.abs(parte.amount),",
    "      amount: parte.amount,",
  ],
  [
    PARTE,
    "o -Math.abs vira - simples (view mudando de sinal vira receita)",
    "      amount: -Math.abs(parte.amount),",
    "      amount: -parte.amount,",
  ],
  [
    PARTE,
    "o total da despesa entra positivo",
    "      totalDaDespesa: -Math.abs(despesa.amount),",
    "      totalDaDespesa: Math.abs(despesa.amount),",
  ],

  // --- a contagem dupla ---
  [
    PARTE,
    "a guarda de paguei_eu cai (a despesa que eu paguei conta duas vezes)",
    "    if (parte.paguei_eu) continue;",
    "    if (false) continue;",
  ],
  [
    PARTE,
    "a guarda de paguei_eu inverte (so a MINHA parte do que eu paguei entra)",
    "    if (parte.paguei_eu) continue;",
    "    if (!parte.paguei_eu) continue;",
  ],

  // --- a parte sem descricao ---
  [
    PARTE,
    "a parte sem despesa passa a entrar na lista sem descricao",
    "    const despesa = despesas.get(parte.transaction_id);\n    if (!despesa) {\n      semDescricao += 1;\n      continue;\n    }",
    '    const despesa = despesas.get(parte.transaction_id) ?? {\n      id: parte.transaction_id,\n      description: "",\n      amount: 0,\n      category: null,\n    };',
  ],
  [
    PARTE,
    "o descarte deixa de ser contado (a lista encurta em silencio)",
    "      semDescricao += 1;\n      continue;",
    "      continue;",
  ],

  // --- o id que nao pode cair numa rota de transacao ---
  [
    PARTE,
    "o id da parte perde o prefixo (vai cru para a rota de transacao)",
    "      id: `parte:${parte.id}`,",
    "      id: parte.id,",
    ],
  [
    PARTE,
    "o id da parte passa a ser o id da transacao do grupo",
    "      id: `parte:${parte.id}`,",
    "      id: parte.transaction_id,",
  ],

  // --- a aba em que a parte aparece ---
  [
    PARTE,
    "a parte passa a aparecer em TODAS as abas (inclusive Receitas)",
    '  if (filtro === "todos" || filtro === "expense") {',
    "  if (true) {",
  ],
  [
    PARTE,
    "a parte deixa de aparecer na aba Despesas",
    '  if (filtro === "todos" || filtro === "expense") {',
    '  if (filtro === "todos") {',
  ],
  [
    PARTE,
    "a parte deixa de aparecer na lista inteira",
    '  if (filtro === "todos" || filtro === "expense") {',
    "  if (false) {",
  ],

  // --- a ordem ---
  [
    PARTE,
    "a ordenacao por data some (as partes caem todas no fim da lista)",
    "  return linhas.sort((a, b) => dataDaLinha(b).localeCompare(dataDaLinha(a)));",
    "  return linhas;",
  ],
  [
    PARTE,
    "a lista sai em ordem CRESCENTE de data",
    "  return linhas.sort((a, b) => dataDaLinha(b).localeCompare(dataDaLinha(a)));",
    "  return linhas.sort((a, b) => dataDaLinha(a).localeCompare(dataDaLinha(b)));",
  ],

  // --- a contagem da barra de abas ---
  [
    PARTE,
    "a contagem volta a ignorar as partes (a aba diz 4 e mostra 6)",
    "    todos: minhas.length + partes.length,\n    income: 0,\n    expense: partes.length,",
    "    todos: minhas.length,\n    income: 0,\n    expense: 0,",
  ],
  [
    PARTE,
    "as partes entram na contagem de Receitas",
    "    income: 0,\n    expense: partes.length,",
    "    income: partes.length,\n    expense: 0,",
  ],

  // --- a nota dos cartoes ---
  [
    PARTE,
    "o total das partes passa a somar com sinal (zera ou inverte)",
    "  return linhas.reduce((soma, linha) => soma + Math.abs(linha.amount), 0);",
    "  return linhas.reduce((soma, linha) => soma + linha.amount, 0);",
  ],
  [
    PARTE,
    "a nota passa a aparecer com zero parte (R$ 0,00 em grupo para quem nao tem grupo)",
    "  if (linhas.length === 0) return null;",
    "  if (false) return null;",
  ],

  // --- a parte DENTRO do cartao Despesas (HMO-275) ---
  //
  // Os tres primeiros sao os que erram dinheiro sem quebrar nada: um deles --
  // o `meu.saldo` herdado -- e um erro de UMA PALAVRA que deixa os tres cartoes
  // se contradizendo embaixo da legenda "Receitas - Despesas". Um teste que
  // afirmasse so sobre o saldo sobreviveria a dois deles.
  [
    PARTE,
    "a parte volta a ficar fora do cartao Despesas",
    "  const despesas = meu.despesas + totalDasPartesDeTerceiros(partes);",
    "  const despesas = meu.despesas;",
  ],
  [
    PARTE,
    "o saldo e HERDADO em vez de recalculado (os tres cartoes se contradizem)",
    "    saldo: meu.receitas - despesas,",
    "    saldo: meu.saldo,",
  ],
  [
    PARTE,
    "a parte entra em RECEITAS (o reembolso da F10 publicado como recebido)",
    "  const despesas = meu.despesas + totalDasPartesDeTerceiros(partes);\n\n  return {\n    receitas: meu.receitas,",
    "  const despesas = meu.despesas;\n\n  return {\n    receitas: meu.receitas + totalDasPartesDeTerceiros(partes),",
  ],
  [
    PARTE,
    "a parte entra nos DOIS lados (o saldo fecha certo e os dois cartoes incham)",
    "    receitas: meu.receitas,",
    "    receitas: meu.receitas + totalDasPartesDeTerceiros(partes),",
  ],
  [
    PARTE,
    "a parte SUBTRAI de Despesas (gasto do mes cai quando outro paga)",
    "  const despesas = meu.despesas + totalDasPartesDeTerceiros(partes);",
    "  const despesas = meu.despesas - totalDasPartesDeTerceiros(partes);",
  ],
  [
    PARTE,
    "a parte conta em dobro no cartao",
    "  const despesas = meu.despesas + totalDasPartesDeTerceiros(partes);",
    "  const despesas = meu.despesas + 2 * totalDasPartesDeTerceiros(partes);",
  ],
  [
    PARTE,
    "a parte passa a contar como transferencia (muda a outra frase do saldo)",
    "    transferido: meu.transferido,\n    transferencias: meu.transferencias,",
    "    transferido: meu.transferido + totalDasPartesDeTerceiros(partes),\n    transferencias: meu.transferencias + partes.length,",
  ],
  [
    PARTE,
    "o cartao passa a contar a parte CONTADA PELA QUANTIDADE, nao pelo valor",
    "  const despesas = meu.despesas + totalDasPartesDeTerceiros(partes);",
    "  const despesas = meu.despesas + partes.length;",
  ],
];

let sobreviventes = 0;

for (const [alvo, nome, de, para] of mutantes) {
  const original = fontes.get(alvo);

  // Mutante que nao aplica passa por "morto" sem nunca ter existido: o trecho
  // mudou de forma, o replace nao acha nada, e a suite fica verde por nao ter
  // sido mexida. Conta como sobrevivente de proposito.
  if (!original.includes(de)) {
    console.log(`??  ${nome}: o trecho nao existe mais -- mutante desatualizado`);
    sobreviventes++;
    continue;
  }

  writeFileSync(alvo, original.replace(de, para));
  let vermelho = false;
  try {
    execSync("npm run test:lancamentos-completos", { stdio: "pipe" });
  } catch {
    vermelho = true;
  }
  writeFileSync(alvo, original);

  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) sobreviventes++;
}

// Restaurar os dois fontes e a ultima coisa que este script faz. `process.exit`
// dentro de um try pularia qualquer finally e deixaria lib/ MUTADO no worktree.
for (const [alvo, original] of fontes) writeFileSync(alvo, original);

console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`);
process.exit(sobreviventes === 0 ? 0 : 1);
