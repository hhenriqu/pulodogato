#!/usr/bin/env node
// Mutantes da sintese da fatura ABERTA (lib/agenda-do-cartao.ts) -- HMO-227.
//
// POR QUE ISTO EXISTE
// -------------------
// `test:fatura-prevista` passa com 27 assercoes verdes, e isso sozinho nao diz
// nada: um teste que nunca reprovou nao esta medindo o que a justificativa dele
// afirma. Cada mutante abaixo quebra UMA decisao de `sintetizarFaturasAbertas`
// (ou da merge), e a suite tem de ficar vermelha em todos.
//
// O MUTANTE QUE DA NOME A ISSUE e `sem_dedup`: ele apaga a de-duplicacao pela
// chave canonica, e com isso a fatura ja fechada passa a aparecer DUAS VEZES em
// Contas a Pagar -- a linha gravada e a sintetizada, com o mesmo valor e o
// mesmo vencimento, e o cabecalho cobrando o dobro. Nada nisso da erro: as duas
// linhas sao plausiveis uma ao lado da outra, e quem olha conclui que parcelou.
//
// Nenhum destes mutantes quebra nada em runtime. Todos produzem uma tela de
// aparencia normal, com dinheiro errado dentro.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria; o `.ts` mutado e escrito numa COPIA da arvore,
// em diretorio temporario, e e de la que o `tsc` compila.
// `lib/agenda-do-cartao.ts` nao e tocado em momento nenhum.
//
// O jeito usual -- mutar o arquivo, rodar, restaurar no `finally` -- deixa a
// fonte mutada no disco quando o processo morre no meio, e o placar seguinte
// vira ficcao. Pior neste repositorio: restaurar com `git checkout --` apaga
// edicao nao-commitada do mesmo arquivo, sem aviso.
//
// COMO RODAR
//   npm run mutantes:fatura-prevista

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

const FONTE = "lib/agenda-do-cartao.ts";

