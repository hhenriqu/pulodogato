// O que qualquer visitante ve, sem login. Roda ate sem os segredos.
import { test, expect } from "@playwright/test";

import { evidencia } from "./guarda";

test("a tela de login abre", async ({ page }, info) => {
  const resposta = await page.goto("/login");
  expect(resposta?.status(), "status da pagina de login").toBeLessThan(400);
  await expect(page.getByText("Entrar", { exact: true }).first()).toBeVisible();
  await expect(page.locator("#email")).toBeVisible();
  await expect(page.locator("#password")).toBeVisible();
  await evidencia(page, info, "login");
});

test("sem sessao, o painel manda para o login", async ({ page }) => {
  await page.goto("/dashboard");
  await page.waitForURL(/\/login/, { timeout: 20_000 });
});

test("senha errada mostra erro e nao entra", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#email").fill("ninguem-e2e@example.com");
  await page.locator("#password").fill("senha-errada-do-e2e");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator(".text-destructive").first()).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/login/);
});
