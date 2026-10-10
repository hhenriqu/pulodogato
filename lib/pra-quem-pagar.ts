/**
 * "PRA QUEM PAGAR" NA ABA DESPESAS -- HMO-365, fase F2 da HMO-360.
 *
 * A HMO-363 (F1) escreveu a regra do pagador e a HMO-364 (F1b/F3) a ligou: a aba
 * Despesas conta BRUTO a conta de grupo que EU fronto, e a MINHA PARTE da que
 * outro membro frontou -- essa ultima carimbada com `pagar_para`
 * (`lib/regra-do-pagador.ts`). O que a issue pede agora e o outro metade da
 * frase:
 *
 *   > em Despesas exibe o quanto tenho que pagar pra ela referente ao total do
 *   > grupo e **pra quem pagar**, com **chevron que expande** e mostra detalhado
 *   > qual valor de cada coisa (assim como no dashboard)
 *
 * Ate aqui a tela sabia o VALOR e nao sabia o DESTINATARIO: `pagar_para` morria
 * dentro de `linhasDaTela`, que monta `LinhaDaTela` campo por campo e nao o
 * copia. Entao a linha da Leticia aparecia pela minha parte, certa no numero e
 * MUDA sobre a quem eu devo -- que e exatamente o estado que faz a conta do outro
 * se ler como conta propria.
 *
 * O QUE ESTE MODULO FAZ, E O QUE ELE DELIBERADAMENTE NAO FAZ
 * ---------------------------------------------------------
 * Ele AGRUPA POR DESTINATARIO e escreve o rotulo. Nao divide nada: o `amount`
 * que chega aqui JA e a minha parte, calculada por `parteConfiguradaDoMembro`
 * um passo antes. Uma segunda divisao aqui seria a terceira implementacao de
 * rateio do app -- a que empata na maioria dos casos e diverge no centavo do
 * empate de restos, que e o argumento do cabecalho da 033 e do
 * `regra-do-pagador.ts`.
 *
 * A INVARIANTE E A ENTREGA, E ELA E HERDADA DA HMO-300
 * ---------------------------------------------------
 * `soma(detalhe) === total`, por destinatario. O cabecalho de `LinhaDoDetalhe`
 * (lib/papel-de-pao.ts) diz por que: *"um chevron que abre uma lista que nao
 * fecha com o numero de cima e pior que cartao nenhum -- ele transforma um numero
 * conferivel num numero desmentido pela propria tela"*. Aqui ela sai DE GRACA, e
 * de proposito: o `total` e a soma das MESMAS linhas que vao para `detalhe`, no
 * mesmo laco, e nao uma segunda leitura. Uma segunda consulta erraria no filtro
 * de status e pareceria certa na tela.
 *
 * E E POR ISSO QUE O FILTRO DE STATUS ESTA AQUI. `STATUS_QUE_SAI_DO_PREVISTO`
 * (`paid`, `skipped`, `cancelled`) e a MESMA peneira que `linhaPrevista` aplica
 * antes de a linha entrar no cartao «Previsto». Sem ela este painel somaria a
 * conta que a Leticia ja pagou, ou a que ela pulou, e diria "pague R$ 500 para a
 * Leticia" sobre R$ 300 de divida real -- com o cartao de cima, lido da mesma
 * fonte, mostrando outro numero. Importar a constante em vez de repetir a lista
 * e o que impede as duas de divergirem no dia em que um quarto status entrar.
 *
 * O NOME PODE NAO VIR, E ISSO E CAMINHO NORMAL
 * --------------------------------------------
 * Nenhuma das tres policies de SELECT de `profiles` olha `group_members`
 * (`id = auth.uid()`, `is_public = TRUE` do 002, e "conexao aceita" do 010):
 * dividir a conta com alguem NAO da acesso ao perfil dele, e o PostgREST nao
 * levanta erro nisso -- a linha simplesmente nao vem. `is_public` tem
 * `DEFAULT true`, entao na pratica a maioria dos nomes chega, e e justamente
 * isso que torna o caminho sem nome perigoso: ele quase nunca acontece em teste
 * e acontece em producao.
 *
 * Por isso o rotulo NUNCA fica sem mencao a outra pessoa -- ver `rotuloDoDestino`.
 * Um painel de pagamento sem destinatario nomeado nao se le como "nao sei o
 * nome": se le como conta minha, e o usuario conclui que a divida e dele.
 */

import type { LinhaDoDetalhe } from "@/lib/papel-de-pao";
import {
  STATUS_QUE_SAI_DO_PREVISTO,
  valorEmReais,
} from "@/lib/telas-de-movimentacao";

