#!/usr/bin/env node
// Prova de mutacao da 053 (HMO-369). Cada entrada estraga UMA decisao da
// migration; o database/tests/053_mybank_emprestimo_e_parcelas_test.sql tem de
// ficar VERMELHO em todas. Mutante que sobrevive e uma decisao que nenhuma
// assercao distingue -- ou codigo morto.
//
//   PGURL=postgresql://postgres:postgres@127.0.0.1:5432 node scripts/mutantes-mybank-travas.mjs
//
// O QUE ESTA MEDICAO EXISTE PARA PROVAR
// -------------------------------------
// A 053 e so schema: nenhuma rota, nenhum `lib/`, nenhuma tela. Tudo o que ela
// afirma esta em trava, policy e reloption -- e TRES defeitos desse tipo nao dao
// erro em lugar nenhum quando acontecem:
//
//   * a trava que confere METADE do que diz conferir (a conta e minha, mas nao
//     e de investimento -- ou e de investimento, mas e de outra pessoa);
//   * a policy de UPDATE sem `WITH CHECK`, que o Postgres completa repetindo o
//     `USING` e que por isso PARECE escrita;
//   * a view sem `security_invoker`, que neste banco (dono = `postgres`, que
//     bypassa RLS) devolve exatamente o mesmo resultado no caminho feliz,
//     entao so o catalogo a distingue.
//
// Os tres estao na lista, e cada um e morto por uma assercao diferente.
//
// O MUTANTE 16 NAO E HIPOTETICO
// -----------------------------
// `revoke-sem-from-public` e o defeito que esta migration REALMENTE teve: a
// primeira rodada dela reprovou no proprio posflight com `anon ficou com
// EXECUTE`, porque o Postgres concede EXECUTE a PUBLIC em toda funcao nova e um
// `REVOKE ... FROM anon` nao tira privilegio herdado. Ele esta aqui para o
// conserto nao poder ser desfeito em silencio.
//
// POR QUE UM BANCO-TEMPLATE, E POR QUE ELE PARA NA 052
// ----------------------------------------------------
// A cadeia 001 -> 052 sobe UMA vez num template e cada mutante sai de
// `CREATE DATABASE ... TEMPLATE` -- copia de arquivo no lado do servidor, em vez
// de uma cadeia inteira por mutante.
//
// O template NAO PODE ter a 053: com ela, cada mutante seria um
// `CREATE OR REPLACE FUNCTION` por cima da versao BOA (as tabelas tem
// `IF NOT EXISTS`) e o placar seria ficcao. Aqui isso se mede pela existencia da
// tabela, porque `mybank_loans` nasce NESTA migration -- diferente da 050, onde
// a view ja existia e o template precisou ser medido pela definicao.
//
// "001 -> 052" e uma REGRA sobre o numero (`< ALVO_NUM`), e nao
// `!f.startsWith("053_")`: "tudo menos a 053" incluiria uma 054 futura, cujo
// preflight pode abortar, e o runner morreria antes do primeiro mutante com erro
// de psql em vez de placar.
import { readFileSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const BASE = process.env.PGURL || "postgresql://postgres:postgres@127.0.0.1:5432";
const ALVO = "database/migrations/053_mybank_emprestimo_e_parcelas.sql";
const TESTE = "database/tests/053_mybank_emprestimo_e_parcelas_test.sql";
const TEMPLATE = `tpl_053_${process.pid}`;

const ALVO_NUM = 53;

const original = readFileSync(ALVO, "utf8");

// As ancoras levam a INDENTACAO e a pontuacao colada de proposito: o cabecalho
// desta migration repete os mesmos trechos em prosa, e `String.replace` troca a
// PRIMEIRA ocorrencia. Uma ancora curta demais mutaria o COMENTARIO e deixaria o
// codigo intacto -- o placar diria "sobreviveu" e a culpa cairia nas assercoes.
// O `rodarMutante` recusa ancora ambigua justamente por isso.
const TRAVA_1_CONSULTA =
  "  SELECT EXISTS (\n" +
  "    SELECT 1 FROM public.financial_accounts a\n" +
  "     WHERE a.id = NEW.lender_account_id\n" +
  "       AND a.user_id = NEW.lender_user_id\n" +
  "       AND a.account_type = 'investment'\n" +
  "  ) INTO v_conta_ok;\n";

const TRAVA_2_EXISTS =
  "    IF NOT EXISTS (\n" +
  "      SELECT 1 FROM public.user_connections uc\n" +
  "       WHERE uc.status = 'accepted'\n" +
  "         AND ( (uc.requester_id = NEW.lender_user_id   AND uc.requested_id = NEW.borrower_user_id)\n" +
  "            OR (uc.requested_id = NEW.lender_user_id   AND uc.requester_id = NEW.borrower_user_id) )\n" +
  "    ) THEN\n";

const TRAVA_2_DESVIO = "  IF NEW.borrower_user_id IS DISTINCT FROM NEW.lender_user_id THEN\n";

const JANELA_DO_UPDATE =
  "  IF TG_OP = 'UPDATE'\n" +
  "     AND NEW.lender_user_id    IS NOT DISTINCT FROM OLD.lender_user_id\n" +
  "     AND NEW.lender_account_id IS NOT DISTINCT FROM OLD.lender_account_id\n" +
  "     AND NEW.borrower_user_id  IS NOT DISTINCT FROM OLD.borrower_user_id\n" +
  "  THEN\n" +
  "    RETURN NEW;\n" +
  "  END IF;\n";

const PIN_DO_DEVEDOR =
  "    IF NEW.id                  IS DISTINCT FROM OLD.id\n" +
  "       OR NEW.loan_id             IS DISTINCT FROM OLD.loan_id\n" +
  "       OR NEW.installment_number  IS DISTINCT FROM OLD.installment_number\n" +
  "       OR NEW.installment_total   IS DISTINCT FROM OLD.installment_total\n" +
  "       OR NEW.amount              IS DISTINCT FROM OLD.amount\n" +
  "       OR NEW.due_date            IS DISTINCT FROM OLD.due_date\n" +
  "       OR NEW.paid_date           IS DISTINCT FROM OLD.paid_date\n" +
  "       OR NEW.paid_transaction_id IS DISTINCT FROM OLD.paid_transaction_id\n" +
  "    THEN\n";

const TRANSICAO_DO_DEVEDOR =
  "    IF NEW.status IS DISTINCT FROM 'reported'\n" +
  "       OR OLD.status IS DISTINCT FROM 'pending' THEN\n";

const TRIGGER_DO_DEVEDOR =
  "CREATE TRIGGER mybank_installments_trava_do_devedor\n" +
  "  BEFORE UPDATE ON public.mybank_installments\n" +
  "  FOR EACH ROW EXECUTE FUNCTION public.mybank_installments_trava_do_devedor();";

const WITH_CHECK_DAS_PARCELAS =
  "  WITH CHECK (EXISTS (\n" +
  "    SELECT 1 FROM public.mybank_loans l\n" +
  "     WHERE l.id = mybank_installments.loan_id\n" +
  "       AND ( l.lender_user_id = auth.uid()\n" +
  "          OR (l.borrower_user_id = auth.uid()\n" +
  "              AND mybank_installments.status = 'reported'\n" +
  "              AND mybank_installments.reported_at IS NOT NULL) )\n" +
  "  ));";

const INVOKER = "ALTER VIEW public.mybank_due_entries SET (security_invoker = true);";

const VIEW_FILTRO_DEVEDOR = "  WHERE l.borrower_user_id = auth.uid()\n";
const VIEW_SEM_AUTO =
  "    AND l.borrower_user_id IS DISTINCT FROM l.lender_user_id\n";

const UNIQUE_DA_PARCELA =
  "    CONSTRAINT mybank_installments_loan_id_installment_number_key\n" +
  "      UNIQUE (loan_id, installment_number),\n";

const REVOKE_DAS_FUNCOES =
  "REVOKE ALL ON FUNCTION public.mybank_loans_trava()                   FROM PUBLIC, anon, authenticated;\n" +
  "REVOKE ALL ON FUNCTION public.mybank_installments_trava_do_devedor() FROM PUBLIC, anon, authenticated;";

const SELECT_DOS_DOIS_LADOS =
  "  USING (lender_user_id = auth.uid() OR borrower_user_id = auth.uid());";

const DELETE_SEM_PARCELA_PAGA =
  "    lender_user_id = auth.uid()\n" +
  "    AND NOT EXISTS (\n" +
  "      SELECT 1 FROM public.mybank_installments i\n" +
  "       WHERE i.loan_id = mybank_loans.id\n" +
  "         AND i.status = 'paid'\n" +
  "    )\n";

const mutantes = [
  // -----------------------------------------------------------------------
  // A TRAVA 1 -- a conta credora. As duas metades ("e minha" e "e de
  // investimento") tem mutante PROPRIO: uma trava que confere so uma delas fica
  // verde em metade do arquivo de teste, e e o erro mais facil de escrever aqui.
  // -----------------------------------------------------------------------
  [
    "a trava da conta credora e APAGADA (empresta de conta corrente e da conta de outro)",
    TRAVA_1_CONSULTA,
    "  v_conta_ok := true;\n",
  ],
  [
    "a trava 1 esquece o account_type (a conta CORRENTE passa a emprestar)",
    TRAVA_1_CONSULTA,
    "  SELECT EXISTS (\n" +
      "    SELECT 1 FROM public.financial_accounts a\n" +
      "     WHERE a.id = NEW.lender_account_id\n" +
      "       AND a.user_id = NEW.lender_user_id\n" +
      "  ) INTO v_conta_ok;\n",
  ],
  [
    "a trava 1 esquece o DONO (empresta da conta de investimento de outra pessoa)",
    TRAVA_1_CONSULTA,
    "  SELECT EXISTS (\n" +
      "    SELECT 1 FROM public.financial_accounts a\n" +
      "     WHERE a.id = NEW.lender_account_id\n" +
      "       AND a.account_type = 'investment'\n" +
      "  ) INTO v_conta_ok;\n",
  ],

  // -----------------------------------------------------------------------
  // A TRAVA 2 -- o devedor. E a que amarra o MyBank as conexoes.
  // -----------------------------------------------------------------------
  [
    "a trava do devedor e APAGADA (empresta para qualquer id de usuario)",
    TRAVA_2_EXISTS,
    "    IF FALSE THEN\n",
  ],
  [
    "a trava 2 esquece o status (conexao PENDENTE passa a valer como aceita)",
    TRAVA_2_EXISTS,
    "    IF NOT EXISTS (\n" +
      "      SELECT 1 FROM public.user_connections uc\n" +
      "       WHERE ( (uc.requester_id = NEW.lender_user_id   AND uc.requested_id = NEW.borrower_user_id)\n" +
      "            OR (uc.requested_id = NEW.lender_user_id   AND uc.requester_id = NEW.borrower_user_id) )\n" +
      "    ) THEN\n",
  ],
  // Este e o mutante que achou um buraco no PROPRIO teste desta issue: a
  // primeira versao do fixture tinha so a conexao A -> B (credor = requester) e
  // este mutante SOBREVIVIA. Foi o que motivou o quarto usuario (D -> A) e a
  // assercao "a conexao vale tambem quando o CREDOR foi o requested".
  [
    "a trava 2 olha so UM sentido da conexao (quem pediu a conexao nao pode receber emprestimo)",
    TRAVA_2_EXISTS,
    "    IF NOT EXISTS (\n" +
      "      SELECT 1 FROM public.user_connections uc\n" +
      "       WHERE uc.status = 'accepted'\n" +
      "         AND uc.requester_id = NEW.lender_user_id\n" +
      "         AND uc.requested_id = NEW.borrower_user_id\n" +
      "    ) THEN\n",
  ],
  // Sem o desvio do auto-emprestimo a trava recusa o CASO PRINCIPAL da issue --
  // "a moto que eu pago para mim mesmo" --, porque `user_connections` tem
  // `CHECK (requester_id <> requested_id)` e ninguem e conexao de si mesmo. E o
  // mutante que so uma assercao POSITIVA mata.
  [
    "o desvio do auto-emprestimo cai (emprestar para si mesmo passa a ser recusado)",
    TRAVA_2_DESVIO,
    "  IF TRUE THEN\n",
  ],

  // -----------------------------------------------------------------------
  // A JANELA DO UPDATE. Sem ela a trava re-valida sempre, e desfazer uma
  // conexao transforma a divida em linha impossivel de encerrar.
  // -----------------------------------------------------------------------
  [
    "a trava re-valida em TODO update (desfazer a conexao tranca a divida para sempre)",
    JANELA_DO_UPDATE,
    "  -- mutante: a janela do UPDATE foi apagada\n",
  ],

  // -----------------------------------------------------------------------
  // A TRAVA DO DEVEDOR NAS PARCELAS -- o que prende o valor da divida.
  // -----------------------------------------------------------------------
  [
    "a trigger do devedor nao e ARMADA (a policy sozinha deixa reescrever o amount)",
    TRIGGER_DO_DEVEDOR,
    "-- mutante: a trigger nao foi criada",
  ],
  [
    "o pin do devedor deixa o AMOUNT passar (a devedora encolhe a propria divida)",
    PIN_DO_DEVEDOR,
    "    IF NEW.id                  IS DISTINCT FROM OLD.id\n" +
      "       OR NEW.loan_id             IS DISTINCT FROM OLD.loan_id\n" +
      "       OR NEW.installment_number  IS DISTINCT FROM OLD.installment_number\n" +
      "       OR NEW.installment_total   IS DISTINCT FROM OLD.installment_total\n" +
      "       OR NEW.due_date            IS DISTINCT FROM OLD.due_date\n" +
      "       OR NEW.paid_date           IS DISTINCT FROM OLD.paid_date\n" +
      "       OR NEW.paid_transaction_id IS DISTINCT FROM OLD.paid_transaction_id\n" +
      "    THEN\n",
  ],
  [
    "o pin do devedor deixa o VENCIMENTO passar (a devedora empurra a parcela)",
    PIN_DO_DEVEDOR,
    "    IF NEW.id                  IS DISTINCT FROM OLD.id\n" +
      "       OR NEW.loan_id             IS DISTINCT FROM OLD.loan_id\n" +
      "       OR NEW.installment_number  IS DISTINCT FROM OLD.installment_number\n" +
      "       OR NEW.installment_total   IS DISTINCT FROM OLD.installment_total\n" +
      "       OR NEW.amount              IS DISTINCT FROM OLD.amount\n" +
      "       OR NEW.paid_date           IS DISTINCT FROM OLD.paid_date\n" +
      "       OR NEW.paid_transaction_id IS DISTINCT FROM OLD.paid_transaction_id\n" +
      "    THEN\n",
  ],
  [
    "a transicao do devedor deixa de ser pending -> reported (ela se da por paga)",
    TRANSICAO_DO_DEVEDOR,
    "    IF FALSE THEN\n",
  ],

  // -----------------------------------------------------------------------
  // A RLS. O `WITH CHECK` omitido e o mutante mais dificil de ver a olho nu: o
  // Postgres NAO reclama, ele repete o `USING` sobre a linha nova, e a policy
  // continua parecendo completa no `\d+` e no `pg_policies`.
  // -----------------------------------------------------------------------
  [
    "a policy de UPDATE das parcelas perde o WITH CHECK (o Postgres repete o USING)",
    WITH_CHECK_DAS_PARCELAS,
    "  ;",
  ],
  [
    "o SELECT passa a ser so do credor (a devedora nao ve mais a divida dela)",
    SELECT_DOS_DOIS_LADOS,
    "  USING (lender_user_id = auth.uid());",
  ],
  [
    "o DELETE deixa de olhar a parcela paga (apagar o emprestimo leva o historico pelo CASCADE)",
    DELETE_SEM_PARCELA_PAGA,
    "    lender_user_id = auth.uid()\n",
  ],
  // O defeito que esta migration realmente teve. Ver o cabecalho.
  [
    "o REVOKE das funcoes perde o FROM PUBLIC (anon volta a executar a trava DEFINER)",
    REVOKE_DAS_FUNCOES,
    "REVOKE ALL ON FUNCTION public.mybank_loans_trava()                   FROM anon, authenticated;\n" +
      "REVOKE ALL ON FUNCTION public.mybank_installments_trava_do_devedor() FROM anon, authenticated;",
  ],

  // -----------------------------------------------------------------------
  // A UNIQUE DE DINHEIRO.
  // -----------------------------------------------------------------------
  [
    "a UNIQUE perde o loan_id (a parcela 1/24 passa a ser unica no BANCO, nao no emprestimo)",
    UNIQUE_DA_PARCELA,
    "    CONSTRAINT mybank_installments_loan_id_installment_number_key\n" +
      "      UNIQUE (installment_number),\n",
  ],
  [
    "a UNIQUE e APAGADA (duas parcelas 7/24 no mesmo emprestimo, dinheiro contado duas vezes)",
    UNIQUE_DA_PARCELA,
    "",
  ],

  // -----------------------------------------------------------------------
  // A VIEW. `security_invoker` e reloption, e `CREATE OR REPLACE VIEW` apaga
  // reloptions -- e o caminho real pelo qual isto se perde numa 05x futura.
  // -----------------------------------------------------------------------
  [
    "a view perde o security_invoker (passa a devolver a divida de todo mundo)",
    INVOKER,
    "-- mutante: o ALTER foi apagado",
  ],
  [
    "a view perde o filtro do devedor (quem le ve a divida alheia)",
    VIEW_FILTRO_DEVEDOR,
    "  WHERE TRUE\n",
  ],
  // O mutante de dinheiro da view: sem esta linha o auto-emprestimo volta a
  // aparecer, a F2 une a view com `scheduled_transactions` e a MESMA parcela
  // conta duas vezes.
  [
    "a view deixa de excluir o auto-emprestimo (a parcela conta DUAS vezes em Contas a Pagar)",
    VIEW_SEM_AUTO,
    "",
  ],
];

const psql = (url, args) =>
  execFileSync("psql", ["-v", "ON_ERROR_STOP=1", "--no-psqlrc", url, ...args], {
    stdio: "pipe",
    encoding: "utf8",
  });

// O teste imprime um NOTICE por assercao que PASSOU antes de estourar na que
// falhou, e todos saem em stderr. Mostrar `stderr` cru deixa o placar com a
// PRIMEIRA assercao verde em cada linha, que e exatamente a informacao inutil.
// A linha que importa e a do ERROR.
const linhaDoErro = (stderr) => {
  const txt = (stderr || "").trim();
  const erro = txt.split("\n").find((l) => l.includes("ERROR:"));
  return (erro || txt).replace(/^.*ERROR:\s*/, "").trim();
};

const migrations = readdirSync("database/migrations")
  .filter(
    (f) =>
      /^0\d\d_/.test(f) && !f.startsWith("000_") && Number(f.slice(0, 3)) < ALVO_NUM
  )
  .sort();

function montarTemplate() {
  psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`]);
  psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${TEMPLATE}`]);
  const url = `${BASE}/${TEMPLATE}`;
  psql(url, ["-f", "database/tests/00_supabase_shim.sql"]);
  for (const m of migrations) psql(url, ["-f", `database/migrations/${m}`]);

  // As tabelas do MyBank nascem NESTA migration, entao a existencia de uma
  // delas e prova suficiente de que a 053 entrou no template -- e ela tem de
  // NAO ter entrado, senao cada mutante seria um CREATE OR REPLACE por cima da
  // versao boa (as tabelas tem IF NOT EXISTS) e o placar seria ficcao.
  const jaTem = psql(url, [
    "-tAc",
    "SELECT count(*) FROM pg_class WHERE oid = to_regclass('public.mybank_loans')",
  ]).trim();
  if (jaTem !== "0") {
    throw new Error(
      `o template ${TEMPLATE} ja tem a 053 -- os mutantes mediriam a versao boa`
    );
  }
}

