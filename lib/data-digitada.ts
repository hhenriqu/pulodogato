// ---------------------------------------------------------------------------
// A DATA DIGITADA, E POR QUE O CONTROLE NATIVO NAO SERVE (HMO-238)
// ---------------------------------------------------------------------------
// A queixa e de uma linha: "digitar dia mes e ano sem ficar pulando pro ano".
// Antes de trocar nada, `scripts/probe-campo-de-data.mjs` mediu o
// `<input type="date">` nativo em Chromium, varrendo as posicoes em que o dedo
// pode cair num campo da largura real da tela (`w-full`, 343px num celular).
// Digitando "10032026" (10 de marco) num campo que mostra hoje, 02/10/2026:
//
//   x=6, 20     ->  "2026-10-03"   a ordem do aparelho e mm/dd: virou 3 de OUTUBRO
//   x=40        ->  "32026-10-10"  ano corrompido
//   x=60        ->  "32026-10-02"  ano corrompido
//   x=80..320   ->  "2026-10-03"   3 de outubro outra vez
//   x=337       ->  "2026-10-02"   icone do calendario: 8 teclas, nada mudou
//   campo vazio ->  "" em metade das posicoes: 8 teclas, nada gravado
//
// EM NENHUMA POSICAO sai a data que a pessoa digitou. Sao tres modos de errar, e
// o pior nao e o que a queixa descreve:
//
//   - ORDEM. A maioria das posicoes grava "2026-10-03": data valida, plausivel,
//     sem erro nenhum no caminho. Move o lancamento sete meses e ninguem fica
//     sabendo. Num app de dinheiro este e o grave.
//   - ANO CORROMPIDO ("32026-...") e CAMPO VAZIO ("") batem no regex de
//     `lib/lancamento.ts` (`/^\d{4}-\d{2}-\d{2}$/`) e produzem a MESMA frase:
//     "Informe a data." A pessoa digitou a data e a tela diz que ela nao digitou.
//
// O ACHADO QUE DECIDIU A TROCA
// ----------------------------
// A ordem dos segmentos sai do APARELHO, nao do nosso codigo. A sonda tentou
// `locale: "pt-BR"` e `--lang=pt-BR`; nenhum dos dois mudou a ordem no Chromium,
// que continuou pedindo o MES primeiro. Hoje, portanto, o mesmo app mostra dd/mm
// para um usuario e mm/dd para outro, sem nada na tela dizendo qual -- e e dai
// que vem o modo de errar mais caro.
//
// A mascara resolve isso de graca: a ordem passa a ser nossa, igual em todo
// aparelho, escrita na tela em `dd/mm/aaaa`.
//
// (A issue registrava "32026-10-02" para um clique no CENTRO. O numero existe e a
// sonda continua reproduzindo-o, mas ele vinha de um campo de largura DEFAULT
// (123px), onde o texto ocupa o campo inteiro e o centro cai sobre o ano. No
// campo `w-full` da tela o centro cai no vazio a direita, e o que sai de la e o
// erro de ORDEM. O defeito e maior do que o numero sugeria, nao menor.)
//
// OS DOIS CONTRATOS QUE ELA NAO PODE QUEBRAR
// ------------------------------------------
//   1. O VALOR emitido continua `AAAA-MM-DD`. So a EXIBICAO e pt-BR. Emitir
//      outro formato faz o PostgREST devolver 22007, que a tela traduz para um
//      "erro ao salvar" generico.
//   2. Data incompleta emite VAZIO, nunca data parcial. "10/1" nao pode virar
//      `2026-01-10`: um dia que ninguem digitou entrando no banco e pior que uma
//      recusa. A validacao continua podendo dizer "Informe a data.".
//
// E a mesma divisao de lib/dinheiro.ts, pela mesma razao -- e este arquivo copia
// aquele desenho de proposito, em vez de inventar um segundo:
//
//   EXIBICAO -> "10/03/2026". Existe so para o olho, nunca e gravada.
//   VALOR    -> "2026-03-10". O que o estado do formulario guarda e o que o
//               Postgres entende.
//
// Sem import de proposito: `tsc lib/data-digitada.ts` compila sozinho, o que
// deixa a suite rodar sem o passo de reescrita do alias `@/`.
// ---------------------------------------------------------------------------

/** Os digitos de uma data completa: dd + mm + aaaa. */
export const DIGITOS_DA_DATA = 8;

/** O separador que a exibicao usa. pt-BR escreve com barra. */
export const SEPARADOR = "/";

