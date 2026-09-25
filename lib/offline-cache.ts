// =====================================================
// O CATALOGO QUE O FORMULARIO PRECISA PARA EXISTIR OFFLINE
// =====================================================
// Lancar offline nao e so guardar a linha: e conseguir PREENCHER o formulario.
// Ele pede categoria e conta, e as duas listas vem do servidor -- junto com o
// `service_id`, que e NOT NULL na tabela e nao aparece em tela nenhuma.
//
// Sem isto, a fila funcionaria e nao serviria para nada: offline o seletor de
// categoria abriria vazio, e um formulario sem categoria nao passa na propria
// validacao. O modo offline pareceria simplesmente nao existir -- que e como
// este projeto ja perdeu o banner de instalacao e a pagina /offline.
//
// Guardado em localStorage, e nao no IndexedDB da fila, de proposito: sao
// poucos kilobytes, a leitura e sincrona (o formulario precisa deles na
// primeira pintura) e perder este cache nao perde dado nenhum -- ele e copia
// do que esta no servidor. A fila e o contrario: e copia unica, e por isso ela
// mora no armazenamento mais duravel.
// =====================================================

export const CHAVE_CATALOGO = "pulodogato:catalogo-lancamento";

export interface CategoriaEmCache {
  id: string;
  name: string;
  is_expense: boolean;
}

export interface ContaEmCache {
  id: string;
  name: string;
  account_type: string;
}

export interface CatalogoDeLancamento {
  serviceId: string;
  categorias: CategoriaEmCache[];
  contas: ContaEmCache[];
  /** Quando foi guardado, para a tela poder dizer de quando sao os dados. */
  guardadoEm: number;
}

type ArmazenamentoSimples = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function guardarCatalogo(
  storage: ArmazenamentoSimples,
  catalogo: CatalogoDeLancamento
): void {
  try {
    storage.setItem(CHAVE_CATALOGO, JSON.stringify(catalogo));
  } catch {
    // Cota estourada ou storage bloqueado. Nao pode derrubar o carregamento
    // normal da tela -- o preco e o modo offline vir sem catalogo depois.
  }
}

/**
 * Le o catalogo, recusando o que nao tem a forma esperada.
 *
 * Defensivo pelo mesmo motivo de `lerSessaoLembrada`: este valor sobrevive a
 * troca de versao do app, e um `JSON.parse` solto estoura no meio da montagem
 * da tela. A tela em branco resultante so sai com "limpar dados do site" --
 * uma instrucao que ninguem descobre sozinho.
 */
export function lerCatalogo(
  storage: ArmazenamentoSimples
): CatalogoDeLancamento | null {
  let cru: string | null;
  try {
    cru = storage.getItem(CHAVE_CATALOGO);
  } catch {
    return null;
  }
  if (!cru) return null;

  try {
    const v = JSON.parse(cru) as Partial<CatalogoDeLancamento>;
    if (typeof v?.serviceId !== "string" || !v.serviceId) return null;
    if (!Array.isArray(v.categorias)) return null;

    const categorias = v.categorias.filter(
      (c): c is CategoriaEmCache =>
        !!c && typeof c.id === "string" && typeof c.name === "string"
    );

    // Catalogo sem nenhuma categoria utilizavel e o mesmo que catalogo
    // nenhum: o formulario nao teria o que oferecer. Devolver um objeto vazio
    // aqui faria a tela mostrar um seletor vazio em vez do aviso de "abra uma
    // vez com conexao" -- de novo, a feature parecendo quebrada em vez de
    // explicada.
    if (categorias.length === 0) return null;

    return {
      serviceId: v.serviceId,
      categorias,
      contas: Array.isArray(v.contas)
        ? v.contas.filter(
            (c): c is ContaEmCache => !!c && typeof c.id === "string"
          )
        : [],
      guardadoEm:
        typeof v.guardadoEm === "number" && Number.isFinite(v.guardadoEm)
          ? v.guardadoEm
          : 0,
    };
  } catch {
    return null;
  }
}

export function esquecerCatalogo(storage: ArmazenamentoSimples): void {
  try {
    storage.removeItem(CHAVE_CATALOGO);
  } catch {
    // Idem.
  }
}

