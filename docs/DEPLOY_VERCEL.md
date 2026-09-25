# Deploy na Vercel

Runbook para colocar o PuloDoGato no ar. Decisao registrada em HMO-122: o
destino e a Vercel. Desde 22/09 o app esta no ar em
`pulodogato-theta.vercel.app`; a HMO-157 acrescenta o dominio proprio
`pulodogato.hmoraes.com.br` (passo 6).

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
  o dominio sem hardcode. Mas veja o passo 3 -- o Supabase precisa autorizar
  esse dominio, senao ele ignora o valor e usa o Site URL do projeto.
- O retorno do link de email tem rota propria, `/auth/callback` (HMO-157). Ela
  troca o `code`/`token_hash` por sessao e **cria o perfil**. Antes dela o
  cadastro nao terminava: a policy de INSERT de `profiles` e `TO authenticated`,
  e com a confirmacao de email ligada o `signUp` nao devolve sessao -- o insert
  que o cliente tentava rodava como `anon`, a RLS recusava, e o erro ia para o
  console. Sem perfil, `create_user_subscription_trigger` tambem nunca disparava:
  em 25/09 producao tinha `user_subscriptions.n_tup_ins = 0`, nenhuma assinatura
  criada desde que o banco existe.

## Quem faz o que (decidido na HMO-122, estendido na HMO-157)

- **Passos 1 a 4 e 6.1 a 6.5** (import, variaveis, Supabase Auth, Deployment
  Protection, dominio na Vercel, zona no Registro.br, confirmacao de email): o
  Helio, no browser. Nenhum deles sai da conta dele -- e a razao de nao haver
  `VERCEL_TOKEN` nem credencial de DNS nem token de management do Supabase neste
  fluxo.
- **Passos 5 e 6.6** (verificacao pos-deploy): o agente, assim que o dominio
  resolver. Sao scripts, nao precisam de credencial nenhuma -- so de uma URL
  publica e do `SUPABASE_DB_URL_RO`, que ele ja tem.

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
| `pulodogato-theta.vercel.app` | **o dominio de PRODUCAO, e o unico publico** -- use nos passos 3 a 6 |
| `pulodogato-git-main-helio-moraes-projects.vercel.app` | alias da branch `main`; a Vercel o trata como URL de branch, ou seja continua atras da Deployment Protection |
| `pulodogato-mckko4ekk-helio-moraes-projects.vercel.app` | alias imutavel de um deploy especifico; muda a cada deploy, nao serve de referencia |

Onde este runbook escreve `<projeto>.vercel.app`, leia `pulodogato-theta.vercel.app`.
**Nao existe deploy nosso em `pulodogato.vercel.app`** -- aquele hostname e de
terceiros.

> **Correcao de 25/09.** Ate aqui este documento afirmava que o alias
> `-git-main-` era "o endereco estavel de producao". Nao e, e a diferenca nao e
> cosmetica -- os passos 3 a 5 mandavam configurar o Supabase e rodar a
> verificacao contra um hostname que **nao serve a ninguem**. Medido no mesmo
> minuto:
>
> ```
> $ curl -sI https://pulodogato-theta.vercel.app/api/health
> HTTP/2 200        {"status":"ok","message":"Database connection successful"}
>
> $ curl -sI https://pulodogato-git-main-helio-moraes-projects.vercel.app/api/health
> HTTP/2 302        location: https://vercel.com/sso-api?url=...
> ```
>
> Desligar a Deployment Protection (passo 4) vale para **Production**, e a
> Vercel nao conta o alias de branch como producao: ele fica no regime de
> preview e segue pedindo login da Vercel. Um 302 para `vercel.com/sso-api` se
> parece com URL errada, nao com protecao ligada -- e o que faz esse erro
> sobreviver.

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

- **Site URL**: `https://pulodogato.hmoraes.com.br` (ate o dominio proprio
  existir, `https://pulodogato-theta.vercel.app`)
- **Redirect URLs**: `https://pulodogato.hmoraes.com.br/**` e
  `https://pulodogato-theta.vercel.app/**`

O padrao do Supabase e `http://localhost:3000`. Enquanto estiver assim, o link
de confirmacao de cadastro e o de redefinicao de senha chegam apontando para a
maquina local de quem clicar.

