#!/usr/bin/env node
// =====================================================
// A ANCORA DO `sed` DOS WORKFLOWS: todo padrao plantado casa no arquivo citado
// =====================================================
// Roda com:  npm run check-sed-dos-workflows
//
// POR QUE ISTO EXISTE (HMO-231, derivada da HMO-199)
// --------------------------------------------------
// Um controle negativo de CI planta um defeito por `sed -i` e exige que a suite
// reprove. O defeito do mecanismo e que `sed -i` cujo padrao NAO CASA **sai 0 e
// nao muda nada**: a suite seguinte roda a fonte intacta, passa -- corretamente
// -- e o `if` do controle le esse verde como "a suite nao pegou o defeito".
//
// O custo medido: a HMO-199 contou **57 runs vermelhos seguidos**, na main
// inclusive, acusando codigo correto, e NOVE issues abertas em 24h pelo mesmo
// defeito (HMO-205, 212, 213, 214, 217, 222, 223, 229, 230) -- cada uma por um
// run diferente que viu o vermelho de passagem. Nenhuma pegou a causa, porque o
// vermelho aponta para a suite, e o defeito esta num `sed` dentro de um YAML.
//
// A ancora apodrece a cada refatoracao BEM FEITA: quem dedenta uma linha, troca
// um `padding` por variavel de safe-area ou renomeia um identificador nao tem
// motivo nenhum para procurar um `sed` dentro de `.github/workflows/`. Foi assim
// que a HMO-185 matou a ancora do `menu-mobile`, consertada pelo PR #136 -- UM
// caso. Esta guarda fecha a classe: ela reprova no PR que quebra a ancora, em
// vez de dias depois, no vermelho da main.
//
// O QUE ELA AFIRMA, E SAO DUAS COISAS
// -----------------------------------
// 1. ANCORA VIVA: o padrao casa **pelo menos uma linha** do arquivo que o
//    proprio comando cita. Zero linha = ancora MORTA = o mutante mediria a
//    fonte intacta.
// 2. PROVA LOCAL: entre cada `sed` e a suite que ele deveria reprovar existe um
//    `cmp -s`/`diff -q`/`git diff --quiet`/`grep -q`/`grep -cF` que afirma que
//    o arquivo MUDOU, com mensagem propria.
//
// As duas, e nao uma: a (1) le a arvore de HOJE, no PR, e e o que pega a
// refatoracao que mata a ancora; a (2) mede no momento em que o mutante e
// plantado, e e a unica que pega o `sed` que deixa de casar por algo que nao
// esta no padrao -- um `cp` que nao rodou, um alvo que um passo anterior
// reescreveu, ou um padrao dinamico que a (1) nao sabe conferir de fora.
//
// Medido ao escrever isto: dos 148 `sed -i`, 75 ja tinham prova local e 73 nao.
// Os 73 ganharam a sua, entao a divida e ZERO e a exigencia nao precisa de
// lista de excecao -- ver "POR QUE ELA NAO TEM LISTA DE EXCECAO" abaixo.
//
// DIALETO: `grep` EM BRE, QUE E O DIALETO DO `sed` -- NAO `includes()`, NAO ERE
// ---------------------------------------------------------------------------
// Primeira armadilha, e foi o erro do primeiro passe da HMO-199: conferir o
// padrao como TEXTO LITERAL. Estes tres padroes da arvore sao regex, e um
// `includes()` acusa falso negativo nos tres --
//
//     ^      </Link>$                       (ancoras ^ e $)
//     --success: [0-9.]* [0-9.]*%           (classe e quantificador)
//     ^/\.tmp-recorrencia-edicao/$          (ponto escapado)
//
// Segunda armadilha, mais sutil: o dialeto NAO e ERE. `sed` sem `-E` usa **BRE**,
// onde `(`, `)`, `{`, `}`, `+`, `?` e `|` sao LITERAIS. A arvore depende disso:
// `s#  return Boolean(categoria) \&\& linha.category_id === categoria;#` so casa
// porque `(` e literal em BRE. Compilado como ERE, `Boolean(categoria)` seria um
// grupo de captura e o `(` desapareceria do padrao -- a guarda daria por
// casada uma ancora que o `sed` nao casa, ou o contrario.
//
// Por isso a medicao nao reimplementa regex nenhuma: ela chama `grep`, que usa
// **a mesma BRE do `sed`** (e `grep -E` quando o comando traz `-E`). O oraculo e
// o proprio motor, entao a guarda nao pode divergir do dialeto que ela mede.
// `-a` porque `grep` trata arquivo com byte NUL como binario e devolve zero
// linha sem ele -- veja `check-mutacao-no-lugar.mjs`, que apanhou disso.
//
// VARIAVEL DE SHELL E RESOLVIDA, E QUANDO NAO DA, E DECLARADO
// -----------------------------------------------------------
// Varios passos escrevem `REGRAS=lib/x.ts` e depois `sed -i '...' $REGRAS`; sem
// resolver, a guarda nao acha arquivo nenhum e vira vacua. Ela le as atribuicoes
// do proprio corpo do passo, na ordem, e expande `$VAR` e `${VAR}`.
//
// O que ela NAO consegue resolver e declarado como tal, nunca escondido: os
// runners "em bloco" fazem `for ... ; do sed -i "s@$de@$para@" "$arquivo"`, onde
// o padrao sai de uma LISTA percorrida em laco. Para esses nao existe padrao
// estatico para conferir, e a unica prova possivel e a LOCAL -- que a guarda
// cobra de todo `sed`, dinamico ou nao.
//
// POR QUE ELA NAO TEM LISTA DE EXCECAO
// ------------------------------------
// Lista a mao vence pelo cansaco: quem quebra a ancora acrescenta o nome e
// segue. Todo veredito aqui sai do CODIGO -- do texto do workflow e do arquivo
// alvo. Ela so pode ser assim porque a divida foi a ZERO antes de a exigencia
// entrar: uma guarda que nasce reprovando 73 `sed` seria desligada por uma
// lista de excecao antes de pegar o primeiro `sed` novo.
//
// E ELA TEM CONTROLE NEGATIVO PROPRIO
// -----------------------------------
// `npm run test:sed-dos-workflows` quebra um padrao de proposito e exige que
// esta guarda reprove com a mensagem de ancora, e que o MESMO padrao quebrado
// sem a guarda volte a mentir (o `sed` sai 0 e nao muda nada). Foi assim que o
// PR #136 provou que a guarda e quem trabalha, e nao a mensagem nova.
// =====================================================

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const DIR_WORKFLOWS = join(RAIZ, ".github", "workflows");

