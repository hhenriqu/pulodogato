#!/usr/bin/env node
// Mutantes da migration 051 (a restauracao do grupo arquivado) -- HMO-203.
//
// POR QUE ISTO EXISTE
// -------------------
// `051_restauracao_do_grupo_arquivado_test.sql` passa com 27 assercoes verdes.
// Isso, sozinho, nao diz nada -- e nesta migration menos do que nas outras,
// porque a 051 existe por causa de uma escrita que SAIU COMO SUCESSO SEM
// ACONTECER. Em producao, o `UPDATE` do grupo era filtrado pela RLS: HTTP 200,
// zero linha, nenhum erro, e a rota respondendo "Grupo restaurado com sucesso!".
// Um teste que apenas chamasse a funcao e lesse `is_active = true` ficaria verde
// em varios mundos errados -- entre eles o mundo em que a funcao nao confere
// nada e apenas DIZ que restaurou.
//
// Cada mutante abaixo afrouxa UMA decisao da 051; o teste tem que ficar vermelho
// em todos.
//
// AS DUAS FAMILIAS QUE ESTE RUNNER SEPARA
// ---------------------------------------
// 1. **AUTORIZACAO** (quem restaura). O miolo da issue e `status IN
//    ('active','archived')`: arquivar rebaixa o proprio admin para 'archived', e
//    o estado parcial o deixa em 'active'. Trocar aquele IN por qualquer um dos
//    dois valores sozinho reabre o poco de um dos lados -- e so UM dos lados
//    aparece no caso "normal" do teste, por isso as SECOES 2 e 5 existem as
//    duas.
// 2. **CONFERENCIA** (a funcao mediu ou descreveu?). `conferencia_de_leitura` e
//    `resposta_montada_em_vez_de_lida` sao a propria HMO-203 reescrita em SQL.
//    Quem os mata e a SECAO 6c do teste, que engole a escrita na linha do grupo
//    com um trigger `RETURN NULL` -- o mecanismo e outro (em prod era a RLS), o
//    sintoma e identico.
//
// A PROVA DE QUE O TESTE NAO VIVE DE CARONA NO BLOCO DE PROVA
// -----------------------------------------------------------
// A 051 termina num bloco `DO $$` que confere DEFINER, search_path e os GRANTs.
// Isso faz alguns mutantes morrerem na COLAGEM da migration, antes de o teste
// rodar -- o que esta certo (e para isso que o bloco existe) mas nao mede o
// teste. Por isso cada um desses tem um PAR que tambem apaga a conferencia
// correspondente do bloco de prova: `security_invoker` morre na prova,
// `security_invoker_sem_prova` tem de morrer no TESTE. Se o segundo sobreviver,
// o arquivo de teste esta se apoiando na migration para medir a migration.
//
// OS MUTANTES DELIBERADAMENTE DEIXADOS DE FORA
// ---------------------------------------------
// `sem_lock_for_update` (tirar o `FOR UPDATE` do SELECT do grupo) nao entra, e
// nao e esquecimento: ele SOBREVIVERIA, e sobreviver estaria certo. O que o
// `FOR UPDATE` protege e o clique duplo -- duas requisicoes concorrentes --, e
// um arquivo `.sql` roda numa transacao so, com uma sessao so. Nao ha como
// fabricar a corrida ali. Mutante sobrevivente que esta certo polui o placar e
// ensina a nao ler o placar; a protecao fica registrada no comentario da
// migration, onde ela pode ser lida, em vez de num numero que nao significa
// nada.
//
// Trocar `NOW()` por `clock_timestamp()` nos UPDATEs tambem fica de fora: dentro
// de UMA transacao os dois gravam valor valido e nao-nulo, nenhuma assercao
// distingue, e a diferenca nao e observavel por quem usa o app.
//
// A FONTE NUNCA E MUTADA NO DISCO
// -------------------------------
// A mutacao e feita em memoria e escrita num arquivo TEMPORARIO; o
// `database/migrations/051_*.sql` nao e tocado em momento nenhum. O jeito usual
// (mutar o arquivo, rodar, restaurar no `finally`) deixa a fonte mutada no disco
// quando o processo morre no meio -- e o placar seguinte vira ficcao.
//
// COMO RODAR
//   1. Monte o banco-template com a cadeia ATE A 050 (SEM a 051) -- a mesma
//      sequencia de `$PSQL -f` do .github/workflows/db-verify.yml, parando
//      antes da 051. O template NAO pode conter a 051: ela e
//      `CREATE OR REPLACE FUNCTION`, entao aplicar um mutante sobre um banco que
//      ja tem a versao boa funciona -- mas um template montado errado faria todo
//      mutante "morrer" sem nada ter sido medido. Quem denuncia isso e o
//      controle negativo.
//   2. PG_TEMPLATE=<nome do template> npm run mutantes:restauracao-do-grupo

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const PG = process.env.PG_URL_BASE ?? "postgresql://postgres:postgres@127.0.0.1:5432";
const TEMPLATE = process.env.PG_TEMPLATE ?? "hmo203_pre051";
const MIGRATION = "database/migrations/051_restauracao_do_grupo_arquivado.sql";
const TESTE = "database/tests/051_restauracao_do_grupo_arquivado_test.sql";

