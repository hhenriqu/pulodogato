#!/usr/bin/env node
// =====================================================
// PULODOGATO - a pagina de Planos para de vender sinal de trading (HMO-198)
// =====================================================
//   npm run test:planos-em-breve
//
// O QUE ESTA SUITE GUARDA
// -----------------------
// A pagina publica de Planos anunciava sinal de trading em tempo real como
// recurso incluido no plano de R$ 79,90/mes. Nao existe tabela, rota nem origem
// de dado por tras -- /dashboard/trading mostra `EmDesenvolvimento`. A decisao
// de produto foi marcar "em breve", e NAO construir o recurso: recomendacao de
// compra e venda e atividade regulada pela CVM.
//
// POR QUE RENDERIZA, EM VEZ DE SO OLHAR O MAPA
// --------------------------------------------
// O cartao corta a lista de recursos em 8 itens. Um teste que afirmasse so
// sobre `NOMES_NA_PAGINA_DE_PLANOS` ficaria verde com o item de sinais caindo
// fora do corte -- o mapa certo, a tela sem o aviso. Pior ainda se o aviso
// tivesse virado um item NOVO no fim da lista: ele entraria depois do corte e
// nao apareceria nenhum. Por isso o teste conta os itens que sairam no HTML e
// exige o de sinais entre eles.
//
// POR QUE NEGA O TEXTO ANTIGO, EM VEZ DE SO PROCURAR O NOVO
// ---------------------------------------------------------
// Confirmar que "em breve" aparece em algum lugar nao prova nada: o texto
// antigo poderia continuar na tela alguns pixels acima, e `hidden` no HTML nem
// tira do textContent. As assercoes centrais aqui sao NEGATIVAS.
//
// O QUE ELA NAO COBRE
// -------------------
// O `UpgradePrompt` de PlanGuards.tsx nao e renderizado: o modulo arrasta
// `useSubscription` e o cliente do Supabase. O que o teste faz por ele e
// afirmar sobre o FONTE -- que o mapa de nomes de la passa por
// `comAvisoDeEmBreve`, a mesma fonte de verdade da pagina de Planos. E uma
// assercao mais fraca que renderizar, e esta escrita aqui para nao ser
// confundida com uma prova de tela.
// =====================================================

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import PlansPage from "../.tmp-planos-em-breve/app/(dashboard)/dashboard/plans/page.js";
import HomePage from "../.tmp-planos-em-breve/app/page.js";
import {
  AVISO_EM_BREVE,
  LIMITE_DE_RECURSOS_NO_CARTAO,
  NOMES_NA_PAGINA_DE_PLANOS,
  comAvisoDeEmBreve,
  estaEmBreve,
  listaDeRecursosDoPlano,
} from "../.tmp-planos-em-breve/lib/planos.js";
import { PLAN_CONFIGS } from "../.tmp-planos-em-breve/types/subscription.js";

/** O HTML sem tag nenhuma, com os espacos normalizados. */
const texto = (html) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;| /g, " ")
    .replace(/&#x27;|&quot;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

const htmlDosPlanos = renderToStaticMarkup(h(PlansPage));
const htmlDaHome = renderToStaticMarkup(h(HomePage));

/**
 * As linhas de recurso de UM cartao, na ordem em que a tela imprime.
 *
 * O corte por "Limites" existe porque o bloco seguinte do cartao tambem tem
 * texto: sem ele, "Transacoes: Ilimitado" entraria na contagem de recursos.
 */
function recursosDoCartao(html, nomeDoPlano) {
  const cartoes = html.split("Funcionalidades Incluídas").slice(1);
  const ordem = Object.values(PLAN_CONFIGS)
    .filter((p) => p.id !== "admin")
    .map((p) => p.name);
  const indice = ordem.indexOf(nomeDoPlano);
  assert.notEqual(
    indice,
    -1,
    `plano "${nomeDoPlano}" nao esta entre os publicos (${ordem.join(", ")})`
  );
  assert.equal(
    cartoes.length,
    ordem.length,
    "a pagina deixou de ter um bloco de funcionalidades por plano publico"
  );

  const bloco = cartoes[indice].split("Limites")[0];
  return [...bloco.matchAll(/<span class="text-sm([^"]*)">([^<]*)<\/span>/g)].map(
    (m) => ({ classe: m[1], rotulo: m[2], html: m[0] })
  );
}

// ---------------------------------------------------------------------------
// 1. A funcao pura: o rotulo e o estado do recurso
// ---------------------------------------------------------------------------

