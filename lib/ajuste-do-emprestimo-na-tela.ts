// ---------------------------------------------------------------------------
// O AJUSTE NA TELA -- o corpo do PATCH e a previa dele (HMO-480)
// ---------------------------------------------------------------------------
// F8 da HMO-444. A F4 (HMO-447) e a F7 (HMO-478) entregaram o
// `PATCH /api/mybank/loans/[id]` inteiro -- os quatro campos, o recalculo da
// cauda, o emprestado parado e as 12 recusas nomeadas. Nenhuma tela chamava
// nada daquilo: pelo painel, um emprestimo ativo so podia ser CANCELADO, e
// corrigir um typo na descricao exigia `curl`.
//
// Este modulo e a metade PURA daquele dialogo. O `PainelDoMyBank` guarda o
// estado dos campos e faz o `fetch`; o que esta aqui e o que decide **o que vai
// no corpo** e **que numeros a pessoa le antes de clicar** -- as duas coisas
// que, escritas no JSX, passariam por qualquer suite intactas
// (`provar-handler-react-em-chromium-commitado`).
//
// A PRESENCA DO CAMPO MANDA, E E O INVARIANTE DESTE ARQUIVO
// ---------------------------------------------------------
// `PedidoDeAjuste` tem os quatro campos OPCIONAIS, e a rota le `!== undefined`
// para decidir o que mexe em que. Campo ausente nao e "campo igual ao de hoje":
// `{descricao: "Geladeira"}` sobre um emprestimo que JA se chama "Geladeira" e
// um AJUSTE -- entra em `mexeNaDescricao`, passa pela validacao, grava, e a
// frase da rota reporta uma mudanca de descricao que nao mudou nada.
//
// Por isso o formulario nasce VAZIO, e nao preenchido com os valores de hoje.
// Preencher seria o jeito "amigavel" de montar a tela e faria todo clique em
// "Ajustar" mandar os quatro campos -- o que transforma um conserto de typo num
// pedido que recalcula a serie inteira. O preco de nascer vazio e que a pessoa
// nao LE o valor atual no campo; quem o mostra e a linha do painel logo acima
// (descricao, valor por parcela, vencimento) e a previa daqui.
//
// O VAZIO SIGNIFICA "NAO TOQUEI", E ISSO E SEGURO NOS QUATRO
// ----------------------------------------------------------
// Para os quatro campos o valor vazio nao e um pedido legitimo:
//
//   descricao   `mybank_loans.description` e NOT NULL e a rota recusa o branco
//               com `descricao_vazia` -- "" nunca foi um valor que se possa
//               querer gravar;
//   total       `total_invalido` recusa `<= 0`, e "" viraria `Number("") === 0`;
//   taxa        zerar o juro EXISTE e e alcancavel, mas ele se pede com "0" no
//               campo, nao apagando o campo (ver ZERAR O JURO abaixo);
//   vencimento  `vencimento_invalido` exige `AAAA-MM-DD`.
//
// Entao nao ha estado que o vazio esconda, e nao foi preciso um terceiro estado
// (nem um `checkbox` "mexer neste campo" por campo, que era a outra forma).
//
// ZERAR O JURO SE PEDE COM "0", E NAO COM O MODO "SEM JUROS"
// ----------------------------------------------------------
// O alternador e o do `CamposDeJuros` (F3), e os tres modos dele querem dizer
// OUTRA COISA aqui -- e e por isso que os rotulos sao proprios
// (`rotuloDoModoDoAjuste`):
//
//   na CRIACAO          no AJUSTE
//   sem_juros  juro 0   NAO MEXER no juro       -> nem `taxa` nem `total`
//   taxa       a taxa   trocar a taxa           -> `{taxa}`
//   total      o total  trocar o total          -> `{total}`
//
// "Sem juros" seria uma frase FALSA no modo inicial: ele nao zera juro nenhum,
// ele nao manda campo nenhum. Quem quer zerar escolhe "% de juros" e digita 0 --
// e aquele pedido passa por `ajusteMexeNoJuro` (ja tem juro + mexe na taxa),
// resolve `total = principal` e cai na recusa certa
// (`total_menor_que_o_pago`) se metade da serie ja foi recebida.
//
// `taxa_e_total_juntos` FICA INALCANCAVEL PELA TELA, e de proposito: o modo e UM
// so, entao os dois campos nunca existem ao mesmo tempo no DOM (o
// `CamposDeJuros` monta so o do modo escolhido -- esconder com CSS deixaria o
// estado preenchido e os dois viajariam no corpo). A rota continua perguntando,
// porque quem chega pelo PostgREST nao passa por tela nenhuma -- a mesma divisao
// que `mais_do_que_em_aberto` tem no dialogo de antecipar.
//
// A PREVIA NAO FAZ CONTA NENHUMA
// ------------------------------
// `previaDoAjuste` chama `juroDepoisDoAjuste`, `totalDepoisDoAjuste` e
// `faltaReceberDoAjuste` -- as tres da F7, as mesmas que a rota chama. Uma conta
// propria aqui divergiria da rota na primeira mudanca, e o sintoma seria a tela
// prometendo um total que o banco nao grava: e o defeito que tem nome neste
// repositorio (`previa-na-tela-tem-que-usar-o-peso-do-fechamento`), onde a tela
// chamava a funcao certa com o argumento errado e a diferenca eram 13 centavos
// por mes que nada denunciava.
//
// E O `emprestado` SAI DE `juro.principal`, NAO DE `emprestimo.principal`
// ----------------------------------------------------------------------
// As duas leituras valem o mesmo quando a fiacao esta certa, e e justamente por
// isso que a previa le a RESPOSTA da funcao: o "emprestado fica parado" e a
// decisao da HMO-478 (opcao A, confirmada pelo Helio), e quem a cumpre e
// `juroDepoisDoAjuste`, que recebe o `principal` e o devolve intacto. Lendo
// `emprestimo.principal` direto, a tela diria "parado" mesmo no dia em que
// aquela funcao passasse a mover o principal -- a previa viraria uma afirmacao
// sobre si mesma em vez de uma medicao do que vai ser gravado, e o unico jeito
// de ver o defeito seria ler `mybank_loans` antes e depois (ele nao tem sintoma
// na tela: `SUM(amount) - principal` vira zero em silencio).
//
// ...MAS HA UM TERCEIRO RAMO, E NELE O EMPRESTADO **MUDA** (HMO-479)
// -----------------------------------------------------------------
// O paragrafo acima descreve dois ramos e a rota tem TRES, porque
// `montaAjuste` escolhe o `patchDoEmprestimo` assim:
//
//   com juro resolvido           -> grava `interest_rate`; o `principal` NAO
//                                   entra no patch, logo fica parado;
//   SEM juro e com `total`       -> grava `principal = total` (o caminho da F4:
//                                   a juro zero o total E o principal, e o
//                                   pedido quer dizer "o valor estava errado");
//   nenhum dos dois              -> nao toca a linha do emprestimo.
//
// O segundo ramo e o unico em que o emprestado se MOVE, e era exatamente onde a
// previa mentia: com `juro === null` ela caia em `Number(emprestimo.principal)`
// e imprimia o valor ANTIGO. Medido na HMO-479, no cenario do caso D7 (4x250,00
// sem juro, novo total 1.200,00): a tela dizia "Você emprestou R$ 1.000,00" e o
// `patchDoEmprestimo` levava `{principal: 1200}`. A tela afirmava um numero que
// o banco nao ia guardar, no UNICO ramo em que aquele numero era noticia.
//
// E o defeito era invisivel para a suite inteira: o D7 media `total`,
// `falta_receber` e a AUSENCIA de `taxa`/`juros` -- nunca o `emprestado`. Por
// isso o `emprestado` agora sai do MESMO `total` que a rota grava, e nao de uma
// segunda conta (`previa-na-tela-tem-que-usar-o-peso-do-fechamento`: a funcao
// certa com o argumento errado da um numero plausivel e errado).
// ---------------------------------------------------------------------------

