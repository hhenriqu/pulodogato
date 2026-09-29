#!/usr/bin/env node
//
// Nenhum modulo de interface fica sem quem o importe.
//
// O modo de falha e o mais silencioso que existe: o arquivo COMPILA. O tsc
// passa, o next build passa, e o bundle nem cresce -- o empacotador nunca chega
// nele. Nada fica vermelho, e o custo aparece semanas depois, quando alguem vai
// "evoluir o formulario de lancamento", abre o arquivo de nome mais obvio e
// passa a tarde mexendo numa tela que usuario nenhum ve.
//
// Foi o que a HMO-163 encontrou. O pedido era apagar 4 arquivos de
// components/forms/; a varredura achou a corrente inteira, 8 arquivos e 2555
// linhas: os 4 formularios, a TransactionList que repetia a lista de
// lancamentos, os dois hooks que so eles chamavam e a camada de servico
// abaixo dos hooks. O
// arquivo de nome mais convidativo (NewTransactionDialog.tsx) era um dos
// mortos, e ainda carregava console.log de depuracao -- o que reforcava a
// impressao de ser o codigo ativo. O formulario de verdade mora dentro da
// pagina de personal-finance.
//
// Tres familias de achado, porque sao tres jeitos de morrer:
//
//   1. SEM IMPORTADOR -- o modulo e importavel, mas ninguem o importa.
//   2. NAO IMPORTAVEL -- a extensao nao e de modulo (.bak, .old, .orig...).
//      Nao depende de varredura nenhuma: um .bak e morto por construcao,
//      porque nao ha como escrever um import que chegue nele.
//   3. REGISTRO VENCIDO -- ver ESPERANDO_TELA abaixo.
//
// Node puro, biblioteca padrao. Roda em segundos e nao precisa de npm ci.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, relative, extname } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');

// Onde um import pode nascer.
const DIRS_QUE_IMPORTAM = ['app', 'components', 'lib', 'scripts', 'hooks', 'types', 'utils'];
const ARQUIVOS_QUE_IMPORTAM = ['middleware.ts'];

// Onde procuramos o codigo morto. lib/hooks e lib/services entram porque a
// corrente da HMO-163 morreu em tres niveis: o componente, o hook que so ele
// chamava e o servico abaixo do hook. Vigiar so components/ teria deixado 528
// linhas de hook e servico orfaos na arvore, verdes.
const DIRS_VIGIADOS = ['components', 'lib/hooks', 'lib/services'];

// components/ui/ e superficie de biblioteca, nao tela: sao primitivos do
// shadcn, adicionados por CLI, e um primitivo sem uso hoje nao engana ninguem
// amanha -- ninguem abre `table.tsx` pensando estar editando uma tela. Ficar de
// fora aqui e de proposito. (Depois desta limpeza `ui/table.tsx` ficou sem
// importador, porque os dois arquivos que montavam tabela eram os mortos.)
const DIRS_IGNORADOS = ['components/ui'];

// Extensoes que o empacotador sabe resolver a partir de um import.
const EXT_DE_MODULO = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
// Extensoes que vivem nessas pastas sem serem alcancadas por caminho de modulo.
const EXT_TOLERADA = ['.css', '.scss', '.svg', '.png', '.woff', '.woff2', '.json', '.md'];

