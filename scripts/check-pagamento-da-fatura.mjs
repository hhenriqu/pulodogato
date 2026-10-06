#!/usr/bin/env node
// =====================================================
// O PAGAMENTO DA FATURA SAIU DE `bills/page.tsx`, E SO SAIU UMA VEZ? (HMO-310)
// =====================================================
//   node scripts/check-pagamento-da-fatura.mjs
//
// POR QUE ISTO EXISTE, SE A DECISAO JA TEM 33 ASSERCOES E 15 MUTANTES
// -------------------------------------------------------------------
// Porque `npm run test:pagamento-da-fatura` prova a DECISAO e a SEQUENCIA, e as
// duas podem estar perfeitas sem estarem LIGADAS. O que sobra e fiacao, e ela e
// muda -- nenhum destes quatro aparece no `tsc`:
//
//   1. o dialogo deixa de usar `FRASE_DO_PATRIMONIO` no toast de sucesso. Quem
//      pagou R$ 1.000 ve o patrimonio parado, conclui que a baixa nao
//      registrou e PAGA DE NOVO. E a frase inteira da fase: a issue diz, com
//      essas palavras, que sem ela a fase 14 nasce sem ela;
//   2. o dialogo deixa de dizer o MOTIVO do `Confirmar` desabilitado. Botao
//      cinza sem explicacao se le como "o app travou";
//   3. `bills/page.tsx` volta a montar a sequencia das escritas por conta
//      propria -- o `close`, o 409, o `/pay`. E a SEGUNDA implementacao da
//      de-duplicacao de fatura, e as duas divergem na primeira correcao. Esta e
//      a exigencia NEGATIVA deste guard, e e ela que impede a fase 13 de ser
//      desfeita em silencio;
//   4. a tela para de renderizar `DialogoDePagamentoDaFatura`. A fatura passaria
//      a nao ter dialogo nenhum, e `pedirBaixa` guardaria um estado que ninguem
//      le.
//
// A HMO-311 (fase 14) ACRESCENTOU A SEGUNDA TELA, e com ela tres fios novos que
// tambem sao mudos:
//
//   5. `SecaoDaTela` desenha o botao sem `onClick`, ou lê a regra errada. O
//      botao aparece e o clique nao faz nada -- o pior dos tres estados que o
//      cabecalho de lib/acoes-da-linha.ts enumera;
//   6. a lista passa a linha CRUA ao dialogo, sem `linhaParaPagarDaTela`. A
//      chave sintetica da fatura ABERTA vira id de banco, e o `/pay` responde
//      404 -- que para quem clicou se le como "o app nao conseguiu";
//   7. `aoPagar` deixa de ser `carregar`. A baixa acontece, o banco muda, e a
//      linha fica no «Previsto» -- "funcionou e a tela nao mudou" se le como
//      "nao funcionou", e a pessoa clica de novo num botao que mexe em dinheiro.
//
// E a exigencia NEGATIVA passou a valer para AS DUAS telas: a fase 14 nasceu
// depois da 13 exatamente para nao ser a segunda implementacao.
//
// OS COMENTARIOS SAO REMOVIDOS ANTES DA VARREDURA, E ISSO E LOAD-BEARING. Os
// tres arquivos abaixo EXPLICAM esta fase em prosa, e a prosa cita
// `/api/card-invoices/close`, `scheduled_transaction_id` e os nomes das
// constantes. Varrendo o fonte cru, a exigencia 3 reprovaria o arquivo
// CORRIGIDO (que fala do `close` para dizer que ele saiu) e as exigencias 1 e 2
// passariam verdes lendo um comentario. `semComentarios` e o mesmo helper dos
// outros guards textuais, pela mesma razao.
//
// E AS DECLARACOES DE `import` TAMBEM SAIEM, pelo motivo que a HMO-265 mediu: um
// guard que aceita a MENCAO do nome mede se a dependencia foi declarada, nao se
// ela e usada -- trocar `toast.success(m, { description: FRASE_DO_PATRIMONIO })`
// por `toast.success(m)` deixa o `import` intacto e o nome continua
// "aparecendo". Com os imports fora, a unica forma de satisfazer a exigencia e
// USAR.
// =====================================================

import { readFileSync } from "node:fs";
import { semComentarios } from "./varredura-de-fonte.mjs";

/** O fonte sem comentario e sem a lista de imports. Ver o cabecalho. */
function semComentariosNemImports(fonte) {
  return semComentarios(fonte).replace(
    /^\s*import\s[\s\S]*?from\s*["'][^"']*["'];?\s*$/gm,
    ""
  );
}

