#!/usr/bin/env node
// Mutantes de lib/telas-de-movimentacao.ts -- HMO-246.
//
// POR QUE ISTO EXISTE
// -------------------
// `npm run test:telas-de-movimentacao` passa com 33 blocos verdes. Num modulo
// que soma errado, varias dessas assercoes continuam verdes por acaso: o
// exemplo da issue tem UMA conta no mes, e contas erradas devolvem o numero
// certo para uma linha so. Cada mutante abaixo desfaz UMA decisao do modulo; o
// teste tem que ficar vermelho em todos.
//
// OS MUTANTES QUE IMPORTAM (um por armadilha do cabecalho da lib)
// ---------------------------------------------------------------
//   `sem_abs`             -- previsto (+159,90) e realizado (-159,90) se
//                            CANCELAM e a tela de Despesas fecha o mes em
//                            R$ 0,00 com as duas despesas na lista ao lado.
//   `paga_entra`          -- a conta prevista com baixa conta junto com a
//                            transacao que ela gerou: R$ 319,80 de R$ 159,90.
//   `perna_de_entrada_entra` -- as duas pernas do Pix contam, e R$ 1.000 viram
//                            R$ 2.000 numa lista que mostra as duas.
//   `tipo_pelo_sinal`     -- a perna de saida da transferencia entra na tela de
//                            Despesas: todo Pix entre contas proprias passa a
//                            ser gasto do mes.
//   `previsto_sem_direction` -- receita prevista vira conta a pagar (a familia
//                            da 027).
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao vive em memoria e e compilada de uma ARVORE TEMPORARIA. Mutar,
// rodar e restaurar no `finally` deixa a fonte mutada no disco quando o
// processo morre no meio -- e um `trap` que restaura por cima apaga trabalho
// nao salvo.
//
// OS IMPORTS DE @/ SAO O QUE COMPLICA O BUILD
// -------------------------------------------
// Este modulo importa `@/lib/movimentacoes` e `@/lib/destino-do-lancamento`.
// Compilar so o arquivo mutado com `tsc arquivo.ts` nao resolve `@/` e morre em
// erro de compilacao -- e um mutante que nao COMPILA "morre" por motivo errado,
// o que faz o placar mentir a favor. Por isso o runner monta a arvore
// temporaria com as copias das duas dependencias ao lado, escreve um tsconfig
// com `baseUrl`/`paths` e roda o mesmo resolve-aliases.mjs do npm script.
//
// COMO RODAR
//   npm run mutantes:telas-de-movimentacao

import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  copyFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";

