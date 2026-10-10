"use client";

// -----------------------------------------------------------------------------
// "PRA QUEM PAGAR" NA ABA DESPESAS -- HMO-365, fase F2 da HMO-360
// -----------------------------------------------------------------------------
// A issue, na voz do Helio:
//
//   > em Despesas exibe o quanto tenho que pagar pra ela referente ao total do
//   > grupo e **pra quem pagar**, com **chevron que expande** e mostra detalhado
//   > qual valor de cada coisa (assim como no dashboard)
//
// "Assim como no dashboard" nomeia um componente que existe: o chevron de
// `NumeroGrande` (PainelDePapel.tsx, HMO-300), com `aria-expanded`,
// `aria-controls` e a invariante `soma(detalhe) === total`. A linha da lista e
// literalmente a MESMA funcao -- `LinhaDeDetalhe`, extraida nesta issue para os
// dois paineis a dividirem (ver o cabecalho dela).
//
// NAO E UM QUARTO CARTAO, E ISSO E DECISAO HERDADA
// -----------------------------------------------
// O valor JA ESTA dentro do «Previsto» de Despesas: a regra do pagador (HMO-363)
// pos a minha parte la. Um cartao novo na fileira dos tres somaria visualmente o
// que ja esta somado, e a pessoa leria «Previsto» + «A pagar» como duas dividas
// -- o erro que a HMO-246 ja decidiu nao cometer com o vencido, pelo mesmo
// motivo. Entao este painel vive DEBAIXO dos cartoes, e o texto dele diz, em
// voz alta, que o valor nao e um acrescimo.
//
// POR QUE ELE E UM COMPONENTE SEM HOOK DE REDE
// -------------------------------------------
// Props entram, marcacao sai -- a mesma razao de `CartoesDaTela` estar em arquivo
// proprio: `TelaDeMovimentacao.tsx` importa `next/navigation`, que NAO roda no
// node, e um componente de tela que dependa dele nao pode ser medido por sonda
// nenhuma. O estado do chevron (`aberto`) e local e nao vai para a URL, como no
// painel do dashboard.
//
// AS DUAS CLASSES DE DEFEITO QUE SO A MARCACAO DENUNCIA
// ----------------------------------------------------
//   1. O ROTULO SEM A PESSOA. Quando `full_name` nao e legivel (nenhuma policy
//      de `profiles` olha `group_members`), um `{destino.nome}` solto renderiza
//      NADA -- e uma linha de pagamento sem destinatario nao se le como "nao sei
//      o nome": se le como conta minha. Nenhum teste de funcao pura alcanca
//      "nao aparece"; so ler o HTML alcanca. Por isso o texto vem PRONTO da lib
//      (`rotuloDoDestino`), e o `data-tem-nome` ao lado sai da MESMA decisao.
//
//   2. O CHEVRON QUE ABRE A LISTA ERRADA. Com `aria-controls` apontando para um
//      id repetido entre destinatarios, abrir o da Leticia abriria o da Ana --
//      os dois valores certos, nos lugares trocados. E por isso que o id leva o
//      `user_id` e que a sonda escopa a leitura por destinatario.
// -----------------------------------------------------------------------------

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { LinhaDeDetalhe } from "@/components/papel-de-pao/LinhaDeDetalhe";
import type { DestinoDoPagamento } from "@/lib/pra-quem-pagar";

/**
 * O titulo do painel.
 *
 * Exportado para a sonda afirmar sobre ESTE texto e nao sobre uma copia dele --
 * o mesmo motivo de `PAGADOR_SEM_NOME` e das tres constantes do papel de pao.
 */
export const TITULO_PRA_QUEM_PAGAR = "Pra quem pagar";

/**
 * A frase que diz que este valor NAO e um acrescimo aos cartoes.
 *
 * Ela e entrega e nao enfeite, e e a mesma familia da `LEGENDA_DO_BRUTO`: sem
 * ela o painel apresenta um total que a pessoa vai somar ao «Previsto» de cima,
 * concluindo que deve o dobro. O valor daqui JA ESTA la dentro.
 */
export const NOTA_PRA_QUEM_PAGAR =
  "já incluído no Previsto acima — é a sua parte das contas que outra pessoa lançou";

/**
 * O painel, ou `null` quando nao ha ninguem a quem pagar.
 *
 * `null` -- e nao um painel com "R$ 0,00" -- pela razao de
 * `notaDasPartesDeTerceiros`: quem nao participa de grupo, e quem fronta todas
 * as contas do grupo, nao tem destinatario nenhum, e um painel vazio ali e ruido
 * que parece recurso quebrado. A lista vazia e o caso NORMAL, nao o de borda.
 */
