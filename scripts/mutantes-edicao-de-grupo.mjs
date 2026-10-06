#!/usr/bin/env node
// Prova de mutacao da 024 (HMO-176). NAO roda em CI: e ferramenta de quem esta
// escrevendo o teste. Cada entrada estraga UMA decisao da migration; o
// database/tests/024_edicao_de_despesa_de_grupo_test.sql tem que ficar
// VERMELHO em todas. Mutante que sobrevive e uma decisao que nenhuma assercao
// distingue -- ou codigo morto.
//
// Precisa de um Postgres alcancavel. Por padrao usa o local:
//   PGURL=postgresql://postgres:postgres@127.0.0.1:5432 node scripts/mutantes-edicao-de-grupo.mjs
//
// Cada mutante sobe um banco proprio do zero (shim + 001 -> 024 mutada) e o
// derruba no fim. Sao ~15s por mutante.
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.PGURL || "postgresql://postgres:postgres@127.0.0.1:5432";
const ALVO = "database/migrations/024_edicao_de_despesa_de_grupo.sql";
const TESTE = "database/tests/024_edicao_de_despesa_de_grupo_test.sql";
const original = readFileSync(ALVO, "utf8");

const mutantes = [
  // O defeito original, de volta: o corpo inteiro so roda quando ainda nao ha
  // divisao. E a forma exata do bug da HMO-176 -- edicao que nao refaz nada.
  [
    "a edicao volta a nao fazer nada (guard do baseline)",
    "  IF v_mudou_valor THEN\n    PERFORM public.recalcular_partes_pendentes(v_gt);\n  END IF;",
    "  IF FALSE THEN\n    PERFORM public.recalcular_partes_pendentes(v_gt);\n  END IF;",
  ],
  // A segunda metade do bug: a divisao do grupo velho fica onde estava.
  [
    "trocar de grupo deixa a divisao antiga viva",
    "  IF v_mudou_grupo THEN\n    DELETE FROM public.group_transactions gt\n     WHERE gt.transaction_id = p_transaction_id\n       AND (v_alvo IS NULL OR gt.group_id <> v_alvo);\n  END IF;",
    "  IF FALSE THEN\n    DELETE FROM public.group_transactions gt\n     WHERE gt.transaction_id = p_transaction_id\n       AND (v_alvo IS NULL OR gt.group_id <> v_alvo);\n  END IF;",
  ],
  // O DELETE sem condicao: apaga tambem a ligacao que nenhum trigger recria.
  [
    "o DELETE deixa de olhar se o grupo mudou",
    "  IF v_mudou_grupo THEN\n    DELETE FROM public.group_transactions gt",
    "  IF TRUE THEN\n    DELETE FROM public.group_transactions gt",
  ],
  // A trava da opcao (b), nas duas direcoes.
  [
    "parte aprovada deixa de travar a mudanca de valor",
    "  IF v_mudou_valor AND v_alvo IS NOT NULL AND EXISTS (",
    "  IF FALSE AND v_mudou_valor AND v_alvo IS NOT NULL AND EXISTS (",
  ],
  [
    "parte aprovada deixa de travar a troca de grupo",
    "  IF v_mudou_grupo AND EXISTS (",
    "  IF FALSE AND v_mudou_grupo AND EXISTS (",
  ],
  // A trava vira trava de meia porta: recusa o rateio e deixa o valor passar.
  [
    "a trava passa a recusar so o rateio (valor novo, partes velhas)",
    "    RAISE EXCEPTION 'Alguem ja aprovou a parte desta despesa no grupo. Mudar o valor mudaria o que essa pessoa aprovou: estorne e relance, ou peca para reabrir a aprovacao.'\n      USING ERRCODE = 'PDG01';",
    "    RETURN;",
  ],
  // O recorte do recalculo: tudo, em vez de so o pendente.
  [
    "o recalculo passa por cima da parte recusada",
    "    DELETE FROM public.group_expense_splits\n     WHERE group_transaction_id = p_group_transaction_id\n       AND status = 'pending';",
    "    DELETE FROM public.group_expense_splits\n     WHERE group_transaction_id = p_group_transaction_id;",
  ],
  [
    "o reescalonamento do rateio combinado passa por cima do recusado",
    "     WHERE es.group_transaction_id = p_group_transaction_id\n       AND es.status = 'pending';",
    "     WHERE es.group_transaction_id = p_group_transaction_id;",
  ],
  // O achatamento que a 007 tirou, de volta pela edicao.
  [
    "rateio combinado volta a ser achatado em partes iguais",
    "  IF v_split_type = 'equal' THEN",
    "  IF TRUE THEN",
  ],
  // A conta do dinheiro feita a mao, sem o maior resto do 007. Note que NAO
  // adianta mutar o valor de fachada do INSERT: o BEFORE INSERT reescreve
  // aquela coluna, e o mutante nasce no-op. O que distingue a decisao e trocar
  // o caminho inteiro -- reescrever no lugar, com divisao simples.
  [
    "a divisao igual passa a ser feita na mao (perde centavo)",
    "    DELETE FROM public.group_expense_splits\n     WHERE group_transaction_id = p_group_transaction_id\n       AND status = 'pending';",
    "    UPDATE public.group_expense_splits es SET amount = ROUND(v_total / GREATEST((SELECT count(*) FROM public.group_members g2 JOIN public.group_transactions g3 ON g3.group_id = g2.group_id WHERE g3.id = p_group_transaction_id AND g2.status = 'active'), 1), 2) WHERE es.group_transaction_id = p_group_transaction_id AND es.status = 'pending';\n    IF TRUE THEN RETURN 0; END IF;\n    DELETE FROM public.group_expense_splits\n     WHERE group_transaction_id = p_group_transaction_id\n       AND status = 'pending';",
  ],
  // O privilegio: a razao de as duas funcoes serem SECURITY DEFINER.
  [
    "recalcular_partes_pendentes volta a SECURITY INVOKER",
    "RETURNS integer\nLANGUAGE plpgsql\nSECURITY DEFINER",
    "RETURNS integer\nLANGUAGE plpgsql",
  ],
  [
    "refazer_rateio_do_grupo volta a SECURITY INVOKER",
    "RETURNS void\nLANGUAGE plpgsql\nSECURITY DEFINER",
    "RETURNS void\nLANGUAGE plpgsql",
  ],
  // A porta da funcao DEFINER, nas duas trancas.
  [
    "authenticated ganha EXECUTE na funcao",
    "    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) FROM authenticated';",
    "    EXECUTE 'GRANT EXECUTE ON FUNCTION public.refazer_rateio_do_grupo(uuid, uuid, numeric) TO authenticated';",
  ],
  [
    "a checagem de dono some",
    "  IF pg_trigger_depth() = 0 AND auth.uid() IS NOT NULL AND auth.uid() <> v_user_id THEN",
    "  IF FALSE THEN",
  ],
  // O indice que impede a mesma despesa em dois grupos.
  [
    "o indice unico por transacao nao e criado",
    "    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS uniq_group_transactions_transaction ON public.group_transactions (transaction_id)';\n    EXECUTE $c$COMMENT ON INDEX public.uniq_group_transactions_transaction IS 'Uma despesa so pode estar dividida em um grupo. Sem isto, editar o grupo de uma despesa a cobra nos dois (HMO-176).'$c$;",
    "    PERFORM 1;",
  ],
  // O gemeo que ficaria divergindo em silencio.
  [
    "o gemeo trigger_sync_transaction_group continua vivo",
    "DROP TRIGGER IF EXISTS trigger_sync_transaction_group ON public.financial_transactions;\nDROP FUNCTION IF EXISTS public.sync_transaction_with_group();",
    "",
  ],
  // O recorte de "o que e despesa de grupo".
  [
    "receita no grupo passa a ser dividida",
    "  v_alvo        := CASE WHEN v_group_id        IS NOT NULL AND v_amount       < 0 THEN v_group_id        END;",
    "  v_alvo        := v_group_id;",
  ],
];

