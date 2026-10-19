#!/usr/bin/env node
// =====================================================
// PULODOGATO - controle negativo da travessa de arquivar o grupo (HMO-426)
// =====================================================
//   node scripts/mutantes-travessa-de-arquivar.mjs
//
// POR QUE ESTE RUNNER EXISTE
// --------------------------
// `test:travessa-de-arquivar` passa com 9 casos verdes, e tres das assercoes
// que mais importam nele sao de AUSENCIA -- `escritas: []` nos caminhos de
// recusa, e "nao le group_expense_splits". Assercao de ausencia passa verde
// tambem quando ela deixou de medir, e esta travessa ja ficou verde medindo a
// coisa errada DUAS vezes (HMO-145 e a propria HMO-426). Cada entrada abaixo
// estraga UMA decisao do conserto; a suite tem de ficar VERMELHA em todas.
//
// O MUTANTE QUE E O CODIGO DE ANTES DO CONSERTO
// ---------------------------------------------
// `o criterio volta a ser o status da parte` e o estado anterior, letra por
// letra. Ele e a unica coisa que prova que a medicao ve o defeito que a issue
// descreve, e nao uma variacao proxima dele -- e ele morre pelo lado que
// SURPREENDE: os casos de sucesso continuam verdes com ele, porque o duble nao
// emula embed e a consulta velha responde vazio ali. Quem o mata e o lado da
// PROTECAO (grupo devendo tem de ser recusado, e com o criterio velho ele era
// liberado) e a assercao de onde o criterio le. Isto esta anotado porque a
// leitura intuitiva -- "o caso da issue mata o mutante da issue" -- esta errada
// aqui, e quem for mexer na suite precisa saber qual assercao e load-bearing.
//
// OS DOIS CHAMADORES TEM MUTANTE PROPRIO
// --------------------------------------
// `apagar o grupo` e `sair como ultimo membro` carregam CADA UM a sua copia do
// bloco de decisao. O defeito da HMO-145 estava escrito duas vezes, nas duas
// rotas, e o modo de falha mais provavel aqui e consertar uma e esquecer a
// outra. Um mutante por rota e o que distingue "a travessa decide certo" de "as
// duas rotas obedecem a travessa".
//
// A MUTACAO VAI PARA UMA SOMBRA EM /tmp, NUNCA PARA A ARVORE: ver o cabecalho
// de scripts/mutantes-em-bloco.mjs.
// =====================================================

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const TRAVESSA = "lib/services/expense-groups.ts";
const ROTA_APAGAR = "app/api/expense-groups/[groupId]/route.ts";
const ROTA_SAIR = "app/api/expense-groups/[groupId]/leave/route.ts";
/** O oraculo: chama os dois handlers e rele `is_active` na tabela. */
const SONDA = "test:travessa-de-arquivar";

// OS CAMINHOS SAO RELATIVOS A RAIZ, E LIDOS DIRETO -- SEM HELPER.
// A guarda `check-ancora-de-mutante` IMPORTA o miolo deste arquivo como modulo
// de dados, sem os imports dele, e uma declaracao que CHAMA funcao estoura ali
// e aborta a varredura inteira. A forma que ela sabe ler e esta:
// `readFileSync(CONSTANTE, "utf8")` com a constante guardando o caminho
// relativo.
const originais = {
  [TRAVESSA]: readFileSync(TRAVESSA, "utf8"),
  [ROTA_APAGAR]: readFileSync(ROTA_APAGAR, "utf8"),
  [ROTA_SAIR]: readFileSync(ROTA_SAIR, "utf8"),
};

