/**
 * Leitura das variáveis de ambiente do Supabase com mensagem de erro clara.
 *
 * Sem isso, uma variável ausente vira um erro críptico lá na frente
 * ("fetch failed", "Invalid URL") longe da causa real.
 */

const SETUP_HINT_LOCAL =
  "Copie .env.local.example para .env.local e preencha com os dados do seu projeto em https://supabase.com/dashboard";

// Na Vercel a dica de .env.local manda para o lugar errado: lá o arquivo não
// existe e o .env.production do repositório não chega ao build (a camada de
// Environment Variables do projeto o sombreia). Foi o que travou o primeiro
// deploy -- o log pedia .env.local quando o que faltava era o dashboard.
const SETUP_HINT_VERCEL =
  "Defina em Project Settings → Environment Variables, escopo Production, e redeploy. O .env.production versionado NÃO chega ao build na Vercel. Ver docs/DEPLOY_VERCEL.md.";

function setupHint(): string {
  return process.env.VERCEL ? SETUP_HINT_VERCEL : SETUP_HINT_LOCAL;
}

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `Variável de ambiente ausente: ${name}. ${setupHint()}`
    );
  }
  return value;
}

// Valores dos arquivos .env*.example. Se um deles chega aqui, alguém publicou
// um build com placeholder — falhar agora é muito melhor que falhar em produção.
const PLACEHOLDERS = [
  "your_supabase_url_here",
  "your_supabase_project_url",
  "your_supabase_anon_key",
  "your_supabase_anon_key_here",
];

function notPlaceholder(name: string, value: string): string {
  if (PLACEHOLDERS.includes(value.trim())) {
    throw new Error(
      `A variável ${name} ainda está com o valor de exemplo ("${value}"). ${setupHint()}`
    );
  }
  return value;
}

export function getSupabaseEnv() {
  const url = notPlaceholder(
    "NEXT_PUBLIC_SUPABASE_URL",
    required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL)
  );

  try {
    new URL(url);
  } catch {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL não é uma URL válida ("${url}"). ${setupHint()}`
    );
  }

  const anonKey = notPlaceholder(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
  );

  return { url, anonKey };
}
