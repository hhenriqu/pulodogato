#!/usr/bin/env node
// Ingestor de fundamento da CVM -- HMO-194 (entrega 4 da HMO-141).
//
// Baixa o pacote anual da DFP, resolve a ponte ticker -> CNPJ pela consulta
// aberta da B3 e emite o SQL que enche `cvm_ponte_ticker`, `cvm_fundamentos` e
// `cvm_tickers_sem_fundamento` (028_fundamento_cvm.sql).
//
// A decisao de QUAL empresa e, de QUAIS contas guardar e de COMO derivar cada
// indicador nao esta aqui: esta em `lib/fundamento-cvm.ts`, que nao toca rede
// nem banco e por isso e testada por `npm run test:fundamento-cvm` -- com
// PETR4, VALE3 e RANI3, que sao os tres tickers em que o primeiro resultado da
// B3 e outra empresa. Este arquivo e so o encanamento.
//
// Uso:
//   npm run ingest:cvm -- --ano 2025 PETR4 VALE3 RANI3      # imprime o SQL
//   npm run ingest:cvm -- --ano 2025 --aplicar PETR4        # aplica via psql
//   npm run ingest:cvm -- --ano 2025 --do-banco             # tickers de investment_assets
//
// `--aplicar` exige `DATABASE_URL` e o binario `psql`. Nao ha caminho de cron
// aqui de proposito: agendar isto na Vercel e assunto da entrega 5, e um cron
// mal feito reimportaria 439 empresas por hora.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { abrirZipCvm } from "../.tmp-ingest-cvm/cvm-zip.js";
import {
  CONTAS,
  acharConta,
  anoDoExercicio,
  calcularIndicadores,
  escolherEmpresaDaB3,
  formatarCnpj,
  lerCsvCvm,
  normalizarRotulo,
  somarDividendos,
} from "../.tmp-ingest-cvm/fundamento-cvm.js";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const CACHE = join(RAIZ, ".cache-cvm");

