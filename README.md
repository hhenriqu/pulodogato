# Pulo do Gato

Gestão financeira **familiar** — um Progressive Web App para o controle do dinheiro
de casa: contas, cartões, lançamentos, despesas divididas em grupo, orçamento,
metas e relatórios. Tem um módulo de investimentos, mas ele é uma parte do
produto, não o produto.

No ar em **https://pulodogato.hmoraes.com.br**.

> **Sobre este arquivo.** Até setembro de 2026 o README e a PRD descreviam um
> "Controle de Investimentos": um app de carteira de ações, FIIs e dividendos que
> nunca foi o que este repositório construiu. O passo a passo de instalação
> chegava a mandar colar `CREATE TABLE assets`, `transactions` e `dividends` no
> SQL Editor — tabelas que não existem no schema real e que conflitam com as 25
> migrations de `database/migrations/`. Quem seguisse o README montava um banco
> que o app não sabe ler. Isto é a HMO-119.

---

## O que o app faz

**Dinheiro entrando e saindo**

- **Contas** (corrente, poupança) e **Cartões** (limite, dia de fechamento, dia
  de vencimento) em telas separadas — o que é conta não tem fatura, o que é
  cartão não tem saldo.
- **Lançamentos** de despesa, receita e transferência, com parcelamento,
  recorrência e rateio. Despesa é gravada com valor **negativo**.
- **Fatura de cartão**: o pagamento da fatura entra como transferência de duas
  pernas, para não contar a despesa duas vezes.
- **Transferência** entre contas, com categoria reservada própria.
- **Extratos** (OFX/CSV) com deduplicação por conta, e comprovantes em bucket
  privado.
- **Categorização automática** por regras.

**Dividir com outras pessoas**

- **Grupos de despesa**: rateio em centavos, acerto de contas (quem deve a
  quem), arquivamento e as regras de saída do grupo. A divisão é feita pelo
  **banco**, por trigger — não pela tela.
- **Conexões** entre usuários, com consentimento.

**Planejar**

- **Orçamento** por categoria.
- **Metas** com aporte mensal.
- **Contas previstas** e **recorrências**, incluindo um detector de assinaturas.
- **Fluxo de caixa** com previsão, **quanto posso gastar**, **anomalias** e
  **gasto variável**.
- **Patrimônio líquido**, **relatórios** e **calculadoras**.
- **Contracheque**: bruto, descontos em folha e o líquido.
- **Investimentos** e multi-moeda.

**O resto**

- **PWA instalável**, com leitura offline e fila de lançamentos feitos sem rede.
- **Notificações** push (VAPID) e resumo mensal.
- **Planos/assinatura**, perfil, e um painel de configurações onde a pessoa
  escolhe a ordem dos blocos do dashboard e pode zerar a conta.
- Modo noturno: **toda cor sai de token**, com contraste AA verificado no CI.

## Stack

| | |
| --- | --- |
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind |
| Componentes | Radix UI, Recharts, Lucide |
| Formulários | React Hook Form + Zod |
| Banco / Auth | Supabase (PostgreSQL, RLS) |
| PWA | next-pwa |
| Hospedagem | Vercel (+ Vercel Cron) |

## Rodando localmente

Precisa de Node 20 e de um projeto Supabase.

```bash
npm install
cp .env.local.example .env.local   # preencha as duas chaves do seu projeto
npm run dev                        # http://localhost:3000
```

As variáveis que o app lê:

| variável | para quê |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | cliente e servidor |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | cliente e servidor |
| `SUPABASE_SERVICE_ROLE_KEY` | só as rotas de cron |
| `CRON_SECRET` | autentica as rotas de cron |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | push |
| `NEXT_PUBLIC_URL` | links absolutos em e-mail e push |

As duas primeiras são **obrigatórias já no build**: `utils/supabase/env.ts`
valida que existem, que a URL é válida e que não são o valor de exemplo — e
`next build` pré-renderiza as telas de login, então um build sem elas falha em 31
páginas com `Variável de ambiente ausente`. As demais são lidas **dentro** dos
handlers: faltar não quebra o build, quebra a rota que precisa delas.

> `.env.production` **não está versionado** (nem poderia: o `.env.local.example`
> existe justamente para isso). Um clone limpo não constrói sem que você
> preencha as duas chaves — foi assim que o job `build` do CI reprovou na sua
> primeira execução.

