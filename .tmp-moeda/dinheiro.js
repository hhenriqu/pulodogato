// ---------------------------------------------------------------------------
// A MASCARA DE DINHEIRO, E O QUE ELA NAO PODE DEIXAR VAZAR (HMO-171)
// ---------------------------------------------------------------------------
// O pedido e de uma linha: "qualquer campo de valor deve ser aplicado a mascara
// R$1.000,00". A armadilha esta em como esse texto convive com o resto do app.
//
// Todos os formularios deste projeto guardam o valor como STRING e o convertem
// com `Number.parseFloat` na hora de gravar (`validarLancamento`, `valorGravado`,
// as rotas de parcelas, a fila offline). E `parseFloat` le a mascara brasileira
// do jeito errado, sem erro nenhum:
//
//   Number.parseFloat("1.000,00")  ->  1
//
// Mil reais viram um real. Nao ha excecao, nao ha NaN, nao ha nada para um
// `catch` pegar: a tela mostra "R$ 1.000,00", a validacao aprova (1 > 0), e a
// linha entra no banco valendo R$ 1,00. O saldo fecha -- errado -- e o unico
// jeito de descobrir e conferir lancamento por lancamento.
//
// Por isso este modulo separa duas coisas que parecem uma:
//
//   EXIBICAO -> "R$ 1.000,00". Existe so para o olho, nunca e gravada.
//   VALOR    -> "1000.00". String decimal com ponto, que e o que `parseFloat`
//               e o Postgres entendem. E o que o formulario guarda no estado.
//
// `CampoDeValor` (components/ui/campo-de-valor.tsx) mostra a primeira e emite a
// segunda. Nenhuma tela chega a ver o texto mascarado.
//
// POR QUE A CONVERSAO E FEITA COM DIGITOS, E NAO COM `parseFloat`
// ---------------------------------------------------------------
// A mascara e guiada por DIGITOS: o que a pessoa digita preenche a partir dos
// centavos ("1" -> R$ 0,01; "100000" -> R$ 1.000,00), que e como todo campo de
// dinheiro se comporta no Brasil. Isso torna a funcao total -- toda sequencia de
// teclas tem uma saida canonica -- e e o que permite ao componente derivar a
// exibicao do valor a cada render, sem guardar um segundo estado que pode
// divergir do primeiro.
//
// O VALOR sai montado como string (`inteiro + "." + centavos`), sem passar por
// ponto flutuante.
//
// Sendo honesto sobre o tamanho desse cuidado: `(Number(digitos) / 100).toFixed(2)`
// daria hoje o MESMO resultado em todos os casos -- conferido por amostragem, e
// pela razao estrutural de que `MAX_DIGITOS` (15) mantem o inteiro abaixo de
// 2^53, onde `Number` e exato e o `toFixed` reconstroi a string sem erro. A
// montagem por string nao esta aqui porque a divisao erra hoje; esta aqui porque
// a divisao so acerta ENQUANTO o teto ficar onde esta. Ela amarra a corretude do
// dinheiro a uma constante de ergonomia de campo, e quem um dia subir
// `MAX_DIGITOS` para caber um valor em guarani nao tem por que adivinhar isso. A
// versao por string e exata por construcao, independente do teto.
//
// O CATALOGO DE MOEDAS mora aqui porque a escolha de moeda por lancamento
// (mesma issue) precisa exatamente das mesmas duas perguntas: qual simbolo
// prefixar e quantas casas a moeda tem. Iene nao tem centavos, e formatar
// "¥ 1.000,00" seria inventar uma subdivisao que a moeda nao possui.
//
// Sem import de proposito: `tsc lib/dinheiro.ts` compila sozinho, o que deixa a
// suite de teste rodar sem o passo de reescrita do alias `@/`.
// ---------------------------------------------------------------------------
/**
 * As moedas que o seletor oferece.
 *
 * Lista curta e fechada de proposito. Um `<select>` com as 180 moedas do ISO
 * 4217 nao ajuda ninguem a achar a sua, e cada codigo aqui e um simbolo que
 * alguem precisa ter conferido -- "$" sozinho para dolar americano e euro a
 * direita do numero sao os dois erros classicos de uma lista gerada.
 */
