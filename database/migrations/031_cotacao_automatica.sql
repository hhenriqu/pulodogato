-- 031_cotacao_automatica.sql
--
-- HMO-191 (entrega 1 da HMO-141): o cron que para de exigir que o usuario
-- digite o preco do ativo na mao.
--
-- ===========================================================================
-- ESTA MIGRATION NAO CRIA NADA. ELA ABRE UMA PORTA DE UM CHECK.
-- ===========================================================================
-- A entrega inteira cabe em codigo, e isso e deliberado: `current_price` e
-- `current_price_at` existem em `investment_assets` desde a 021, que ja tinha
-- escrito o plano no proprio cabecalho --
--
--   "Quando houver fonte de cotacao, ela passa a escrever nessa mesma coluna e
--    nada mais muda -- o calculo da carteira le a coluna, nao a origem dela."
--
-- Continua valendo. A tabela da carteira nao muda nem uma coluna aqui.
--
-- O QUE PRECISA MUDAR E OUTRA TABELA: `cron_runs`, da 019.
--
-- A 019 fechou o dominio de `cron_runs.job` num CHECK com os quatro jobs que
-- existiam ("o valor errado aqui e sempre typo, nunca dado do usuario"). O
-- quinto job, `cotacoes`, entra em vercel.json nesta mesma entrega -- e sem
-- abrir o CHECK o INSERT do livro-razao toma `23514` e a linha some.
--
-- O SINTOMA DISSO SEM ESTA MIGRATION, PARA QUEM FOR DEPURAR
-- ---------------------------------------------------------
-- O cron FUNCIONA. Ele le a carteira, cota na brapi, grava os precos e devolve
-- 200 -- porque `gravarLinha` em lib/services/cron-ledger.ts nunca lanca, de
-- proposito (o trabalho ja aconteceu; derrubar a resposta por causa do registro
-- seria trocar uma execucao boa nao registrada por uma execucao boa reportada
-- como falha). O unico efeito visivel e `SELECT * FROM cron_runs WHERE job =
-- 'cotacoes'` voltar vazio para sempre.
--
-- Que e precisamente a ausencia-lida-como-falha que a 019 existe para acabar:
-- um cron morto e um cron nao registrado ficam outra vez indistinguiveis. Por
-- isso esta migration acompanha o codigo em vez de ser adiada.
--
-- POR QUE DROP + ADD, E POR QUE ISSO E SEGURO
-- -------------------------------------------
-- A 019 protege o ADD com `IF NOT EXISTS (SELECT 1 FROM pg_constraint ...)`.
-- Esse desenho e re-executavel mas NAO e atualizavel: em producao a constraint
-- ja existe com a lista de quatro, entao o guard pula e o quinto valor nunca
-- entra. Para AMPLIAR o dominio e preciso derrubar e recriar.
--
-- Duas razoes para isso nao repetir o risco da 024 (`DROP CONSTRAINT IF EXISTS`
-- com dependente):
--
--   1. CHECK nao tem dependente. Nenhuma FK, indice ou view se apoia num CHECK,
--      entao o DROP nao pode derrubar nada junto -- ao contrario do UNIQUE da
--      021, onde o mesmo padrao teria arrastado a FK composta.
--
--   2. O dominio novo e um SUPERCONJUNTO do antigo: os quatro valores continuam
--      la e `cotacoes` se soma. O `ADD CONSTRAINT` revalida a tabela inteira, e
--      toda linha ja gravada passa por construcao. Nao ha backfill, nao ha
--      linha para consertar antes, e nao ha janela em que producao recuse algo
--      que aceitava -- que e o defeito que um CHECK mais ESTREITO produziria.
--
-- A janela entre o DROP e o ADD existe, mas esta dentro do BEGIN/COMMIT deste
-- arquivo: quem tentar gravar durante ela fica bloqueado pelo lock da tabela,
-- nao passa sem checagem.
--
-- COMO CONFERIR QUE PEGOU (cole depois de aplicar):
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'public.cron_runs'::regclass AND conname = 'cron_runs_job_check';
--
--   -- tem que listar os CINCO, com 'cotacoes' entre eles.
--
-- Idempotente: pode rodar duas vezes seguidas sem erro.
-- Cola como lote unico no SQL Editor (nenhum meta-comando de psql aqui).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. O dominio de `cron_runs.job` passa a ter cinco valores
-- ---------------------------------------------------------------------------
-- A lista segue sendo o ultimo segmento de cada `crons[].path` do vercel.json,
-- e a mesma lista esta no tipo `CronJob` de lib/services/cron-ledger.ts. Sao
-- tres copias da mesma verdade (vercel.json, TypeScript, CHECK) e nao ha como
-- reduzir para uma -- o que ha e o CHECK, que transforma a divergencia em erro
-- de gravacao em vez de linha orfa sob um nome que ninguem consulta.

ALTER TABLE public.cron_runs
  DROP CONSTRAINT IF EXISTS cron_runs_job_check;

ALTER TABLE public.cron_runs
  ADD CONSTRAINT cron_runs_job_check
  CHECK (job IN (
    'recurrence-scan',
    'recurrence-alerts',
    'bill-alerts',
    'monthly-summary',
    'cotacoes'
  ));

-- ---------------------------------------------------------------------------
-- 2. O comentario da coluna `current_price` deixa de mentir
-- ---------------------------------------------------------------------------
-- A 021 escreveu, com razao na epoca: "Preco atual informado A MAO pelo usuario
-- (nao ha fonte de cotacao contratada - HMO-141 item 2)". A partir desta
-- entrega ha, e ela e gratuita -- entao o comentario passou a descrever um
-- mundo que nao existe mais.
--
-- Isso nao e cosmetico. `COMMENT ON COLUMN` e o que o proximo agente le quando
-- inspeciona o schema pelo psql sem abrir o repositorio, e um comentario
-- confiante e desatualizado e pior que comentario nenhum: ele encerra a
-- pergunta com a resposta errada.
--
-- O que o comentario NAO passa a dizer: que toda linha tem preco. Nao tem --
-- renda fixa e ativo internacional continuam fora da cotacao automatica (ver
-- lib/cotacao-brapi.ts), e para eles o preco segue vindo da mao do usuario.

COMMENT ON COLUMN public.investment_assets.current_price IS
  'Preco atual do ativo. Desde a HMO-191 o cron /api/cron/cotacoes preenche stock e fii em BRL pela brapi; renda fixa e internacional continuam informados A MAO. NULL = sem preco: a tela mostra a posicao pelo custo e avisa, em vez de fingir lucro zero.';

COMMENT ON COLUMN public.investment_assets.current_price_at IS
  'Quando o preco foi apurado - pelo cron de cotacao ou pela mao do usuario. Anda em par com current_price (CHECK investment_assets_preco_par_check): gravar so um dos dois levanta 23514 e a linha INTEIRA e recusada.';

INSERT INTO public.schema_migrations (version, name, description, executed_at)
VALUES ('031', '031_cotacao_automatica',
        'Abre cron_runs.job para o quinto job (cotacoes) e atualiza o comentario de investment_assets.current_price, que dizia nao haver fonte de cotacao - HMO-191', now())
ON CONFLICT (version) DO NOTHING;

COMMIT;