// ---------------------------------------------------------------------------
// argumentos
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opcao = (nome, padrao) => {
  const i = argv.indexOf(`--${nome}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : padrao;
};
const temFlag = (nome) => argv.includes(`--${nome}`);

const ANO = Number(opcao("ano", String(new Date().getFullYear() - 1)));
const APLICAR = temFlag("aplicar");
const DO_BANCO = temFlag("do-banco");
const tickersDoArgv = argv.filter((a) => /^[A-Z]{4}\d{1,2}F?$/.test(a));

if (!Number.isInteger(ANO) || ANO < 2010) {
  console.error(`--ano invalido: ${ANO}. O portal da CVM comeca em 2010.`);
  process.exit(1);
}

function psql(sql) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL ausente -- necessaria para --aplicar/--do-banco.");
  return execFileSync("psql", [url, "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-tAc", sql], {
    encoding: "utf8",
  });
}

let TICKERS = tickersDoArgv;
if (DO_BANCO) {
  // `investment_assets` guarda o ticker que o usuario digitou; so acao brasileira
  // interessa aqui, e o filtro de formato tambem exclui FII (11), que nao tem DFP.
  const linhas = psql(
    "SELECT DISTINCT upper(trim(symbol)) FROM public.investment_assets " +
      "WHERE symbol ~ '^[A-Za-z]{4}[0-9]{1,2}$' ORDER BY 1",
  );
  TICKERS = [...new Set([...TICKERS, ...linhas.split("\n").map((l) => l.trim()).filter(Boolean)])];
}
if (TICKERS.length === 0) {
  console.error("Nenhum ticker. Passe PETR4 VALE3 ... ou use --do-banco.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// a ponte, pela B3
// ---------------------------------------------------------------------------
const URL_B3 =
  "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetInitialCompanies";

/**
 * Consulta a B3 pelo RADICAL do ticker e devolve a lista crua.
 *
 * Nao interpreta nada: quem escolhe e `escolherEmpresaDaB3`. A busca e por
 * substring no nome, entao esta lista vem ordenada por nome e a empresa certa
 * quase nunca e a primeira -- ver o cabecalho de `lib/fundamento-cvm.ts`.
 */
async function consultarB3(radical) {
  const payload = Buffer.from(
    JSON.stringify({ language: "pt-br", pageNumber: 1, pageSize: 120, company: radical }),
  ).toString("base64");

  const r = await fetch(`${URL_B3}/${payload}`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`B3 devolveu HTTP ${r.status} para ${radical}`);
  const j = await r.json();
  return Array.isArray(j?.results) ? j.results : [];
}

// ---------------------------------------------------------------------------
// o pacote da CVM
// ---------------------------------------------------------------------------
async function baixarPacote(ano) {
  if (!existsSync(CACHE)) mkdirSync(CACHE, { recursive: true });
  const destino = join(CACHE, `dfp_cia_aberta_${ano}.zip`);
  if (existsSync(destino)) {
    console.error(`[cvm] usando cache ${destino}`);
    return readFileSync(destino);
  }
  const url = `https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/DFP/DADOS/dfp_cia_aberta_${ano}.zip`;
  console.error(`[cvm] baixando ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`CVM devolveu HTTP ${r.status} para ${ano}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(destino, buf);
  return buf;
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------
const lit = (v) => (v === null || v === undefined ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const num = (v) => (v === null || v === undefined || !Number.isFinite(v) ? "NULL" : v.toFixed(2));

function sqlPonte(e) {
  return (
    `INSERT INTO public.cvm_ponte_ticker (ticker, radical, codigo_cvm, cnpj, denominacao, criterio)\n` +
    `VALUES (${lit(e.ticker)}, ${lit(e.radical)}, ${lit(e.codigoCvm)}, ${lit(e.cnpj)}, ${lit(e.nome)}, 'issuing_company_exato')\n` +
    `ON CONFLICT (ticker) DO UPDATE SET radical = EXCLUDED.radical, codigo_cvm = EXCLUDED.codigo_cvm,\n` +
    `  cnpj = EXCLUDED.cnpj, denominacao = EXCLUDED.denominacao, criterio = EXCLUDED.criterio,\n` +
    `  resolvido_em = now();\n` +
    // O ticker resolveu: se ele estava na lista de recusados de uma rodada
    // anterior, tem que SAIR. Sem isto, um ticker que a B3 passou a devolver
    // direito continuaria registrado como sem fundamento para sempre.
    `DELETE FROM public.cvm_tickers_sem_fundamento WHERE ticker = ${lit(e.ticker)};\n`
  );
}

function sqlRecusa(ticker, motivo, candidatos) {
  return (
    `INSERT INTO public.cvm_tickers_sem_fundamento (ticker, motivo, candidatos)\n` +
    `VALUES (${lit(ticker)}, ${lit(motivo)}, ${candidatos})\n` +
    `ON CONFLICT (ticker) DO UPDATE SET motivo = EXCLUDED.motivo,\n` +
    `  candidatos = EXCLUDED.candidatos, tentado_em = now();\n` +
    // Simetrico ao de cima: o ticker recusado nao pode continuar na ponte com o
    // par da rodada passada, senao a tela segue mostrando o ROE antigo.
    `DELETE FROM public.cvm_ponte_ticker WHERE ticker = ${lit(ticker)};\n`
  );
}

function sqlFundamento(f) {
  return (
    `INSERT INTO public.cvm_fundamentos (codigo_cvm, ano_exercicio, cnpj, data_base,\n` +
    `  receita_liquida, custo, lucro_liquido, patrimonio_liquido, divida_curto_prazo,\n` +
    `  divida_longo_prazo, caixa, aplicacoes_financeiras, dividendos_distribuidos, quantidade_acoes)\n` +
    `VALUES (${lit(f.codigoCvm)}, ${f.anoExercicio}, ${lit(f.cnpj)}, ${lit(f.dataBase)},\n` +
    `  ${num(f.receitaLiquida)}, ${num(f.custo)}, ${num(f.lucroLiquido)}, ${num(f.patrimonioLiquido)},\n` +
    `  ${num(f.dividaCurtoPrazo)}, ${num(f.dividaLongoPrazo)}, ${num(f.caixa)},\n` +
    `  ${num(f.aplicacoesFinanceiras)}, ${num(f.dividendosDistribuidos)},\n` +
    `  ${f.quantidadeAcoes === null ? "NULL" : Math.round(f.quantidadeAcoes)})\n` +
    `ON CONFLICT (codigo_cvm, ano_exercicio) DO UPDATE SET\n` +
    `  cnpj = EXCLUDED.cnpj, data_base = EXCLUDED.data_base,\n` +
    `  receita_liquida = EXCLUDED.receita_liquida, custo = EXCLUDED.custo,\n` +
    `  lucro_liquido = EXCLUDED.lucro_liquido, patrimonio_liquido = EXCLUDED.patrimonio_liquido,\n` +
    `  divida_curto_prazo = EXCLUDED.divida_curto_prazo, divida_longo_prazo = EXCLUDED.divida_longo_prazo,\n` +
    `  caixa = EXCLUDED.caixa, aplicacoes_financeiras = EXCLUDED.aplicacoes_financeiras,\n` +
    `  dividendos_distribuidos = EXCLUDED.dividendos_distribuidos,\n` +
    `  quantidade_acoes = EXCLUDED.quantidade_acoes, importado_em = now();\n`
  );
}

// ---------------------------------------------------------------------------
// a rodada
// ---------------------------------------------------------------------------
async function main() {
  const zipBuf = await baixarPacote(ANO);
  const zip = abrirZipCvm(zipBuf);

  const csv = (curto) => {
    const nome = `dfp_cia_aberta_${curto}_${ANO}.csv`;
    // latin1 e obrigatorio: os arquivos sao ISO-8859-1, e lidos como UTF-8 a
    // coluna 'Patrimonio Liquido Consolidado' da DMPL chega quebrada -- o que
    // faria `somarDividendos` recusar o arquivo inteiro apontando para a coluna
    // errada, em vez de somar a coluna certa.
    return lerCsvCvm(zip.extrair(nome).toString("latin1"));
  };

  console.error(`[cvm] lendo CSVs de ${ANO}...`);
  const arquivos = {
    DRE_con: csv("DRE_con"),
    BPP_con: csv("BPP_con"),
    BPA_con: csv("BPA_con"),
    DMPL_con: csv("DMPL_con"),
    composicao_capital: csv("composicao_capital"),
  };

  const partes = [];
  const resumo = { gravados: 0, recusados: 0 };

  for (const ticker of TICKERS) {
    const radical = ticker.slice(0, 4);
    let resultados;
    try {
      resultados = await consultarB3(radical);
    } catch (erro) {
      console.error(`[${ticker}] B3 falhou: ${erro.message} -- pulando sem gravar recusa`);
      continue;
    }

    const res = escolherEmpresaDaB3(ticker, resultados);
    if (!res.ok) {
      const { motivo, candidatos } = res.recusa;
      console.error(`[${ticker}] RECUSADO (${motivo}, ${candidatos} candidatos da B3)`);
      partes.push(sqlRecusa(ticker, motivo, candidatos));
      resumo.recusados++;
      continue;
    }

    const e = res.empresa;
    const cnpjFmt = formatarCnpj(e.cnpj);
    const escolhido = resultados.findIndex((r) => (r.issuingCompany ?? "").toUpperCase() === e.radical);
    console.error(
      `[${ticker}] ${e.nome} (CVM ${e.codigoCvm}) -- ${escolhido + 1}o de ${resultados.length} resultados`,
    );

    const conta = (c) =>
      acharConta(arquivos[CONTAS[c].arquivo], {
        cnpjFormatado: cnpjFmt,
        ano: ANO,
        rotulos: CONTAS[c].rotulos,
        codigo: CONTAS[c].codigo,
      });

    let f;
    try {
      // A data-base sai da propria linha do lucro, nao de `${ANO}-12-31`: ha
      // empresa com exercicio social que nao fecha em dezembro, e carimbar
      // 31/12 num balanco de 30/06 poria uma data falsa na tela.
      //
      // A linha e localizada pelo ROTULO, igual `acharConta` -- procurar pelo
      // codigo 3.11 aqui faria banco e seguradora cairem em
      // "sem_dfp_no_pacote" mesmo tendo DFP no pacote, porque nelas o lucro
      // consolidado mora em 3.09 ou 3.13 (armadilha 4).
      const rotulosLucro = CONTAS.lucroLiquido.rotulos.map(normalizarRotulo);
      const linhaDre = arquivos.DRE_con.find(
        (l) =>
          l.CNPJ_CIA === cnpjFmt &&
          anoDoExercicio(l) === ANO &&
          rotulosLucro.includes(normalizarRotulo(l.DS_CONTA ?? "")),
      );
      if (!linhaDre) {
        console.error(`[${ticker}] sem lucro consolidado de ${ANO} no pacote -- registrando`);
        partes.push(sqlRecusa(ticker, "sem_dfp_no_pacote", resultados.length));
        resumo.recusados++;
        continue;
      }

      const capital = arquivos.composicao_capital.find((l) => l.CNPJ_CIA === cnpjFmt);
      const acoes = capital ? Number(capital.QT_ACAO_TOTAL_CAP_INTEGR) : NaN;

      f = {
        codigoCvm: e.codigoCvm,
        cnpj: e.cnpj,
        anoExercicio: ANO,
        dataBase: linhaDre.DT_FIM_EXERC,
        receitaLiquida: conta("receitaLiquida"),
        custo: conta("custo"),
        lucroLiquido: conta("lucroLiquido"),
        patrimonioLiquido: conta("patrimonioLiquido"),
        dividaCurtoPrazo: conta("dividaCurtoPrazo"),
        dividaLongoPrazo: conta("dividaLongoPrazo"),
        caixa: conta("caixa"),
        aplicacoesFinanceiras: conta("aplicacoesFinanceiras"),
        dividendosDistribuidos: somarDividendos(arquivos.DMPL_con, { cnpjFormatado: cnpjFmt, ano: ANO }),
        quantidadeAcoes: Number.isFinite(acoes) && acoes > 0 ? acoes : null,
      };
    } catch (erro) {
      // Conta duplicada, escala desconhecida, coluna da DMPL ausente: tudo que
      // `lib/fundamento-cvm.ts` recusa em vez de adivinhar chega aqui. Vira
      // recusa registrada, nao linha com numero chutado.
      console.error(`[${ticker}] dado inconsistente: ${erro.message}`);
      partes.push(sqlRecusa(ticker, "dado_inconsistente", resultados.length));
      resumo.recusados++;
      continue;
    }

    if (f.dividendosDistribuidos !== null && f.dividendosDistribuidos < 0) {
      console.error(`[${ticker}] distribuicao negativa (${f.dividendosDistribuidos}) -- registrando`);
      partes.push(sqlRecusa(ticker, "dado_inconsistente", resultados.length));
      resumo.recusados++;
      continue;
    }

    const ind = calcularIndicadores(f);
    console.error(
      `        ROE ${ind.roe === null ? "n/d" : (ind.roe * 100).toFixed(2) + "%"}` +
        `  divida liq/PL ${ind.dividaLiquidaSobrePatrimonio === null ? "n/d" : ind.dividaLiquidaSobrePatrimonio.toFixed(2) + "x"}` +
        `  base ${f.dataBase}`,
    );

    partes.push(sqlPonte(e), sqlFundamento(f));
    resumo.gravados++;
  }

  const sql = `BEGIN;\n\n${partes.join("\n")}\nCOMMIT;\n`;

  if (APLICAR) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL ausente -- necessaria para --aplicar.");
    execFileSync("psql", [url, "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], {
      input: sql,
      encoding: "utf8",
      stdio: ["pipe", "inherit", "inherit"],
    });
    console.error(`\n[cvm] aplicado: ${resumo.gravados} gravados, ${resumo.recusados} recusados.`);
  } else {
    process.stdout.write(sql);
    console.error(`\n[cvm] SQL emitido: ${resumo.gravados} gravados, ${resumo.recusados} recusados.`);
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exit(1);
});