const MUTANTES = [
  // -------------------------------------------------------------------------
  // O DEFEITO DA ISSUE, RECONSTITUIDO
  // -------------------------------------------------------------------------
  {
    nome: "o criterio volta a ser o status da parte (o defeito da issue)",
    suite: SONDA,
    fonte: TRAVESSA,
    porque:
      "o codigo de antes do conserto, letra por letra. Depois da HMO-425 nenhum caminho do app escreve nessa coluna: toda parte nasce 'pending' e fica, entao grupo com qualquer despesa lancada nao podia mais ser arquivado nem apagado -- para sempre, e sem porta de saida, porque o aprovar/recusar que a mensagem antiga nomeava saiu na mesma issue",
    de:
      '    .from("group_member_balances")\n' +
      '    .select("user_id")\n' +
      '    .eq("group_id", groupId)\n' +
      '    .neq("net_balance", 0)\n',
    para:
      '    .from("group_transactions")\n' +
      '    .select("id, group_expense_splits!inner(id)")\n' +
      '    .eq("group_id", groupId)\n' +
      '    .eq("group_expense_splits.status", "pending")\n',
  },

  // -------------------------------------------------------------------------
  // A COMPARACAO COM ZERO -- O CRITERIO NOVO
  // -------------------------------------------------------------------------
  {
    nome: "a comparacao com zero sai da consulta",
    suite: SONDA,
    fonte: TRAVESSA,
    porque:
      "sem o `neq`, QUALQUER membro ativo conta como saldo em aberto: a view tem uma linha por membro, entao grupo nenhum com gente dentro pode mais ser arquivado. E o travamento eterno de volta, por outro caminho -- e o 'ha' continua sendo tecnicamente uma resposta da view, o que faz o defeito parecer um criterio",
    de: '    .neq("net_balance", 0)\n',
    para: "",
  },
  {
    nome: "o criterio le quem esta em ZERO em vez de quem nao esta",
    suite: SONDA,
    fonte: TRAVESSA,
    porque:
      "`eq` por `neq` inverte a feature inteira: o grupo acertado passa a ser o recusado e o grupo devendo passa a ser arquivavel. Este e o mutante que mede dinheiro -- arquivar com saldo em aberto esconde das duas telas o registro de quem devia a quem, e nao tem volta pelo app",
    de: '    .neq("net_balance", 0)',
    para: '    .eq("net_balance", 0)',
  },
  {
    nome: "o recorte por grupo sai da consulta",
    suite: SONDA,
    fonte: TRAVESSA,
    porque:
      "a travessa passa a somar o saldo de TODOS os grupos de quem pergunta: uma divida de outra viagem trava o grupo que esta acertado. Sem o caso do grupo vizinho na suite, este mutante sobrevive -- 'o meu saldo' e 'o saldo de todos os meus grupos' sao o mesmo conjunto num fixture de um grupo so",
    de: '    .eq("group_id", groupId)\n',
    para: "",
  },

  // -------------------------------------------------------------------------
  // O CONTRATO DE TRES ESTADOS (a travessa da HMO-145)
  // -------------------------------------------------------------------------
  {
    nome: "o erro de leitura volta a colapsar em 'nao ha' (o defeito da HMO-145)",
    suite: SONDA,
    fonte: TRAVESSA,
    porque:
      "exatamente o colapso que produziu a falha ABERTA da HMO-145: a consulta dava 42703, o `error` nao era lido, `data` vinha `null`, e a travessa concluia 'nao ha nada pendente' -- SEMPRE, sem log, sem 500 e sem sintoma na tela. O contrato tem tres estados por causa disto",
    de: '  if (error) return { situacao: "nao-deu-para-saber", erro: error };\n',
    para: "",
  },
  {
    nome: "'ha' e 'nao ha' trocam de lugar",
    suite: SONDA,
    fonte: TRAVESSA,
    porque:
      "o erro de sinal mais facil de escrever no fim de uma funcao de existencia. Grupo acertado recusado, grupo devendo arquivado",
    de: '  return (data ?? []).length > 0 ? { situacao: "ha" } : { situacao: "nao-ha" };',
    para: '  return (data ?? []).length > 0 ? { situacao: "nao-ha" } : { situacao: "ha" };',
  },

  // -------------------------------------------------------------------------
  // APAGAR O GRUPO -- a copia do bloco de decisao que vive na rota do grupo
  // -------------------------------------------------------------------------
  {
    nome: "apagar o grupo: 'nao deu para saber' deixa de recusar",
    suite: SONDA,
    fonte: ROTA_APAGAR,
    porque:
      "o 503 sai e a rota segue para as escritas: um erro de leitura passa a AUTORIZAR o arquivamento. E a HMO-145 um nivel acima -- a funcao distingue os tres estados corretamente e a rota joga um deles fora",
    de:
      '    if (saldoEmAberto.situacao === "nao-deu-para-saber") {\n' +
      "      console.error(\n" +
      '        "Não deu para verificar o saldo em aberto do grupo:",\n' +
      "        saldoEmAberto.erro\n" +
      "      );\n" +
      "      return NextResponse.json(\n" +
      "        {\n" +
      "          error:\n" +
      '            "Não foi possível verificar se há saldo em aberto no grupo. Tente de novo em instantes.",\n' +
      "        },\n" +
      "        { status: 503 }\n" +
      "      );\n" +
      "    }\n\n",
    para: "",
  },
  {
    nome: "apagar o grupo: a travessa recusa o grupo ERRADO",
    suite: SONDA,
    fonte: ROTA_APAGAR,
    porque:
      "a condicao da recusa troca de estado: o grupo acertado leva 400 (o travamento eterno da issue, agora escrito na rota) e o grupo devendo cai direto nas escritas. Um mutante, os dois lados",
    de: '    if (saldoEmAberto.situacao === "ha") {',
    para: '    if (saldoEmAberto.situacao === "nao-ha") {',
  },

  // -------------------------------------------------------------------------
  // SAIR COMO ULTIMO MEMBRO -- a OUTRA copia do mesmo bloco
  // -------------------------------------------------------------------------
  {
    nome: "sair do grupo: 'nao deu para saber' deixa de recusar",
    suite: SONDA,
    fonte: ROTA_SAIR,
    porque:
      "o mesmo buraco da rota de apagar, na copia que vive em leave/route.ts. Os dois mutantes existem porque o bloco esta escrito duas vezes, e foi assim que o defeito da HMO-145 chegou em duplicado",
    de:
      '  if (saldoEmAberto.situacao === "nao-deu-para-saber") {\n' +
      "    console.error(\n" +
      '      "Não deu para verificar o saldo em aberto do grupo:",\n' +
      "      saldoEmAberto.erro\n" +
      "    );\n" +
      "    return NextResponse.json(\n" +
      "      {\n" +
      "        error:\n" +
      '          "Não foi possível verificar se há saldo em aberto no grupo. Tente de novo em instantes.",\n' +
      "      },\n" +
      "      { status: 503 }\n" +
      "    );\n" +
      "  }\n\n",
    para: "",
  },
  {
    nome: "sair do grupo: a travessa recusa o grupo ERRADO",
    suite: SONDA,
    fonte: ROTA_SAIR,
    porque:
      "a condicao da recusa troca de estado na rota de sair: quem e o ultimo membro de um grupo acertado nao consegue sair, e quem e o ultimo membro de um grupo devendo sai e leva o registro da divida embora",
    de: '  if (saldoEmAberto.situacao === "ha") {',
    para: '  if (saldoEmAberto.situacao === "nao-ha") {',
  },
];

