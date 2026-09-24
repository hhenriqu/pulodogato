// GET /api/anomalies
//
// "Este mes esta fora do meu normal?" -- por categoria e por estabelecimento,
// sobre o mes CORRENTE, comparando janela contra janela (os primeiros N dias de
// agora contra os primeiros N dias de cada mes anterior).
//
// A aritmetica inteira -- e cada armadilha dela -- mora em lib/anomalies.ts,
// com teste unitario proprio (`npm run test:anomalies`). A leitura mora em
// lib/services/monthly-summary.ts, compartilhada com o cron do resumo, para que
// a tela e a notificacao nunca discordem sobre o mesmo numero.
//
// E leitura pura: nao existe tabela de anomalia e nao deve existir. O resultado
// muda a cada transacao importada, e materializar exigiria trigger em
// financial_transactions so para economizar uma consulta que ja e barata (sete
// meses de despesa de um usuario).
//
// `?hoje=` existe para a tela poder inspecionar um dia especifico e para o
// teste manual nao depender do calendario. Nao afrouxa nada: a rota continua
// exigindo sessao, e a leitura continua filtrada por `user.id`.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { today } from "@/lib/recurrence";
import { isIsoDate } from "@/lib/recurrence-detector";
import { anomaliasDoUsuario } from "@/lib/services/monthly-summary";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const pedido = request.nextUrl.searchParams.get("hoje");
    if (pedido !== null && !isIsoDate(pedido)) {
      return NextResponse.json(
        { error: "O parâmetro `hoje` precisa ser uma data ISO (YYYY-MM-DD)." },
        { status: 400 }
      );
    }

    const hoje = pedido ?? today();

    const { anomalias, truncado } = await anomaliasDoUsuario(
      supabase,
      user.id,
      hoje
    );

    return NextResponse.json({
      mes: anomalias.mes,
      ateODia: anomalias.ateODia,
      // `temBase` e o que distingue "nao houve anomalia" de "ainda nao da para
      // saber". Sem ele a tela de quem acabou de instalar o app diria que esta
      // tudo normal, o que e uma afirmacao que os dados nao sustentam.
      temBase: anomalias.temBase,
      truncado,
      alertas: anomalias.alertas,
      categorias: anomalias.categorias,
      estabelecimentos: anomalias.estabelecimentos,
    });
  } catch (e) {
    console.error("Erro ao calcular as anomalias:", e);
    return NextResponse.json(
      { error: "Falha ao calcular as anomalias" },
      { status: 500 }
    );
  }
}
