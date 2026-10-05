// GET /api/papel-de-pao/painel
//
// Os DOIS numeros do modo papel de pao (HMO-286, 3/3 do plano da HMO-279):
// "Salario Previsto" e "Total de contas", do mes corrente.
//
// A ROTA NAO FAZ CONTA. Ela autentica, le e delega para `lib/papel-de-pao.ts`,
// que e onde as duas contas moram como funcoes puras e onde
// `npm run test:papel-de-pao` as mede. Somar aqui dentro poria a definicao dos
// dois rotulos num lugar que nenhuma suite alcanca -- e rotulo novo em cima de
// numero velho e como este app ja errou duas vezes (HMO-187, HMO-290).
//
// POR QUE ELA EXISTE, EM VEZ DE REUSAR /api/scheduled-transactions/summary
// ------------------------------------------------------------------------
// Aquela rota nao recorta por categoria: o `expected_income` dela e TODA receita
// prevista do mes somada num numero so. Debaixo do rotulo "Salario Previsto"
// aquilo chamaria aluguel recebido e reembolso de grupo de salario. Esta rota
// recorta -- e e o unico motivo de ela existir.
//
// O QUE ELA COPIA DAQUELA ROTA, E NAO E DUPLICACAO
// ------------------------------------------------
// A sequencia materializar -> tirar compra de cartao -> somar fatura aberta ->
// dividir a parte do grupo nao e enfeite: cada elo e um defeito de dinheiro que
// este repositorio ja mediu em producao.
//
//   * sem materializar, o mes corrente pode nao ter linha nenhuma e o painel
//     diria "nenhuma conta prevista" num mes cheio de contas;
//   * sem `agendaSemCompraNoCartao`, cada compra no cartao conta como conta a
//     pagar E a fatura tambem conta -- a mesma despesa duas vezes;
//   * sem `faturasPrevistasDaJanela`, a fatura aberta do mes simplesmente nao
//     aparece, e ela e a maior conta de muita gente;
//   * sem `parteDoMembro`, a policy do 005 (que libera `group_id IS NOT NULL
//     AND is_group_member(group_id)`) poe o aluguel de R$ 3.000 do grupo Casa
//     inteiro no total das DUAS pessoas.
//
// Em todos os quatro elos a chamada e para a MESMA funcao que a outra rota usa.
// Reescrever qualquer um deles aqui criaria a segunda copia -- e a copia
// esquecida e o defeito.

