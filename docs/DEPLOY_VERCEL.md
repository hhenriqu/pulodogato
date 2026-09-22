# Deploy na Vercel

Runbook para colocar o PuloDoGato no ar. Decisao registrada em HMO-122: a
aplicacao roda so em `localhost` hoje; o destino e a Vercel, usando o dominio
`*.vercel.app` por enquanto (sem dominio proprio).

O caminho antigo (`deploy.sh` + `docker-compose` numa VPS, atras de
`pulodogato.heliomoraes.dev`) **nunca chegou a subir**. Os arquivos continuam no
repositorio, mas nao ha nada rodando por ali -- `pulodogato.heliomoraes.dev` nao
resolve em DNS.

## Estado do repositorio

Ja feito e verificado (`next build` limpo, so warnings de lint):

- `vercel.json` fixa as funcoes em `gru1` (Sao Paulo). O Supabase do projeto
  esta em `sa-east-1`, tambem Sao Paulo -- co-localizar evita um salto de ida e
  volta ate os EUA em toda query.
- `metadataBase` detecta o dominio do deploy sozinho (`VERCEL_PROJECT_PRODUCTION_URL`
  / `VERCEL_URL`). Sem isso as metatags anunciariam `http://localhost:3000`.
- Nenhuma rota usa filesystem ou `process.cwd()`; tudo roda em serverless sem
  ajuste.
- Os redirects de autenticacao usam `window.location.origin`, entao acompanham
  o dominio da Vercel sem hardcode. Mas veja o passo 3 -- o Supabase precisa
  autorizar esse dominio.

## Quem faz o que (decidido na HMO-122)

- **Passos 1, 2 e 3** (import, variaveis, Supabase Auth): o Helio, no browser.
  Nenhum dos tres sai da conta dele -- e a razao de nao haver `VERCEL_TOKEN`
  neste fluxo.
- **Passo 4** (verificacao pos-deploy): o agente, assim que receber a URL do
  deploy. E um script, nao precisa de credencial nenhuma -- so de uma URL
  publica.

## Passos

### 1. Importar o repositorio

Vercel → Add New → Project → importar `pulodogato`. O framework e detectado
como Next.js; nao mude build command nem output directory.

O nome do projeto fica o padrao (`pulodogato`), decidido na HMO-122. O dominio
tende a ser `pulodogato.vercel.app`, mas se o nome ja estiver tomado por outra
conta a Vercel acrescenta um sufixo. **Copie a URL que a Vercel mostrar** em vez
de assumir -- o passo 3 e o 4 dependem dela estar exata.

### 2. Variaveis de ambiente

Defina em Project Settings → Environment Variables, escopo **Production**:

| Variavel | Valor |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave `anon` do projeto |

> **Atencao ao `.env.production` versionado.** Esse arquivo esta commitado e ja
> contem os valores de producao. O Next carrega ele durante o build, entao a
> aplicacao sobe funcionando mesmo sem configurar nada na Vercel -- inclusive
> nos **preview deployments de qualquer branch**, que passariam a falar com o
> banco de producao. Definir as variaveis na Vercel nao resolve isso sozinho
> (variaveis do ambiente tem precedencia, mas o preview tambem herdaria). Se o
> incomodo aparecer, o proximo passo e tirar `.env.production` do versionamento.

A chave `anon` e publica por design (vai para o bundle do browser); o que
protege os dados e a RLS, aplicada em producao em 21/09 (HMO-120, HMO-125).

### 3. Autorizar o dominio no Supabase Auth

**Sem este passo o login por email quebra.** Supabase Dashboard → Authentication
→ URL Configuration:

- **Site URL**: `https://<projeto>.vercel.app`
- **Redirect URLs**: adicionar `https://<projeto>.vercel.app/**`

O padrao do Supabase e `http://localhost:3000`. Enquanto estiver assim, o link
de confirmacao de cadastro e o de redefinicao de senha chegam apontando para a
maquina local de quem clicar.

### 4. Verificar depois do deploy

```bash
./scripts/verify-deploy.sh https://<projeto>.vercel.app
```

Checa `/api/health` (200) e as **10** rotas removidas na Fase 1 (404 em todas).
Sai com codigo 1 se algo falhar.

> A lista de rotas dentro do script veio do `git log --diff-filter=D`, nao de
> memoria -- e isso e o ponto. Uma versao anterior deste runbook mandava checar
> `/api/debug/database`, que **nunca existiu** (a rota era
> `/api/debug/database-check`). O curl devolvia 404 pelo caminho errado e a
> verificacao passava sem provar nada.
>
> Pelo mesmo motivo o script termina checando `/`: num deploy que nao existe,
> *todas* as rotas dao 404 e os 10 checks "passam". Se a raiz nao responde, os
> 404 nao valem como prova.

Depois, no browser: cadastro → email de confirmacao (o link deve apontar para o
dominio `.vercel.app`, nao para localhost) → login → dashboard carrega dados.

## Dominio proprio, quando for a hora

Apontar um CNAME para a Vercel, adicionar o dominio no projeto e entao:

1. Definir `NEXT_PUBLIC_URL=https://<dominio>` nas variaveis de ambiente.
2. Repetir o passo 3 com o dominio novo (Site URL + Redirect URLs).
