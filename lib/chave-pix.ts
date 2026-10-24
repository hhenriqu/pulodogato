/**
 * A chave Pix que o colega do grupo vai COPIAR (HMO-201, parte 1).
 *
 * O pedido: "adicionar ao perfil a chave pix da pessoa para que o colega do
 * grupo possa copiar e fazer o pagamento."
 *
 * POR QUE ISTO E UM MODULO, E NAO UM `<input type="text">`
 * --------------------------------------------------------
 * Porque a unica coisa que essa chave precisa fazer e funcionar quando alguem
 * colar ela no app do banco -- e o formato em que a pessoa DIGITA quase nunca
 * e o formato que o banco aceita. Quem digita CPF escreve `123.456.789-09`;
 * quem digita telefone escreve `(11) 98888-7777`. O arranjo Pix trabalha com
 * as chaves em forma canonica: CPF e CNPJ so digitos, telefone em E.164
 * (`+5511988887777`), email em minusculas, EVP como UUID.
 *
 * Se guardarmos o que foi digitado, o colega copia, cola, o banco recusa, e o
 * app nao errou em lugar nenhum que de para ver: a tela mostrou uma chave, o
 * botao copiou aquela chave. O defeito so aparece no aplicativo do banco de
 * outra pessoa. Por isso a normalizacao acontece ANTES de gravar, uma vez, e
 * fica aqui -- sem tela, sem rede, sem banco, e testavel.
 *
 * O DIGITO VERIFICADOR NAO E FRESCURA
 * -----------------------------------
 * CPF e CNPJ tem digito verificador, e um CPF com um numero trocado tem
 * altissima chance de ser recusado como chave inexistente -- mas tambem pode
 * ser o CPF VALIDO DE OUTRA PESSOA. Conferir o digito aqui e barato e e a
 * diferenca entre "o app avisou que a chave esta errada" e "o dinheiro foi
 * para um estranho". Nao conferimos se a chave esta REGISTRADA no arranjo
 * (isso exige o Banco Central); conferimos que ela e bem-formada.
 */

export type TipoDeChavePix =
  | "cpf"
  | "cnpj"
  | "email"
  | "telefone"
  | "aleatoria";

export const TIPOS_DE_CHAVE_PIX: readonly TipoDeChavePix[] = [
  "cpf",
  "cnpj",
  "email",
  "telefone",
  "aleatoria",
] as const;

export const ROTULO_DA_CHAVE_PIX: Record<TipoDeChavePix, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  aleatoria: "Chave aleatória",
};

export type ChavePixValida = {
  readonly ok: true;
  /** Forma canonica, pronta para o colega copiar e colar no banco. */
  readonly chave: string;
  readonly tipo: TipoDeChavePix;
};

export type ChavePixInvalida = {
  readonly ok: false;
  /** Frase para a pessoa que esta DIGITANDO, nao para o log. */
  readonly erro: string;
};

export type ResultadoDaChavePix = ChavePixValida | ChavePixInvalida;

const soDigitos = (v: string) => v.replace(/\D/g, "");

/**
 * Digito verificador de CPF/CNPJ pelo modulo 11.
 *
 * `pesos` vem de fora porque CPF e CNPJ usam sequencias diferentes; o resto da
 * conta e identico nos dois, e duplicar isso e como um dos dois acaba com uma
 * regra ligeiramente diferente da do outro.
 */
