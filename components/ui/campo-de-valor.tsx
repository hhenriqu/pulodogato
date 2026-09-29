"use client";

// ---------------------------------------------------------------------------
// O CAMPO DE DINHEIRO (HMO-171)
// ---------------------------------------------------------------------------
// Um input de texto que MOSTRA "R$ 1.000,00" e EMITE "1000.00". Ver
// lib/dinheiro.ts para por que essas duas coisas nao podem ser a mesma: todo
// formulario deste app converte o valor com `Number.parseFloat`, e
// `parseFloat("1.000,00")` e 1 -- mil reais gravados como um real, sem erro
// nenhum no caminho.
//
// POR QUE ELE NAO TEM ESTADO PROPRIO
// ----------------------------------
// A exibicao e derivada do `value` a cada render. A alternativa -- guardar o
// texto mascarado num `useState` local e sincronizar com a prop -- cria duas
// fontes de verdade para o mesmo numero, e elas divergem no caso que ninguem
// testa: quando o pai muda o valor sem o usuario digitar. E exatamente o que a
// tela de despesa faz ao preencher o valor total a partir do valor da parcela,
// e o que a edicao faz ao carregar o lancamento do banco. Com estado local, o
// campo continuaria mostrando o texto antigo com o valor novo por baixo.
//
// A mascara de digitos (`aoDigitarValor`) e o que permite isso: ela e total --
// toda sequencia de teclas tem uma saida canonica -- entao ida e volta nao
// perdem informacao e nao ha nada para guardar entre renders.
//
// POR QUE O CURSOR E EMPURRADO PARA O FIM
// ---------------------------------------
// A mascara e de digitos: eles entram pelos centavos e empurram os anteriores
// para a esquerda. Nao existe "digitar no meio" -- clicar entre o 1 e o 0 de
// "1.000,00" e teclar 5 da o mesmo resultado que teclar 5 no fim. Como o
// reposicionamento do caret pelo navegador conta caracteres que a reformatacao
// acabou de mover, sem isto o cursor salta para posicoes que nao correspondem a
// nada; fixar no fim e o unico lugar coerente com o que a mascara faz.
// ---------------------------------------------------------------------------

import { useEffect, useRef, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { CalculadoraDeValor } from "@/components/ui/calculadora-de-valor";
import {
  MOEDA_PADRAO,
  aoDigitarValor,
  formatarValor,
  valorParaExibicao,
} from "@/lib/dinheiro";

interface CampoDeValorProps {
  id?: string;
  /**
   * O valor em notacao decimal com ponto ("1000.00"), como o estado do
   * formulario guarda. NAO e o texto mascarado.
   */
  value: string;
  /** Recebe o valor plano, nunca a mascara. */
  onChange: (valorPlano: string) => void;
  /** Codigo ISO da moeda. Decide simbolo e numero de casas. */
  moeda?: string;
  /**
   * Para os campos que aplicam no Enter (o ajuste de gasto em Fluxo de Caixa).
   * Passa direto, sem a mascara no meio: quem escuta a tecla quer a TECLA, e o
   * valor ja chegou por `onChange`.
   */
  onKeyDown?: (evento: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  name?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

export function CampoDeValor({
  id,
  value,
  onChange,
  moeda = MOEDA_PADRAO,
  placeholder,
  required,
  disabled,
  className,
  name,
  onKeyDown,
  ...aria
}: CampoDeValorProps) {
  const ref = useRef<HTMLInputElement>(null);
  // A MESMA funcao que o `onChange` usa por tras. E isso -- e nao um comentario
  // pedindo cuidado -- que impede o campo de exibir um texto que ele nao seria
  // capaz de emitir. Um valor negativo no estado aparece positivo, que e
  // exatamente o que este campo devolveria se a pessoa digitasse o mesmo.
  const exibicao = valorParaExibicao(value, moeda);

  useEffect(() => {
    const campo = ref.current;
    // So mexe no caret do campo que esta sendo digitado. Sem esta porta, o
    // efeito roubaria a posicao do cursor de outro campo do formulario a cada
    // vez que este valor mudasse por fora.
    if (!campo || document.activeElement !== campo) return;
    const fim = campo.value.length;
    campo.setSelectionRange(fim, fim);
  }, [exibicao]);

  return (
    // A CALCULADORA ENTRA AQUI, E NAO EM CADA TELA (HMO-171)
    // -----------------------------------------------------
    // "Todos os campos de valor ao lado do input deve ter uma calculadora." Sao
    // 15 campos em 10 arquivos, e pendurar o botao em cada um deles seria 15
    // chances de esquecer um -- incluindo o proximo campo de valor, que ninguem
    // vai lembrar de equipar. Aqui e o gargalo por onde todos passam.
    //
    // `gap` e nao `space-x`: o espaco lateral desaparece quando a linha quebra,
    // e estes campos quebram no celular.
    //
    // O `className` de quem chama continua indo para o INPUT, e nao para esta
    // caixa. Em Fluxo de Caixa ele e `h-8 w-32`, uma largura pensada para o
    // campo; na caixa, a largura passaria a incluir o botao e o campo encolheria.
    <div className="flex items-center gap-2">
      <Input
        ref={ref}
        id={id}
        name={name}
        // `text` com `inputMode="decimal"`: `type="number"` nao aceita mascara --
        // o navegador rejeita o ponto de milhar e devolve string vazia em
        // `e.target.value`, o que apagaria o campo a cada tecla. O `inputMode`
        // e o que mantem o teclado numerico no celular, que e onde este app roda
        // instalado.
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={exibicao}
        onChange={(e) => onChange(aoDigitarValor(e.target.value, moeda).valor)}
        onKeyDown={onKeyDown}
        // O zero da propria moeda, e nao "R$ 0,00" escrito na mao: iene nao tem
        // centavos, e um placeholder com duas casas prometeria uma subdivisao que
        // a moeda escolhida nao possui.
        placeholder={placeholder ?? formatarValor(0, moeda)}
        required={required}
        disabled={disabled}
        className={className}
        {...aria}
      />

      <CalculadoraDeValor
        valorAtual={value}
        moeda={moeda}
        // O mesmo `onChange` do campo, e por isso a calculadora devolve o valor
        // PLANO: se ela mandasse o texto mascarado, o estado do formulario
        // guardaria "R$ 1.000,00" e `parseFloat` gravaria 1.
        aoAplicar={onChange}
        rotuloDoCampo={aria["aria-label"]}
        disabled={disabled}
      />
    </div>
  );
}
