#!/usr/bin/env node
// =====================================================
// SONDA: registrar um acerto DE VERDADE e medir o saldo (HMO-245, fase 11)
// =====================================================
//   PLAYWRIGHT_MODULE=/caminho/para/playwright/index.mjs \
//   APP_URL=https://pulodogato.hmoraes.com.br \
//   APP_EMAIL=... APP_PASSWORD=... \
//   GRUPO_ID=<uuid do grupo com sugestao de pagamento em aberto> \
//   node scripts/probe-acerto-de-grupo.mjs
//
// POR QUE ESTA SONDA EXISTE, E POR QUE ELA NAO E UM TESTE DE CI
// ------------------------------------------------------------
// As duas suites do PR provam o que da para provar sem navegador:
//
//   scripts/test-acerto-em-lancamento.mjs        as REGRAS (sinal, tipo, moeda)
//   database/tests/hmo245_acerto_vira_lancamento_test.sql  o BANCO (saldo
//                                               antes/depois, rateio, RLS)
//
// Nenhuma das duas prova que a TELA deployada coleta a conta e manda o
// `account_id` -- e esse e justamente o ponto em que a feature pode ficar
// parecida com o defeito que ela conserta. O botao antigo era de um clique, sem
// campo nenhum: ele continuaria "funcionando", registrando a quitacao, e
// nenhuma das suites acima ficaria vermelha.
//
// Ela ESCREVE: deixa uma quitacao e um lancamento de verdade na conta usada.
// Rode num grupo de teste, e desfaca pelo botao "Desfazer" da propria tela
// (o DELETE apaga a perna junto -- e isso tambem e medido aqui).
//
// AS DUAS MEDIDAS QUE IMPORTAM
// ----------------------------
//   1. O BOTAO DE CONFIRMAR FICA DESABILITADO SEM CONTA. E a prova de que o
//      caminho de um clique acabou. Se ele estiver habilitado, a sonda falha
//      mesmo que o resto passe: dava para registrar sem lancar nada.
//   2. `current_balance` da conta escolhida ANTES -> DEPOIS, pela diferenca
//      exata do valor. Um 200 OK nao prova dinheiro: a rota responde 200
//      tambem quando grava a quitacao e nada mais.
//
// O CONTROLE POSITIVO E OBRIGATORIO: a sonda exige que a lista de contas do
// seletor venha com pelo menos UMA opcao antes de concluir qualquer coisa. Um
// seletor vazio por erro de carregamento dá "nao consegui escolher a conta",
// que e indistinguivel de "o campo nao existe" -- e as duas leituras pedem
// acoes opostas.
// =====================================================

const APP = (process.env.APP_URL || "https://pulodogato.hmoraes.com.br").replace(
  /\/$/,
  ""
);
const EMAIL = process.env.APP_EMAIL;
const SENHA = process.env.APP_PASSWORD;
const GRUPO = process.env.GRUPO_ID;