function rodarMutante(nome, de, para) {
  if (!original.includes(de)) {
    // Ancora morta e pior que mutante sobrevivente: ela nao muta nada, o `psql`
    // do teste passa, e sem este aviso o placar diria "sobreviveu" com a culpa
    // caindo nas assercoes.
    return { nome, estado: "ANCORA MORTA", detalhe: de.slice(0, 80) };
  }
  // A ancora tem de ser UNICA: o cabecalho desta migration repete os mesmos
  // trechos em prosa, e `replace` pegaria o comentario em vez do codigo.
  const ocorrencias = original.split(de).length - 1;
  if (ocorrencias > 1) {
    return {
      nome,
      estado: "ANCORA AMBIGUA",
      detalhe: `o trecho aparece ${ocorrencias}x -- a mutacao atingiria so a primeira`,
    };
  }
  const mutado = original.replace(de, para);
  if (mutado === original) {
    return { nome, estado: "ANCORA MORTA", detalhe: "replace nao mudou nada" };
  }

  const banco = `mut053_${Math.random().toString(36).slice(2, 10)}`;
  // A MUTACAO VAI PARA UMA SOMBRA EM /tmp, E A ARVORE NUNCA E TOCADA -- morto
  // por timeout ou cancelamento, um runner que escreve no arquivo rastreado
  // deixa o mutante GRAVADO e dali em diante toda medicao le a migration errada,
  // sem nada no placar dizendo isso.
  const sombra = join(tmpdir(), `mut053_${banco}.sql`);
  try {
    psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${banco} TEMPLATE ${TEMPLATE}`]);
    writeFileSync(sombra, mutado);
    const url = `${BASE}/${banco}`;
    try {
      psql(url, ["-f", sombra]);
    } catch (e) {
      // Mutante que nem aplica tambem esta morto -- e honesto dizer COMO, para
      // quem le o placar nao achar que uma assercao o pegou. Aqui vale uma nota:
      // vario mutante desta lista morre no POSFLIGHT da propria migration (a
      // SECAO 9 dela), e nao numa assercao do teste. Isso conta como morte, e e
      // de proposito -- o posflight existe para a colagem a mao nao seguir com
      // a trava pela metade.
      return {
        nome,
        estado: "morto",
        detalhe: `a migration mutada nao aplica: ${linhaDoErro(e.stderr).slice(0, 140)}`,
      };
    }
    try {
      psql(url, ["-f", TESTE]);
      return { nome, estado: "SOBREVIVEU", detalhe: "o teste passou com o mutante" };
    } catch (e) {
      return { nome, estado: "morto", detalhe: linhaDoErro(e.stderr) };
    }
  } finally {
    try {
      rmSync(sombra, { force: true });
    } catch {
      /* sombra em /tmp: sobrar nao muda placar nem toca a arvore */
    }
    try {
      psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`]);
    } catch {
      /* banco de mutante: sobrar nao muda placar */
    }
  }
}

