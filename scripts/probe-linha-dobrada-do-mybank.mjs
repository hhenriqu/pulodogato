#!/usr/bin/env node
// =====================================================
// SONDA: a parcela do MyBank aparece UMA vez em Contas a Pagar (HMO-386)
// =====================================================
//   PLAYWRIGHT_MODULE=/caminho/para/playwright/index.mjs \
//   APP_URL=https://pulodogato.hmoraes.com.br \
//   APP_EMAIL=<a conta DEVEDORA> APP_PASSWORD=... \
//   [TOTAL_A_PAGAR_ESPERADO="R$ 1.148,00"] \
//   node scripts/probe-linha-dobrada-do-mybank.mjs
//
// O QUE ELA MEDE, E POR QUE NENHUMA SUITE MEDE ISSO
// -------------------------------------------------
// A HMO-386 e duplicacao de LINHA na composicao da PAGINA: a mesma parcela
// desenhada duas vezes em `/dashboard/bills` -- uma na agenda (ela vem fundida
// em `GET /api/scheduled-transactions` desde a HMO-372) e uma no bloco
// «Parcelas do MyBank». Nenhum total discorda, nada fica vermelho, e por isso
// nao havia como um teste de funcao pura ver o defeito: as duas metades estao
// certas separadas. O que esta errado e a tela TER AS DUAS.
//
// Entao a medida e a contagem no DOM da tela deployada:
//
//   1. quantas vezes a descricao de UMA parcela em janela aparece no texto da
//      pagina -- ANTES = 2, DEPOIS = 1;
//   2. o bloco do devedor (`[data-devo]`) nao esta mais nesta tela -- ele e de
//      `/dashboard/mybank` (a saida 2 da issue);
//   3. a linha da agenda GANHOU o id da parcela num `data-*`
//      (`[data-parcela-do-mybank]`) e o gesto de `reported`
//      (`[data-avisar]`/`[data-avisado]`). Sem esta medida a saida 2 seria so
//      "apagar o bloco", e o devedor perderia o unico botao que tinha.
//
// O CONTROLE NEGATIVO E O DINHEIRO: «Total a pagar». A saida 2 foi escolhida
// porque ela NAO mexe no total -- a parcela continua vindo da agenda e
// continua somada uma vez. O numero medido entra na assercao por
// `TOTAL_A_PAGAR_ESPERADO`: rodar a sonda ANTES, anotar o numero, e rodar
// DEPOIS com ele exigido. Sem isso a sonda nao distingue a saida 2 da saida 1,
// que apaga a conta a pagar da soma -- a direcao que faz a pessoa gastar o que
// nao tem.
//
// O CONTROLE POSITIVO E OBRIGATORIO: a sonda exige que a conta logada tenha ao
// menos UMA parcela de MyBank DENTRO da janela da pagina. Sem ela a contagem
// "apareceu 1 vez" seria 0 -> 0, que e `sonda-de-horizonte-vence-fora-da-janela`
// em outra roupa: verde sem medir nada. Quem monta o estado:
// `scripts/medicao-cancelamento-do-mybank.mjs` (ele cria emprestimo de verdade
// entre as duas contas de teste).
// =====================================================

const APP = (process.env.APP_URL || "https://pulodogato.hmoraes.com.br").replace(
  /\/$/,
  ""
);
const EMAIL = process.env.APP_EMAIL;
const SENHA = process.env.APP_PASSWORD;
const TOTAL_ESPERADO = process.env.TOTAL_A_PAGAR_ESPERADO || null;

if (!EMAIL || !SENHA) {
  console.error(
    "Faltou APP_EMAIL / APP_PASSWORD. Sem sessao esta sonda mediria a tela de login."
  );
  process.exit(2);
}

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const falhas = [];
const medir = (rotulo, ok, detalhe = "") => {
  console.log(`  ${ok ? "ok  " : "FALHA"} | ${rotulo}${detalhe ? " -- " + detalhe : ""}`);
  if (!ok) falhas.push(rotulo);
};