// =====================================================
// ABRIR A TELA DE LANCAMENTO QUANDO `getUser()` NAO DEU USUARIO
// =====================================================
// Este e o conserto do defeito que o Helio viu em 25/09, com o modo offline
// ja no ar: "funciona offline mas as categorias nao carregaram".
//
// A causa e uma linha que parecia uma guarda trivial:
//
//     const { data: { user } } = await supabase.auth.getUser();
//     if (!user) return;
//
// `getUser()` vai na rede. Quando a rede falha, o supabase-js **nao lanca**:
// ele devolve `user: null` com o erro ao lado. Entao o `return` seco saia da
// funcao ANTES do try/catch que sabia repor o catalogo -- e a tela terminava
// sem categoria, sem conta, sem `service_id` e sem usuario, **sem nenhum erro
// na tela**. A fila de lancamentos, que e a razao de existir do modo offline,
// ficava inalcancavel: o submit comeca com `if (!user)` e recusava com a
// mensagem errada ("preencha todos os campos obrigatorios").
//
// Por que a decisao mora aqui, e nao na pagina: o defeito nao era um calculo
// errado, era um caso que ninguem tinha escrito. Um caso que nao existe no
// codigo tambem nao existe no teste. Como tabela de casos exaustiva -- e com
// um teste que percorre os quatro -- o caso que falta passa a ser visivel.
// =====================================================

/** O que a tela de lancamento deve fazer quando o servidor nao confirmou o usuario. */
export type AberturaDaTela =
  /** O servidor confirmou: segue o carregamento normal. */
  | "seguir"
  /** Ninguem respondeu, e o aparelho tem o que repor: abre em modo offline. */
  | "repor-do-aparelho"
  /** Ninguem respondeu, e o aparelho nao tem nada. Nao ha o que inventar. */
  | "aparelho-vazio"
  /** O servidor respondeu que a sessao nao vale. Quem manda para /login e o layout. */
  | "desistir";

export interface UsuarioLembrado {
  id: string;
  email: string | null;
}

export interface EstadoDeAbertura {
  decisao: AberturaDaTela;
  /**
   * Quem usar para `user_id` na fila, quando a decisao e `repor-do-aparelho`.
   * Vem do bilhete de `lib/offline-session.ts`, que so e gravado quando o
   * SERVIDOR confirma a sessao -- e nao destrava leitura nenhuma: toda consulta
   * continua indo com o token de verdade e batendo na RLS.
   */
  usuario: UsuarioLembrado | null;
  /** O catalogo a repor, quando ha um. */
  catalogo: CatalogoDeLancamento | null;
}

export interface LeituraDeAbertura {
  /** `data.user` de `supabase.auth.getUser()`. */
  usuarioConfirmado: UsuarioLembrado | null;
  /**
   * `"recusa"` quando o servidor disse que o token nao vale, `"rede"` quando
   * ninguem respondeu. Use `classificarFalhaDeAuth()` do `offline-session` --
   * nao chute por `navigator.onLine`, que mente em wi-fi de hotel.
   */
  origemDaFalha: "rede" | "recusa";
  /** O bilhete da sessao confirmada, ou null. */
  sessaoLembrada: UsuarioLembrado | null;
  /** `lerCatalogo(localStorage)`. */
  catalogo: CatalogoDeLancamento | null;
}

export function decidirAbertura(leitura: LeituraDeAbertura): EstadoDeAbertura {
  // Vem primeiro e sozinho, como em `decidirSessao`: confirmado pelo servidor
  // manda, mesmo com catalogo velho no aparelho ou `navigator.onLine` mentindo.
  if (leitura.usuarioConfirmado) {
    return {
      decisao: "seguir",
      usuario: leitura.usuarioConfirmado,
      catalogo: null,
    };
  }

  // O servidor respondeu que nao. Repor o catalogo aqui seria mostrar as
  // categorias de uma sessao que o proprio servidor acabou de recusar.
  if (leitura.origemDaFalha === "recusa") {
    return { decisao: "desistir", usuario: null, catalogo: null };
  }

  // Daqui para baixo ninguem respondeu, e o aparelho e tudo o que ha.
  //
  // Os dois tem que existir. So o catalogo, sem bilhete, enche os seletores e
  // deixa a pessoa preencher um lancamento que a fila vai recusar no fim, por
  // falta de `user_id` -- o pior momento para descobrir. So o bilhete, sem
  // catalogo, e um formulario sem categoria: ele nao passa na propria
  // validacao.
  if (!leitura.sessaoLembrada || !leitura.catalogo) {
    return {
      decisao: "aparelho-vazio",
      usuario: leitura.sessaoLembrada,
      catalogo: null,
    };
  }

  return {
    decisao: "repor-do-aparelho",
    usuario: leitura.sessaoLembrada,
    catalogo: leitura.catalogo,
  };
}
