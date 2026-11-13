// -----------------------------------------------------------------------------
// O MERCADO DO DIA (HMO-193, entrega 3)
// -----------------------------------------------------------------------------
// GET /api/investments/mercado
//   -> { altas, baixas, aviso, avisoDeAtraso, buscaDisponivel }
//
// GET /api/investments/mercado?ticker=PETR4
//   -> { cotacao }                    quando achou
//   -> { cotacao: null, mensagem }    quando nao achou, ou quando falta a chave
//
// Esta rota existe no servidor por duas razoes, nao uma:
//
//   1. `BRAPI_TOKEN` nao pode descer para o navegador;
//   2. o FILTRO DE LIQUIDEZ nao pode ser opcional. Se a tela chamasse a brapi
//      direto, qualquer outro consumidor -- uma tela nova, um widget, um
//      colega com pressa -- ligaria na lista crua e publicaria IGTI4F subindo
//      16% sobre quatro acoes. Passando por aqui, o filtro de lib/mercado.ts e
//      o unico caminho.
//
// Como /api/cambio, esta rota NAO TEM 5xx por falha do mundo: a brapi fora do
// ar volta 200 com ranking vazio e a frase do motivo. Cotacao de terceiro nao
// derruba a tela de investimentos, cujo dado principal (a carteira) vem do
// nosso banco e nao depende disto.
// -----------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { cotacaoDoTicker, listarPorVariacao, temTokenConfigurado } from "@/lib/brapi";
import {
  AVISO_DE_ATRASO,
  AVISO_NAO_E_RECOMENDACAO,
  type Direcao,
  lerCotacao,
  mensagemDaFalha,
  montarRanking,
  normalizarTicker,
} from "@/lib/mercado";

export const dynamic = "force-dynamic";

/** Quantas linhas cada ranking mostra. */
const TAMANHO_DO_RANKING = 10;

export async function GET(request: Request) {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const pedido = params.get("ticker");

  // ---------------------------------------------------------------- busca
  if (pedido !== null) {
    const ticker = normalizarTicker(pedido);

    if (ticker === null) {
      return NextResponse.json({
        cotacao: null,
        mensagem: mensagemDaFalha({ tipo: "ticker_invalido" }),
      });
    }

    const resultado = await cotacaoDoTicker(ticker);

    if (!resultado.ok) {
      return NextResponse.json({ cotacao: null, mensagem: mensagemDaFalha(resultado.falha) });
    }

    const cotacao = lerCotacao(resultado.bruta);

    if (cotacao === null) {
      return NextResponse.json({
        cotacao: null,
        mensagem: mensagemDaFalha({ tipo: "nao_encontrado", ticker }),
      });
    }

    return NextResponse.json({ cotacao });
  }

  // -------------------------------------------------------------- rankings
  const direcoes: readonly Direcao[] = ["altas", "baixas"];

  const [altas, baixas] = await Promise.all(
    direcoes.map(async (direcao) => {
      const resultado = await listarPorVariacao(direcao);

      if (!resultado.ok) {
        return {
          direcao,
          itens: [],
          recebidas: 0,
          mensagem: mensagemDaFalha(resultado.falha),
        };
      }

      const ranking = montarRanking(resultado.linhas, direcao, TAMANHO_DO_RANKING);

      return {
        direcao,
        itens: ranking.itens,
        recebidas: ranking.recebidas,
        removidas: ranking.removidas,
        mensagem: null,
      };
    }),
  );

  return NextResponse.json({
    altas,
    baixas,
    aviso: AVISO_NAO_E_RECOMENDACAO,
    avisoDeAtraso: AVISO_DE_ATRASO,
    buscaDisponivel: temTokenConfigurado(),
    // Quando o servidor mediu. Existe porque o bloco se chama "do DIA" e o
    // service worker guarda resposta de `/api/` por ate 24h (NetworkFirst,
    // `lib/pwa-runtime-cache.js`) -- sem rede, e tambem com rede lenta, a tela
    // recebe o JSON de ontem com todo campo no lugar e nada muda visualmente.
    // Um rotulo de dia sem eixo de tempo mente calado; com o carimbo, o ranking
    // de ontem se denuncia sozinho. A brapi nao publica hora propria na lista.
    apuradoEm: new Date().toISOString(),
  });
}
