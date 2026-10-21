"use client";

// ---------------------------------------------------------------------------
// O FORMULARIO DE UMA CONTA PREVISTA DO CARTAO (HMO-460)
// ---------------------------------------------------------------------------
// Fase F3 da HMO-455. A assinatura cadastrada com o cartao como conta nao se
// editava em lugar NENHUM do app: nao tinha botao aqui, e a HMO-209 a tirou de
// Contas a Pagar de proposito. Ver o cabecalho de
// `lib/acoes-da-previsao-do-cartao.ts`.
//
// SEM REDE, como `FaturaDoCartao` e `AjusteDeSaldo`: ele so chama handlers. E
// isso que deixa o teste renderizar a tela de verdade com `react-dom/server` e
// afirmar sobre o HTML -- e o defeito que um formulario destes tem e de
// marcacao (o campo que nao chega, a frase do alcance que falta), nao de
// calculo.
//
// NAO E UM `Dialog`, E NAO E DENTRO DA LINHA -- as duas razoes sao as mesmas
// que `ListaDeMovimentacao` ja mediu:
//
//   1. tres campos dentro de uma linha de 320px de celular ou viram ilegiveis
//      ou empurram o valor para fora da tela;
//   2. a releitura TROCA o array de linhas. A tela do cartao recarrega a fatura
//      INTEIRA depois de cada acao (`recarregar`), e um formulario montado
//      dentro da linha perderia o que estava digitado em qualquer recarga.
//
// Por isso ele e um bloco proprio, ACIMA do bloco das previsoes, e a pagina o
// entrega como SLOT -- ele nao depende da lista ter carregado, entao uma
// releitura que falhe no meio da digitacao nao o faz desaparecer com o texto
// dentro.
// ---------------------------------------------------------------------------

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CampoDeData } from "@/components/ui/campo-de-data";
import {
  avisoDaEdicaoDaPrevisao,
  type PrevisaoAcionavel,
} from "@/lib/acoes-da-previsao-do-cartao";
import type { EdicaoDaPrevista } from "@/lib/acoes-da-linha";

interface EdicaoDaPrevisaoDoCartaoProps {
  /** A previsao em edicao. A pagina so monta este bloco quando ha uma. */
  previsao: PrevisaoAcionavel;
  campos: EdicaoDaPrevista;
  aoMudarCampos: (campos: EdicaoDaPrevista) => void;
  aoSalvar: () => void;
  aoCancelar: () => void;
  salvando?: boolean;
}

export function EdicaoDaPrevisaoDoCartao({
  previsao,
  campos,
  aoMudarCampos,
  aoSalvar,
  aoCancelar,
  salvando = false,
}: EdicaoDaPrevisaoDoCartaoProps) {
  return (
    <Card className="border-primary/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Editar conta prevista</CardTitle>
        <CardDescription>
          {/* O ALCANCE ESCRITO, e nao implicito -- regra 3 do modulo.
              `apenas_esta` muda esta ocorrencia e NAO a regra: a assinatura
              reajustada so neste mes volta ao valor antigo no proximo, e sem
              esta frase ninguem liga uma coisa a outra. A frase sai da lib
              porque e ela que sabe se ha serie. */}
          {avisoDaEdicaoDaPrevisao(previsao)}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Descrição</span>
            <input
              id="previsao-descricao"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={campos.descricao}
              onChange={(evento) =>
                aoMudarCampos({ ...campos, descricao: evento.target.value })
              }
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Valor (R$)</span>
            {/* `type="text"` com `inputMode="decimal"`, e NAO `type="number"`:
                o nativo DESCARTA a virgula enquanto se digita (medido na
                HMO-271), e "1.234,56" chega no handler como "1.234". Quem
                converte e `pedidoDeEdicaoDaPrevista`, que tem teste -- e quem
                PREENCHE e `valorNoCampoDaPrevisao`, que e o par exato daquele
                parser. Um preenchimento com ponto viraria 10x o valor. */}
            <input
              id="previsao-valor"
              inputMode="decimal"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={campos.valor}
              onChange={(evento) =>
                aoMudarCampos({ ...campos, valor: evento.target.value })
              }
            />
          </label>
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Vencimento</span>
            {/* `CampoDeData` e NAO o controle nativo: a ordem dos tres
                segmentos do `type="date"` sai do APARELHO, e o mesmo app mostra
                dd/mm para um usuario e mm/dd para outro sem nada na tela
                dizendo qual (medido na HMO-238). Quem digitasse 10 de MARCO
                gravaria 3 de OUTUBRO -- data valida, plausivel e sem erro no
                caminho. Ele MOSTRA dd/mm/aaaa e EMITE AAAA-MM-DD, que e o
                formato que `pedidoDeEdicaoDaPrevista` exige. */}
            <CampoDeData
              id="previsao-vencimento"
              value={campos.vencimento}
              onChange={(vencimento) => aoMudarCampos({ ...campos, vencimento })}
              aria-label="Vencimento"
            />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            id="previsao-salvar"
            size="sm"
            onClick={aoSalvar}
            disabled={salvando}
          >
            {salvando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salvar
          </Button>
          <Button
            id="previsao-cancelar"
            size="sm"
            variant="outline"
            onClick={aoCancelar}
            disabled={salvando}
          >
            Cancelar
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
