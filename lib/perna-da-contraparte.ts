/**
 * O OUTRO LADO DO ACERTO, E O DESFAZER DE CADA LADO (HMO-245, fase 12)
 * ====================================================================
 *
 * A fase 11 fez a quitacao gravar UMA perna em `financial_transactions`: a de
 * quem clicou. A outra ficou de fora, e nao por falta de codigo --
 * `financial_transactions_write` e `FOR INSERT WITH CHECK (user_id =
 * auth.uid())` (`002_rls_lockdown.sql:472`), entao a perna da contraparte
 * precisa da SESSAO dela e da CONTA dela. E a objecao 1 da migration 007
 * ("nunca mexer no saldo da conta de outra pessoa") em vigor: a alternativa, um
 * trigger `SECURITY DEFINER` escolhendo conta alheia, e a forma de errar em
 * silencio no saldo de terceiro, e foi o motivo de a 007 ter recusado o desenho
 * inteiro.
 *
 * A CONSEQUENCIA E QUE O MESMO ACERTO TEM DOIS ESTADOS AO MESMO TEMPO
 * -------------------------------------------------------------------
 * Entre o registro e a confirmacao, quem registrou ja tem o Pix no extrato e a
 * contraparte nao tem nada. O dado que distingue os dois nao esta em
 * `group_settlements`: esta na EXISTENCIA da perna daquela pessoa, e cada um so
 * consegue ler a propria (a mesma RLS, agora no SELECT). Por isso este modulo
 * nao pergunta "o acerto foi confirmado?" -- pergunta **"EU ja lancei?"**, que
 * e a unica pergunta que cada sessao tem como responder.
 *
 * ===========================================================================
 * O ROTULO E A ENTREGA, NAO ENFEITE
 * ===========================================================================
 * `ROTULO_A_LANCAR` existe porque **"nao lancado" e indistinguivel de "nao
 * aconteceu"**. Sem ele, a tela de quem nao confirmou mostra o acerto na lista
 * de pagamentos -- com valor, data e os dois nomes -- e nenhum sinal de que o
 * dinheiro nao passou pela conta dela. A pessoa conclui que esta tudo lancado,
 * e o extrato dela fica sem o Pix para sempre.
 *
 * O rotulo e o estado sao o MESMO calculo em tela e em teste: a alternativa e
 * uma frase escrita no JSX, que casa com qualquer assercao textual sobre o JSX
 * e nao prova nada sobre o estado que a produziu.
 *
 * QUEM DESFAZ REMOVE A PROPRIA PERNA
 * ----------------------------------
 * `DELETE /settlements/[id]` apaga a quitacao e e restrito a `created_by` (a
 * policy da 007). Ele ja apaga a perna de quem clica, pela chave em `notes`
 * (fase 11) -- a RLS garante que ele nao alcance a do outro. Falta o simetrico:
 * a contraparte precisa poder remover A PERNA DELA sem apagar a quitacao, que
 * nao e dela para apagar. Sao duas acoes diferentes, e e por isso que
 * `podeDesfazerSoAMinhaPerna` e `podeDesfazerOAcerto` nao sao o mesmo booleano.
 *
 * POR QUE QUEM REGISTROU NAO GANHA A ACAO DE "SO A MINHA PERNA"
 * -------------------------------------------------------------
 * Porque o resultado dela, para quem registrou, e a quitacao gravada com
 * dinheiro nenhum -- o defeito EXATO que a fase 11 consertou. Quem registrou
 * tem a acao melhor (desfazer o acerto, que leva a perna junto), e oferecer as
 * duas ao lado uma da outra convida a reproduzir o defeito antigo com um clique
 * de distancia. A recusa e explicada em `MENSAGEM_USE_DESFAZER`.
 *
 * O QUE ESTE MODULO NAO RESOLVE, E ESTA ESCRITO PARA NAO SER ESQUECIDO
 * --------------------------------------------------------------------
 * Se quem registrou desfizer o acerto DEPOIS de a contraparte ter confirmado, a
 * perna da contraparte sobrevive -- a RLS impede que o DELETE a alcance, e e
 * isso que se quer. A quitacao, porem, deixa de existir, e com ela a linha da
 * tela de grupo que oferecia "Desfazer o meu lancamento".
 *
 * A perna NAO fica inalcancavel: ela e um lancamento normal no extrato de quem
 * confirmou, com `Acerto de grupo` na descricao e o nome da outra pessoa, e se
 * apaga de la como qualquer outro. Mas o aviso tem de ser DITO a quem desfaz --
 * e `AVISO_AO_DESFAZER_O_ACERTO` --, porque quem desfaz e a unica pessoa que
 * sabe, naquele instante, que o acerto deixou de valer.
 *
 * Fechar isso de verdade exigiria que um lado LESSE o estado do outro, e nao
 * ha onde: nenhuma coluna de `group_settlements` guarda "quem ja lancou", e
 * `financial_transactions` e invisivel entre usuarios por policy. Seria
 * migration, e e decisao do Helio.
 */

