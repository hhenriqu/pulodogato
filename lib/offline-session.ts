// =====================================================
// ABRIR O APP SEM REDE -- OU MANDAR PARA O LOGIN
// =====================================================
// Ate aqui, ficar sem internet DESLOGAVA a pessoa. Nao era uma tela vazia nem
// um erro: era o app voltando para /login, como se a sessao tivesse acabado.
//
// A causa esta em `useAuth`, e e uma linha so: `supabase.auth.getUser()`. Esse
// metodo SEMPRE vai na rede -- ele existe justamente para o servidor reconferir
// o token, e nao confiar no que esta guardado no aparelho. Sem rede ele falha,
// `user` vira null, e o layout do dashboard tem `if (!user) router.push
// ("/login")`. O app se comporta exatamente como se o token fosse invalido.
//
// Duas consequencias que sao piores do que parecem:
//
// 1. offline NAO da para logar de novo -- o login tambem precisa da rede. A
//    pessoa fica presa numa tela de login que nao pode funcionar;
// 2. a mesma coisa acontece quando o servidor de auth do Supabase cai. Um 500
//    de la nao quer dizer "a sua sessao acabou", mas o codigo antigo tratava
//    todo erro igual: uma instabilidade de minutos deslogaria todo mundo.
//
// Por isso a decisao mora aqui, fora do React: ela e uma tabela de casos, e a
// diferenca entre os casos e "quem respondeu nao" -- o servidor ou a rede.
//
// O QUE ENTRAR OFFLINE **NAO** SIGNIFICA: nao e permissao. Entrar aqui so
// destrava a casca do app, o que ja esta em cache e a fila de lancamentos
// (`lib/offline-queue.ts`). Toda leitura e toda escrita no servidor continuam
// passando pela RLS com o token de verdade. Uma sessao forjada no localStorage
// abre o menu e nao le um centavo de ninguem.
// =====================================================

/** O que o layout do dashboard deve fazer. */
export type DecisaoDeSessao =
  /** O servidor confirmou o token: segue normal. */
  | "entrar"
  /** Sem resposta do servidor, mas ha sessao guardada: abre em modo offline. */
  | "entrar-offline"
  /** Nao ha sessao utilizavel: manda para /login. */
  | "login";

/**
 * Quem disse "nao": a rede ou o servidor.
 *
 * Esta e a distincao que o codigo antigo nao fazia, e e ela que decide se a
 * pessoa continua dentro do app ou e mandada para uma tela de login que, sem
 * rede, nao tem como funcionar.
 */
export type OrigemDaFalha =
  /** A requisicao nao chegou, ou o servidor respondeu que esta com problema. */
  | "rede"
  /** O servidor respondeu, e a resposta foi "essa sessao nao vale". */
  | "recusa";

/**
 * Por quantos dias depois de `expires_at` a sessao guardada ainda abre o app
 * offline.
 *
 * O access token do Supabase dura 1 hora; quem mantem a pessoa logada e o
 * refresh token, e a validade DELE nao esta no que o navegador guarda -- nao
 * ha como consultar offline. Entao este numero e uma politica, nao um fato,
 * e o valor sai do unico jeito honesto de errar: para o lado de quem ficou uma
 * semana sem rede e ainda quer ver os proprios lancamentos.
 *
 * O limite existe para que um aparelho esquecido numa gaveta por um ano nao
 * abra o app em modo offline para quem o encontrar. E ele nao precisa ser
 * exato: assim que a rede voltar, o `getUser()` real manda -- e se o servidor
 * recusar, a pessoa vai para /login mesmo tendo entrado offline antes.
 */
export const DIAS_DE_GRACA_OFFLINE = 30;

const UM_DIA_EM_MS = 86_400_000;

export interface LeituraDeSessao {
  /** `supabase.auth.getUser()` devolveu um usuario. */
  usuarioConfirmado: boolean;
  /**
   * Quem disse nao, quando `usuarioConfirmado` e false. Use
   * `classificarFalhaDeAuth()` -- nao chute por `navigator.onLine`.
   */
  origemDaFalha: OrigemDaFalha;
  /**
   * `expires_at` da sessao guardada no aparelho, em milissegundos, ou null
   * quando nao ha sessao nenhuma. Vem de `getSession()`, que le o localStorage
   * e NAO vai na rede -- e por isso que ele responde offline.
   */
  sessaoLocalExpiraEm: number | null;
  /** `Date.now()` de quem chama -- parametro para o teste nao depender do relogio. */
  agora: number;
}

