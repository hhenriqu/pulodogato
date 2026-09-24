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

- **Passos 1 a 4** (import, variaveis, Supabase Auth, Deployment Protection): o
  Helio, no browser. Nenhum dos quatro sai da conta dele -- e a razao de nao
  haver `VERCEL_TOKEN` neste fluxo.
- **Passo 5** (verificacao pos-deploy): o agente, assim que receber a URL do
  deploy. E um script, nao precisa de credencial nenhuma -- so de uma URL
  publica.

## Passos

### 1. Importar o repositorio

Vercel → Add New → Project → importar `pulodogato`. O framework e detectado
como Next.js; nao mude build command nem output directory.

O nome do projeto fica o padrao (`pulodogato`), decidido na HMO-122.

> **`pulodogato.vercel.app` ja esta tomado.** Verificado em 22/09: aquele
> hostname responde 200 servindo um SPA estatico do Lovable, que nao tem nada a
> ver com este projeto. Entao a Vercel **vai** dar um sufixo ao dominio deste
> deploy. **Copie a URL que a Vercel mostrar** em vez de assumir -- os passos 3 e
> 5 dependem dela estar exata, e apontar a verificacao para o hostname errado ja
> custou uma rodada de verificacao em cima da app de outra pessoa.

O projeto ja foi importado (22/09) e a Vercel deu, como previsto, dominios com
sufixo de time. Os dois que ela lista em Domains:

| Dominio | O que e |
| --- | --- |
| `pulodogato-git-main-helio-moraes-projects.vercel.app` | alias da branch `main` -- **e este o endereco estavel de producao**, use nos passos 3 a 5 |
| `pulodogato-mckko4ekk-helio-moraes-projects.vercel.app` | alias imutavel de um deploy especifico; muda a cada deploy, nao serve de referencia |

Onde este runbook escreve `<projeto>.vercel.app`, leia o dominio da primeira
linha. **Nao existe deploy nosso em `pulodogato.vercel.app`** -- aquele hostname
e de terceiros.

### 2. Variaveis de ambiente

**Este passo e obrigatorio: sem ele o build falha.** Nao e configuracao
opcional -- o deploy nao chega a subir.

Defina em Project Settings → Environment Variables, escopo **Production**:

| Variavel | Valor |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave `anon` do projeto |

Os dois valores de producao estao em `.env.production`, na raiz do repositorio
(o repo e privado). E o mesmo projeto Supabase que o banco de producao --
conferido comparando o ref `odxqjvtxsioksguuevqm` com o host de
`SUPABASE_DB_URL_RO`.

> **O `.env.production` versionado NAO vale na Vercel.** Uma versao anterior
> deste runbook dizia o contrario -- que o Next carregava o arquivo no build e
> por isso a aplicacao subiria funcionando mesmo sem configurar nada. Esta
> errado, e a primeira tentativa de deploy (commit `432d23f`) falhou por causa
> disso:
>
> ```
> Error: Variavel de ambiente ausente: NEXT_PUBLIC_SUPABASE_URL
> Error occurred prerendering page "/forgot-password"
> Error: Command "npm run build" exited with 1
> ```
>
> O mesmo commit **builda limpo na nossa maquina**, em clone novo e sem
> `.env.local` -- ou seja, o arquivo do repo e suficiente localmente. Na Vercel
> nao: a camada de Environment Variables do projeto substitui/sombreia o
> `.env.production` do clone, e como as variaveis nao estavam definidas o valor
> chegou vazio no prerender. O log ainda mostra `- Environments: .env.production`,
> o que faz parecer que o arquivo do repo foi lido. Nao foi.
>
> Consequencia pratica: o arquivo commitado nao e rede de seguranca nem risco de
> preview apontando para producao **na Vercel** -- ele e simplesmente inerte ali.
> Continua sendo usado localmente (`scripts/extract-schema.mjs` le ele como
> fallback), entao nao saiu do versionamento.

A validacao que produz esse erro (`utils/supabase/env.ts`) esta fazendo o que
deveria: falhar no build em vez de subir uma aplicacao que quebraria na cara do
usuario. Nao contorne prerender nem afrouxe a validacao para o build passar --
o jeito de fazer passar e definir as variaveis.

