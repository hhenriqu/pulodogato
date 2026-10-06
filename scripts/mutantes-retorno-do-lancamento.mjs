#!/usr/bin/env node
// Mutantes de lib/retorno-do-lancamento.ts -- HMO-249.
//
// POR QUE ISTO EXISTE
// -------------------
// `npm run test:retorno-lancamento` passa com 28 blocos verdes, e boa parte
// deles afirma sobre STRINGS DE ROTA -- o tipo de assercao que passa por acaso
// com mais facilidade. "o destino e /dashboard/personal-finance" continua verde
// numa funcao que devolve aquela constante SEMPRE, ou seja, numa funcao que
// desfaz a issue inteira. Cada mutante abaixo desfaz UMA decisao do modulo; o
// teste tem que ficar vermelho em todos.
//
// OS MUTANTES QUE IMPORTAM
// ------------------------
//   `sem_peneira`          -- `router.push("https://golpe.example")`: o app leva
//                             a pessoa para fora logo DEPOIS de ela confirmar um
//                             lancamento, que e o instante de maior confianca.
//   `aceita_qualquer_caminho_interno` -- `//golpe.example` e `/api/...` passam.
//   `dashboard_sem_barra`  -- `/dashboardfalso` passa por `/dashboard`.
//   `aceita_tela_de_lancamento` -- o Salvar reabre o MESMO modal: le-se como
//                             "o botao nao fez nada", com o lancamento gravado.
//   `continuar_ignorado`   -- o interruptor "Salvar e continuar" nao faz nada: o
//                             modal fecha de qualquer jeito.
//   `valor_sobrevive`      -- O MUTANTE DE DINHEIRO. Com valor e descricao ainda
//                             na tela, UM segundo clique em Salvar grava o mesmo
//                             gasto de novo, e nada avisa que foram dois.
//   `parcelado_sobrevive`  -- a conta seguinte herda "10x" e cria uma SEGUNDA
//                             serie parcelada, espalhada por dez faturas.
//   `reset_total`          -- limpa tudo, inclusive categoria e grupo: a opcao
//                             existe para nao reescolher isso, e ela passaria a
//                             ser mais trabalho que fechar e reabrir.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao vive em memoria e e compilada de uma ARVORE TEMPORARIA. Mutar,
// rodar e restaurar no `finally` deixa a fonte mutada no disco quando o processo
// morre no meio -- e um `trap` que restaura por cima apaga trabalho nao salvo.
//
// A DEPENDENCIA DE TIPO TEM DE IR JUNTO
// -------------------------------------
// O modulo faz `import type { ValoresDeLancamento } from "./lancamento"`. O
// emit apaga aquela linha, mas o COMPILADOR precisa resolve-la: sem a copia de
// lib/lancamento.ts ao lado, todo mutante falharia na compilacao e "morreria"
// por motivo errado -- o placar mentiria a favor. O controle positivo abaixo
// pega esse caso, porque ele reprovaria primeiro.
//
// COMO RODAR
//   npm run mutantes:retorno-lancamento

import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";

const FONTE = "lib/retorno-do-lancamento.ts";
const DEPENDENCIAS = ["lib/lancamento.ts"];
const SAIDA = ".tmp-retorno-lancamento";
const TESTE = "scripts/test-retorno-do-lancamento.mjs";

const original = readFileSync(FONTE, "utf8");