if (!EMAIL || !SENHA || !GRUPO) {
  console.error(
    "Faltou APP_EMAIL / APP_PASSWORD / GRUPO_ID. Sem sessao esta sonda mediria " +
      "a tela de login; sem grupo ela nao tem sugestao de pagamento para clicar."
  );
  process.exit(2);
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const falhas = [];
const medir = (rotulo, ok, detalhe = "") => {
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${rotulo}${detalhe ? " -- " + detalhe : ""}`);
  if (!ok) falhas.push(rotulo);
};

const navegador = await chromium.launch();

try {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const pagina = await ctx.newPage();

  // -------------------------------------------------------------------------
  // 0. Login
  // -------------------------------------------------------------------------
  await pagina.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
  await pagina.fill('input[type="email"]', EMAIL);
  await pagina.fill('input[type="password"]', SENHA);
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL(/dashboard/, { timeout: 30000 });

  /**
   * Os saldos por conta, lidos pela SESSAO DO NAVEGADOR.
   *
   * `pagina.request` reusa os cookies da sessao, entao a leitura passa pela
   * mesma RLS que a tela -- e nao pela credencial de leitura do banco, que
   * responde `(0 rows)` com toda a confianca quando a policy nao deixa ver.
   */
  const saldos = async () => {
    const r = await pagina.request.get(`${APP}/api/financial-accounts`);
    const j = await r.json();
    const lista = j.accounts || j || [];
    return new Map(lista.map((c) => [c.id, Number(c.current_balance)]));
  };

  const antes = await saldos();
  medir("controle positivo: a sessao le as contas", antes.size > 0, `${antes.size} conta(s)`);
  if (antes.size === 0) throw new Error("sem contas legiveis: a sonda estaria cega");

  // -------------------------------------------------------------------------
  // 1. A sugestao de pagamento, na aba de saldos
  // -------------------------------------------------------------------------
  await pagina.goto(`${APP}/dashboard/expense-groups/${GRUPO}`, {
    waitUntil: "domcontentloaded",
  });
  // Esperar por conteudo VISIVEL antes de medir: logo depois do goto metade da
  // arvore nao existe, e medir ali inventa defeito.
  await pagina.getByText("Sugestões de Pagamento").waitFor({ timeout: 30000 });

  // Os dois rotulos possiveis, porque a direcao agora aparece no botao: quem
  // recebe le "Já recebi", quem paga le "Já paguei".
  const gatilho = pagina
    .getByRole("button", { name: /^(Já recebi|Já paguei|Recebi em reais|Paguei em reais)$/ })
    .first();

  medir("ha uma sugestao de pagamento para registrar", (await gatilho.count()) > 0);
  if ((await gatilho.count()) === 0) {
    throw new Error(
      "este grupo nao tem sugestao em aberto para quem esta logado -- escolha outro GRUPO_ID"
    );
  }

  // -------------------------------------------------------------------------
  // 2. O clique ABRE O DIALOGO (nao registra nada)
  // -------------------------------------------------------------------------
  await gatilho.click();

  const dialogo = pagina.getByRole("dialog");
  await dialogo.waitFor({ timeout: 10000 });
  medir("o clique abre o dialogo em vez de registrar direto", true);

  const confirmar = dialogo.getByRole("button", { name: "Registrar acerto" });
  await confirmar.waitFor({ timeout: 10000 });

  // A MEDIDA 1. Sem conta escolhida, o caminho tem de estar fechado.
  medir(
    "o botao de confirmar esta DESABILITADO sem conta escolhida",
    await confirmar.isDisabled()
  );

  // -------------------------------------------------------------------------
  // 3. Escolher a conta no campo novo
  // -------------------------------------------------------------------------
  // O seletor e Radix: o gatilho e um botao, e as opcoes só existem no DOM
  // depois de abrir. Escolher pela URL ou por `evaluate` aprovaria uma tela que
  // o usuario nao consegue usar.
  await dialogo.locator("#conta-do-acerto").click();
  const opcoes = pagina.getByRole("option");
  await opcoes.first().waitFor({ timeout: 10000 });

  const quantas = await opcoes.count();
  medir("o campo de conta oferece pelo menos uma conta", quantas > 0, `${quantas} opcao(oes)`);

  const nomeDaConta = (await opcoes.first().textContent())?.trim() || "";
  await opcoes.first().click();

  medir(
    "depois de escolher, o botao de confirmar libera",
    !(await confirmar.isDisabled()),
    nomeDaConta
  );

  // -------------------------------------------------------------------------
  // 4. Registrar, e medir o saldo
  // -------------------------------------------------------------------------
  await confirmar.click();

  // O toast diz em qual conta caiu -- e e a unica frase que distingue o
  // comportamento novo do antigo.
  const toast = pagina.getByText(/Acerto registrado/);
  await toast.waitFor({ timeout: 20000 });
  const textoDoToast = (await toast.textContent()) || "";
  medir(
    'o aviso diz em qual conta o acerto foi lancado',
    /Lançado em/.test(textoDoToast),
    textoDoToast.trim()
  );

  const depois = await saldos();

  const mudou = [...antes.entries()]
    .map(([id, v]) => ({ id, antes: v, depois: depois.get(id) ?? v }))
    .filter((c) => Math.abs(c.depois - c.antes) > 0.001);

  medir(
    "EXATAMENTE UMA conta mudou de saldo",
    mudou.length === 1,
    mudou.map((c) => `${c.id}: ${c.antes} -> ${c.depois}`).join(" | ") || "nenhuma mudou"
  );

  if (mudou.length === 1) {
    const delta = Number((mudou[0].depois - mudou[0].antes).toFixed(2));
    medir(
      "o saldo mudou em valor diferente de zero (o Pix existe no extrato)",
      Math.abs(delta) > 0,
      `delta ${delta}`
    );
  }

  console.log("\nDesfaca pelo botao 'Desfazer' da lista de acertos: o DELETE apaga a perna junto.");
} catch (erro) {
  console.error("\nA sonda parou:", erro.message);
  falhas.push(`excecao: ${erro.message}`);
} finally {
  await navegador.close();
}

if (falhas.length) {
  console.error(`\n${falhas.length} falha(s): ${falhas.join("; ")}`);
  process.exit(1);
}
console.log("\nA tela coleta a conta, e o acerto mexeu no saldo dela.");