import {
  emPercentoDaPrevia,
  emReaisDaPrevia,
  faltaReceberDoAjuste,
  jaRecebidoDaSerie,
  juroDepoisDoAjuste,
  pendentesDaSerie,
  totalDepoisDoAjuste,
  type GrandezaDaPrevia,
  type ModoDoJuro,
  type ParcelaParaAjustar,
  type PedidoDeAjuste,
} from "@/lib/emprestimo-do-mybank";
import type { ParcelaDoMyBank } from "@/lib/mybank-na-tela";

/**
 * O estado dos campos do dialogo -- o que a pessoa digitou, cru.
 *
 * Strings nos tres campos de valor porque e isso que um `<input>` tem, e porque
 * e isso que a rota recebe: ela coerce (`Number(pedido.total)`,
 * `fracaoDaTaxaDigitada(String(pedido.taxa))`) e as recusas dela sao escritas
 * para texto ilegivel. Converter aqui faria um campo com "abc" virar `NaN` antes
 * de sair da tela, e `NaN` serializa como `null` em JSON -- a rota receberia
 * `{total: null}`, que e `!== undefined` e portanto um pedido de mudar o total
 * para "nada".
 */
export interface FormularioDoAjuste {
  descricao: string;
  /** Qual dos dois campos de juro existe -- ou nenhum. Ver ZERAR O JURO. */
  modoDoJuro: ModoDoJuro;
  /** A taxa em PERCENTO, como o `CamposDeJuros` emite ("20"). */
  taxa: string;
  /** O total a receber, plano em reais ("1200.00"). */
  total: string;
  /** `AAAA-MM-DD`, como o `CampoDeData` emite. */
  primeiroVencimentoDaCauda: string;
}

