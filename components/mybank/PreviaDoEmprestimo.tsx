"use client";

// ---------------------------------------------------------------------------
// A PREVIA DO EMPRESTIMO -- as quatro grandezas antes do clique (HMO-448)
// ---------------------------------------------------------------------------
// F3 da HMO-444. A issue pede, com estas palavras: "mostrando qual sera o valor
// total, ou se eu colocar valor total vejo quanto de juros estou cobrando".
//
// ESTE COMPONENTE NAO CALCULA NADA, E E ISSO QUE O TORNA CONFIAVEL
// ---------------------------------------------------------------
// Ele recebe a lista pronta de `previaDoEmprestimo` (lib/emprestimo-do-mybank)
// e desenha. Os rotulos, a formatacao do dinheiro e a do percento vivem todos
// na funcao pura, onde tem teste -- escritos aqui no JSX, passariam por
// qualquer suite intactos.
//
// O defeito que esta separacao existe para impedir tem nome neste repositorio:
// `previa-na-tela-tem-que-usar-o-peso-do-fechamento`. Lá a tela chamava a
// funcao de producao certa com o ARGUMENTO errado; o total fechava, nada na
// tela denunciava, e a diferenca era de 13 centavos por mes. Uma previa com
// `if` proprio divergiria da rota na primeira mudanca, e o sintoma seria a tela
// prometendo um total que o banco nao grava.
//
// DEPENDENCIA DE PROPOSITO MINIMA: nenhum `components/ui/*`, nenhum icone.
// A sonda de navegador (`scripts/test-previa-do-emprestimo-na-tela.mjs`) monta
// este componente numa pagina `file://` concatenando os `.js` compilados, e
// todo import que nao for compilado vira um esboco -- e cada esboco e um lugar
// onde a sonda deixa de falar do codigo de producao
// (`provar-handler-react-em-chromium-commitado`).
// ---------------------------------------------------------------------------

import type { GrandezaDaPrevia } from "@/lib/emprestimo-do-mybank";

export interface PreviaDoEmprestimoProps {
  /** A lista de `previaDoEmprestimo`. `null` = nao ha o que mostrar ainda. */
  grandezas: GrandezaDaPrevia[] | null;
}

export function PreviaDoEmprestimo({ grandezas }: PreviaDoEmprestimoProps) {
  // `null` NAO DESENHA NADA, e nao uma caixa com quatro "R$ 0,00": quatro zeros
  // se leem como um emprestimo de valor zero ja calculado, e nao como "falta
  // preencher". Quem decidiu isso foi a funcao pura, devolvendo `null`.
  if (!grandezas) return null;

  return (
    <div
      id="mybank-previa"
      data-previa
      className="rounded-md border border-border bg-muted/50 p-3"
    >
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Antes de emprestar, confira:
      </p>
      <dl className="space-y-1">
        {grandezas.map((grandeza) => (
          <div
            key={grandeza.chave}
            // `data-grandeza` E A ANCORA DA SONDA, e ela e a chave e nao o
            // rotulo: rotulo e texto de produto e muda sem nada estar errado,
            // e sonda ancorada em texto reprova a mudanca certa.
            data-grandeza={grandeza.chave}
            className="flex items-baseline justify-between gap-3 text-sm"
          >
            <dt className="text-muted-foreground">{grandeza.rotulo}</dt>
            {/* O valor num SPAN proprio, e nao no texto da linha: o React
                escreve `value` de input como PROPRIEDADE e o `--dump-dom` so
                mostra o atributo inicial -- por isso a sonda afirma sobre
                elemento de texto, nunca sobre campo. Aqui nao ha input, mas a
                regra que escolheu este `<dd>` e a mesma. */}
            <dd data-valor className="font-medium tabular-nums">
              {grandeza.valor}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
