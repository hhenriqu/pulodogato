/**
 * As colunas de `profiles` que uma pessoa pode ver de OUTRA.
 *
 * A policy `profiles_select_own_or_public` (migration 002) libera a LINHA
 * inteira de todo perfil com `is_public = true` -- e RLS nao sabe filtrar
 * coluna. Entao um `select("*")` num perfil alheio devolve tambem `email`,
 * `phone`, `birth_date` e `preferences`, que a tela nunca mostra e o navegador
 * passa a ter em maos: buscar "ana" na aba Conexoes traria o telefone e o
 * e-mail da Ana para dentro do bundle, sem nenhum erro e sem nada aparecer.
 *
 * Esta lista e a unica forma de pedir perfil de terceiro no app. Ela existe
 * como constante, e nao repetida em cada rota, porque quatro copias da mesma
 * regra viram quatro regras diferentes no primeiro dia em que alguem precisar
 * de mais um campo.
 *
 * Para o PROPRIO perfil (tela /dashboard/profile) continua valendo o select
 * completo: a linha e do usuario.
 */
export const PUBLIC_PROFILE_FIELDS =
  "id, full_name, nickname, avatar_url, bio, is_public, allow_connections";