const MUTANTES = [
  // --- a peneira do que vem da URL ----------------------------------------
  {
    nome: "sem_peneira",
    porque:
      "`?origem=https://golpe.example` e empurrado como esta: o proprio app " +
      "leva a pessoa para fora depois de ela confirmar um lancamento",
    de: `  if (!crua.startsWith("/")) return null;`,
    para: `  if (!crua.startsWith("/")) return crua;`,
  },
  {
    // ESTE E O MUTANTE QUE MUDOU O CODIGO. A primeira versao de
    // `origemSegura` tinha uma guarda separada contra protocolo-relativo
    // (`startsWith("//") || startsWith("/\\")`), e o mutante que a apagava
    // SOBREVIVEU -- porque ela era inalcancavel: a lista de permissao exige que
    // o caractere de indice 1 seja `d`, e protocolo-relativo exige `/` ou `\`.
    // A guarda saiu, e este mutante ficou no lugar dos dois antigos: ele prova
    // que e a lista de permissao quem fecha `//golpe.example`.
    nome: "aceita_qualquer_caminho_interno",
    porque:
      "`//golpe.example/dashboard` e `/api/...` passam: basta comecar com `/`. " +
      "O primeiro sai do dominio (o navegador le `//` como protocolo-relativo) " +
      "e o segundo devolve JSON na cara da pessoa depois de ela salvar",
    de: `  if (caminho !== "/dashboard" && !caminho.startsWith("/dashboard/")) {`,
    para: `  if (!caminho.startsWith("/")) {`,
  },
  {
    nome: "dashboard_sem_barra",
    porque:
      "`/dashboardfalso` e `/dashboard-publico/x` passam por `/dashboard` -- " +
      "o jeito obvio de escrever esta guarda",
    de: `  if (caminho !== "/dashboard" && !caminho.startsWith("/dashboard/")) {`,
    para: `  if (!caminho.startsWith("/dashboard")) {`,
  },
  {
    nome: "query_entra_no_caminho",
    porque:
      "a comparacao passa a incluir a query, entao NENHUMA tela com `?de=&ate=` " +
      "e aceita como origem: tudo cai no destino de antes da issue",
    de: `  const caminho = fimDoCaminho === -1 ? crua : crua.slice(0, fimDoCaminho);`,
    para: `  const caminho = crua;`,
  },
  {
    nome: "sem_controle",
    porque:
      "`/dashboard\\n//golpe.example` passa: o `\\n` no meio da URL e o truque " +
      "classico contra quem compara so o comeco da string",
    de: `    if (codigo <= 0x20 || codigo === 0x7f) return null;`,
    para: `    if (codigo === 0x7f) return null;`,
  },
  {
    nome: "aceita_tela_de_lancamento",
    porque:
      "`?origem=/dashboard/movimentacoes/despesa` passa: o Salvar fecha o modal " +
      "e ABRE O MESMO MODAL de novo, limpo -- indistinguivel de 'o botao nao " +
      "fez nada', com o lancamento ja gravado",
    de: `  if ((ROTAS_DE_LANCAMENTO as readonly string[]).includes(caminho)) {
    return null;
  }`,
    para: `  if (false) {
    return null;
  }`,
  },
  {
    nome: "sem_limite_de_tamanho",
    porque:
      "uma URL de 600 caracteres entra no `?origem=` e vai para o historico do " +
      "navegador e para o log do servidor",
    de: `  if (!crua || crua.length > LIMITE_DA_ORIGEM) return null;`,
    para: `  if (!crua) return null;`,
  },

  // --- a escolha do destino -----------------------------------------------
  {
    nome: "continuar_ignorado",
    porque:
      "o interruptor 'Salvar e continuar' nao faz nada: o modal fecha de " +
      "qualquer jeito, e a metade da issue que a pessoa pediu por escrito some",
    de: `  if (opcoes.continuar) return null;`,
    para: `  if (false) return null;`,
  },
  {
    nome: "continuar_sempre",
    porque:
      "o modal NUNCA fecha: quem lancou uma conta so fica olhando um " +
      "formulario vazio sem saber se gravou",
    de: `  if (opcoes.continuar) return null;`,
    para: `  if (!opcoes.continuar) return null;`,
  },
  {
    nome: "fallback_vence_origem",
    porque:
      "a transferencia lancada de dentro de uma tela vai para /dashboard/bills " +
      "em vez de voltar para ela: a origem explicita e ignorada",
    de: `    origemSegura(opcoes.origem) ??
    opcoes.fallback ??
    ROTA_PADRAO_DE_RETORNO`,
    para: `    opcoes.fallback ??
    origemSegura(opcoes.origem) ??
    ROTA_PADRAO_DE_RETORNO`,
  },
  {
    nome: "sem_fallback",
    porque:
      "a transferencia MENSAL cai na lista de lancamentos, onde a regra que " +
      "acabou de ser criada nao aparece -- le-se como 'nao salvou'",
    de: `    origemSegura(opcoes.origem) ??
    opcoes.fallback ??
    ROTA_PADRAO_DE_RETORNO`,
    para: `    origemSegura(opcoes.origem) ?? ROTA_PADRAO_DE_RETORNO`,
  },

  // --- o link que abre o modal --------------------------------------------
  {
    nome: "separador_sempre_interrogacao",
    porque:
      "`...despesa?cartao=<id>?origem=...`: o `origem` vira parte do valor de " +
      "`cartao`, e o cartao travado desaparece do formulario sem nenhum erro",
    de: `  return rota.includes("?")
    ? (\`\${rota}&\${valor}\` as \`\${R}?\${string}\`)
    : (\`\${rota}?\${valor}\` as \`\${R}?\${string}\`);`,
    para: `  return \`\${rota}?\${valor}\` as \`\${R}?\${string}\`;`,
  },
  {
    nome: "sem_encode",
    porque:
      "o `&ate=` da origem sai cru e o navegador o le como parametro DO MODAL: " +
      "`origemSegura` recebe meio endereco e recusa, e a volta cai no padrao",
    de: `  const valor = \`\${PARAM_DE_ORIGEM}=\${encodeURIComponent(segura)}\`;`,
    para: `  const valor = \`\${PARAM_DE_ORIGEM}=\${segura}\`;`,
  },
  {
    nome: "link_com_origem_ruim",
    porque:
      "o link carrega `?origem=https://golpe.example` mesmo sendo invalida -- " +
      "a peneira passa a existir num lado so",
    de: `  const segura = origemSegura(origem);
  if (!segura) return rota;`,
    para: `  const segura = origem;
  if (!segura) return rota;`,
  },

  // --- "Salvar e continuar": o que fica na tela ---------------------------
  {
    nome: "valor_sobrevive",
    porque:
      "O MUTANTE DE DINHEIRO: o valor fica na tela depois de salvar, e UM " +
      "segundo clique em Salvar grava o mesmo gasto de novo -- dois lancamentos " +
      "identicos, sem nada que diga que foram dois",
    // O trecho leva a linha de `parcelado` so para ser UNICO:
    // `proximaTransferencia` tem as mesmas tres linhas de cima, e o runner
    // aborta mutante ambiguo (foi o que aconteceu na primeira volta).
    de: `    valor: inicial.valor,
    notas: inicial.notas,
    parcelado: inicial.parcelado,`,
    para: `    notas: inicial.notas,
    parcelado: inicial.parcelado,`,
  },
  {
    nome: "descricao_sobrevive",
    porque:
      "a descricao da conta anterior fica na tela: a proxima conta e gravada " +
      "com o nome da anterior se a pessoa so trocar o valor",
    de: `    descricao: inicial.descricao,
    valor: inicial.valor,
    notas: inicial.notas,
    parcelado: inicial.parcelado,`,
    para: `    valor: inicial.valor,
    notas: inicial.notas,
    parcelado: inicial.parcelado,`,
  },
  {
    nome: "parcelado_sobrevive",
    porque:
      "a conta seguinte herda 'parcelado em 10x' e cria uma SEGUNDA serie " +
      "parcelada que ninguem pediu, espalhada por dez faturas",
    de: `    parcelado: inicial.parcelado,
    baseDoValorParcelado: inicial.baseDoValorParcelado,`,
    para: `    baseDoValorParcelado: inicial.baseDoValorParcelado,`,
  },
  {
    nome: "total_de_parcelas_sobrevive",
    porque:
      "`parcelado` volta a false mas o campo continua em 10: remarcar a " +
      "checkbox parcela a conta nova sem a pessoa digitar nada",
    de: `    parcelaAtual: inicial.parcelaAtual,
    totalDeParcelas: inicial.totalDeParcelas,`,
    para: `    parcelaAtual: inicial.parcelaAtual,`,
  },
  {
    nome: "reset_total",
    porque:
      "limpa TUDO, inclusive categoria, conta, data e grupo: a opcao existe " +
      "justamente para nao reescolher isso, e passaria a dar mais trabalho que " +
      "fechar o modal e abrir de novo",
    de: `  return {
    ...valores,
    descricao: inicial.descricao,
    valor: inicial.valor,
    notas: inicial.notas,
    parcelado: inicial.parcelado,`,
    para: `  return {
    ...inicial,
    descricao: inicial.descricao,
    valor: inicial.valor,
    notas: inicial.notas,
    parcelado: inicial.parcelado,`,
  },
  {
    nome: "muta_o_estado_anterior",
    porque:
      "escreve no objeto que recebeu em vez de devolver um novo: dentro de " +
      "`setValores(atual => ...)` o React pode nao ver a mudanca, e a tela fica " +
      "com o valor da conta anterior",
    de: `  return {
    ...valores,
    descricao: inicial.descricao,
    valor: inicial.valor,
    notas: inicial.notas,
    parcelado: inicial.parcelado,`,
    para: `  return Object.assign(valores, {
    descricao: inicial.descricao,
    valor: inicial.valor,
    notas: inicial.notas,
    parcelado: inicial.parcelado,`,
  },
  {
    nome: "transferencia_valor_sobrevive",
    porque:
      "o valor fica na tela da transferencia, onde o duplo envio custa o DOBRO " +
      "em duas contas -- sao duas pernas por transferencia",
    de: `>(valores: V, inicial: V): V {
  return {
    ...valores,
    descricao: inicial.descricao,
    valor: inicial.valor,`,
    para: `>(valores: V, inicial: V): V {
  return {
    ...valores,
    descricao: inicial.descricao,`,
  },
];

