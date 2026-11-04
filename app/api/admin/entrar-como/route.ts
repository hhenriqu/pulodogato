import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { requireAdmin } from "@/utils/supabase/admin";
import {
  COOKIE_ENTROU_COMO,
  COOKIE_VOLTA_DO_ADMIN,
  DURACAO_DA_VOLTA_EM_SEGUNDOS,
  escreverEntrouComo,
  pessoasQuePossoAssumir,
  possoAssumir,
  type MembroDoGrupo,
} from "@/lib/entrar-como";

/**
 * "Entrar como" -- ver `lib/entrar-como.ts`.
 *
 * GET  lista quem o admin pode assumir (membros ativos dos grupos dele).
 * POST { user_id } troca a sessao do navegador pela do membro, guarda a volta
 *      do admin num cookie httpOnly e grava a entrada em `registro_entrar_como`.
 *
 * A service role so e usada para tres coisas que a sessao do admin nao
 * alcanca por RLS: ler os membros dos grupos dele com nome, gerar o link de
 * acesso do membro (sem enviar e-mail) e gravar o registro.
 */

export const dynamic = "force-dynamic";

function servico() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) return null;
  return createServiceClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Servico = NonNullable<ReturnType<typeof servico>>;

async function membrosDosMeusGrupos(
  admin: Servico,
  adminId: string
): Promise<MembroDoGrupo[]> {
  const { data: meus, error: e1 } = await admin
    .from("group_members")
    .select("group_id")
    .eq("user_id", adminId)
    .eq("status", "active");
  if (e1) throw e1;

  const grupos = Array.from(new Set((meus ?? []).map((m) => m.group_id)));
  if (grupos.length === 0) return [];

  const [{ data: membros, error: e2 }, { data: nomesDeGrupo, error: e3 }] =
    await Promise.all([
      admin
        .from("group_members")
        .select("group_id, user_id, status")
        .in("group_id", grupos),
      admin.from("expense_groups").select("id, name").in("id", grupos),
    ]);
  if (e2) throw e2;
  if (e3) throw e3;

  const ids = Array.from(
    new Set((membros ?? []).map((m) => m.user_id).filter(Boolean))
  ) as string[];
  const { data: perfis, error: e4 } = ids.length
    ? await admin.from("profiles").select("id, full_name, email").in("id", ids)
    : { data: [], error: null };
  if (e4) throw e4;

  const nomeDaPessoa = new Map(
    (perfis ?? []).map((p) => [p.id, p.full_name || p.email || null])
  );
  const nomeDoGrupo = new Map((nomesDeGrupo ?? []).map((g) => [g.id, g.name]));

  return (membros ?? []).map((m) => ({
    group_id: m.group_id,
    user_id: m.user_id,
    status: m.status,
    nome: m.user_id ? nomeDaPessoa.get(m.user_id) ?? null : null,
    grupo: nomeDoGrupo.get(m.group_id) ?? null,
  }));
}

function semServico() {
  return NextResponse.json(
    {
      error: "Entrar como não configurado. Falta SUPABASE_SERVICE_ROLE_KEY.",
    },
    { status: 503 }
  );
}

