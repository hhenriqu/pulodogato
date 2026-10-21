/**
 * O MOTOR DA CONVERSA DO MODO "PAPEL DE PAO" -- HMO-464, F1 do plano da
 * HMO-462.
 *
 * A tela do modo mostrava RELATORIO: tres numeros, listas que abrem, navegacao
 * mes a mes. A issue-mae pede CONVERSA -- "Ola {Nome}, o que deseja?", botao
 * Gastei, Ganhei, Saldo, e vai caminhando. Este arquivo e a maquina de estados
 * dessa conversa, e so ela.
 *
 * POR QUE E UM REDUTOR PURO
 * -------------------------
 * Mesmo motivo de `lib/menu-do-papel.ts` e `lib/modo-papel.ts`, que ja sao
 * puros: a suite roda em node, sem navegador. Entao aqui nao ha React, nao ha
 * `fetch`, nao ha supabase -- e nao ha data do sistema lida por dentro: o
 * relogio entra por parametro (`hoje`), uma vez, no `conversaInicial`.
 *
 * `components/papel-de-pao/ConversaDePapel.tsx` (F4) e uma CASCA em cima
 * disto: ela pinta `fraseDaPergunta`, `fraseDoResultado` e `botoes`, manda os
 * gestos de volta, e chama a rota de F3 quando o estado vira `pronto`. Nenhuma
 * palavra da conversa e escrita no JSX -- se fosse, a tela e a suite
 * divergiriam na primeira vez que alguem reescrevesse uma frase, e so a tela
 * mudaria.
 *
 * SEM CHAMADA DE IA, DE PROPOSITO
 * -------------------------------
 * A issue descreve BOTOES, nao texto livre. Com botoes o motor e
 * deterministico, de graca e funciona offline -- o app e PWA e ja tem fila
 * offline em `lib/offline-cache.ts`. Texto digitado ("gastei 50") e fase
 * propria DEPOIS de F4 estar em pe, porque traz um interpretador e um caminho
 * de erro novo (o que a tela faz quando nao entende) que este motor nao tem.
 *
 * O QUE ESTE ARQUIVO NAO FAZ, E QUEM FAZ
 * --------------------------------------
 * - NAO grava nada. `lancamentoDaConversa` devolve a INTENCAO (direcao, valor,
 *   data) e quem escreve e a rota de F3, que tambem resolve a conta padrao, a
 *   categoria reservada e o SINAL do `amount` (despesa e negativa em
 *   `financial_transactions`). O sinal mora num lugar so, e esse lugar e a
 *   rota -- aqui o valor e sempre a GRANDEZA, sem sinal.
 * - NAO soma o saldo. `lib/saldo-da-conversa.ts` (F2) faz as tres contas sobre
 *   linhas realizadas. Aqui entram os tres numeros ja prontos, e eles sao
 *   mostrados COMO VIERAM -- ver `frasesDoSaldo`.
 * - NAO pergunta categoria, conta nem data. Nada disso e pergunta para ela, e
 *   a garantia disso nao e um comentario: `Gesto` e uma uniao FECHADA de oito
 *   nomes, e um seletor novo nao tem por onde entrar sem mudar o tipo.
 *
 * O ACUMULADOR E O DE `lib/dinheiro.ts`, NAO UM SEGUNDO
 * -----------------------------------------------------
 * `aoDigitarValor` ja e o teclado de dinheiro de todo campo deste app, com a
 * convencao de CENTAVOS (digitar 1-0-0-0 da "R$ 10,00") e a poda de zero a
 * esquerda. Escrever um acumulador proprio aqui -- em reais inteiros, digamos,
 * para que 1-0-0-0 desse "R$ 1.000,00" como se le na issue -- criaria duas
 * mascaras para o mesmo dinheiro, e elas divergiriam na primeira moeda nova ou
 * no primeiro conserto de arredondamento. Pior: o `Saldo` da tela e formatado
 * por `formatarValor` do MESMO arquivo, entao os tres numeros que a issue quer
 * ver fechando juntos sairiam de dois formatadores diferentes.
 *
 * A consequencia, declarada: "Gastei 1000" da issue e o NUMERO mil, nao quatro
 * teclas. Para anota-lo ela digita 1-0-0-0-0-0 e a tela diz "Gastei R$
 * 1.000,00". Em troca, 47,80 (a compra de verdade) se digita 4-7-8-0 e nenhum
 * centavo se perde -- que e o que um acumulador de reais inteiros nao teria.
 */
