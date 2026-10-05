/**
 * O ELO EXPLICITO ENTRE A PREVISAO DIGITADA A MAO E A FATURA DO CARTAO
 * -- HMO-305 (o caminho 4 do plano da HMO-302, §3.4).
 *
 * ===========================================================================
 * O DEFEITO, E POR QUE ELE NAO SE CONSERTA SOZINHO
 * ===========================================================================
 * A pessoa anota "Pagar fatura Nubank, R$ 800, dia 10" na CONTA CORRENTE --
 * e assim que se anota uma fatura, porque e de la que o dinheiro sai. O app, do
 * outro lado, sintetiza a fatura ABERTA do cartao a partir das compras reais
 * (`sintetizarFaturasAbertas`, lib/agenda-do-cartao.ts). As duas sao a MESMA
 * divida de R$ 800,00, e o mes fecha em R$ 1.600,00 nas duas telas.
 *
 * As duas saidas automaticas foram avaliadas e RECUSADAS no plano, as duas por
 * errarem para BAIXO -- a direcao cara, porque esconde uma conta real:
 *
 *   1. de-duplicar por heuristica (mesma conta, mesmo mes, valor parecido)
 *      esconde uma divida de verdade de quem tem duas parecidas no mesmo mes;
 *   2. suprimir a fatura sintetizada quando existe previsao digitada e
 *      indetectavel de proposito -- a previsao esta na conta corrente, nao no
 *      cartao, entao nao ha elo nenhum para achar.
 *
 * ===========================================================================
 * O QUE ESTE ARQUIVO FAZ, E O QUE ELE NAO FAZ
 * ===========================================================================
 * Ele faz DUAS coisas, e nenhuma delas e aritmetica de dinheiro:
 *
 *   * `suspeitasDeFaturaRepetida` -- aponta a previsao que PODE ser a fatura, e
 *     QUAL fatura. E so um rotulo: nao soma, nao subtrai, nao esconde linha;
 *   * `notesDoElo` / `NOTES_SEM_ELO` -- o que a rota grava em `notes` quando a
 *     pessoa liga e quando ela desliga o elo.
 *
 * A DE-DUPLICACAO NAO ESTA AQUI, E ISSO E A ENTREGA. Quem de-duplica e
 * `sintetizarFaturasAbertas`, pela chave canonica que ela JA le
 * (`chavesPersistidas`) e que o `POST /api/card-invoices/close` JA grava desde a
 * HMO-227. Uma segunda implementacao da de-duplicacao seria a segunda fonte de
 * verdade sobre "esta fatura ja esta na agenda?", e as duas divergiriam em
 * silencio -- o numero da tela nao daria erro nenhum, so ficaria errado. Por
 * isso o elo e gravado na forma EXATA que aquela funcao reconhece, e nada mais.
 *
 * ===========================================================================
 * A UNICA MUDANCA DE DINHEIRO E INICIADA PELA PESSOA
 * ===========================================================================
 * Nenhuma linha deste arquivo muda numero nenhum. O rotulo acende, a pessoa
 * clica, a rota grava a chave, e a de-duplicacao que ja existia passa a
 * enxergar a fatura como "ja esta na agenda". O app nunca esconde uma conta por
 * conta propria -- e e por isso que `suspeitasDeFaturaRepetida` pode ser
 * conservadora sem custo: um rotulo que nao acende deixa o mes em R$ 1.600,00,
 * que e exatamente o estado de hoje.
 *
 * E E POR ISSO QUE DESFAZER NAO E OPCIONAL. Um elo errado erra na direcao
 * OPOSTA -- ele esconde uma conta de verdade, e a pessoa fecha o mes achando
 * que tem R$ 800 que nao tem. O caminho de volta (`NOTES_SEM_ELO`) e parte da
 * mesma entrega.
 *
 * ===========================================================================
 * O PRECO DE GRAVAR EM `notes`, DITO EM VOZ ALTA
 * ===========================================================================
 * `RE_CHAVE_FATURA` e ancorada nas duas pontas (lib/chave-da-fatura.ts), e o
 * comentario dela argumenta por que: sem o `$`, uma nota escrita a mao como
 * "fatura:2026-09-01:xxx paguei no debito" passaria por chave canonica e a
 * descricao livre da pessoa viraria regra de negocio. A consequencia aqui e
 * direta e nao tem jeito bonito: ligar o elo SUBSTITUI o texto que a pessoa
 * tinha escrito em `notes`, e desligar nao o traz de volta.
 *
 * As alternativas foram consideradas e sao piores:
 *
 *   * afrouxar a ancora da chave canonica poe texto livre dentro de uma chave
 *     de negocio -- o defeito que aquele comentario ja recusou;
 *   * uma coluna nova em `scheduled_transactions` seria uma migration, e
 *     migration vai para `main` sozinha neste repositorio: o elo ficaria
 *     esperando uma colagem no SQL Editor para existir.
 *
 * Entao o preco e pago na TELA: o cartao de confirmacao mostra a anotacao que
 * vai ser substituida, com o texto dela a vista. A `description` nao e tocada --
 * "Pagar fatura Nubank" continua sendo o nome da linha, que e o que a pessoa le
 * na lista.
 *
 * ===========================================================================
 * ARQUIVO-FOLHA, E ISSO E REQUISITO
 * ===========================================================================
 * O unico import e `@/lib/chave-da-fatura`, que tambem e folha. As duas telas
 * que precisam do rotulo estao nos dois lados de uma fronteira de compilacao:
 * `lib/telas-de-movimentacao.ts` e compilado por um tsconfig com
 * `rootDir: lib`, e um import para fora de `lib/` reprova com TS6059 (e o
 * mutante que nao compila "morre" por motivo errado, com o placar mentindo a
 * favor). E por isso que o rotulo de MES nao e montado aqui: `rotuloDaFatura`
 * mora em `lib/fatura-do-cartao.ts`, que importa `types/financial`. As frases
 * abaixo recebem o mes JA formatado de quem as chama.
 */
