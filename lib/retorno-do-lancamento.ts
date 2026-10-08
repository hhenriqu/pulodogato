// ---------------------------------------------------------------------------
// PARA ONDE O LANCAMENTO VOLTA, E O QUE SOBREVIVE A "SALVAR E CONTINUAR"
// ---------------------------------------------------------------------------
// "Apos lancar uma despesa seja ela qual for, devemos ser redirecionados para a
// tela da qual estavamos. e ter um checkbox ou switch button para ativar o
// 'Salvar e continuar' ele se mantem na tela para lancar uma nova conta."
// (HMO-249)
//
// Antes desta issue as tres telas de lancamento terminavam em
// `router.push("/dashboard/personal-finance")` -- uma string fixa, escrita tres
// vezes. Quem abria "Nova Despesa" a partir de `/dashboard/despesas`, de
// `/dashboard/cartoes/<id>` ou da aba de um grupo era despejado numa QUARTA
// tela, e tinha de refazer o caminho (inclusive o `?de=&ate=` do periodo, que
// se perdia) para ver o que acabou de lancar.
//
// AS DUAS DECISOES QUE MORAM AQUI, E POR QUE SAO FUNCOES PURAS
// ------------------------------------------------------------
// 1. `origemSegura` -- o `?origem=` vem da URL, ou seja, do lado de fora.
//    Empurrar para ele sem conferir e um redirecionamento aberto: um link
//    `...despesa?origem=https://golpe.example` faria o proprio app levar a
//    pessoa para fora logo DEPOIS de ela confirmar um lancamento, que e o
//    instante em que ela mais confia na tela. Por isso a peneira e uma lista de
//    permissao (`/dashboard/...`), nao uma lista de proibicao.
//
// 2. `proximoLancamento` -- o que o formulario guarda e o que ele limpa quando
//    "Salvar e continuar" esta ligado. Limpar de menos custa dinheiro: com
//    `valor` e `descricao` ainda preenchidos, UM segundo clique em Salvar grava
//    o mesmo gasto de novo, e nada na tela diria que foram dois. Limpar demais
//    torna a opcao inutil -- ela existe para lancar varias contas do mesmo
//    grupo/categoria em sequencia.
//
// Este modulo nao importa nada em tempo de execucao (so o TIPO de
// `./lancamento`, que o emit apaga), para `npm run test:retorno-lancamento`
// poder compila-lo sozinho.
// ---------------------------------------------------------------------------

import type { ValoresDeLancamento } from "./lancamento";

/**
 * O nome do parametro que carrega a tela de origem.
 *
 * Exportado para que quem escreve o link e quem o le usem a MESMA string: duas
 * constantes iguais divergem na primeira renomeacao, e o sintoma seria o
 * formulario voltando para `/dashboard/personal-finance` como antes -- um
 * comportamento que ja existia, ou seja, uma regressao que nao parece bug.
 */
export const PARAM_DE_ORIGEM = "origem";

/**
 * Para onde se volta quando ninguem disse de onde veio.
 *
 * E a lista de lancamentos, que e o destino que as tres telas usavam antes desta
 * issue: sem `?origem=` o comportamento fica exatamente o de antes, e nenhum
 * link antigo (ha varios, inclusive em e-mail de aviso) muda de significado.
 */
export const ROTA_PADRAO_DE_RETORNO = "/dashboard/personal-finance";

/**
 * As proprias telas de lancamento.
 *
 * Elas sao recusadas como origem de proposito. Um `?origem=` apontando para a
 * tela de despesa faria o "Salvar" fechar o modal e ABRIR O MESMO MODAL de novo,
 * em cima de um formulario limpo -- indistinguivel de "o botao nao fez nada",
 * com o lancamento ja gravado. Vale tambem para o X e para o Cancelar.
 */
export const ROTAS_DE_LANCAMENTO = [
  "/dashboard/movimentacoes/despesa",
  "/dashboard/movimentacoes/receita",
  "/dashboard/movimentacoes/transferencia",
] as const;

/** URL mais comprida que isso nao e tela de origem, e nao vale carregar. */
const LIMITE_DA_ORIGEM = 512;