export const MOEDAS = [
    { codigo: "BRL", simbolo: "R$", nome: "Real brasileiro", casas: 2 },
    { codigo: "USD", simbolo: "US$", nome: "Dólar americano", casas: 2 },
    { codigo: "EUR", simbolo: "€", nome: "Euro", casas: 2 },
    { codigo: "GBP", simbolo: "£", nome: "Libra esterlina", casas: 2 },
    { codigo: "CHF", simbolo: "CHF", nome: "Franco suíço", casas: 2 },
    { codigo: "CAD", simbolo: "C$", nome: "Dólar canadense", casas: 2 },
    { codigo: "AUD", simbolo: "A$", nome: "Dólar australiano", casas: 2 },
    { codigo: "ARS", simbolo: "AR$", nome: "Peso argentino", casas: 2 },
    { codigo: "CLP", simbolo: "CLP$", nome: "Peso chileno", casas: 0 },
    { codigo: "UYU", simbolo: "UY$", nome: "Peso uruguaio", casas: 2 },
    { codigo: "PYG", simbolo: "₲", nome: "Guarani paraguaio", casas: 0 },
    { codigo: "JPY", simbolo: "¥", nome: "Iene japonês", casas: 0 },
    { codigo: "CNY", simbolo: "CN¥", nome: "Yuan chinês", casas: 2 },
];
/** A moeda de quem nunca configurou nada. O app nasceu em pt-BR. */
export const MOEDA_PADRAO = "BRL";
/**
 * O maximo de digitos que o campo aceita.
 *
 * 15 digitos com 2 casas dao R$ 9.999.999.999.999,99 -- alem do que qualquer
 * campo deste app precisa, e ainda dentro de `Number.MAX_SAFE_INTEGER` (9e15),
 * que e o que a reexibicao de um valor gravado atravessa.
 *
 * O teto IGNORA a tecla extra em vez de cortar a string. Cortar pelo fim
 * mudaria o numero que a pessoa esta vendo enquanto ela digita; ignorar so nao
 * faz nada, e nao ha como ficar com um valor que ninguem pediu.
 */
export const MAX_DIGITOS = 15;
/**
 * A moeda pelo codigo. Codigo desconhecido cai no padrao em vez de explodir:
 * um `preferences.moeda` estranho (mao humana no jsonb, versao antiga do app)
 * nao pode deixar a tela de lancamento branca.
 */
export function moedaPorCodigo(codigo) {
    const alvo = (codigo ?? "").trim().toUpperCase();
    return (MOEDAS.find((m) => m.codigo === alvo) ??
        MOEDAS.find((m) => m.codigo === MOEDA_PADRAO));
}
/** O codigo e uma das moedas que o app conhece? */
export function moedaConhecida(codigo) {
    if (typeof codigo !== "string")
        return false;
    const alvo = codigo.trim().toUpperCase();
    return MOEDAS.some((m) => m.codigo === alvo);
}
/** Agrupa a parte inteira de 3 em 3 com ponto, como se escreve em pt-BR. */
function agrupar(inteiro) {
    let saida = "";
    for (let i = 0; i < inteiro.length; i++) {
        // A posicao a contar do FIM e o que decide o separador: agrupar a partir do
        // comeco erra todo numero cujo tamanho nao e multiplo de 3.
        const daDireita = inteiro.length - i;
        saida += inteiro[i];
        if (daDireita > 1 && (daDireita - 1) % 3 === 0)
            saida += ".";
    }
    return saida;
}
/**
 * Separa uma sequencia de digitos em parte inteira e centavos, segundo as casas
 * da moeda. Devolve as duas partes como STRING para que nada passe por
 * aritmetica de ponto flutuante.
 */
function partir(digitos, casas) {
    const preenchido = digitos.padStart(casas + 1, "0");
    const corte = preenchido.length - casas;
    // Sem poda de zero a esquerda aqui: quem chama ja poda os DIGITOS, e com isso
    // a parte inteira so pode ser "0" (quando o valor e menor que uma unidade) ou
    // comecar por digito diferente de zero. Havia um `replace(/^0+(?=\d)/, "")`
    // nesta linha; ele era inalcancavel, e um controle negativo o denunciou --
    // remove-lo nao mudou nenhuma das 33 asercoes da suite.
    return { inteiro: preenchido.slice(0, corte), fracao: preenchido.slice(corte) };
}
/**
 * O que mostrar e o que guardar, a partir do texto cru que esta no input.
 *
 * Aceita qualquer coisa: o que nao e digito e descartado. Isso e o que faz a
 * funcao ser total -- colar "mil reais" nao deixa o campo num estado que a
 * validacao nao sabe ler, deixa o campo vazio.
 *
 * O MENOS E DESCARTADO, SEMPRE
 * ----------------------------
 * E de proposito, e conserta um perigo anterior a esta issue: o campo era
 * `type="number"` e aceitava "-30" numa tela de despesa. `valorGravado` aplica
 * `-Math.abs`, entao "-30" virava `-(-30) = +30` -- dinheiro ENTRANDO numa tela
 * de saida, e o saldo fechando errado para MAIS, que e o lado do qual ninguem
 * reclama. O `Math.abs` continua nas rotas e na fila offline; o campo deixa de
 * oferecer a armadilha.
 *
 * Houve aqui, por algumas horas, uma opcao `aceitaNegativo` para os campos onde
 * o vermelho e resposta legitima (saldo de conta). Ela saiu porque nao funciona
 * neste desenho: `CampoDeValor` DERIVA o texto do valor, e um menos sem digito
 * nenhum nao cabe no valor ("-" nao e numero). O sinal sumia debaixo do dedo de
 * quem digitasse o menos primeiro -- que e a ordem natural. Um campo que aceite
 * negativo vai precisar de rascunho proprio, e nao de mais um parametro aqui;
 * ate existir esse campo, a opcao era codigo morto com um defeito dentro.
 */
