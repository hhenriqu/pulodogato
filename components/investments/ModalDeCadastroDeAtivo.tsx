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
  /**
   * A Conta Investimento a que o ativo fica atrelado (059/HMO-436).
   *
   * `""` e "nenhuma" -- o ativo nasce SOLTO, que e o estado de todo ativo
   * cadastrado antes da 059. Ver `SEM_CONTA`.
   */
  accountId: string;
  rendaFixa: ValoresDeRendaFixa;
}

export function valoresDoAtivoVazios(): ValoresDoAtivo {
  return {
    symbol: "",
    nome: "",
    tipo: "stock",
    preco: "",
    // NASCE VAZIO, E NAO NA PRIMEIRA CONTA DA LISTA.
    //
    // Preencher com a primeira conta seria o default obvio e colapsaria a
    // feature: quem tem duas Contas Investimento cadastraria na errada sem
    // escolher nada, e o ativo apareceria somando na conta que a pessoa nao
    // quis -- dinheiro no lugar errado, sem erro em lugar nenhum. O elo e
    // opcional no banco de proposito (ver o cabecalho de lib/conta-do-ativo.ts),
    // e aqui ele nasce desse jeito.
    accountId: "",
    rendaFixa: valoresDeRendaFixaVazios(),
  };
}

/** A conta como o seletor a recebe. */
export interface ContaDeInvestimento {
  id: string;
  name: string;
}

/**
 * O valor da opcao "nenhuma conta" no `<Select>`.
 *
 * Ele existe porque o `SelectItem` do Radix RECUSA `value=""` em tempo de
 * execucao, e "" e justamente como o estado (e a rota) representam "sem conta".
 * O sentinela fica contido nesta fronteira: o estado continua guardando `""`, e
 * `corpoDoAtivo` nunca ve esta string. Confundir os dois mandaria
 * `accountId: "sem-conta"` para a rota, que responderia 400 "Conta invalida" --
 * uma recusa correta sobre um pedido que a tela montou errado.
 */
const SEM_CONTA = "sem-conta";

interface ModalDeCadastroDeAtivoProps {
  salvando: boolean;
  /**
   * As Contas Investimento ATIVAS do dono.
   *
   * So as de `account_type = 'investment'`: a trigger da 059 recusa qualquer
   * outra, e a rota traduz a recusa em "nao e uma Conta Investimento". Oferecer
   * a conta corrente aqui seria oferecer uma opcao que SEMPRE falha -- a pessoa
   * escolhe, aperta, e leva uma recusa que nao tinha como prever. Quem recorta
   * e a tela (ver `/dashboard/investments`).
   */
  contas: ContaDeInvestimento[];
  aoFechar: () => void;
  /** Grava. Devolve a frase de erro, ou `null` quando gravou. */
  aoSalvar: (valores: ValoresDoAtivo) => Promise<string | null>;
}

export function ModalDeCadastroDeAtivo({
  salvando,
  contas,
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
          {/* A CONTA INVESTIMENTO (HMO-438, F4 da HMO-432).
              Fora do `sm:grid-cols-2` -- `sm:col-span-2` -- porque o nome da
              conta e texto livre do usuario e um trilho de metade da largura o
              trunca; e porque a frase de ajuda abaixo nao cabe em meia coluna
              sem virar quatro linhas no celular. */}
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="novo-conta">Conta (opcional)</Label>
            <Select
              value={valores.accountId || SEM_CONTA}
              onValueChange={(v) => campo("accountId", v === SEM_CONTA ? "" : v)}
              disabled={salvando}
            >
              <SelectTrigger id="novo-conta">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {/* "Nenhuma" e uma opcao DE VERDADE e vem primeiro: sem ela o
                    Radix nao tem caminho de volta para o estado vazio, e quem
                    escolhesse uma conta por engano ficaria presa nela. */}
                <SelectItem value={SEM_CONTA}>
                  Nenhuma — deixar solto na carteira
                </SelectItem>
                {contas.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {contas.length === 0
                ? // O seletor vazio sem dizer por que e um seletor quebrado --
                  // e o motivo nao e obvio: nao falta ativo, falta uma conta do
                  // TIPO certo. A frase diz onde cadastrar.
                  "Você ainda não tem Conta Investimento. Cadastre uma em Contas para atrelar este ativo a ela."
                : "Atrelar à conta faz o valor deste ativo entrar no saldo dela e no seu patrimônio. Sem conta, ele fica só na carteira."}
            </p>
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
