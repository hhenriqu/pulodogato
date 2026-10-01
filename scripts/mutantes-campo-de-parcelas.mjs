#!/usr/bin/env node
// Mutantes do campo de parcelas -- HMO-226.
//
// POR QUE ISTO EXISTE, E POR QUE ELE NAO E O MUTANTE QUE A ISSUE PEDIU
// --------------------------------------------------------------------
// A issue pediu um mutante so: "repor `|| 1` no `onChange`", e exigiu que os
// dois testes de render morressem nele. Eles NAO morrem, e o motivo importa:
// `renderToStaticMarkup` nunca chama `onChange`. O handler nao aparece no HTML,
// e o estado que o render exibe e escolhido pelo teste -- entao `value=""`
// continua saindo igual com o fallback de volta no lugar. O mutante da issue
// sobreviveria com as duas assercoes "certas" verdes ao lado dele.
//
// Foi isso que obrigou os testes de handler (`camposDoInput`, em
// scripts/test-campos-de-lancamento.mjs): chamar `onChange`, `onFocus` e
// `onBlur` de verdade, aproveitando que `CamposDeLancamento` nao usa hook
// nenhum e portanto e uma funcao pura de props. `onchange_fallback_texto`
// abaixo e o mutante da issue na forma que os tipos novos permitem escrever, e
// ele morre por assercao.
//
// `onchange_parseint` e o mutante LITERAL da issue, e ele morre no `tsc`. Isso
// nao e um kill fraco por acidente: e a prova de que a troca de `number` para
// `string` esta carregando peso -- com os tipos antigos aquele codigo compilava,
// e e exatamente ele que estava no repositorio.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria e escrita numa COPIA da arvore, em diretorio
// temporario, com `node_modules` entrando por symlink. Mutar o arquivo e
// restaurar no `finally` deixa a fonte mutada no disco quando o processo morre
// no meio, e o placar seguinte vira ficcao -- pior aqui, onde o worktree e
// compartilhado com outro run e restaurar com `git checkout --` apagaria
// trabalho nao commitado de outra issue.
//
// COMO RODAR
//   npm run mutantes:campo-de-parcelas