## Banco de dados

O schema vive versionado em `database/migrations/`, hoje `001` a `024`, e a ordem
importa — **`001` sozinho deixa o banco aberto**, é o `002` que liga a RLS.
`001_baseline.sql` é **gerado** por `pg_dump`; não edite à mão.

**O deploy publica código, não schema.** Não existe runner de migration neste
projeto: subir um PR para a Vercel não aplica nada no banco. Migration nova é um
passo manual, colada no SQL Editor do Supabase a partir do bundle de
`database/validation/` — que o CI mantém em sincronia com as migrations
(`node scripts/gen-validation-bundle.mjs --check`).

Detalhes de cada arquivo, a ordem completa e as armadilhas conhecidas estão em
**[`database/README.md`](database/README.md)**.

## Testes

Cálculo financeiro é testado dos dois lados. A aritmética em TypeScript roda com
o runner nativo do Node sobre o JS compilado:

```bash
npm run test:lancamento      # sinal, categoria, campos obrigatórios
npm run test:grupos          # rateio e acerto de grupo
npm run test:card-invoice    # fatura de cartão
npm run test:dinheiro        # máscara de valor (R$ 1.000,00 -> 1000)
npm run test:contas          # o corte entre Contas e Cartões
# ...~50 suítes no total; veja os scripts `test:*` do package.json
```

E as regras que moram no banco — RLS, triggers, invariantes de dinheiro — rodam
em Postgres de verdade, em `database/tests/`, dentro do workflow `db-verify`.

```bash
npm run type-check     # tsc --noEmit
npm run lint           # hoje 142 warnings, nenhum erro
```

## CI

Onze workflows no GitHub Actions. O primeiro nasceu com a HMO-119:

| workflow | prova |
| --- | --- |
| `build` | `next build`, `tsc --noEmit` e o **build da imagem Docker** |
| `db-verify` | o schema sobe do zero e a RLS isola um usuário do outro |
| `code-schema-drift` | todo `.from("tabela")` do código existe no schema |
| `color-tokens` | nenhuma cor fixa fora dos tokens, contraste AA nos dois temas |
| `pwa-assets` | todo asset declarado existe e é o que diz ser |
| `lancamento`, `contas`, `dinheiro`, `configuracoes`, `menu-mobile` | as regras e a árvore de cada tela |
| `env-preview` | o preview da Vercel não escreve no banco de produção |

Quase todos rodam **sem filtro de `paths`**, de propósito: o `db-verify` é
filtrado e foi assim que três suítes deste repositório ficaram paradas em verde.

Vários deles carregam **controle negativo** — um passo que planta o defeito e
exige que a verificação reprove. Verificação que nunca viu vermelho não é
verificação.

## Deploy

Vercel, a partir da `main`. Duas coisas que este projeto aprendeu doendo:

- **Squash merge.** Merge commit não dispara o deploy de produção.
- A Vercel **não builda commit de autor não verificado** — o build nem começa, e
  o squash pelo GitHub resolve porque atribui o commit ao dono do repositório.
- As variáveis vivem no painel da Vercel (Project Settings → Environment
  Variables). Um `.env.production` local **não chega** ao build de lá.

Os crons (`/api/cron/*`) rodam pelo Vercel Cron, autenticados por `CRON_SECRET`.
No plano Hobby o horário tem tolerância de ±59 min, então a ordem entre dois
jobs do mesmo dia não é garantida.

## Docker

```bash
docker build -t pulodogato .
docker run -p 3000:3000 pulodogato
```

A imagem é multi-stage e o estágio final copia `.next/standalone`, que só existe
porque `next.config.js` tem `output: "standalone"`. O job `docker` do CI existe
para pegar justamente isso: tirar essa chave não quebra `next build` nem o `tsc`,
só o `COPY` da imagem.

## Documentação

`docs/` tem a PRD, a especificação da API, as decisões de arquitetura e os guias
de cada área (offline, PWA, grupos, contas previstas, deploy). O guia de
governança da PRD (`docs/PRD-Governance.md`) descreve como mudá-la.

> Um aviso sobre `docs/`: documento que se declara **FINAL** costuma ser o menos
> confiável da pasta. Este repositório já teve um `STATUS_FINAL` anunciando
> pronto uma pendência que o guia ao lado listava como aberta.
