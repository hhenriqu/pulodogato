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
import { MOEDA_PADRAO } from "@/lib/dinheiro";
import { moedaSugerida, opcoesDeMoeda } from "@/lib/moeda";
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
import { CampoDeCotacao } from "@/components/movimentacoes/CampoDeCotacao";
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
  /**
   * A checkbox de moeda aparece? Vem da preferencia do usuario
   * (`preferences.moeda.porLancamento`), e a issue pede exatamente isso: a
   * checkbox "deve aparecer quando configurado para aparecer através das
   * configuracoes".
   *
   * Nao e lida aqui por hook de proposito -- este componente e usado pelas duas
   * telas e pelo teste de JSX, que nao tem `fetch`.
   */
  moedaPorLancamento?: boolean;
  /**
   * A moeda oficial da pessoa. Ultimo recurso da sugestao, para o instante em
   * que ainda nao ha conta escolhida.
   */
  moedaOficial?: string;
  /**
   * O cartao que a tela de origem ja escolheu (HMO-210).
   *
   * Vem de "Lancar gasto neste cartao", em `/dashboard/cartoes/[id]`. Quando
   * esta preenchido, natureza e conta deixam de ser SELETOR e passam a ser
   * texto: a pessoa clicou num cartao especifico, e um seletor livre ali deixa
   * ela lancar no cartao errado tendo entrado pelo certo -- sem nada acusar,
   * porque os dois cartoes sao dela.
   *
   * Texto, e nao `<Select disabled>`, por dois motivos: o Radix nao imprime o
   * valor escolhido na renderizacao de servidor (o nome do cartao sairia em
   * branco no primeiro quadro), e um seletor cinza convida ao clique que nao
   * funciona.
   *
   * O objeto inteiro, e nao um booleano: e dele que sai o NOME na tela.
   */
  cartaoFixado?: ContaDeLancamento | null;
}

