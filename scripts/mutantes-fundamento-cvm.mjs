#!/usr/bin/env node
// =====================================================
// MUTANTES DE lib/fundamento-cvm.ts (HMO-194)
// =====================================================
// Uma suite de 30 asercoes que nunca viu vermelho nao e evidencia de nada. Este
// script estraga `lib/fundamento-cvm.ts` de um jeito por vez, roda
// `npm run test:fundamento-cvm` e EXIGE que a suite reprove. Mutante que
// sobrevive aponta uma regra que o codigo afirma e o teste nao verifica.
//
// Aqui isso importa mais que o normal, porque o defeito que esta entrega existe
// para impedir e SILENCIOSO: casar PETR4 com a ACU PETROLEO nao levanta excecao,
// nao deixa linha vazia e nao escreve log -- so mostra o ROE de outra empresa. O
// primeiro mutante da lista e exatamente esse defeito. Se ele sobrevivesse, a
// suite inteira estaria decorando os numeros da Petrobras sem verificar a regra
// que os escolheu.
//
// Cada mutacao e um defeito que alguem escreveria de verdade -- pegar o primeiro
// resultado, trocar igualdade por `includes`, esquecer a escala, somar todas as
// colunas da DMPL -- e nao uma quebra artificial. A LISTA segue o mesmo espirito
// da de `scripts/mutantes-moeda.mjs`; o APARELHO, nao: aquele runner passou a
// compartilhar uma compilacao entre os mutantes (`mutantes-em-bloco.mjs`,
// HMO-319/HMO-320) e este ainda roda um `npm run` por volta.
//
// Roda com: node scripts/mutantes-fundamento-cvm.mjs
// =====================================================

import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ALVO = fileURLToPath(new URL("../lib/fundamento-cvm.ts", import.meta.url));
const BACKUP = `${ALVO}.mutantes.bak`;

