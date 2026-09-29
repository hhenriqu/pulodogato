// ---------------------------------------------------------------------------
// A CALCULADORA DO CAMPO DE VALOR (HMO-171)
// ---------------------------------------------------------------------------
// "Todos os campos de valor ao lado do input deve ter uma calculadora que abre
// como um modal permitindo o usuario calcular o valor que ele quer adicionar ao
// campo."
//
// Este modulo e a CONTA. O modal e a interface
// (components/ui/calculadora-de-valor.tsx); ele nao decide nada sobre numeros,
// so mostra o que sai daqui.
//
// A funcao devolve o VALOR ("1000.00", decimal com ponto) e nunca o texto
// mascarado, pela mesma razao que existe a separacao em lib/dinheiro.ts:
// `Number.parseFloat("1.000,00")` e 1, e o que sai desta funcao vai direto para
// o estado de um formulario que grava com `parseFloat`. Mil reais entrariam como
// um real sem erro nenhum no caminho.
//
// POR QUE A CONTA RECUSA EM VEZ DE ENTREGAR O MELHOR PALPITE
// ----------------------------------------------------------
// Toda recusa aqui existe porque a alternativa e um numero ERRADO que ninguem
// ve. `ResultadoDaConta` e uma uniao discriminada e nao um `number | null`
// justamente para que a tela tenha de escrever o motivo na cara da pessoa:
//
//   "1.5"       -> nao e 15 nem 1,5. Em pt-BR o ponto e milhar, e "1.5" nao e um
//                  milhar valido. Chutar qualquer um dos dois erra por 10x.
//   "30 - 100"  -> -70. As rotas deste app aplicam `-Math.abs` (ver
//                  pulodogato: despesa e gravada negativa), entao um -70 num
//                  campo de despesa voltaria como +70: dinheiro ENTRANDO numa
//                  tela de saida. O saldo fecha errado para mais, que e o lado
//                  de que ninguem reclama.
//   "10 / 0"    -> Infinity. `toFixed` de Infinity e "Infinity", e a string
//                  "Infinity" no campo vira `parseFloat` -> Infinity -> erro do
//                  Postgres numa hora em que a pessoa ja saiu da tela.
//   "5 - 5"     -> 0. Todo formulario daqui valida "maior que zero", e campo
//                  vazio e o estado que essas validacoes ja sabem recusar.
//                  Aplicar zero passaria pelo `required` do HTML.
//   16 digitos  -> `MAX_DIGITOS` do campo e 15, e `aoDigitarValor` IGNORA a
//                  tecla extra. Se eu entregasse 16 digitos, o campo mostraria
//                  um numero diferente do que a calculadora acabou de prometer.
//
// POR QUE O ARREDONDAMENTO NAO USA `Math.round(n * 100) / 100`
// ------------------------------------------------------------
// Porque ele erra o caso que uma calculadora de dinheiro encontra toda hora. O
// literal `1.005` nao existe em binario; o double mais proximo e
// 1.00499999999999989..., entao `Math.round(1.005 * 100)` da 100 e o resultado
// sai R$ 1,00 onde a pessoa esperava R$ 1,01. Nao ha excecao: e um centavo a
// menos, calado.
//
// `toFixed` ja faz a conversao para DECIMAL com a casa extra que falta para
// decidir ("1.005"), e a partir dai o arredondamento acontece sobre DIGITOS --
// `somarUm` soma na string, com transporte. Nenhum float participa da decisao.
//
// Sem BigInt de proposito, que seria o jeito obvio de somar exato: o tsconfig
// deste app declara `lib: ["es6"]` e nao declara `target`, entao `1n` e o proprio
// `BigInt` nao compilam no `tsc --noEmit` do CI. A suite de teste compila com
// `--target es2020` e aceitaria os dois -- passaria verde aqui e quebraria o
// type-check do PR.
//
// Sem import de proposito: `tsc lib/calculadora-de-campo.ts` compila sozinho, o
// que deixa a suite rodar sem o passo de reescrita do alias `@/`. E por isso que
// a moeda entra como numero de CASAS, e nao como codigo ISO -- a conta nao
// precisa do catalogo, so de quantas casas arredondar.
// ---------------------------------------------------------------------------

