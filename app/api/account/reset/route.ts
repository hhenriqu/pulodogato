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
// -----------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import {
  PLANO_DE_RESET,
  confirmacaoValida,
  resetCompleto,
  totalApagado,
  type ResultadoDePasso,
} from "@/lib/account-reset";

export const dynamic = "force-dynamic";

const BUCKET_DE_COMPROVANTES = "receipts";

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
  supabase: ReturnType<typeof createClient>,
  userId: string
): Promise<ResultadoDePasso> {
  const passo: ResultadoDePasso = {
    tabela: "storage:receipts",
    rotulo: "Arquivos de comprovante",
    apagadas: 0,
  };

  try {
    let apagados = 0;

    // `list` pagina. Sem o laco, uma conta com mais de 100 comprovantes teria
    // os primeiros 100 apagados e o resto deixado para tras -- e a resposta
    // diria "100 arquivos apagados", que soa como sucesso.
    for (;;) {
      const { data: arquivos, error } = await supabase.storage
        .from(BUCKET_DE_COMPROVANTES)
        .list(userId, { limit: 100 });

      if (error) {
        passo.apagadas = null;
        passo.erro = error.message;
        return passo;
      }

      if (!arquivos || arquivos.length === 0) break;

      const caminhos = arquivos.map((a) => `${userId}/${a.name}`);
      const { error: erroRemocao } = await supabase.storage
        .from(BUCKET_DE_COMPROVANTES)
        .remove(caminhos);

      if (erroRemocao) {
        passo.apagadas = null;
        passo.erro = erroRemocao.message;
        return passo;
      }

      apagados += caminhos.length;

      // A RLS do bucket restringe a pasta ao dono, entao `list` so devolve o
      // que este usuario pode apagar. Se mesmo assim uma pagina voltar cheia e
      // nada sair, parar aqui evita laco infinito.
      if (arquivos.length < 100) break;
    }

    passo.apagadas = apagados;
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

  const passos: ResultadoDePasso[] = [];

  for (const etapa of PLANO_DE_RESET) {
    const { error, count } = await supabase
      .from(etapa.tabela)
      .delete({ count: "exact" })
      .eq(etapa.coluna, user.id);

    if (error) {
      // Nao abortamos o laco. O passo seguinte pode muito bem funcionar, e uma
      // tabela a menos e melhor do que parar na primeira -- o relatorio conta
      // exatamente o que ficou.
      console.error(`Reset: falha ao limpar ${etapa.tabela}:`, error);
      passos.push({
        tabela: etapa.tabela,
        rotulo: etapa.rotulo,
        apagadas: null,
        erro: error.message,
      });
      continue;
    }

    passos.push({
      tabela: etapa.tabela,
      rotulo: etapa.rotulo,
      apagadas: count ?? 0,
    });
  }

  passos.push(await apagarComprovantes(supabase, user.id));

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
      passos,
      grupos_restantes: gruposRestantes ?? 0,
    },
    // 207 e nao 500: uma parte do trabalho foi feita, e a resposta traz o
    // detalhe de qual. Um 500 aqui faria a tela dizer "falhou" sobre uma conta
    // que ja esta meio apagada.
    { status: completo ? 200 : 207 }
  );
}
