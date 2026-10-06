#!/usr/bin/env node
// Mutantes da HMO-312 -- pagar a fatura do cartao: a decisao e os dois pedidos.
//
// POR QUE ISTO EXISTE
// -------------------
// `npm run test:pagamento-da-fatura` passa verde. Um teste que nunca reprovou
// nao prova nada: cada mutante abaixo desfaz UMA decisao de
// `lib/pagamento-da-fatura.ts`, e a suite dele tem de ficar vermelha.
//
// OS DOIS MUTANTES OBRIGATORIOS DA ISSUE sao os dois primeiros:
//
//   galho_do_close_pela_natureza -- troca `gravada` por `natureza` no galho do
//       `close`. A previsao que a pessoa LIGOU a fatura (HMO-305) passa a ser
//       FECHADA como se fosse a fatura do cartao: o `close` responde 200, a
//       fatura do mes vira uma conta a pagar de verdade, e o mes passa a cobrar
//       a divida duas vezes -- sem erro em lugar nenhum. Se ele sobrevive, a
//       suite nao distingue os tres sabores de fatura e a F14 herda o defeito.
//
//   sem_galho_do_409 -- o 409 "esta fatura ja foi fechada" volta a ser erro. Se
//       ele sobrevive, o teste nao cobre a corrida de duas abas -- que e o
//       UNICO motivo de esta sequencia ser extraida em vez de copiada na tela de
//       Despesas.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao vive em memoria e e compilada de uma ARVORE TEMPORARIA, como nos
// runners da HMO-227 e da HMO-290. Mutar, rodar e restaurar no `finally` deixa
// a fonte mutada no disco quando o processo morre no meio -- e um `trap` que
// restaura por cima apaga trabalho nao salvo.
//
// O QUE ESTA LISTA NAO COBRE, DE PROPOSITO
// ----------------------------------------
// O FUSO de `hojeEmSaoPaulo`. Trocar `America/Sao_Paulo` por `UTC` ali
// sobreviveria em 21 das 24 horas do dia, porque os dois fusos concordam na
// data na maior parte do tempo -- um mutante que depende da hora do relogio
// torna o placar nao-reproduzivel, e um placar que oscila e pior que um buraco
// conhecido. Aquela decisao e medida pela suite rodando nos DOIS fusos
// (`TZ=UTC` e `TZ=America/Sao_Paulo`), que e o controle estavel.
//
// COMO RODAR
//   npm run mutantes:pagamento-da-fatura

import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  cpSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const FONTE = "lib/pagamento-da-fatura.ts";

// A COPIA PRECISA DE MAIS QUE A FONTE MUTADA: toda dependencia de runtime, ou o
// `tsc` para em TS2307 ("Cannot find module") ANTES de qualquer assercao -- o
// placar sairia perfeito e o controle positivo reprovaria. Toda dependencia
// nova de um destes arquivos precisa entrar aqui tambem.
const ACOMPANHAM = [
  "lib/agenda-do-cartao.ts",
  "lib/card-invoice.ts",
  // Re-exportado por card-invoice.ts: a chave canonica mora aqui (HMO-285).
  "lib/chave-da-fatura.ts",
  // card-invoice.ts -> transferencia.ts -> lancamento.ts.
  "lib/transferencia.ts",
  "lib/lancamento.ts",
  "scripts/tsconfig.pagamento-da-fatura-test.json",
  "scripts/resolve-aliases.mjs",
  "scripts/test-pagamento-da-fatura.mjs",
];

