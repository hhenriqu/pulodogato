// -----------------------------------------------------------------------------
// A COTACAO DO DIA DA COMPRA, PELA PTAX DO BANCO CENTRAL (HMO-182)
// -----------------------------------------------------------------------------
// GET /api/cambio?moeda=USD&data=2026-09-26
//   -> { moeda, taxa, dataDoBoletim, origem, editavel, mensagem }
//
// A decisao do Helio foi `ptax_editavel`. A parte "editavel" e o que dita o
// contrato desta rota, e ele e curto:
//
//     ESTA ROTA NAO TEM 5xx.
//
// A cotacao e obrigatoria para gravar (o CHECK da 026 nao deixa passar moeda
// estrangeira com cotacao 1), mas a BUSCA dela e uma conveniencia. Se um 500
// daqui travasse o formulario, o Banco Central fora do ar viraria "nao consigo
// lancar a despesa do jantar" -- e a pessoa esta no restaurante, no exterior,
// provavelmente no wi-fi ruim do hotel. Toda falha desce como 200 com a origem
// que explica o motivo, e o campo continua digitavel.
//
// Os unicos status de erro que sobram sao 401 (nao logado) e 400 (moeda que o
// app nao conhece, ou data fora de formato). Os dois sao defeito de chamada, nao
// do mundo.
//
// Quem fala com o Olinda e lib/ptax.ts, e quem decide o que e um boletim valido
// e lib/cambio.ts. Esta rota so traduz para HTTP e escreve a frase que a pessoa
// le -- inclusive a diferenca entre "nao publica" e "nao respondeu", que e a
// unica coisa que impede a tela de convidar alguem a tentar de novo para sempre
// uma cotacao que nunca existiu (guarani, peso, yuan).
// -----------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { moedaConhecida } from "@/lib/dinheiro";
import { precisaDeCotacao } from "@/lib/cambio";
import { cotacaoNaData } from "@/lib/ptax";

export const dynamic = "force-dynamic";

/** `2026-09-26` -> `26/09/2026`. So para a mensagem. */
function formatarBR(dataISO: string): string {
  const [ano, mes, dia] = dataISO.split("-");
  return `${dia}/${mes}/${ano}`;
}

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
  const moeda = String(params.get("moeda") ?? "")
    .trim()
    .toUpperCase();
  const data = String(params.get("data") ?? "").slice(0, 10);

  if (!moedaConhecida(moeda)) {
    return NextResponse.json({ error: "Moeda desconhecida" }, { status: 400 });
  }

  // BRL nao tem cotacao: ela e 1, e o CHECK da 026 exige que seja exatamente 1.
  // Responder aqui evita que a tela invente uma chamada ao Banco Central para
  // perguntar quanto vale um real em reais.
  if (!precisaDeCotacao(moeda)) {
    return NextResponse.json({
      moeda,
      taxa: 1,
      dataDoBoletim: null,
      origem: "ptax",
      editavel: false,
      mensagem: "Lançamento em reais: a cotação é 1.",
    });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    return NextResponse.json({ error: "Data inválida" }, { status: 400 });
  }

  const cotacao = await cotacaoNaData(moeda, data);

  const mensagem = (() => {
    switch (cotacao.origem) {
      case "ptax":
        return `PTAX de fechamento de ${formatarBR(data)}.`;
      case "ptax_anterior":
        return `${formatarBR(
          data
        )} não teve fechamento (fim de semana, feriado ou dia ainda em aberto). Usei a PTAX de ${formatarBR(
          cotacao.dataDoBoletim as string
        )}.`;
      case "sem_cobertura":
        return `O Banco Central não publica PTAX de ${moeda}. Informe a cotação usada na compra.`;
      case "indisponivel":
      default:
        return "Não consegui a cotação agora. Informe o valor — o lançamento salva normalmente.";
    }
  })();

  return NextResponse.json({
    moeda,
    taxa: cotacao.taxa,
    dataDoBoletim: cotacao.dataDoBoletim,
    origem: cotacao.origem,
    // Sempre editavel quando nao e BRL: e o "editavel" de `ptax_editavel`, e o
    // que garante que nenhuma falha do Banco Central trave o formulario.
    editavel: true,
    mensagem,
  });
}
