"use client";

// ---------------------------------------------------------------------------
// O CAMPO DE DATA (HMO-238)
// ---------------------------------------------------------------------------
// Um input de texto que MOSTRA "10/03/2026" e EMITE "2026-03-10". Ver
// lib/data-digitada.ts para o que foi medido antes de trocar o controle nativo:
// num `<input type="date">` da largura desta tela, digitar 10032026 nao grava a
// data digitada em NENHUMA posicao de clique -- sai "2026-10-03" (a ordem do
// aparelho e mm/dd, entao 10 de marco virou 3 de outubro, sem erro nenhum),
// "32026-10-02" (ano corrompido) ou "" (oito teclas, nada gravado).
//
// POR QUE ELE GUARDA UM RASCUNHO, E `CampoDeValor` NAO
// ----------------------------------------------------
// `CampoDeValor` deriva a exibicao do `value` a cada render e nao guarda estado
// nenhum. Aqui isso nao da: data incompleta NAO TEM valor -- "10/1" emite vazio
// de proposito, para nao gravar um dia que ninguem digitou -- entao um campo que
// so soubesse derivar apagaria a primeira tecla de toda digitacao.
//
// O rascunho fica SUBORDINADO ao valor, e essa e a parte que importa: ele so vale
// enquanto o valor do pai continuar sendo exatamente o que aquele texto emitiu
// (`exibicaoDoCampo`). No instante em que o pai discorda -- a edicao carregando o
// lancamento do banco, a tela copiando a data prevista da data real -- o rascunho
// e ignorado e a exibicao volta a sair do valor. E o que impede o bug classico de
// duas fontes de verdade: campo mostrando o texto antigo com o valor novo por
// baixo. Sem `useEffect` de sincronizacao, que e onde esse bug mora.
//
// A MASCARA E O CARET SAO APLICADOS PELA FUNCAO PURA
// --------------------------------------------------
// `aplicarMascaraNoCampo` escreve o texto mascarado e empurra o caret para o fim
// (sem isso, "1003" vira "10/30": a barra inserida desloca a terceira tecla).
// Ela mora em lib/data-digitada.ts, e nao aqui, para que a sonda em Chromium
// meca o MESMO codigo que a tela roda -- uma sonda que exercita uma reimplementacao
// mede a si mesma.
// ---------------------------------------------------------------------------

import { useRef, useState, type ChangeEvent, type FocusEvent } from "react";
import { CalendarDays } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  aplicarMascaraNoCampo,
  exibicaoDoCampo,
  type RascunhoDeData,
} from "@/lib/data-digitada";

