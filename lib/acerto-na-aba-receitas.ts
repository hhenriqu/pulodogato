// -----------------------------------------------------------------------------
// "ELA PAGOU; EU CONFIRMO" FORA DA TELA DO GRUPO (HMO-366, fase F4 da HMO-360)
// -----------------------------------------------------------------------------
// "o pagamento dela gera uma receita prevista pra mim. Ela clica que pagou, e o
// meu continua como previsto, e eu tenho que confirmar que foi pago."
//
// O ESTADO JA EXISTIA; O QUE FALTAVA ERA O LUGAR
// ----------------------------------------------
// Nada aqui e mecanismo novo, e esse e o achado que barateia a fase:
//
//   * `group_settlements_select` e `USING (is_group_member(group_id))` (007) --
//     os DOIS lados veem a linha da quitacao, e `created_by` diz quem a
//     registrou;
//   * `EstadoDaMinhaPerna` (lib/perna-da-contraparte.ts) ja responde "EU ja
//     lancei?" por sessao, porque a perna de cada um e invisivel para o outro
//     por policy;
//   * logo "ela disse que pagou e eu ainda nao confirmei" = a quitacao existe E
//     o meu estado e `a_lancar`. Nao ha coluna a criar, e nao ha migration;
//   * a acao de confirmar tambem ja existe:
//     `POST /api/expense-groups/[groupId]/settlements/[id]/perna`.
//
// O cabecalho de lib/perna-da-contraparte.ts diz que fechar o ciclo "exigiria
// que um lado LESSE o estado do outro, e nao ha onde". Isso continua verdade
// para a pergunta DELE ("o outro ja lancou?"). A pergunta desta fase e outra --
// "alguem registrou que me pagou e eu ainda nao lancei?" -- e para ela ha onde,
// porque as duas metades da resposta sao legiveis pela MINHA sessao.
//
// ESTE MODULO NAO DECIDE DINHEIRO, E ISSO E DELIBERADO
// ----------------------------------------------------
// Ele escolhe QUAIS acertos a aba Receitas mostra e EM QUAL DOS DOIS LADOS. O
// valor sai de `group_settlements` como a quitacao o gravou, e quem converte
// para a moeda da conta continua sendo `pernaDoAcerto` -- a mesma funcao no
// dialogo e no servidor. Uma segunda aritmetica aqui divergiria dela
// exatamente no caso que dói (acerto em moeda estrangeira, 026).
//
// =============================================================================
// POR QUE ESTAS LINHAS FICAM FORA DOS TRES CARTOES -- AS DUAS RAZOES
// =============================================================================
// 1. O «PREVISTO» DE RECEITAS JA CONTA ESTE DINHEIRO. Desde a F3 (HMO-364) o
//    cartao soma o REEMBOLSO PREVISTO do grupo (`resumoComReembolsoPrevisto`),
//    que vem de `creditoAReceber` -> `fecharMes`. E `fecharMes` NAO LE
//    `group_settlements`: ele neta despesas do mes por membro e mais nada
//    (confira: nenhuma das seis consultas de lib/services/credito-dos-grupos.ts
//    toca aquela tabela). Entao registrar o acerto NAO abaixa o credito, e somar
//    o acerto no «Previsto» contaria os mesmos R$ 300 duas vezes -- um numero
//    inflado e plausivel, que e a familia de `duas-pernas-mantem-o-total-certo`.
//
// 2. A PERNA E `transfer`, E `transfer` NAO E RECEITA REALIZADA. Confirmar grava
//    `TIPO_DA_PERNA` (lib/acerto-em-lancamento.ts), e a invariante que aquele
//    modulo mediu e **um acerto nunca muda a Receita nem a Despesa de ninguem**:
//    com `income`, `personal_category_monthly_totals` apagaria a parte que a
//    pessoa consumiu e o mes fecharia empatado (medido: net 0,00 onde o certo e
//    -200,00). Somar no cartao «Realizado» daqui seria o mesmo defeito escrito
//    na tela em vez de no banco.
//
// E E JUSTAMENTE POR ISSO QUE A LINHA TEM DE EXISTIR
// --------------------------------------------------
// Sem ela, confirmar faria a linha DESAPARECER da tela: ela sai do lado a
// confirmar, e a perna `transfer` nao entra em Receitas realizadas. "Cliquei e
// o valor sumiu" e indistinguivel de bug -- e o caminho dessa estranheza termina
// em alguem lancando a receita a mao para "consertar", que e exatamente a conta
// duas vezes que a 007 recusou. Por isso o lado confirmado continua na tela,
// ROTULADO e FORA DO TOTAL, do mesmo jeito que a parte de grupo aparece na lista
// de Financas Pessoais sem entrar nos cartoes.
//
// O ROTULO E A ENTREGA, NAO ENFEITE: as frases sao constantes exportadas, e nao
// strings no JSX, pela razao escrita em lib/perna-da-contraparte.ts -- uma frase
// no JSX casa com qualquer assercao textual sobre o JSX e nao prova nada sobre o
// estado que a produziu. E a sonda de producao pode procura-las no chunk.
// -----------------------------------------------------------------------------

