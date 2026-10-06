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
// COMO RODAR
//   npm run mutantes:retorno-lancamento
//
// O BLOCO: UMA COMPILACAO PARA TODOS OS MUTANTES (HMO-318)
// --------------------------------------------------------
// Este runner era da familia da HMO-246: montava uma arvore temporaria com uma
// lista de DEPENDENCIAS escrita a mao, sintetizava um tsconfig e disparava
// `npx tsc` + `resolve-aliases` + `node --test` UMA VEZ POR MUTANTE. Entre
// duas voltas mudava UM arquivo, e o programa inteiro era reparseado do zero.
//
// Agora as voltas dividem um processo e um cache de AST (`criarBlocoDeMutantes`,
// HMO-319): so o arquivo mutado e reparseado. Tres coisas sairam junto, e as
// tres eram defeito:
//
//   - a lista de DEPENDENCIAS a mao, que envelhecia em silencio e ja deixou
//     runner desta familia abortando por meses (ver o conversor);
//   - o tsconfig repetido a mao, que podia divergir do alvo `test:retorno-lancamento`
//     -- agora as etapas saem do proprio package.json;
//   - a saida MUTADA emitida dentro do repositorio, que o `finally` tinha de
//     recompilar depois. A sombra emite em /tmp; `lib/retorno-do-lancamento.ts`
//     e o `.tmp-*` do repositorio nao sao tocados em momento nenhum.
//
// A lista de mutantes abaixo nao foi reescrita: ela veio byte a byte do arquivo
// anterior, pelo `scripts/converte-mutantes-em-bloco.mjs`.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const FONTE = "lib/retorno-do-lancamento.ts";

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

const SUITE = "test:retorno-lancamento";

const bloco = criarBlocoDeMutantes({ rotulo: "retorno-do-lancamento", suites: [SUITE] });

// A sombra vive em diretorio temporario. No pior caso sobra um diretorio orfao
// em /tmp -- e nao uma fonte mutada na arvore, que era o modo de falha do
// desenho anterior. O handler de sinal existe para que nem o orfao sobre:
// `finally` nao roda em SIGTERM, mas `process.exit` dispara o `exit` abaixo.
process.on("exit", () => bloco.fechar());
for (const sinal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sinal, () => process.exit(1));
}

// CONTROLE POSITIVO: a arvore INTACTA tem de passar antes de qualquer mutante,
// e pelo MESMO `rodar` que os mutantes usam -- por isso ele pega erro no
// aparelho. Sem ele, uma sombra mal montada reprova TODO mutante e o placar sai
// "N/N mortos" sobre zero assercoes executadas.
const controle = bloco.rodar("controle", {}, SUITE);
if (!controle.verde) {
  console.error(`ABORTADO: ${FONTE} INTACTO reprova em ${SUITE} (${controle.como}).`);
  console.error(`  ${controle.saida}`);
  console.error("O placar nao valeria: todo mutante 'morreria' sem ter sido medido.");
  process.exit(1);
}
console.log(`controle positivo: ${FONTE} intacto passa em ${SUITE}\n`);

let falhas = 0;

for (const m of MUTANTES) {
  // `String.replace` troca a PRIMEIRA ocorrencia. Um trecho que aparece duas
  // vezes produz um mutante que muta o lugar errado e morre verde com o rotulo
  // mentindo sobre o que foi medido -- por isso o trecho tem de ser UNICO, e
  // nao apenas existir.
  const ocorrencias = original.split(m.de).length - 1;
  if (ocorrencias === 0) {
    console.log(`  !! ${m.nome}: o trecho a mutar NAO EXISTE MAIS -- mutante invalido`);
    falhas++;
    continue;
  }
  if (ocorrencias > 1) {
    console.log(`  !! ${m.nome}: o trecho aparece ${ocorrencias}x -- mutante ambiguo, invalido`);
    falhas++;
    continue;
  }

  const r = bloco.rodar(m.nome, { [FONTE]: original.replace(m.de, m.para) }, SUITE);

  if (r.verde) {
    console.log(`  SOBREVIVEU  ${m.nome}  <-- nenhuma assercao protege isto`);
    console.log(`              (${m.porque})`);
    if (r.mudouASaida === false) {
      console.log("              (saida compilada identica a da arvore limpa: EQUIVALENTE)");
    }
    falhas++;
  } else {
    // Morrer no tsc tambem e morrer -- mutante que nao compila nao chega em
    // producao --, mas a distincao importa: um erro de tipo nao diz que a SUITE
    // pegou a regra.
    console.log(`  morreu      ${m.nome}  (${r.como === "tsc" ? "tsc" : "asercao"})`);
  }
}

console.log();
if (falhas === 0) {
  console.log(`todos os ${MUTANTES.length} mutantes morreram`);
} else {
  console.log(`${falhas} mutante(s) sobreviveu/sobreviveram ou sao invalidos`);
  process.exit(1);
}
