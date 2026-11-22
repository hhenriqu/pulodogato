// Entra UMA vez com a conta de teste e guarda a sessao em e2e/.auth/ (fora do
// git e fora do artefato: ali mora o token). Os projetos logados reusam.
import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { EMAIL, SENHA, SESSAO } from "./ambiente";

setup("entrar com a conta de teste", async ({ page }) => {
  expect(
    EMAIL && SENHA,
    "Faltam E2E_EMAIL e E2E_PASSWORD. No CI sao segredos do repositorio; localmente, variaveis de ambiente. " +
      "Para rodar so a parte publica: npm run e2e -- --project=publico",
  ).toBeTruthy();

  await page.goto("/login");
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(SENHA);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });

  mkdirSync(dirname(SESSAO), { recursive: true });
  await page.context().storageState({ path: SESSAO });
});