const psql = (db, args) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", "-q", `${PG}/${db}`, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? "postgres" },
  });

const original = readFileSync(MIGRATION, "utf8");

// ---------------------------------------------------------------------------
// Os trechos exatos da 051 que os mutantes trocam.
// ---------------------------------------------------------------------------
// Cada anchor abaixo tem de aparecer UMA vez no arquivo. O cabecalho da 051
// repete varias dessas frases em COMENTARIO (e o estilo deste repositorio
// explicar a decisao em prosa antes de a escrever), entao anchor curto casaria
// com o comentario e o mutante mutaria a explicacao em vez do codigo. Daí as
// ancoras serem multi-linha e incluirem a pontuacao do SQL. O laco confere a
// contagem antes de rodar qualquer coisa.

const CABECALHO_DA_FUNCAO = `LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$`;

const AUTORIZACAO = `  SELECT gm.role INTO v_role
  FROM public.group_members gm
  WHERE gm.group_id = p_group_id
    AND gm.user_id = auth.uid()
    AND gm.status IN ('active', 'archived');`;

const GUARDA_DE_PAPEL = `  IF v_role <> 'admin' THEN
    RAISE EXCEPTION 'apenas administradores podem restaurar grupos'
      USING ERRCODE = '42501';
  END IF;`;

const GUARDA_DE_JA_ATIVO = `  IF v_was.is_active THEN
    RAISE EXCEPTION 'este grupo ja esta ativo' USING ERRCODE = 'PDG01';
  END IF;`;

const UPDATE_DO_GRUPO = `  UPDATE public.expense_groups
     SET is_active   = TRUE,
         archived_at = NULL,
         archived_by = NULL,
         restored_at = NOW(),
         restored_by = auth.uid(),
         updated_at  = NOW()
   WHERE id = p_group_id;`;

const UPDATE_DOS_MEMBROS = `  UPDATE public.group_members
     SET status      = 'active',
         archived_at = NULL,
         restored_at = NOW(),
         updated_at  = NOW()
   WHERE group_id = p_group_id
     AND status = 'archived';`;

const CONFERENCIA_DE_LEITURA = `  IF v_now.is_active IS NOT TRUE OR v_now.restored_at IS NULL THEN
    RAISE EXCEPTION 'a restauracao do grupo % nao ficou gravada (is_active=%, restored_at=%)',
      p_group_id, v_now.is_active, v_now.restored_at
      USING ERRCODE = 'data_exception';
  END IF;`;

const CONFERENCIA_DE_INVARIANTE = `  IF v_sobrou > 0 THEN
    RAISE EXCEPTION 'grupo % ficaria ativo com % membro(s) ainda arquivado(s)',
      p_group_id, v_sobrou
      USING ERRCODE = 'data_exception';
  END IF;`;

const RETORNO = `  RETURN QUERY SELECT v_now.id, v_now.name, v_now.is_active, v_now.restored_at, v_members;`;

const GRANT = `GRANT EXECUTE ON FUNCTION public.restore_archived_group(UUID) TO authenticated;`;

// Os pedacos do BLOCO DE PROVA, usados pelos pares `*_sem_prova`.
const PROVA_DE_DEFINER = `  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid = v_oid AND prosecdef) THEN
    problemas := problemas || E'\\n  - restore_archived_group ficou SECURITY INVOKER; tem que ser DEFINER, senao a RLS filtra o UPDATE de novo';
  END IF;`;

const PROVA_DE_GRANT = `  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    problemas := problemas || E'\\n  - authenticated nao tem EXECUTE em restore_archived_group(uuid); nenhum usuario do app restauraria';
  END IF;`;

