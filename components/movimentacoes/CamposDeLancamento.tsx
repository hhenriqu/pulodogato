"use client";

// ---------------------------------------------------------------------------
// OS CAMPOS DE UM LANCAMENTO (HMO-165)
// ---------------------------------------------------------------------------
// Componente sem banco e sem hook de dados: ele recebe os valores, devolve as
// mudancas, e decide o que mostrar chamando `camposDoTipo`. Essa separacao e o
// que permite o teste renderizar os campos de verdade com `react-dom/server`,
// afirmando sobre a arvore que sai -- e o defeito que esta tela corrige era
// JSX, nao calculo: uma funcao pura `mostraParcelamento(tipo)` passaria verde
// com os tres formularios sobrepostos intactos.
//
// O bloco de rateio entra pelo slot `rateio` porque ele precisa do plano do
// usuario (`SoftFeatureGuard`), e isso arrastaria supabase para dentro de um
// componente que nao precisa dele. Quem decide se o slot aparece continua
// sendo aqui -- `camposDoTipo(tipo).rateio` -- e nao quem passa o slot.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { CampoDeValor } from "@/components/ui/campo-de-valor";
import { formatarValor, valorNumerico } from "@/lib/dinheiro";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarClock, CreditCard, Receipt, Repeat } from "lucide-react";
import {
  camposDoTipo,
  categoriasDoTipo,
  contasDoSeletor,
  naturezasDoTipo,
  MAX_MESES_DE_REPETICAO,
  type CategoriaDeLancamento,
  type ContaDeLancamento,
  type DuracaoDaRepeticao,
  type NaturezaDespesa,
  type TipoLancamento,
  type ValoresDeLancamento,
} from "@/lib/lancamento";

// ---------------------------------------------------------------------------
// OS ROTULOS DE CADA NATUREZA, POR TELA
// ---------------------------------------------------------------------------
// Tabela em vez de `tipo === "expense" ? ... : ...` espalhado pelo JSX: com duas
// telas e tres naturezas sao seis textos, e o ternario aninhado e onde a receita
// herdou "Despesa Fixa" escrito na tela dela.
const ROTULO_DA_NATUREZA: Record<
  TipoLancamento,
  Record<NaturezaDespesa, string>
> = {
  expense: {
    one_off: "Despesa Pontual",
    card: "Gasto no Cartão",
    fixed: "Despesa Fixa",
  },
  income: {
    one_off: "Receita Pontual",
    // O caso que deu nome a issue: salario. "Receita Fixa" e o rotulo generico,
    // e o texto de ajuda abaixo cita o salario para quem procura por ele.
    card: "Gasto no Cartão",
    fixed: "Receita Fixa",
  },
};

const AJUDA_DA_NATUREZA: Record<
  TipoLancamento,
  Record<NaturezaDespesa, string>
> = {
  expense: {
    one_off: "Um gasto avulso, lançado só nesta data.",
    card: "Entra na fatura do cartão escolhido, no mês certo conforme o dia do fechamento.",
    fixed:
      "Vira uma regra mensal em Contas Previstas, que passa a cobrar você todo mês.",
  },
  income: {
    one_off: "Uma entrada avulsa, lançada só nesta data.",
    card: "",
    fixed:
      "Salário, aluguel recebido, mensalidade: vira uma regra mensal em Contas Previstas, que passa a prever essa entrada todo mês.",
  },
};

const ICONE_DA_NATUREZA: Record<NaturezaDespesa, typeof Receipt> = {
  one_off: Receipt,
  card: CreditCard,
  fixed: Repeat,
};

const COR_DA_NATUREZA: Record<NaturezaDespesa, string> = {
  one_off: "text-muted-foreground",
  card: "text-info",
  fixed: "text-warning",
};

interface CamposDeLancamentoProps {
  tipo: TipoLancamento;
  valores: ValoresDeLancamento;
  /** Recebe so o que mudou; quem mescla e o container. */
  aoMudar: (mudanca: Partial<ValoresDeLancamento>) => void;
  categorias: CategoriaDeLancamento[];
  contas: ContaDeLancamento[];
  editando: boolean;
  /** O bloco de divisao/grupo, montado pelo container. So despesa o recebe. */
  rateio?: ReactNode;
}

