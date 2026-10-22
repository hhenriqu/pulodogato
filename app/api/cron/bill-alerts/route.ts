// GET /api/cron/bill-alerts   varre os vencimentos e avisa (uma vez por dia)
//
// Agendado em vercel.json para 11:00 UTC = 08:00 em Brasilia -- cedo o
// bastante para ainda dar tempo de pagar no mesmo dia.
//
// POR QUE ESTA ROTA PRECISA DA service_role
// ------------------------------------------
// O cron roda sem nenhum usuario logado e precisa enxergar o vencimento de
// TODOS. Com a chave anon a RLS do 009 devolveria zero linhas e o job sairia
// verde sem avisar ninguem -- a pior falha possivel aqui, porque e silenciosa.
//
// Por isso a rota EXIGE as duas variaveis e responde 503 dizendo qual falta, em
// vez de rodar a vazio. E por isso ela e a unica do projeto que usa a
// service_role: tudo que passa pelo navegador continua passando pela RLS.
//
// PROTECAO
// --------
// `CRON_SECRET` no header Authorization. Sem ele, qualquer um na internet
// dispararia a varredura -- nao vazaria dado (a resposta e so contagem), mas
// encheria o celular de todo mundo de notificacao repetida... ate a UNIQUE de
// bill_notifications barrar. A UNIQUE e a segunda linha de defesa; o segredo e
// a primeira.
//
// O CONJUNTO DE CHAVES DA RESPOSTA E A ASSINATURA DO RAMO (HMO-486)
// -----------------------------------------------------------------
// `cron_runs.result` e o unico registro durável do que este job fez, e
// `avisos: 0` nao diz em qual `return` ele passou. O que diz e o CONJUNTO de
// chaves, porque ele e uma propriedade do codigo e nao do dado:
//
//   ramo                                    | chaves
//   ----------------------------------------|-------
//   `if (error)` na leitura da view         |   2  (error, erro_leitura)
//   `if (lista.length === 0)` -> ocioso     |   8  (+ lista_bruta, st_pendentes, projeto)
//   caminho completo, depois do upsert      |  13
//
// Foi contando chaves que a HMO-486 provou que as 27 execucoes de producao
// paravam no retorno ocioso -- as 5 chaves de entao nao podiam ter vindo do
// caminho completo. **Quem acrescentar um `return` aqui tem de atualizar esta
// tabela**, e dar a ele pelo menos um campo exclusivo: e o campo exclusivo que
// torna o ramo legivel depois, como `email_desligado` e `unique_antiga` ja
// fazem.
//
// A contagem do ramo ocioso ja andou, e por isso ela tambem datilha o deploy:
// 3 chaves ate 08/10/2026, 5 de 09/10 a 22/10, 8 a partir da instrumentacao da
// HMO-486 (`b5f5a2f`). Ler um `result` sem conferir quantas chaves ele tem e
// concluir sobre codigo que nao rodou.
//
// O QUE IMPEDE O SPAM
// -------------------
// A view ja traz `already_notified`, e o INSERT bate na UNIQUE
// (scheduled_transaction_id, user_id, kind, reference_date) da 057. Mesmo que o
// cron rode dez vezes no mesmo dia, o aviso sai uma vez so POR PESSOA.
//
// UMA CONTA DE GRUPO RENDE UM AVISO POR MEMBRO (HMO-414)
// ------------------------------------------------------
// Conta prevista de grupo e UMA linha, do dono -- e por isso o aviso saia so
// para ele. Desde a 057 `bill_alerts` devolve uma linha POR DESTINATARIO (os
// membros ativos do grupo, mais o dono), e esta rota nao precisou saber de
// grupo nenhum: ela continua gravando `a.user_id`, que agora e o destinatario.
//
// O QUE ELA PRECISOU SABER E O `onConflict`. Com `user_id` fora da chave, o
// aviso do segundo membro colide com o do primeiro e o `ignoreDuplicates`
// responde `INSERT 0 0` -- SEM ERRO. Medido: o fan-out inteiro gravava UMA
// linha. E por isso que o nome das colunas aqui e load-bearing, e por que esta
// rota tem de ir ao ar ANTES de a 057 ser colada (ver o cabecalho dela).
//
// E O DIA ENTRE O DEPLOY E A COLAGEM? (a queda de volta para a chave do 009)
// --------------------------------------------------------------------------
// "Deploy antes da colagem" e o lado CERTO da ordem -- mas enquanto a 057 nao
// esta colada a lista larga nao casa com nenhum indice, e o PostgREST responde
// ERRO, nao "ignorei o conflito". Medido num Postgres 17 com a
// `bill_notifications` do 009:
//
//   INSERT ... ON CONFLICT (scheduled_transaction_id, user_id, kind,
//   reference_date) DO NOTHING
//   -> ERROR 42P10: there is no unique or exclusion constraint matching the
//      ON CONFLICT specification
//
// Sem queda de volta, o PRIMEIRO dia com conta a avisar depois do deploy
// perderia o aviso de TODO MUNDO -- inclusive o do dono, que funciona hoje.
// Entao: `42P10` na lista da 057 -> grava de novo pela chave do 009, que e
// exatamente o comportamento de hoje (o fan-out colapsa numa linha porque a
// view velha ja devolve uma linha so, do dono).
//
// A queda NAO e silenciosa: `unique_antiga: true` entra na resposta e e por ela
// que `cron_runs` guarda o dia em que isso aconteceu. Um canal que se degrada
// sem sintoma vira defeito permanente; este diz o proprio nome no registro.
// Quando a 057 for colada, a primeira tentativa passa e este caminho morre.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { enviarPush, textoDoAviso, type BillAlert } from "@/lib/services/notifications";
import {
  configuracaoDeEmail,
  enviarEmails,
  separarDestinatarios,
} from "@/lib/services/email";
import { comRegistro } from "@/lib/services/cron-ledger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * As duas listas de `onConflict`. Ficam em constantes NOMEADAS porque a
 * diferenca entre elas e exatamente uma coluna, e e essa coluna que decide se o
 * aviso do segundo membro do grupo e gravado ou descartado.
 */