export async function GET() {
  const check = await requireAdmin();
  if (!check.ok) return check.response;

  const admin = servico();
  if (!admin) return semServico();

  try {
    const membros = await membrosDosMeusGrupos(admin, check.user.id);
    return NextResponse.json({
      pessoas: pessoasQuePossoAssumir(check.user.id, membros),
    });
  } catch (e) {
    console.error("[entrar-como] falha ao listar membros", e);
    return NextResponse.json(
      { error: "Não foi possível listar os membros dos seus grupos" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const check = await requireAdmin();
  if (!check.ok) return check.response;

  const admin = servico();
  if (!admin) return semServico();

  const jar = cookies();
  if (jar.get(COOKIE_VOLTA_DO_ADMIN)) {
    // Encadear (admin -> Lais -> Leticia) perderia a volta: o segundo POST
    // ja nao seria do admin. Na pratica o requireAdmin acima barra, mas a
    // mensagem aqui diz o que fazer.
    return NextResponse.json(
      { error: "Volte para a sua conta antes de entrar em outra" },
      { status: 409 }
    );
  }

  const body = await request.json().catch(() => null);
  const alvoId = typeof body?.user_id === "string" ? body.user_id : "";

  let membros: MembroDoGrupo[];
  try {
    membros = await membrosDosMeusGrupos(admin, check.user.id);
  } catch (e) {
    console.error("[entrar-como] falha ao conferir membros", e);
    return NextResponse.json(
      { error: "Não foi possível conferir os membros dos seus grupos" },
      { status: 500 }
    );
  }

  if (!possoAssumir(check.user.id, alvoId, membros)) {
    return NextResponse.json(
      { error: "Só dá para entrar como quem está num grupo ativo com você" },
      { status: 403 }
    );
  }

  const supabase = createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.refresh_token) {
    return NextResponse.json(
      { error: "Sessão do administrador não encontrada" },
      { status: 401 }
    );
  }

  const { data: alvo, error: eAlvo } = await admin.auth.admin.getUserById(
    alvoId
  );
  if (eAlvo || !alvo?.user?.email) {
    return NextResponse.json(
      { error: "Esse membro não tem e-mail de acesso" },
      { status: 422 }
    );
  }

  // generateLink NAO envia e-mail: devolve o token, que e trocado por sessao
  // aqui mesmo, no servidor. O membro nao recebe nada.
  const { data: link, error: eLink } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: alvo.user.email,
  });
  const tokenHash = link?.properties?.hashed_token;
  if (eLink || !tokenHash) {
    console.error("[entrar-como] falha ao gerar o acesso", eLink);
    return NextResponse.json(
      { error: "Não foi possível gerar o acesso do membro" },
      { status: 500 }
    );
  }

  const { data: registro, error: eRegistro } = await admin
    .from("registro_entrar_como")
    .insert({
      admin_id: check.user.id,
      alvo_id: alvoId,
      user_agent: request.headers.get("user-agent"),
    })
    .select("id")
    .single();
  if (eRegistro || !registro) {
    // Sem registro, sem entrada: o registro e a condicao, nao um extra.
    console.error("[entrar-como] falha ao gravar o registro", eRegistro);
    return NextResponse.json(
      { error: "Não foi possível registrar a entrada" },
      { status: 500 }
    );
  }

  const volta = JSON.stringify({
    refresh_token: session.refresh_token,
    admin_id: check.user.id,
    registro_id: registro.id,
  });

  const { error: eTroca } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (eTroca) {
    console.error("[entrar-como] falha ao trocar a sessao", eTroca);
    await admin
      .from("registro_entrar_como")
      .update({ saiu_em: new Date().toISOString() })
      .eq("id", registro.id);
    return NextResponse.json(
      { error: "Não foi possível entrar na conta do membro" },
      { status: 500 }
    );
  }

  const nome = pessoasQuePossoAssumir(check.user.id, membros).find(
    (p) => p.user_id === alvoId
  )?.nome;

  const seguro = process.env.NODE_ENV === "production";
  jar.set(COOKIE_VOLTA_DO_ADMIN, volta, {
    httpOnly: true,
    secure: seguro,
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_DA_VOLTA_EM_SEGUNDOS,
  });
  jar.set(COOKIE_ENTROU_COMO, escreverEntrouComo(nome ?? "outro membro"), {
    httpOnly: false,
    secure: seguro,
    sameSite: "lax",
    path: "/",
    maxAge: DURACAO_DA_VOLTA_EM_SEGUNDOS,
  });

  console.info(
    `[entrar-como] admin ${check.user.id} entrou como ${alvoId} (registro ${registro.id})`
  );

  return NextResponse.json({ ok: true, nome });
}
