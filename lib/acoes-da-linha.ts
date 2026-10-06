// -----------------------------------------------------------------------------
// QUAIS ACOES UMA LINHA DA LISTA GANHA, E PARA ONDE CADA UMA VAI (HMO-301)
// -----------------------------------------------------------------------------
// 10/10 do plano da HMO-279. "E em ambos os modos verificar pois todos
// lancamentos devem ter botoes de editar, excluir ou confirmar pra validar que
// foi pago ou recebido."
//
// Ate esta issue a linha de `components/movimentacoes/SecaoDaTela.tsx` era SO
// LEITURA, nas tres telas (Receitas, Despesas, Transferencias) que os dois
// modos usam -- o completo e o papel de pao. Entao isto nao e "habilitar no
// papel de pao": e a feature nascendo no lugar que serve aos dois.
//
// POR QUE A DECISAO MORA NUM MODULO PURO, E NAO NO JSX
// ---------------------------------------------------
// Porque ela e uma peneira de CINCO regras sobre estado de linha, e as cinco
// falham de forma plausivel: o botao aparece, a pessoa clica, e o que acontece
// e um 404, um 409, ou -- o pior -- um 200 que nao mudou nada. Nenhum desses
// tres estados tem sintoma na tela. Escritas como `&&` dentro do JSX elas nao
// teriam assercao nenhuma por cima; aqui `npm run test:acoes-da-linha` e
// `npm run mutantes:acoes-da-linha` as alcancam sem navegador.
//
// ARQUIVO-FOLHA, DE PROPOSITO: nenhum import de runtime alem de `comOrigem`
// (que tambem e folha -- `lib/retorno-do-lancamento.ts` so importa um TIPO).
// `LinhaDaTela` entra por `import type`, que o emit apaga. Isso e o que deixa
// este modulo barato de compilar na sonda de navegador de
// scripts/test-lista-na-tela.mjs, que concatena os `.js` de producao num script
// classico.
//
// =============================================================================
// AS CINCO REGRAS, E O QUE CADA UMA EVITA
// =============================================================================
//
// 1. "CONFIRMAR" SO EXISTE NO PREVISTO. Em linha realizada nao ha o que
//    confirmar, e um botao que confirmasse o que ja aconteceu gravaria a
//    SEGUNDA PERNA do mesmo dinheiro -- que e exatamente como este app ja
//    contou despesa duas vezes (ver a armadilha 2 do cabecalho de
//    lib/telas-de-movimentacao.ts). `origem` ja distingue, sem campo novo.
//
// 2. "PAGO OU RECEBIDO" E UMA ACAO E TRES ROTULOS. A rota da baixa e a MESMA
//    (`POST /api/scheduled-transactions/{id}/pay`); o texto segue a DIRECAO da
//    linha. Um rotulo so faz duas das tres telas mentir -- "Confirmar
//    pagamento" embaixo de um salario previsto e um verbo errado sobre um
//    numero certo, e e o mesmo defeito que `palavraDaLinha` existe para evitar
//    em `AparenciaDaTela`.
//
// 3. LINHA NAO GRAVADA NAO GANHA BOTAO. `gravada: false` e a fatura aberta
//    sintetizada (HMO-227): ela nao existe em tabela nenhuma e nao tem
//    `scheduled_transactions.id`. A baixa com id inventado responde 404 -- que,
//    para quem clicou, se le como "o app nao conseguiu".
//
// 4. SEM `posso_editar` NAO SAI BOTAO NENHUM. A lista pode conter linha de
//    OUTRO membro do grupo (a policy do 005 libera `group_id IS NOT NULL AND
//    is_group_member(group_id)`), e a RLS recusa a escrita. O modo de falha
//    pior esta medido neste repositorio: **UPDATE filtrado pela RLS volta 200
//    sem alterar nada** -- o app diz "pronto" e a linha fica. Botao que aparece
//    e nao funciona e pior que botao ausente.
//
// 5. A LINHA DE FATURA NAO ENTRA NA BAIXA GENERICA, mesmo GRAVADA -- e sao duas
//    razoes independentes, as duas suficientes:
//
//      * a fatura FECHADA se paga escolhendo A CONTA PAGADORA. O caminho de
//        `pagarFatura` exige `payment_account_id` no corpo
//        (`validarContaPagadora` em lib/card-invoice.ts), e um POST sem ele
//        volta erro. Um "Confirmar pagamento" que sempre falha e o botao da
//        regra 4 com outro nome;
//      * a linha de fatura ERA UM `<a>` para a tela do cartao (ver
//        `LinhaDaSecao` em SecaoDaTela.tsx). Botao dentro de ancora e
//        aninhamento interativo invalido, e o clique navegaria junto.
//
//    E E POR ISSO QUE A FATURA GANHOU DESTINO PROPRIO NA HMO-311 -- `podePagarAFatura`
//    la embaixo --, e nao uma excecao dentro de `podeAgirNaLinha`. As duas
//    razoes acima nao foram revogadas: elas foram ATENDIDAS. O destino e o
//    dialogo que PERGUNTA a conta pagadora
//    (components/fatura/DialogoDePagamentoDaFatura, HMO-310), e a linha deixou
//    de ser `<a>` -- o link virou o NOME DO CARTAO, dentro dela.
//
//    `podeAgirNaLinha` continua recusando a fatura, e o mutante que apaga essa
//    recusa continua tendo de morrer: a baixa generica e justamente a que volta
//    erro sem `payment_account_id`.
// -----------------------------------------------------------------------------