**Os dois campos fazem coisas diferentes, e so um deles o codigo consegue
contornar.** O *Redirect URLs* e uma lista de permissao: o `emailRedirectTo` que
o app manda em `signUp` (e o `redirectTo` da recuperacao de senha) so e aceito
se casar com um padrao dessa lista -- se nao casar, o Supabase ignora o valor
sem reclamar e cai no *Site URL*. O *Site URL* e um valor unico para o projeto
todo, ou seja para producao e preview ao mesmo tempo. Por isso mantenha os dois
dominios na lista de Redirect URLs: com so um deles, cadastrar-se pelo outro
manda o link de confirmacao para o endereco errado.

> **Medido em 25/09 (HMO-157), e o estado e outro.** O Site URL **nao** e mais
> `https://pulodogato.vercel.app` (o hostname de terceiros do passo 1): hoje esta
> `https://pulodogato-helio-moraes-projects.vercel.app`, que e um alias do nosso
> proprio projeto na Vercel. Nao ha token saindo para fora daqui.
>
> **O que esta errado e a outra metade.** A lista de *Redirect URLs* nao contem
> nenhum dos nossos hostnames -- nem `pulodogato-theta.vercel.app`, nem
> `localhost:3000`. Como nenhum valor que o app manda casa com a lista, o
> Supabase descarta os dois em silencio e manda o link para a **raiz** do Site
> URL. A raiz nao troca o token por sessao (`app/page.tsx` nao le o fragmento),
> entao o link de confirmacao nunca chega em `/auth/callback` e a redefinicao de
> senha nao chega em `/reset-password`. Corrigir e o item 2 da **HMO-158**.

#### Conferir a allow-list sem o painel (e sem disparar email)

O endpoint `/auth/v1/verify` com um token invalido revela as duas configuracoes:
um `redirect_to` **aceito** volta ecoado com o caminho preservado, um **recusado**
cai na raiz do Site URL. Nenhum email e enviado.

```bash
curl -s -o /dev/null -w '%{redirect_url}\n' \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  "https://<project-ref>.supabase.co/auth/v1/verify?token=x&type=signup&redirect_to=<url-encodada>"
```

Sem o parametro `redirect_to`, o destino e o **Site URL** -- e assim que se le o
valor dele de fora do painel.

**Use um controle positivo ou a leitura inverte.** "Caiu na raiz do Site URL" e
tambem o que acontece se o endpoint simplesmente ignorasse `redirect_to` em caso
de erro. Mande primeiro um caminho sob o **proprio Site URL**
(`.../auth/callback`): se ele voltar com o caminho preservado, a allow-list esta
sendo respeitada e as recusas seguintes sao reais.

### 4. Liberar o acesso publico (Deployment Protection)

**Ja foi desligada para Production** (`pulodogato-theta.vercel.app` responde 200
em 25/09). O que segue vale para entender o sintoma, e continua valendo para
preview. A Vercel Authentication vem habilitada por padrao em projetos novos.
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
./scripts/verify-deploy.sh https://pulodogato-theta.vercel.app
# e, depois do passo 6, tambem:
./scripts/verify-deploy.sh https://pulodogato.hmoraes.com.br
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
| **500** | a rota quebrou antes do guard de auth -- **nao** e migration pendente (veja abaixo) |
| **404** | `vercel.json` agenda um caminho que nao existe no deploy |
| **200** | alarme: a rota roda sem autenticacao para qualquer um |

401 prova que a variavel existe, nao que a Vercel disparou o job. Isso so o
painel mostra: Project → **Cron Jobs**, que lista cada agendamento e o ultimo
disparo (e cada execucao aparece no log da funcao).

E prova menos ainda do que parece. O guard de `Authorization` vem **antes** de
qualquer acesso ao banco, entao a sonda anonima para no 401 e **nunca executa o
corpo da rota**: schema faltando, RLS errada e erro de runtime sao todos
invisiveis para ela. Os tres crons podem dar 401 e mesmo assim estourar 500
quando a Vercel dispara com o Bearer correto — foi exatamente o caso do aviso de
assinatura (09:30), que depende da migration **016**. Um 500 nesta sonda so
aparece se a rota quebrar antes do guard, que e outra coisa. Para saber se o job
*funcionou*, o unico lugar e o log da execucao no painel.

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

