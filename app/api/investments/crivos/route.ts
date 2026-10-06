// -----------------------------------------------------------------------------
// OS CRIVOS DE FUNDAMENTO (HMO-195)
// -----------------------------------------------------------------------------
// GET devolve o que a lista de criterios precisa: os ativos da carteira, a linha
// de `public.cvm_indicadores` de cada um -- so o ULTIMO exercicio -- e o limite
// que o usuario escolheu. PUT grava o limite.
//
// POR QUE A COMPARACAO NAO ACONTECE AQUI
// --------------------------------------
// A regra da HMO-124 ("os numeros da tela vem das rotas, nunca calculados na
// tela") vale para o NUMERO, e ela e respeitada: ROE, margem e alavancagem sao
// derivados na VIEW, fonte unica, e esta rota nao recalcula nenhum deles -- ela
// os repassa. O que a tela faz e comparar esses numeros com um limite que o
// usuario esta digitando, e essa comparacao tem que ser local: a definicao de
// pronto exige que mudar o limite mude o resultado na tela, e uma ida ao
// servidor por tecla nao entrega isso.
//
// A comparacao e a MESMA funcao nos dois lados (`lib/crivos.ts`), e e por isso
// que ela pode morar no cliente sem reabrir o problema dos tres P/L da PETR4:
// duas implementacoes e que produzem dois resultados, nao dois lugares de
// execucao.
//
// A MIGRATION 028 PODE NAO ESTAR APLICADA
// ---------------------------------------
// Neste projeto migration nao tem runner: quem aplica e uma pessoa colando o
// arquivo no SQL Editor, e a 028 entrou na main em 30/09. Se a view nao existir,
// a leitura falha com 42P01 -- e a resposta certa NAO e um 500 que pinta a
// pagina de investimentos de vermelho. E `fonteIndisponivel: true`, que a tela
// imprime como frase ("a base nao respondeu agora; isto nao e reprovacao").
//
// O contrario -- deixar os tres campos vazios -- e exatamente o que a issue
// proibiu: vazio se le como "ainda carregando" ou como zero, e zero num crivo de
// divida APROVA.
// -----------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import {
  CRIVOS,
  CRIVOS_PENDENTES,
  FONTE_DECLARADA,
  lerLimites,
  limitesPadrao,
  mesclarLimites,
  ultimoExercicioPorTicker,
  validarLimites,
  type AtivoParaCrivos,
  type LinhaDeIndicadores,
} from "@/lib/crivos";

export const dynamic = "force-dynamic";

/** As colunas da view que a tela usa. Nada de preco: preco nao e CVM. */
const COLUNAS_DA_VIEW =
  "ticker, denominacao, ano_exercicio, data_base, roe, margem_liquida, divida_liquida_sobre_patrimonio";

/** O catalogo como a tela o consome -- rotulo, faixa aceita e fonte declarada. */
function catalogoParaATela() {
  return CRIVOS.map((crivo) => ({
    id: crivo.id,
    rotulo: crivo.rotulo,
    explicacao: crivo.explicacao,
    fonte: FONTE_DECLARADA[crivo.campo],
    direcao: crivo.direcao,
    unidade: crivo.unidade,
    limitePadrao: crivo.limitePadrao,
    limiteMinimo: crivo.limiteMinimo,
    limiteMaximo: crivo.limiteMaximo,
  }));
}