/**
 * O FORMULARIO DE ABERTURA -- nada tocado.
 *
 * Uma constante e nao um literal no componente: "abrir o dialogo zera os campos"
 * e uma regra que tem de valer na PRIMEIRA abertura e em toda reabertura, e o
 * dialogo de antecipar ja ensinou o preco de nao reza-la (`abrirAntecipacao`
 * reseta a quantidade porque sem isso o `<select>` fica com um valor que nao
 * esta entre as opcoes). Aqui o estrago seria pior: a descricao digitada para o
 * emprestimo A seguiria no campo ao abrir o B, e um clique em "Ajustar"
 * renomearia a divida errada.
 */
export const FORMULARIO_DO_AJUSTE_VAZIO: FormularioDoAjuste = {
  descricao: "",
  modoDoJuro: "sem_juros",
  taxa: "",
  total: "",
  primeiroVencimentoDaCauda: "",
};

/** O rotulo de cada modo do alternador NO AJUSTE. Ver ZERAR O JURO no cabecalho. */
export function rotuloDoModoDoAjuste(modo: ModoDoJuro): string {
  switch (modo) {
    case "sem_juros":
      // "Nao mexer nos juros" e nao "Sem juros": este modo nao zera juro
      // nenhum, ele deixa `taxa` e `total` FORA do corpo. Um emprestimo a 20%
      // ajustado neste modo continua a 20%.
      return "Não mexer nos juros";
    case "taxa":
      return "% de juros";
    case "total":
      return "Total a receber";
  }
}

/**
 * O CORPO DO PATCH -- so os campos tocados.
 *
 * Esta funcao e o invariante do cabecalho em forma de codigo, e cada `if` aqui e
 * um campo que NAO viaja quando esta vazio. O retorno e `{}` para o formulario
 * intocado, e e `pedidoAjustaAlgumCampo` (nao esta) que transforma isso em
 * "nao ha o que mandar" -- separar as duas deixa o `{}` ser medido como valor.
 *
 * `trim()` DECIDE E O VALOR VAI CRU. A pergunta e sobre o campo estar em branco
 * ("   " e um campo em branco, nao um pedido de descricao de tres espacos); o
 * que se manda e o que foi digitado, porque a rota tem as frases dela para texto
 * que nao serve e aparar aqui faria a tela consertar calado um pedido que a
 * pessoa vai reler na frase de volta.
 */