// O `tsc` DO PROJETO, POR CAMINHO ABSOLUTO. `npx tsc` cairia no `tsc` do
// sistema (a arvore temporaria nao tem node_modules), que responde "This is not
// the tsc command you are looking for" -- e TODO mutante "morreria no tsc" com
// o placar saindo perfeito sem uma assercao ter rodado.
const TSC = join(process.cwd(), "node_modules/.bin/tsc");

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  {
    nome: "galho_do_close_pela_natureza",
    porque:
      "O PRIMEIRO MUTANTE OBRIGATORIO DA ISSUE: o galho do `close` passa a olhar a NATUREZA (a chave da fatura em `notes`) em vez de `gravada`. A previsao digitada que a pessoa ligou a fatura (HMO-305) e FECHADA como se fosse a fatura do cartao -- 200 em tudo, e o mes cobra a divida duas vezes",
    de: "  return ehFaturaPrevista(linha);",
    para: "  return faturaDaChave(linha.notes) !== null;",
  },
  {
    nome: "sem_galho_do_409",
    porque:
      "O SEGUNDO MUTANTE OBRIGATORIO DA ISSUE: o 409 'esta fatura ja foi fechada' volta a ser erro. Quem clicou ve a recusa, tenta de novo e ve a MESMA recusa, porque o estado nao vai mudar -- e a corrida de duas abas e o unico motivo de esta sequencia ser extraida em vez de copiada",
    de:
      "  if (status === 409 && dados.scheduled_transaction_id) {\n" +
      "    return { fatura: comId(fatura, dados.scheduled_transaction_id) };\n" +
      "  }",
    para: "  // mutante: o 409 vira erro",
  },
  {
    nome: "close_tambem_na_fatura_fechada",
    porque:
      "a fatura que JA esta fechada e fechada de novo antes da baixa: na melhor hipotese um 409 extra, e na previsao ligada da HMO-305 uma fatura de cartao fechada por causa de um pagamento de conta corrente",
    de: "  if (!fatura.precisaFechar) return null;",
    para: "  // mutante: fecha sempre",
  },
  {
    nome: "mes_do_close_com_o_dia",
    porque:
      "o `close` recebe 'AAAA-MM-01' onde a rota espera 'AAAA-MM': ela recusa, e o que a pessoa ve e 'nao foi possivel registrar a fatura' sobre uma fatura que existe",
    de: "      month: fatura.mes.slice(0, 7),",
    para: "      month: fatura.mes,",
  },
  {
    nome: "baixa_sem_conta_pagadora",
    porque:
      "a baixa sai sem `payment_account_id`: a rota recusa com `mensagemContaPagadora('ausente')` -- e era justamente a baixa sem conta pagadora que lancava tudo no proprio cartao e contava a despesa duas vezes (HMO-149)",
    de: "    corpo: { paid_date: hoje, payment_account_id: contaPagadoraId },",
    para: "    corpo: { paid_date: hoje },",
  },
  {
    nome: "baixa_aceita_fatura_sem_id",
    porque:
      "a fatura ABERTA, que nao existe em tabela nenhuma, vira `/api/scheduled-transactions/null/pay` -- 404, que para quem clicou se le como 'o app nao conseguiu' (este morre no `tsc`: e a UNIAO do descritor que impede a URL com null, e isso e o resultado certo)",
    de: "  if (fatura.id === null) return null;",
    para: "  // mutante: paga sem id",
  },
  {
    nome: "cartao_do_account_id_em_vez_da_chave",
    porque:
      "o cartao da fatura passa a sair do `account_id` da linha. Na previsao ligada (HMO-305) aquele campo e a CONTA CORRENTE, entao o `close` iria fechar a 'fatura' de uma conta corrente -- e a fatura do cartao continuaria em aberto",
    de: "    cartaoId: chave.accountId,",
    para: "    cartaoId: String(linha.account_id),",
  },
  {
    nome: "conta_comum_vira_fatura",
    porque:
      "toda conta a pagar passa a abrir o dialogo da conta pagadora e a ser paga pela rota da fatura: o aluguel viraria uma transferencia de duas pernas, e a despesa DESAPARECERIA do fluxo de caixa (as views do 008 filtram `transaction_type IN ('expense','income')`)",
    de: "  const chave = faturaDaChave(linha.notes);",
    para:
      '  const chave = faturaDaChave(linha.notes) ?? { mes: "1970-01-01", accountId: "" };',
  },
  {
    nome: "spinner_sempre_na_chave_canonica",
    porque:
      "a chave do spinner ignora o id da linha real: na fatura fechada o spinner aponta para uma chave que nenhuma linha da lista tem, e nenhuma linha gira enquanto a escrita acontece",
    de: "  return fatura.id ?? chaveFatura(fatura.mes, fatura.cartaoId);",
    para: "  return chaveFatura(fatura.mes, fatura.cartaoId);",
  },
  {
    nome: "aviso_de_valor_congelado_em_toda_fatura",
    porque:
      "a fatura JA FECHADA passa a avisar que 'ainda esta em aberto' e que uma compra lancada depois nao entra no pagamento -- uma frase falsa sobre um valor que nao muda mais, exatamente onde a pessoa esta decidindo pagar",
    de: "  return fatura.precisaFechar ? AVISO_DA_FATURA_ABERTA : null;",
    para: "  return AVISO_DA_FATURA_ABERTA;",
  },
  {
    nome: "cartao_paga_a_propria_fatura",
    porque:
      "o cartao volta ao seletor de quem paga a fatura. O proprio cartao pagando a propria fatura faz as duas pernas da transferencia se anularem: a fatura fica paga sem dinheiro nenhum ter saido",
    de: "  return contas.filter((conta) => conta.account_type !== TIPO_CARTAO);",
    para: "  return contas;",
  },
  {
    nome: "numeric_como_string",
    porque:
      "`amount` chega como string pelo PostgREST em alguns caminhos; sem o `Number` o valor no dialogo sai como texto e `moeda()` imprime 'R$ NaN' em cima do botao de confirmar",
    de: "    valor: Number(linha.amount),",
    para: "    valor: linha.amount as number,",
  },
];

