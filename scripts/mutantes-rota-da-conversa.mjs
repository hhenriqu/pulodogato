#!/usr/bin/env node
// Prova de mutacao da rota da conversa -- HMO-481 (F3 da HMO-462).
//
//   node scripts/mutantes-rota-da-conversa.mjs
//
// Cada entrada estraga UMA decisao da rota (ou da lib das categorias
// reservadas); `npm run test:rota-da-conversa` tem de ficar VERMELHA em todas.
// Mutante que sobrevive e um trecho que nenhuma assercao distingue.
//
// OS SEIS QUE A ISSUE NOMEIA SAO OS SEIS PRIMEIROS DA LISTA
// ---------------------------------------------------------
//   1. inverter o SINAL
//   2. apagar `account_id` (em duas formas -- ver abaixo)
//   4. apagar `transaction_type`
//   5. trocar `COLUNAS_DA_CONVERSA` por lista de colunas
//   6. trocar `today()` por `toISOString()`
//   e a CATEGORIA DE DIRECAO trocada, que mora na lib e esta nos tres ultimos.
//
// Se qualquer um deles sobrevive, nenhum outro compensa -- a suite nao estaria
// medindo a feature que a issue pediu.
//
// POR QUE ESTES, E POR QUE QUASE NENHUM DELES DA ERRO EM LUGAR NENHUM
// -------------------------------------------------------------------
// Nao ha excecao, 500, CHECK violado nem tela em branco em quase nenhum destes
// mutantes. A tela continua dizendo "anotei" e continua mostrando tres numeros
// bem formatados -- e so quem somar na mao descobre. E a familia de defeito que
// este repositorio ja pagou duas vezes (HMO-290, HMO-187):
//
//   * o SINAL invertido faz "Gastei 1000" virar receita. F2 soma por
//     `transaction_type`, nao por sinal, entao os TRES numeros ficam plausiveis
//     e o saldo erra para CIMA;
//   * `account_id` ausente e EXATAMENTE o defeito que
//     /api/personal-finance/transactions tem hoje: a coluna e anulavel, o insert
//     volta 201, e o `update_account_balance_trigger` nao move saldo nenhum. A
//     tela de contas passa a discordar do extrato, calada. Ele esta aqui em DUAS
//     formas porque as duas acontecem de verdade e uma assercao pode pegar uma e
//     deixar a outra passar: `null` grava a linha ORFA, e `undefined` e o que o
//     PostgREST DESCARTA do payload -- o objeto do insert parece ter o campo;
//   * `transaction_type` nulo faz as tres views da 008 descartarem a linha: ela
//     aparece na lista e nao mexe no saldo (HMO-181);
//   * o `select` NOMEADO responde `42703 column ... does not exist` em banco sem
//     a 060 colada -- e, aqui, o duble projeta e o criterio da coluna simplesmente
//     deixa de ser aplicavel, que e o mesmo estrago silencioso;
//   * `toISOString()` so erra em 3 das 24 horas do dia, e e por isso que a suite
//     CONGELA O RELOGIO num teste (ver o cabecalho de
//     scripts/test-rota-da-conversa.mjs). Sem aquele teste este mutante
//     sobreviveria de dia e morreria de madrugada -- placar de controle negativo
//     que depende da hora e pior que placar nenhum.
//
// A FORMA DA LISTA E A DA FAMILIA TUPLA DE ARIDADE 4
// --------------------------------------------------
// `scripts/mede-ancora-ambigua.mjs` -- a guarda que reprova ancora morta,
// ambigua ou de arquivo inexistente em TODO runner do repo -- le a lista de
// verdade usando o recorte de `converte-mutantes-em-bloco.mjs`. Ele exige a
// tupla `[ALVO, rotulo, de, para]` e que nenhuma `const` MULTILINHA seja
// declarada antes da lista: o recorte corta ate o proximo `\n];`, e um
// `const original = new Map(...)` multilinha ali levaria a lista inteira embora.
// Por isso o `original` e montado DEPOIS da lista, e so as duas `const` de uma
// linha vem antes.
//
// AS ANCORAS SAO LINHAS INTEIRAS, COM INDENTACAO
// ----------------------------------------------
// O cabecalho da rota CITA as proprias decisoes na prosa, e uma ancora curta
// mutaria o COMENTARIO e deixaria o codigo intacto -- com o placar dizendo
// "sobreviveu" sobre um mutante que nunca existiu. A trava de ocorrencia unica
// abaixo pega isso, mas a defesa barata e a ancora carregar a margem, a chave e a
// virgula, que a prosa nao tem.
//
// NENHUM MUTANTE E CONSTANTE DOBRAVEL
// -----------------------------------
// `if (false)` seria a forma obvia de desligar a recusa de 409, e o tsc a
// reprovaria por codigo inalcancavel -- morte no COMPILADOR, nao na assercao,
// que prova menos. Por isso quem desliga a recusa e o degrau da ESCADA que
// deixaria de achar `null` (mutante 8), que e falso sem ser constante.

