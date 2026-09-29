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
 * A categoria reservada das pernas. So leitura -- ela e SEED (migration 023).
 *
 * `financial_transactions.category_id` e NOT NULL e transferencia nao tem
 * categoria -- ver `NOME_DA_CATEGORIA_DE_TRANSFERENCIA`. A linha esta no banco
 * com `is_active = false`, que e o que a mantem fora dos dois seletores de
 * categoria do app, e uma policy propria do 023 e o que a torna legivel mesmo
 * desativada.
 *
 * ESTA FUNCAO JA TENTOU CRIAR A LINHA, e foi assim que a transferencia passou
 * meses respondendo 500 em producao sem ninguem ver. `transaction_categories` e
 * tabela de REFERENCIA: nao tem `user_id`, o 002_rls_lockdown so deu
 * `GRANT SELECT`, e a unica policy dela e `FOR SELECT`. O insert voltava 42501
 * em toda chamada, de todo usuario -- e como nao e 23505, nem o ramo de "outro
 * pedido criou primeiro" pegava. O SELECT que vinha antes tambem nao achava
 * nada, porque a policy antiga e `USING (is_active = TRUE)`.
 *
 * Abrir INSERT para `authenticated` faria a rota funcionar e seria o conserto
 * errado: a tabela e global, e quem escreve nela escreve na tela de todos os
 * usuarios do app. Por isso a linha nasce de migration, e por isso aqui so se
 * le. Ausencia dela e schema desatualizado, nao caso de uso -- e o log diz
 * exatamente isso, em vez de um "erro ao criar" que apontava para o lugar
 * errado.
 */
async function categoriaDaTransferencia(
  supabase: ReturnType<typeof createClient>,
  serviceId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("transaction_categories")
    .select("id")
    .eq("service_id", serviceId)
    .eq("name", NOME_DA_CATEGORIA_DE_TRANSFERENCIA)
    .maybeSingle();

  if (data?.id) return data.id;

  console.error(
    `A categoria "${NOME_DA_CATEGORIA_DE_TRANSFERENCIA}" nao esta legivel no banco. ` +
      "Aplique database/migrations/023_categoria_de_transferencia.sql.",
    error
  );
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
      // Nao ha nada que a pessoa possa fazer na tela para contornar isto, entao
      // a mensagem diz que o problema e do lado de ca. "Tente novamente" seria
      // mentira: sem a migration 023, a proxima tentativa falha igual.
      return NextResponse.json(
        {
          error:
            "A transferência não pôde ser registrada por uma configuração pendente do sistema. Nada foi lançado.",
        },
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
