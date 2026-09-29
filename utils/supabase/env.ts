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

// HMO-132. Num preview, variavel ausente e a configuracao ESCOLHIDA, nao um
// defeito: o escopo Preview ficou sem as variaveis de proposito.
//
// A dica de producao acima seria ativamente perigosa aqui. Ela manda "defina em
// Environment Variables e redeploy" -- e quem seguir isso encontra um dashboard
// que marca Production, Preview e Development por PADRAO, e assim remarca o
// Preview no banco real, desfazendo a decisao sem perceber. Por isso o preview
// tem dica propria, que explica o motivo e aponta o unico caminho seguro.
const SETUP_HINT_PREVIEW =
  "Este build e um preview deployment, e o escopo Preview foi deixado SEM as variaveis do Supabase de proposito (HMO-132): preview nenhum precisa subir para a main seguir, e preview ligado no banco real gravaria lancamento de verdade na conta do Helio. Falhar aqui e o resultado esperado -- producao nao e afetada. Se um dia preview precisar funcionar, aponte o escopo Preview para um projeto Supabase SEPARADO; nao remarque o escopo Preview nas variaveis de producao. Ver docs/DEPLOY_VERCEL.md.";

/**
 * Qual dica acompanha um erro de variavel ausente.
 *
 * Funcao pura (e exportada) porque a dica errada aqui nao quebra nada agora --
 * ela induz o leitor, meses depois, a reabrir o banco de producao para os
 * previews. Isso nao tem sintoma; so um teste segura.
 */
export function setupHintFor(
  onVercel: boolean,
  vercelEnv: string | undefined
): string {
  if (!onVercel) return SETUP_HINT_LOCAL;
  if (vercelEnv === "preview") return SETUP_HINT_PREVIEW;
  return SETUP_HINT_VERCEL;
}

function setupHint(): string {
  return setupHintFor(Boolean(process.env.VERCEL), process.env.VERCEL_ENV);
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

// O ref do projeto Supabase de producao. Ver docs/DEPLOY_VERCEL.md.
//
// Esta escrito aqui, e nao lido de um .env, de proposito: a pergunta que o
// guard abaixo responde e "este build esta apontando para o banco real?", e uma
// resposta que vem da mesma camada de configuracao que pode estar errada nao
// responde nada.
const PRODUCTION_PROJECT_REF = "odxqjvtxsioksguuevqm";

// Escotilha de saida, so para o caso de o guard errar o alvo. Fica como
// variavel de ambiente porque a alternativa -- guard sem desvio -- convida ao
// conserto pior, que e apagar o guard no codigo e nunca mais repor.
const PREVIEW_OVERRIDE = "PREVIEW_ALLOW_PRODUCTION_DB";

/**
 * `https://odxqjvtxsioksguuevqm.supabase.co` -> `odxqjvtxsioksguuevqm`.
 *
 * Devolve `null` para qualquer coisa que nao seja um host de projeto Supabase
 * (URL invalida, Supabase local em `127.0.0.1`, dominio proprio). `null` faz o
 * guard liberar: ele so sabe reconhecer o banco de producao, e o que ele nao
 * reconhece nao e producao.
 */
export function projectRefFromSupabaseUrl(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const match = hostname.match(/^([a-z0-9-]+)\.supabase\.[a-z.]+$/);
  return match ? match[1] : null;
}

/**
 * Um preview deployment esta prestes a escrever no banco de producao?
 *
 * Preview deployment na Vercel tambem e build de producao, e por isso passa
 * batido por qualquer checagem baseada em `NODE_ENV`. Quem separa os dois e o
 * `VERCEL_ENV`, que a plataforma define no build e no runtime.
 */
export function previewPointsAtProduction(
  vercelEnv: string | undefined,
  url: string,
  override: string | undefined
): boolean {
  if (vercelEnv !== "preview") return false;
  if (override === "1") return false;
  return projectRefFromSupabaseUrl(url) === PRODUCTION_PROJECT_REF;
}

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

  // HMO-132. Sem isto, abrir um PR cria uma URL publica que escreve no banco
  // real: um "criar transacao" de teste no preview vira lancamento de verdade
  // na conta do Helio, e nada na tela avisa. Falhar o build do preview e o
  // resultado desejado -- preview nenhum precisa subir para a main seguir.
  if (
    previewPointsAtProduction(
      process.env.VERCEL_ENV,
      url,
      process.env[PREVIEW_OVERRIDE]
    )
  ) {
    throw new Error(
      `Este preview deployment esta apontando para o banco de PRODUCAO ` +
        `(projeto ${PRODUCTION_PROJECT_REF}). Um teste feito aqui gravaria ` +
        `dado real. Em Project Settings → Environment Variables, tire o escopo ` +
        `Preview de NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY ` +
        `(deixar preview sem as variaveis derruba o build com mensagem clara), ` +
        `ou aponte o escopo Preview para um projeto Supabase separado. ` +
        `Para liberar mesmo assim: ${PREVIEW_OVERRIDE}=1.`
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