export function CamposDeLancamento({
  tipo,
  valores,
  aoMudar,
  categorias,
  contas,
  editando,
  rateio,
  moedaPorLancamento = false,
  moedaOficial = MOEDA_PADRAO,
  cartaoFixado = null,
}: CamposDeLancamentoProps) {
  // `valores.confirmado` entra aqui desde a HMO-188: e ele que decide se o campo
  // da data real existe e se a data prevista e obrigatoria. Esquece-lo deixaria
  // os dois campos na tela ao mesmo tempo, pedindo uma data de pagamento para um
  // lancamento que a pessoa acabou de dizer que nao pagou.
  const campos = camposDoTipo(
    tipo,
    valores.natureza,
    editando,
    valores.confirmado
  );
  // Nomeada, e nao `cartaoFixado ?` repetido no JSX: a conta usa a MESMA
  // condicao logo abaixo, e duas ocorrencias identicas da mesma expressao nao
  // dao para distinguir num controle negativo -- um mutante plantado na
  // primeira passaria por medir a segunda.
  const naturezaTravada = Boolean(cartaoFixado);
  const categoriasVisiveis = categoriasDoTipo(categorias, tipo);
  const contasVisiveis = contasDoSeletor(contas, tipo, valores.natureza);
  const naturezasVisiveis = naturezasDoTipo(tipo);
  // A conta escolhida, para saber que moeda ela sugere.
  const contaEscolhida = contas.find((c) => c.id === valores.contaId);

  return (
    <div className="space-y-6">
      {campos.natureza && (
        <div className="space-y-2">
          <Label>{campos.rotuloDaNatureza}</Label>
          {naturezaTravada ? (
            // Com cartao fixado a natureza nao e pergunta: a tela de origem e a
            // fatura de um cartao, e "Despesa Fixa" ali gravaria uma regra
            // mensal em `recurring_rules` em vez da compra.
            <>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <CreditCard className="h-4 w-4 text-info" />
                <span className="text-sm font-medium text-foreground">
                  {ROTULO_DA_NATUREZA[tipo].card}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {AJUDA_DA_NATUREZA[tipo].card}
              </p>
            </>
          ) : (
            <>
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
            {/* O `id` nao e decoracao: o radix renderiza as OPCOES num portal,
                que so existe com o seletor aberto, entao "a natureza nao se
                troca" nao da para afirmar pelos nomes das opcoes -- elas nao
                saem no HTML do servidor nem quando o seletor esta la. O que da
                para afirmar e a presenca do proprio seletor, e para isso ele
                precisa de ancora. Mesma razao do `id="account"` abaixo. */}
            <SelectTrigger id="natureza">
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
            </>
          )}
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
          {/* `moeda` decide o simbolo E O NUMERO DE CASAS da mascara. Sem
              isto um valor em iene apareceria como "R$ 1.000,00" -- e iene nao
              tem centavos, entao a mascara inventaria uma subdivisao que a moeda
              nao possui e o numero digitado sairia cem vezes menor. */}
          <CampoDeValor
            id="amount"
            value={valores.valor}
            onChange={(valor) => aoMudar({ valor })}
            moeda={valores.moeda}
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
          {cartaoFixado ? (
            // O cartao travado. Nome em texto, nao seletor -- ver `cartaoFixado`
            // nas props. O link de volta esta no topo da pagina do cartao.
            <div
              id="account"
              className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2"
            >
              <CreditCard className="h-4 w-4 text-info" />
              <span className="text-sm font-medium text-foreground">
                {cartaoFixado.name}
              </span>
            </div>
          ) : (
          <Select
            value={valores.contaId}
            // Trocar de conta arrasta a moeda -- MENOS quando a pessoa marcou a
            // checkbox. Sem a excecao, escolher dolar e depois corrigir a conta
            // jogaria a moeda de volta para a da conta, desfazendo em silencio
            // uma escolha explicita com o campo ainda aberto na tela mostrando o
            // valor antigo.
            onValueChange={(value: string) => {
              if (valores.moedaSobreposta) {
                aoMudar({ contaId: value });
                return;
              }
              const conta = contas.find((c) => c.id === value);
              aoMudar({
                contaId: value,
                moeda: moedaSugerida({
                  daConta: conta?.currency,
                  oficial: moedaOficial,
                }),
              });
            }}
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
          )}
          {/* Sem isto, escolher "Gasto no Cartao" sem ter cartao nenhum abre um
              seletor vazio e sem explicacao. Com cartao fixado nao cabe: ha um
              cartao, e ele e o da tela anterior. */}
          {!cartaoFixado && campos.contaObrigatoria && contasVisiveis.length === 0 && (
            <p className="text-xs text-warning">
              Você ainda não tem nenhum cartão de crédito cadastrado. Cadastre
              em Cartões.
            </p>
          )}

          {/* A MOEDA DESTE LANCAMENTO (HMO-171)

              Fica logo DEPOIS do seletor de conta, e nao antes, porque a conta e
              quem sugere a moeda: ler "Conta: Nubank / Moeda: R$" na ordem
              inversa faz a pessoa escolher a moeda e depois ver o valor mudar
              debaixo do dedo ao trocar a conta.

              A checkbox nao guarda moeda nenhuma -- ela REVELA o seletor, e ao
              ser desmarcada devolve a moeda para a sugestao da conta. Sem esse
              retorno, quem marcasse, escolhesse dolar e desmarcasse gravaria em
              dolar com o campo invisivel na tela. */}
          {moedaPorLancamento && (
            <div className="space-y-2 pt-1">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-primary"
                  checked={valores.moedaSobreposta}
                  onChange={(e) =>
                    aoMudar(
                      e.target.checked
                        ? { moedaSobreposta: true }
                        : {
                            moedaSobreposta: false,
                            moeda: moedaSugerida({
                              daConta: contaEscolhida?.currency,
                              oficial: moedaOficial,
                            }),
                          }
                    )
                  }
                />
                Este lançamento está em outra moeda
              </label>

              {valores.moedaSobreposta && (
                <>
                  <Select
                    value={valores.moeda}
                    // Trocar a moeda LIMPA a cotacao (HMO-182). A cotacao do
                    // dolar nao significa nada para o euro, e deixa-la ali faria
                    // o campo parecer preenchido e correto -- o CampoDeCotacao so
                    // busca automatico quando esta vazio, entao sem esta limpeza
                    // a taxa velha seria gravada na moeda nova.
                    onValueChange={(valor) =>
                      aoMudar({ moeda: valor, cotacao: "" })
                    }
                  >
                    <SelectTrigger id="lancamento-moeda">
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
                  {/* O valor fica gravado NESTA moeda -- o que muda desde a 026 e
                      que agora existe cotacao, e por isso o grupo consegue
                      converter. O relatorio pessoal continua separando por moeda
                      (decisao da HMO-171: "gastei 1.000 reais e 180 dolares" e a
                      resposta certa para o extrato de uma pessoa). */}
                  <p className="text-xs text-muted-foreground">
                    O valor é registrado nesta moeda. Nos seus relatórios os
                    totais aparecem separados por moeda; no acerto do grupo e na
                    barra de orçamento eles são convertidos pela cotação abaixo.
                  </p>
                </>
              )}
            </div>
          )}

          {/* A COTACAO FICA FORA DO `moedaPorLancamento` DE PROPOSITO (HMO-182)

              A checkbox de moeda por lancamento e uma preferencia, e vem
              DESLIGADA. A moeda do lancamento, nao: ela vem da CONTA. Quem tem
              uma conta em dolar grava lancamentos em dolar sem nunca ter ligado
              preferencia nenhuma -- `moedaSugerida({ daConta })`, no seletor de
              conta logo acima.

              Se este campo morasse dentro do bloco da preferencia, essa pessoa
              veria "Erro ao gravar o lancamento" para sempre, sem campo na tela
              para consertar: o CHECK da 026 exige cotacao para moeda estrangeira,
              e a tela nao teria onde pedi-la. A condicao certa e a moeda do
              lancamento, e so ela. */}
          <CampoDeCotacao
            moeda={valores.moeda}
            data={valores.data}
            cotacao={valores.cotacao}
            valor={valores.valor}
            aoMudar={(cotacao) => aoMudar({ cotacao })}
          />
        </div>

        {/* A DATA EM QUE O DINHEIRO ANDOU (HMO-188)

            Ela SOME quando a pessoa desmarca a confirmacao: um lancamento que
            ainda nao aconteceu nao tem data de pagamento, e o campo com a data
            de hoje dentro pareceria uma resposta ja dada. Quem decide e
            `campos.dataDeRealizacao`, nao `valores.confirmado` -- numa despesa
            fixa esta data e o `start_date` da regra e nao pode desaparecer. */}
        {campos.dataDeRealizacao && (
          <div className="space-y-2">
            <Label htmlFor="date">{campos.rotuloDaData}</Label>
            <Input
              id="date"
              type="date"
              value={valores.data}
              onChange={(e) => aoMudar({ data: e.target.value })}
            />
          </div>
        )}

        {campos.dataPrevista && (
          <div className="space-y-2">
            <Label htmlFor="expected-date">{campos.rotuloDaDataPrevista}</Label>
            <Input
              id="expected-date"
              type="date"
              value={valores.dataPrevista}
              onChange={(e) => aoMudar({ dataPrevista: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              {campos.dataDeRealizacao
                ? "Quando era esperado. Deixe igual à data acima se não houve atraso."
                : `Quando você espera ${
                    tipo === "expense" ? "pagar" : "receber"
                  }. Fica em Contas Previstas até você confirmar.`}
            </p>
          </div>
        )}
      </div>

      {/* A CONFIRMACAO: "JA PAGUEI" / "JA RECEBI" (HMO-188)

          Fica DEPOIS das datas de proposito -- ela e quem decide se a data de
          cima existe, e uma checkbox acima do campo que ela liga se le como
          filtro, nao como pergunta.

          O que esta em jogo nao e cosmetico: marcada, o lancamento vai para
          `financial_transactions` e mexe no saldo agora; desmarcada, vai para
          `scheduled_transactions` e espera a confirmacao. O aviso ao lado existe
          porque essa e a unica coisa na tela que muda de tabela. */}
      {campos.confirmacao && (
        <div className="space-y-2 p-4 border rounded-lg bg-muted/20">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="confirmado"
              checked={valores.confirmado}
              onChange={(e) => aoMudar({ confirmado: e.target.checked })}
            />
            <Label htmlFor="confirmado" className="font-medium">
              {campos.rotuloDaConfirmacao}
            </Label>
          </div>
          <p className="text-xs text-muted-foreground">
            {valores.confirmado
              ? tipo === "expense"
                ? "O valor sai do saldo da conta agora."
                : "O valor entra no saldo da conta agora."
              : `Ainda não ${
                  tipo === "expense" ? "pagou" : "recebeu"
                }: vai para Contas Previstas e não mexe no saldo até você confirmar lá.`}
          </p>
        </div>
      )}

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
                  moeda={valores.moeda}
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
