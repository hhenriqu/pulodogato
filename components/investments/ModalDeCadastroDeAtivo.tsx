"use client";

// ---------------------------------------------------------------------------
// CADASTRAR ATIVO, EM MODAL (HMO-252)
// ---------------------------------------------------------------------------
// POR QUE ESTE TAMBEM VIROU MODAL, E ELE NAO E LANCAMENTO
// -------------------------------------------------------
// A issue deixou a decisao aberta: cadastrar ativo nao mexe em dinheiro, entao
// virar modal era opcional. O que decidiu foi a coerencia da tela -- deixar um
// dos dois formularios como modal aberto por botao no cabecalho e o outro como
// `<Card>` no fim da pagina colocaria dois gestos diferentes para a mesma
// classe de acao, lado a lado. Os dois sobem para o cabecalho.
//
// O QUE ELE NAO TEM, E O PORQUE
// -----------------------------
// Nao tem "Salvar e continuar". O interruptor da HMO-249 existe para um
// problema de DINHEIRO: manter a tela aberta economiza o reescolher, e o preco
// de mante-la aberta e o risco do segundo clique gravar o mesmo valor de novo.
// Cadastrar ativo nao grava valor nenhum -- cria a ficha do papel. Um
// interruptor aqui ofereceria a comodidade sem nenhum dos dois lados da
// decisao, e teria de inventar uma frase sobre o que limpa (codigo? nome?) que
// nao corresponde a caso de uso nenhum: ninguem cadastra duas PETR4.
// ---------------------------------------------------------------------------

import { useState } from "react";

import { ModalDeLancamento } from "@/components/movimentacoes/ModalDeLancamento";
import {
  CamposDeRendaFixa,
  valoresDeRendaFixaVazios,
  type ValoresDeRendaFixa,
} from "@/components/RendaFixaDaCarteira";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Plus } from "lucide-react";
import { ROTULO_TIPO, TIPOS_DE_ATIVO, type AssetType } from "@/lib/investments";

/** O estado do formulario de ativo, em um objeto. */
export interface ValoresDoAtivo {
  symbol: string;
  nome: string;
  tipo: AssetType;
  preco: string;
  rendaFixa: ValoresDeRendaFixa;
}

export function valoresDoAtivoVazios(): ValoresDoAtivo {
  return {
    symbol: "",
    nome: "",
    tipo: "stock",
    preco: "",
    rendaFixa: valoresDeRendaFixaVazios(),
  };
}

interface ModalDeCadastroDeAtivoProps {
  salvando: boolean;
  aoFechar: () => void;
  /** Grava. Devolve a frase de erro, ou `null` quando gravou. */
  aoSalvar: (valores: ValoresDoAtivo) => Promise<string | null>;
}

export function ModalDeCadastroDeAtivo({
  salvando,
  aoFechar,
  aoSalvar,
}: ModalDeCadastroDeAtivoProps) {
  const [valores, setValores] = useState<ValoresDoAtivo>(valoresDoAtivoVazios);
  const [erro, setErro] = useState<string | null>(null);

  const campo = <C extends keyof ValoresDoAtivo>(
    chave: C,
    valor: ValoresDoAtivo[C]
  ) => setValores((atual) => ({ ...atual, [chave]: valor }));

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault();
    setErro(null);

    // O erro vai DENTRO do modal: o `<Alert>` da pagina fica atras do overlay.
    // Ver `ModalDeMovimentacao`.
    const frase = await aoSalvar(valores);
    if (frase) {
      setErro(frase);
      return;
    }

    aoFechar();
  }

  return (
    <ModalDeLancamento
      titulo="Cadastrar ativo"
      descricao="O código é como você identifica o ativo na sua carteira. Não há lista fechada de códigos."
      aoFechar={aoFechar}
      aviso={
        erro ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        ) : undefined
      }
    >
      <form onSubmit={enviar} className="space-y-6">
        {/* `grid-cols-1` explicito na base -- ver ModalDeMovimentacao. */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="novo-symbol">Código *</Label>
            <Input
              id="novo-symbol"
              value={valores.symbol}
              onChange={(e) => campo("symbol", e.target.value.toUpperCase())}
              placeholder="PETR4"
              maxLength={16}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="novo-nome">Nome *</Label>
            <Input
              id="novo-nome"
              value={valores.nome}
              onChange={(e) => campo("nome", e.target.value)}
              placeholder="Petrobras PN"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="novo-tipo">Tipo *</Label>
            <Select
              value={valores.tipo}
              onValueChange={(v) => campo("tipo", v as AssetType)}
            >
              <SelectTrigger id="novo-tipo">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS_DE_ATIVO.map((t) => (
                  <SelectItem key={t} value={t}>
                    {ROTULO_TIPO[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            {/* Cotacao, nao valor em reais: fica sem mascara. Ver o bloco de
                Quantidade de ModalDeMovimentacao para o porque. */}
            <Label htmlFor="novo-preco">Preço atual (opcional)</Label>
            <Input
              id="novo-preco"
              type="number"
              step="0.00000001"
              min="0"
              value={valores.preco}
              onChange={(e) => campo("preco", e.target.value)}
              placeholder="31,50"
            />
          </div>
          {/* Renda fixa pede o que nao existe em acao nenhuma: indexador,
              percentual do indice, data de aplicacao e vencimento (HMO-192).
              Sem estes campos o tipo `fixed_income` funcionava so se a pessoa
              reescrevesse o preco na mao todo mes. */}
          {valores.tipo === "fixed_income" && (
            <CamposDeRendaFixa
              idPrefixo="novo-rf"
              valores={valores.rendaFixa}
              onChange={(v) => campo("rendaFixa", v)}
              desabilitado={salvando}
            />
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={salvando}>
            <Plus className="h-4 w-4 mr-1" />
            {salvando ? "Cadastrando..." : "Cadastrar ativo"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={aoFechar}
            disabled={salvando}
          >
            Cancelar
          </Button>
        </div>
      </form>
    </ModalDeLancamento>
  );
}