const CHAVE_057 = "scheduled_transaction_id,user_id,kind,reference_date";
const CHAVE_009 = "scheduled_transaction_id,kind,reference_date";

/**
 * "A lista do `onConflict` nao casa com nenhum indice unico" -- o unico erro
 * que justifica tentar de novo pela chave antiga.
 *
 * `42P10` e o SQLSTATE que o Postgres levanta em `infer_arbiter_indexes`, e o
 * PostgREST o repassa no campo `code`. A segunda condicao existe porque esse
 * repasse e do PostgREST, nao nosso: se uma versao dele trocar o `code` por um
 * proprio, a mensagem continua sendo a do Postgres -- e uma queda de volta que
 * para de funcionar em silencio e pior do que nao ter.
 *
 * Qualquer OUTRO erro de gravacao continua virando 500: o fim do dia nao pode
 * ser "tentei de novo de um jeito diferente e deu errado de novo tambem".
 */
function semIndiceParaOnConflict(erro: { code?: string; message?: string }): boolean {
  return (
    erro.code === "42P10" ||
    /no unique or exclusion constraint matching/i.test(erro.message ?? "")
  );
}

/**
 * Uma contagem para o livro-razao -- OU o motivo de ela nao ter saido.
 *
 * O tipo de retorno e `number | string` de proposito, e e a parte que importa.
 * Uma contagem que devolvesse `0` quando a consulta FALHA fabricaria exatamente
 * o numero que o diagnostico desta issue le como "o cliente nao esta vendo o
 * banco" -- e mandaria a investigacao conferir URL e chave por causa de um erro
 * de permissao. Zero tem de significar "contei, e nao ha linha"; qualquer outra
 * coisa diz o proprio nome em `cron_runs`.
 *
 * `count: null` com `error: null` tambem e um caso: o PostgREST responde assim
 * quando o cabecalho `Prefer: count` nao volta, e isso NAO e zero linhas.
 */
