"use client";

// ---------------------------------------------------------------------------
// OS CAMPOS DE UMA CONTA, OU DE UM CARTAO (HMO-166)
// ---------------------------------------------------------------------------
// Componente sem banco e sem hook de dados: recebe os valores, devolve as
// mudancas, e decide o que mostrar chamando `camposDoEscopo`. E o que permite o
// teste renderizar os campos de verdade com `react-dom/server` e afirmar sobre
// a arvore que sai -- porque o defeito que esta tela corrige era JSX, e nao
// calculo. Uma funcao pura `mostraLimite(tipo)` passaria verde com os dois
// formularios sobrepostos intactos, do jeito que estavam.
//
// A queixa era esta, literal: quem abria para cadastrar uma conta corrente via
// limite, dia de fechamento e dia de vencimento aparecerem e sumirem conforme
// trocava o tipo no seletor. Agora a tela de Contas nao tem esses tres campos
// em estado nenhum -- nao ha `if` que os traga de volta, porque eles nao estao
// no arquivo do escopo errado, estao atras de `campos.fatura`.
// ---------------------------------------------------------------------------

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CampoDeValor } from "@/components/ui/campo-de-valor";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  camposDoEscopo,
  tiposDoEscopo,
  type EscopoDeConta,
  type ValoresDaConta,
} from "@/lib/contas";
import { Switch } from "@/components/ui/switch";
import { opcoesDeMoeda } from "@/lib/moeda";
import type { AccountType } from "@/types/financial";

interface CamposDaContaProps {
  escopo: EscopoDeConta;
  valores: ValoresDaConta;
  aoMudar: (valores: ValoresDaConta) => void;
  /** Edicao de algo que ja existe: o tipo nao muda mais. */
  editando: boolean;
  /**
   * Mostra o seletor de moeda (HMO-171). Vem de fora, e nao de um hook chamado
   * aqui dentro, para nao quebrar a promessa do cabecalho deste arquivo:
   * componente sem banco e sem hook de dados, que e o que deixa o teste
   * renderizar os campos de verdade com `react-dom/server`.
   */
  mostrarMoeda?: boolean;
}