import {
  MAX_DIGITOS,
  aoDigitarValor,
  formatarValor,
  valorNumerico,
} from "@/lib/dinheiro";
import {
  ehDataIso,
  modoDoPeriodo,
  rotuloDoPeriodo,
} from "@/lib/periodo-do-painel";
import {
  MesDaConversa,
  TresNumerosDaConversa,
  mesCorrenteDaConversa,
} from "@/lib/saldo-da-conversa";

/** As duas palavras que a issue usa para dinheiro. */
export type Direcao = "gastei" | "ganhei";

/**
 * Os cinco estados da conversa, na ordem em que ela caminha.
 *
 * `pronto` NAO e uma sexta tela: ele e a saudacao com o resultado dito em cima
 * ("volta para a saudacao, e o resultado fica dito em uma frase"). Ele existe
 * como estado proprio -- em vez de um campo solto na saudacao -- porque e o
 * unico momento em que ha um lancamento a mostrar, e porque e a transicao que
 * F4 escuta para chamar a rota de F3.
 */
export const ESTADOS = [
  "saudacao",
  "digitando",
  "confirmando",
  "pronto",
  "saldo",
] as const;

export type Estado = (typeof ESTADOS)[number];

/** A intencao de lancamento -- o que F3 grava. Sem sinal, sem conta, sem categoria. */
export interface Lancamento {
  readonly direcao: Direcao;
  /**
   * A GRANDEZA em notacao decimal com ponto ("1000.00"), como
   * `aoDigitarValor().valor` a devolve. Quem aplica o sinal e a rota.
   */
  readonly valor: string;
  /** 'AAAA-MM-DD' -- o `hoje` que entrou por parametro, nunca um relogio lido aqui. */
  readonly data: string;
}

export interface Conversa {
  readonly estado: Estado;
  /** O primeiro nome, ja recortado. `""` quando nao se sabe o nome. */
  readonly nome: string;
  /** O relogio, POR PARAMETRO. 'AAAA-MM-DD'. */
  readonly hoje: string;
  /** A palavra escolhida. `null` fora de `digitando`/`confirmando`/`pronto`. */
  readonly direcao: Direcao | null;
  /**
   * O acumulador CRU do teclado -- so digitos, sem zero a esquerda e sem
   * mascara. A mascara sai de `valorNaTela`, que e `aoDigitarValor`.
   */
  readonly digitos: string;
  /**
   * O lancamento em jogo: o que ela esta confirmando (em `confirmando`) e o
   * que acabou de ser anotado (em `pronto`). `null` nos outros estados.
   */
  readonly lancamento: Lancamento | null;
}

/** Os oito gestos. Uniao FECHADA -- e o que impede um seletor de nascer aqui. */
export type Gesto =
  | { readonly tipo: "gastei" }
  | { readonly tipo: "ganhei" }
  | { readonly tipo: "saldo" }
  | { readonly tipo: "digito"; readonly digito: string }
  | { readonly tipo: "apagar" }
  | { readonly tipo: "limpar" }
  | { readonly tipo: "confirmar" }
  | { readonly tipo: "voltar" };

export type TipoDeGesto = Gesto["tipo"];

/**
 * As teclas do teclado numerico grande, na ordem em que elas sao pintadas.
 *
 * A ordem mora aqui e nao no JSX pelo mesmo motivo das frases: o zero embaixo,
 * depois do nove, e como todo teclado de telefone se parece, e um `map` na tela
 * que comecasse pelo zero seria um defeito invisivel para qualquer assercao de
 * conta.
 */
