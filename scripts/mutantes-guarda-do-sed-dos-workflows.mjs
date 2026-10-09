#!/usr/bin/env node
// =====================================================
// OS MUTANTES DA GUARDA DE `sed` DOS WORKFLOWS (HMO-231)
// =====================================================
// Roda com:  npm run mutantes:guarda-do-sed-dos-workflows
//
// POR QUE ISTO EXISTE, SE A GUARDA JA TEM CONTROLE NEGATIVO
// ---------------------------------------------------------
// `test-sed-dos-workflows.mjs` tem 65 casos e prova que a guarda SABE reprovar.
// Ele nao prova que cada decisao da guarda esta MEDIDA por algum caso. Sao
// perguntas diferentes, e a segunda e a que apodrece: um refator que troque o
// dialeto de BRE para ERE, ou que pare de fechar a janela da prova no consumo,
// deixa os 65 casos verdes se nenhum deles depender daquela linha.
//
// Este runner responde a segunda. Para cada decisao load-bearing da guarda ele
// planta o defeito NO FONTE DELA e exige que o controle negativo fique VERMELHO.
// Mutante que sobrevive e decisao sem assercao -- ou decisao que nao precisava
// existir.
//
// A IRONIA DELIBERADA, E A RAZAO DE O PLACAR VALER
// ------------------------------------------------
// Isto e exatamente o mecanismo que a issue trata, um nivel acima: se o `de` de
// um mutante aqui parar de casar no fonte da guarda, `String.replace` nao troca
// nada, o controle negativo roda sobre a guarda INTACTA, sai verde -- e o
// mutante seria dado por VIVO (ou por morto, dependendo do sinal) medindo nada.
// Por isso o runner CONFERE cada `de` antes de mutar e exige que apareca
// EXATAMENTE UMA vez: zero e ancora morta, mais de uma e ancora ambigua, e
// `String.replace` trocaria a primeira ocorrencia, mutando um lugar que o nome
// do mutante nao descreve. E a trava que o `mede-ancora-ambigua.mjs` cobra dos
// outros runners, aplicada a este.
//
// TUDO NUMA SOMBRA EM /tmp, SEM `trap`
// ------------------------------------
// O repositorio inteiro (menos `.git`, `node_modules` e os `.tmp-*`) e copiado
// UMA vez para um `mkdtempSync`, e a mutacao acontece la. Nao ha nada para
// restaurar: morrer no meio -- SIGTERM, SIGKILL, timeout do runner -- nao deixa
// mutante gravado em `scripts/`. O cabecalho de `check-mutacao-no-lugar.mjs`
// mede por que o remedio nao e um handler de sinal (o laco e sincrono, e o
// handler so roda quando o event loop recebe o controle, o que nunca acontece),
// e e a regra que aquela guarda cobra de todo runner novo.
//
// O CONTROLE POSITIVO E O PRIMEIRO, E NAO E CERIMONIA
// ---------------------------------------------------
// A sombra NAO MUTADA tem de rodar o controle negativo e sair 0. Se ela sair
// vermelha -- por um caminho que a copia quebrou, por `node_modules` ausente,
// por qualquer coisa -- entao TODO mutante "morre", o placar sai 12/12 perfeito
// e nao mediu nada. Suite vermelha faz todo controle negativo passar vacuo, e um
// placar perfeito e o disfarce mais confortavel desse estado.
// =====================================================

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const GUARDA = "scripts/check-sed-dos-workflows.mjs";
const CONTROLE = "scripts/test-sed-dos-workflows.mjs";

/**
 * Um mutante por decisao da guarda. `de` tem de casar EXATAMENTE uma vez no
 * fonte dela.
 */
