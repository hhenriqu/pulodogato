# Offline — o que funciona sem internet, e o que não

Complementa `docs/PWA.md`, que trata de **instalar** o app. Este trata de
**usar** o app sem rede.

## O que estava quebrado (HMO-145, 25/09/2026)

Havia service worker, havia `app/offline/page.tsx` com ilustração e texto, e
havia a impressão de que o modo offline existia. Nenhuma das três peças
funcionava, por três causas independentes.

### 1. Ficar sem sinal DESLOGAVA a pessoa

`lib/hooks/useAuth.ts` decidia quem está logado com `supabase.auth.getUser()`.
Esse método **sempre vai na rede** — é para isso que ele existe, o servidor
reconferir o token em vez de confiar no aparelho. Sem rede ele falha, `user`
vira `null`, e `app/(dashboard)/layout.tsx` tem `if (!user) router.push
("/login")`.

O app se comportava exatamente como se a sessão tivesse expirado. E o destino
era o pior possível: **offline não dá para logar de novo**, porque o login
também precisa da rede. A pessoa ficava presa numa tela de login inutilizável,
com o app instalado no celular.

O mesmo caminho tinha um segundo efeito, mais raro e mais caro: o servidor de
auth do Supabase em 5xx produz o mesmo `user = null`. Uma instabilidade de
minutos deslogaria toda a base.

**Consertado em `lib/offline-session.ts`**, fora do React, porque é uma tabela
de casos e é lá que dá para testá-la. A distinção que o código antigo não fazia:

| Quem disse "não" | O que acontece |
| --- | --- |
| O servidor confirmou o token | entra normal |
| O servidor **recusou** (401/403) | vai para /login, mesmo offline |
| A **rede** falhou, e há sessão lembrada dentro da graça | entra em modo offline |
| A rede falhou e não há sessão lembrada | vai para /login |
| O auth do Supabase em 5xx | tratado como rede: **não** desloga |

O default da classificação é "rede", de propósito: errar para o lado de
"recusa" desloga quem só estava sem sinal, e esse erro não tem volta offline.

### 2. `getSession()` também para de funcionar sem rede

A saída óbvia — trocar `getUser()` por `getSession()`, que lê do armazenamento
— funciona por **uma hora**, que é a validade do access token. Passado esse
prazo o próprio `getSession()` tenta renovar, a renovação precisa de rede, e
offline ele devolve `session: null`. O método que existe para funcionar sem rede
para de funcionar sem rede exatamente quando o modo offline começa a importar
(uma noite, um voo, um fim de semana no sítio).

Por isso o app guarda o próprio bilhete (`CHAVE_SESSAO_LEMBRADA`), gravado toda
vez que o **servidor** confirma a sessão, com validade de
`DIAS_DE_GRACA_OFFLINE` (30 dias) depois do vencimento.

**O bilhete não é credencial e não abre nada sozinho.** Ele só destrava a casca
do app e a fila de lançamentos. Toda leitura e toda escrita continuam indo com o
token de verdade e batendo na RLS — forjar o bilhete na mão abre o menu e não
entrega um centavo de dado de ninguém. Ele é apagado no logout, antes da chamada
ao servidor: sair da conta com o wi-fi caindo não pode deixar o app reabrindo
offline na conta de quem saiu.

### 3. A página /offline era inalcançável

`app/offline/page.tsx` existia, pronta, e **nada navegava até ela**. O `sw.js`
de produção foi baixado e conferido antes de mexer:

| | antes | depois |
| --- | --- | --- |
| `self.fallback(` | 0 | 15 |
| `handlerDidError` | 0 | 15 |
| `importScripts(...fallback...)` | não | sim |
| `/offline` no precache | não | sim |

A causa é uma chave ausente em `next.config.js`. Com o default (`{}`), o
next-pwa procura a página em `pages/_offline.*`; este projeto é App Router e não
tem diretório `pages/`. A busca falha, ele **desliga os fallbacks em silêncio** e
não imprime nada no log do build. Para completar a ilusão, havia um
`public/fallback-*.js` versionado no repositório — sobra de um build antigo, que
ninguém carregava. Ele saiu.