const FONTE = "lib/telas-de-movimentacao.ts";
const DEPENDENCIAS = ["lib/movimentacoes.ts", "lib/destino-do-lancamento.ts"];
const SAIDA = ".tmp-telas-de-movimentacao";
const TESTE = "scripts/test-telas-de-movimentacao.mjs";

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  // --- armadilha 1: os dois lados tem sinal oposto -------------------------
  {
    nome: "sem_abs",
    porque:
      "previsto (+159,90) e realizado (-159,90) se cancelam e a tela de " +
      "Despesas fecha o mes em ZERO, com as duas despesas visiveis na lista",
    de: "  const quantia = Number.isFinite(bruto) ? Math.abs(bruto) : 0;",
    para: "  const quantia = Number.isFinite(bruto) ? bruto : 0;",
  },
  {
    nome: "cotacao_zero_apaga",
    porque:
      "exchange_rate = 0 multiplica a linha por zero: um boleto de R$ 1.200 " +
      "vale R$ 0,00 no total e continua aparecendo na lista",
    de: "  const cotacao = Number.isFinite(taxa) && taxa > 0 ? taxa : 1;",
    para: "  const cotacao = Number.isFinite(taxa) ? taxa : 1;",
  },

  // --- armadilha 2: a mesma conta contada duas vezes -----------------------
  {
    nome: "paga_entra",
    porque:
      "a conta prevista com baixa entra junto com a transacao que ela gerou -- " +
      "a internet de R$ 159,90 vira R$ 319,80 no mes em que foi paga",
    de: "  if (STATUS_QUE_SAI_DO_PREVISTO.has(String(crua.status))) return null;",
    para: "  if (false) return null;",
  },
  {
    nome: "paga_entra_por_allowlist",
    porque:
      "a lista de status trocada pela de lib/previsto-x-realizado.ts, que " +
      "mantem `paid` DENTRO -- certa para 'o que o periodo prometia', e o " +
      "dobro aqui, onde previsto e realizado somam no mesmo total",
    de: '  "paid",\n  "skipped",\n  "cancelled",',
    para: '  "skipped",\n  "cancelled",',
  },

  // --- armadilha 3: a transferencia tem duas pernas ------------------------
  {
    nome: "perna_de_entrada_entra",
    porque:
      "as duas pernas do Pix contam: R$ 1.000 viram R$ 2.000, e a lista mostra " +
      "as duas linhas com a mesma descricao e a mesma data",
    de: '    if (tipo === "transfer" && ehPernaDeEntrada(crua)) continue;',
    para: "    if (false) continue;",
  },
  {
    nome: "entrada_so_pelo_elo",
    porque:
      "transferencia de antes do 015 (ou cujo par perdeu o elo por " +
      "ON DELETE SET NULL) volta a ser contada duas vezes -- e o valor dobrado " +
      "e plausivel",
    de: "  return Number(crua.amount) > 0;",
    para: "  return false;",
  },
  {
    nome: "entrada_so_pelo_sinal",
    porque:
      "o elo deixa de valer e sobra o sinal: num CAMBIO a perna de saida " +
      "(-1.000 BRL) e a de entrada (+180 USD) nao se anulam, e a tela passa a " +
      "somar as duas",
    de: "  if (texto(crua.counterpart_transaction_id)) return true;",
    para: "  if (false) return true;",
  },
  {
    nome: "entrada_pelo_elo_sem_texto",
    porque:
      'counterpart_transaction_id: "" tratado como elo tira a perna de SAIDA, ' +
      "e a transferencia desaparece da tela que existe para mostra-la",
    de: "  if (texto(crua.counterpart_transaction_id)) return true;",
    para: "  if (crua.counterpart_transaction_id !== undefined) return true;",
  },
  {
    nome: "de_duplica_todo_tipo",
    porque:
      "a regra da transferencia aplicada a TODAS as telas: toda receita " +
      "(amount positivo) desaparece da tela de Receitas",
    de: '    if (tipo === "transfer" && ehPernaDeEntrada(crua)) continue;',
    para: "    if (ehPernaDeEntrada(crua)) continue;",
  },

  // --- armadilha 4: o sinal nao pode ser o criterio de tipo ----------------
  {
    nome: "tipo_pelo_sinal",
    porque:
      "a perna de saida da transferencia (-200, categoria de despesa) entra na " +
      "tela de Despesas: todo Pix entre contas proprias vira gasto do mes",
    de: "    if (classificarMovimentacao(crua) !== tipo) continue;",
    para:
      '    if ((Number(crua.amount) < 0 ? "expense" : "income") !== tipo) continue;',
  },
  {
    nome: "tipo_nao_filtra",
    porque:
      "'o sinal ja foi normalizado, o tipo nao importa' -- as tres telas " +
      "passam a mostrar as mesmas linhas e cada total soma o mes inteiro",
    de: "    if (classificarMovimentacao(crua) !== tipo) continue;",
    para: "    if (false) continue;",
  },
  {
    nome: "previsto_nao_filtra",
    porque:
      "a conta prevista entra em qualquer tela: o salario previsto de R$ 7.000 " +
      "aparece como despesa prevista do mes",
    de: "    if (linha && linha.tipo === tipo) linhas.push(linha);",
    para: "    if (linha) linhas.push(linha);",
  },
  {
    nome: "previsto_sem_direction",
    porque:
      "toda conta prevista vira despesa: confirmar o recebimento de uma " +
      "receita prevista cobraria R$ 7.000 do mes (a familia da 027)",
    de: "  const tela = telaDoTipo(crua.direction);\n  if (!tela) return null;",
    para: '  const tela = telaDoTipo(crua.direction) ?? telaDoTipo("expense");\n  if (!tela) return null;',
  },

  // --- o vencido ------------------------------------------------------------
  {
    nome: "vencido_por_todo_previsto",
    porque:
      "o cartao Previsto passa a anunciar o periodo INTEIRO como atrasado: " +
      "R$ 500 'ja venceram' num mes em que venceram R$ 400",
    de: '    if (linha.situacao !== "overdue") continue;',
    para: "    if (false) continue;",
  },
  // --- o total e as contagens ---------------------------------------------
  {
    nome: "total_e_so_realizado",
    porque:
      "o 'Total' volta a ser o cartao de Financas Pessoais: a conta que vence " +
      "dia 15 nao entra em total nenhum do mes, que e o defeito da HMO-245",
    de: "    total: centavos(previsto + realizado),",
    para: "    total: centavos(realizado),",
  },
  {
    nome: "total_e_so_previsto",
    porque:
      "o 'Total' ignora o que ja aconteceu: no dia 30 do mes, com tudo pago, a " +
      "tela mostra Total R$ 0,00 e Realizado R$ 3.000",
    de: "    total: centavos(previsto + realizado),",
    para: "    total: centavos(previsto),",
  },
  {
    nome: "contagem_so_do_realizado",
    porque:
      "a contagem embaixo do Total ignora as previstas: 'Total R$ 3.090 · 2 " +
      "lançamento(s)' sobre uma lista de tres",
    de: "    quantidade: quantidadePrevista + quantidadeRealizada,",
    para: "    quantidade: quantidadeRealizada,",
  },

  // --- as duas secoes e a ordem -------------------------------------------
  {
    nome: "previstas_ao_contrario",
    porque:
      "a conta que vence dia 28 aparece acima da que vence dia 5 -- 'o que vem " +
      "agora' passa a mostrar o que vem por ultimo",
    de: "    previstas: previstas.sort((a, b) => a.data.localeCompare(b.data)),",
    para: "    previstas: previstas.sort((a, b) => b.data.localeCompare(a.data)),",
  },
  {
    nome: "realizadas_ao_contrario",
    porque:
      "o lancamento mais antigo do periodo aparece primeiro: quem acabou de " +
      "lancar nao encontra a propria linha",
    de: "    realizadas: realizadas.sort((a, b) => b.data.localeCompare(a.data)),",
    para: "    realizadas: realizadas.sort((a, b) => a.data.localeCompare(b.data)),",
  },
  {
    nome: "secoes_compartilham_array",
    porque:
      "as duas secoes passam a ordenar O MESMO array, em sentidos opostos: a " +
      "segunda desfaz a primeira e uma das duas listas sai ao contrario",
    de: "  const realizadas = linhas.filter((l) => l.origem === \"realizado\");",
    para: "  const realizadas = previstas;",
  },
  {
    nome: "ordem_por_date",
    porque:
      "`new Date('')` e NaN e um NaN no comparador EMBARALHA a lista inteira: " +
      "com uma linha sem data no meio, a de 20/10 cai abaixo da de 05/10",
    de: "  return linhas.sort((a, b) => b.data.localeCompare(a.data));",
    para:
      "  return linhas.sort(\n" +
      "    (a, b) => new Date(b.data).getTime() - new Date(a.data).getTime()\n" +
      "  );",
  },

  // --- o embed do PostgREST sobre a view ----------------------------------
  {
    nome: "embed_so_objeto",
    porque:
      "o embed sobre VIEW chega como ARRAY e a leitura da `undefined` em TODA " +
      "linha: a categoria e a conta somem da lista inteira, sem erro nenhum",
    de: "  if (Array.isArray(valor)) return valor[0] ?? null;",
    para: "  if (false) return valor[0] ?? null;",
  },

  // --- a chave da linha ---------------------------------------------------
  {
    nome: "chave_sem_fatura",
    porque:
      "a fatura aberta do cartao (id: null) perde a chave e sai do previsto -- " +
      "em muitos meses ela e a MAIOR despesa prevista do periodo",
    de: "  const chave = idGravado ?? texto(crua.notes);",
    para: "  const chave = idGravado;",
  },
  {
    nome: "gravada_sempre",
    porque:
      "a fatura sintetizada se declara gravada: a tela oferece acao sobre ela " +
      "e o id vira `/api/scheduled-transactions/fatura:.../pay`",
    de: "    gravada: idGravado !== null,",
    para: "    gravada: true,",
  },

  // --- rotulos que mudam o significado do numero --------------------------
  {
    nome: "moeda_sempre_rotulada",
    porque:
      "'R$ 1.000,00 · BRL' em toda linha: o rotulo que distingue a quantia " +
      "estrangeira deixa de distinguir nada",
    de: '  return nome && nome.toUpperCase() !== "BRL" ? nome.toUpperCase() : null;',
    para: "  return nome ? nome.toUpperCase() : null;",
  },
  {
    nome: "conta_inventada",
    porque:
      '"Sem conta" escrito igual a "Itaú" e um nome de conta inventado na ' +
      "linha de quem nunca escolheu conta nenhuma",
    de: "    conta: destino.faltaConta ? null : destino.texto,",
    para: "    conta: destino.texto,",
  },
];

