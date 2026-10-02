#!/usr/bin/env node
// Mutantes de tipo e sinal no lancamento -- HMO-181.
//
//   lib/movimentacoes.ts                              a regra pura
//   app/api/personal-finance/transactions/route.ts    quem a usa e grava
//
// POR QUE ISTO EXISTE
// -------------------
// O defeito que a issue descreve foi achado em producao com a rota verde: um
// POST de `-12.34` -- o sinal CERTO pela convencao do banco -- gravava `+12.34`
// e sem `transaction_type` nenhum. A tela disfarcava os dois (a lista
// classifica por `category.is_expense` e o resumo usa `Math.abs`), entao nao
// havia nada para ninguem procurar. Uma suite nova sobre esse trecho tem de
// provar que SABE reprovar, e nao so que ficou verde uma vez.
//
// OS DOIS MUTANTES QUE A ISSUE PEDE NOMINALMENTE sao `sinal_recebido_invertido`
// (valor negativo virando positivo) e `insert_sem_tipo` (a coluna sumindo do
// INSERT). Os dois sao de familias diferentes e por isso precisam de provas
// diferentes: o primeiro e regra, morre numa assercao sobre a funcao; o segundo
// e OMISSAO -- uma linha que desaparece num refactor -- e nenhuma assercao
// sobre a funcao pura o alcanca. E por isso que a suite le o codigo da rota.
//
// Nenhum destes mutantes quebra nada em runtime. O POST continua respondendo
// 201, a tela continua mostrando o lancamento com o rotulo certo, e a linha
// gravada e que fica errada -- ou invisivel para as tres views da 008.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria; o arquivo mutado e escrito numa COPIA da
// arvore, em diretorio temporario. Nenhum arquivo de `lib/` ou de `app/` e
// tocado. O jeito usual -- mutar, rodar, restaurar no `finally` -- deixa a
// fonte mutada no disco quando o processo morre no meio, e neste repositorio
// restaurar com `git checkout --` ainda apaga edicao nao-commitada do mesmo
// arquivo, sem aviso.
//
// COMO RODAR
//   npm run mutantes:tipo-e-sinal

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

const REGRA = "lib/movimentacoes.ts";
const ROTA = "app/api/personal-finance/transactions/route.ts";
const EDICAO = "app/api/personal-finance/transactions/[id]/route.ts";

// A suite roda com o cwd na raiz temporaria, entao o arquivo de teste precisa
// estar la. A ROTA nao entra aqui porque ela ja e uma das duas fontes mutaveis
// e e escrita na copia em toda rodada -- se nao fosse, os quatro casos que leem
// o codigo da rota estourariam em TODO mutante, o placar sairia perfeito, e
// quem denunciaria isso seria o controle positivo, nao o placar.
const ACOMPANHAM = ["scripts/test-movimentacoes.mjs"];

// O `tsc` DO PROJETO, POR CAMINHO ABSOLUTO. `npx tsc` cairia no pacote Debian
// `node-typescript` (a arvore mutada nao tem node_modules), que responde "This
// is not the tsc command you are looking for" -- e ai TODO mutante "morreria no
// tsc" com o placar perfeito e zero assercao executada.
const TSC = join(process.cwd(), "node_modules/.bin/tsc");

const ARGS_TSC = [
  "lib/movimentacoes.ts",
  "--outDir",
  ".tmp-movimentacoes",
  "--module",
  "es2020",
  "--target",
  "es2020",
  "--moduleResolution",
  "node",
  "--skipLibCheck",
];

const originais = {
  [REGRA]: readFileSync(REGRA, "utf8"),
  [ROTA]: readFileSync(ROTA, "utf8"),
  [EDICAO]: readFileSync(EDICAO, "utf8"),
};