const DIALOGO = "components/fatura/DialogoDePagamentoDaFatura.tsx";
const TELA = "app/(dashboard)/dashboard/bills/page.tsx";
const LIB = "lib/pagamento-da-fatura.ts";
// A SEGUNDA TELA, desde a HMO-311 (fase 14): a lista das telas de movimentacao.
const LISTA = "components/movimentacoes/ListaDeMovimentacao.tsx";
const SECAO = "components/movimentacoes/SecaoDaTela.tsx";

const EXIGE = [
  {
    arquivo: DIALOGO,
    trechos: [
      // A FRASE NO TOAST DE SUCESSO, no proprio argumento do toast -- nao
      // solta em qualquer lugar do arquivo.
      "description: FRASE_DO_PATRIMONIO",
      // O motivo escrito do botao desabilitado.
      "MOTIVO_SEM_CONTA_PAGADORA",
      // A decisao e a sequencia vem da lib: nada e redecidido aqui.
      "decisaoDePagamentoDaFatura(",
      "pagarAFatura(",
      // As contas sao buscadas pelo componente, ao abrir.
      "/api/financial-accounts",
      "contasQuePodemPagar(",
    ],
    porque:
      "o dialogo e quem diz a frase do patrimonio e o motivo do botao desabilitado, e quem chama a decisao e a sequencia da lib. Sem isso a fase 14 herda um dialogo sem as duas frases que evitam o pagamento em dobro.",
  },
  {
    arquivo: TELA,
    trechos: [
      "<DialogoDePagamentoDaFatura",
      // OS DOIS CALL SITES, NOMEADOS. `linhaParaPagarDaAgenda(` solto nao
      // serve, e isso foi MEDIDO pelo controle negativo em
      // .github/workflows/verificacao.yml: a tela chama a funcao em DOIS
      // lugares (o galho de `pedirBaixa` e a prop do dialogo), e matar um
      // deixava o outro satisfazendo a exigencia. Com o galho morto, `pedirBaixa`
      // volta a ter o proprio criterio de "isto e fatura?" -- o segundo dono da
      // pergunta -- e o guard ficava verde.
      "decisaoDePagamentoDaFatura(linhaParaPagarDaAgenda(conta))",
      "linhaParaPagarDaAgenda(faturaParaPagar)",
      // A transferencia prevista (HMO-172) ainda da baixa por aqui, e a frase
      // dela e a MESMA -- importada, nao repetida em literal.
      "description: FRASE_DO_PATRIMONIO",
    ],
    porque:
      "Contas a Pagar tem de CONSUMIR o extraido. Sem o componente renderizado a fatura fica sem dialogo; sem a decisao no galho de `pedirBaixa`, a tela volta a ter o proprio criterio de 'isto e fatura?'.",
  },
  {
    arquivo: LIB,
    trechos: [
      // O galho das duas escritas. Ver o cabecalho da lib e os mutantes.
      "!linha.gravada",
      'linha.natureza === "fatura"',
      "mensagemContaPagadora(",
    ],
    porque:
      "a lib tem de decidir por `gravada` (o galho do close) e por `natureza` (a conta pagadora), e tirar o motivo da recusa da PROPRIA rota -- um texto escrito a mao aqui divergiria da mensagem que o /pay devolve.",
  },
  {
    // A FIACAO DA FASE 14. Os tres trechos sao CALL SITES, e nao nomes soltos:
    // um `includes("linhaParaPagarDaTela")` ficaria verde com a funcao
    // importada e nao chamada -- e o `tsc` nao reclama de prop que some.
    arquivo: LISTA,
    trechos: [
      "<DialogoDePagamentoDaFatura",
      // A CONVERSAO, no argumento. Sem ela a chave sintetica da fatura ABERTA
      // (`fatura:2026-10-01:<uuid>`) vai como id de banco, e o `/pay` responde
      // 404 em todo ramo onde o `close` nao sobrescrever o id.
      "linhaParaPagarDaTela(faturaParaPagar)",
      // A RECARGA. `aoPagar` com um `setX` local seria a SEGUNDA aritmetica da
      // de-duplicacao de fatura: quem de-duplica e a LEITURA
      // (`sintetizarFaturasAbertas`, na rota), entao a linha so sai do
      // «Previsto» depois de reler.
      "aoPagar={carregar}",
      // A frase obrigatoria da fatura SEM dia de vencimento. Sem ela, "a do
      // Nubank tem botão e a do C6 não" se lê como tela quebrada.
      "FATURA_SEM_VENCIMENTO_NAO_TEM_PAGAR",
    ],
    porque:
      "a tela de Despesas tem de CONSUMIR o dialogo extraido, converter a linha (a chave sintetica nao e id de banco) e recarregar pela LEITURA. E a fatura sem vencimento tem de dizer por que nao tem botao.",
  },
  {
    arquivo: SECAO,
    trechos: [
      // A REGRA LIDA PELA MARCACAO, e o `onClick` que leva ao container. Dado
      // certo chegando num JSX que nao o le nao quebra build nem muda pixel.
      "podePagarAFatura(linha)",
      "acoes.aoPagarFatura(linha)",
    ],
    porque:
      "o botao Pagar tem de sair da regra de lib/acoes-da-linha.ts e chamar de volta o container. Sem o `onClick`, o botao aparece e o clique nao faz nada -- o pior dos tres estados.",
  },
];

