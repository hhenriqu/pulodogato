import { createClient } from "@/utils/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { groupSplitConfigSchema } from "@/lib/validations/financial";
import {
  conferirConfiguracao,
  paraPercentual,
} from "@/lib/divisao-configurada";

export const dynamic = "force-dynamic";

/**
 * A CONFIGURACAO DE DIVISAO DO GRUPO (HMO-245, fase 3).
 *
 *   PUT /api/expense-groups/{groupId}/split-config
 *   { "default_split_type": "percentage",
 *     "members": [ { "member_id": "...", "percentage": 70 },
 *                  { "member_id": "...", "percentage": 30 } ] }
 *
 * Esta e a PRIMEIRA escrita em `group_members.percentage` que o app tem. A
 * coluna existe desde a 001 (`numeric(5,2)`, CHECK 0..100, linha 1216), o CHECK
 * existe, a sugestao "Divisao Proporcional" de `split-suggestions` LE a coluna
 * -- e um `grep` em todo `app/` + `lib/` nao acha um unico UPDATE nela. Por isso
 * aquela sugestao e codigo morto: ela so monta se `m.percentage > 0`, e o valor
 * e o `DEFAULT 0.00` de sempre, em todo grupo que existe.
 *
 * `group_members.percentage` E A VERDADE -- NAO `group_member_proportions`
 * -----------------------------------------------------------------------
 * Existe um segundo armazem de porcentagem no schema
 * (`group_member_proportions.proportion_percentage`, 001:1200). Esta rota NAO
 * escreve nele, por decisao do plano: ele e aposentado na fase 7. Dois armazens
 * de porcentagem e como se chega a duas telas discordando sobre dinheiro, e
 * nenhuma das duas sabendo qual esta certa.
 *
 * POR QUE OS PERCENTUAIS SAO GRAVADOS ANTES DO MODO
 * -------------------------------------------------
 * O pedido da fase e "grava os dois numa transacao so", e com o supabase-js nao
 * existe transacao de duas instrucoes -- cada chamada PostgREST e a sua propria.
 * Transacao de verdade exigiria uma funcao no banco, e a fase 3 nao tem
 * migration (a unica do escopo e a fase 2, e ela vai sozinha para a `main`).
 *
 * O que da para garantir sem migration, e o que esta feito aqui, e duas coisas:
 *
 *   1. **Os percentuais, entre si, sao atomicos.** Todos os membros vao num
 *      UNICO `upsert`, que o PostgREST executa como um `INSERT ... ON CONFLICT
 *      DO UPDATE` so -- uma instrucao, uma transacao. Um laco de UPDATE por
 *      membro e o que nao da para fazer: falhar no terceiro de quatro deixa a
 *      configuracao somando 70%, e nada no banco conserta isso depois (o
 *      `group_members_percentage_check` confere LINHA, nao conjunto -- um CHECK
 *      nao ve as outras linhas).
 *
 *   2. **A ORDEM das duas escritas torna a falha parcial inofensiva.** Os
 *      percentuais primeiro, o modo depois. Se a segunda falhar, o grupo fica
 *      com os percentuais novos e o modo ANTIGO -- e o modo antigo e o que
 *      decide se alguem os usa. O inverso seria o estrago: gravar
 *      `default_split_type = 'percentage'` e falhar nos percentuais deixa o
 *      grupo em modo porcentagem com os quatro zeros do `DEFAULT 0.00`, ou seja,
 *      um fechamento que rateia 0% da conta da casa. Por isso o modo e a ultima
 *      escrita: ele e o que "liga" a configuracao.
 *
 * Nao ha rollback do passo 1 quando o passo 2 falha, de proposito: desfazer e
 * uma terceira escrita, que pode falhar pelo mesmo motivo que a segunda falhou,
 * e o estado em que ela deixaria o grupo nao e mais seguro que o estado em que
 * ele ja esta. A resposta diz, em texto, o que ficou gravado e o que nao ficou.
 *
 * O CORPO PRECISA LISTAR EXATAMENTE OS MEMBROS ATIVOS
 * ---------------------------------------------------
 * Nem a mais nem a menos, sem repetidos. Isso parece rigor burocratico e nao e:
 * a invariante e a SOMA do conjunto. Deixar um membro de fora gravaria 70/30
 * entre dois de tres e manteria o terceiro no valor velho -- a soma gravada
 * viraria 70+30+x, que e qualquer coisa menos 100. Recusar e a unica saida que
 * nao envolve adivinhar o que o cliente quis dizer sobre o membro ausente.
 *
 * Membro INATIVO fica fora dos dois lados: ele nao entra no conjunto exigido e
 * a `percentage` dele nao e tocada. Quem saiu do grupo nao divide a conta, e o
 * numero parado na linha dele nao atrapalha ninguem porque ninguem soma linha
 * inativa.
 *
 * O que esta conferencia NAO cobre e alguem entrar ou sair do grupo entre a
 * leitura dos ativos e o `upsert`: o conjunto gravado seria o de um instante
 * atras, e a soma deixaria de fechar. Nao da para travar isso aqui -- a soma e
 * uma invariante de CONJUNTO e nenhum CHECK a enxerga (ver o cabecalho de
 * `lib/divisao-configurada.ts`). A defesa contra esse estado ja existe e e na
 * LEITURA: `divisaoDaDespesa` recusa uma configuracao que nao some 10000, em
 * vez de ratear 97% da conta em silencio.
 *
 * O QUE E GRAVADO E O NUMERO NORMALIZADO, NAO O QUE VEIO NO CORPO
 * ---------------------------------------------------------------
 * `percentage` e `numeric(5,2)`: mandar `33.333` grava `33.33`, e o Postgres faz
 * esse arredondamento CALADO (caso 5 de
 * `database/tests/hmo269_split_config_test.sql`). Tres membros com `33.333`
 * passariam por uma conferencia de soma feita sobre o corpo (99,999 ~ 100) e
 * deixariam no banco uma soma de 99,99 -- um residual que pagamento nenhum
 * zera. Entao a conta e feita na unidade inteira de
 * `lib/divisao-configurada.ts` (centesimos de ponto, 0..10000), e o que vai
 * para a coluna e o numero que a conferencia APROVOU, nao o que chegou.
 *
 * AS REGRAS DE DECISAO NAO MORAM NESTE ARQUIVO
 * ---------------------------------------------
 * `conferirConfiguracao` (lib/divisao-configurada.ts) e quem recusa membro
 * repetido, conjunto incompleto e soma != 100. Esta rota so traduz a recusa
 * para HTTP. E a mesma separacao de `lib/fechamento-do-grupo.ts`, pelo mesmo
 * motivo: todo defeito nessas tres regras sai daqui como um 200 com o numero
 * errado, e um handler so e verificavel por um 200. Na funcao pura eles tem
 * teste (`npm run test:divisao-configurada`) e mutante
 * (`npm run mutantes:divisao-configurada`).
 *
 * POR QUE `members` E OBRIGATORIO ATE EM `equal`
 * ----------------------------------------------
 * Seria tentador aceitar `default_split_type: "equal"` sem percentuais, ja que
 * em divisao igual eles nao pesam. Mas isso cria um segundo caminho de codigo
 * com uma regra propria sobre o que fica gravado na coluna, e o grupo volta
 * para o estado "modo diz uma coisa, coluna diz outra". A tela (fase 5) sempre
 * tem uma lista que soma 10000 em maos -- `igualitario()` produz uma para o
 * caso igual --, entao exigir sempre custa nada e mantem coluna e modo
 * coerentes em todo caminho.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { groupId: string } }
) {
  try {
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { groupId } = params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Corpo inválido" }, { status: 400 });
    }

    const parsed = groupSplitConfigSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Configuração de divisão inválida",
          detalhes: parsed.error.issues.map((i) => ({
            campo: i.path.join("."),
            erro: i.message,
          })),
        },
        { status: 400 }
      );
    }

    // A mesma guarda, e o mesmo par de respostas, do PATCH do grupo
    // (route.ts:189 e :224): quem nao e membro ativo nao descobre nem que o
    // grupo existe; quem e membro mas nao e admin leva 403.
    const { data: membership } = await supabase
      .from("group_members")
      .select("role")
      .eq("group_id", groupId)
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (!membership) {
      return NextResponse.json(
        { error: "Grupo não encontrado ou acesso negado" },
        { status: 404 }
      );
    }

    if (membership.role !== "admin") {
      return NextResponse.json(
        { error: "Apenas administradores podem editar o grupo" },
        { status: 403 }
      );
    }

    const { data: ativos, error: erroMembros } = await supabase
      .from("group_members")
      .select("id, group_id, user_id")
      .eq("group_id", groupId)
      .eq("status", "active");

    if (erroMembros || !ativos) {
      return NextResponse.json(
        { error: "Não foi possível ler os membros do grupo" },
        { status: 500 }
      );
    }

    // As tres regras -- repetido, conjunto e soma -- moram em
    // `lib/divisao-configurada.ts`, com teste e mutante. Aqui so traduzimos a
    // recusa para HTTP.
    const conferencia = conferirConfiguracao(
      ativos.map((m) => m.id),
      parsed.data.members
    );

    if (!conferencia.ok) {
      const { recusa } = conferencia;

      if (recusa.motivo === "repetido") {
        return NextResponse.json(
          { error: "O mesmo membro aparece mais de uma vez na configuração" },
          { status: 400 }
        );
      }

      if (recusa.motivo === "conjunto") {
        return NextResponse.json(
          {
            error:
              "A configuração precisa listar exatamente os membros ativos do grupo",
            membros_ativos_sem_percentual: recusa.faltando,
            membros_desconhecidos_ou_inativos: recusa.sobrando,
          },
          { status: 400 }
        );
      }

      return NextResponse.json(
        {
          error: `Os percentuais somam ${paraPercentual(recusa.centesimos)
            .toFixed(2)
            .replace(".", ",")}% e precisam somar 100%.`,
          soma_percentual: paraPercentual(recusa.centesimos),
        },
        { status: 400 }
      );
    }

    // Casa posicao a posicao com `ativos`: `conferirConfiguracao` devolve na
    // ordem dos ids que recebeu, que e a ordem da leitura do banco.
    const percentualPorMembro = new Map(
      conferencia.porMembro.map((m) => [m.member_id, m.percentage])
    );

    // Uma instrucao so para todos os membros -- ver o cabecalho.
    //
    // `group_id` e `user_id` vao no payload porque o Postgres avalia a tupla
    // PROPOSTA antes de resolver o conflito, e ela reprova por DOIS motivos
    // independentes (os dois medidos no banco de validacao, com SET ROLE
    // authenticated):
    //
    //   * a policy de INSERT `group_members_insert` e avaliada mesmo quando
    //     nenhuma linha nova sera criada. Sem `group_id` ela chama
    //     `is_group_admin(NULL)`, que nao e verdadeiro, e a chamada volta "new
    //     row violates row-level security policy";
    //   * e, com a RLS fora do caminho, o `NOT NULL` de `group_id` estoura
    //     sozinho.
    //
    // Os dois valores saem da leitura acima, e nao do corpo, entao um
    // `member_id` forjado nao tem como virar uma linha nova pendurada em outro
    // grupo -- ele ja foi recusado como "desconhecido".
    //
    // `role` e `status` ficam DE FORA: o `DO UPDATE SET` do PostgREST so toca
    // as colunas que vieram, e reenviar os valores lidos transformaria esta
    // rota num caminho que sobrescreve papel de membro.
    const { data: gravados, error: erroPercentuais } = await supabase
      .from("group_members")
      .upsert(
        ativos.map((m) => ({
          id: m.id,
          group_id: m.group_id,
          user_id: m.user_id,
          percentage: percentualPorMembro.get(m.id)!,
        })),
        { onConflict: "id" }
      )
      .select("id, percentage");

    if (erroPercentuais) {
      return NextResponse.json(
        { error: "Não foi possível gravar os percentuais dos membros" },
        { status: 500 }
      );
    }

    // Escrita barrada pela RLS volta como sucesso com zero linhas, nao como
    // erro -- conferir so o `error` acima daria 200 num grupo onde nada foi
    // gravado. A contagem e a unica coisa que distingue os dois casos.
    if (!gravados || gravados.length !== ativos.length) {
      return NextResponse.json(
        {
          error:
            "Os percentuais não foram gravados para todos os membros do grupo",
          membros_ativos: ativos.length,
          linhas_gravadas: gravados?.length ?? 0,
        },
        { status: 500 }
      );
    }

    const { data: grupo, error: erroModo } = await supabase
      .from("expense_groups")
      .update({
        default_split_type: parsed.data.default_split_type,
        updated_at: new Date().toISOString(),
      })
      .eq("id", groupId)
      .select("id, default_split_type")
      .maybeSingle();

    if (erroModo || !grupo) {
      return NextResponse.json(
        {
          error:
            "Os percentuais foram gravados, mas o modo de divisão não. Repita a operação.",
          percentuais_gravados: true,
          modo_gravado: false,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      default_split_type: grupo.default_split_type,
      // O que a coluna guarda, devolvido pelo proprio banco -- nao o que o
      // corpo pediu. Um cliente que mandou `33.333` tem que ver `33.33` aqui.
      members: gravados.map((m) => ({
        member_id: m.id,
        percentage: Number(m.percentage),
      })),
    });
  } catch (error) {
    console.error("Erro em PUT /split-config:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