export function PainelPraQuemPagar({
  destinos,
}: {
  destinos: readonly DestinoDoPagamento[];
}) {
  if (destinos.length === 0) return null;

  return (
    <Card data-painel="pra-quem-pagar">
      <CardContent className="pt-6 pb-6">
        <p className="text-sm text-muted-foreground">
          {TITULO_PRA_QUEM_PAGAR}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {NOTA_PRA_QUEM_PAGAR}
        </p>

        <div className="mt-4 space-y-3">
          {destinos.map((destino) => (
            <Destinatario
              // O `user_id` e a chave, e o balde sem dono tem a dele: ver
              // `DestinoDoPagamento.user_id` -- agrupar por nome juntaria dois
              // homonimos num rotulo so.
              key={destino.user_id ?? "sem-dono"}
              destino={destino}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * UM destinatario: o rotulo, o total e o chevron que abre o detalhe.
 *
 * COMPONENTE PROPRIO PORQUE O ESTADO E POR DESTINATARIO. Um `useState` no painel
 * guardaria UM booleano para a lista inteira, e abrir a Leticia abriria a Ana
 * junto -- o mesmo motivo pelo qual o estado do dashboard e por cartao e nao por
 * painel ("abrir as contas nao e pedir para abrir o salario"). Fechado por
 * padrao.
 */
function Destinatario({ destino }: { destino: DestinoDoPagamento }) {
  const [aberto, setAberto] = useState(false);

  // `""` nao e um uuid possivel, entao o balde sem dono nao pode colidir com o
  // id de ninguem. Sem isto os `aria-controls` de dois destinatarios
  // apontariam para o mesmo `<ul>`.
  const id = `pra-quem-pagar-${destino.user_id ?? "sem-dono"}`;

  /**
   * A lista SO EXISTE NO DOM QUANDO ABERTA, e nao escondida com `hidden`.
   *
   * Medido neste repositorio e escrito no cabecalho de `NumeroGrande`: `hidden`
   * NAO tira o texto do `textContent`, e a sonda que mede "abrir mostra as
   * linhas" ficaria verde com o chevron inteiramente desligado.
   */
  const podeAbrir = destino.detalhe.length > 0;

  return (
    <div data-destinatario={destino.user_id ?? ""}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm break-words" data-rotulo-do-destino={id}>
            {/* O TEXTO VEM PRONTO DA LIB, e o `data-tem-nome` sai da MESMA
                decisao (`rotuloDoDestino` devolve os dois). Calcular a marca
                aqui com um `destino.nome ? "sim" : "nao"` seria a receita do
                rotulo que mente: um `full_name` de espacos em branco e
                verdadeiro em JavaScript, a marca diria "sim" e o texto sairia
                "Pagar para " -- e a assercao leria a marca e passaria verde
                sobre o selo em branco. */}
            {destino.rotulo.texto}
          </p>
          <p
            className="text-xs text-muted-foreground"
            data-tem-nome={destino.rotulo.temNome ? "sim" : "nao"}
          >
            {destino.quantidade}{" "}
            {destino.quantidade === 1 ? "conta" : "contas"}
            {/* O GRUPO DITO POR EXTENSO quando ha nome da pessoa. Quando NAO ha,
                o nome do grupo ja esta dentro do rotulo ("outro membro de
                Casa") e repeti-lo aqui diria a mesma coisa duas vezes na mesma
                linha. */}
            {destino.rotulo.temNome && destino.grupos.length > 0
              ? ` · ${destino.grupos.join(", ")}`
              : ""}
          </p>
        </div>

        <span
          className="shrink-0 text-sm font-medium"
          data-total-do-destino={destino.total}
        >
          {formatCurrency(destino.total)}
        </span>

        {podeAbrir && (
          <Button
            id={`${id}-chevron`}
            variant="ghost"
            size="icon"
            className="shrink-0"
            aria-expanded={aberto}
            aria-controls={`${id}-detalhe`}
            // O rotulo diz o que o clique VAI fazer e troca com o estado: "Ver
            // os detalhes" num botao ja aberto manda o leitor de tela para o
            // lado errado. O rotulo do destino entra nele para que dois
            // chevrons na mesma tela nao tenham o mesmo nome acessivel.
            aria-label={`${aberto ? "Esconder" : "Ver"} os detalhes de ${destino.rotulo.texto}`}
            onClick={() => setAberto((estava) => !estava)}
          >
            <ChevronDown
              className={`h-5 w-5 transition-transform ${aberto ? "rotate-180" : ""}`}
            />
          </Button>
        )}
      </div>

      {podeAbrir && aberto && (
        <ul
          id={`${id}-detalhe`}
          data-detalhe-do-destino={destino.user_id ?? ""}
          className="mt-2 space-y-2 border-t pt-2"
        >
          {destino.detalhe.map((linha, indice) => (
            <LinhaDeDetalhe
              // `id` pode ser `null` (a fatura sintetizada nao chega aqui, mas
              // o tipo o permite); o indice desempata. A lista nao e
              // reordenavel nem editavel, entao o indice nao carrega o problema
              // que ele carrega noutras listas.
              key={linha.id ?? `${linha.data}:${indice}`}
              linha={linha}
              // SEM `aoConcluirElo`, e isso DESLIGA a acao do elo da fatura por
              // contrato (ver `LinhaDeDetalhe`): nenhuma linha daqui e minha, e
              // ligar o elo e um `UPDATE` que a RLS recusa devolvendo 200 sem
              // alterar nada -- o app diria "pronto" com a linha intacta.
            />
          ))}
        </ul>
      )}
    </div>
  );
}
