#!/usr/bin/env node
// =====================================================
// A ANCORA DO MUTANTE: quantas vezes cada `de` aparece no arquivo que ele muta
// =====================================================
// Roda com:  npm run check-ancora-de-mutante
//            node scripts/mede-ancora-ambigua.mjs [runner.mjs ...]
//            (sem argumento: todos os runners das familias que ele sabe ler)
//
// DE MEDIDOR A GUARDA (HMO-262). O nome do arquivo diz "mede" e diz "ambigua", e
// as duas coisas ficaram estreitas: ele AGORA REPROVA, e reprova os tres estados
// em que uma ancora para de medir -- `de` que aparece 0 vez (MORTA), mais de uma
// (AMBIGUA), ou cujo arquivo nao existe (AUSENTE). O arquivo nao foi renomeado de
// proposito: a conversao dos runners para bloco esta em curso em varias branches
// e um rename aqui colidiria com todas elas.
//
// O caso que fez o zero passar a reprovar esta em `npm run pre-commit`, que e
// onde um rename e feito -- nao no CI, que e onde ele era descoberto meses
// depois.
//
// POR QUE ISTO EXISTE (HMO-328)
// -----------------------------
// A conversao dos runners da familia do painel para o bloco ACRESCENTOU uma
// trava que a familia nao tinha: `de` que aparece mais de uma vez no arquivo e
// mutante invalido. A familia HMO-246 ja tinha essa trava; esta so checava se o
// trecho EXISTE.
//
// A razao da trava: `String.replace(de, para)` troca a PRIMEIRA ocorrencia. Se o
// trecho aparece duas vezes, o mutante muta um lugar que o seu proprio `nome` nao
// descreve. Quando esse outro lugar nao e medido pela suite, o mutante SOBREVIVE
// -- e o placar passa a dizer "nenhuma assercao protege X" sobre um X que nunca
// foi mutado.
//
// MAS ACRESCENTAR TRAVA MUDA O PLACAR, e um placar que muda junto com o
// encanamento e um placar que ninguem consegue comparar com o de ontem. Por isso
// a pergunta "algum `de` de hoje e ambiguo?" foi MEDIDA antes de a trava entrar,
// e nao suposta -- e e isto que mede.
//
// Na familia do painel (HMO-328) a resposta foi "nenhuma": a trava entrou sem
// mexer em veredito nenhum. Na familia TUPLA (HMO-334) foi TRES -- ver a medicao
// datada mais abaixo. E a razao de isto ser um medidor e nao uma nota: a mesma
// pergunta deu respostas diferentes nas duas familias.
//
// POR QUE ELE LE A LISTA EM VEZ DE A REESCREVER
// ---------------------------------------------
// A lista de mutantes e a unica parte de um runner que carrega conhecimento que
// nao esta em nenhum outro lugar. Este arquivo nao copia nenhuma entrada: ele
// recorta o miolo do runner (`mioloDoPainel`, o mesmo recorte que o conversor
// usa) e o IMPORTA como modulo de dados, entao o que ele mede e a lista de
// verdade, e ele nao pode divergir dela.
//
// Medido em 2026-10-07, familia do painel (HMO-328): 72 mutantes nos cinco
// runners, nenhum com ancora ambigua -- e NOVE com ancora MORTA (seis em
// `detalhe-do-painel`, dois em `sobra-ou-falta`, um em `painel-na-tela`), que e
// outro assunto e tem issue propria. Os vereditos dos tres runners convertidos
// pela HMO-328 sao identicos antes e depois da conversao, com esses nove
// inclusive.
//
// Medido em 2026-10-07, as DUAS familias (HMO-334): 292 mutantes em 14 runners,
// TRES com ancora ambigua, os tres em `mutantes-parte-do-grupo` -- porque
// `lib/parte-do-grupo.ts` repete `if (!groupId) return cheio;` em
// `parteConfiguradaDoMembro` e em `parteDoMembro`, e a guarda de status em
// `montarParticipantesPorGrupo` e em `contarMembrosAtivos`. O runner antigo
// mutava a primeira ocorrencia das duas e dava os tres por mortos, sem dizer
// qual funcao havia medido. Os tres `de` foram estendidos para casar so o
// trecho que ele ja mutava; as funcoes GEMEAS seguem sem mutante proprio, e isso
// e uma lacuna de cobertura com issue propria -- nao um defeito da conversao.
//
// O CONTROLE POSITIVO DELE
// ------------------------
// Um medidor que nao acha mutante nenhum imprime "0 ambiguas" e parece um boletim
// limpo -- e a forma mais facil de isto mentir. Por isso ele SAI COM ERRO se um
// runner rendeu zero mutantes, e imprime o total lido por runner: o numero tem de
// casar com o que o proprio runner imprime no fim ("N/N mortos").
// =====================================================

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ehDoPainel,
  mioloDoPainel,
  ehTupla,
  mioloDaTupla,
  elementosDaPrimeiraEntrada,
} from "./converte-mutantes-em-bloco.mjs";

const RAIZ = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