// A EXIGENCIA NEGATIVA: a tela nao pode ter a sequencia das escritas de volta.
//
// Nao e estilo. Um segundo tratamento do 409 do `close` e a segunda
// implementacao da de-duplicacao de fatura, e as duas divergem na primeira
// correcao -- exatamente o defeito que a fase 13 existe para nao deixar nascer.
//
// CADA PADRAO E UMA REGEX, E NAO UM `includes`, por um falso positivo medido: a
// tela tem `<Receipts alvo={{ scheduled_transaction_id: conta.id }} />`, que e o
// nome da COLUNA do comprovante e nao tem nada a ver com o 409 do `close`. Um
// `includes("scheduled_transaction_id")` reprovava o arquivo correto. O padrao e
// a LEITURA do campo numa resposta (`.scheduled_transaction_id`), que e a unica
// forma de tratar aquele 409.
const PROIBIDO_NA_TELA = [
  {
    padrao: /\/api\/card-invoices\/close/,
    como: "/api/card-invoices/close",
    porque:
      "a sequencia das escritas voltou para dentro da tela: o `close` tem UM dono, `pagarAFatura` em lib/pagamento-da-fatura.ts.",
  },
  {
    padrao: /\.\s*scheduled_transaction_id/,
    como: "a leitura de `.scheduled_transaction_id` numa resposta",
    porque:
      "o tratamento do 409 do `close` voltou para dentro da tela. Dois tratamentos do mesmo 409 divergem, e o que erra manda a pessoa recarregar para fazer o que ja esta feito.",
  },
  {
    padrao: /payment_account_id/,
    como: "payment_account_id",
    porque:
      "a tela voltou a montar o corpo do `/pay` com a conta pagadora. Quem monta e `pagarAFatura`; aqui isso significa um segundo caminho de pagamento de fatura.",
  },
];

let falhas = 0;

for (const { arquivo, trechos, porque } of EXIGE) {
  const fonte = semComentariosNemImports(readFileSync(arquivo, "utf8"));
  for (const trecho of trechos) {
    if (fonte.includes(trecho)) continue;
    console.error(`FALTA  ${arquivo}`);
    console.error(`       não cita \`${trecho}\` fora de comentário e de import`);
    console.error(`       ${porque}`);
    falhas++;
  }
}

// A EXIGENCIA NEGATIVA VALE PARA AS DUAS TELAS (HMO-311). A fase 14 nasceu
// DEPOIS da fase 13 exatamente para nao ser a segunda implementacao: se a tela
// de Despesas montar o `close`, o 409 ou o `payment_account_id` por conta
// propria, a extracao virou decoracao.
for (const arquivo of [TELA, LISTA]) {
  const fonte = semComentariosNemImports(readFileSync(arquivo, "utf8"));
  for (const { padrao, como, porque } of PROIBIDO_NA_TELA) {
    if (!padrao.test(fonte)) continue;
    console.error(`SOBRA  ${arquivo}`);
    console.error(`       cita ${como} fora de comentário`);
    console.error(`       ${porque}`);
    falhas++;
  }
}

// CONTRAPESO DA EXIGENCIA 1: `description: FRASE_DO_PATRIMONIO` poderia estar
// satisfeito por uma constante LOCAL com o mesmo nome -- e aí a frase da tela e
// a da lib divergiriam sem ninguem notar. A frase tem UM dono, e ele e a lib.
for (const arquivo of [DIALOGO, TELA]) {
  const fonte = semComentarios(readFileSync(arquivo, "utf8"));
  if (/FRASE_DO_PATRIMONIO\s*=/.test(fonte)) {
    console.error(`SOBRA  ${arquivo}`);
    console.error("       declara a própria `FRASE_DO_PATRIMONIO`");
    console.error(
      "       A frase do patrimônio mora em lib/pagamento-da-fatura.ts. Duas cópias divergem na primeira revisão de copy, e a que fica errada é a que ninguém lê."
    );
    falhas++;
  }
}

if (falhas > 0) {
  console.error(
    `\n${falhas} ponto(s) da fiação do pagamento da fatura está desligado (HMO-310/HMO-311).`
  );
  process.exit(1);
}

console.log(
  "OK: o diálogo diz a frase do patrimônio e o motivo do botão; AS DUAS telas (Contas a Pagar e Despesas) consomem o extraído; e a sequência das escritas não voltou para dentro de nenhuma delas."
);