import { direcaoDoAcerto, type DirecaoDoAcerto } from "@/lib/acerto-em-lancamento";

/**
 * O estado do acerto PARA MIM.
 *
 * Nao e o estado do acerto: e o meu. O mesmo id responde `lancado` numa sessao
 * e `a_lancar` na outra, e e isso que esta fase existe para tornar visivel.
 */
export type EstadoDaMinhaPerna =
  /** O acerto e entre outras duas pessoas. Nao afirma nada sobre a minha conta. */
  | "nao_sou_parte"
  /** Sou parte e NAO ha perna minha: o dinheiro nao passou pela minha conta. */
  | "a_lancar"
  /** Sou parte e a perna existe: o Pix esta no meu extrato. */
  | "lancado";

/** O que a quitacao diz, do ponto de vista de quem esta lendo a tela. */
export interface AcertoParaMim {
  from_user_id: string;
  to_user_id: string;
  /** Quem registrou -- e, pela policy da 007, quem pode desfazer. */
  created_by: string;
}

/**
 * A frase do estado intermediario. A entrega 2 da issue, literal.
 *
 * Constante exportada, e nao string no JSX, por duas razoes: o teste puro pode
 * exigir que ela apareca com ESTE estado e nao com o outro, e a sonda de
 * producao pode procura-la no chunk publicado.
 */
export const ROTULO_A_LANCAR =
  "Acerto registrado, ainda não lançado na sua conta.";

/** O estado seguinte, dito com a conta -- e so com ela se soubermos o nome. */
export function rotuloDeLancado(nomeDaConta?: string | null): string {
  const conta = (nomeDaConta || "").trim();
  return conta ? `Lançado em ${conta}.` : "Lançado na sua conta.";
}

/**
 * A recusa de remover a propria perna quando quem pede foi quem registrou.
 *
 * Ela DIZ O QUE FAZER porque a acao certa existe e esta na mesma linha da tela.
 */
export const MENSAGEM_USE_DESFAZER =
  "Você registrou este acerto: use Desfazer, que remove o acerto e o seu lançamento juntos. " +
  "Tirar só o lançamento deixaria a dívida quitada sem o dinheiro ter saído da conta.";

/** A recusa de lancar duas vezes a mesma perna. */
export const MENSAGEM_JA_LANCADO =
  "Este acerto já está lançado na sua conta.";

/** A recusa de lancar a perna de um acerto do qual nao se e parte. */
export const MENSAGEM_NAO_SOU_PARTE =
  "Este acerto é entre outras duas pessoas: não há perna sua para lançar.";

/**
 * O que dizer a quem acabou de desfazer o acerto.
 *
 * Ver "O QUE ESTE MODULO NAO RESOLVE" no cabecalho. Quem desfaz e a unica
 * pessoa que sabe, naquele instante, que o acerto deixou de valer -- e a perna
 * da outra pessoa so sai pela mao dela.
 */
export const AVISO_AO_DESFAZER_O_ACERTO =
  "Se a outra pessoa já lançou este acerto na conta dela, avise: só ela pode remover o lançamento dela.";

/** O acerto como a sessao de quem esta lendo o ve. */
export interface AcertoVistoPorMim {
  estado: EstadoDaMinhaPerna;
  /** `null` quando nao sou parte -- e entao nao ha sinal a aplicar. */
  direcao: DirecaoDoAcerto | null;
  /** A frase do estado, ou `null` quando o acerto nao fala da minha conta. */
  rotulo: string | null;
  /** Mostrar a acao de escolher a conta e lancar. */
  podeLancar: boolean;
  /** Mostrar "desfazer o meu lancamento", que NAO apaga a quitacao. */
  podeDesfazerSoAMinhaPerna: boolean;
  /** Mostrar "Desfazer", que apaga a quitacao E a perna de quem clica. */
  podeDesfazerOAcerto: boolean;
}

/**
 * O estado, o rotulo e as acoes de um acerto para UMA sessao.
 *
 * `temPerna` vem de uma consulta que so devolve as linhas da propria pessoa
 * (`notes = 'acerto:<id>'`, com a RLS filtrando por `user_id`). Passar isso
 * como parametro, em vez de consultar aqui, e o que deixa esta decisao ser
 * medida sem banco -- e o que impede a tela e a rota de discordarem, porque as
 * duas chamam esta funcao.
 */
