#!/usr/bin/env node
// Mutantes da decisao e da sequencia do pagamento de fatura
// (lib/pagamento-da-fatura.ts) -- HMO-310, fase 13.
//
// POR QUE ISTO EXISTE
// -------------------
// `test:pagamento-da-fatura` passa com 33 assercoes verdes, e isso sozinho nao
// diz nada: uma suite que nunca reprovou nao esta medindo o que a justificativa
// dela afirma. Cada mutante abaixo quebra UMA decisao, e a suite tem de ficar
// vermelha em todos.
//
// O MUTANTE QUE DA NOME A FASE e `galho_por_natureza`. Os TRES sabores de
// fatura casam em `natureza === "fatura"`; o que separa UMA escrita de DUAS e
// `gravada`. Trocando um criterio pelo outro, a previsao DIGITADA que alguem
// ligou a fatura (HMO-305) passa a levar `POST /api/card-invoices/close`: a
// fatura do CARTAO e fechada porque a pessoa pagou a previsao da CONTA
// CORRENTE. O `close` responde 201, nenhum erro aparece em lugar nenhum, e o
// unico sintoma e uma conta a pagar que ninguem pediu no mes seguinte.
//
// E ELE SO MORRE POR UM CASO SOBRE O SABOR 3. Na fatura ABERTA as duas
// expressoes dao a MESMA resposta (`!gravada` e `natureza === "fatura"` sao as
// duas verdadeiras), entao uma suite que so olhe a fatura aberta passa VERDE
// com a troca feita -- e a fase 14 herdaria o defeito.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria; o `.ts` mutado e escrito numa COPIA da arvore,
// em diretorio temporario, e e de la que o `tsc` compila.
// `lib/pagamento-da-fatura.ts` nao e tocado em momento nenhum.
//
// O jeito usual -- mutar o arquivo, rodar, restaurar no `finally` -- deixa a
// fonte mutada no disco quando o processo morre no meio, e o placar seguinte
// vira ficcao. Pior neste repositorio: restaurar com `git checkout --` apaga
// edicao nao-commitada do mesmo arquivo, sem aviso.
//
// COMO RODAR
//   npm run mutantes:pagamento-da-fatura

import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  cpSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const FONTE = "lib/pagamento-da-fatura.ts";

// A COPIA PRECISA DO FECHAMENTO INTEIRO DE IMPORTS.
//
// O mutador copia SO o que esta nesta lista. Falta qualquer um e o `tsc` para
// em TS2307 ("Cannot find module '@/lib/...'") antes de uma assercao rodar: o
// placar sairia perfeito e o controle positivo reprovaria. E a mesma lista do
// `include` do tsconfig, mais o que a suite importa.
const ACOMPANHAM = [
  "lib/agenda-do-cartao.ts",
  "lib/card-invoice.ts",
  "lib/chave-da-fatura.ts",
  "lib/transferencia.ts",
  "lib/lancamento.ts",
  "scripts/tsconfig.pagamento-da-fatura-test.json",
  "scripts/resolve-aliases.mjs",
  "scripts/test-pagamento-da-fatura.mjs",
];