/** Importa um miolo (so declaracoes `const`) como modulo de dados. */
async function listaDoMiolo(miolo) {
  // Nao executa driver nenhum: o miolo termina no `];` da lista.
  const url = `data:text/javascript,${encodeURIComponent(`${miolo}\nexport { mutantes };`)}`;
  return (await import(url)).mutantes;
}

/** A lista de um runner da familia DO PAINEL, ja em `{ nome, arquivo, de }`. */
async function lerMutantesDoPainel(fonte) {
  return listaDoMiolo(mioloDoPainel(fonte).miolo);
}

/**
 * A lista de um runner da familia TUPLA, normalizada para a mesma forma.
 *
 * A ARIDADE VEM DA FORMA DA LISTA (`elementosDaPrimeiraEntrada`) e nao de
 * `aridadeDaTupla`, e a diferenca nao e estilo: `aridadeDaTupla` cruza duas
 * pistas que a conversao APAGA (a `const fontes = new Map`), entao ela lanca
 * justamente nos runners ja convertidos -- que sao a maioria dos que esta
 * varredura precisa ler.
 *
 * Na aridade 3 o alvo e a `const ALVO` do modulo. Pelo NOME, de proposito: a
 * primeira versao disto usava "a primeira constante de arquivo", que em
 * `edicao-de-grupo` e `minha-parte-no-realizado` seria uma escolha entre DUAS
 * (`ALVO` e `TESTE`) decidida pela ordem de declaracao -- certa hoje e por
 * acidente.
 */
async function lerMutantesDaTupla(fonte) {
  const { miolo } = mioloDaTupla(fonte);
  const lista = await listaDoMiolo(miolo);
  const aridade = elementosDaPrimeiraEntrada(miolo);

  if (aridade === 4) {
    return lista.map(([arquivo, nome, de]) => ({ nome, arquivo, de }));
  }
  const mAlvo = /^const ALVO = "([^"]+)";$/m.exec(miolo);
  if (!mAlvo) throw new Error("aridade 3 sem `const ALVO` -- nao sei contra qual arquivo medir");
  return lista.map(([nome, de]) => ({ nome, arquivo: mAlvo[1], de }));
}

// O ARQUIVO QUE CONTEM UM RUNNER DE MENTIRA DENTRO DE UMA STRING.
//
// `mutantes-conferidor-da-conversao.mjs` carrega o FIXTURE dele -- um runner
// completo da familia do painel -- num template literal. Visto de fora, ele casa
// com `ehDoPainel` como qualquer runner de verdade, e a varredura tentava medir
// as ancoras do fixture contra `lib/exemplo.ts`, que nao existe (ENOENT).
//
// E a familia de "sonda que se mede a si mesma": o aparelho entrou no proprio
// censo. Excluir pelo NOME e deliberado -- excluir "todo runner cujo arquivo nao
// existe" calaria justamente o defeito que vale reportar (runner que aponta para
// arquivo apagado).
const APARELHO = new Set([
  "scripts/mutantes-conferidor-da-conversao.mjs",
  // O mesmo caso, na familia tupla: o fixture dele e um runner completo de
  // aridade 4 dentro de um template literal, e as ancoras dele apontam para
  // `lib/exemplo.ts`, que nao existe.
  "scripts/mutantes-conferidor-da-conversao-tupla.mjs",
]);

// OS RUNNERS DE FORMA PROPRIA, com o motivo escrito (HMO-334).
//
// Tres dos cinco que a HMO-335 converteu A MAO -- sem conversor, porque a
// familia tupla so ganhou entrada na tabela depois -- tem cada um uma forma que
// nenhum `recortar` descreve: `orcamento-de-grupo` guarda os alvos num OBJETO
// (`const ALVOS = {`), `semeadura` e `sugestao-de-divisao` mantem no modulo um
// `const original = new Map(...)` que o desenho de bloco nao tem, e a tupla de
// `semeadura` carrega a SUITE como terceiro elemento.
//
// Declarados aqui em vez de filtrados por "tentei e nao deu": um filtro por
// excecao capturada calaria tambem o runner que passou a nao ser legivel por
// defeito, e e isso que esta varredura existe para ver. A trava logo abaixo
// cobra o contrario -- runner tupla fora desta lista TEM de ser legivel.
const FORMA_PROPRIA = new Set([
  "scripts/mutantes-orcamento-de-grupo.mjs",
  "scripts/mutantes-semeadura.mjs",
  "scripts/mutantes-sugestao-de-divisao.mjs",
]);

// O MESMO predicado que o conversor usa para escolher a familia. Escrever o
// criterio a mao aqui ja deu errado uma vez neste arquivo: `const mutantes = [`
// sozinho arrasta os runners da familia "tupla", que precisam de outro
// normalizador -- nao de nenhum.
const FAMILIAS = [
  { nome: "painel", reconhece: ehDoPainel, ler: lerMutantesDoPainel },
  { nome: "tupla", reconhece: ehTupla, ler: lerMutantesDaTupla },
];

function familiaDoArquivo(caminho) {
  const fonte = readFileSync(path.join(RAIZ, caminho), "utf8");
  return FAMILIAS.find((f) => f.reconhece(fonte));
}