import { MOEDA_PADRAO, moedaConhecida } from "@/lib/dinheiro";
import {
  chaveDoAcerto,
  descricaoDoAcerto,
} from "@/lib/acerto-em-lancamento";
import { comoEuVejoOAcerto } from "@/lib/perna-da-contraparte";
import type { TipoDaTela } from "@/lib/telas-de-movimentacao";

/**
 * Uma linha de `group_settlements` como a consulta a devolve.
 *
 * `amount` e `exchange_rate` sao `numeric` -- chegam como STRING no JSON do
 * PostgREST, e e por isso que os dois sao `number | string` aqui e passam por
 * `Number()` abaixo. Tipar como `number` deixaria o `tsc` verde e faria
 * `valor` chegar na tela como texto, onde `R$ "300.00"` so aparece no formato.
 */
export interface AcertoCruDaReceita {
  id: string;
  group_id: string;
  from_user_id: string;
  to_user_id: string;
  /** Quem registrou -- e, pela policy da 007, quem pode desfazer. */
  created_by: string;
  amount: number | string;
  currency: string | null;
  exchange_rate: number | string | null;
  /** 'AAAA-MM-DD': a data do PAGAMENTO, nao de hoje. */
  settled_on: string;
}

/** O acerto como a aba Receitas o mostra. */
export interface AcertoNaAbaReceitas {
  /**
   * `acerto:<id da quitacao>` -- a MESMA chave que a perna leva em `notes`.
   *
   * Nao e um id de `scheduled_transactions` nem de `financial_transactions`, e
   * o prefixo esta aqui para que nenhum `href` montado com este campo possa
   * passar por um `/api/scheduled-transactions/<uuid>/pay` plausivel. Quem
   * precisa do id da quitacao le `settlementId`, que e o que a rota da perna
   * recebe na URL.
   */
  id: string;
  settlementId: string;
  /** A rota da confirmacao e por grupo: sem ele nao da para montar a URL. */
  groupId: string;
  /**
   * A frase que a pessoa vai reconhecer -- a MESMA de `descricaoDoAcerto`.
   *
   * E a funcao que o POST usa para escrever a `description` da perna, de
   * proposito: a linha ANTES de confirmar e a linha DEPOIS de confirmar dizem a
   * mesma coisa, e o extrato repete a frase que a tela prometeu. Uma segunda
   * frase escrita aqui divergiria dela na primeira mudanca, e o sintoma seria
   * "a tela diz uma coisa e o extrato outra" sobre o mesmo Pix.
   */
  descricao: string;
  /** POSITIVO, na moeda do PAGAMENTO (`moeda`) -- nunca convertido aqui. */
  valor: number;
  moeda: string;
  /** A cotacao congelada em `settled_on` (026). 1 em real. */
  cotacao: number;
  /** `settled_on`. */
  data: string;
  /** `null` quando o perfil de quem pagou nao e legivel para mim. */
  nomeDaContraparte: string | null;
}

/** Os dois lados da aba, cada um com as suas linhas. */
export interface AcertosNaAbaReceitas {
  /** Ela registrou que pagou; eu ainda nao lancei. Ganha a acao Confirmar. */
  a_confirmar: AcertoNaAbaReceitas[];
  /** Eu ja lancei: a perna esta no meu extrato, como `transfer`. */
  confirmados: AcertoNaAbaReceitas[];
}

/**
 * Nenhum acerto -- a resposta de quem nao participa de grupo nenhum, e TAMBEM a
 * de quando a leitura falha.
 *
 * Objeto exportado em vez de dois `[]` no lugar da chamada: a rota tem tres
 * caminhos que caem aqui (tela que nao e Receitas, consulta que falhou, nada no
 * periodo) e os tres tem de produzir a MESMA forma. A tela distingue "nao ha
 * acerto" de "nao houve leitura" pelo campo estar AUSENTE, nao vazio.
 */
export const ACERTOS_VAZIOS: AcertosNaAbaReceitas = {
  a_confirmar: [],
  confirmados: [],
};

/** O titulo do bloco de quem ainda nao confirmou. */
export const TITULO_A_CONFIRMAR = "Acerto de grupo a confirmar";

/**
 * O que o bloco a confirmar explica, e por que ele diz as duas coisas.
 *
 * A primeira oracao e o estado ("alguem registrou que te pagou"), e a segunda e
 * a CONSEQUENCIA de nao agir -- o dinheiro nao esta no extrato. Sem a segunda,
 * a linha se le como aviso informativo e fica ali para sempre: e o defeito que
 * `ROTULO_A_LANCAR` existe para nao ter na tela do grupo, agora na aba Receitas.
 */