const dir = mkdtempSync(join(tmpdir(), "mutantes-pagamento-da-fatura-"));

/** Compila a fonte mutada numa copia da arvore e roda a suite contra ela. */
function rodar(nome, fonte) {
  const raiz = join(dir, nome);

  mkdirSync(join(raiz, "lib"), { recursive: true });
  writeFileSync(join(raiz, FONTE), fonte);

  for (const arquivo of ACOMPANHAM) {
    mkdirSync(join(raiz, dirname(arquivo)), { recursive: true });
    cpSync(arquivo, join(raiz, arquivo));
  }

  try {
    execFileSync(TSC, ["-p", "scripts/tsconfig.pagamento-da-fatura-test.json"], {
      cwd: raiz,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    execFileSync(
      "node",
      ["scripts/resolve-aliases.mjs", ".tmp-pagamento-da-fatura", "lib"],
      { cwd: raiz, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (e) {
    // O `tsc` reprovando TAMBEM mata o mutante -- um mutante que nem compila e
    // informacao valida --, mas tem de ser DISTINGUIVEL do teste reprovando:
    // um mutante que nunca rodou nao prova nada sobre as assercoes.
    return {
      verde: false,
      como: "tsc",
      saida: String(e.stdout ?? e.message)
        .trim()
        .split("\n")
        .slice(0, 2)
        .join(" | "),
    };
  }

  try {
    execFileSync("node", ["--test", "scripts/test-pagamento-da-fatura.mjs"], {
      cwd: raiz,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { verde: true };
  } catch (e) {
    const saida = String(e.stdout ?? "") + String(e.stderr ?? "");
    const quais = [...saida.matchAll(/✖ (.+?) \(/g)]
      .map((m) => m[1])
      .filter((n) => n !== "failing tests:");
    return {
      verde: false,
      como: "teste",
      saida: [...new Set(quais)].slice(0, 3).join("; ") || "reprovou",
    };
  }
}

let falhou = false;

try {
  // CONTROLE POSITIVO. Sem ele, uma copia de arvore incompleta faria TODO
  // mutante "morrer" e o placar sairia cheio sem que uma assercao tivesse
  // medido nada. E o unico controle que pega erro de script no proprio runner.
  const controle = rodar("controle", original);
  if (!controle.verde) {
    console.error(
      `CONTROLE FALHOU: a fonte intacta nao passa na suite (${controle.como}) -> ${controle.saida}`
    );
    console.error("A copia da arvore esta errada. O placar abaixo nao vale.");
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  }
  console.log("controle: a fonte intacta passa na suite  OK\n");

  let mortos = 0;
  let porTeste = 0;

  for (const m of MUTANTES) {
    // MUTANTE QUE NAO SE APLICA E O PIOR RESULTADO POSSIVEL: ele contaria como
    // "morreu" sem nunca ter existido.
    const ocorrencias = original.split(m.de).length - 1;
    if (ocorrencias === 0) {
      console.error(
        `NAO APLICOU: ${m.nome} -- o trecho procurado nao esta em ${FONTE}`
      );
      falhou = true;
      continue;
    }
    if (ocorrencias > 1) {
      console.error(
        `AMBIGUO: ${m.nome} -- o trecho aparece ${ocorrencias}x; a mutacao atingiria so a primeira`
      );
      falhou = true;
      continue;
    }

    const r = rodar(m.nome, original.replace(m.de, m.para));
    if (r.verde) {
      console.error(`SOBREVIVEU: ${m.nome}`);
      console.error(`            ${m.porque}`);
      falhou = true;
    } else {
      mortos++;
      if (r.como === "teste") porTeste++;
      console.log(`morreu:     ${m.nome}  (${r.como}: ${r.saida})`);
    }
  }

  console.log(
    `\n${mortos}/${MUTANTES.length} mutantes mortos (${porTeste} por assercao)`
  );

  // UM MUTANTE MORTO SO PELO `tsc` NAO PROVA ASSERCAO NENHUMA. Se todos
  // morressem assim, a suite poderia estar vazia e o placar sairia perfeito.
  if (mortos > 0 && porTeste === 0) {
    console.error(
      "\nNENHUM mutante foi morto por assercao -- todos cairam no compilador. A suite nao esta medindo nada."
    );
    falhou = true;
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exitCode = falhou ? 1 : 0;
