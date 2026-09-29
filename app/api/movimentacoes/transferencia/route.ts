// ---------------------------------------------------------------------------
// TRANSFERENCIA ENTRE CONTAS PROPRIAS (HMO-164)
// ---------------------------------------------------------------------------
// Por que isto e uma rota, e nao mais um `supabase.from(...).insert(...)` na
// tela como receita e despesa: transferencia sao DUAS linhas que so fazem
// sentido juntas. Se a segunda falhar, a primeira tem que ser desfeita, e esse
// desfazer nao pode depender do navegador continuar aberto -- a pessoa fecha a
// aba e o dinheiro fica so saindo.
//
// O mesmo motivo faz a validacao morar aqui e nao so no formulario: o
// `account_type` que decide se uma conta pode ser origem tem que vir do banco.
// Vindo do cliente, bastaria mandar outro para gravar uma saida num cartao.
// ---------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import {
  mensagemDaTransferencia,
  pernasDaTransferencia,
  validarContasDaTransferencia,
  NOME_DA_CATEGORIA_DE_TRANSFERENCIA,
} from "@/lib/transferencia";
import { moedaSugerida } from "@/lib/moeda";

/**
 * A categoria reservada das pernas, criada sob demanda.
 *
 * `financial_transactions.category_id` e NOT NULL e transferencia nao tem
 * categoria -- ver `NOME_DA_CATEGORIA_DE_TRANSFERENCIA`. Nasce com
 * `is_active = false`, que e o que a mantem fora dos dois seletores de
 * categoria do app.
 *
 * O SELECT vem antes do INSERT de proposito, em vez de um upsert: se o usuario
 * ja tiver uma categoria com esse nome (a UNIQUE e `(service_id, name)`), o
 * upsert sobrescreveria os campos dela e desativaria uma categoria que ele usa.
 * Ler primeiro nunca mexe no que ja existe.
 *
 * O `insert` ainda pode colidir quando duas transferencias sao criadas ao mesmo
 * tempo no primeiro uso; 23505 e unique_violation, e ai a linha do outro pedido
 * ja serve.
 */