import { comOrigem } from "@/lib/retorno-do-lancamento";
import type { LinhaDaTela, TipoDaTela } from "@/lib/telas-de-movimentacao";

/**
 * O que uma acao precisa saber da linha.
 *
 * ESTRUTURAL E NAO `LinhaDaTela` INTEIRA, para que os casos de teste sejam
 * sete campos em vez de quinze -- e `LinhaDaTela` a satisfaz por construcao
 * (`Pick`), entao um campo renomeado la reprova o `tsc` aqui em vez de passar
 * silenciosamente.
 */
export type LinhaAcionavel = Pick<
  LinhaDaTela,
  "id" | "gravada" | "origem" | "tipo" | "natureza" | "posso_editar"
>;

/** O rotulo fixo dos dois botoes que nao mudam de nome por tela. */
export const ROTULO_DE_EDITAR = "Editar";
export const ROTULO_DE_EXCLUIR = "Excluir";

/**
 * O rotulo do botao da fatura -- "Pagar", e NAO "Confirmar pagamento".
 *
 * Os dois verbos prometem coisas diferentes, e so um deles e verdade aqui:
 * "Confirmar" diz que o clique JA resolveu (e e isso que `rotuloDeConfirmar` faz
 * nas outras linhas, onde a baixa sai no proprio clique). O da fatura ABRE UM
 * DIALOGO e pergunta de qual conta o dinheiro saiu -- quem clica ainda tem uma
 * escolha a fazer, e pode desistir.
 */
export const ROTULO_DE_PAGAR = "Pagar";

/**
 * O verbo da baixa, por direcao da linha -- regra 2.
 *
 * TRES e nao dois: a issue cita "recebimento" e "pagamento", e a tela de
 * Transferencias usa as mesmas linhas previstas (a transferencia recorrente da
 * 038 chega aqui com `direction: "transfer"`). Sem o terceiro caso ela cairia
 * num `??` e diria "pagamento" sobre dinheiro que so trocou de conta.
 */
export function rotuloDeConfirmar(tipo: TipoDaTela): string {
  if (tipo === "income") return "Confirmar recebimento";
  if (tipo === "transfer") return "Confirmar transferência";
  return "Confirmar pagamento";
}

