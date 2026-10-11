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
//
// O PONTO CEGO QUE DUROU MESES (HMO-389)
// --------------------------------------
// Tudo escrito acima sobre "nao calar defeito" era verdade de uma varredura que
// olhava 29 dos 73 runners. A lista de familias tinha DUAS das tres do conversor
// -- faltava a HMO-246, a de `const MUTANTES = [` em caixa alta -- e um
// `.filter((f) => familiaDoArquivo(f))` jogava fora, sem imprimir nada, todo
// runner que nao casasse com as duas. Censo na main (8f5b79c):
//
//     runners no disco:                 73
//     lidos:                            29
//     excluidos POR NOME (com motivo):   5
//     DESCARTADOS EM SILENCIO:          39
//
// Entre os 39: `telas-de-movimentacao` (75 mutantes, o maior do repositorio) e
// `realizado-do-caixa`. A guarda dizia `576 mutantes lidos em 29 runners, 0 com
// ancora MORTA` e saia 0 -- verde confiante sobre o modulo de dinheiro mais
// mutado do projeto. Medido plantando uma ancora morta em
// `telas-de-movimentacao`: a guarda da main saiu 0; esta sai 1.
//
// O conserto tem TRES partes, e nenhuma sozinha resolve:
//
//   1. a familia HMO-246 entrou na tabela  -> 29 -> 47 runners, 576 -> 947 mutantes
//   2. o descarte calado virou ABORTADO    -> forma nova para a guarda, nao passa batido
//   3. o boletim passou a DIZER o que nao mediu -> "29 runners" nunca mais se le
//      como censo completo
//
// Os 26 que seguem sem medicao estao em `APARELHO`/`FORMA_PROPRIA` logo abaixo,
// cada grupo com o motivo escrito, e sao listados no fim de toda varredura.
// =====================================================

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ehDoPainel,
  mioloDoPainel,
  ehTupla,
  mioloDaTupla,
  ehHmo246,
  mioloDoHmo246,
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

/**
 * A lista de um runner da familia HMO-246, normalizada para a mesma forma.
 *
 * O ALVO VEM DO `const FONTE` -- MENOS quando o mutante nomeia o seu, e esta
 * familia nomeia de DUAS maneiras: `arquivo:` (como a do painel) e `alvo:`.
 *
 * AS TRES PRIMEIRAS ANCORAS "MORTAS" QUE ESTA GUARDA ENCONTROU ERAM FALSAS, e
 * foram por nao ler o `alvo:` (medido na HMO-389, antes de o conserto ir para o
 * PR). `mutantes-realizado-do-caixa.mjs` e MULTI-ARQUIVO: ele declara
 * `const DONO_DO_CRITERIO = "lib/telas-de-movimentacao.ts"` e tres dos doze
 * mutantes trazem `alvo: DONO_DO_CRITERIO`. Medidos contra o `FONTE` eles dao
 * zero ocorrencia -- os trechos existem, so no OUTRO arquivo:
 *
 *     as_duas_pernas_entram         ancora MORTA  <- existe, em telas-de-movimentacao
 *     par_de_valor_zero_e_promovido ancora MORTA  <- idem
 *     fatura_sem_a_chave            ancora MORTA  <- idem
 *
 * E o modo de falha mais caro que uma guarda pode ter, e o OPOSTO do defeito
 * que ela conserta: reprovar a main acusando codigo correto. Um `de` que some
 * de verdade custa um mutante desarmado; uma MORTA falsa custa a confianca na
 * guarda inteira, e a primeira reacao de quem a ve e desligar o step.
 *
 * `alvo` AQUI E UM CAMINHO, e nao um apelido -- `fatura-do-periodo` e
 * `orcamento-de-grupo` usam `alvo:` como CHAVE de um objeto `ALVOS`, e os dois
 * estao em `FORMA_PROPRIA` exatamente por isso. Se um runner futuro desta
 * familia trouxer um apelido em `alvo`, a leitura nao o acha no disco e ele sai
 * como `ARQUIVO AUSENTE`: alto, nomeado e reprovando -- nao como MORTA falsa.
 */
