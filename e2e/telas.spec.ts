// A VARREDURA: toda tela do menu abre, sem excecao no navegador, sem 5xx, sem
// cair no login -- e deixa um print mascarado como evidencia do deploy.
import { test, expect, evidencia, esperarAssentar, semQuebras } from "./guarda";
import { telasDoMenu } from "./telas";

const ERRO_NA_TELA = /Application error|Unhandled Runtime Error|Internal Server Error/i;

for (const tela of telasDoMenu()) {
  test(`${tela.nome} (${tela.href})`, async ({ page, quebras }, info) => {
    const resposta = await page.goto(tela.href);
    expect(resposta?.status(), "status do documento").toBeLessThan(400);

    await esperarAssentar(page);

    await expect(page, "caiu no login: a sessao nao valeu").not.toHaveURL(/\/login/);
    await expect(page.locator("main")).toBeVisible();
    // Booleanos, e nao `toContainText`: na falha ele imprimiria a tela inteira
    // no log publico do Actions.
    const texto = await page.locator("body").innerText();
    expect(ERRO_NA_TELA.test(texto), "a tela mostra erro de aplicacao do Next").toBe(false);
    expect((await page.locator("main").innerText()).trim().length > 20, "a tela abriu vazia").toBe(true);

    await evidencia(page, info, tela.slug);
    semQuebras(quebras);
  });
}