// ---------------------------------------------------------------------------
// DOIS MUTANTES QUE FORAM REMOVIDOS, E O QUE ELES ENSINARAM
// ---------------------------------------------------------------------------
// Os dois SOBREVIVERAM na primeira rodada, e os dois sobreviveram com razao: o
// que eles apagavam era defesa morta. A conclusao foi apagar a defesa do
// modulo, nao escrever um teste capaz de "provar" codigo que nao faz nada.
//
//   `vencido_pega_realizado` apagava `if (linha.origem !== "previsto")` de
//   `previstoVencido`. `linhaRealizada` grava `situacao: null` em TODA linha
//   realizada, entao a linha realizada nunca passava do filtro de 'overdue' e a
//   primeira guarda nao decidia nada. O unico teste que a mataria teria de
//   FORJAR uma linha realizada com `situacao: "overdue"` -- um estado que o
//   modulo nao produz, e uma trava provada so por estado forjado por fora nao
//   prova nada. O invariante ("o realizado nasce sem situacao") passou a ter
//   assercao propria, que e onde a regra de fato se segura.
//
//   `secoes_ordenam_no_lugar` apagava o `[...previstas]` de `secoesDaTela`.
//   `filter` ja devolve array novo, entao a copia era copia de copia. O que
//   restou para medir e OUTRA coisa, e essa importa: `secoes_compartilham_array`
//   faz as duas secoes ordenarem o MESMO array em sentidos opostos.