const dir = mkdtempSync(join(tmpdir(), "mut249-"));
const dirLib = join(dir, "lib");
mkdirSync(dirLib, { recursive: true });
for (const dep of DEPENDENCIAS) copyFileSync(dep, join(dirLib, basename(dep)));

const tsconfig = join(dir, "tsconfig.json");
writeFileSync(
  tsconfig,
  JSON.stringify({
    compilerOptions: {
      outDir: resolve(SAIDA),
      rootDir: dirLib,
      module: "es2020",
      target: "es2020",
      moduleResolution: "node",
      skipLibCheck: true,
      strict: true,
    },
    include: [join(dirLib, basename(FONTE))],
  })
);

/**
 * Compila a fonte dada na arvore temporaria e roda a suite contra ela.
 *
 * Lanca quando o tsc OU o teste reprova. Nao ha como distinguir os dois aqui de
 * proposito: para o placar, "nao compilou" e "reprovou" sao a mesma coisa (o
 * mutante morreu), e o que protege contra um build quebrado contar como morte em
 * MASSA e o controle positivo abaixo.
 */
const compilaERoda = (fonte) => {
  writeFileSync(join(dirLib, basename(FONTE)), fonte);
  rmSync(SAIDA, { recursive: true, force: true });
  execFileSync("npx", ["tsc", "-p", tsconfig], { stdio: "pipe" });
  execFileSync("node", ["--test", TESTE], { stdio: "pipe" });
};

