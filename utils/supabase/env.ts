/**
 * Leitura das variáveis de ambiente do Supabase com mensagem de erro clara.
 *
 * Sem isso, uma variável ausente vira um erro críptico lá na frente
 * ("fetch failed", "Invalid URL") longe da causa real.
 */

const SETUP_HINT =
  "Copie .env.local.example para .env.local e preencha com os dados do seu projeto em https://supabase.com/dashboard";

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `Variável de ambiente ausente: ${name}. ${SETUP_HINT}`
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
      `A variável ${name} ainda está com o valor de exemplo ("${value}"). ${SETUP_HINT}`
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
      `NEXT_PUBLIC_SUPABASE_URL não é uma URL válida ("${url}"). ${SETUP_HINT}`
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