const dir = mkdtempSync(join(tmpdir(), "mut246-"));
const dirLib = join(dir, "lib");
mkdirSync(dirLib, { recursive: true });
for (const dep of DEPENDENCIAS) copyFileSync(dep, join(dirLib, basename(dep)));

// O tsconfig temporario e a copia do scripts/tsconfig.telas-de-movimentacao-
// test.json apontada para a arvore mutada. `baseUrl` no dir temporario e o que
// faz `@/lib/movimentacoes` achar a COPIA, e nao o arquivo do repo.
const tsconfig = join(dir, "tsconfig.json");
writeFileSync(
  tsconfig,
  JSON.stringify({
    compilerOptions: {
      outDir: resolve(SAIDA),
      rootDir: dirLib,
      module: "es2020",
      target: "es2020",
      moduleResolution: "node",
      skipLibCheck: true,
      baseUrl: dir,
      paths: { "@/*": ["./*"] },
    },
    include: [join(dirLib, "telas-de-movimentacao.ts")],
  })
);

let falhas = 0;

function compilaERoda(fonteTs) {
  writeFileSync(join(dirLib, "telas-de-movimentacao.ts"), fonteTs);
  rmSync(SAIDA, { recursive: true, force: true });
  execFileSync("npx", ["tsc", "-p", tsconfig], { stdio: "pipe" });
  // O tsc resolve `@/` mas nao o reescreve no JS emitido -- o mesmo passo do
  // npm script, sem o qual o node morre em ERR_MODULE_NOT_FOUND e TODO mutante
  // "morre" por erro de import.
  execFileSync("node", ["scripts/resolve-aliases.mjs", SAIDA, "lib"], {
    stdio: "pipe",
  });
  // O fuso e o mesmo do npm script: o controle do dia 1 (o mutante
  // `ordem_por_date`) so e capaz de falhar em fuso negativo.
  execFileSync("node", ["--test", TESTE], {
    stdio: "pipe",
    env: { ...process.env, TZ: "America/Sao_Paulo" },
  });
}