export function pedidoDoAjusteDaTela(form: FormularioDoAjuste): PedidoDeAjuste {
  const pedido: PedidoDeAjuste = {};

  if (form.descricao.trim() !== "") {
    pedido.descricao = form.descricao;
  }

  // O MODO MANDA, E DEPOIS O CAMPO. As duas perguntas sao necessarias: sem o
  // modo, trocar de "% de juros" para "Total a receber" depois de ter digitado
  // a taxa mandaria os DOIS (`taxa_e_total_juntos`, a recusa que esta tela
  // existe para nao alcancar); sem o campo, escolher o modo e nao digitar nada
  // mandaria `{taxa: ""}` -- que e `!== undefined` e viraria um pedido de taxa
  // zero por engano.
  if (form.modoDoJuro === "taxa" && form.taxa.trim() !== "") {
    pedido.taxa = form.taxa;
  }

  if (form.modoDoJuro === "total" && form.total.trim() !== "") {
    pedido.total = form.total;
  }

  if (form.primeiroVencimentoDaCauda.trim() !== "") {
    pedido.primeiroVencimentoDaCauda = form.primeiroVencimentoDaCauda;
  }

  return pedido;
}

/**
 * O pedido mexe em ALGUM campo? `false` e o formulario intocado.
 *
 * UM criterio e nao dois, e e por isso que ele le o PEDIDO e nao o formulario: o
 * botao "Ajustar" se desabilita por ele e a previa se esconde por ele, e as duas
 * perguntas tem de ser a MESMA -- duas copias (uma lendo `form.descricao`, outra
 * lendo `pedido.descricao`) divergiriam no primeiro campo novo, e o sintoma
 * seria um botao habilitado sobre uma previa vazia, ou o contrario.
 *
 * E ele e a razao pela qual `nada_a_ajustar` nao e alcancavel por esta tela. A
 * rota continua perguntando: o `{}` e o corpo que um cliente com um campo
 * escrito errado manda, e e la que a frase diz quais campos existem.
 */
export function pedidoAjustaAlgumCampo(pedido: PedidoDeAjuste): boolean {
  return (
    pedido.descricao !== undefined ||
    pedido.total !== undefined ||
    pedido.taxa !== undefined ||
    pedido.primeiroVencimentoDaCauda !== undefined
  );
}

/**
 * As parcelas do painel na forma que as funcoes do ajuste leem.
 *
 * Duas formas do mesmo fato existem porque sao dois vocabularios: a ROTA devolve
 * `{numero, valor, vencimento}` (`ParcelaDoMyBank`, em portugues, para a tela) e
 * as funcoes puras do ajuste leem `{installment_number, amount, due_date}`
 * (`ParcelaParaAjustar`, os nomes das COLUNAS, porque e a mesma forma que o
 * servidor passa a elas). Esta traducao e o unico lugar onde as duas se
 * encontram.
 *
 * `installment_total` SAI DE `parcela.total`, e esse nome colide feio: em
 * `ParcelaDoMyBank`, `total` e o TOTAL DE PARCELAS da serie (o 24 de "3 de 24"),
 * nao um valor em reais. O valor e `parcela.valor`. Trocar os dois nao da
 * sintoma na previa -- `installment_total` nao entra em conta nenhuma do ajuste
 * -- mas poe o numero de parcelas no lugar do dinheiro, que e a familia de
 * `nome-de-campo-errado-esconde-bug-de-dinheiro`.
 */
export function parcelasParaAjustar(
  parcelas: ParcelaDoMyBank[]
): ParcelaParaAjustar[] {
  return parcelas.map((parcela) => ({
    id: parcela.id,
    installment_number: parcela.numero,
    installment_total: parcela.total,
    amount: parcela.valor,
    due_date: parcela.vencimento,
    status: parcela.status,
  }));
}

