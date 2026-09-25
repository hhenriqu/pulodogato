// =====================================================
// O QUE UMA TELA DE LEITURA PODE MOSTRAR QUANDO A BUSCA NAO DEU CERTO
// =====================================================
// Consertando o "zero confiante". Sem rede, hoje, a tela de contas imprime:
//
//     Saldo somado das contas    R$ 0,00
//     Faturas em aberto          R$ 0,00
//     Voce ainda nao tem contas / Cadastre sua conta corrente...
//
// Nada disso e erro de calculo: a lista veio vazia porque a busca falhou, e
// `soma([]) === 0`. O zero esta certo e a FRASE esta errada -- o app afirma
// algo sobre o dinheiro da pessoa que ele nao tem como saber.
//
// Esta e a razao pela qual so duas rotas entraram no precache ate aqui
// (`lib/pwa-precache.js`): abrir as outras sem rede seria publicar essa tela.
// O modulo abaixo e o que faltava para as demais poderem entrar.
//
// -----------------------------------------------------------------------
// TRES SILENCIOS DIFERENTES QUE VIRAVAM A MESMA LISTA VAZIA
// -----------------------------------------------------------------------
//   1. o servidor respondeu, e voce realmente nao tem nada -> a frase de
//      estado vazio esta certa, e ela e util;
//   2. ninguem respondeu (sem rede, sem copia no aparelho) -> nao ha o que
//      dizer sobre o seu dinheiro. So da para dizer que nao deu para olhar;
//   3. o servidor respondeu com erro (500, 401) -> problema nosso, e a acao
//      da pessoa e outra: esperar, ou entrar de novo.
//
// E um quarto caso, que nao e silencio nenhum e e o mais traicoeiro:
//
//   4. o service worker serviu a copia guardada. Ha dado de verdade na tela,
//      completo e plausivel -- e ele pode ser de ontem. Ver o carimbo em
//      `lib/pwa-runtime-cache.js`: sem ele, este caso e indistinguivel do 1.
//
// Os quatro terminavam no mesmo lugar. Um caso que nao existe no codigo
// tambem nao existe no teste -- e o defeito das categorias offline (PR #57)
// foi exatamente isso: um caso que ninguem tinha escrito.
//
// NAO use `navigator.onLine` para esta decisao. Ele e confiavel no negativo e
// otimista no positivo: em wi-fi de hotel, em tunel, em rede com portal de
// login, ele diz `true` com o pacote sem sair do aparelho. A evidencia boa e o
// que aconteceu com a requisicao -- que e o que esta funcao recebe.
// =====================================================

/** Como a tela conseguiu (ou nao) o dado que ela mostra. */
export type EstadoDaLeitura =
  /** O servidor respondeu agora. */
  | "fresco"
  /** O dado e real e veio do aparelho: pode estar velho, e da para dizer de quando. */
  | "do-aparelho"
  /** Ninguem respondeu e nao ha copia guardada. Nao ha nada honesto a mostrar. */
  | "sem-rede"
  /** O servidor respondeu, e respondeu erro. */
  | "erro-do-servidor"
  /** O servidor disse que a sessao nao vale. Quem manda para /login e o layout. */
  | "sessao-recusada";

/**
 * Os dois cabecalhos que o service worker acrescenta. Tem que ser iguais aos
 * de `lib/pwa-runtime-cache.js` -- ha teste comparando os dois arquivos,
 * porque uma letra diferente aqui apaga o aviso de dado velho sem apagar o
 * dado: a tela volta a mostrar ontem como se fosse agora, e nada fica vermelho.
 */
export const MARCA_DO_APARELHO = "x-pulodogato-do-aparelho";
export const MARCA_GUARDADO_EM = "x-pulodogato-guardado-em";

export interface RespostaObservada {
  ok: boolean;
  status: number;
  /** `resposta.headers.get`. */
  cabecalho: (nome: string) => string | null;
}

export interface LeituraObservada {
  /** A resposta, ou null quando o `fetch` nem chegou a devolver uma. */
  resposta: RespostaObservada | null;
}

export interface Classificacao {
  estado: EstadoDaLeitura;
  /** Quando o servidor produziu o dado, so quando ele veio do aparelho. */
  guardadoEm: Date | null;
}

export function classificarLeitura({
  resposta,
}: LeituraObservada): Classificacao {
  // O `fetch` nao devolveu resposta nenhuma: a requisicao nao saiu, ou saiu e
  // ninguem respondeu. Nao e chute -- se houvesse copia no aparelho, o service
  // worker a teria entregue aqui (NetworkFirst), com `ok` verdadeiro e o
  // carimbo. Nao ter resposta E a prova de que nao ha copia.
  if (!resposta) return { estado: "sem-rede", guardadoEm: null };

  // Antes do `ok`: o servidor respondeu com todas as letras que o token nao
  // vale. Tratar isto como "erro do servidor" mandaria a pessoa esperar por
  // algo que nunca vai melhorar sozinho.
  if (resposta.status === 401 || resposta.status === 403) {
    return { estado: "sessao-recusada", guardadoEm: null };
  }

  if (!resposta.ok) return { estado: "erro-do-servidor", guardadoEm: null };

  if (resposta.cabecalho(MARCA_DO_APARELHO) === "1") {
    return {
      estado: "do-aparelho",
      guardadoEm: lerData(resposta.cabecalho(MARCA_GUARDADO_EM)),
    };
  }

  return { estado: "fresco", guardadoEm: null };
}

