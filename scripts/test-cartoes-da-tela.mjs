#!/usr/bin/env node
// =====================================================
// PULODOGATO - os tres cartoes das telas de movimentacao (HMO-246)
// =====================================================
//   npm run test:cartoes-da-tela
//
// POR QUE ESTE TESTE RENDERIZA O COMPONENTE
// -----------------------------------------
// `resumoDaTela` ja tem suite propria (test-telas-de-movimentacao, 34 blocos) e
// 26 mutantes. TODA ela passaria verde com o JSX imprimindo `previsto` no cartao
// "Realizado": a aritmetica estaria exata e a tela ignorando ela. Nao quebra
// build, nao fica vazio, e os dois numeros sao plausiveis -- a unica coisa que
// denuncia e ler o HTML.
//
// Aqui o `react-dom/server` renderiza o mesmo arquivo que o app importa, e o
// teste afirma sobre o HTML que sai.
//
// OS TRES ESTADOS QUE OS CARTOES TEM
// ----------------------------------
//   1. com leitura   -- os tres numeros aparecem, cada um no seu cartao;
//   2. `estado: null`-- ainda carregando. NAO pode imprimir "R$ 0,00": num mes
//      com despesa, zero nao parece erro, parece um mes barato;
//   3. `resumo: null`-- a resposta veio e nao trouxe o campo (uma copia antiga
//      guardada no aparelho, de antes desta feature). Mesmo tratamento.
//
// Os estados 2 e 3 sao os que um teste puro nao alcanca de jeito nenhum: o que
// se afirma deles e que o numero NAO aparece, e "nao aparece" e propriedade da
// marcacao.
//
// O QUE ELE NAO COBRE
// -------------------
// Cor e espacamento. A cor sai de classe de token, que tem guarda propria
// (check-color-tokens). O que este teste cobre e QUAL numero aparece em QUAL
// cartao, e o que nao aparece.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CartoesDaTela } from "../.tmp-cartoes-da-tela/components/movimentacoes/CartoesDaTela.js";
import { telaDoTipo } from "../.tmp-cartoes-da-tela/lib/telas-de-movimentacao.js";

const DESPESAS = telaDoTipo("expense");
const RECEITAS = telaDoTipo("income");

/** O mes do exemplo da issue: R$ 159,90 previstos e R$ 2.930,20 realizados. */
const RESUMO = {
  previsto: 159.9,
  realizado: 2930.2,
  total: 3090.1,
  quantidadePrevista: 1,
  quantidadeRealizada: 2,
  quantidade: 3,
};

const SEM_VENCIDO = { total: 0, quantidade: 0 };

const render = (props) =>
  renderToStaticMarkup(
    h(CartoesDaTela, {
      tela: DESPESAS,
      cor: "text-destructive",
      resumo: RESUMO,
      vencido: SEM_VENCIDO,
      estado: "fresco",
      ...props,
    })
  );

/**
 * O HTML sem tag nenhuma, com os espacos normalizados.
 *
 * Necessario porque o rotulo e o numero nascem em elementos IRMAOS: procurar
 * "Previsto R$ 159,90" no HTML cru nao acha nada, ha uma tag entre os dois. E e
 * justamente a vizinhanca entre rotulo e numero que este teste precisa afirmar.
 *
 * O espaco do `Intl.NumberFormat` em pt-BR e NBSP (U+00A0) -- "R$ 159,90" com
 * espaco comum nao casa com o que sai.
 */
