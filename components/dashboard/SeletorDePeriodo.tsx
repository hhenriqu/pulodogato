"use client";

// -----------------------------------------------------------------------------
// O SELETOR DE PERIODO DO PAINEL
// -----------------------------------------------------------------------------
// Tres controles sobre o MESMO estado, e por isso nenhum deles guarda estado
// proprio: as setas, o botao "Hoje" e o seletor de presets apenas chamam
// `aoMudar` com um `Periodo` novo. Quem guarda e a URL (ver page.tsx).
//
// O componente e burro de proposito. A aritmetica toda -- passo de mes, presets,
// rotulo, classificacao em mes x intervalo -- mora em lib/periodo-do-painel.ts,
// onde o teste alcanca sem precisar montar React. O que sobra aqui e marcacao.
//
// POR QUE AS SETAS NAO TEM LIMITE
// --------------------------------
// Nem para tras nem para frente. Para tras e obvio -- o usuario pode ter
// importado extrato de anos anteriores. Para frente tambem: a agenda de contas
// previstas e sobre o futuro, e travar a seta em "hoje" esconderia justamente o
// mes que a pessoa quer planejar. O que nao pode acontecer no futuro e
// ESCREVER, e esse cuidado esta na rota, nao na seta.
// -----------------------------------------------------------------------------

import { ChevronLeft, ChevronRight, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ehDataIso,
  ehPeriodoCorrente,
  lerPeriodo,
  passoDeMes,
  periodoCorrente,
  periodoDoPreset,
  presetDoPeriodo,
  rotuloDoPeriodo,
  PRESETS,
  type IdDePreset,
  type Periodo,
} from "@/lib/periodo-do-painel";

/** O valor que o seletor usa quando nenhum preset descreve o periodo. */
const PERSONALIZADO = "personalizado";

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
  // edicao o par pode ficar invertido (trocar o mes do `de` para depois do
  // `ate`). `lerPeriodo` devolveria o mes corrente e a tela pularia sozinha
  // para setembro enquanto a pessoa ainda estava digitando -- entao o par so
  // sobe quando os dois lados formam um periodo valido.
  const trocarExtremo = (qual: "de" | "ate", valor: string) => {
    const de = qual === "de" ? valor : periodo.de;
    const ate = qual === "ate" ? valor : periodo.ate;
    if (!ehDataIso(de) || !ehDataIso(ate) || de > ate) return;
    aoMudar(lerPeriodo(de, ate, hoje));
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon"
          aria-label="Mês anterior"
          onClick={() => aoMudar(passoDeMes(periodo, -1))}
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
          onClick={() => aoMudar(passoDeMes(periodo, 1))}
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
          onClick={() => aoMudar(periodoCorrente(hoje))}
        >
          Hoje
        </Button>
      )}

      <Select
        value={preset ?? PERSONALIZADO}
        onValueChange={(valor) => {
          // "Personalizado" nao e um periodo: e a decisao de escolher as datas
          // a mao. Escolher o item nao muda numero nenhum -- so abre os dois
          // campos, ja preenchidos com o periodo atual.
          if (valor === PERSONALIZADO) return;
          aoMudar(periodoDoPreset(valor as IdDePreset, hoje));
        }}
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
          <SelectItem value={PERSONALIZADO}>Personalizado</SelectItem>
        </SelectContent>
      </Select>

      {preset === null && (
        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="w-auto"
            aria-label="Data inicial"
            value={periodo.de}
            onChange={(e) => trocarExtremo("de", e.target.value)}
          />
          <span className="text-sm text-muted-foreground">a</span>
          <Input
            type="date"
            className="w-auto"
            aria-label="Data final"
            value={periodo.ate}
            onChange={(e) => trocarExtremo("ate", e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