export function aoDigitarValor(textoCru, codigoDaMoeda = MOEDA_PADRAO) {
    const moeda = moedaPorCodigo(codigoDaMoeda);
    // Zeros a esquerda caem JA AQUI, e nao so na parte inteira. E o que permite ao
    // campo esvaziar.
    //
    // Sem isto o backspace tem um ponto fixo em "R$ 0,00": apagar o ultimo
    // caractere deixa "R$ 0,0", que tem dois digitos, que o `padStart` devolve
    // para tres, que reexibem "R$ 0,00". O campo ficava impossivel de limpar --
    // a pessoa aperta backspace e nada acontece, para sempre, sem erro nenhum.
    //
    // A consequencia aceita: um valor exatamente ZERO nao e digitavel, porque
    // "0,00" e indistinguivel de "a pessoa apagou tudo" quando a unica informacao
    // e o texto em tela. Nenhum campo deste app quer zero -- toda validacao pede
    // "maior que zero" -- e campo vazio e o estado que elas ja sabem recusar.
    const digitos = textoCru
        .replace(/\D/g, "")
        .replace(/^0+/, "")
        .slice(0, MAX_DIGITOS);
    if (digitos === "") {
        // Campo vazio nao e zero. Mostrar "R$ 0,00" aqui faria um `required` do HTML
        // passar com nada digitado, deixando a validacao da submissao como unica
        // rede.
        return { exibicao: "", valor: "" };
    }
    const { inteiro, fracao } = partir(digitos, moeda.casas);
    const numero = moeda.casas > 0 ? `${agrupar(inteiro)},${fracao}` : agrupar(inteiro);
    return {
        exibicao: `${moeda.simbolo} ${numero}`,
        valor: `${inteiro}${moeda.casas > 0 ? `.${fracao}` : ""}`,
    };
}
/**
 * A mascara de um valor que JA existe -- o que veio do banco na edicao, ou o
 * padrao que a tela sugere.
 *
 * Entra em notacao decimal com ponto (como o Postgres devolve `numeric`) e sai
 * mascarado. Passa por `aoDigitarValor`, e nao por um formatador proprio: e isso
 * -- e nao um comentario pedindo cuidado -- que garante que o texto de um valor
 * gravado e IDENTICO ao texto do mesmo valor digitado. Dois caminhos para o
 * mesmo texto e como um deles fica diferente sem ninguem notar, e no campo
 * controlado essa diferenca apareceria como um piscar a cada tecla.
 *
 * Por consequencia o sinal NAO sobrevive aqui: `aoDigitarValor` descarta o
 * menos. E o que se quer num campo de digitacao -- ele mostra exatamente o que
 * emitiria. Para LER um valor negativo (saldo no vermelho) use `formatarValor`,
 * que e a funcao de leitura e mantem o sinal.
 */
export function valorParaExibicao(valorPlano, codigoDaMoeda = MOEDA_PADRAO) {
    if (valorPlano === null || valorPlano === undefined || valorPlano === "") {
        return "";
    }
    const numero = typeof valorPlano === "number" ? valorPlano : Number(valorPlano);
    if (!Number.isFinite(numero))
        return "";
    const moeda = moedaPorCodigo(codigoDaMoeda);
    const fator = 10 ** moeda.casas;
    const unidadesMenores = Math.round(Math.abs(numero) * fator);
    return aoDigitarValor(String(unidadesMenores), moeda.codigo).exibicao;
}
/**
 * O numero por tras de um valor plano, para quem precisa calcular.
 *
 * Existe para que nenhuma tela escreva `parseFloat` em cima de um campo de
 * dinheiro por conta propria: e justamente esse `parseFloat` que le a mascara
 * errado, e um dia alguem vai passar o texto exibido para ele.
 */
export function valorNumerico(valorPlano) {
    if (valorPlano === null || valorPlano === undefined)
        return 0;
    const n = Number.parseFloat(String(valorPlano));
    return Number.isFinite(n) ? n : 0;
}
/**
 * Formata um valor JA calculado para leitura, com o simbolo da moeda.
 *
 * Difere de `formatCurrency` (lib/utils.ts) em duas coisas que importam desde
 * esta issue: usa o catalogo -- entao respeita as casas reais da moeda em vez
 * de forcar duas -- e usa espaco normal em vez do espaco inquebravel que o
 * `Intl` insere, que e o que permite comparar o texto num teste sem cair no
 * falso negativo de "R$ 1,00" nao bater com "R$ 1,00".
 */
export function formatarValor(valor, codigoDaMoeda = MOEDA_PADRAO) {
    const moeda = moedaPorCodigo(codigoDaMoeda);
    const fator = 10 ** moeda.casas;
    const unidadesMenores = Math.round(Math.abs(valor) * fator);
    const { inteiro, fracao } = partir(String(unidadesMenores), moeda.casas);
    const numero = moeda.casas > 0 ? `${agrupar(inteiro)},${fracao}` : agrupar(inteiro);
    // O menos vem antes do simbolo ("-R$ 10,00") e nao entre ele e o numero:
    // "R$ -10,00" e o formato que todo leitor le duas vezes.
    return `${valor < 0 ? "-" : ""}${moeda.simbolo} ${numero}`;
}