async function lerMutantesDoHmo246(fonte) {
  const { miolo, arquivoFonte } = mioloDoHmo246(fonte);
  const url = `data:text/javascript,${encodeURIComponent(`${miolo}\nexport { MUTANTES };`)}`;
  const lista = (await import(url)).MUTANTES;
  return lista.map((m) => ({
    nome: m.nome,
    arquivo: m.arquivo ?? m.alvo ?? arquivoFonte,
    de: m.de,
  }));
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
  // NAO E RUNNER: e a BIBLIOTECA do bloco (`export function
  // criarBlocoDeMutantes`), que todos os runners convertidos importam. Ela nao
  // tem lista de mutante nenhuma, e por isso nenhum predicado de familia a
  // reconhece. Antes da HMO-389 ela era descartada em silencio junto com os
  // outros 38; com o descarte virando ABORTADO, ela precisa estar aqui -- pelo
  // NOME e com o motivo escrito, que e a convencao deste arquivo.
  "scripts/mutantes-em-bloco.mjs",
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
//
// OS 20 QUE A HMO-389 ACRESCENTOU vem DEPOIS, agrupados pela forma MEDIDA (nao
// por "tentei e nao deu"). Eles eram o resto do ponto cego: dos 39 descartados
// em silencio, 18 passaram a ser lidos pela familia HMO-246 e 1 era a
// biblioteca (`APARELHO`); estes 20 seguem sem medicao -- a diferenca e que
// agora isso esta ESCRITO, contado no boletim e com issue propria, em vez de
// desaparecer num `.filter`.
const FORMA_PROPRIA = new Set([
  "scripts/mutantes-orcamento-de-grupo.mjs",
  "scripts/mutantes-semeadura.mjs",
  "scripts/mutantes-sugestao-de-divisao.mjs",

  // --- MUTAM UMA MIGRATION SQL, nao um modulo TypeScript (8) -------------
  // Forma comum medida nos oito: `const PG`, `const TEMPLATE`,
  // `const MIGRATION`, `const TESTE`, `const psql = (db, args) =>` e
  // `const original = readFileSync(MIGRATION, "utf8")`. O alvo e `MIGRATION`
  // -- nao existe `const FONTE` --, e os `de` sao constantes de template
  // literal declaradas entre o `original` e a lista.
  //
  // A ancora deles E mensuravel em principio (contar o trecho no .sql e a
  // mesma operacao), e falta so um normalizador cujo alvo seja `MIGRATION`.
  // Nao entra aqui junto com a familia HMO-246 porque atribuir o arquivo
  // errado produz "ancora MORTA" FALSA -- que reprova a main acusando codigo
  // correto, o pior resultado possivel para uma guarda.
  "scripts/mutantes-chave-pix.mjs",
  "scripts/mutantes-moeda-da-conta-prevista.mjs",
  "scripts/mutantes-parcela-n-de-m.mjs",
  "scripts/mutantes-restauracao-do-grupo.mjs",
  "scripts/mutantes-transferencia-recorrente.mjs",
  "scripts/mutantes-trava-de-membro.mjs",
  "scripts/mutantes-trava-de-tipo.mjs",
  // O mesmo, mais DUAS listas (`MUTANTES` e `MUTANTES_TS`) e `arquivo:` por
  // mutante: ele muta a migration E o TypeScript que a le. Um normalizador que
  // leia so a primeira lista mediria metade dos mutantes e diria "li o runner".
  "scripts/mutantes-fatura-escolhida.mjs",

  // --- MULTI-ARQUIVO EM CAIXA ALTA (4) ----------------------------------
  // `const MUTANTES = [` (entao `ehHmo246` os reconhece) mas SEM `const FONTE`:
  // o alvo vem de varias constantes de arquivo (`RECORRENCIA`/`PARCELAS`/`TELA`,
  // `CAMPOS`/`LIB`, `CONTRATO`/`MARCACAO`/`ROTA`/`CARTOES`/`SAFE`/`PAINEL`,
  // `REGRA`/`ROTA`/`EDICAO`) e, em dois deles, de um `arquivo:` por mutante.
  // E a familia do painel em caixa alta -- `ehDoPainel` exige `mutantes`
  // minusculo e nao os alcanca.
  "scripts/mutantes-alcance-da-serie.mjs",
  "scripts/mutantes-campo-de-parcelas.mjs",
  "scripts/mutantes-fiacao-do-bruto.mjs",
  "scripts/mutantes-tipo-e-sinal.mjs",

  // --- O ALVO NAO SE CHAMA `FONTE` (3) ----------------------------------
  // `const ALVO = "caminho"` (`ancora-da-parte-de-grupo`, `contrato-dos-cartoes`)
  // ou um OBJETO de alvos indexado por apelido, com `alvo: "posso-gastar"` por
  // mutante (`fatura-do-periodo`, que e a mesma forma de `orcamento-de-grupo`
  // la em cima).
  "scripts/mutantes-ancora-da-parte-de-grupo.mjs",
  "scripts/mutantes-contrato-dos-cartoes.mjs",
  "scripts/mutantes-fatura-do-periodo.mjs",

  // --- A LISTA SE CHAMA `MUTACOES` (2) ----------------------------------
  // Nenhum dos tres predicados casa: eles nao tem `const MUTANTES = [` nem
  // `const mutantes = [`. Renomear a lista nos dois arquivos os traria para a
  // familia HMO-246 de graca, e e a conversao mais barata que sobrou.
  "scripts/mutantes-transferencia.mjs",
  "scripts/mutantes-transferencia-recorrente-app.mjs",

  // --- GUARDAS DE CI: mutam arvore de FIXTURE, nao a arvore rastreada (3) -
  // Os tres montam uma arvore temporaria (`const RAIZ`, `const GUARDA`,
  // `const FIXTURES`, `const CONTROLE`) e mutam ARQUIVO DE FIXTURE. Medir a
  // ancora deles contra a arvore rastreada daria `ancora MORTA` em todos,
  // FALSAMENTE -- o trecho existe, so nao no arquivo que a guarda leria.
  // Esta e a unica entrada da lista cujo motivo NAO e "ainda nao sei ler a
  // forma": aqui ler a forma nao basta, porque o arquivo medido nao existe no
  // repositorio no momento da medicao.
  //
  // `guarda-dos-mutantes` e mais forte ainda: nos 15 mutantes nao existe um
  // `de:` sequer. Cada entrada e uma FUNCAO (`mutar(dir)`) que escreve na
  // arvore de fixture, conferida por um `espera:` em regexp. Nao ha trecho a
  // contar, e nenhum normalizador futuro muda isso.
  "scripts/mutantes-guarda-do-sed-dos-workflows.mjs",
  "scripts/mutantes-guarda-dos-mutantes.mjs",
  "scripts/mutantes-guarda-de-mutacao-no-lugar.mjs",
]);

// O MESMO predicado que o conversor usa para escolher a familia. Escrever o
// criterio a mao aqui ja deu errado uma vez neste arquivo: `const mutantes = [`
// sozinho arrasta os runners da familia "tupla", que precisam de outro
// normalizador -- nao de nenhum.
const FAMILIAS = [
  { nome: "painel", reconhece: ehDoPainel, ler: lerMutantesDoPainel },
  { nome: "tupla", reconhece: ehTupla, ler: lerMutantesDaTupla },
  // A TERCEIRA, que faltava desde sempre (HMO-389). A tabela do conversor
  // sempre teve as tres; esta lista tinha duas, e a familia ausente nao dava
  // erro -- ela era DESCARTADA EM SILENCIO pelo `.filter` logo abaixo.
  { nome: "hmo246", reconhece: ehHmo246, ler: lerMutantesDoHmo246 },
];

function familiaDoArquivo(caminho) {
  const fonte = readFileSync(path.join(RAIZ, caminho), "utf8");
  return FAMILIAS.find((f) => f.reconhece(fonte));
}

const alvos = process.argv.slice(2);
const noDisco = readdirSync(path.join(RAIZ, "scripts"))
  .filter((f) => /^mutantes-.*\.mjs$/.test(f))
  .map((f) => path.join("scripts", f));
const excluidosPorNome = noDisco.filter((f) => APARELHO.has(f) || FORMA_PROPRIA.has(f));

// A TRAVA CONTRA EXCLUSAO FANTASMA. Excluir pelo NOME e a convencao deste
// arquivo justamente para que a exclusao seja legivel -- mas um nome com typo,
// ou o nome de um runner que foi renomeado/apagado, nao exclui nada e nao
// reclama: ele fica na lista parecendo documentacao de uma decisao que nao
// existe mais. E a forma mais barata de a lista mentir, e eu mesmo plantei uma
// (`mutantes-fatura-do-periodo-placeholder.mjs`) ao escrever a HMO-389.
//
// O `excluidosPorNome.length > 0` NAO E ZELO: as arvores de fixture de
// `test-ancora-de-mutante.mjs` tem um runner so e NENHUM dos 26 nomes
// declarados, e sem essa condicao toda varredura de teste abortaria aqui --
// antes de chegar ao caso que ela quer medir, o que faria os controles
// negativos passarem vacuos. A guarda so cobra a lista quando esta olhando uma
// arvore que tem ao menos um dos declarados, isto e, o repositorio de verdade.
// O caso degenerado que isto deixa passar (TODOS os 26 sumirem de uma vez) nao
// e alcancavel por typo, que e o defeito que a trava existe para pegar.
if (!alvos.length && excluidosPorNome.length > 0) {
  const declarados = [...APARELHO, ...FORMA_PROPRIA];
  const fantasmas = declarados.filter((f) => !noDisco.includes(f));
  if (fantasmas.length > 0) {
    console.error(
      "ABORTADO: nome declarado em APARELHO/FORMA_PROPRIA que nao existe no disco:\n" +
        fantasmas.map((f) => `   ${f}`).join("\n"),
    );
    process.exit(1);
  }
}

// O `.filter((f) => familiaDoArquivo(f))` QUE MORAVA AQUI ERA A HMO-389.
//
// Ele jogava fora, sem imprimir nada, todo runner que nao casasse com `painel`
// nem com `tupla` -- e a familia HMO-246 nao estava na tabela. Censo medido na
// main (8f5b79c), antes do conserto:
//
//     runners no disco:                 73
//     lidos pela guarda:                29   <- o que o boletim chamava de total
//     excluidos POR NOME (com motivo):   5
//     DESCARTADOS EM SILENCIO:          39
//
// Entre os 39 estavam `mutantes-telas-de-movimentacao.mjs` (75 mutantes, o
// maior do repositorio) e `mutantes-realizado-do-caixa.mjs`. A guarda imprimia
// `576 mutantes lidos em 29 runners, 0 com ancora MORTA` e saia 0 numa arvore
// com SETE ancoras mortas ou ambiguas -- verde confiante sobre o modulo de
// dinheiro mais mutado do projeto.
//
// Sem o filtro, quem nao e de familia nenhuma chega ao laco e ABORTA ali, pelo
// `console.error` que sempre existiu e era INALCANCAVEL. E a mesma politica dos
// outros dois casos ("rendeu ZERO mutantes", "arquivo ausente"): a excecao e
// relatada, nunca silenciada. Runner de forma nova -> a guarda para e cobra uma
// decisao, que e `FORMA_PROPRIA` com o motivo escrito ou um normalizador.
const runners = alvos.length
  ? alvos
  : noDisco.filter((f) => !APARELHO.has(f) && !FORMA_PROPRIA.has(f));

let ambiguas = 0;
let ausentes = 0;
let mortas = 0;
let total = 0;
const lidosPorFamilia = { painel: 0, tupla: 0, hmo246: 0 };

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

// O QUE NAO FOI MEDIDO, DITO NA MESMA RESPIRACAO -- e esta linha e metade do
// conserto da HMO-389. A outra metade foi parar de descartar em silencio; esta e
// parar de RELATAR como se o censo fosse completo. `576 mutantes lidos em 29
// runners` nao era falso, era so a verdade de um recorte que a linha nao
// mencionava, e foi lido como "a guarda olhou tudo".
if (!alvos.length) {
  console.log(
    `${noDisco.length} runners no disco, ${runners.length} medidos, ` +
      `${excluidosPorNome.length} excluidos pelo NOME (com motivo escrito em ` +
      "APARELHO/FORMA_PROPRIA) -- estes NAO tem medicao de ancora:",
  );
  for (const f of excluidosPorNome) console.log(`   sem medir  ${f}`);
}
process.exit(ambiguas === 0 && mortas === 0 && ausentes === 0 ? 0 : 1);
