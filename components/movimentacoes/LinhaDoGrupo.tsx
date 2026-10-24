"use client";

/**
 * A LINHA "DESPESAS DO GRUPO {NOME}" DA LISTA (24/10/2026).
 *
 * O pedido do Helio: "deve ser exibido o total nomeado Despesas do Grupo
 * {nome}, e um chevron que voce pode clicar e ele mostra os custos detalhados
 * por despesa, ou clica em cima e te leva ao grupo. Abaixo, onde tem os
 * Pagamentos ao grupo, exibe as transferencias que devem ser realizadas, e um
 * icone de copia e cola."
 *
 *   * o NOME e o link para a tela do grupo;
 *   * o CHEVRON abre o detalhe (`DetalheDoGrupo`): cada despesa com a minha
 *     parte, o que eu ja paguei abatido, e o total -- que e o valor da linha;
 *   * a ESTIMATIVA leva o selo "previsto até o fechamento de 01/11", e nao tem
 *     transferencia: o Pix so existe depois do fechamento;
 *   * a CONTA DO FECHAMENTO leva os Pix que a quitam, com o copia e cola.
 *
 * O valor vem de fora (`SecaoDaTela` soma as linhas que esta agrega), e nao do
 * detalhe: a secao confere o subtotal com o cartao de cima pela soma das
 * linhas, e e essa soma que a linha do grupo tem de mostrar.
 */

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ChevronDown, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CopiarPix, type PixParaCopiar } from "@/components/movimentacoes/CopiarPix";
import {
  caminhoDoGrupo,
  seloDoGrupo,
  textoDaTransferencia,
  tituloDoGrupo,
  type GrupoNaLista,
} from "@/lib/despesas-do-grupo";

const reais = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);

const diaEMes = (iso: string) =>
  iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "—";

/** A frase que leva da transferencia para onde ela se registra. */
export const REGISTRE_O_ACERTO =
  "Depois do Pix, registre o acerto na tela do grupo: a conta dos dois lados é quitada junto.";

/**
 * O detalhe que o chevron abre. Exportado para o teste o renderizar aberto,
 * sem clique: a linha so o poe no DOM quando aberta.
 */
export function DetalheDoGrupo({
  grupo,
  total,
  id,
}: {
  grupo: GrupoNaLista;
  total: number;
  id?: string;
}) {
  // O SINAL DEPENDE DO LADO. Em Despesas o total e a minha parte menos o que
  // eu ja paguei; em Receitas e o que eu paguei menos a minha parte. A mesma
  // lista com o mesmo sinal nos dois lados diria, na linha a receber, que o
  // aluguel que eu paguei DIMINUI o que o grupo me deve.
  const aReceber = grupo.direcao === "income";
  const sinalDoAbatimento = (valor: number) =>
    aReceber ? (valor < 0 ? "− " : "") : valor < 0 ? "+ " : "− ";
  return (
    <ul
      id={id}
      data-detalhe-do-grupo={grupo.chave}
      className="mt-2 space-y-1 border-t border-border pt-2 text-sm"
    >
      {grupo.itens.map((item, indice) => (
        <li
          key={`${item.data}:${indice}`}
          className="flex items-start justify-between gap-3"
          data-item-do-grupo={indice}
        >
          <div className="min-w-0">
            <p className="truncate">{item.descricao ?? "Sem descrição"}</p>
            <p className="text-xs text-muted-foreground">
              {diaEMes(item.data)}
              {item.nome_de_quem_lancou ? ` · lançada por ${item.nome_de_quem_lancou}` : ""}
              {item.prevista ? " · prevista" : ""}
              {` · total ${reais(item.valor_cheio)}`}
            </p>
          </div>
          <span className="shrink-0" data-minha-parte={item.minha_parte}>
            {aReceber ? "− " : ""}
            {reais(item.minha_parte)}
          </span>
        </li>
      ))}
      {grupo.abatimentos.map((a) => (
        <li
          key={a.rotulo}
          className="flex items-start justify-between gap-3 text-muted-foreground"
          data-abatimento={a.rotulo}
        >
          <span>{a.rotulo}</span>
          <span className="shrink-0">
            {sinalDoAbatimento(a.valor)}
            {reais(Math.abs(a.valor))}
          </span>
        </li>
      ))}
      <li className="flex items-start justify-between gap-3 border-t border-border pt-1 font-medium">
        <span>{grupo.direcao === "income" ? "A receber" : "Sua parte"}</span>
        <span className="shrink-0" data-total-do-detalhe={total}>
          {reais(total)}
        </span>
      </li>
    </ul>
  );
}