/**
 * Marcas de prova LOCAL que um passo pode trazer depois do `sed`. As formas que
 * a arvore JA usa, da mais forte para a mais fraca: comparacao com a copia
 * intacta (`cmp -s` ou `diff -q` contra o `.orig`, que provam que o arquivo
 * MUDOU), `CASOU=$(grep -cF ...)` exigindo exatamente 1, e `grep -q` no
 * resultado da mutacao.
 *
 * `diff -q` nao e redundante com `cmp -s`: os passos "A verificacao das acoes
 * sabe falhar" e "A sonda do gesto sabe falhar" escrevem
 * `if diff -q "$1.orig" "$1" > /dev/null` dentro de `mutou()`, e sem esta
 * entrada a guarda acusava os 12 `sed` deles de descobertos -- 12 falsos
 * vermelhos sobre passos que provam cada mutante. Marca de prova que falta
 * nesta lista nao e lacuna de cobertura: e a guarda mandando consertar o que
 * ja esta certo.
 *
 * `git diff --quiet` e a forma dos cinco blocos que restauram com
 * `git checkout --` em vez de guardar `.orig` (color-tokens, scroll
 * horizontal, area util, artefatos, pwa-assets): sem copia intacta para
 * comparar, quem responde "o arquivo mudou?" e o proprio git.
 */
