// =====================================================
// PULODOGATO - E2E: os fluxos que mudaram por ultimo
// =====================================================
// Cada um e o comportamento que um PR recente prometeu, medido na tela:
//
//   #455  Cartoes: composicao em rosca, Mensal x TOTAL para quitar; e o
//         Custo de vida somando esse MESMO total na reserva.
//   #454  Assinaturas: total por mes, peso na renda, filtro "Para revisar".
//   #452/#453  Apagar conta fixa pergunta o ALCANCE, e "Todos os meses" so
//         destrava depois de a pessoa marcar que entendeu.
//
// O LOG E PUBLICO (repositorio publico). Por isso as assercoes sao sobre
// LOCALIZADORES (`getByText(...).toBeVisible()`), e nao `toContainText` num
// bloco: na falha, `toContainText` imprime o texto inteiro do bloco -- com os
// valores -- no log do Actions e no relatorio.
//
// NADA AQUI GRAVA. A fixture de e2e/guarda.ts aborta toda escrita, e o teste
// de apagar FECHA o dialogo sem confirmar. O `confirm()` nativo das linhas que
// nao sao fixas e recusado (dismiss).
//
// Quando a conta de teste nao tem o dado que o fluxo precisa (nenhum cartao,
// nenhuma conta fixa no mes), o teste PULA dizendo o motivo no relatorio --
// pular calado seria indistinguivel de passar.
// =====================================================

import type { Page } from "@playwright/test";

import { test, expect, evidencia, esperarAssentar, semQuebras } from "./guarda";

const REAIS = /R\$\s?[\d.]+,\d{2}/;

/** O cartao "Composicao dos cartoes" (o Card que contem as abas) e o centro da rosca. */
function composicao(page: Page) {
  const abas = page.getByRole("tablist", { name: "Mensal ou total para quitar" });
  const cartao = abas.locator("xpath=ancestor::div[contains(@class,'bg-card')][1]");
  const centro = cartao.locator("div.absolute.inset-0");
  return { abas, cartao, centro };
}

test.describe("Cartoes e Custo de vida (#455)", () => {
  test("composicao dos cartoes alterna Mensal e TOTAL para quitar", async ({ page, quebras }, info) => {
    await page.goto("/dashboard/cartoes");
    await esperarAssentar(page);

    const { abas, cartao, centro } = composicao(page);
    test.skip(!(await abas.isVisible()), "a conta de teste nao tem cartao com composicao");

    const total = abas.getByRole("tab", { name: "TOTAL" });
    const mensal = abas.getByRole("tab", { name: "Mensal" });

    await total.click();
    await expect(total).toHaveAttribute("aria-selected", "true");
    await expect(cartao.getByText("Para quitar hoje")).toBeVisible();
    await expect(centro.getByText("para quitar", { exact: true })).toBeVisible();
    await expect(centro.getByText(REAIS)).toBeVisible();
    await evidencia(page, info, "cartoes--total-para-quitar");

    await mensal.click();
    await expect(mensal).toHaveAttribute("aria-selected", "true");
    await expect(centro.getByText("na fatura", { exact: true })).toBeVisible();
    await expect(cartao.getByText("Para quitar hoje")).toHaveCount(0);

    semQuebras(quebras);
  });

  test("custo de vida soma o MESMO total para quitar da tela de Cartoes", async ({ page, quebras }, info) => {
    // 1. O total da rosca, na tela de Cartoes.
    await page.goto("/dashboard/cartoes");
    await esperarAssentar(page);
    const { abas, centro } = composicao(page);
    test.skip(!(await abas.isVisible()), "a conta de teste nao tem cartao com composicao");
    await abas.getByRole("tab", { name: "TOTAL" }).click();
    await expect(centro.getByText("para quitar", { exact: true })).toBeVisible();
    const totalNosCartoes = REAIS.exec(await centro.innerText())?.[0];
    expect(totalNosCartoes, "o centro da rosca no TOTAL").toBeTruthy();

    // 2. O mesmo numero ao lado da chave do Custo de vida.
    await page.goto("/dashboard/investments/custo-de-vida");
    await esperarAssentar(page);
    const chave = page.locator("#custo-com-cartoes");
    await expect(chave).toBeVisible();
    const linha = page.locator("div").filter({ has: chave }).filter({ hasText: "Somar o total para quitar" }).last();
    await expect(linha.getByText(REAIS)).toBeVisible({ timeout: 20_000 });
    const valorNaChave = REAIS.exec(await linha.innerText())?.[0];
    // Comparado como booleano DE PROPOSITO: o log do Actions e publico, e um
    // `toBe(valor)` imprimiria os dois totais na falha.
    const iguais = !!valorNaChave && valorNaChave.replace(/\s/g, "") === totalNosCartoes?.replace(/\s/g, "");
    expect(iguais, "o total ao lado da chave do Custo de vida difere do TOTAL da tela de Cartoes").toBe(true);

    // 3. Ligada, a reserva passa a dizer que soma o total dos cartoes.
    const somaNaReserva = page.locator("main").getByText(/\+ R\$\s?[\d.]+,\d{2} para quitar os cartões/);
    await expect(chave).toHaveAttribute("aria-checked", "false");
    await chave.click();
    await expect(chave).toHaveAttribute("aria-checked", "true");
    await expect(somaNaReserva).toBeVisible();
    await evidencia(page, info, "custo-de-vida--com-cartoes");

    await chave.click();
    await expect(chave).toHaveAttribute("aria-checked", "false");
    await expect(somaNaReserva).toHaveCount(0);

    semQuebras(quebras);
  });
});

