// -----------------------------------------------------------------------------
// APAGAR TUDO E COMECAR DO ZERO (HMO-159)
// -----------------------------------------------------------------------------
// Executa o plano de lib/account-reset.ts. Toda a justificativa do desenho --
// por que a sessao do usuario e nao a chave de servico, por que grupo de
// despesa fica de fora, por que as contas padrao nao sao recriadas aqui --
// esta no cabecalho daquele arquivo.
//
// O QUE ESTA ROTA NAO TEM, E A AUSENCIA E O PONTO
// -----------------------------------------------
// Nao ha transacao. O supabase-js fala PostgREST, e PostgREST nao abre
// transacao que atravesse varias chamadas: cada DELETE e o seu proprio
// commit. Ou seja, um reset que falhar no meio NAO volta atras -- parte do
// dado ja foi.
//
// Envolver tudo numa funcao SQL resolveria isso, e foi considerado. Mas criar
// funcao exige migration, e migration neste projeto nao tem runner: a 019 esta
// na main desde 25/09 e ainda nao foi aplicada em producao. O botao nasceria
// morto para todo mundo ate alguem colar SQL num painel, e "morto" aqui quer
// dizer erro 500 numa tela de configuracao.
//
// O caminho escolhido e assumir o parcial e TORNA-LO VISIVEL: cada passo volta
// com a sua contagem ou com o seu erro, a rota devolve HTTP 207 quando algum
// falhou, e a tela escreve o que sobrou em vez de dizer "pronto!". Repetir o
// reset e seguro -- apagar o que ja foi apagado apaga zero linhas --, entao o
// conserto de um reset parcial e clicar de novo.
//
// O QUE FICA (24/10/2026)
// -----------------------
// Grupo, divisao com pessoa e MyBank ficam, e a conta de banco onde algum
// deles mora tambem. A regra e a ordem estao em lib/account-reset.ts
// (`executarPlano`); aqui mora so a traducao para o PostgREST
// (`bancoDaSessao`): as regras viram filtro do DELETE, e os elos viram
// `not.in.(...)` ou o apagamento por lotes.
// -----------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import {
  TAMANHO_DO_LOTE,
  confirmacaoValida,
  executarPlano,
  resetCompleto,
  totalApagado,
  totalMantido,
  type BancoDoReset,
  type ConjuntoQueFica,
  type ErroDoBanco,
  type PassoDeReset,
  type ResultadoDePasso,
} from "@/lib/account-reset";

export const dynamic = "force-dynamic";

// O apagamento por lotes pode passar dos 10 s do padrao numa conta grande com
// uma linha recusada: e o mesmo teto das rotas de cron.
export const maxDuration = 60;

const BUCKET_DE_COMPROVANTES = "receipts";

/** Quantas linhas o PostgREST devolve por pagina (o `max-rows` padrao). */
const PAGINA = 1000;

type Sessao = ReturnType<typeof createClient>;

/** Os metodos de filtro que as regras usam, no builder do PostgREST. */
interface Filtravel<T> {
  is(coluna: string, valor: null): T;
  or(expressao: string): T;
}

/**
 * As regras de "fica" como filtro do DELETE (ou da leitura do que sai).
 *
 * `comeca_com` vira `coluna IS NULL OR coluna NOT LIKE 'prefixo%'`: o
 * `NOT LIKE` sozinho e NULL sobre a linha sem anotacao, e ela ficaria. O teste
 * do plano garante uma regra dessas por passo, no maximo -- dois `or=` na
 * mesma URL nao sao um contrato do PostgREST em que valha apostar.
 */
function comAsRegras<T extends Filtravel<T>>(consulta: T, passo: PassoDeReset): T {
  let q = consulta;
  for (const regra of passo.ficam ?? []) {
    q =
      regra.quando === "preenchida"
        ? q.is(regra.coluna, null)
        : q.or(
            `${regra.coluna}.is.null,${regra.coluna}.not.like.${regra.prefixo ?? ""}%`
          );
  }
  return q;
}

/** Todas as linhas de uma leitura, de pagina em pagina. */
async function lerTudo(
  pagina: (
    de: number,
    ate: number
    // `unknown` e nao a linha: com a lista de colunas montada em tempo de
    // execucao, o tipo que o client infere para `data` e o de erro de parse.
  ) => PromiseLike<{ data: unknown; error: ErroDoBanco | null }>
): Promise<{ linhas: Record<string, unknown>[] | null; erro: ErroDoBanco | null }> {
  const linhas: Record<string, unknown>[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de, de + PAGINA - 1);
    if (error) return { linhas: null, erro: error };
    const lidas = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    linhas.push(...lidas);
    if (lidas.length < PAGINA) return { linhas, erro: null };
  }
}