const texto = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;| /g, " ")
    .replace(/&#x27;|&quot;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

// ---------------------------------------------------------------------------
// 1. Os tres numeros, cada um no SEU cartao
// ---------------------------------------------------------------------------

test("os tres cartoes da issue aparecem, com estes rotulos", () => {
  const t = texto(render());

  for (const rotulo of ["Total", "Previsto", "Realizado"]) {
    assert.ok(t.includes(rotulo), `falta o cartao "${rotulo}"`);
  }
});

test("cada numero sai no cartao certo -- e nao no do lado", () => {
  const t = texto(render());

  // O par rotulo+numero, na ordem em que o HTML os emite. E a unica forma de
  // afirmar POSICAO: os tres numeros aparecem no HTML de qualquer jeito, e
  // trocados dois a dois o `includes` de cada um continuaria verde.
  assert.ok(t.includes("Total R$ 3.090,10"), `Total fora de lugar em: ${t}`);
  assert.ok(t.includes("Previsto R$ 159,90"), `Previsto fora de lugar em: ${t}`);
  assert.ok(
    t.includes("Realizado R$ 2.930,20"),
    `Realizado fora de lugar em: ${t}`
  );

  // CONTROLE: os dois pares que o defeito produziria. Sem estas negacoes, a
  // assercao acima passaria verde num HTML que mostra os tres numeros em
  // qualquer ordem.
  assert.ok(!t.includes("Previsto R$ 2.930,20"));
  assert.ok(!t.includes("Realizado R$ 159,90"));
  assert.ok(!t.includes("Total R$ 159,90"));
});

test("a legenda do Total diz que ele e previsto + realizado", () => {
  // Sem ela, este Total e o cartao "Despesas" de Financas Pessoais (que soma so
  // o realizado) sao dois numeros certos por criterios diferentes, e a
  // diferenca se le como bug.
  const t = texto(render());
  assert.ok(t.includes("previsto + realizado"));
  // E a contagem de linhas, que e o que liga o numero a lista logo abaixo.
  assert.ok(t.includes("3 lançamento(s)"));
});

test("as legendas de Previsto e Realizado vem do catalogo, nao do JSX", () => {
  // Elas mudam com a tela: em Despesas o previsto e "o que ainda vence no
  // periodo"; em Receitas, "o que ainda esta previsto entrar". Escritas no JSX,
  // as tres telas diriam a mesma frase -- e na de Receitas a frase de Despesas
  // afirmaria que o salario e divida.
  const despesas = texto(render({ tela: DESPESAS }));
  const receitas = texto(render({ tela: RECEITAS }));

  assert.ok(despesas.includes(DESPESAS.oQueOPrevistoE));
  assert.ok(despesas.includes(DESPESAS.oQueORealizadoE));
  assert.ok(receitas.includes(RECEITAS.oQueOPrevistoE));
  assert.ok(receitas.includes(RECEITAS.oQueORealizadoE));

  // E as duas telas de fato dizem coisas DIFERENTES -- senao o teste acima
  // passaria verde com as duas legendas iguais.
  assert.notEqual(DESPESAS.oQueOPrevistoE, RECEITAS.oQueOPrevistoE);
  assert.ok(!receitas.includes(DESPESAS.oQueOPrevistoE));
});

// ---------------------------------------------------------------------------
// 2. O zero confiante
// ---------------------------------------------------------------------------

test("sem leitura NAO sai numero nenhum -- nem R$ 0,00", () => {
  // `estado: null` e "ainda carregando". Um "R$ 0,00" aqui nao parece erro:
  // parece um mes em que a pessoa nao gastou nada.
  const t = texto(render({ estado: null }));

  assert.ok(!t.includes("R$"), `imprimiu valor sem leitura: ${t}`);
  assert.ok(!t.includes("0,00"));
  // Os rotulos FICAM: a tela continua dizendo quais sao os tres numeros, e
  // apenas admite nao te-los.
  for (const rotulo of ["Total", "Previsto", "Realizado"]) {
    assert.ok(t.includes(rotulo));
  }
  // E a contagem tambem vira travessao, pelo mesmo motivo: "0 lançamento(s)" e
  // o mesmo zero confiante em outra forma.
  assert.ok(!t.includes("lançamento(s)"), `afirmou contagem sem leitura: ${t}`);
});

test("sem rede e com erro do servidor tambem nao imprimem valor", () => {
  for (const estado of ["sem-rede", "erro-do-servidor", "sessao-recusada"]) {
    const t = texto(render({ estado }));
    assert.ok(!t.includes("R$"), `${estado} imprimiu valor: ${t}`);
  }
});

test("resposta SEM o campo `resumo` tambem nao imprime valor", () => {
  // A copia guardada no aparelho de antes desta feature e `ok` e nao tem
  // `resumo`. `podeMostrarNumero` diria que da para mostrar numero; o que falta
  // e o numero. As duas condicoes precisam estar na porta.
  const t = texto(render({ resumo: null, estado: "fresco" }));
  assert.ok(!t.includes("R$"), `imprimiu valor sem resumo: ${t}`);

  // Com dado do aparelho E com resumo, o numero SAI -- senao a assercao acima
  // passaria verde num componente que nunca mostra numero.
  const doAparelho = texto(render({ estado: "do-aparelho" }));
  assert.ok(doAparelho.includes("R$ 3.090,10"));
});

// ---------------------------------------------------------------------------
// 3. O vencido: nota do cartao "Previsto", nunca um quarto cartao
// ---------------------------------------------------------------------------

test("o vencido aparece como nota, com o valor e a contagem", () => {
  const t = texto(
    render({ vencido: { total: 400, quantidade: 2 }, resumo: RESUMO })
  );

  assert.ok(t.includes("R$ 400,00 em 2 linhas que já venceram"), t);
  // E ele NAO soma com o previsto: o cartao continua mostrando o previsto
  // inteiro, do qual o vencido e um recorte. R$ 559,90 seria a soma errada.
  assert.ok(t.includes("Previsto R$ 159,90"));
  assert.ok(!t.includes("R$ 559,90"));
});

test("uma linha vencida fala no singular", () => {
  const t = texto(render({ vencido: { total: 400, quantidade: 1 } }));
  assert.ok(t.includes("em 1 linha que já venceu"), t);
  assert.ok(!t.includes("linhas que já venceram"));
});

test("sem nada vencido a nota NAO aparece", () => {
  // "R$ 0,00 em 0 linhas que já venceram" e um aviso de atraso para quem nao
  // esta atrasado.
  const t = texto(render({ vencido: SEM_VENCIDO }));
  assert.ok(!t.includes("venceu"));
  assert.ok(!t.includes("venceram"));
});

test("sem leitura a nota de vencido tambem cala", () => {
  // "R$ 400 já venceu" dito sobre uma copia de ontem e uma divida que pode ja
  // ter sido paga.
  const t = texto(
    render({ estado: null, vencido: { total: 400, quantidade: 2 } })
  );
  assert.ok(!t.includes("venceram"), t);
});

// ---------------------------------------------------------------------------
// 4. A cor vem em classe de token
// ---------------------------------------------------------------------------

test("a cor do Total chega como classe, e e a que a tela passou", () => {
  // Hex no JSX e reprovado por check-color-tokens; aqui o que se afirma e que a
  // prop CHEGA -- um `cor` ignorado deixaria os tres cartoes iguais nas tres
  // telas, e a cor e o que distingue receita de despesa num relance.
  const html = render({ cor: "text-destructive" });
  assert.ok(html.includes("text-destructive"));
  assert.ok(!/#[0-9a-fA-F]{3,6}/.test(html), "cor em hex na marcacao");

  const verde = render({ cor: "text-success" });
  assert.ok(verde.includes("text-success"));
  assert.ok(!verde.includes("text-destructive"));
});

// ---------------------------------------------------------------------------
// 5. O REEMBOLSO DO GRUPO E AS DUAS LEGENDAS (HMO-364, fases F3 e F5)
// ---------------------------------------------------------------------------
// O que estes blocos medem e `nao aparece` e `aparece onde`, que e propriedade
// da MARCACAO: a soma esta coberta por test-telas-de-movimentacao (6 blocos) e
// por mutantes. O defeito que mora so aqui e o valor entrando no «Previsto» com
// a frase impressa no cartao de baixo, ou nao impressa nenhuma -- os dois
// deixam a aritmetica exata e a tela muda.

const REEMBOLSO = { total: 300, quantos: 1, grupos: 1 };

test("o reembolso previsto aparece como nota do «Previsto», no plural certo", () => {
  const t = texto(
    render({
      tela: RECEITAS,
      resumo: { ...RESUMO, reembolso_previsto: { total: 300, quantos: 3, grupos: 2 } },
    })
  );

  assert.match(t, /inclui R\$ 300,00 de reembolso previsto/);
  assert.match(t, /3 pessoas em 2 grupos/);
  // E a frase diz que o dinheiro NAO chegou: "a receber" num cartao verde se le
  // como dinheiro que ja entrou.
  assert.match(t, /ainda não recebido/);
});

test("um devedor em um grupo fala no singular", () => {
  const t = texto(
    render({ tela: RECEITAS, resumo: { ...RESUMO, reembolso_previsto: REEMBOLSO } })
  );

  assert.match(t, /1 pessoa em 1 grupo/);
  assert.ok(
    !/1 pessoas|1 grupos/.test(t),
    "a frase concorda em numero com `quantos` e `grupos` -- e a concordancia " +
      "nao pode ser calculada no meio do JSX"
  );
});

test("sem reembolso a nota NAO aparece -- nem 'R$ 0,00 de reembolso'", () => {
  for (const vazio of [null, undefined]) {
    const t = texto(
      render({ tela: RECEITAS, resumo: { ...RESUMO, reembolso_previsto: vazio } })
    );
    assert.ok(
      !t.includes("reembolso"),
      `com reembolso_previsto=${vazio} a tela escreveu a frase. "R$ 0,00 de ` +
        `reembolso previsto" na tela de quem nao tem grupo e ruido que parece ` +
        `recurso quebrado.`
    );
  }
});

test("sem leitura a nota de reembolso tambem cala", () => {
  // Mesmo motivo do vencido: "R$ 300 a receber" dito sobre um cache de ontem
  // pode ja ter sido pago. E `resumo: null` e o outro estado -- a resposta que
  // veio sem o campo.
  for (const props of [
    { estado: null },
    { estado: "sem-rede" },
    { resumo: null },
  ]) {
    const t = texto(
      render({
        tela: RECEITAS,
        resumo: { ...RESUMO, reembolso_previsto: REEMBOLSO },
        ...props,
      })
    );
    assert.ok(
      !t.includes("reembolso"),
      `com ${JSON.stringify(props)} a nota de reembolso apareceu`
    );
  }
});

test("a legenda do bruto sai na aba Despesas, e SO nela", () => {
  // A fase F5. Sem esta linha o «Previsto» de Despesas conta a conta de grupo
  // inteira e o cartao «Quanto ainda posso gastar» conta so a parte -- dois
  // numeros certos discordando na mesma navegacao, e o menor deles se lendo
  // como conta perdida.
  const despesas = texto(render({ tela: DESPESAS }));

  assert.match(despesas, /quanto sai da sua conta/);
  assert.match(
    despesas,
    /Quanto ainda posso gastar/,
    "a legenda tem de dizer ONDE a outra pergunta e respondida -- uma frase " +
      "que explica so o proprio numero deixa o outro sem explicacao"
  );

  // Em Receitas e em Transferencias a mesma frase estaria errada: aquele
  // «Previsto» nao conta conta de grupo nenhuma pelo bruto.
  for (const tela of [RECEITAS, telaDoTipo("transfer")]) {
    assert.ok(
      !texto(render({ tela })).includes("quanto sai da sua conta"),
      `a legenda do bruto apareceu na tela ${tela.tipo}`
    );
  }
});