/**
 * A PREVIA DO AJUSTE -- os numeros que a pessoa le ANTES de clicar.
 *
 * `null` quando nao ha nada tocado, pela razao que `previaDoEmprestimo` ja da:
 * uma lista de zeros se le como "um ajuste de valor zero ja calculado", nao como
 * "falta preencher".
 *
 * AS TRES FUNCOES SAO AS DA ROTA. Ver A PREVIA NAO FAZ CONTA NENHUMA no
 * cabecalho; a ordem aqui tambem e a de la, porque `totalDepoisDoAjuste` e
 * `faltaReceberDoAjuste` recebem o `juro` ja resolvido e passar `null` por
 * engano apagaria a taxa da conta sem apagar a taxa da tela.
 *
 * `juros` E `taxa` SO APARECEM COM JURO RESOLVIDO, e a ausencia e a informacao:
 * um pedido que so troca a descricao ou so adia o vencimento nao mexe no juro, e
 * imprimir "Juros R$ 0,00" ali seria dizer que o ajuste vai zerar o juro de um
 * emprestimo que continua a 20%. Quem decide e `juroDepoisDoAjuste`, devolvendo
 * `null` -- a mesma divisao que `ajusteMexeNoJuro` faz na rota.
 *
 * `total` E `falta_receber` APARECEM SEMPRE, E OS DOIS NAO SAO O MESMO NUMERO.
 * `total` e a divida inteira depois do ajuste; `falta_receber` e `total` menos o
 * que ja foi recebido, que e o que vai ser repartido entre as pendentes. Num
 * emprestimo sem nada pago eles coincidem, e e exatamente por isso que as duas
 * linhas existem: no emprestimo com metade paga, quem lesse so o `total`
 * concluiria que vai receber o dobro.
 */
export function previaDoAjuste(params: {
  emprestimo: {
    principal: number | string;
    interest_rate?: number | string | null;
  };
  parcelas: ParcelaParaAjustar[];
  pedido: PedidoDeAjuste;
}): GrandezaDaPrevia[] | null {
  const { emprestimo, parcelas, pedido } = params;

  if (!pedidoAjustaAlgumCampo(pedido)) return null;

  const juro = juroDepoisDoAjuste({ emprestimo, pedido });
  const total = totalDepoisDoAjuste({ emprestimo, pedido, juro });
  const faltaReceber = faltaReceberDoAjuste({
    pendentes: pendentesDaSerie(parcelas),
    jaRecebido: jaRecebidoDaSerie(parcelas),
    pedido,
    juro,
  });

  // O EMPRESTADO, E ELE VEM DA RESPOSTA DA FUNCAO. Ver E O `emprestado` SAI DE
  // `juro.principal` no cabecalho: e a decisao da HMO-478 sendo MEDIDA na tela,
  // e nao repetida por ela.
  //
  // OS TRES RAMOS SAO OS TRES DO `patchDoEmprestimo`, NA MESMA ORDEM, e o do
  // meio e o da HMO-479: sem juro e com `total` no pedido a rota grava
  // `principal = total`, entao o emprestado DEPOIS do ajuste e aquele `total` --
  // o mesmo que `totalDepoisDoAjuste` acabou de resolver, e nao um
  // `Number(pedido.total)` recalculado aqui (o arredondamento ao centavo mora
  // naquela funcao, e repeti-lo seria a segunda conta que divergiria na
  // primeira mudanca). Ver ...MAS HA UM TERCEIRO RAMO no cabecalho.
  const emprestado = juro
    ? juro.principal
    : pedido.total !== undefined
      ? total
      : Number(emprestimo.principal);

  const grandezas: GrandezaDaPrevia[] = [
    {
      chave: "emprestado",
      // PASSADO, e nao "Você empresta" como na criacao: o dinheiro ja saiu da
      // conta de investimento, e e justamente isso que o ajuste nao mexe.
      rotulo: "Você emprestou",
      valor: emReaisDaPrevia(emprestado),
    },
  ];

  if (juro) {
    grandezas.push({
      chave: "juros",
      rotulo: "Juros",
      valor: emReaisDaPrevia(juro.juros),
    });
    grandezas.push({
      chave: "taxa",
      rotulo: "Taxa do empréstimo",
      valor: emPercentoDaPrevia(juro.taxa),
    });
  }

  grandezas.push({
    chave: "total",
    rotulo: "Passa a valer",
    valor: emReaisDaPrevia(total),
  });

  grandezas.push({
    chave: "falta_receber",
    rotulo: "Falta receber",
    valor: emReaisDaPrevia(faltaReceber),
  });

  return grandezas;
}

