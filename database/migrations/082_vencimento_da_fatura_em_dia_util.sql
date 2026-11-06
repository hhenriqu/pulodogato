-- ===========================================================================
-- 082 -- A FATURA VENCE EM DIA UTIL
-- ===========================================================================
-- O pedido (Helio, 06/11/2026, comparando com o app Minhas Financas): no
-- Minhas Financas o cartao C6 que vence dia 20 aparece com "20/NOV" riscado e
-- "23/NOV" no lugar. 20/11/2026 e sexta-feira e feriado (Consciencia Negra),
-- 21 e 22 sao fim de semana. Em dezembro o mesmo cartao vence 21/12, porque
-- 19/12 e sabado. No Pulo do Gato a fatura ficava prevista para o dia 20: um
-- dia em que banco nenhum cobra, e a conta a pagar aparecia "vencida" no
-- sabado e no domingo seguintes sem estar.
--
-- A regra (a mesma do banco e do Minhas Financas): quando o dia do vencimento
-- cai em sabado, domingo ou feriado bancario nacional, a fatura vence no
-- PROXIMO dia util. So o vencimento anda; o fechamento nao muda, e a compra
-- continua na mesma fatura.
--
-- E UMA OPCAO DO CARTAO, LIGADA POR PADRAO
-- ----------------------------------------
-- No Minhas Financas isso e o interruptor "Vencimento em dias uteis" do
-- cadastro do cartao, marcado em cartao novo. Os cartoes do Helio la mostram os
-- dois casos: o C6 Helio (marcado) vai de 20/11 para 23/11; o C6 Leticia e o
-- BRB (desmarcados) ficam em 20/11 e 15/11. Aqui e a coluna
-- `financial_accounts.vencimento_em_dia_util`, DEFAULT true.
--
-- ONDE A DATA NASCE
-- -----------------
-- Toda data de vencimento de fatura do app sai da view `card_invoice_lines`
-- (061) ou da RPC `card_invoice_due_date` (`lib/services/cobranca-no-cartao.ts`).
-- O fechamento (`POST /api/card-invoices/close`), a agenda, o previsto e o
-- "quanto posso gastar" leem `invoice_due_date` da view. Entao basta: uma
-- funcao de QUATRO argumentos (a de tres da 006 fica como esta, e e o dia
-- nominal), a view passando a usa-la, e a RPC idem.
--
-- OS FERIADOS
-- -----------
-- Os nacionais em que nao ha expediente bancario (calendario da FEBRABAN):
--   fixos   01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 20/11, 25/12
--   moveis  segunda e terca de Carnaval (Pascoa - 48 e - 47), Sexta-feira
--           Santa (Pascoa - 2) e Corpus Christi (Pascoa + 60)
-- O 20/11 so entra a partir de 2024 (Lei 14.759/2023). Feriado estadual e
-- municipal fica de fora: o vencimento e o mesmo para quem mora em qualquer
-- cidade, e o app nao sabe onde fica a agencia.
--
-- A Pascoa e calculada (algoritmo de Meeus/Jones/Butcher), e nao tabelada: uma
-- tabela acaba num ano qualquer e o vencimento depois dele voltaria a cair em
-- feriado sem erro nenhum. Por isso as tres funcoes sao IMMUTABLE como a 006.
--
-- O MES DO VENCIMENTO PODE MUDAR
-- ------------------------------
-- Vencimento no dia 31/01/2027 (domingo) vira 01/02/2027. O Resultado conta a
-- fatura no mes do VENCIMENTO (072), e o banco tambem cobra em fevereiro:
-- seguir a data e o certo, e e o que o Minhas Financas faz.
--
-- AS FATURAS JA FECHADAS
-- ----------------------
-- O fechamento grava a data numa conta a pagar (`scheduled_transactions`,
-- notes = 'fatura:AAAA-MM-01:<cartao>'). A SECAO 4 anda para o dia util a que
-- ainda esta pendente e vence de hoje em diante. Paga, pulada e vencida no
-- passado nao mudam: e historico.
--
-- O QUE ESTA MIGRATION FAZ
-- ------------------------
--   SECAO 1  `pascoa(ano)`
--   SECAO 2  `feriado_bancario(data)` e `proximo_dia_util(data)`
--   SECAO 3  a coluna do cartao, `card_invoice_due_date` de quatro argumentos
--            e a view `card_invoice_lines` usando a nova
--   SECAO 4  as faturas fechadas e pendentes andam para o dia util
--   SECAO 5  grants
--
-- O PASSO HUMANO
-- --------------
-- Colar no SQL Editor do Supabase depois do merge, DEPOIS da 081.
-- Re-executavel: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, e a SECAO 4 nao
-- tem efeito na segunda vez.
-- ===========================================================================

