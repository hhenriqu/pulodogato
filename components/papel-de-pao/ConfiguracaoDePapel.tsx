"use client";

import { Switch } from "@/components/ui/switch";
import { useModoPapel } from "@/components/ModoPapelProvider";

/**
 * O espelho do papelzinho em Configuracoes > Painel (HMO-283).
 *
 * POR QUE E UM COMPONENTE, E NAO UM BLOCO DENTRO DA PAGINA
 * --------------------------------------------------------
 * `settings/page.tsx` tem 600 linhas, busca na rede e abre dialogo. A sonda de
 * navegador (`npm run test:papel-na-tela`) precisa MONTAR o interruptor para
 * clicar nele, e montar aquela pagina inteira para isso significaria arrastar
 * `fetch`, `sonner` e as abas do Radix para dentro do teste -- cada um deles um
 * lugar onde a sonda deixaria de falar do codigo de producao.
 *
 * Mesma razao de `ConfiguracaoDeMoeda` existir ao lado dela.
 *
 * O CROMO (Card, titulo, descricao) FICA NO CHAMADOR. Aqui dentro so o que o
 * teste precisa exercitar: o rotulo, o estado e o interruptor. Nao ha Save:
 * diferente das outras duas abas, esta preferencia nao vai para o servidor --
 * ela mora no aparelho, como o tema (ver `lib/modo-papel.ts`).
 */
export function ConfiguracaoDePapel() {
  const { papel, setModo, mounted } = useModoPapel();
  const ligado = mounted && papel;

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <label
          htmlFor="papel-config-switch"
          className="font-medium cursor-pointer"
        >
          Papel de pão
        </label>
        <p
          id="papel-config-estado"
          className="text-sm text-muted-foreground mt-0.5"
        >
          {ligado
            ? "Ligado — marrom e bege, com letra manuscrita."
            : "Desligado — o app usa as cores de sempre."}
        </p>
        {/* A consequencia aceita do padrao 4 do plano: a preferencia e do
            aparelho, nao do perfil. Dizer isso aqui e mais barato que o
            primeiro "liguei no telefone e no computador continua normal". */}
        <p className="text-xs text-muted-foreground mt-1">
          Vale só neste aparelho, como o tema claro/escuro.
        </p>
      </div>

      <Switch
        id="papel-config-switch"
        checked={ligado}
        onCheckedChange={(marcado) =>
          setModo(marcado ? "ligado" : "desligado")
        }
        aria-label="Papel de pão"
      />
    </div>
  );
}