/**
 * A base de todas as acoes: regras 3, 4 e 5 juntas.
 *
 * As tres sao conjuncao e nenhuma e redundante com as outras -- a fatura ABERTA
 * cai pela 3, a fatura FECHADA so pela 5, e a linha de outro membro do grupo so
 * pela 4.
 */
export function podeAgirNaLinha(linha: LinhaAcionavel): boolean {
  if (!linha.gravada) return false;
  if (!linha.posso_editar) return false;
  if (linha.natureza === "fatura") return false;
  return true;
}

/**
 * O DESTINO PROPRIO DA FATURA -- HMO-311 (fase 14).
 *
 * "Precisa colocar o botao de pagar tbm na fatura do cartao em despesas."
 *
 * NAO E `podeAgirNaLinha` COM UMA EXCECAO, e a diferenca nao e estilo: os dois
 * criterios se CONTRADIZEM em `gravada`, e de proposito.
 *
 *   * `podeAgirNaLinha` recusa `gravada: false` (regra 3) porque a baixa
 *     generica monta `/api/scheduled-transactions/{id}/pay` com o id da linha --
 *     e a fatura ABERTA sintetizada nao tem id de banco, so a chave
 *     `fatura:2026-10-01:<uuid>`. Aquela URL responde 404;
 *   * aqui `gravada` NAO E CONDICAO, porque este caminho nao monta aquela URL.
 *     Ele abre o dialogo, e a sequencia de escritas de `pagarAFatura`
 *     (lib/pagamento-da-fatura.ts, HMO-310) MATERIALIZA a fatura aberta pelo
 *     `POST /api/card-invoices/close` antes do `/pay` -- o id sai da resposta do
 *     `close`, nao da linha. A fatura aberta e precisamente o sabor que esta
 *     fase existe para alcancar: ela e a terceira fonte do «Previsto» da tela de
 *     Despesas, e em muitos meses a maior.
 *
 * Por isso este modulo NAO monta `PedidoDaAcao` para a fatura: pagar fatura e
 * uma ou duas escritas, e qual das duas sai de `gravada` -- a decisao e
 * `decisaoDePagamentoDaFatura`, e repetir o galho aqui seria a segunda
 * implementacao da de-duplicacao de fatura. O que esta funcao responde e so
 * "esta linha ganha o botao?".
 *
 * OS TRES CRITERIOS, e nenhum e redundante com os outros:
 *
 *   * `natureza === "fatura"` -- o criterio do botao, dito pela issue. Ele cobre
 *     os TRES sabores (aberta sintetizada, fechada na agenda, e a previsao
 *     digitada que alguem ligou ao elo da HMO-305), que e exatamente o conjunto
 *     que `pagarAFatura` sabe pagar. E e ele que impede o botao de brotar em
 *     Receitas: nenhuma linha de receita carrega a chave canonica da fatura;
 *
 *   * `origem === "previsto"` -- a regra 1 vale para esta baixa tambem. Hoje
 *     `natureza: "fatura"` NAO EXISTE no realizado (`linhaRealizada` escreve
 *     "fixa" ou "despesa", e `fatura` sai sempre `null`), entao este criterio e
 *     sobre o amanha com nome e numero: a HMO-264 ("A fatura PAGA vira
 *     Realizado") faz a fatura chegar ao lado realizado. Sem ele, no dia em que
 *     ela chegar, a tela ofereceria "Pagar" numa fatura JA PAGA -- e o `/pay`
 *     dela grava a SEGUNDA perna do mesmo dinheiro, que e como este app ja
 *     contou despesa duas vezes;
 *
 *   * `posso_editar` -- a regra 4, inteira e sem desconto. A lista de Despesas
 *     inclui linha de OUTRO membro do grupo desde a HMO-303, e **UPDATE filtrado
 *     pela RLS volta 200 sem alterar nada**: o dialogo diria "Fatura paga", o
 *     saldo nao mudaria, e a pessoa pagaria de novo pelo banco. Botao que
 *     aparece e nao funciona e pior que botao ausente.
 */