// O `tsc` DO PROJETO, POR CAMINHO ABSOLUTO.
//
// `npx tsc` nao serve: a arvore mutada e um diretorio temporario SEM
// node_modules, e o npx cairia no `tsc` do sistema (o pacote Debian
// `node-typescript`), que responde "This is not the tsc command you are looking
// for" e sai com erro. O sintoma e brutal -- TODO mutante "morre no tsc" e o
// placar sai perfeito sem uma assercao ter rodado.
const TSC = join(process.cwd(), "node_modules/.bin/tsc");

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  {
    nome: "galho_por_natureza",
    porque:
      "O MUTANTE OBRIGATORIO DA FASE: o galho do `close` passa a olhar `natureza` em vez de `gravada`, e a previsao DIGITADA ligada ao elo (HMO-305) fecha a fatura do CARTAO quando a pessoa pagou a previsao da CONTA CORRENTE -- 201, sem erro nenhum, com uma conta a pagar nova no mes seguinte. So morre por um caso sobre o SABOR 3: na fatura aberta as duas expressoes coincidem",
    de: "  const precisaDeClose = ehFaturaDeCartao && !linha.gravada;",
    para: '  const precisaDeClose = ehFaturaDeCartao && linha.natureza === "fatura";',
  },
  {
    nome: "galho_invertido",
    porque:
      "o `close` troca de lado: a fatura ABERTA vai direto ao `/pay` com `id: null` (404, 'o app nao conseguiu') e as duas gravadas ganham um `close` que cria fatura em dobro",
    de: "  const precisaDeClose = ehFaturaDeCartao && !linha.gravada;",
    para: "  const precisaDeClose = ehFaturaDeCartao && linha.gravada;",
  },
  {
    nome: "conta_pagadora_por_gravada",
    porque:
      "a pergunta 'de qual conta o dinheiro saiu?' passa a valer para TODA linha gravada: o dialogo da fatura abre para a conta de luz, e a fatura ABERTA (que nao e gravada) deixa de pedir a conta e cai no 400 do `/pay`",
    de: '  const ehFaturaDeCartao = linha.natureza === "fatura";',
    para: "  const ehFaturaDeCartao = linha.gravada;",
  },
  {
    nome: "close_com_o_dia_no_mes",
    porque:
      "o `close` recebe 'AAAA-MM-01' onde espera 'AAAA-MM': no melhor caso 400, no pior uma chave canonica com o mes errado -- e chave errada e fatura contada duas vezes, sem erro em lugar nenhum",
    de: "const mesDoClose = (mes: string): string => mes.slice(0, 7);",
    para: "const mesDoClose = (mes: string): string => mes;",
  },
  {
    nome: "close_so_com_o_ano",
    porque:
      "o mes do `close` vira '2026': a fatura fechada nasceria em outro mes (ou a rota recusa), e o pagamento da fatura de outubro apareceria em janeiro",
    de: "const mesDoClose = (mes: string): string => mes.slice(0, 7);",
    para: "const mesDoClose = (mes: string): string => mes.slice(0, 4);",
  },
  {
    nome: "fixa_antes_de_fatura",
    porque:
      "a ordem de avaliacao inverte: a fatura que um dia nascer de regra recorrente vira 'fixa', perde a conta pagadora e o `/pay` recusa com 400 -- o mesmo defeito que `linhasDaTela` ja documenta",
    de: "    natureza: daChave\n      ? \"fatura\"\n      : typeof linha.recurring_rule_id === \"string\" && linha.recurring_rule_id\n        ? \"fixa\"\n        : \"despesa\",",
    para: "    natureza:\n      typeof linha.recurring_rule_id === \"string\" && linha.recurring_rule_id\n        ? \"fixa\"\n        : daChave\n          ? \"fatura\"\n          : \"despesa\",",
  },
  {
    nome: "gravada_por_presenca",
    porque:
      "`id: \"\"` passa a contar como linha gravada: a fatura aberta de um mock (ou de uma leitura que trouxe a coluna vazia) deixa de levar `close` e a baixa monta `/api/scheduled-transactions//pay`",
    de: '  const gravada = typeof linha.id === "string" && linha.id !== "";',
    para: "  const gravada = linha.id != null;",
  },
  {
    nome: "recusa_sem_conta_pagadora_apagada",
    porque:
      "a sequencia deixa de recusar sem conta pagadora: a fatura ABERTA e FECHADA pelo `close` e so depois o `/pay` responde 400 -- fica uma fatura fechada e NAO paga para tras, e fechar nao e reversivel pela tela",
    de: "  if (decisao.precisaDeContaPagadora && !contaPagadoraId) {",
    para: "  if (false) {",
  },
  {
    nome: "nove_quatro_tratado_como_erro",
    porque:
      "o 409 'esta fatura ja foi fechada' volta a ser erro: quem teve a fatura fechada por outra aba no meio recebe um toast de falha e e mandado recarregar para fazer o que ja esta feito",
    de: "      resposta.status === 409 &&",
    para: "      false &&",
  },
  {
    nome: "nove_quatro_sem_checar_o_id",
    porque:
      "TODO 409 do `close` passa a ser tratado como 'ja fechada': 'esta fatura nao tem lancamentos' e 'nao tem valor a pagar' viram um `/pay` com id nulo, e a mensagem que a pessoa le deixa de ser a que a rota deu",
    de: "      resposta.status === 409 &&\n      texto(dados.scheduled_transaction_id)",
    para: "      resposta.status === 409",
  },
  {
    nome: "sem_guard_de_id",
    porque:
      "a sequencia segue sem id: `POST /api/scheduled-transactions/null/pay` responde 404 -- ou, pior, 400 falando de outra coisa -- e quem clicou le 'o app nao conseguiu'",
    de: "  if (!idDaLinha) {",
    para: "  if (false) {",
  },
  {
    nome: "pay_sem_a_conta_pagadora",
    porque:
      "o corpo do `/pay` perde `payment_account_id`: a rota recusa com 400 em TODA fatura, e a tela que acabou de perguntar de qual conta o dinheiro saiu nao manda a resposta",
    de: "        ...(contaPagadoraId ? { payment_account_id: contaPagadoraId } : {}),",
    para: "        ...{},",
  },
  {
    nome: "frase_do_patrimonio_condicional",
    porque:
      "a frase do patrimonio passa a depender de `is_transfer` vir na resposta: no dia em que a rota parar de mandar o campo, quem pagou R$ 1.000 ve o patrimonio parado sem explicacao, conclui que a baixa nao registrou e paga de novo",
    de: "    descricao: FRASE_DO_PATRIMONIO,",
    para: '    descricao: dados.is_transfer ? FRASE_DO_PATRIMONIO : "",',
  },
  {
    nome: "erro_do_pay_engolido",
    porque:
      "o 400 do `/pay` vira sucesso: a tela mostra 'Fatura paga', fecha o dialogo e recarrega -- com a fatura ainda pendente e nenhum dinheiro lancado",
    de: "  if (!resposta.ok) {\n    return {\n      ok: false,\n      etapa: \"pay\",",
    para: "  if (false) {\n    return {\n      ok: false,\n      etapa: \"pay\",",
  },
  {
    nome: "cartao_pode_pagar_cartao",
    porque:
      "o seletor passa a oferecer cartao de credito: escolher o PROPRIO cartao faria as duas pernas se anularem e a fatura ficaria paga sem dinheiro nenhum ter saido -- o bug do HMO-149 com outra roupa",
    de: "  return contas.filter((conta) => conta.account_type !== TIPO_CARTAO);",
    para: "  return contas.filter(() => true);",
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
  // medido nada.
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