import { ehFatura, chaveFatura, faturaDaChave } from "@/lib/chave-da-fatura";

/**
 * A linha como as DUAS leituras a entregam -- a agenda gravada e a fatura
 * sintetizada na mesma lista.
 *
 * Tudo opcional menos `due_date` pela mesma razao de `LinhaPrevistaDoPapel`: a
 * fatura sintetizada nao tem `id` nem `notes` de banco, e a previsao gravada
 * nao tem `invoice_month`. Uma leitura que esqueca uma coluna tem de produzir
 * MENOS rotulo -- nunca um rotulo errado.
 */
export interface LinhaComEloPossivel {
  /** `scheduled_transactions.id`. Ausente/nulo e a fatura sintetizada. */
  id?: string | null;
  description?: string | null;
  /** Onde a chave canonica mora quando o elo existe. */
  notes?: string | null;
  group_id?: string | null;
  /** 'income' | 'expense' | 'transfer', da coluna `direction` do 027. */
  direction?: string | null;
  /**
   * O vencimento. OPCIONAL porque `PrevistaCrua` o declara assim, e a ausencia
   * dele nao abre porta nenhuma: `mesDaData(null)` e `""`, e `""` nunca e igual
   * ao mes de uma fatura aberta -- a fatura sem vencimento nem e sintetizada (ela
   * vira aviso em `semVencimento`). Linha sem data nao ganha rotulo, que e a
   * direcao barata.
   */
  due_date?: string | null;
  /** Da fatura sintetizada: o nome do cartao, que e o que a descricao cita. */
  account_name?: string | null;
}

