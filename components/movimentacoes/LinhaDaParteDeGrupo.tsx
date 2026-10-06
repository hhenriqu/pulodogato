"use client";

// -----------------------------------------------------------------------------
// UMA LINHA QUE NAO E MINHA: A MINHA PARTE DO QUE OUTRA PESSOA PAGOU (HMO-215)
// -----------------------------------------------------------------------------
// Componente proprio, e nao um ramo dentro da linha normal, porque o que ela
// NAO tem e o que importa:
//
// - SEM BOTAO DE EXCLUIR. Apagar esta linha mexeria na despesa de quem pagou, e
//   o id dela e de `group_expense_splits` -- mandar isso para
//   `/api/personal-finance/transactions/[id]` volta 404, que para quem clicou se
//   le como "o app nao conseguiu apagar". A conversa sobre o rateio acontece na
//   tela do grupo, e e para la que a linha leva.
// - SEM BOTAO DE EDITAR, pela mesma razao.
// - SEM CONTA. O dinheiro saiu da conta de outra pessoa; nao ha destino meu a
//   mostrar, e inventar um seria afirmar que a despesa passou por uma conta
//   minha.
//
// O que ela TEM, e que a linha comum nao precisa: o grupo, QUEM PAGOU, o valor
// CHEIO da despesa ao lado da minha parte (sem ele, "R$ 200,00" num jantar de
// R$ 600 nao se reconhece) e o aviso de rateio ainda nao aprovado.
//
// POR QUE ELA SAIU DE DENTRO DA PAGINA (HMO-274)
// ----------------------------------------------
// Era uma funcao no fim de `app/(dashboard)/dashboard/personal-finance/page.tsx`,
// e de la nao havia como MEDIR o que ela desenha: a pagina importa o cliente do
// Supabase, `next/navigation` e dezenas de componentes, e nada disso roda no
// `node --test`. A consequencia pratica e que toda afirmacao sobre esta linha
// teria que ser sobre o codigo-fonte dela -- e assercao textual casa com o
// comentario, nao com o que a tela mostra.
//
// Em arquivo proprio ela e renderizavel por `react-dom/server`, e o teste afirma
// sobre o HTML que sai (scripts/test-pagador-da-parte.mjs). Nada do desenho
// mudou na extracao, exceto o selo de quem pagou, que e o que a HMO-274 pede.
//
// Ela nao usa hook nenhum: e funcao pura de props. O `"use client"` esta aqui
// porque a pagina que a importa e client component e `next/link` pede cliente --
// nao porque ela tenha estado.
// -----------------------------------------------------------------------------

import Link from "next/link";
import { Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  pagadorNaLinha,
  type LancamentoDeTerceiro,
} from "@/lib/parte-de-grupo-na-lista";

/**
 * O dinheiro desta tela sai todo da MESMA funcao.
 *
 * A pagina formata moeda com um `Intl.NumberFormat` no escopo do modulo dela, e
 * duas funcoes de moeda na mesma tela e uma oportunidade de divergirem no numero
 * de casas -- a minha parte com duas e o total com uma.
 */
const formatCurrency = (value: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);

export function LinhaDaParteDeGrupo({
  parte,
  nomeDoGrupo,
}: {
  parte: LancamentoDeTerceiro;
  nomeDoGrupo: Record<string, string>;
}) {
  const grupo = nomeDoGrupo[parte.groupId];
  const pagador = pagadorNaLinha(parte.pagador);

  return (
    <Link
      href={`/dashboard/expense-groups/${parte.groupId}`}
      className="flex items-center justify-between gap-3 p-3 border rounded-lg border-dashed transition-colors hover:bg-muted/50"
    >
      {/*
        `min-w-0` nos dois niveis e `truncate` na descricao, como na linha comum:
        sem eles o minimo de min-content de um item flex estoura a largura do
        celular e a pagina inteira ganha scroll horizontal (HMO-185).
      */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center text-white"
          style={{ backgroundColor: parte.categoria?.color_hex ?? undefined }}
        >
          <Users className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="font-medium truncate">{parte.description}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {/*
              "Minha parte" e nao "Despesa": o valor ao lado NAO e o que foi
              gasto, e a fracao que cabe a mim de uma despesa maior. O selo
              generico "Despesa" faria a pessoa ler R$ 200,00 como o preco do
              jantar.
            */}
            <Badge variant="outline" className="shrink-0">
              Minha parte
            </Badge>
            {parte.categoria?.name && <span>{parte.categoria.name}</span>}
            <span>•</span>
            <span>
              {new Date(parte.transactionDate).toLocaleDateString("pt-BR")}
            </span>
            <span>•</span>
            <Badge variant="outline" className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {/*
                O nome do grupo quando ele veio, e "Grupo" quando a chamada de
                grupos falhou sem derrubar a lista. Ali "Grupo" e menos
                informacao, nao informacao errada -- a mesma regra do selo da
                linha comum.
              */}
              {grupo || "Grupo"}
            </Badge>
            {/*
              QUEM PAGOU (HMO-274).

              O selo e INCONDICIONAL. Esconde-lo quando o nome nao veio seria a
              falha que a issue pede para nao ter: a linha voltaria a ser "R$
              200,00 · Minha parte · Praia", e uma linha de parte sem nenhuma
              mencao a outra pessoa se le como despesa propria. `pagadorNaLinha`
              e quem decide o texto, e ele nunca devolve vazio.

              O `data-pagador` nao e enfeite de teste: ele e o que distingue "o
              nome veio" de "o nome nao veio" no HTML. Sem ele, um teste que
              afirma sobre o texto do selo nao consegue separar o rotulo de
              fallback de um nome que por coincidencia seja igual a ele -- e
              `title` sozinho tambem nao serve, porque ele some do texto visivel
              e ninguem repara se ele parar de sair.

              A marca sai do MESMO `pagadorNaLinha` que o texto, de proposito:
              dois calculos do mesmo booleano e o caminho para a marca dizer
              "nome" em cima de um selo em branco.
            */}
            <span>•</span>
            <span
              data-pagador={pagador.temNome ? "nome" : "sem-nome"}
              title={
                pagador.temNome
                  ? undefined
                  : "O perfil de quem pagou não está visível para você. Abra o grupo para ver quem lançou."
              }
            >
              {pagador.texto}
            </span>
            {/*
              Rateio ainda nao aprovado. A view do 033 ja descarta `rejected` e
              `expired`; `pending` entra porque o dinheiro e devido de todo
              jeito -- mas sem este selo a linha afirmaria um acerto fechado que
              ainda esta em aberto.
            */}
            {parte.splitStatus === "pending" && (
              <>
                <span>•</span>
                <Badge variant="outline" className="shrink-0">
                  a aprovar
                </Badge>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="font-semibold text-destructive">
          {formatCurrency(Math.abs(parte.amount))}
        </p>
        {/*
          O valor cheio embaixo da parte. Sem ele "R$ 200,00 · Hotel em Paraty"
          se le como o preco do hotel, e a pessoa nao tem como conferir a divisao
          sem abrir a tela do grupo.
        */}
        <p className="text-xs text-muted-foreground">
          de {formatCurrency(Math.abs(parte.totalDaDespesa))}
        </p>
      </div>
    </Link>
  );
}
