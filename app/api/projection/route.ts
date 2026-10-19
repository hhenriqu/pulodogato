// GET /api/projection?through=YYYY-MM-DD
//
// "Sobra ou falta no dia 30?" -- saldo de hoje mais tudo que esta previsto ate
// a data, por conta. Sem `through`, projeta ate o fim do mes corrente.
//
// Rota fina de proposito: ela busca as linhas e repassa. Toda a aritmetica --
// e a decisao de deixar a fatura fechada FORA do `scheduled_out`, que e a
// razao de o lib existir -- esta no lib/projecao.ts, com suite propria
// (`npm run test:projecao`) e mutantes (`scripts/mutantes-projecao.mjs`).
// Leia o cabecalho de la antes de mexer no numero: ele explica por que o
// lib/cash-flow-forecast.ts decide o oposto sobre a mesma fatura.
//
// O filtro de status fica aqui porque e da consulta: 'pending' e vencimento
// ate a data, incluindo as ja VENCIDAS -- uma conta que venceu ontem e nao foi
// paga continua sendo dinheiro que vai sair. Ficam de fora 'paid' (ja virou
// transacao real e ja esta no saldo), 'skipped' e 'cancelled'.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { isIsoDate, today } from "@/lib/recurrence";
import { calcularProjecao, fimDoMes } from "@/lib/projecao";
import { contasQueSomam } from "@/lib/contas";

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

    const url = new URL(request.url);
    const param = url.searchParams.get("through");
    const hoje = today();
    const ate = param ?? fimDoMes(hoje);

    if (!isIsoDate(ate)) {
      return NextResponse.json(
        { error: "Data deve estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    const { data: contasBrutas, error: erroContas } = await supabase
      .from("financial_accounts")
      .select(
        // `*` E NAO A LISTA DE COLUNAS, e o motivo e uma ordem de deploy
        // (HMO-431). Nomear `include_in_total` aqui faz o PostgREST responder
        //
        //     42703  column financial_accounts.include_in_total does not exist
        //
        // em qualquer banco que ainda nao recebeu a migration 058 -- e a 058 e
        // colada A MAO no SQL Editor, depois do deploy do codigo. MEDIDO em
        // producao em 2026-10-19: a coluna respondia 42703 enquanto `is_active`
        // respondia 42501 (permissao), o que prova que o 42703 e resolucao de
        // NOME e nao RLS. Com a lista nomeada, esta rota inteira responderia 500
        // na janela entre o deploy e a colagem.
        //
        // `*` nao nomeia coluna nenhuma: ele traz o campo quando ele existe e
        // simplesmente nao o traz quando nao existe. Ai `include_in_total` chega
        // `undefined`, e `contasQueSomam` trata ausente como "soma" -- o
        // comportamento de antes da feature, que e exatamente o que se quer
        // nessa janela.
        //
        // NAO troque por `.eq("include_in_total", true)` tampouco: um filtro tem
        // o mesmo 42703 do select nomeado, e ainda por cima descartaria a linha
        // em vez de derrubar a rota -- um total silenciosamente menor e pior que
        // um 500.
        "*"
      )
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (erroContas) {
      console.error("Erro ao carregar contas:", erroContas);
      return NextResponse.json(
        { error: "Não foi possível carregar as contas" },
        { status: 500 }
      );
    }

    // A CONTA DESLIGADA SAI DA PROJECAO (HMO-431). O recorte e aqui e nao
    // dentro de `lib/projecao.ts`, que soma o que recebe -- `contasQueSomam` em
    // lib/contas.ts e a unica definicao de "esta conta conta".
    const contas = contasQueSomam(contasBrutas ?? []);

    // A VIEW, e nao a tabela (HMO-256): a tabela nao tem `direction`, e deduzir
    // a direcao do tipo da REGRA faz toda receita prevista avulsa entrar como
    // conta a pagar -- e sair do `scheduled_in` no mesmo movimento. Ver o
    // cabecalho do lib/projecao.ts.
    //
    // `my_status` E NAO `my_effective_status`: a view entrega as duas, a
    // primeira e a gravada, e trocar aqui excluiria justamente a conta VENCIDA
    // e nao paga -- dinheiro que vai sair, e que o `overdue_total` existe para
    // destacar.
    //
    // `my_status` E NAO `status` (HMO-411, leitura 7 de 8) -- o porque completo
    // esta no cabecalho de app/api/scheduled-transactions/route.ts. Aqui a
    // troca e demonstravelmente INOCUA: o `.eq("user_id", user.id)` logo abaixo
    // so deixa passar linha minha, e para linha minha a 055 define
    // `my_status = status::text` sempre. Ela esta aqui por UMA CONVENCAO SO --
    // metade das rotas em `status` e metade em `my_status` obrigaria a proxima
    // pessoa a descobrir caso a caso qual das duas cada rota devia ler.
    //
    // Duas colunas sao load-bearing e nao dao erro nenhum se sairem do select,
    // so mudam o numero em silencio:
    //
    //   * `notes` carrega a chave canonica da fatura, e e ela que o
    //     lib/projecao.ts usa para deixar a fatura fechada fora do
    //     `scheduled_out`. Sem ela a exclusao para de acontecer.
    //   * `direction` e a propria direcao. Sem ela toda previsao vira despesa,
    //     que e o defeito desta issue de volta.
    const { data: previstas, error: erroPrevistas } = await supabase
      .from("scheduled_transactions_effective")
      // `my_status` SAI DO SELECT e fica so no filtro abaixo (HMO-411): o
      // `status` que estava aqui nunca foi lido -- `PrevistaParaProjetar` nem
      // declara o campo --, e coluna trazida e nunca lida e divida que a
      // proxima pessoa confunde com criterio.
      .select("id, account_id, amount, due_date, notes, direction")
      .eq("user_id", user.id)
      .eq("my_status", "pending")
      .lte("due_date", ate);

    if (erroPrevistas) {
      console.error("Erro ao carregar contas previstas:", erroPrevistas);
      return NextResponse.json(
        { error: "Não foi possível carregar as contas previstas" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      calcularProjecao({
        contas: contas ?? [],
        previstas: previstas ?? [],
        hoje,
        ate,
      })
    );
  } catch (error) {
    console.error("Erro na API de projeção:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