A chave `anon` e publica por design (vai para o bundle do browser); o que
protege os dados e a RLS, aplicada em producao em 21/09 (HMO-120, HMO-125).

#### As variaveis dos crons: o build passa sem elas, os avisos nao saem

As duas acima quebram o build quando faltam, entao e impossivel esquecer delas.
Estas duas **nao**:

| Variavel | Valor |
| --- | --- |
| `CRON_SECRET` | frase longa e aleatoria -- `openssl rand -base64 32` |
| `SUPABASE_SERVICE_ROLE_KEY` | chave `service_role` do projeto Supabase |

Sem elas o deploy sobe verde, o site funciona inteiro e **os tres crons de
`vercel.json` respondem 503 todo dia, para sempre**: o de vencimento de contas
(11:00 UTC), a varredura de assinaturas (09:00) e o aviso de assinatura (09:30).
Foi exatamente o que aconteceu -- `CRON_SECRET` nunca foi definida, entao desde
a HMO-141 nenhum aviso de vencimento chegou a ninguem, e ninguem percebeu,
porque uma rota que nunca roda com sucesso tambem nao gera erro nenhum no
painel. A HMO-152 e essa descoberta.

O 503 e deliberado: a rota se recusa a rodar sem a `service_role` em vez de
rodar com a chave anon, ver zero linhas pela RLS e sair verde sem avisar
ninguem. Nao afrouxe essa checagem -- defina as variaveis.

A `service_role` **ignora a RLS inteira**. E a unica rota do projeto que a usa;
nunca a exponha com prefixo `NEXT_PUBLIC_`.

Depois de definir, **redeploy** (variavel nova nao alcanca um deploy que ja
existe) e confira com `./scripts/verify-crons.sh` do passo 5.

### 3. Autorizar o dominio no Supabase Auth

**Sem este passo o login por email quebra.** Supabase Dashboard → Authentication
→ URL Configuration:

- **Site URL**: `https://pulodogato-git-main-helio-moraes-projects.vercel.app`
- **Redirect URLs**: adicionar `https://pulodogato-git-main-helio-moraes-projects.vercel.app/**`

O padrao do Supabase e `http://localhost:3000`. Enquanto estiver assim, o link
de confirmacao de cadastro e o de redefinicao de senha chegam apontando para a
maquina local de quem clicar.

> **Corrigir o que esta la agora.** Em 22/09 o Site URL foi preenchido com
> `https://pulodogato.vercel.app` -- o hostname de terceiros do passo 1, nao o
> nosso. Isso e pior que ter deixado `localhost`: o link de confirmacao de
> cadastro e o de redefinicao de senha saem apontando para a aplicacao de outra
> pessoa, levando o usuario (e o token que vai na URL) para fora daqui. Troque
> pelo dominio `-git-main-` acima antes de testar login.

### 4. Liberar o acesso publico (Deployment Protection)

**Conferido em 22/09: esta LIGADA, e enquanto estiver o deploy nao serve a
ninguem.** A Vercel Authentication vem habilitada por padrao em projetos novos.
Ela intercepta a requisicao antes da aplicacao e devolve 302 para
`vercel.com/sso-api`:

```
$ curl -sI https://pulodogato-git-main-helio-moraes-projects.vercel.app/api/health
HTTP/2 302
location: https://vercel.com/sso-api?url=...&nonce=...
```

Quem nao esta logado na conta da Vercel do projeto nao passa dali -- nao e
"protegido por login do app", e inacessivel. E independente do passo 2: mesmo
com as variaveis certas e o build verde, continua assim ate ser desligada.

Vercel → o projeto → Settings → Deployment Protection → desligar **Vercel
Authentication** para Production (pode continuar ligada em preview, que ai
protege as branches sem estorvar producao).

### 5. Verificar depois do deploy

```bash
./scripts/verify-deploy.sh https://pulodogato-git-main-helio-moraes-projects.vercel.app
```

Checa `/api/health` (200) e as **10** rotas removidas na Fase 1 (404 em todas).
Sai com codigo 1 se algo falhar.

Para verificar um **preview de PR antes do merge** -- desligar a protecao para
Production nao a desliga para Preview, entao o preview continua atras do SSO:

```bash
VERCEL_BYPASS_TOKEN=<token> ./scripts/verify-deploy.sh https://<preview>.vercel.app
```

O token sai de Settings → Deployment Protection → **Protection Bypass for
Automation**. Vale a pena: e a diferenca entre verificar o fix num deploy real
antes do merge e descobrir o problema em producao.

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

#### Os crons estao armados?

```bash
./scripts/verify-crons.sh https://pulodogato-theta.vercel.app
```

`verify-deploy.sh` nao cobre isso: ele prova que a app esta no ar, e os crons
podem estar 100% mortos com a app no ar. Este segundo script le `crons[].path`
do `vercel.json` (nao uma lista escrita a mao, que repetiria o bug do
`/api/debug/database`) e sonda cada um **sem header nenhum**. Como as rotas
checam as variaveis antes do `Authorization`, a resposta anonima diz tudo:

| Resposta | Leitura |
| --- | --- |
| **401** | certo -- variaveis no lugar; a Vercel manda o Bearer e passa, a internet nao |
| **503** | falta variavel (o corpo diz qual). Este cron nunca rodou |
| **500** | segredo ok, rota quebrada -- suspeita 1: migration pendente no Supabase |
| **404** | `vercel.json` agenda um caminho que nao existe no deploy |
| **200** | alarme: a rota roda sem autenticacao para qualquer um |

401 prova que a variavel existe, nao que a Vercel disparou o job. Isso so o
painel mostra: Project → **Cron Jobs**, que lista cada agendamento e o ultimo
disparo (e cada execucao aparece no log da funcao).

No plano **Hobby** o disparo tem precisao de hora, `±59 min`: `30 9 * * *` sai
entre 09:30 e 10:29. Com a varredura as 09:00 e o aviso as 09:30, em alguns dias
o aviso roda antes da varredura daquele dia -- nada quebra (o aviso le as
assinaturas ja conhecidas), mas uma assinatura detectada naquela manha so e
avisada no dia seguinte. Ordem garantida exige o plano Pro.

## Commits do agente: a Vercel se recusa a buildar

A Vercel verifica o **autor** do commit. Se o email do autor nao estiver ligado
a uma conta com acesso ao time, ela nao falha o build -- ela **nao builda**, e
comenta no PR:

```
Vercel didn't deploy this pull request to the Helio Moraes' projects team.
GitHub couldn't verify an account for commit <sha>.
```

Foi o que aconteceu no PR #10: os quatro commits estavam como
`Chief of staff (Paperclip) <agent@hmoraes.tec>`, um email sem conta, e nenhum
preview subiu.

O que escondia isso: todo commit que chegou na `main` ate hoje veio de **squash
merge**, e o squash reescreve o autor para quem clicou o merge (o Helio). Por
isso producao sempre deployou e so o preview quebrava.

A armadilha e que os tres metodos de merge estao habilitados no repo. Um
**"Create a merge commit"** ou **"Rebase and merge"** preserva a autoria
original -- e ai a Vercel recusa o deploy **de producao** do mesmo jeito. O
resultado e pior que um erro: a `main` avanca, nenhum build comeca, e o site
continua servindo o bundle antigo sem nada vermelho em lugar nenhum.

Duas saidas, nessa ordem:

1. **Autorar os commits como o Helio** antes de abrir o PR, preservando o
   credito do agente no trailer -- que e exatamente o que o squash ja produzia:

   ```bash
   git rebase <base> --exec 'git commit --amend --no-edit \
     --author="Helio Moraes <95727027+hhenriqu@users.noreply.github.com>" \
     --trailer "Co-authored-by: Chief of staff (Paperclip) <agent@hmoraes.tec>"'
   ```

2. Se um PR ja estiver aberto com a autoria errada, **mergear por squash** e o
   unico metodo seguro.

## Dominio proprio, quando for a hora

Apontar um CNAME para a Vercel, adicionar o dominio no projeto e entao:

1. Definir `NEXT_PUBLIC_URL=https://<dominio>` nas variaveis de ambiente.
2. Repetir o passo 3 com o dominio novo (Site URL + Redirect URLs).