function digitoModulo11(digitos: number[], pesos: number[]): number {
  const soma = digitos.reduce((s, d, i) => s + d * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function cpfEhValido(valor: string): boolean {
  const d = soDigitos(valor);
  if (d.length !== 11) return false;
  // Todos os digitos iguais passam no modulo 11 (111.111.111-11 fecha a conta)
  // e nenhum deles e um CPF emitido. Sem esta linha, `11111111111` seria
  // aceito -- e e exatamente o tipo de valor que alguem digita para "testar".
  if (/^(\d)\1{10}$/.test(d)) return false;

  const n = d.split("").map(Number);
  const dv1 = digitoModulo11(n.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const dv2 = digitoModulo11(n.slice(0, 10), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return dv1 === n[9] && dv2 === n[10];
}

export function cnpjEhValido(valor: string): boolean {
  const d = soDigitos(valor);
  if (d.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(d)) return false;

  const n = d.split("").map(Number);
  const dv1 = digitoModulo11(
    n.slice(0, 12),
    [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  );
  const dv2 = digitoModulo11(
    n.slice(0, 13),
    [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  );
  return dv1 === n[12] && dv2 === n[13];
}

/**
 * Telefone em E.164 com DDI do Brasil.
 *
 * Aceita o que a pessoa digita de verdade -- `(11) 98888-7777`,
 * `11988887777`, `+55 11 98888-7777` -- e devolve sempre `+5511988887777`.
 *
 * O `55` inicial e ambiguo e e preciso dizer como ele e resolvido: um numero
 * de 12 ou 13 digitos que comeca com 55 e tratado como ja tendo o DDI. Isso
 * significa que um fixo do DDD 55 (Santa Maria/RS) escrito SEM DDI --
 * `5533334444`, 10 digitos -- ainda funciona, porque 10 digitos nunca sao
 * lidos como tendo DDI. O caso que nao tem saida limpa e um numero de 12
 * digitos comecando em 55; ali assumimos DDI, que e a leitura certa em
 * praticamente todo caso real.
 */
export function telefoneCanonico(valor: string): string | null {
  let d = soDigitos(valor);
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) {
    d = d.slice(2);
  }
  // 10 = fixo com DDD, 11 = celular com DDD (9 na frente).
  if (d.length !== 10 && d.length !== 11) return null;
  // DDD valido comeca em 11; nao existe DDD 0x nem 10.
  if (Number(d.slice(0, 2)) < 11) return null;
  if (d.length === 11 && d[2] !== "9") return null;
  return `+55${d}`;
}

/**
 * Email em minusculas. Deliberadamente frouxo no meio e rigido nas bordas:
 * validar email por regex "completa" reprova endereco valido, e o arranjo Pix
 * so exige que caiba em 77 caracteres e tenha a forma `local@dominio`.
 */
export function emailCanonico(valor: string): string | null {
  const v = valor.trim().toLowerCase();
  if (v.length > 77) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return null;
  return v;
}

/** EVP: UUID, em minusculas. E a chave que o proprio banco gera. */
export function aleatoriaCanonica(valor: string): string | null {
  const v = valor.trim().toLowerCase();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v)
  ) {
    return null;
  }
  return v;
}

/**
 * Valida e normaliza. O `tipo` e escolhido pela pessoa na tela, e nao
 * adivinhado: `11988887777` e um telefone valido e tambem poderia ser lido
 * como o comeco de um CPF, e errar essa leitura em silencio e como a chave
 * certa vira a chave de outra pessoa.
 */
export function validarChavePix(
  valor: string,
  tipo: TipoDeChavePix
): ResultadoDaChavePix {
  const bruto = (valor ?? "").trim();

  if (bruto === "") {
    return { ok: false, erro: "Digite a chave Pix." };
  }

  switch (tipo) {
    case "cpf": {
      if (!cpfEhValido(bruto)) {
        return {
          ok: false,
          erro: "CPF inválido. Confira os números — o dígito verificador não fecha.",
        };
      }
      return { ok: true, chave: soDigitos(bruto), tipo };
    }
    case "cnpj": {
      if (!cnpjEhValido(bruto)) {
        return {
          ok: false,
          erro: "CNPJ inválido. Confira os números — o dígito verificador não fecha.",
        };
      }
      return { ok: true, chave: soDigitos(bruto), tipo };
    }
    case "telefone": {
      const c = telefoneCanonico(bruto);
      if (!c) {
        return {
          ok: false,
          erro: "Telefone inválido. Use DDD + número, como (11) 98888-7777.",
        };
      }
      return { ok: true, chave: c, tipo };
    }
    case "email": {
      const c = emailCanonico(bruto);
      if (!c) {
        return { ok: false, erro: "E-mail inválido para chave Pix." };
      }
      return { ok: true, chave: c, tipo };
    }
    case "aleatoria": {
      const c = aleatoriaCanonica(bruto);
      if (!c) {
        return {
          ok: false,
          erro: "Chave aleatória inválida. Ela tem o formato de um UUID, com 36 caracteres.",
        };
      }
      return { ok: true, chave: c, tipo };
    }
  }
}

/**
 * Como a chave aparece na TELA do colega. O que ele copia e sempre a forma
 * canonica -- esta funcao existe so para o olho: `+5511988887777` e dificil de
 * conferir, `(11) 98888-7777` nao.
 *
 * Nunca use o retorno disto para copiar. Ver `chaveParaCopiar`.
 */
export function formatarChavePix(chave: string, tipo: TipoDeChavePix): string {
  switch (tipo) {
    case "cpf": {
      const d = soDigitos(chave);
      if (d.length !== 11) return chave;
      return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    }
    case "cnpj": {
      const d = soDigitos(chave);
      if (d.length !== 14) return chave;
      return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(
        8,
        12
      )}-${d.slice(12)}`;
    }
    case "telefone": {
      const d = soDigitos(chave);
      // `+5511988887777` -> 13 digitos com o 55 na frente.
      if (d.length !== 12 && d.length !== 13) return chave;
      const semDdi = d.startsWith("55") ? d.slice(2) : d;
      const ddd = semDdi.slice(0, 2);
      const resto = semDdi.slice(2);
      const meio = resto.length === 9 ? 5 : 4;
      return `(${ddd}) ${resto.slice(0, meio)}-${resto.slice(meio)}`;
    }
    default:
      return chave;
  }
}

/**
 * O que vai para a area de transferencia. E a chave CRUA, sempre.
 *
 * Existe como funcao de uma linha de proposito: o erro natural em toda tela
 * que mostra uma coisa e copia outra e passar para o `clipboard` o texto que
 * ja esta na mao -- o formatado. `123.456.789-09` colado no app do banco e uma
 * chave que nao existe.
 */
export function chaveParaCopiar(chave: string): string {
  return chave;
}

/**
 * A 032 ainda nao foi aplicada neste banco?
 *
 * POR QUE ISTO PRECISA EXISTIR
 * ----------------------------
 * Producao nao tem runner de migration: o deploy publica CODIGO, nao schema.
 * Entre o merge e o momento em que alguem cola a 032 no SQL Editor do Supabase
 * existe uma janela em que o app novo conversa com o banco velho -- e nessa
 * janela `user_pix_keys` nao existe.
 *
 * Sem este reconhecimento, a tela de Perfil abre com um toast vermelho
 * ("Nao foi possivel carregar sua chave Pix") para TODA pessoa que entrar
 * nela, por uma feature que ela nem sabia que ia ganhar. A leitura honesta
 * desse estado nao e "deu erro", e "ainda nao ha chave" -- que e exatamente o
 * que a tela ja sabe mostrar.
 *
 * `42P01` e o SQLSTATE do Postgres para relacao inexistente; `PGRST205` e o
 * que o PostgREST devolve quando a tabela nao esta no schema cache dele. Os
 * dois aparecem neste caminho e significam a mesma coisa.
 */
export function tabelaDePixAusente(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;
  const codigo = (erro as { code?: unknown }).code;
  return codigo === "42P01" || codigo === "PGRST205";
}

// ---------------------------------------------------------------------------
// O PIX COPIA E COLA (BR Code) -- a transferencia do acerto com um toque
// ---------------------------------------------------------------------------
// "um icone de copia e cola que ja gera uma linha de valor e pix da pessoa pra
// ela pagar no banco." A chave sozinha (`chaveParaCopiar`) obriga a pessoa a
// digitar o valor no app do banco, e e no valor digitado que o acerto erra. O
// codigo copia e cola leva os DOIS: o banco le a chave e o valor, mostra o nome
// do dono da chave e pede so a confirmacao.
//
// O formato e o BR Code estatico do Banco Central (EMV QRCPS-MPM): campos
// `ID + tamanho + valor`, o arranjo `br.gov.bcb.pix` com a chave no campo 26, o
// valor no 54 e o CRC16 no 63. Nada aqui fala com rede ou banco.
//
// O NOME E A CIDADE SAO EXIGIDOS PELO PADRAO, E SO A CHAVE DECIDE O DESTINO
// ------------------------------------------------------------------------
// Os campos 59 (nome, ate 25) e 60 (cidade, ate 15) sao obrigatorios. O app nao
// guarda cidade; vai `BRASIL`. O banco nao paga pelo nome nem pela cidade: ele
// busca a chave no DICT e mostra o nome de quem e dono dela antes da
// confirmacao. Por isso os dois sao normalizados para o que o padrao aceita
// (sem acento, sem simbolo) em vez de recusados: um nome com emoji nao pode
// impedir o acerto.

/** O que vai no campo 60 quando o app nao sabe a cidade. */
export const CIDADE_DO_PIX = "BRASIL";

/** O que vai no campo 59 quando o nome de quem recebe nao esta legivel. */
export const NOME_DO_PIX_SEM_NOME = "RECEBEDOR";

/** Um campo EMV: ID de 2 digitos, tamanho de 2 digitos, valor. */
function campoEmv(id: string, valor: string): string {
  return `${id}${String(valor.length).padStart(2, "0")}${valor}`;
}

/**
 * O texto que o padrao aceita: ASCII, sem acento, sem simbolo, cortado.
 * `Letícia 🌸` vira `Leticia`.
 */
function textoDoPix(texto: string, maximo: number): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximo)
    .trim();
}

/**
 * CRC16/CCITT-FALSE (polinomio 0x1021, inicio 0xFFFF), em 4 hex maiusculos --
 * o que o campo 63 exige. Calculado sobre o codigo INTEIRO, inclusive o
 * `6304` do proprio campo.
 */
export function crcDoPix(texto: string): string {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i++) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * O codigo Pix copia e cola de uma transferencia.
 *
 * `valor` em reais; sem valor positivo o campo 54 sai do codigo e o banco pede
 * o valor na tela -- o mesmo comportamento de um QR estatico sem valor. `null`
 * quando a chave esta vazia: um codigo sem chave nao paga ninguem, e a tela
 * mostra que a pessoa nao cadastrou chave em vez de copiar lixo.
 */
export function codigoPixCopiaECola(entrada: {
  chave: string;
  valor?: number | null;
  nome?: string | null;
  cidade?: string | null;
}): string | null {
  const chave = chaveParaCopiar((entrada.chave ?? "").trim());
  if (!chave) return null;

  const arranjo =
    campoEmv("00", "br.gov.bcb.pix") + campoEmv("01", chave);
  // O campo 26 inteiro cabe em 99: o arranjo tem 18 e a chave mais longa (a
  // aleatoria, 36; o email, ate 77) cabe no que sobra. Email maior que isso nao
  // e chave Pix valida.
  if (arranjo.length > 99) return null;

  const nome = textoDoPix(entrada.nome ?? "", 25) || NOME_DO_PIX_SEM_NOME;
  const cidade = textoDoPix(entrada.cidade ?? "", 15) || CIDADE_DO_PIX;

  const valor =
    typeof entrada.valor === "number" &&
    Number.isFinite(entrada.valor) &&
    entrada.valor > 0
      ? campoEmv("54", entrada.valor.toFixed(2))
      : "";

  const semCrc =
    campoEmv("00", "01") +
    campoEmv("26", arranjo) +
    campoEmv("52", "0000") +
    campoEmv("53", "986") +
    valor +
    campoEmv("58", "BR") +
    campoEmv("59", nome) +
    campoEmv("60", cidade) +
    campoEmv("62", campoEmv("05", "***")) +
    "6304";

  return semCrc + crcDoPix(semCrc);
}
