// GET /api/papel-de-pao/painel?month=AAAA-MM
//
// Os numeros do modo papel de pao (HMO-286, 3/3 do plano da HMO-279):
// "Salario Previsto" e "Total de contas", do mes PEDIDO -- o mes corrente
// quando ninguem pede (HMO-295, 5/6) --, mais as "Receitas" do mes e o cartao
// "Quanto Sobra ou Quanto Falta" (HMO-296, 6/6).
//
// A HMO-296 NAO ACRESCENTOU CONSULTA NENHUMA, e isso e o criterio dela e nao
// uma economia: `receitas` e uma perna a mais de `somarPerna` sobre o MESMO
// array de linhas que ja estava peneirado aqui, e o cartao e a diferenca das
// duas pernas. Uma segunda soma de despesa feita fora desta sequencia erraria
// nos quatro elos abaixo ao mesmo tempo e pareceria certa na tela.
//
// A HMO-300 (9/10) TAMBEM NAO, E PELO MESMO CRITERIO -- o chevron que abre a
// lista de detalhes dentro dos dois cartoes de cima. As linhas da lista sao as
// que `somarPerna` JA aceitou: ela devolve, junto com o total, o `detalhe` do
// que entrou. O que mudou aqui foram TRES COLUNAS no `select` que ja existia
// (`id`, `description`, `user_id`) e o `meuUserId` no contexto -- nenhuma
// consulta nova, e a razao e aritmetica: a soma das linhas abertas tem de ser
// exatamente o total do cartao fechado, e uma segunda leitura para montar a
// lista erraria nos mesmos quatro elos, so que agora EXPLICANDO o numero errado
// linha a linha.
//
// O `month` da resposta ECOA o mes que saiu da querystring, e nao e enfeite: e
// com ele que a tela evita pintar a resposta de um mes na moldura de outro
// quando alguem clica duas vezes na seta, ou quando o cache do PWA (24h nas
// rotas /api/) devolve a resposta de outro mes. Ele sai de `janela.de`, que e a
// unica fonte da janela -- um campo calculado a parte poderia discordar dela.
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
//   * sem `parteConfiguradaDoMembro`, a policy do 005 (que libera `group_id IS
//     NOT NULL AND is_group_member(group_id)`) poe o aluguel de R$ 3.000 do
//     grupo Casa inteiro no total das DUAS pessoas -- e com a divisao IGUAL que
//     ela substituiu (HMO-303), quem tem 30% do grupo via 50% da conta.
//
// Em todos os quatro elos a chamada e para a MESMA funcao que a outra rota usa.
// Reescrever qualquer um deles aqui criaria a segunda copia -- e a copia
// esquecida e o defeito.