/** Os valores nao nulos das colunas, sem repeticao. */
function idsDas(linhas: Record<string, unknown>[], colunas: string[]): string[] {
  const ids = new Set<string>();
  for (const linha of linhas) {
    for (const coluna of colunas) {
      const valor = linha[coluna];
      if (typeof valor === "string" && valor) ids.add(valor);
    }
  }
  return Array.from(ids);
}

/** O banco do reset, pela sessao do usuario (ver o cabecalho da lib). */
function bancoDaSessao(supabase: Sessao, userId: string): BancoDoReset {
  const conjuntos: Record<
    ConjuntoQueFica,
    () => Promise<{ ids: string[] | null; erro: ErroDoBanco | null }>
  > = {
    // As metas de grupo que eu vejo: as minhas e as dos meus grupos. A RLS de
    // `financial_goals` ja recorta; o `group_id` e o que separa.
    metas_de_grupo: async () => {
      const r = await lerTudo((de, ate) =>
        supabase
          .from("financial_goals")
          .select("id")
          .not("group_id", "is", null)
          .order("id")
          .range(de, ate)
      );
      return { ids: r.linhas ? idsDas(r.linhas, ["id"]) : null, erro: r.erro };
    },
    // As divisoes que eu vejo (expense_splits_select, 002): as dos meus
    // lancamentos e as em que sou a outra pessoa. As segundas nao casam com
    // lancamento meu nenhum, e nao atrapalham.
    lancamentos_divididos: async () => {
      const r = await lerTudo((de, ate) =>
        supabase
          .from("expense_splits")
          .select("transaction_id")
          .order("id")
          .range(de, ate)
      );
      return {
        ids: r.linhas ? idsDas(r.linhas, ["transaction_id"]) : null,
        erro: r.erro,
      };
    },
    // Depois do passo das contas previstas, as que sobraram sao as que ficam.
    lancamentos_das_contas_que_ficam: async () => {
      const r = await lerTudo((de, ate) =>
        supabase
          .from("scheduled_transactions")
          .select("transaction_id")
          .eq("user_id", userId)
          .not("transaction_id", "is", null)
          .order("id")
          .range(de, ate)
      );
      return {
        ids: r.linhas ? idsDas(r.linhas, ["transaction_id"]) : null,
        erro: r.erro,
      };
    },
    // Toda conta para onde aponta uma linha que ficou, mais a conta credora do
    // MyBank (ON DELETE RESTRICT, 053).
    contas_que_ficam: async () => {
      const leituras = [
        {
          colunas: ["account_id"],
          pagina: (de: number, ate: number) =>
            supabase
              .from("financial_transactions")
              .select("account_id")
              .eq("user_id", userId)
              .not("account_id", "is", null)
              .order("id")
              .range(de, ate),
        },
        {
          colunas: ["account_id", "destination_account_id"],
          pagina: (de: number, ate: number) =>
            supabase
              .from("scheduled_transactions")
              .select("account_id, destination_account_id")
              .eq("user_id", userId)
              .order("id")
              .range(de, ate),
        },
        {
          colunas: ["account_id", "destination_account_id"],
          pagina: (de: number, ate: number) =>
            supabase
              .from("recurring_rules")
              .select("account_id, destination_account_id")
              .eq("user_id", userId)
              .order("id")
              .range(de, ate),
        },
        {
          colunas: ["lender_account_id"],
          pagina: (de: number, ate: number) =>
            supabase
              .from("mybank_loans")
              .select("lender_account_id")
              .eq("lender_user_id", userId)
              .order("id")
              .range(de, ate),
        },
      ];
      const ids = new Set<string>();
      for (const leitura of leituras) {
        const r = await lerTudo(leitura.pagina);
        if (!r.linhas) return { ids: null, erro: r.erro };
        for (const id of idsDas(r.linhas, leitura.colunas)) ids.add(id);
      }
      return { ids: Array.from(ids), erro: null };
    },
  };

  return {
    async apagarDeUmaVez(passo, exclusoes) {
      let q = comAsRegras(
        supabase.from(passo.tabela).delete({ count: "exact" }).eq(passo.coluna, userId),
        passo
      );
      for (const exclusao of exclusoes) {
        q = q.not(exclusao.coluna, "in", `(${exclusao.ids.join(",")})`);
      }
      const { error, count } = await q;
      return { apagadas: error ? null : count ?? 0, erro: error };
    },

    async lerLinhasQueSaem(passo) {
      const colunas = Array.from(
        new Set(["id", ...(passo.elos ?? []).map((e) => e.coluna)])
      ).join(", ");
      return lerTudo((de, ate) =>
        comAsRegras(
          supabase.from(passo.tabela).select(colunas).eq(passo.coluna, userId),
          passo
        )
          .order("id")
          .range(de, ate)
      );
    },

    async apagarIds(passo, ids) {
      const { error, count } = await supabase
        .from(passo.tabela)
        .delete({ count: "exact" })
        .eq(passo.coluna, userId)
        .in("id", ids);
      return { apagadas: error ? null : count ?? 0, erro: error };
    },

    async contarRestantes(passo) {
      const { count, error } = await supabase
        .from(passo.tabela)
        .select("*", { count: "exact", head: true })
        .eq(passo.coluna, userId);
      return error ? null : count ?? 0;
    },

    lerConjunto(conjunto) {
      return conjuntos[conjunto]();
    },
  };
}

