#!/usr/bin/env node
// =====================================================
// SONDA: lancar uma receita e uma despesa de verdade (HMO-165)
// =====================================================
//   PLAYWRIGHT_MODULE=/caminho/para/playwright \
//   APP_URL=https://pulodogato.hmoraes.com.br \
//   APP_EMAIL=... APP_PASSWORD=... \
//   node scripts/probe-lancamento-prod.mjs
//
// POR QUE ISTO NAO E UM TESTE DE CI
// ---------------------------------
// Ela precisa de um navegador e de uma conta de verdade no ambiente que se quer
// medir -- as duas coisas que o CI nao tem. E ela ESCREVE: cada execucao deixa
// dois lancamentos em producao, com descricao marcada para dar para achar e
// apagar depois.
//
// O QUE ELA PROVA, E QUE NENHUM TESTE DE CI PROVA
// ----------------------------------------------
// Rota respondendo 200 nao prova campo em tela, e um guard em Server Component
// devolve 200 com o conteudo bloqueado. As duas suites do PR provam a ARVORE em
// memoria e as REGRAS em isolado; nenhuma das duas prova que a tela deployada
// grava a linha certa. Isto aqui fecha esse buraco:
//
//   1. as duas telas abrem LOGADO em producao;
//   2. a de receita nao tem parcelamento, natureza de despesa nem rateio, e a de
//      despesa tem os tres -- medido no DOM, nao no HTML servido (os campos sao
//      de componente de cliente e so existem depois da hidratacao);
//   3. lancar de verdade nas duas e cair de volta na lista;
//   4. o SINAL e o `transaction_type` da linha gravada, que e o criterio que
//      erra dinheiro em silencio. Este ultimo passo NAO sai daqui: a sonda
//      imprime como conferir, e o caminho nao e o obvio -- ver o item 4 no fim
//      do arquivo, porque a credencial de leitura do banco responde (0 rows)
//      com toda a confianca.
//
// A ARMADILHA QUE ESTE PROJETO JA PREGOU
// --------------------------------------
// Medir antes da hidratacao inventa bug: logo depois do `waitForURL` metade da
// arvore nao existe. Toda medicao aqui espera por um seletor visivel primeiro.
// =====================================================

const APP = (process.env.APP_URL || "https://pulodogato.hmoraes.com.br").replace(
  /\/$/,
  "",
);
const EMAIL = process.env.APP_EMAIL;
const SENHA = process.env.APP_PASSWORD;

