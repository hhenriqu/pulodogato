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