export function comoEuVejoOAcerto(params: {
  acerto: AcertoParaMim;
  userId: string;
  temPerna: boolean;
  nomeDaConta?: string | null;
}): AcertoVistoPorMim {
  const direcao = direcaoDoAcerto({
    fromUserId: params.acerto.from_user_id,
    toUserId: params.acerto.to_user_id,
    userId: params.userId,
  });

  // Quem registrou desfaz, mesmo sem perna: a policy de DELETE da 007 olha
  // `created_by` e mais nada. Um acerto gravado antes da fase 11 nao tem perna
  // nenhuma, e continua tendo de sair da lista.
  const podeDesfazerOAcerto = params.acerto.created_by === params.userId;

  if (!direcao) {
    return {
      estado: "nao_sou_parte",
      direcao: null,
      // Nenhuma frase: o acerto de dois outros membros nao afirma nada sobre a
      // minha conta, e "ainda nao lancado na sua conta" ali seria mentira.
      rotulo: null,
      podeLancar: false,
      podeDesfazerSoAMinhaPerna: false,
      // Caso real, nao teorico: quem administra o grupo pode ter registrado o
      // acerto entre outros dois -- e e ele quem desfaz o proprio registro.
      podeDesfazerOAcerto,
    };
  }

  if (params.temPerna) {
    return {
      estado: "lancado",
      direcao,
      rotulo: rotuloDeLancado(params.nomeDaConta),
      podeLancar: false,
      // Ver "POR QUE QUEM REGISTROU NAO GANHA A ACAO" no cabecalho.
      podeDesfazerSoAMinhaPerna: !podeDesfazerOAcerto,
      podeDesfazerOAcerto,
    };
  }

  return {
    estado: "a_lancar",
    direcao,
    rotulo: ROTULO_A_LANCAR,
    // Vale tambem para quem REGISTROU e esta sem perna: acerto de antes da fase
    // 11, ou perna apagada do extrato a mao. Nos dois casos o dinheiro nao esta
    // na conta e a acao certa e a mesma.
    podeLancar: true,
    podeDesfazerSoAMinhaPerna: false,
    podeDesfazerOAcerto,
  };
}

/** Por que a perna pedida nao pode ser gravada. */
export type RecusaDaPerna = "nao_sou_parte" | "ja_lancado";

/**
 * A frase da recusa, para a rota responder texto e nao codigo de erro.
 */
export function mensagemDaRecusaDaPerna(recusa: RecusaDaPerna): string {
  return recusa === "ja_lancado" ? MENSAGEM_JA_LANCADO : MENSAGEM_NAO_SOU_PARTE;
}

/**
 * A rota de confirmacao em uma decisao: posso gravar a minha perna agora?
 *
 * Devolve a direcao quando sim -- e e dela que sai o SINAL. Sem esta funcao a
 * rota repetiria `direcaoDoAcerto` mais a checagem de duplicata, e a tela
 * ofereceria o botao por um critério e o servidor recusaria por outro.
 */
export function minhaPernaPodeSerGravada(params: {
  acerto: AcertoParaMim;
  userId: string;
  temPerna: boolean;
}):
  | { direcao: DirecaoDoAcerto; recusa?: undefined }
  | { direcao?: undefined; recusa: RecusaDaPerna } {
  const visao = comoEuVejoOAcerto(params);

  if (visao.estado === "nao_sou_parte") return { recusa: "nao_sou_parte" };
  if (visao.estado === "lancado") return { recusa: "ja_lancado" };

  // `direcao` e nao-nulo em `a_lancar` por construcao: o unico caminho para
  // `nao_sou_parte` e `direcao === null`. O teste existe para o tipo, e para
  // que uma mudanca naquela funcao nao vire um sinal invertido aqui.
  return visao.direcao
    ? { direcao: visao.direcao }
    : { recusa: "nao_sou_parte" };
}

/**
 * Remover SO a minha perna: pode?
 *
 * `null` = pode. A string e a frase da recusa, ja pronta para a resposta.
 */
export function recusaDeRemoverSoAMinhaPerna(params: {
  acerto: AcertoParaMim;
  userId: string;
  temPerna: boolean;
}): string | null {
  const visao = comoEuVejoOAcerto(params);

  if (visao.estado === "nao_sou_parte") return MENSAGEM_NAO_SOU_PARTE;
  // Quem registrou tem a acao melhor, e ela remove a perna junto.
  if (visao.podeDesfazerOAcerto) return MENSAGEM_USE_DESFAZER;
  if (visao.estado === "a_lancar") {
    return "Este acerto não está lançado na sua conta: não há o que remover.";
  }
  return null;
}