interface CampoDeDataProps {
  id?: string;
  /**
   * A data em `AAAA-MM-DD`, como o estado do formulario guarda, ou vazio. NAO e o
   * texto mascarado.
   */
  value: string;
  /** Recebe `AAAA-MM-DD`, ou vazio enquanto a data nao esta completa. */
  onChange: (valorISO: string) => void;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  name?: string;
  /**
   * O ultimo dia que o CALENDARIO oferece, em `AAAA-MM-DD`. O nome diz
   * "calendario" porque e so ate onde ele chega: o `max` do input nativo nao
   * alcanca o campo de texto, entao DIGITAR uma data depois dela continua
   * possivel e quem chama precisa recusa-la na gravacao.
   *
   * Um `max` que parecesse validar os dois caminhos seria pior que nenhum --
   * a tela ficaria confiando numa trava que metade dos usuarios atravessa.
   */
  maxDoCalendario?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

export function CampoDeData({
  id,
  value,
  onChange,
  required,
  disabled,
  className,
  name,
  maxDoCalendario,
  ...aria
}: CampoDeDataProps) {
  const [rascunho, setRascunho] = useState<RascunhoDeData | null>(null);
  const calendario = useRef<HTMLInputElement>(null);

  const exibicao = exibicaoDoCampo(rascunho, value);

  function aoDigitar(evento: ChangeEvent<HTMLInputElement>) {
    // `exibicao` e o que estava na tela ANTES desta tecla. E o que permite a
    // mascara saber que uma tecla sobre uma data completa comeca uma data nova,
    // em vez de se misturar com a que ja estava la.
    const entrada = aplicarMascaraNoCampo(evento.currentTarget, exibicao);

    setRascunho({ texto: entrada.exibicao, valor: entrada.valor });

    // O pai so ouve quando o valor muda de fato. Enquanto a data esta pela
    // metade o valor e "" -- e continuar emitindo "" a cada tecla faria o
    // formulario re-renderizar sem nada novo para dizer.
    if (entrada.valor !== value) onChange(entrada.valor);
  }

  // Selecionar tudo ao focar e um ATALHO, nao a correcao: apagar a data inteira
  // passa a ser uma tecla. A regra de "redigitar comeca do zero" vive na mascara
  // (ver lib/data-digitada.ts), entao o campo continua certo no aparelho em que
  // esta selecao nao sobrevive ao toque.
  function selecionarTudo(evento: FocusEvent<HTMLInputElement>) {
    evento.currentTarget.select();
  }

  function abrirCalendario() {
    const campo = calendario.current;
    if (!campo) return;
    // `showPicker` e o unico jeito de abrir o calendario nativo sem o usuario
    // acertar o icone minusculo do proprio input. Onde ele nao existe (Safari
    // antigo), o `click` ainda abre em parte dos aparelhos -- e quem nao
    // conseguir continua podendo DIGITAR, que e o ponto desta issue.
    if (typeof campo.showPicker === "function") {
      try {
        campo.showPicker();
        return;
      } catch {
        // `showPicker` lanca sem gesto do usuario. Cai no clique.
      }
    }
    campo.click();
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        id={id}
        name={name}
        // `text` com `inputMode="numeric"`: e o `type="date"` que traz os tres
        // segmentos e o salto para o ano. O `inputMode` e o que mantem o teclado
        // numerico no celular, que e onde este app roda instalado.
        type="text"
        inputMode="numeric"
        autoComplete="off"
        // O formato na tela, e nao so no placeholder: com o controle nativo a
        // ordem saia do aparelho e a tela nao dizia qual era.
        placeholder="dd/mm/aaaa"
        maxLength={10}
        value={exibicao}
        onChange={aoDigitar}
        onFocus={selecionarTudo}
        required={required}
        disabled={disabled}
        className={className}
        {...aria}
      />

      {/* O BOTAO DE CALENDARIO, PARA QUEM PREFERE APONTAR

          A issue troca o controle nativo para que DIGITAR funcione; perder o
          calendario no caminho seria trocar uma reclamacao por outra. O input de
          data continua aqui para isso -- invisivel, sem foco de teclado e sem
          receber clique proprio -- e serve so de picker: ninguem digita nele,
          entao o salto de segmento nao volta por esta porta.

          Ele fica ATRAS do botao (e nao escondido com `display:none`) porque o
          navegador ancora o calendario na posicao do campo; escondido de verdade,
          o calendario abriria no canto da tela. */}
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={abrirCalendario}
          disabled={disabled}
          aria-label={
            aria["aria-label"]
              ? `Escolher ${aria["aria-label"]} no calendário`
              : "Escolher no calendário"
          }
          className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-input bg-background text-muted-foreground ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
        </button>

        <input
          ref={calendario}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          max={maxDoCalendario}
          // Uma data invalida no estado nao pode chegar aqui: o input nativo
          // recusa calado e passaria a mostrar o mes corrente, que e a sonda
          // de fatura outra vez. `exibicao` vazia significa valor vazio.
          value={exibicao === "" ? "" : value}
          onChange={(e) => {
            // O picker entrega `AAAA-MM-DD` pronto. O rascunho nao e tocado: ele
            // deixa de valer sozinho, porque o valor do pai passa a discordar
            // dele (ver `exibicaoDoCampo`).
            onChange(e.target.value);
          }}
          className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
        />
      </div>
    </div>
  );
}