export function podePagarAFatura(linha: LinhaAcionavel): boolean {
  if (linha.natureza !== "fatura") return false;
  if (linha.origem !== "previsto") return false;
  if (!linha.posso_editar) return false;
  return true;
}

/** Regra 1 por cima da base: a baixa so existe do lado previsto. */
export function podeConfirmar(linha: LinhaAcionavel): boolean {
  return podeAgirNaLinha(linha) && linha.origem === "previsto";
}

export function podeExcluir(linha: LinhaAcionavel): boolean {
  return podeAgirNaLinha(linha);
}

/**
 * Editar, com a UNICA excecao que nao e sobre RLS: a perna de transferencia JA
 * GRAVADA.
 *
 * Abrir uma perna na tela de despesa a transformaria em despesa e deixaria a
 * outra perna ORFA -- o saldo passaria a somar sozinho, pelo valor inteiro, sem
 * nada na tela parecendo errado. E a mesma recusa que a lista de Financas
 * Pessoais ja faz (`tipoDoLancamento` devolve `null` para transferencia), e pelo
 * mesmo motivo.
 *
 * A transferencia PREVISTA nao cai aqui: ela e UMA linha de
 * `scheduled_transactions` com as duas contas dentro, e o PATCH mexe nessa
 * linha so. As duas pernas nascem na baixa, nao na agenda.
 */
export function podeEditar(linha: LinhaAcionavel): boolean {
  if (!podeAgirNaLinha(linha)) return false;
  return !(linha.origem === "realizado" && linha.tipo === "transfer");
}

/**
 * Por que o Editar esta apagado, quando esta -- ou `null` quando ele aparece.
 *
 * Existe para que o botao desabilitado tenha MOTIVO escrito: um Editar cinza
 * sem explicacao e indistinguivel de tela quebrada, e a pessoa tenta de novo.
 */
export function motivoSemEditar(linha: LinhaAcionavel): string | null {
  if (podeEditar(linha)) return null;
  if (linha.origem === "realizado" && linha.tipo === "transfer") {
    return "Transferência não se edita por aqui: são duas pernas, e abrir só uma deixaria a outra órfã.";
  }
  return null;
}

/** Um pedido HTTP pronto: o metodo, o caminho e o corpo (quando ha). */
export interface PedidoDaAcao {
  metodo: "POST" | "PATCH" | "DELETE";
  url: string;
  corpo?: Record<string, unknown>;
}

/**
 * A baixa. `null` quando a linha nao pode receber uma.
 *
 * O `null` E O CONTRATO, e nao zelo: ele e o que torna impossivel montar
 * `/api/scheduled-transactions/fatura:2026-08-01:<uuid>/pay` a partir da chave
 * sintetica da fatura aberta. Quem chama nao precisa repetir a peneira.
 */
export function pedidoDeConfirmacao(linha: LinhaAcionavel): PedidoDaAcao | null {
  if (!podeConfirmar(linha)) return null;
  return {
    metodo: "POST",
    url: `/api/scheduled-transactions/${encodeURIComponent(linha.id)}/pay`,
    // Corpo VAZIO de proposito: a rota usa `today()` do fuso de Sao Paulo
    // quando `paid_date` falta, e `amount` ausente mantem o valor previsto. Um
    // `paid_date` montado aqui seria a data do NAVEGADOR -- e num celular com o
    // fuso errado a baixa cairia no mes vizinho.
    corpo: {},
  };
}