/**
 * Apaga os arquivos de comprovante do usuario no Storage.
 *
 * Precisa ser um passo proprio porque o Storage nao e o banco: apagar a linha
 * de `receipts` nao remove o arquivo, e o arquivo continua ocupando a cota da
 * conta e continua sendo um documento do usuario -- um "apaguei tudo" que
 * deixa os comprovantes no servidor nao apagou tudo.
 *
 * Varre a pasta em vez de ler `receipts.storage_path` de proposito: assim
 * pega tambem os orfaos, que existem por construcao. O upload grava o arquivo
 * ANTES de inserir a linha (app/api/receipts/route.ts), entao todo insert que
 * falhar depois de um upload bem-sucedido deixa um arquivo sem linha nenhuma
 * apontando para ele.
 */
async function apagarComprovantes(
  supabase: Sessao,
  userId: string,
  /** `storage_path` dos comprovantes que ficaram (os de acerto de grupo). */
  caminhosQueFicam: ReadonlySet<string>
): Promise<ResultadoDePasso> {
  const passo: ResultadoDePasso = {
    tabela: "storage:receipts",
    rotulo: "Arquivos de comprovante",
    apagadas: 0,
  };

  try {
    // PRIMEIRO A LISTA INTEIRA, DEPOIS A REMOCAO. `list` pagina, e o laco
    // antigo (listar 100, apagar 100, listar de novo) contava com a pasta
    // esvaziar: com arquivo que fica, a mesma pagina voltaria para sempre.
    // Sem paginar, uma conta com mais de 100 comprovantes teria os primeiros
    // 100 apagados e o resto deixado para tras -- e a resposta diria "100
    // arquivos apagados", que soa como sucesso.
    const caminhos: string[] = [];
    for (let offset = 0; ; offset += 100) {
      const { data: arquivos, error } = await supabase.storage
        .from(BUCKET_DE_COMPROVANTES)
        .list(userId, { limit: 100, offset });

      if (error) {
        passo.apagadas = null;
        passo.erro = error.message;
        return passo;
      }

      for (const a of arquivos ?? []) caminhos.push(`${userId}/${a.name}`);

      // A RLS do bucket restringe a pasta ao dono, entao `list` so devolve o
      // que este usuario pode apagar.
      if (!arquivos || arquivos.length < 100) break;
    }

    // O arquivo de um comprovante de acerto fica junto com a linha dele: o
    // grupo ve a linha, e a linha sem o arquivo seria um link quebrado.
    const saem = caminhos.filter((c) => !caminhosQueFicam.has(c));
    const ficam = caminhos.length - saem.length;

    let apagados = 0;
    for (let i = 0; i < saem.length; i += TAMANHO_DO_LOTE) {
      const lote = saem.slice(i, i + TAMANHO_DO_LOTE);
      const { error: erroRemocao } = await supabase.storage
        .from(BUCKET_DE_COMPROVANTES)
        .remove(lote);

      if (erroRemocao) {
        passo.apagadas = null;
        passo.erro = erroRemocao.message;
        return passo;
      }
      apagados += lote.length;
    }

    passo.apagadas = apagados;
    if (ficam > 0) {
      passo.mantidas = ficam;
      passo.motivos = ["arquivo de comprovante de acerto de grupo"];
    }
    return passo;
  } catch (erro) {
    passo.apagadas = null;
    passo.erro = erro instanceof Error ? erro.message : "erro desconhecido";
    return passo;
  }
}

