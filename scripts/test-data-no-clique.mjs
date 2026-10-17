#!/usr/bin/env node
// =====================================================
// PULODOGATO - A DATA E A DO CLIQUE, NAO A DA MONTAGEM (HMO-315)
// =====================================================
//   npm run test:data-no-clique
//
// O DEFEITO QUE ESTA SUITE EXISTE PARA MEDIR
// ------------------------------------------
// `app/(dashboard)/dashboard/bills/page.tsx` guardava a data de hoje numa
// CONSTANTE DE MODULO:
//
//     const HOJE = new Intl.DateTimeFormat("en-CA", { ... }).format(new Date());
//
// Num componente `"use client"` aquilo e avaliado UMA vez -- quando o navegador
// avalia o chunk, e nao quando a pessoa clica. Numa aba que atravessa a
// meia-noite `HOJE` continua sendo a data de ONTEM. Este app e PWA com service
// worker: aba aberta por dias no celular e o caso normal, nao o raro.
//
// Tres dos quatro usos gravavam dinheiro ou data de dinheiro -- o `paid_date`
// da baixa, o `paid_date` da FATURA, o vencimento sugerido. No dia 1o a data de
// ontem cai no MES ANTERIOR: o lancamento troca de mes no fluxo de caixa, no
// teto da categoria e no "quanto este mes cobra". A baixa responde 200, a data
// gravada e plausivel, a linha sai do previsto como esperado, e NADA na tela
// acusa. Quem descobre e quem fecha o mes e acha o valor num mes e falta no
// outro.
//
// O CONTROLE QUE SEPARA ESTA SUITE DE UM FIXTURE INOCENTE
// -------------------------------------------------------
// E o relogio que ANDA entre a montagem e o clique. Um teste que chame a funcao
// UMA vez passa verde com a constante de modulo intacta -- a constante so erra
// quando o tempo passa entre a avaliacao e o uso. Por isso todo caso de
// sequencia aqui move o relogio no meio, e todo caso tem o par:
//
//   * a forma NOVA (ler no gesto) grava a data do CLIQUE;
//   * a forma ANTIGA (congelar na montagem) grava a data da MONTAGEM -- e esta
//     assercao e afirmativa, nao um `assert.ok(!...)`. Sem ela a suite passaria
//     identica num app em que nada foi consertado.
//
// O QUE E PRODUCAO AQUI, E O QUE E HARNESS -- DITO EM VOZ ALTA
// ------------------------------------------------------------
// Producao: `today()` (`lib/recurrence.ts`), que e quem le o relogio, e
// `pagarAFatura` (`lib/pagamento-da-fatura.ts`), que e quem monta o corpo com
// `paid_date`. A data medida nas assercoes de sequencia e a que sai do
// `JSON.stringify` de producao, nao uma variavel do teste.
//
// Harness: o `montarDialogo` abaixo, ~10 linhas que fazem o que
// `DialogoDePagamentoDaFatura` faz com a prop `hoje` -- guardar na montagem e
// chamar no `confirmar`. Ele NAO e o componente React: `node --test` nao
// renderiza JSX e `react-dom/server` nao chama handler nenhum.
//
// Quem cobre o que o harness nao cobre:
//
//   * que a prop `hoje` seja `() => string` e nao `string` e o `tsc` --
//     `components/movimentacoes/ListaDeMovimentacao.tsx` passava `hoje={today()}`
//     e DEIXOU DE COMPILAR quando o tipo mudou, que e como aquele segundo
//     chamador foi encontrado;
//   * que nenhuma tela volte a guardar data em constante de modulo e
//     `npm run check-data-no-clique`, que varre `app/` e `components/` com os
//     comentarios removidos.
//
// OS DOIS FUSOS
// -------------
// O npm script roda a suite DUAS vezes, `TZ=America/Sao_Paulo` e `TZ=UTC`: o
// sandbox e Sao Paulo e o runner do GitHub e UTC, e defeito de fuso que so se
// manifesta num dos dois passa verde justamente no ambiente que decide o PR
// (ver a HMO-210). As assercoes daqui sao de valor ABSOLUTO ("2026-10-31"), e
// nao comparacoes com o relogio do processo, exatamente para valerem nos dois
// -- o que so e possivel porque `today()` pede `America/Sao_Paulo` ao `Intl`
// EXPLICITAMENTE. Se alguem tirar o fuso de la, estes casos reprovam em UTC.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";

const { today } = await import("../.tmp-data-no-clique/recurrence.js");
const { pagarAFatura } = await import(
  "../.tmp-data-no-clique/pagamento-da-fatura.js"
);

