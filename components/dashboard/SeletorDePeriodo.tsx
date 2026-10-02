"use client";

// -----------------------------------------------------------------------------
// O SELETOR DE PERIODO DO PAINEL
// -----------------------------------------------------------------------------
// Tres controles sobre o MESMO estado: as setas, o botao "Hoje" e o seletor de
// presets apenas chamam `aoMudar` com um `Periodo` novo. Quem guarda e a URL
// (ver page.tsx).
//
// O componente e burro de proposito. A aritmetica toda -- passo de mes, presets,
// rotulo, classificacao em mes x intervalo -- mora em lib/periodo-do-painel.ts,
// onde o teste alcanca sem precisar montar React. O que sobra aqui e marcacao.
//
// AS DUAS EXCECOES SAO OS DOIS `useState`, E NENHUM DELES DECIDE NADA
// --------------------------------------------------------------------
// 1. O RASCUNHO DO PAR (HMO-240). Existe porque o par de datas passou a ser
//    campo mascarado, e campo mascarado emite VAZIO enquanto a data esta pela
//    metade -- enquanto o filtro deste seletor nao pode disparar com vazio. A
//    explicacao inteira, e a regra, moram em `extremoDigitado`/`parDoSeletor`.
//
// 2. O MODO PERSONALIZADO (HMO-243). Existe porque "escrever as datas a mao" e
//    uma escolha da pessoa, e nao uma propriedade do periodo: no instante do
//    clique o periodo ainda e o mes corrente. Enquanto isso era DERIVADO de
//    `presetDoPeriodo`, escolher "Personalizado" nao fazia nada -- o item era
//    decorativo e o comentario que ficava aqui afirmava o contrario.
//
// Os dois guardam estado; quem decide o que fazer com ele sao `escolhaDoSeletor`
// e `camposAbertos` (lib/periodo-do-painel.ts). Isso nao e preferencia de
// arquitetura: `react-dom/server` nao enxerga handler nenhum, entao uma decisao
// escrita dentro de um `onValueChange` e uma decisao que nenhum teste deste
// repositorio alcanca sem navegador. Foi por essa porta que a 243 entrou.
//
// POR QUE AS SETAS NAO TEM LIMITE
// --------------------------------
// Nem para tras nem para frente. Para tras e obvio -- o usuario pode ter
// importado extrato de anos anteriores. Para frente tambem: a agenda de contas
// previstas e sobre o futuro, e travar a seta em "hoje" esconderia justamente o
// mes que a pessoa quer planejar. O que nao pode acontecer no futuro e
// ESCREVER, e esse cuidado esta na rota, nao na seta.
// -----------------------------------------------------------------------------

import { useState } from "react";
import { ChevronLeft, ChevronRight, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CampoDeData } from "@/components/ui/campo-de-data";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  camposAbertos,
  ehPeriodoCorrente,
  escolhaDoSeletor,
  extremoDigitado,
  lerPeriodo,
  parDoSeletor,
  presetDoPeriodo,
  rotuloDoPeriodo,
  valorDoSeletor,
  PRESETS,
  VALOR_PERSONALIZADO,
  type GestoDoSeletor,
  type Periodo,
  type RascunhoDoPar,
} from "@/lib/periodo-do-painel";

interface Props {
  periodo: Periodo;
  /** Hoje em America/Sao_Paulo. Vem de cima para a tela inteira concordar. */
  hoje: string;
  aoMudar: (periodo: Periodo) => void;
}