async function categoriaDaTransferencia(
  supabase: ReturnType<typeof createClient>,
  serviceId: string
): Promise<string | null> {
  const { data: existente } = await supabase
    .from("transaction_categories")
    .select("id")
    .eq("service_id", serviceId)
    .eq("name", NOME_DA_CATEGORIA_DE_TRANSFERENCIA)
    .maybeSingle();

  if (existente?.id) return existente.id;

  const { data: criada, error } = await supabase
    .from("transaction_categories")
    .insert({
      service_id: serviceId,
      name: NOME_DA_CATEGORIA_DE_TRANSFERENCIA,
      description:
        "Reservada para as duas pernas de uma transferência. Não aparece nos seletores.",
      is_expense: false,
      is_active: false,
    })
    .select("id")
    .single();

  if (criada?.id) return criada.id;

  if (error?.code === "23505") {
    const { data: doOutroPedido } = await supabase
      .from("transaction_categories")
      .select("id")
      .eq("service_id", serviceId)
      .eq("name", NOME_DA_CATEGORIA_DE_TRANSFERENCIA)
      .maybeSingle();
    return doOutroPedido?.id ?? null;
  }

  console.error("Erro ao criar a categoria de transferência:", error);
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = await request.json();
    const descricao = typeof body.descricao === "string" ? body.descricao : "";
    const data = typeof body.data === "string" ? body.data : "";
    const notas = typeof body.notas === "string" && body.notas ? body.notas : null;
    const origemId =
      typeof body.origem_id === "string" && body.origem_id
        ? body.origem_id
        : null;
    const destinoId =
      typeof body.destino_id === "string" && body.destino_id
        ? body.destino_id
        : null;

    if (!descricao.trim()) {
      return NextResponse.json(
        { error: "Informe a descrição." },
        { status: 400 }
      );
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      return NextResponse.json({ error: "Informe a data." }, { status: 400 });
    }

    const valor = Number(body.valor);
    if (!Number.isFinite(valor) || valor <= 0) {
      return NextResponse.json(
        { error: "Valor deve ser maior que zero." },
        { status: 400 }
      );
    }

    // Os dois ids sao buscados juntos e com `user_id` no filtro: uma conta de
    // outra pessoa volta como "nao encontrada", que e a resposta certa -- dizer
    // "essa conta nao e sua" confirmaria que o id existe.
    const ids = [origemId, destinoId].filter((x): x is string => Boolean(x));
    const { data: contas } = ids.length
      ? await supabase
          .from("financial_accounts")
          .select("id, name, account_type, currency")
          .eq("user_id", user.id)
          .in("id", ids)
      : { data: [] };

    const achar = (id: string | null) =>
      id === null ? undefined : (contas ?? []).find((c) => c.id === id) ?? null;

    const origem = achar(origemId);
    const destino = achar(destinoId);

    const problema = validarContasDaTransferencia(origem, destino);
    if (problema) {
      return NextResponse.json(
        { error: mensagemDaTransferencia(problema) },
        { status: 400 }
      );
    }

    const { data: servico } = await supabase
      .from("financial_services")
      .select("id")
      .eq("name", "personal_finance")
      .single();

    if (!servico) {
      return NextResponse.json(
        { error: "Serviço de finanças pessoais não encontrado" },
        { status: 404 }
      );
    }

    const categoriaId = await categoriaDaTransferencia(supabase, servico.id);
    if (!categoriaId) {
      return NextResponse.json(
        { error: "Não foi possível registrar a transferência" },
        { status: 500 }
      );
    }

    const { saida, entrada } = pernasDaTransferencia({
      valor,
      origemId: origem!.id,
      destinoId: destino!.id,
      descricao: descricao.trim(),
    });

    // `group_id: null` e `is_shared: false` nas duas pernas, sempre.
    // Transferencia entre contas proprias nao e despesa compartilhada, e os
    // triggers de grupo (sync_transaction_with_group,
    // auto_create_group_transaction) criariam rateio para ela -- cobrando dos
    // outros membros um valor que eles ja rateiam nas COMPRAS, que e onde a
    // despesa esta. A tela nem oferece grupo; isto e a garantia de que nenhum
    // corpo de pedido consegue oferecer.
    const comum = {
      user_id: user.id,
      service_id: servico.id,
      category_id: categoriaId,
      group_id: null,
      is_shared: false,
      transaction_date: data,
      notes: notas,
    };

    // A MOEDA E DE CADA PERNA, NAO DA TRANSFERENCIA (HMO-171)
    //
    // Por isso ela nao entra em `comum`: cada perna fica na moeda da SUA conta.
    // Uma transferencia de uma conta em real para uma em dolar e um cambio, e as
    // duas pernas estao em unidades diferentes por definicao.
    //
    // A consequencia que vale registrar: o par deixa de se anular. Nas
    // transferencias de mesma moeda a soma das duas pernas e zero -- e e isso que
    // mantem o patrimonio total certo enquanto o dinheiro muda de conta. No
    // cambio, -1000 BRL e +180 USD nao somam zero, e nao DEVEM somar: o saldo de
    // cada conta na propria moeda continua exato, e e o unico numero que existe
    // sem cotacao. Quem somar as duas pernas de moedas diferentes esperando zero
    // esta fazendo a pergunta errada.
    //
    // As duas pernas sao `transfer`, e `category_monthly_totals` filtra
    // `type IN ('expense','income')` -- entao o cambio nao entra como receita nem
    // como despesa de nenhuma das duas moedas (conferido no Postgres: a moeda que
    // so recebeu a perna do cambio nao produz linha nenhuma na view).
    const moedaDaOrigem = moedaSugerida({ daConta: origem!.currency });
    const moedaDoDestino = moedaSugerida({ daConta: destino!.currency });

    const { data: txSaida, error: erroSaida } = await supabase
      .from("financial_transactions")
      .insert({ ...comum, ...saida, currency: moedaDaOrigem })
      .select()
      .single();

    if (erroSaida || !txSaida) {
      console.error("Erro ao lançar a saída da transferência:", erroSaida);
      return NextResponse.json(
        { error: "Não foi possível lançar a transferência" },
        { status: 500 }
      );
    }

    const { data: txEntrada, error: erroEntrada } = await supabase
      .from("financial_transactions")
      .insert({
        ...comum,
        ...entrada,
        currency: moedaDoDestino,
        counterpart_transaction_id: txSaida.id,
      })
      .select()
      .single();

    if (erroEntrada || !txEntrada) {
      // As duas pernas ou nenhuma. Sem este desfazer, o dinheiro teria saido da
      // origem e nao entrado em lugar nenhum -- que e exatamente o bug que a
      // HMO-164 veio consertar, so que agora com a tela certa por cima.
      await supabase.from("financial_transactions").delete().eq("id", txSaida.id);
      console.error(
        "Transferência desfeita: a entrada no destino falhou",
        erroEntrada
      );
      return NextResponse.json(
        {
          error:
            "Não foi possível creditar a conta de destino. Nada foi lançado — tente novamente.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: `Transferido de ${origem!.name} para ${destino!.name}`,
      saida: txSaida,
      entrada: txEntrada,
    });
  } catch (erro) {
    console.error("Erro na transferência:", erro);
    return NextResponse.json(
      { error: "Não foi possível lançar a transferência" },
      { status: 500 }
    );
  }
}