test("o recurso de sinais sai da lista marcado como indisponivel", () => {
  const sinais = listaDeRecursosDoPlano(PLAN_CONFIGS.trader).find(
    (r) => r.feature === "trading_signals"
  );

  assert.ok(sinais, "sinais de trading sumiu da lista do plano Trader");
  assert.equal(sinais.disponivel, false);
  assert.equal(sinais.rotulo, `Sinais de trading (${AVISO_EM_BREVE})`);
});

test("o nome-base do recurso nao promete prontidao por conta propria", () => {
  // O sufixo so se acrescenta no fim. Se o nome-base voltasse a dizer "em tempo
  // real", o rotulo continuaria anunciando o recurso E ainda teria "em breve"
  // no fim -- verde numa assercao que so procura o aviso.
  assert.equal(NOMES_NA_PAGINA_DE_PLANOS.trading_signals, "Sinais de trading");
});

test("recurso que existe nao ganha aviso nenhum", () => {
  assert.equal(estaEmBreve("expense_groups"), false);
  assert.equal(
    comAvisoDeEmBreve("Grupos de gastos compartilhados", "expense_groups"),
    "Grupos de gastos compartilhados"
  );

  for (const recurso of listaDeRecursosDoPlano(PLAN_CONFIGS.invest)) {
    assert.equal(
      recurso.disponivel,
      true,
      `"${recurso.rotulo}" apareceu como em breve no plano Investidor`
    );
    assert.ok(
      !recurso.rotulo.includes(AVISO_EM_BREVE),
      `"${recurso.rotulo}" ganhou aviso sem estar em RECURSOS_EM_BREVE`
    );
  }
});

// ---------------------------------------------------------------------------
// 2. A pagina renderizada: o item existe, cabe no corte, e nao tem "incluido"
// ---------------------------------------------------------------------------

test("o cartao do Trader mostra o aviso DENTRO do corte de itens", () => {
  const recursos = recursosDoCartao(htmlDosPlanos, "Trader");

  // A armadilha do corte: item novo no fim da lista nao apareceria, e o teste
  // de unidade do mapa passaria do mesmo jeito.
  assert.equal(
    recursos.length,
    LIMITE_DE_RECURSOS_NO_CARTAO,
    "o cartao deixou de imprimir os 8 recursos"
  );

  const sinais = recursos.find((r) => r.rotulo.startsWith("Sinais de trading"));
  assert.ok(
    sinais,
    `sinais de trading nao saiu no HTML do cartao. Saiu: ${recursos
      .map((r) => r.rotulo)
      .join(" | ")}`
  );
  assert.equal(sinais.rotulo, `Sinais de trading (${AVISO_EM_BREVE})`);
});

test("a linha de sinais nao leva o sinal visual de recurso incluido", () => {
  const recursos = recursosDoCartao(htmlDosPlanos, "Trader");
  const bloco = htmlDosPlanos.split("Funcionalidades Incluídas")[3];
  const linha = bloco.slice(
    bloco.lastIndexOf("<div", bloco.indexOf("Sinais de trading")),
    bloco.indexOf("Sinais de trading")
  );

  assert.ok(
    !linha.includes("lucide-check"),
    "a linha de sinais voltou a ganhar o check de recurso incluido"
  );
  assert.ok(
    linha.includes("lucide-clock"),
    "a linha de sinais perdeu o icone que a distingue das outras"
  );

  // O icone sozinho seria sutil demais: o texto tambem fica apagado.
  const sinais = recursos.find((r) => r.rotulo.startsWith("Sinais de trading"));
  assert.ok(
    sinais.classe.includes("text-muted-foreground"),
    "o texto de sinais voltou a ter o mesmo destaque dos recursos que existem"
  );
  // E as OUTRAS linhas continuam com o check -- sem isto, apagar o check da
  // pagina inteira passaria neste teste.
  const comCheck = recursos.filter((r) => !r.rotulo.includes(AVISO_EM_BREVE));
  assert.equal(comCheck.length, LIMITE_DE_RECURSOS_NO_CARTAO - 1);
  for (const recurso of comCheck) {
    assert.equal(
      recurso.classe.trim(),
      "",
      `"${recurso.rotulo}" ficou apagado junto com o recurso que nao existe`
    );
  }
  assert.equal(
    (bloco.split("Limites")[0].match(/lucide-check/g) || []).length,
    LIMITE_DE_RECURSOS_NO_CARTAO - 1
  );
});

// ---------------------------------------------------------------------------
// 3. As assercoes NEGATIVAS -- o texto antigo nao esta mais na tela
// ---------------------------------------------------------------------------