export interface EntradaDeData {
  /** O texto mascarado, para o `value` do input. So para o olho. */
  exibicao: string;
  /**
   * A data em `AAAA-MM-DD`, que e o que o estado do formulario guarda e o que a
   * validacao de `lib/lancamento.ts` aceita. VAZIO enquanto a data nao estiver
   * completa e nao existir no calendario.
   */
  valor: string;
}

/** Ano bissexto pela regra cheia -- 1900 nao e, 2000 e. */
function bissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

/**
 * Quantos dias o mes tem de verdade.
 *
 * Tabela em vez de `new Date(ano, mes, 0).getDate()` de proposito: `Date`
 * interpreta o que recebe no fuso LOCAL, e este repositorio ja perdeu um teste
 * por isso -- o sandbox roda em America/Sao_Paulo e o CI em UTC, entao um
 * mutante morria aqui e sobrevivia la. Aritmetica pura nao tem fuso.
 */
function diasNoMes(mes: number, ano: number): number {
  if (mes === 2) return bissexto(ano) ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mes - 1] ?? 0;
}

/**
 * A data existe no calendario?
 *
 * E aqui que 31/02 e 32/10 param. Sem esta porta a mascara emitiria `2026-02-31`
 * -- oito digitos, formato certo, regex de `lib/lancamento.ts` aprovando -- e o
 * Postgres recusaria com 22007 na hora de gravar, que a tela mostra como "erro
 * ao salvar" sem dizer qual campo esta errado.
 *
 * O ano ZERO tambem e recusado: `'0000-01-01'::date` e fora de faixa no
 * Postgres, e um ano digitado pela metade ("10/03/0002" a caminho de 2026) nao
 * pode virar uma gravacao.
 */
export function dataExiste(dia: number, mes: number, ano: number): boolean {
  if (ano < 1) return false;
  if (mes < 1 || mes > 12) return false;
  return dia >= 1 && dia <= diasNoMes(mes, ano);
}

/**
 * Pontua os digitos como dd/mm/aaaa.
 *
 * O separador entra ANTES do 3o e do 5o digito, e nunca no fim. Barra no fim
 * ("10/") daria a esta mascara o ponto fixo que a de dinheiro teve: o backspace
 * apaga a barra, a funcao a devolve, e o campo fica impossivel de limpar -- a
 * pessoa aperta backspace e nada acontece, para sempre, sem erro nenhum.
 */
function pontuar(digitos: string): string {
  let saida = "";
  for (let i = 0; i < digitos.length; i++) {
    if (i === 2 || i === 4) saida += SEPARADOR;
    saida += digitos[i];
  }
  return saida;
}

/** Os digitos de um texto, na ordem em que aparecem. */
function digitosDe(texto: string): string {
  return texto.replace(/\D/g, "");
}

/**
 * Os digitos que acabaram de ser INSERIDOS num texto.
 *
 * Compara prefixo e sufixo com o que havia antes e devolve o miolo que sobrou.
 * Para "02102026" -> "021012026" devolve "1", sem precisar saber onde estava o
 * caret -- e por isso que esta regra pode morar aqui, numa funcao pura, em vez de
 * depender de um handler de foco que a sonda nao conseguiria medir.
 *
 * Colar uma data inteira em cima de outra tambem cai aqui e devolve os 8 digitos
 * colados, que e o que a pessoa quis dizer.
 */
function digitosInseridos(digitosNovos: string, digitosAntes: string): string {
  let i = 0;
  while (i < digitosAntes.length && digitosAntes[i] === digitosNovos[i]) i++;

  let j = 0;
  while (
    j < digitosAntes.length - i &&
    digitosAntes[digitosAntes.length - 1 - j] ===
      digitosNovos[digitosNovos.length - 1 - j]
  ) {
    j++;
  }

  return digitosNovos.slice(i, digitosNovos.length - j);
}

