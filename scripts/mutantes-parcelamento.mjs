#!/usr/bin/env node
// Mutantes da serie de parcelas (lib/lancamento.ts) -- HMO-211.
//
// POR QUE ISTO EXISTE
// -------------------
// `test:parcelamento` passa com 23 assercoes verdes. Isso, sozinho, nao diz
// nada: um teste que nunca reprova e um teste que nao esta medindo o que a
// justificativa dele afirma. Cada mutante abaixo quebra UMA decisao de
// `serieDeParcelas`, e a suite tem que ficar vermelha em todos.
//
// OS QUATRO QUE A ISSUE NOMEOU, mais a decisao (A):
//
//   base_trocada        "1.000 em 10x" grava R$ 1.000 em vez de R$ 10.000
//   n_e_m_invertidos    "parcela 3 de 10" lido como "10 de 3"
//   off_by_one_*        uma parcela a mais / a menos no fim da serie
//   sobra_perdida       3 x 333,33 = 999,99, um centavo que linha nenhuma explica
//   grava_as_anteriores a opcao (B) entrando pela porta de tras
//
// Nenhum desses produz erro em runtime. Todos gravam dinheiro plausivel.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria; o `.ts` mutado e escrito numa COPIA da arvore,
// em diretorio temporario, e e de la que o `tsc` compila. `lib/lancamento.ts`
// nao e tocado em momento nenhum.
//
// O jeito usual -- mutar o arquivo, rodar, restaurar no `finally` -- deixa a
// fonte mutada no disco quando o processo morre no meio, e o placar seguinte
// vira ficcao. Pior neste repositorio: restaurar com `git checkout --` apaga
// edicao nao-commitada do mesmo arquivo, sem aviso.
//
// COMO RODAR
//   npm run mutantes:parcelamento

import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  cpSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const FONTE = "lib/lancamento.ts";
const TESTE = "scripts/test-parcelamento.mjs";

// O `tsc` DO PROJETO, POR CAMINHO ABSOLUTO.
//
// `npx tsc` nao serve aqui: a arvore mutada e um diretorio temporario SEM
// node_modules, entao o npx cai no `tsc` do sistema (o pacote Debian
// `node-typescript`), que responde "This is not the tsc command you are looking
// for" e sai com erro. O sintoma e brutal -- TODO mutante "morre no tsc" e o
// placar sai perfeito sem uma assercao ter rodado. Foi o controle positivo que
// pegou isto; sem ele o arquivo teria nascido mentindo 16/16.
const TSC = join(process.cwd(), "node_modules/.bin/tsc");

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  {
    nome: "base_trocada",
    porque:
      'a pergunta da issue e ignorada: "parcela" passa a valer como "total" e uma compra de R$ 10.000 em 10x e gravada como R$ 1.000',
    de: 'base === "parcela" ? digitadoEmCentavos * m : digitadoEmCentavos;',
    para: 'base === "parcela" ? digitadoEmCentavos : digitadoEmCentavos * m;',
  },
  {
    nome: "base_ignorada",
    porque:
      "a base para de ser lida: todo valor digitado passa a ser o total, e quem responder 'o valor de cada parcela' tem a compra dividida por M",
    de: 'base === "parcela" ? digitadoEmCentavos * m : digitadoEmCentavos;',
    para: "digitadoEmCentavos;",
  },
  {
    nome: "n_e_m_invertidos",
    porque:
      '"parcela 3 de 10" e lido como "parcela 10 de 3": a serie nasce ao contrario',
    de: "  const { base, parcelaAtual: n, totalDeParcelas: m } = entrada;",
    para: "  const { base, parcelaAtual: m, totalDeParcelas: n } = entrada;",
  },
  {
    nome: "aceita_n_maior_que_m",
    porque:
      '"parcela 12 de 10" deixa de ser recusado, e o laco nao roda nenhuma volta -- zero parcelas gravadas e um toast de sucesso',
    de: "  if (n < 1 || n > m) return null;",
    para: "  if (n < 1) return null;",
  },
  {
    nome: "off_by_one_uma_a_mais",
    porque:
      "a serie ganha uma parcela alem de M: ela cai na fatura de um mes que ainda nao chegou, com valor plausivel",
    de: "  for (let numero = n; numero <= m; numero++) {",
    para: "  for (let numero = n; numero <= m + 1; numero++) {",
  },
  {
    nome: "off_by_one_uma_a_menos",
    porque:
      "a ultima parcela nao e gravada -- e e justamente ela que carrega a sobra da divisao, entao o centavo tambem desaparece",
    de: "  for (let numero = n; numero <= m; numero++) {",
    para: "  for (let numero = n; numero < m; numero++) {",
  },
  {
    nome: "grava_as_anteriores",
    porque:
      "a OPCAO (B) entrando pela porta de tras: a serie passa a incluir as parcelas 1..N-1, e o app afirma pagamentos que ninguem registrou",
    de: "  for (let numero = n; numero <= m; numero++) {",
    para: "  for (let numero = 1; numero <= m; numero++) {",
  },
  {
    nome: "sobra_perdida",
    porque:
      "a ultima parcela deixa de fechar o total: R$ 1.000 em 3x soma 999,99 e falta um centavo que nenhuma linha explica",
    de: "    totalEmCentavos - parcelaEmCentavos * (m - 1);",
    para: "    parcelaEmCentavos;",
  },
  {
    nome: "sobra_na_primeira",
    porque:
      "a sobra vai para a parcela N em vez da M -- com N > 1 a serie ainda fecha, mas o valor da parcela que a pessoa esta olhando fica errado",
    de: "      valor: (numero === m ? ultimaEmCentavos : parcelaEmCentavos) / 100,",
    para: "      valor: (numero === n ? ultimaEmCentavos : parcelaEmCentavos) / 100,",
  },
  {
    nome: "vencimento_nao_anda",
    porque:
      "todas as parcelas vencem no mesmo dia: as 10 caem na MESMA fatura e o mes fecha com dez vezes o valor",
    de: "    const vencimento = somaMeses(entrada.vencimentoDaParcelaAtual, numero - n);",
    para: "    const vencimento = somaMeses(entrada.vencimentoDaParcelaAtual, 0);",
  },
  {
    nome: "vencimento_conta_do_um",
    porque:
      "o deslocamento de mes conta da parcela 1 e nao da N: lancar 'parcela 3 de 10' joga a primeira linha dois meses para a frente",
    de: "    const vencimento = somaMeses(entrada.vencimentoDaParcelaAtual, numero - n);",
    para: "    const vencimento = somaMeses(entrada.vencimentoDaParcelaAtual, numero - 1);",
  },
  {
    nome: "dia_nao_grampeia",
    porque:
      "o dia deixa de ser grampeado no ultimo do mes: a parcela de 31/01 vai para 03/03 e a serie pula fevereiro",
    de: "  const diaDestino = Math.min(dia, ultimoDia);",
    para: "  const diaDestino = dia;",
  },
  {
    nome: "conta_em_ponto_flutuante",
    porque:
      "a aritmetica sai dos centavos inteiros: 1000/3 em float soma 999,99999999999989 e a fatura fecha num numero que nao e dinheiro",
    de: "  const digitadoEmCentavos = Math.round(valor * 100);",
    para: "  const digitadoEmCentavos = valor * 100;",
  },
  {
    nome: "serie_de_uma_parcela_passa",
    porque:
      'M = 1 deixa de ser recusado: "parcela 1 de 1" e uma compra avulsa com um rotulo a mais, e a tela passaria a rotular metade das compras',
    de: "  if (m < 2 || m > MAX_PARCELAS) return null;",
    para: "  if (m > MAX_PARCELAS) return null;",
  },
  {
    nome: "parcelamento_volta_para_toda_despesa",
    porque:
      "a checkbox volta a aparecer fora do cartao, onde a rota recusa -- a tela oferece um caminho que o servidor nao atende",
    de: "    parcelamento: !editando && ehNoCartao,",
    para: "    parcelamento: !editando,",
  },
  {
    nome: "resumo_esconde_as_anteriores",
    porque:
      "o resumo deixa de dizer que as N-1 anteriores nao entram: a tela anuncia 10x e grava 8, e o unico aviso da decisao (A) desaparece",
    de: "  if (serie.parcelasAnteriores > 0) {",
    para: "  if (false) {",
  },
];