console.log(`montando o template ${TEMPLATE} (001 -> 052, sem a 053)...`);
montarTemplate();

// CONTROLE NEGATIVO DA SUITE: no template (sem a 053) o teste tem de REPROVAR.
// Sem isto, uma suite que nao olhasse para nada deixaria todo mutante "morto"
// por outro motivo e o placar sairia perfeito medindo a fixture.
{
  const banco = `mut053_sem_a_053_${process.pid}`;
  psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${banco} TEMPLATE ${TEMPLATE}`]);
  try {
    psql(`${BASE}/${banco}`, ["-f", TESTE]);
    console.error(
      "CONTROLE NEGATIVO REPROVOU: a suite da 053 passa num banco que NAO tem a 053."
    );
    process.exit(1);
  } catch (e) {
    console.log(
      `controle negativo: sem a 053 a suite fica vermelha (${linhaDoErro(e.stderr).slice(0, 110)})`
    );
  } finally {
    psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`]);
  }
}

// CONTROLE POSITIVO: a arvore NAO mutada tem de ficar VERDE. Sem ele, um erro de
// script (caminho errado, template sem shim) deixaria todo mutante "morto" e o
// placar sairia perfeito medindo nada.
{
  const banco = `mut053_positivo_${process.pid}`;
  psql(`${BASE}/postgres`, ["-c", `CREATE DATABASE ${banco} TEMPLATE ${TEMPLATE}`]);
  try {
    psql(`${BASE}/${banco}`, ["-f", ALVO]);
    psql(`${BASE}/${banco}`, ["-f", TESTE]);
    console.log("controle positivo: a arvore limpa passa.\n");
  } catch (e) {
    console.error("CONTROLE POSITIVO REPROVOU -- o placar abaixo nao vale nada.");
    console.error((e.stderr || e.message || "").trim().slice(0, 600));
    process.exit(1);
  } finally {
    psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${banco} WITH (FORCE)`]);
  }
}

const resultados = mutantes.map(([nome, de, para]) => rodarMutante(nome, de, para));

for (const r of resultados) {
  if (r.estado === "morto") {
    console.log(`ok   ${r.nome}\n       -> ${r.detalhe.slice(0, 160)}`);
  } else {
    console.log(`FALHA ${r.nome}\n       -> ${r.estado}: ${r.detalhe}`);
  }
}

try {
  psql(`${BASE}/postgres`, ["-c", `DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`]);
} catch {
  /* idem */
}

const vivos = resultados.filter((r) => r.estado !== "morto");
if (vivos.length) {
  console.error(`\n${vivos.length} de ${resultados.length} mutantes NAO morreram.`);
  process.exit(1);
}

// MUTANTE MORTO SO PELO `psql` NAO PROVA ASSERCAO NENHUMA. Se TODOS morressem
// assim, a suite poderia estar vazia e o placar sairia perfeito.
const porAssercao = resultados.filter((r) => r.detalhe.startsWith("FALHA")).length;
if (porAssercao === 0) {
  console.error(
    "\nNENHUM mutante foi morto por assercao -- todos cairam no psql. A suite nao esta medindo nada."
  );
  process.exit(1);
}
console.log(
  `\nTodos os ${resultados.length} mutantes morreram (${porAssercao} por assercao da suite).`
);
