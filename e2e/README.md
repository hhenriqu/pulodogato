# E2E: regressão a cada deploy (Playwright)

Abre o app **publicado** num Chromium de verdade, como uma pessoa usaria, e
reprova o deploy que quebrar uma tela. Cada rodada deixa os prints de todas as
telas (desktop e celular) como evidência da evolução do app.

## O que roda

| Arquivo | O que prova |
|---|---|
| `publico.spec.ts` | Login abre; sem sessão o painel manda para o login; senha errada mostra erro. Não precisa de conta. |
| `telas.spec.ts` | **Toda tela do menu** abre: documento < 400, não cai no login, sem exceção no navegador, sem 5xx em `/api` ou no Supabase, sem tela de erro do Next, e com conteúdo. A lista vem de `components/navegacao-do-menu.ts`: tela nova no menu entra na varredura sozinha. |
| `fluxos.spec.ts` | Os fluxos dos PRs recentes: composição dos cartões (Mensal × TOTAL para quitar, #455); o Custo de vida somando **o mesmo** total da tela de Cartões (#455); Assinaturas com total, peso na renda e filtro (#454); apagar conta fixa pergunta o alcance e trava "Todos os meses" até marcar que entendeu (#452/#453). |

Cada teste logado roda em dois projetos: `desktop` (1366×900) e `celular` (Pixel 7).

## Somente leitura

A suite roda contra produção. `guarda.ts` **aborta no navegador** toda escrita
(POST/PUT/PATCH/DELETE em `/api` e no PostgREST do Supabase); passam só o login
e as RPCs de leitura. O teste de apagar fixa abre o diálogo e fecha sem
confirmar, e o `confirm()` nativo é recusado.

## Privacidade (o repositório é público)

- Os prints têm **todo dígito trocado por 0** antes da captura (`E2E_MASCARAR=nao` desliga, só para uso local).
- Trace, vídeo e o print automático do Playwright ficam desligados: guardariam valores e respostas da API.
- As asserções não imprimem o texto da tela na falha (log do Actions é público).
- Mesmo assim, o ideal é uma **conta de teste** com dados fictícios, e não a sua conta real.

## No CI (`.github/workflows/e2e.yml`)

- **A cada deploy da Vercel que dá certo** (`deployment_status`): produção testa
  `pulodogato.hmoraes.com.br`; preview testa a URL do preview.
- **Todo dia às 9h** contra produção, e **na mão** (Actions → e2e → Run workflow, com URL opcional).
- Artefato `evidencias-<ambiente>-<sha>-<tentativa>`: prints mascarados + relatório HTML, 90 dias.
- Segredos do repositório: `E2E_EMAIL`, `E2E_PASSWORD` (obrigatórios; sem eles o job **falha**) e `E2E_VERCEL_BYPASS` (opcional, preview protegido).

## Rodar na sua máquina

```bash
npx playwright install chromium            # uma vez
E2E_EMAIL=... E2E_PASSWORD=... npm run e2e  # tudo, contra produção
npm run e2e -- --project=publico           # só o que não precisa de login
E2E_BASE_URL=http://localhost:3000 npm run e2e
npm run e2e:relatorio                      # abre o relatório da última rodada
```

Os prints ficam em `e2e/evidencias/<projeto>/` (fora do git).
