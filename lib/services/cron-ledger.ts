// =====================================================
// O LIVRO-RAZAO DAS EXECUCOES DE CRON
// =====================================================
// Grava uma linha em `cron_runs` por execucao de cron que passou do guard de
// auth -- inclusive, e principalmente, quando a execucao nao tinha nada a
// fazer.
//
// POR QUE ISSO E O PONTO TODO
// ---------------------------
// Ate aqui a unica evidencia de que um cron rodou era o EFEITO COLATERAL dele:
// uma linha nova em `bill_notifications`, uma recorrencia nova em
// `detected_recurrences`. Essa evidencia nao serve, porque um cron MORTO e um
// cron OCIOSO produzem o mesmo registro -- nenhum. E o dia normal de um job de
// aviso e justamente o dia em que ele nao tem nada a avisar.
//
// Foi assim que a HMO-152 escondeu tres crons em 503 por semanas. Com esta
// tabela, "rodou e estava ocioso" grava `status='ok'` com contadores zerados, e
// "nunca foi chamado" continua nao gravando nada. Duas causas, dois registros.
//
// O CABECALHO DA 019 TEM O RESTO
// ------------------------------
// Por que o 503 e o 401 nao sao registrados, por que a leitura precisa de uma
// policy nomeando `paperclip_ro`, e o estado fisico das tabelas que mostra que
// o plano de verificacao por efeito colateral nao podia funcionar.
// =====================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Os quatro jobs de `crons[]` do vercel.json. Espelha o CHECK da 019. */
export type CronJob =
  | "recurrence-scan"
  | "recurrence-alerts"
  | "bill-alerts"
  | "monthly-summary";

export interface LinhaDeExecucao {
  job: CronJob;
  started_at: string;
  finished_at: string;
  status: "ok" | "error";
  http_status: number;
  duration_ms: number;
  result: unknown;
  error: string | null;
}

/**
 * Quanto do corpo da resposta cabe em `result`.
 *
 * As respostas de hoje sao contadores e nao passam de algumas centenas de
 * bytes, mas `recurrence-scan` devolve uma lista de falhas por usuario: um dia
 * ruim com 500 usuarios quebrados escreveria um jsonb enorme em cada execucao,
 * todo dia, para sempre. O corte e defensivo e a marca `truncado: true` avisa
 * que houve corte, em vez de deixar o leitor achar que o job devolveu pouco.
 */
const MAX_RESULT_BYTES = 4000;

/**
 * Quanto tempo esperar pela gravacao do livro-razao.
 *
 * Sem teto, uma instabilidade do banco na hora de fechar a conta faria a rota
 * inteira estourar o `maxDuration` da Vercel -- e o trabalho, que ja terminou,
 * seria cortado no meio sem resposta. O livro-razao nao pode custar a execucao
 * que ele existe para registrar.
 */
const TIMEOUT_GRAVACAO_MS = 5000;

/**
 * Monta a linha a partir do que a rota devolveu. Pura de proposito: e aqui que
 * mora a decisao de o que conta como sucesso, e ela precisa ser testavel sem
 * banco e sem o runtime do Next.
 */
export function montarLinha(entrada: {
  job: CronJob;
  httpStatus: number;
  corpo: unknown;
  erro?: unknown;
  inicio: number;
  fim: number;
}): LinhaDeExecucao {
  const { job, httpStatus, corpo, erro, inicio, fim } = entrada;

  // 2xx e sucesso; qualquer outra coisa e falha. Um 200 com contadores zerados
  // E sucesso -- "nao havia nada a fazer" e o caso normal, nao uma anomalia, e
  // marca-lo como erro encheria o livro-razao de alarme falso justamente nos
  // dias tranquilos.
  const ok = httpStatus >= 200 && httpStatus < 300;

  // `fim` e `inicio` saem de dois Date.now() do mesmo processo, entao a ordem
  // deveria ser garantida -- mas Date.now() NAO e monotonico: um ajuste de
  // relogio (NTP) entre as duas leituras produz fim < inicio.
  //
  // O piso protege o CHECK `cron_runs_finished_after_started_check` da 019.
  // Sem ele a linha e RECUSADA pelo banco, e como gravarLinha nao derruba a
  // rota de proposito, a execucao simplesmente sumiria do livro-razao -- o
  // mesmo silencio que esta tabela existe para acabar.
  const fimCorrigido = Math.max(inicio, fim);

  return {
    job,
    started_at: new Date(inicio).toISOString(),
    finished_at: new Date(fimCorrigido).toISOString(),
    status: ok ? "ok" : "error",
    http_status: httpStatus,
    duration_ms: Math.round(fimCorrigido - inicio),
    result: recortarResultado(corpo),
    error: ok ? null : mensagemDeErro(erro, corpo),
  };
}