### 6. Dominio proprio: `pulodogato.hmoraes.com.br`

Decidido na HMO-157. O dominio `hmoraes.com.br` **ja existe e ja aponta para a
Vercel** -- o site institucional da H. Moraes roda nele. Ou seja, este passo nao
e "comprar e configurar um dominio", e adicionar um subdominio a uma zona que ja
funciona. Levantado em 25/09, e o que decide onde cada registro entra:

| O que | Valor medido | De onde sai |
| --- | --- | --- |
| Registrador / DNS | **Registro.br** | `NS` de `hmoraes.com.br` = `e.sec.dns.br` / `f.sec.dns.br`, e o `SOA` e `hostmaster.registro.br` |
| Apex (`hmoraes.com.br`) | `A 216.198.79.1` → 308 para `www` | IP anycast da Vercel |
| `www` | `CNAME f16a85fe47e1b081.vercel-dns-017.com` | ja servindo o site institucional |
| `pulodogato.hmoraes.com.br` | **NXDOMAIN** | nao existe ainda |

**A zona nao esta na Vercel, esta no Registro.br.** Isso importa: nao da para
criar o registro pelo painel da Vercel: ela vai *pedir* um registro e ficar
esperando. Quem cria e o Registro.br.

#### 6.1 Adicionar o dominio no projeto da Vercel (primeiro)

Vercel → projeto `pulodogato` → Settings → Domains → Add → `pulodogato.hmoraes.com.br`.

Ela vai mostrar o registro a criar, quase certamente um `CNAME` para um host
`*.vercel-dns-017.com`. **Copie o valor que ela mostrar.** O hash do `www`
(`f16a85fe47e1b081`) e daquele dominio, nao deste -- reaproveita-lo produz um
dominio que nunca verifica.

**Decidido em 25/09 (HMO-157): `pulodogato.hmoraes.com.br` e o dominio
PRINCIPAL, e `pulodogato-theta.vercel.app` redireciona para ele.** Na mesma tela
de Domains, no menu do dominio novo, marque *Set as Primary Domain*; a Vercel
passa a responder 307/308 no `.vercel.app` apontando para o proprio.

Duas consequencias que valem por si:

- `VERCEL_PROJECT_PRODUCTION_URL` passa a ser o dominio novo, e com isso o
  `metadataBase` acerta sozinho (veja 6.4).
- o cadastro deixa de poder comecar num dominio e terminar no outro. Isso
  importa por causa do PKCE: o verificador vive num COOKIE, entao um link de
  recuperacao de senha aberto no dominio errado nao consegue trocar o `code` por
  sessao. Com um dominio so servindo de verdade, esse caso deixa de existir.

#### 6.2 Criar o registro no Registro.br

<https://painel.registro.br> → `hmoraes.com.br` → **DNS** → editar a zona →
adicionar a linha que a Vercel pediu:

```
pulodogato    CNAME    <valor-que-a-vercel-mostrou>.
```

O nome e so `pulodogato` (a zona ja e `hmoraes.com.br`), e o ponto final no
destino nao e enfeite: sem ele alguns editores concatenam a zona e o destino
vira `...vercel-dns-017.com.hmoraes.com.br`. Salvar e publicar a zona.

A propagacao costuma levar minutos; o TTL da zona hoje e 3600s, entao no pior
caso uma hora. O certificado TLS a Vercel emite sozinha depois de ver o
registro.

Conferir sem browser:

```bash
curl -s -H 'accept: application/dns-json' \
  'https://cloudflare-dns.com/dns-query?name=pulodogato.hmoraes.com.br&type=CNAME'
```

`"Status":3` e NXDOMAIN, ou seja ainda nao propagou. Com `"Status":0` e o CNAME
da Vercel na resposta, siga.

#### 6.3 Autorizar o dominio no Supabase

Repetir o passo 3 com o dominio novo -- e **este** e o passo que faz o cadastro
funcionar, nao o DNS:

- **Site URL**: `https://pulodogato.hmoraes.com.br`
- **Redirect URLs**: `https://pulodogato.hmoraes.com.br/**` e
  `https://pulodogato-theta.vercel.app/**`

