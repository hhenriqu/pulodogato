"use client";

// -----------------------------------------------------------------------------
// "QUEM ME PAGA" NA ABA RECEITAS -- HMO-422
// -----------------------------------------------------------------------------
// A issue, na voz do Helio, olhando a aba Receitas:
//
//   > Previsto / R$ 508,42 / o que ainda esta previsto entrar no periodo
//   > inclui R$ 508,42 de reembolso previsto de 2 pessoas em 1 grupo
//   > Previsto no periodo (0)
//   > Nenhum lancamento previsto neste periodo.
//   >
//   > os 508,42 nao deveria estar aparecendo?
//
// Deveria. O numero estava CERTO e a tela estava MUDA: desde a HMO-364 o
// reembolso de grupo entra no «Previsto» de Receitas, desde a HMO-379 a legenda
// do cartao diz quantas pessoas e quantos grupos -- e QUEM sao as pessoas e
// QUAL e o grupo nao apareciam em lugar nenhum desta aba. Para conferir os
// R$ 508,42 era preciso trocar de tela (/dashboard/personal-finance, bloco
// "A receber dos grupos", HMO-245).
//
// A ASSIMETRIA ERA O DEFEITO, E ELA TINHA UM LADO PRONTO
// -----------------------------------------------------
// A aba DESPESAS ja lista as pessoas da parte simetrica desde a HMO-365:
// `PainelPraQuemPagar` mostra para QUEM pagar a minha parte das contas que
// outro frontou, e diz por escrito que o valor ja esta dentro do «Previsto»
// (`NOTA_PRA_QUEM_PAGAR`). Receitas tinha a outra metade do mesmo rateio -- o
// que os outros me devem -- sem painel nenhum. Este arquivo e aquele espelho,
// e as tres decisoes de desenho sao HERDADAS dele, nao novas:
//
//   * NAO E UM QUARTO CARTAO. O valor ja esta somado no «Previsto»; um cartao a
//     mais na fileira seria lido como uma segunda receita, e a pessoa concluiria
//     que vai receber o dobro. O painel vive DEBAIXO dos cartoes e a nota diz
//     que ele nao e acrescimo;
//   * NAO E LINHA DA LISTA, e isso e decisao da HMO-379 que esta issue NAO
//     reverte. Fabricar `LinhaDaTela` para este credito daria os botoes de
//     `posso_editar` -- Editar, Excluir e Confirmar -- sobre um id que nao
//     existe em `scheduled_transactions`; `lib/acoes-da-linha.ts` montaria
//     `/api/scheduled-transactions/<id>/pay` para um credito que nasce de
//     `fecharMes`, e `UPDATE` recusado pela RLS volta 200 sem alterar nada, ou
//     seja o app diria "pronto" e nada teria acontecido. Painel proprio, sem
//     acao nenhuma, e o que da o nome sem dar o botao errado;
//   * PROPS ENTRAM, MARCACAO SAI, sem hook de rede: a mesma razao de
//     `CartoesDaTela` e de `PainelPraQuemPagar` estarem em arquivo proprio --
//     `TelaDeMovimentacao.tsx` importa `next/navigation`, que NAO roda no node,
//     e um componente que dependa dele nao pode ser medido por sonda nenhuma.
//
// AS DUAS CLASSES DE DEFEITO QUE SO A MARCACAO DENUNCIA
// ----------------------------------------------------
//   1. O ROTULO SEM A PESSOA. `devedor` e `null` quando o perfil nao e legivel,
//      e esse caminho e NORMAL -- nenhuma policy de SELECT de `profiles` olha
//      `group_members`, entao dividir a conta com alguem nao da acesso ao
//      perfil dele. Um `{linha.devedor}` solto renderiza NADA, e uma linha
//      "R$ 53,30 · Casa" sem mencao a outra pessoa se le como receita propria
//      -- e, pior, como receita JA RECEBIDA. Nenhum teste de funcao pura
//      alcanca "nao aparece"; so ler o HTML alcanca. Por isso o texto vem
//      PRONTO da lib (`devedorNaLinha`) e o `data-tem-nome` sai da MESMA
//      decisao, como no painel irmao;
//   2. O SALDO SEM DEVEDOR DESAPARECENDO. `total` e a soma das LINHAS, de
//      proposito (HMO-245), e o resto do saldo positivo vira `sem_devedor`. Sem
//      a linha final deste painel, a soma visivel fica ABAIXO do numero que a
//      legenda do cartao cita, e a unica forma de achar a diferenca seria somar
//      a lista a mao -- o defeito que `CreditoAReceber.sem_devedor` existe para
//      nao ter.
// -----------------------------------------------------------------------------

import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { devedorNaLinha, type CreditoAReceber } from "@/lib/credito-de-grupo";

/**
 * O titulo do painel.
 *
 * Exportado para a sonda afirmar sobre ESTE texto e nao sobre uma copia dele --
 * o mesmo motivo de `TITULO_PRA_QUEM_PAGAR` e de `DEVEDOR_SEM_NOME`.
 */