/** Os caracteres que a expressao pode conter. Todo o resto e erro de sintaxe. */
const PERMITIDOS = /^[0-9.,+\-*/()\s]*$/;

export type MotivoDeRecusa =
  /** Nada digitado ainda. Nao e erro: e o estado inicial do modal. */
  | "vazia"
  /** A expressao nao fecha (operador sobrando, parentese aberto, lixo). */
  | "sintaxe"
  /** Um ponto que nao e separador de milhar valido -- "1.5", "1.0000". */
  | "milhar-ambiguo"
  | "divisao-por-zero"
  /** O resultado nao e um numero finito por outro caminho. */
  | "sem-resultado"
  | "negativa"
  | "zero"
  /** Passa dos digitos que o campo aceita. */
  | "grande-demais";

export interface ContaAceita {
  ok: true;
  /**
   * Notacao decimal com PONTO ("1000.00"), com exatamente `casas` decimais. E o
   * que `CampoDeValor` consome pelo `onChange`.
   */
  valor: string;
  /** O mesmo numero, para quem quiser formatar a previa. */
  numero: number;
}

export interface ContaRecusada {
  ok: false;
  motivo: MotivoDeRecusa;
  /** Pronta para aparecer na tela, em pt-BR. */
  mensagem: string;
}

export type ResultadoDaConta = ContaAceita | ContaRecusada;

/** O teto de digitos do campo (`MAX_DIGITOS` em lib/dinheiro.ts). */
export const MAX_DIGITOS_PADRAO = 15;

function recusar(motivo: MotivoDeRecusa, mensagem: string): ContaRecusada {
  return { ok: false, motivo, mensagem };
}

// ---------------------------------------------------------------------------
// Leitura de um numero em pt-BR
// ---------------------------------------------------------------------------

/**
 * Le um numero escrito como se escreve aqui: ponto no milhar, virgula nos
 * centavos.
 *
 * O ponto e conferido como AGRUPAMENTO, e nao apenas removido. Remover sem
 * conferir e o que transforma "1.5" em 15 -- o campo mostra R$ 15,00, a
 * validacao aprova, e o erro e de 10x. `1.234.567` passa; `1.5`, `12.34` e
 * `1.0000` nao.
 */