const dir = mkdtempSync(join(tmpdir(), "mutantes-parcelamento-"));

/**
 * Compila `sql`... nao: compila a FONTE mutada numa copia da arvore e roda a
 * suite contra ela.
 *
 * A suite importa de `../.tmp-parcelamento/lib/lancamento.js` -- caminho
 * relativo ao arquivo de teste --, entao a copia precisa manter a mesma forma:
 * `<raiz>/scripts/test-parcelamento.mjs` e `<raiz>/.tmp-parcelamento/lib/`.
 */
function rodar(nome, fonte) {
  const raiz = join(dir, nome);
  mkdirSync(join(raiz, "lib"), { recursive: true });
  mkdirSync(join(raiz, "scripts"), { recursive: true });

  writeFileSync(join(raiz, "lib/lancamento.ts"), fonte);
  cpSync(TESTE, join(raiz, "scripts/test-parcelamento.mjs"));

  try {
    execFileSync(
      TSC,
      [
        "lib/lancamento.ts",
        "--outDir",
        ".tmp-parcelamento/lib",
        "--module",
        "es2020",
        "--target",
        "es2020",
        "--moduleResolution",
        "node",
        "--skipLibCheck",
      ],
      { cwd: raiz, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch (e) {
    // O `tsc` reprovando TAMBEM mata o mutante -- e um mutante que nem compila
    // e informacao valida --, mas tem de ser distinguivel do teste reprovando:
    // um mutante que nunca rodou nao prova nada sobre as assercoes.
    return {
      verde: false,
      como: "tsc",
      saida: String(e.stdout ?? e.message).trim().split("\n").slice(0, 2).join(" | "),
    };
  }

  try {
    execFileSync("node", ["--test", "scripts/test-parcelamento.mjs"], {
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
  // CONTROLE POSITIVO. Sem ele, uma copia de arvore quebrada faria TODO mutante
  // "morrer" e o placar sairia cheio sem que nenhuma assercao tivesse medido
  // nada -- ver `mutantes-e-controle-negativo`.
  const controle = rodar("controle", original);
  if (!controle.verde) {
    console.error(
      `CONTROLE FALHOU: a fonte intacta nao passa na suite (${controle.como}) -> ${controle.saida}`
    );
    console.error("A copia da arvore esta errada. O placar abaixo nao vale.");
    process.exitCode = 1;
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
      console.error(`NAO APLICOU: ${m.nome} -- o trecho procurado nao esta em ${FONTE}`);
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

  console.log(`\n${mortos}/${MUTANTES.length} mutantes mortos (${porTeste} por assercao)`);

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