import { readFileSync } from "node:fs";

import { criarBlocoDeMutantes } from "./mutantes-em-bloco.mjs";

const ROTA = "app/api/papel-de-pao/conversa/route.ts";
const LIB = "lib/categoria-da-conversa.ts";

/** [alvo, rotulo, de, para] */
const mutantes = [
  // =========================================================================
  // OS QUE A ISSUE NOMEIA
  // =========================================================================

  [
    ROTA,
    "1. o SINAL invertido: `Gastei 1000` entra como receita e o saldo erra para CIMA",
    '        amount: direcao === "gastei" ? -valor : valor,',
    '        amount: direcao === "gastei" ? valor : -valor,',
  ],

  [
    ROTA,
    "2. `account_id` vira NULL: a linha nasce ORFA e o trigger de saldo nao move nada",
    "        account_id: conta.id,",
    "        account_id: null,",
  ],

  [
    ROTA,
    "3. `account_id` vira UNDEFINED: o PostgREST DESCARTA a coluna e o payload parece ter o campo",
    "        account_id: conta.id,",
    "        account_id: undefined,",
  ],

  [
    ROTA,
    "4. `transaction_type` sai: as tres views da 008 descartam a linha (HMO-181)",
    "        transaction_type: TIPO_POR_DIRECAO[direcao],",
    "        transaction_type: undefined,",
  ],

  [
    ROTA,
    "5. o `select` volta a NOMEAR colunas: 42703 em banco sem a 060, e o criterio da coluna cai",
    "    .select(COLUNAS_DA_CONVERSA)",
    '    .select("id, transaction_type, amount, transaction_date")',
  ],

  [
    ROTA,
    "6. `today()` vira `toISOString()`: no fim do mes a linha nasce fora da janela que o GET soma",
    "        transaction_date: today(),",
    '        transaction_date: new Date().toISOString().slice(0, 10),',
  ],

  // =========================================================================
  // A ESCADA DA CONTA -- E O CARTAO, QUE DOBRA O DINHEIRO
  // =========================================================================

  [
    ROTA,
    "7. a ESCADA invertida: o degrau da idade ganha do degrau do nome, e `Conta Corrente` perde",
    `    ativas.find(
      (conta) =>
        conta.account_type === "checking" && conta.name === NOME_DA_CONTA_PADRAO
    ) ??
    ativas.find((conta) => escopoDoTipo(conta.account_type) === "conta") ??`,
    `    ativas.find((conta) => escopoDoTipo(conta.account_type) === "conta") ??
    ativas.find(
      (conta) =>
        conta.account_type === "checking" && conta.name === NOME_DA_CONTA_PADRAO
    ) ??`,
  ],

  [
    ROTA,
    "8. o criterio de escopo sai: o CARTAO entra, o dinheiro conta agora e outra vez na fatura",
    '    ativas.find((conta) => escopoDoTipo(conta.account_type) === "conta") ??',
    "    ativas.find(() => true) ??",
  ],

  [
    ROTA,
    "9. `is_active !== false` vira `=== true`: a conta do cache offline sai e a rota recusa com 409",
    "  const ativas = contas.filter((conta) => conta.is_active !== false);",
    "  const ativas = contas.filter((conta) => conta.is_active === true);",
  ],

  // =========================================================================
  // O RECORTE DA LEITURA
  // =========================================================================

  [
    ROTA,
    "10. o recorte por `service_id` sai: o dinheiro do outro servico entra nos tres numeros",
    '    .eq("service_id", serviceId)',
    '    .neq("service_id", "nenhum-servico-tem-este-id")',
  ],

  [
    ROTA,
    "11. o recorte por dono sai: a policy do 002 entrega tambem a linha de grupo de quem e membro",
    '    .eq("user_id", userId)',
    '    .neq("user_id", "ninguem-tem-este-id")',
  ],

  [
    ROTA,
    "12. a LISTA deixa de sair do criterio que somou: ela discorda do total que esta em cima dela",
    "    linhas: linhasDaConversa(doBanco, mes),",
    "    linhas: doBanco,",
  ],

  // =========================================================================
  // O CORPO RECUSADO
  // =========================================================================

  [
    ROTA,
    "13. o TETO de `numeric(15,2)` sai: 14 digitos viram `22003` como 500 em vez de 400",
    "const VALOR_DA_CONVERSA = /^\\d{1,13}(\\.\\d{1,2})?$/;",
    "const VALOR_DA_CONVERSA = /^\\d+(\\.\\d{1,2})?$/;",
  ],

  [
    ROTA,
    "14. a catraca da direcao vira EXCLUSAO: corpo vazio e typo gravam uma despesa",
    "  return DIRECOES.includes(bruta as Direcao) ? (bruta as Direcao) : null;",
    '  return bruta === "ganhei" ? "ganhei" : "gastei";',
  ],

  // =========================================================================
  // AS DUAS CATEGORIAS RESERVADAS
  // =========================================================================

  [
    LIB,
    "15. a categoria do gasto passa a ter `is_expense: false`: o degrau 2 classifica ao contrario",
    "    is_expense: true,",
    "    is_expense: false,",
  ],

  [
    LIB,
    "16. as duas reservadas ficam com o MESMO nome: uma direcao adota a categoria da outra",
    '    name: "Papel de pão — gasto",',
    '    name: "Papel de pão — ganho",',
  ],

  [
    LIB,
    "17. a `description` do lancamento troca de direcao: a lista diz `Ganhei` no que ela gastou",
    '    descricaoDoLancamento: "Gastei",',
    '    descricaoDoLancamento: "Ganhei",',
  ],

  [
    LIB,
    "18. a busca da categoria perde o dono: o lancamento dela aponta para a categoria de outra pessoa",
    `  const { data: existente, error: erroBusca } = await supabase
    .from("transaction_categories")
    .select("id")
    .eq("service_id", serviceId)
    .eq("user_id", userId)`,
    `  const { data: existente, error: erroBusca } = await supabase
    .from("transaction_categories")
    .select("id")
    .eq("service_id", serviceId)`,
  ],
];