export function decidirSessao(leitura: LeituraDeSessao): DecisaoDeSessao {
  // Vem primeiro e sozinho: quando o servidor confirma, nada mais importa --
  // nem sessao local vencida, nem `navigator.onLine` dizendo que esta offline.
  // A palavra do servidor e a unica autoridade sobre o token.
  if (leitura.usuarioConfirmado) return "entrar";

  // O servidor respondeu, e respondeu que nao. Deslogar aqui esta certo, e
  // deixar entrar seria o bug oposto: manter no app alguem cuja sessao o
  // proprio servidor acabou de recusar.
  if (leitura.origemDaFalha === "recusa") return "login";

  // Daqui para baixo: ninguem respondeu. A sessao guardada e tudo o que ha.
  if (leitura.sessaoLocalExpiraEm === null) return "login";

  const diasVencida =
    (leitura.agora - leitura.sessaoLocalExpiraEm) / UM_DIA_EM_MS;

  // `diasVencida < 0` e o caso normal -- a sessao ainda nem venceu. Escrito
  // como comparacao de teto (e nao `if (venceu) ...`) para que o relogio do
  // aparelho adiantado nao vire um caso separado: uma data no futuro so deixa
  // este numero mais negativo, e continua passando.
  if (diasVencida > DIAS_DE_GRACA_OFFLINE) return "login";

  return "entrar-offline";
}

interface ErroDeAuth {
  name?: string;
  message?: string;
  status?: number;
}

/**
 * De quem foi o "nao": da rede ou do servidor de auth.
 *
 * Errar para o lado de "recusa" desloga quem so estava sem sinal. Errar para o
 * lado de "rede" mantem no app, por no maximo `DIAS_DE_GRACA_OFFLINE`, alguem
 * cuja sessao acabou -- sem destravar leitura nenhuma, porque a RLS nao ve
 * nada disto. Os dois erros nao custam o mesmo, e por isso o default e "rede":
 * so classificamos como recusa o que o servidor disse com todas as letras.
 */
export function classificarFalhaDeAuth(erro: unknown): OrigemDaFalha {
  // Sem erro e sem usuario: o servidor respondeu, e a resposta foi "nao ha
  // sessao". E o caso de quem nunca logou -- o mais comum dos dois.
  if (erro === null || erro === undefined) return "recusa";

  const e = erro as ErroDeAuth;

  // O nome que o supabase-js da a toda falha de transporte. Ele ja embrulhou o
  // TypeError do fetch, entao este teste e o mais confiavel dos quatro.
  if (e.name === "AuthRetryableFetchError") return "rede";

  // `status: 0` e o que sobra quando nao houve resposta HTTP nenhuma.
  if (e.status === 0) return "rede";

  // O auth do Supabase fora do ar NAO e a sessao da pessoa acabando. Tratar
  // 5xx como recusa transformaria uma instabilidade de minutos em logout de
  // todo mundo, e logout aqui e caro: offline ninguem consegue logar de volta.
  if (typeof e.status === "number" && e.status >= 500) return "rede";

  // Agora sim: 401/403 e o servidor dizendo que o token nao vale.
  if (typeof e.status === "number" && e.status >= 400 && e.status < 500) {
    return "recusa";
  }

  // Fetch cru, quando algo escapou do embrulho do supabase-js. As tres
  // mensagens sao dos tres motores -- Chrome, Firefox e Safari dizem coisas
  // diferentes para a MESMA falha de rede, e so o Safari nao contem "fetch".
  if (/failed to fetch|networkerror|load failed/i.test(e.message ?? "")) {
    return "rede";
  }

  return "rede";
}

/**
 * `expires_at` da sessao em milissegundos.
 *
 * O Supabase entrega esse campo em SEGUNDOS desde a epoca, e o resto do app
 * conta em milissegundos. Sem a conversao, `expires_at` de 2026 vira janeiro
 * de 1970 e toda sessao aparece vencida ha 56 anos -- ou seja, o modo offline
 * nunca abriria, e o sintoma seria exatamente o bug que ele veio consertar.
 */
