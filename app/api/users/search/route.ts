import { createClient } from "@/utils/supabase/server";
import { NextResponse } from "next/server";
import {
  aplicarPortaoDeConexao,
  montarFiltroDeBusca,
  pareceEmail,
} from "@/lib/busca-de-perfil";
import { PUBLIC_PROFILE_FIELDS } from "@/lib/profile-fields";

export const dynamic = "force-dynamic";

/**
 * A busca de pessoas para conectar.
 *
 * HMO-373 mexeu em tres coisas aqui, e vale dizer o que NAO mudou: a resposta
 * continua sendo a mesma lista de colunas (`PUBLIC_PROFILE_FIELDS`), e os dois
 * portoes -- `is_public` e `allow_connections` -- continuam ANDados por fora da
 * arvore de busca, onde o texto digitado nao os alcanca.
 *
 * 1. O PORTAO DE `allow_connections` ACEITA `NULL`. Ver a decisao escrita em
 *    `lib/busca-de-perfil.ts` (`aplicarPortaoDeConexao`): `NULL` e "nunca mexeu
 *    no botao", o default da coluna e `true`, e a policy da 010 ja usa
 *    `COALESCE(allow_connections, true)`. O `.eq("allow_connections", true)`
 *    de antes escondia um perfil que a policy admite.
 *
 * 2. BUSCA POR E-MAIL, pelo caminho da 039 -- e NAO por `profiles.email`.
 *    Ver a secao abaixo.
 *
 * 3. O filtro de nome passa a sair de `montarFiltroDeBusca`, que CITA o
 *    operando. A rota ainda colava o termo cru na arvore do PostgREST, que e o
 *    defeito que a HMO-142 consertou na tela e deixou aqui: um nome com virgula
 *    ("Silva, Joao") quebrava a expressao inteira com PGRST100 e virava
 *    "Erro ao buscar usuários".
 */

/**
 * POR QUE A BUSCA POR E-MAIL NAO CASA `profiles.email`
 * ----------------------------------------------------
 * `profiles.email` e FORJAVEL, e isto nao e teorico -- e a decisao de seguranca
 * que a migration 039 ja tomou e documentou. A policy de UPDATE da 002 e
 * `USING (id = auth.uid()) WITH CHECK (id = auth.uid())`, e policy de RLS trava
 * a LINHA, nunca a COLUNA: nao existe `OLD` dentro de uma policy. Quem esta
 * logado escreve qualquer string em `profiles.email` da propria linha, e
 * `lib/ensure-profile.ts` grava esse campo a partir do cliente.
 *
 * Se a busca casasse `profiles.email`, o ataque seria: escrevo
 * `profiles.email = 'vitima@...'` na minha linha e passo a ser o resultado de
 * quem procura a vitima pelo e-mail dela. Em `auth.users` nao ha policy que
 * deixe o usuario escrever -- o endereco so chega la por cadastro/confirmacao
 * no GoTrue -- e por isso a comparacao vai por `get_user_by_email` (001), que e
 * `SECURITY DEFINER`, compara `LOWER(auth.users.email)` e exige
 * `email_confirmed_at IS NOT NULL`. E o mesmo caminho que
 * `app/api/expense-groups/invite/route.ts` usa.
 *
 * E O QUE IMPEDE ISTO DE VIRAR VAZAMENTO
 * --------------------------------------
 * `get_user_by_email` nao sabe de `is_public` nem de `allow_connections`: ela
 * devolve QUALQUER conta confirmada. Entao ela nao e usada como resposta -- ela
 * e usada so para RESOLVER O `id`, e o perfil e lido depois da mesma tabela
 * `profiles`, com os MESMOS DOIS PORTOES da busca por nome. Quem desligou
 * `is_public` ou `allow_connections` nao aparece por e-mail tampouco, e a
 * resposta nao ganha coluna nenhuma -- em particular o e-mail devolvido pela
 * funcao e descartado, para a busca por nome nao passar a vazar o e-mail de
 * quem ela achou.
 *
 * O casamento e EXATO, nunca parcial. Um `ilike.%@gmail.com%` transformaria o
 * campo de busca em listagem de usuarios, que e o mesmo motivo pelo qual
 * `montarFiltroDeBusca` recusa termo vazio.
 */
export async function GET(request: Request) {
  try {
    const supabase = createClient();

    // Verificar autenticação
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");

    if (!query || query.length < 2) {
      return NextResponse.json(
        { error: "Query deve ter pelo menos 2 caracteres" },
        { status: 400 }
      );
    }

    const filtroDeNome = montarFiltroDeBusca(query);
    if (!filtroDeNome) {
      return NextResponse.json([]);
    }

    // Buscar usuários públicos que permitem conexões
    const { data: porNome, error } = await aplicarPortaoDeConexao(
      supabase
        .from("profiles")
        .select(PUBLIC_PROFILE_FIELDS)
        .or(filtroDeNome)
        .eq("is_public", true)
        .neq("id", user.id)
    ).limit(20);

    if (error) {
      console.error("Error searching users:", error);
      return NextResponse.json(
        { error: "Erro ao buscar usuários" },
        { status: 500 }
      );
    }

    const achados = [...(porNome || [])];

    // A busca por e-mail e EXTRA, nao alternativa: um apelido pode ser um
    // e-mail, e nesse caso as duas acham e a deduplicacao por `id` abaixo
    // resolve. Ela so sai quando o termo parece e-mail -- caso contrario seria
    // uma ida a mais em toda digitacao.
    if (pareceEmail(query)) {
      const { data: contas } = await supabase.rpc("get_user_by_email", {
        user_email: query.trim(),
      });

      const idDaConta = (contas as { id: string }[] | null)?.[0]?.id;

      // `idDaConta !== user.id` espelha o `.neq("id", user.id)` da busca por
      // nome: procurar o proprio e-mail nao devolve a si mesmo.
      if (idDaConta && idDaConta !== user.id) {
        // OS MESMOS DOIS PORTOES. Sem eles isto seria uma rota que, dado um
        // e-mail, confirma a existencia de qualquer conta do app -- inclusive
        // de quem escolheu ficar fora da busca.
        const { data: perfil } = await aplicarPortaoDeConexao(
          supabase
            .from("profiles")
            .select(PUBLIC_PROFILE_FIELDS)
            .eq("id", idDaConta)
            .eq("is_public", true)
        ).maybeSingle();

        if (perfil && !achados.some((u) => u.id === idDaConta)) {
          achados.push(perfil);
        }
      }
    }

    // Filtrar usuários que já têm conexão
    const userIds = achados.map((u) => u.id);
    if (userIds.length > 0) {
      const { data: connections } = await supabase
        .from("user_connections")
        .select("requester_id, requested_id")
        .or(
          userIds
            .map(
              (id) =>
                `and(requester_id.eq.${user.id},requested_id.eq.${id}),` +
                `and(requester_id.eq.${id},requested_id.eq.${user.id})`
            )
            .join(",")
        );

      const connectedUserIds = new Set();
      connections?.forEach((conn) => {
        if (conn.requester_id === user.id) {
          connectedUserIds.add(conn.requested_id);
        } else {
          connectedUserIds.add(conn.requester_id);
        }
      });

      const filteredUsers = achados.filter((u) => !connectedUserIds.has(u.id));
      return NextResponse.json(filteredUsers);
    }

    return NextResponse.json(achados);
  } catch (error) {
    console.error("Error in users search GET:", error);
    return NextResponse.json(
      { error: "Erro interno do servidor" },
      { status: 500 }
    );
  }
}