export const TECLAS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "0",
] as const;

export interface Botao {
  readonly gesto: TipoDeGesto;
  readonly rotulo: string;
}

/**
 * O primeiro nome, para a saudacao.
 *
 * "Ola Leticia" e a conversa; "Ola Leticia Moraes de Souza" e um cadastro
 * falando. Nome vazio, sujo de espaco ou ausente devolve `""`, e a saudacao
 * perde a virgula junto (ver `fraseDaPergunta`) -- "Ola , o que deseja?" seria
 * a cara de um campo que ninguem preencheu.
 *
 * Quem escolhe a FONTE do nome e F4 (`profiles.full_name`); aqui so se recorta
 * o que chegou. E-mail nao entra como rede: "Ola heliohenriquemoraes" nao e uma
 * conversa, e a saudacao sem nome ja le bem.
 */
export function primeiroNome(nomeCompleto: string | null | undefined): string {
  const limpo = (nomeCompleto ?? "").trim();
  if (limpo === "") return "";
  return limpo.split(/\s+/)[0];
}

/**
 * O primeiro quadro da conversa.
 *
 * `hoje` EXIGE 'AAAA-MM-DD' valido e LANCA quando nao e. Esta e a unica trava
 * do arquivo, e ela e deliberada: `hoje` nao vem do banco nem da mao de
 * ninguem -- vem do `today()` de `lib/recurrence` dentro do nosso proprio
 * codigo --, e um `hoje` errado nao deixa a tela estranha, deixa o SALDO
 * respondendo por outro mes com a mesma cara de certo. Cair num padrao aqui
 * seria impossivel sem ler o relogio, que e justamente o que este motor nao
 * faz; e seguir em frente com a data suja seria escolher o defeito silencioso.
 */
export function conversaInicial(entrada: {
  nome?: string | null;
  hoje: string;
}): Conversa {
  if (!ehDataIso(entrada.hoje)) {
    throw new Error(
      `conversaInicial: hoje tem de ser 'AAAA-MM-DD' valido, recebi ${JSON.stringify(
        entrada.hoje
      )}`
    );
  }

  return {
    estado: "saudacao",
    nome: primeiroNome(entrada.nome),
    hoje: entrada.hoje,
    direcao: null,
    digitos: "",
    lancamento: null,
  };
}

/**
 * Acrescenta uma tecla ao acumulador.
 *
 * Duas regras, e as duas sao as de `aoDigitarValor` -- de proposito, porque e
 * ele que vai mascarar estes digitos:
 *
 * - ZERO A ESQUERDA NAO ACUMULA. Sem isso o primeiro toque no zero deixaria
 *   "0", e dali "0" + "5" = "05" -> "R$ 0,05" por um caminho e "R$ 0,50" por
 *   outro, dependendo de quem poda. Com a poda aqui, o zero sozinho nao faz
 *   nada e o campo vazio continua sendo o unico jeito de ter zero.
 * - O TETO IGNORA A TECLA, nao corta a string. Cortar pelo fim mudaria o
 *   numero que ela esta vendo enquanto digita; ignorar so nao faz nada.
 */
function acrescentarDigito(digitos: string, tecla: string): string {
  if (!/^[0-9]$/.test(tecla)) return digitos;
  const proximo = `${digitos}${tecla}`.replace(/^0+/, "");
  if (proximo.length > MAX_DIGITOS) return digitos;
  return proximo;
}

/** A mascara do que esta no teclado. Vazio mostra zero, nao mostra nada. */
export function valorNaTela(conversa: Conversa): string {
  return aoDigitarValor(conversa.digitos).exibicao || formatarValor(0);
}

/** O valor em notacao decimal com ponto. `""` quando nada foi digitado. */
function valorPlano(conversa: Conversa): string {
  return aoDigitarValor(conversa.digitos).valor;
}