// ---------------------------------------------------------------------------
// O relogio congelado, e o relogio que ANDA
// ---------------------------------------------------------------------------
// `today()` chama `new Date()` e nao recebe o instante por parametro -- mudar a
// assinatura mexeria em bills, budgets, goals e doze rotas. Trocar o `Date`
// global durante a chamada e o menor gesto que prova o comportamento no horario
// em que ele quebra (mesma receita de `scripts/test-periodo-painel.mjs`).
//
// A diferenca desta aqui: `instante` e MUTAVEL. `relogioEm` devolve um
// `avancarPara` que move o tempo DENTRO do bloco, que e o unico jeito de
// distinguir "lido na montagem" de "lido no clique".
function comRelogioQueAnda(instanteInicialIso, fn) {
  const Real = Date;
  let agora = new Real(instanteInicialIso).getTime();

  class Congelada extends Real {
    constructor(...args) {
      if (args.length === 0) super(agora);
      else super(...args);
    }
    static now() {
      return agora;
    }
  }

  globalThis.Date = Congelada;
  const avancarPara = (iso) => {
    agora = new Real(iso).getTime();
  };
  try {
    return fn(avancarPara);
  } finally {
    globalThis.Date = Real;
  }
}

// ---------------------------------------------------------------------------
// Os dois instantes, e por que estes
// ---------------------------------------------------------------------------
// 2026-10-31T23:50 em Sao Paulo (UTC-3) -> 2026-11-01T02:50Z.
//
// Este instante carrega os DOIS defeitos de uma vez:
//
//   * em UTC a data ja virou ("2026-11-01"), em Sao Paulo nao ("2026-10-31");
//   * e a virada e de MES, que e o caso caro: o lancamento troca de mes no
//     fluxo de caixa e no teto da categoria.
//
// (O Brasil nao tem horario de verao desde 2019, entao UTC-3 vale o ano todo e
// estes numeros nao envelhecem.)
const ANTES_DA_VIRADA = "2026-11-01T02:50:00Z";
const DEPOIS_DA_VIRADA = "2026-11-01T03:05:00Z";

const DIA_DA_MONTAGEM = "2026-10-31";
const DIA_DO_CLIQUE = "2026-11-01";

// ---------------------------------------------------------------------------
// 1. `today()` le o relogio quando e CHAMADA
// ---------------------------------------------------------------------------

test("today() devolve a data de Sao Paulo, nao a de UTC, as 23:50 de 31/10", () => {
  const dia = comRelogioQueAnda(ANTES_DA_VIRADA, () => today());
  assert.equal(dia, DIA_DA_MONTAGEM);
});

test("CONTROLE: a forma de UTC erra nesse mesmo instante, e erra de MES", () => {
  // Sem esta assercao o caso acima passaria identico num instante inofensivo, e
  // ninguem saberia se ele cobre a armadilha do fuso ou so o caso facil. Ela
  // tambem e o que faz a suite falar a mesma coisa em UTC e em Sao Paulo:
  // `toISOString()` e UTC nos dois.
  const emUtc = comRelogioQueAnda(ANTES_DA_VIRADA, () =>
    new Date().toISOString().slice(0, 10)
  );

  assert.equal(emUtc, DIA_DO_CLIQUE);
  assert.notEqual(emUtc.slice(0, 7), DIA_DA_MONTAGEM.slice(0, 7));
});

test("a MESMA today() devolve outra data depois da meia-noite: ela nao congela", () => {
  // O caso que a constante de modulo nao sobrevive. Duas chamadas, um relogio
  // que andou 15 minutos no meio, duas respostas -- e meses diferentes.
  const { naMontagem, noClique } = comRelogioQueAnda(
    ANTES_DA_VIRADA,
    (avancarPara) => {
      const naMontagem = today();
      avancarPara(DEPOIS_DA_VIRADA);
      const noClique = today();
      return { naMontagem, noClique };
    }
  );

  assert.equal(naMontagem, DIA_DA_MONTAGEM);
  assert.equal(noClique, DIA_DO_CLIQUE);
  assert.notEqual(naMontagem, noClique);
});

// ---------------------------------------------------------------------------
// 2. A sequencia: montar, o relogio andar, clicar
// ---------------------------------------------------------------------------
// Daqui para baixo a data medida e a que `pagarAFatura` (producao) poe em
// `paid_date`, lida do corpo que ele mandou para a rede.

const CARTAO = "11111111-1111-4111-8111-111111111111";
const CORRENTE = "22222222-2222-4222-8222-222222222222";
const ID_DA_FECHADA = "33333333-3333-4333-8333-333333333333";

/** A fatura FECHADA da agenda: uma escrita so, sem `close` antes. */
const faturaFechada = () => ({
  id: ID_DA_FECHADA,
  description: "Fatura Nubank 10/2026",
  gravada: true,
  natureza: "fatura",
  fatura: { accountId: CARTAO, mes: "2026-10-01" },
});