const MARCAS_DE_PROVA = [/cmp -s/, /diff -q/, /git diff --quiet/, /CASOU=/, /grep -cF/, /grep -q/];

// -----------------------------------------------------------------------------
// Leitura do workflow: passos, atribuicoes de shell e as linhas de `sed -i`
// -----------------------------------------------------------------------------

/**
 * Separa um YAML de workflow em passos. Nao usa parser de YAML de proposito: o
 * que interessa e o TEXTO do `run:`, que um parser entregaria igual, e a arvore
 * nao tem dependencia de YAML para scripts.
 */
export function passosDoWorkflow(texto, arquivo) {
  const linhas = emendarContinuacoes(texto.split("\n"));
  const passos = [];
  let atual = null;
  for (const { texto: linha, linha: n } of linhas) {
    const m = /^\s*- name:\s*(.*)$/.exec(linha);
    if (m) {
      atual = { arquivo, nome: nomeLimpo(m[1]), linhaDoNome: n, corpo: [] };
      passos.push(atual);
      continue;
    }
    if (atual) atual.corpo.push({ texto: linha, linha: n });
  }
  return passos;
}

/**
 * Junta a continuacao de linha do shell (`\` no fim) numa linha so, guardando o
 * numero da PRIMEIRA -- que e onde o `sed` esta escrito e onde quem le o erro
 * vai procurar.
 *
 * Sem isto a guarda mentia por omissao e por acusacao: `sed -i 's|...|...|' \`
 * com o alvo na linha seguinte era lido como `sed` sem alvo, e o passo
 * `env-preview` saia como "ALVO AUSENTE: \" -- um falso vermelho da guarda que
 * existe para acabar com falso vermelho.
 */
function emendarContinuacoes(brutas) {
  const saida = [];
  let i = 0;
  while (i < brutas.length) {
    let texto = brutas[i];
    const n = i + 1;
    while (/\\$/.test(texto) && i + 1 < brutas.length) {
      texto = texto.slice(0, -1).replace(/\s+$/, "") + " " + brutas[i + 1].trim();
      i++;
    }
    saida.push({ texto, linha: n });
    i++;
  }
  return saida;
}

function nomeLimpo(bruto) {
  const t = bruto.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1);
  }
  return t;
}

/** `true` quando a linha e comentario de shell ou de YAML (ou so espaco). */
function ehComentario(texto) {
  return /^\s*#/.test(texto);
}

/**
 * Nomes que um laco introduz (`for X in ...`, `while read X`). O padrao que sai
 * de um deles nao tem valor estatico, e e por isso que a guarda pede a prova
 * local em vez de inventar um valor.
 */
function nomesDeLaco(texto) {
  const nomes = [];
  const forr = /\bfor\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/.exec(texto);
  if (forr) nomes.push(forr[1]);
  const read = /\bread\s+(-r\s+)?([A-Za-z_][A-Za-z0-9_]*)/.exec(texto);
  if (read) nomes.push(read[2]);
  return nomes;
}

