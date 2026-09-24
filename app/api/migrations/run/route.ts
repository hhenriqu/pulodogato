import { createClient } from "@/utils/supabase/server";
import { requireAdmin } from "@/utils/supabase/admin";
import { NextResponse } from "next/server";

// Este endpoint NAO executa migracoes - nunca executou, apesar do nome e da
// mensagem antiga dizerem que sim. Ele so reporta se o schema ja esta aplicado.
// Migracao continua sendo manual, via SQL Editor do Supabase.
//
// Mesmo sendo leitura, e restrito a admin desde a HMO-150: ate entao bastava
// estar logado. O que ele devolve nao e dado de usuario, mas e inventario de
// infraestrutura -- quais migracoes existem, quais faltam e o caminho dos
// arquivos. Isso descreve o estado do banco para quem nao tem nada que ver com
// ele, e o nome da rota promete um poder (`/run`) que ela nao tem: se algum dia
// alguem implementar o POST que o nome sugere, o furo ja estaria aberto.
//
// Ate 2026-09-18 ele listava 002_personal_finance.sql, 003_expense_groups.sql e
// 004_financial_extensions.sql, arquivos que nunca existiram no repositorio.
// As migracoes reais estao em database/migrations/.

export const dynamic = "force-dynamic";

const MIGRATIONS = [
  {
    name: "001_baseline.sql",
    description: "Schema completo (16 tabelas) + seed de referencia",
    required: true,
    // Uma tabela representativa por migracao, so para detectar se rodou.
    probeTable: "financial_services",
  },
  {
    name: "002_rls_lockdown.sql",
    description: "Row Level Security e privilegios de role",
    required: true,
    probeTable: null, // nao da pra detectar RLS por fora; ver abaixo
  },
];

async function checkMigrationStatus(supabase: any) {
  const checks = [];

  for (const m of MIGRATIONS) {
    if (!m.probeTable) {
      checks.push({
        migration: m.name,
        status: "desconhecido",
        note:
          "Nao e verificavel por esta API. Rode `node scripts/extract-schema.mjs --audit` " +
          "ou a query de pg_class no fim de database/migrations/002_rls_lockdown.sql.",
      });
      continue;
    }

    const { error } = await supabase.from(m.probeTable).select("id").limit(1);
    checks.push({
      migration: m.name,
      status: error ? "nao instalado" : "instalado",
      probeTable: m.probeTable,
    });
  }

  return checks;
}

export async function GET() {
  try {
    // `requireAdmin` ja cobre o nao-autenticado (401) antes do nao-admin (403),
    // entao nao ha checagem de sessao separada aqui.
    const admin = await requireAdmin();
    if (!admin.ok) {
      return admin.response;
    }

    const supabase = createClient();

    return NextResponse.json({
      migrations: MIGRATIONS.map(({ name, description, required }) => ({
        name,
        description,
        required,
      })),
      status: await checkMigrationStatus(supabase),
      howToApply: [
        "Acesse https://supabase.com/dashboard → SQL Editor",
        "Execute database/migrations/001_baseline.sql",
        "Execute database/migrations/002_rls_lockdown.sql",
        "Confirme com: node scripts/extract-schema.mjs --audit",
      ],
      note: "Este endpoint é somente leitura. Ver database/README.md.",
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: "Erro ao verificar migrações", details: error.message },
      { status: 500 }
    );
  }
}