/**
 * O `?origem=` e um caminho interno para onde se pode empurrar?
 *
 * Devolve o caminho (com a query, que importa: `/dashboard/despesas?de=...&ate=...`
 * e o periodo escolhido, e voltar sem ele joga a pessoa em outro mes) ou `null`
 * quando nao da para confiar.
 *
 * O QUE E RECUSADO, E POR QUE CADA UM
 * -----------------------------------
 *   https://golpe.example   -> host de fora. O caso que esta funcao existe para
 *                              fechar.
 *   //golpe.example         -> MESMO caso, e o mais facil de deixar passar: ele
 *                              comeca com `/`, entao uma guarda ingenua
 *                              (`startsWith("/")`) aprova, e o navegador trata
 *                              como protocolo-relativo -- vai para o host de
 *                              fora do mesmo jeito. Quem o recusa aqui e a LISTA
 *                              DE PERMISSAO, e nao uma guarda propria -- o
 *                              porque esta no corpo da funcao.
 *   /\golpe.example         -> a mesma coisa com barra invertida, que Chrome e
 *                              Firefox normalizam para `//`.
 *   /api/...                -> rota interna, mas nao e tela: a pessoa receberia
 *                              JSON na cara depois de salvar.
 *   /login                  -> interna e e tela, mas nao e do dashboard; voltar
 *                              para o login depois de lancar se le como "fui
 *                              desconectado" e o lancamento parece perdido.
 *   /dashboard/movimentacoes/despesa -> ver `ROTAS_DE_LANCAMENTO`.
 *
 * `/dashboardfalso` tambem e recusada: a comparacao exige `/dashboard` seguido
 * de `/`, `?`, `#` ou fim. `startsWith("/dashboard")` sozinho aprovaria um
 * caminho de outro app montado no mesmo dominio.
 */