export const TITULO_QUEM_ME_PAGA = "Quem te paga";

/**
 * A frase que diz que este valor NAO e um acrescimo aos cartoes.
 *
 * Irma exata de `NOTA_PRA_QUEM_PAGAR`, com o sinal trocado, e ela e entrega e
 * nao enfeite: sem ela o painel apresenta um total que a pessoa vai somar ao
 * «Previsto» de cima, concluindo que vai receber o dobro. O valor daqui JA
 * ESTA la dentro.
 *
 * E ela diz PREVISTO em voz alta pela razao escrita em `CartoesDaTela`: o risco
 * de leitura e o contrario do da despesa -- "a receber" numa tela de receita se
 * le como dinheiro que ja entrou, e a Lais pode nao pagar.
 */
export const NOTA_QUEM_ME_PAGA =
  "já incluído no Previsto acima — é o reembolso do grupo, e ainda não entrou na sua conta";

/**
 * O painel, ou `null` quando ninguem me deve nada.
 *
 * `null` -- e nao um painel com "R$ 0,00" -- pela razao de
 * `notaDoCreditoAReceber` e de `resumoComReembolsoPrevisto`: "R$ 0,00 a receber
 * de grupos" na tela de quem nao participa de grupo nenhum e ruido que parece
 * recurso quebrado. A lista vazia e o caso NORMAL, nao o de borda.
 *
 * `credito` pode ser `null` e isso NAO e o mesmo que vazio: e a resposta que
 * nao fala de credito (corpo guardado no aparelho de antes desta issue, ou as
 * outras duas abas). Os dois casos dao o mesmo painel -- nenhum --, e por isso o
 * teste e um so aqui; quem precisa distinguir e `quem_me_paga` na rota, onde um
 * `[]` seria uma afirmacao.
 */
export function PainelQuemMePaga({
  credito,
}: {
  credito: CreditoAReceber | null;
}) {
  if (!credito || credito.linhas.length === 0) return null;

  return (
    <Card data-painel="quem-me-paga">
      <CardContent className="pt-6 pb-6">
        <p className="text-sm text-muted-foreground">{TITULO_QUEM_ME_PAGA}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {NOTA_QUEM_ME_PAGA}
        </p>

        <div className="mt-4 space-y-3">
          {credito.linhas.map((linha) => {
            // O TEXTO VEM PRONTO DA LIB, e o `temNome` sai da MESMA decisao.
            // Calcular a marca aqui com um `linha.devedor ? "sim" : "nao"` seria
            // a receita do rotulo que mente: um `full_name` de espacos em branco
            // e verdadeiro em JavaScript, a marca diria "sim", o texto sairia
            // vazio, e a assercao leria a marca e passaria verde sobre o rotulo
            // em branco. `devedorNaLinha` faz o `trim()` e tem teste.
            const devedor = devedorNaLinha(linha);

            return (
              <div
                // A CHAVE E O PAR (grupo, devedor), e nao so o `devedor_user_id`:
                // `creditoAReceber` agrega UMA linha por (grupo, devedor), entao
                // a mesma pessoa pode me deverem DOIS grupos e as duas linhas
                // sao legitimas. Com a chave so do devedor o React juntaria as
                // duas e uma delas sumiria da tela com o total do cartao
                // continuando a conta-la.
                key={`${linha.group_id}:${linha.devedor_user_id}`}
                data-devedor={linha.devedor_user_id}
                className="flex items-baseline justify-between gap-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm break-words">{devedor.texto}</p>
                  <p
                    className="text-xs text-muted-foreground"
                    data-tem-nome={devedor.temNome ? "sim" : "nao"}
                  >
                    {linha.grupo}
                  </p>
                </div>

                <span
                  className="shrink-0 text-sm font-medium"
                  data-valor-do-devedor={linha.valor}
                >
                  {formatCurrency(linha.valor)}
                </span>
              </div>
            );
          })}

          {/*
            O SALDO SEM DEVEDOR NOMEADO, quando ha -- a classe (2) do cabecalho.

            `> 0` e nao `!== 0`: `creditoSemDevedorCents` nunca devolve negativo,
            e um "mais -R$ 0,01 sem devedor" seria pior que a omissao.

            O TEXTO E BYTE A BYTE o do bloco "A receber dos grupos" de
            /dashboard/personal-finance, de proposito: os dois paineis leem o
            MESMO campo da MESMA lib, e dois textos diferentes para o mesmo
            numero se leem como dois numeros por quem compara as duas telas --
            que e a familia de defeito que esta aba inteira paga desde a
            `despesa-de-grupo-tem-tres-convencoes`. Ele nao e constante
            compartilhada porque extrai-la mexeria naquela pagina (que esta
            fora do escopo desta issue); quem os mantem juntos e esta frase.
          */}
          {credito.sem_devedor > 0 && (
            <p
              className="text-xs text-muted-foreground"
              data-sem-devedor={credito.sem_devedor}
            >
              mais {formatCurrency(credito.sem_devedor)} sem devedor
              identificado no acerto
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