/**
 * A frase de erro que vai para a coluna `error`.
 *
 * Prefere a excecao, quando houve uma, porque ela carrega a causa de verdade; o
 * corpo da resposta nesse caso costuma ser o texto generico que a rota mostra
 * para fora ("Erro interno"), que nao ajuda ninguem a depurar.
 */
function mensagemDeErro(erro: unknown, corpo: unknown): string {
  if (erro instanceof Error && erro.message) return erro.message;
  if (erro !== undefined && erro !== null && `${erro}`.trim()) return `${erro}`;

  if (corpo && typeof corpo === "object" && "error" in corpo) {
    const e = (corpo as { error: unknown }).error;
    if (typeof e === "string" && e.trim()) return e;
  }

  return "falha sem mensagem";
}

/** Corta o corpo quando ele passa do teto, marcando que cortou. */
function recortarResultado(corpo: unknown): unknown {
  if (corpo === undefined) return null;

  let serializado: string;
  try {
    serializado = JSON.stringify(corpo) ?? "null";
  } catch {
    // Corpo com referencia circular: nao da para gravar, mas perder a linha
    // inteira por causa disso seria trocar o registro da execucao por nada.
    return { truncado: true, motivo: "corpo nao serializavel" };
  }

  if (serializado.length <= MAX_RESULT_BYTES) return corpo;

  return {
    truncado: true,
    motivo: `corpo de ${serializado.length} bytes acima do teto de ${MAX_RESULT_BYTES}`,
    trecho: serializado.slice(0, MAX_RESULT_BYTES),
  };
}

/**
 * Grava a linha. Nunca lanca.
 *
 * Se a gravacao falhar, o trabalho do cron JA ACONTECEU -- derrubar a resposta
 * por causa do livro-razao transformaria uma execucao bem-sucedida e nao
 * registrada numa execucao bem-sucedida, nao registrada E reportada como falha
 * para a Vercel. O erro vai para o log e a resposta da rota segue intacta.
 */
export async function gravarLinha(
  admin: SupabaseClient,
  linha: LinhaDeExecucao
): Promise<{ gravou: boolean; erro?: string }> {
  try {
    const gravacao = admin.from("cron_runs").insert(linha);

    const resultado = await Promise.race([
      gravacao,
      new Promise<{ error: { message: string } }>((resolve) =>
        setTimeout(
          () => resolve({ error: { message: `timeout de ${TIMEOUT_GRAVACAO_MS}ms` } }),
          TIMEOUT_GRAVACAO_MS
        )
      ),
    ]);

    const erro = (resultado as { error: { message: string } | null }).error;
    if (erro) {
      console.error(`cron_runs: falha ao registrar a execucao de ${linha.job}:`, erro.message);
      return { gravou: false, erro: erro.message };
    }

    return { gravou: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`cron_runs: falha ao registrar a execucao de ${linha.job}:`, msg);
    return { gravou: false, erro: msg };
  }
}

/**
 * Envolve o corpo da rota e registra o desfecho -- qualquer que ele seja.
 *
 * Recebe uma funcao que devolve `{ status, body }` em vez de um NextResponse
 * pronto para que esta camada nao precise clonar e reparsear a resposta, e para
 * que nenhum caminho de saida possa escapar do registro: a rota nao tem mais um
 * `return NextResponse.json(...)` proprio depois do guard de auth, entao nao ha
 * como esquecer de instrumentar um `return` novo.
 *
 * O cliente de escrita do livro-razao e criado AQUI, separado do que a rota
 * usa: se a criacao do cliente da rota estourar, a execucao ainda fica
 * registrada como erro -- que e exatamente o caso em que mais importa ter o
 * registro.
 */
export async function comRegistro(
  job: CronJob,
  env: { url: string; serviceRole: string },
  corpo: () => Promise<{ status: number; body: unknown }>
): Promise<{ status: number; body: unknown }> {
  const inicio = Date.now();

  let status = 500;
  let body: unknown = { error: "Erro interno" };
  let erro: unknown;

  try {
    const r = await corpo();
    status = r.status;
    body = r.body;
  } catch (e) {
    erro = e;
    console.error(`Cron ${job}: excecao nao tratada:`, e);
  }

  const linha = montarLinha({ job, httpStatus: status, corpo: body, erro, inicio, fim: Date.now() });

  try {
    const admin = createClient(env.url, env.serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await gravarLinha(admin, linha);
  } catch (e) {
    console.error(`cron_runs: nao foi possivel abrir o cliente para ${job}:`, e);
  }

  return { status, body };
}