test("a pagina de Planos nao anuncia mais o recurso como pronto", () => {
  const t = texto(htmlDosPlanos);

  assert.ok(
    !t.includes("Sinais de trading em tempo real"),
    "o rotulo antigo continua na pagina de Planos"
  );
  // A descricao do plano, logo acima do preco, prometia a mesma coisa.
  assert.ok(
    !/sinais e dados em tempo real/i.test(t),
    "a descricao do plano Trader continua prometendo sinais"
  );
  assert.ok(t.includes(`Sinais de trading (${AVISO_EM_BREVE})`));
  assert.ok(t.includes("R$ 79,90/mês"), "o preco saiu da tela; o teste cegou");
});

test("a pagina publica nao anuncia mais o recurso como pronto", () => {
  const t = texto(htmlDaHome);

  assert.ok(
    !/sinais em tempo real/i.test(t),
    "o cartao da home continua prometendo sinal em tempo real"
  );
  assert.ok(
    !/sinais de trading profissionais/i.test(t),
    "a chamada da home continua prometendo sinais de trading"
  );
  assert.ok(
    t.includes(AVISO_EM_BREVE),
    "a home nao diz em lugar nenhum que trading ainda nao existe"
  );
  assert.ok(
    t.includes("Trading Profissional"),
    "o cartao sumiu da home; o teste passou a nao provar nada"
  );
});

test("nenhuma tela usa vocabulario de recomendacao de compra e venda", () => {
  // A issue proibe recomendacao explicita porque e atividade regulada pela CVM.
  // "recomendado" pega tambem o rotulo de plano, que e outra coisa -- se um dia
  // aparecer legitimamente, o teste tem que ser reescrito com contexto, nao
  // afrouxado.
  for (const [nome, html] of [
    ["Planos", htmlDosPlanos],
    ["home", htmlDaHome],
  ]) {
    const t = texto(html).toLowerCase();
    for (const palavra of ["compre ", "venda ", "recomendado", "recomendamos"]) {
      assert.ok(
        !t.includes(palavra),
        `a pagina de ${nome} usa "${palavra.trim()}"`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 4. O SEGUNDO mapa de nomes da interface
// ---------------------------------------------------------------------------

test("o mapa de PlanGuards passa pela mesma fonte de verdade", () => {
  // Assercao sobre o FONTE, nao sobre a tela: ver o cabecalho. O que ela
  // impede e o defeito concreto -- alguem corrigir a pagina de Planos e deixar
  // este mapa anunciando o recurso como pronto em outro canto.
  const fonte = readFileSync(
    new URL("../components/subscription/PlanGuards.tsx", import.meta.url),
    "utf8"
  );

  assert.ok(
    /return comAvisoDeEmBreve\(names\[feature\] \|\| feature, feature\);/.test(
      fonte
    ),
    "getFeatureName voltou a devolver o nome cru, sem consultar RECURSOS_EM_BREVE"
  );
  assert.equal(
    comAvisoDeEmBreve("Sinais de Trading", "trading_signals"),
    `Sinais de Trading (${AVISO_EM_BREVE})`
  );
});

test("a frase antiga nao sobrou em nenhum arquivo do app", () => {
  // Varredura do repositorio: e ela que cobre os cantos que ninguem lembrou de
  // renderizar. NAO distingue comentario de texto de tela -- de proposito, e
  // por isso os comentarios desta entrega nao citam a frase proibida.
  const RAIZES = ["app", "components", "lib", "types"];
  const PROIBIDAS = [
    "Sinais de trading em tempo real",
    "Sinais em tempo real",
    "sinais e dados em tempo real",
    "sinais de trading profissionais",
  ];

  const arquivos = (dir) =>
    readdirSync(dir).flatMap((nome) => {
      const caminho = join(dir, nome);
      if (statSync(caminho).isDirectory()) return arquivos(caminho);
      return /\.tsx?$/.test(caminho) ? [caminho] : [];
    });

  const raiz = new URL("..", import.meta.url).pathname;
  const achados = [];
  for (const dir of RAIZES) {
    for (const arquivo of arquivos(join(raiz, dir))) {
      const conteudo = readFileSync(arquivo, "utf8");
      for (const frase of PROIBIDAS) {
        if (conteudo.toLowerCase().includes(frase.toLowerCase())) {
          achados.push(`${arquivo.replace(raiz, "")}: "${frase}"`);
        }
      }
    }
  }

  assert.deepEqual(achados, [], `frase antiga ainda no codigo:\n${achados.join("\n")}`);
});