/**
 * Da para seguir para a confirmacao?
 *
 * Zero nao e lancamento. E a pergunta se faz pelo VALOR e nao pelo numero de
 * teclas: um "0" digitado nao sobrevive a poda de zero a esquerda, entao
 * contar digitos e contar valor dao o mesmo resultado hoje -- e `> 0` continua
 * certo no dia em que a poda mudar.
 */
export function podeConfirmar(conversa: Conversa): boolean {
  if (conversa.estado !== "digitando") return false;
  return valorNumerico(valorPlano(conversa)) > 0;
}

/**
 * O lancamento em jogo -- o que F4 manda para a rota de F3.
 *
 * Em `confirmando` e o que ela esta vendo na pergunta; em `pronto` e o que
 * acabou de ser anotado. Nos outros estados e `null`, e nao ha estado em que
 * exista lancamento sem a direcao escolhida.
 */
export function lancamentoDaConversa(conversa: Conversa): Lancamento | null {
  return conversa.lancamento;
}

/**
 * O mes a que o `Saldo` responde -- a MESMA janela que F2 soma e F3 consulta.
 *
 * Delega para `mesCorrenteDaConversa` (F2) em vez de chamar `periodoCorrente`
 * por conta propria. As duas chamadas dariam o mesmo resultado hoje, e e justo
 * por isso que a segunda seria perigosa: no dia em que "o mes da conversa"
 * mudar de definicao -- um mes que vira da virada do cartao, digamos -- o
 * rotulo desta tela continuaria dizendo o mes civil enquanto os numeros abaixo
 * dele viriam de outra janela. Dois lugares certos que discordam.
 */
export function mesDoSaldo(conversa: Conversa): MesDaConversa {
  return mesCorrenteDaConversa(conversa.hoje);
}

/**
 * O rotulo do mes do saldo ("outubro de 2026").
 *
 * Ele e OBRIGATORIO na tela, e nasce da MESMA janela que F2 soma: um "Saldo"
 * sem periodo e um numero que ela nao consegue conferir de cabeca, e um rotulo
 * escrito a parte da consulta seria o defeito que este repositorio ja pagou
 * duas vezes -- numero certo, pergunta desconhecida.
 *
 * O `modo` sai de `modoDoPeriodo` e nao de um `"mes"` digitado aqui: e ele que
 * decide entre "outubro de 2026" e "01/10/2026 a 20/10/2026", e cravar o
 * primeiro faria o rotulo MENTIR por conta propria se a janela de F2 deixasse
 * de ser um mes inteiro -- exatamente o caso em que o rotulo precisa avisar.
 */
export function rotuloDoSaldo(conversa: Conversa): string {
  const mes = mesDoSaldo(conversa);
  return rotuloDoPeriodo({ ...mes, modo: modoDoPeriodo(mes.de, mes.ate) });
}

/** A pergunta da vez -- a unica linha grande da tela. */
export function fraseDaPergunta(conversa: Conversa): string {
  switch (conversa.estado) {
    case "saudacao":
    case "pronto":
      return conversa.nome
        ? `Olá ${conversa.nome}, o que deseja?`
        : "Olá, o que deseja?";
    case "digitando":
      return conversa.direcao === "ganhei"
        ? "Quanto você ganhou?"
        : "Quanto você gastou?";
    case "confirmando":
      return `${conversa.direcao === "ganhei" ? "Ganhei" : "Gastei"} ${valorNaTela(
        conversa
      )}, certo?`;
    case "saldo":
      return `Seu saldo de ${rotuloDoSaldo(conversa)}`;
  }
}

/**
 * O resultado dito em uma frase. `null` fora de `pronto`.
 *
 * Ela nomeia a DIRECAO e o VALOR, e nao so "anotado": "anotado" sozinho nao
 * distingue o toque que gravou mil do toque que gravou dez mil, e e justamente
 * o erro de uma tecla que esta frase existe para deixar visivel.
 */