-- ===========================================================================
-- SECAO 1: a Pascoa
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.pascoa(p_ano integer)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  a integer := p_ano % 19;
  b integer := p_ano / 100;
  c integer := p_ano % 100;
  d integer := b / 4;
  e integer := b % 4;
  f integer := (b + 8) / 25;
  g integer := (b - f + 1) / 3;
  h integer := (19 * a + b - d - g + 15) % 30;
  i integer := c / 4;
  k integer := c % 4;
  l integer := (32 + 2 * e + 2 * i - h - k) % 7;
  m integer := (a + 11 * h + 22 * l) / 451;
  mes integer := (h + l - 7 * m + 114) / 31;
  dia integer := ((h + l - 7 * m + 114) % 31) + 1;
BEGIN
  IF p_ano IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN make_date(p_ano, mes, dia);
END;
$$;

COMMENT ON FUNCTION public.pascoa(integer) IS
  'Domingo de Pascoa do ano (calendario gregoriano). Base dos feriados moveis.';

-- ===========================================================================
-- SECAO 2: feriado bancario e proximo dia util
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.feriado_bancario(p_data date)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE WHEN p_data IS NULL THEN NULL ELSE
    to_char(p_data, 'MM-DD') IN (
      '01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25'
    )
    OR (to_char(p_data, 'MM-DD') = '11-20'
        AND EXTRACT(YEAR FROM p_data) >= 2024)
    OR p_data IN (
      public.pascoa(EXTRACT(YEAR FROM p_data)::integer) - 48,  -- segunda de Carnaval
      public.pascoa(EXTRACT(YEAR FROM p_data)::integer) - 47,  -- terca de Carnaval
      public.pascoa(EXTRACT(YEAR FROM p_data)::integer) - 2,   -- Sexta-feira Santa
      public.pascoa(EXTRACT(YEAR FROM p_data)::integer) + 60   -- Corpus Christi
    )
  END;
$$;

COMMENT ON FUNCTION public.feriado_bancario(date) IS
  'Feriado nacional sem expediente bancario (fixos, Carnaval, Sexta-feira Santa, Corpus Christi).';

-- O laco termina: nao ha mais de quatro dias seguidos sem expediente no
-- calendario acima (Carnaval cai de segunda a terca; o pior caso e sexta
-- feriado + fim de semana + segunda feriado). O teto de 10 e so uma trava.
CREATE OR REPLACE FUNCTION public.proximo_dia_util(p_data date)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  d date := p_data;
  passos integer := 0;
BEGIN
  IF d IS NULL THEN
    RETURN NULL;
  END IF;
  WHILE (EXTRACT(ISODOW FROM d) IN (6, 7) OR public.feriado_bancario(d))
        AND passos < 10 LOOP
    d := d + 1;
    passos := passos + 1;
  END LOOP;
  RETURN d;
END;
$$;

COMMENT ON FUNCTION public.proximo_dia_util(date) IS
  'A propria data se for dia util; senao, o proximo dia sem fim de semana nem feriado bancario.';

-- ===========================================================================
-- SECAO 3: a opcao do cartao e o vencimento que a respeita
-- ===========================================================================
-- `financial_accounts.vencimento_em_dia_util`: liga por padrao, como no
-- Minhas Financas (cartao novo nasce com "Vencimento em dias uteis" marcado).
-- O DEFAULT preenche os cartoes que ja existem, e e de proposito: e o que o
-- banco faz, e quem tem um cartao que cobra no feriado desmarca na edicao.
-- Fora do cartao a coluna nao tem efeito nenhum.
ALTER TABLE public.financial_accounts
  ADD COLUMN IF NOT EXISTS vencimento_em_dia_util boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.financial_accounts.vencimento_em_dia_util IS
  '082: cartao. TRUE = quando o dia do vencimento cai em fim de semana ou feriado bancario, a fatura vence no proximo dia util.';