/**
 * O que mostrar e o que guardar, a partir do texto cru que esta no input.
 *
 * Aceita qualquer coisa: o que nao e digito e descartado. E isso que torna a
 * funcao TOTAL -- toda sequencia de teclas tem uma saida canonica -- e e o que
 * permite ao campo derivar a exibicao em vez de guardar um segundo estado que
 * pode divergir do primeiro.
 *
 * A EXIBICAO SOBREVIVE AO VALOR VAZIO, E ISSO E O PONTO
 * -----------------------------------------------------
 * `aoDigitarData("1003")` devolve exibicao "10/03" e valor "". As duas coisas ao
 * mesmo tempo: a pessoa VE o que digitou ate agora e o formulario NAO recebe
 * meia data. Se a exibicao fosse derivada do valor (como em `CampoDeValor`), o
 * campo apagaria o que ela acabou de digitar no primeiro digito -- porque uma
 * data de um digito nao tem valor nenhum para derivar de.
 *
 * DIGITAR SOBRE UM CAMPO COMPLETO COMECA UMA DATA NOVA
 * ----------------------------------------------------
 * `exibicaoAnterior` existe por causa do caso principal da issue, e e o unico
 * motivo de esta funcao nao ter um argumento so.
 *
 * O campo de lancamento chega preenchido com HOJE. A pessoa clica no meio dele e
 * digita a data que quer. Sem este parametro, a tecla cai entre os digitos de
 * hoje e as duas datas se MISTURAM: com o campo em "02/10/2026", digitar
 * "10032026" produzia "02/10/1202" -- uma data que ninguem digitou, no formato
 * certo, que a validacao aprova. E a versao mascarada do mesmo defeito que o
 * controle nativo tinha ("32026-10-02").
 *
 * Com ele, oito digitos completos + uma tecla nova significam "esta pessoa esta
 * redigitando", e a data recomeca daquela tecla. A regra e da MASCARA, e nao de
 * um `onFocus` que seleciona o texto: assim ela tem teste unitario, a sonda a
 * mede pelo caminho de verdade, e ela continua valendo no aparelho em que
 * selecionar-ao-focar nao sobrevive ao toque.
 *
 * (O campo seleciona tudo ao receber o foco de todo jeito -- e o atalho que
 * deixa apagar a data inteira de uma vez -- mas a corretude nao depende disso.)
 *
 * O EXCESSO E IGNORADO, NAO CORTADO PELO FIM
 * ------------------------------------------
 * Nove digitos vindos de um campo que ja estava incompleto devolvem os oito
 * primeiros. E deliberado e tem par no `MAX_DIGITOS` de lib/dinheiro.ts: ignorar
 * a tecla extra nao muda o que a pessoa esta vendo, enquanto cortar pelo fim
 * mudaria a data debaixo do dedo dela.
 */
export function aoDigitarData(
  textoCru: string,
  exibicaoAnterior: string = ""
): EntradaDeData {
  const crus = digitosDe(textoCru);
  const antes = digitosDe(exibicaoAnterior);

  // O campo estava completo e CRESCEU: nao e continuacao, e uma data nova.
  const redigitando = antes.length === DIGITOS_DA_DATA && crus.length > antes.length;

  const digitos = (
    redigitando ? digitosInseridos(crus, antes) : crus
  ).slice(0, DIGITOS_DA_DATA);

  const exibicao = pontuar(digitos);

  if (digitos.length < DIGITOS_DA_DATA) {
    // Data incompleta nao tem valor. Emitir `2026-01-10` para "10/1" seria
    // inventar o mes -- o contrato 2 do cabecalho.
    return { exibicao, valor: "" };
  }

  const dia = digitos.slice(0, 2);
  const mes = digitos.slice(2, 4);
  const ano = digitos.slice(4, 8);

  if (!dataExiste(Number(dia), Number(mes), Number(ano))) {
    // A pessoa continua vendo "31/02/2026" para poder consertar; o formulario
    // continua sem data e recusa com "Informe a data.".
    return { exibicao, valor: "" };
  }

  return { exibicao, valor: `${ano}-${mes}-${dia}` };
}

/**
 * A exibicao de uma data que JA existe -- a que veio do banco na edicao, ou o
 * padrao que a tela sugere (hoje).
 *
 * Passa por `aoDigitarData`, e nao por um formatador proprio: e isso -- e nao um
 * comentario pedindo cuidado -- que garante que o texto de uma data gravada e
 * IDENTICO ao texto da mesma data digitada. Dois caminhos para o mesmo texto e
 * como um deles fica diferente sem ninguem notar, e num campo controlado essa
 * diferenca apareceria como um piscar a cada tecla.
 *
 * Qualquer coisa que nao seja `AAAA-MM-DD` valido sai VAZIA, incluindo o
 * `32026-10-02` que o campo nativo produzia: o campo mostra vazio em vez de
 * mostrar uma data que ele seria incapaz de emitir.
 */