const MUTANTES = [
  {
    nome: "a ponte pega o PRIMEIRO resultado da B3 (o defeito da issue)",
    de: `  const exatos = resultados.filter((r) => (r.issuingCompany ?? "").trim().toUpperCase() === radical);`,
    para: `  const exatos = resultados.length > 0 ? [resultados[0]] : [];`,
  },
  {
    nome: "a ponte casa por substring no lugar de igualdade",
    de: `(r.issuingCompany ?? "").trim().toUpperCase() === radical`,
    para: `(r.issuingCompany ?? "").trim().toUpperCase().includes(radical)`,
  },
  {
    nome: "a ponte cai no primeiro quando o casamento e ambiguo",
    de: `  if (exatos.length > 1) {
    return { ok: false, recusa: { motivo: "casamento_ambiguo", ticker: limpo, radical, candidatos: resultados.length } };
  }`,
    para: ``,
  },
  {
    nome: "a ponte aceita empresa sem codigo CVM (o ETF com cnpj 0)",
    de: `  if (!codigoCvm || codigoCvm === "0" || cnpj.length !== 14) {`,
    para: `  if (false) {`,
  },
  {
    nome: "radicalDoTicker chuta o radical tirando os digitos do fim",
    de: `  const m = /^([A-Z]{4})\\d{1,2}F?$/.exec(ticker.trim().toUpperCase());
  return m ? m[1] : null;`,
    para: `  const limpo = ticker.trim().toUpperCase().replace(/\\d+F?$/, "");
  return limpo.length > 0 ? limpo : null;`,
  },
  {
    nome: "somarDividendos soma TODAS as colunas da DMPL",
    de: `  const consolidadas = daEmpresa.filter((l) => l.COLUNA_DF === COLUNA_DMPL_CONSOLIDADO);`,
    para: `  const consolidadas = daEmpresa;`,
  },
  {
    nome: "somarDividendos usa o subtotal 'Patrimonio Liquido' no lugar do Consolidado",
    de: `export const COLUNA_DMPL_CONSOLIDADO = "Patrimônio Líquido Consolidado";`,
    para: `export const COLUNA_DMPL_CONSOLIDADO = "Patrimônio Líquido";`,
  },
  {
    nome: "somarDividendos inclui dividendo prescrito (5.04.11)",
    de: `const codigos: readonly string[] = [CONTAS_DMPL.dividendos, CONTAS_DMPL.jurosSobreCapitalProprio];`,
    para: `const codigos: readonly string[] = [CONTAS_DMPL.dividendos, CONTAS_DMPL.jurosSobreCapitalProprio, "5.04.11"];`,
  },
  {
    nome: "somarDividendos esquece de inverter o sinal da DMPL",
    de: `  return -alvo.reduce((soma, l) => soma + valorEmReais(l), 0);`,
    para: `  return alvo.reduce((soma, l) => soma + valorEmReais(l), 0);`,
  },
  {
    nome: "valorEmReais ignora ESCALA_MOEDA (le MIL como unidade)",
    de: `  return n * fator;`,
    para: `  return n;`,
  },
  {
    nome: "valorEmReais assume MIL quando a escala e desconhecida",
    de: `  if (fator === undefined) throw new Error(\`ESCALA_MOEDA desconhecida: \${JSON.stringify(linha.ESCALA_MOEDA)}\`);`,
    para: `  const seguro = fator === undefined ? 1000 : fator;`,
    // A substituicao acima deixaria `fator` sem uso; troca tambem o retorno.
    extra: [{ de: `  return n * fator;`, para: `  return n * seguro;` }],
  },
  {
    nome: "acharConta pega a primeira quando ha re-apresentacao",
    de: `    if (!distintos.includes(v)) distintos.push(v);`,
    para: `    distintos.push(v);`,
  },
  {
    nome: "lerCsvCvm nao confere a contagem de campos",
    de: `    if (valores.length !== colunas.length) {`,
    para: `    if (false) {`,
  },
  {
    nome: "calcularIndicadores aceita patrimonio NEGATIVO no ROE",
    de: `  const patrimonioUtil = f.patrimonioLiquido !== null && f.patrimonioLiquido > 0 ? f.patrimonioLiquido : null;`,
    para: `  const patrimonioUtil = f.patrimonioLiquido !== null && f.patrimonioLiquido !== 0 ? f.patrimonioLiquido : null;`,
  },
  {
    nome: "margem bruta SUBTRAI o custo (que ja vem negativo)",
    de: `        (f.receitaLiquida + f.custo) / f.receitaLiquida;`,
    para: `        (f.receitaLiquida - f.custo) / f.receitaLiquida;`,
  },
  {
    nome: "divida liquida esquece de abater as aplicacoes financeiras",
    de: `dividaBruta === null ? null : dividaBruta - (f.caixa ?? 0) - (f.aplicacoesFinanceiras ?? 0);`,
    para: `dividaBruta === null ? null : dividaBruta - (f.caixa ?? 0);`,
  },
  {
    nome: "divida liquida vira 0 quando a empresa nao publicou divida",
    de: `f.dividaCurtoPrazo === null && f.dividaLongoPrazo === null
      ? null
      : (f.dividaCurtoPrazo ?? 0) + (f.dividaLongoPrazo ?? 0);`,
    para: `(f.dividaCurtoPrazo ?? 0) + (f.dividaLongoPrazo ?? 0);`,
  },
  {
    nome: "o lucro procura o rotulo do resultado NAO consolidado",
    de: `    rotulos: ["lucro/prejuizo consolidado do periodo", "lucro ou prejuizo liquido consolidado do periodo"],`,
    para: `    rotulos: ["lucro/prejuizo do periodo"],`,
  },
  {
    nome: "o patrimonio sai do individual (BPP_ind) no lugar do consolidado",
    de: `  patrimonioLiquido: { arquivo: "BPP_con", rotulos: ["patrimonio liquido consolidado"] },`,
    para: `  patrimonioLiquido: { arquivo: "BPP_ind", rotulos: ["patrimonio liquido consolidado"] },`,
  },
  // ---- armadilha 4: o codigo que significa outra coisa em banco ----
  {
    nome: "o patrimonio volta a ser buscado pelo CODIGO 2.03 (pega passivo no banco)",
    de: `  patrimonioLiquido: { arquivo: "BPP_con", rotulos: ["patrimonio liquido consolidado"] },`,
    para: `  patrimonioLiquido: { arquivo: "BPP_con", codigo: "2.03", rotulos: ["patrimonio liquido consolidado"] },`,
  },
  {
    nome: "acharConta aceita pelo codigo sem conferir o rotulo",
    de: `  const achadas = candidatas.filter((l) => querido.includes(normalizarRotulo(l.DS_CONTA ?? "")));`,
    para: `  const achadas = candidatas;`,
  },
  {
    nome: "acharConta aceita valores que DISCORDAM (pega o primeiro)",
    de: `  if (distintos.length > 1) {`,
    para: `  if (false) {`,
  },
  {
    nome: "normalizarRotulo nao tira acento (quebra a comparacao de DS_CONTA)",
    de: `    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")`,
    para: `    .normalize("NFD")`,
  },
  {
    nome: "CNPJ da B3 nao e reenchido com os zeros a esquerda (recusa o Banco do Brasil)",
    de: `  const cnpj = cnpjCru.replace(/^0+/, "") === "" ? "" : cnpjCru.padStart(14, "0");`,
    para: `  const cnpj = cnpjCru;`,
  },
  {
    nome: "reencher o CNPJ tambem TRUNCA o numero longo demais",
    de: `  const cnpj = cnpjCru.replace(/^0+/, "") === "" ? "" : cnpjCru.padStart(14, "0");`,
    para: `  const cnpj = cnpjCru.replace(/^0+/, "") === "" ? "" : cnpjCru.padStart(14, "0").slice(-14);`,
  },
];