test.describe("Assinaturas (#454)", () => {
  test("painel com total, peso na renda e filtro de revisao", async ({ page, quebras }, info) => {
    await page.goto("/dashboard/recurrences");
    await esperarAssentar(page);

    await expect(page.getByRole("heading", { level: 1, name: "Assinaturas" })).toBeVisible();
    const main = page.locator("main");
    await expect(main.getByText("Total por mês", { exact: true })).toBeVisible();
    await expect(main.getByText("Peso na sua renda", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Suas assinaturas" })).toBeVisible();

    const filtro = page.getByRole("group", { name: "Filtrar a lista" });
    if (await filtro.isVisible()) {
      const revisar = filtro.getByRole("button", { name: /^Para revisar \(\d+\)$/ });
      await revisar.click();
      await expect(revisar).toHaveAttribute("aria-pressed", "true");
      await filtro.getByRole("button", { name: /^Todas \(\d+\)$/ }).click();
    } else {
      info.annotations.push({ type: "sem filtro", description: "nada para revisar nesta conta" });
    }
    await evidencia(page, info, "assinaturas");

    semQuebras(quebras);
  });
});

test.describe("Apagar conta fixa com alcance (#452/#453)", () => {
  test("o dialogo pergunta o alcance e trava 'Todos os meses'", async ({ page, quebras }, info) => {
    // Linha que nao e fixa abre `confirm()` nativo: recusado, nada e apagado.
    page.on("dialog", (d) => d.dismiss());

    await page.goto("/dashboard/despesas");
    await esperarAssentar(page);

    const dialogo = page.getByRole("dialog").filter({ hasText: "Escolha o que apagar" });
    const excluir = page.locator("main").getByRole("button", { name: "Excluir", exact: true });
    const n = await excluir.count();

    let achou = false;
    for (let i = 0; i < n && !achou; i++) {
      await excluir.nth(i).click();
      achou = await dialogo.waitFor({ timeout: 2_000 }).then(() => true, () => false);
    }
    test.skip(!achou, "nenhuma conta fixa em Despesas neste mes");

    await expect(dialogo.getByRole("button", { name: /^Só este mês \(/ })).toBeVisible();
    await expect(dialogo.getByRole("button", { name: "Deste mês em diante" })).toBeVisible();

    const todos = dialogo.getByRole("button", { name: "Apagar todos os meses" });
    const entendi = dialogo.locator("#alcance-entendi-todos");
    await expect(todos).toBeDisabled();
    await entendi.check();
    await expect(todos).toBeEnabled();
    await evidencia(page, info, "despesas--apagar-fixa-alcance");
    await entendi.uncheck();
    await expect(todos).toBeDisabled();

    await page.keyboard.press("Escape");
    await expect(dialogo).toBeHidden();

    expect(quebras.escritasBloqueadas, "o teste nao pode ter tentado apagar").toEqual([]);
    semQuebras(quebras);
  });
});