export function fraseDoResultado(conversa: Conversa): string | null {
  if (conversa.estado !== "pronto" || !conversa.lancamento) return null;
  const { direcao, valor } = conversa.lancamento;
  const palavra = direcao === "ganhei" ? "Ganhei" : "Gastei";
  return `${palavra} ${formatarValor(valorNumerico(valor))}. Anotado.`;
}

/** O teclado numerico esta aberto? So em `digitando`. */
export function tecladoAberto(conversa: Conversa): boolean {
  return conversa.estado === "digitando";
}

/**
 * Os botoes do estado, com o rotulo que cada um mostra.
 *
 * Os TRES da saudacao sao os da issue, nesta ordem. E eles voltam no `pronto`,
 * que e a saudacao com o resultado em cima -- ela nao precisa dispensar a
 * frase para anotar a proxima coisa.
 *
 * No `digitando` o `confirmar` SO APARECE com valor digitado: um botao que nao
 * faz nada ensina que a tela as vezes nao responde. As teclas (digito, apagar,
 * limpar) nao estao aqui -- elas sao o teclado, e `TECLAS`/`tecladoAberto`
 * respondem por elas.
 */
export function botoes(conversa: Conversa): readonly Botao[] {
  switch (conversa.estado) {
    case "saudacao":
    case "pronto":
      return [
        { gesto: "gastei", rotulo: "Gastei" },
        { gesto: "ganhei", rotulo: "Ganhei" },
        { gesto: "saldo", rotulo: "Saldo" },
      ];
    case "digitando":
      return podeConfirmar(conversa)
        ? [
            { gesto: "confirmar", rotulo: "Pronto" },
            { gesto: "voltar", rotulo: "Voltar" },
          ]
        : [{ gesto: "voltar", rotulo: "Voltar" }];
    case "confirmando":
      return [
        { gesto: "confirmar", rotulo: "Sim, anotar" },
        { gesto: "voltar", rotulo: "Não, corrigir" },
      ];
    case "saldo":
      return [
        { gesto: "gastei", rotulo: "Gastei" },
        { gesto: "ganhei", rotulo: "Ganhei" },
        { gesto: "voltar", rotulo: "Voltar" },
      ];
  }
}

/** Volta para a saudacao, sem direcao, sem digito e sem lancamento. */
function doZero(conversa: Conversa): Conversa {
  return {
    ...conversa,
    estado: "saudacao",
    direcao: null,
    digitos: "",
    lancamento: null,
  };
}

/**
 * A palavra escolhida abre o teclado, SEMPRE do zero.
 *
 * Esta funcao existe porque a transicao e a mesma vinda de tres lugares (da
 * saudacao, do `pronto` e do `saldo`), e escrever o objeto tres vezes seria
 * tres lugares para esquecer o `digitos: ""` -- o esquecimento que faz o
 * segundo lancamento nascer com o valor do primeiro na tela, de onde um
 * "Pronto" por reflexo grava dinheiro que ninguem digitou.
 */
function aoEscolherDirecao(conversa: Conversa, direcao: Direcao): Conversa {
  return {
    ...conversa,
    estado: "digitando",
    direcao,
    digitos: "",
    lancamento: null,
  };
}

/**
 * A TRANSICAO. Gesto que nao faz sentido no estado devolve a MESMA conversa --
 * o proprio objeto, nao uma copia.
 *
 * Devolver o mesmo objeto nao e economia: e o que permite a F4 confiar na
 * identidade (`proxima === atual` quer dizer "nada aconteceu") e o que impede
 * um toque perdido de reiniciar a digitacao em silencio.
 */
