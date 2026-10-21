"use client";

// ---------------------------------------------------------------------------
// O SELETOR DE MODO E OS DOIS SENTIDOS DO JURO (HMO-448)
// ---------------------------------------------------------------------------
// F3 da HMO-444. Tres modos -- `sem juros` / `% de juros` / `total a receber` --
// e o seletor SUBSTITUI a pergunta `parcela|total` da HMO-211 **so nos dois
// modos com juro**.
//
// POR QUE SUBSTITUI, E NAO CONVIVE
// --------------------------------
// Com juro a serie e montada sobre o TOTAL A RECEBER (ver `valorQueMontaASerie`),
// entao a base e `total` por construcao. Deixar a pergunta na tela ofereceria
// uma escolha que o servidor ignora -- e `base: "parcela"` com juro, se chegasse
// a ser respeitada, multiplicaria o total por N: um emprestimo de R$ 1.000 a 20%
// em 12x viraria uma divida de R$ 14.400 com a taxa gravada dizendo 20%.
//
// UM CAMPO POR VEZ, E O OUTRO NEM E DESENHADO
// -------------------------------------------
// `tresCamposDoEmprestimo` (F2) RECUSA taxa e total juntos, e recusa de
// proposito: os dois podem discordar (R$ 1.000 a 20% com total R$ 1.500) e nao
// ha resposta certa -- escolher um calado faz a tela apagar um numero que a
// pessoa digitou. A tela honra isso nao oferecendo os dois: so o campo do modo
// escolhido existe no DOM.
//
// ESTE COMPONENTE NAO TEM ARITMETICA, E A PREVIA DELE E A DO FECHAMENTO
// --------------------------------------------------------------------
// Ele e so os campos. Quem resolve os tres campos e `juroDoPedido`, no pai, com
// a MESMA funcao que a rota chama -- e e o `juro` resolvido que desce para a
// `PreviaDoEmprestimo`. Ver `previa-na-tela-tem-que-usar-o-peso-do-fechamento`.
//
// DEPENDENCIA MINIMA DE PROPOSITO: nenhum `components/ui/*` e nenhum icone, pela
// mesma razao de `PreviaDoEmprestimo` -- a sonda de navegador concatena os `.js`
// compilados numa pagina `file://`, e cada import nao compilado vira um esboco
// que deixa a sonda de falar do codigo de producao.
//
// O CAMPO DE DINHEIRO E UM `input` COM A MASCARA DE `lib/dinheiro.ts`, E NAO O
// `CampoDeValor`
// ---------------------------------------------------------------------------
// `CampoDeValor` arrasta `components/ui/input` e a `CalculadoraDeValor`, e as
// duas levariam a sonda a esbocar justamente o caminho do dinheiro. O que
// importa daquele componente e a CONVENCAO -- exibir "R$ 1.200,00" e emitir
// "1200.00", porque `parseFloat("1.200,00")` e 1 e mil reais entrariam como um
// real sem erro no caminho (`dinheiro-ts-ja-e-o-teclado-e-a-convencao-e-centavos`).
// A convencao e `aoDigitarValor`/`valorParaExibicao`, e sao ELAS que estao aqui,
// de `lib/dinheiro.ts`, que e a mesma fonte que o `CampoDeValor` usa. O cromo
// (a calculadora) fica no campo do pai, que continua sendo `CampoDeValor`.
// ---------------------------------------------------------------------------

import {
  MODOS_DO_JURO,
  rotuloDoModo,
  type ModoDoJuro,
} from "@/lib/emprestimo-do-mybank";
import { MOEDA_PADRAO, aoDigitarValor, valorParaExibicao } from "@/lib/dinheiro";

export interface CamposDeJurosProps {
  modo: ModoDoJuro;
  aoEscolherModo: (modo: ModoDoJuro) => void;
  /** A taxa em PERCENTO, como o estado do formulario guarda ("20"). */
  taxa: string;
  aoDigitarTaxa: (taxa: string) => void;
  /** O total a receber, plano em reais ("1200.00"). */
  total: string;
  aoDigitarTotal: (total: string) => void;
  /** `id` unico por documento. */
  idPrefixo?: string;
  /**
   * COMO CHAMAR CADA MODO. O padrao e `rotuloDoModo` (a CRIACAO), e o dialogo de
   * AJUSTE passa `rotuloDoModoDoAjuste` (HMO-480).
   *
   * Os tres modos querem dizer outra coisa nos dois lugares: na criacao,
   * `sem_juros` e um emprestimo a juro zero; no ajuste, e "nao mexer no juro" --
   * nenhum campo de juro no corpo do PATCH. Mostrar "Sem juros" la seria uma
   * frase FALSA sobre o que o botao faz, e o custo e dinheiro: quem lesse "Sem
   * juros" marcado acreditaria estar zerando o juro, e nao estaria.
   *
   * UMA PROP E NAO UM SEGUNDO COMPONENTE, porque o que importa aqui e a
   * EXCLUSIVIDADE -- um modo so, logo um campo so no DOM, logo
   * `taxa_e_total_juntos` inalcancavel. Um `CamposDeJurosDoAjuste` copiado
   * teria de reproduzir essa mecanica e divergiria na primeira mudanca.
   *
   * O TEXTO CONTINUA EM `lib/`, nos dois casos: a prop escolhe QUAL funcao, nao
   * carrega frase nenhuma. Escrita no JSX, ela passaria por qualquer suite
   * intacta.
   */
  rotuloDoModo?: (modo: ModoDoJuro) => string;
}