const PROVA_DE_ANON = `  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    problemas := problemas || E'\\n  - anon ficou com EXECUTE em restore_archived_group(uuid)';
  END IF;`;

const CABECALHO_INVOKER = `LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$`;

const MUTANTES = [
  // -------------------------------------------------------------------------
  // Familia 1: AUTORIZACAO
  // -------------------------------------------------------------------------
  {
    nome: "autorizacao_exige_active",
    porque:
      "E A HMO-203 DE VOLTA, INTEIRA. Exigir `status = 'active'` reproduz o criterio de `is_group_admin()` -- e arquivar o grupo poe o PROPRIO admin em 'archived'. Ninguem restaura, e a funcao vira um jeito novo de nao restaurar. Quem o mata e a SECAO 2, com o admin arquivado pela fixture do mesmo jeito que a rota arquiva",
    de: AUTORIZACAO,
    para: AUTORIZACAO.replace("IN ('active', 'archived')", "= 'active'"),
  },
  {
    nome: "autorizacao_exige_archived",
    porque:
      "o outro lado, que passa despercebido porque o caso 'normal' nao o ve: exigir 'archived' e o que o PRE-CHECK DA ROTA ANTIGA fazia (`.eq(\"status\",\"archived\")`), e deixa travado para sempre o grupo que JA caiu no estado parcial -- grupo inativo com admin 'active', que e o estado que a propria rota antiga produzia em producao. Quem o mata e a SECAO 5",
    de: AUTORIZACAO,
    para: AUTORIZACAO.replace("IN ('active', 'archived')", "= 'archived'"),
  },
  {
    nome: "autorizacao_aceita_qualquer_status",
    porque:
      "afrouxar para 'qualquer linha de membro serve' deixa o EX-MEMBRO ('removed') desarquivar o grupo -- quem foi tirado do grupo reabre o grupo para reentrar nele. Mede o outro sentido do IN: o criterio nao e 'tem linha', e 'esta dentro'",
    de: AUTORIZACAO,
    para: AUTORIZACAO.replace(
      "IN ('active', 'archived')",
      "IN ('active', 'archived', 'removed', 'inactive', 'pending')",
    ),
  },
  {
    nome: "sem_guarda_de_papel",
    porque:
      "sem ela QUALQUER membro do grupo restaura. Arquivar e decisao de admin (a rota de DELETE exige isso); desarquivar sem ser admin desfaz a decisao de quem a tomou",
    de: GUARDA_DE_PAPEL,
    para: "  -- guarda de papel removida pelo mutante",
  },
  {
    nome: "papel_invertido",
    porque:
      "`<>` -> `=`: a guarda fica de cabeca para baixo, recusando exatamente o admin e liberando exatamente quem nao pode. Passa em qualquer teste que so conte 'houve erro' -- e e por isso que a SECAO 7 exige o SQLSTATE e a SECAO 2 exige o caminho do admin FUNCIONANDO",
    de: GUARDA_DE_PAPEL,
    para: GUARDA_DE_PAPEL.replace("v_role <> 'admin'", "v_role = 'admin'"),
  },
  {
    nome: "sem_guarda_de_ja_ativo",
    porque:
      "restaurar um grupo que ja esta ativo passaria a reescrever `restored_at`/`restored_by` e a LIMPAR `archived_at` de um grupo que nunca foi arquivado. A rota perde o 400 'ja esta ativo' e o botao vira um no-op que mexe em colunas",
    de: GUARDA_DE_JA_ATIVO,
    para: "  -- guarda de grupo ja ativo removida pelo mutante",
  },

  // -------------------------------------------------------------------------
  // Familia 2: AS DUAS ESCRITAS
  // -------------------------------------------------------------------------
  {
    nome: "so_restaura_o_grupo",
    porque:
      "sem o UPDATE dos membros o grupo volta a `is_active = true` com TODOS os participantes em 'archived': ele sai da lista de arquivados (que exige membro 'archived') e entra na lista ativa vazio, sem ninguem dentro. Quem o mata e a conferencia de invariante -- e se ela tambem for removida, o par `so_restaura_o_grupo` + `sem_conferencia_de_invariante` deixaria de ser pego, razao de os dois estarem na lista",
    de: UPDATE_DOS_MEMBROS,
    para: "  -- UPDATE dos membros removido pelo mutante",
  },
  {
    nome: "so_restaura_os_membros",
    porque:
      "o espelho: os membros voltam a 'active' e o grupo fica `is_active = false`. E EXATAMENTE o estado parcial que a rota antiga produzia em producao, e o que torna o grupo inalcancavel pelas duas telas enquanto `invite` aceita convidar para ele",
    de: UPDATE_DO_GRUPO,
    para: "  -- UPDATE do grupo removido pelo mutante",
  },
  {
    nome: "membros_de_todo_grupo",
    porque:
      "tirar o filtro `group_id = p_group_id` do UPDATE dos membros desarquiva membro de grupo ALHEIO -- restaurar um grupo reativaria a participacao de pessoas em todos os outros grupos arquivados do banco. O `WHERE status = 'archived'` sozinho nao recorta nada",
    de: UPDATE_DOS_MEMBROS,
    para: UPDATE_DOS_MEMBROS.replace(
      "   WHERE group_id = p_group_id\n     AND status = 'archived';",
      "   WHERE status = 'archived';",
    ),
  },
  {
    nome: "nao_limpa_archived_at_do_grupo",
    porque:
      "o grupo volta a `is_active = true` com `archived_at` preenchido, e passa a aparecer nas DUAS listas ao mesmo tempo: na ativa por `is_active`, na de arquivados por `archived_at IS NOT NULL`. Um mesmo grupo em dois lugares, com dois botoes contraditorios",
    de: UPDATE_DO_GRUPO,
    para: UPDATE_DO_GRUPO.replace("         archived_at = NULL,\n", ""),
  },
  {
    nome: "nao_grava_quem_restaurou",
    porque:
      "`restored_by = NULL` apaga a autoria da restauracao -- a unica coluna que diz quem desfez o arquivamento de um grupo com historico financeiro dentro. Nao muda nada visivel na hora, e e justamente por isso que uma assercao tem de cobrir",
    de: UPDATE_DO_GRUPO,
    para: UPDATE_DO_GRUPO.replace("restored_by = auth.uid()", "restored_by = NULL"),
  },
  {
    nome: "membros_voltam_pendentes",
    porque:
      "`status = 'pending'` no lugar de 'active': o grupo volta e os membros ficam esperando aprovacao que ninguem pediu. A tela do grupo filtra 'active' para o controle de acesso, entao o grupo reabre sem participantes e com uma fila de pedidos falsos",
    de: UPDATE_DOS_MEMBROS,
    para: UPDATE_DOS_MEMBROS.replace("SET status      = 'active',", "SET status      = 'pending',"),
  },

  // -------------------------------------------------------------------------
  // Familia 3: CONFERENCIA -- a propria HMO-203
  // -------------------------------------------------------------------------
  {
    nome: "sem_conferencia_de_leitura",
    porque:
      "A HMO-203 EM SQL. Sem ler a linha de volta, uma escrita que nao pega sai como sucesso -- que e literalmente o bug medido em producao (RLS filtrando, HTTP 200, zero linha). Quem o mata e a SECAO 6c, que engole o UPDATE do grupo com um trigger RETURN NULL: mecanismo diferente, sintoma identico",
    de: CONFERENCIA_DE_LEITURA,
    para: "  -- conferencia de leitura removida pelo mutante",
  },
  {
    nome: "resposta_montada_em_vez_de_lida",
    porque:
      "a rota antiga exibia um `restored_at` montado com `new Date().toISOString()` -- DESCREVIA a escrita em vez de medir. Este mutante porta aquilo para dentro do banco: devolve TRUE e NOW() literais, sem olhar a linha. Com ele, 'restaurado com sucesso' volta a ser uma frase e nao uma medida",
    de: RETORNO,
    para: "  RETURN QUERY SELECT p_group_id, v_was.name, TRUE, NOW(), v_members;",
  },
  {
    nome: "sem_conferencia_de_invariante",
    porque:
      "sem ela o grupo pode ficar ativo com membro arquivado -- o estado que nenhuma tela mostra certo. E o invariante que o item 4 da issue pede por escrito",
    de: CONFERENCIA_DE_INVARIANTE,
    para: "  -- conferencia de invariante removida pelo mutante",
  },
  {
    nome: "invariante_com_limiar_alto",
    porque:
      "`> 0` -> `> 99`: a conferencia continua no arquivo, continua parecendo uma trava, e nao pega nenhum caso real -- grupo tem punhado de membros, nunca cem. E o mutante que uma assercao de PRESENCA ('a funcao confere o invariante') deixaria passar",
    de: CONFERENCIA_DE_INVARIANTE,
    para: CONFERENCIA_DE_INVARIANTE.replace("v_sobrou > 0", "v_sobrou > 99"),
  },
  {
    nome: "leitura_so_do_is_active",
    porque:
      "tirar `OR v_now.restored_at IS NULL` deixa passar o caso em que o grupo ficou ativo mas a MARCA da restauracao nao gravou -- um trigger ou um DEFAULT que limpe aquela coluna, e a rota devolve `restored_at` nulo dizendo que restaurou. Mede que a conferencia olha as duas pontas da escrita, nao so a mais visivel",
    de: CONFERENCIA_DE_LEITURA,
    para: CONFERENCIA_DE_LEITURA.replace(
      "IF v_now.is_active IS NOT TRUE OR v_now.restored_at IS NULL THEN",
      "IF v_now.is_active IS NOT TRUE THEN",
    ),
  },

  // -------------------------------------------------------------------------
  // Familia 4: DEFINER e ACL -- e os pares que provam que o TESTE os mata
  // -------------------------------------------------------------------------
  {
    nome: "security_invoker",
    porque:
      "INVOKER faz o corpo cair na mesma policy `USING (is_group_admin(id))` que trava o admin arquivado: o UPDATE volta a nao afetar linha -- agora em silencio, dentro do corpo. MORRE NO BLOCO DE PROVA da propria 051, que e para isso que ele existe; o par abaixo e que mede o teste",
    de: CABECALHO_DA_FUNCAO,
    para: CABECALHO_INVOKER,
  },
  {
    nome: "security_invoker_sem_prova",
    porque:
      "o mesmo INVOKER, agora com a conferencia do bloco de prova apagada tambem -- a migration cola limpa e o TESTE tem de reprovar sozinho. Se este sobreviver, o arquivo de teste esta se apoiando na migration para medir a migration, e o `security_invoker` acima era morte de carona",
    de: CABECALHO_DA_FUNCAO,
    para: CABECALHO_INVOKER,
    tambem: [{ de: PROVA_DE_DEFINER, para: "  -- conferencia de DEFINER removida pelo mutante" }],
  },
  {
    nome: "sem_grant_para_authenticated",
    porque:
      "sem o GRANT a funcao existe e NENHUM usuario do app a executa: todo mundo recebe 42501 -- o MESMO SQLSTATE que a funcao usa para 'nao e admin'. A tela diria 'apenas administradores podem restaurar' para o admin. MORRE NO BLOCO DE PROVA; o par abaixo mede o teste",
    de: GRANT,
    para: "-- GRANT removido pelo mutante",
  },
  {
    nome: "sem_grant_para_authenticated_sem_prova",
    porque:
      "o mesmo GRANT ausente, com a conferencia do bloco de prova apagada. Quem tem de matar e a SECAO 8 do teste (has_function_privilege) e, antes dela, a SECAO 2 -- a chamada do admin reprovando com 42501 em vez de restaurar",
    de: GRANT,
    para: "-- GRANT removido pelo mutante",
    tambem: [{ de: PROVA_DE_GRANT, para: "  -- conferencia de GRANT removida pelo mutante" }],
  },
  {
    nome: "grant_para_anon",
    porque:
      "expor uma funcao SECURITY DEFINER a `anon` nao e exploravel hoje (auth.uid() e NULL e ela levanta 28000), e e exatamente o tipo de concessao que para de ser inofensiva quando alguem mexe no criterio de autorizacao depois. MORRE NO BLOCO DE PROVA; o par abaixo mede o teste",
    de: GRANT,
    para: `GRANT EXECUTE ON FUNCTION public.restore_archived_group(UUID) TO authenticated, anon;`,
  },
  {
    nome: "grant_para_anon_sem_prova",
    porque:
      "o mesmo GRANT para anon, com a conferencia do bloco de prova apagada: quem mata e a SECAO 8 do teste. Sem ela, o REVOKE/GRANT da 051 nao teria medida nenhuma fora do proprio arquivo que o escreve",
    de: GRANT,
    para: `GRANT EXECUTE ON FUNCTION public.restore_archived_group(UUID) TO authenticated, anon;`,
    tambem: [{ de: PROVA_DE_ANON, para: "  -- conferencia de anon removida pelo mutante" }],
  },
  {
    nome: "sem_guarda_de_sessao",
    porque:
      "sem o `auth.uid() IS NULL` a chamada sem identidade (cron, service_role, psql) cai na autorizacao com `user_id = NULL`, nao acha linha, e responde 'nao encontrado ou acesso negado' -- um P0002 onde devia haver 28000. A rota traduziria 'voce nao esta logado' em 'esse grupo nao existe'",
    de: `  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'nao autenticado' USING ERRCODE = '28000';
  END IF;`,
    para: "  -- guarda de sessao removida pelo mutante",
  },
];