export function SeletorDePeriodo({ periodo, hoje, aoMudar }: Props) {
  const preset = presetDoPeriodo(periodo, hoje);
  const noMesCorrente = ehPeriodoCorrente(periodo, hoje);

  // As datas do modo personalizado sao editadas uma de cada vez, e no meio da
  // edicao o par pode ficar incompleto (data pela metade emite vazio) ou
  // invertido (trocar o mes do `de` para depois do `ate`). `lerPeriodo`
  // devolveria o mes corrente nos dois casos e a tela pularia sozinha para
  // setembro enquanto a pessoa ainda estava digitando -- entao o par so sobe
  // quando os dois lados formam um periodo valido, e o que foi digitado fica no
  // rascunho ate la.
  const [rascunho, setRascunho] = useState<RascunhoDoPar | null>(null);
  const par = parDoSeletor(rascunho, periodo);

  // "Escrever as datas a mao" e escolha da pessoa, nao propriedade do periodo:
  // ver o cabecalho deste arquivo e `escolhaDoSeletor`.
  const [personalizado, setPersonalizado] = useState(false);

  /** O unico caminho por onde um gesto chega ao periodo e ao modo a mao. */
  const aplicar = (gesto: GestoDoSeletor) => {
    const escolha = escolhaDoSeletor(gesto, { periodo, personalizado }, hoje);
    setPersonalizado(escolha.personalizado);
    // `null` e o gesto que NAO mexe em numero nenhum -- abrir os campos. Chamar
    // `aoMudar` aqui refiltraria a tela antes de a pessoa escolher data alguma.
    if (escolha.periodo) aoMudar(escolha.periodo);
  };

  const trocarExtremo = (qual: "de" | "ate", valor: string) => {
    const passo = extremoDigitado(rascunho, periodo, qual, valor);
    setRascunho(passo.rascunho);
    if (!passo.par) return;
    aplicar({
      tipo: "par",
      periodo: lerPeriodo(passo.par.de, passo.par.ate, hoje),
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label="Mês anterior"
          onClick={() => aplicar({ tipo: "passo", meses: -1 })}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        {/* aria-live porque o rotulo e a UNICA coisa na tela que diz a que
            periodo os numeros abaixo se referem: quem navega por leitor de
            tela clica na seta e, sem isto, nao ouve nada mudar. */}
        <span
          aria-live="polite"
          className="min-w-[11rem] text-center text-sm font-medium capitalize"
        >
          {rotuloDoPeriodo(periodo)}
        </span>

        <Button
          variant="outline"
          size="icon"
          aria-label="Próximo mês"
          onClick={() => aplicar({ tipo: "passo", meses: 1 })}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Aparece so fora do mes corrente. Um "Hoje" sempre visivel seria um
          botao que na maior parte do tempo nao faz nada -- e um botao que nao
          faz nada ensina a nao clicar nele. */}
      {!noMesCorrente && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => aplicar({ tipo: "hoje" })}
        >
          Hoje
        </Button>
      )}

      <Select
        value={valorDoSeletor(preset, personalizado)}
        onValueChange={(valor) => aplicar({ tipo: "item", valor })}
      >
        <SelectTrigger className="w-[11rem]" aria-label="Período">
          <CalendarRange className="h-4 w-4 mr-2 shrink-0" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.rotulo}
            </SelectItem>
          ))}
          <SelectItem value={VALOR_PERSONALIZADO}>Personalizado</SelectItem>
        </SelectContent>
      </Select>

      {/* `CampoDeData` e nao o controle de data nativo (HMO-240): nele a ordem
          dos segmentos saia do APARELHO, entao quem digitava 10/03 podia estar
          filtrando 3 de outubro -- e num filtro isso nao da erro nenhum, da um
          painel com os numeros de outro periodo.

          `value` sai do RASCUNHO e nao de `periodo`: ver o cabecalho deste
          arquivo e `extremoDigitado`.

          `flex-wrap` e largura fixa nos campos, e nao o `w-auto` de antes: cada
          `CampoDeData` e o input MAIS o botao de calendario, e o par passou a
          medir ~300px. Num celular de 343px uteis isso fica no limite, e `flex`
          sem `flex-wrap` estoura para fora da tela em vez de quebrar a linha.

          A CONDICAO TEM DUAS RAZOES, E NAO UMA (HMO-243): `preset === null` e
          "o periodo nao tem nome", e so ela deixava os campos inalcancaveis
          pelo menu -- escolher "Personalizado" nao muda o periodo, entao o
          preset continuava sendo `este-mes`. Ver `camposAbertos`. */}
      {camposAbertos(preset, personalizado) && (
        <div className="flex flex-wrap items-center gap-2">
          <CampoDeData
            className="w-[6.5rem]"
            aria-label="Data inicial"
            value={par.de}
            onChange={(valor) => trocarExtremo("de", valor)}
          />
          <span className="text-sm text-muted-foreground">a</span>
          <CampoDeData
            className="w-[6.5rem]"
            aria-label="Data final"
            value={par.ate}
            onChange={(valor) => trocarExtremo("ate", valor)}
          />
        </div>
      )}
    </div>
  );
}