/**
 * Duas casas, pelo mesmo motivo e com a mesma linha de `telas-de-movimentacao`
 * (onde ela e privada): a soma de varias partes rateadas acumula o erro de ponto
 * flutuante, e `0.1 + 0.2` desmentiria a invariante por um centesimo de centavo
 * -- um `assert.equal` reprovando com os dois numeros visivelmente iguais na
 * mensagem.
 */
const centavos = (valor: number) => Number(valor.toFixed(2));

/**
 * O que este modulo le de uma previsao ja carimbada pela regra do pagador.
 *
 * E a interseccao de `PrevistaCrua` com `ComPagarPara` -- declarada aqui, e nao
 * importada de nenhuma das duas, pela razao que `PrevistaComDono`
 * (lib/regra-do-pagador.ts) ja da: `PrevistaCrua` arrasta o grafo das telas, e
 * este modulo precisa de SEIS campos. O chamador passa o objeto inteiro sem
 * adaptar nada, porque os nomes sao os mesmos.
 */
export interface PrevistaComDestino {
  /** `scheduled_transactions.id`, ou `null` na fatura sintetizada. */
  id?: string | null;
  description?: string | null;
  /** `numeric(15,2)` chega como string pelo PostgREST. */
  amount: number | string | null;
  due_date?: string | null;
  status?: string | null;
  group_id?: string | null;
  /**
   * O carimbo de `previstasPelaRegraDoPagador`.
   *
   * `undefined` = esta linha nao e desse tipo (pessoal, ou frontada por mim);
   * `null` = e desse tipo e o `user_id` do pagador nao e legivel. Os dois sao
   * distinguiveis de proposito -- ver `ComPagarPara`.
   */
  pagar_para?: string | null;
}

/**
 * O rotulo de um destinatario, E se ele esta nomeando alguem.
 *
 * OS DOIS CAMPOS SAEM DA MESMA DECISAO, e isso e copiado de `pagadorNaLinha`
 * (lib/parte-de-grupo-na-lista.ts, HMO-274) junto com o motivo: `temNome` e o
 * que a tela marca no HTML para o teste poder separar "o nome veio" de "o nome
 * nao veio", e calcular os dois em lugares diferentes (`nome ? ... : ...` no JSX
 * e o texto aqui) e a receita do rotulo que mente. Um `full_name` de espacos em
 * branco e verdadeiro em JavaScript: a marca diria "nome" e o texto sairia
 * "Pagar para " -- e a assercao leria a MARCA, acreditaria, e passaria verde
 * sobre o selo em branco.
 */
export interface RotuloDoDestino {
  texto: string;
  temNome: boolean;
}

/** O que o painel escreve quando nao sabe nem o nome nem o grupo. */
export const DESTINO_SEM_NOME = "outro membro do grupo";

/**
 * "Pagar para Letícia", ou o rotulo honesto quando o perfil nao e legivel.
 *
 * TRES SAIDAS, E A TERCEIRA E O PONTO DO EXERCICIO:
 *
 *   | nome      | grupo   | texto                                |
 *   |-----------|---------|--------------------------------------|
 *   | "Letícia" | *       | `Pagar para Letícia`                 |
 *   | ausente   | "Casa"  | `Pagar para outro membro de Casa`    |
 *   | ausente   | ausente | `Pagar para outro membro do grupo`   |
 *
 * O NOME DO GRUPO ENTRA NO LUGAR DO NOME DA PESSOA porque ele e a unica coisa
 * que sobra para ancorar a divida em algo que o usuario reconhece. "Pagar para
 * outro membro do grupo" e verdadeiro e quase inutil quando a pessoa participa
 * de quatro grupos; "de Casa" responde onde procurar. E ele e legivel quando o
 * perfil nao e: `expense_groups` se le por `is_group_member` (007), que e
 * exatamente a checagem que `profiles` nao faz.
 *
 * NOME EM BRANCO E TRATADO COMO AUSENTE, e nao como nome vazio: `full_name` nao
 * tem NOT NULL nem CHECK de tamanho em `profiles` (001), entao `""` e `"   "`
 * sao valores que o banco aceita e que um fixture produz sem esforco. O perfil
 * legivel-e-sem-nome cai no MESMO caminho do perfil invisivel, de proposito --
 * os dois sabem a mesma coisa sobre quem receber o dinheiro.
 */
export function rotuloDoDestino(
  nome: string | null | undefined,
  grupo: string | null | undefined
): RotuloDoDestino {
  const limpo = (nome ?? "").trim();
  if (limpo) return { texto: `Pagar para ${limpo}`, temNome: true };

  const daCasa = (grupo ?? "").trim();
  return {
    texto: `Pagar para outro membro ${daCasa ? `de ${daCasa}` : "do grupo"}`,
    temNome: false,
  };
}

