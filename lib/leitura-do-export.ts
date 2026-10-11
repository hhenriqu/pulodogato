// A guarda de leitura do export de relatorio (HMO-378).
//
// O DEFEITO QUE ISTO EXISTE PARA APAGAR
// -------------------------------------
// `app/api/reports/export/route.ts` tinha DOZE chamadas `.from(...)`. Duas
// desestruturavam `error` (para `console.error`, so) e NENHUMA das doze mudava
// a resposta: uma leitura que falhava devolvia `data: null`, o `?? []` seguinte
// fazia dela uma secao vazia, e a rota respondia **200 com um CSV sem linhas**
// -- com os cabecalhos de download corretos e o nome de arquivo certo.
//
// O 200 e a parte caro. Quem exportou o ano inteiro abre a planilha, ve as
// colunas e nenhuma linha, e conclui que **nao houve movimento** -- nao que a
// leitura falhou. E a familia `export-de-relatorio-nunca-confere-error-nos-cinco`
// + `CSV vazio com 200`, e e pior que o irmao dela
// (`fontes-consistentes-que-discordam`): ali dois numeros discordam e alguem
// percebe; aqui o arquivo e internamente coerente e esta vazio.
//
// POR QUE 500, E NAO UMA LINHA "FALHOU" DENTRO DO CSV
// ---------------------------------------------------
// A decisao oposta esta certa em `/api/movimentacoes/resumo`, e esta escrita
// la: seguir com o reembolso zerado em vez de trocar os tres numeros do mes por
// uma tela de erro. Uma TELA tem onde se explicar -- o usuario esta olhando o
// app, ha um aviso ao lado do numero, e ele pode recarregar.
//
// O export nao tem esse lugar. Ele existe para ser **arquivado e conferido
// depois, fora do app**: a planilha e aberta semanas depois, por quem talvez
// nao o tenha baixado, e um `#ERRO` numa celula perdida no meio de 400 linhas
// nao se distingue de um dado. Um arquivo incompleto nao tem como se explicar
// no lugar onde vai ser lido, entao ele nao pode existir.
//
// POR QUE UM HELPER, E NAO UM `if (error) return` EM CADA RAMO
// ------------------------------------------------------------
// Porque o corpo da resposta tem de dizer QUAL consulta falhou -- "Erro
// interno" manda quem recebeu o 500 abrir oito ramos de rota para descobrir o
// que nao leu. Com oito `if` escritos a mao, oito mensagens divergem; com um
// helper, o nome da consulta e o unico parametro que varia.
//
// Isso NAO reduz os oito pontos de guarda a um: a guarda continua tendo de ser
// CHAMADA em cada ramo, e `apagar-runner-derruba-ancora-do-guarda-dos-mutantes`
// vale aqui -- por isso scripts/mutantes-export-de-relatorio.mjs tem um mutante
// por chamada, e nao um pelo helper.

/**
 * O erro do PostgREST, no minimo que esta guarda le.
 *
 * Estrutural e com tudo opcional de proposito: o `PostgrestError` do
 * supabase-js casa com isto, e o `{ data: [] }` dos ramos que NAO consultam
 * (quando a lista de ids esta vazia) tambem -- sem precisar inventar um
 * `error: null` so para satisfazer o tipo.
 */
export type ErroDeLeitura = {
  message?: string | null;
  code?: string | null;
  details?: string | null;
  hint?: string | null;
};

/**
 * A falha de UMA consulta do export, com o nome dela.
 *
 * Classe propria, e nao `new Error(texto)`, porque o `catch` da rota precisa
 * distinguir ESTA falha de um defeito de programacao (um `TypeError`, por
 * exemplo). As duas respondem 500, mas so esta pode contar ao cliente o que
 * nao leu: repetir a mensagem de um `TypeError` no corpo da resposta vazaria
 * caminho de arquivo e nome de variavel.
 */
export class FalhaDeLeituraDoExport extends Error {
  /** A consulta, em portugues, como ela aparece no corpo do 500. */
  readonly consulta: string;

  /** A mensagem do banco. Vai no corpo: e o que diz se foi RLS, view ou rede. */
  readonly detalhe: string;

  /** `42501`, `42P01`, `PGRST205`... `null` quando o erro nao traz codigo. */
  readonly codigo: string | null;

  constructor(consulta: string, erro: ErroDeLeitura) {
    const detalhe = erro.message ?? "erro sem mensagem";
    super(`Falha ao ler ${consulta}: ${detalhe}`);
    this.name = "FalhaDeLeituraDoExport";
    this.consulta = consulta;
    this.detalhe = detalhe;
    this.codigo = erro.code ?? null;
  }
}

/**
 * As linhas de uma leitura do export, ou a falha dela.
 *
 * Substitui o `data ?? []` -- e e a diferenca inteira entre as duas versoes
 * desta rota. O `?? []` transforma "nao consegui ler" em "nao havia nada",
 * que sao a mesma coisa no arquivo e opostas na realidade.
 *
 * `data: null` com `error: null` continua virando lista vazia: o PostgREST nao
 * produz esse par num `select`, e inventar uma falha para ele faria a rota
 * quebrar por um estado que nao existe (`trava-pode-proteger-estado-inalcancavel`).
 * O que esta guarda mede e o `error`, nao o `data`.
 */
export function linhasOuFalha<T>(
  consulta: string,
  resposta: { data: T[] | null; error?: ErroDeLeitura | null }
): T[] {
  if (resposta.error) {
    throw new FalhaDeLeituraDoExport(consulta, resposta.error);
  }

  return resposta.data ?? [];
}