import { createClient } from "@/utils/supabase/server";
import { NextResponse, type NextRequest } from "next/server";
import { materializarAgenda } from "@/lib/services/scheduled";
import { today } from "@/lib/recurrence";
import {
  montarParticipantesPorGrupo,
  type ParticipantesPorGrupo,
} from "@/lib/parte-do-grupo";
import { janelaParaMaterializar } from "@/lib/periodo-do-painel";
import {
  agendaComFaturasAbertas,
  agendaSemCompraNoCartao,
} from "@/lib/agenda-do-cartao";
import { faturasPrevistasDaJanela } from "@/lib/services/fatura-prevista";
import {
  NOME_DA_CATEGORIA_DE_SALARIO,
  janelaDoMes,
  painelDePapel,
  type LinhaPrevistaDoPapel,
} from "@/lib/papel-de-pao";

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

    const hoje = today();

    // O MES PEDIDO (HMO-295). Ausente ou estragado cai no mes corrente, e nao
    // em 400: ver `mesPedido` em lib/papel-de-pao.ts para o porque -- uma
    // querystring cortada no meio nao pode apagar o modulo inteiro.
    const month = request.nextUrl.searchParams.get("month");
    const janela = janelaDoMes(month, hoje);

    // A agenda do mes pedido pode ainda nao existir como linha: ela nasce das
    // regras recorrentes. `janelaParaMaterializar` nunca comeca antes de hoje --
    // materializar para tras fabricaria contas vencidas retroativas -- e devolve
    // `null` para mes inteiramente passado, que e por isso que abrir setembro
    // mostra so o que ja esta gravado e abrir NOVEMBRO cria as linhas das
    // regras recorrentes de novembro. E este elo que faz o "ver o mes seguinte"
    // da issue responder algo em vez de "nenhuma conta prevista".
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
    //
    // `id`, `description` e `user_id` ENTRARAM NA HMO-300, e sao TRES COLUNAS
    // NA CONSULTA QUE JA EXISTE -- nao uma consulta nova, que e o criterio da
    // issue. Elas alimentam a lista que o chevron abre, e nenhuma delas entra
    // em soma nenhuma:
    //
    //   * `description` e o NOME da linha. Sem ela a lista sai sem nome;
    //   * `id` e o que diz se a linha existe no banco (`gravada`), e e o que
    //     separa a conta gravada da fatura aberta sintetizada, que tem `id`
    //     nulo de proposito;
    //   * `user_id` e o que decide `posso_editar`. A policy do 005 traz as
    //     linhas de grupo dos OUTROS membros junto com as minhas, e um botao
    //     de Excluir sobre a linha alheia e recusado pela RLS -- com `UPDATE`
    //     voltando 200 sem alterar nada, que e o modo de falha caro.
    const { data: linhasBrutas, error } = await supabase
      .from("scheduled_transactions_effective")
      .select(
        "id, due_date, description, amount, status, direction, category_id, group_id, user_id, notes, account:financial_accounts(account_type)"
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

    let pesosPorGrupo: ParticipantesPorGrupo = new Map();

    if (gruposEnvolvidos.length > 0) {
      // `id, user_id, percentage` SAO LOAD-BEARING, e o modo de falha de tirar um dos
      // dois e silencioso (HMO-303): sem `percentage` todo peso vira 0, o
      // `ratearPorPeso` cai no degrau do 0/0 e o grupo 70/30 volta a dividir
      // IGUAL -- o defeito que esta issue consertou, de volta, sem erro, sem log
      // e com o `tsc` verde. Sem `user_id` a lista sai vazia e a linha de grupo
      // volta ao valor CHEIO. Quem tranca isso e a sonda textual de
      // scripts/test-contrato-do-papel-de-pao.mjs.
      const { data: membros, error: erroMembros } = await supabase
        .from("group_members")
        .select("id, group_id, user_id, percentage, status")
        .in("group_id", gruposEnvolvidos)
        .eq("status", "active");

      if (erroMembros) {
        // Sem os pesos, `parteConfiguradaDoMembro` mantem o valor CHEIO: erra
        // para cima, que e a direcao barata. Subestimar a conta a pagar e o modo
        // caro.
        console.error(
          "Painel de papel seguiu sem dividir a parte do grupo:",
          erroMembros
        );
      } else {
        pesosPorGrupo = montarParticipantesPorGrupo(membros ?? []);
      }
    }

    // A CONTA, inteira, numa chamada. `parteConfiguradaDoMembro` roda dentro
    // dela -- e por isso a divisao do grupo tambem esta sob a suite, e nao so
    // aqui.
    const painel = painelDePapel(linhas, {
      janela,
      pesosPorGrupo,
      categoriasDeSalario,
      // QUEM ESTA OLHANDO (HMO-300). A rota e quem autentica, entao e dela que
      // sai a resposta; a REGRA ("a linha e minha?") fica na lib, onde
      // `npm run test:papel-de-pao` a alcanca. Sem este campo `posso_editar`
      // cai para `false` em toda linha -- nenhum botao aparece, que e a
      // direcao barata.
      meuUserId: user.id,
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