const alvos = process.argv.slice(2);
const runners = alvos.length
  ? alvos
  : readdirSync(path.join(RAIZ, "scripts"))
      .filter((f) => /^mutantes-.*\.mjs$/.test(f))
      .map((f) => path.join("scripts", f))
      .filter((f) => !APARELHO.has(f) && !FORMA_PROPRIA.has(f))
      .filter((f) => familiaDoArquivo(f));

let ambiguas = 0;
let ausentes = 0;
let mortas = 0;
let total = 0;
const lidosPorFamilia = { painel: 0, tupla: 0 };

for (const runner of runners) {
  const familia = familiaDoArquivo(runner);
  if (!familia) {
    console.error(`ABORTADO: ${runner} nao e de familia nenhuma que eu saiba ler.`);
    process.exit(1);
  }
  const fonte = readFileSync(path.resolve(RAIZ, runner), "utf8");
  // Deixar a excecao SUBIR e deliberado: um runner da familia que o
  // normalizador nao consegue ler ou mudou de forma (e entao pertence ao
  // `FORMA_PROPRIA`, com o motivo escrito) ou quebrou. As duas coisas tem de
  // aparecer, e nenhuma delas pode virar "0 ambiguas".
  const mutantes = await familia.ler(fonte);
  if (mutantes.length === 0) {
    console.error(`ABORTADO: ${runner} rendeu ZERO mutantes -- a leitura da lista quebrou.`);
    process.exit(1);
  }
  total += mutantes.length;
  lidosPorFamilia[familia.nome]++;

  const achados = [];
  for (const m of mutantes) {
    // Arquivo apagado e um defeito a RELATAR, nao uma excecao a propagar: um
    // runner que aponta para um arquivo que nao existe mais nunca mede nada, e o
    // stack trace do ENOENT esconde de qual runner e qual mutante se trata.
    let texto;
    try {
      texto = readFileSync(path.join(RAIZ, m.arquivo), "utf8");
    } catch {
      achados.push({ nome: m.nome, arquivo: m.arquivo, n: null });
      continue;
    }
    const n = texto.split(m.de).length - 1;
    if (n !== 1) achados.push({ nome: m.nome, arquivo: m.arquivo, n });
  }

  console.log(`${runner}: ${mutantes.length} mutantes`);
  for (const a of achados) {
    // ZERO TAMBEM REPROVA, DESDE A HMO-262.
    //
    // Era so relatado ("e outro assunto"), porque o >1 era o que a trava nova da
    // HMO-328 recusava. Mas um `de` com zero ocorrencia e o defeito que custa
    // mais caro dos tres: o mutante NAO APLICA, a suite roda sobre o codigo
    // correto, e a guarda que o mutante existia para vigiar fica sem controle
    // negativo nenhum. A HMO-262 e exatamente esse caso --
    // `parcelamento_volta_para_toda_despesa` parou de aplicar quando a HMO-254
    // trocou `ehNoCartao` por `natureza === "card"` em `lib/lancamento.ts`, e
    // ninguem soube por meses.
    //
    // Este medidor JA IMPRIMIA "ancora MORTA" nesse caso e saia ZERO. Ver o
    // trecho ter morrido e nao reprovar e a pior combinacao possivel: o sinal
    // existe e nao chega a ninguem.
    const rotulo =
      a.n === null
        ? "ARQUIVO AUSENTE"
        : a.n === 0
          ? "ancora MORTA"
          : `ancora AMBIGUA (${a.n}x)`;
    console.log(`   ${rotulo}  ${a.nome}  [${a.arquivo}]`);
    if (a.n !== null && a.n > 1) ambiguas++;
    if (a.n === null) ausentes++;
    if (a.n === 0) mortas++;
  }
}

// A TRAVA CONTRA A VARREDURA VAZIA, agora por FAMILIA. "0 ambiguas" sobre zero
// runners de uma familia e um boletim limpo que nao mediu nada -- e seria o
// resultado de um predicado que parasse de casar (a HMO-328 ja viu `ehDoPainel`
// deixar de reconhecer um runner por uma mudanca de forma). Com duas familias, a
// contagem total nao basta: a do painel sozinha passaria por "mediu tudo".
if (!alvos.length) {
  const vazias = Object.entries(lidosPorFamilia).filter(([, n]) => n === 0);
  if (vazias.length > 0) {
    console.error(
      `\nABORTADO: nenhum runner lido da familia ${vazias.map(([n]) => n).join(", ")} -- ` +
        "a varredura nao mediu essa familia.",
    );
    process.exit(1);
  }
}

console.log(
  `\n${total} mutantes lidos em ${runners.length} runners ` +
    `(${Object.entries(lidosPorFamilia).map(([n, q]) => `${n}:${q}`).join(" ")}), ` +
    `${ambiguas} com ancora ambigua (>1 ocorrencia)` +
    `, ${mortas} com ancora MORTA (0 ocorrencias)` +
    (ausentes > 0 ? `, ${ausentes} apontando para arquivo AUSENTE` : ""),
);
process.exit(ambiguas === 0 && mortas === 0 && ausentes === 0 ? 0 : 1);