/**
 * A fatura aberta que uma previsao digitada a mao PODE estar repetindo.
 *
 * `mes` e o `invoice_month` da fatura -- o mes DELA, nao o do vencimento da
 * previsao. Os dois podem ser diferentes (um cartao que fecha dia 28 e vence
 * dia 5 poe a fatura de marco vencendo em abril), e quem de-duplica compara a
 * chave: gravar o mes do vencimento produziria uma chave que `chavesPersistidas`
 * nao casa com nenhuma fatura, e o elo nao faria nada -- em silencio, com a tela
 * dizendo "pronto".
 */
export interface SuspeitaDeFatura {
  accountId: string;
  /** 'AAAA-MM-01' -- o mes da FATURA. */
  mes: string;
  nomeDoCartao: string | null;
  /**
   * O AVISO DA ANOTACAO QUE VAI EMBORA -- `null` quando nao ha nenhuma.
   *
   * Ele viaja DENTRO da suspeita, e nao como campo solto da linha, por duas
   * razoes. A primeira e que ele so tem sentido onde a suspeita existe: um campo
   * solto obrigaria toda linha da resposta a carregar o texto livre de `notes`,
   * que nenhuma tela mostra. A segunda e que ele e calculado onde o `notes`
   * esta a mao -- e e `avisoDaAnotacao` quem o escreve, num lugar so.
   */
  aviso: string | null;
}

/** 'AAAA-MM' de uma data ISO. Comparar mes nao e comparar dia. */
const mesDaData = (data: unknown): string => String(data ?? "").slice(0, 7);

/**
 * Sem acento, minusculo, quebrado em palavras.
 *
 * As tres linhas sao as mesmas de `lib/categorias.ts` e de
 * `lib/recurrence-detector.ts`, e estao copiadas de proposito: importar
 * qualquer um dos dois arrastaria o grafo deles para dentro do tsconfig das
 * suites que compilam este arquivo, e o preco de duas linhas duplicadas de
 * normalizacao de texto e menor que o de um arquivo-folha que deixa de ser
 * folha (ver o cabecalho).
 */