const MUTANTES = [
  {
    nome: "dialeto_sempre_ere",
    porque:
      "o motivo numero um da issue: `sed` sem `-E` usa BRE, onde `(` e literal. " +
      "Medir em ERE faz `Boolean(categoria)` virar grupo de captura e a guarda confere um padrao que o `sed` nao usa",
    de: `spawnSync("grep", [ere ? "-aEc" : "-ac", "-e", padrao, "--", arquivo], {`,
    para: `spawnSync("grep", ["-aEc", "-e", padrao, "--", arquivo], {`,
  },
  {
    nome: "dialeto_sempre_bre",
    porque: "o outro lado: ignorar o `-E` de um `sed` que pediu ERE",
    de: `spawnSync("grep", [ere ? "-aEc" : "-ac", "-e", padrao, "--", arquivo], {`,
    para: `spawnSync("grep", ["-ac", "-e", padrao, "--", arquivo], {`,
  },
  {
    nome: "ancora_morta_absolvida",
    porque: "zero linha casada deixa de ser ancora morta -- a guarda perde a razao de existir",
    de: `estado: medida.casou > 0 ? "CASOU" : "ANCORA_MORTA",`,
    para: `estado: medida.casou >= 0 ? "CASOU" : "ANCORA_MORTA",`,
  },
  {
    nome: "padrao_como_literal",
    porque:
      "o erro do primeiro passe da HMO-199: conferir o padrao como TEXTO. " +
      "Da falso negativo em `--success: [0-9.]* [0-9.]*%` e nos outros dois regex da arvore",
    de: `  const r = spawnSync("grep", [ere ? "-aEc" : "-ac", "-e", padrao, "--", arquivo], {`,
    para: `  const r = spawnSync("grep", [ere ? "-aEcF" : "-acF", "-e", padrao, "--", arquivo], {`,
  },
  {
    nome: "variavel_de_shell_nao_resolvida",
    porque: "sem expandir `$REGRAS`/`$TELA` a guarda nao acha arquivo nenhum e vira vacua",
    de: `    const v = valores.get(nome);
    if (v === undefined || v === null) { pendentes.push(nome); return todo; }
    return v;`,
    para: `    const v = valores.get(nome);
    if (v === undefined || v === null) { pendentes.push(nome); return todo; }
    return todo;`,
  },
  {
    nome: "continuacao_de_linha_ignorada",
    porque:
      "o `sed` do `env-preview` tem o alvo na linha de baixo; sem emendar, a guarda " +
      "lia `ALVO AUSENTE: \\` -- falso vermelho da guarda que existe para acabar com falso vermelho",
    de: `    while (/\\\\$/.test(texto) && i + 1 < brutas.length) {`,
    para: `    while (false && i + 1 < brutas.length) {`,
  },
  {
    nome: "barra_invertida_do_alvo_mantida",
    porque:
      "o alvo da rota de serie e escrito `\\[id\\]`; sem desescapar, a guarda procura " +
      "um arquivo com barra invertida no nome e acusa ALVO AUSENTE sobre arquivo que existe",
    de: `  return v.replace(/\\\\(.)/g, "$1");`,
    para: `  return v;`,
  },
  {
    nome: "prova_local_nao_cobrada",
    porque: "a segunda afirmacao da guarda desligada: `sed` sem prova local volta a passar",
    de: `    } else if (!a.temProvaLocal) {`,
    para: `    } else if (false) {`,
  },
  {
    nome: "janela_da_prova_nao_fecha_no_consumo",
    porque:
      "prova que chega DEPOIS de a suite rodar nao distingue nada -- a suite ja leu a " +
      "fonte intacta e ja passou. Sem fechar a janela, um `cmp` no fim do passo absolve o bloco inteiro",
    de: `      if (ehConsumo(t)) break;`,
    para: `      if (false) break;`,
  },
  {
    nome: "prova_de_um_sed_vale_para_o_seguinte",
    porque:
      "a ressalva que a propria issue fez sobre `cartoes.yml`: 15 mutacoes e UMA prova. " +
      "Sem fechar a janela no `sed` de baixo, uma conferencia absolve a cadeia toda",
    de: `      if (ehLinhaDeSed(t)) break;
      if (MARCAS_DE_PROVA.some((r) => r.test(t))) { provado = true; por = "marca de prova na janela"; break; }`,
    para: `      if (MARCAS_DE_PROVA.some((r) => r.test(t))) { provado = true; por = "marca de prova na janela"; break; }`,
  },
  {
    nome: "preconferencia_vaza_para_o_sed_seguinte",
    porque: "a mesma coisa pelo lado de tras: a pre-conferencia de um `sed` nao prova o de baixo",
    de: `      if (ehLinhaDeSed(t) || ehConsumo(t)) break;
      if (/grep -c/.test(t)) { prechecado = true; break; }`,
    para: `      if (/grep -c/.test(t)) { prechecado = true; break; }`,
  },
  {
    nome: "funcao_que_nao_prova_conta_como_prova",
    porque:
      "uma `planta()` que so muta, sem conferir, passaria a absolver todo `sed` que a chama -- " +
      "a guarda confiaria no NOME da funcao em vez do corpo dela",
    de: `  const queProvam = funcoes.filter((f) => f.prova);`,
    para: `  const queProvam = funcoes;`,
  },
  {
    nome: "forma_desconhecida_ignorada",
    porque:
      "uma forma de `sed` que a guarda nao sabe ler e, no boletim, indistinguivel de um `sed` " +
      "em ordem. Ignora-la calada e o jeito de a guarda ficar vacua num `sed` novo",
    de: `    } else if (a.estado === "FORMA_DESCONHECIDA") {`,
    para: `    } else if (false) {`,
  },
  {
    nome: "controle_positivo_do_conjunto_vazio",
    porque:
      "varredura que nao acha `sed` nenhum imprime boletim limpo. Sem este `exit`, mover o " +
      "diretorio de workflow ou mudar a forma do comando sai como 'tudo em ordem'",
    de: `  if (achados.length === 0) {`,
    para: `  if (false) {`,
  },
];