import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import { materializarAgenda } from "@/lib/services/scheduled";
import { today } from "@/lib/recurrence";
import { contarMembrosAtivos } from "@/lib/parte-do-grupo";
import { janelaParaMaterializar } from "@/lib/periodo-do-painel";
import {
  agendaComFaturasAbertas,
  agendaSemCompraNoCartao,
} from "@/lib/agenda-do-cartao";
import { faturasPrevistasDaJanela } from "@/lib/services/fatura-prevista";
import {
  NOME_DA_CATEGORIA_DE_SALARIO,
  janelaDoMesCorrente,
  painelDePapel,
  type LinhaPrevistaDoPapel,
} from "@/lib/papel-de-pao";

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

    const hoje = today();
    const janela = janelaDoMesCorrente(hoje);

    // A agenda do mes corrente pode ainda nao existir como linha: ela nasce das
    // regras recorrentes. `janelaParaMaterializar` nunca comeca antes de hoje --
    // materializar para tras fabricaria contas vencidas retroativas.
    const aMaterializar = janelaParaMaterializar(janela, hoje);

    if (aMaterializar) {
      try {
        await materializarAgenda(supabase, user.id, aMaterializar);
      } catch (erroAgenda) {
        // A leitura ainda tem valor: as linhas ja gravadas estao la. Derrubar o
        // painel inteiro por causa da materializacao trocaria dois numeros
        // incompletos por uma tela de erro.
        console.error("Painel de papel seguiu sem materializar a agenda:", erroAgenda);
      }
    }

    // OS IDS DA CATEGORIA SALARIO, resolvidos pelo NOME do seed do 001.
    //
    // Sem filtro de `user_id`: a RLS do 036 ja limita esta tabela ao catalogo
    // (`user_id IS NULL`) mais as categorias da propria pessoa, e as duas devem
    // contar -- quem criou a propria "Salário" tem salario igual.
    const { data: categorias, error: erroCategorias } = await supabase
      .from("transaction_categories")
      .select("id")
      .eq("name", NOME_DA_CATEGORIA_DE_SALARIO);

    if (erroCategorias) {
      // Lista vazia faz o salario sair *indisponivel*, nao zero. E a resposta
      // honesta: sem a categoria nao da para dizer o que e salario, e "R$ 0,00"
      // seria uma afirmacao falsa sobre o dinheiro de quem recebe salario.
      console.error(
        "Painel de papel seguiu sem a categoria de salário:",
        erroCategorias
      );
    }

    const categoriasDeSalario = (categorias ?? []).map((c) => String(c.id));

    // `category_id` e o que esta rota tem e a de resumo nao precisa -- e o
    // recorte do salario. O resto do select e identico ao dela de proposito: o
    // embed da conta e `notes` sao as duas colunas de que
    // `agendaSemCompraNoCartao` precisa para separar a fatura (que fica) da
    // compra individual no cartao (que sai).
    const { data: linhasBrutas, error } = await supabase
      .from("scheduled_transactions_effective")
      .select(
        "due_date, amount, status, direction, category_id, group_id, notes, account:financial_accounts(account_type)"
      )
      .gte("due_date", janela.de)
      .lte("due_date", janela.ate);

    if (error) {
      console.error("Erro ao ler o painel do papel de pão:", error);
      return NextResponse.json(
        { error: "Não foi possível calcular o painel" },
        { status: 500 }
      );
    }

    // ANTES de juntar a fatura: a compra de cartao escondida nao pode
    // influenciar nada do que a tela mostra.
    const semCompraDeCartao = agendaSemCompraNoCartao(linhasBrutas ?? []);

    const previsaoDaFatura = await faturasPrevistasDaJanela(supabase, user.id, {
      de: janela.de,
      ate: janela.ate,
      hoje,
    });

    const linhas = agendaComFaturasAbertas(
      semCompraDeCartao,
      previsaoDaFatura.previstas
    ) as LinhaPrevistaDoPapel[];

    // Quantos membros ativos tem cada grupo que aparece nas linhas. Sem isto a
    // parte dos OUTROS conta como minha -- ver lib/parte-do-grupo.ts.
    const gruposEnvolvidos = Array.from(
      new Set(
        linhas
          .map((l) => l.group_id)
          .filter((id): id is string => Boolean(id))
      )
    );

    let membrosAtivosPorGrupo = new Map<string, number>();

    if (gruposEnvolvidos.length > 0) {
      const { data: membros, error: erroMembros } = await supabase
        .from("group_members")
        .select("group_id, status")
        .in("group_id", gruposEnvolvidos)
        .eq("status", "active");

      if (erroMembros) {
        // Sem a contagem, `parteDoMembro` mantem o valor CHEIO: erra para cima,
        // que e a direcao barata. Subestimar a conta a pagar e o modo caro.
        console.error(
          "Painel de papel seguiu sem dividir a parte do grupo:",
          erroMembros
        );
      } else {
        membrosAtivosPorGrupo = contarMembrosAtivos(membros ?? []);
      }
    }

    // A CONTA, inteira, numa chamada. `parteDoMembro` roda dentro dela -- e por
    // isso a divisao do grupo tambem esta sob a suite, e nao so aqui.
    const painel = painelDePapel(linhas, {
      janela,
      membrosAtivosPorGrupo,
      categoriasDeSalario,
    });

    return NextResponse.json({
      month: janela.de.slice(0, 7),
      range: { from: janela.de, to: janela.ate },
      ...painel,
    });
  } catch (error) {
    console.error("Erro no painel do papel de pão:", error);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