/**
 * A exclusao. Dois destinos, e a escolha nao e cosmetica.
 *
 * A perna de transferencia JA GRAVADA sai por
 * `DELETE /api/movimentacoes/transferencia?id=`, que apaga AS DUAS. Pela rota de
 * lancamento comum a FK `ON DELETE SET NULL` do 015 nao reclama: a outra perna
 * FICA, com o elo zerado, mexendo o saldo de UMA conta. Meia transferencia nao
 * tem sintoma -- o extrato parece completo e o patrimonio esta errado pelo valor
 * inteiro. E a mesma bifurcacao que `deleteTransaction` da lista de Financas
 * Pessoais ja faz.
 */
export function pedidoDeExclusao(linha: LinhaAcionavel): PedidoDaAcao | null {
  if (!podeExcluir(linha)) return null;

  const id = encodeURIComponent(linha.id);

  if (linha.origem === "previsto") {
    return {
      metodo: "DELETE",
      url: `/api/scheduled-transactions/${id}`,
      // `apenas_esta` EXPLICITO, e nao confiando no default da rota: o alcance
      // decide se a serie inteira sai da agenda, e e a unica coisa que esta tela
      // NAO pergunta. Escrito, ele nao muda de significado no dia em que o
      // default da rota mudar. Ver lib/recorrencia-edicao.ts.
      corpo: { alcance: "apenas_esta" },
    };
  }

  if (linha.tipo === "transfer") {
    return {
      metodo: "DELETE",
      url: `/api/movimentacoes/transferencia?id=${id}`,
    };
  }

  return {
    metodo: "DELETE",
    url: `/api/personal-finance/transactions/${id}`,
  };
}

/**
 * O caminho de edicao de uma linha REALIZADA, ou `null`.
 *
 * `rotaDoFormulario` e a rota do FORMULARIO DE LANCAMENTO
 * (`/dashboard/movimentacoes/despesa`), e NAO a da tela
 * (`/dashboard/despesas`). As duas existem, as duas comecam com
 * `/dashboard/` e so uma sabe ler `?id=`: com a da tela, o Editar recarregaria
 * a propria lista com um parametro que ela ignora -- o clique nao faria
 * NADA VISIVEL. Foi exatamente o defeito que a sonda de navegador pegou no
 * codigo intacto desta issue, e nenhuma assercao de unidade o alcancava,
 * porque ela passa a string que ela mesma escolheu.
 *
 * Ela entra por PARAMETRO (vem de `AparenciaDaTela.rotaDeLancar`) para este
 * arquivo continuar folha -- importar `telaDoTipo` arrastaria
 * `telas-de-movimentacao` -> `movimentacoes`, `destino-do-lancamento`,
 * `chave-da-fatura` para dentro do grafo da sonda de navegador, por uma string.
 *
 * `?id=` e o nome que `FormularioDeLancamento` le (`parametros.get("id")`), e
 * `origem` volta para ESTA tela com o `?de=&ate=` dentro -- sem ele, fechar a
 * edicao de uma despesa de janeiro devolveria a pessoa ao mes corrente, onde ela
 * nao esta (HMO-249).
 *
 * A PREVISTA NAO TEM CAMINHO: ela nao e `financial_transactions`, e aquela tela
 * le `?id=` daquela tabela. Ela se edita no formulario em linha desta lista, por
 * `pedidoDeEdicaoDaPrevista`.
 */
export function caminhoDeEdicao(
  linha: LinhaAcionavel,
  rotaDoFormulario: string,
  origem: string | null | undefined
): string | null {
  if (!podeEditar(linha)) return null;
  if (linha.origem !== "realizado") return null;
  return comOrigem(
    `${rotaDoFormulario}?id=${encodeURIComponent(linha.id)}`,
    origem
  );
}

/** Os campos que o formulario em linha de uma conta prevista edita. */
export interface EdicaoDaPrevista {
  descricao: string;
  /** Em reais, como a pessoa digitou (ja normalizado para ponto). */
  valor: string;
  /** `AAAA-MM-DD`. */
  vencimento: string;
}