export const SUBTITULO_A_CONFIRMAR =
  "Alguém registrou um pagamento para você. Enquanto você não confirmar em qual conta o dinheiro entrou, o Pix não está no seu extrato.";

/** O titulo do bloco de quem ja confirmou. */
export const TITULO_CONFIRMADO = "Acerto de grupo recebido";

/**
 * POR QUE O VALOR CONFIRMADO NAO ESTA NO CARTAO «Realizado».
 *
 * Ela e a entrega da pegadinha de UX desta fase: a perna e `transfer`, entao
 * confirmar tira a linha de um lado e NAO a soma no outro. Quem acabou de
 * clicar precisa ler, na mesma tela, por que o numero grande nao subiu -- senao
 * conclui que o app nao registrou e lanca a receita a mao, que e a conta duas
 * vezes que a 007 recusou.
 */
export const ACERTO_FORA_DO_REALIZADO =
  "Já está na sua conta e fora do Realizado acima: acerto é transferência — ele move dinheiro de lugar e não é receita nova.";

/**
 * POR QUE O VALOR A CONFIRMAR NAO ESTA NO CARTAO «Previsto».
 *
 * O «Previsto» de Receitas ja conta este dinheiro como REEMBOLSO PREVISTO
 * (F3/HMO-364), e `fecharMes` nao desconta acerto registrado -- ver a razao 1
 * do cabecalho. Somar aqui contaria duas vezes; nao dizer isso deixaria a
 * pessoa somando a lista a mao para descobrir a diferenca.
 */
export const ACERTO_FORA_DO_PREVISTO =
  "Fora do Previsto acima: este valor já está lá dentro, como reembolso previsto do grupo.";

/**
 * Os acertos que a aba Receitas mostra, separados pelo MEU estado.
 *
 * `chavesComPerna` sao as chaves `acerto:<id>` para as quais a MINHA sessao
 * achou perna em `financial_transactions`. Ela entra como parametro -- e nao e
 * consultada aqui -- pelo mesmo motivo de `temPerna` em `comoEuVejoOAcerto`: e
 * o que deixa esta decisao ser medida sem banco, e o que impede a tela e a rota
 * de discordarem sobre quem ganha o botao.
 *
 * AS QUATRO COISAS QUE ESTA FUNCAO EXISTE PARA NAO ERRAR
 * ------------------------------------------------------
 * 1. SO A ABA RECEITAS. Em Despesas estas linhas seriam uma divida que nao
 *    existe (quem recebe nao paga nada), e em Transferencias elas seriam o
 *    quinto numero sem rotulo da familia `despesa-de-grupo-tem-tres-convencoes`.
 *    Mesma guarda de `resumoComReembolsoPrevisto`, no mesmo lugar da cadeia.
 *
 * 2. SO QUEM RECEBE. A issue e "ela pagou; EU confirmo": a direcao tem de ser
 *    `recebi`. O acerto em que EU pago tambem aparece em `a_lancar` para mim --
 *    e ele nao e receita de ninguem: a confirmacao dele vive na tela do grupo,
 *    onde o contexto e a divida. Listar os dois aqui poria uma SAIDA de dinheiro
 *    na aba Receitas, com botao de confirmar ao lado.
 *
 * 3. O ESTADO VEM DE `comoEuVejoOAcerto`, NUNCA DE UM `has()` DIRETO. Repetir
 *    "sou parte? ja lancei?" aqui criaria o segundo criterio da mesma pergunta,
 *    e a rota da perna decide pelo primeiro -- a tela ofereceria Confirmar sobre
 *    um acerto que o POST recusa com 409.
 *
 * 4. VALOR QUE NAO E NUMERO POSITIVO NAO VIRA LINHA. `numeric` chega como
 *    string, e `Number("")` e 0 -- nao `NaN`, entao nenhum `isNaN` o pega. Uma
 *    linha de R$ 0,00 com botao Confirmar abriria um dialogo que o servidor
 *    recusa (`pernaDoAcerto` devolve `sem_conta` para `amount <= 0`), e o
 *    sintoma seria "cliquei e nada aconteceu".
 *
 * AS DUAS ORDENS SAO OPOSTAS, como em `secoesDaTela`: a confirmar em ordem
 * CRESCENTE de data (a pergunta e "o que eu preciso resolver", e o mais antigo
 * e o que esta esperando ha mais tempo), confirmados em DECRESCENTE (a pergunta
 * e "o que aconteceu", e o ultimo e o que a pessoa acabou de fazer).
 */