import {
  readFileSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  symlinkSync,
  cpSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const RAIZ = process.cwd();
const CAMPOS = "components/movimentacoes/CamposDeLancamento.tsx";
const LIB = "lib/lancamento.ts";

/** As duas suites que medem este conserto. */
const CAMPOS_SUITE = "test:campos-lancamento";
const LIB_SUITE = "test:parcelamento";

const MUTANTES = [
  // -------------------------------------------------------------------------
  // O BUG DA ISSUE, DE VOLTA
  // -------------------------------------------------------------------------
  {
    nome: "onchange_fallback_texto",
    arquivo: CAMPOS,
    suite: CAMPOS_SUITE,
    porque:
      'o `|| 1` da issue na forma que os tipos novos permitem: apagar o campo volta a repor o "1" no mesmo quadro, e o Backspace nao funciona de novo',
    de: "                        aoMudar({ totalDeParcelas: e.target.value })",
    para: '                        aoMudar({ totalDeParcelas: e.target.value || "1" })',
  },
  {
    nome: "onchange_parseint",
    arquivo: CAMPOS,
    suite: CAMPOS_SUITE,
    porque:
      "o `onChange` LITERAL que estava no repositorio antes da HMO-226; so compila se os campos voltarem a ser numero",
    de: "                        aoMudar({ totalDeParcelas: e.target.value })",
    para:
      "                        aoMudar({ totalDeParcelas: parseInt(e.target.value) || 1 })",
  },
  {
    nome: "tipo_volta_para_number",
    arquivo: LIB,
    suite: LIB_SUITE,
    porque:
      "a troca de tipo e o que faz o estado vazio existir; com `number` de volta nao ha `\"\"` possivel, e todo o resto do conserto fica decorativo",
    de: "  parcelaAtual: string;",
    para: "  parcelaAtual: number;",
  },

  // -------------------------------------------------------------------------
  // A BORDA UNICA DE CONVERSAO
  // -------------------------------------------------------------------------
  {
    nome: "borda_cai_no_1",
    arquivo: LIB,
    suite: LIB_SUITE,
    porque:
      'o fallback silencioso um nivel mais fundo: o campo vazio vira 1, e o usuario recebe "deve ser 2 ou mais" sobre um numero que nao digitou -- a mentira que fazia o bug ser invisivel',
    de: "  if (!/^\\d+$/.test(limpo)) return Number.NaN;",
    para: "  if (!/^\\d+$/.test(limpo)) return 1;",
  },
  {
    nome: "borda_usa_number",
    arquivo: LIB,
    suite: LIB_SUITE,
    porque:
      '`Number("")` e 0 -- um inteiro que passa por `Number.isInteger` e chega ao banco como uma quantidade de parcelas',
    de: '  const limpo = texto.trim();\n  if (!/^\\d+$/.test(limpo)) return Number.NaN;\n  return Number(limpo);',
    para: "  return Number(texto.trim());",
  },
  {
    nome: "borda_usa_parseint",
    arquivo: LIB,
    suite: LIB_SUITE,
    porque:
      '`parseInt` le o prefixo e descarta o resto: "6x" vira 6 e "1.5" vira 1, entao a tela mostra uma coisa e a borda le outra',
    de: '  const limpo = texto.trim();\n  if (!/^\\d+$/.test(limpo)) return Number.NaN;\n  return Number(limpo);',
    para: "  return Number.parseInt(texto.trim(), 10);",
  },

  // -------------------------------------------------------------------------
  // A FRASE PROPRIA DO CAMPO VAZIO
  // -------------------------------------------------------------------------
  {
    nome: "validador_sem_ramo_do_vazio",
    arquivo: LIB,
    suite: LIB_SUITE,
    porque:
      'o ramo do vazio volta a ser o mesmo do `< 2`: quem apagou o campo recebe "o total de parcelas deve ser 2 ou mais", uma frase sobre um numero que ele nao escreveu',
    de: "    if (!Number.isInteger(totalDeParcelas)) {\n      return {\n        ok: false,\n        mensagem: \"Informe em quantas parcelas a compra foi dividida.\",\n      };\n    }\n    if (totalDeParcelas < 2) {",
    para: "    if (!Number.isInteger(totalDeParcelas) || totalDeParcelas < 2) {",
  },
  {
    nome: "validador_aceita_o_vazio",
    arquivo: LIB,
    suite: LIB_SUITE,
    porque:
      "o pior caso: o campo vazio deixa de ser recusado e a rota recebe NaN, virando 'Erro ao criar parcelas' sem dizer o que falta",
    de: "    if (!Number.isInteger(parcelaAtual)) {",
    para: "    if (false) {",
  },

  // -------------------------------------------------------------------------
  // AS DUAS PECAS DE INTERACAO QUE O PEDIDO NOMEIA
  // -------------------------------------------------------------------------
  {
    nome: "sem_onfocus_no_total",
    arquivo: CAMPOS,
    suite: CAMPOS_SUITE,
    porque:
      'o "quando clicar ele apague" do pedido desaparece: clicar nao seleciona o "1", e quem quer 6 digita ao lado dele e produz 16',
    de: '                      value={valores.totalDeParcelas}\n                      onFocus={(e) => e.target.select()}',
    para: "                      value={valores.totalDeParcelas}",
  },
  {
    nome: "onblur_sempre_repoe",
    arquivo: CAMPOS,
    suite: CAMPOS_SUITE,
    porque:
      "o `onBlur` passa a sobrescrever SEMPRE: o 6 que a pessoa acabou de digitar e trocado por 1 ao sair do campo -- o mesmo bug com outro gatilho",
    de: "                      onBlur={(e) => {\n                        if (!e.target.value.trim())\n                          aoMudar({ totalDeParcelas: \"1\" });\n                      }}",
    para: '                      onBlur={() => aoMudar({ totalDeParcelas: "1" })}',
  },
  {
    nome: "sem_onblur_no_total",
    arquivo: CAMPOS,
    suite: CAMPOS_SUITE,
    porque:
      "a tela fica guardando um campo em branco depois que a pessoa saiu dele, sem nada dizendo que falta responder",
    de: "                      onBlur={(e) => {\n                        if (!e.target.value.trim())\n                          aoMudar({ totalDeParcelas: \"1\" });\n                      }}",
    para: "",
  },

  // -------------------------------------------------------------------------
  // O CONTROLE NEGATIVO DO RESUMO
  // -------------------------------------------------------------------------
  // O MUTANTE EQUIVALENTE QUE NAO ESTA NESTA LISTA, e por que ele nao esta
  //
  //   totalDeParcelas: parcelaDigitada(valores.totalDeParcelas) || 1
  //
  // Esse era o mutante obvio do controle negativo do resumo, e ele e
  // INMATAVEL -- nao por falta de teste, mas porque nao tem efeito nenhum:
  // `serieDeParcelas` recusa M = 1 (`if (m < 2 ... ) return null`), entao cair em
  // 1 devolve `null` igual ao NaN, e o resumo desaparece dos dois jeitos.
  // Deixá-lo aqui seria um sobrevivente permanente no placar, e placar que nunca
  // fecha e placar que as pessoas param de ler.
  //
  // O mesmo fallback no campo N, abaixo, NAO e equivalente: com M = 3 ele monta
  // uma serie valida e a tela passa a anunciar "3x de R$ 300,00" ao lado de um
  // campo vazio. Foi este mutante que mostrou que o controle negativo pedido
  // pela issue (so no M) deixava o furo de verdade aberto.
  {
    nome: "resumo_parcial_com_parcela_vazia",
    arquivo: CAMPOS,
    suite: CAMPOS_SUITE,
    porque:
      'a mentira pior que o campo vazio: com a Parcela em branco a tela anuncia "3x de R$ 300,00 · total R$ 900,00", e um resumo parcial se le como resposta',
    de: "          parcelaAtual: parcelaDigitada(valores.parcelaAtual),",
    para: "          parcelaAtual: parcelaDigitada(valores.parcelaAtual) || 1,",
  },
];

const dir = mkdtempSync(join(tmpdir(), "mutantes-campo-de-parcelas-"));

/**
 * Monta uma copia da arvore com `arquivo` substituido por `fonte` e roda
 * `npm run <suite>` dentro dela.
 *
 * `node_modules` entra por SYMLINK: copiar levaria minutos por mutante, e a
 * suite nao escreve nada lá. O `tsc` do projeto e encontrado por ele.
 */
function rodar(nome, arquivo, fonte, suite) {
  const raiz = join(dir, nome);
  mkdirSync(raiz, { recursive: true });

  for (const alvo of ["components", "lib", "scripts"]) {
    cpSync(join(RAIZ, alvo), join(raiz, alvo), { recursive: true });
  }
  cpSync(join(RAIZ, "package.json"), join(raiz, "package.json"));
  symlinkSync(join(RAIZ, "node_modules"), join(raiz, "node_modules"));

  mkdirSync(join(raiz, dirname(arquivo)), { recursive: true });
  writeFileSync(join(raiz, arquivo), fonte);

  try {
    execFileSync("npm", ["run", suite], {
      cwd: raiz,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { verde: true };
  } catch (e) {
    const saida = String(e.stdout ?? "") + String(e.stderr ?? "");

    // O `tsc` reprovando TAMBEM mata o mutante -- um mutante que nem compila e
    // informacao valida --, mas tem de ser distinguivel do teste reprovando: um
    // mutante que nunca rodou nao prova nada sobre as assercoes.
    const erroDeTipo = saida.match(/error TS\d+: .*/)?.[0];
    if (erroDeTipo) {
      return { verde: false, como: "tsc", saida: erroDeTipo.slice(0, 110) };
    }

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
  const fontes = new Map(
    [CAMPOS, LIB].map((a) => [a, readFileSync(join(RAIZ, a), "utf8")])
  );

  // CONTROLE POSITIVO, UM POR SUITE. Sem ele, uma copia de arvore quebrada faria
  // TODO mutante "morrer" e o placar sairia cheio sem que nenhuma assercao
  // tivesse medido nada.
  for (const [suite, arquivo] of [
    [CAMPOS_SUITE, CAMPOS],
    [LIB_SUITE, LIB],
  ]) {
    const controle = rodar(
      `controle-${suite.replace(/:/g, "-")}`,
      arquivo,
      fontes.get(arquivo),
      suite
    );
    if (!controle.verde) {
      console.error(
        `CONTROLE FALHOU (${suite}): a fonte intacta nao passa na suite (${controle.como}) -> ${controle.saida}`
      );
      console.error("A copia da arvore esta errada. O placar abaixo nao vale.");
      rmSync(dir, { recursive: true, force: true });
      process.exit(1);
    }
    console.log(`controle: ${suite} passa com a fonte intacta  OK`);
  }
  console.log("");

  let mortos = 0;
  let porTeste = 0;

  for (const m of MUTANTES) {
    const original = fontes.get(m.arquivo);

    // MUTANTE QUE NAO SE APLICA E O PIOR RESULTADO POSSIVEL: ele contaria como
    // "morreu" sem nunca ter existido.
    const ocorrencias = original.split(m.de).length - 1;
    if (ocorrencias === 0) {
      console.error(
        `NAO APLICOU: ${m.nome} -- o trecho procurado nao esta em ${m.arquivo}`
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

    const r = rodar(
      m.nome,
      m.arquivo,
      original.replace(m.de, m.para),
      m.suite
    );
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

process.exit(falhou ? 1 : 0);
