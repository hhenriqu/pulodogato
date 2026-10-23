// GET /api/cron/group-closings   o fechamento dos grupos que fecham hoje
//
// O grupo com dia de fechamento (`expense_groups.closing_day`, 067) fecha o
// periodo no dia: o saldo de cada membro vira "Pagamento ao grupo" ou "A
// receber do grupo" (RN018). Esta rota percorre os grupos com dia configurado e
// chama `fecharOGrupo` (lib/services/fechamento-dos-grupos.ts) em cada um; a
// decisao de "e hoje?" e a aritmetica moram la e em lib/fechamento-por-periodo.ts.
//
// AINDA NAO ESTA NO vercel.json, DE PROPOSITO
// -------------------------------------------
// Ate a fase 4 do modelo novo, a parte de cada membro continua contando no
// realizado pelo rateio (033/046). Gerar "Pagamento ao grupo" antes disso conta
// a divida DUAS vezes para quem deve. A rota existe e responde; o agendamento
// entra junto com a leitura nova, na fase 4.
//
// POR QUE PRECISA DA service_role
// -------------------------------
// O cron roda sem usuario logado, le as despesas de TODOS os membros e e o
// unico que executa `registrar_fechamento_do_grupo` (o GRANT da 067). Sem as
// variaveis a rota responde 503 dizendo qual falta, como as outras rotas de
// cron, em vez de rodar a vazio.
//
// RE-EXECUTAVEL
// -------------
// Rodar duas vezes no mesmo dia nao gera nada duas vezes: o periodo fechado
// volta como `ja_fechado` (a UNIQUE da 067) ou `fora_do_dia` (o fim ja nao e
// depois do ultimo fechado).

import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import { comRegistro } from "@/lib/services/cron-ledger";
import { fecharOGrupo, type DesfechoDoGrupo } from "@/lib/services/fechamento-dos-grupos";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Teto de grupos por execucao, pelo mesmo motivo do MAX_USUARIOS da varredura. */
const MAX_GRUPOS = 500;

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
        error: `Fechamento dos grupos não configurado. Faltam: ${faltando.join(", ")}.`,
        hint: "Project Settings → Environment Variables, escopo Production.",
      },
      { status: 503 }
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${segredo}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const env = { url: url as string, serviceRole: serviceRole as string };

  const saida = await comRegistro("group-closings", env, async () => {
    const admin = createClient(env.url, env.serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // O dia em Sao Paulo, nao o do servidor: a Vercel roda em UTC, e das 21:00
    // em diante o servidor ja esta no dia seguinte.
    const hoje = today();

    const { data: grupos, error: erroGrupos } = await admin
      .from("expense_groups")
      .select("id, closing_day")
      .not("closing_day", "is", null)
      .eq("is_active", true)
      .limit(MAX_GRUPOS);

    if (erroGrupos) {
      console.error("Cron group-closings: erro ao listar grupos:", erroGrupos);
      return { status: 500, body: { error: "Falha ao listar os grupos" } };
    }

    const desfechos: DesfechoDoGrupo[] = [];
    const falhas: Array<{ group_id: string; erro: string }> = [];

    // Um grupo de cada vez: sao poucos, e a falha de um nao pode derrubar os
    // outros -- um grupo com dado estranho deixaria todo mundo sem fechamento.
    for (const grupo of grupos ?? []) {
      try {
        desfechos.push(await fecharOGrupo(admin, grupo, hoje));
      } catch (erro) {
        falhas.push({
          group_id: grupo.id,
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }
    }

    if (falhas.length) {
      console.error(`Cron group-closings: ${falhas.length} grupo(s) falharam`, falhas);
    }

    const contar = (d: DesfechoDoGrupo["desfecho"]) =>
      desfechos.filter((x) => x.desfecho === d).length;

    // Todos falharam = o job nao fez nada, e isso sai 500 para o painel da
    // Vercel nao mostrar verde.
    const todosFalharam = (grupos ?? []).length > 0 && falhas.length === (grupos ?? []).length;

    return {
      status: todosFalharam ? 500 : 200,
      body: {
        ok: !todosFalharam,
        hoje,
        grupos: (grupos ?? []).length,
        fechados: contar("fechado"),
        ja_fechados: contar("ja_fechado"),
        sem_membro_ativo: contar("sem_membro_ativo"),
        contas: desfechos.reduce((s, d) => s + (d.desfecho === "fechado" ? d.contas : 0), 0),
        falhas: falhas.length,
        truncated_grupos: (grupos ?? []).length >= MAX_GRUPOS,
      },
    };
  });

  return NextResponse.json(saida.body, { status: saida.status });
}