/** Os Pix que quitam a conta do fechamento, cada um com o copia e cola. */
export function TransferenciasDoGrupo({
  grupo,
  chavesPix,
}: {
  grupo: GrupoNaLista;
  chavesPix: Readonly<Record<string, PixParaCopiar>>;
}) {
  if (grupo.transferencias.length === 0) return null;
  return (
    <div className="mt-2 space-y-1 rounded-md bg-muted/40 px-2 py-2" data-transferencias={grupo.chave}>
      {grupo.transferencias.map((t) => (
        <div
          key={t.para_user_id}
          className="flex items-center justify-between gap-2 text-sm"
          data-transferencia={t.para_user_id}
        >
          <span>{textoDaTransferencia(t)}</span>
          <CopiarPix pix={chavesPix[t.para_user_id] ?? null} valor={t.valor} nome={t.nome} />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        {REGISTRE_O_ACERTO.split("tela do grupo")[0]}
        <Link
          href={caminhoDoGrupo(grupo.group_id) as Route}
          className="underline hover:text-foreground"
        >
          tela do grupo
        </Link>
        {REGISTRE_O_ACERTO.split("tela do grupo")[1]}
      </p>
    </div>
  );
}

export function LinhaDoGrupo({
  grupo,
  valor,
  descricao,
  vencida = false,
  chavesPix = {},
}: {
  grupo: GrupoNaLista;
  /** A soma das linhas da lista que esta agrega. */
  valor: number;
  /** A descricao da linha agregada, quando ha uma so ("Pagamento ao grupo Casa"). */
  descricao?: string | null;
  vencida?: boolean;
  chavesPix?: Readonly<Record<string, PixParaCopiar>>;
}) {
  const [aberto, setAberto] = useState(false);

  const titulo =
    grupo.tipo === "conta_do_fechamento" && descricao ? descricao : tituloDoGrupo(grupo);
  const selo = seloDoGrupo(grupo);
  const id = `grupo-${grupo.chave.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const podeAbrir = grupo.itens.length > 0;
  const quantas = grupo.itens.length;

  return (
    <div
      className="border-b border-border py-2 last:border-0"
      data-grupo-na-lista={grupo.chave}
      data-tipo-do-grupo={grupo.tipo}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="truncate font-medium">
            <Link
              href={caminhoDoGrupo(grupo.group_id) as Route}
              className="text-foreground hover:underline"
            >
              {titulo}
            </Link>
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" aria-label="grupo" />
              <span>grupo</span>
            </span>
            {selo && (
              <span
                className={grupo.tipo === "estimativa" ? "font-medium text-warning" : undefined}
                data-selo-do-grupo={grupo.tipo}
              >
                · {selo}
              </span>
            )}
            {quantas > 0 && (
              <span>
                · {quantas} {quantas === 1 ? "despesa" : "despesas"}
              </span>
            )}
            {vencida && <span className="text-destructive">· vencida</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <p className="font-semibold" data-valor-do-grupo={valor}>
            {reais(valor)}
          </p>
          {podeAbrir && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              aria-expanded={aberto}
              aria-controls={`${id}-detalhe`}
              aria-label={`${aberto ? "Esconder" : "Ver"} as despesas de ${titulo}`}
              onClick={() => setAberto((estava) => !estava)}
            >
              <ChevronDown
                className={`h-4 w-4 transition-transform ${aberto ? "rotate-180" : ""}`}
              />
            </Button>
          )}
        </div>
      </div>

      {podeAbrir && aberto && (
        <DetalheDoGrupo grupo={grupo} total={valor} id={`${id}-detalhe`} />
      )}

      {grupo.direcao === "expense" && (
        <TransferenciasDoGrupo grupo={grupo} chavesPix={chavesPix} />
      )}
    </div>
  );
}