export function dataParaExibicao(valorISO: string | null | undefined): string {
  if (!valorISO) return "";

  const casa = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valorISO);
  if (!casa) return "";

  const [, ano, mes, dia] = casa;
  // Ida e volta pela mascara: se a data nao existe no calendario, nao ha texto
  // para mostrar. `aoDigitarData` e a unica autoridade sobre isso.
  const entrada = aoDigitarData(`${dia}${mes}${ano}`);
  return entrada.valor === "" ? "" : entrada.exibicao;
}

/**
 * O rascunho do campo: o texto que a pessoa esta digitando, junto do valor que
 * aquele texto emitiu.
 *
 * O valor viaja COM o texto de proposito -- e ele que permite saber se o
 * rascunho ainda descreve o estado atual do formulario (ver `exibicaoDoCampo`).
 */
export interface RascunhoDeData {
  texto: string;
  valor: string;
}

/**
 * O texto que o input deve mostrar.
 *
 * ESTE E O PONTO DELICADO DO CAMPO, E A RAZAO DE SER UMA FUNCAO PURA
 * ------------------------------------------------------------------
 * `CampoDeValor` nao guarda estado nenhum: a exibicao e derivada do `value` a
 * cada render, e isso elimina a divergencia que aparece quando o PAI muda o
 * valor sem o usuario digitar -- carregar o lancamento do banco, copiar a data
 * prevista da data real. Com estado local, o campo continuaria mostrando o texto
 * antigo com o valor novo por baixo.
 *
 * Um campo de data nao pode ser tao simples, porque data incompleta nao tem
 * valor: derivar "1" de valor nenhum e impossivel, e o campo apagaria a primeira
 * tecla de toda digitacao. O rascunho e inevitavel.
 *
 * O que esta funcao faz e deixar o rascunho SUBORDINADO ao valor: ele so e
 * honrado enquanto o valor do pai continuar sendo exatamente o que aquele texto
 * emitiu. No instante em que o pai discorda, o rascunho e ignorado e a exibicao
 * volta a ser derivada do valor. Com isso o campo recupera a propriedade de
 * `CampoDeValor` -- valor mudado por fora aparece na tela -- sem precisar de
 * `useEffect` de sincronizacao, que e onde esse tipo de bug mora.
 */
export function exibicaoDoCampo(
  rascunho: RascunhoDeData | null,
  valor: string
): string {
  if (rascunho && rascunho.valor === valor) return rascunho.texto;
  return dataParaExibicao(valor);
}

/**
 * O minimo de um `<input>` que a mascara precisa tocar. Existe para que
 * `aplicarMascaraNoCampo` nao dependa do DOM inteiro, e principalmente para que
 * a SONDA possa chamar a mesma funcao que o componente chama, em vez de
 * reimplementar a regra e medir a si mesma.
 */
export interface CampoDeDataDom {
  value: string;
  setSelectionRange(inicio: number, fim: number): void;
}

/**
 * Aplica a mascara no proprio campo e devolve o que emitir.
 *
 * POR QUE O CARET VAI PARA O FIM
 * ------------------------------
 * A mascara INSERE caracteres (as barras) a esquerda do caret. Sem mexer nele, a
 * terceira tecla de "1003" cai depois da barra recem-inserida e a digitacao
 * embaralha: "10/" + "3" na posicao 3 vira "10/30" em vez de "10/03". Medido na
 * sonda, nao deduzido.
 *
 * O caret no fim e coerente com o que o campo e: oito digitos de largura fixa,
 * digitados da esquerda para a direita. "Digitar no meio" nao existe aqui -- o
 * jeito de corrigir e apagar ou redigitar, e para apontar ha o botao de
 * calendario. E a mesma escolha de `CampoDeValor`, pela mesma razao.
 *
 * ESCREVER `campo.value` AQUI NAO BRIGA COM O REACT
 * -------------------------------------------------
 * O componente renderiza exatamente esta `exibicao`. Como o DOM ja esta com ela,
 * o React nao reatribui o `value` -- e e justamente a reatribuicao que jogaria o
 * caret para o fim de novo. Nos dois caminhos possiveis o caret termina no mesmo
 * lugar, entao o campo nao precisa de `useEffect` para consertar o cursor.
 */
export function aplicarMascaraNoCampo(
  campo: CampoDeDataDom,
  exibicaoAnterior: string
): EntradaDeData {
  const entrada = aoDigitarData(campo.value, exibicaoAnterior);

  campo.value = entrada.exibicao;
  const fim = entrada.exibicao.length;
  campo.setSelectionRange(fim, fim);

  return entrada;
}