#### 6.4 Desligar a confirmacao de email

**Decidido em 25/09 (HMO-157): a conta passa a valer na hora.**

Supabase → Authentication → Sign In / Providers → **Email** → desmarcar
**Confirm email** → Save.

Conferir sem o painel (e publico, nao precisa de chave):

```bash
curl -s https://<project-ref>.supabase.co/auth/v1/settings \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" | grep -o '"mailer_autoconfirm":[a-z]*'
```

`"mailer_autoconfirm":true` e o estado novo (o nome e invertido: `autoconfirm`
ligado = confirmacao desligada). Em 25/09 estava `false`.

O que muda no comportamento:

- o `signUp` passa a devolver **sessao na hora**, e o usuario cai direto no
  `/dashboard` sem passar por `/auth/callback`;
- ninguem mais depende do SMTP embutido para criar conta, ou seja o limite de
  envio sai do caminho do cadastro (ele continua valendo para recuperacao de
  senha);
- em troca, um email digitado errado cria uma conta que funciona com um endereco
  que nao existe. O preco de recuperar a senha dessa conta e o dono nao ter como
  receber o link.

O codigo funciona nos **dois** estados e nao precisa de deploy quando a chave
vira: `lib/signup-outcome.ts` decide o fim do cadastro pela sessao que o
`signUp` devolveu, e `lib/ensure-profile.ts` cria o perfil nos dois caminhos --
no `signUp` quando ja ha sessao, no `/auth/callback` quando o perfil so pode
nascer depois do link. Isso e o que evita o modo de falha antigo: com a
confirmacao desligada ninguem visita o callback, e um perfil que nascesse *so*
la deixaria a conta sem perfil e -- porque
`create_user_subscription_trigger` dispara AFTER INSERT ON profiles -- sem
assinatura, sem erro nenhum em tela.

#### 6.5 Opcional: `NEXT_PUBLIC_URL`

Só para as metatags (`metadataBase` em `app/layout.tsx`). Sem ela o app usa
`VERCEL_PROJECT_PRODUCTION_URL`, que a Vercel preenche com o dominio de
producao: como o passo 6.1 marca `pulodogato.hmoraes.com.br` como principal,
nao ha nada a fazer aqui.

#### 6.6 Verificar

```bash
./scripts/verify-deploy.sh https://pulodogato.hmoraes.com.br
```

E o cadastro de ponta a ponta, que e o objetivo da HMO-157. Com a confirmacao
desligada no passo 6.4 o roteiro e: criar uma conta em
`https://pulodogato.hmoraes.com.br/signup` e **cair logado no `/dashboard`
direto, sem email nenhum**. Se a tela disser "Enviamos um email de confirmacao",
uma das duas coisas esta acontecendo: o passo 6.4 nao foi salvo, ou o deploy e
anterior a este commit.

Rota importante: o `.vercel.app` tem que redirecionar, e nao servir o app.

```bash
curl -s -o /dev/null -w '%{http_code} -> %{redirect_url}\n' \
  https://pulodogato-theta.vercel.app/dashboard
```

Esperado: `307` (ou `308`) apontando para `pulodogato.hmoraes.com.br`. Um `200`
aqui significa que o *Set as Primary Domain* do passo 6.1 nao pegou.

E a prova que nao aparece na tela -- o perfil e a assinatura nasceram? Com o
`SUPABASE_DB_URL_RO`:

```sql
select
  (select count(*) from profiles)          as perfis,
  (select count(*) from user_subscriptions) as assinaturas;
```

Os dois numeros tem que subir de 1 a cada conta criada. Se `perfis` subir e
`assinaturas` nao, o problema e o trigger, nao o cadastro. Em 25/09, antes
disto, `user_subscriptions` tinha **zero** linhas desde que o banco existe --
esse e o numero que este passo existe para mudar.

> **A recuperacao de senha continua dependendo de email**, e o SMTP embutido do
> Supabase e para desenvolvimento: poucos emails por hora por projeto, sem
> garantia de entrega. Desligar a confirmacao tirou o cadastro dessa
> dependencia, nao o "esqueci minha senha". Se um link nao chegar, conferir
> Authentication → Logs antes de suspeitar do dominio. SMTP proprio e assunto de
> outra issue.
