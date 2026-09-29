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