export function origemSegura(bruta: string | null | undefined): string | null {
  if (!bruta) return null;

  const crua = bruta.trim();
  if (!crua || crua.length > LIMITE_DA_ORIGEM) return null;

  // Caractere de controle (inclusive `\n` e `\t`) e espaco: nenhum tem o que
  // fazer num caminho, e `\n` no meio de uma URL e o truque classico para
  // escapar de uma peneira que compara so o comeco da string.
  //
  // O teste e feito por codigo, e nao por classe de regex: `\s` nao cobre o
  // `\x00`, e o nome da classe muda de significado entre motores.
  for (const caractere of crua) {
    const codigo = caractere.codePointAt(0) ?? 0;
    if (codigo <= 0x20 || codigo === 0x7f) return null;
  }

  if (!crua.startsWith("/")) return null;

  // Onde o caminho termina e a query/fragmento comeca.
  const fimDoCaminho = crua.search(/[?#]/);
  const caminho = fimDoCaminho === -1 ? crua : crua.slice(0, fimDoCaminho);

  // A LISTA DE PERMISSAO, E POR QUE ELA SOZINHA BASTA
  // -------------------------------------------------
  // A primeira versao disto tinha, logo acima, uma guarda separada contra
  // protocolo-relativo (`crua.startsWith("//") || crua.startsWith("/\\")`).
  // Ela saiu porque o mutante que a apagava SOBREVIVEU a suite -- e o mutante
  // estava certo: a guarda era inalcancavel. Nenhuma URL protocolo-relativa
  // pode passar por esta comparacao, porque ela exige que o caractere de indice
  // 1 seja `d` (de `/dashboard`), e protocolo-relativo exige que ele seja `/` ou
  // `\`. As duas condicoes nao podem ser verdadeiras ao mesmo tempo.
  //
  // Vale registrar a direcao do raciocinio: nao foi "a guarda e redundante,
  // entao tire", foi "nenhum teste consegue ver a diferenca, entao ou ela nao
  // faz nada ou falta um teste". Deixar as duas seria pior do que parece --
  // duas guardas para o mesmo caso, uma delas sem teste possivel, e quem
  // mexesse na lista de permissao amanha teria a impressao de que o
  // protocolo-relativo continua coberto pela outra. Ver os casos
  // "host de fora e RECUSADO" em scripts/test-retorno-do-lancamento.mjs: eles
  // continuam la, e e ESTA linha que os faz passar.
  //
  // `caminho !== "/dashboard"` cobre o painel inicial, que nao tem barra no
  // fim. E a exigencia da barra e o que recusa `/dashboardfalso`:
  // `startsWith("/dashboard")` sozinho -- o jeito obvio de escrever isto --
  // aprovaria um caminho de outro app montado no mesmo dominio.
  if (caminho !== "/dashboard" && !caminho.startsWith("/dashboard/")) {
    return null;
  }

  if ((ROTAS_DE_LANCAMENTO as readonly string[]).includes(caminho)) {
    return null;
  }

  return crua;
}

/**
 * Monta o link de "Nova Despesa" / "Nova Receita" / "Nova Transferencia"
 * carregando a tela de onde a pessoa clicou.
 *
 * `rota` pode JA ter query (`...despesa?cartao=<id>`, de "Lancar gasto neste
 * cartao"): por isso o separador e decidido aqui e nao na mao de quem chama --
 * um `?` a mais transformaria o `origem` em parte do valor de `cartao`, e o
 * cartao travado sumiria do formulario sem nenhum erro.
 *
 * O TIPO DE RETORNO, E POR QUE ELE NAO TEM UM RAMO COM `&`
 * ---------------------------------------------------------
 * `next.config.js` liga `typedRoutes`: `href` passa a aceitar so rota
 * conhecida, e uma funcao que devolve `string` nao e atribuivel (o mesmo
 * cuidado de `lib/fatura-do-cartao.ts`).
 *
 * A primeira versao declarava `R | \`${R}?${string}\` | \`${R}&${string}\``, o
 * que descreve o runtime com exatidao e NAO COMPILA:
 *
 *     Type '`/dashboard/movimentacoes/receita&${string}`' is not assignable
 *     to type 'UrlObject | RouteImpl<...>'
 *
 * O ramo com `&` e uma rota invalida quando `rota` nao tem query -- e o tipo
 * nao sabe se tem. O `Route` do Next infere o caminho ATE O PRIMEIRO `?`,
 * entao `\`${R}?${string}\`` cobre os dois casos reais: sem query vira
 * `...receita?origem=x`, e com query (`...despesa?cartao=abc`) o tipo vira
 * `...despesa?cartao=abc?${string}`, cujo caminho inferido continua sendo
 * `/dashboard/movimentacoes/despesa`. O `as` no ramo do `&` existe por isso, e
 * nao por preguica: o VALOR esta certo (`rota` ja tem `?`), e so a forma do
 * tipo que precisa ser a que o Next sabe validar.
 *
 * Vale registrar que `tsc --noEmit` NAO pega esse erro: a tipagem das rotas
 * vive em `.next/types`, que so existe depois de um `next build`.
 */
export function comOrigem<R extends string>(
  rota: R,
  origem: string | null | undefined
): R | `${R}?${string}` {
  const segura = origemSegura(origem);
  if (!segura) return rota;

  const valor = `${PARAM_DE_ORIGEM}=${encodeURIComponent(segura)}`;
  return rota.includes("?")
    ? (`${rota}&${valor}` as `${R}?${string}`)
    : (`${rota}?${valor}` as `${R}?${string}`);
}

/**
 * Para onde ir depois de uma gravacao que deu certo.
 *
 * `null` quer dizer FICAR: e o "Salvar e continuar" ligado, e quem decide o
 * estado do formulario nesse caso e `proximoLancamento`.
 *
 * `fallback` existe porque nem todo destino padrao e a lista de lancamentos. A
 * transferencia mensal termina em `/dashboard/bills` ("Confirme cada mes em
 * Contas Previstas"), e trocar isso por `personal-finance` mandaria a pessoa
 * para uma tela onde a regra que ela acabou de criar NAO aparece -- ela
 * concluiria que nao salvou. A origem explicita vence o fallback: quem clicou em
 * "Nova Transferencia" dentro de uma tela pediu para voltar para ela.
 */
export function destinoDepoisDeSalvar(opcoes: {
  origem: string | null | undefined;
  fallback?: string;
  continuar: boolean;
}): string | null {
  if (opcoes.continuar) return null;
  return (
    origemSegura(opcoes.origem) ??
    opcoes.fallback ??
    ROTA_PADRAO_DE_RETORNO
  );
}

/**
 * O estado do formulario para a PROXIMA conta, com "Salvar e continuar" ligado.
 *
 * `inicial` e `valoresIniciais()`, passado de fora: este modulo nao importa
 * `lib/lancamento.ts` em tempo de execucao (ver o cabecalho), e o campo limpo
 * precisa ser o MESMO que a tela usa ao abrir -- escrever `""` aqui divergiria
 * de `totalDeParcelas: "1"` no dia em que o padrao mudasse.
 *
 * O QUE E LIMPO, UM POR UM
 * ------------------------
 *   descricao, valor, notas  identificam ESTE lancamento. O `valor` e o que
 *                            impede o duplo-clique de gravar o mesmo gasto duas
 *                            vezes: sem valor, `validarLancamento` recusa o
 *                            segundo envio em vez de aceita-lo em silencio.
 *   parcelado + os tres       uma serie parcelada e uma decisao de UMA compra.
 *   campos dela              Carregada para a conta seguinte, ela criaria uma
 *                            SEGUNDA serie de 10x sem ninguem ter pedido --
 *                            dinheiro em dobro espalhado por dez faturas, que e
 *                            exatamente o erro que ninguem percebe no mes.
 *
 * O QUE SOBREVIVE, E POR QUE
 * --------------------------
 * Categoria, subcategoria, conta, data, previsao, natureza, moeda/cotacao,
 * grupo e rateio ficam. E para isso que a opcao existe: lancar as cinco contas
 * da viagem, todas no mesmo grupo e na mesma categoria, sem reescolher nada.
 * Limpar a categoria faria a segunda conta cair na primeira categoria da lista
 * ou em nenhuma -- mais caro do que mante-la, porque a pessoa VE a categoria na
 * tela e nao ve o rateio que ela nao conferiu.
 */
export function proximoLancamento(
  valores: ValoresDeLancamento,
  inicial: ValoresDeLancamento
): ValoresDeLancamento {
  return {
    ...valores,
    descricao: inicial.descricao,
    valor: inicial.valor,
    notas: inicial.notas,
    parcelado: inicial.parcelado,
    baseDoValorParcelado: inicial.baseDoValorParcelado,
    parcelaAtual: inicial.parcelaAtual,
    totalDeParcelas: inicial.totalDeParcelas,
  };
}

/**
 * O mesmo para a transferencia, que tem outro formulario e outro estado.
 *
 * Aqui `valor` e `descricao` sao limpos pelo mesmo motivo, e origem/destino/data
 * ficam: a transferencia repetida e justamente "mandei tres Pix da conta A para
 * a conta B hoje". `diaDeVencimento`, `duracao` e `mesesDeRepeticao` tambem
 * ficam, porque eles so valem quando a natureza e fixa -- e a natureza fica.
 */
export function proximaTransferencia<
  V extends { descricao: string; valor: string; notas: string }
>(valores: V, inicial: V): V {
  return {
    ...valores,
    descricao: inicial.descricao,
    valor: inicial.valor,
    notas: inicial.notas,
  };
}

/**
 * O mesmo para a movimentacao de carteira -- compra, venda e provento de
 * investimento (HMO-252).
 *
 * POR QUE AQUI DOI MAIS DO QUE NAS OUTRAS DUAS
 * --------------------------------------------
 * Nas duas de cima, gravar o mesmo lancamento duas vezes erra o TOTAL do mes --
 * uma linha repetida na lista, visivel para quem olha. Aqui o lancamento
 * repetido entra na conta do PRECO MEDIO do ativo, que `lib/investments.ts`
 * calcula sobre as movimentacoes: uma segunda compra de 100 PETR4 a R$ 31,50
 * nao soma uma linha estranha, ela MOVE o preco medio -- e com ele o lucro, o
 * prejuizo e a rentabilidade exibidos daquele ativo. A pessoa nao tem como
 * notar olhando a lista, porque o numero errado parece um numero.
 *
 * O QUE E LIMPO
 * -------------
 *   quantidade  o campo que o navegador exige (`required`): sem ele, o segundo
 *   e preco     clique em "Lançar" nao envia nada em vez de enviar de novo.
 *               Sao os dois fatores do valor da operacao -- deixar UM na tela
 *               ja bastaria para o segundo envio passar.
 *   taxas       a corretagem e desta operacao. Carregada para a seguinte, ela
 *               soma uma taxa fantasma ao custo -- que e preco medio errado
 *               outra vez, pelo outro lado.
 *
 * O QUE SOBREVIVE
 * ---------------
 * Ativo, tipo de movimentacao e data. E exatamente o caso que a opcao existe
 * para servir: por a carteira em dia e lancar os proventos do mes de um ativo,
 * ou as tres compras do mesmo papel, sem reescolher o ativo a cada volta.
 */
export function proximaMovimentacaoDeCarteira<
  V extends { quantidade: string; preco: string; taxas: string }
>(valores: V, inicial: V): V {
  return {
    ...valores,
    quantidade: inicial.quantidade,
    preco: inicial.preco,
    taxas: inicial.taxas,
  };
}

/**
 * O mesmo para a despesa de um GRUPO -- "Adicionar Nova Despesa" em
 * `/dashboard/expense-groups/[groupId]` (HMO-251).
 *
 * Os campos sao em ingles porque o estado daquele formulario e em ingles
 * (`expenseForm`, que vai quase direto para o corpo do POST). Nao vale
 * traduzi-los aqui so por simetria com as funcoes de cima: o `...valores`
 * carrega o resto do estado, e um nome traduzido viraria um campo NOVO no
 * objeto devolvido, deixando o original intacto -- isto e, o reset passaria a
 * nao resetar nada, calado.
 *
 * POR QUE AQUI DOI MAIS DO QUE NAS TRES DE CIMA
 * ---------------------------------------------
 * Nas outras, o lancamento repetido erra o dinheiro de QUEM DIGITOU. Aqui nao:
 * a despesa de grupo e rateada entre os participantes por um trigger do banco
 * (`group_expense_splits` -- ver a divisao automatica da migration 042), entao
 * um segundo clique em "Adicionar Despesa" cobra de OUTRAS PESSOAS uma conta que
 * nunca existiu. Elas nao tem como desconfiar: no extrato do grupo a linha
 * duplicada e indistinguivel de duas contas iguais no mesmo dia, que num jantar
 * de viagem e plausivel. O acerto do mes sai errado para todo mundo.
 *
 * O QUE E LIMPO
 * -------------
 *   description  identifica ESTA despesa. Herdada, a conta seguinte e gravada
 *                com o nome da anterior se a pessoa so trocar o valor.
 *   amount       o campo que barra o reenvio: `handleAddExpense` recusa sem
 *                descricao ou sem valor, entao com ele limpo o segundo clique
 *                nao envia nada em vez de enviar de novo. E ele tambem que
 *                esconde o painel de sugestoes de divisao, que so aparece com
 *                `amount > 0` -- ver abaixo.
 *   notes        a observacao e daquela despesa ("mesa de 4").
 *
 * O QUE SOBREVIVE, E POR QUE
 * --------------------------
 * `category_id`, `transaction_date`, `currency`, `cotacao` e `split_type`. E
 * exatamente o caso que a opcao serve: lancar as cinco contas da viagem, todas
 * na mesma categoria, no mesmo dia e na moeda da viagem, sem reescolher nada. A
 * cotacao fica junto com a moeda e a data porque ela e a cotacao DAQUELE DIA
 * naquela moeda -- continua sendo a taxa certa para a despesa seguinte, e
 * limpa-la faria `CampoDeCotacao` buscar de novo o mesmo numero.
 *
 * `split_type` fica, mas a SUGESTAO ESCOLHIDA nao -- e ela nao mora neste
 * objeto, e sim num estado separado da tela, que quem chama limpa junto. Os dois
 * tem de andar assim, e por um motivo de dinheiro: a sugestao carrega o valor
 * ABSOLUTO de cada participante (R$ 120,00 para a Ana, R$ 120,00 para o Bruno),
 * calculado sobre o total da despesa ANTERIOR. Reaproveitada numa despesa de
 * outro valor, ela nao erra o rateio por pouco -- ela rateia o numero errado, e
 * a diferenca vai para a conta dos outros.
 *
 * Com a sugestao limpa, o `split_type` sobrevivente faz a tela PEDIR a divisao
 * de novo ("Escolha uma das divisões sugeridas abaixo") em vez de cair em partes
 * IGUAIS caladas, que e o defeito oposto e o pior dos dois: uma divisao
 * silenciosamente errada parece ter funcionado.
 */
export function proximaDespesaDeGrupo<
  V extends { description: string; amount: string; notes: string }
>(valores: V, inicial: V): V {
  return {
    ...valores,
    description: inicial.description,
    amount: inicial.amount,
    notes: inicial.notes,
  };
}