/** Uma linha de `sed -i` de verdade (nao prosa que o cita, nao comentario). */
function ehLinhaDeSed(texto) {
  return !ehComentario(texto) && /(?:^|[\s;&|(])sed\s+(-[A-Za-z]+\s+)*-i\b/.test(texto);
}

/** Linha que CONSOME a mutacao: daqui para a frente, provar nao serve mais. */
function ehConsumo(texto) {
  return /\bnpm run |\bnode scripts\/|\bnpx /.test(texto) && !ehComentario(texto);
}

/**
 * A PROVA LOCAL, MEDIDA POR `sed` E NAO POR PASSO.
 *
 * Esta e a correcao da ressalva que a propria HMO-231 fez: deteccao por PASSO
 * da o veredito errado nos dois sentidos. O passo de `color-tokens` tem um
 * `grep -q` -- e ele prova o segundo `sed`, nao o primeiro. O passo de
 * `cartoes` aparecia como "tem guarda" com 15 mutacoes e UMA prova.
 *
 * Tres formas contam como prova deste `sed`, e a terceira e a que uma leitura
 * ingenua perde:
 *
 *   1. marca de prova na janela entre este `sed` e o consumo da mutacao;
 *   2. este `sed` esta DENTRO de uma funcao que prova (uma `planta()` que muta
 *      e confere no mesmo corpo);
 *   3. a janela chama uma funcao do passo cujo corpo prova -- o idioma
 *      `mutou $REGRAS 1` depois do `sed`, que e o mais usado na arvore (sete
 *      `mutou()`, mais `planta()`, `estragar()`, `desligar()`, `reprova()`).
 *
 * Sem a forma 3 esta medicao acusaria 126 de 148 `sed` descobertos, e os 25 do
 * passo `ajuste-de-saldo` estariam entre eles -- um passo que prova CADA
 * mutante com `cmp -s` dentro de `mutou()`. Era falso vermelho da guarda que
 * existe para acabar com falso vermelho.
 *
 * A janela fecha no CONSUMO (`npm run`, `node scripts/`), nao no fim do passo:
 * prova que chega depois de a suite rodar nao distingue mais nada -- a suite ja
 * leu a fonte intacta e ja passou.
 */
export function provaLocalDosSeds(corpo) {
  // Funcoes do passo, com o corpo, para saber quais PROVAM.
  const funcoes = [];
  for (let i = 0; i < corpo.length; i++) {
    const m = /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{/.exec(corpo[i].texto);
    if (!m) continue;
    const fecho = new RegExp(`^${m[1]}\\}`);
    let fim = corpo.length - 1;
    for (let j = i + 1; j < corpo.length; j++) {
      if (fecho.test(corpo[j].texto)) { fim = j; break; }
    }
    const corpoDaFuncao = corpo.slice(i + 1, fim).map((l) => l.texto).join("\n");
    funcoes.push({ nome: m[2], inicio: i, fim, prova: MARCAS_DE_PROVA.some((r) => r.test(corpoDaFuncao)) });
  }
  const queProvam = funcoes.filter((f) => f.prova);
  const chamada = queProvam.length
    ? new RegExp(`(?:^|[\\s;&|(])(?:${queProvam.map((f) => f.nome).join("|")})(?![\\w-])`)
    : null;

  const porLinha = new Map();
  for (let i = 0; i < corpo.length; i++) {
    if (!ehLinhaDeSed(corpo[i].texto)) continue;

    // Forma 2: o `sed` mora dentro de uma funcao que prova.
    if (queProvam.some((f) => i > f.inicio && i < f.fim)) {
      porLinha.set(corpo[i].linha, { provado: true, por: "funcao que muta e confere" });
      continue;
    }

    // Forma 4: a PRE-conferencia, que e a mais forte das formas e por isso nao
    // pode ser recusada. `lancamento.yml` escreve
    // `test "$(grep -c '^      </Link>$' $LISTA)" = "1"` ANTES do `sed`: ela
    // nao afirma so que a ancora existe, afirma que existe UMA vez -- o que a
    // conferencia de depois nao distingue (`String.replace` troca a primeira
    // ocorrencia, e um `de` ambiguo muta um lugar que o nome do mutante nao
    // descreve; e o assunto do `mede-ancora-ambigua.mjs`).
    //
    // Sem esta forma a guarda reprovaria os dois `sed` do mutante 10 de
    // `cartoes` -- que sao justamente os melhor provados do arquivo. Guarda que
    // manda consertar o que esta certo e desligada no mes seguinte.
    let prechecado = false;
    for (let j = i - 1; j >= 0; j--) {
      const t = corpo[j].texto;
      if (ehComentario(t)) continue;
      if (ehLinhaDeSed(t) || ehConsumo(t)) break;
      if (/grep -c/.test(t)) { prechecado = true; break; }
    }
    if (prechecado) {
      porLinha.set(corpo[i].linha, { provado: true, por: "pre-conferencia da ancora antes do sed" });
      continue;
    }

    // Formas 1 e 3, na janela ate o consumo.
    let provado = false;
    let por = null;
    for (let j = i + 1; j < corpo.length; j++) {
      const t = corpo[j].texto;
      if (ehComentario(t)) continue;
      if (ehLinhaDeSed(t)) break;
      if (MARCAS_DE_PROVA.some((r) => r.test(t))) { provado = true; por = "marca de prova na janela"; break; }
      if (chamada && chamada.test(t)) { provado = true; por = "chamada de funcao que prova"; break; }
      if (ehConsumo(t)) break;
    }
    porLinha.set(corpo[i].linha, { provado, por });
  }
  return porLinha;
}

/**
 * Atribuicao simples de shell, `VAR=valor`. Valor com substituicao de comando
 * (`$(...)` ou backtick) nao e um valor: fica sem resolucao, e quem usa cai no
 * ramo dinamico.
 */
function atribuicao(texto) {
  const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(texto);
  if (!m) return null;
  const valor = m[2].trim();
  if (/\$\(|`/.test(valor)) return { nome: m[1], valor: null };
  return { nome: m[1], valor: desaspar(valor) };
}

/**
 * Tira as aspas de uma palavra do shell. Numa palavra SEM aspas o shell tambem
 * come a barra invertida, e a arvore depende disso: o alvo da rota de serie e
 * escrito `app/api/scheduled-transactions/\[id\]/route.ts`, com os colchetes
 * escapados, e sem desescapar a guarda procurava um arquivo com `\[id\]` no
 * nome e dava ALVO AUSENTE sobre um arquivo que existe.
 */
function desaspar(v) {
  if (v.length >= 2 && v[0] === "'" && v[v.length - 1] === "'") return v.slice(1, -1);
  if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') return v.slice(1, -1);
  return v.replace(/\\(.)/g, "$1");
}

// -----------------------------------------------------------------------------
// Recorte do comando `sed -i`
// -----------------------------------------------------------------------------

/**
 * Recorta a expressao e o alvo de um `sed -i`. Devolve `null` quando a linha nao
 * e um comando de `sed -i` (prosa que o cita, por exemplo). Devolve
 * `{ erro }` quando E um comando mas esta fora das formas conhecidas -- e isso
 * REPROVA, em vez de ser ignorado: forma nova sem medicao e como `sed` sem
 * prova, e o jeito de esta guarda ficar vacua calada.
 */
export function recortarSed(texto) {
  const m = /(?:^|[\s;&|(])sed\s+(-[A-Za-z]+\s+)*-i\b/.exec(texto);
  if (!m) return null;
  let resto = texto.slice(m.index + m[0].length);

  // As opcoes vem dos DOIS lados do `-i` -- `sed -E -i` e `sed -i -E` sao a
  // mesma coisa para o `sed`, e colher so as da esquerda fazia a guarda medir
  // em BRE um comando escrito em ERE. Foi o caso 14 do controle negativo que
  // pegou isto; antes dele a guarda errava o dialeto calada.
  const opcoes = m[0].match(/-[A-Za-z]+/g) || [];
  for (;;) {
    const o = /^\s+(-[A-Za-z]+)(?=\s)/.exec(resto);
    if (!o) break;
    opcoes.push(o[1]);
    resto = resto.slice(o[0].length);
  }
  // `-i` nao conta: a letra que interessa e `E` (POSIX) ou `r` (sinonimo GNU),
  // e `-i` nao carrega nenhuma das duas.
  const flags = opcoes.filter((o) => o !== "-i").join("");
  const ere = flags.includes("E") || flags.includes("r");

  const aberto = /^\s*(['"])/.exec(resto);
  if (!aberto) return { erro: "expressao do `sed` nao vem entre aspas" };
  const aspa = aberto[1];
  let i = aberto[0].length;
  let expressao = "";
  let fechou = false;
  while (i < resto.length) {
    const c = resto[i];
    // Em aspas simples o shell nao interpreta barra invertida; em aspas duplas,
    // `\"` e uma aspa literal dentro da expressao.
    if (aspa === '"' && c === "\\" && i + 1 < resto.length) {
      expressao += resto[i + 1] === '"' ? '"' : c + resto[i + 1];
      i += 2;
      continue;
    }
    if (c === aspa) { fechou = true; i++; break; }
    expressao += c;
    i++;
  }
  if (!fechou) return { erro: "expressao do `sed` sem aspa de fechamento" };

  const alvo = resto.slice(i).trim().split(/\s+/)[0] || "";
  if (!alvo) return { erro: "`sed -i` sem arquivo alvo" };
  return { expressao, alvo: desaspar(alvo), ere };
}

/**
 * O PADRAO de uma expressao de `sed`. Cobre `s<D>padrao<D>troca<D>flags` com
 * qualquer delimitador (a arvore usa `/`, `#`, `|` e `@`) e os enderecos de
 * linha `/padrao/d`. Respeita barra invertida: um delimitador escapado faz
 * parte do padrao, e e por isso que `s#...\#...#` nao pode ser quebrado por
 * `split`.
 */
export function padraoDaExpressao(expressao) {
  const e = expressao.trim();

  if (e.startsWith("s") && e.length > 1) {
    const d = e[1];
    if (/[A-Za-z0-9\\\s]/.test(d)) return { erro: `delimitador invalido em ${JSON.stringify(e.slice(0, 12))}` };
    const fim = fimDoCampo(e, 2, d);
    if (fim < 0) return { erro: "substituicao sem delimitador de fechamento" };
    return { padrao: e.slice(2, fim) };
  }

  if (e.startsWith("/")) {
    const fim = fimDoCampo(e, 1, "/");
    if (fim < 0) return { erro: "endereco de linha sem `/` de fechamento" };
    return { padrao: e.slice(1, fim) };
  }

  return { erro: `comando de \`sed\` nao reconhecido: ${JSON.stringify(e.slice(0, 20))}` };
}

function fimDoCampo(texto, inicio, delim) {
  for (let i = inicio; i < texto.length; i++) {
    if (texto[i] === "\\") { i++; continue; }
    if (texto[i] === delim) return i;
  }
  return -1;
}

/**
 * Expande `$VAR` e `${VAR}`. Devolve `{ pendentes }` com os nomes que nao tem
 * valor conhecido -- e a presenca de QUALQUER pendente que manda o `sed` para o
 * ramo dinamico, onde a cobranca passa a ser a prova local.
 */
export function expandir(texto, valores) {
  const pendentes = [];
  const expandido = texto.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (todo, a, b) => {
    const nome = a || b;
    const v = valores.get(nome);
    if (v === undefined || v === null) { pendentes.push(nome); return todo; }
    return v;
  });
  return { expandido, pendentes };
}

// -----------------------------------------------------------------------------
// O oraculo: `grep` no dialeto do proprio `sed`
// -----------------------------------------------------------------------------

/**
 * Quantas LINHAS do arquivo o padrao casa, medido pelo `grep` -- BRE por
 * padrao, ERE quando o `sed` trouxe `-E`/`-r`. Conta linha, nao ocorrencia:
 * para "a ancora morreu?" basta `>= 1`, e a ambiguidade de ocorrencia e assunto
 * do `mede-ancora-ambigua.mjs`, para os runners.
 */
export function linhasQueCasam(padrao, arquivo, ere) {
  const r = spawnSync("grep", [ere ? "-aEc" : "-ac", "-e", padrao, "--", arquivo], {
    encoding: "utf8",
  });
  if (r.error) return { erro: `grep nao rodou: ${r.error.message}` };
  if (r.status === 2) return { erro: `grep recusou o padrao: ${(r.stderr || "").trim()}` };
  return { casou: Number((r.stdout || "0").trim()) || 0 };
}

// -----------------------------------------------------------------------------
// A varredura
// -----------------------------------------------------------------------------

export function varrer({ raiz = RAIZ, dirWorkflows = DIR_WORKFLOWS } = {}) {
  const achados = [];
  const arquivos = readdirSync(dirWorkflows)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .sort();

  for (const nomeArq of arquivos) {
    const caminho = join(dirWorkflows, nomeArq);
    const rel = join(".github", "workflows", nomeArq);
    const passos = passosDoWorkflow(readFileSync(caminho, "utf8"), rel);

    for (const passo of passos) {
      const provas = provaLocalDosSeds(passo.corpo);
      const valores = new Map();

      for (const { texto, linha } of passo.corpo) {
        if (ehComentario(texto)) continue;

        for (const nome of nomesDeLaco(texto)) valores.set(nome, null);
        const at = atribuicao(texto);
        if (at) valores.set(at.nome, at.valor);

        const corte = recortarSed(texto);
        if (!corte) continue;

        const prova = provas.get(linha) || { provado: false, por: null };
        const base = {
          arquivo: rel,
          linha,
          passo: passo.nome,
          temProvaLocal: prova.provado,
          provadoPor: prova.por,
          texto: texto.trim(),
        };
        if (corte.erro) { achados.push({ ...base, estado: "FORMA_DESCONHECIDA", motivo: corte.erro }); continue; }

        const expr = expandir(corte.expressao, valores);
        const alvo = expandir(corte.alvo, valores);
        const pendentes = [...new Set([...expr.pendentes, ...alvo.pendentes])];

        if (pendentes.length) {
          achados.push({ ...base, estado: "DINAMICO", pendentes, alvo: alvo.expandido });
          continue;
        }

        const pad = padraoDaExpressao(expr.expandido);
        if (pad.erro) { achados.push({ ...base, estado: "FORMA_DESCONHECIDA", motivo: pad.erro }); continue; }

        const caminhoAlvo = join(raiz, alvo.expandido);
        if (!existsSync(caminhoAlvo) || !statSync(caminhoAlvo).isFile()) {
          achados.push({ ...base, estado: "ALVO_AUSENTE", alvo: alvo.expandido, padrao: pad.padrao });
          continue;
        }

        const medida = linhasQueCasam(pad.padrao, caminhoAlvo, corte.ere);
        if (medida.erro) {
          achados.push({ ...base, estado: "FORMA_DESCONHECIDA", motivo: medida.erro, padrao: pad.padrao });
          continue;
        }
        achados.push({
          ...base,
          estado: medida.casou > 0 ? "CASOU" : "ANCORA_MORTA",
          alvo: alvo.expandido,
          padrao: pad.padrao,
          casou: medida.casou,
        });
      }
    }
  }
  return achados;
}

/**
 * Os achados que REPROVAM, com a frase de cada estado. A frase importa tanto
 * quanto o veredito: "o defeito nao foi plantado, corrija o padrao neste
 * workflow" nunca pode sair como "a verificacao passou verde". Um SQLSTATE para
 * dois estados foi o que fez nove runs procurarem no lugar errado.
 */
export function reprovados(achados) {
  const fora = [];
  for (const a of achados) {
    if (a.estado === "ANCORA_MORTA") {
      fora.push({
        ...a,
        frase:
          `ANCORA MORTA: o padrao nao casa NENHUMA linha de ${a.alvo}. O \`sed\` vai sair 0 ` +
          `sem mudar nada, a suite vai rodar a fonte INTACTA e passar, e o controle negativo ` +
          `vai ler esse verde como defeito da suite. CONSERTE O PADRAO NESTE WORKFLOW, nao o codigo.`,
      });
    } else if (a.estado === "ALVO_AUSENTE") {
      fora.push({
        ...a,
        frase: `ALVO AUSENTE: ${a.alvo} nao existe na arvore. O \`sed\` nao muta nada e o controle negativo mede a fonte intacta.`,
      });
    } else if (a.estado === "FORMA_DESCONHECIDA") {
      fora.push({
        ...a,
        frase: `FORMA NAO MEDIDA (${a.motivo}): ensine esta forma a check-sed-dos-workflows.mjs, senao a guarda fica vacua neste \`sed\`.`,
      });
    } else if (!a.temProvaLocal) {
      // Vale para os DOIS: o `sed` de padrao dinamico, que esta guarda nao sabe
      // conferir de fora, e o estatico, que ela confere -- mas confere a arvore
      // de HOJE. A prova local e a que mede no momento em que o mutante e
      // plantado, e e a unica que pega o `sed` que deixa de casar por algo que
      // nao esta no padrao (um `cp` que nao rodou, um alvo reescrito por um
      // passo anterior). As duas respondem perguntas diferentes.
      const porque = a.pendentes
        ? `o padrao vem de ${a.pendentes.map((p) => "$" + p).join(", ")}, que nao tem valor estatico aqui`
        : `a conferencia estatica le a arvore de hoje, nao o momento em que o mutante e plantado`;
      fora.push({
        ...a,
        frase:
          `SEM PROVA LOCAL: ${porque}, e nao ha \`cmp -s\`, \`diff -q\`, \`git diff --quiet\`, ` +
          `\`grep -q\` nem \`grep -cF\` entre este \`sed\` e a suite que ele deveria reprovar. ` +
          `Sem isso, ancora morta sai como verde. O idioma da arvore e uma funcao \`mutou()\` ` +
          `no topo do passo e um \`mutou <alvo> <n>\` depois de cada \`sed\`.`,
      });
    }
  }
  return fora;
}

function principal() {
  const achados = varrer();

  // Controle positivo. Uma varredura que nao acha `sed` nenhum imprime um
  // boletim limpo, e e a forma mais facil de isto mentir: o `sed` pode ter
  // mudado de forma, o diretorio de workflow pode ter sido movido, e o
  // veredito seria "tudo em ordem".
  if (achados.length === 0) {
    console.error("::error::check-sed-dos-workflows nao achou NENHUM `sed -i` nos workflows -- a guarda mediu o conjunto vazio.");
    process.exit(1);
  }

  const porEstado = new Map();
  for (const a of achados) porEstado.set(a.estado, (porEstado.get(a.estado) || 0) + 1);

  const fora = reprovados(achados);

  console.log(`check-sed-dos-workflows: ${achados.length} \`sed -i\` lidos`);
  for (const [estado, n] of [...porEstado].sort()) console.log(`  ${estado}: ${n}`);

  const porForma = new Map();
  for (const a of achados.filter((a) => a.temProvaLocal)) {
    porForma.set(a.provadoPor, (porForma.get(a.provadoPor) || 0) + 1);
  }
  console.log(`  com prova local: ${achados.filter((a) => a.temProvaLocal).length}`);
  for (const [forma, n] of [...porForma].sort((a, b) => b[1] - a[1])) console.log(`    ${forma}: ${n}`);

  if (fora.length) {
    console.error("");
    for (const a of fora) {
      console.error(`::error file=${a.arquivo},line=${a.linha}::${a.frase}`);
      console.error(`  passo:  ${a.passo}`);
      console.error(`  linha:  ${a.texto}`);
      if (a.padrao !== undefined) console.error(`  padrao: ${JSON.stringify(a.padrao)}`);
      console.error("");
    }
    console.error(`${fora.length} \`sed -i\` de workflow nao provam que plantam o defeito.`);
    process.exit(1);
  }

  console.log("Toda ancora de `sed` casa no arquivo que ela cita, e todo `sed` prova que mutou.");
}

// Programa so quando E o programa: importado como modulo (pelo controle
// negativo) ele nao pode rodar nem ler `process.argv`. O driver que disparava
// por "tem argumento" fez o conversor da HMO-262 REESCREVER o arquivo que
// recebia para medir.
if (process.argv[1] && fileURLToPath(new URL(`file://${process.argv[1]}`)).endsWith("check-sed-dos-workflows.mjs")) {
  principal();
}
