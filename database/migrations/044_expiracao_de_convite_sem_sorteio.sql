-- =====================================================
-- HMO-344: a expiracao de convite deixa de depender de sorteio
-- =====================================================
-- O `001_baseline` deixou em `public.group_invitations` um trigger
-- `cleanup_expired_invitations` (AFTER INSERT, FOR EACH ROW) cuja funcao
-- `cleanup_expired_invitations_trigger()` tem o corpo:
--
--     IF random() < 0.1 THEN
--         PERFORM expire_old_invitations();
--     END IF;
--
-- e `expire_old_invitations()` faz `UPDATE group_invitations SET status =
-- 'expired'` em TODA linha `pending` com `expires_at` no passado.
--
-- Ou seja: cada INSERT de convite tinha 10% de chance de varrer a tabela
-- inteira. Duas consequencias, as duas medidas, nenhuma suposta:
--
--   1. TESTE NAO-DETERMINISTICO. Na HMO-197 o mutante SQL `sem_prazo`
--      sobreviveu em 4 de 8 execucoes sobre clones identicos do mesmo banco.
--      A causa era esta varredura: a linha de teste que era `pending` E
--      expirada de proposito virava `expired`, e entao quem a excluia passava
--      a ser o filtro `status = 'pending'` SOZINHO -- o mutante que removia a
--      clausula de prazo virava EQUIVALENTE, nao "furo de assercao". O
--      conserto de la foi local (DISABLE TRIGGER no trecho); a causa ficou.
--
--   2. EM PRODUCAO, A EXPIRACAO ACONTECE EM MOMENTO QUE NENHUMA LEITURA
--      CONTROLA. O `status` de um convite vencido mudava quando alguem
--      inseria um convite qualquer e o dado sorteava menos de 0.1 -- nao
--      quando o convite vencia. Dois leitores do mesmo convite vencido, no
--      mesmo instante, podiam ver `pending` ou `expired` conforme insercoes
--      alheias.
--
-- POR QUE APAGAR E O CONSERTO INTEIRO, SEM BACKFILL
-- -------------------------------------------------
-- Levantamento feito antes de mexer (pre-requisito da issue): NINGUEM le
-- `group_invitations.status = 'expired'`. E todo leitor de `status =
-- 'pending'` ja carrega o filtro de PRAZO ao lado dele:
--
--   * `list_my_group_invitations()`   (030) -- status='pending' AND expires_at > NOW()
--   * `respond_to_group_invitation()` (030) -- status='pending' AND expires_at > NOW()
--   * `has_pending_invitation()`      (002) -- status='pending' AND (expires_at IS NULL OR expires_at > NOW())
--   * `reclamar_convites_orfaos()`    (039) -- status='pending' AND expires_at > NOW()
--   * `app/api/expense-groups/invite/route.ts` -- .eq("status","pending").gt("expires_at", now)
--
-- Entao um convite vencido fica de fora PELO PRAZO, esteja o `status` como
-- estiver. A correcao de leitura ja estava de pe sem o trigger: o trigger nao
-- sustentava nenhuma leitura, so embaralhava o rotulo.
--
-- Nao ha backfill. As linhas que ja estao carimbadas `expired` em producao
-- continuam `expired`, e isso e inofensivo: elas so foram carimbadas porque
-- `expires_at` ja estava no passado, entao os leitores acima as excluem pelo
-- prazo exatamente como antes. O valor 'expired' TAMBEM CONTINUA LEGAL no
-- CHECK da coluna, de proposito -- tirar o valor do CHECK exigiria reescrever
-- linha historica, e nada ganha com isso.
--
-- E `expire_old_invitations()` TAMBEM SAI, por dois motivos
-- -------------------------------------------------------
-- Primeiro, o trigger era o unico chamador dela em todo o repositorio.
--
-- Segundo, e isto foi achado ao conferir o catalogo e nao estava na issue:
-- ela e `SECURITY DEFINER` e nasceu no baseline SEM REVOKE, entao herdou o
-- padrao do Postgres (EXECUTE para PUBLIC). Medido no catalogo:
--
--     has_function_privilege('anon',         'public.expire_old_invitations()','EXECUTE') -> true
--     has_function_privilege('authenticated','public.expire_old_invitations()','EXECUTE') -> true
--
-- Era um UPDATE de tabela inteira, que ignora RLS, alcancavel por `anon`. O
-- estrago possivel era limitado (ela so carimba `expired` em linha JA vencida,
-- e nenhuma leitura usa o rotulo), mas e uma primitiva de escrita anonima sem
-- nenhum chamador legitimo. Apagar fecha isso de graca.
--
-- Se algum dia o rotulo persistido voltar a ser necessario, o lugar dele e um
-- passo AGENDADO (o repo ja tem cron), nunca um sorteio dentro de trigger.
--
-- Aditiva no sentido que importa: nao cria nem remove coluna, nao mexe em
-- linha, e o codigo que esta em producao hoje nao chama nada do que sai aqui.
-- Aplicar com a `main` velha e inofensivo.
--
-- Idempotente: pode colar duas vezes.
-- =====================================================

BEGIN;

-- Primeiro o trigger, depois a funcao dele: na ordem inversa o DROP FUNCTION
-- falharia por dependencia (e com `CASCADE` apagaria o trigger calado, o que
-- esconderia justamente o que esta sendo apagado).
DROP TRIGGER IF EXISTS cleanup_expired_invitations ON public.group_invitations;

DROP FUNCTION IF EXISTS public.cleanup_expired_invitations_trigger();

-- Sem CASCADE de proposito: se alguem tiver criado um chamador novo desde a
-- leitura do catalogo, o DROP falha e a migration aborta, em vez de levar o
-- chamador embora em silencio.
DROP FUNCTION IF EXISTS public.expire_old_invitations();

COMMENT ON TABLE public.group_invitations IS
  'Convite de grupo. HMO-344: nao ha mais trigger que carimbe status = ''expired'' '
  '(o `cleanup_expired_invitations` do 001 fazia isso sob `random() < 0.1`, em '
  'momento que nenhuma leitura controlava). Um convite vencido continua `pending` '
  'para sempre, e QUEM LE E RESPONSAVEL PELO PRAZO: filtre sempre '
  '`expires_at > NOW()` junto com `status = ''pending''`, nunca o status sozinho. '
  'Linhas historicas carimbadas `expired` seguem validas e tambem estao vencidas.';

COMMIT;
