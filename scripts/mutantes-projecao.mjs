#!/usr/bin/env node
// Controle negativo do lib/projecao.ts. Cada entrada abaixo estraga UMA decisao
// do arquivo; a suite `test:projecao` tem que ficar VERMELHA em todas. Mutante
// que sobrevive e um trecho que nenhuma assercao distingue -- ou codigo morto.
//
// O primeiro da lista e o que justifica a HMO-293 inteira: sem a exclusao da
// fatura, `scheduled_out` volta a descontar a mesma compra duas vezes, e foi
// isso que a medicao em producao pegou (`projected_total` caindo R$ 300 no
// clique em "fechar", sem nenhum fato novo). O segundo e o conserto TENTADOR e
// errado -- excluir por `account_type` -- que passa no tsc, passa numa leitura
// distraida, e apaga a assinatura cobrada no cartao.
//
// A MUTACAO VAI PARA UMA SOMBRA EM /tmp, NUNCA PARA A ARVORE
// ----------------------------------------------------------
// A primeira versao deste runner fazia `writeFileSync(ALVO, ...)` na fonte
// rastreada pelo git e restaurava no fim. Esse desenho ja plantou mutante neste
// repositorio: morto por timeout ou cancelamento, ele deixa o arquivo MUTADO na
// arvore, e dali em diante toda medicao le o arquivo errado sem nada no placar
// dizendo isso. O `criarBlocoDeMutantes` tira o problema da raiz -- o texto
// mutado so existe dentro da sombra -- e de graca roda o bloco inteiro num
// processo so, reaproveitando o AST de tudo o que nao foi mutado.
//
// O CONTROLE POSITIVO VEM ANTES DOS MUTANTES
// ------------------------------------------
// `bloco.rodar(..., {})` compila e roda a arvore INTACTA. E a unica coisa que
// pega erro no proprio aparelho: um `rodar` quebrado reprova todo mutante e o
// placar sai cheio -- "23/23 mortos" sobre zero assercoes executadas.
//
//   node scripts/mutantes-projecao.mjs

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const FONTE = "lib/projecao.ts";
const ALVO = fileURLToPath(new URL("../lib/projecao.ts", import.meta.url));
const SUITE = "test:projecao";