export function acertosNaAbaReceitas(params: {
  acertos: readonly AcertoCruDaReceita[];
  /** A tela que esta sendo lida. Nada sai fora de `income`. */
  tipo: TipoDaTela;
  userId: string;
  chavesComPerna: ReadonlySet<string>;
  /** `user_id -> nome`, so com os perfis que a RLS deixou ler. */
  nomes: ReadonlyMap<string, string>;
  /** `group_id -> nome do grupo`. */
  grupos: ReadonlyMap<string, string>;
}): AcertosNaAbaReceitas {
  // Coisa 1 do bloco acima.
  if (params.tipo !== "income") return { a_confirmar: [], confirmados: [] };

  const aConfirmar: AcertoNaAbaReceitas[] = [];
  const confirmados: AcertoNaAbaReceitas[] = [];

  for (const acerto of params.acertos || []) {
    if (!acerto?.id || !acerto.group_id) continue;

    const chave = chaveDoAcerto(acerto.id);

    // Coisa 3: o MESMO calculo da tela do grupo e da rota da perna.
    const visao = comoEuVejoOAcerto({
      acerto: {
        from_user_id: acerto.from_user_id,
        to_user_id: acerto.to_user_id,
        created_by: acerto.created_by,
      },
      userId: params.userId,
      temPerna: params.chavesComPerna.has(chave),
    });

    // Coisa 2, e ela e sobre o "paguei": sem esta linha, o acerto que EU pago
    // entra na aba RECEITAS, porque ele tambem esta `a_lancar` para mim.
    //
    // O CASO `nao_sou_parte` E COBERTO DUAS VEZES, E ISSO ESTA MEDIDO. Em
    // `comoEuVejoOAcerto`, `direcao === null` e `estado === "nao_sou_parte"` sao
    // a MESMA condicao -- o unico caminho para aquele estado e aquela direcao
    // nula. Entao a quitacao entre outros dois membros (que a policy da 007 me
    // deixa LER) e barrada aqui E no `estado` la embaixo, e um mutante que
    // afrouxe SO esta linha para `=== "paguei"` SOBREVIVE: medido em
    // `scripts/mutantes-acerto-na-aba-receitas.mjs`, e por isso ele nao esta na
    // lista -- seria um mutante equivalente com rotulo de defeito.
    //
    // Nenhuma das duas guardas e removivel: esta exclui o "paguei" (que o
    // `estado` admitiria), e a do `estado` e quem ROTEIA as duas listas. A
    // redundancia esta escrita aqui em vez de medida por um controle negativo
    // que nao pode falhar.
    if (visao.direcao !== "recebi") continue;

    // Coisa 4.
    const valor = Number(acerto.amount);
    if (!Number.isFinite(valor) || valor <= 0) continue;

    const cotacao = Number(acerto.exchange_rate ?? 1) || 1;
    const moeda = moedaConhecida(acerto.currency)
      ? String(acerto.currency).trim().toUpperCase()
      : MOEDA_PADRAO;

    const nome = params.nomes.get(acerto.from_user_id) ?? null;

    const linha: AcertoNaAbaReceitas = {
      id: chave,
      settlementId: acerto.id,
      groupId: acerto.group_id,
      descricao: descricaoDoAcerto({
        direcao: "recebi",
        nomeDaContraparte: nome,
        nomeDoGrupo: params.grupos.get(acerto.group_id) ?? null,
      }),
      valor,
      moeda,
      cotacao,
      data: String(acerto.settled_on ?? ""),
      nomeDaContraparte: nome,
    };

    // `estado` e nao `temPerna`: os dois concordam hoje, e o que decide e o
    // estado -- se um dia `comoEuVejoOAcerto` ganhar um quarto valor, a linha
    // cai FORA das duas listas em vez de entrar na errada.
    if (visao.estado === "a_lancar") aConfirmar.push(linha);
    else if (visao.estado === "lancado") confirmados.push(linha);
  }

  return {
    a_confirmar: aConfirmar.sort((a, b) => a.data.localeCompare(b.data)),
    confirmados: confirmados.sort((a, b) => b.data.localeCompare(a.data)),
  };
}

/**
 * NAO HA TOTAL DOS DOIS BLOCOS, E A AUSENCIA E DELIBERADA.
 *
 * Um "R$ 300,00 a confirmar" em cima da lista seria o quarto numero da tela, e
 * ele teria de somar valores que podem estar em MOEDAS DIFERENTES: a 026 deixou
 * `group_settlements` gravar o acerto na moeda do pagamento, entao somar US$ 50
 * com R$ 50 daria um numero que nao existe em moeda nenhuma. A alternativa
 * (somar convertendo) poria aqui a segunda aritmetica de cambio do projeto, que
 * divergiria de `pernaDoAcerto` exatamente no caso raro.
 *
 * Cada linha leva o proprio valor e a propria moeda, que e a unica leitura
 * verdadeira possivel -- e a contagem, que a tela imprime, nao tem esse
 * problema.
 */