let falhou = false;

function rodar(dir, db, sql) {
  psql("postgres", ["-c", `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`]);
  psql("postgres", ["-c", `CREATE DATABASE ${db} TEMPLATE ${TEMPLATE}`]);
  try {
    if (sql !== null) {
      const arquivo = join(dir, `${db}.sql`);
      writeFileSync(arquivo, sql);
      psql(db, ["-f", arquivo]);
    }
    psql(db, ["-f", TESTE]);
    return { verde: true };
  } catch (e) {
    return {
      verde: false,
      saida: String(e.stderr ?? e.message).trim().split("\n").slice(-2).join(" | "),
    };
  } finally {
    try {
      psql("postgres", ["-c", `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`]);
    } catch {
      /* o banco ja pode ter falhado ao nascer; nao e o que esta sendo medido */
    }
  }
}

const dir = mkdtempSync(join(tmpdir(), "mutantes-hmo203-"));

try {
  // CONTROLE NEGATIVO. Sem a 051, o teste tem de REPROVAR. Ele e o que detecta
  // o template montado com a migration dentro -- o erro que faz todo mutante
  // "morrer" sem que nada tenha sido medido.
  const negativo = rodar(dir, "hmo203_mut_negativo", null);
  if (negativo.verde) {
    console.error("CONTROLE NEGATIVO FALHOU: o teste da 051 passa num banco SEM a 051 aplicada.");
    console.error(
      `O template '${TEMPLATE}' provavelmente ja contem a 051 (ou o teste nao mede nada). Placar abaixo nao vale.`,
    );
    falhou = true;
  } else {
    console.log("controle negativo: sem a 051 o teste reprova  OK");
  }

  // CONTROLE POSITIVO. E o unico controle que pega erro de script no proprio
  // caminho da mutacao: com ele vermelho, todo mutante "morre" de graca e o
  // placar sai cheio sem ter medido nada.
  const positivo = rodar(dir, "hmo203_mut_controle", original);
  if (!positivo.verde) {
    console.error(`CONTROLE POSITIVO FALHOU: a 051 intacta nao passa no teste -> ${positivo.saida}`);
    console.error("O template esta errado, ou a migration quebrou. Placar nenhum vale, e por isso nao sai nenhum.");
    process.exitCode = 1;
    rmSync(dir, { recursive: true, force: true });
    process.exit(1);
  }
  console.log("controle positivo: a 051 intacta passa no teste  OK\n");

  let mortos = 0;
  for (const m of MUTANTES) {
    // Mutante que nao se aplica e o pior resultado possivel: ele conta como
    // "morreu" sem nunca ter existido. As duas travas, antes e depois -- e a
    // primeira vale para cada trecho do `tambem` tambem.
    const trocas = [{ de: m.de, para: m.para }, ...(m.tambem ?? [])];
    let mutado = original;
    let aplicou = true;

    for (const t of trocas) {
      const ocorrencias = mutado.split(t.de).length - 1;
      if (ocorrencias !== 1) {
        console.error(
          `NAO APLICOU: ${m.nome} -- o trecho procurado aparece ${ocorrencias}x na 051 (esperado: 1)`,
        );
        falhou = true;
        aplicou = false;
        break;
      }
      mutado = mutado.replace(t.de, t.para);
    }

    if (!aplicou) continue;

    if (mutado === original) {
      console.error(`NAO MUTOU: ${m.nome} -- a substituicao nao mudou o arquivo`);
      falhou = true;
      continue;
    }

    const r = rodar(dir, `hmo203_mut_${m.nome}`, mutado);
    if (r.verde) {
      console.error(`SOBREVIVEU: ${m.nome}`);
      console.error(`            ${m.porque}`);
      falhou = true;
    } else {
      mortos++;
      console.log(`morreu:     ${m.nome}`);
    }
  }

  console.log(`\nSQL: ${mortos}/${MUTANTES.length} mutantes mortos`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exitCode = falhou ? 1 : 0;