export function expiracaoEmMs(
  sessao: { expires_at?: number | null } | null | undefined
): number | null {
  if (!sessao) return null;
  const segundos = sessao.expires_at;
  if (typeof segundos !== "number" || !Number.isFinite(segundos)) return null;
  return segundos * 1000;
}

// -----------------------------------------------------------------------------
// A SESSAO LEMBRADA -- POR QUE `getSession()` NAO BASTA
// -----------------------------------------------------------------------------
// `getSession()` le do armazenamento e nao vai na rede -- mas so enquanto o
// access token esta valido, e ele dura UMA HORA. Passado esse prazo, o proprio
// `getSession()` tenta renovar o token, a renovacao precisa de rede, e offline
// ele devolve `session: null`. Ou seja: o metodo que existe para funcionar sem
// rede para de funcionar sem rede exatamente uma hora depois -- e uma hora
// cobre quase nenhum dos casos que motivam o modo offline (uma noite, um voo,
// um fim de semana no sitio).
//
// (O supabase-js NAO apaga a sessao guardada quando a renovacao falha por
// rede; ele so apaga quando o servidor recusa. Mas o que sobra fica em cookie
// fatiado e codificado, e ler aquilo por fora seria depender de um detalhe
// interno da biblioteca que muda entre versoes menores.)
//
// Entao guardamos nosso proprio bilhete, gravado toda vez que o SERVIDOR
// confirma a sessao. Ele nao e credencial e nao abre nada sozinho: e so o
// registro de que este aparelho teve uma sessao confirmada, com a validade que
// ela tinha. Toda leitura e toda escrita continuam indo com o token de verdade
// e batendo na RLS -- forjar este bilhete na mao abre o menu do app e nao
// entrega um centavo de dado.
// -----------------------------------------------------------------------------

export const CHAVE_SESSAO_LEMBRADA = "pulodogato:sessao-lembrada";

export interface SessaoLembrada {
  id: string;
  email: string | null;
  /** `expires_at` da sessao confirmada, em milissegundos. */
  expiraEm: number;
}

type ArmazenamentoSimples = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function lembrarSessao(
  storage: ArmazenamentoSimples,
  sessao: SessaoLembrada
): void {
  try {
    storage.setItem(CHAVE_SESSAO_LEMBRADA, JSON.stringify(sessao));
  } catch {
    // Cota cheia ou navegacao anonima com storage bloqueado. Nao ha o que
    // fazer aqui e nao pode derrubar o login: o custo e o modo offline nao
    // abrir depois, nao a sessao de agora falhar.
  }
}

/**
 * Le o bilhete, recusando o que nao tem a forma esperada.
 *
 * A validacao nao e paranoia: o localStorage e compartilhado com tudo que roda
 * na origem, sobrevive a troca de versao do app e pode conter o formato antigo
 * de um dia. Um `JSON.parse` solto aqui estoura no BOOT do app -- antes de
 * qualquer tela -- e o sintoma seria uma pagina em branco que so um "limpar
 * dados do site" resolve.
 */
export function lerSessaoLembrada(
  storage: ArmazenamentoSimples
): SessaoLembrada | null {
  let cru: string | null;
  try {
    cru = storage.getItem(CHAVE_SESSAO_LEMBRADA);
  } catch {
    return null;
  }
  if (!cru) return null;

  try {
    const v = JSON.parse(cru) as Partial<SessaoLembrada>;
    if (typeof v?.id !== "string" || !v.id) return null;
    if (typeof v?.expiraEm !== "number" || !Number.isFinite(v.expiraEm)) {
      return null;
    }
    return {
      id: v.id,
      email: typeof v.email === "string" ? v.email : null,
      expiraEm: v.expiraEm,
    };
  } catch {
    return null;
  }
}

/**
 * Apaga o bilhete. Tem que ser chamado no logout.
 *
 * Sem isto, sair da conta e depois ficar sem rede reabriria o app na conta de
 * quem saiu: `getUser()` falharia por rede, e o bilhete antigo -- ainda dentro
 * da graca -- diria "pode entrar". A pessoa clicou em Sair e o app voltaria.
 */
export function esquecerSessao(storage: ArmazenamentoSimples): void {
  try {
    storage.removeItem(CHAVE_SESSAO_LEMBRADA);
  } catch {
    // Idem: nada a fazer, e nao pode impedir o logout de acontecer.
  }
}
