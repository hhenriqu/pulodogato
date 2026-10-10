/**
 * O filtro de busca de pessoas da aba Conexoes.
 *
 * A tela montava o filtro colando o texto digitado direto na arvore logica do
 * PostgREST:
 *
 *   .or(`full_name.ilike.%${termo}%,nickname.ilike.%${termo}%`)
 *
 * A virgula e o separador de disjuncao nessa arvore, e o parenteses e o ponto
 * tambem sao sintaxe. Entao qualquer nome com virgula -- "Silva, Joao", que e
 * como meio mundo escreve o proprio nome -- nao busca: o PostgREST recusa a
 * expressao inteira com PGRST100 e a tela cai no catch e mostra "Erro ao buscar
 * usuários". Medido em producao nesta forma exata (HMO-142).
 *
 * Nao era vazamento: os portoes `is_public` e `allow_connections` vao como
 * filtros ANDados, fora do `or`, e um termo hostil nao os alcanca -- conferido
 * em producao, a tentativa de injetar `is_public.eq.false` continuou devolvendo
 * so perfil publico. O defeito e de busca quebrada, nao de perfil exposto.
 *
 * O conserto e CITAR o valor. O PostgREST aceita o operando entre aspas duplas,
 * e ai virgula, parenteses e ponto sao texto comum. Dentro das aspas, so
 * `\` e `"` precisam de escape.
 */

/** Escapa o que tem significado DENTRO de um operando citado do PostgREST. */
function citar(valor: string): string {
  return `"${valor.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Monta a arvore `or` da busca por nome/apelido.
 *
 * Devolve `null` quando nao ha o que buscar: sem isto, termo vazio vira
 * `ilike.%%`, que casa com TODO perfil publico da base e transforma o campo de
 * busca em listagem de usuarios.
 */
export function montarFiltroDeBusca(termo: string): string | null {
  const limpo = (termo ?? "").trim();
  if (!limpo) return null;

  // O `%` do usuario continua sendo curinga do LIKE de proposito: quem digita
  // "jo%o" espera curinga. O que nao pode e quebrar a ARVORE.
  const alvo = citar(`%${limpo}%`);
  return `full_name.ilike.${alvo},nickname.ilike.${alvo}`;
}

/**
 * O PORTAO DE CONEXAO: `allow_connections` com `NULL` significa PERMITE.
 *
 * A coluna e anulavel e o default dela e `true` (`001_baseline.sql:1252`).
 * `NULL` ali nao quer dizer "recusou" -- quer dizer "nunca mexeu no botao", e
 * quem nunca mexeu continua com o default, que e permitir. A migration 010 ja
 * decidiu isto, e decidiu por escrito: a policy de INSERT de `user_connections`
 * compara `COALESCE(p.allow_connections, true)` (`010:198`, com o comentario em
 * `010:193` dizendo exatamente isto).
 *
 * O app discordava do banco. Tres leituras filtravam `allow_connections = true`,
 * e `= true` NAO casa com `NULL` em SQL (o resultado e `NULL`, que nao e
 * verdadeiro). O efeito era um estado que a policy ADMITE e que a busca NUNCA
 * MOSTRA: o perfil existe, aceita conexao pelo banco, e simplesmente nao
 * aparece -- sem erro, sem log, sem sintoma. HMO-373.
 *
 * MEDIDO EM PRODUCAO (2026-10-10, sessao real da conta de teste, porque a RLS
 * fecha `profiles` para o papel read-only): dos 13 perfis publicos, **0 estao
 * com a coluna `NULL`** hoje. O defeito era latente, nao ativo -- ninguem
 * estava invisivel. O que o torna real e que nada impede o `NULL`: a coluna
 * aceita, a policy admite, e `app/api/profile/route.ts` grava `Boolean(...)`
 * so no caminho que passa pelo formulario.
 *
 * A FORMA DO FILTRO, e por que `not.is.false` e nao `or(is.null,eq.true)`
 * ----------------------------------------------------------------------
 * As duas dao o mesmo resultado -- conferi as duas em producao contra uma linha
 * `NULL` de verdade (gravei `NULL` na propria linha da conta de teste, medi, e
 * restaurei para `true`):
 *
 *   allow_connections=eq.true        -> 12 de 13   PERDE a linha NULL
 *   allow_connections=is.null        ->  1         e ela esta la
 *   allow_connections=not.is.false   -> 13 de 13   ACHA a linha NULL
 *   or=(...is.null,...eq.true)       -> 13 de 13   idem
 *
 * Escolhi `not.is.false` por duas razoes. A primeira e que ele e UM filtro, e
 * portanto ANDa com o resto da cadeia sem ambiguidade -- a busca JA gasta o
 * `.or()` dela na arvore de nome/apelido, e empilhar um segundo `or=` na mesma
 * consulta depende de o PostgREST ANDar os dois, que e verdade mas e uma regra
 * a mais para alguem lembrar. A segunda e que `IS NOT FALSE` e literalmente
 * `COALESCE(x, true)` em SQL para uma coluna de tres estados, ou seja o filtro
 * passa a ser a MESMA frase que a policy da 010 -- e quando os dois concordam
 * por construcao, nao ha como um deles voltar a divergir em silencio.
 *
 * Isto NAO afrouxa nada: `allow_connections = false` continua fora, e o portao
 * `is_public` continua intacto e ANDado por fora. Quem desligou o botao de
 * proposito continua invisivel -- e e esse o controle negativo do teste.
 */
export function aplicarPortaoDeConexao<
  Q extends { not(coluna: string, operador: string, valor: unknown): Q },
>(consulta: Q): Q {
  return consulta.not("allow_connections", "is", false);
}

/**
 * A MESMA regra do portao, para quem ja tem o valor na mao em vez de uma
 * consulta para filtrar (`app/api/connections/route.ts`).
 *
 * Existe como funcao, e nao como `if (!valor)` repetido, porque `!valor` e
 * exatamente o defeito: `!null` e `true`, entao um `if (!allow_connections)
 * recusa` RECUSA o perfil que a policy admite -- a rota de pedir conexao
 * respondia "Este usuário não aceita conexões" para alguem que aceita, e o
 * INSERT teria passado se a rota tivesse deixado chegar nele.
 */
export function permiteConexao(valor: boolean | null | undefined): boolean {
  return valor !== false;
}

/**
 * O termo digitado e um e-mail?
 *
 * Deliberadamente conservador, e a conta nao e de elegancia: todo termo que
 * passar por aqui vai virar uma consulta a `get_user_by_email`, e um termo que
 * passe por engano ("fulano@" num nome) so gasta uma ida a mais. O que nao pode
 * e o contrario -- um e-mail de verdade que nao seja reconhecido cai no
 * `ilike` de nome e nao acha ninguem, que e o estado de hoje.
 *
 * Exige um `@` unico, parte local nao vazia, dominio com ponto e nenhum espaco.
 * Nao e validacao de RFC: a decisao de quem existe e do `get_user_by_email`.
 */
export function pareceEmail(termo: string): boolean {
  const limpo = (termo ?? "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpo);
}
