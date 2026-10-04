"use client";

// ---------------------------------------------------------------------------
// O INTERRUPTOR "SALVAR E CONTINUAR" (HMO-249)
// ---------------------------------------------------------------------------
// "...e ter um checkbox ou switch button para ativar o 'Salvar e continuar' ele
// se mantem na tela para lancar uma nova conta."
//
// Um componente so para os dois formularios (lancamento e transferencia) porque
// o ROTULO e a parte que nao pode divergir: ele e a unica coisa que avisa que o
// modal NAO vai fechar. Duas copias do texto viram duas promessas diferentes
// sobre o mesmo botao.
//
// POR QUE ELE NAO APARECE NA EDICAO
// ---------------------------------
// Editar e um lancamento que ja existe. "Salvar e continuar" ali so poderia
// significar "atualizar e deixar o formulario aberto no mesmo lancamento" -- e o
// proximo Salvar gravaria em cima do mesmo registro. Quem chama passa
// `editando` e o interruptor some; nao ha estado "ligado mas escondido", porque
// um interruptor invisivel que ainda age e pior que nenhum.
// ---------------------------------------------------------------------------

import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface SalvarEContinuarProps {
  ligado: boolean;
  aoMudar: (ligado: boolean) => void;
  /** Desligado enquanto a gravacao esta em curso, como o botao de Salvar. */
  disabled?: boolean;
}

export function SalvarEContinuar({
  ligado,
  aoMudar,
  disabled,
}: SalvarEContinuarProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/20 p-3">
      <Switch
        id="salvar-e-continuar"
        checked={ligado}
        onCheckedChange={aoMudar}
        disabled={disabled}
        // O rotulo visivel diz "Salvar e continuar"; o leitor de tela ganha a
        // consequencia, que e a informacao que falta a quem nao ve o texto de
        // apoio abaixo.
        aria-label="Salvar e continuar: manter esta tela aberta depois de salvar"
      />
      <div className="space-y-0.5">
        <Label htmlFor="salvar-e-continuar" className="cursor-pointer">
          Salvar e continuar
        </Label>
        <p className="text-sm text-muted-foreground">
          {ligado
            ? "A tela fica aberta para a próxima conta. Descrição e valor são limpos; categoria, conta, data e grupo continuam."
            : "Ao salvar, esta tela fecha e você volta de onde veio."}
        </p>
      </div>
    </div>
  );
}