// Recusa comecar sobre um arquivo que uma rodada anterior deixou mutado.
//
// Isto ja aconteceu: a primeira versao deste script chamava `process.exit(1)` de
// dentro do `try` quando um trecho nao casava, e `process.exit` NAO roda o
// `finally` -- o arquivo ficou com o mutante da iteracao anterior escrito, e a
// rodada seguinte leu o codigo ESTRAGADO como se fosse o original. O efeito e o
// pior possivel para uma ferramenta de controle negativo: os mutantes seguintes
// passam a ser medidos contra uma base errada e reportam MORTO por comparar
// defeito com defeito. Hoje o abort passa por `abortar()`, que restaura antes de
// sair, e a presenca do .bak e tratada como estado sujo.
if (existsSync(BACKUP)) {
  console.error(
    `ERRO: ${BACKUP} existe -- uma rodada anterior morreu antes de restaurar.\n` +
      `lib/fundamento-cvm.ts pode estar mutado. Confira o arquivo (e o diff do git) antes de rodar de novo.`,
  );
  process.exit(1);
}

const original = readFileSync(ALVO, "utf8");
copyFileSync(ALVO, BACKUP);

let mortos = 0;
const sobreviventes = [];

/** Restaura o alvo e so entao sai -- ver o comentario acima. */
function abortar(mensagem) {
  copyFileSync(BACKUP, ALVO);
  unlinkSync(BACKUP);
  console.error(`\nERRO: ${mensagem}`);
  process.exit(1);
}

try {
  for (const mutante of MUTANTES) {
    const trocas = [{ de: mutante.de, para: mutante.para }, ...(mutante.extra ?? [])];

    let mutado = original;
    for (const { de, para } of trocas) {
      if (!mutado.includes(de)) {
        // Mutante que nao encontra o alvo nao aplica nada, e ai a suite passa --
        // o que se leria como "sobreviveu". Um controle negativo que nasce falso
        // e pior que nenhum: e por isso que isto e erro, nao aviso.
        abortar(
          `o trecho do mutante "${mutante.nome}" nao existe mais em lib/fundamento-cvm.ts:\n  ${de.split("\n")[0]}`,
        );
      }
      mutado = mutado.replace(de, para);
    }
    if (mutado === original) abortar(`o mutante "${mutante.nome}" nao mudou nada.`);
    writeFileSync(ALVO, mutado);

    let reprovou = false;
    let motivo = "";
    try {
      execSync("npm run test:fundamento-cvm", { stdio: "pipe", encoding: "utf8" });
    } catch (erro) {
      reprovou = true;
      const saida = `${erro.stdout ?? ""}${erro.stderr ?? ""}`;
      // O tsc reprovando tambem conta como morto -- mutante que nao compila nao
      // chega em producao. Mas vale distinguir: erro de tipo nao diz que a SUITE
      // pegou a regra.
      motivo = /error TS\d+/.test(saida) ? "tsc" : "asercao";
    }

    if (reprovou) {
      mortos++;
      console.log(`MORTO ${mutante.nome}  (${motivo})`);
    } else {
      console.log(`VIVO  ${mutante.nome}`);
      sobreviventes.push(mutante.nome);
    }
  }
} finally {
  copyFileSync(BACKUP, ALVO);
  unlinkSync(BACKUP);
}

console.log(`\n${mortos}/${MUTANTES.length} mortos.`);

if (sobreviventes.length > 0) {
  console.log("\nSOBREVIVENTES:");
  for (const nome of sobreviventes) console.log(`  - ${nome}`);
  process.exit(1);
}