export function CamposDeJuros({
  modo,
  aoEscolherModo,
  taxa,
  aoDigitarTaxa,
  total,
  aoDigitarTotal,
  idPrefixo = "",
  // RENOMEADA A PROP, E NAO O IMPORT, E A DIFERENCA E MEDIDA (HMO-480)
  //
  // O caminho natural era `rotuloDoModo as rotuloDoModoPadrao` no import, com a
  // prop ficando com o nome bonito. ELE QUEBRA A SONDA DE NAVEGADOR: ela
  // concatena os `.js` compilados num script classico e TIRA as linhas de
  // `import` por regex -- entao `rotuloDoModoPadrao` nao e definido por
  // ninguem, e o `default` so e avaliado quando a prop vem `undefined`, que e
  // exatamente o caso do formulario de CRIACAO. O sintoma foi o painel inteiro
  // morrendo no render e os 63 casos reprovando com
  // "Cannot read properties of null (reading 'options')" -- a sonda procurando
  // o `<select>` de contas numa arvore que nunca montou.
  //
  // Renomeando a PROP, o default aponta para o nome que a lib concatenada de
  // fato declara. Familia `concatenar-partes-compiladas-num-escopo-mente`.
  rotuloDoModo: rotuloDoModoDoCampo = rotuloDoModo,
}: CamposDeJurosProps) {
  return (
    <div className="space-y-3" data-campos-de-juros>
      <div className="space-y-2">
        <p className="text-sm font-medium">Juros</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
          {MODOS_DO_JURO.map((opcao) => (
            <label
              key={opcao}
              htmlFor={`${idPrefixo}modo_${opcao}`}
              className="flex items-center gap-2 text-sm"
            >
              <input
                type="radio"
                id={`${idPrefixo}modo_${opcao}`}
                // O MESMO `name` NOS TRES, que e o que faz o navegador trata-los
                // como um grupo -- sem ele os tres sao caixas independentes e
                // dois modos podem ficar marcados ao mesmo tempo.
                name={`${idPrefixo}modo_do_juro`}
                value={opcao}
                checked={modo === opcao}
                onChange={() => aoEscolherModo(opcao)}
                className="h-4 w-4"
              />
              <span>{rotuloDoModoDoCampo(opcao)}</span>
            </label>
          ))}
        </div>
      </div>

      {/* SO O CAMPO DO MODO ESCOLHIDO EXISTE NO DOM. Ver o cabecalho: a F2
          recusa taxa e total juntos, e a tela honra isso nao oferecendo os
          dois. Esconder com CSS nao serviria -- o estado continuaria
          preenchido e os dois viajariam no corpo do POST. */}
      {modo === "taxa" && (
        <div className="space-y-1">
          <label
            htmlFor={`${idPrefixo}taxa`}
            className="text-sm font-medium"
          >
            Taxa de juros do empréstimo todo (%)
          </label>
          <input
            id={`${idPrefixo}taxa`}
            // `text` com `inputMode="decimal"`, e NAO `type="number"`: o
            // numerico nativo descarta a virgula e devolve string vazia em
            // `e.target.value` (`input-type-number-descarta-a-virgula`), o que
            // apagaria o campo a cada tecla de quem digita "1,5".
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={taxa}
            onChange={(e) => aoDigitarTaxa(e.target.value)}
            placeholder="20"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            A taxa é do empréstimo todo, não ao mês: 20% em 12x devolve 20% a
            mais no fim, e não 20% por mês.
          </p>
        </div>
      )}

      {modo === "total" && (
        <div className="space-y-1">
          <label
            htmlFor={`${idPrefixo}total`}
            className="text-sm font-medium"
          >
            Total a receber
          </label>
          <input
            id={`${idPrefixo}total`}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            // A MASCARA DE DINHEIRO: mostra "R$ 1.200,00" e emite "1200.00".
            // Ver o cabecalho para por que as duas coisas nao podem ser a
            // mesma.
            value={valorParaExibicao(total, MOEDA_PADRAO)}
            onChange={(e) =>
              aoDigitarTotal(aoDigitarValor(e.target.value, MOEDA_PADRAO).valor)
            }
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Quanto vai voltar no total. A taxa que você está cobrando aparece na
            prévia.
          </p>
        </div>
      )}
    </div>
  );
}