const bloco = criarBlocoDeMutantes({
  rotulo: "travessa-de-arquivar",
  suites: [SONDA],
});

process.on("exit", () => bloco.fechar());

// CONTROLE POSITIVO. Sem ele, um pipeline quebrado faria TODO mutante "morrer"
// e o placar sairia cheio sobre zero assercoes executadas.
for (const suite of [SONDA]) {
  const controle = bloco.rodar(`controle:${suite}`, originais, suite);
  if (!controle.verde) {
    console.error(
      `CONTROLE FALHOU: as fontes intactas reprovam em ${suite} (${controle.como})`
    );
    console.error(`  ${controle.saida}`);
    process.exit(1);
  }
  console.log(`CTRL  as fontes intactas passam em ${suite}`);
}
console.log("");

let mortos = 0;
let porAssercao = 0;
const sobreviventes = [];

for (const m of MUTANTES) {
  const original = originais[m.fonte];

  // MUTANTE QUE NAO SE APLICA E O PIOR RESULTADO POSSIVEL: contaria como
  // "morreu" sem nunca ter existido.
  const ocorrencias = original.split(m.de).length - 1;
  if (ocorrencias === 0) {
    console.error(`NAO APLICOU: ${m.nome}`);
    console.error(`             o trecho procurado nao esta em ${m.fonte}`);
    sobreviventes.push(`${m.nome} (trecho ausente)`);
    continue;
  }
  if (ocorrencias > 1) {
    console.error(`AMBIGUO: ${m.nome}`);
    console.error(
      `         o trecho aparece ${ocorrencias}x em ${m.fonte}; a mutacao atingiria so a primeira`
    );
    sobreviventes.push(`${m.nome} (ancora ambigua)`);
    continue;
  }

  const r = bloco.rodar(
    m.nome,
    { ...originais, [m.fonte]: original.replace(m.de, m.para) },
    m.suite
  );

  if (!r.verde) {
    mortos++;
    if (r.como !== "tsc") porAssercao++;
    console.log(`MORTO ${m.nome}  (${r.como === "tsc" ? "tsc" : "asercao"}, ${m.suite})`);
  } else {
    console.error(`VIVO  ${m.nome}`);
    console.error(`      ${m.porque}`);
    // Sobreviver emitindo o MESMO byte nao e furo de assercao: e mutante
    // equivalente, e nenhuma assercao o mataria.
    if (r.mudouASaida === false) {
      console.error(
        "      (saida compilada identica a da arvore limpa: EQUIVALENTE, nao furo de teste)"
      );
    }
    sobreviventes.push(m.nome);
  }
}

console.log(`\n${mortos}/${MUTANTES.length} mortos (${porAssercao} por assercao).`);

// UM PLACAR PERFEITO SO PELO COMPILADOR NAO MEDE A SUITE. Se nenhum mutante
// morreu por assercao, o que ficou verde foi o `tsc` -- e a suite pode estar
// vazia.
if (mortos > 0 && porAssercao === 0) {
  console.error(
    "\nNENHUM mutante morreu por assercao: o que reprovou foi o compilador.\n" +
      "A suite nao esta medindo o comportamento, so a forma do codigo."
  );
  process.exit(1);
}

if (sobreviventes.length > 0) {
  console.error("\nSOBREVIVENTES:");
  for (const nome of sobreviventes) console.error(`  - ${nome}`);
  process.exit(1);
}
