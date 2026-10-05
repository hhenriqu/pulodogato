-- =====================================================
-- 042: o rateio do trigger passa a honrar o percentual do membro
-- =====================================================
-- HMO-304 (filha da HMO-302, §4.2). SO SCHEMA: nenhum TypeScript, nenhuma tela.
--
-- O DEFEITO
-- ---------
-- A mesma conta vale um numero enquanto esta PREVISTA e outro depois de PAGA.
-- Num grupo 70/30, uma despesa de R$ 1.000:
--
--     previsto   (painel, tela de Despesas, fechamento do mes)   R$ 300,00
--        | a pessoa da baixa na conta
--     realizado  (group_expense_splits -> group_share_entries)   R$ 500,00
--
-- Medido na cadeia 001..041 deste repositorio, com `percentage` 70/30 gravada
-- em `group_members` e uma despesa de -1000,00 com `group_id`:
--
--     split_type | full_name | pct_config | pct_gravado | valor_gravado
--     -----------+-----------+------------+-------------+--------------
--     equal      | A-70      |      70.00 |       50.00 |        500.00
--     equal      | B-30      |      30.00 |       50.00 |        500.00
--
-- A causa esta na SECAO 2c de `refazer_rateio_do_grupo` (024): ela insere a
-- ligacao com `split_type = 'equal'` fixo e as partes com `percentage = 100,
-- amount = 0` de fachada. O BEFORE INSERT `calculate_equal_split` (007) ve
-- `'equal'`, divide IGUAL em centavos inteiros e sobrescreve as duas colunas.
-- A `percentage` configurada nunca e lida por ninguem.
--
-- A HMO-269/270/271 NAO consertou isto, ao contrario do que o comentario de
-- `parteDoMembro` (lib/parte-do-grupo.ts:39-48) supunha: ela mudou
-- `ratearPorPeso` e o FECHAMENTO do mes, que sao o lado PREVISTO. Conferido
-- migration por migration -- 037, 038, 039, 041 e a 040 em voo nao tocam em
-- `split_type`, `calculate_equal_split`, `recalcular_partes_pendentes` nem
-- `refazer_rateio_do_grupo`.
--
-- O QUE MUDA
-- ----------
-- Só a SECAO 2c de `refazer_rateio_do_grupo`. Quando o grupo tem divisao
-- configurada, a ligacao nasce `split_type = 'percentage'` e as partes nascem
-- com o percentual normalizado e o valor em centavos inteiros. O
-- `calculate_equal_split` entao devolve as linhas INTACTAS, porque ele ja sai
-- fora quando `split_type <> 'equal'` (007:449) -- e por isso esta migration
-- nao precisa toca-lo.
--
-- O ramo ELSE de `recalcular_partes_pendentes` tambem nao muda: ele ja reescala
-- pela porcentagem gravada, que agora e a de verdade. Ver o LIMITE CONHECIDO
-- no fim deste cabecalho.
--
-- O QUE O TRIGGER FAZ QUANDO A SOMA NAO FECHA 100 -- A DECISAO
-- ------------------------------------------------------------
-- A issue pede que esta escolha seja explicita, porque as duas funcoes do app
-- tem defeito OPOSTO aqui. A decisao: `percentage` e PESO, e o rateio divide
-- pela SOMA dos pesos -- nao por 100.
--
-- Com 70/27 gravado (soma 97), R$ 1.000 sai 721,65 / 278,35, e a soma e o
-- valor INTEIRO da despesa. A alternativa -- tratar 70 como "70 de 100" e
-- deixar 3% sem dono -- deixaria o saldo do grupo nao fechando em zero, que e
-- o invariante que `group_member_balances` existe para manter.
--
-- Isto NAO e uma invencao desta migration: e a aritmetica que
-- `ratearPorPeso` (lib/fechamento-do-grupo.ts:244) ja usa em producao desde a
-- HMO-270, e e justamente ela que decide o lado PREVISTO. Escolher qualquer
-- outra coisa aqui manteria previsto e realizado discordando -- que e o
-- defeito que esta issue existe para fechar. A regra em uma frase: o trigger
-- rateia pela MESMA conta que o fechamento do mes.
--
-- O DEGRAU DO 0/0: GRUPO LEGADO CONTINUA DIVIDINDO IGUAL
-- ------------------------------------------------------
-- `group_members.percentage` e `numeric(5,2) DEFAULT 0.00` e NULLABLE
-- (001:1215). Grupo que nunca passou pela tela de divisao tem a coluna 0.00
-- (o default) ou NULL -- nos dois casos a soma dos pesos e ZERO, e nao existe
-- proporcao a respeitar.
--
-- Nesse caso a ligacao nasce `split_type = 'equal'` e as partes de fachada,
-- EXATAMENTE como hoje: quem faz a conta continua sendo o
-- `calculate_equal_split`. Isto e deliberado e nao e preguica -- aquela funcao
-- e a aritmetica de divisao igual que esta em producao, tem teste e tem
-- mutante proprios. Reimplementar a divisao igual aqui criaria um SEGUNDO
-- caminho capaz de divergir do primeiro, e o `ratearPorPeso` toma a mesma
-- decisao pelo mesmo motivo ("O DEGRAU DO 0/0", linha 230).
--
-- Consequencia pratica: para todo grupo que nao configurou divisao -- que e
-- todo grupo de hoje, menos os que passaram pela tela da HMO-271 -- esta
-- migration nao muda UM CENTAVO.
--
-- O MEMBRO COM PESO ZERO ENTRE PESOS POSITIVOS
-- --------------------------------------------
-- Num grupo 100/0 o membro de peso zero deve R$ 0,00 -- e o que `ratearPorPeso`
-- da, e e o que "eu nao divido esta conta" significa. Mas
-- `group_expense_splits_percentage_check` (001:1165) exige `percentage > 0`:
-- gravar 0,00 na coluna de DISPLAY derrubaria o INSERT inteiro, e com ele o
-- lancamento.
--
-- Entao a `percentage` sai com piso de 0,01 e o `amount` sai 0,00. O dinheiro
-- esta certo e a coluna de display e uma aproximacao -- que e a mesma escolha
-- que o 007 ja registrou na propria funcao ("A porcentagem vira DISPLAY (...)
-- Quem manda e o valor", 007:496-501), onde o `GREATEST(..., 0.01)` cobre o
-- grupo com mais de 10 mil membros. A linha CONTINUA existindo, com o valor
-- certo, em vez de o membro desaparecer do rateio.
--
-- O DESEMPATE DO CENTAVO QUE SOBRA
-- --------------------------------
-- Maior resto, e o empate vai para o menor `group_members.id` -- a mesma ordem
-- do `calculate_equal_split` (007:476, `ORDER BY gm.id`), para que o caminho
-- igual e o caminho por peso desempatem igual. `ratearPorPeso` desempata pela
-- ORDEM em que o chamador passou os participantes, que nao e observavel daqui;
-- quando dois restos empatam, previsto e realizado podem portanto diferir UM
-- CENTAVO de lugar (nunca no total, que fecha nos dois). Registrado aqui porque
-- e o unico desvio que sobra entre as duas contas.
--
-- POR QUE NAO HA BACKFILL
-- -----------------------
-- Despesa que JA existe fica com a divisao com que nasceu. Reescrever o rateio
-- do historico mudaria o valor de partes que alguem JA APROVOU -- que e
-- exatamente o que as duas travas PDG01 da 024 (linhas 300-322) existem para
-- impedir, e nao ha razao para esta migration fazer pela porta de tras o que a
-- edicao de despesa recusa pela porta da frente. A mudanca vale da proxima
-- despesa em diante.
--
-- Pelo mesmo motivo nao ha ALTER na coluna nem CHECK novo: nenhuma linha
-- existente passa a violar nada, e a migration e reexecutavel (so
-- CREATE OR REPLACE FUNCTION).
--
-- O QUE MUDA DE COMPORTAMENTO E A ISSUE NAO NOMEOU
-- ------------------------------------------------
-- Na tela do grupo existe um seletor "Tipo de Divisão" que default para
-- `equal`. Quando a pessoa deixa esse default, a rota
-- `app/api/expense-groups/[groupId]/transactions/route.ts` grava a despesa COM
-- `group_id` e delega o rateio ao trigger (`partes === null`, linha 273).
-- Num grupo que TEM divisao configurada, essa despesa passa a sair 70/30 em vez
-- de 50/50.
--
-- Isso e o pedido da issue aplicado onde ele importa -- o fechamento do mes ja
-- cobra 70/30 e nao olha esse seletor --, mas vale dito: nao ha mais, por este
-- caminho, como pedir "divisao igual nesta despesa" num grupo 70/30. A divisao
-- COMBINADA da tela (`custom_splits`) continua intacta: ela nasce sem
-- `group_id`, cria a propria ligacao e so depois preenche a coluna (HMO-190),
-- entao a SECAO 2c nem roda para ela.
--
-- LIMITE CONHECIDO, FORA DO ESCOPO DESTA MIGRATION
-- ------------------------------------------------
-- Ao EDITAR o valor de uma despesa, o ramo ELSE de
-- `recalcular_partes_pendentes` reescala cada parte com
-- `ROUND(v_total * es.percentage / 100, 2)`, linha por linha e sem maior resto.
-- Com percentual que nao tem representacao exata em duas casas (os 72,16% de
-- um 70/27), a soma das partes pode ficar um centavo longe do total. Isso ja
-- valia para todo rateio `percentage`/`custom` antes desta migration, e mexer
-- nessa funcao reescreveria assercoes do teste da 024 que provam o caminho
-- igual. Fica registrado, nao consertado.
--
-- MEDIDO: 13 MUTANTES, 11 MORTOS, E OS DOIS SOBREVIVENTES SAO EQUIVALENTES
-- -------------------------------------------------------------------------
-- Com controle positivo (a 042 intacta passa) e controle negativo (sem a 042 o
-- teste reprova na primeira assercao). Os dois que sobreviveram sobreviveram
-- por serem a MESMA funcao escrita de outro jeito, e nao por falta de
-- assercao -- medido no Postgres 17.11:
--
--   * tirar o `COALESCE` da SOMA dos pesos. `SUM` ja ignora NULL, e com todas
--     as linhas NULL ele devolve NULL -- e `IF NULL > 0 THEN` cai no ramo
--     falso, o mesmo lugar onde `0 > 0` cai. O COALESCE fica porque faz do
--     zero uma DECISAO, em vez de depender de NULL ser falsy num IF;
--   * tirar o `ROUND` de `ROUND(ABS(v_amount) * 100)::bigint`. O cast de
--     numeric para bigint JA arredonda (100000.5 -> 100001), e `amount` e
--     `numeric(15,2)`, entao `ABS(amount) * 100` nunca tem casa decimal para
--     arredondar. O ROUND fica por ser a forma exata que o 007 usa na mesma
--     conta -- duas aritmeticas de centavo que se comparam devem se PARECER.
--
-- Rodar depois de 001 -> ... -> 041.
-- =====================================================

-- ---------------------------------------------------------------------------
-- refazer_rateio_do_grupo() -- igual a 024, com a SECAO 2c nova
-- ---------------------------------------------------------------------------
-- Reproduzida INTEIRA de proposito: `CREATE OR REPLACE FUNCTION` substitui o
-- corpo todo, entao copiar so o trecho novo apagaria as travas PDG01 e a
-- checagem de dono. As secoes 1, 2a, 2b e 2d sao byte a byte as da 024 -- o que
-- muda esta marcado com "HMO-304".
CREATE OR REPLACE FUNCTION public.refazer_rateio_do_grupo(
  p_transaction_id uuid,
  p_group_id_antigo uuid DEFAULT NULL,
  p_valor_antigo numeric DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_group_id uuid;
  v_amount NUMERIC;
  v_alvo uuid;
  v_alvo_antigo uuid;
  v_mudou_grupo BOOLEAN;
  v_mudou_valor BOOLEAN;
  v_gt uuid;
  -- HMO-304: o peso do grupo e o total em centavos inteiros.
  v_soma_pesos BIGINT;
  v_total_cents BIGINT;
BEGIN
  SELECT ft.user_id, ft.group_id, ft.amount
    INTO v_user_id, v_group_id, v_amount
    FROM public.financial_transactions ft
   WHERE ft.id = p_transaction_id;

  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  -- Chamada DIRETA (fora de trigger) por alguem que nao e o dono da despesa
  -- nao passa. Dentro de trigger a checagem nao se repete, e isso e
  -- deliberado: para o trigger disparar, o comando em financial_transactions
  -- ja passou pela RLS daquela tabela, que so deixa o dono escrever. Repetir a
  -- checagem ali quebraria toda escrita feita com um claim que nao e o do dono
  -- -- o backfill de uma migration, uma manutencao por psql numa sessao que
  -- ainda tem `request.jwt.claim.sub` de outra pessoa -- com um erro que nao
  -- tem nada a ver com o que a pessoa estava fazendo.
  IF pg_trigger_depth() = 0 AND auth.uid() IS NOT NULL AND auth.uid() <> v_user_id THEN
    RAISE EXCEPTION 'so o dono do lancamento pode refazer o rateio dele'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Divisao de grupo existe para DESPESA lancada num grupo. Receita no grupo
  -- nao e alguem pagando a conta do restaurante (a view do 007 ja faz essa
  -- distincao para o "pago"), e valor zero nao tem o que dividir.
  v_alvo        := CASE WHEN v_group_id        IS NOT NULL AND v_amount       < 0 THEN v_group_id        END;
  v_alvo_antigo := CASE WHEN p_group_id_antigo IS NOT NULL AND p_valor_antigo < 0 THEN p_group_id_antigo END;

  v_mudou_grupo := v_alvo IS DISTINCT FROM v_alvo_antigo;
  v_mudou_valor := p_valor_antigo IS NOT NULL AND p_valor_antigo IS DISTINCT FROM v_amount;

  -- ------------------------------------------------------------------
  -- 2a. As duas travas da opcao (b), ANTES de qualquer escrita
  -- ------------------------------------------------------------------
  IF v_mudou_grupo AND EXISTS (
       SELECT 1
         FROM public.group_expense_splits es
         JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
        WHERE gt.transaction_id = p_transaction_id
          AND (v_alvo IS NULL OR gt.group_id <> v_alvo)
          AND es.status = 'approved'
     ) THEN
    RAISE EXCEPTION 'Alguem ja aprovou a parte desta despesa no grupo atual. Tirar ela dali apagaria essa aprovacao: estorne e relance, ou peca para reabrir a aprovacao.'
      USING ERRCODE = 'PDG01';
  END IF;

  IF v_mudou_valor AND v_alvo IS NOT NULL AND EXISTS (
       SELECT 1
         FROM public.group_expense_splits es
         JOIN public.group_transactions gt ON gt.id = es.group_transaction_id
        WHERE gt.transaction_id = p_transaction_id
          AND gt.group_id = v_alvo
          AND es.status = 'approved'
     ) THEN
    RAISE EXCEPTION 'Alguem ja aprovou a parte desta despesa no grupo. Mudar o valor mudaria o que essa pessoa aprovou: estorne e relance, ou peca para reabrir a aprovacao.'
      USING ERRCODE = 'PDG01';
  END IF;

  -- ------------------------------------------------------------------
  -- 2b. Tirar a despesa dos grupos onde ela nao esta mais
  -- ------------------------------------------------------------------
  -- Condicionado a v_mudou_grupo de proposito. Sem isso, uma edicao de
  -- descricao apagaria a ligacao de uma despesa POSITIVA de grupo -- que a
  -- rota da tela de grupo cria pela rede de seguranca dela, e que nenhum
  -- trigger recriaria depois.
  IF v_mudou_grupo THEN
    DELETE FROM public.group_transactions gt
     WHERE gt.transaction_id = p_transaction_id
       AND (v_alvo IS NULL OR gt.group_id <> v_alvo);
  END IF;

  IF v_alvo IS NULL THEN
    RETURN;
  END IF;

  SELECT gt.id INTO v_gt
    FROM public.group_transactions gt
   WHERE gt.transaction_id = p_transaction_id
     AND gt.group_id = v_alvo;

  -- ------------------------------------------------------------------
  -- 2c. Grupo novo (ou despesa nova): cria a ligacao e as partes
  -- ------------------------------------------------------------------
  IF v_gt IS NULL THEN
    -- HMO-304: o peso do grupo decide QUAL dos dois caminhos abaixo roda.
    -- COALESCE porque a coluna e NULLABLE, e em centesimos (`* 100`) para a
    -- aritmetica do rateio ser inteira de ponta a ponta -- `numeric(5,2)`
    -- permite 33,33, e `33.33 * total / soma` em NUMERIC arredondaria no meio
    -- do caminho. Escalar os DOIS lados da divisao por 100 nao muda o
    -- resultado.
    SELECT COALESCE(SUM(ROUND(COALESCE(gm.percentage, 0) * 100)::bigint), 0)
      INTO v_soma_pesos
      FROM public.group_members gm
     WHERE gm.group_id = v_alvo
       AND gm.status = 'active';

    IF v_soma_pesos > 0 THEN
      -- CAMINHO NOVO: o grupo configurou divisao. A ligacao diz 'percentage',
      -- e por isso o `calculate_equal_split` (BEFORE INSERT) devolve cada
      -- linha abaixo INTACTA em vez de achatar para partes iguais.
      INSERT INTO public.group_transactions (group_id, transaction_id, split_type, created_by)
      VALUES (v_alvo, p_transaction_id, 'percentage', v_user_id)
      RETURNING id INTO v_gt;

      v_total_cents := ROUND(ABS(v_amount) * 100)::bigint;

      -- Maior resto, em centavos inteiros, com desempate por `gm.id`. O
      -- `base * soma` no resto (em vez de dividir antes) e a mesma forma de
      -- `ratearPorPeso`: com peso inteiro ela e exata por construcao.
      INSERT INTO public.group_expense_splits
        (group_transaction_id, member_id, percentage, amount, status)
      WITH ativos AS (
        SELECT gm.id AS member_id,
               ROUND(COALESCE(gm.percentage, 0) * 100)::bigint AS peso
          FROM public.group_members gm
         WHERE gm.group_id = v_alvo
           AND gm.status = 'active'
      ),
      bruto AS (
        SELECT a.member_id,
               a.peso,
               (v_total_cents * a.peso) / v_soma_pesos AS base_cents,
               (v_total_cents * a.peso) - ((v_total_cents * a.peso) / v_soma_pesos) * v_soma_pesos AS resto
          FROM ativos a
      ),
      com_ordem AS (
        SELECT b.*,
               row_number() OVER (ORDER BY b.resto DESC, b.member_id) AS ordem,
               v_total_cents - SUM(b.base_cents) OVER () AS sobra
          FROM bruto b
      )
      SELECT v_gt,
             c.member_id,
             -- DISPLAY, com piso de 0,01: o CHECK da coluna exige > 0 e o
             -- membro de peso zero deve R$ 0,00 (ver o cabecalho).
             LEAST(GREATEST(ROUND(c.peso * 100.0 / v_soma_pesos, 2), 0.01), 100),
             (c.base_cents + CASE WHEN c.ordem <= c.sobra THEN 1 ELSE 0 END)::numeric / 100,
             'pending'
        FROM com_ordem c;

      RETURN;
    END IF;

    -- CAMINHO DE SEMPRE: soma dos pesos ZERO -- grupo legado, ou grupo que
    -- nunca passou pela tela de divisao. `split_type = 'equal'` e as partes de
    -- fachada, para o `calculate_equal_split` fazer a conta em centavos. Nao
    -- muda um centavo do que a 024 fazia.
    INSERT INTO public.group_transactions (group_id, transaction_id, split_type, created_by)
    VALUES (v_alvo, p_transaction_id, 'equal', v_user_id)
    RETURNING id INTO v_gt;

    INSERT INTO public.group_expense_splits
      (group_transaction_id, member_id, percentage, amount, status)
    SELECT v_gt, gm.id, 100, 0, 'pending'
      FROM public.group_members gm
     WHERE gm.group_id = v_alvo
       AND gm.status = 'active';

    RETURN;
  END IF;

  -- ------------------------------------------------------------------
  -- 2d. Mesmo grupo, valor novo: refaz as partes pendentes
  -- ------------------------------------------------------------------
  IF v_mudou_valor THEN
    PERFORM public.recalcular_partes_pendentes(v_gt);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) IS
  'Poe a divisao de uma despesa em dia com o grupo e o valor atuais dela: cria, move, apaga e recalcula. A divisao nova sai pelo PESO de group_members.percentage (split_type percentage), e cai em divisao igual quando a soma dos pesos e zero. Falha com SQLSTATE PDG01 quando a edicao precisaria apagar ou reescrever uma parte ja aprovada.';

-- A 024 revogou o EXECUTE desta funcao de PUBLIC, anon e authenticated.
-- `CREATE OR REPLACE FUNCTION` PRESERVA os privilegios de uma funcao que ja
-- existe, entao as revogacoes continuam valendo -- mas repetimos aqui para o
-- banco onde esta migration encontre a funcao ausente (e aonde o REPLACE viria
-- a ser um CREATE, com os defaults do projeto Supabase de volta).
REVOKE EXECUTE ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) FROM authenticated';
  END IF;
END $$;

-- A premissa que esta migration tem de poder assumir: o
-- `calculate_equal_split` sai fora quando `split_type <> 'equal'`. Se um dia
-- ele deixar de fazer isso, as partes por peso gravadas acima voltam a ser
-- achatadas para iguais -- em silencio, e so o dinheiro acusaria. NOTICE, e
-- nao EXCEPTION: o mesmo tom da sonda da 025 sobre o calculate_split_amount.
DO $$
BEGIN
  IF to_regprocedure('public.calculate_equal_split()') IS NULL THEN
    RAISE NOTICE '042: calculate_equal_split nao existe -- reler a nota do topo';
  ELSIF NOT EXISTS (
    SELECT 1 FROM pg_proc
     WHERE oid = to_regprocedure('public.calculate_equal_split()')
       AND prosrc LIKE '%<> ''equal''%'
  ) THEN
    RAISE NOTICE '042: calculate_equal_split nao sai mais fora no rateio combinado -- reler a nota do topo';
  END IF;
END $$;