/** A rede falsa: grava o corpo de cada chamada. `ok` e DERIVADO do status. */
function redeFalsa(respostas) {
  const chamadas = [];
  const fila = [...respostas];
  const rede = async (url, init) => {
    chamadas.push({ url, corpo: JSON.parse(init.body) });
    if (fila.length === 0) {
      throw new Error(`chamada de rede inesperada: ${url}`);
    }
    const r = fila.shift();
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body,
    };
  };
  return { rede, chamadas };
}

/**
 * O HARNESS, e so ele: o que `DialogoDePagamentoDaFatura` faz com a prop `hoje`.
 *
 * Recebe `hoje` na MONTAGEM e devolve o `confirmar`, como o componente recebe a
 * prop no render e devolve o handler. O que varia entre os dois casos abaixo e
 * SO o que se passa aqui -- uma funcao ou uma string ja congelada.
 */
function montarDialogo(hoje, rede) {
  return {
    confirmar: () =>
      pagarAFatura({
        linha: faturaFechada(),
        contaPagadoraId: CORRENTE,
        pagoEm: hoje(),
        rede,
      }),
  };
}

const RESPOSTA_DO_PAY = [
  { status: 200, body: { message: "Fatura paga com Itaú", is_transfer: true } },
];

test("a fatura paga depois da meia-noite grava o paid_date do CLIQUE", async () => {
  const { rede, chamadas } = redeFalsa(RESPOSTA_DO_PAY);

  const r = await comRelogioQueAnda(
    ANTES_DA_VIRADA,
    async (avancarPara) => {
      // A MONTAGEM: 23:50 de 31/10. A tela passa a FUNCAO, nao a data.
      const dialogo = montarDialogo(today, rede);

      // A ABA ATRAVESSA A MEIA-NOITE enquanto o dialogo esta aberto.
      avancarPara(DEPOIS_DA_VIRADA);

      // O CLIQUE em Confirmar.
      return dialogo.confirmar();
    }
  );

  assert.equal(r.ok, true);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].corpo.paid_date, DIA_DO_CLIQUE);
  assert.equal(chamadas[0].corpo.payment_account_id, CORRENTE);
});

test("CONTROLE: congelada na montagem, a MESMA sequencia grava o mes ERRADO", async () => {
  // A forma antiga, escrita como ela era: a data e lida UMA vez, na montagem, e
  // o clique usa aquela. E esta e a assercao que torna o caso acima uma medida
  // em vez de um fixture -- ela AFIRMA o defeito, com numero.
  const { rede, chamadas } = redeFalsa(RESPOSTA_DO_PAY);

  const r = await comRelogioQueAnda(ANTES_DA_VIRADA, async (avancarPara) => {
    const congelada = today();
    const dialogo = montarDialogo(() => congelada, rede);
    avancarPara(DEPOIS_DA_VIRADA);
    return dialogo.confirmar();
  });

  assert.equal(r.ok, true);

  // A baixa responde OK e a data e plausivel: e por isso que isto nao tem
  // sintoma na tela.
  assert.equal(chamadas[0].corpo.paid_date, DIA_DA_MONTAGEM);

  // E O PRECO, dito como numero: o pagamento cai em OUTUBRO, nao em novembro.
  assert.equal(chamadas[0].corpo.paid_date.slice(0, 7), "2026-10");
  assert.notEqual(
    chamadas[0].corpo.paid_date.slice(0, 7),
    DIA_DO_CLIQUE.slice(0, 7)
  );
});

// ---------------------------------------------------------------------------
// 3. O vencimento sugerido do formulario
// ---------------------------------------------------------------------------
// O quarto uso de `HOJE` em Contas a Pagar nao grava baixa: ele e o `due_date`
// que nasce no campo. Errado, a conta nasce vencida (ou vence no mes passado), e
// quem nao olhar o campo salva assim. A tela re-semeia no gesto de ABRIR o
// dialogo, que e o ultimo momento antes de a pessoa ver a data.

test("o vencimento sugerido e semeado quando o dialogo ABRE, nao na montagem", () => {
  const { naMontagem, aoAbrir } = comRelogioQueAnda(
    ANTES_DA_VIRADA,
    (avancarPara) => {
      // `useState(() => ({ ..., due_date: today() }))` na montagem da tela.
      const naMontagem = today();

      // A aba fica aberta a noite inteira, e so entao alguem clica em
      // "Conta avulsa".
      avancarPara(DEPOIS_DA_VIRADA);

      // `aoAbrirDialogAvulsa` -> `setFormAvulsa({ ..., due_date: today() })`.
      const aoAbrir = today();
      return { naMontagem, aoAbrir };
    }
  );

  assert.equal(naMontagem, DIA_DA_MONTAGEM);
  assert.equal(aoAbrir, DIA_DO_CLIQUE);
});