/**
 * `true` so quando ha dado atras do numero.
 *
 * A regra de uma linha que mata o zero confiante: todo total, media e contagem
 * da tela passa por aqui, e o que nao passa vira travessao. `null` e "ainda
 * carregando" -- durante o carregamento tambem nao da para afirmar R$ 0,00.
 */
export function podeMostrarNumero(estado: EstadoDaLeitura | null): boolean {
  return estado === "fresco" || estado === "do-aparelho";
}

/**
 * `true` quando a frase de estado vazio ("voce ainda nao tem contas") pode ser
 * dita.
 *
 * So depois de o servidor ter respondido agora. Com dado do aparelho a lista
 * pode estar vazia por ser uma copia de antes de a pessoa cadastrar a primeira
 * conta -- e a frase convidaria a cadastrar de novo o que ja existe.
 */
export function podeAfirmarVazio(estado: EstadoDaLeitura | null): boolean {
  return estado === "fresco";
}

/** Data do cabecalho, recusando o que nao da para ler. */
function lerData(cru: string | null): Date | null {
  if (!cru) return null;
  const quando = new Date(cru);
  return Number.isNaN(quando.getTime()) ? null : quando;
}

/**
 * "hoje as 14:32", "ontem as 09:10", "em 22/09 as 10:03".
 *
 * Escrito a mao, e nao com `toLocaleString`, por duas razoes: "hoje" e "ontem"
 * sao o que a pessoa precisa para decidir se confia no numero (uma data
 * completa exige que ela faca a conta), e o resultado nao muda com o locale do
 * aparelho -- o mesmo teste vale em qualquer maquina.
 */
export function descreverMomento(
  quando: Date | null,
  agora: Date = new Date()
): string {
  if (!quando) return "de um carregamento anterior";

  const hora = `${dois(quando.getHours())}:${dois(quando.getMinutes())}`;
  const dias = diasDeDiferenca(quando, agora);

  if (dias === 0) return `hoje as ${hora}`;
  if (dias === 1) return `ontem as ${hora}`;

  // Inclusive quando `dias` e negativo: relogio do aparelho atrasado faz o
  // dado guardado parecer do futuro. Mostrar a data completa e o unico jeito
  // de nao escrever "amanha as 10:03" embaixo de um saldo.
  return `em ${dois(quando.getDate())}/${dois(quando.getMonth() + 1)} as ${hora}`;
}

/**
 * Quantos dias de CALENDARIO separam as duas datas.
 *
 * Nao e `(agora - quando) / 86400000`: 23:50 e 00:10 sao vinte minutos e dias
 * diferentes, e "ontem as 23:50" e a resposta certa. Subtrair timestamps diria
 * "hoje" -- e diria "hoje" ate para as 00:10 de depois de amanha.
 */
function diasDeDiferenca(quando: Date, agora: Date): number {
  const a = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const b = new Date(quando.getFullYear(), quando.getMonth(), quando.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

const dois = (n: number) => String(n).padStart(2, "0");

export interface Leitura<T> {
  estado: EstadoDaLeitura;
  guardadoEm: Date | null;
  /** O corpo, quando houve corpo utilizavel. */
  dados: T | null;
}

/**
 * `fetch` que nao lanca e volta classificado.
 *
 * Existe para que a pagina nao precise de try/catch em volta de cada busca --
 * e era o try/catch que vinha escondendo os quatro casos um dentro do outro.
 */
export async function buscarLeitura<T>(
  url: string,
  init?: RequestInit
): Promise<Leitura<T>> {
  let resposta: Response | null = null;

  try {
    resposta = await fetch(url, init);
  } catch {
    // Sem resposta nenhuma. O motivo exato (DNS, TCP, CORS) nao muda o que a
    // tela faz, e nenhum deles e "o servidor disse alguma coisa".
    resposta = null;
  }

  const { estado, guardadoEm } = classificarLeitura({
    resposta: resposta
      ? {
          ok: resposta.ok,
          status: resposta.status,
          cabecalho: (nome) => resposta!.headers.get(nome),
        }
      : null,
  });

  if (estado !== "fresco" && estado !== "do-aparelho") {
    return { estado, guardadoEm, dados: null };
  }

  try {
    return { estado, guardadoEm, dados: (await resposta!.json()) as T };
  } catch {
    // 200 com corpo que nao e JSON. Acontece quando alguma camada no meio
    // devolve uma pagina de erro com status 200 -- e mostrar a tela vazia
    // nesse caso seria de novo afirmar que a pessoa nao tem nada.
    return { estado: "erro-do-servidor", guardadoEm: null, dados: null };
  }
}
