/**
 * "Entrar como": o administrador do app entra na conta de quem divide um
 * grupo com ele, para conferir o fluxo da familia pelos olhos do outro membro.
 *
 * Este arquivo e a parte pura -- quem pode ser assumido e os nomes dos
 * cookies. A rota (`app/api/admin/entrar-como/route.ts`) faz o resto: a
 * checagem de admin no servidor, a troca de sessao e o registro na tabela
 * `registro_entrar_como` (migration 080).
 *
 * POR QUE SO MEMBRO DE GRUPO EM COMUM. O plano "admin" e do app inteiro; sem
 * este recorte, quem tem o plano entraria na conta de qualquer usuario
 * cadastrado. O caso de uso e a familia (Casa), entao o alcance e: quem esta
 * ATIVO num grupo onde o admin tambem esta ATIVO. Membro sem conta (077,
 * `user_id` nulo) nao tem login, entao nao aparece.
 */

/** Cookie httpOnly com o refresh token do admin, para o "Voltar para minha conta". */
export const COOKIE_VOLTA_DO_ADMIN = "pdg_volta_admin";

/**
 * Cookie legivel pela tela, so para o aviso no topo ("Voce esta como Lais").
 * Nao da acesso a nada: quem decide e o cookie httpOnly acima e a sessao.
 */
export const COOKIE_ENTROU_COMO = "pdg_entrou_como";

/** Quanto tempo a volta fica guardada. Passou disso, entra de novo com senha. */
export const DURACAO_DA_VOLTA_EM_SEGUNDOS = 4 * 60 * 60;

export interface MembroDoGrupo {
  group_id: string;
  user_id: string | null;
  status: string;
  nome?: string | null;
  grupo?: string | null;
}

export interface PessoaQuePossoAssumir {
  user_id: string;
  nome: string;
  grupos: string[];
}

/**
 * Quem o admin pode assumir: membros ATIVOS, com conta, dos grupos onde o
 * proprio admin esta ATIVO. O admin nunca aparece na propria lista. Cada
 * pessoa aparece uma vez, com os nomes dos grupos em comum.
 */
export function pessoasQuePossoAssumir(
  adminId: string,
  membros: MembroDoGrupo[]
): PessoaQuePossoAssumir[] {
  const meusGrupos = new Set(
    membros
      .filter((m) => m.user_id === adminId && m.status === "active")
      .map((m) => m.group_id)
  );

  const porPessoa = new Map<string, PessoaQuePossoAssumir>();

  for (const m of membros) {
    if (!m.user_id || m.user_id === adminId) continue;
    if (m.status !== "active") continue;
    if (!meusGrupos.has(m.group_id)) continue;

    const atual = porPessoa.get(m.user_id) ?? {
      user_id: m.user_id,
      nome: (m.nome ?? "").trim() || "Sem nome",
      grupos: [],
    };
    const grupo = (m.grupo ?? "").trim();
    if (grupo && !atual.grupos.includes(grupo)) atual.grupos.push(grupo);
    porPessoa.set(m.user_id, atual);
  }

  return Array.from(porPessoa.values()).sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR")
  );
}

/** O alvo pedido esta na lista de quem o admin pode assumir? */
export function possoAssumir(
  adminId: string,
  alvoId: string,
  membros: MembroDoGrupo[]
): boolean {
  if (!alvoId || alvoId === adminId) return false;
  return pessoasQuePossoAssumir(adminId, membros).some(
    (p) => p.user_id === alvoId
  );
}

/**
 * Le o cookie do aviso. Valor estragado vira `null`, nunca excecao.
 *
 * O `cookies().set` do Next ja codifica o valor (encodeURIComponent) ao
 * gravar, entao `escreverEntrouComo` devolve o JSON cru. A leitura decodifica
 * ate o texto virar JSON, porque o que chega do `document.cookie` vem
 * codificado uma vez -- e um valor gravado por quem codificou de novo (a
 * primeira versao desta funcao fazia isso) vem duas.
 */
export function lerEntrouComo(
  valor: string | undefined | null
): { nome: string } | null {
  if (!valor) return null;
  let texto = valor;
  for (let i = 0; i < 3 && !texto.trimStart().startsWith("{"); i++) {
    try {
      texto = decodeURIComponent(texto);
    } catch {
      return null;
    }
  }
  try {
    const obj = JSON.parse(texto);
    if (obj && typeof obj.nome === "string" && obj.nome.trim()) {
      return { nome: obj.nome.trim() };
    }
  } catch {
    // cookie estragado: sem aviso
  }
  return null;
}

/** Valor do cookie do aviso. Cru: o Next codifica ao gravar. */
export function escreverEntrouComo(nome: string): string {
  return JSON.stringify({ nome });
}