let falhas = 0;

try {
  // CONTROLE POSITIVO: com a fonte intacta o teste tem de PASSAR. Sem isto, um
  // "todos morreram" poderia significar apenas que o build esta quebrado -- por
  // exemplo que a copia de lib/lancamento.ts nao foi feita -- e o teste reprova
  // sempre, por motivo nenhum a ver com as mutacoes.
  try {
    compilaERoda(original);
    console.log("controle positivo: o teste passa com a fonte intacta\n");
  } catch (e) {
    console.error("ABORTADO: o teste reprova com a fonte INTACTA.");
    console.error((e.stdout ?? e.stderr ?? "").toString().slice(-2000));
    process.exit(1);
  }

  for (const m of MUTANTES) {
    // `String.replace` troca a PRIMEIRA ocorrencia. Um trecho que aparece duas
    // vezes produz um mutante que muta o lugar errado e morre verde com o
    // rotulo mentindo sobre o que foi medido -- por isso o trecho tem de ser
    // UNICO, e nao apenas existir.
    const ocorrencias = original.split(m.de).length - 1;
    if (ocorrencias === 0) {
      console.log(
        `  !! ${m.nome}: o trecho a mutar NAO EXISTE MAIS -- mutante invalido`
      );
      falhas++;
      continue;
    }
    if (ocorrencias > 1) {
      console.log(
        `  !! ${m.nome}: o trecho aparece ${ocorrencias}x -- mutante ambiguo, invalido`
      );
      falhas++;
      continue;
    }

    const mutado = original.replace(m.de, m.para);

    let sobreviveu = false;
    try {
      compilaERoda(mutado);
      sobreviveu = true;
    } catch {
      // reprovou (ou nem compilou): e o esperado.
    }

    if (sobreviveu) {
      console.log(`  SOBREVIVEU  ${m.nome}  <-- nenhuma assercao protege isto`);
      console.log(`              (${m.porque})`);
      falhas++;
    } else {
      console.log(`  morreu      ${m.nome}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
  // Deixa o build em dia com a fonte de verdade, para o proximo
  // `npm run test:retorno-lancamento` nao rodar contra um artefato mutado.
  try {
    rmSync(SAIDA, { recursive: true, force: true });
    execFileSync("npm", ["run", "test:retorno-lancamento"], { stdio: "pipe" });
  } catch {
    /* o controle positivo acima ja teria falhado */
  }
}

console.log();
if (falhas === 0) {
  console.log(`todos os ${MUTANTES.length} mutantes morreram`);
} else {
  console.log(`${falhas} mutante(s) sobreviveu/sobreviveram ou sao invalidos`);
  process.exit(1);
}