export async function GET() {
  try {
    const supabase = createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { data: ativos, error: erroAtivos } = await supabase
      .from("investment_assets")
      .select("id, symbol, name, type")
      .eq("user_id", user.id)
      .order("symbol", { ascending: true });

    if (erroAtivos) {
      console.error("Erro ao ler os ativos para os crivos:", erroAtivos);
      return NextResponse.json(
        { error: "Não foi possível carregar a sua carteira" },
        { status: 500 }
      );
    }

    const lista = (ativos || []) as AtivoParaCrivos[];

    // O perfil pode nao existir numa conta antiga -- e isso nao e erro. Sem
    // perfil valem os limites de fabrica, que e o que a tela abre mostrando.
    const { data: profile, error: erroPerfil } = await supabase
      .from("profiles")
      .select("preferences")
      .eq("id", user.id)
      .maybeSingle();

    if (erroPerfil) {
      console.error("Erro ao ler os limites dos crivos:", erroPerfil);
      return NextResponse.json(
        { error: "Não foi possível carregar os seus critérios" },
        { status: 500 }
      );
    }

    const limites = profile ? lerLimites(profile.preferences) : limitesPadrao();

    // So os tickers que a DFP da CVM pode cobrir. FII, renda fixa e ativo
    // internacional nao vao a view: perguntar por eles gastaria a consulta para
    // receber zero linha e o zero seria indistinguivel de "nao importado".
    const tickers = lista
      .filter((ativo) => ativo.type === "stock")
      .map((ativo) => String(ativo.symbol ?? "").trim().toUpperCase())
      .filter((t) => t !== "");

    let indicadores: LinhaDeIndicadores[] = [];
    let fonteIndisponivel = false;

    if (tickers.length > 0) {
      const { data: linhas, error: erroView } = await supabase
        .from("cvm_indicadores")
        .select(COLUNAS_DA_VIEW)
        .in("ticker", tickers);

      if (erroView) {
        // Ver o cabecalho: view ausente (028 nao aplicada) nao pode virar 500.
        console.error("cvm_indicadores indisponivel:", erroView);
        fonteIndisponivel = true;
      } else {
        // Uma linha por ticker, a do maior `ano_exercicio`. A view tem uma linha
        // por exercicio importado, e repassar todas faria o mesmo ticker
        // aparecer varias vezes na tela de quem chamasse esta rota sem agrupar.
        indicadores = [
          ...ultimoExercicioPorTicker(
            (linhas || []) as unknown as LinhaDeIndicadores[]
          ).values(),
        ];
      }
    }

    return NextResponse.json({
      ativos: lista,
      indicadores,
      limites,
      criterios: catalogoParaATela(),
      // O quarto crivo da issue, declarado como pendente em vez de omitido: um
      // criterio que simplesmente nao aparece se le como esquecimento.
      pendentes: CRIVOS_PENDENTES,
      fonteIndisponivel,
    });
  } catch (error) {
    console.error("Erro em GET /api/investments/crivos:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
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
      return NextResponse.json({ error: "Corpo inválido" }, { status: 400 });
    }

    const validado = validarLimites(body);
    if (!validado.ok) {
      return NextResponse.json({ error: validado.erro }, { status: 400 });
    }

    const { data: profile, error: erroLeitura } = await supabase
      .from("profiles")
      .select("preferences")
      .eq("id", user.id)
      .maybeSingle();

    if (erroLeitura) {
      console.error("Erro ao ler o perfil antes de gravar os crivos:", erroLeitura);
      return NextResponse.json(
        { error: "Não foi possível salvar os seus critérios" },
        { status: 500 }
      );
    }

    if (!profile) {
      return NextResponse.json({ error: "Perfil não encontrado" }, { status: 404 });
    }

    const { error: erroEscrita } = await supabase
      .from("profiles")
      .update({
        // Mescla o jsonb INTEIRO. `preferences` guarda painel, moeda,
        // notificacoes e privacidade; escrever `{ crivos: ... }` direto apagaria
        // tudo isso em silencio -- os criterios passariam a funcionar como o
        // usuario pediu enquanto o layout do painel voltava ao padrao.
        preferences: mesclarLimites(profile.preferences, validado.valor),
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    if (erroEscrita) {
      console.error("Erro ao gravar os limites dos crivos:", erroEscrita);
      return NextResponse.json(
        { error: "Não foi possível salvar os seus critérios" },
        { status: 500 }
      );
    }

    // Devolve o que ficou gravado, nao o que veio no corpo: ecoar a entrada
    // esconderia qualquer normalizacao e a tela mostraria um criterio que o banco
    // nao tem.
    return NextResponse.json({ limites: validado.valor });
  } catch (error) {
    console.error("Erro em PUT /api/investments/crivos:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