const MUTANTES = [
  // -------------------------------------------------------------------------
  // A REGRA PURA
  // -------------------------------------------------------------------------
  {
    nome: "sinal_recebido_invertido",
    fonte: REGRA,
    porque:
      "O PRIMEIRO CONTROLE NEGATIVO DA ISSUE, e o defeito que estava em producao: o valor deixa de ser normalizado e o sinal recebido passa a mandar. Quem respeita a convencao do banco e manda `-12.34` tem `+12.34` gravado -- a despesa vira receita, soma no realizado do mes em vez de abater, e a tela nao mostra nada de errado porque ela imprime o modulo",
    de: "  const absoluto = Math.abs(recebido.amount);",
    para: "  const absoluto = recebido.amount;",
  },
  {
    nome: "despesa_gravada_positiva",
    fonte: REGRA,
    porque:
      "toda despesa passa a ser gravada POSITIVA, venha com o sinal que vier: `monthly_cash_flow` soma com ABS() e filtra por tipo, entao o fluxo de caixa continua certo -- quem quebra e o SALDO DA CONTA, que soma `amount` cru e passa a subir a cada gasto",
    de: '    amount: tipo === "income" ? absoluto : -absoluto,',
    para: "    amount: absoluto,",
  },
  {
    nome: "tipo_declarado_ignorado",
    fonte: REGRA,
    porque:
      "o `transaction_type` do corpo vira enfeite: o cliente declara 'income' num estorno lancado em categoria de despesa, recebe 201, e o banco grava 'expense' com o sinal trocado. O cliente diz uma coisa e o banco grava outra -- a familia inteira de defeitos desta issue",
    de: '    transaction_type: typeof declarado === "string" ? declarado : null,',
    para: "    transaction_type: null,",
  },
  {
    nome: "categoria_ignorada_na_derivacao",
    fonte: REGRA,
    porque:
      "sem tipo declarado, a derivacao passa a ser so pelo sinal e a categoria some da conta: a tela manda o valor sem sinal (ela sempre mandou), entao TODA despesa lancada pela tela passa a ser gravada como receita positiva",
    de: "    category:\n      typeof recebido.categoriaEhDespesa === \"boolean\"\n        ? { is_expense: recebido.categoriaEhDespesa }\n        : null,",
    para: "    category: null,",
  },
  {
    nome: "transferencia_aceita",
    fonte: REGRA,
    porque:
      "a rota passa a aceitar `transaction_type: 'transfer'` e grava UMA perna: dinheiro sai de uma conta sem entrar em nenhuma, sem perna irma para o elo `counterpart_transaction_id` apontar, e `resumoDoPeriodo` conta meia transferencia -- o saldo geral fica errado e o erro aparece como dinheiro sumido",
    de: '    if (declarado === "transfer") {',
    para: "    if (false) {",
  },
  {
    nome: "tipo_invalido_vira_palpite",
    fonte: REGRA,
    porque:
      "`transaction_type: 'despesa'` (o erro provavel, em portugues) deixa de ser 400 e passa a cair no palpite por categoria: o cliente declarou algo que o servidor nao entendeu e recebeu 201 mesmo assim. Ignorar em silencio o que o cliente declarou e exatamente o que esta funcao existe para fechar",
    de: '    if (declarado !== "income" && declarado !== "expense") {',
    para: "    if (false) {",
  },
  {
    nome: "campo_vazio_vira_erro",
    fonte: REGRA,
    porque:
      "o outro lado do mesmo corte: string vazia e null passam a contar como 'declarou errado' em vez de 'nao declarou'. A tela manda campo vazio o tempo todo, entao lancar pela tela passa a devolver 400 em todo lancamento -- uma trava que impede o uso normal, nascida de uma guarda apertada demais",
    de: '  if (declarado !== undefined && declarado !== null && declarado !== "") {',
    para: "  if (declarado !== undefined) {",
  },

  // -------------------------------------------------------------------------
  // A ROTA
  // -------------------------------------------------------------------------
  {
    nome: "insert_sem_tipo",
    fonte: ROTA,
    porque:
      "O SEGUNDO CONTROLE NEGATIVO DA ISSUE, e o estado em que a rota estava: a linha nasce com `transaction_type` NULO. As tres views da 008 filtram `transaction_type IN ('expense','income')`, entao o lancamento aparece na lista e DESAPARECE do fluxo de caixa, dos relatorios e do orcamento -- sem erro, sem aviso, e com a lista provando que ele existe",
    de: "        transaction_type: tipo,\n",
    para: "",
  },
  {
    nome: "rota_ignora_a_recusa",
    fonte: ROTA,
    porque:
      "a recusa da regra vira enfeite: `normalizarLancamento` devolve `ok: false` e a rota segue em frente mesmo assim. O 400 que o cliente deveria receber nunca sai, e o que e gravado depende do que o TypeScript deixou indefinido",
    de: "    if (!normalizado.ok) {\n      return NextResponse.json({ error: normalizado.erro }, { status: 400 });\n    }",
    para: "    // mutante: a recusa nao vira resposta",
  },
  {
    nome: "grupo_por_categoria_em_vez_do_tipo",
    fonte: ROTA,
    porque:
      "O TERCEIRO DEFEITO DA ISSUE, na forma que um leitor bem-intencionado reintroduz: a guarda do vinculo de grupo volta a sair da categoria em vez do tipo gravado. Um estorno declarado 'income' numa categoria de despesa passa a criar linha em `group_transactions` e rateio para todo mundo -- os membros ficam devendo a parte de uma RECEITA",
    de: '    const isExpense = tipo === "expense";',
    para: "    const isExpense = category?.is_expense === true;",
  },

  // -------------------------------------------------------------------------
  // A EDICAO
  // -------------------------------------------------------------------------
  {
    nome: "edicao_sem_tipo",
    fonte: EDICAO,
    porque:
      "o PATCH volta a nao gravar `transaction_type`: a linha ANTIGA, criada sem a coluna, continua invisivel nas tres views da 008 exatamente quando o usuario acabou de mexer nela -- ele olha o lancamento, corrige o valor, e o fluxo de caixa segue sem ele",
    de: "      updateData.transaction_type = normalizado.tipo;\n",
    para: "",
  },
  {
    nome: "edicao_desfaz_o_conserto",
    fonte: EDICAO,
    porque:
      "o PATCH volta a decidir o sinal por conta propria, com o defeito do POST inteiro: a linha nasce certa e vira RECEITA na primeira edicao. E o pior modo de falha desta issue, porque o estrago aparece depois e longe da causa -- a sonda que provou o POST ja passou",
    de: "      if (amount !== undefined) updateData.amount = normalizado.amount;",
    para: "      if (amount !== undefined)\n        updateData.amount =\n          category?.is_expense && amount > 0 ? -Math.abs(amount) : Math.abs(amount);",
  },
  {
    nome: "edicao_reclassifica_a_transferencia",
    fonte: EDICAO,
    porque:
      "a perna de transferencia passa pela regra comum: ela e reclassificada como despesa ou receita e perde o par (015). Os mesmos R$ 1.000 passam a existir duas vezes na soma do mes, e o saldo geral sobe sem ninguem ter recebido nada",
    de: '    if (existingTransaction.transaction_type === "transfer") {',
    para: "    if (false) {",
  },
];

