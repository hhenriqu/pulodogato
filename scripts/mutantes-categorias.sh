#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# CONTROLE NEGATIVO DA HMO-216
# ---------------------------------------------------------------------------
# `hmo216_categorias_do_usuario_test.sql` passa. Isso, sozinho, nao diz nada:
# um teste que nunca reprova e indistinguivel de um teste que nao roda.
#
# Este script desfaz, uma por vez, cada decisao load-bearing da 036 e exige que
# o teste REPROVE. Um mutante "SOBREVIVEU" e um pedaco da migration que nenhuma
# assercao protege -- ou seja, algo que a proxima pessoa pode remover por
# "simplificacao" sem que o CI diga uma palavra.
#
# Cada mutante e SQL aplicado a um banco clonado do estado "036 aplicada", e
# cada um corresponde a uma simplificacao plausivel, nao a um estrago aleatorio:
#
#   policy_larga   -> "por que `user_id IS NULL` aqui? a policy do 002 nao
#                      tinha" -- o vazamento que a 036 existe para fechar
#   insert_larga   -> "o WITH CHECK e redundante, a rota ja manda o user certo"
#   update_larga   -> "deixar mover para o catalogo nao machuca ninguem"
#   trigger_global -> "`NEW.user_id` ou NULL, da no mesmo, o Outros e generico"
#   sem_trigger    -> "a rota ja cria o Outros, o trigger e redundante"
#   sem_backfill   -> "banco novo nasce certo pelo trigger"
#   fk_simples     -> "FK composta e exotica; uma FK em subcategory_id basta"
#   unique_global  -> "a unique do 001 ja garantia nome unico"
#
# Uso (com PGHOST/PGUSER/PGPASSWORD apontando para um Postgres 17):
#   BANCO_BASE=pdg216 bash scripts/mutantes-categorias.sh
#
# O banco base tem de estar no estado "cadeia completa + 036". O script nunca
# escreve nele: cada mutante roda num clone `TEMPLATE`, que e descartado.
# ---------------------------------------------------------------------------
set -uo pipefail

BASE="${BANCO_BASE:-pdg216}"
TESTE="database/tests/hmo216_categorias_do_usuario_test.sql"
PSQL="psql -v ON_ERROR_STOP=1 --no-psqlrc -q"

# Primeiro o CONTROLE POSITIVO: no banco intacto o teste tem de PASSAR. Sem
# isto, um "todos os mutantes morreram" poderia significar apenas que o teste
# reprova sempre -- inclusive sem mutacao.
if ! $PSQL -d "$BASE" -f "$TESTE" >/dev/null 2>&1; then
  echo "ABORTADO: o teste reprova no banco INTACTO. Nada abaixo significaria nada."
  exit 1
fi
echo "controle positivo: o teste passa no banco intacto"
echo

mutante() {
  local nome="$1" sql="$2"
  local db="${BASE}_mut"

  psql -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1
  if ! psql -q -c "CREATE DATABASE $db TEMPLATE $BASE" >/dev/null 2>&1; then
    echo "  !! nao consegui clonar $BASE (conexao aberta?) -- mutante $nome NAO FOI MEDIDO"
    FALHAS=$((FALHAS + 1))
    return
  fi

  # A mutacao PRECISA aplicar. Um mutante que nao aplica aparece como
  # "sobreviveu" e manda investigar a assercao certa pelo motivo errado.
  if ! $PSQL -d "$db" -c "$sql" >/dev/null 2>&1; then
    echo "  !! a mutacao $nome NAO APLICOU -- resultado invalido"
    FALHAS=$((FALHAS + 1))
    psql -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1
    return
  fi

  if $PSQL -d "$db" -f "$TESTE" >/dev/null 2>&1; then
    echo "  SOBREVIVEU  $nome   <-- nenhuma assercao protege isto"
    FALHAS=$((FALHAS + 1))
  else
    local qual
    qual=$($PSQL -d "$db" -f "$TESTE" 2>&1 | grep -oE 'FALHA: [^-]+' | head -1)
    echo "  morreu      $nome   (${qual:-reprovou})"
  fi

  psql -q -c "DROP DATABASE IF EXISTS $db WITH (FORCE)" >/dev/null 2>&1
}

FALHAS=0

mutante policy_larga "
  DROP POLICY transaction_categories_read ON public.transaction_categories;
  CREATE POLICY transaction_categories_read ON public.transaction_categories
    FOR SELECT TO anon, authenticated USING (is_active = TRUE);"

mutante insert_larga "
  DROP POLICY transaction_categories_insert_own ON public.transaction_categories;
  CREATE POLICY transaction_categories_insert_own ON public.transaction_categories
    FOR INSERT TO authenticated WITH CHECK (TRUE);"

mutante update_larga "
  DROP POLICY transaction_categories_update_own ON public.transaction_categories;
  CREATE POLICY transaction_categories_update_own ON public.transaction_categories
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid() OR user_id IS NULL);"

mutante trigger_global "
  CREATE OR REPLACE FUNCTION public.criar_subcategoria_outros()
  RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS \$\$
  BEGIN
    INSERT INTO public.transaction_subcategories (category_id, user_id, name)
    SELECT NEW.id, NULL, 'Outros'
    WHERE NOT EXISTS (
      SELECT 1 FROM public.transaction_subcategories s
       WHERE s.category_id = NEW.id AND s.name = 'Outros');
    RETURN NULL;
  END \$\$;"

mutante sem_trigger "
  DROP TRIGGER criar_subcategoria_outros_trg ON public.transaction_categories;"

mutante sem_backfill "
  DELETE FROM public.transaction_subcategories
   WHERE name = 'Outros' AND user_id IS NULL;"

mutante fk_simples "
  ALTER TABLE public.financial_transactions
    DROP CONSTRAINT financial_transactions_subcategoria_da_categoria;
  ALTER TABLE public.financial_transactions
    ADD CONSTRAINT financial_transactions_subcategoria_da_categoria
    FOREIGN KEY (subcategory_id) REFERENCES public.transaction_subcategories(id);"

mutante unique_global "
  DROP INDEX unique_categoria_do_usuario;
  CREATE UNIQUE INDEX unique_categoria_do_usuario
    ON public.transaction_categories (service_id, name)
    WHERE user_id IS NOT NULL;"

echo
if [ "$FALHAS" -eq 0 ]; then
  echo "todos os mutantes morreram"
else
  echo "$FALHAS mutante(s) sobreviveu/sobreviveram ou nao foram medidos"
  exit 1
fi