-- A funcao da 006 (tres argumentos) NAO muda: ela continua sendo o dia
-- nominal, e e o que a tela mostra riscado quando o vencimento anda. A de
-- quatro argumentos e a que a view e a cobranca no cartao usam.
--
-- Por que uma assinatura nova, e nao um quarto parametro com DEFAULT na
-- antiga: com DEFAULT as duas assinaturas aceitariam a chamada de tres
-- argumentos e o Postgres recusaria a chamada por ambiguidade.
CREATE OR REPLACE FUNCTION public.card_invoice_due_date(
  p_invoice_month date,
  p_closing_day integer,
  p_due_day integer,
  p_em_dia_util boolean
) RETURNS date
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE WHEN p_em_dia_util IS DISTINCT FROM false
              THEN public.proximo_dia_util(
                     public.card_invoice_due_date(p_invoice_month, p_closing_day, p_due_day))
              ELSE public.card_invoice_due_date(p_invoice_month, p_closing_day, p_due_day)
         END;
$$;

COMMENT ON FUNCTION public.card_invoice_due_date(date, integer, integer, boolean) IS
  '082: o vencimento da fatura, levado ao proximo dia util quando o cartao pede (p_em_dia_util). NULL quando o cartao nao tem due_day.';

-- A view da 061, com UMA diferenca: `invoice_due_date` passa pela funcao de
-- quatro argumentos. Mesmas colunas, mesma ordem, mesmo WHERE -- o REPLACE
-- so troca a expressao. O `security_invoker` e reafirmado no fim (o REPLACE
-- apaga a opcao, ver a 061).
CREATE OR REPLACE VIEW public.card_invoice_lines AS
  SELECT
    t.id                AS transaction_id,
    t.user_id,
    t.account_id,
    a.name              AS account_name,
    a.closing_day,
    a.due_day,
    t.category_id,
    t.description,
    t.amount,
    (-t.amount) AS invoice_amount,
    t.transaction_date,
    t.transaction_type,
    t.group_id,
    COALESCE(t.invoice_month_override,
             public.card_invoice_month(t.transaction_date, a.closing_day)) AS invoice_month,
    public.card_invoice_due_date(
      COALESCE(t.invoice_month_override,
               public.card_invoice_month(t.transaction_date, a.closing_day)),
      a.closing_day, a.due_day, a.vencimento_em_dia_util)        AS invoice_due_date,
    t.installment_number,
    t.installment_total,
    t.include_in_total
  FROM public.financial_transactions t
  JOIN public.financial_accounts a ON a.id = t.account_id
  WHERE a.account_type = 'credit_card'
    AND t.transaction_type IN ('expense', 'income');

COMMENT ON VIEW public.card_invoice_lines IS
  'Lancamentos de cartao com o mes e o vencimento da fatura em que caem (respeitando invoice_month_override, 041; vencimento no dia util quando o cartao pede, 082), o rotulo de parcela (035) e o include_in_total da linha (061). O include_in_total e PUBLICADO e nao FILTRADO: o total da fatura soma a linha desmarcada, porque a fatura do app tem de bater com a do banco.';

-- ===========================================================================
-- SECAO 4: as faturas fechadas que ainda vao vencer
-- ===========================================================================
-- So a conta a pagar de FATURA (a chave canonica de lib/chave-da-fatura.ts),
-- pendente, com vencimento de hoje em diante, de cartao com a opcao ligada.
-- Nada mais se mexe.
UPDATE public.scheduled_transactions s
   SET due_date = public.proximo_dia_util(s.due_date)
  FROM public.financial_accounts a
 WHERE s.status = 'pending'
   AND s.due_date >= current_date
   AND s.notes ~ '^fatura:\d{4}-\d{2}-\d{2}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   AND a.id::text = lower(substring(s.notes FROM 19))
   AND a.vencimento_em_dia_util
   AND s.due_date <> public.proximo_dia_util(s.due_date);

-- ===========================================================================
-- SECAO 5: grants
-- ===========================================================================
-- As tres sao funcoes de calendario, sem dado de ninguem. O mesmo recorte da
-- 006: so `authenticated` executa.
REVOKE EXECUTE ON FUNCTION public.pascoa(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pascoa(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.pascoa(integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.feriado_bancario(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.feriado_bancario(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.feriado_bancario(date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.proximo_dia_util(date) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.proximo_dia_util(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.proximo_dia_util(date) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.card_invoice_due_date(date, integer, integer, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.card_invoice_due_date(date, integer, integer, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.card_invoice_due_date(date, integer, integer, boolean) TO authenticated;

REVOKE ALL ON public.card_invoice_lines FROM anon;
GRANT SELECT ON public.card_invoice_lines TO authenticated;

-- ULTIMA instrucao do arquivo, de proposito (ver a 061): sem ela o REPLACE
-- acima abre a fatura de todo mundo.
ALTER VIEW public.card_invoice_lines SET (security_invoker = true);