/** Quantas vezes `agulha` aparece em `texto`, sem regex (a descricao e dado). */
const quantasVezes = (texto, agulha) => {
  if (!agulha) return 0;
  let n = 0;
  let i = texto.indexOf(agulha);
  while (i !== -1) {
    n += 1;
    i = texto.indexOf(agulha, i + agulha.length);
  }
  return n;
};

const navegador = await chromium.launch();

try {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 1200 } });
  const pagina = await ctx.newPage();

  // -------------------------------------------------------------------------
  // 0. Login
  // -------------------------------------------------------------------------
  await pagina.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
  await pagina.fill('input[type="email"]', EMAIL);
  await pagina.fill('input[type="password"]', SENHA);
  await pagina.click('button[type="submit"]');
  await pagina.waitForURL(/dashboard/, { timeout: 30000 });

  // -------------------------------------------------------------------------
  // 1. O CONTROLE POSITIVO, pela MESMA leitura que a tela faz
  // -------------------------------------------------------------------------
  // `pagina.request` reusa os cookies da sessao: a leitura passa pela mesma RLS
  // que a tela, e nao pela credencial de leitura do banco (que responde
  // `(0 rows)` com toda a confianca quando a policy nao deixa ver).
  const respostaAgenda = await pagina.request.get(
    `${APP}/api/scheduled-transactions?status=open`
  );
  const agenda = await respostaAgenda.json();
  const linhas = agenda.scheduled || [];
  // O discriminante e o MESMO que `ehParcelaDoMyBank` usa. Nao e o `notes`:
  // a previsao digitada tambem pode carregar o elo `mybank:<id>` um dia.
  const emJanela = linhas.filter((l) => l.parcela_do_mybank === true);

  medir(
    "controle positivo: ha parcela de MyBank DENTRO da janela da pagina",
    emJanela.length > 0,
    `${emJanela.length} parcela(s) em janela, de ${linhas.length} linha(s) na agenda`
  );
  if (emJanela.length === 0) {
    throw new Error(
      "a conta logada nao tem parcela de MyBank em janela: a contagem seria 0 -> 0 " +
        "(verde sem medir nada). Monte o estado com " +
        "scripts/medicao-cancelamento-do-mybank.mjs e rode de novo."
    );
  }

  const respostaDivida = await pagina.request.get(`${APP}/api/mybank/due`);
  const divida = await respostaDivida.json();
  const devidas = divida.parcelas || [];
  medir(
    "a divida inteira continua legivel em /api/mybank/due",
    respostaDivida.ok() && devidas.length > 0,
    `${devidas.length} parcela(s) em aberto no total`
  );

  // -------------------------------------------------------------------------
  // 2. A TELA
  // -------------------------------------------------------------------------
  await pagina.goto(`${APP}/dashboard/bills`, { waitUntil: "domcontentloaded" });
  // Esperar conteudo VISIVEL antes de contar: logo depois do goto metade da
  // arvore nao existe, e `count()` ali inventa defeito (o `click()` auto-espera
  // e mascara isso; quem mente e a contagem).
  await pagina.getByText("Total a pagar").first().waitFor({ timeout: 30000 });
  await pagina.getByText(/Vencidas|Esta semana|Mais adiante/).first().waitFor({
    timeout: 30000,
  });

  const texto = await pagina.evaluate(() => document.body.innerText);

  // A MEDIDA 1: a contagem por DESCRICAO, e o esperado e o TAMANHO DO GRUPO.
  //
  // As parcelas de um emprestimo compartilham a descricao -- ela e do
  // emprestimo, nao da parcela ("HMO386 divida em janela" nas duas). Exigir
  // `=== 1` por parcela reprovaria a tela CERTA de um emprestimo de duas
  // parcelas em janela: a familia `assercao-de-rotulo-casa-com-o-dado-rotulado`.
  // O que a duplicacao faz e DOBRAR o grupo, e e isso que se mede.
  const porDescricao = new Map();
  for (const parcela of emJanela) {
    porDescricao.set(
      parcela.description,
      (porDescricao.get(parcela.description) ?? 0) + 1
    );
  }
  for (const [descricao, esperado] of porDescricao) {
    const vezes = quantasVezes(texto, descricao);
    medir(
      `"${descricao}" aparece ${esperado} vez(es) na tela -- uma por parcela em janela`,
      vezes === esperado,
      `${vezes} vez(es); antes da HMO-386 era o DOBRO (${esperado * 2}: agenda + bloco)`
    );
  }

  // A MEDIDA 2: o bloco do devedor nao e mais desta tela.
  const linhasDoBloco = await pagina.locator("[data-devo]").count();
  medir(
    "o bloco «Parcelas do MyBank» nao esta em /dashboard/bills",
    linhasDoBloco === 0,
    `${linhasDoBloco} linha(s) de bloco`
  );

  // A MEDIDA 3: a linha da agenda e a dona da parcela, com o gesto de avisar.
  const naAgenda = await pagina.locator("[data-parcela-do-mybank]").count();
  medir(
    "a linha da agenda carrega o id da parcela",
    naAgenda === emJanela.length,
    `${naAgenda} linha(s) marcada(s) para ${emJanela.length} parcela(s) em janela`
  );

  // O GESTO CONTADO DENTRO DA LINHA, e nao na pagina: na tela ANTES do conserto
  // o bloco tinha esses mesmos marcadores, e `[data-avisar]` solto passava pelo
  // bloco -- a medida ficava verde nos DOIS estados, que e nao medir nada.
  const gestos =
    (await pagina.locator("[data-parcela-do-mybank] [data-avisar]").count()) +
    (await pagina.locator("[data-parcela-do-mybank] [data-avisado]").count());
  medir(
    "a linha da agenda tem o gesto de avisar que paguei",
    gestos === emJanela.length,
    `${gestos} gesto(s) DENTRO da linha, para ${emJanela.length} parcela(s)`
  );

  const selos = await pagina.locator("[data-selo-do-mybank]").count();
  medir(
    "a linha da agenda tem o selo do MyBank",
    selos === emJanela.length,
    `${selos} selo(s) -- sem ele a parcela e INDISTINGUIVEL de uma conta de luz`
  );

  // -------------------------------------------------------------------------
  // 3. O CONTROLE NEGATIVO: o dinheiro nao se mexeu
  // -------------------------------------------------------------------------
  // O card e `<CardDescription>Total a pagar</CardDescription>` seguido do
  // `<CardTitle>` com o valor: o valor sai do IRMAO, e nao do proprio no.
  const total = await pagina.evaluate(() => {
    const nos = Array.from(document.querySelectorAll("div,p,span"));
    const rotulo = nos.find((n) => n.textContent?.trim() === "Total a pagar");
    return rotulo?.nextElementSibling?.textContent?.trim() ?? null;
  });
  console.log(`\n  «Total a pagar» na tela: ${total}`);

  if (TOTAL_ESPERADO) {
    // NBSP: o `Intl` pt-BR separa "R$" do numero com  , e um literal
    // digitado com espaco comum nunca casaria (`intl-pt-br-separa-o-real-com-nbsp`).
    const normaliza = (s) => (s || "").replace(/ /g, " ").trim();
    medir(
      `«Total a pagar» continua ${TOTAL_ESPERADO}`,
      normaliza(total) === normaliza(TOTAL_ESPERADO),
      `medido ${normaliza(total)}`
    );
  } else {
    console.log(
      "  (sem TOTAL_A_PAGAR_ESPERADO: o controle negativo do dinheiro NAO foi medido)"
    );
  }

  // O retrato, para o comentario da issue.
  console.log("\n  --- retrato ---");
  console.log(`  parcelas em janela: ${emJanela.length}`);
  for (const p of emJanela) {
    console.log(
      `    ${p.mybank_installment_id}  ${p.description}  ${p.due_date}  ${p.amount}  ` +
        `(${quantasVezes(texto, p.description)}x na tela)`
    );
  }
  console.log(`  divida inteira: ${devidas.length} parcela(s)`);

  await pagina.screenshot({
    path: process.env.PRINT || "/tmp/hmo-386-contas-a-pagar.png",
    fullPage: true,
  });
} finally {
  await navegador.close();
}

if (falhas.length > 0) {
  console.error(`\n${falhas.length} medida(s) falharam:`);
  for (const f of falhas) console.error(`  - ${f}`);
  process.exit(1);
}

console.log("\nTodas as medidas passaram.");