export async function POST(request: Request) {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  if (
    !confirmacaoValida((body as { confirmacao?: unknown } | null)?.confirmacao)
  ) {
    return NextResponse.json(
      { error: "Digite a frase de confirmação para continuar" },
      { status: 400 }
    );
  }

  // Um passo que falha nao aborta o laco: o seguinte pode muito bem
  // funcionar, e uma tabela a menos e melhor do que parar na primeira -- o
  // relatorio conta exatamente o que ficou.
  const passos: ResultadoDePasso[] = await executarPlano(
    bancoDaSessao(supabase, user.id)
  );
  for (const passo of passos) {
    if (passo.erro || passo.recusadas) {
      console.error(`Reset: ${passo.tabela}:`, passo.erro ?? passo.motivoDaRecusa);
    }
  }

  // Os comprovantes que sobraram sao os de acerto de grupo (a regra do passo
  // `receipts`); os arquivos deles ficam. Sem conseguir ler quais sao, nenhum
  // arquivo sai: apagar o arquivo de uma linha que o grupo ve e pior do que
  // deixar um arquivo meu para o proximo clique.
  const { data: comprovantesQueFicam, error: erroDosQueFicam } = await supabase
    .from("receipts")
    .select("storage_path")
    .eq("user_id", user.id);

  if (erroDosQueFicam) {
    passos.push({
      tabela: "storage:receipts",
      rotulo: "Arquivos de comprovante",
      apagadas: null,
      erro: erroDosQueFicam.message,
    });
  } else {
    passos.push(
      await apagarComprovantes(
        supabase,
        user.id,
        new Set(
          (comprovantesQueFicam ?? [])
            .map((c) => c.storage_path)
            .filter((c): c is string => typeof c === "string")
        )
      )
    );
  }

  // O painel tambem volta de fabrica: "uma conta nova" nao herda a ordem de
  // blocos que a anterior escolheu. Isso mexe SO na chave `dashboard` --
  // moeda, fuso e privacidade continuam onde estao, porque sao identidade e
  // nao dado financeiro.
  const { data: perfil } = await supabase
    .from("profiles")
    .select("preferences")
    .eq("id", user.id)
    .maybeSingle();

  if (perfil) {
    const preferencesAtuais =
      typeof perfil.preferences === "object" && perfil.preferences !== null
        ? (perfil.preferences as Record<string, unknown>)
        : {};
    const { dashboard: _descartado, ...resto } = preferencesAtuais;

    const { error: erroPrefs } = await supabase
      .from("profiles")
      .update({ preferences: resto, updated_at: new Date().toISOString() })
      .eq("id", user.id);

    if (erroPrefs) {
      console.error("Reset: falha ao restaurar o painel padrão:", erroPrefs);
      passos.push({
        tabela: "profiles.preferences.dashboard",
        rotulo: "Configuração do painel",
        apagadas: null,
        erro: erroPrefs.message,
      });
    } else {
      passos.push({
        tabela: "profiles.preferences.dashboard",
        rotulo: "Configuração do painel",
        apagadas: preferencesAtuais.dashboard ? 1 : 0,
      });
    }
  }

  // Os grupos que o reset NAO tocou. Contar e devolver e o que impede a tela
  // de dizer "tudo limpo" para quem ainda tem despesa compartilhada aberta --
  // e o que da ao usuario o proximo passo, em vez de deixa-lo descobrir
  // sozinho que sobrou coisa.
  const { count: gruposRestantes } = await supabase
    .from("group_members")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  const completo = resetCompleto(passos);

  return NextResponse.json(
    {
      ok: completo,
      total_apagado: totalApagado(passos),
      total_mantido: totalMantido(passos),
      passos,
      grupos_restantes: gruposRestantes ?? 0,
    },
    // 207 e nao 500: uma parte do trabalho foi feita, e a resposta traz o
    // detalhe de qual. Um 500 aqui faria a tela dizer "falhou" sobre uma conta
    // que ja esta meio apagada.
    { status: completo ? 200 : 207 }
  );
}