Hoje `npm run check-pwa-assets` reprova o commit que tirar a chave ou apontá-la
para uma rota sem `page.tsx`, e o workflow `pwa-assets` prova as duas coisas com
controle negativo.

## Lançar sem rede

A única coisa que o app **precisa** aceitar offline é registrar uma despesa —
é justamente o que acontece longe do wi-fi: o caixa do mercado, o
estacionamento, a fila do restaurante.

- as regras (o que pode entrar, em que ordem sai, o que fazer com cada erro)
  estão em `lib/offline-queue.ts`, testável sem navegador;
- o armazenamento é IndexedDB (`lib/offline-store.ts`), de propósito burro;
- o catálogo que o formulário precisa — categorias, contas e o `service_id`,
  que é `NOT NULL` e não aparece em tela nenhuma — fica em
  `lib/offline-cache.ts`. Sem ele a fila funcionaria e não serviria para nada:
  offline o seletor de categoria abriria vazio.

### A armadilha central: repetir o envio e cobrar duas vezes

O ponto cego de toda fila que reenvia não é "a rede caiu". É a rede cair
**depois** de o servidor gravar: o insert chega, o Postgres confirma, e a
resposta se perde na volta. Para o aparelho isso é indistinguível de nunca ter
chegado. Ele tenta de novo, e o almoço de R$ 32 vira R$ 64 de gasto — sem erro
em lugar nenhum.

Por isso o `id` da transação **nasce no aparelho**, antes do primeiro envio. A
coluna é `uuid DEFAULT gen_random_uuid()`, então aceita um id de fora, e a chave
primária transforma o reenvio em `ON CONFLICT (id) DO NOTHING`: a segunda
tentativa não grava nada e não dispara os triggers de saldo de novo.

`DO NOTHING` e não `DO UPDATE`, porque a linha pode ter sido editada no servidor
desde então — sobrescrever com a cópia do aparelho desfaria a edição sem
ninguém pedir.

### A armadilha espelho: o sucesso que parece falha

Com `ON CONFLICT DO NOTHING`, o reenvio de uma linha que **já gravou** responde
**sem erro e com zero linhas**. Quem lê "zero linhas" como falha — e é a leitura
natural, `.single()` até estoura — devolve o item para a fila e tenta de novo.
Para sempre. A fila nunca esvazia, o contador do aviso nunca zera, e a causa é
um envio que deu certo.

### O que a fila recusa, e por quê

| Recusado | Motivo |
| --- | --- |
| Parcelamento | vira N transações amarradas por `installment_parent_id`, montadas por uma rota |
| Despesa fixa | é uma **regra** em `recurring_rules`, não um lançamento — gravar transação cobraria duas vezes |
| Despesa dividida / com grupo | o rateio depende de quem está **ativo** no grupo agora, lista que o aparelho offline não tem |
| Edição | a versão no servidor pode ter mudado |

O critério não é "dá para gravar depois" — quase tudo daria. É "dá para gravar
depois **sem errar dinheiro**". Os quatro escrevem em várias tabelas, e um
reenvio que acerta metade delas deixa o livro desencontrado sem sintoma.

### O que nunca acontece com um lançamento enfileirado

Ele **não some em silêncio**. Um erro que não adianta repetir (a categoria foi
apagada no outro aparelho, o CHECK recusou o valor) marca o item como `falhou` e
o faz **aparecer** na faixa do topo, com descrição, valor e data — os três dados
que a pessoa precisa para relançar. Descartar sem poder relançar é o mesmo que
perder, só que com um aviso vermelho.

Um 401 **não** descarta e **não** gasta o teto de tentativas: a causa é a
sessão, não o lançamento, e queimar as dez tentativas numa viagem longa
transformaria "faça login" em "o seu lançamento virou erro permanente".

## O limite das 24 horas — resolvido

Até aqui valia: **o app só abria offline se você tivesse usado aquela tela nas
últimas 24 horas.** Depois disso aparecia a página /offline — no aparelho com o
app instalado, os 110 chunks precacheados e a fila de lançamentos intacta.

O motivo estava no `sw.js`: os documentos de navegação passavam pelo cache
`others` do next-pwa, que é `NetworkFirst` com `maxEntries: 32` e
`maxAgeSeconds: 86400`. Os **chunks JS** nunca tiveram esse problema — eles
estão no precache, versionados com o build — mas o HTML da tela não estava.