// -----------------------------------------------------------------------------

const sombra = mkdtempSync(join(tmpdir(), "hmo231-mutantes-"));
process.on("exit", () => { try { rmSync(sombra, { recursive: true, force: true }); } catch {} });

console.log(`sombra: ${sombra}`);
cpSync(RAIZ, sombra, {
  recursive: true,
  filter: (src) => {
    const rel = src.slice(RAIZ.length);
    return !/(^|\/)(\.git|node_modules|\.next)(\/|$)/.test(rel) && !/(^|\/)\.tmp-/.test(rel);
  },
});

const fonteOriginal = readFileSync(join(sombra, GUARDA), "utf8");

/** Roda o controle negativo na sombra. Devolve o codigo de saida. */
function rodarControle() {
  const r = spawnSync("node", [CONTROLE], { cwd: sombra, encoding: "utf8" });
  return { status: r.status, saida: (r.stdout || "") + (r.stderr || "") };
}

// O CONTROLE POSITIVO, PRIMEIRO.
const positivo = rodarControle();
if (positivo.status !== 0) {
  console.error("::error::A sombra NAO MUTADA reprova o controle negativo. Todo mutante 'morreria' e o placar seria vacuo.");
  console.error(positivo.saida.split("\n").slice(-25).join("\n"));
  process.exit(1);
}
console.log("controle positivo: a sombra intacta passa o controle negativo (exit 0)\n");

let mortos = 0;
const vivos = [];

for (const m of MUTANTES) {
  // A ANCORA, ANTES DE MUTAR. Exatamente uma ocorrencia: zero e ancora morta,
  // mais de uma e ambigua e `replace` trocaria so a primeira.
  const n = fonteOriginal.split(m.de).length - 1;
  if (n !== 1) {
    console.error(
      `::error::ancora do mutante \`${m.nome}\` aparece ${n} vez(es) em ${GUARDA} -- ` +
        `${n === 0 ? "ANCORA MORTA" : "ANCORA AMBIGUA"}. Conserte o \`de\` deste mutante; sem isso ele mediria a guarda INTACTA.`,
    );
    process.exit(1);
  }

  writeFileSync(join(sombra, GUARDA), fonteOriginal.replace(m.de, m.para));
  const r = rodarControle();

  if (r.status !== 0) {
    mortos++;
    const casos = (r.saida.match(/^\s*FALHA .*$/gm) || []).map((l) => l.trim().replace(/^FALHA\s*/, ""));
    console.log(`  MORTO     ${m.nome}`);
    console.log(`            ${casos.length ? casos.slice(0, 2).join(" | ") : "(reprovou sem caso nomeado)"}`);
  } else {
    vivos.push(m);
    console.log(`  VIVO      ${m.nome}  <-- nenhum caso do controle negativo depende desta decisao`);
    console.log(`            ${m.porque}`);
  }
}

writeFileSync(join(sombra, GUARDA), fonteOriginal);

console.log(`\n${mortos}/${MUTANTES.length} mortos`);
if (vivos.length) {
  console.error("");
  for (const m of vivos) {
    console.error(`::error::mutante VIVO: ${m.nome} -- ${m.porque}`);
  }
  console.error(
    `${vivos.length} mutante(s) sobreviveram: ha decisao na guarda que nenhum caso de ` +
      `${CONTROLE} mede. Acrescente o caso, ou tire a decisao.`,
  );
  process.exit(1);
}
console.log("Toda decisao load-bearing da guarda tem um caso que a mede.");
