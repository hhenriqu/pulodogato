#!/usr/bin/env node
// =====================================================
// PULODOGATO - o controle negativo do patrimonio que vem da carteira (HMO-437)
// =====================================================
//   node scripts/mutantes-patrimonio-da-carteira.mjs
//
// As tres suites verdes (`test:net-worth`, `test:investments`,
// `test:renda-fixa`) nao provam que elas SABEM REPROVAR. E aqui isso pesa mais
// que o normal: o defeito central desta fase -- contar a mesma aplicacao duas
// vezes -- nao levanta excecao, nao quebra proporcao nenhuma e nao deixa linha
// estranha para auditar. Ele imprime um patrimonio MAIOR, plausivel, e
// exatamente igual ao certo mais o valor da aplicacao atrelada. Uma assercao que
// parou de alcancar essa soma imprime o mesmo `✔`.
//
// Cada mutante e plantado numa COPIA da arvore em /tmp, compilado e medido com
// as suites de verdade. O mutante tem de MATAR alguma delas; sobrevivente e
// relatorio de buraco na suite, nao de defeito no app.
//
// A ORDEM DOS PASSOS E ECONOMIA, nao estilo: a suite do patrimonio vem primeiro
// porque e a mais barata e a que mede a maioria dos mutantes -- quem morre nela
// nao paga a compilacao das outras duas.
//
// Nada daqui toca arquivo rastreado -- ver `check-mutacao-no-lugar`.
// =====================================================

import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RAIZ = fileURLToPath(new URL("..", import.meta.url));

// Os alvos como CONSTANTES, e nao caminho literal em cada entrada: os caminhos
// repetem, e `scripts/mede-ancora-ambigua.mjs` recorta o miolo deste arquivo a
// partir da primeira constante que a lista REFERENCIA. Ver
// `runner-fora-da-forma-canonica-derruba-a-guarda-de-ancora`.
const PATRIMONIO = "lib/net-worth.ts";
const CARTEIRA = "lib/investments.ts";
const RENDA_FIXA = "lib/renda-fixa.ts";

/**
 * Cada mutante: o arquivo, a ANCORA (`de`, que tem de existir uma vez so) e a
 * troca. A ancora exata e o que impede o mutante de morrer calado por nao ter
 * casado -- `ancora-de-mutante-casa-no-comentario-e-o-cmp-nao-ve`.
 */