export function CamposDeLancamento({
  tipo,
  valores,
  aoMudar,
  categorias,
  contas,
  editando,
  rateio,
}: CamposDeLancamentoProps) {
  const campos = camposDoTipo(tipo, valores.natureza, editando);
  const categoriasVisiveis = categoriasDoTipo(categorias, tipo);
  const contasVisiveis = contasDoSeletor(contas, tipo, valores.natureza);
  const naturezasVisiveis = naturezasDoTipo(tipo);

  return (
    <div className="space-y-6">
      {campos.natureza && (
        <div className="space-y-2">
          <Label>{campos.rotuloDaNatureza}</Label>
          <Select
            value={valores.natureza}
            onValueChange={(value) =>
              aoMudar({
                natureza: value as NaturezaDespesa,
                // Trocar de natureza invalida a conta escolhida: a lista muda
                // (cartao x todas), e manter o id antigo deixaria selecionada
                // uma conta que nao esta mais no seletor.
                contaId: value === "card" ? "" : valores.contaId,
              })
            }
            disabled={editando}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {/* As opcoes saem de `naturezasDoTipo`, nao de tres itens fixos:
                  receita nao tem "no cartao", e um item a mais aqui deixaria a
                  tela oferecer um caminho que a validacao recusa depois. */}
              {naturezasVisiveis.map((opcao) => {
                const Icone = ICONE_DA_NATUREZA[opcao];
                return (
                  <SelectItem key={opcao} value={opcao}>
                    <div className="flex items-center gap-2">
                      <Icone className={`h-4 w-4 ${COR_DA_NATUREZA[opcao]}`} />
                      <span>{ROTULO_DA_NATUREZA[tipo][opcao]}</span>
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {AJUDA_DA_NATUREZA[tipo][valores.natureza]}
          </p>
        </div>
      )}

      {campos.diaDeVencimento && (
        <div className="space-y-2">
          <Label htmlFor="due_day">
            {tipo === "expense" ? "Vence todo dia *" : "Cai todo dia *"}
          </Label>
          <Input
            id="due_day"
            type="number"
            min={1}
            max={31}
            value={valores.diaDeVencimento}
            onChange={(e) => aoMudar({ diaDeVencimento: e.target.value })}
            placeholder="Ex: 10"
          />
          <p className="text-xs text-muted-foreground">
            Dia 29, 30 ou 31 cai no último dia do mês quando o mês for mais
            curto.
          </p>
        </div>
      )}

      {/* POR QUANTOS MESES (HMO-170)
          O bloco so existe junto com o dia do vencimento -- `campos.duracao` tem
          a mesma condicao -- porque as duas perguntas descrevem a MESMA regra.
          Mostrar a duracao sem o dia deixaria a pessoa dizer "por 12 meses" sem
          dizer quando vence. */}
      {campos.duracao && (
        <div className="space-y-3 p-4 border rounded-lg bg-muted/20">
          <Label>Por quanto tempo *</Label>
          <Select
            value={valores.duracao}
            onValueChange={(value) =>
              aoMudar({
                duracao: value as DuracaoDaRepeticao,
                // Voltar para "todos os meses" limpa a contagem: deixar o numero
                // no estado faria ele voltar a valer se a pessoa trocasse de
                // novo, cadastrando um prazo que ela ja tinha desistido de por.
                mesesDeRepeticao:
                  value === "contada" ? valores.mesesDeRepeticao : "",
              })
            }
          >
            <SelectTrigger id="duracao">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="indefinida">
                <div className="flex items-center gap-2">
                  <Repeat className="h-4 w-4 text-warning" />
                  <span>Todos os meses, sem data de fim</span>
                </div>
              </SelectItem>
              <SelectItem value="contada">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-info" />
                  <span>Por um número de meses</span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>

          {valores.duracao === "contada" && (
            <div className="space-y-2">
              <Label htmlFor="meses_de_repeticao">Quantos meses *</Label>
              <Input
                id="meses_de_repeticao"
                type="number"
                min={2}
                max={MAX_MESES_DE_REPETICAO}
                value={valores.mesesDeRepeticao}
                onChange={(e) =>
                  aoMudar({ mesesDeRepeticao: e.target.value })
                }
                placeholder="Ex: 12"
              />
              <p className="text-xs text-muted-foreground">
                Conta a partir deste mês. Depois do último, a cobrança para
                sozinha.
              </p>
            </div>
          )}

          {valores.duracao === "indefinida" && (
            <p className="text-xs text-muted-foreground">
              Continua até você desativar em Contas Previstas.
            </p>
          )}
        </div>
      )}

      {/* `grid-cols-1` explicito: sem a coluna de base, o trilho `auto` tem o
          min-content como PISO e estoura o container no celular (HMO-168). */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="description">Descrição *</Label>
          <Input
            id="description"
            value={valores.descricao}
            onChange={(e) => aoMudar({ descricao: e.target.value })}
            placeholder={
              tipo === "expense"
                ? "Ex: Compra no supermercado"
                : "Ex: Salário de setembro"
            }
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="amount">Valor *</Label>
          <CampoDeValor
            id="amount"
            value={valores.valor}
            onChange={(valor) => aoMudar({ valor })}
            required
          />
          {/* O valor e digitado positivo nas duas telas. Quem aplica o sinal de
              despesa e `valorGravado`, e a tela diz isso em vez de deixar a
              pessoa somar um menos na frente "para garantir".
              O campo tambem nao ACEITA mais o menos (HMO-171): era `type=number`
              e "-30" numa tela de despesa virava `-(-30) = +30`. */}
          <p className="text-xs text-muted-foreground">
            {tipo === "expense"
              ? "Digite quanto saiu, sem sinal. A despesa é lançada como saída."
              : "Digite quanto entrou."}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="category">
            {tipo === "expense" ? "Categoria da despesa *" : "Categoria da receita *"}
          </Label>
          <Select
            value={valores.categoriaId}
            onValueChange={(value: string) => aoMudar({ categoriaId: value })}
          >
            <SelectTrigger id="category">
              <SelectValue placeholder="Selecione uma categoria" />
            </SelectTrigger>
            <SelectContent>
              {categoriasVisiveis.map((categoria) => (
                <SelectItem key={categoria.id} value={categoria.id}>
                  {categoria.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Uma lista vazia aqui nao e "escolha uma": e "nao ha o que
              escolher", e as duas dao a mesma tela sem este aviso. */}
          {categoriasVisiveis.length === 0 && (
            <p className="text-xs text-warning">
              Nenhuma categoria de {tipo === "expense" ? "despesa" : "receita"}{" "}
              disponível. Abra esta tela uma vez com internet.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="account">{campos.rotuloDaConta}</Label>
          <Select
            value={valores.contaId}
            onValueChange={(value: string) => aoMudar({ contaId: value })}
          >
            <SelectTrigger id="account">
              <SelectValue
                placeholder={
                  campos.contaObrigatoria
                    ? "Selecione um cartão"
                    : "Selecione uma conta"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {contasVisiveis.map((conta) => (
                <SelectItem key={conta.id} value={conta.id}>
                  {conta.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Sem isto, escolher "Gasto no Cartao" sem ter cartao nenhum abre um
              seletor vazio e sem explicacao. */}
          {campos.contaObrigatoria && contasVisiveis.length === 0 && (
            <p className="text-xs text-warning">
              Você ainda não tem nenhum cartão de crédito cadastrado. Cadastre
              em Cartões.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="date">Data</Label>
          <Input
            id="date"
            type="date"
            value={valores.data}
            onChange={(e) => aoMudar({ data: e.target.value })}
          />
        </div>
      </div>

      {campos.parcelamento && (
        <div className="space-y-4 p-4 border rounded-lg bg-muted/20">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_installment"
              checked={valores.parcelado}
              onChange={(e) => aoMudar({ parcelado: e.target.checked })}
            />
            <Label htmlFor="is_installment" className="font-medium">
              Parcelar esta despesa
            </Label>
            <Badge variant="outline" className="text-xs">
              Apenas para novas despesas
            </Badge>
          </div>

          {valores.parcelado && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="total_installments">Número de Parcelas</Label>
                <Input
                  id="total_installments"
                  type="number"
                  min="2"
                  max="60"
                  value={valores.totalDeParcelas}
                  onChange={(e) =>
                    aoMudar({
                      totalDeParcelas: parseInt(e.target.value) || 1,
                    })
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="installment_amount">Valor da Parcela</Label>
                <CampoDeValor
                  id="installment_amount"
                  value={valores.valorDaParcela}
                  onChange={(valorDaParcela) => {
                    // `valorNumerico` em vez de `parseFloat` solto: e a mesma
                    // conversao que o resto do app usa, e ela devolve 0 no lugar
                    // de NaN -- um NaN aqui contaminaria o valor TOTAL, que e o
                    // que a rota de parcelas grava.
                    const parcela = valorNumerico(valorDaParcela);
                    aoMudar({
                      valorDaParcela,
                      // O valor total acompanha a parcela: e ele que a rota de
                      // parcelas recebe, e deixar os dois independentes ja
                      // gravou compra de 10x com o total de uma parcela.
                      valor: (parcela * valores.totalDeParcelas).toFixed(2),
                    });
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Total:{" "}
                  {formatarValor(
                    valorNumerico(valores.valorDaParcela) *
                      valores.totalDeParcelas
                  )}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="first_due_date">Primeira Parcela</Label>
                <Input
                  id="first_due_date"
                  type="date"
                  value={valores.primeiroVencimento}
                  onChange={(e) =>
                    aoMudar({ primeiroVencimento: e.target.value })
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="notes">Observações</Label>
        <Textarea
          id="notes"
          value={valores.notas}
          onChange={(e) => aoMudar({ notas: e.target.value })}
          placeholder="Informações adicionais..."
          rows={3}
        />
      </div>

      {campos.rateio && rateio}
    </div>
  );
}