/**
 * O PATCH de uma conta prevista, ou a recusa com o motivo.
 *
 * VALIDA ANTES DE SAIR, porque as tres recusas da rota voltam 400 com texto em
 * portugues que a tela mostraria como "erro do servidor" -- e uma delas
 * (`amount <= 0`) e silenciosa de outra forma: um campo vazio vira `Number("")
 * === 0`, que nao e `NaN` e passa por qualquer guarda de `isNaN`.
 */
export function pedidoDeEdicaoDaPrevista(
  linha: LinhaAcionavel,
  edicao: EdicaoDaPrevista
): { pedido: PedidoDaAcao } | { erro: string } {
  if (!podeEditar(linha) || linha.origem !== "previsto") {
    return { erro: "Esta linha não pode ser editada por aqui." };
  }

  const descricao = edicao.descricao.trim();
  if (!descricao) return { erro: "Descrição é obrigatória." };

  // `replace` da virgula ANTES do `Number`: `Number("1.234,56")` e `NaN`, e
  // `type="number"` descarta a virgula no caminho (medido na HMO-271). O campo
  // e `type="text"` por isso.
  const valor = Number(edicao.valor.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(valor) || valor <= 0) {
    return { erro: "Valor deve ser maior que zero." };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(edicao.vencimento)) {
    return { erro: "Vencimento deve estar no formato AAAA-MM-DD." };
  }

  return {
    pedido: {
      metodo: "PATCH",
      url: `/api/scheduled-transactions/${encodeURIComponent(linha.id)}`,
      corpo: {
        description: descricao,
        amount: valor,
        due_date: edicao.vencimento,
        // Mesmo motivo do `apenas_esta` da exclusao: escrito, nao herdado.
        alcance: "apenas_esta",
      },
    },
  };
}

/**
 * O texto da confirmacao de exclusao -- e ele DIZ QUAL DAS DUAS COISAS VAI
 * ACONTECER.
 *
 * "Excluir ocorrencia nao e excluir a regra fixa", e o comportamento da rota
 * depende de a linha ter `recurring_rule_id`:
 *
 *   * linha de REGRA FIXA (`natureza: "fixa"`) -> a ocorrencia vira `skipped`;
 *     a regra continua ativa e segue gerando as proximas;
 *   * conta prevista AVULSA -> `DELETE` de verdade, a linha deixa de existir.
 *
 * As duas respondem 200 e as duas tiram a linha da tela, entao NADA no app
 * distingue uma da outra depois do clique. Quem clicou em "Excluir" num aluguel
 * fixo e viu a linha sumir concluiu que o aluguel acabou -- e ele volta no mes
 * seguinte. A frase e o unico lugar onde essa diferenca pode aparecer.
 *
 * `null` quando a linha nao pode ser excluida: a peneira de novo, para que a
 * tela nao possa perguntar sobre uma acao que nao vai acontecer.
 */
export function avisoDaExclusao(
  linha: LinhaAcionavel,
  nome: string | null
): string | null {
  if (!podeExcluir(linha)) return null;

  const rotulo = nome?.trim() ? `"${nome.trim()}"` : "este lançamento";

  if (linha.origem === "previsto") {
    if (linha.natureza === "fixa") {
      return (
        `Tirar ${rotulo} da agenda.\n\n` +
        "Isto vale SÓ para esta ocorrência. O gasto fixo continua ativo e vai " +
        "gerar as próximas — para encerrar a série inteira, use Contas a Pagar."
      );
    }
    return (
      `Excluir a conta prevista ${rotulo}.\n\n` +
      "Ela não nasceu de um gasto fixo, então é excluída de vez: não volta."
    );
  }

  if (linha.tipo === "transfer") {
    return (
      `Excluir a transferência ${rotulo}.\n\n` +
      "Ela existe nas DUAS contas. As duas pernas vão ser apagadas juntas — " +
      "apagar só uma deixaria o saldo da outra conta errado."
    );
  }

  return `Excluir ${rotulo}.\n\nO lançamento sai da sua conta e não volta.`;
}