const MUTANTES = [
  {
    nome: "soma_em_vez_de_substituir",
    descricao:
      "A DUPLA CONTAGEM, escrita como a opcao B do plano: a conta com ativo " +
      "atrelado passa a somar o saldo digitado E a carteira",
    arquivo: PATRIMONIO,
    de: "    const saldo = daCarteira ? daCarteira.valor : saldoInformado;",
    para:
      "    const saldo = daCarteira\n" +
      "      ? daCarteira.valor + saldoInformado\n" +
      "      : saldoInformado;",
  },
  {
    nome: "substitui_conta_que_nao_e_investimento",
    descricao:
      "a trava de tipo cai: um elo errado faz a conta CORRENTE perder o saldo " +
      "dela e valer a carteira",
    arquivo: PATRIMONIO,
    de: "      classe === \"investimento\" ? carteiraDaConta.get(bruta.id) : undefined;",
    para: "      carteiraDaConta.get(bruta.id);",
  },
  {
    nome: "saldo_informado_zerado_na_substituicao",
    descricao:
      "o saldo digitado e zerado quando a carteira entra: a tela perde a unica " +
      "evidencia de que a substituicao aconteceu, e o saldo defasado fica " +
      "indistinguivel de um saldo que nunca existiu",
    arquivo: PATRIMONIO,
    de: "      saldoInformado,\n      carteira: daCarteira",
    para: "      saldoInformado: daCarteira ? 0 : saldoInformado,\n      carteira: daCarteira",
  },
  {
    nome: "arquivada_pelo_saldo_digitado",
    descricao:
      "`totalInativas` continua somando o saldo DIGITADO enquanto o patrimonio " +
      "soma a carteira: as duas metades da tela discordam",
    arquivo: PATRIMONIO,
    de: "    if (!ativa) totalInativas += saldo;",
    para: "    if (!ativa) totalInativas += saldoInformado;",
  },
  {
    nome: "numero_grande_pelo_liquido_de_ir",
    descricao:
      "a Decisao 2 invertida: o patrimonio passa a ser o liquido de IR, e sobe " +
      "sozinho na virada de 180/360/720 dias sem nenhum aporte",
    arquivo: PATRIMONIO,
    de: "    patrimonioLiquido: arredondar(patrimonioLiquido),",
    para: "    patrimonioLiquido: arredondar(patrimonioLiquido - irEstimado),",
  },
  {
    nome: "aviso_da_carteira_sempre_calado",
    descricao:
      "o aviso para de dizer que o saldo informado nao e somado: o numero novo " +
      "fica sem legenda, e numero sem legenda nao se distingue de bug",
    arquivo: PATRIMONIO,
    de: "  if (c.totalEmCarteira > 0) {",
    para: "  if (false) {",
  },
  // NAO HA MUTANTE PARA "o solto entra na conta" de proposito: a troca que
  // deixaria a linha de `account_id: null` passar pelo filtro nao COMPILA --
  // `Map<string, CarteiraDaConta>` recusa a chave nula. Invariante travada pelo
  // tipo e melhor que invariante travada por assercao, e plantar um mutante que
  // morre no tsc mediria o compilador, nao a suite. O efeito continua medido:
  // `o ativo SOLTO (account_id nulo) nao entra em conta nenhuma`, em
  // scripts/test-net-worth.mjs.
  {
    nome: "valor_da_posicao_sem_rendimento",
    descricao:
      "o rendimento volta a morrer no card: o valor da posicao de renda fixa " +
      "vira o principal, e o patrimonio para de crescer",
    arquivo: RENDA_FIXA,
    de: "  const bruto = rendeu ? (p.bruto as number) : 0;",
    para: "  const bruto = 0;",
  },
  {
    nome: "valor_da_posicao_pelo_liquido",
    descricao:
      "o valor da posicao passa a ser `principal + liquido`: o patrimonio " +
      "inteiro desce o IR sem dizer, e volta a subir sozinho na borda da faixa",
    arquivo: RENDA_FIXA,
    de: "    valor: arredondar(p.principal + bruto),",
    para: "    valor: arredondar(p.principal + liquido),",
  },
  {
    nome: "sem_boletim_a_posicao_vale_zero",
    descricao:
      "o papel sem boletim do Banco Central passa a valer ZERO em vez do custo: " +
      "o patrimonio desaba porque uma API nao respondeu",
    arquivo: RENDA_FIXA,
    de: "    valorLiquido: arredondar(p.principal + liquido),",
    para: "    valorLiquido: rendeu ? arredondar(p.principal + liquido) : 0,",
  },
  {
    nome: "a_conta_so_soma_renda_fixa",
    descricao:
      "a acao atrelada desaparece: a conta deixa de contar o saldo digitado " +
      "(porque TEM ativo atrelado) e nao conta a posicao, e o patrimonio cai " +
      "pelo valor dela sem nenhuma linha para auditar",
    arquivo: CARTEIRA,
    de: "      linha.valor += p.current_value;",
    para: "      linha.valor += 0;",
  },
  {
    nome: "a_conta_ignora_o_rendimento_projetado",
    descricao:
      "a renda fixa entra pelo principal e nao pelo projetado: o rendimento " +
      "chega calculado e e descartado na ultima soma",
    arquivo: CARTEIRA,
    de: "      linha.valor += proj.valor;",
    para: "      linha.valor += proj.principal;",
  },
  {
    nome: "posicao_zerada_continua_no_patrimonio",
    descricao:
      "o CDB resgatado por inteiro continua valendo: o patrimonio conta " +
      "dinheiro que ja saiu da carteira",
    arquivo: CARTEIRA,
    de: "  for (const p of posicoesAbertas(posicoes)) {",
    para: "  for (const p of posicoes) {",
  },
];

// As tres cadeias, na ordem do mais barato para o mais caro. Declaradas DEPOIS
// da lista de proposito: um `const` multilinha entre a primeira constante de
// arquivo e a lista faz o recorte de `mede-ancora-ambigua.mjs` engolir a lista
// inteira -- ver `runner-fora-da-forma-canonica-derruba-a-guarda-de-ancora`.
const COMPILA_PATRIMONIO = [
  "scripts/compila.mjs",
  "lib/net-worth.ts",
  "--outDir",
  ".tmp-net-worth",
  "--module",
  "es2020",
  "--target",
  "es2020",
  "--moduleResolution",
  "node",
  "--skipLibCheck",
];