if (!EMAIL || !SENHA) {
  console.error(
    "Faltou APP_EMAIL / APP_PASSWORD -- as duas telas exigem login, e sem " +
      "sessao esta sonda mediria a tela de login duas vezes.",
  );
  process.exit(2);
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

/** Marca desta execucao, para achar as duas linhas no banco depois. */
const MARCA = `HMO165-${Date.now()}`;
const VALOR_RECEITA = "123.45";
const VALOR_DESPESA = "67.89";

const navegador = await chromium.launch();
const falhas = [];

/** Conta quantas vezes um texto aparece no texto visivel da pagina. */
const temTexto = async (pagina, texto) =>
  (await pagina.locator(`text=${texto}`).count()) > 0;

try {
  const contexto = await navegador.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const pagina = await contexto.newPage();

  await pagina.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
  await pagina.fill('input[type="email"]', EMAIL);
  await pagina.fill('input[type="password"]', SENHA);
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL(/\/dashboard/, { timeout: 30000 });
  console.log(`logado em ${APP} como ${EMAIL}`);
  console.log(`marca desta execucao: ${MARCA}\n`);

  // ---------------------------------------------------------------------
  // 1. A SEPARACAO, MEDIDA NO DOM DA TELA DEPLOYADA
  // ---------------------------------------------------------------------
  for (const [tipo, rota] of [
    ["receita", "/dashboard/movimentacoes/receita"],
    ["despesa", "/dashboard/movimentacoes/despesa"],
  ]) {
    await pagina.goto(`${APP}${rota}`, { waitUntil: "domcontentloaded" });
    await pagina.waitForSelector("#description", {
      state: "visible",
      timeout: 20000,
    });

    const campos = {
      natureza: await temTexto(pagina, "Tipo de Despesa"),
      parcelamento: await temTexto(pagina, "Parcelar esta despesa"),
      rateio: await temTexto(pagina, "Dividir esta despesa"),
    };

    const esperado = tipo === "despesa";
    console.log(`${rota}`);
    for (const [nome, presente] of Object.entries(campos)) {
      const ok = presente === esperado;
      console.log(`  ${ok ? "ok  " : "FALHA"} ${nome}: ${presente}`);
      if (!ok) {
        falhas.push(
          `${rota}: ${nome} ${presente ? "presente" : "ausente"}, esperado ${esperado}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------
  // 2. LANCAR DE VERDADE
  // ---------------------------------------------------------------------
  const lancar = async (rota, descricao, valor) => {
    await pagina.goto(`${APP}${rota}`, { waitUntil: "domcontentloaded" });
    await pagina.waitForSelector("#description", {
      state: "visible",
      timeout: 20000,
    });

    await pagina.fill("#description", descricao);
    await pagina.fill("#amount", valor);

    // O seletor de categoria e do radix: a lista vive num portal que so existe
    // com ele aberto, entao nao da para escolher por `selectOption`.
    await pagina.click("#category");
    await pagina.waitForSelector('[role="option"]', {
      state: "visible",
      timeout: 15000,
    });
    const quantas = await pagina.locator('[role="option"]').count();
    await pagina.locator('[role="option"]').first().click();

    await pagina.click('button[type="submit"]');
    await pagina.waitForURL(/\/dashboard\/personal-finance/, { timeout: 30000 });

    console.log(
      `  ok   ${rota}: ${quantas} categoria(s) no seletor, lancado e de volta na lista`,
    );
  };

  console.log("\nlancando:");
  try {
    await lancar(
      "/dashboard/movimentacoes/receita",
      `${MARCA} receita`,
      VALOR_RECEITA,
    );
  } catch (erro) {
    console.log(`  FALHA receita: ${erro.message.split("\n")[0]}`);
    falhas.push(`nao consegui lancar a receita: ${erro.message.split("\n")[0]}`);
  }

  try {
    await lancar(
      "/dashboard/movimentacoes/despesa",
      `${MARCA} despesa`,
      VALOR_DESPESA,
    );
  } catch (erro) {
    console.log(`  FALHA despesa: ${erro.message.split("\n")[0]}`);
    falhas.push(`nao consegui lancar a despesa: ${erro.message.split("\n")[0]}`);
  }

  // ---------------------------------------------------------------------
  // 3. AS DUAS APARECEM NA LISTA
  // ---------------------------------------------------------------------
  await pagina.goto(`${APP}/dashboard/personal-finance`, {
    waitUntil: "domcontentloaded",
  });
  // O seletor e o titulo DESTA tela, nao um `h1` qualquer: o cabecalho do app
  // tem um `h1` com o nome do produto que fica escondido no desktop, e esperar
  // por "o primeiro h1 visivel" expira com a tela inteira pintada na frente.
  await pagina.waitForSelector('h1:has-text("Finanças Pessoais")', {
    state: "visible",
    timeout: 20000,
  });
  // A lista chega por consulta do cliente, depois da pintura.
  await pagina.waitForTimeout(3000);

  for (const sufixo of ["receita", "despesa"]) {
    const presente = await temTexto(pagina, `${MARCA} ${sufixo}`);
    console.log(`  ${presente ? "ok  " : "FALHA"} ${sufixo} na lista`);
    if (!presente) falhas.push(`o lancamento de ${sufixo} nao apareceu na lista`);
  }

  // -----------------------------------------------------------------------
  // 4. O SINAL DA LINHA GRAVADA -- E COMO NAO LER ISSO ERRADO
  // -----------------------------------------------------------------------
  // NAO da para conferir com a credencial de leitura do banco de producao:
  // `paperclip_ro` nao tem BYPASSRLS e `financial_transactions` tem RLS ligada,
  // entao um `select ... where description like '...'` volta com **(0 rows)** --
  // sem erro, sem aviso, parecendo que a tela nao gravou nada. E o formato de
  // resposta mais perigoso que existe: uma medicao confiante e errada.
  //
  // O caminho honesto e o PostgREST com o token DA SESSAO do usuario de teste,
  // que e quem a RLS deixa ler as proprias linhas -- as mesmas tres chamadas do
  // roteiro de cadastro.
  console.log(
    `\nPara fechar o criterio do SINAL (a credencial de leitura do banco NAO\n` +
      `serve: sem BYPASSRLS ela devolve 0 linhas com cara de "nao gravou"):\n\n` +
      `  TOKEN=$(curl -s -X POST "$SB/auth/v1/token?grant_type=password" \\\n` +
      `    -H "apikey: $AK" -H "Content-Type: application/json" \\\n` +
      `    -d '{"email":"'"$APP_EMAIL"'","password":"..."}' | jq -r .access_token)\n\n` +
      `  curl -s "$SB/rest/v1/financial_transactions?description=like.${MARCA}*\\\n` +
      `&select=description,amount,transaction_type" \\\n` +
      `    -H "apikey: $AK" -H "Authorization: Bearer $TOKEN"\n\n` +
      `  esperado: receita ${VALOR_RECEITA} / income, despesa -${VALOR_DESPESA} / expense`,
  );
} finally {
  await navegador.close();
}

if (falhas.length > 0) {
  console.error(`\n${falhas.length} falha(s):`);
  for (const f of falhas) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("\nTudo o que da para medir daqui passou.");