/** Um destinatario e tudo o que eu devo a ele no periodo. */
export interface DestinoDoPagamento {
  /**
   * `pagar_para`, ou `null` quando a linha de grupo nao tem dono legivel.
   *
   * A CHAVE DA AGREGACAO, e ela e o `user_id` e nao o nome: dois membros
   * homonimos (ou dois perfis invisiveis, os dois sem nome) viram UMA linha se o
   * nome for a chave -- somando dividas de duas pessoas num rotulo so, com o
   * total certo e o destinatario errado. Agrupar por nome tambem faria a
   * agregacao mudar quando o perfil fica visivel, que e um efeito de RLS onde
   * ninguem procura.
   */
  user_id: string | null;
  /** `full_name`, ou `null` quando o perfil nao e legivel. */
  nome: string | null;
  /** O rotulo pronto e a marca dele. Ver `rotuloDoDestino`. */
  rotulo: RotuloDoDestino;
  /**
   * Os grupos de onde a divida vem, por nome, sem repetir e em ordem.
   *
   * Plural porque uma pessoa pode frontar conta minha em dois grupos no mesmo
   * mes, e o painel soma os dois num destinatario -- e quem paga quer o total
   * por PESSOA, nao por grupo. A lista existe para a linha poder dizer de onde,
   * e e tambem de onde sai o rotulo de fallback (o primeiro nome).
   */
  grupos: string[];
  /** A soma de `detalhe`, em reais, positiva. */
  total: number;
  /** `detalhe.length`, dito de fora para a tela nao ter de contar. */
  quantidade: number;
  /** As linhas que o chevron abre. `soma(valor) === total`, por construcao. */
  detalhe: LinhaDoDetalhe[];
}

/**
 * Para quem eu tenho de pagar no periodo, do maior valor para o menor.
 *
 * `nomes` e `gruposPorId` sao os dois mapas que a rota monta
 * (`profiles` por id, `expense_groups` por id). Faltar qualquer um dos dois NAO
 * descarta linha nenhuma -- cai no rotulo de `rotuloDoDestino`, que e o caminho
 * que esta issue existe para escrever. Descartar seria o pior dos dois: a divida
 * desapareceria do painel e o cartao «Previsto» de cima continuaria contando-a.
 *
 * ORDEM: maior total primeiro, e o `user_id` desempata.
 *
 * A ordem precisa ser TOTAL e nao so "por valor": `Array.prototype.sort` e
 * estavel (ES2019+), entao sem o desempate a ordem de dois destinatarios de
 * mesmo valor seria a ordem de chegada das previsoes -- que e a ordem do
 * `ORDER BY` da consulta, e muda quando uma linha e editada. Um painel que
 * reordena sozinho entre duas leituras iguais se le como dado instavel. Com o
 * desempate pelo id, duas leituras do mesmo periodo dao a mesma tela.
 *
 * LISTA VAZIA E O CASO NORMAL: quem nao participa de grupo, e quem fronta todas
 * as contas do grupo, nao tem destinatario nenhum. A tela nao desenha o painel
 * -- ver `PainelPraQuemPagar`, que devolve `null`. "R$ 0,00 a pagar para
 * ninguem" e ruido que parece recurso quebrado.
 */