/**
 * A FRASE DO EMPRESTADO -- o que o ajuste faz com o que saiu da conta (HMO-479).
 *
 * A previa acima mostra os NUMEROS; esta frase diz o que eles querem dizer, e e
 * o item 4 da issue com as palavras dela: "você continua tendo emprestado R$ X".
 * Sem ela a tela mostra "Você emprestou R$ 1.000,00" ao lado de "Passa a valer
 * R$ 1.300,00" e deixa a pergunta mais cara sem resposta -- *o 1.000 tambem
 * mudou?* --, que e justamente a decisao que a F7 tomou (o emprestado fica
 * parado, a taxa se move) e que nenhum rotulo de linha afirma.
 *
 * ELA E CONDICIONAL PORQUE O FATO E CONDICIONAL, E ESSE E O PONTO
 * --------------------------------------------------------------
 * "Você continua tendo emprestado" e FALSO no ramo sem juro com `total`: ali a
 * rota grava `principal = total` e o emprestado e exatamente o que muda. Uma
 * frase fixa no JSX seria uma mentira em um dos tres ramos -- e a mentira cairia
 * no ramo do conserto de digitacao, onde a pessoa esta mexendo no valor DE
 * PROPOSITO e seria informada de que ele nao vai mudar.
 *
 * Por isso os tres ramos devolvem tres coisas, e `null` e uma delas: o pedido
 * que so troca a descricao ou so adia o vencimento nao tem noticia sobre o
 * emprestado, e imprimir "continua tendo emprestado" ali seria responder uma
 * pergunta que ninguem fez -- ruido que ensina a ignorar a frase justamente
 * antes do ramo em que ela importa.
 *
 * E O NUMERO SAI DA PREVIA, NAO DE UMA SEGUNDA LEITURA. As duas tem de dizer o
 * mesmo R$: a frase e a linha `emprestado` lado a lado na mesma caixa, e um
 * `Number(emprestimo.principal)` aqui reintroduziria, so na frase, o defeito que
 * a HMO-479 acabou de tirar da linha.
 */
export function fraseDoEmprestadoNoAjuste(params: {
  emprestimo: {
    principal: number | string;
    interest_rate?: number | string | null;
  };
  parcelas: ParcelaParaAjustar[];
  pedido: PedidoDeAjuste;
}): string | null {
  const grandezas = previaDoAjuste(params);
  if (!grandezas) return null;

  const emprestado = grandezas.find((g) => g.chave === "emprestado");
  if (!emprestado) return null;

  // OS TRES RAMOS SAO OS DO `patchDoEmprestimo`, E A PERGUNTA E PELO JURO E PELO
  // PEDIDO -- nunca comparando o R$ formatado com o de hoje, porque dois ramos
  // diferentes podem dar o MESMO numero: `{total: 1000}` sobre um emprestimo de
  // 1.000 sem juro E um conserto (a rota grava `principal`), e uma comparacao de
  // strings leria "nao mudou" e devolveria a frase do ramo errado.
  const juro = juroDepoisDoAjuste({
    emprestimo: params.emprestimo,
    pedido: params.pedido,
  });

  if (juro) {
    return `Você continua tendo emprestado ${emprestado.valor} — o ajuste move a taxa, não o que saiu da sua conta.`;
  }

  if (params.pedido.total !== undefined) {
    return `Isto corrige o valor emprestado para ${emprestado.valor}.`;
  }

  // SO DESCRICAO E/OU VENCIMENTO: nenhuma noticia sobre o emprestado. Ver ELA E
  // CONDICIONAL no JSDoc -- a frase que nao informa nada ensina a ignorar a
  // frase, e o preco disso se paga nos dois ramos acima.
  return null;
}