const SUITE = "test:rota-da-conversa";

const bloco = criarBlocoDeMutantes({
  suites: [SUITE],
  rotulo: "rota-da-conversa",
});

// Lido da arvore de verdade, que e o original por construcao: nada mais aqui
// escreve nela. Montado DEPOIS da lista -- ver A FORMA DA LISTA, no cabecalho.
const original = new Map();
for (const arquivo of new Set(mutantes.map(([alvo]) => alvo))) {
  original.set(arquivo, readFileSync(arquivo, "utf8"));
}

// CONTROLE POSITIVO: a arvore limpa tem de passar. Sem ele, uma suite ja
// vermelha deixaria TODO mutante aparecendo como morto e o placar sairia cheio
// sem medir nada.
const limpo = bloco.rodar("<arvore limpa>", {}, SUITE);
if (!limpo.verde) {
  console.error(
    "controle positivo REPROVOU: a suite ja esta vermelha sem mutante nenhum. " +
      "Todo mutante abaixo apareceria como MORTO sem medir nada.\n" +
      `  como: ${limpo.como}\n  saida: ${limpo.saida}`
  );
  bloco.fechar();
  process.exit(1);
}
console.log("controle positivo: arvore limpa VERDE.\n");

let mortos = 0;
const sobreviventes = [];

for (const [arquivo, rotulo, de, para] of mutantes) {
  const fonte = original.get(arquivo);
  const ocorrencias = fonte.split(de).length - 1;

  if (ocorrencias === 0) {
    console.error(
      `ANCORA MORTA  ${rotulo}\n  ${arquivo} nao contem o trecho procurado. ` +
        "Isto e erro do runner, nao mutante morto -- conserte a ancora."
    );
    bloco.fechar();
    process.exit(1);
  }

  // A TRAVA DE OCORRENCIA UNICA. `String.replace` troca a PRIMEIRA ocorrencia:
  // um `de` que aparece duas vezes muta um lugar que o rotulo nao descreve. O
  // risco e concreto nos dois arquivos -- o cabecalho da rota CITA as decisoes na
  // prosa, e a lib das categorias tem DOIS blocos de busca quase identicos.
  if (ocorrencias > 1) {
    console.error(
      `ANCORA AMBIGUA  ${rotulo}\n  o trecho aparece ${ocorrencias}x em ${arquivo} ` +
        "-- o replace muta so a 1a. Isto e erro do runner; estreite a ancora."
    );
    bloco.fechar();
    process.exit(1);
  }

  const mutado = fonte.replace(de, para);

  if (mutado === fonte) {
    console.error(
      `MUTACAO NO-OP  ${rotulo}\n  o replace nao mudou o texto de ${arquivo}.`
    );
    bloco.fechar();
    process.exit(1);
  }

  const r = bloco.rodar(rotulo, { [arquivo]: mutado }, SUITE);

  if (!r.verde) {
    mortos += 1;
    console.log(`MORTO      ${rotulo}`);
  } else {
    sobreviventes.push(rotulo);
    console.log(`SOBREVIVEU ${rotulo}`);
    if (r.mudouASaida === false) {
      console.log(
        "           (saida compilada identica a da arvore limpa: EQUIVALENTE)"
      );
    }
  }
}

bloco.fechar();

console.log(`\n${mortos}/${mutantes.length} mortos.`);
if (sobreviventes.length > 0) {
  console.log("\nsobreviventes:");
  for (const s of sobreviventes) console.log(`  - ${s}`);
}

// Sai 1 com sobrevivente: um runner que saisse 0 deixaria o step de CI verde
// para sempre e provaria o mesmo que step nenhum.
process.exit(sobreviventes.length === 0 ? 0 : 1);
