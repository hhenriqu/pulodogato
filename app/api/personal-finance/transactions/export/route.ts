// GET /api/personal-finance/transactions/export?de=AAAA-MM-DD&ate=AAAA-MM-DD
//
// O CSV DA LISTA DE LANCAMENTOS: EXATAMENTE AS LINHAS QUE A TELA MOSTRA
// ---------------------------------------------------------------------
// O botao "Exportar CSV" de /dashboard/personal-finance aponta para ca, e nao
// para /api/reports/export?report=transactions, que era o caminho obvio porque
// ja existe e ja monta CSV. A tentativa foi feita e desfeita: aquela rota
// responde uma pergunta PARECIDA e diferente, e as duas diferencas sao do tipo
// que ninguem descobre olhando o arquivo.
//
//   * Ela faz `.is("group_id", null)` -- exclui os lançamentos de grupo. A tela
//     MOSTRA esses lançamentos, com o nome do grupo ao lado (HMO-175): quem
//     pagou o restaurante de R$ 300 desembolsou os R$ 300, e a linha e dele.
//     Exportando por la, o mes em que houve um jantar de grupo sai com R$ 300 a
//     menos do que a tela somou -- um CSV completo, plausivel e menor.
//
//   * Ela nao filtra `service_id`. Ha tres servicos no seed
//     (personal_finance, investments, goals), e a tela le so o primeiro. O
//     arquivo sairia com linhas que a lista nunca mostrou.
//
// Uma divergencia dessas nao aparece: o arquivo abre, tem cabecalho, tem
// numeros com duas casas e soma sozinho na planilha. Quem conferir vai concluir
// que a TELA esta errada.
//
// O que continua compartilhado e o que de fato e o mesmo: o formato do CSV
// (separador `;`, decimal com virgula, BOM na frente) e os cabecalhos de
// download, que saem de lib/services/reports.ts. Duplicar aquilo daria dois
// dialetos de CSV no mesmo produto. O que e diferente aqui -- e so isso -- e a
// consulta, que e justamente o que tem que ser diferente.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { montarCsv, cabecalhosCsv } from "@/lib/services/reports";
import { periodoCorrente, periodoDaQuery } from "@/lib/periodo-do-painel";
import {
  classificarMovimentacao,
  type TipoMovimentacao,
} from "@/lib/movimentacoes";

/**
 * Teto de linhas do arquivo.
 *
 * Um export nao pagina -- um CSV pela metade e pior que nenhum, porque a
 * planilha soma o que recebeu e nao sabe o que faltou. Entao o teto nao CORTA:
 * quando ele e alcancado a rota recusa e diz para estreitar o periodo. Dez mil
 * lançamentos num periodo de financas pessoais nao acontece; o numero existe
 * para que o dia em que acontecer seja um erro legivel e nao um arquivo curto.
 */
const TETO_DE_LINHAS = 10000;

/**
 * O rotulo do tipo, e ele NAO sai direto de `transaction_type`.
 *
 * Provado em producao em 2026-09-29: ha linha em `financial_transactions` com
 * `transaction_type` NULO. Uma delas nasceu do POST desta mesma pasta, que nao
 * grava a coluna. Lendo `ROTULO[l.transaction_type]` a coluna "Tipo" do CSV sai
 * VAZIA para essas linhas -- enquanto a TELA mostra "Despesa" na mesma linha,
 * porque ela classifica por `classificarMovimentacao`, que cai para
 * `category.is_expense` e depois para o sinal do valor quando a coluna falta.
 *
 * Duas respostas diferentes para a mesma linha, uma na tela e outra no arquivo,
 * e o defeito que esta rota existe para nao ter (ver o cabecalho). Entao a
 * classificacao aqui e a MESMA funcao da tela, e por isso o `select` pede
 * `is_expense` junto com o nome da categoria.
 */