const MUTANTES = [
  // --- a exclusao da fatura: a razao de a issue existir ---
  {
    nome: "a fatura volta a entrar no scheduled_out (o defeito da HMO-293)",
    de: "    if (ehFatura(p.notes)) continue;\n",
    para: "",
  },
  {
    nome: "exclui por account_type em vez da chave em notes",
    de: "if (ehFatura(p.notes)) continue;",
    para: 'if (projecao?.account_type === "credit_card") continue;',
  },
  // O cartao ARQUIVADO torna este caso alcancavel: a rota so busca
  // `is_active = true`, entao `projecao` e undefined com `account_id` cheio.
  {
    nome: "exclui so quando a conta esta na lista (cartao arquivado vaza)",
    de: "if (ehFatura(p.notes)) continue;",
    para: "if (projecao && ehFatura(p.notes)) continue;",
  },
  {
    nome: "a fatura entra como scheduled_in (opcao B: infla o total)",
    de: "if (ehFatura(p.notes)) continue;",
    para:
      "if (ehFatura(p.notes)) {\n" +
      "      if (projecao) projecao.scheduled_in += Math.abs(numero(p.amount));\n" +
      "      continue;\n" +
      "    }",
  },
  {
    nome: "o cartao inteiro sai da projecao (opcao D)",
    de: "if (ehFatura(p.notes)) continue;",
    para:
      'if (projecao?.account_type === "credit_card") continue;\n' +
      "    if (ehFatura(p.notes)) continue;",
  },

  // --- o sinal e a aritmetica do saldo projetado ---
  {
    nome: "scheduled_out passa a SOMAR no saldo da conta",
    de: "p.current_balance - p.scheduled_out + p.scheduled_in",
    para: "p.current_balance + p.scheduled_out + p.scheduled_in",
  },
  {
    nome: "scheduled_in passa a DESCONTAR no saldo da conta",
    de: "p.current_balance - p.scheduled_out + p.scheduled_in",
    para: "p.current_balance - p.scheduled_out - p.scheduled_in",
  },
  {
    nome: "o total projetado soma o que sai",
    de: "saldoAtual - saiTotal + entraTotal",
    para: "saldoAtual + saiTotal + entraTotal",
  },
  {
    nome: "o total projetado desconta o que entra",
    de: "saldoAtual - saiTotal + entraTotal",
    para: "saldoAtual - saiTotal - entraTotal",
  },

  // --- o badge "fica negativa" ---
  {
    nome: "goes_negative perde a igualdade do saldo zerado",
    de: "projetado < 0 && p.current_balance >= 0",
    para: "projetado < 0 && p.current_balance > 0",
  },
  {
    nome: "goes_negative avisa quem JA esta negativo hoje",
    de: "projetado < 0 && p.current_balance >= 0",
    para: "projetado < 0",
  },
  {
    nome: "goes_negative dispara na projecao exatamente zero",
    de: "projetado < 0 && p.current_balance >= 0",
    para: "projetado <= 0 && p.current_balance >= 0",
  },

  // --- o horizonte, o vencido e a direcao ---
  {
    nome: "o horizonte deixa de cortar a prevista",
    de: "if (p.due_date > ate) continue;",
    para: "",
  },
  {
    nome: "a borda do horizonte vira exclusiva",
    de: "if (p.due_date > ate) continue;",
    para: "if (p.due_date >= ate) continue;",
  },
  {
    nome: "vencido passa a incluir a prevista que vence HOJE",
    de: "if (p.due_date < hoje) vencidoTotal",
    para: "if (p.due_date <= hoje) vencidoTotal",
  },
  {
    nome: "receita vencida passa a contar como conta atrasada",
    de: "vencidoTotal += ehReceita ? 0 : valor;",
    para: "vencidoTotal += valor;",
  },
  {
    nome: "a prevista sem conta deixa de entrar nos totais",
    de:
      "      if (ehReceita) semContaIn += valor;\n" +
      "      else semContaOut += valor;\n" +
      "      continue;",
    para: "      continue;",
  },
  {
    nome: "o total ignora a prevista sem conta",
    de: "projecoes.reduce((s, p) => s + p.scheduled_out, 0) + semContaOut",
    para: "projecoes.reduce((s, p) => s + p.scheduled_out, 0)",
  },
  {
    nome: "a direcao deixa de ser lida (tudo vira despesa, o defeito da HMO-256)",
    de: 'const ehReceita = direcaoDaAgenda(p.direction) === "income";',
    para: "const ehReceita = false;",
  },
  {
    // O mutante que SUBSTITUI "o embed em ARRAY deixa de ser lido": a HMO-256
    // apagou a normalizacao do embed (a direcao vem de UMA coluna da view
    // agora), e um `de:` que nao casa sai 0 sem mutar nada.
    //
    // ELE TEM DE PULAR `direcaoDaAgenda`, e nao variar o lado direito da
    // igualdade. Medido: `!== "expense"` SOBREVIVE, e sobrevive CERTO --
    // `direcaoDaAgenda` devolve `DirecaoPrevista` ("income" | "expense"), entao
    // as duas comparacoes particionam o mesmo conjunto e o mutante e
    // equivalente. Quem carrega o default conservador e a funcao, nao a
    // comparacao: ler `p.direction` crua e o que perde o lado seguro, e faz
    // `direction` nulo ou 'transfer' prometer dinheiro que nao vem.
    nome: "a direcao e lida crua, sem o default conservador de direcaoDaAgenda",
    de: 'const ehReceita = direcaoDaAgenda(p.direction) === "income";',
    para: 'const ehReceita = p.direction !== "expense";',
  },
  {
    // A previsao AVULSA e o caso da issue: ela tem `direction` e nao tem regra.
    // Este mutante reintroduz a suposicao antiga pela porta dos fundos -- so
    // confia na coluna quando ela diz 'expense' --, e e a forma mais barata de
    // o defeito voltar sem que nenhum nome de funcao mude.
    nome: "so a despesa e lida da coluna; a receita avulsa volta a ser despesa",
    de: 'const ehReceita = direcaoDaAgenda(p.direction) === "income";',
    para:
      'const ehReceita = direcaoDaAgenda(p.direction) === "income" &&\n' +
      "      p.notes != null;",
  },
  {
    nome: "o valor da prevista deixa de ser modulo",
    de: "const valor = Math.abs(numero(p.amount));",
    para: "const valor = numero(p.amount);",
  },

  // --- a ordem da lista e o horizonte default ---
  {
    nome: "a lista inverte: a conta mais folgada vem primeiro",
    de: "projecoes.sort((a, b) => a.projected_balance - b.projected_balance);",
    para: "projecoes.sort((a, b) => b.projected_balance - a.projected_balance);",
  },
  {
    nome: "fimDoMes erra o ultimo dia por um",
    de: "const ultimo = lastDayOfMonth(ano, mes);",
    para: "const ultimo = lastDayOfMonth(ano, mes) - 1;",
  },
];

const original = readFileSync(ALVO, "utf8");

const bloco = criarBlocoDeMutantes({ rotulo: "projecao", suites: [SUITE] });

// A sombra e apagada mesmo se este processo sair por excecao ou por sinal.
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
    // O tsc reprovando tambem conta como morto -- um mutante que nao compila nao
    // chega em producao. Mas vale distinguir na saida: um erro de tipo nao diz
    // que a SUITE pegou a regra.
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
