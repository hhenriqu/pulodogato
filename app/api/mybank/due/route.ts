// ---------------------------------------------------------------------------
// GET /api/mybank/due -- o LADO DO DEVEDOR: o que eu devo ao MyBank de alguem
// ---------------------------------------------------------------------------
// MyBank, F3 da HMO-368 (issue HMO-371). A outra ponta de
// `GET /api/mybank/loans`, que devolve o que ME devem.
//
// LE A VIEW, E NAO AS DUAS TABELAS
// --------------------------------
// `mybank_due_entries` (migration 053, `security_invoker = true`) e quem resolve
// os tres recortes que o devedor precisa e que uma consulta a mao erraria:
//
//   * `borrower_user_id = auth.uid()` -- so a minha divida;
//   * `borrower_user_id IS DISTINCT FROM lender_user_id` -- o AUTO-EMPRESTIMO
//     fica FORA. Ele ja esta em `scheduled_transactions` como transferencia
//     prevista, e some-lo aqui mostraria a mesma parcela duas vezes em Contas a
//     Pagar. E a familia do `pulodogato-fatura-conta-duas-vezes`, e seria um
//     defeito sem erro nenhum no caminho;
//   * `status IN ('pending','reported')` -- quem avisou CONTINUA aparecendo, que
//     e a convencao da HMO-366: sumir da tela no intervalo entre avisar e ser
//     confirmado faria a conta parecer paga.
//
// Reescrever esses tres filtros aqui seria a segunda definicao deles, e a view
// e o que a F1 mergeou justamente para a leitura do devedor nao ter de sabe-los.
//
// O NOME DE QUEM EMPRESTOU SAI DE UMA CONSULTA PROPRIA, NAO DE UM EMBED
// --------------------------------------------------------------------
// Pela mesma razao medida na F2: embed que a RLS nao deixa resolver nao devolve
// `null` neste repositorio -- ele DESCARTA A LINHA. A parcela que eu devo
// desapareceria de Contas a Pagar para quem desfez a conexao depois de pegar
// emprestado, sem erro nenhum. Com a leitura separada, perfil ilegivel vira nome
// `null`, e `seloDoMyBank` tem frase para isso: o selo diz so "MyBank" e a
// divida continua na lista.
//
// A view NAO tem FK para `profiles`, entao nao ha embed possivel sobre ela de
// todo jeito -- e isso e uma propriedade boa, nao um limite: `embed-de-view-
// tipado-como-array` e `embed-de-profiles-falha-fk-vai-para-auth-users` sao os
// dois tropecos que esta forma evita de uma vez.
// ---------------------------------------------------------------------------

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";

import type { ParcelaQueEuDevo } from "@/lib/mybank-na-tela";

export async function GET() {
  const supabase = createClient();

  try {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { data: linhas, error } = await supabase
      .from("mybank_due_entries")
      .select(
        "id, loan_id, lender_user_id, description, amount, due_date, status, installment_number, installment_total, reported_at"
      )
      .order("due_date", { ascending: true });

    if (error) {
      console.error("Erro ao ler as parcelas que eu devo ao MyBank:", error);
      return NextResponse.json(
        { error: "Não foi possível ler as parcelas do MyBank" },
        { status: 500 }
      );
    }

    const parcelas = linhas ?? [];

    if (parcelas.length === 0) {
      return NextResponse.json({ parcelas: [] });
    }

    // Sem repetidos, e a deduplicacao e por `indexOf` e nao por `[...new Set()]`:
    // o `tsconfig.json` deste projeto nao tem `target` nem `downlevelIteration`,
    // e espalhar um Set reprova com TS2802 -- erro que so aparece no
    // `type-check`, nao na suite. Duas parcelas do MESMO credor pediriam o
    // perfil dele duas vezes no `.in()`.
    const idsDeCredor = parcelas
      .map((p) => p.lender_user_id)
      .filter((id, i, todos) => Boolean(id) && todos.indexOf(id) === i);

    const { data: perfis } = idsDeCredor.length
      ? await supabase
          .from("profiles")
          .select("id, full_name, nickname")
          .in("id", idsDeCredor)
      : {
          data: [] as {
            id: string;
            full_name: string | null;
            nickname: string | null;
          }[],
        };

    const nomePorId = new Map(
      (perfis ?? []).map((p) => [p.id, p.nickname || p.full_name || null])
    );

    const resposta: ParcelaQueEuDevo[] = parcelas.map((p) => ({
      id: p.id,
      loan_id: p.loan_id,
      descricao: p.description,
      valor: Number(p.amount),
      vencimento: p.due_date,
      status: p.status,
      numero: p.installment_number,
      total: p.installment_total,
      // O `n de m` vem MONTADO da rota, como em `/api/mybank/loans`: as duas
      // pontas da feature imprimem a mesma frase, e ela tem um dono so.
      rotulo: `${p.installment_number} de ${p.installment_total}`,
      quem_emprestou: nomePorId.get(p.lender_user_id) ?? null,
    }));

    return NextResponse.json({ parcelas: resposta });
  } catch (error) {
    console.error("MyBank due GET error:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