export function destinosDoPagamento(
  previstas: readonly PrevistaComDestino[],
  nomes: ReadonlyMap<string, string>,
  gruposPorId: ReadonlyMap<string, string>
): DestinoDoPagamento[] {
  /** `chave do destinatario -> o acumulador dele`. */
  const porDestino = new Map<
    string,
    {
      user_id: string | null;
      grupos: string[];
      total: number;
      detalhe: LinhaDoDetalhe[];
    }
  >();

  for (const prevista of previstas) {
    // `undefined` sai: e linha pessoal, ou de grupo frontada por MIM -- e o
    // valor cheio dela nao e divida com ninguem. `null` FICA: e linha de grupo
    // de outro membro cujo `user_id` eu nao sei ler, e ela e divida de verdade.
    // Um `if (!prevista.pagar_para)` juntaria os dois e faria a divida sem dono
    // desaparecer do painel, continuando dentro do cartao «Previsto» de cima.
    if (prevista.pagar_para === undefined) continue;

    // A MESMA peneira de `linhaPrevista`, pela constante e nao por uma copia da
    // lista -- ver o cabecalho. `String()` porque o status chega do PostgREST e
    // o tipo o deixa `null`.
    if (STATUS_QUE_SAI_DO_PREVISTO.has(String(prevista.status))) continue;

    const user_id = prevista.pagar_para;
    // `""` nao e um `user_id` possivel (a coluna e uuid), entao ele e uma chave
    // livre para o balde do "sem dono legivel" e nao pode colidir com ninguem.
    const chave = user_id ?? "";

    let destino = porDestino.get(chave);
    if (!destino) {
      destino = { user_id, grupos: [], total: 0, detalhe: [] };
      porDestino.set(chave, destino);
    }

    const grupo = prevista.group_id
      ? gruposPorId.get(prevista.group_id) ?? null
      : null;
    if (grupo && !destino.grupos.includes(grupo)) destino.grupos.push(grupo);

    // `valorEmReais` E NAO `Number(amount)`: ele e a mesma conversao que o
    // cartao «Previsto» usa (modulo, duas casas, string do PostgREST tratada), e
    // duas conversoes diferentes sobre o mesmo campo e como o painel passaria a
    // discordar do numero de cima por um centavo.
    const valor = valorEmReais(prevista.amount);

    destino.total = centavos(destino.total + valor);
    destino.detalhe.push({
      id: prevista.id ?? null,
      // `gravada` E `id !== null` E NAO `true`: a fatura sintetizada nao tem
      // linha em tabela nenhuma, e e `gravada` que decide se a linha do detalhe
      // ganha acao. Fixar `true` poria botao em cima de linha que o `PATCH` nao
      // acha -- e aqui ela nao chega hoje (fatura de cartao nao tem `group_id`),
      // o que torna o `true` uma afirmacao que nada mede.
      gravada: prevista.id != null,
      descricao: prevista.description ?? null,
      valor,
      data: prevista.due_date ?? "",
      // SEMPRE `true`: so linha com `pagar_para` chega aqui, e `pagar_para` so e
      // carimbado em linha de grupo. E o rotulo "minha parte do grupo" que o
      // renderizador desenha, e ele e load-bearing pelo motivo do cabecalho de
      // `LinhaDoDetalhe`: sem ele, metade do aluguel debaixo do nome do aluguel
      // inteiro se le como erro de digitacao.
      de_grupo: true,
      // FALHA FECHADO, e aqui o fechado e o CERTO: a linha e de outro membro do
      // grupo, e `scheduled_transactions_update` (005) exige `user_id =
      // auth.uid()`. Um botao aqui seria recusado pela RLS -- e o modo de falha
      // medido neste repositorio e pior que o 404: `UPDATE` filtrado pela RLS
      // volta 200 sem alterar nada, e o app diz "pronto" com a linha intacta.
      posso_editar: false,
      // Os tres campos de fatura sao `null` por construcao, e nao por omissao: a
      // fatura de cartao nasce sem `group_id` (`faturasPrevistasDaJanela`), logo
      // nunca recebe `pagar_para` e nunca chega neste laco. Deixa-los nulos diz
      // isso; preenche-los exigiria um elo que esta lista nao tem como ter.
      fatura: null,
      fatura_suspeita: null,
      elo_da_fatura: null,
    });
  }

  return Array.from(porDestino.values())
    .map((destino) => {
      const nome =
        destino.user_id !== null ? nomes.get(destino.user_id) ?? null : null;
      // O nome em branco vira `null` AQUI, uma vez, e nao em cada leitor: o
      // `nome` que sai no corpo e o que o rotulo usou, entao a tela nao pode
      // escrever um e marcar o outro.
      const limpo = (nome ?? "").trim() || null;

      return {
        user_id: destino.user_id,
        nome: limpo,
        rotulo: rotuloDoDestino(limpo, destino.grupos[0] ?? null),
        grupos: destino.grupos,
        total: destino.total,
        quantidade: destino.detalhe.length,
        detalhe: destino.detalhe,
      };
    })
    .sort(
      (a, b) =>
        b.total - a.total || (a.user_id ?? "").localeCompare(b.user_id ?? "")
    );
}

/**
 * O total de tudo o que eu devo a outros membros no periodo, ou `null`.
 *
 * `null` -- e nao zero -- quando nao ha destinatario, pela razao de
 * `notaDasPartesDeTerceiros`: "R$ 0,00 a pagar" na tela de quem nao participa de
 * grupo e ruido que parece recurso quebrado. A tela testa este `null` para
 * decidir se o painel existe.
 *
 * ELE NAO E UM QUARTO CARTAO, e isso e decisao da HMO-246 repetida aqui: o valor
 * JA ESTA dentro do «Previsto» de Despesas (a minha parte entrou la pela regra do
 * pagador). Um cartao novo ao lado dos tres somaria visualmente o que ja esta
 * somado -- a pessoa leria «Previsto» + «A pagar» como duas dividas.
 */
export function totalPraQuemPagar(
  destinos: readonly DestinoDoPagamento[]
): { total: number; pessoas: number } | null {
  if (destinos.length === 0) return null;

  return {
    total: centavos(destinos.reduce((soma, d) => soma + d.total, 0)),
    pessoas: destinos.length,
  };
}