export function CamposDaConta({
  escopo,
  valores,
  aoMudar,
  editando,
  mostrarMoeda = false,
}: CamposDaContaProps) {
  const campos = camposDoEscopo(escopo);
  const mudar = (parcial: Partial<ValoresDaConta>) =>
    aoMudar({ ...valores, ...parcial });

  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="name">Nome</Label>
        <Input
          id="name"
          value={valores.name}
          onChange={(e) => mudar({ name: e.target.value })}
          placeholder={
            escopo === "cartao"
              ? "Nubank, Visa Infinite, cartão da loja..."
              : "Conta do Itaú, poupança, carteira..."
          }
        />
      </div>

      {/*
        Em Cartoes ha um tipo so, entao nao existe escolha a oferecer: o seletor
        seria um menu de um item. O `account_type` continua sendo gravado -- ele
        vem de `tipoPadraoDoEscopo` nos valores iniciais.
      */}
      {campos.tipo && (
        <div className="space-y-2">
          <Label>Tipo</Label>
          <Select
            value={valores.account_type}
            onValueChange={(valor) =>
              mudar({ account_type: valor as AccountType })
            }
            // O tipo decide como o saldo e lido em todo o app. Trocar depois de
            // ter lancamento reinterpretaria o historico inteiro.
            disabled={editando}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {tiposDoEscopo(escopo).map((tipo) => (
                <SelectItem key={tipo.valor} value={tipo.valor}>
                  {tipo.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {editando && (
            <p className="text-xs text-muted-foreground">
              O tipo não muda depois de criada: ele decide como os lançamentos
              já feitos são lidos.
            </p>
          )}
        </div>
      )}

      {/*
        A moeda da conta (HMO-171). So aparece com o recurso ligado nas
        configuracoes -- a issue pede que a escolha de moeda seja condicionada a
        isso, e quem nunca vai usar outra moeda nao ganha um campo a mais.

        O campo fica OCULTO, nao desabilitado: `valores.currency` continua no
        estado e continua sendo mandado por `corpoDaConta`. Uma conta em dolar
        criada com o recurso ligado nao pode voltar para BRL porque a pessoa
        desligou o recurso e editou o nome depois.
      */}
      {mostrarMoeda && (
        <div className="space-y-2">
          <Label htmlFor="conta-moeda">Moeda</Label>
          <Select
            value={valores.currency}
            onValueChange={(valor) => mudar({ currency: valor })}
          >
            <SelectTrigger id="conta-moeda">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {opcoesDeMoeda().map((o) => (
                <SelectItem key={o.codigo} value={o.codigo}>
                  {o.rotulo}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {editando
              ? "Vale para os lançamentos novos desta conta. Os que já existem ficam na moeda em que foram registrados."
              : "Os lançamentos desta conta vão sugerir esta moeda."}
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="bank">Banco</Label>
          <Input
            id="bank"
            value={valores.bank_name}
            onChange={(e) => mudar({ bank_name: e.target.value })}
            placeholder="Opcional"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="digits">Últimos 4 dígitos</Label>
          <Input
            id="digits"
            inputMode="numeric"
            maxLength={4}
            value={valores.last_four_digits}
            onChange={(e) =>
              mudar({ last_four_digits: e.target.value.replace(/\D/g, "") })
            }
            placeholder="Opcional"
          />
        </div>
      </div>

      {campos.fatura && (
        <>
          <div className="space-y-2">
            <Label htmlFor="limit">Limite</Label>
            {/*
              Campo de dinheiro, entao passa pelo CampoDeValor (HMO-171): o
              input cru aceitava "1.000,00", e `parseFloat` disso e 1. Um limite
              de mil reais gravado como um real nao derruba nada -- so faz o
              cartao parecer estourado desde a primeira compra.
            */}
            <CampoDeValor
              id="limit"
              value={valores.credit_limit}
              onChange={(valorPlano) => mudar({ credit_limit: valorPlano })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="closing">Dia do fechamento</Label>
              <Input
                id="closing"
                inputMode="numeric"
                value={valores.closing_day}
                onChange={(e) => mudar({ closing_day: e.target.value })}
                placeholder="1 a 31"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="due">Dia do vencimento</Label>
              <Input
                id="due"
                inputMode="numeric"
                value={valores.due_day}
                onChange={(e) => mudar({ due_day: e.target.value })}
                placeholder="1 a 31"
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Sem esses dois dias a fatura não fecha, e uma compra feita depois do
            fechamento aparece no mês errado.
          </p>
        </>
      )}

      {/* ------------------------------------------------------------------
          SOMAR NOS TOTAIS (HMO-431)

          FORA DE `campos.fatura`, e de proposito: o pedido e "o mesmo para
          TODAS as contas", entao o campo vale nos dois escopos -- conta
          corrente e cartao. Posto dentro daquele bloco, ele desapareceria da
          tela de Contas, que e justamente onde o caso real mora (a conta da
          empresa, a conjunta, a de terceiro).

          O ROTULO E POSITIVO ("Somar nos totais"), apesar de o pedido estar na
          forma negativa ("optar nao somar"). Um rotulo negativo ao lado de um
          switch cria a dupla negacao na cabeca de quem le: desligar "Não somar
          nos totais" passa a querer dizer que soma. A frase de baixo e que
          carrega o "não" -- uma vez, e em cima da consequencia.

          E A FRASE DIZ O QUE **NAO** MUDA. Esta e a parte que nao pode sair: o
          medo de desmarcar e perder lancamento, e sem dizer "continua
          recebendo lancamento e aparecendo no extrato" o campo e
          indistinguivel de arquivar a conta -- que e o botao ao lado, e faz
          outra coisa.

          OS DOIS RAMOS ENUMERAM AS MESMAS QUATRO LEITURAS (HMO-488). O ramo
          desligado dizia o generico "so nao entra nas somas", que se le como
          TODAS as somas -- e nao e: o interruptor vale para as quatro leituras
          de SALDO (saldo total, patrimonio, "posso gastar", projecao), e o
          lancamento da conta desligada CONTINUA contando nos relatorios de
          gasto (fluxo de caixa, total por categoria, resumo mensal, anomalias,
          previsto x realizado). Isso foi decidido, nao esquecido: um
          interruptor so nao consegue separar a conta de terceiro -- cujo gasto
          nao e meu -- da conta conjunta, cujo gasto e meu mesmo; e tirar o
          gasto do relatorio erraria do lado silencioso, sumindo com linha sem
          sintoma na tela. Quem quer excluir um lancamento especifico tem o
          `include_in_total` por lancamento (migration 060). Entao a frase
          precisa NOMEAR as quatro, nos dois ramos: generalizar aqui foi a
          causa da duvida.
          ------------------------------------------------------------------ */}
      <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
        <div className="space-y-1">
          <Label htmlFor="conta-soma-nos-totais">Somar nos totais</Label>
          <p className="text-xs text-muted-foreground">
            {valores.include_in_total
              ? `Esta ${campos.substantivo === "cartão" ? "fatura entra" : "conta entra"} no saldo total, no patrimônio, no "posso gastar" e na projeção.`
              : `Fora dos totais. A ${campos.substantivo === "cartão" ? "fatura" : "conta"} continua recebendo lançamentos, aparecendo no extrato e contando nos relatórios de gasto — só não entra no saldo total, no patrimônio, no "posso gastar" nem na projeção.`}
          </p>
        </div>
        <Switch
          id="conta-soma-nos-totais"
          checked={valores.include_in_total}
          onCheckedChange={(marcado) => mudar({ include_in_total: marcado })}
        />
      </div>
    </>
  );
}