const ROTULO_DO_TIPO: Record<TipoMovimentacao, string> = {
  income: "Receita",
  expense: "Despesa",
  transfer: "Transferência",
};

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const url = new URL(request.url);
    const doPedido = periodoDaQuery(
      url.searchParams.get("de"),
      url.searchParams.get("ate")
    );

    // Invalido e diferente de ausente, e a rota trata os dois de formas
    // diferentes de proposito (ver `periodoDaQuery`): um par corrompido vira
    // 400, porque responder setembro a quem pediu julho entrega o arquivo
    // errado com 200 e quem chamou nao tem como saber.
    if (doPedido === "invalido") {
      return NextResponse.json(
        {
          error:
            "de e ate devem ser datas AAAA-MM-DD válidas, as duas presentes, com de anterior ou igual a ate",
        },
        { status: 400 }
      );
    }

    // Sem periodo nenhum, o mes corrente -- que e o que a tela abre. E o
    // periodo vai no NOME do arquivo, entao nao ha como confundir o que veio.
    const periodo = doPedido ?? periodoCorrente();

    const { data: service } = await supabase
      .from("financial_services")
      .select("id")
      .eq("name", "personal_finance")
      .single();

    if (!service) {
      return NextResponse.json(
        { error: "Serviço de finanças pessoais não encontrado" },
        { status: 404 }
      );
    }

    // Os MESMOS filtros da tela: meu usuario, o servico de financas pessoais, o
    // periodo escolhido, e nenhum recorte por grupo. `transaction_date` e `date`
    // no banco (001), entao `gte`/`lte` sao exatos e inclusivos nos dois
    // extremos, sem armadilha de fuso.
    //
    // A ordem tambem e a da tela, e pelo mesmo motivo que lá: `transaction_date`
    // empata dentro do dia, e sem desempate por `created_at` e `id` a ordem das
    // linhas empatadas nao e prometida por nada -- o arquivo de hoje e o de
    // amanha sairiam com as mesmas linhas em ordem diferente, e um `diff` entre
    // os dois acusaria mudanca que nao houve.
    const { data, error } = await supabase
      .from("financial_transactions")
      .select(
        "transaction_date, description, amount, transaction_type, category_id, account_id, group_id, notes"
      )
      .eq("user_id", user.id)
      .eq("service_id", service.id)
      .gte("transaction_date", periodo.de)
      .lte("transaction_date", periodo.ate)
      .order("transaction_date", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(0, TETO_DE_LINHAS);

    if (error) {
      console.error("Erro ao ler lançamentos para export:", error);
      return NextResponse.json(
        { error: "Não foi possível ler os lançamentos" },
        { status: 500 }
      );
    }

    const linhas = data ?? [];

    // `range(0, TETO)` pede TETO + 1 linhas justamente para saber se passou do
    // teto, em vez de descobrir tarde que o arquivo estava cortado no limite.
    if (linhas.length > TETO_DE_LINHAS) {
      return NextResponse.json(
        {
          error: `O período tem mais de ${TETO_DE_LINHAS} lançamentos. Exporte em períodos menores — um CSV cortado no meio soma errado na planilha sem avisar.`,
        },
        { status: 400 }
      );
    }

    // Nomes de categoria, conta e grupo, em tres consultas em lote em vez de
    // joins: as linhas repetem muito as mesmas chaves, e o `select` aninhado do
    // PostgREST traria o objeto inteiro por linha.
    const ids = <T,>(lista: (T | null | undefined)[]) =>
      Array.from(new Set(lista.filter(Boolean))) as T[];

    const catIds = ids(linhas.map((l) => l.category_id));
    const contaIds = ids(linhas.map((l) => l.account_id));
    const grupoIds = ids(linhas.map((l) => l.group_id));

    // `is_expense` entra no select das CATEGORIAS porque a classificacao do tipo
    // precisa dela quando `transaction_type` vem nulo -- ver `ROTULO_DO_TIPO`.
    const vazioCat = {
      data: [] as { id: string; name: string; is_expense: boolean }[],
    };
    const vazio = { data: [] as { id: string; name: string }[] };
    const [{ data: categorias }, { data: contas }, { data: grupos }] =
      await Promise.all([
        catIds.length
          ? supabase
              .from("transaction_categories")
              .select("id, name, is_expense")
              .in("id", catIds)
          : Promise.resolve(vazioCat),
        contaIds.length
          ? supabase
              .from("financial_accounts")
              .select("id, name")
              .in("id", contaIds)
          : Promise.resolve(vazio),
        grupoIds.length
          ? supabase.from("expense_groups").select("id, name").in("id", grupoIds)
          : Promise.resolve(vazio),
      ]);

    const nomeCat = new Map((categorias ?? []).map((c) => [c.id, c.name]));
    const gastoDaCat = new Map(
      (categorias ?? []).map((c) => [c.id, c.is_expense])
    );
    const nomeConta = new Map((contas ?? []).map((c) => [c.id, c.name]));
    const nomeGrupo = new Map((grupos ?? []).map((g) => [g.id, g.name]));

    const csv = montarCsv(
      [
        "Data",
        "Descrição",
        "Categoria",
        "Conta",
        "Tipo",
        "Grupo",
        "Valor",
        "Observações",
      ],
      linhas.map((l) => [
        String(l.transaction_date).slice(0, 10).split("-").reverse().join("/"),
        l.description,
        nomeCat.get(l.category_id) ?? "",
        l.account_id ? nomeConta.get(l.account_id) ?? "" : "",
        ROTULO_DO_TIPO[
          classificarMovimentacao({
            amount: Number(l.amount),
            transaction_type: l.transaction_type,
            category: { is_expense: gastoDaCat.get(l.category_id) },
          })
        ],
        // A coluna "Grupo" existe porque as linhas de grupo ENTRAM neste
        // arquivo. Sem ela, uma despesa de R$ 300 rateada entre tres pessoas e
        // indistinguivel de uma despesa pessoal de R$ 300 -- e a planilha soma
        // as duas igual.
        l.group_id ? nomeGrupo.get(l.group_id) ?? "" : "",
        // O valor sai com o SINAL do banco, de proposito: despesa negativa.
        // Numa planilha e isso que faz a coluna somar sozinha para o saldo do
        // periodo. As telas e que precisam de ABS.
        Number(l.amount),
        l.notes ?? "",
      ])
    );

    // O periodo no nome, com os DIAS: dois recortes diferentes do mesmo mes nao
    // podem chegar a pasta de downloads com o mesmo nome (HMO-152).
    return new NextResponse(
      csv,
      { headers: cabecalhosCsv(`lancamentos-${periodo.de}-a-${periodo.ate}.csv`) }
    );
  } catch (erro) {
    console.error("Erro ao exportar lançamentos:", erro);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