const COMPILA_CARTEIRA = [
  "scripts/compila.mjs",
  "lib/investments.ts",
  "--outDir",
  ".tmp-investments",
  "--module",
  "es2020",
  "--target",
  "es2020",
  "--moduleResolution",
  "node",
  "--skipLibCheck",
];

const PASSOS = [
  ["node", COMPILA_PATRIMONIO],
  ["node", ["--test", "scripts/test-net-worth.mjs"]],
  ["node", COMPILA_CARTEIRA],
  ["node", ["--test", "scripts/test-investments.mjs"]],
  ["node", ["scripts/compila.mjs", "-p", "scripts/tsconfig.renda-fixa-test.json"]],
  ["node", ["scripts/resolve-aliases.mjs", ".tmp-renda-fixa", "lib"]],
  ["node", ["--test", "scripts/test-renda-fixa.mjs"]],
];

/** Roda a cadeia inteira na copia e diz se as suites passaram. */
function suitesPassam(dir) {
  for (const [cmd, args] of PASSOS) {
    try {
      execFileSync(cmd, args, { cwd: dir, stdio: "pipe" });
    } catch {
      // Compilacao quebrada tambem e mutante morto: o tsc reprovando e um sinal
      // vermelho tao bom quanto a assercao reprovando. O que nao serve e tudo
      // verde.
      return false;
    }
  }
  return true;
}

const base = mkdtempSync(join(tmpdir(), "mut-patrimonio-da-carteira-"));
console.log(`arvore base em ${base}`);

// A copia exclui `.tmp-*` e `.next`: o lote compilado do worktree tem centenas
// de megabytes e nada dele e entrada do mutante.
cpSync(RAIZ, base, {
  recursive: true,
  dereference: false,
  filter: (src) => {
    const rel = src.slice(RAIZ.length);
    if (rel.startsWith(".tmp-") || rel.startsWith(".next")) return false;
    if (rel.startsWith(".git/")) return false;
    return true;
  },
});

// O controle POSITIVO: a arvore sem mutante tem de ficar VERDE. Sem ele, uma
// arvore quebrada faria TODO mutante parecer morto --
// `suite-vermelha-faz-todo-controle-negativo-passar-vacuo`.
if (!suitesPassam(base)) {
  console.error(
    "CONTROLE POSITIVO VERMELHO: a arvore SEM mutante nao passa as suites em " +
      `${base}. Todo mutante abaixo pareceria morto por este motivo, nao pelo ` +
      "defeito. Nada foi medido."
  );
  process.exit(1);
}
console.log("controle positivo: arvore limpa VERDE\n");

let mortos = 0;
const sobreviventes = [];

for (const m of MUTANTES) {
  const alvo = join(base, m.arquivo);
  const original = readFileSync(alvo, "utf8");

  const ocorrencias = original.split(m.de).length - 1;
  if (ocorrencias !== 1) {
    console.error(
      `ANCORA MORTA em ${m.nome}: o texto casa ${ocorrencias} vez(es) em ` +
        `${m.arquivo}, e tem de casar exatamente 1. O mutante nao foi plantado ` +
        "-- isto e falha do runner, nao mutante morto.\n" +
        `  ancora: ${JSON.stringify(m.de.slice(0, 80))}`
    );
    process.exit(1);
  }

  writeFileSync(alvo, original.replace(m.de, m.para));
  const passou = suitesPassam(base);
  writeFileSync(alvo, original);

  if (passou) {
    sobreviventes.push(m);
    console.log(`SOBREVIVEU  ${m.nome} -- ${m.descricao}`);
  } else {
    mortos++;
    console.log(`morto       ${m.nome}`);
  }
}

rmSync(base, { recursive: true, force: true });

console.log(`\nplacar: ${mortos}/${MUTANTES.length} mortos`);

if (sobreviventes.length > 0) {
  console.error(
    "\nSobrevivente e buraco na suite: cada um destes defeitos pode entrar na " +
      "main com as tres suites do patrimonio verdes."
  );
  process.exit(1);
}
