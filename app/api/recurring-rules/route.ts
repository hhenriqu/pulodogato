// GET  /api/recurring-rules            lista os gastos e receitas fixos
// POST /api/recurring-rules            cadastra um e ja materializa a agenda
//
// A RLS da migration 005 e quem filtra: o SELECT devolve as regras do proprio
// usuario mais as dos grupos de que ele participa. Nao repetimos o filtro aqui
// para nao ter duas versoes da mesma regra de acesso.

import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { materializarAgenda } from "@/lib/services/scheduled";
import { isIsoDate, today } from "@/lib/recurrence";
import {
  validarContasDaTransferencia,
  mensagemDaTransferencia,
  camposDeDestinoDaRegra,
} from "@/lib/transferencia";

const FREQUENCIAS = [
  "weekly",
  "biweekly",
  "monthly",
  "bimonthly",
  "quarterly",
  "semiannual",
  "annual",
];

// Os valores do enum `transaction_financial_type` (001_baseline). A lista existe
// desde a HMO-172 porque `transfer` passou a ser um valor COM consequencia: ele
// manda a baixa gravar duas pernas e exige `destination_account_id`. Antes, um
// `transaction_type` qualquer vindo do corpo so levava 22P02 do banco; agora um
// valor fora da lista passaria pela validacao de transferencia sem ser
// transferencia, e o destino iria para o banco num tipo que o CHECK proibe.
const TIPOS = ["income", "expense", "transfer"];

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
    const incluirInativas = url.searchParams.get("include_inactive") === "true";

    // A FK vai QUALIFICADA de proposito. A 038 deu a `recurring_rules` uma
    // SEGUNDA chave estrangeira para `financial_accounts`
    // (`destination_account_id`), e a partir dali `financial_accounts(...)` sem
    // qualificar deixou de ter resposta unica: o PostgREST devolve PGRST201
    // ("more than one relationship was found") e esta rota virava 500 para
    // todo mundo -- a tela de gastos fixos nao listava nada. Medido em
    // producao: o SELECT de antes dava HTTP 300/PGRST201, este da 200.
    //
    // O nome da constraint, e nao `!account_id`: os dois desambiguam, mas o
    // nome da FK quebra alto se a constraint for renomeada, enquanto a forma
    // por coluna continuaria resolvendo silenciosamente para outra relacao.
    let query = supabase
      .from("recurring_rules")
      .select(
        `
        *,
        category:transaction_categories(*),
        account:financial_accounts!recurring_rules_account_id_fkey(id, name, account_type, color_hex),
        group:expense_groups(id, name, group_code)
      `
      )
      .order("due_day", { ascending: true, nullsFirst: false });

    if (!incluirInativas) query = query.eq("is_active", true);

    const { data: rules, error } = await query;

    if (error) {
      console.error("Erro ao listar gastos fixos:", error);
      return NextResponse.json(
        { error: "Não foi possível carregar os gastos fixos" },
        { status: 500 }
      );
    }

    return NextResponse.json({ rules: rules ?? [] });
  } catch (error) {
    console.error("Erro na API de gastos fixos:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
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
    const {
      description,
      amount,
      category_id,
      subcategory_id,
      account_id,
      destination_account_id,
      group_id,
      transaction_type = "expense",
      frequency = "monthly",
      interval_count = 1,
      due_day,
      start_date = today(),
      end_date,
      max_occurrences,
      reminder_days = 3,
      notes,
    } = body;

    if (!description?.trim()) {
      return NextResponse.json(
        { error: "Descrição é obrigatória" },
        { status: 400 }
      );
    }

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json(
        { error: "Valor deve ser maior que zero" },
        { status: 400 }
      );
    }

    if (!category_id) {
      return NextResponse.json(
        { error: "Categoria é obrigatória" },
        { status: 400 }
      );
    }

    if (!FREQUENCIAS.includes(frequency)) {
      return NextResponse.json(
        { error: `Frequência inválida. Use uma de: ${FREQUENCIAS.join(", ")}` },
        { status: 400 }
      );
    }

    if (due_day != null && (due_day < 1 || due_day > 31)) {
      return NextResponse.json(
        { error: "Dia de vencimento deve estar entre 1 e 31" },
        { status: 400 }
      );
    }

    if (!isIsoDate(start_date) || (end_date && !isIsoDate(end_date))) {
      return NextResponse.json(
        { error: "Datas devem estar no formato AAAA-MM-DD" },
        { status: 400 }
      );
    }

    if (end_date && end_date < start_date) {
      return NextResponse.json(
        { error: "Data final não pode ser anterior à inicial" },
        { status: 400 }
      );
    }

    if (!TIPOS.includes(transaction_type)) {
      return NextResponse.json(
        { error: `Tipo inválido. Use um de: ${TIPOS.join(", ")}` },
        { status: 400 }
      );
    }

    // ---------------------------------------------------------------
    // A TRANSFERENCIA RECORRENTE (HMO-172)
    // ---------------------------------------------------------------
    // Transferencia e o unico tipo com DUAS contas, e as duas recusas abaixo
    // acontecem aqui -- antes do INSERT -- porque o CHECK da 038 devolveria 23514,
    // que a tela nao sabe traduzir: a pessoa veria "não foi possível criar" sem
    // saber qual campo esta errado.
    //
    // As contas sao lidas DO BANCO e nao do corpo. `account_type` vindo do
    // cliente nao decide regra de dinheiro, e e ele que diz se a origem e um
    // cartao -- uma saida recorrente num cartao criaria divida sem compra por
    // tras, todo mes, e cada uma dessas linhas entraria na fatura cobrando algo
    // que nao foi comprado.
    if (transaction_type === "transfer") {
      const ids = [account_id, destination_account_id].filter(
        (id): id is string => typeof id === "string" && id.length > 0
      );
      const { data: contas } = await supabase
        .from("financial_accounts")
        .select("id, account_type")
        .in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
        .eq("user_id", user.id);

      // `?? null` de proposito, nos dois: `null` quer dizer "id informado que a
      // busca nao achou" (ou que nao e deste usuario) e `undefined` quer dizer
      // "nao informado". `validarContasDaTransferencia` da mensagens diferentes
      // para os dois, e confundi-los esconderia uma tentativa de pendurar uma
      // regra na conta de outra pessoa atras de "preencha o campo".
      const achar = (id: unknown) =>
        typeof id === "string" && id
          ? (contas ?? []).find((c) => c.id === id) ?? null
          : undefined;

      const problema = validarContasDaTransferencia(
        achar(account_id),
        achar(destination_account_id)
      );
      if (problema) {
        return NextResponse.json(
          { error: mensagemDaTransferencia(problema) },
          { status: 400 }
        );
      }

      // Transferencia entre contas proprias nao e despesa compartilhada. Aceitar
      // `group_id` aqui faria os triggers de grupo ratearem cada ocorrencia,
      // cobrando dos outros membros um valor que eles ja rateiam nas COMPRAS --
      // e a recusa e explicita em vez de um `group_id: null` calado, que
      // esconderia da pessoa que o campo foi ignorado.
      if (group_id) {
        return NextResponse.json(
          {
            error:
              "Transferência entre contas próprias não é despesa de grupo: ela não muda o patrimônio de ninguém.",
          },
          { status: 400 }
        );
      }

      // `due_day` e obrigatorio: sem ele a regra nasce sem vencimento e
      // `occurrencesBetween` nao gera ocorrencia nenhuma. A regra existiria no
      // banco, a tela diria "criado", e a agenda nunca mostraria nada.
      if (due_day == null) {
        return NextResponse.json(
          { error: "Escolha o dia do vencimento da transferência" },
          { status: 400 }
        );
      }
    } else if (destination_account_id) {
      // Conta de destino em receita/despesa e o estado que o CHECK da 038 chama
      // de transferencia disfarcada: a baixa le o TIPO, grava UMA perna, e a
      // coluna fica na linha dizendo que havia um destino que ninguem honrou.
      return NextResponse.json(
        { error: "Conta de destino só existe em transferência" },
        { status: 400 }
      );
    }

    // Grupo so vale se o usuario for membro ativo. A RLS ja barraria a LEITURA
    // depois, mas sem esta checagem o INSERT passa e a regra nasce invisivel
    // para o proprio dono na tela do grupo.
    if (group_id) {
      const { data: membro } = await supabase
        .from("group_members")
        .select("id")
        .eq("group_id", group_id)
        .eq("user_id", user.id)
        .eq("status", "active")
        .single();

      if (!membro) {
        return NextResponse.json(
          { error: "Você não participa deste grupo" },
          { status: 403 }
        );
      }
    }

    const { data: rule, error } = await supabase
      .from("recurring_rules")
      .insert({
        user_id: user.id,
        category_id,
        // HMO-216. A regra e a semente de toda ocorrencia futura: perder a
        // subcategoria aqui a perderia em TODOS os meses que a regra gera, nao
        // num lancamento. `|| null` porque a coluna e uuid e `""` volta 22P02.
        subcategory_id: subcategory_id || null,
        account_id: account_id || null,
        // HMO-172/HMO-236. A coluna de destino so viaja quando o tipo e
        // `transfer`. A decisao mora em `camposDeDestinoDaRegra`, com o porque
        // inteiro escrito la -- resumo: mandar a coluna sempre acopla a criacao
        // de despesa/receita fixa a migration 038, e sem ela o PostgREST recusa
        // o INSERT inteiro com PGRST204, para os tres tipos.
        ...camposDeDestinoDaRegra(transaction_type, destination_account_id),
        group_id: group_id || null,
        description: description.trim(),
        amount: Math.abs(Number(amount)),
        transaction_type,
        frequency,
        interval_count: Number(interval_count) || 1,
        due_day: due_day ?? null,
        start_date,
        end_date: end_date || null,
        max_occurrences: max_occurrences ?? null,
        reminder_days: Number(reminder_days) || 0,
        notes: notes || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Erro ao criar gasto fixo:", error);
      return NextResponse.json(
        { error: "Não foi possível criar o gasto fixo" },
        { status: 500 }
      );
    }

    // Já deixa os próximos vencimentos na agenda: cadastrar um gasto fixo e não
    // ver nada na tela de contas previstas é o caminho mais curto para o
    // usuário achar que não salvou.
    let agenda = { criadas: 0, regras: 0 };
    try {
      agenda = await materializarAgenda(supabase, user.id);
    } catch (erroAgenda) {
      // A regra foi criada; falhar a resposta faria o usuário cadastrar de novo
      // e duplicar. A agenda é recalculável a qualquer momento.
      console.error("Regra criada, mas a agenda não foi materializada:", erroAgenda);
    }

    return NextResponse.json(
      {
        message: "Gasto fixo criado com sucesso",
        rule,
        scheduled_created: agenda.criadas,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Erro na API de gastos fixos:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
