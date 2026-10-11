"use client";

// ---------------------------------------------------------------------------
// "O VALOR ACIMA É: o valor de cada parcela / o total" -- a pergunta da HMO-211
// ---------------------------------------------------------------------------
// Ela nasceu DENTRO de `CamposDeLancamento.tsx` e saiu de la na HMO-371 (F3 do
// MyBank) por um motivo so: o formulario de emprestimo do MyBank faz a MESMA
// pergunta sobre o MESMO numero, e a issue manda reusar em vez de reescrever.
//
// POR QUE REUSAR IMPORTA AQUI, E NAO E ARRUMACAO
// ---------------------------------------------
// A pergunta existe porque ler "1.000" como parcela ou como total da um
// emprestimo vinte e quatro vezes diferente. Duas copias dela divergiriam no
// primeiro dia em que alguem mudasse o texto de uma -- e o sintoma nao seria
// visual: seriam duas telas do mesmo app ensinando coisas diferentes sobre o que
// o numero digitado significa, com `serieDeParcelas` (a MESMA funcao) do outro
// lado das duas.
//
// O CONTEUDO DESCEU BYTE A BYTE do bloco antigo -- os dois `id`, o `name`, os
// dois rotulos, as classes e a ordem das opcoes. `npm run test:campos-lancamento`
// afirma `id="base_parcela"`, `id="base_total"` e a frase "O valor acima é:", e
// e ele que prova que a extracao nao mudou a tela do lancamento.
//
// RADIO NATIVO, E NAO O SELECT DO RADIX
// -------------------------------------
// Duas opcoes exclusivas das quais NENHUMA e um padrao inofensivo: radio mostra
// as duas respostas ao mesmo tempo; um select mostra uma e esconde a outra atras
// de um clique, e o valor que fica visivel passa por "o normal". E as sondas
// destas telas renderizam com `react-dom/server` e em Chromium: o Radix Select
// nao imprime o valor escolhido no servidor, e a assercao leria vazio em
// qualquer caso.
//
// AS DUAS PROPS COM DEFAULT NAO SAO CONFIGURACAO A TOA
// ---------------------------------------------------
// `rotuloDoTotal` existe porque "o total da compra" e falso num emprestimo (nao
// se compra nada); `idPrefixo` existe porque `id` de HTML e unico por documento,
// e as duas perguntas podem um dia aparecer na mesma pagina. Os dois defaults
// sao exatamente o que o bloco antigo tinha, entao o lancamento nao muda uma
// letra.
// ---------------------------------------------------------------------------

import { Label } from "@/components/ui/label";
import type { BaseDoValorParcelado } from "@/lib/lancamento";

export interface PerguntaDaBaseDoValorProps {
  valor: BaseDoValorParcelado;
  aoEscolher: (base: BaseDoValorParcelado) => void;
  /** "o total da compra" no lancamento; "o total do empréstimo" no MyBank. */
  rotuloDoTotal?: string;
  /** Prefixo dos `id` dos dois radios, para duas perguntas na mesma pagina. */
  idPrefixo?: string;
  /** O `name` do grupo de radio -- idem. */
  nome?: string;
}

export function PerguntaDaBaseDoValor({
  valor,
  aoEscolher,
  rotuloDoTotal = "o total da compra",
  idPrefixo = "",
  nome = "base_do_valor",
}: PerguntaDaBaseDoValorProps) {
  const idDaParcela = `${idPrefixo}base_parcela`;
  const idDoTotal = `${idPrefixo}base_total`;

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">O valor acima é:</legend>
      <div className="flex flex-col gap-2 sm:flex-row sm:gap-6">
        <div className="flex items-center gap-2">
          <input
            type="radio"
            id={idDaParcela}
            name={nome}
            value="parcela"
            checked={valor === "parcela"}
            onChange={() => aoEscolher("parcela")}
          />
          <Label htmlFor={idDaParcela}>o valor de cada parcela</Label>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="radio"
            id={idDoTotal}
            name={nome}
            value="total"
            checked={valor === "total"}
            onChange={() => aoEscolher("total")}
          />
          <Label htmlFor={idDoTotal}>{rotuloDoTotal}</Label>
        </div>
      </div>
    </fieldset>
  );
}