**Aumentar o prazo teria sido pior**, e é por isso que não foi o caminho. O HTML
guardado referencia os chunks daquele build pelo nome. Depois de alguns deploys,
um HTML de 30 dias atrás aponta para chunks que não existem mais em lugar
nenhum, e offline isso não dá a página /offline: dá uma **tela branca**, que é
onde ninguém consegue investigar.

**O que foi feito.** O HTML das telas entrou no mesmo manifesto de precache dos
chunks (`lib/pwa-precache.js`, ligado em `next.config.js`). O workbox troca o
precache como um bloco só: ou tudo do deploy N, ou tudo do N+1 — HTML e JS não
têm mais como sair de sincronia. Conferido no `sw.js` gerado: 112 entradas, as
duas rotas com a revisão do commit.

**Duas rotas, não todas as telas.** Só entra rota que tem o que fazer offline:

| rota | por quê |
| --- | --- |
| `/dashboard` | a casca. Sem ela o menu não existe e não dá para chegar na tela de lançamento |
| `/dashboard/personal-finance` | a única que **funciona** offline: catálogo no aparelho + fila |

As outras ficam no cache de 24h de propósito. Uma tela de leitura precacheada
abre sem rede e imprime **R$ 0,00 com toda a confiança** — o "zero confiante",
que é pior que a página /offline porque parece um número. Cada tela que entrar
nessa lista precisa antes saber dizer "estou sem rede" em vez de "você não tem
nada".

**A armadilha de quem for mexer nisso.** No next-pwa 5.6,
`additionalManifestEntries` **substitui** a varredura de `public/` em vez de
somar (`index.js`, linha 142). Quem devolver só as rotas tira do precache o
`manifest.json`, o `favicon.ico` e os 20 ícones — e o app volta a não ser
instalável, com build verde e HTTP 200 em todos eles. `npm run
test:pwa-precache` cobra os arquivos críticos pelo nome, e roda no workflow
`pwa-assets`.

Vale notar que quase todo `/dashboard/*` é **estático** no build (`○` na saída
do `next build`): o HTML é uma casca sem dado de usuário, e os dados vêm de
chamadas do navegador ao Supabase. Guardar essa casca não guarda dado de
ninguém — e é por isso que a lista não pode receber rota `ƒ` (dinâmica), que é
renderizada com o cookie de quem pediu. Há teste para isso.

## O que a tela diz quando não há rede

Sem rede, o app continua parecendo normal — e esse é o problema. Os números na
tela são os do último carregamento e não têm nenhuma marca que os distinga dos
atuais. Por isso os avisos falam de **dado**, não de conexão:

- a faixa no topo (`components/OfflineBanner.tsx`, montada no layout do
  dashboard) diz que os valores são do último carregamento, quantos lançamentos
  esperam para subir e quanto somam. Ela **some sozinha** quando há rede e a
  fila está vazia: faixa permanente vira cenário e para de ser lida no dia em
  que tem algo a dizer;
- em Finanças Pessoais, uma linha diz que a **lista** de lançamentos não
  carregou e de quando são as categorias que estão no seletor. Sem ela, a tela
  offline mostra zero lançamentos com a mesma cara de quem nunca lançou nada —
  o "zero confiante" que este projeto já sofreu.

## Testar de verdade

`npm run test:offline-session` e `npm run test:offline-queue` (rodam no
`db-verify`; os arquivos de `lib/offline-*.ts` estão no `paths:` dos dois
gatilhos, senão o job não dispara e o PR fica verde sem a suite ter rodado).

No celular ou no DevTools:

1. abra o app **com** rede e navegue até Finanças Pessoais (é o que enche o
   catálogo e o cache do documento);
2. ligue o modo avião, ou DevTools → Network → Offline;
3. recarregue. **Você não deve cair no login** — esse é o conserto principal;
4. lance uma despesa simples. O aviso do topo deve contar 1 pendente;
5. feche o app, volte a ligar a rede e abra de novo. A fila deve esvaziar
   sozinha, e o lançamento aparecer na lista **uma vez só**.

O passo 5 é o que importa: ele é o teste da idempotência, e é o único que
distingue "a fila funciona" de "a fila cobra duas vezes".