// Componentes que estao sem importador porque a TELA deles ainda nao existe --
// nao porque foram substituidos. Sao apresentacionais puros (recebem tudo por
// prop, nao falam com o banco), escritos para /dashboard/investments e
// /dashboard/trading, que hoje renderizam o aviso de EmDesenvolvimento.
//
// Isto NAO e uma lista de perdao: o registro se invalida sozinho. Se o arquivo
// for apagado, o passo falha; se alguma tela passar a importa-lo, o passo falha
// pedindo que saia daqui. Uma lista que so cresce e envelhece em silencio e
// justamente o mecanismo que esta verificacao existe para quebrar.
//
// VAZIA DESDE A HMO-169, e esse e o estado saudavel. Os quatro componentes que
// moravam aqui -- DashboardSummary, PortfolioTable, AssetAllocationChart e
// PerformanceChart -- ganharam a tela que esperavam: /dashboard/investments
// passou a importar os quatro, e o registro se invalidou sozinho como prometido.
//
// `/dashboard/trading` continua no EmDesenvolvimento, de proposito: "sinais de
// trading em tempo real" e recomendacao de investimento, com implicacao
// regulatoria (CVM), e nao ha componente esperando por ela.
const ESPERANDO_TELA = [];

function listar(dir) {
  const saida = [];
  let entradas;
  try {
    entradas = readdirSync(join(ROOT, dir), { withFileTypes: true });
  } catch {
    return saida;
  }
  for (const e of entradas) {
    const rel = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === '.git') continue;
      saida.push(...listar(rel));
    } else if (e.isFile()) {
      saida.push(rel);
    }
  }
  return saida;
}

// As quatro formas de citar um modulo. O `from` cobre import e export-from.
const PADROES = [
  /\bfrom\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
];

function especificadores(texto) {
  const achados = [];
  for (const re of PADROES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(texto)) !== null) achados.push(m[1]);
  }
  return achados;
}

// Devolve o caminho relativo do arquivo que o especificador aponta, ou null se
// o alvo nao existe no repo (pacote de node_modules, por exemplo).
//
// A resolucao tem que tentar as extensoes uma a uma, e nao adivinhar pelo nome:
// conferindo esta limpeza a mao eu dei `useDeviceDetection` como morto porque
// tinha cortado `.ts` de um arquivo `.tsx`. Ele esta vivo -- o PWAWrapper
// importa dele.
function resolverParaArquivo(spec, arquivoQueImporta) {
  let base;
  if (spec.startsWith('@/')) {
    base = join(ROOT, spec.slice(2));
  } else if (spec.startsWith('./') || spec.startsWith('../')) {
    base = resolve(ROOT, dirname(arquivoQueImporta), spec);
  } else {
    return null; // pacote externo
  }

  const tentativas = [base];
  for (const ext of EXT_DE_MODULO) tentativas.push(base + ext);
  for (const ext of EXT_DE_MODULO) tentativas.push(join(base, 'index' + ext));

  for (const t of tentativas) {
    try {
      if (statSync(t).isFile()) return relative(ROOT, t);
    } catch {
      /* segue */
    }
  }
  return null;
}

// --- 1. tudo que alguem importa -------------------------------------------

const fontes = [];
for (const d of DIRS_QUE_IMPORTAM) fontes.push(...listar(d));
for (const f of ARQUIVOS_QUE_IMPORTAM) {
  try {
    if (statSync(join(ROOT, f)).isFile()) fontes.push(f);
  } catch {
    /* opcional */
  }
}

const importados = new Set();
let especificadoresLidos = 0;

for (const f of fontes) {
  if (!EXT_DE_MODULO.includes(extname(f))) continue;
  let texto;
  try {
    texto = readFileSync(join(ROOT, f), 'utf8');
  } catch {
    continue;
  }
  for (const spec of especificadores(texto)) {
    especificadoresLidos++;
    const alvo = resolverParaArquivo(spec, f);
    // Um arquivo que importa a si mesmo nao conta como importador.
    if (alvo && alvo !== f) importados.add(alvo);
  }
}

