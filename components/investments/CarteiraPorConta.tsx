"use client";

// ---------------------------------------------------------------------------
// A CARTEIRA AGRUPADA POR CONTA (HMO-438, F4 da HMO-432)
// ---------------------------------------------------------------------------
// A migration 059 criou o elo ativo -> Conta Investimento e a Fase 3 fez esse
// elo valer dinheiro: a conta com ativo atrelado passou a valer
// `aplicado + rendimento` e o saldo digitado dela deixou de contar no
// patrimonio. Este bloco e onde a pessoa VE o agrupamento que o elo produziu --
// sem ele, o elo e um campo de formulario cujo efeito so aparece em outra tela.
//
// A LINHA DOS SOLTOS NAO E UM CASO DE BORDA
// -----------------------------------------
// Todo ativo cadastrado antes da 059 esta solto, entao numa carteira existente
// essa linha e a REGRA e nao a excecao. Ela existe para o total do bloco fechar
// com a carteira: sem ela, a soma das contas e menor que o "Valor Atual" do topo
// e nada na tela explica a diferenca. E ela diz, em texto, que aquele dinheiro
// nao entra em conta nenhuma -- que e verdade e e consertavel (basta atrelar).
//
// POR QUE ESTE BLOCO NAO MOSTRA O LIQUIDO DE IR
// ---------------------------------------------
// Porque ele e sobre ONDE o dinheiro esta, nao sobre quanto sobra depois do
// imposto. O liquido tem lugar proprio (`RendaFixaDaCarteira`, e o patrimonio),
// e repeti-lo aqui poria dois numeros parecidos lado a lado em cada linha --
// que e como se perde a leitura de uma tabela, nao como se ganha informacao.
//
// SEM ICONE, pelo mesmo motivo do bloco irmao em components/contas: a sonda de
// navegador monta este componente, e import novo nele e esboco novo na sonda.
// ---------------------------------------------------------------------------

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatarValor } from "@/lib/dinheiro";
import type { CarteiraPorConta as CarteiraComposta } from "@/lib/carteira-na-tela";

interface CarteiraPorContaProps {
  /** O que `comporCarteiraPorConta` devolveu. Importado com alias porque o
   *  tipo e o componente se chamam igual. */
  composta: CarteiraComposta;
  /** `id -> nome` das contas, para a linha dizer o nome e nao o uuid. */
  nomeDaConta: Record<string, string>;
}

export function CarteiraPorConta({
  composta,
  nomeDaConta,
}: CarteiraPorContaProps) {
  const { porConta, solta, rendimentoIndisponivel } = composta;

  // NADA ATRELADO E NENHUM SOLTO = carteira vazia. O bloco nao aparece, e nao
  // aparece como um card vazio dizendo "R$ 0,00": a tela de quem nunca
  // cadastrou ativo tem de ficar como era.
  if (porConta.length === 0 && !solta) return null;

  const total =
    porConta.reduce((s, l) => s + l.valor, 0) + (solta ? solta.valor : 0);

  return (
    <Card data-bloco="carteira-por-conta">
      <CardHeader>
        <CardTitle>Carteira por conta</CardTitle>
        <CardDescription>
          Onde cada ativo está. O que está atrelado a uma Conta Investimento
          entra no saldo dela e no seu patrimônio.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* O AVISO DO BANCO CENTRAL VEM PRIMEIRO: ele muda como se le TODO
            numero abaixo, e um aviso embaixo da tabela e lido depois de a
            pessoa ja ter acreditado nos valores. */}
        {rendimentoIndisponivel && (
          <p
            data-aviso="rendimento-indisponivel"
            // `text-warning` sobre o fundo da pagina, e nao
            // `text-warning-foreground` sobre `bg-warning/10`: aquele par e
            // desenhado para fundo SOLIDO, e sobre um veu de 10% o fundo real
            // ainda e o da pagina -- no tema claro o texto sairia branco sobre
            // quase branco. E o mesmo uso que o cartao de conta ja faz.
            className="rounded-md border p-2 text-xs text-warning"
          >
            Não foi possível falar com o Banco Central agora: a renda fixa
            aparece abaixo <strong>pelo valor aplicado</strong>, sem o
            rendimento. O resto da carteira não depende disso.
          </p>
        )}

        {porConta.map((linha) => (
          // `min-w-0`/`truncate` no nome e `shrink-0` no valor -- o nome da
          // conta e texto livre e e ele que estoura 320px (HMO-185).
          <div
            key={linha.account_id as string}
            data-conta={linha.account_id as string}
            className="flex items-baseline justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {nomeDaConta[linha.account_id as string] ?? "Conta"}
              </span>
              <span className="block text-xs text-muted-foreground">
                {linha.ativos === 1 ? "1 ativo" : `${linha.ativos} ativos`}
                {" · aplicado "}
                {formatarValor(linha.principal)}
                {linha.rendimento !== 0
                  ? ` · rendimento ${formatarValor(linha.rendimento)}`
                  : ""}
              </span>
            </span>
            <span
              data-valor-da-conta={linha.account_id as string}
              className="shrink-0 text-sm font-semibold tabular-nums"
            >
              {formatarValor(linha.valor)}
            </span>
          </div>
        ))}

        {/* OS SOLTOS -- ver o cabecalho. */}
        {solta && (
          <div
            data-conta="solto"
            className="flex items-baseline justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                Sem conta atrelada
              </span>
              <span className="block text-xs text-muted-foreground">
                {solta.ativos === 1 ? "1 ativo" : `${solta.ativos} ativos`} · não
                entra no saldo de nenhuma conta
              </span>
            </span>
            <span
              data-valor-da-conta="solto"
              className="shrink-0 text-sm font-semibold tabular-nums"
            >
              {formatarValor(solta.valor)}
            </span>
          </div>
        )}

        <div className="flex items-baseline justify-between gap-2 pt-1">
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            Total da carteira
          </span>
          <span
            data-valor-da-conta="total"
            className="shrink-0 text-sm font-semibold tabular-nums"
          >
            {formatarValor(total)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