export function aoGesto(conversa: Conversa, gesto: Gesto): Conversa {
  switch (conversa.estado) {
    case "saudacao":
    case "pronto":
      if (gesto.tipo === "gastei" || gesto.tipo === "ganhei") {
        return aoEscolherDirecao(conversa, gesto.tipo);
      }
      if (gesto.tipo === "saldo") {
        return { ...conversa, estado: "saldo", direcao: null, lancamento: null };
      }
      // No `pronto`, `voltar` dispensa a frase do resultado; na saudacao ele
      // nao tem o que dispensar e o estado ja e este.
      if (gesto.tipo === "voltar") {
        return conversa.estado === "pronto" ? doZero(conversa) : conversa;
      }
      return conversa;

    case "digitando":
      if (gesto.tipo === "digito") {
        const digitos = acrescentarDigito(conversa.digitos, gesto.digito);
        return digitos === conversa.digitos ? conversa : { ...conversa, digitos };
      }
      if (gesto.tipo === "apagar") {
        if (conversa.digitos === "") return conversa;
        return { ...conversa, digitos: conversa.digitos.slice(0, -1) };
      }
      if (gesto.tipo === "limpar") {
        return conversa.digitos === "" ? conversa : { ...conversa, digitos: "" };
      }
      if (gesto.tipo === "confirmar") {
        // Sem valor nao ha confirmacao. Seguir daqui para `confirmando` com
        // zero levaria a pergunta "Gastei R$ 0,00, certo?" -- e um lancamento
        // de zero que a rota recusaria depois, no lugar errado.
        if (!podeConfirmar(conversa)) return conversa;
        return {
          ...conversa,
          estado: "confirmando",
          lancamento: {
            direcao: conversa.direcao ?? "gastei",
            valor: valorPlano(conversa),
            data: conversa.hoje,
          },
        };
      }
      if (gesto.tipo === "voltar") return doZero(conversa);
      return conversa;

    case "confirmando":
      if (gesto.tipo === "confirmar") {
        return { ...conversa, estado: "pronto" };
      }
      if (gesto.tipo === "voltar") {
        // De volta ao teclado COM os digitos -- corrigir uma tecla nao pode
        // custar digitar o valor outra vez. `lancamento` sai porque ele deixa
        // de estar em jogo.
        return { ...conversa, estado: "digitando", lancamento: null };
      }
      return conversa;

    case "saldo":
      // Do `saldo` ela anota direto, sem voltar para a saudacao: olhar o saldo
      // e lembrar de um gasto e a sequencia mais provavel da tela.
      if (gesto.tipo === "gastei" || gesto.tipo === "ganhei") {
        return aoEscolherDirecao(conversa, gesto.tipo);
      }
      if (gesto.tipo === "voltar") return doZero(conversa);
      return conversa;
  }
}

export interface LinhaDoSaldo {
  readonly rotulo: string;
  readonly valor: string;
}

/**
 * As TRES linhas do saldo, sempre as tres, nesta ordem.
 *
 * Os numeros entram no tipo de F2 (`TresNumerosDaConversa`) em vez de num tipo
 * proprio com os mesmos tres campos: o motor nao e dono da convencao deles --
 * `ganhei` e `gastei` sao GRANDEZAS positivas e `saldo` e `ganhei - gastei`,
 * e quem vira o sinal negativo que `financial_transactions` guarda e F2.
 *
 * Mostrar so o saldo seria o defeito que o plano nomeia: um numero plausivel
 * que ela nao tem como conferir. Com `Ganhei`, `Gastei` e `Saldo` juntos a
 * aritmetica fica visivel na propria tela, e e essa a unica defesa real contra
 * o numero errado que nao levanta excecao.
 *
 * E AQUI NAO SE RECALCULA NADA. A tentacao e devolver `ganhei - gastei` no
 * lugar do `saldo` que chegou -- a tela fecharia sempre, e exatamente por isso
 * ela pararia de denunciar F2. Um `gastei` negativo (o sinal cru da tabela,
 * esquecido no caminho) tem de aparecer como "-R$ 1.000,00" na tela, porque e
 * assim que alguem ve que a conta nao fecha.
 */
export function frasesDoSaldo(
  tres: TresNumerosDaConversa
): readonly LinhaDoSaldo[] {
  return [
    { rotulo: "Ganhei", valor: formatarValor(tres.ganhei) },
    { rotulo: "Gastei", valor: formatarValor(tres.gastei) },
    { rotulo: "Saldo", valor: formatarValor(tres.saldo) },
  ];
}