// --- 2. rede de seguranca da propria verificacao ---------------------------
//
// Se uma refatoracao quebrar as regex, `importados` fica vazio, TODO modulo
// passa a ser "morto" e o job fica vermelho de um jeito que se explica. O
// perigo oposto e pior e nao apareceria: por isso o piso abaixo. Uma varredura
// que leu quase nenhum import nao esta aprovando nada -- esta cega.
const PISO_ESPECIFICADORES = 200;
if (especificadoresLidos < PISO_ESPECIFICADORES) {
  console.error(
    `check-dead-components: li apenas ${especificadoresLidos} especificadores de import em ` +
      `${fontes.length} arquivos, abaixo do piso de ${PISO_ESPECIFICADORES}.\n` +
      'A varredura esta cega, nao limpa. Conferir as regex e as pastas de origem.'
  );
  process.exit(1);
}

// --- 3. o que ficou sem importador ----------------------------------------

const registrados = new Map(ESPERANDO_TELA.map((r) => [r.arquivo, r]));

const vigiados = [];
for (const d of DIRS_VIGIADOS) {
  for (const f of listar(d)) {
    if (DIRS_IGNORADOS.some((ig) => f.startsWith(ig + '/'))) continue;
    vigiados.push(f);
  }
}

const semImportador = [];
const naoImportavel = [];

for (const f of vigiados) {
  const ext = extname(f);
  if (EXT_TOLERADA.includes(ext)) continue;
  if (!EXT_DE_MODULO.includes(ext)) {
    naoImportavel.push(f);
    continue;
  }
  if (f.endsWith('.d.ts')) continue;
  if (importados.has(f)) continue;
  if (registrados.has(f)) continue; // tratado no bloco do registro
  semImportador.push(f);
}

// --- 4. o registro se invalida sozinho ------------------------------------

const registroVencido = [];
for (const r of ESPERANDO_TELA) {
  let existe = true;
  try {
    existe = statSync(join(ROOT, r.arquivo)).isFile();
  } catch {
    existe = false;
  }
  if (!existe) {
    registroVencido.push(
      `  ${r.arquivo}: esta no registro e nao existe mais. Tirar a linha daqui (${r.issue}).`
    );
  } else if (importados.has(r.arquivo)) {
    registroVencido.push(
      `  ${r.arquivo}: ganhou importador -- ${r.tela} foi construida. Tirar a linha do registro (${r.issue}).`
    );
  }
}

// --- 5. relatorio ---------------------------------------------------------

const linhas = [];

if (naoImportavel.length > 0) {
  linhas.push('Arquivos que nenhum import alcanca (extensao nao e de modulo):');
  for (const f of naoImportavel) linhas.push(`  ${f}`);
  linhas.push('');
  linhas.push('  Copia de rascunho nao mora na arvore: o historico do git ja guarda a versao antiga.');
  linhas.push('');
}

if (semImportador.length > 0) {
  linhas.push(`Modulos sem nenhum importador (${semImportador.length}):`);
  for (const f of semImportador) {
    const n = readFileSync(join(ROOT, f), 'utf8').split('\n').length;
    linhas.push(`  ${f} (${n} linhas)`);
  }
  linhas.push('');
  linhas.push('  Ou alguma tela passa a importar, ou o arquivo sai. Manter os dois');
  linhas.push('  caminhos e o que faz a proxima pessoa editar a tela errada.');
  linhas.push('  Se o arquivo espera uma tela que ainda nao existe, entrar em');
  linhas.push('  ESPERANDO_TELA com a tela e a issue -- nao em silencio.');
  linhas.push('');
}

if (registroVencido.length > 0) {
  linhas.push('Registro de ESPERANDO_TELA fora de dia:');
  linhas.push(...registroVencido);
  linhas.push('');
}

if (linhas.length > 0) {
  console.error('check-dead-components: codigo morto na interface\n');
  console.error(linhas.join('\n'));
  process.exit(1);
}

console.log(
  `check-dead-components: OK -- ${vigiados.length} arquivos em ${DIRS_VIGIADOS.join(', ')}, ` +
    `todos alcancados por algum import (${ESPERANDO_TELA.length} no registro de tela pendente; ` +
    `${especificadoresLidos} especificadores lidos em ${fontes.length} arquivos).`
);