function palavras(texto: string | null | undefined): string[] {
  if (!texto) return [];
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * A descricao da previsao CITA o nome do cartao?
 *
 * E o unico elo que existe entre as duas linhas, e ele e textual porque nao ha
 * outro: a previsao esta na conta corrente e nao guarda referencia nenhuma ao
 * cartao (e essa ausencia e o defeito inteiro). "Pagar fatura Nubank" cita
 * "Nubank"; "Pagar cartao roxo" nao cita nada, e nao acende rotulo.
 *
 * A COMPARACAO E POR PALAVRA INTEIRA, e nao por `includes`. Com substring um
 * cartao chamado "Nu" casaria com "Numerario da viagem", e o rotulo apontaria
 * para a fatura errada -- onde um clique de confirmacao esconderia uma conta
 * real. Palavra inteira tambem e o que faz "nubank" casar com "NuBank" e com
 * "Nubank." sem uma lista de pontuacao.
 *
 * ERRAR PARA O LADO DE NAO ROTULAR E DE GRACA, e e esse o criterio desta
 * funcao. Um falso negativo deixa o mes em R$ 1.600,00 -- o estado de hoje, com
 * a conta a vista. Um falso positivo poe na tela um botao que, clicado, esconde
 * R$ 800 de divida verdadeira. As duas pontas da assimetria estao medidas na
 * suite (`scripts/test-elo-da-fatura.mjs`).
 */
export function descricaoCitaOCartao(
  descricao: string | null | undefined,
  nomeDoCartao: string | null | undefined
): boolean {
  const doCartao = palavras(nomeDoCartao);
  // Sem nome legivel nao ha o que citar. O nome vem de `financial_accounts`
  // pela view; falta dele e leitura incompleta, e leitura incompleta nao vira
  // afirmacao sobre a divida de ninguem.
  if (doCartao.length === 0) return false;

  // Um cartao chamado "C" ou "7" casaria com qualquer descricao que tivesse a
  // letra solta. A palavra inteira ja barra o caso do substring; isto barra o
  // nome que nao identifica nada.
  if (!doCartao.some((p) => p.length >= 3)) return false;

  const daDescricao: { [palavra: string]: true } = {};
  for (const p of palavras(descricao)) daDescricao[p] = true;

  return doCartao.every((p) => daDescricao[p] === true);
}

/**
 * QUAIS PREVISOES GRAVADAS PODEM SER A FATURA DE UM CARTAO -- o rotulo.
 *
 * Recebe a lista JA montada pela rota: a agenda gravada (sem as compras no
 * cartao, que `agendaSemCompraNoCartao` tirou) MAIS as faturas sintetizadas.
 * Nao faz consulta nenhuma e nao precisa de insumo novo -- as duas metades do
 * defeito ja estao na mesma lista, e e isso que torna este rotulo honesto: ele
 * fala da MESMA lista que produziu o numero da tela.
 *
 * Devolve `id da previsao -> a fatura suspeita`. Mapa VAZIO e a resposta certa
 * para o mes sem cartao, para o mes em que o elo ja existe, e para toda duvida.
 *
 * AS QUATRO PENEIRAS, E CADA UMA ESTA FECHANDO UMA PORTA DIFERENTE:
 *
 *   1. a linha tem de ser GRAVADA (`id`). A fatura sintetizada nao e suspeita
 *      de ser a si mesma, e `id` e exatamente como o resto do modulo decide
 *      isso (`LinhaDaTela.gravada`, `LinhaDoDetalhe.gravada`);
 *   2. ela NAO pode ja ter o elo (`ehFatura(notes)`). E daqui que sai a
 *      propriedade que a issue pede -- "o rotulo some quando o elo existe" --, e
 *      ela sai de graca: a linha com a chave JA e uma fatura para o resto do
 *      app;
 *   3. conta de GRUPO nao e fatura de cartao. A despesa de grupo tem rateio
 *      proprio e o `valor` que a tela mostra ja e uma fracao; chamar aquilo de
 *      fatura do meu cartao seria o rotulo errado sobre o numero errado;
 *   4. RECEITA nao e fatura. `direction` ausente nao bloqueia (a fatura
 *      sintetizada e sempre 'expense' e a view do 027 termina em 'expense'),
 *      mas 'income' explicito bloqueia -- um salario que por acaso citasse o
 *      nome do cartao nao pode ganhar botao de esconder divida.
 *
 * E A QUINTA, QUE E A QUE DECIDE: `candidatas.length !== 1`. Duas faturas
 * abertas no mesmo mes cujos nomes a mesma descricao cita (um "Nubank" e um
 * "Nubank Ultravioleta", com a descricao citando os dois) nao viram rotulo. Com
 * ambiguidade, escolher uma seria escolher no lugar da pessoa justamente no caso
 * em que ela e a unica que sabe -- e o clique seguinte esconde dinheiro.
 */
export function suspeitasDeFaturaRepetida(
  linhas: readonly LinhaComEloPossivel[]
): Map<string, SuspeitaDeFatura> {
  const suspeitas = new Map<string, SuspeitaDeFatura>();

  // AS FATURAS ABERTAS DA LISTA, RECONHECIDAS PELA CHAVE QUE ELAS JA CARREGAM.
  //
  // `faturaDaChave(notes)` e nao `invoice_month` + `account_id`, e a razao e que
  // as duas telas montam a lista com tipos diferentes: o painel recebe a
  // `FaturaPrevista` inteira, a tela de Despesas recebe a `PrevistaCrua`, e o
  // unico campo que as DUAS tem e `notes` -- porque a fatura sintetizada nasce
  // com a chave canonica la dentro (`sintetizarFaturasAbertas`). Ler a chave
  // tambem fecha a porta de gravar o mes errado: o `mes` que vai para o `notes`
  // da previsao e, literalmente, o mes que a propria fatura ja declarou.
  //
  // `!gravada` E LOAD-BEARING, e o caso que ele deixa de fora e proposital: uma
  // fatura FECHADA e uma linha de agenda de verdade, com a mesma chave. Ligar
  // uma previsao digitada a ela criaria DUAS linhas com a mesma chave, e nao ha
  // fatura sintetizada para suprimir -- o mes continuaria dobrado, com a tela
  // dizendo "pronto". Quem recusa esse caso e a rota, que verifica se a chave ja
  // esta tomada antes de gravar; aqui ele simplesmente nao acende rotulo.
  //
  // `mesDoVencimento` e o que se compara com a previsao (a pessoa anota o DIA DE
  // PAGAR), e `mes` e o que vai para a chave. Os dois saem da MESMA linha --
  // separados, um cartao que fecha dia 28 e vence dia 5 ja seria o bug.
  const abertas: {
    accountId: string;
    mes: string;
    nomeDoCartao: string | null;
    mesDoVencimento: string;
  }[] = [];

  for (const linha of linhas) {
    const gravada = typeof linha.id === "string" && linha.id !== "";
    if (gravada) continue;

    const daChave = faturaDaChave(linha.notes);
    if (!daChave) continue;

    abertas.push({
      accountId: daChave.accountId,
      mes: daChave.mes,
      nomeDoCartao: linha.account_name?.trim() || null,
      mesDoVencimento: mesDaData(linha.due_date),
    });
  }

  if (abertas.length === 0) return suspeitas;

  for (const linha of linhas) {
    const id = typeof linha.id === "string" && linha.id !== "" ? linha.id : null;
    if (!id) continue;
    if (ehFatura(linha.notes)) continue;
    if (linha.group_id != null) continue;
    if (linha.direction === "income") continue;

    const mes = mesDaData(linha.due_date);
    const candidatas = abertas.filter(
      (f) =>
        f.mesDoVencimento === mes &&
        descricaoCitaOCartao(linha.description, f.nomeDoCartao)
    );

    if (candidatas.length !== 1) continue;

    const f = candidatas[0];
    suspeitas.set(id, {
      accountId: f.accountId,
      mes: f.mes,
      nomeDoCartao: f.nomeDoCartao,
      aviso: avisoDaAnotacao(linha.notes),
    });
  }

  return suspeitas;
}

/**
 * O ELO QUE A PESSOA PODE DESFAZER -- a outra metade da entrega.
 *
 * Desfazer nao e opcional e nao e cortesia: um elo errado erra na direcao
 * OPOSTA ao defeito. Ele esconde uma conta de verdade, e a pessoa fecha o mes
 * achando que tem R$ 800 que nao tem. Se o caminho de volta nao estivesse na
 * tela, o unico jeito de sair daquele estado seria editar o campo de anotacoes
 * e apagar uma string que ninguem explicou.
 *
 * E AQUI ESTA A DISTINCAO QUE DECIDE A FUNCAO: `notes` com a chave canonica
 * descreve DUAS linhas diferentes, e so uma delas pode ser desfeita aqui:
 *
 *   * a FATURA FECHADA, criada pelo `POST /api/card-invoices/close`. A chave
 *     dela e o que torna o fechamento idempotente -- apagar aquilo faz um
 *     segundo clique em "fechar fatura" criar uma SEGUNDA conta a pagar do mesmo
 *     mes. O `close` grava `account_id` = o PROPRIO CARTAO, de proposito ("esta
 *     conta a pagar pertence ao cartao");
 *   * a previsao DIGITADA A MAO que alguem ligou, cujo `account_id` e a conta de
 *     onde o dinheiro sai -- nunca o cartao, porque previsao lancada no cartao
 *     nem aparece na agenda (`agendaSemCompraNoCartao` a tira).
 *
 * O criterio e esse, e ele e o MESMO que o `DELETE` da rota aplica. Dois
 * criterios para "esta linha e a fatura fechada?" dariam uma tela que oferece um
 * botao que a rota recusa -- ou, pior, uma rota que aceita o que a tela
 * escondeu.
 *
 * `null` tambem quando falta `accountIdDaLinha`: sem ele nao da para distinguir
 * as duas linhas acima, e a resposta segura e nao oferecer o desfazer (a pessoa
 * ainda tem a edicao da linha). Oferecer e deixar a rota recusar poria na tela um
 * botao que falha -- o modo de falha que `posso_editar` existe para evitar.
 */
export function eloDesfazivel(
  notes: string | null | undefined,
  accountIdDaLinha: string | null | undefined,
  gravada: boolean
): { accountId: string; mes: string } | null {
  if (!gravada) return null;

  const daChave = faturaDaChave(notes);
  if (!daChave) return null;

  const daLinha = accountIdDaLinha ?? null;
  if (!daLinha) return null;
  if (daLinha === daChave.accountId) return null;

  return daChave;
}

/**
 * O que a rota grava em `notes` quando a pessoa LIGA o elo.
 *
 * E `chaveFatura` e nada mais -- nenhum sufixo, nenhum prefixo, nenhum texto da
 * pessoa junto. A funcao existe para que o CHAMADOR nao precise saber disso: o
 * dia em que alguem concatenar " (confirmado)" aqui, `RE_CHAVE_FATURA` para de
 * casar, a de-duplicacao para de acontecer e a tela volta a somar R$ 1.600,00
 * sem erro nenhum. Esse e o modo de falha que esta indirecao de uma linha
 * compra, e a suite mede exatamente ele.
 */
export function notesDoElo(mes: string, accountId: string): string {
  return chaveFatura(mes, accountId);
}

/**
 * O que a rota grava em `notes` quando a pessoa DESFAZ o elo.
 *
 * `null` e nao string vazia: `faturaDaChave` responde `null` para os dois, mas
 * `notes` vazio e um texto que a pessoa nunca escreveu, e ele aparece em tela de
 * edicao como um campo "preenchido com nada". O que ela escreveu antes nao volta
 * -- ver o cabecalho --, e a tela diz isso ANTES de ligar, nao depois.
 */
export const NOTES_SEM_ELO = null;

// ---------------------------------------------------------------------------
// AS FRASES
// ---------------------------------------------------------------------------
// Elas moram aqui, e nao no componente, porque as DUAS telas (o painel do modo
// e a tela de Despesas) dizem a mesma coisa sobre a mesma linha. Dois textos
// para a mesma pergunta divergem na primeira revisao de copy, e a divergencia
// aparece como "o app me disse duas coisas diferentes sobre o mesmo botao".
//
// O MES CHEGA JA FORMATADO ("março de 2026"), de `rotuloDaFatura`
// (lib/fatura-do-cartao.ts). Ver o cabecalho: este arquivo nao pode importar
// aquele. Mes ilegivel chega `null` e as frases caem no texto sem mes, em vez de
// escreverem "a fatura de undefined".

/** O rotulo curto, na propria linha da lista. */
export const ROTULO_DE_SUSPEITA = "pode ser a mesma dívida da fatura";

/** O titulo da acao que liga o elo. */
export const ROTULO_DE_LIGAR = "é a fatura deste cartão";

/** O titulo da acao que desfaz. */
export const ROTULO_DE_DESLIGAR = "desfazer o elo com a fatura";

/** O nome do cartao, ou o substantivo quando a leitura nao trouxe o nome. */
function cartao(nomeDoCartao: string | null | undefined): string {
  return nomeDoCartao?.trim() || "do cartão";
}

/**
 * A pergunta do cartao de confirmacao -- "esta previsao e a fatura do Nubank de
 * marco de 2026?".
 *
 * E a frase da issue, quase literal, e e deliberado: ela e a unica coisa na tela
 * que diz QUAL fatura o clique vai casar com esta previsao.
 */
export function perguntaDoElo(
  nomeDoCartao: string | null | undefined,
  rotuloDoMes: string | null | undefined
): string {
  const nome = cartao(nomeDoCartao);
  if (!rotuloDoMes) return `Esta previsão é a fatura ${nome}?`;
  return `Esta previsão é a fatura ${nome} de ${rotuloDoMes}?`;
}

/**
 * O QUE VAI ACONTECER COM O NUMERO, antes de a pessoa clicar.
 *
 * O valor chega JA FORMATADO da tela (cada uma tem o seu `moeda`), e esta funcao
 * nao faz conta nenhuma -- de proposito. Prometer o total DEPOIS exigiria somar
 * aqui o que a rota soma la, e essa segunda aritmetica e exatamente o que esta
 * issue existe para nao escrever: a de-duplicacao de verdade acontece em
 * `sintetizarFaturasAbertas`, na proxima leitura. O que a frase afirma e o
 * MECANISMO ("deixa de ser contada de novo") e a GRANDEZA ("cai esse valor"),
 * que e uma subtracao que a propria tela ja mostra nas duas linhas.
 *
 * `null` quando a tela nao achou a linha da fatura aberta na lista que ela mesma
 * recebeu. A frase sai sem numero em vez de sair com um numero inventado: o
 * cartao de confirmacao e o lugar onde um valor errado custa mais caro.
 *
 * "a dívida continua na lista" e a parte que nao pode faltar. Sem ela, o cartao
 * esta dizendo a uma pessoa que o app vai apagar R$ 800 que ela deve.
 */
export function efeitoDoElo(valorDaFaturaFormatado: string | null): string {
  if (!valorDaFaturaFormatado) {
    return (
      "A fatura aberta deste cartão deixa de ser contada de novo. A dívida " +
      "continua na lista, nesta linha."
    );
  }
  return (
    `A fatura aberta de ${valorDaFaturaFormatado} deixa de ser contada de ` +
    `novo: o total do mês cai esse valor. A dívida continua na lista, nesta ` +
    `linha.`
  );
}

/**
 * O AVISO DA ANOTACAO QUE VAI EMBORA -- so quando ha uma.
 *
 * `null` quando `notes` esta vazio ou quando ja e uma chave: nos dois casos nao
 * ha texto de ninguem para perder, e um aviso que aparece sempre e um aviso que
 * ninguem le. O texto da pessoa vai ENTRE ASPAS na frase, porque "sua anotação
 * será substituída" sem mostrar qual deixa a decisao sem o dado que a informa.
 */
export function avisoDaAnotacao(
  notes: string | null | undefined
): string | null {
  const texto = notes?.trim();
  if (!texto) return null;
  if (ehFatura(texto)) return null;
  return (
    `A anotação «${texto}» será substituída pelo elo, e desfazer não a traz ` +
    `de volta. A descrição da linha não muda.`
  );
}

/**
 * A frase do desfazer.
 *
 * Ela diz o numero de VOLTA pelo mesmo motivo que a de ir: desfazer tambem mexe
 * em dinheiro na tela, so que para cima. "Volta a aparecer" e a parte que
 * importa -- a fatura nao e criada de novo, ela nunca deixou de existir.
 */
export function efeitoDoDesfazer(
  valorDaPrevisaoFormatado: string | null
): string {
  if (!valorDaPrevisaoFormatado) {
    return (
      "A fatura aberta deste cartão volta a aparecer como linha própria, e o " +
      "total do mês sobe de novo — a mesma dívida em dois lugares."
    );
  }
  return (
    `A fatura aberta deste cartão volta a aparecer como linha própria: o ` +
    `total do mês sobe ${valorDaPrevisaoFormatado} e a mesma dívida fica em ` +
    `dois lugares outra vez.`
  );
}