// A COPIA PRECISA DE MAIS QUE A FONTE MUTADA.
//
// Tres casos da suite leem o CODIGO das duas rotas e do servico compartilhado
// (`readFileSync`), porque o defeito que eles pegam e de omissao -- sintetizar
// na lista e esquecer o resumo. Sem estes arquivos na copia, aqueles tres casos
// estouram em TODO mutante: o placar sairia perfeito e o controle positivo
// reprovaria. Foi o controle positivo que mostrou isso.
const ACOMPANHAM = [
  "lib/card-invoice.ts",
  "lib/transferencia.ts",
  // HMO-172: `transferencia.ts` passou a importar `@/lib/lancamento` (os tipos da
  // recorrencia). Na arvore COPIADA o modulo nao existiria, e o tsc para em
  // TS2307 -- "Cannot find module '@/lib/lancamento'" -- antes de qualquer
  // assercao, com o placar saindo perfeito e o controle positivo reprovando.
  //
  // Quem pegou isso foi o controle positivo, no CI: `test:fatura-prevista` passa
  // na arvore DE VERDADE, porque la o arquivo esta no disco e o tsc o resolve
  // pelo `paths`. So a copia expoe a falta. Toda dependencia nova de um arquivo
  // desta lista precisa entrar aqui tambem.
  "lib/lancamento.ts",
  "lib/previsto-x-realizado.ts",
  "lib/services/fatura-prevista.ts",
  "app/api/scheduled-transactions/route.ts",
  "app/api/scheduled-transactions/summary/route.ts",
  "scripts/tsconfig.fatura-prevista-test.json",
  "scripts/resolve-aliases.mjs",
  "scripts/test-fatura-prevista.mjs",
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
    nome: "sem_dedup",
    porque:
      "O CONTROLE NEGATIVO DA ISSUE: a fatura ja fechada volta a ser sintetizada, e a mesma fatura aparece DUAS vezes em Contas a Pagar -- mesmo valor, mesmo vencimento -- com o cabecalho cobrando o dobro",
    de: "    if (persistidas.has(chave)) continue;",
    para: "    if (false) continue;",
  },
  {
    nome: "dedup_invertida",
    porque:
      "a de-duplicacao passa a sintetizar SO o que ja esta gravado: a fatura aberta -- a unica que a issue pediu -- desaparece, e a fechada sai em dobro",
    de: "    if (persistidas.has(chave)) continue;",
    para: "    if (!persistidas.has(chave)) continue;",
  },
  {
    nome: "chave_com_argumentos_trocados",
    porque:
      "a chave canonica nasce como `fatura:<uuid>:<mes>`: a de-duplicacao nunca casa (fatura em dobro), o filtro da HMO-209 some com a linha e a baixa deixa de saber que pagar a fatura e transferencia -- tres quebras, zero erro",
    de: "    const chave = chaveFatura(mes, linha.account_id);",
    para: "    const chave = chaveFatura(linha.account_id, mes);",
  },
  {
    nome: "sem_vencimento_desaparece_calada",
    porque:
      "o cartao sem `due_day` deixa de ser avisado: a fatura nao aparece em Contas a Pagar e nada na tela diz por que -- o defeito da issue de volta, agora com o app TENDO o dado para avisar",
    de: "      semVencimento.push({",
    para: "      if (false) semVencimento.push({",
  },
  {
    nome: "vencimento_inventado",
    porque:
      "a fatura sem `due_day` passa a sair com uma data que o banco nao calculou, e a pessoa pagaria o cartao no dia errado por causa de um chute do app (este morre no `tsc`: e a tipagem que impede a data inventada, e isso e o resultado certo)",
    de: "    if (!linha.invoice_due_date) {",
    para: "    if (!linha.invoice_due_date && false) {",
  },
  {
    nome: "janela_ignorada",
    porque:
      "a fatura entra na agenda fora da janela que a tela pediu: o cabecalho (que soma a janela) discorda das linhas logo abaixo dele",
    de: "    if (vencimento < de || vencimento > ate) continue;",
    para: "    if (false) continue;",
  },
  {
    nome: "janela_so_com_limite_de_cima",
    porque:
      "faturas de meses ja passados voltam para a agenda, todas marcadas como vencidas: a tela abre acusando atraso em faturas que a pessoa pagou meses atras",
    de: "    if (vencimento < de || vencimento > ate) continue;",
    para: "    if (vencimento > ate) continue;",
  },
  {
    nome: "fatura_zerada_entra",
    porque:
      "o cartao que a pessoa nao usou no mes ganha uma conta a pagar de R$ 0,00 na agenda -- com botao de pagar, e o `CHECK (amount > 0)` do 005 recusando a linha no dia do clique",
    de: "    if (valor <= 0) continue;",
    para: "    if (valor < 0) continue;",
  },
  {
    nome: "sem_arredondar_centavos",
    porque:
      "o resto de ponto flutuante (0,1 + 0,2 - 0,3 = 5.55e-17) passa a peneira do zero e vira uma fatura de R$ 0,00 na agenda",
    de: "    const valor = Number(total.toFixed(2));",
    para: "    const valor = total;",
  },
  {
    nome: "numeric_como_string",
    porque:
      "`invoice_amount` chega como string pelo PostgREST em alguns caminhos; sem o `Number` a soma concatena e a fatura sai cem vezes maior, ou a linha e descartada inteira",
    de: "    const valor = Number(linha.invoice_amount);",
    para: "    const valor = linha.invoice_amount as number;",
  },
  {
    nome: "vencida_nao_marcada",
    porque:
      "a fatura atrasada entra como se estivesse em dia: ela cai em 'Próximos 7 dias' com '-3 dia(s)' no badge, e a secao 'Vencidas' diz 'Nada em atraso.' com a fatura vencida na tela",
    de: '      effective_status: vencimento < hoje ? "overdue" : "pending",',
    para: '      effective_status: "pending",',
  },
  {
    nome: "dias_com_sinal_trocado",
    porque:
      "`days_until_due` sai com o sinal invertido: a fatura que venceu ha 3 dias aparece como 'em 3 dia(s)', e a que vence em 3 dias como atrasada",
    de: "    (Date.parse(`${dueDate}T00:00:00Z`) - Date.parse(`${hoje}T00:00:00Z`)) /",
    para: "    (Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) /",
  },
  {
    nome: "fatura_vira_receita",
    porque:
      "a fatura do cartao entra como dinheiro ENTRANDO: ela soma em 'Total a receber' e o 'a pagar' do mes fica menor pelo valor da fatura -- o numero que parece certo (este morre no `tsc`: `direction` e o literal 'expense' no tipo, e e isso que impede a troca)",
    de: '      direction: "expense",',
    para: '      direction: "income",',
  },
  {
    nome: "descricao_sem_nome_do_cartao",
    porque:
      '"Fatura undefined 10/2026" na agenda e no dialogo de pagamento: o rotulo quebrado e justamente o que faz a pessoa desconfiar do valor ao lado dele',
    de: '  return `Fatura ${nome?.trim() || "do cartão"} ${mesNum}/${ano}`;',
    para: "  return `Fatura ${nome} ${mesNum}/${ano}`;",
  },
  {
    nome: "merge_descarta_a_sintetizada",
    porque:
      "a fatura aberta e calculada e jogada fora na juncao: a tela volta ao estado da issue, e as duas rotas continuam chamando a funcao certa",
    de: "  const juntas: (T | FaturaPrevista)[] = [...linhas, ...previstas];",
    para: "  const juntas: (T | FaturaPrevista)[] = [...linhas];",
  },
  {
    nome: "merge_sem_ordenar",
    porque:
      "a fatura entra no fim da lista em vez do lugar dela: dentro de cada secao a ordem e a da lista, e a fatura de dezembro aparece no meio das contas de outubro",
    de: "  juntas.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));",
    para: "  // mutante: sem ordenar",
  },
];

const dir = mkdtempSync(join(tmpdir(), "mutantes-fatura-prevista-"));

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
    execFileSync(TSC, ["-p", "scripts/tsconfig.fatura-prevista-test.json"], {
      cwd: raiz,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    execFileSync(
      "node",
      ["scripts/resolve-aliases.mjs", ".tmp-fatura-prevista", "lib"],
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
    execFileSync("node", ["--test", "scripts/test-fatura-prevista.mjs"], {
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