async function contar(
  consulta: PromiseLike<{
    count: number | null;
    error: { code?: string; message?: string } | null;
  }>
): Promise<number | string> {
  try {
    const { count, error } = await consulta;
    if (error) {
      return `${error.code ?? "sem code"}: ${error.message ?? "sem mensagem"}`;
    }
    if (count === null || count === undefined) {
      return "o PostgREST nao devolveu count";
    }
    return count;
  } catch (e) {
    return `excecao: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * O `ref` do projeto Supabase que este processo esta de fato usando.
 *
 * So o subdominio, e NUNCA a chave: `NEXT_PUBLIC_SUPABASE_URL` ja viaja no
 * bundle do navegador, entao o ref nao e segredo -- a `SUPABASE_SERVICE_ROLE_KEY`
 * e, e nao entra aqui nem truncada.
 *
 * Existe porque a primeira linha da tabela de diagnostico da HMO-486
 * ("`lista_bruta` 0 e `st_pendentes` 0") junta TRES causas numa celula:
 * env, URL e chave. O ref separa a do meio sozinho -- se o que esta gravado em
 * `cron_runs` nao for o projeto de producao, a investigacao acaba em uma
 * execucao em vez de passar pelas outras duas.
 */
function refDoProjeto(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0] || "host sem subdominio";
  } catch {
    return "NEXT_PUBLIC_SUPABASE_URL nao e uma URL";
  }
}

/**
 * O e-mail de cada usuario, lido pela API de admin.
 *
 * O endereco mora em `auth.users`, que nao e consultavel por PostgREST -- e
 * nao deve ser copiado para `profiles`: a policy `profiles_select_own_or_public`
 * do 002 expoe o perfil a toda conta autenticada, e uma coluna de e-mail ali
 * publicaria o endereco de todo mundo para a base inteira (foi exatamente o
 * raciocinio da 032 com a chave Pix).
 *
 * Deduplica antes de perguntar: varias contas vencendo no mesmo dia sao
 * normalmente do mesmo usuario, e uma chamada por AVISO viraria dez chamadas
 * identicas.
 *
 * Falha de leitura NAO derruba o cron. Sem endereco o aviso sai sem e-mail e
 * entra em `email_sem_endereco` -- visivel no livro-razao, ao contrario de uma
 * excecao que levaria junto o push e a gravacao que ja deram certo.
 */
async function enderecosDe(
  admin: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string | null>> {
  const mapa = new Map<string, string | null>();

  // `Array.from` e nao `for...of` direto no Set: o target do tsconfig do app
  // e es5 e iterar um Set sem isso reprova com TS2802.
  for (const id of Array.from(new Set(userIds))) {
    try {
      const { data, error } = await admin.auth.admin.getUserById(id);
      if (error) {
        console.error("Cron: falha ao ler o e-mail do usuario", id, error.message);
        mapa.set(id, null);
        continue;
      }
      mapa.set(id, data.user?.email ?? null);
    } catch (e) {
      console.error("Cron: excecao ao ler o e-mail do usuario", id, e);
      mapa.set(id, null);
    }
  }

  return mapa;
}

export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const faltando = [
    !segredo && "CRON_SECRET",
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !serviceRole && "SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);

  if (faltando.length) {
    return NextResponse.json(
      {
        error: `Aviso de vencimento não configurado. Faltam: ${faltando.join(", ")}.`,
        hint: "Project Settings → Environment Variables, escopo Production.",
      },
      { status: 503 }
    );
  }

  // A Vercel manda `Authorization: Bearer <CRON_SECRET>` nos crons do projeto.
  const enviado = request.headers.get("authorization");
  if (enviado !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // Daqui para baixo toda saida passa pelo livro-razao (`cron_runs`, 019) --
  // inclusive o "nao havia nada a fazer" logo abaixo, que e o caso normal e o
  // unico que distingue um cron ocioso de um cron que nunca foi chamado.
  // O `faltando` acima ja garantiu que as duas existem, mas o TypeScript nao
  // enxerga isso atraves do array -- dai o estreitamento explicito aqui.
  const env = { url: url as string, serviceRole: serviceRole as string };

  const saida = await comRegistro("bill-alerts", env, async () => {
    const admin = createClient(env.url, env.serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: alertas, error } = await admin
      .from("bill_alerts")
      .select("*")
      .eq("already_notified", false);

    if (error) {
      console.error("Cron: erro ao ler bill_alerts:", error);
      // `erro_leitura` no CORPO, e nao so no console (HMO-486). O log da funcao
      // da Vercel tem retencao curta e nao e consultavel por SQL; `cron_runs` e
      // o registro que sobrevive. Sem este campo, uma falha de leitura so
      // aparecia como um 500 sem causa -- e a causa e justamente o que separa
      // "permissao" de "coluna que nao existe mais" de "banco fora".
      return {
        status: 500,
        body: {
          error: "Falha ao ler os vencimentos",
          erro_leitura: `${error.code ?? "sem code"}: ${error.message ?? "sem mensagem"}`,
        },
      };
    }

    const lista = (alertas ?? []) as BillAlert[];
    if (lista.length === 0) {
      // =====================================================
      // O RETORNO OCIOSO, E POR QUE ELE PRECISA CONTAR DUAS VEZES (HMO-486)
      // =====================================================
      // `email_desligado` tambem no caminho ocioso: o dia normal deste cron e
      // o dia sem nada a avisar, e e justamente nele que "o canal esta
      // configurado?" precisa continuar aparecendo em `cron_runs`. Sem isto a
      // resposta so apareceria no primeiro dia com vencimento -- e o relatorio
      // de meses tranquilos nao diria nada sobre o e-mail.
      //
      // E O MESMO MOTIVO TRAZ AS CONTAGENS ABAIXO.
      // `avisos: 0` e AMBIGUO DE PROPOSITO: ele e o dia tranquilo (correto) e e
      // tambem a leitura que voltou vazia (defeito), e os dois gravam o mesmo
      // 200. Em producao isso custou 28 execucoes verdes entre 25/09 e 22/10,
      // todas com `avisos: 0`, enquanto a MESMA view devolvia linha para o
      // dono -- e `bill_notifications` nunca recebeu uma linha deste job.
      //
      // O FILTRO `already_notified` NAO E SUSPEITO -- ISSO FOI MEDIDO (HMO-489)
      // ----------------------------------------------------------------------
      // Uma versao anterior deste comentario dizia que `already_notified` "nao
      // correlaciona por `user_id`" e que lido pela service_role ele significa
      // "alguem ja foi avisado". **Isso era verdade na cadeia 001->056 e e
      // FALSO no schema que esta no ar.** Medido no catalogo de producao em
      // 22/10/2026, com a 057 colada:
      //
      //   - `pg_get_viewdef('public.bill_alerts')` traz
      //     `n.user_id = d.user_id` dentro do `EXISTS` -- a coluna e POR
      //     DESTINATARIO, igual para a service_role e para o dono;
      //   - `bill_notifications_unique` e
      //     `(scheduled_transaction_id, user_id, kind, reference_date)`;
      //   - `pg_stat_user_tables` da `bill_notifications`: `n_live_tup = 0` e
      //     `n_tup_ins = 1` na vida inteira -- a tabela esta VAZIA.
      //
      // Tabela vazia => o `EXISTS` e `false` em toda linha, para todo leitor =>
      // `.eq("already_notified", false)` nao descarta nada. Entao
      // **`lista_bruta` e `lista.length` sao a mesma contagem por construcao**,
      // e chegar aqui com `lista_bruta > 0` seria uma contradicao do PostgREST,
      // nao o filtro trabalhando. O mundo "quem zera e o `already_notified`"
      // (3a linha da tabela antiga, HMO-414) nao existe no ar.
      //
      // O QUE AS DUAS CONTAGENS DESEMPATAM, ENTAO
      // -----------------------------------------
      // A terceira linha da tabela antiga cai junto com o filtro: ela mandava a
      // leitura para a HMO-414, que e um defeito de outra cadeia de schema.
      // Sobra uma tabela de DUAS linhas -- e uma terceira celula que, se
      // aparecer, nao e um mundo e sim uma contradicao a investigar no
      // PostgREST, nao no schema:
      //
      //   lista_bruta | st_pendentes | o que e
      //   ------------|--------------|--------------------------------------
      //        0      |      0       | este processo nao esta vendo o banco
      //               |              | de producao -- veja `projeto`. Em
      //               |              | 22/10/2026 a tabela crua de producao
      //               |              | tinha 136 linhas vivas, entao
      //               |              | `st_pendentes: 0` aqui nao e "nao ha
      //               |              | conta prevista"
      //        0      |     > 0      | a view filtra para ESTE leitor -- a
      //               |              | linha existe e `bill_alerts` a esconde.
      //               |              | Como o catalogo diz que o WHERE dela le
      //               |              | a coluna CRUA `s.status` e que o fan-out
      //               |              | sai de `s.user_id` (nenhum dos dois
      //               |              | depende de `auth.uid()`), o suspeito
      //               |              | aqui nao e a RLS: e `CURRENT_DATE`, o
      //               |              | LEFT JOIN de `notification_preferences`,
      //               |              | ou a view resolvida nao ser a do
      //               |              | catalogo (`search_path`/`db-schemas`)
      //      > 0      |     > 0      | CONTRADICAO, nao mundo: a leitura
      //               |              | filtrada e a contagem da mesma view
      //               |              | discordam com um filtro que nao
      //               |              | descarta nada
      //
      // `st_pendentes` nao passa pela view nenhuma -- e a tabela crua, e e so
      // por isso que ela consegue acusar a view.
      //
      // CUSTO: duas consultas `head: true` (nenhuma linha trafega) e SO no dia
      // ocioso. O dia com aviso a dar nao paga nada disso.
      const [listaBruta, stPendentes] = await Promise.all([
        contar(admin.from("bill_alerts").select("*", { count: "exact", head: true })),
        contar(
          admin
            .from("scheduled_transactions")
            .select("*", { count: "exact", head: true })
            .eq("status", "pending")
        ),
      ]);

      return {
        status: 200,
        body: {
          ok: true,
          avisos: 0,
          push: 0,
          email: 0,
          email_desligado: !configuracaoDeEmail(),
          lista_bruta: listaBruta,
          st_pendentes: stPendentes,
          projeto: refDoProjeto(env.url),
        },
      };
    }

    // Um INSERT so, com ON CONFLICT. Gravar ANTES de mandar o push e
    // deliberado: se a gravacao falhar depois do envio, o proximo cron manda o
    // mesmo push de novo. Na ordem inversa, o pior caso e um aviso gravado que
    // nao saiu no celular -- e ele ainda aparece no sino do app.
    const linhas = lista.map((a) => {
      const { title, body } = textoDoAviso(a);
      return {
        user_id: a.user_id,
        scheduled_transaction_id: a.scheduled_transaction_id,
        kind: a.kind,
        reference_date: a.due_date,
        title,
        body,
        channel: "inapp" as const,
      };
    });

    const gravarCom = (onConflict: string) =>
      admin
        .from("bill_notifications")
        .upsert(linhas, { onConflict, ignoreDuplicates: true })
        .select("id, user_id, scheduled_transaction_id, title, body");

    // `user_id` ENTRA AQUI, e a lista tem de casar com a UNIQUE da 057: o
    // PostgREST exige um indice unico com estas colunas e responde ERRO quando
    // nao acha -- nao "ignorei o conflito". Sem `user_id`, o aviso do segundo
    // membro de um grupo era descartado em silencio.
    let { data: gravados, error: erroGravar } = await gravarCom(CHAVE_057);
    let uniqueAntiga = false;

    if (erroGravar && semIndiceParaOnConflict(erroGravar)) {
      // A 057 ainda nao foi colada. Grava pela chave do 009 em vez de perder o
      // dia inteiro de aviso -- ver o cabecalho.
      console.error(
        "Cron: a UNIQUE de bill_notifications ainda e a do 009 (a 057 nao foi " +
          "colada). Gravando pela chave antiga: o aviso de conta de grupo sai " +
          "so para o dono hoje.",
        erroGravar
      );
      uniqueAntiga = true;
      ({ data: gravados, error: erroGravar } = await gravarCom(CHAVE_009));
    }

    if (erroGravar) {
      console.error("Cron: erro ao gravar avisos:", erroGravar);
      return { status: 500, body: { error: "Falha ao gravar os avisos" } };
    }

    const novos = gravados ?? [];

    // Push so para os que acabaram de ser gravados: os que ja existiam foram
    // avisados numa execucao anterior.
    let enviados = 0;
    let removidos = 0;
    let pushDesligado = false;

    await Promise.all(
      novos.map(async (n) => {
        const r = await enviarPush(admin, n.user_id, {
          title: n.title,
          body: n.body,
          url: "/dashboard/bills",
          // uma notificacao por conta: a do aluguel substitui a anterior do
          // aluguel em vez de empilhar duas na bandeja.
          tag: `bill-${n.scheduled_transaction_id}`,
        });
        enviados += r.enviados;
        removidos += r.removidos;
        if (r.desligado) pushDesligado = true;
      })
    );

    if (enviados > 0) {
      await admin
        .from("bill_notifications")
        .update({ channel: "push" })
        .in(
          "id",
          novos.map((n) => n.id)
        );
    }

    // -----------------------------------------------------------------------
    // E-MAIL (HMO-183)
    // -----------------------------------------------------------------------
    // Depois do push, e sobre a MESMA lista `novos` -- os avisos que acabaram
    // de ser gravados. E dai que vem a idempotencia do canal: a UNIQUE
    // (scheduled_transaction_id, user_id, kind, reference_date) da 057 faz o
    // segundo cron do dia devolver `novos` vazio, entao ele nao manda e-mail
    // nenhum. Por PESSOA desde a 057: o aviso que a Lais ja recebeu nao cala
    // mais o da Ana sobre a mesma conta.
    // Nao ha contagem separada a manter; o que ja protegia o push protege o
    // e-mail pela mesma linha.
    // Com o canal desligado NAO se procura endereco nenhum. `enderecosDe` e
    // uma chamada a API de admin por usuario, todo dia, e sem a chave do
    // provedor nenhuma delas pode terminar em envio -- seria custo e latencia
    // puros numa rota que ja tem teto de 60s, por um canal que esta off.
    const canalLigado = configuracaoDeEmail() !== null;

    const prefs = new Map(lista.map((a) => [a.user_id, a.notify_email]));
    const emails = canalLigado
      ? await enderecosDe(
          admin,
          novos.map((n) => n.user_id)
        )
      : new Map<string, string | null>();

    // Com o canal desligado as contagens ficam ZERADAS, nao "todo mundo sem
    // endereco". Sao coisas diferentes e exigem acoes diferentes: `0 enviados,
    // 4 sem endereco` manda investigar o cadastro dos usuarios, quando o que
    // havia era uma variavel de ambiente faltando. Quem responde isso e
    // `email_desligado`, sozinho.
    const { paraEnviar, recusaram, semEndereco } = canalLigado
      ? separarDestinatarios(
          novos,
          (u) => prefs.get(u),
          (u) => emails.get(u)
        )
      : { paraEnviar: [], recusaram: 0, semEndereco: 0 };

    const email = await enviarEmails(paraEnviar);

    // O id da mensagem no provedor fica gravado na linha do aviso. E com ele
    // que se confere a entrega no painel depois -- sem isso o unico registro
    // de que o e-mail saiu seria um contador numa resposta HTTP que ninguem
    // guarda.
    //
    // Um UPDATE por aviso porque cada um tem um id de mensagem diferente;
    // `novos` e um punhado de linhas por dia.
    for (const e of email.entregues) {
      const { error: erroMarcar } = await admin
        .from("bill_notifications")
        .update({ emailed_at: new Date().toISOString(), email_message_id: e.messageId })
        .eq("id", e.id);

      // Nao derruba a execucao: o e-mail JA SAIU. Perder a marcacao faz o
      // proximo cron... nao reenviar nada, porque quem decide isso e a UNIQUE
      // sobre `novos`, nao esta coluna. O custo real e so ficar sem o id para
      // conferir, e isso vale uma linha no log, nao um 500.
      if (erroMarcar) {
        console.error("Cron: e-mail enviado mas nao marcado:", e.id, erroMarcar.message);
      }
    }

    return {
      status: 200,
      body: {
        ok: true,
        avisos: novos.length,
        ja_avisados: lista.length - novos.length,
        push: enviados,
        assinaturas_removidas: removidos,
        push_desligado: pushDesligado,
        // A queda de volta para a chave do 009, se ela aconteceu. `true` aqui
        // significa: o aviso saiu, mas a 057 ainda nao esta colada e por isso a
        // conta de grupo avisou so o dono naquele dia. E o campo que torna a
        // degradacao LEGIVEL em `cron_runs` em vez de invisivel.
        unique_antiga: uniqueAntiga,
        // Daqui para baixo e o que vai para `cron_runs.result` sobre o e-mail.
        // `email_desligado` e o campo que esta issue existe para criar: sem
        // ele, um canal sem chave de API e um canal funcionando respondem o
        // mesmo 200, que foi exatamente como o push passou meses morto.
        email: email.enviados,
        email_desligado: email.desligado,
        email_remetente_sandbox: email.sandbox,
        email_recusado: recusaram,
        email_sem_endereco: semEndereco + email.semEndereco,
        email_falhas: email.falhas,
      },
    };
  });

  return NextResponse.json(saida.body, { status: saida.status });
}