const dir = mkdtempSync(join(tmpdir(), "mutantes-tipo-e-sinal-"));

/** Compila as fontes numa copia da arvore e roda a suite contra ela. */
function rodar(nome, fontes) {
  const raiz = join(dir, nome);

  for (const [caminho, conteudo] of Object.entries(fontes)) {
    mkdirSync(join(raiz, dirname(caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  for (const arquivo of ACOMPANHAM) {
    mkdirSync(join(raiz, dirname(arquivo)), { recursive: true });
    cpSync(arquivo, join(raiz, arquivo));
  }

  try {
    execFileSync(TSC, ARGS_TSC, {
      cwd: raiz,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    // O `tsc` reprovando TAMBEM mata o mutante, mas tem de ser DISTINGUIVEL do
    // teste reprovando: um mutante que nunca rodou nao prova nada sobre as
    // assercoes. Vale em dobro aqui, porque a rota NAO passa pelo tsc nesta
    // copia -- um mutante de rota que morresse "no tsc" seria sinal de que a
    // copia esta errada, nao de que a suite o pegou.
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
    execFileSync("node", ["--test", "scripts/test-movimentacoes.mjs"], {
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
  const controle = rodar("controle", originais);
  if (!controle.verde) {
    console.error(
      `CONTROLE FALHOU: as fontes intactas nao passam na suite (${controle.como}) -> ${controle.saida}`
    );
    console.error("A copia da arvore esta errada. O placar abaixo nao vale.");
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  }
  console.log("controle: as fontes intactas passam na suite  OK\n");

  let mortos = 0;
  let porTeste = 0;

  for (const m of MUTANTES) {
    const original = originais[m.fonte];

    // MUTANTE QUE NAO SE APLICA E O PIOR RESULTADO POSSIVEL: ele contaria como
    // "morreu" sem nunca ter existido.
    const ocorrencias = original.split(m.de).length - 1;
    if (ocorrencias === 0) {
      console.error(
        `NAO APLICOU: ${m.nome} -- o trecho procurado nao esta em ${m.fonte}`
      );
      falhou = true;
      continue;
    }
    if (ocorrencias > 1) {
      console.error(
        `AMBIGUO: ${m.nome} -- o trecho aparece ${ocorrencias}x em ${m.fonte}; a mutacao atingiria so a primeira`
      );
      falhou = true;
      continue;
    }

    const r = rodar(m.nome, {
      ...originais,
      [m.fonte]: original.replace(m.de, m.para),
    });

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
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(falhou ? 1 : 0);
