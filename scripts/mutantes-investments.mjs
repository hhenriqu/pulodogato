#!/usr/bin/env node
// Prova de mutacao do lib/investments.ts. NAO roda em CI: e uma ferramenta de
// quem esta escrevendo o teste. Cada entrada abaixo estraga uma decisao do
// arquivo; a suite tem que ficar VERMELHA em todas. Mutante que sobrevive e um
// trecho que nenhum teste distingue -- ou codigo morto.
//
//   node scripts/mutantes-investments.mjs
//
// 26 de 28 morrem. Os DOIS sobreviventes sao no-op, e vale registrar por que --
// senao alguem "conserta" o teste para matar um mutante que nao existe:
//
//   - "investido conta a posicao encerrada"
//   - "alocacao inclui posicao zerada"
//
// Os dois trocam `abertas` por `posicoes` numa soma. Uma posicao encerrada tem
// quantidade 0, e dai saem `custo = custo - (custo/qtd)*qtd = 0` e
// `current_value = 0 * preco = 0`: ela contribui ZERO nas duas somas, e o
// resultado e identico com ou sem o filtro. O filtro fica porque a intencao
// ("o resumo olha a carteira de hoje") tem que estar legivel no codigo, e
// porque uma posicao encerrada com custo residual -- linha editada a mao no
// banco -- passaria a somar.
//
// Trocar `abertas` pelo conjunto todo em `totalDividends` e `realizedProfitLoss`
// NAO e no-op, e esses dois mutantes morrem: e justamente o dinheiro que a
// posicao encerrada deixou.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const ALVO = "lib/investments.ts";
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  // O erro central do custo medio: a venda ponderando a media.
  [
    "venda pondera o preco medio",
    "e.custo -= medio * vendida;",
    "e.custo += quantidade * preco;",
  ],
  // Taxa fora do custo: infla o lucro em exatamente o valor das corretagens.
  [
    "taxa da compra sai do custo",
    "e.custo += quantidade * preco + taxas;",
    "e.custo += quantidade * preco;",
  ],
  ["taxa da venda deixa de abater", "e.realizado += quantidade * preco - taxas - medio * vendida;", "e.realizado += quantidade * preco - medio * vendida;"],
  // Provento tratado como aporte.
  ["provento entra na quantidade", "e.proventos += quantidade * preco - taxas;", "e.proventos += quantidade * preco - taxas;\n    e.quantidade += quantidade;"],
  ["provento entra no custo", "e.proventos += quantidade * preco - taxas;", "e.custo += quantidade * preco;"],
  // Preco ausente virando zero: a carteira "vale R$ 0,00" e -100%.
  ["preco ausente vira zero", "const precoParaAvaliar = temPreco ? num(precoInformado) : medio;", "const precoParaAvaliar = num(precoInformado);"],
  ["has_price passa a ser sempre verdadeiro", "const temPreco =", "const temPreco: boolean = true ||"],
  // Rentabilidade sobre o numero errado.
  ["rentabilidade dividida pelo valor atual", "e.custo > 0 ? arredondar((resultado / e.custo) * 100) : 0", "valorAtual > 0 ? arredondar((resultado / valorAtual) * 100) : 0"],
  ["resumo sem guarda de divisao por zero", "totalInvested > 0\n        ? arredondar((totalProfitLoss / totalInvested) * 100)\n        : 0", "arredondar((totalProfitLoss / totalInvested) * 100)"],
  // Realizado somado no nao realizado.
  ["realizado somado no resultado da posicao", "const resultado = valorAtual - e.custo;", "const resultado = valorAtual - e.custo + e.realizado;"],
  // Posicao encerrada entrando ou saindo do lugar errado.
  ["posicao zerada volta para a carteira", "return posicoes.filter((p) => p.total_quantity > 0);", "return posicoes;"],
  ["proventos da posicao encerrada somem", "const totalDividends = posicoes.reduce((s, p) => s + p.dividends, 0);", "const totalDividends = abertas.reduce((s, p) => s + p.dividends, 0);"],
  ["realizado da posicao encerrada some", "const realizedProfitLoss = posicoes.reduce(", "const realizedProfitLoss = abertas.reduce("],
  ["investido conta a posicao encerrada", "const totalInvested = abertas.reduce((s, p) => s + p.total_invested, 0);", "const totalInvested = posicoes.reduce((s, p) => s + p.total_invested, 0);"],
  // Alocacao.
  ["alocacao divide pelo investido em vez do valor atual", "const total = abertas.reduce((s, p) => s + p.current_value, 0);", "const total = abertas.reduce((s, p) => s + p.total_invested, 0);"],
  ["alocacao inclui posicao zerada", "const abertas = posicoesAbertas(posicoes);\n  const total = abertas.reduce", "const abertas = posicoes;\n  const total = abertas.reduce"],
  ["alocacao mostra fatia de zero por cento", "return TIPOS_DE_ATIVO.filter((t) => (porTipo.get(t) || 0) > 0).map((t) => {", "return TIPOS_DE_ATIVO.map((t) => {"],
  ["rotulo perde o acento", 'stock: "Ações",', 'stock: "Acoes",'],
  // Venda acima da posicao.
  ["quantidade fica negativa", "e.quantidade -= vendida;", "e.quantidade -= quantidade;"],
  ["excesso de venda deixa de ser sinalizado", "if (quantidade > e.quantidade) e.excedeu = true;", ""],
  // Evolucao mensal.
  ["evolucao ignora o corte no primeiro lancamento", "if (fim < primeira) continue;", ""],
  ["evolucao corta o mes do primeiro lancamento", "if (fim < primeira) continue;", "if (fim < primeira || fim === primeira) continue;\n    if (new Date(fim).getUTCDate() < 28) continue;"],
  ["evolucao usa o inicio do mes em vez do fim", "const d = new Date(Date.UTC(ano, mesZeroBased + 1, 0));", "const d = new Date(Date.UTC(ano, mesZeroBased, 1));"],
  ["evolucao deixa de cortar por data", "if (ate && l.trade_date > ate) continue;", ""],
  // numeric como string.
  ["numeric em string deixa de ser convertido", "const n = typeof v === \"number\" ? v : Number(v);", "const n = v as number;"],
  // Ordenacao.
  ["lancamentos deixam de ser ordenados por data", "for (const l of emOrdem(lancamentos)) {", "for (const l of lancamentos) {"],
  // quantidadeDisponivel, que e o arbitro da rota.
  ["quantidade disponivel ignora as vendas", "return arredondar(replay(doAtivo).quantidade, 8);", "return arredondar(doAtivo.filter((l) => l.kind === \"buy\").reduce((s, l) => s + num(l.quantity), 0), 8);"],
  ["quantidade disponivel olha o ativo errado", "const doAtivo = lancamentos.filter((l) => l.asset_id === assetId);", "const doAtivo = lancamentos;"],
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
    execSync("npm run test:investments", { stdio: "pipe" });
  } catch {
    vermelho = true;
  }
  console.log(`${vermelho ? "OK  " : "VIVO"} ${nome}`);
  if (!vermelho) sobreviventes++;
}

writeFileSync(ALVO, original);
console.log(`\n${mutantes.length - sobreviventes}/${mutantes.length} mutantes mortos`);
process.exit(sobreviventes === 0 ? 0 : 1);