try {
  // CONTROLE POSITIVO: com a fonte intacta o teste tem de PASSAR. Sem isto, um
  // "todos morreram" poderia significar apenas que o build esta quebrado e o
  // teste reprova sempre.
  try {
    compilaERoda(original);
    console.log("controle positivo: o teste passa com a fonte intacta\n");
  } catch (e) {
    console.error("ABORTADO: o teste reprova com a fonte INTACTA.");
    console.error((e.stdout ?? e.stderr ?? "").toString().slice(-1500));
    process.exit(1);
  }

  for (const m of MUTANTES) {
    // `String.replace` troca a PRIMEIRA ocorrencia. Um trecho que aparece duas
    // vezes produz um mutante que muta o lugar errado e morre verde com o
    // rotulo mentindo sobre o que foi medido -- por isso o trecho tem de ser
    // UNICO, e nao apenas existir.
    const ocorrencias = original.split(m.de).length - 1;
    if (ocorrencias === 0) {
      console.log(
        `  !! ${m.nome}: o trecho a mutar NAO EXISTE MAIS -- mutante invalido`
      );
      falhas++;
      continue;
    }
    if (ocorrencias > 1) {
      console.log(
        `  !! ${m.nome}: o trecho aparece ${ocorrencias}x -- mutante ambiguo, invalido`
      );
      falhas++;
      continue;
    }

    const mutado = original.replace(m.de, m.para);

    let sobreviveu = false;
    try {
      compilaERoda(mutado);
      sobreviveu = true;
    } catch {
      // reprovou (ou nem compilou): e o esperado.
    }

    if (sobreviveu) {
      console.log(`  SOBREVIVEU  ${m.nome}  <-- nenhuma assercao protege isto`);
      console.log(`              (${m.porque})`);
      falhas++;
    } else {
      console.log(`  morreu      ${m.nome}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
  // Deixa o build em dia com a fonte de verdade, para o proximo
  // `npm run test:telas-de-movimentacao` nao rodar contra um artefato mutado.
  try {
    rmSync(SAIDA, { recursive: true, force: true });
    execFileSync("npm", ["run", "test:telas-de-movimentacao"], { stdio: "pipe" });
  } catch {
    /* o controle positivo acima ja teria falhado */
  }
}

console.log();
if (falhas === 0) {
  console.log(`todos os ${MUTANTES.length} mutantes morreram`);
} else {
  console.log(`${falhas} mutante(s) sobreviveu/sobreviveram ou sao invalidos`);
  process.exit(1);
}