const psql = (url, args) =>
  execFileSync("psql", ["-q", "-v", "ON_ERROR_STOP=1", url, ...args], {
    stdio: "pipe",
    encoding: "utf8",
  });

const migrations = readdirSync("database/migrations")
  .filter((f) => /^0\d\d_/.test(f) && !f.startsWith("000_"))
  .sort();

let sobreviventes = 0;

for (const [nome, de, para] of mutantes) {
  if (!original.includes(de)) {
    console.log(`?? ${nome}: o trecho procurado nao existe mais no arquivo`);
    sobreviventes++;
    continue;
  }

  const banco = `mut_${Math.random().toString(36).slice(2, 10)}`;
  const dir = mkdtempSync(join(tmpdir(), "mut-024-"));
  const mutado = join(dir, "024.sql");
  writeFileSync(mutado, original.replace(de, para));

  let vermelho = false;
  let detalhe = "";

  try {
    psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${banco}`]);
    const url = `${BASE}/${banco}`;
    psql(url, ["-f", "database/tests/00_supabase_shim.sql"]);

    for (const m of migrations) {
      if (m.startsWith("024_")) continue;
      psql(url, ["-f", `database/migrations/${m}`]);
    }

    // A propria migration mutada pode nao aplicar -- isso tambem e "vermelho",
    // mas por outro motivo, e vale distinguir no relatorio.
    try {
      psql(url, ["-f", mutado]);
    } catch {
      vermelho = true;
      detalhe = "a migration mutada nem aplica";
    }

    if (!vermelho) {
      try {
        psql(url, ["-f", TESTE]);
      } catch (e) {
        vermelho = true;
        detalhe = String(e.stderr || "")
          .split("\n")
          .find((l) => l.includes("FALHA") || l.includes("ERROR")) || "teste falhou";
      }
    }
  } finally {
    try {
      psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`]);
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  }

  if (vermelho) {
    console.log(`ok   ${nome} -> ${detalhe.trim().slice(0, 120)}`);
  } else {
    console.log(`VIVO ${nome} -- nenhuma assercao distingue isto`);
    sobreviventes++;
  }
}

console.log(
  sobreviventes === 0
    ? `\nTodos os ${mutantes.length} mutantes morreram.`
    : `\n${sobreviventes} de ${mutantes.length} mutantes SOBREVIVERAM.`
);
process.exit(sobreviventes === 0 ? 0 : 1);