function lerNumero(bruto: string): number | MotivoDeRecusa {
  const partes = bruto.split(",");
  if (partes.length > 2) return "sintaxe";

  const inteiro = partes[0];
  const fracao = partes.length === 2 ? partes[1] : "";

  // Ponto depois da virgula ("1,50.000") nao e nada em nenhuma convencao.
  if (fracao.indexOf(".") !== -1) return "sintaxe";
  if (fracao !== "" && !/^[0-9]+$/.test(fracao)) return "sintaxe";
  if (inteiro === "" && fracao === "") return "sintaxe";

  let inteiroLimpo: string;
  if (inteiro.indexOf(".") !== -1) {
    // Com ponto, a unica forma aceita e grupo de 1-3 digitos seguido de grupos
    // de exatamente 3.
    if (!/^[0-9]{1,3}(\.[0-9]{3})+$/.test(inteiro)) return "milhar-ambiguo";
    inteiroLimpo = inteiro.split(".").join("");
  } else {
    if (inteiro !== "" && !/^[0-9]+$/.test(inteiro)) return "sintaxe";
    inteiroLimpo = inteiro;
  }

  const numero = Number(`${inteiroLimpo === "" ? "0" : inteiroLimpo}.${fracao === "" ? "0" : fracao}`);
  return Number.isFinite(numero) ? numero : "sintaxe";
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type Token =
  | { tipo: "numero"; numero: number }
  | { tipo: "op"; op: "+" | "-" | "*" | "/" }
  | { tipo: "abre" }
  | { tipo: "fecha" };

function tokenizar(expressao: string): Token[] | MotivoDeRecusa {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expressao.length) {
    const c = expressao.charAt(i);

    if (/\s/.test(c)) {
      i++;
      continue;
    }

    if (/[0-9.,]/.test(c)) {
      let j = i;
      while (j < expressao.length && /[0-9.,]/.test(expressao.charAt(j))) j++;
      const lido = lerNumero(expressao.slice(i, j));
      if (typeof lido !== "number") return lido;
      tokens.push({ tipo: "numero", numero: lido });
      i = j;
      continue;
    }

    if (c === "+" || c === "-" || c === "*" || c === "/") {
      tokens.push({ tipo: "op", op: c });
      i++;
      continue;
    }

    if (c === "(") {
      tokens.push({ tipo: "abre" });
      i++;
      continue;
    }

    if (c === ")") {
      tokens.push({ tipo: "fecha" });
      i++;
      continue;
    }

    return "sintaxe";
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Parser (descida recursiva)
// ---------------------------------------------------------------------------
//
//   soma    := termo (('+' | '-') termo)*
//   termo   := unario (('*' | '/') unario)*
//   unario  := ('+' | '-')* fator
//   fator   := numero | '(' soma ')'
//
// Sem `eval` e sem `new Function`: a expressao vem de um input de texto, e
// nenhuma quantidade de filtro na entrada justifica entregar o que a pessoa
// digitou para o motor de JS.

/** O motivo interrompe a descida; o topo o converte em `ContaRecusada`. */
class Interrompe {
  motivo: MotivoDeRecusa;
  constructor(motivo: MotivoDeRecusa) {
    this.motivo = motivo;
  }
}

function avaliarTokens(tokens: Token[]): number | MotivoDeRecusa {
  let pos = 0;

  function atual(): Token | undefined {
    return tokens[pos];
  }

  function soma(): number {
    let esquerda = termo();
    for (;;) {
      const t = atual();
      if (t && t.tipo === "op" && (t.op === "+" || t.op === "-")) {
        pos++;
        const direita = termo();
        esquerda = t.op === "+" ? esquerda + direita : esquerda - direita;
        continue;
      }
      return esquerda;
    }
  }

  function termo(): number {
    let esquerda = unario();
    for (;;) {
      const t = atual();
      if (t && t.tipo === "op" && (t.op === "*" || t.op === "/")) {
        pos++;
        const direita = unario();
        if (t.op === "*") {
          esquerda = esquerda * direita;
        } else {
          // Antes da divisao, e nao depois: `1 / 0` e Infinity, e Infinity
          // sobrevive a `+ 5` e a `* 2`. Barrar so no fim deixaria a expressao
          // "10 / 0 - 10 / 0" chegar como NaN, cujo motivo ninguem sabe dizer.
          if (direita === 0) throw new Interrompe("divisao-por-zero");
          esquerda = esquerda / direita;
        }
        continue;
      }
      return esquerda;
    }
  }

  function unario(): number {
    const t = atual();
    if (t && t.tipo === "op" && (t.op === "+" || t.op === "-")) {
      pos++;
      const valor = unario();
      return t.op === "-" ? -valor : valor;
    }
    return fator();
  }

  function fator(): number {
    const t = atual();
    if (!t) throw new Interrompe("sintaxe");

    if (t.tipo === "numero") {
      pos++;
      return t.numero;
    }

    if (t.tipo === "abre") {
      pos++;
      const dentro = soma();
      const fecha = atual();
      if (!fecha || fecha.tipo !== "fecha") throw new Interrompe("sintaxe");
      pos++;
      return dentro;
    }

    throw new Interrompe("sintaxe");
  }

  try {
    const valor = soma();
    // Token sobrando e erro: sem isto, "2 3" devolveria 2 -- a pessoa ve um
    // resultado plausivel e metade da conta foi ignorada em silencio.
    if (pos !== tokens.length) return "sintaxe";
    return valor;
  } catch (erro) {
    if (erro instanceof Interrompe) return erro.motivo;
    throw erro;
  }
}

// ---------------------------------------------------------------------------
// Arredondamento sobre digitos
// ---------------------------------------------------------------------------

/** Soma 1 na ultima casa de uma string de digitos, com transporte. */
function somarUm(digitos: string): string {
  const saida = digitos.split("");
  let i = saida.length - 1;
  while (i >= 0) {
    if (saida[i] === "9") {
      saida[i] = "0";
      i--;
    } else {
      saida[i] = String(Number(saida[i]) + 1);
      break;
    }
  }
  // Estourou todas as casas ("999" + 1): nasce um digito na frente.
  return i < 0 ? `1${saida.join("")}` : saida.join("");
}

function semZerosAEsquerda(digitos: string): string {
  const podado = digitos.replace(/^0+/, "");
  return podado === "" ? "0" : podado;
}

/**
 * Quantas casas decimais a mais do que a moeda tem sao pedidas ao `toFixed`.
 *
 * UMA casa a mais nao serve, e este teto custou um teste vermelho: `toFixed`
 * ARREDONDA no ponto em que corta, entao `(1.0049).toFixed(3)` e "1.005", e um
 * meio-para-cima sobre esse "5" devolve 1,01 -- quando 1,0049 arredondado em
 * duas casas e 1,00. E arredondamento duplo: o corte fabrica o digito que decide.
 *
 * Com casas de sobra o corte acontece longe do digito que decide, e so poderia
 * alcanca-lo se todas as casas intermediarias fossem 9 -- caso em que o numero e
 * indistinguivel, no double, do valor que arredonda para cima de qualquer forma.
 */
const CASAS_DE_FOLGA = 8;

/**
 * O valor absoluto arredondado, em UNIDADES MENORES (centavos), como string de
 * digitos. Meio para cima, decidido em decimal.
 */
function escalarArredondando(abs: number, casas: number): string {
  const texto = abs.toFixed(casas + CASAS_DE_FOLGA);
  const digitos = texto.replace(".", "");
  // O valor ja escalado para as casas da moeda ocupa tudo menos a folga; o
  // primeiro digito da folga e o que decide.
  const corte = digitos.length - CASAS_DE_FOLGA;
  const decisor = Number(digitos.charAt(corte));
  const truncado = semZerosAEsquerda(digitos.slice(0, corte));
  return decisor >= 5 ? semZerosAEsquerda(somarUm(truncado)) : truncado;
}

/** Monta "1000.00" a partir dos centavos ("100000") e das casas. */
function montarValor(escalado: string, casas: number): string {
  if (casas === 0) return escalado;
  // Valor menor que uma unidade da moeda: os centavos precisam de um "0" na
  // frente para que "5" (cinco centavos) monte "0.05" e nao ".05".
  const preenchido =
    escalado.length <= casas
      ? `${"0".repeat(casas - escalado.length + 1)}${escalado}`
      : escalado;
  const corte = preenchido.length - casas;
  return `${preenchido.slice(0, corte)}.${preenchido.slice(corte)}`;
}

// ---------------------------------------------------------------------------
// A conta
// ---------------------------------------------------------------------------

export interface OpcoesDaConta {
  /** Casas decimais da moeda do campo. Iene tem zero. */
  casas?: number;
  /** Teto de digitos do campo. */
  maxDigitos?: number;
}

/**
 * Calcula a expressao e devolve o que o campo pode receber, ou o motivo pelo
 * qual nao pode.
 *
 * A previa do modal e o `onChange` do campo chamam ESTA funcao -- nao ha um
 * caminho "rapido" para a previa. Duas contas para o mesmo texto e como uma
 * delas passa a mostrar outro numero sem ninguem notar, e aqui isso significaria
 * a tela prometer um valor e o campo receber outro.
 */
export function calcular(
  expressao: string,
  opcoes: OpcoesDaConta = {}
): ResultadoDaConta {
  const casas = opcoes.casas === undefined ? 2 : opcoes.casas;
  const maxDigitos =
    opcoes.maxDigitos === undefined ? MAX_DIGITOS_PADRAO : opcoes.maxDigitos;

  if (expressao.trim() === "") {
    return recusar("vazia", "Digite uma conta.");
  }

  // Esta peneira NAO e o que impede um caractere estranho de entrar na conta --
  // o tokenizador ja recusa tudo que nao reconhece, e um controle negativo
  // provou isso: removendo estas quatro linhas a suite continuava verde, porque
  // o motivo ("sintaxe") sai igual pelos dois caminhos.
  //
  // Ela existe pela MENSAGEM. Quem digitou "R$ 10" ou "10%" precisa ler qual e
  // o alfabeto aceito; "Conta incompleta.", que e o texto padrao de sintaxe,
  // manda a pessoa procurar um parentese que ela nao esqueceu. E por isso que o
  // teste desta peneira compara o TEXTO, e nao so o motivo: comparando o motivo,
  // apagar daqui nao produz vermelho nenhum.
  if (!PERMITIDOS.test(expressao)) {
    return recusar("sintaxe", "Use apenas numeros e + - * / ( ).");
  }

  const tokens = tokenizar(expressao);
  if (!Array.isArray(tokens)) return recusar(tokens, mensagemDe(tokens));
  if (tokens.length === 0) {
    return recusar("vazia", "Digite uma conta.");
  }

  const bruto = avaliarTokens(tokens);
  if (typeof bruto !== "number") return recusar(bruto, mensagemDe(bruto));

  if (!Number.isFinite(bruto)) {
    return recusar("sem-resultado", "Essa conta nao tem resultado.");
  }

  // Antes do `toFixed`: a partir de 1e21 ele devolve notacao exponencial
  // ("1e+21"), e o `replace(".", "")` seguinte leria os digitos errados. O teto
  // do campo (15 digitos) ja reprovaria este numero -- a ordem e que importa.
  if (Math.abs(bruto) >= 1e18) {
    return recusar("grande-demais", `O campo aceita no maximo ${maxDigitos} digitos.`);
  }

  const escalado = escalarArredondando(Math.abs(bruto), casas);

  // O sinal e lido do ESCALADO, e nao do bruto: -0,004 em real arredonda para
  // zero, e "negativa" seria uma recusa confusa para um resultado que a moeda
  // considera zero.
  const zero = escalado === "0";

  if (zero) {
    return recusar("zero", "O resultado e zero, e o campo nao aceita zero.");
  }

  if (bruto < 0) {
    return recusar(
      "negativa",
      "O resultado e negativo. Os campos de valor guardam so o tamanho do valor; a tela e que diz se entra ou sai."
    );
  }

  if (escalado.length > maxDigitos) {
    return recusar("grande-demais", `O campo aceita no maximo ${maxDigitos} digitos.`);
  }

  const valor = montarValor(escalado, casas);
  return { ok: true, valor, numero: Number(valor) };
}

function mensagemDe(motivo: MotivoDeRecusa): string {
  switch (motivo) {
    case "milhar-ambiguo":
      return "Use a virgula para os centavos (1,50). O ponto separa milhar (1.000).";
    case "divisao-por-zero":
      return "Nao da para dividir por zero.";
    case "vazia":
      return "Digite uma conta.";
    case "sem-resultado":
      return "Essa conta nao tem resultado.";
    case "negativa":
      return "O resultado e negativo.";
    case "zero":
      return "O resultado e zero, e o campo nao aceita zero.";
    case "grande-demais":
      return "O resultado e grande demais para o campo.";
    case "sintaxe":
    default:
      return "Conta incompleta.";
  }
}