/**
 * Apaga as DUAS pernas, recebendo qualquer uma delas.
 *
 * A FK de `counterpart_transaction_id` e ON DELETE SET NULL (migration 015), e
 * e por isso que apagar uma perna pela lista de lancamentos nao da erro
 * nenhum: a outra continua la, com o elo zerado, movendo o saldo de uma conta
 * so. Meia transferencia e pior que nenhuma, porque o extrato parece completo.
 *
 * O elo aponta num sentido so -- a entrada guarda o id da saida --, entao a
 * busca da parceira depende de qual perna chegou.
 */
export async function DELETE(request: NextRequest) {
  try {
    const supabase = createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Informe o lançamento" }, { status: 400 });
    }

    const { data: alvo } = await supabase
      .from("financial_transactions")
      .select("id, transaction_type, counterpart_transaction_id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!alvo) {
      return NextResponse.json(
        { error: "Lançamento não encontrado" },
        { status: 404 }
      );
    }

    if (alvo.transaction_type !== "transfer") {
      return NextResponse.json(
        { error: "Este lançamento não é uma transferência" },
        { status: 400 }
      );
    }

    // A parceira: se `alvo` e a entrada, o elo dela aponta para a saida. Se e a
    // saida, quem aponta para ela e a entrada.
    let parceiraId = alvo.counterpart_transaction_id as string | null;

    if (!parceiraId) {
      const { data: aponta } = await supabase
        .from("financial_transactions")
        .select("id")
        .eq("counterpart_transaction_id", alvo.id)
        .eq("user_id", user.id)
        .maybeSingle();
      parceiraId = aponta?.id ?? null;
    }

    // A entrada primeiro, pelo mesmo motivo do estorno da fatura: ela aponta
    // para a saida. Apagar a saida antes faria o SET NULL zerar o elo, e se a
    // segunda remocao falhasse a entrada ficaria sem nada que diga de onde veio.
    const ordem =
      alvo.counterpart_transaction_id && parceiraId
        ? [alvo.id, parceiraId]
        : parceiraId
          ? [parceiraId, alvo.id]
          : [alvo.id];

    for (const alvoId of ordem) {
      const { error } = await supabase
        .from("financial_transactions")
        .delete()
        .eq("id", alvoId)
        .eq("user_id", user.id);

      if (error) {
        console.error("Erro ao apagar perna da transferência:", error);
        return NextResponse.json(
          {
            error:
              "Não foi possível apagar a transferência inteira. Confira o extrato das duas contas.",
          },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      message:
        ordem.length === 2
          ? "Transferência apagada nas duas contas"
          : "Lançamento apagado",
      // A tela avisa quando so havia uma perna: e o dado antigo, gravado antes
      // da HMO-164, e quem ve "apagada nas duas contas" num caso desses ficaria
      // procurando uma linha que nunca existiu.
      pernas: ordem.length,
    });
  } catch (erro) {
    console.error("Erro ao apagar transferência:", erro);
    return NextResponse.json(
      { error: "Não foi possível apagar a transferência" },
      { status: 500 }
    );
  }
}
